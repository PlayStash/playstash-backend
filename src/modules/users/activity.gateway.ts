import {
  forwardRef,
  Inject,
  Logger,
  UnauthorizedException,
  UseFilters,
  UseGuards,
} from "@nestjs/common";
import { ApiBasicAuth } from "@nestjs/swagger";
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from "@nestjs/websockets";
//import { AsyncApiPub, AsyncApiSub } from "nestjs-asyncapi";
import { type Server, type Socket } from "socket.io";

import configuration from "../../configuration.js";
import { SkipGuards } from "../../decorators/skip-guards.decorator.js";
import { WebsocketExceptionsFilter } from "../../filters/websocket-exceptions.filter.js";
import { ApiKeyGuard } from "../auth/guards/api-key.guard.js";
import { GamesService } from "../games/games.service.js";
import { ChatService } from "./chat.service.js";
import { ActivityState } from "./models/activity-state.enum.js";
import { Activity } from "./models/activity.dto.js";
import { ChatHistoryDto, ChatSendDto } from "./models/chat.dto.js";
import { Role } from "./models/role.enum.js";
import { PlaystashUser } from "./playstash-user.entity.js";
import { UsersService } from "./users.service.js";

// Conditionally decorate the WebSocket gateway class.
const ConditionalWebSocketGateway = configuration.SERVER
  .ONLINE_ACTIVITIES_DISABLED
  ? () => {}
  : WebSocketGateway({ cors: true });

@UseGuards(ApiKeyGuard)
@SkipGuards(["AuthenticationGuard"])
@ApiBasicAuth()
@ConditionalWebSocketGateway
@UseFilters(WebsocketExceptionsFilter)
export class ActivityGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(this.constructor.name);

  private readonly activities: Map<number, Activity> = new Map<
    number,
    Activity
  >();
  private readonly chatRooms = new Map<string, Set<string>>();

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly usersService: UsersService,
    @Inject(forwardRef(() => GamesService))
    private readonly gamesService: GamesService,
    private readonly chatService: ChatService = new ChatService(
      usersService,
      gamesService,
    ),
  ) {}

  //@AsyncApiSub({
  //  channel: "set-activity",
  //  operationId: "set-activity",
  //  summary: "sets the activity of your user.",
  //  tags: [{ name: "activity" }],
  //  message: {
  //    payload: Activity,
  //  },
  //})
  //@AsyncApiPub({
  //  channel: "activities",
  //  operationId: "activity",
  //  summary: "sends the new activiy to all users.",
  //  tags: [{ name: "activity" }],
  //  message: {
  //    payload: Activity,
  //  },
  //})
  @SubscribeMessage("set-activity")
  async setActivity(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: Activity,
  ) {
    const user = await this.currentUser(client);
    if (!dto || !Object.values(ActivityState).includes(dto.state))
      throw new WsException("Invalid activity state.");
    const gameId =
      dto.state === ActivityState.PLAYING ? dto.game_id : undefined;
    if (dto.state === ActivityState.PLAYING) {
      if (!Number.isSafeInteger(gameId) || Number(gameId) <= 0)
        throw new WsException("A valid game ID is required.");
      await this.gamesService.findOneByGameIdOrFail(gameId!, {
        requestingUser: user,
        loadDeletedEntities: false,
        filterByAge: await this.usersService.findUserAgeByUsername(
          user.username,
        ),
      });
    }
    const activity = {
      user_id: user.id,
      socket_id: client.id,
      state: dto.state,
      game_id: gameId,
    };
    this.activities.set(user.id, activity);
    await Promise.all(
      [...(this.server.sockets?.sockets.values() ?? [])].map(async (socket) => {
        try {
          const visible = await this.visibleActivity(
            activity,
            await this.currentUser(socket),
          );
          if (visible) socket.emit("activity", visible);
          else socket.emit("remove-activity", { user_id: activity.user_id });
        } catch {
          /* Unauthenticated, deleted or disabled recipient. */
        }
      }),
    );
  }

  //@AsyncApiSub({
  //  channel: "get-activities",
  //  operationId: "get-activities",
  //  summary: "request all activities",
  //  tags: [{ name: "activity" }],
  //  message: { payload: Object },
  //})
  //@AsyncApiPub({
  //  channel: "activities",
  //  operationId: "activities",
  //  summary: "sends all activities to all users.",
  //  tags: [{ name: "activity" }],
  //  message: {
  //    payload: Array<Activity>,
  //  },
  //})
  @SubscribeMessage("get-activities")
  async getActivities(@ConnectedSocket() client: Socket) {
    const user = await this.currentUser(client);
    const activities = await Promise.all(
      this.getAll().map((activity) => this.visibleActivity(activity, user)),
    );
    client.emit(
      "activities",
      activities.filter((activity) => activity !== undefined),
    );
  }

  @SubscribeMessage("chat-history")
  async chatHistory(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: ChatHistoryDto = {},
  ) {
    const result = await this.chatService.history(
      dto,
      await this.currentUser(client),
    );
    this.subscribeConversation(client.id, result.conversation);
    return { event: "chat-history", data: result };
  }

  @SubscribeMessage("chat-leave")
  async chatLeave(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: ChatHistoryDto = {},
  ) {
    const result = await this.chatService.history(
      { ...dto, limit: 1 },
      await this.currentUser(client),
    );
    this.chatRooms.get(client.id)?.delete(result.conversation);
    return { event: "chat-left", data: { conversation: result.conversation } };
  }

  @SubscribeMessage("chat-send")
  async chatSend(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: ChatSendDto,
  ) {
    const result = await this.chatService.send(
      dto,
      await this.currentUser(client),
    );
    this.subscribeConversation(client.id, result.conversation);
    if (!result.replay) {
      await Promise.all(
        [...(this.server.sockets?.sockets.values() ?? [])].map(
          async (socket) => {
            if (
              !result.message.recipient_user_id &&
              !this.chatRooms.get(socket.id)?.has(result.conversation)
            )
              return;
            try {
              if (
                await this.chatService.canReceive(
                  result.message,
                  await this.currentUser(socket),
                )
              )
                socket.emit("chat-message", result.message);
            } catch {
              /* Recipient authentication or permissions were revoked. */
            }
          },
        ),
      );
    }
    return { event: "chat-sent", data: result.message };
  }

  private subscribeConversation(socketId: string, conversation: string): void {
    const rooms = this.chatRooms.get(socketId) ?? new Set<string>();
    // Prevent an authenticated socket from accumulating unlimited subscriptions.
    if (!rooms.has(conversation) && rooms.size >= 100)
      rooms.delete(rooms.values().next().value!);
    rooms.add(conversation);
    this.chatRooms.set(socketId, rooms);
  }

  private async currentUser(client: Socket): Promise<PlaystashUser> {
    const authenticated = (client as unknown as { user?: PlaystashUser }).user;
    if (!authenticated)
      throw new UnauthorizedException(
        "Authentication is required for activities and chat.",
      );
    const user = await this.usersService.findOneByUserIdOrFail(
      authenticated.id,
      { loadRelations: false, loadDeletedEntities: false },
    );
    if (user.activated === false && user.role !== Role.ADMIN)
      throw new UnauthorizedException("The user is inactive.");
    return user;
  }

  handleConnection(client: Socket) {
    this.logger.log({ message: "Client connected.", client: client.id });
    // Message guards authenticate get-activities; the initial connection has
    // not passed them and must receive no private library/activity data.
  }

  handleDisconnect(client: Socket) {
    this.logger.log({ message: "Client disconnected.", client: client.id });
    for (const [userId, activity] of this.activities) {
      if (activity.socket_id === client.id) {
        this.activities.delete(userId);
        if (activity.state !== ActivityState.INVISIBLE) {
          for (const socket of this.server.sockets?.sockets.values() ?? []) {
            if ((socket as unknown as { user?: PlaystashUser }).user)
              socket.emit("remove-activity", { user_id: userId });
          }
        }
      }
    }
    this.chatRooms.delete(client.id);
  }

  private getAll() {
    return [...this.activities.values()];
  }

  private async visibleActivity(
    activity: Activity,
    viewer: PlaystashUser,
  ): Promise<Activity | undefined> {
    if (
      activity.state === ActivityState.INVISIBLE &&
      activity.user_id !== viewer.id
    )
      return undefined;
    if (!activity.game_id) return activity;
    const hidden = {
      ...activity,
      game_id: undefined,
      state: ActivityState.ONLINE,
    };
    try {
      const game = await this.gamesService.findOneByGameIdOrFail(
        activity.game_id,
        {
          requestingUser: viewer,
          loadDeletedEntities: false,
          filterByAge: await this.usersService.findUserAgeByUsername(
            viewer.username,
          ),
        },
      );
      if (game.access_restricted && activity.user_id !== viewer.id) {
        const owner = await this.usersService.findOneByUserIdOrFail(
          activity.user_id!,
          { loadRelations: false, loadDeletedEntities: false },
        );
        if (!owner.share_restricted_activity) return hidden;
      }
      return activity;
    } catch {
      return hidden;
    }
  }
}
