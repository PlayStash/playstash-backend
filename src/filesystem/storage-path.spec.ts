import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveStoragePath } from "./storage-path.js";

describe("storage volume containment", () => {
  let directory: string;
  let root: string;
  let outside: string;
  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "playstash-storage-"));
    root = path.join(directory, "volume");
    outside = path.join(directory, "outside");
    await mkdir(root);
    await mkdir(outside);
    await writeFile(path.join(outside, "secret.zip"), "must not be served");
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  it("allows ordinary files and missing children of the configured volume", async () => {
    const file = path.join(root, "archive.zip");
    await writeFile(file, "game");
    expect(await resolveStoragePath(root, file)).toBe(file);
    const next = path.join(root, "users", "1", "games", "2", "save.zip");
    expect(await resolveStoragePath(root, next, true)).toBe(next);
  });
  it("rejects the root itself, sibling-prefix paths and parent traversal", async () => {
    for (const target of [
      root,
      outside,
      `${root}-other/file.zip`,
      path.join(root, "..", "outside", "secret.zip"),
    ])
      await expect(resolveStoragePath(root, target, true)).rejects.toThrow(
        "outside",
      );
  });
  it("rejects existing directory links for reads and not-yet-created upload destinations", async () => {
    // Directory junctions need no Windows developer-mode or administrator token.
    const alias = path.join(root, "linked");
    await symlink(
      outside,
      alias,
      process.platform === "win32" ? "junction" : "dir",
    );
    await expect(
      resolveStoragePath(root, path.join(alias, "secret.zip")),
    ).rejects.toThrow("symbolic links");
    await expect(
      resolveStoragePath(root, path.join(alias, "new", "save.zip"), true),
    ).rejects.toThrow("symbolic links");
    expect(
      await resolveStoragePath(outside, path.join(outside, "secret.zip")),
    ).toContain("secret.zip");
  });
  it("also rejects links to other locations within the same volume", async () => {
    const actual = path.join(root, "private-game");
    await mkdir(actual);
    await symlink(
      actual,
      path.join(root, "public-game"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await expect(
      resolveStoragePath(
        root,
        path.join(root, "public-game", "file.zip"),
        true,
      ),
    ).rejects.toThrow("symbolic links");
  });
});
