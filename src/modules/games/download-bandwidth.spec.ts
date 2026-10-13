import { Readable } from "node:stream";
import {
  createDownloadRateProvider,
  DynamicDownloadThrottle,
} from "./download-bandwidth.js";

describe("download bandwidth", () => {
  const at = (iso: string) => new Date(iso);
  it("does not convert server bytes twice and prevents a client from bypassing the cap", () => {
    expect(
      createDownloadRateProvider(
        { MAX_DOWNLOAD_BANDWIDTH_IN_KBPS: 2048 },
        100,
      )(),
    ).toBe(2048);
    expect(
      createDownloadRateProvider({ MAX_DOWNLOAD_BANDWIDTH_IN_KBPS: 2048 }, 1)(),
    ).toBe(1024);
    expect(
      createDownloadRateProvider({ MAX_DOWNLOAD_BANDWIDTH_IN_KBPS: 2048 }, 0)(),
    ).toBe(2048);
  });
  it.each([
    undefined,
    -5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER,
  ])("ignores invalid client limits (%s)", (limit) =>
    expect(createDownloadRateProvider({}, limit)()).toBe(0),
  );
  it("uses in/out limits at the specified local hour, weekday, and minute boundaries", () => {
    const rate = createDownloadRateProvider({
      MAX_DOWNLOAD_BANDWIDTH_IN_KBPS: 8192,
      MAX_DOWNLOAD_BANDWIDTH_SCHEDULE: "* 6-18 * * MON-FRI",
      MAX_DOWNLOAD_BANDWIDTH_SCHEDULE_TIMEZONE: "Europe/Berlin",
      MAX_DOWNLOAD_BANDWIDTH_IN_KBPS_OUT_SCHEDULE: 1024,
    });
    expect(rate(at("2026-10-13T03:59:59Z"))).toBe(1024);
    expect(rate(at("2026-10-13T04:00:00Z"))).toBe(8192);
    expect(rate(at("2026-10-13T16:59:59Z"))).toBe(8192);
    expect(rate(at("2026-10-13T17:00:00Z"))).toBe(1024);
    expect(rate(at("2026-10-17T10:00:00Z"))).toBe(1024);
    expect(rate(at("2026-12-15T05:00:00Z"))).toBe(8192);
  });
  it("supports zero as unlimited and evaluates sparse cron matches for the entire minute", () => {
    const rate = createDownloadRateProvider({
      MAX_DOWNLOAD_BANDWIDTH_IN_KBPS: 8192,
      MAX_DOWNLOAD_BANDWIDTH_SCHEDULE: "*/15 * * * *",
      MAX_DOWNLOAD_BANDWIDTH_SCHEDULE_TIMEZONE: "UTC",
      MAX_DOWNLOAD_BANDWIDTH_IN_KBPS_IN_SCHEDULE: 0,
      MAX_DOWNLOAD_BANDWIDTH_IN_KBPS_OUT_SCHEDULE: 1024,
    });
    expect(rate(at("2026-10-13T12:15:59Z"))).toBe(0);
    expect(rate(at("2026-10-13T12:16:00Z"))).toBe(1024);
  });
  it("rejects malformed cron expressions and unknown timezones", () => {
    expect(() =>
      createDownloadRateProvider({
        MAX_DOWNLOAD_BANDWIDTH_SCHEDULE: "0 * * * * *",
      }),
    ).toThrow("five cron fields");
    expect(() =>
      createDownloadRateProvider({
        MAX_DOWNLOAD_BANDWIDTH_SCHEDULE: "* 25 * * *",
      }),
    ).toThrow();
    expect(() =>
      createDownloadRateProvider({
        MAX_DOWNLOAD_BANDWIDTH_SCHEDULE: "* * * * *",
        MAX_DOWNLOAD_BANDWIDTH_SCHEDULE_TIMEZONE: "Unknown/Place",
      }),
    ).toThrow();
  });
  it("keeps payloads intact and applies a new limit during an active transfer", async () => {
    let limit = 1024;
    const throttle = new DynamicDownloadThrottle(() => limit);
    const expected = Buffer.alloc(4096, 42);
    const chunks: Buffer[] = [];
    const ended = new Promise<void>((resolve, reject) => {
      throttle.on("data", (chunk) => {
        chunks.push(chunk);
        limit = 0;
      });
      throttle.once("end", resolve);
      throttle.once("error", reject);
    });
    Readable.from([expected]).pipe(throttle);
    await ended;
    expect(chunks.length).toBeGreaterThan(1);
    expect(Buffer.concat(chunks)).toEqual(expected);
  });
  it("cancels a pending throttled transfer immediately when destroyed", async () => {
    const throttle = new DynamicDownloadThrottle(() => 1);
    const closed = new Promise<void>((resolve) =>
      throttle.once("close", resolve),
    );
    throttle.end(Buffer.alloc(4096));
    throttle.destroy();
    await closed;
    expect(throttle.destroyed).toBe(true);
    expect(throttle.read()).toBeNull();
  });
});
