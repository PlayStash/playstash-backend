import { NotFoundException } from "@nestjs/common";
import {
  mkdir,
  mkdtemp,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MINIMUM_ROLE_KEY } from "../../decorators/minimum-role.decorator.js";
import { Role } from "../users/models/role.enum.js";
import { AdminLogsService } from "./admin-logs.service.js";
import { AdminController } from "./admin.controller.js";

describe("administrator file-log tail", () => {
  let directory: string;
  let config: any;
  let service: AdminLogsService;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "playstash-admin-logs-"));
    config = {
      SERVER: { LOG_FILES_ENABLED: true, ADMIN_PASSWORD: "test-admin-secret" },
      VOLUMES: { LOGS: directory },
      DB: { PASSWORD: "test-db-secret" },
      AUTH: { ACCESS_TOKEN: { SECRET: "test-jwt-secret" } },
      NOTIFICATIONS: { WEBHOOK_URL: "https://hooks.example/private-path" },
    };
    service = new AdminLogsService(config);
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("exposes only string fields and redacts configured secrets, tokens, Basic/Bearer and URL credentials", async () => {
    const text =
      'test-admin-secret test-db-secret test-jwt-secret https://hooks.example/private-path Bearer bearerValue Basic YWxhZGRpbjpvcGVuc2VzYW1l api_key=unknown-key {"refresh_token":"unknown-refresh"} https://alice:password@example.test/';
    const record = {
      level: "error",
      timestamp: "2026-10-13T12:00:00.000Z",
      context: "Auth",
      message: {
        message: text,
        user: { password: "another-user-password" },
        config,
      },
      error: { stack: "not exposed" },
    };
    await writeFile(
      join(directory, "playstash-backend-2026-10-13.log"),
      JSON.stringify(record) + "\n",
    );
    const result = await service.getRecentLogs();
    expect(result).toHaveLength(1);
    expect(Object.keys(result[0]).sort()).toEqual([
      "context",
      "level",
      "message",
      "timestamp",
    ]);
    expect(result[0].message).toContain("[REDACTED]");
    for (const secret of [
      "test-admin-secret",
      "test-db-secret",
      "test-jwt-secret",
      "private-path",
      "bearerValue",
      "YWxhZGRpbjpvcGVuc2VzYW1l",
      "unknown-key",
      "unknown-refresh",
      "alice:password",
      "another-user-password",
      "not exposed",
    ])
      expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("returns at most the last 200 records in chronological file order", async () => {
    await writeFile(
      join(directory, "playstash-backend-2026-10-13.log"),
      Array.from({ length: 240 }, (_, i) =>
        JSON.stringify({ level: "info", message: `message ${i}` }),
      ).join("\n") + "\n",
    );
    const result = await service.getRecentLogs();
    expect(result).toHaveLength(200);
    expect(result[0].message).toBe("message 40");
    expect(result[199].message).toBe("message 239");
  });

  it("reads only the last 64 KiB and discards partial/non-JSON/raw structured lines", async () => {
    const first = JSON.stringify({
      level: "info",
      message: "x".repeat(70_000),
    });
    await writeFile(
      join(directory, "playstash-backend-2026-10-13.log"),
      first +
        "\nraw-secret-data\nnull\n" +
        JSON.stringify({ level: "info", message: { config: "hidden" } }) +
        "\n" +
        JSON.stringify({ level: "info", message: "last record" }) +
        "\n",
    );
    expect(await service.getRecentLogs()).toEqual([
      { level: "info", message: "last record" },
    ]);
  });

  it("selects only the latest own rotating log, ignoring arbitrary files", async () => {
    await writeFile(join(directory, "private.txt"), "never expose");
    const old = join(directory, "playstash-backend-2026-10-12.log");
    await writeFile(
      old,
      JSON.stringify({ level: "info", message: "old" }) + "\n",
    );
    await utimes(old, new Date(0), new Date(0));
    await writeFile(
      join(directory, "playstash-backend-2026-10-13.log.1"),
      JSON.stringify({ level: "info", message: "new" }) + "\n",
    );
    expect(await service.getRecentLogs()).toEqual([
      { level: "info", message: "new" },
    ]);
  });

  it("returns an empty list when logs are disabled or absent", async () => {
    config.SERVER.LOG_FILES_ENABLED = false;
    config.VOLUMES.LOGS = join(directory, "not-present");
    expect(await service.getRecentLogs()).toEqual([]);
    config.SERVER.LOG_FILES_ENABLED = true;
    expect(await service.getRecentLogs()).toEqual([]);
  });

  it("rejects linked log directories and files", async () => {
    const real = join(directory, "real");
    await mkdir(real);
    const link = join(directory, "linked");
    await symlink(real, link, "junction");
    config.VOLUMES.LOGS = link;
    await expect(service.getRecentLogs()).rejects.toBeInstanceOf(
      NotFoundException,
    );
    config.VOLUMES.LOGS = directory;
    // A directory junction named like a log is rejected even without Windows
    // developer-mode privileges required for creating file symlinks.
    await symlink(
      real,
      join(directory, "playstash-backend-2026-10-13.log"),
      "junction",
    );
    await expect(service.getRecentLogs()).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("requires the administrator role on the API route", () => {
    expect(
      Reflect.getMetadata(
        MINIMUM_ROLE_KEY,
        AdminController.prototype.getAdminLogs,
      ),
    ).toBe(Role.ADMIN);
  });
});
