import {
  Body,
  Controller,
  Get,
  Inject,
  Logger,
  Put,
  Request,
  forwardRef,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from "@nestjs/swagger";
import { MinimumRole } from "../../decorators/minimum-role.decorator.js";
import { GamesService } from "../games/games.service.js";
import { Role } from "../users/models/role.enum.js";
import { type PlaystashUser } from "../users/playstash-user.entity.js";
import { FolderTagRulesDto, FolderTagRulesResultDto } from "./auto-tags.dto.js";
import { AutoTagsService } from "./auto-tags.service.js";
import { MetadataService } from "./metadata.service.js";

@ApiBearerAuth()
@ApiSecurity("apikey")
@ApiTags("config")
@Controller("config/folder-tag-rules")
export class AutoTagsController {
  private readonly logger = new Logger(this.constructor.name);
  constructor(
    private readonly rules: AutoTagsService,
    private readonly metadata: MetadataService,
    @Inject(forwardRef(() => GamesService)) private readonly games: any,
  ) {}

  @Get()
  @MinimumRole(Role.ADMIN)
  @ApiOperation({
    operationId: "getFolderTagRules",
    summary: "Read persistent folder-based automatic tag rules.",
  })
  @ApiOkResponse({ type: FolderTagRulesResultDto })
  async get(): Promise<FolderTagRulesResultDto> {
    return {
      rules: await this.rules.getRules(),
      applied_games: 0,
      failed_games: 0,
    };
  }

  @Put()
  @MinimumRole(Role.ADMIN)
  @ApiOperation({
    operationId: "putFolderTagRules",
    summary: "Save automatic tag rules and refresh all existing games.",
  })
  @ApiOkResponse({ type: FolderTagRulesResultDto })
  async put(
    @Body() dto: FolderTagRulesDto,
    @Request() req: { user: PlaystashUser },
  ): Promise<FolderTagRulesResultDto> {
    const rules = await this.rules.setRules(dto);
    const games = await this.games.find({
      select: ["id"],
      requestingUser: req.user,
      loadRelations: false,
    });
    let applied_games = 0,
      failed_games = 0;
    for (const game of games) {
      try {
        await this.metadata.merge(game.id, true);
        applied_games++;
      } catch {
        failed_games++;
        this.logger.warn(`Could not refresh folder tags for game ${game.id}.`);
      }
    }
    return { rules, applied_games, failed_games };
  }
}
