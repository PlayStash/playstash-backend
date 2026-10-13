import { BadRequestException, Injectable } from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { type AppConfiguration } from "../../configuration.js";
import { InjectPlaystashConfig } from "../../decorators/inject-playstash-config.decorator.js";
import { type PlaystashGame } from "../games/playstash-game.entity.js";
import { FolderTagRulesDto, type FolderTagRuleDto } from "./auto-tags.dto.js";
import { type GameMetadata } from "./games/game.metadata.entity.js";
import { type TagMetadata } from "./tags/tag.metadata.entity.js";

export function normalizeFolderTagRules(
  rules: FolderTagRuleDto[],
): FolderTagRuleDto[] {
  return rules.map((rule) => {
    const prefix = rule.folder_prefix.trim().replaceAll("\\", "/");
    const segments = prefix.split("/");
    if (
      !prefix ||
      prefix.startsWith("/") ||
      /[:\0\r\n]/.test(prefix) ||
      segments.some((part) => !part || part === "." || part === "..")
    )
      throw new BadRequestException(
        "A folder prefix must be a relative folder without traversal.",
      );
    const tags = [
      ...new Map(
        rule.tags.map((name) => [name.trim().toLowerCase(), name.trim()]),
      ).values(),
    ];
    if (tags.some((name) => !name))
      throw new BadRequestException("Tags cannot be empty.");
    return { folder_prefix: prefix, tags, enabled: rule.enabled ?? true };
  });
}

export function tagsForGameFolder(
  game: PlaystashGame,
  libraryRoot: string,
  rules: FolderTagRuleDto[],
): string[] {
  const paths = [
    game.file_path,
    ...(game.versions ?? []).map((version) => version.file_path),
  ].filter((filename): filename is string => !!filename);
  const folders = paths.flatMap((filename) => {
    const relative = path.relative(libraryRoot, filename).replaceAll("\\", "/");
    if (
      relative.startsWith("../") ||
      relative === ".." ||
      path.isAbsolute(relative)
    )
      return [];
    // A version can itself be an unpacked folder, so include its whole relative
    // path as well as its parent. Prefix boundaries prevent Arcade matching Arcade2.
    return [relative.toLowerCase(), path.posix.dirname(relative).toLowerCase()];
  });
  const names = rules
    .filter(
      (rule) =>
        rule.enabled !== false &&
        folders.some((folder) => {
          const prefix = rule.folder_prefix.toLowerCase();
          return folder === prefix || folder.startsWith(`${prefix}/`);
        }),
    )
    .flatMap((rule) => rule.tags);
  return [...new Map(names.map((name) => [name.toLowerCase(), name])).values()];
}

@Injectable()
export class AutoTagsService {
  private cached?: Promise<FolderTagRuleDto[]>;
  private writeQueue: Promise<unknown> = Promise.resolve();
  constructor(
    @InjectPlaystashConfig() private readonly config: AppConfiguration,
  ) {}

  private get filename() {
    return path.join(this.config.VOLUMES.CONFIG, "folder-tag-rules.json");
  }

  getRules(): Promise<FolderTagRuleDto[]> {
    if (!this.cached)
      this.cached = this.loadRules().catch((error) => {
        this.cached = undefined;
        throw error;
      });
    return this.cached;
  }

  private async loadRules(): Promise<FolderTagRuleDto[]> {
    try {
      if ((await stat(this.filename)).size > 256 * 1024)
        throw new BadRequestException("Folder tag rules exceed 256 KiB.");
      const parsed = plainToInstance(
        FolderTagRulesDto,
        JSON.parse(await readFile(this.filename, "utf8")),
      );
      if ((await validate(parsed)).length)
        throw new BadRequestException("Invalid folder tag rules.");
      return normalizeFolderTagRules(parsed.rules);
    } catch (error: any) {
      if (error?.code === "ENOENT") return [];
      throw error;
    }
  }

  async setRules(input: FolderTagRulesDto): Promise<FolderTagRuleDto[]> {
    const rules = normalizeFolderTagRules(input.rules);
    const operation = this.writeQueue.then(async () => {
      const temporary = `${this.filename}.part-${randomUUID()}`;
      await mkdir(path.dirname(this.filename), { recursive: true });
      try {
        await writeFile(temporary, JSON.stringify({ rules }, null, 2) + "\n", {
          flag: "wx",
        });
        await rename(temporary, this.filename);
        this.cached = Promise.resolve(rules);
      } finally {
        await rm(temporary, { force: true });
      }
    });
    this.writeQueue = operation.catch(() => undefined);
    await operation;
    return rules;
  }

  async decorate(
    game: PlaystashGame,
    metadata: GameMetadata,
  ): Promise<GameMetadata> {
    const names = tagsForGameFolder(
      game,
      this.config.VOLUMES.FILES,
      await this.getRules(),
    );
    const existing = new Set(
      (metadata.tags ?? []).map((tag) => tag.name?.toLowerCase()),
    );
    return {
      ...metadata,
      tags: [
        ...(metadata.tags ?? []),
        ...names
          .filter((name) => !existing.has(name.toLowerCase()))
          .map((name) => ({ name }) as TagMetadata),
      ],
    } as GameMetadata;
  }
}
