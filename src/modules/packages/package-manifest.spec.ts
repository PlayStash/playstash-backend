import {
  mkdir,
  mkdtemp,
  rm,
  rmdir,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  parsePackageManifest,
  readPackageManifest,
  resolvePackagePath,
  scanDirectoryGames,
  snapshotGameDirectory,
  validateRelativePackagePath,
} from "./package-manifest.js";

describe("game package manifests and directory grouping", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "playstash-package-test-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });
  it.each([
    "../secret",
    "/etc/passwd",
    "C:\\secret",
    "sub/../../secret",
    "sub\\..\\secret",
    "a\0b",
    "a//b",
    "",
  ])("rejects unsafe package path %s", (value) => {
    expect(() => validateRelativePackagePath(value)).toThrow();
  });
  it("validates a versioned manifest and never interprets commands as shell scripts", () => {
    const manifest = parsePackageManifest({
      schema_version: 1,
      install: { executable: "setup.exe", parameters: "/S" },
      launch_profiles: [{ name: "Normal", executable: "bin/game.exe" }],
      addons: [{ path: "Addons/patch.zip", kind: "patch" }],
    });
    expect(manifest.install?.executable).toBe("setup.exe");
    expect(manifest.addons?.[0].kind).toBe("patch");
    expect(() => parsePackageManifest({ schema_version: 2 })).toThrow();
    expect(() =>
      parsePackageManifest({
        schema_version: 1,
        install: { executable: "../evil.exe" },
      }),
    ).toThrow();
  });
  it("ignores absent manifests and rejects malformed or oversized manifests", async () => {
    expect(await readPackageManifest(root)).toBeUndefined();
    await writeFile(path.join(root, "playstash-package.json"), "{broken");
    await expect(readPackageManifest(root)).rejects.toThrow("not valid JSON");
    await writeFile(
      path.join(root, "playstash-package.json"),
      "x".repeat(1024 * 1024 + 1),
    );
    await expect(readPackageManifest(root)).rejects.toThrow("1 MiB");
  });
  it("groups sibling installer data files as one game and excludes Extras/Addons payloads", async () => {
    const game = path.join(root, "My Game (v1.0)");
    await mkdir(path.join(game, "Extras"), { recursive: true });
    await mkdir(path.join(game, "Addons"));
    await writeFile(path.join(game, "setup.exe"), "setup");
    await writeFile(path.join(game, "data1.bin"), "data");
    await writeFile(path.join(game, "Extras", "Manual.pdf"), "manual");
    await writeFile(path.join(game, "Addons", "patch.zip"), "patch");
    const games = await scanDirectoryGames(root, false, () => true);
    expect(games.map((item) => item.path)).toEqual([game]);
    expect(games[0].size).toBe(9n);
    const before = await snapshotGameDirectory(game);
    await writeFile(path.join(game, "data1.bin"), "DATA");
    const after = await snapshotGameDirectory(game);
    expect(after.size).toBe(before.size);
    expect(after.fingerprint).not.toBe(before.fingerprint);
  });
  it("groups a portable manifest folder and preserves explicitly archived sources", async () => {
    const portable = path.join(root, "Portable");
    const archived = path.join(root, "Archived");
    await mkdir(portable);
    await mkdir(archived);
    await writeFile(
      path.join(portable, "playstash-package.json"),
      JSON.stringify({ schema_version: 1, title: "Portable Game" }),
    );
    await writeFile(path.join(portable, "game.exe"), "game");
    await writeFile(
      path.join(archived, "playstash-package.json"),
      JSON.stringify({ schema_version: 1, source: "game.zip" }),
    );
    const games = await scanDirectoryGames(root, true, () => true);
    expect(games).toHaveLength(1);
    expect(games[0].manifest?.title).toBe("Portable Game");
  });
  it("invalidates a folder archive when an empty directory is added or removed without changing payload bytes", async () => {
    await writeFile(path.join(root, "game.exe"), "game");
    const before = await snapshotGameDirectory(root);
    await mkdir(path.join(root, "empty"));
    const added = await snapshotGameDirectory(root);
    expect(added.size).toBe(before.size);
    expect(added.fingerprint).not.toBe(before.fingerprint);
    await rmdir(path.join(root, "empty"));
    const removed = await snapshotGameDirectory(root);
    expect(removed.size).toBe(before.size);
    expect(removed.fingerprint).toBe(before.fingerprint);
  });
  it("rejects symlink escape paths even when their textual relative paths are valid", async () => {
    const outside = await mkdtemp(
      path.join(tmpdir(), "playstash-package-outside-"),
    );
    try {
      await writeFile(path.join(outside, "private.txt"), "private");
      await symlink(
        outside,
        path.join(root, "linked"),
        process.platform === "win32" ? "junction" : "dir",
      );
      await expect(
        resolvePackagePath(root, "linked/private.txt"),
      ).rejects.toThrow("outside");
      await expect(snapshotGameDirectory(root)).rejects.toThrow(
        "symbolic links",
      );
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
  it("continues scanning valid games when another package is malformed", async () => {
    await mkdir(path.join(root, "Broken"));
    await mkdir(path.join(root, "Working"));
    await writeFile(path.join(root, "Broken", "playstash-package.json"), "{");
    await writeFile(path.join(root, "Working", "setup.exe"), "exe");
    const errors = vi.fn();
    const games = await scanDirectoryGames(root, true, () => true, errors);
    expect(games).toHaveLength(1);
    expect(errors).toHaveBeenCalledTimes(1);
  });
});
