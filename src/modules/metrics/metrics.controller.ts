import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Request,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiSecurity,
  ApiTags,
} from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsInt, IsOptional, Max, Min } from "class-validator";
import { MinimumRole } from "../../decorators/minimum-role.decorator.js";
import { Role } from "../users/models/role.enum.js";
import { PlaystashUser } from "../users/playstash-user.entity.js";
import { MetricsService } from "./metrics.service.js";
import {
  CreateGameClientEventDto,
  GameClientEventAcceptedDto,
  GameClientEventDto,
  GameMetricsSummaryDto,
} from "./models/game-client-event.dto.js";

export class MetricsQueryDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(500) @IsOptional() limit?: number;
  @Type(() => Number) @IsInt() @Min(1) @IsOptional() before_id?: number;
  @Type(() => Number) @IsInt() @Min(1) @IsOptional() user_id?: number;
}

@Controller("game")
@ApiTags("metrics")
@ApiBearerAuth()
@ApiSecurity("apikey")
export class MetricsController {
  constructor(private readonly service: MetricsService) {}

  @Post(":game_id/events")
  @MinimumRole(Role.USER)
  @HttpCode(200)
  @ApiParam({ name: "game_id", type: Number, required: true })
  @ApiOperation({
    summary:
      "Record your completed client lifecycle event; retries use the same UUID",
    operationId: "postGameClientEvent",
  })
  @ApiBody({ type: CreateGameClientEventDto })
  @ApiOkResponse({ type: GameClientEventAcceptedDto })
  record(
    @Param("game_id", ParseIntPipe) gameId: number,
    @Body() dto: CreateGameClientEventDto,
    @Request() req: { user: PlaystashUser },
  ) {
    return this.service.record(gameId, dto, req.user);
  }

  @Get(":game_id/events")
  @MinimumRole(Role.ADMIN)
  @ApiParam({ name: "game_id", type: Number, required: true })
  @ApiQuery({
    name: "limit",
    type: Number,
    required: false,
    description: "1–500; defaults to 100",
  })
  @ApiQuery({ name: "before_id", type: Number, required: false })
  @ApiQuery({ name: "user_id", type: Number, required: false })
  @ApiOperation({
    summary: "Inspect per-user lifecycle events (administrators only)",
    operationId: "getGameClientEvents",
  })
  @ApiOkResponse({ type: GameClientEventDto, isArray: true })
  list(
    @Param("game_id", ParseIntPipe) gameId: number,
    @Query() query: MetricsQueryDto,
    @Request() req: { user: PlaystashUser },
  ) {
    return this.service.list(
      gameId,
      req.user,
      query.limit,
      query.before_id,
      query.user_id,
    );
  }

  @Get(":game_id/metrics")
  @MinimumRole(Role.ADMIN)
  @ApiParam({ name: "game_id", type: Number, required: true })
  @ApiOperation({
    summary: "Inspect lifecycle totals (administrators only)",
    operationId: "getGameMetrics",
  })
  @ApiOkResponse({ type: GameMetricsSummaryDto })
  summary(
    @Param("game_id", ParseIntPipe) gameId: number,
    @Request() req: { user: PlaystashUser },
  ) {
    return this.service.summary(gameId, req.user);
  }
}
