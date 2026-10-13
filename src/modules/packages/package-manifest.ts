import { BadRequestException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { lstat, readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { GameType } from "../games/models/game-type.enum.js";

export const PACKAGE_MANIFEST = "playstash-package.json";
export const SIDECAR_DIRECTORIES = new Set(["extras", "addons"]);
export interface PackageAsset {
  path: string;
  title?: string;
  kind?: "extra" | "manual" | "soundtrack" | "mod" | "dlc" | "patch";
}
export interface PackageManifest {
  schema_version: 1;
  title?: string;
  version?: string;
  type?: GameType;
  source?: string;
  install?: { executable: string; parameters?: string };
  launch_profiles?: { name: string; executable: string; parameters?: string }[];
  extras?: PackageAsset[];
  addons?: PackageAsset[];
}
export interface DirectorySnapshot {
  size: bigint;
  fingerprint: string;
}
export interface DirectoryGame {
  path: string;
  size: bigint;
  manifest?: PackageManifest;
  type?: GameType;
}

export function validateRelativePackagePath(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 1024 ||
    /[:\0\r\n]/.test(value) ||
    /^[\\/]/.test(value)
  ) {
    throw new BadRequestException(
      "Package paths must be relative paths inside the game folder.",
    );
  }
  const normalized = value.replace(/\\/g, "/");
  if (normalized.split("/").some((part) => part === ".." || !part)) {
    throw new BadRequestException(
      "Package paths cannot escape the game folder.",
    );
  }
  return normalized;
}

function text(value: unknown, name: string, max = 8192): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > max || value.includes("\0"))
    throw new BadRequestException(`Invalid package ${name}.`);
  return value;
}

export function parsePackageManifest(value: unknown): PackageManifest {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (value as any).schema_version !== 1
  ) {
    throw new BadRequestException(
      "Package manifest must use schema_version 1.",
    );
  }
  const source = value as Record<string, any>;
  const recipe = (item: any) => {
    if (!item || typeof item !== "object" || Array.isArray(item))
      throw new BadRequestException("Invalid package launch/install recipe.");
    return {
      executable: validateRelativePackagePath(item.executable),
      ...(item.parameters !== undefined && {
        parameters: text(item.parameters, "parameters"),
      }),
    };
  };
  const assets = (items: any, addons: boolean): PackageAsset[] | undefined => {
    if (items === undefined) return undefined;
    if (!Array.isArray(items) || items.length > 1000)
      throw new BadRequestException(
        "Package asset lists must contain at most 1000 entries.",
      );
    return items.map((item) => {
      if (!item || typeof item !== "object")
        throw new BadRequestException("Invalid package asset.");
      const kind = item.kind ?? (addons ? "mod" : "extra");
      if (
        !(
          addons ? ["mod", "dlc", "patch"] : ["extra", "manual", "soundtrack"]
        ).includes(kind)
      )
        throw new BadRequestException("Invalid package asset kind.");
      if (
        addons &&
        (typeof item.path !== "string" ||
          !/\.(?:zip|7z|rar|tar|gz|bz2|xz|zst)$/i.test(item.path))
      )
        throw new BadRequestException(
          "Package addons must be supported archives.",
        );
      return {
        path: validateRelativePackagePath(item.path),
        title: text(item.title, "asset title", 256),
        kind,
      };
    });
  };
  if (
    source.type !== undefined &&
    !Object.values(GameType).includes(source.type)
  )
    throw new BadRequestException("Unknown package game type.");
  if (
    source.launch_profiles !== undefined &&
    (!Array.isArray(source.launch_profiles) ||
      source.launch_profiles.length > 20)
  )
    throw new BadRequestException(
      "A package can define at most 20 launch profiles.",
    );
  return {
    schema_version: 1,
    title: text(source.title, "title", 256),
    version: text(source.version, "version", 120),
    type: source.type,
    ...(source.source !== undefined && {
      source: validateRelativePackagePath(source.source),
    }),
    ...(source.install !== undefined && { install: recipe(source.install) }),
    ...(source.launch_profiles !== undefined && {
      launch_profiles: source.launch_profiles.map((item: any) => ({
        name: text(item.name, "profile name", 120) || "Launch",
        ...recipe(item),
      })),
    }),
    extras: assets(source.extras, false),
    addons: assets(source.addons, true),
  };
}

export async function resolvePackagePath(
  root: string,
  relative: string,
): Promise<string> {
  const safe = validateRelativePackagePath(relative);
  const resolvedRoot = await realpath(root);
  const resolved = await realpath(path.resolve(root, safe));
  const remainder = path.relative(resolvedRoot, resolved);
  if (
    !remainder ||
    remainder === ".." ||
    remainder.startsWith(`..${path.sep}`) ||
    path.isAbsolute(remainder)
  ) {
    throw new BadRequestException("Package file is outside the game folder.");
  }
  return resolved;
}

export async function readPackageManifest(
  root: string,
): Promise<PackageManifest | undefined> {
  let filename: string;
  try {
    filename = await resolvePackagePath(root, PACKAGE_MANIFEST);
  } catch (error: any) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
  if ((await stat(filename)).size > 1024 * 1024)
    throw new BadRequestException("Package manifest exceeds 1 MiB.");
  try {
    return parsePackageManifest(JSON.parse(await readFile(filename, "utf8")));
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    throw new BadRequestException("Package manifest is not valid JSON.");
  }
}

/** Fingerprints every primary payload file; sidecars are downloaded separately. */
export async function snapshotGameDirectory(
  root: string,
): Promise<DirectorySnapshot> {
  const hash = createHash("sha256");
  let size = 0n;
  const walk = async (directory: string) => {
    const entries = (await readdir(directory, { withFileTypes: true })).sort(
      (a, b) => a.name.localeCompare(b.name),
    );
    for (const entry of entries) {
      if (
        directory === root &&
        SIDECAR_DIRECTORIES.has(entry.name.toLowerCase())
      )
        continue;
      const filename = path.join(directory, entry.name);
      const info = await lstat(filename);
      if (info.isSymbolicLink())
        throw new BadRequestException(
          "Unarchived game folders cannot contain symbolic links; archive the game explicitly instead.",
        );
      if (info.isDirectory()) {
        hash.update(
          JSON.stringify(["directory", path.relative(root, filename)]),
        );
        await walk(filename);
      } else if (info.isFile()) {
        size += BigInt(info.size);
        hash.update(
          JSON.stringify([
            path.relative(root, filename),
            info.size,
            info.mtimeMs,
            info.ctimeMs,
          ]),
        );
      }
    }
  };
  await walk(root);
  return { size, fingerprint: hash.digest("hex") };
}

/** Groups installer folders or explicit manifest folders into one coherent game. */
export async function scanDirectoryGames(
  root: string,
  recursive: boolean,
  includeDirectory: (name: string) => boolean,
  onError: (directory: string, error: unknown) => void = () => {},
): Promise<DirectoryGame[]> {
  const games: DirectoryGame[] = [];
  const walk = async (directory: string) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (
        !entry.isDirectory() ||
        SIDECAR_DIRECTORIES.has(entry.name.toLowerCase()) ||
        !includeDirectory(entry.name)
      )
        continue;
      const filename = path.join(directory, entry.name);
      try {
        const manifest = await readPackageManifest(filename);
        const children = await readdir(filename, { withFileTypes: true });
        const installer = children.some(
          (child) =>
            child.isFile() &&
            /^(?:setup|install)(?:[._ -].*)?\.(?:exe|sh)$/i.test(child.name),
        );
        if ((manifest && !manifest.source) || (!manifest && installer)) {
          const snapshot = await snapshotGameDirectory(filename);
          if (snapshot.size)
            games.push({
              path: filename,
              size: snapshot.size,
              manifest,
              type: children.some((child) =>
                /^(?:setup|install)(?:[._ -].*)?\.exe$/i.test(child.name),
              )
                ? GameType.WINDOWS_SETUP
                : children.some((child) =>
                      /\.(?:sh|appimage)$/i.test(child.name),
                    )
                  ? GameType.LINUX_PORTABLE
                  : children.some((child) => /\.exe$/i.test(child.name))
                    ? GameType.WINDOWS_PORTABLE
                    : GameType.UNDETECTABLE,
            });
        } else if (recursive) await walk(filename);
      } catch (error) {
        onError(filename, error);
      }
    }
  };
  await walk(root);
  return games;
}
