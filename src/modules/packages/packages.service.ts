import {
  HttpException,
  Injectable,
  NotFoundException,
  StreamableFile,
} from "@nestjs/common";
import { type Response } from "express";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import configuration from "../../configuration.js";
import {
  createDownloadRateProvider,
  DynamicDownloadThrottle,
} from "../games/download-bandwidth.js";
import { GamesService } from "../games/games.service.js";
import { type PlaystashUser } from "../users/playstash-user.entity.js";
import { UsersService } from "../users/users.service.js";
import {
  type PackageAsset,
  readPackageManifest,
  resolvePackagePath,
} from "./package-manifest.js";
import { type PackageAssetDto, PackageDescriptorDto } from "./package.dto.js";

@Injectable()
export class PackagesService {
  constructor(
    private readonly games: GamesService,
    private readonly users: UsersService,
  ) {}

  private async root(gameId: number, user: PlaystashUser): Promise<string> {
    const game = await this.games.findOneByGameIdOrFail(gameId, {
      loadDeletedEntities: false,
      filterByAge: await this.users.findUserAgeByUsername(user.username),
      requestingUser: user,
    });
    if (!game.file_path)
      throw new NotFoundException("The game has no available package.");
    const info = await stat(game.file_path);
    return info.isDirectory() ? game.file_path : path.dirname(game.file_path);
  }

  async describe(
    gameId: number,
    user: PlaystashUser,
  ): Promise<PackageDescriptorDto> {
    const root = await this.root(gameId, user);
    return this.describeRoot(root);
  }

  private async discover(
    root: string,
    folder: string,
    kind: "extra" | "mod",
  ): Promise<PackageAsset[]> {
    const assets: PackageAsset[] = [];
    const walk = async (relative: string) => {
      let entries;
      try {
        entries = await readdir(path.join(root, relative), {
          withFileTypes: true,
        });
      } catch (error: any) {
        if (error?.code === "ENOENT") return;
        throw error;
      }
      for (const entry of entries.sort((a, b) =>
        a.name.localeCompare(b.name),
      )) {
        if (assets.length >= 1000) return;
        const file = `${relative}/${entry.name}`;
        if (entry.isDirectory()) await walk(file);
        else if (entry.isFile() || entry.isSymbolicLink()) {
          if (
            kind === "mod" &&
            !/\.(?:zip|7z|rar|tar|gz|bz2|xz|zst)$/i.test(entry.name)
          )
            continue;
          assets.push({ path: file, kind });
        }
      }
    };
    const sidecars = (await readdir(root, { withFileTypes: true }))
      .filter(
        (entry) =>
          entry.isDirectory() &&
          entry.name.toLowerCase() === folder.toLowerCase(),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const sidecar of sidecars) await walk(sidecar.name);
    return assets;
  }

  private async describeRoot(root: string): Promise<PackageDescriptorDto> {
    const manifest = await readPackageManifest(root);
    const resolveAssets = async (
      items: PackageAsset[],
    ): Promise<PackageAssetDto[]> => {
      const result: PackageAssetDto[] = [];
      for (const item of items) {
        try {
          const filename = await resolvePackagePath(root, item.path);
          const info = await stat(filename);
          if (!info.isFile()) continue;
          result.push({
            id: Buffer.from(item.path).toString("base64url"),
            path: item.path,
            title: item.title || path.basename(item.path),
            kind: item.kind || "extra",
            size: String(info.size),
          });
        } catch (error: any) {
          if (error?.code !== "ENOENT") throw error;
        }
      }
      return result;
    };
    return {
      manifest,
      extras: await resolveAssets(
        manifest?.extras ?? (await this.discover(root, "Extras", "extra")),
      ),
      addons: await resolveAssets(
        manifest?.addons ?? (await this.discover(root, "Addons", "mod")),
      ),
    };
  }

  async download(
    gameId: number,
    assetId: string,
    user: PlaystashUser,
    response: Response,
    range?: string,
    speed?: string,
  ): Promise<StreamableFile> {
    const root = await this.root(gameId, user);
    const descriptor = await this.describeRoot(root);
    const asset = [...descriptor.extras, ...descriptor.addons].find(
      (item) => item.id === assetId,
    );
    if (!asset) throw new NotFoundException("Package asset was not found.");
    const filename = await resolvePackagePath(root, asset.path);
    const size = (await stat(filename)).size;
    let start = 0;
    let end = size - 1;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1] && !match[2]))
        throw new HttpException("Invalid byte range.", 416);
      if (!match[1]) start = Math.max(0, size - Number(match[2]));
      else {
        start = Number(match[1]);
        if (match[2]) end = Math.min(end, Number(match[2]));
      }
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start < 0 ||
        start > end ||
        start >= size
      ) {
        response.setHeader("Content-Range", `bytes */${size}`);
        throw new HttpException("Requested byte range is not available.", 416);
      }
      response.status(206);
      response.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
    }
    response.setHeader("Accept-Ranges", "bytes");
    const source = size
      ? createReadStream(filename, { start, end })
      : undefined;
    const rate = createDownloadRateProvider(
      configuration.SERVER,
      Number(speed),
    );
    const throttle = new DynamicDownloadThrottle(rate);
    source?.on("error", (error) => throttle.destroy(error));
    throttle.once("close", () => source?.destroy());
    response.once?.("close", () => throttle.destroy());
    const { default: mime } = await import("mime");
    const options = {
      type: mime.getType(filename) || "application/octet-stream",
      length: size ? end - start + 1 : 0,
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(asset.path))}`,
    };
    return source
      ? new StreamableFile(source.pipe(throttle), options)
      : new StreamableFile(Buffer.alloc(0), options);
  }
}
