import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AutoTagsService,
  normalizeFolderTagRules,
  tagsForGameFolder,
} from "./auto-tags.service.js";

const folders: string[] = [];
afterEach(async () => {
  for (const folder of folders.splice(0))
    await rm(folder, { recursive: true, force: true });
});

describe("persistent folder tag rules", () => {
  it.each([
    "../Games",
    "Games/../Other",
    "/Games",
    "C:\\Games",
    "Games//Other",
    "Games\0Other",
  ])("rejects escaping prefix %s", (folder_prefix) => {
    expect(() =>
      normalizeFolderTagRules([{ folder_prefix, tags: ["A"] }]),
    ).toThrow();
  });
  it("matches folder boundaries, all versions and unpacked folders without duplication", () => {
    const rules = normalizeFolderTagRules([
      { folder_prefix: "Arcade", tags: ["Fast", "fast"] },
      { folder_prefix: "RPG", tags: ["Story"] },
      { folder_prefix: "Arcade", tags: ["Disabled"], enabled: false },
    ]);
    const game = {
      file_path: path.resolve("library/Arcade2/Game.zip"),
      versions: [
        { file_path: path.resolve("library/Arcade/Game.zip") },
        { file_path: path.resolve("library/RPG/Folder") },
      ],
    } as any;
    expect(tagsForGameFolder(game, path.resolve("library"), rules)).toEqual([
      "fast",
      "Story",
    ]);
    expect(
      tagsForGameFolder(
        { file_path: path.resolve("other/Arcade/game.zip") } as any,
        path.resolve("library"),
        rules,
      ),
    ).toEqual([]);
  });
  it("keeps provider/manual tags, persists rules and reloads after restart", async () => {
    const folder = await mkdtemp(path.join(tmpdir(), "playstash-tags-"));
    folders.push(folder);
    const config = {
      VOLUMES: { CONFIG: folder, FILES: path.join(folder, "library") },
    } as any;
    const service = new AutoTagsService(config);
    await expect(service.getRules()).resolves.toEqual([]);
    await service.setRules({
      rules: [{ folder_prefix: "Classics", tags: ["Classic", "Favorite"] }],
    });
    expect(
      JSON.parse(
        await readFile(path.join(folder, "folder-tag-rules.json"), "utf8"),
      ).rules,
    ).toHaveLength(1);
    const restarted = new AutoTagsService(config);
    const metadata = {
      tags: [
        { name: "Favorite", provider_slug: "user" },
        { name: "Adventure" },
      ],
    } as any;
    const decorated = await restarted.decorate(
      { file_path: path.join(folder, "library/Classics/Game.zip") } as any,
      metadata,
    );
    expect(decorated.tags?.map((tag) => tag.name)).toEqual([
      "Favorite",
      "Adventure",
      "Classic",
    ]);
    await restarted.setRules({ rules: [] });
    expect(
      (
        await restarted.decorate(
          { file_path: path.join(folder, "library/Classics/Game.zip") } as any,
          metadata,
        )
      ).tags?.map((tag) => tag.name),
    ).toEqual(["Favorite", "Adventure"]);
  });
});
