import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Request,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiSecurity,
  ApiTags,
} from "@nestjs/swagger";
import { MinimumRole } from "../../decorators/minimum-role.decorator.js";
import { Role } from "../users/models/role.enum.js";
import { type PlaystashUser } from "../users/playstash-user.entity.js";
import {
  CreateGameRequestDto,
  FeedbackPageDto,
  GameRequestsViewDto,
  GameRequestViewDto,
  GameReviewsViewDto,
  GameReviewViewDto,
  PutGameReviewDto,
  RequestPageDto,
  UpdateGameRequestDto,
} from "./feedback.dto.js";
import { FeedbackService } from "./feedback.service.js";

type AuthenticatedRequest = { user: PlaystashUser };

@ApiBearerAuth()
@ApiSecurity("apikey")
@ApiTags("requests")
@Controller("requests")
export class GameRequestsController {
  constructor(private readonly feedback: FeedbackService) {}

  @Get()
  @MinimumRole(Role.USER)
  @ApiOperation({
    operationId: "getGameRequests",
    summary: "List your requests, or all requests for administrators.",
  })
  @ApiOkResponse({ type: GameRequestsViewDto })
  list(@Request() req: AuthenticatedRequest, @Query() query: RequestPageDto) {
    return this.feedback.listRequests(req.user, query);
  }

  @Post()
  @MinimumRole(Role.USER)
  @ApiOperation({
    operationId: "postGameRequest",
    summary: "Request a game from your server administrator.",
  })
  @ApiOkResponse({ type: GameRequestViewDto })
  create(
    @Request() req: AuthenticatedRequest,
    @Body() input: CreateGameRequestDto,
  ) {
    return this.feedback.createRequest(req.user, input);
  }

  @Patch(":id")
  @MinimumRole(Role.ADMIN)
  @ApiParam({ name: "id", type: Number })
  @ApiOperation({
    operationId: "patchGameRequest",
    summary:
      "Change a request's status and optionally attach the game fulfilling it.",
  })
  @ApiOkResponse({ type: GameRequestViewDto })
  update(
    @Param("id", ParseIntPipe) id: number,
    @Request() req: AuthenticatedRequest,
    @Body() input: UpdateGameRequestDto,
  ) {
    return this.feedback.updateRequest(id, req.user, input);
  }

  @Put(":id/seen")
  @MinimumRole(Role.USER)
  @ApiParam({ name: "id", type: Number })
  @ApiOperation({
    operationId: "putGameRequestSeen",
    summary: "Acknowledge an update to your own request.",
  })
  @ApiOkResponse({ type: GameRequestViewDto })
  seen(
    @Param("id", ParseIntPipe) id: number,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.feedback.acknowledgeRequest(id, req.user);
  }

  @Delete(":id")
  @HttpCode(204)
  @MinimumRole(Role.USER)
  @ApiParam({ name: "id", type: Number })
  @ApiOperation({
    operationId: "deleteGameRequest",
    summary: "Cancel your own open game request.",
  })
  @ApiNoContentResponse()
  cancel(
    @Param("id", ParseIntPipe) id: number,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.feedback.cancelRequest(id, req.user);
  }
}

@ApiBearerAuth()
@ApiSecurity("apikey")
@ApiTags("reviews")
@Controller("games/:game_id/reviews")
export class GameReviewsController {
  constructor(private readonly feedback: FeedbackService) {}

  @Get()
  @MinimumRole(Role.GUEST)
  @ApiParam({ name: "game_id", type: Number })
  @ApiOperation({
    operationId: "getGameReviews",
    summary:
      "Read reviews and the community's average rating for an accessible game.",
  })
  @ApiOkResponse({ type: GameReviewsViewDto })
  list(
    @Param("game_id", ParseIntPipe) gameId: number,
    @Request() req: AuthenticatedRequest,
    @Query() query: FeedbackPageDto,
  ) {
    return this.feedback.listReviews(gameId, req.user, query);
  }

  @Put("me")
  @MinimumRole(Role.USER)
  @ApiParam({ name: "game_id", type: Number })
  @ApiOperation({
    operationId: "putMyGameReview",
    summary: "Publish or replace your rating and review of a game.",
  })
  @ApiOkResponse({ type: GameReviewViewDto })
  put(
    @Param("game_id", ParseIntPipe) gameId: number,
    @Request() req: AuthenticatedRequest,
    @Body() input: PutGameReviewDto,
  ) {
    return this.feedback.putReview(gameId, req.user, input);
  }

  @Delete("me")
  @HttpCode(204)
  @MinimumRole(Role.USER)
  @ApiParam({ name: "game_id", type: Number })
  @ApiOperation({
    operationId: "deleteMyGameReview",
    summary: "Delete your own rating and review.",
  })
  @ApiNoContentResponse()
  delete(
    @Param("game_id", ParseIntPipe) gameId: number,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.feedback.deleteReview(gameId, req.user);
  }
}
