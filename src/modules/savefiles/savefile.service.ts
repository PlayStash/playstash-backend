import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  StreamableFile,
} from "@nestjs/common";
import { isUUID } from "class-validator";
import fileTypeChecker from "file-type-checker";
import fsExtra from "fs-extra";
import { randomUUID } from "node:crypto";
import path, { basename, dirname } from "node:path";
import type { AppConfiguration } from "../../configuration.js";
import { InjectPlaystashConfig } from "../../decorators/inject-playstash-config.decorator.js";
import { resolveStoragePath } from "../../filesystem/storage-path.js";
import {
  discardStreamedUpload,
  readFileHeader,
} from "../../uploads/streamed-upload.js";
import { GamesService } from "../games/games.service.js";
import { UsersService } from "../users/users.service.js";
import { SavefileDto } from "./models/savefile.dto.js";
const { createReadStream, ensureDir, lstat, move, readdir, remove, stat } =
  fsExtra;

@Injectable()
export class SavefileService {
  private readonly logger = new Logger(this.constructor.name);

  constructor(
    private readonly usersService: UsersService,
    @InjectPlaystashConfig() private readonly config: AppConfiguration,
    @Inject(forwardRef(() => GamesService))
    private readonly gamesService?: GamesService,
  ) {}

  private async checkGameAccess(
    gameId: number,
    executorUsername: string,
  ): Promise<void> {
    if (!this.gamesService) return;
    const requestingUser = await this.usersService.findOneByUsernameOrFail(
      executorUsername,
      { loadRelations: false, loadDeletedEntities: false },
    );
    await this.gamesService.findOneByGameIdOrFail(gameId, {
      loadDeletedEntities: false,
      requestingUser,
      filterByAge:
        await this.usersService.findUserAgeByUsername(executorUsername),
    });
  }

  /** Lists all save versions for their owner or an administrator, newest first. */
  public async list(
    userId: number,
    gameId: number,
    executorUsername: string,
  ): Promise<SavefileDto[]> {
    await this.usersService.checkIfUsernameMatchesIdOrIsAdminOrThrow(
      userId,
      executorUsername,
    );
    await this.checkGameAccess(gameId, executorUsername);
    let paths: string[];
    try {
      paths = await this.findSavefilesByUserIdAndGameIdOrFail(userId, gameId);
    } catch (error) {
      if (error instanceof NotFoundException) return [];
      throw error;
    }
    return Promise.all(
      paths.map(async (filePath) => {
        const filename = basename(filePath);
        const info = await stat(filePath);
        const timestamp = Number.parseInt(filename, 10);
        const createdAt = new Date(timestamp);
        const installationId = filename.slice(filename.indexOf("_") + 1, -4);
        return {
          filename,
          size: info.size,
          created_at: Number.isFinite(createdAt.getTime())
            ? createdAt
            : info.mtime,
          installation_id: isUUID(installationId, 4)
            ? installationId
            : undefined,
        };
      }),
    );
  }

  /** Downloads an explicitly selected save version after the same owner/admin check. */
  public async downloadVersion(
    userId: number,
    gameId: number,
    filename: string,
    executorUsername: string,
  ): Promise<StreamableFile> {
    const filePath = await this.resolveVersion(
      userId,
      gameId,
      filename,
      executorUsername,
    );
    return new StreamableFile(createReadStream(filePath), {
      disposition: `attachment; filename="${basename(filePath)}"`,
      length: (await stat(filePath)).size,
      type: "application/zip",
    });
  }

  public async deleteVersion(
    userId: number,
    gameId: number,
    filename: string,
    executorUsername: string,
  ): Promise<void> {
    const filePath = await this.resolveVersion(
      userId,
      gameId,
      filename,
      executorUsername,
    );
    if (!this.config.TESTING.MOCK_FILES) await remove(filePath);
  }

  private async resolveVersion(
    userId: number,
    gameId: number,
    filename: string,
    executorUsername: string,
  ): Promise<string> {
    await this.usersService.checkIfUsernameMatchesIdOrIsAdminOrThrow(
      userId,
      executorUsername,
    );
    await this.checkGameAccess(gameId, executorUsername);
    if (!/^\d{10,17}(?:_[0-9a-f-]{36})?\.zip$/i.test(filename)) {
      throw new BadRequestException("Invalid save archive filename.");
    }
    const paths = await this.findSavefilesByUserIdAndGameIdOrFail(
      userId,
      gameId,
    );
    const filePath = paths.find(
      (candidate) => basename(candidate) === filename,
    );
    if (!filePath)
      throw new NotFoundException("The requested save version was not found.");
    return filePath;
  }

  /**
   * Uploads a new save file for a user and game
   * @param userId - ID of the user owning the save file
   * @param gameId - ID of the game the save belongs to
   * @param installationId - UUID4 string identifying the installation
   * @param file - The uploaded file buffer and metadata
   * @param executorUsername - Username of the user performing the action
   * @throws {BadRequestException} If the file validation fails
   * @throws {NotFoundException} If user/game validation fails
   */
  public async upload(
    userId: number,
    gameId: number,
    file: Express.Multer.File,
    executorUsername: string,
    installationId?: string,
  ) {
    try {
      this.logger.log(`User uploading save file for a game`, {
        userId,
        gameId,
      });
      await this.usersService.checkIfUsernameMatchesIdOrIsAdminOrThrow(
        userId,
        executorUsername,
      );
      await this.checkGameAccess(gameId, executorUsername);
      if (installationId && !isUUID(installationId, 4)) {
        throw new BadRequestException(
          "Installation ID must be a valid UUID v4.",
        );
      }
      // The upload was streamed to disk, so validation reads only the header of
      // the temporary file instead of the whole file being held in memory.
      await this.validate(await readFileHeader(file.path));
      await this.saveToFileSystem(
        this.generateNewPath(userId, gameId, installationId),
        file.path,
      );
      await this.cleanupOldSaves(userId, gameId, executorUsername);
    } finally {
      // On success the temporary file has been moved to its final location; on
      // failure (permissions, validation, ...) whatever is left is removed.
      await discardStreamedUpload(file.path, this.logger);
    }
  }

  /**
   * Retrieves the most recent save file path for a user and game
   * @param userId - ID of the user owning the save file
   * @param gameId - ID of the game the save belongs to
   * @param executorUsername - Username of the user performing the action
   */
  public async download(
    userId: number,
    gameId: number,
    executorUsername: string,
  ): Promise<StreamableFile> {
    await this.usersService.checkIfUsernameMatchesIdOrIsAdminOrThrow(
      userId,
      executorUsername,
    );
    await this.checkGameAccess(gameId, executorUsername);
    const savefiles = await this.findSavefilesByUserIdAndGameIdOrFail(
      userId,
      gameId,
    );
    if (!savefiles[0]) {
      throw new NotFoundException(
        `Savefile for user ${userId} and game ${gameId} was not found.`,
      );
    }
    const path = savefiles[0];
    const file = createReadStream(path);
    this.logger.log(`User downloading save file for a game`, {
      userId,
      gameId,
    });
    const { default: mime } = await import("mime");
    return new StreamableFile(file, {
      disposition: `attachment; filename="${basename(path)}"`,
      length: (await stat(path)).size,
      type: mime.getType(path) ?? undefined,
    });
  }

  /**
   * Deletes save files for a user and game
   * @param userId - ID of the user owning the save files
   * @param gameId - ID of the game the saves belong to
   * @param executorUsername - Username of the user performing the action
   * @param last - Optional number of recent files to preserve (deletes older ones)
   * @remarks Will not delete files if TESTING.MOCK_FILES is true
   */
  public async delete(
    userId: number,
    gameId: number,
    executorUsername?: string,
    last?: number,
  ): Promise<void> {
    await this.usersService.checkIfUsernameMatchesIdOrIsAdminOrThrow(
      userId,
      executorUsername ?? "",
    );
    await this.checkGameAccess(gameId, executorUsername ?? "");
    if (this.config.TESTING.MOCK_FILES) {
      this.logger.warn({
        message: "Not deleting media from filesystem.",
        reason: "TESTING_MOCK_FILES is set to true.",
      });
      return;
    }
    try {
      const paths = await this.findSavefilesByUserIdAndGameIdOrFail(
        userId,
        gameId,
      );
      if (last) {
        const toDelete = paths.slice(-last);
        await Promise.all(toDelete.map((p) => remove(p)));
      } else {
        await Promise.all(paths.map((p) => remove(p)));
      }
      this.logger.log("Savefile(s) successfully deleted from filesystem.", {
        userId,
        gameId,
      });
    } catch (error) {
      this.logger.error({
        message: "Error deleting savefile.",
        path,
        error,
      });
    }
  }

  /**
   * Finds and sorts all save files for a user and game
   * @param userId - ID of the user owning the save files
   * @param gameId - ID of the game the saves belong to
   * @returns {Promise<string[]>} Array of sorted file paths (newest first)
   * @throws {NotFoundException} If no save files are found
   */
  private async findSavefilesByUserIdAndGameIdOrFail(
    userId: number,
    gameId: number,
  ): Promise<string[]> {
    try {
      if (this.config.TESTING.MOCK_FILES) {
        this.logger.warn({
          message: "Not saving media to the filesystem.",
          reason: "TESTING_MOCK_FILES is set to true.",
        });
        return [];
      }
      const saveDir = await resolveStoragePath(
        this.config.VOLUMES.SAVEFILES,
        path.dirname(this.generateNewPath(userId, gameId)),
      );
      const files = await readdir(saveDir);
      const candidates = files
        .filter((file) => file.endsWith(".zip"))
        .map((file) => path.join(saveDir, file));
      const paths = (
        await Promise.all(
          candidates.map(async (candidate) => {
            const target = await resolveStoragePath(
              this.config.VOLUMES.SAVEFILES,
              candidate,
            );
            return (await lstat(target)).isFile() ? target : undefined;
          }),
        )
      )
        .filter((candidate): candidate is string => !!candidate)
        .sort((a, b) => {
          return (
            Number.parseInt(path.basename(b, ".zip"), 10) -
            Number.parseInt(path.basename(a, ".zip"), 10)
          );
        });
      if (paths.length === 0) {
        throw new Error("No save files found");
      }
      this.logger.debug(`Found ${paths.length} save files`, {
        userId,
        gameId,
      });
      return paths;
    } catch (error) {
      throw new NotFoundException(
        `Savefile for user ${userId} and game ${gameId} was not found.`,
        {
          cause: error,
        },
      );
    }
  }

  /**
   * Moves an upload that was streamed to disk to its final location.
   *
   * @param path - Target path to save the file
   * @param tempPath - Temporary file the upload was streamed to
   * @remarks Will not save files if TESTING.MOCK_FILES is true
   */
  private async saveToFileSystem(
    path: string,
    tempPath: string,
  ): Promise<void> {
    if (this.config.TESTING.MOCK_FILES) {
      this.logger.warn({
        message: "Not saving media to the filesystem.",
        reason: "TESTING_MOCK_FILES is set to true.",
      });
      return;
    }
    const target = await resolveStoragePath(
      this.config.VOLUMES.SAVEFILES,
      path,
      true,
    );
    await ensureDir(dirname(target));
    await move(tempPath, target, { overwrite: true });
    this.logger.debug({
      message: "Savefile successfully saved to filesystem.",
      path,
    });
  }

  /**
   * Generates a new save file path with installation ID
   * @param userId - ID of the user owning the save file
   * @param gameId - ID of the game the save belongs to
   * @param installationId - UUID4 string identifying the installation
   * @returns {string} Generated file path in format: /users/{userId}/games/{gameId}/{timestamp}_{installationId}.zip
   */
  private generateNewPath(
    userId: number,
    gameId: number,
    installationId: string = randomUUID(),
  ): string {
    return `${this.config.VOLUMES.SAVEFILES}/users/${userId}/games/${gameId}/${Date.now()}_${installationId}.zip`;
  }

  /**
   * Validates a save file buffer as a ZIP file
   * @param savefileBuffer - Buffer containing the file data to validate
   * @throws {BadRequestException} If the file is not a valid ZIP
   */
  private async validate(savefileBuffer: Buffer) {
    const type = fileTypeChecker.detectFile(savefileBuffer);
    const errorContextObject = {
      type,
      bufferLength: savefileBuffer.length,
      bufferStart: (
        savefileBuffer.toString("hex", 0, 32).match(/.{1,2}/g) ?? []
      ).join(" "),
    };
    if (!type?.extension || !type?.mimeType) {
      throw new BadRequestException(
        errorContextObject,
        "File type could not be detected. Please use a different file.",
      );
    }
    if (type.mimeType != "application/zip") {
      throw new BadRequestException(
        errorContextObject,
        `This file is a "${type.mimeType}", which is not supported.`,
      );
    }
  }

  /**
   * Cleans up old save files beyond the configured maximum
   * @param userId - ID of the user owning the save files
   * @param gameId - ID of the game the saves belong to
   * @param executorUsername - Username of the user performing the action
   */
  private async cleanupOldSaves(
    userId: number,
    gameId: number,
    executorUsername: string,
  ): Promise<void> {
    const maxSaves = this.config.SAVEFILES.MAX_SAVES ?? 0;
    if (maxSaves <= 0) {
      return;
    }
    try {
      const saveFiles = await this.findSavefilesByUserIdAndGameIdOrFail(
        userId,
        gameId,
      );
      const currentCount = saveFiles.length;
      const excess = currentCount - maxSaves;
      if (excess > 0) {
        this.logger.log(`Deleting ${excess} old save files.`, {
          userId,
          gameId,
        });
        await this.delete(userId, gameId, executorUsername, excess);
      }
    } catch (error) {
      this.logger.error({
        message: "Error during cleanup of old save files",
        userId,
        gameId,
        error,
      });
    }
  }
}
