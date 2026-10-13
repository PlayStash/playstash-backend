import { CronTime } from "cron";
import { performance } from "node:perf_hooks";
import { Transform, type TransformCallback } from "node:stream";

export interface DownloadBandwidthConfiguration {
  MAX_DOWNLOAD_BANDWIDTH_IN_KBPS?: number;
  MAX_DOWNLOAD_BANDWIDTH_SCHEDULE?: string;
  MAX_DOWNLOAD_BANDWIDTH_SCHEDULE_TIMEZONE?: string;
  MAX_DOWNLOAD_BANDWIDTH_IN_KBPS_IN_SCHEDULE?: number;
  MAX_DOWNLOAD_BANDWIDTH_IN_KBPS_OUT_SCHEDULE?: number;
}

/** Configuration values are bytes/second; the optional client header is KiB/second. */
export function createDownloadRateProvider(
  config: DownloadBandwidthConfiguration,
  clientKibibytesPerSecond?: number,
): (now?: Date) => number {
  const clientLimit =
    Number.isFinite(clientKibibytesPerSecond) &&
    clientKibibytesPerSecond! > 0 &&
    clientKibibytesPerSecond! <= Number.MAX_SAFE_INTEGER / 1024
      ? clientKibibytesPerSecond! * 1024
      : 0;
  const expression = config.MAX_DOWNLOAD_BANDWIDTH_SCHEDULE?.trim();
  if (expression && expression.split(/\s+/).length !== 5) {
    throw new Error(
      "SERVER_MAX_DOWNLOAD_BANDWIDTH_SCHEDULE must contain five cron fields.",
    );
  }
  const timezone =
    config.MAX_DOWNLOAD_BANDWIDTH_SCHEDULE_TIMEZONE ||
    Intl.DateTimeFormat().resolvedOptions().timeZone;
  const schedule = expression ? new CronTime(expression, timezone) : undefined;
  let cachedMinute = Number.NaN;
  let insideSchedule = false;
  return (now = new Date()) => {
    let serverLimit = config.MAX_DOWNLOAD_BANDWIDTH_IN_KBPS ?? 0;
    if (schedule) {
      const minute = Math.floor(now.getTime() / 60_000) * 60_000;
      if (minute !== cachedMinute) {
        insideSchedule =
          schedule
            .getNextDateFrom(new Date(minute - 1000), timezone)
            .toMillis() === minute;
        cachedMinute = minute;
      }
      serverLimit = insideSchedule
        ? (config.MAX_DOWNLOAD_BANDWIDTH_IN_KBPS_IN_SCHEDULE ?? serverLimit)
        : (config.MAX_DOWNLOAD_BANDWIDTH_IN_KBPS_OUT_SCHEDULE ?? 0);
    }
    if (!Number.isFinite(serverLimit) || serverLimit <= 0) serverLimit = 0;
    return serverLimit && clientLimit
      ? Math.min(serverLimit, clientLimit)
      : serverLimit || clientLimit;
  };
}

/** Re-evaluates schedules during a download, with at most 100 ms of rate-change delay. */
export class DynamicDownloadThrottle extends Transform {
  private timer?: ReturnType<typeof setTimeout>;
  private credit = 0;
  private lastTick = performance.now();
  private lastRate = -1;

  constructor(private readonly rate: () => number) {
    super();
  }

  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: TransformCallback,
  ) {
    let offset = 0;
    const pump = () => {
      this.timer = undefined;
      if (this.destroyed) return;
      try {
        const rate = this.rate();
        const now = performance.now();
        if (rate !== this.lastRate) {
          this.credit = 0;
          this.lastRate = rate;
          this.lastTick = now;
        }
        if (rate <= 0) {
          this.push(chunk.subarray(offset));
          callback();
          return;
        }
        this.credit = Math.min(
          Math.max(1, rate / 10),
          this.credit + ((now - this.lastTick) / 1000) * rate,
        );
        this.lastTick = now;
        const length = Math.min(
          chunk.length - offset,
          Math.floor(this.credit),
          64 * 1024,
        );
        if (length > 0) {
          this.push(chunk.subarray(offset, offset + length));
          offset += length;
          this.credit -= length;
        }
        if (offset === chunk.length) callback();
        else
          this.timer = setTimeout(
            pump,
            Math.min(
              100,
              Math.max(1, Math.ceil(((1 - this.credit) / rate) * 1000)),
            ),
          );
      } catch (error) {
        callback(error as Error);
      }
    };
    pump();
  }

  override _destroy(
    error: Error | null,
    callback: (error?: Error | null) => void,
  ) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    callback(error);
  }
}
