import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotAcceptableException,
  StreamableFile,
  UnauthorizedException,
} from "@nestjs/common";
import fsExtra from "fs-extra";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import filenameSanitizer from "sanitize-filename";
import { DataSource } from "typeorm";
import unidecode from "unidecode";
const { copyFile, createReadStream, pathExists, stat } = fsExtra;

import type { AppConfiguration } from "../../configuration.js";
import { InjectPlaystashConfig } from "../../decorators/inject-playstash-config.decorator.js";
import {
  selectPostgresClients,
  type PostgresClients,
} from "./postgres-client.js";

@Injectable()
export class DatabaseService {
  private readonly logger = new Logger(this.constructor.name);
  private readonly execFilePromise = promisify(execFile);

  constructor(
    private readonly dataSource: DataSource,
    @InjectPlaystashConfig() private readonly config: AppConfiguration,
  ) {}

  async backup(password: string): Promise<StreamableFile> {
    if (this.config.TESTING.IN_MEMORY_DB) {
      throw new NotAcceptableException(
        "This server can't backup its data as it uses an in-memory database.",
      );
    }

    this.validatePassword(password);

    switch (this.config.DB.SYSTEM) {
      case "POSTGRESQL":
        return this.backupPostgresql(this.generateBackupFilepath());
      case "SQLITE":
        await this.disconnect();
        try {
          return await this.backupSqlite(this.generateBackupFilepath());
        } finally {
          await this.connect();
        }
      default:
        throw new InternalServerErrorException(
          "This server's DB_SYSTEM environment variable is set to an unknown value.",
        );
    }
  }

  async restore(file: Express.Multer.File, password: string) {
    try {
      if (this.config.TESTING.IN_MEMORY_DB) {
        throw new NotAcceptableException(
          "This server can't restore backups as it uses an in-memory database.",
        );
      }

      this.validatePassword(password);

      switch (this.config.DB.SYSTEM) {
        case "POSTGRESQL":
          await this.restorePostgresql(file);
          break;
        case "SQLITE":
          await this.disconnect();
          try {
            await this.restoreSqlite(file);
          } finally {
            await this.connect();
          }
          break;
        default:
          throw new InternalServerErrorException(
            "This server's DB_SYSTEM environment variable is set to an unknown value.",
          );
      }

      await this.migrate();
    } finally {
      // The upload was streamed to a temporary file; remove it again. This runs
      // even when the restore is rejected (wrong password, in-memory database,
      // ...) so no partial dump is left behind.
      if (file?.path) {
        await rm(file.path, { force: true }).catch(() => undefined);
      }
    }
  }

  async connect() {
    this.logger.log("Connecting Database...");
    return this.dataSource.initialize();
  }

  async disconnect() {
    this.logger.log("Disconnecting Database...");
    return this.dataSource.destroy();
  }

  async migrate() {
    this.logger.log("Migrating Database...");
    return this.dataSource.runMigrations();
  }

  async backupPostgresql(
    backupFilePath: string,
    clients?: PostgresClients,
  ): Promise<StreamableFile> {
    this.logger.log({
      message: "Backing up PostgreSQL Database...",
      backupFilePath,
    });
    try {
      const selected =
        clients ?? (await selectPostgresClients(this.dataSource));
      await this.execFilePromise(
        selected.dump,
        [
          "-F",
          "t",
          ...this.postgresConnectionArgs(),
          "-d",
          this.config.DB.DATABASE,
          "-f",
          backupFilePath,
        ],
        { env: { ...process.env, PGPASSWORD: this.config.DB.PASSWORD } },
      );

      return this.createStreamableFile(backupFilePath);
    } catch (error) {
      this.handleBackupError(error);
      throw new InternalServerErrorException(
        "Failed to backup PostgreSQL database.",
        { cause: error },
      );
    }
  }

  private async backupSqlite(backupFilePath: string): Promise<StreamableFile> {
    this.logger.log({
      message: "Backing up SQLite Database...",
      backupFilePath,
    });
    await copyFile(
      `${this.config.VOLUMES.SQLITEDB}/database.sqlite`,
      backupFilePath,
    );

    return this.createStreamableFile(backupFilePath);
  }

  async restorePostgresql(file: Express.Multer.File) {
    this.logger.log({
      message: "Restoring PostgreSQL Database...",
      size: file.size,
    });
    const restorePath = file.path;
    await mkdir(this.config.VOLUMES.SQLITEDB, {
      recursive: true,
      mode: 0o700,
    });
    const tempDir = await mkdtemp(
      path.join(this.config.VOLUMES.SQLITEDB, "playstash-restore-"),
    );
    const preRestorePath = path.join(tempDir, "database_pre_restore.db");
    let clients: PostgresClients | undefined;
    let databaseReplaced = false;
    let preserveRecoveryBackup = false;
    try {
      clients = await selectPostgresClients(this.dataSource);
      const backup = await this.backupPostgresql(preRestorePath, clients);
      backup?.getStream().destroy();
      await chmod(preRestorePath, 0o600);

      // The dump was streamed to this file; restrict its permissions as it
      // contains the complete database.
      await chmod(restorePath, 0o600);

      await this.execFilePromise(
        "dropdb",
        [
          "--if-exists",
          "-f",
          ...this.postgresConnectionArgs(),
          "--",
          this.config.DB.DATABASE,
        ],
        { env: { ...process.env, PGPASSWORD: this.config.DB.PASSWORD } },
      );
      databaseReplaced = true;

      await this.execFilePromise(
        "createdb",
        [...this.postgresConnectionArgs(), "--", this.config.DB.DATABASE],
        { env: { ...process.env, PGPASSWORD: this.config.DB.PASSWORD } },
      );

      await this.execFilePromise(
        clients.restore,
        [
          "-O",
          "-F",
          "t",
          ...this.postgresConnectionArgs(),
          "-d",
          this.config.DB.DATABASE,
          "--",
          restorePath,
        ],
        { env: { ...process.env, PGPASSWORD: this.config.DB.PASSWORD } },
      );
      this.logger.log("Successfully restored PostgreSQL Database.");
    } catch (error) {
      this.logger.error({
        message: "Error restoring PostgreSQL database",
        error,
      });

      if (
        databaseReplaced &&
        (!clients || !(await pathExists(preRestorePath)))
      ) {
        preserveRecoveryBackup = true;
        throw new InternalServerErrorException(
          "PostgreSQL restore failed and the recovery backup is unavailable. Restore a prior backup manually.",
          { cause: error },
        );
      }
      if (databaseReplaced && clients) {
        this.logger.log("Restoring pre-restore database.");
        try {
          await this.execFilePromise(
            "dropdb",
            [
              "--if-exists",
              "-f",
              ...this.postgresConnectionArgs(),
              "--",
              this.config.DB.DATABASE,
            ],
            { env: { ...process.env, PGPASSWORD: this.config.DB.PASSWORD } },
          );

          await this.execFilePromise(
            "createdb",
            [...this.postgresConnectionArgs(), "--", this.config.DB.DATABASE],
            { env: { ...process.env, PGPASSWORD: this.config.DB.PASSWORD } },
          );

          await this.execFilePromise(
            clients.restore,
            [
              "-O",
              "-F",
              "t",
              ...this.postgresConnectionArgs(),
              "-d",
              this.config.DB.DATABASE,
              "--",
              preRestorePath,
            ],
            { env: { ...process.env, PGPASSWORD: this.config.DB.PASSWORD } },
          );
          this.logger.log("Restored pre-restore database.");
        } catch (error) {
          preserveRecoveryBackup = true;
          this.logger.error({
            message:
              "Errors occured restoring pre-restore PostgreSQL database. Please restore the backup manually.",
            recoveryBackupPath: preRestorePath,
            error,
          });
          throw new InternalServerErrorException(
            "Error restoring pre-restore PostgreSQL Database.",
            { cause: error },
          );
        }
      }
      throw new InternalServerErrorException(
        "PostgreSQL restore failed; the original database was retained or recovered.",
        { cause: error },
      );
    } finally {
      if (!preserveRecoveryBackup)
        await rm(tempDir, { recursive: true, force: true }).catch(
          () => undefined,
        );
    }
  }

  private async restoreSqlite(file: Express.Multer.File) {
    this.logger.log({
      message: "Restoring SQLITE Database...",
      size: file.size,
    });
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "playstash-"));
    const preRestorePath = path.join(tempDir, "database_pre_restore.db");
    const databasePath = `${this.config.VOLUMES.SQLITEDB}/database.sqlite`;
    try {
      if (await pathExists(databasePath)) {
        await this.backupSqlite(preRestorePath);
      }
      // The upload was streamed to a temporary file; copy it over the database.
      await copyFile(file.path, databasePath);
    } catch (error) {
      this.logger.error({ message: "Error restoring SQLITE database", error });
      if (await pathExists(preRestorePath)) {
        this.logger.log("Restoring pre-restore database.");
        await copyFile(preRestorePath, databasePath);
        this.logger.log("Restored pre-restore database.");
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(
        () => undefined,
      );
    }
  }

  private validatePassword(password: string) {
    if (this.config.DB.PASSWORD !== password) {
      throw new UnauthorizedException(
        "The database password provided in the X-Database-Password Header is incorrect.",
      );
    }
  }

  private postgresConnectionArgs(): string[] {
    return [
      "-w",
      "-h",
      this.config.DB.HOST,
      "-p",
      String(this.config.DB.PORT),
      "-U",
      this.config.DB.USERNAME,
    ];
  }

  private generateBackupFilepath(): string {
    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, "-");
    return `/tmp/playstash_${this.config.SERVER.VERSION}_database_backup_${timestamp}.db`;
  }

  private async createStreamableFile(
    filePath: string,
  ): Promise<StreamableFile> {
    const file = createReadStream(filePath);
    const length = (await stat(filePath)).size;
    const { default: mime } = await import("mime");
    const type = mime.getType(filePath);
    const filename = filenameSanitizer(unidecode(path.basename(filePath)));

    return new StreamableFile(file, {
      disposition: `attachment; filename="${filename}"`,
      length,
      type: type ?? undefined,
    });
  }

  private handleBackupError(error: unknown) {
    this.logger.error({ message: "Error backing up database", error });
    throw new InternalServerErrorException("Error backing up database.", {
      cause: error,
    });
  }
}
