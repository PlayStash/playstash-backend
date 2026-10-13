import { Injectable, NotFoundException } from "@nestjs/common";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { AppConfiguration } from "../../configuration.js";
import { InjectPlaystashConfig } from "../../decorators/inject-playstash-config.decorator.js";

const MAX_BYTES = 64 * 1024;
const MAX_RECORDS = 200;
const LOG_FILE = /^playstash-backend-\d{4}-\d{2}-\d{2}\.log(?:\.\d+)?$/;

export class AdminLogRecordDto {
  @ApiProperty() level!: string;
  @ApiPropertyOptional() context?: string;
  @ApiPropertyOptional() timestamp?: string;
  @ApiProperty() message!: string;
}

/** Only the current server's bounded, sanitized file-log tail is exposed. */
@Injectable()
export class AdminLogsService {
  constructor(
    @InjectPlaystashConfig() private readonly config: AppConfiguration,
  ) {}

  async getRecentLogs(): Promise<AdminLogRecordDto[]> {
    if (!this.config.SERVER.LOG_FILES_ENABLED) return [];
    const directory = resolve(this.config.VOLUMES.LOGS);
    try {
      const directoryStat = await lstat(directory);
      if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink())
        throw new Error("Unsafe log directory.");
      const root = await realpath(directory);
      const candidates = (await readdir(directory))
        .filter((name) => LOG_FILE.test(name))
        .sort((a, b) => b.localeCompare(a, "en", { numeric: true }))
        .slice(0, 50);
      const files = await Promise.all(
        candidates.map(async (name) => ({
          path: join(directory, name),
          info: await lstat(join(directory, name)),
        })),
      );
      const selected = files.sort((a, b) => b.info.mtimeMs - a.info.mtimeMs)[0];
      if (!selected) return [];
      if (!selected.info.isFile() || selected.info.isSymbolicLink())
        throw new Error("Unsafe log file.");
      this.assertContained(root, await realpath(selected.path));
      const handle = await open(
        selected.path,
        constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
      );
      try {
        const stat = await handle.stat();
        if (
          !stat.isFile() ||
          stat.dev !== selected.info.dev ||
          stat.ino !== selected.info.ino
        )
          throw new Error("Log file changed during access.");
        this.assertContained(root, await realpath(selected.path));
        const length = Math.min(MAX_BYTES, stat.size);
        const start = Math.max(0, stat.size - length);
        const buffer = Buffer.alloc(length);
        const { bytesRead } = await handle.read(buffer, 0, length, start);
        let text = buffer.subarray(0, bytesRead).toString("utf8");
        if (start > 0) text = text.slice(text.indexOf("\n") + 1);
        return this.sanitizeRecords(text);
      } finally {
        await handle.close();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw new NotFoundException("Server file logs are unavailable.");
    }
  }

  private assertContained(root: string, target: string): void {
    const part = relative(root, target);
    if (
      !part ||
      part === ".." ||
      part.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
      isAbsolute(part)
    )
      throw new Error("Log file is outside the log directory.");
  }

  private sanitizeRecords(text: string): AdminLogRecordDto[] {
    const secrets = new Set<string>();
    const collect = (value: unknown): void => {
      if (!value || typeof value !== "object") return;
      for (const [key, item] of Object.entries(value)) {
        if (
          /(?:password|secret|token|api[_-]?key|webhook[_-]?url)$/i.test(key) &&
          typeof item === "string" &&
          item
        )
          secrets.add(item);
        if (typeof item === "object") collect(item);
      }
    };
    collect(this.config);
    const redact = (value: string) => {
      for (const secret of [...secrets].sort((a, b) => b.length - a.length))
        value = value.replaceAll(secret, "[REDACTED]");
      return value
        .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9+/_=.~-]+/gi, "$1 [REDACTED]")
        .replace(
          /((?:password|secret|token|api[_-]?key|authorization)["']?\s*[=:]\s*["']?)[^\s"'&,;]+/gi,
          "$1[REDACTED]",
        )
        .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1[REDACTED]@")
        .replace(
          /\b[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
          "[REDACTED]",
        )
        .slice(0, 4000);
    };
    const records: AdminLogRecordDto[] = [];
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const data = JSON.parse(line);
        // Winston/Nest can place its text message inside a structured object.
        // Every other nested field (config/user/game/error/stack) is omitted.
        const message =
          typeof data.message === "string"
            ? data.message
            : typeof data.message?.message === "string"
              ? data.message.message
              : undefined;
        if (!message || typeof data.level !== "string") continue;
        records.push({
          level: redact(data.level.slice(0, 30)),
          message: redact(message),
          ...(typeof data.context === "string"
            ? { context: redact(data.context.slice(0, 120)) }
            : {}),
          ...(typeof data.timestamp === "string"
            ? { timestamp: redact(data.timestamp.slice(0, 60)) }
            : {}),
        });
      } catch {
        /* Partial or non-JSON lines are not exposed as raw log dumps. */
      }
    }
    return records.slice(-MAX_RECORDS);
  }
}
