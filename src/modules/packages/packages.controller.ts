import {
  Controller,
  Get,
  Headers,
  Param,
  ParseIntPipe,
  Request,
  Res,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiSecurity,
  ApiTags,
} from "@nestjs/swagger";
import { type Response } from "express";
import { MinimumRole } from "../../decorators/minimum-role.decorator.js";
import { Role } from "../users/models/role.enum.js";
import { type PlaystashUser } from "../users/playstash-user.entity.js";
import { PackageDescriptorDto } from "./package.dto.js";
import { PackagesService } from "./packages.service.js";

@ApiBearerAuth()
@ApiSecurity("apikey")
@ApiTags("game")
@Controller("game/:game_id/package")
export class PackagesController {
  constructor(private readonly packages: PackagesService) {}

  @Get()
  @MinimumRole(Role.GUEST)
  @ApiParam({ name: "game_id", type: Number })
  @ApiOperation({
    operationId: "getGamePackage",
    summary: "Get a game's installation manifest, extras, and optional addons.",
  })
  @ApiOkResponse({ type: PackageDescriptorDto })
  describe(
    @Param("game_id", ParseIntPipe) gameId: number,
    @Request() request: { user: PlaystashUser },
  ) {
    return this.packages.describe(gameId, request.user);
  }

  @Get("assets/:asset_id")
  @MinimumRole(Role.USER)
  @ApiParam({ name: "game_id", type: Number })
  @ApiParam({ name: "asset_id", type: String })
  @ApiOperation({
    operationId: "downloadGamePackageAsset",
    summary: "Download an authorized extra or addon from a game's package.",
  })
  download(
    @Param("game_id", ParseIntPipe) gameId: number,
    @Param("asset_id") assetId: string,
    @Request() request: { user: PlaystashUser },
    @Res({ passthrough: true }) response: Response,
    @Headers("Range") range?: string,
    @Headers("X-Download-Speed-Limit") speed?: string,
  ) {
    return this.packages.download(
      gameId,
      assetId,
      request.user,
      response,
      range,
      speed,
    );
  }
}
