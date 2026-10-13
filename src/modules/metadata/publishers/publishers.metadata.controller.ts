import { Controller, Get, Request } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from "@nestjs/swagger";
import { InjectRepository } from "@nestjs/typeorm";
import {
  Paginate,
  type PaginateQuery,
  type Paginated,
  PaginationType,
  paginate,
} from "nestjs-paginate";
import { Repository } from "typeorm";

import { MinimumRole } from "../../../decorators/minimum-role.decorator.js";
import { PaginateQueryOptions } from "../../../decorators/pagination.decorator.js";
import { ApiOkResponsePaginated } from "../../../globals.js";
import { applyGameAccessFilter } from "../../games/game-access.js";
import { PlaystashGame } from "../../games/playstash-game.entity.js";
import { Role } from "../../users/models/role.enum.js";
import type { PlaystashUser } from "../../users/playstash-user.entity.js";
import { PublisherMetadata } from "./publisher.metadata.entity.js";

@Controller("publishers")
@ApiTags("publishers")
@ApiBearerAuth()
@ApiSecurity("apikey")
export class PublisherController {
  constructor(
    @InjectRepository(PublisherMetadata)
    private readonly publisherRepository: Repository<PublisherMetadata>,
  ) {}

  /**
   * Get a paginated list of publishers, sorted by the number of games released by
   * each publisher (by default).
   */
  @Get()
  @ApiOperation({
    summary: "get a list of publishers",
    description:
      "by default the list is sorted by the amount of games that are published by the publisher.",
    operationId: "getPublishers",
  })
  @MinimumRole(Role.GUEST)
  @ApiOkResponsePaginated(PublisherMetadata)
  @PaginateQueryOptions()
  async getPublishers(
    @Paginate() query: PaginateQuery,
    @Request() request?: { user: PlaystashUser },
  ): Promise<Paginated<PublisherMetadata>> {
    const queryBuilder = this.publisherRepository
      .createQueryBuilder("publisher")
      .innerJoin("publisher.games", "games")
      .innerJoin(
        PlaystashGame,
        "game",
        "game.metadata_id = games.id AND game.deleted_at IS NULL",
      )
      .where("publisher.provider_slug = :provider_slug", {
        provider_slug: "playstash",
      })
      .groupBy("publisher.id");

    if (request) applyGameAccessFilter(queryBuilder, "game", request.user);

    // If no specific sort is provided, sort by the number of games in descending order
    if (query.sortBy?.length === 0) {
      queryBuilder
        .addSelect("COUNT(DISTINCT game.id)", "games_count")
        .orderBy("games_count", "DESC");
    }

    const paginatedResults = await paginate(query, queryBuilder, {
      paginationType: PaginationType.TAKE_AND_SKIP,
      defaultLimit: 100,
      maxLimit: -1,
      nullSort: "last",
      loadEagerRelations: false,
      sortableColumns: ["id", "name", "created_at", "provider_slug"],
      searchableColumns: ["name"],
      filterableColumns: {
        id: true,
        created_at: true,
        name: true,
      },
      withDeleted: false,
    });

    return paginatedResults;
  }
}
