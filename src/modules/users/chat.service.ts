import { Inject, Injectable, forwardRef } from "@nestjs/common";
import { WsException } from "@nestjs/websockets";
import { randomUUID } from "node:crypto";
import { GamesService } from "../games/games.service.js";
import type {
  ChatHistoryDto,
  ChatMessageDto,
  ChatSendDto,
  ChatTargetDto,
} from "./models/chat.dto.js";
import type { PlaystashUser } from "./playstash-user.entity.js";
import { UsersService } from "./users.service.js";

const MESSAGE_LIMIT = 100;
const CONVERSATION_LIMIT = 100;
const RETENTION_MS = 24 * 60 * 60 * 1000;
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Chat is transient: at most 100 conversations of 100 messages, for 24 hours. */
@Injectable()
export class ChatService {
  private readonly histories = new Map<string, ChatMessageDto[]>();
  private readonly sendTimes = new Map<number, number[]>();

  constructor(
    private readonly users: UsersService,
    @Inject(forwardRef(() => GamesService))
    private readonly games: GamesService,
  ) {}

  async send(
    dto: ChatSendDto,
    user: PlaystashUser,
  ): Promise<{
    message: ChatMessageDto;
    conversation: string;
    replay: boolean;
  }> {
    const conversation = await this.authorizedConversation(dto, user);
    if (
      typeof dto.text !== "string" ||
      dto.text.length > 2000 ||
      !dto.text.trim() ||
      Array.from(dto.text).some((character) => {
        const code = character.codePointAt(0)!;
        return (code < 32 && ![9, 10, 13].includes(code)) || code === 127;
      })
    ) {
      throw new WsException(
        "Messages must contain 1 to 2000 characters of plain text.",
      );
    }
    if (
      dto.client_message_id !== undefined &&
      (typeof dto.client_message_id !== "string" ||
        !UUID_V4.test(dto.client_message_id))
    ) {
      throw new WsException("client_message_id must be a UUID v4.");
    }
    this.prune();
    const text = dto.text.trim();
    const messageId = dto.client_message_id?.toLowerCase();
    const previous =
      messageId &&
      this.histories
        .get(conversation)
        ?.find(
          (message) =>
            message.user_id === user.id &&
            message.client_message_id === messageId,
        );
    if (previous) {
      if (previous.text !== text)
        throw new WsException(
          "This message ID was already used for different text.",
        );
      return { message: previous, conversation, replay: true };
    }
    const now = Date.now();
    const recent = (this.sendTimes.get(user.id) ?? []).filter(
      (time) => time > now - 10_000,
    );
    if (recent.length >= 5)
      throw new WsException("Please wait before sending another message.");
    this.sendTimes.set(user.id, [...recent, now]);
    const message: ChatMessageDto = {
      id: randomUUID(),
      client_message_id: messageId,
      user_id: user.id,
      username: user.username,
      text,
      created_at: new Date(now).toISOString(),
      ...(dto.recipient_user_id
        ? { recipient_user_id: dto.recipient_user_id }
        : { room: dto.room ?? "lobby" }),
    };
    const history = [
      ...(this.histories.get(conversation) ?? []),
      message,
    ].slice(-MESSAGE_LIMIT);
    // Refresh insertion order to evict the least recently used conversation.
    this.histories.delete(conversation);
    this.histories.set(conversation, history);
    while (this.histories.size > CONVERSATION_LIMIT)
      this.histories.delete(this.histories.keys().next().value!);
    return { message, conversation, replay: false };
  }

  async history(
    dto: ChatHistoryDto,
    user: PlaystashUser,
  ): Promise<{ conversation: string; messages: ChatMessageDto[] }> {
    const conversation = await this.authorizedConversation(dto, user);
    if (
      dto.limit !== undefined &&
      (!Number.isSafeInteger(dto.limit) ||
        dto.limit < 1 ||
        dto.limit > MESSAGE_LIMIT)
    )
      throw new WsException("History limit must be between 1 and 100.");
    this.prune();
    return {
      conversation,
      messages: (this.histories.get(conversation) ?? []).slice(
        -(dto.limit ?? 50),
      ),
    };
  }

  async canReceive(
    message: ChatMessageDto,
    user: PlaystashUser,
  ): Promise<boolean> {
    if (message.recipient_user_id)
      return (
        user.id === message.user_id || user.id === message.recipient_user_id
      );
    try {
      await this.authorizedConversation({ room: message.room }, user);
      return true;
    } catch {
      return false;
    }
  }

  private async authorizedConversation(
    dto: ChatTargetDto,
    user: PlaystashUser,
  ): Promise<string> {
    if (!dto || typeof dto !== "object")
      throw new WsException("A conversation is required.");
    if (dto.recipient_user_id !== undefined) {
      if (
        dto.room !== undefined ||
        !Number.isSafeInteger(dto.recipient_user_id) ||
        dto.recipient_user_id < 1 ||
        dto.recipient_user_id === user.id
      )
        throw new WsException("Select one valid direct recipient or room.");
      try {
        const recipient = await this.users.findOneByUserIdOrFail(
          dto.recipient_user_id,
          { loadRelations: false, loadDeletedEntities: false },
        );
        if (recipient.activated === false)
          throw new Error("Inactive recipient.");
      } catch {
        throw new WsException("The recipient is unavailable.");
      }
      return `dm:${Math.min(user.id, dto.recipient_user_id)}:${Math.max(user.id, dto.recipient_user_id)}`;
    }
    const room = dto.room ?? "lobby";
    if (room === "lobby") return room;
    if (typeof room !== "string" || !/^game:[1-9]\d{0,14}$/.test(room))
      throw new WsException("Select lobby or game:<game ID>.");
    const gameId = Number(room.slice(5));
    if (!Number.isSafeInteger(gameId))
      throw new WsException("Invalid game ID.");
    try {
      await this.games.findOneByGameIdOrFail(gameId, {
        requestingUser: user,
        loadDeletedEntities: false,
        filterByAge: await this.users.findUserAgeByUsername(user.username),
      });
    } catch {
      throw new WsException("The conversation is unavailable.");
    }
    return room;
  }

  private prune(): void {
    const cutoff = Date.now() - RETENTION_MS;
    for (const [conversation, messages] of this.histories) {
      const retained = messages.filter(
        (message) => Date.parse(message.created_at) > cutoff,
      );
      if (retained.length) this.histories.set(conversation, retained);
      else this.histories.delete(conversation);
    }
    for (const [user, times] of this.sendTimes) {
      const retained = times.filter((time) => time > Date.now() - 10_000);
      if (retained.length) this.sendTimes.set(user, retained);
      else this.sendTimes.delete(user);
    }
  }
}
