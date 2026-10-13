import {
  Controller,
  Delete,
  Get,
  Headers,
  Logger,
  Param,
  ParseIntPipe,
  Post,
  Request,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiSecurity,
  ApiTags,
} from "@nestjs/swagger";

import { FileInterceptor } from "@nestjs/platform-express";
import configuration from "../../configuration.js";
import { DisableApiIf } from "../../decorators/disable-api-if.decorator.js";
import { MinimumRole } from "../../decorators/minimum-role.decorator.js";
import {
  REQUIRED_UPLOAD_FILE_PIPE,
  UPLOAD_FIELD_NAME,
} from "../../uploads/streamed-upload.js";
import { UserIdGameIdDto } from "../progresses/models/user-id-game-id.dto.js";
import { Role } from "../users/models/role.enum.js";
import { PlaystashUser } from "../users/playstash-user.entity.js";
import { SavefileDto } from "./models/savefile.dto.js";
import { savefileUploadMulterOptions } from "./savefile-upload.multer.js";
import { SavefileService } from "./savefile.service.js";

@Controller("savefiles")
@ApiTags("savefile")
@ApiBearerAuth()
@ApiSecurity("apikey")
export class SavefileController {
  private readonly logger = new Logger(this.constructor.name);

  constructor(private readonly savefileService: SavefileService) {}

  @Get("/user/:user_id/game/:game_id/versions")
  @ApiParam({ name: "user_id", required: true, type: Number })
  @ApiParam({ name: "game_id", required: true, type: Number })
  @ApiOperation({
    summary: "List save archive versions for their owner or an administrator",
    operationId: "getSavefileVersions",
  })
  @ApiOkResponse({ type: () => SavefileDto, isArray: true })
  @MinimumRole(Role.USER)
  @DisableApiIf(
    configuration.SERVER.DEMO_MODE_ENABLED || !configuration.SAVEFILES.ENABLED,
  )
  getSavefileVersions(
    @Param() params: UserIdGameIdDto,
    @Request() req: { user: PlaystashUser },
  ): Promise<SavefileDto[]> {
    return this.savefileService.list(
      Number(params.user_id),
      Number(params.game_id),
      req.user.username,
    );
  }

  @Get("/user/:user_id/game/:game_id/versions/:filename")
  @ApiParam({ name: "user_id", required: true, type: Number })
  @ApiParam({ name: "game_id", required: true, type: Number })
  @ApiParam({ name: "filename", required: true, type: String })
  @ApiOperation({
    summary: "Download a selected save archive version",
    operationId: "getSavefileVersion",
  })
  @ApiOkResponse({ type: () => StreamableFile })
  @MinimumRole(Role.USER)
  @DisableApiIf(
    configuration.SERVER.DEMO_MODE_ENABLED || !configuration.SAVEFILES.ENABLED,
  )
  getSavefileVersion(
    @Param("user_id", ParseIntPipe) userId: number,
    @Param("game_id", ParseIntPipe) gameId: number,
    @Param("filename") filename: string,
    @Request() req: { user: PlaystashUser },
  ) {
    return this.savefileService.downloadVersion(
      Number(userId),
      Number(gameId),
      filename,
      req.user.username,
    );
  }

  @Delete("/user/:user_id/game/:game_id/versions/:filename")
  @ApiParam({ name: "user_id", required: true, type: Number })
  @ApiParam({ name: "game_id", required: true, type: Number })
  @ApiParam({ name: "filename", required: true, type: String })
  @ApiOperation({
    summary: "Delete a selected save archive version",
    operationId: "deleteSavefileVersion",
  })
  @MinimumRole(Role.USER)
  @DisableApiIf(
    configuration.SERVER.DEMO_MODE_ENABLED || !configuration.SAVEFILES.ENABLED,
  )
  deleteSavefileVersion(
    @Param("user_id", ParseIntPipe) userId: number,
    @Param("game_id", ParseIntPipe) gameId: number,
    @Param("filename") filename: string,
    @Request() req: { user: PlaystashUser },
  ) {
    return this.savefileService.deleteVersion(
      Number(userId),
      Number(gameId),
      filename,
      req.user.username,
    );
  }

  @Post("/user/:user_id/game/:game_id")
  @ApiParam({ name: "user_id", required: true, type: Number })
  @ApiParam({ name: "game_id", required: true, type: Number })
  @ApiOperation({
    summary: "Upload a save file to the server",
    description:
      "Only admins or the user who is associated to the savefile can upload a games save file. The savefile must be a .zip file. Installation ID is optional for multi-device tracking.",
    operationId: "postSavefileByUserIdAndGameId",
  })
  @ApiHeader({
    name: "X-Installation-Id",
    description:
      "Optional installation identifier (UUID v4 format) for multi-device save management and uninstall-detection",
    required: false,
  })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      properties: {
        file: {
          type: "string",
          format: "binary",
          description: "The save file to upload",
        },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor(UPLOAD_FIELD_NAME, savefileUploadMulterOptions),
  )
  @MinimumRole(Role.USER)
  @DisableApiIf(
    configuration.SERVER.DEMO_MODE_ENABLED || !configuration.SAVEFILES.ENABLED,
  )
  postSavefileByUserIdAndGameId(
    @Param() params: UserIdGameIdDto,
    @Request() req: { user: PlaystashUser },
    @Headers("X-Installation-Id") installationId: string,
    // The interceptor above streams the upload to a temporary file on disk; the
    // savefile service validates the content and moves it into the savefiles
    // volume.
    @UploadedFile(REQUIRED_UPLOAD_FILE_PIPE)
    file: Express.Multer.File,
  ) {
    return this.savefileService.upload(
      Number(params.user_id),
      Number(params.game_id),
      file,
      req.user.username,
      installationId,
    );
  }

  @Get("/user/:user_id/game/:game_id")
  @ApiParam({ name: "user_id", required: true, type: Number })
  @ApiParam({ name: "game_id", required: true, type: Number })
  @ApiOperation({
    summary: "Download a save file from the server",
    description:
      "Only admins or the user who is associated to the savefile can download a games save file.",
    operationId: "getSaveFileByUserIdAndGameId",
  })
  @ApiOkResponse({
    type: () => Buffer,
    description: "The requested save file",
  })
  @ApiOkResponse({ type: () => StreamableFile })
  @DisableApiIf(
    configuration.SERVER.DEMO_MODE_ENABLED || !configuration.SAVEFILES.ENABLED,
  )
  @MinimumRole(Role.USER)
  async getSaveFileByUserIdAndGameId(
    @Param() params: UserIdGameIdDto,
    @Request() req: { user: PlaystashUser },
  ): Promise<StreamableFile> {
    return await this.savefileService.download(
      Number(params.user_id),
      Number(params.game_id),
      req.user.username,
    );
  }

  @Delete("/user/:user_id/game/:game_id")
  @ApiParam({ name: "user_id", required: true, type: Number })
  @ApiParam({ name: "game_id", required: true, type: Number })
  @ApiOperation({
    summary: "Delete a save file from the server",
    description:
      "Only admins or the user who is associated to the savefile can delete a games save file.",
    operationId: "deleteSaveFileByUserIdAndGameId",
  })
  @DisableApiIf(
    configuration.SERVER.DEMO_MODE_ENABLED || !configuration.SAVEFILES.ENABLED,
  )
  @MinimumRole(Role.USER)
  async deleteSaveFileByUserIdAndGameId(
    @Param() params: UserIdGameIdDto,
    @Request() req: { user: PlaystashUser },
  ) {
    await this.savefileService.delete(
      Number(params.user_id),
      Number(params.game_id),
      req.user.username,
    );
  }
}
