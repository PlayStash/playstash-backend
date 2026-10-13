import {
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  Post,
  Put,
  Request,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiSecurity,
  ApiTags,
} from "@nestjs/swagger";

import configuration from "../../configuration.js";
import { DisableApiIf } from "../../decorators/disable-api-if.decorator.js";
import { MinimumRole } from "../../decorators/minimum-role.decorator.js";
import { GameIdDto } from "../games/models/game-id.dto.js";
import { ApiKeyService } from "./api-key.service.js";
import { Role } from "./models/role.enum.js";
import { UpdateUserDto } from "./models/update-user.dto.js";
import { UserIdDto } from "./models/user-id.dto.js";
import { PlaystashUser } from "./playstash-user.entity.js";
import { UsersService } from "./users.service.js";

@ApiBearerAuth()
@ApiTags("user")
@Controller("users")
@ApiSecurity("apikey")
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly apiKeyService: ApiKeyService,
  ) {}
  private readonly logger = new Logger(this.constructor.name);

  @Get()
  @ApiOperation({
    summary:
      "get an overview of all users. admins can see hidden users using this endpoint aswell.",
    operationId: "getUsers",
  })
  @ApiOkResponse({ type: () => PlaystashUser, isArray: true })
  @MinimumRole(Role.GUEST)
  async getUsers(
    @Request() req: { user: PlaystashUser },
  ): Promise<PlaystashUser[]> {
    const includeHiddenUsers = req.user.role >= Role.ADMIN;
    return this.usersService.find(includeHiddenUsers);
  }

  //#region Redirects

  /** Retrieve own user information. */
  @Get("me")
  @ApiOperation({
    summary: "get details of your user",
    operationId: "getUsersMe",
  })
  @MinimumRole(Role.GUEST)
  @ApiOkResponse({ type: () => PlaystashUser })
  async getUsersMe(
    @Request() request: { user: PlaystashUser },
  ): Promise<PlaystashUser> {
    return this.getUserByUserId({ user_id: request.user.id }, request);
  }

  /** Updates details of the user. */
  @Put("me")
  @ApiBody({ type: () => UpdateUserDto })
  @ApiOperation({
    summary: "update details of your user",
    operationId: "putUsersMe",
  })
  @MinimumRole(Role.USER)
  @ApiOkResponse({ type: () => PlaystashUser })
  @DisableApiIf(configuration.SERVER.DEMO_MODE_ENABLED)
  async putUsersMe(
    @Body() dto: UpdateUserDto,
    @Request() request: { user: PlaystashUser },
  ): Promise<PlaystashUser> {
    return this.putUserByUserId(
      { user_id: request.user.id },
      dto,
      request,
      false,
    );
  }

  /** Deletes your own user. */
  @Delete("me")
  @ApiOperation({
    summary: "delete your own user",
    operationId: "deleteUserMe",
  })
  @ApiOkResponse({ type: () => PlaystashUser })
  @MinimumRole(Role.USER)
  @DisableApiIf(configuration.SERVER.DEMO_MODE_ENABLED)
  async deleteUsersMe(
    @Request() request: { user: PlaystashUser },
  ): Promise<PlaystashUser> {
    return this.usersService.delete(request.user.id);
  }
  //#endregion

  @Post("me/bookmark/:game_id")
  @ApiParam({ name: "game_id", required: true, type: Number })
  @ApiOperation({
    summary: "bookmark a game",
    operationId: "postUsersMeBookmark",
  })
  @MinimumRole(Role.GUEST)
  async postUsersMeBookmark(
    @Request() request: { user: PlaystashUser },
    @Param() params: GameIdDto,
  ): Promise<PlaystashUser> {
    const user = await this.usersService.findOneByUsernameOrFail(
      request.user.username,
      { loadDeletedEntities: false, loadRelations: ["bookmarked_games"] },
    );
    return this.usersService.bookmarkGame(user.id, Number(params.game_id));
  }

  @Delete("me/bookmark/:game_id")
  @ApiParam({ name: "game_id", required: true, type: Number })
  @ApiOperation({
    summary: "unbookmark a game",
    operationId: "deleteUsersMeBookmark",
  })
  @MinimumRole(Role.GUEST)
  async deleteUsersMeBookmark(
    @Request() request: { user: PlaystashUser },
    @Param() params: GameIdDto,
  ): Promise<PlaystashUser> {
    const user = await this.usersService.findOneByUsernameOrFail(
      request.user.username,
      { loadDeletedEntities: false, loadRelations: ["bookmarked_games"] },
    );
    return this.usersService.unbookmarkGame(user.id, Number(params.game_id));
  }

  /** Get details on a user. */
  @Get(":user_id")
  @ApiParam({ name: "user_id", required: true, type: Number })
  @ApiOperation({
    summary: "get details on a user",
    operationId: "getUserByUserId",
  })
  @MinimumRole(Role.GUEST)
  @ApiOkResponse({ type: () => PlaystashUser })
  async getUserByUserId(
    @Param() params: UserIdDto,
    @Request() request: { user: PlaystashUser },
  ): Promise<PlaystashUser> {
    const user = await this.usersService.findOneByUserIdOrFail(
      Number(params.user_id),
      {
        loadDeletedEntities: true,
        loadRelations: true,
        requestingUser: request.user,
      },
    );
    if (user.id === request.user.id) {
      // If the user is requesting their own details, ensure the API key is loaded.
      user.api_key = await this.apiKeyService.findApiKeyOrFail(request.user.id);
    }
    return user;
  }

  /** Updates details of any user. */
  @Put(":user_id")
  @ApiParam({ name: "user_id", required: true, type: Number })
  @ApiBody({ type: () => UpdateUserDto })
  @ApiOperation({
    summary: "update details of any user",
    operationId: "putUserByUserId",
  })
  @MinimumRole(Role.ADMIN)
  @ApiOkResponse({ type: () => PlaystashUser })
  async putUserByUserId(
    @Param() params: UserIdDto,
    @Body() dto: UpdateUserDto,
    @Request() request: { user: PlaystashUser },
    isAdmin = true,
  ): Promise<PlaystashUser> {
    const user = await this.usersService.update(
      Number(params.user_id),
      dto,
      isAdmin,
    );
    if (user.id === request.user.id) {
      // If the user is editing their own details, ensure the API key is loaded.
      user.api_key = await this.apiKeyService.findApiKeyOrFail(request.user.id);
    }
    return user;
  }

  /** Deletes any user with the specified ID. */
  @Delete(":user_id")
  @ApiParam({ name: "user_id", required: true, type: Number })
  @ApiOperation({
    summary: "delete any user",
    operationId: "deleteUserByUserId",
  })
  @ApiOkResponse({ type: () => PlaystashUser })
  @MinimumRole(Role.ADMIN)
  async deleteUserByUserId(@Param() params: UserIdDto): Promise<PlaystashUser> {
    return this.usersService.delete(Number(params.user_id));
  }

  /** Recover a deleted user. */
  @Post(":user_id/recover")
  @ApiParam({ name: "user_id", required: true, type: Number })
  @MinimumRole(Role.ADMIN)
  @ApiOperation({
    summary: "recover a deleted user",
    operationId: "postUserRecoverByUserId",
  })
  @ApiOkResponse({ type: () => PlaystashUser })
  async postUserRecoverByUserId(
    @Param() params: UserIdDto,
  ): Promise<PlaystashUser> {
    return this.usersService.recover(Number(params.user_id));
  }
}
