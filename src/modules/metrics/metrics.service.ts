import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { InjectRepository } from "@nestjs/typeorm";
import { LessThan, Repository } from "typeorm";
import type { AppConfiguration } from "../../configuration.js";
import { InjectPlaystashConfig } from "../../decorators/inject-playstash-config.decorator.js";
import { GameVersion } from "../games/game-version.entity.js";
import { GamesService } from "../games/games.service.js";
import { Role } from "../users/models/role.enum.js";
import type { PlaystashUser } from "../users/playstash-user.entity.js";
import { UsersService } from "../users/users.service.js";
import { GameClientEvent } from "./game-client-event.entity.js";
import {
  GameClientEventType,
  type CreateGameClientEventDto,
  type GameClientEventAcceptedDto,
  type GameClientEventDto,
  type GameMetricsSummaryDto,
} from "./models/game-client-event.dto.js";

@Injectable()
export class MetricsService {
  constructor(
    @InjectRepository(GameClientEvent)
    private readonly events: Repository<GameClientEvent>,
    @InjectRepository(GameVersion)
    private readonly versions: Repository<GameVersion>,
    private readonly games: GamesService,
    private readonly users: UsersService,
    @InjectPlaystashConfig() private readonly config: AppConfiguration,
  ) {}

  async record(
    gameId: number,
    dto: CreateGameClientEventDto,
    requester: PlaystashUser,
  ): Promise<GameClientEventAcceptedDto> {
    dto = {
      ...dto,
      event_id: dto.event_id.toLowerCase(),
      installation_id: dto.installation_id?.toLowerCase(),
    };
    const game = await this.games.findOneByGameIdOrFail(gameId, {
      requestingUser: requester,
      loadDeletedEntities: false,
      filterByAge: await this.users.findUserAgeByUsername(requester.username),
    });
    if (!this.config.METRICS.ENABLED || requester.report_game_metrics === false)
      return { event_id: dto.event_id, accepted: false };
    const occurredAt = dto.occurred_at ? new Date(dto.occurred_at) : new Date();
    if (
      !Number.isFinite(occurredAt.getTime()) ||
      occurredAt.getTime() > Date.now() + 5 * 60 * 1000
    ) {
      throw new BadRequestException(
        "Event time is invalid or too far in the future.",
      );
    }
    const retention = this.config.METRICS.RETENTION_DAYS ?? 365;
    if (
      retention > 0 &&
      occurredAt.getTime() < Date.now() - retention * 86400000
    )
      return { event_id: dto.event_id, accepted: false };
    if (dto.type !== GameClientEventType.PLAYED && dto.minutes_played)
      throw new BadRequestException(
        "Session minutes are only valid for played events.",
      );
    const existing = await this.events.findOne({
      where: { event_id: dto.event_id },
      relations: { user: true, game: true, version: true },
    });
    if (existing) return this.replay(existing, gameId, dto, requester);
    const version = dto.version_id
      ? await this.versions.findOneBy({
          id: dto.version_id,
          game: { id: gameId },
        })
      : undefined;
    if (dto.version_id && (!version || version.deleted_at))
      throw new BadRequestException(
        "The requested version does not belong to this game.",
      );
    try {
      await this.events.save({
        event_id: dto.event_id,
        type: dto.type,
        user: requester,
        game,
        version,
        installation_id: dto.installation_id,
        occurred_at: occurredAt,
        minutes_played: dto.minutes_played ?? 0,
      });
    } catch (error) {
      // Unique event IDs also cover simultaneous retries, on SQLite and PostgreSQL.
      const duplicate = await this.events.findOne({
        where: { event_id: dto.event_id },
        relations: { user: true, game: true, version: true },
      });
      if (duplicate) return this.replay(duplicate, gameId, dto, requester);
      throw error;
    }
    return { event_id: dto.event_id, accepted: true };
  }

  private replay(
    existing: GameClientEvent,
    gameId: number,
    dto: CreateGameClientEventDto,
    requester: PlaystashUser,
  ): GameClientEventAcceptedDto {
    if (
      existing.user.id !== requester.id ||
      existing.game.id !== gameId ||
      existing.type !== dto.type ||
      (existing.version?.id ?? null) !== (dto.version_id ?? null) ||
      (existing.installation_id ?? null) !== (dto.installation_id ?? null) ||
      existing.minutes_played !== (dto.minutes_played ?? 0) ||
      (dto.occurred_at &&
        existing.occurred_at.getTime() !== new Date(dto.occurred_at).getTime())
    ) {
      throw new ConflictException(
        "This event UUID was already used for a different event.",
      );
    }
    return { event_id: dto.event_id, accepted: true };
  }

  private async scopedQuery(gameId: number, requester: PlaystashUser) {
    if (requester.role !== Role.ADMIN)
      throw new ForbiddenException("Only administrators may inspect metrics.");
    const game = await this.games.findOneByGameIdOrFail(gameId, {
      requestingUser: requester,
      loadDeletedEntities: true,
    });
    const query = this.events
      .createQueryBuilder("event")
      .innerJoinAndSelect("event.user", "user")
      .innerJoinAndSelect("event.game", "game")
      .leftJoinAndSelect("event.version", "version")
      .where("game.id = :gameId", { gameId });
    if (game.access_restricted)
      query.andWhere(
        "(user.id = :requesterId OR user.share_restricted_activity = :sharing)",
        { requesterId: requester.id, sharing: true },
      );
    return query;
  }

  async list(
    gameId: number,
    requester: PlaystashUser,
    limit = 100,
    beforeId?: number,
    userId?: number,
  ): Promise<GameClientEventDto[]> {
    const query = await this.scopedQuery(gameId, requester);
    if (beforeId) query.andWhere("event.id < :beforeId", { beforeId });
    if (userId) query.andWhere("user.id = :userId", { userId });
    const events = await query
      .orderBy("event.id", "DESC")
      .take(limit)
      .getMany();
    return events.map((event) => ({
      id: event.id,
      event_id: event.event_id,
      type: event.type,
      user_id: event.user.id,
      game_id: event.game.id,
      version_id: event.version?.id,
      installation_id: event.installation_id ?? undefined,
      occurred_at: event.occurred_at,
      minutes_played: event.minutes_played,
    }));
  }

  async summary(
    gameId: number,
    requester: PlaystashUser,
  ): Promise<GameMetricsSummaryDto> {
    const query = await this.scopedQuery(gameId, requester);
    const rows = await query
      .select("event.type", "type")
      .addSelect("COUNT(*)", "count")
      .addSelect("SUM(event.minutes_played)", "minutes")
      .groupBy("event.type")
      .getRawMany();
    const summary = {
      downloaded: 0,
      installed: 0,
      uninstalled: 0,
      played: 0,
      minutes_played: 0,
    };
    for (const row of rows) {
      if (Object.values(GameClientEventType).includes(row.type))
        summary[row.type as GameClientEventType] = Number(row.count);
      summary.minutes_played += Number(row.minutes ?? 0);
    }
    return summary;
  }

  @Cron("0 10 0 * * *")
  async purgeExpiredEvents(): Promise<void> {
    const days = this.config.METRICS.RETENTION_DAYS ?? 365;
    if (days > 0)
      await this.events.delete({
        occurred_at: LessThan(new Date(Date.now() - days * 86400000)),
      });
  }
}
