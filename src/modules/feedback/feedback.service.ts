import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { GamesService } from "../games/games.service.js";
import { Role } from "../users/models/role.enum.js";
import { type PlaystashUser } from "../users/playstash-user.entity.js";
import { UsersService } from "../users/users.service.js";
import {
  type CreateGameRequestDto,
  type FeedbackPageDto,
  type GameRequestsViewDto,
  type GameRequestViewDto,
  type GameReviewsViewDto,
  type GameReviewViewDto,
  type PutGameReviewDto,
  type RequestPageDto,
  type UpdateGameRequestDto,
} from "./feedback.dto.js";
import { GameRequest, RequestStatus } from "./game-request.entity.js";
import { GameReview } from "./game-review.entity.js";

@Injectable()
export class FeedbackService {
  constructor(
    @InjectRepository(GameRequest)
    private readonly requests: Repository<GameRequest>,
    @InjectRepository(GameReview)
    private readonly reviews: Repository<GameReview>,
    private readonly games: GamesService,
    private readonly users: UsersService,
  ) {}

  private async checkGame(gameId: number, user: PlaystashUser) {
    return this.games.findOneByGameIdOrFail(gameId, {
      filterByAge: await this.users.findUserAgeByUsername(user.username),
      requestingUser: user,
    });
  }

  private requestView(
    row: GameRequest,
    user: PlaystashUser,
  ): GameRequestViewDto {
    const mine = row.user_id === user.id;
    return {
      id: row.id,
      title: row.title,
      note: row.note,
      anonymous: row.anonymous,
      status: row.status,
      game_id: row.game_id ?? null,
      mine,
      ...(!row.anonymous
        ? {
            user_id: row.user_id,
            username: row.user?.username ?? "Deleted user",
          }
        : {}),
      unread:
        mine &&
        row.entity_version > 1 &&
        (!row.user_seen_at ||
          row.user_seen_at < (row.updated_at ?? row.created_at)),
      created_at: row.created_at,
      updated_at: row.updated_at ?? row.created_at,
    };
  }

  async listRequests(
    user: PlaystashUser,
    query: RequestPageDto,
  ): Promise<GameRequestsViewDto> {
    const page = query.page ?? 1,
      limit = query.limit ?? 50;
    const where =
      user.role >= Role.ADMIN && !query.mine ? {} : { user_id: user.id };
    const [rows, total] = await this.requests.findAndCount({
      where,
      relations: { user: true },
      order: { created_at: "DESC", id: "DESC" },
      skip: (page - 1) * limit,
      take: limit,
    });
    const unread_count = await this.requests
      .createQueryBuilder("request")
      .where("request.user_id = :userId", { userId: user.id })
      .andWhere("request.entity_version > 1")
      .andWhere(
        "(request.user_seen_at IS NULL OR request.user_seen_at < request.updated_at)",
      )
      .getCount();
    const open_count = await this.requests.count({
      where: { ...where, status: RequestStatus.OPEN },
    });
    // An administrator may revoke access after fulfillment. Do not expose that
    // game's ID in a subsequent response to the requester.
    const views = await Promise.all(
      rows.map(async (row) => {
        const view = this.requestView(row, user);
        if (view.game_id != null) {
          try {
            await this.checkGame(view.game_id, user);
          } catch {
            view.game_id = null;
          }
        }
        return view;
      }),
    );
    return { requests: views, total, page, limit, unread_count, open_count };
  }

  async createRequest(user: PlaystashUser, input: CreateGameRequestDto) {
    const row = await this.requests.save(
      this.requests.create({
        user_id: user.id,
        title: input.title.trim(),
        note: input.note?.trim() ?? "",
        anonymous: input.anonymous ?? false,
        status: RequestStatus.OPEN,
        game_id: null,
        user_seen_at: null,
      }),
    );
    row.user = user;
    return this.requestView(row, user);
  }

  async updateRequest(
    id: number,
    admin: PlaystashUser,
    input: UpdateGameRequestDto,
  ) {
    if (admin.role < Role.ADMIN)
      throw new ForbiddenException("Only administrators can update requests.");
    const row = await this.requests.findOne({
      where: { id },
      relations: { user: true },
    });
    if (!row) throw new NotFoundException("Game request not found.");
    if (input.game_id !== undefined && input.status !== RequestStatus.FULFILLED)
      throw new BadRequestException(
        "A game can only be attached to a fulfilled request.",
      );
    if (input.game_id !== undefined) {
      const owner = await this.users.findOneByUserIdOrFail(row.user_id, {
        loadRelations: false,
      });
      await this.checkGame(input.game_id, admin);
      await this.checkGame(input.game_id, owner);
    }
    const gameId =
      input.status === RequestStatus.FULFILLED ? (input.game_id ?? null) : null;
    if (row.status === input.status && row.game_id === gameId)
      return this.requestView(row, admin);
    row.status = input.status;
    row.game_id = gameId;
    row.user_seen_at = null;
    return this.requestView(await this.requests.save(row), admin);
  }

  async acknowledgeRequest(id: number, user: PlaystashUser) {
    const row = await this.requests.findOne({
      where: { id, user_id: user.id },
      relations: { user: true },
    });
    if (!row) throw new NotFoundException("Game request not found.");
    // Updating only this column must not advance updated_at, otherwise seeing an
    // update creates another unread update. Raw SQL deliberately bypasses the
    // TypeORM update-date hook while keeping values parameterized.
    await this.requests
      .createQueryBuilder()
      .update(GameRequest)
      .set({
        user_seen_at: () => '"updated_at"',
        updated_at: () => '"updated_at"',
        entity_version: () => '"entity_version"',
      })
      .where("id = :id AND user_id = :userId AND entity_version = :version", {
        id,
        userId: user.id,
        version: row.entity_version,
      })
      .execute();
    row.user_seen_at = row.updated_at ?? row.created_at;
    return this.requestView(row, user);
  }

  async cancelRequest(id: number, user: PlaystashUser) {
    const row = await this.requests.findOne({
      where: { id, user_id: user.id },
    });
    if (!row) throw new NotFoundException("Game request not found.");
    if (row.status !== RequestStatus.OPEN)
      throw new ConflictException("Only open requests can be cancelled.");
    await this.requests.delete({ id, user_id: user.id });
  }

  private reviewView(row: GameReview, user: PlaystashUser): GameReviewViewDto {
    return {
      id: row.id,
      user_id: row.user_id,
      username: row.user?.username ?? "Deleted user",
      rating: row.rating,
      comment: row.comment,
      mine: row.user_id === user.id,
      updated_at: row.updated_at ?? row.created_at,
    };
  }

  async listReviews(
    gameId: number,
    user: PlaystashUser,
    query: FeedbackPageDto,
  ): Promise<GameReviewsViewDto> {
    await this.checkGame(gameId, user);
    const page = query.page ?? 1,
      limit = query.limit ?? 50;
    const [rows, total] = await this.reviews.findAndCount({
      where: { game_id: gameId },
      relations: { user: true },
      order: { updated_at: "DESC", id: "DESC" },
      skip: (page - 1) * limit,
      take: limit,
    });
    const aggregate = await this.reviews
      .createQueryBuilder("review")
      .select("AVG(review.rating)", "average")
      .where("review.game_id = :gameId", { gameId })
      .getRawOne<{ average: string | number | null }>();
    const own = await this.reviews.findOne({
      where: { game_id: gameId, user_id: user.id },
      relations: { user: true },
    });
    return {
      reviews: rows.map((row) => this.reviewView(row, user)),
      my_review: own ? this.reviewView(own, user) : null,
      average_rating:
        aggregate?.average == null ? null : Number(aggregate.average),
      total,
      page,
      limit,
    };
  }

  async putReview(
    gameId: number,
    user: PlaystashUser,
    input: PutGameReviewDto,
  ) {
    await this.checkGame(gameId, user);
    // An upsert preserves the one-review-per-user constraint during concurrent
    // requests, and can revive a previous review only through an explicit write.
    await this.reviews.upsert(
      {
        game_id: gameId,
        user_id: user.id,
        rating: input.rating,
        comment: input.comment?.trim() ?? "",
      },
      ["game_id", "user_id"],
    );
    const row = await this.reviews.findOneOrFail({
      where: { game_id: gameId, user_id: user.id },
    });
    row.user = user;
    return this.reviewView(row, user);
  }

  async deleteReview(gameId: number, user: PlaystashUser) {
    await this.checkGame(gameId, user);
    await this.reviews.delete({ game_id: gameId, user_id: user.id });
  }
}
