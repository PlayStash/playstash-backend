import type { Mocked } from "vitest";
import { DatabaseService } from "../database/database.service.js";
import { AdminLogsService } from "./admin-logs.service.js";
import { AdminController } from "./admin.controller.js";

describe("AdminController", () => {
  let controller: AdminController;
  let databaseService: Mocked<DatabaseService>;
  let logs: Mocked<AdminLogsService>;

  beforeEach(() => {
    databaseService = {
      backup: vi.fn(),
      restore: vi.fn(),
    } as any;

    logs = {
      getRecentLogs: vi.fn(),
    } as any;

    controller = new AdminController(databaseService, logs);
  });

  describe("getAdminDatabaseBackup", () => {
    it("should call databaseService.backup with password", async () => {
      const mockBackup = { data: "backup-data" };
      databaseService.backup.mockResolvedValue(mockBackup as any);

      const result = await controller.getAdminDatabaseBackup("SecretPass123");
      expect(result).toEqual(mockBackup);
      expect(databaseService.backup).toHaveBeenCalledWith("SecretPass123");
    });
  });

  describe("postAdminDatabaseRestore", () => {
    it("should call databaseService.restore with file and password", async () => {
      const mockFile = {
        buffer: Buffer.from("backup-data"),
        originalname: "backup.sql",
      } as Express.Multer.File;
      databaseService.restore.mockResolvedValue(undefined);

      await controller.postAdminDatabaseRestore(mockFile, "SecretPass123");
      expect(databaseService.restore).toHaveBeenCalledWith(
        mockFile,
        "SecretPass123",
      );
    });
  });

  describe("getAdminLogs", () => {
    it("returns the sanitized records from the logs service", async () => {
      const records = [{ level: "info", message: "Server started." }];
      logs.getRecentLogs.mockResolvedValue(records);

      expect(await controller.getAdminLogs()).toEqual(records);
    });
  });
});
