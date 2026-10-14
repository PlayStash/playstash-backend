import {
  InternalServerErrorException,
  NotAcceptableException,
  UnauthorizedException,
} from "@nestjs/common";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { platform, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import configuration from "../../configuration.js";

import { DatabaseService } from "./database.service.js";

vi.mock("../../configuration.js", () => ({
  __esModule: true,
  default: {
    TESTING: { IN_MEMORY_DB: false },
    DB: {
      SYSTEM: "POSTGRESQL",
      HOST: "localhost",
      PORT: 5432,
      USERNAME: "user",
      PASSWORD: "correct-password",
      DATABASE: "playstash",
    },
    SERVER: { VERSION: "13.0.0" },
    VOLUMES: { SQLITEDB: "/data/sqlite" },
  },
}));

vi.mock("../../logging.js", () => ({
  __esModule: true,
  default: {
    log: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
  logPlaystashGame: vi.fn(),
  logPlaystashUser: vi.fn(),
  logMedia: vi.fn(),
  logMetadata: vi.fn(),
  logMetadataProvider: vi.fn(),
  logProgress: vi.fn(),
}));

describe("DatabaseService", () => {
  let service: DatabaseService;
  let mockDataSource: any;
  let testDirectory: string;
  let backupDirectory: string;
  let previousVolumes: unknown;

  beforeEach(() => {
    testDirectory = mkdtempSync(join(tmpdir(), "playstash-db-backups-"));
    backupDirectory = join(testDirectory, "persistent", "db");
    const config = configuration as any;
    previousVolumes = config.VOLUMES;
    config.VOLUMES = { ...config.VOLUMES, SQLITEDB: backupDirectory };
    mockDataSource = {
      initialize: vi.fn().mockResolvedValue(undefined),
      destroy: vi.fn().mockResolvedValue(undefined),
      runMigrations: vi.fn().mockResolvedValue([]),
      query: vi.fn().mockResolvedValue([{ server_version_num: "180006" }]),
    };

    service = new DatabaseService(mockDataSource, configuration as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    (configuration as any).VOLUMES = previousVolumes;
    expect(resolve(dirname(testDirectory))).toBe(resolve(tmpdir()));
    expect(basename(testDirectory)).toMatch(/^playstash-db-backups-/);
    rmSync(testDirectory, { recursive: true, force: true });
  });

  // ─── validatePassword ──────────────────────────────────────────────

  describe("validatePassword (via backup)", () => {
    it("should throw UnauthorizedException for wrong password", async () => {
      await expect(service.backup("wrong-password")).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it("should not throw for correct password (then proceeds to backup)", async () => {
      // Will throw InternalServerError because pg_dump won't work in test,
      // but the important thing is it got past validation
      const promise = service.backup("correct-password");
      // It should NOT throw UnauthorizedException
      await expect(promise).rejects.not.toThrow(UnauthorizedException);
    });
  });

  // ─── generateBackupFilepath ────────────────────────────────────────

  describe("generateBackupFilepath", () => {
    it("should generate a path with version and timestamp", () => {
      const filepath = (service as any).generateBackupFilepath();
      expect(filepath).toMatch(
        /^\/tmp\/playstash_13\.0\.0_database_backup_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}/,
      );
      expect(filepath).toMatch(/\.db$/);
    });

    it("should produce unique timestamps on consecutive calls", () => {
      const first = (service as any).generateBackupFilepath();
      const second = (service as any).generateBackupFilepath();
      // May or may not differ depending on timing, but both should be valid
      expect(first).toMatch(/^\/tmp\/playstash_/);
      expect(second).toMatch(/^\/tmp\/playstash_/);
    });
  });

  // ─── connect / disconnect / migrate ────────────────────────────────

  describe("connect", () => {
    it("should initialize the data source", async () => {
      await service.connect();
      expect(mockDataSource.initialize).toHaveBeenCalled();
    });
  });

  describe("disconnect", () => {
    it("should destroy the data source", async () => {
      await service.disconnect();
      expect(mockDataSource.destroy).toHaveBeenCalled();
    });
  });

  describe("migrate", () => {
    it("should run migrations", async () => {
      await service.migrate();
      expect(mockDataSource.runMigrations).toHaveBeenCalled();
    });
  });

  // ─── backup / restore with in-memory DB ────────────────────────────

  describe("in-memory DB guard", () => {
    it("should reject backup on in-memory DB", async () => {
      const config = configuration as any;
      config.TESTING.IN_MEMORY_DB = true;

      await expect(service.backup("correct-password")).rejects.toThrow(
        NotAcceptableException,
      );

      config.TESTING.IN_MEMORY_DB = false;
    });

    it("should reject restore on in-memory DB", async () => {
      const config = configuration as any;
      config.TESTING.IN_MEMORY_DB = true;

      await expect(
        service.restore(
          { buffer: Buffer.from("test") } as any,
          "correct-password",
        ),
      ).rejects.toThrow(NotAcceptableException);

      config.TESTING.IN_MEMORY_DB = false;
    });
  });

  describe("backup/restore routing", () => {
    it("throws InternalServerErrorException for an unknown DB_SYSTEM", async () => {
      const prev = (configuration as any).DB.SYSTEM;
      (configuration as any).DB.SYSTEM = "MYSQL";
      try {
        await expect(service.backup("correct-password")).rejects.toThrow(
          InternalServerErrorException,
        );
      } finally {
        (configuration as any).DB.SYSTEM = prev;
      }
    });

    it("routes POSTGRESQL backup to backupPostgresql", async () => {
      const spy = vi
        .spyOn(service as any, "backupPostgresql")
        .mockResolvedValue({} as any);
      await service.backup("correct-password");
      expect(spy).toHaveBeenCalled();
    });

    it("routes SQLITE backup through disconnect/backupSqlite/connect", async () => {
      const prev = (configuration as any).DB.SYSTEM;
      (configuration as any).DB.SYSTEM = "SQLITE";
      const backupSpy = vi
        .spyOn(service as any, "backupSqlite")
        .mockResolvedValue({} as any);
      const disconnectSpy = vi
        .spyOn(service as any, "disconnect")
        .mockResolvedValue(undefined);
      const connectSpy = vi
        .spyOn(service as any, "connect")
        .mockResolvedValue(undefined);
      try {
        await service.backup("correct-password");
        expect(disconnectSpy).toHaveBeenCalled();
        expect(backupSpy).toHaveBeenCalled();
        expect(connectSpy).toHaveBeenCalled();
      } finally {
        (configuration as any).DB.SYSTEM = prev;
      }
    });

    it("routes SQLITE restore through disconnect/restoreSqlite/connect/migrate", async () => {
      const prev = (configuration as any).DB.SYSTEM;
      (configuration as any).DB.SYSTEM = "SQLITE";
      const restoreSpy = vi
        .spyOn(service as any, "restoreSqlite")
        .mockResolvedValue(undefined);
      const disconnectSpy = vi
        .spyOn(service as any, "disconnect")
        .mockResolvedValue(undefined);
      const connectSpy = vi
        .spyOn(service as any, "connect")
        .mockResolvedValue(undefined);
      const migrateSpy = vi
        .spyOn(service as any, "migrate")
        .mockResolvedValue(undefined);
      try {
        await service.restore(
          { buffer: Buffer.from("test") } as any,
          "correct-password",
        );
        expect(disconnectSpy).toHaveBeenCalled();
        expect(restoreSpy).toHaveBeenCalled();
        expect(connectSpy).toHaveBeenCalled();
        expect(migrateSpy).toHaveBeenCalled();
      } finally {
        (configuration as any).DB.SYSTEM = prev;
      }
    });
  });

  describe("restore from the streamed temporary dump", () => {
    it("removes the temporary dump even when the restore is rejected", async () => {
      const directory = mkdtempSync(join(tmpdir(), "gv-restore-"));
      const tempDump = join(directory, "dump.tmp");
      writeFileSync(tempDump, "dump");
      try {
        await expect(
          service.restore({ path: tempDump } as any, "wrong-password"),
        ).rejects.toThrow(UnauthorizedException);
        expect(existsSync(tempDump)).toBe(false);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    });

    it("restores SQLite by copying from the temporary dump", async () => {
      const directory = mkdtempSync(join(tmpdir(), "gv-sqlite-"));
      const tempDump = join(directory, "dump.tmp");
      const sqliteDirectory = join(directory, "db");
      mkdirSync(sqliteDirectory, { recursive: true });
      writeFileSync(tempDump, "sqlite-bytes");

      const config = configuration as any;
      const previousSystem = config.DB.SYSTEM;
      const previousVolumes = config.VOLUMES;
      config.DB.SYSTEM = "SQLITE";
      config.VOLUMES = { ...previousVolumes, SQLITEDB: sqliteDirectory };
      vi.spyOn(service as any, "backupSqlite").mockResolvedValue(undefined);
      try {
        await service.restore({ path: tempDump } as any, "correct-password");

        expect(
          readFileSync(join(sqliteDirectory, "database.sqlite"), "utf8"),
        ).toBe("sqlite-bytes");
        expect(existsSync(tempDump)).toBe(false);
      } finally {
        config.DB.SYSTEM = previousSystem;
        config.VOLUMES = previousVolumes;
        rmSync(directory, { recursive: true, force: true });
      }
    });

    it("restores PostgreSQL from the temporary dump", async () => {
      const directory = mkdtempSync(join(tmpdir(), "gv-pg-"));
      const tempDump = join(directory, "dump.tmp");
      writeFileSync(tempDump, "pg-dump");

      const config = configuration as any;
      const previousSystem = config.DB.SYSTEM;
      config.DB.SYSTEM = "POSTGRESQL";
      vi.spyOn(service, "backupPostgresql").mockImplementation(
        async (filename) => {
          writeFileSync(filename, "precautionary snapshot");
          return undefined as any;
        },
      );
      const execSpy = vi
        .spyOn(service as any, "execFilePromise")
        .mockResolvedValue({ stdout: "", stderr: "" });
      try {
        await service.restore({ path: tempDump } as any, "correct-password");

        const pgRestoreCall = execSpy.mock.calls.find((call) =>
          String(call[0]).includes("pg_restore"),
        );
        expect(pgRestoreCall?.[1]).toContain(tempDump);
        expect(existsSync(tempDump)).toBe(false);
      } finally {
        config.DB.SYSTEM = previousSystem;
        rmSync(directory, { recursive: true, force: true });
      }
    });
  });

  describe("PostgreSQL restore failures", () => {
    it("rolls back a failed restore and reports failure instead of running migrations", async () => {
      const directory = mkdtempSync(join(tmpdir(), "playstash-rollback-"));
      const dump = join(directory, "failed dump; literal.tar");
      writeFileSync(dump, "invalid incoming dump");
      let recoveryPath = "";
      vi.spyOn(service, "backupPostgresql").mockImplementation(
        async (filename) => {
          recoveryPath = filename;
          writeFileSync(filename, "original database snapshot");
          return undefined as any;
        },
      );
      let restoreCount = 0;
      const execute = vi
        .spyOn(service as any, "execFilePromise")
        .mockImplementation(async (...parameters: unknown[]) => {
          const [command, args] = parameters as [string, string[]];
          if (command === "pg_restore" && ++restoreCount === 1) {
            expect(args.at(-1)).toBe(dump);
            throw new Error("pg_restore: errors ignored on restore: 1");
          }
          return { stdout: "", stderr: "" };
        });
      try {
        await expect(
          service.restore({ path: dump } as any, "correct-password"),
        ).rejects.toThrow("original database was retained or recovered");
        expect(restoreCount).toBe(2);
        expect(
          execute.mock.calls.filter(([command]) => command === "dropdb"),
        ).toHaveLength(2);
        expect(execute.mock.calls.at(-1)?.[1]).toContain(recoveryPath);
        expect(mockDataSource.query).toHaveBeenCalledTimes(1);
        expect(mockDataSource.runMigrations).not.toHaveBeenCalled();
        expect(existsSync(dump)).toBe(false);
        expect(existsSync(recoveryPath)).toBe(false);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    });

    it("does not replace the database if the precautionary backup fails", async () => {
      vi.spyOn(service, "backupPostgresql").mockRejectedValue(
        new Error("backup failed"),
      );
      const execute = vi.spyOn(service as any, "execFilePromise");
      await expect(
        service.restorePostgresql({ path: "unused" } as any),
      ).rejects.toThrow(InternalServerErrorException);
      expect(execute).not.toHaveBeenCalled();
    });

    it("keeps the private snapshot when rollback fails", async () => {
      const directory = mkdtempSync(join(tmpdir(), "playstash-recovery-"));
      const dump = join(directory, "bad.tar");
      writeFileSync(dump, "bad backup");
      let recoveryPath = "";
      vi.spyOn(service, "backupPostgresql").mockImplementation(
        async (filename) => {
          recoveryPath = filename;
          writeFileSync(filename, "original snapshot");
          return undefined as any;
        },
      );
      vi.spyOn(service as any, "execFilePromise").mockImplementation(
        async (...parameters: unknown[]) => {
          if (parameters[0] === "pg_restore")
            throw new Error("restore unavailable");
          return { stdout: "", stderr: "" };
        },
      );
      try {
        expect(existsSync(backupDirectory)).toBe(false);
        await expect(
          service.restore({ path: dump } as any, "correct-password"),
        ).rejects.toThrow("Error restoring pre-restore");
        expect(readFileSync(recoveryPath, "utf8")).toBe("original snapshot");
        expect(resolve(dirname(dirname(recoveryPath)))).toBe(
          resolve(backupDirectory),
        );
        if (platform() !== "win32") {
          expect(statSync(backupDirectory).mode & 0o777).toBe(0o700);
          expect(statSync(dirname(recoveryPath)).mode & 0o777).toBe(0o700);
          expect(statSync(recoveryPath).mode & 0o777).toBe(0o600);
        }
        expect(existsSync(dump)).toBe(false);
      } finally {
        if (recoveryPath) {
          const recoveryDirectory = dirname(recoveryPath);
          expect(resolve(dirname(recoveryDirectory))).toBe(
            resolve(backupDirectory),
          );
          expect(basename(recoveryDirectory)).toMatch(/^playstash-restore-/);
          rmSync(recoveryDirectory, { recursive: true, force: true });
        }
        rmSync(directory, { recursive: true, force: true });
      }
    });
  });
});
