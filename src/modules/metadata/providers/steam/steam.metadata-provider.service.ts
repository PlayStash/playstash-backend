import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { setTimeout } from "node:timers/promises";
import configuration from "../../../../configuration.js";
import { GameMetadata } from "../../games/game.metadata.entity.js";
import type { MinimalGameMetadataDto } from "../../games/minimal-game.metadata.dto.js";
import { MetadataProvider } from "../abstract.metadata-provider.service.js";

interface SteamApp {
  steam_appid: number;
  name: string;
  type?: string;
  required_age?: number | string;
  short_description?: string;
  detailed_description?: string;
  header_image?: string;
  background?: string;
  website?: string;
  developers?: string[];
  publishers?: string[];
  genres?: Array<{ id: string; description: string }>;
  categories?: Array<{ id: number; description: string }>;
  screenshots?: Array<{ path_full: string }>;
  movies?: Array<{ webm?: { max?: string }; mp4?: { max?: string } }>;
  metacritic?: { score?: number };
  release_date?: { coming_soon?: boolean; date?: string };
  pc_requirements?: { minimum?: string; recommended?: string };
}

/** Store HTML becomes inert text/Markdown before being sent to clients. */
export function steamHtmlToMarkdown(html?: string): string | undefined {
  if (!html) return undefined;
  return (
    html
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<li\b[^>]*>/gi, "\n- ")
      .replace(/<\/(?:p|div|ul|h[1-6])>/gi, "\n")
      .replace(/<[^>]*>/g, "")
      .replace(
        /&(?:nbsp|amp|lt|gt|quot|apos);/gi,
        (entity) =>
          ({
            "&nbsp;": " ",
            "&amp;": "&",
            "&lt;": "<",
            "&gt;": ">",
            "&quot;": '"',
            "&apos;": "'",
          })[entity.toLowerCase()] ?? entity,
      )
      .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, value: string) => {
        const code =
          value[0].toLowerCase() === "x"
            ? Number.parseInt(value.slice(1), 16)
            : Number(value);
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
      })
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replace(/\n{3,}/g, "\n\n")
      .trim() || undefined
  );
}

@Injectable()
export class SteamMetadataProviderService extends MetadataProvider {
  readonly slug = "steam";
  readonly name = "Steam";
  readonly enabled = configuration.METADATA.STEAM.ENABLED;
  readonly priority = configuration.METADATA.STEAM.PRIORITY ?? 5;
  readonly request_interval_ms =
    configuration.METADATA.STEAM.REQUEST_INTERVAL_MS ?? 1000;
  private requestQueue: Promise<unknown> = Promise.resolve();
  private lastRequestAt = 0;
  private readonly cache = new Map<
    string,
    { expires: number; data: unknown }
  >();

  public override clearCache(): void {
    this.cache.clear();
  }

  public override async search(
    query: string,
  ): Promise<MinimalGameMetadataDto[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];
    const id = this.parseAppId(trimmed);
    if (id) {
      try {
        return [this.minimal(await this.details(id))];
      } catch (error) {
        if (error instanceof NotFoundException) return [];
        throw error;
      }
    }
    const result = await this.request<{
      items?: Array<{
        type?: string;
        id: number;
        name: string;
        tiny_image?: string;
      }>;
    }>("storesearch", { term: trimmed, l: "english", cc: "US" });
    return (result.items ?? [])
      .filter((item) => item.type === "app" && Number.isSafeInteger(item.id))
      .map((item) => ({
        provider_slug: this.slug,
        provider_data_id: String(item.id),
        title: item.name,
        cover_url: item.tiny_image,
      }));
  }

  public override async getByProviderDataIdOrFail(
    provider_data_id: string,
  ): Promise<GameMetadata> {
    const id = this.parseAppId(provider_data_id);
    if (!id) throw new NotFoundException("Invalid Steam app ID.");
    const app = await this.details(id);
    const provider = { provider_slug: this.slug };
    const storeUrl = `https://store.steampowered.com/app/${id}/`;
    const releaseDate = app.release_date?.coming_soon
      ? undefined
      : new Date(app.release_date?.date ?? "");
    return {
      ...provider,
      provider_data_id: id,
      provider_data_url: storeUrl,
      title: app.name,
      description: steamHtmlToMarkdown(
        app.detailed_description ?? app.short_description,
      ),
      release_date:
        releaseDate && Number.isFinite(releaseDate.getTime())
          ? releaseDate
          : undefined,
      age_rating: Number.isFinite(Number(app.required_age))
        ? Number(app.required_age)
        : undefined,
      rating: app.metacritic?.score,
      url_websites: [storeUrl, ...(app.website ? [app.website] : [])],
      url_screenshots: app.screenshots?.map((image) => image.path_full),
      url_trailers: app.movies
        ?.map((movie) => movie.webm?.max ?? movie.mp4?.max)
        .filter((url): url is string => !!url),
      developers: app.developers?.map((name) => ({
        ...provider,
        provider_data_id: name,
        name,
      })),
      publishers: app.publishers?.map((name) => ({
        ...provider,
        provider_data_id: name,
        name,
      })),
      genres: app.genres?.map((genre) => ({
        ...provider,
        provider_data_id: genre.id,
        name: genre.description,
      })),
      tags: app.categories?.map((category) => ({
        ...provider,
        provider_data_id: String(category.id),
        name: category.description,
      })),
      system_requirements_minimum: steamHtmlToMarkdown(
        app.pc_requirements?.minimum,
      ),
      system_requirements_recommended: steamHtmlToMarkdown(
        app.pc_requirements?.recommended,
      ),
      cover: await this.downloadImage(app.header_image),
      background: await this.downloadImage(app.background),
    } as GameMetadata;
  }

  private minimal(app: SteamApp): MinimalGameMetadataDto {
    return {
      provider_slug: this.slug,
      provider_data_id: String(app.steam_appid),
      title: app.name,
      cover_url: app.header_image,
      description: steamHtmlToMarkdown(app.short_description),
    };
  }

  private parseAppId(input: string): string | undefined {
    let value = input;
    if (!/^\d+$/.test(value)) {
      try {
        const url = new URL(value);
        if (
          url.hostname !== "store.steampowered.com" ||
          url.protocol !== "https:"
        )
          return undefined;
        value = /^\/app\/(\d+)(?:\/|$)/.exec(url.pathname)?.[1] ?? "";
      } catch {
        return undefined;
      }
    }
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 && id <= 2147483647
      ? String(id)
      : undefined;
  }

  private async details(id: string): Promise<SteamApp> {
    const response = await this.request<
      Record<string, { success?: boolean; data?: SteamApp }>
    >("appdetails", { appids: id, l: "english", cc: "US" });
    const app = response[id];
    if (
      !app?.success ||
      !app.data?.name ||
      !["game", "dlc"].includes(app.data.type ?? "")
    ) {
      throw new NotFoundException(
        `Game with app ID ${id} was not found on Steam.`,
      );
    }
    return app.data;
  }

  private async request<T>(
    endpoint: string,
    parameters: Record<string, string>,
  ): Promise<T> {
    const url = `https://store.steampowered.com/api/${endpoint}/?${new URLSearchParams(parameters)}`;
    const cached = this.cache.get(url);
    if (cached && cached.expires > Date.now()) return cached.data as T;
    const request = this.requestQueue
      .catch(() => {})
      .then(async () => {
        const delay =
          this.request_interval_ms - (Date.now() - this.lastRequestAt);
        if (delay > 0) await setTimeout(delay);
        this.lastRequestAt = Date.now();
        try {
          const response = await fetch(url, {
            signal: AbortSignal.timeout(15000),
          });
          if (!response.ok)
            throw new Error(`Steam returned ${response.status}`);
          const data: T = await response.json();
          if (this.cache.size >= 200)
            this.cache.delete(this.cache.keys().next().value!);
          this.cache.set(url, { expires: Date.now() + 5 * 60 * 1000, data });
          return data;
        } catch (error) {
          throw new ServiceUnavailableException(
            "Steam metadata is temporarily unavailable.",
            { cause: error },
          );
        }
      });
    this.requestQueue = request;
    return request;
  }

  private async downloadImage(source?: string) {
    if (!source) return undefined;
    try {
      const url = new URL(source);
      if (
        url.protocol !== "https:" ||
        !(
          url.hostname.endsWith(".steamstatic.com") ||
          url.hostname === "steamcdn-a.akamaihd.net"
        )
      )
        return undefined;
      return await this.mediaService.downloadByUrl(source);
    } catch {
      this.logger.warn("Could not download Steam metadata image.");
      return undefined;
    }
  }
}
