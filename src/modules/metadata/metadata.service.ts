import {
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { validateOrReject } from "class-validator";
import lodash from "lodash";
import { setTimeout } from "node:timers/promises";
import type { AppConfiguration } from "../../configuration.js";
import { InjectPlaystashConfig } from "../../decorators/inject-playstash-config.decorator.js";
import globals from "../../globals.js";
import { logMetadataProvider, logPlaystashGame } from "../../logging.js";
import { GamesService } from "../games/games.service.js";
import { GameType } from "../games/models/game-type.enum.js";
import { PlaystashGame } from "../games/playstash-game.entity.js";
import { AutoTagsService } from "./auto-tags.service.js";
import { GameMetadata } from "./games/game.metadata.entity.js";
import { GameMetadataService } from "./games/game.metadata.service.js";
import { type MinimalGameMetadataDto } from "./games/minimal-game.metadata.dto.js";
import { type MetadataProvider } from "./providers/abstract.metadata-provider.service.js";
import { ProviderNotFoundException } from "./providers/models/provider-not-found.exception.js";

const { kebabCase } = lodash;

@Injectable()
export class MetadataService {
  private readonly logger = new Logger(this.constructor.name);
  private readonly metadataJobs = new Map<number, PlaystashGame>();
  private isProcessingQueue = false;
  private processingGameId?: number;
  private readonly forcedMetadataJobs = new Set<number>();
  private recacheActive = false;
  private recacheLoading = false;
  providers: MetadataProvider[] = [];

  constructor(
    @Inject(forwardRef(() => GamesService))
    // Cyclic service reference (ESM): intentionally loosely typed to avoid design:paramtypes TDZ
    private readonly gamesService: any,
    private readonly gameMetadataService: GameMetadataService,
    @InjectPlaystashConfig() private readonly config: AppConfiguration,
    @Optional() private readonly autoTags?: AutoTagsService,
  ) {}

  /**
   * Registers a metadata provider.
   * If a provider with the same slug or priority already exists, throws a ConflictException.
   * Validates the provider using class-validator and throws an InternalServerErrorException if validation fails.
   * Sorts the providers by priority in ascending order.
   */
  registerProvider(provider: MetadataProvider) {
    // Check if a provider with the same slug or priority already exists
    const existingProvider = this.providers?.find(
      (existingProvider) =>
        existingProvider.slug === provider.slug ||
        existingProvider.priority === provider.priority,
    );

    if (existingProvider) {
      const errorMessage =
        `There is already a provider (${existingProvider.slug}) with the ` +
        (provider.slug === existingProvider.slug
          ? `same slug (${provider.slug})`
          : `same priority (${provider.priority})`);
      throw new ConflictException(errorMessage);
    }

    // Validate the provider using class-validator
    validateOrReject(provider).catch((error_) => {
      this.logger.error({
        message: `Failed to register metadata provider due to validation errors.`,
        provider: logMetadataProvider(provider),
      });
      console.error(error_);
    });

    // Add the provider to the list of providers
    this.providers.push(provider);

    // Sort the providers by priority in descending order
    this.providers.sort((a, b) => b.priority - a.priority);

    // Log the registration of the metadata provider
    this.logger.log({
      message: `Registered metadata provider.`,
      provider: logMetadataProvider(provider),
    });
  }

  /**
   * Retrieves a metadata provider by its slug.
   * If no provider is found, it throws a NotFoundException.
   */
  getProviderBySlugOrFail(slug: string): MetadataProvider {
    if (!slug) {
      throw new NotFoundException(`No slug provided.`);
    }

    // Find the provider with the given slug.
    const provider = this.providers.find((provider) => provider.slug === slug);

    // If no provider is found, throw a NotFoundException.
    if (!provider) {
      throw new ProviderNotFoundException(
        `There is no registered provider with slug "${slug}".`,
      );
    }

    // Return the found provider.
    return provider;
  }

  /**
   * Checks the metadata of games and updates them if necessary.
   */
  async addUpdateMetadataJob(game: PlaystashGame): Promise<void> {
    if (this.metadataJobs.has(game.id) || this.processingGameId === game.id) {
      this.logger.debug({
        message: "Skipping metadata job as it is already enqueued.",
        game: logPlaystashGame(game),
      });
      return;
    }

    this.metadataJobs.set(game.id, game);
    this.processQueue();
  }

  /** One guarded background batch, preserving provider mappings and user overrides. */
  async recacheAll(): Promise<{ queued_games: number; processing: boolean }> {
    if (this.recacheActive)
      throw new ConflictException("A metadata recache is already running.");
    this.recacheActive = true;
    this.recacheLoading = true;
    try {
      const games: PlaystashGame[] = await this.gamesService.find({
        loadDeletedEntities: false,
        loadRelations: ["versions", "provider_metadata", "user_metadata"],
      });
      for (const provider of this.providers.filter(
        (provider) => provider.enabled,
      ))
        provider.clearCache?.();
      let queued = 0;
      for (const game of games) {
        const paths =
          game.versions?.map((version) => version.file_path).filter(Boolean) ??
          [];
        if (
          (paths.length ? paths : [game.file_path]).some((path) =>
            path?.includes("(NC)"),
          )
        )
          continue;
        this.metadataJobs.set(game.id, game);
        this.forcedMetadataJobs.add(game.id);
        queued++;
      }
      this.recacheLoading = false;
      if (!queued) this.recacheActive = false;
      else void this.processQueue();
      return { queued_games: queued, processing: queued > 0 };
    } catch (error) {
      this.recacheLoading = false;
      this.recacheActive = false;
      throw error;
    }
  }

  /**
   * Processes the queue sequentially
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessingQueue) return;
    this.isProcessingQueue = true;

    while (this.metadataJobs.size > 0) {
      const nextJob = this.metadataJobs.entries().next().value;
      if (!nextJob) {
        continue;
      }
      const [gameId, game] = nextJob;
      this.metadataJobs.delete(gameId);
      this.processingGameId = gameId;
      const force = this.forcedMetadataJobs.delete(gameId);
      try {
        const currentGame = force
          ? await this.gamesService.findOneByGameIdOrFail(gameId, {
              loadDeletedEntities: false,
              loadRelations: ["versions", "provider_metadata", "user_metadata"],
            })
          : game;
        await this.updateMetadata(currentGame, force);
      } catch (error) {
        this.logger.warn({
          message: "Error updating metadata for game.",
          game: logPlaystashGame(game),
          error,
        });
      } finally {
        this.processingGameId = undefined;
      }
    }

    this.isProcessingQueue = false;
    if (!this.recacheLoading && !this.forcedMetadataJobs.size)
      this.recacheActive = false;
  }

  /**
   * Updates the metadata of a game if necessary.
   * If the game's file path contains "(NC)", the metadata update is skipped.
   * If the game's metadata is already up to date (i.e. the TTL has not been exceeded),
   * the metadata update is skipped.
   * If the metadata update fails for a provider, the error is logged and the update is skipped.
   * @param game The game to update the metadata for.
   * @returns The updated game.
   */
  private async updateMetadata(
    game: PlaystashGame | undefined,
    force = false,
  ): Promise<void> {
    if (!game) {
      this.logger.error({
        message: "Corresponding metadata-job was not found",
        game: undefined,
      });
      throw new NotFoundException("Corresponding metadata-job was not found");
    }

    this.logger.log({
      message: "Updating metadata.",
      game: logPlaystashGame(game),
    });

    const versionPaths = (game.versions || [])
      .map((version) => version.file_path)
      .filter((path): path is string => !!path);
    const candidatePaths =
      versionPaths.length > 0
        ? versionPaths
        : [game.file_path].filter((path): path is string => !!path);
    if (candidatePaths.some((path) => path.includes("(NC)"))) {
      this.logger.debug({
        message: "Skipping metadata update for (NC) game.",
        game: logPlaystashGame(game),
      });
      return;
    }

    for (const provider of this.providers.filter(
      (provider) => provider.enabled,
    )) {
      try {
        // Find the existing provider metadata for the game and provider.
        const existingProviderMetadata = game.provider_metadata?.find(
          (metadata) => metadata.provider_slug === provider.slug,
        );

        // If the existing provider metadata is already up to date, skip the update.
        if (
          !force &&
          existingProviderMetadata &&
          (existingProviderMetadata.updated_at ??
            existingProviderMetadata.created_at) >
            new Date(
              Date.now() -
                (this.config.METADATA.TTL_IN_DAYS ?? 30) * 24 * 60 * 60 * 1000,
            )
        ) {
          this.logger.debug({
            message: "Metadata is already up to date. Skipping.",
            game: logPlaystashGame(game),
            provider: logMetadataProvider(provider),
          });
          continue;
        }

        if (provider.request_interval_ms) {
          // Waiting the specified request interval to prevent hitting rate limits before making requests to the provider
          this.logger.debug({
            message: `Delaying requests by ${provider.request_interval_ms} ms to avoid rate limits.`,
            game: logPlaystashGame(game),
            provider: logMetadataProvider(provider),
          });
          await setTimeout(provider.request_interval_ms);
        }

        // If the existing provider metadata is not up to date, update it.
        if (existingProviderMetadata) {
          const mapping = [
            game.id,
            provider.slug,
            existingProviderMetadata.provider_data_id ?? "",
          ] as const;
          if (existingProviderMetadata.provider_priority != null)
            await this.map(
              ...mapping,
              existingProviderMetadata.provider_priority,
            );
          else await this.map(...mapping);
        } else {
          // If the existing provider metadata is not found, find the metadata.
          await this.findMetadata(game, provider);
        }
      } catch (error) {
        // If the metadata update fails, log the error and skip the update.
        this.logger.error({
          message: "Failed updating metadata for game and provider. Skipping.",
          game: logPlaystashGame(game),
          provider: logMetadataProvider(provider),
          error,
        });
      }
    }
    await this.merge(game.id);
  }

  /**
   * Checks the metadata of a single provider and updates it if necessary.
   */
  private async findMetadata(
    game: PlaystashGame,
    provider: MetadataProvider,
  ): Promise<void> {
    this.logger.log({
      message: "Searching for metadata.",
      game: logPlaystashGame(game),
      provider: logMetadataProvider(provider),
    });
    try {
      const bestMatchingGame = await provider.getBestMatch(game);
      await this.map(
        game.id,
        provider.slug,
        bestMatchingGame.provider_data_id ?? "",
      );
    } catch (error) {
      if (error instanceof NotFoundException) {
        this.logger.debug({
          message: "No matching game found.",
          game: logPlaystashGame(game),
          provider: logMetadataProvider(provider),
        });
        return;
      }
      throw error;
    }
  }

  /**
   * Searches for metadata of a game using a specific provider.
   */
  async search(
    query: string,
    providerSlug: string,
  ): Promise<MinimalGameMetadataDto[]> {
    const provider = this.getProviderBySlugOrFail(providerSlug);
    try {
      const results = provider.search(query);
      this.logger.debug({
        message: "Searched for metadata.",
        provider: logMetadataProvider(provider),
        query,
        results,
      });
      return results;
    } catch (error) {
      this.logger.error({
        message: "Error searching provider.",
        provider: logMetadataProvider(provider),
        query,
        error,
      });
      throw new InternalServerErrorException(
        error,
        "Error searching provider. Please check the server logs for details.",
      );
    }
  }

  /**
   * Merges provider and user metadata into a single effective metadata for a game.
   *
   * The merge follows this priority order (lowest to highest):
   * 1. Game file defaults (release_date, installer_parameters for WINDOWS_SETUP)
   * 2. Provider metadata (sorted by priority, lower priority applied first)
   * 3. File-derived metadata (early_access flag)
   * 4. User metadata (highest priority, user overrides everything)
   *
   * Safeguards:
   * - Skips merge if no source metadata exists (no providers and no user metadata)
   * - For provider-only updates, skips if no provider is newer than current merged metadata
   * - Always merges when user_metadata exists (user explicitly requested changes)
   */
  async merge(gameId: number, force = false): Promise<PlaystashGame> {
    const game = await this.gamesService.findOneByGameIdOrFail(gameId, {
      loadDeletedEntities: false,
      loadRelations: ["metadata", "provider_metadata", "user_metadata"],
    });
    const { mergeableProviderMetadata, removedInvalidProviderMetadata } =
      this.getMergeableProviderMetadata(game);
    const hasFolderRules = (await this.autoTags?.getRules())?.length;

    // SAFEGUARD: Nothing to merge
    if (
      !force &&
      !hasFolderRules &&
      !mergeableProviderMetadata.length &&
      !game.user_metadata
    ) {
      if (removedInvalidProviderMetadata) {
        return this.gamesService.save(game);
      }

      this.logger.warn({
        message: "No metadata sources available. Skipping merge.",
        game: logPlaystashGame(game),
      });
      return game;
    }

    // SAFEGUARD: Skip merge for provider-only updates if nothing changed
    // Note: Always merge when user_metadata exists since user explicitly requested changes
    if (
      !force &&
      !hasFolderRules &&
      !game.user_metadata &&
      this.isMetadataFresh(game, mergeableProviderMetadata)
    ) {
      if (removedInvalidProviderMetadata) {
        return this.gamesService.save(game);
      }

      this.logger.debug({
        message: "Provider metadata unchanged. Skipping merge.",
        game: logPlaystashGame(game),
      });
      return game;
    }

    // Build merged metadata from all sources
    let mergedMetadata = this.buildBaseMetadata(game);
    mergedMetadata = this.applyProviderMetadata(
      mergedMetadata,
      mergeableProviderMetadata,
    );
    mergedMetadata = this.applyFileMetadata(mergedMetadata, game);
    mergedMetadata = this.applyUserMetadata(mergedMetadata, game);
    if (this.autoTags)
      mergedMetadata = await this.autoTags.decorate(game, mergedMetadata);
    mergedMetadata = this.finalizeMetadata(mergedMetadata, game, gameId);

    // Persist and return
    game.metadata = await this.gameMetadataService.save(mergedMetadata);
    const mergedGame = await this.gamesService.save(game);

    this.logger.debug({
      message: "Metadata merged successfully.",
      game: logPlaystashGame(mergedGame),
    });

    return mergedGame;
  }

  async applyFolderTags(gameId: number): Promise<void> {
    if ((await this.autoTags?.getRules())?.length)
      await this.merge(gameId, true);
  }

  /**
   * Checks if merged metadata is still fresh (no provider has newer data).
   */
  private isMetadataFresh(
    game: PlaystashGame,
    providerMetadata: GameMetadata[],
  ): boolean {
    const effectiveTs =
      game.metadata?.updated_at ?? game.metadata?.created_at ?? null;
    if (!effectiveTs) return false;

    return !providerMetadata.some((provider) => {
      const providerTs = provider.updated_at ?? provider.created_at ?? null;
      return providerTs != null && providerTs > effectiveTs;
    });
  }

  /**
   * Creates base metadata with game file defaults.
   */
  private buildBaseMetadata(game: PlaystashGame): GameMetadata {
    const metadata = new GameMetadata();
    metadata.release_date = game.release_date;

    if (game.type === GameType.WINDOWS_SETUP) {
      metadata.installer_parameters =
        this.config.GAMES.WINDOWS_SETUP_DEFAULT_INSTALL_PARAMETERS;
    }

    return metadata;
  }

  /**
   * Applies provider metadata in priority order (lowest first).
   */
  private applyProviderMetadata(
    base: GameMetadata,
    providerMetadata: GameMetadata[],
  ): GameMetadata {
    const sortedProviders = providerMetadata.toSorted((a, b) => {
      const priorityA =
        a.provider_priority ??
        this.getProviderBySlugOrFail(a.provider_slug ?? "").priority;
      const priorityB =
        b.provider_priority ??
        this.getProviderBySlugOrFail(b.provider_slug ?? "").priority;
      return priorityA - priorityB;
    });

    let result = base;
    for (const provider of sortedProviders) {
      result = {
        ...result,
        ...this.stripEmptyFields(provider),
      } as GameMetadata;
    }

    return result;
  }

  /**
   * Removes corrupt internal provider mappings and skips unregistered providers during merge.
   */
  private getMergeableProviderMetadata(game: PlaystashGame): {
    mergeableProviderMetadata: GameMetadata[];
    removedInvalidProviderMetadata: boolean;
  } {
    const registeredProviderSlugs = new Set(
      this.providers.map((provider) => provider.slug),
    );
    const mergeableProviderMetadata: GameMetadata[] = [];
    const cleanedProviderMetadata: GameMetadata[] = [];
    let removedInvalidProviderMetadata = false;

    for (const providerMetadata of game.provider_metadata ?? []) {
      const providerSlug = providerMetadata.provider_slug;

      if (
        !providerSlug ||
        globals.RESERVED_PROVIDER_SLUGS.includes(providerSlug)
      ) {
        removedInvalidProviderMetadata = true;
        this.logger.warn({
          message:
            "Removing invalid provider metadata mapping with reserved or missing slug.",
          game: logPlaystashGame(game),
          providerSlug: providerSlug ?? null,
        });
        continue;
      }

      cleanedProviderMetadata.push(providerMetadata);

      if (!registeredProviderSlugs.has(providerSlug)) {
        this.logger.warn({
          message:
            "Skipping provider metadata from an unregistered provider during merge.",
          game: logPlaystashGame(game),
          providerSlug,
        });
        continue;
      }

      mergeableProviderMetadata.push(providerMetadata);
    }

    if (removedInvalidProviderMetadata) {
      game.provider_metadata = cleanedProviderMetadata;
    }

    return {
      mergeableProviderMetadata,
      removedInvalidProviderMetadata,
    };
  }

  /**
   * Applies file-derived metadata (early access flag).
   */
  private applyFileMetadata(
    base: GameMetadata,
    game: PlaystashGame,
  ): GameMetadata {
    return {
      ...base,
      early_access: game.early_access,
    } as GameMetadata;
  }

  /**
   * Applies user metadata (highest priority).
   */
  private applyUserMetadata(
    base: GameMetadata,
    game: PlaystashGame,
  ): GameMetadata {
    if (!game.user_metadata) return base;

    const userMetadata = structuredClone(game.user_metadata) as GameMetadata;
    const overrides = this.stripEmptyFields(userMetadata);
    // Empty launch profiles deliberately disable any provider defaults.
    if (userMetadata.launch_profiles != null) {
      overrides.launch_profiles = userMetadata.launch_profiles;
    }

    return {
      ...base,
      ...overrides,
    } as GameMetadata;
  }

  /**
   * Finalizes metadata with playstash identifiers and normalizes relations.
   */
  private finalizeMetadata(
    base: GameMetadata,
    game: PlaystashGame,
    gameId: number,
  ): GameMetadata {
    const result = {
      ...base,
      id: game.metadata?.id ?? undefined,
      provider_slug: "playstash",
      provider_data_id: gameId.toString(),
      provider_priority: null,
    } as unknown as GameMetadata;

    // Normalize relation entities to use playstash as provider
    this.normalizeRelations(result.genres, "playstash");
    this.normalizeRelations(result.tags, "playstash");
    this.normalizeRelations(result.developers, "playstash");
    this.normalizeRelations(result.publishers, "playstash");

    return result;
  }

  /**
   * Removes null/undefined values and empty arrays from metadata.
   */
  private stripEmptyFields(obj: GameMetadata): Partial<GameMetadata> {
    const result = { ...obj } as Record<string, unknown>;
    for (const key of Object.keys(result)) {
      const value = result[key];
      if (value == null || (Array.isArray(value) && value.length === 0)) {
        delete result[key];
      }
    }
    return result as Partial<GameMetadata>;
  }

  /**
   * Normalizes relation entities (genres, tags, etc.) to use consistent provider info.
   */
  private normalizeRelations(
    items:
      | Array<{
          id?: number;
          provider_slug?: string;
          provider_data_id?: string;
          name?: string;
        }>
      | undefined,
    providerSlug: string,
  ): void {
    if (!items?.length) return;

    for (const item of items) {
      item.id = undefined;
      item.provider_slug = providerSlug;
      item.provider_data_id = kebabCase(item.name);
    }
  }

  /**
   * Removes metadata from the game. Does not remove user provided metadata.
   */
  async unmap(gameId: number, providerSlug: string) {
    // Find the game by gameId.
    const game = await this.gamesService.findOneByGameIdOrFail(gameId, {
      loadDeletedEntities: false,
    });

    // Clear the effective metadata.
    game.provider_metadata = (game.provider_metadata ?? []).filter(
      (metadata: GameMetadata) => metadata.provider_slug !== providerSlug,
    );
    this.logger.log({
      message: "Unmapped metadata provider from a game.",
      game: logPlaystashGame(game),
      providerSlug,
    });

    if (game.metadata) {
      // Clear the merged metadata.
      await this.gameMetadataService.deleteByGameMetadataIdOrFail(
        game.metadata.id,
      );
      game.metadata = null;
      this.logger.debug({
        message: "Deleted merged metadata for a game.",
        game: logPlaystashGame(game),
        providerSlug,
      });
    }

    // Clear the user metadata if necessary.
    if (providerSlug === "user" && game.user_metadata?.id) {
      await this.gameMetadataService.deleteByGameMetadataIdOrFail(
        game.user_metadata.id,
      );
      game.user_metadata = null;
      game.sort_title = this.gamesService.generateSortTitle(game.title);
      this.logger.log({
        message: "Deleted user metadata from a game.",
        game: logPlaystashGame(game),
        providerSlug,
      });
    }

    return this.gamesService.save(game);
  }

  /**
   * Maps a game to a metadata provider by fetching and saving the metadata.
   *
   * @param gameId - The ID of the game to map metadata to
   * @param providerSlug - The slug of the metadata provider (e.g., 'igdb', 'rawg')
   * @param providerGameId - The unique identifier of the game in the provider's system
   * @param providerPriorityOverride - Optional priority override for the metadata provider
   */
  async map(
    gameId: number,
    providerSlug: string,
    providerGameId: string,
    providerPriorityOverride?: number,
  ): Promise<PlaystashGame> {
    const provider = this.getProviderBySlugOrFail(providerSlug);

    try {
      // Fetch metadata from provider
      const fetchedMetadata =
        await provider.getByProviderDataIdOrFail(providerGameId);

      // Apply priority override if provided
      if (providerPriorityOverride != null) {
        fetchedMetadata.provider_priority = providerPriorityOverride;
      }

      // Save the metadata
      const gameMetadata = await this.gameMetadataService.save(fetchedMetadata);

      // Unmap the game from older metadata
      await this.unmap(gameId, providerSlug);

      // Get the game and update its metadata
      const game = await this.gamesService.findOneByGameIdOrFail(gameId, {
        loadDeletedEntities: false,
        loadRelations: ["provider_metadata"],
      });

      // Only add the metadata if it's not already associated with the game
      if (
        !(game.provider_metadata ?? []).some(
          (m: GameMetadata) => m.id === gameMetadata.id,
        )
      ) {
        this.logger.debug({
          message: "Adding new metadata provider mapping to game",
          game: logPlaystashGame(game),
          provider_metadata: game.provider_metadata,
          new_provider_metadata: gameMetadata,
        });
        game.provider_metadata.push(gameMetadata);
        await this.gamesService.save(game);
      }

      // Log successful mapping
      this.logger.log({
        message: "Successfully mapped metadata provider to game",
        game: logPlaystashGame(game),
        providerSlug,
      });

      return game;
    } catch (error) {
      // Log the error with detailed context
      this.logger.error({
        message: "Failed to map game to metadata provider",
        provider: logMetadataProvider(provider),
        game: logPlaystashGame({ id: gameId } as PlaystashGame),
        error,
      });

      // Re-throw with appropriate error message
      throw new InternalServerErrorException(
        error,
        "Failed to map game to metadata provider. Please check the server logs for details.",
      );
    }
  }
}
