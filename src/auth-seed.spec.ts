import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAuthSeed } from "./auth-seed.js";

describe("authentication signing key persistence", () => {
  let directory: string;
  const explicit = "an-independent-explicit-secret-with-at-least-32-bytes";
  const key = "a".repeat(64);

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "playstash-auth-seed-"));
  });
  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  const persisted = () =>
    createAuthSeed(undefined, { persist: true, configDirectory: directory });
  const writeSeed = (contents: string) =>
    writeFileSync(join(directory, "auth-seed"), contents, { mode: 0o600 });

  it("generates an independent private key and reuses it for later startups", () => {
    const first = persisted();
    const filename = join(directory, "auth-seed");
    const contents = readFileSync(filename, "utf8");
    expect(contents).toMatch(/^[\da-f]{64}\n$/);
    expect(first).toBe(
      createHash("sha256").update(contents.trim()).digest("hex"),
    );
    expect(persisted()).toBe(first);
    expect(readFileSync(filename, "utf8")).toBe(contents);
    expect(statSync(filename).nlink).toBe(1);
    if (process.platform !== "win32") {
      expect(statSync(filename).mode & 0o777).toBe(0o600);
      expect(statSync(filename).uid).toBe(process.getuid?.());
    }
    const independent = join(directory, "another-installation");
    mkdirSync(independent, { mode: 0o700 });
    expect(
      createAuthSeed(undefined, {
        persist: true,
        configDirectory: independent,
      }),
    ).not.toBe(first);
  });

  it("keeps non-container defaults random without touching the filesystem", () => {
    const first = createAuthSeed(undefined);
    expect(createAuthSeed(undefined)).not.toBe(first);
    expect(
      createAuthSeed(undefined, { persist: false, configDirectory: directory }),
    ).not.toBe(first);
    expect(existsSync(join(directory, "auth-seed"))).toBe(false);
  });

  it("uses an explicit seed without reading or creating a persisted file", () => {
    writeSeed("corrupt-file-that-must-not-be-used");
    expect(
      createAuthSeed(explicit, { persist: true, configDirectory: directory }),
    ).toBe(createHash("sha256").update(explicit).digest("hex"));
    expect(readFileSync(join(directory, "auth-seed"), "utf8")).toBe(
      "corrupt-file-that-must-not-be-used",
    );
    expect(
      createAuthSeed(explicit, {
        persist: true,
        configDirectory: join(directory, "absent"),
      }),
    ).toBe(createAuthSeed(explicit));
    expect(() =>
      createAuthSeed("too-short", {
        persist: true,
        configDirectory: directory,
      }),
    ).toThrow("AUTH_SEED must contain at least 32 bytes");
  });

  it.each(["", "a".repeat(31), "g".repeat(64), "a".repeat(1025), `${key}\0`])(
    "rejects an invalid stored key instead of replacing it (%#)",
    (contents) => {
      writeSeed(contents);
      expect(persisted).toThrow(
        "Cannot securely load persistent authentication seed",
      );
      expect(readFileSync(join(directory, "auth-seed"), "utf8")).toBe(contents);
    },
  );

  it("rejects a directory in place of the key and a missing configuration directory", () => {
    mkdirSync(join(directory, "auth-seed"));
    expect(persisted).toThrow(
      "Cannot securely load persistent authentication seed",
    );
    expect(() =>
      createAuthSeed(undefined, {
        persist: true,
        configDirectory: join(directory, "missing"),
      }),
    ).toThrow("Cannot securely load persistent authentication seed");
  });

  it("rejects hard-linked keys without reading or modifying the linked file", () => {
    const other = join(directory, "other-key");
    writeFileSync(other, key, { mode: 0o600 });
    linkSync(other, join(directory, "auth-seed"));
    expect(persisted).toThrow(
      "Cannot securely load persistent authentication seed",
    );
    expect(readFileSync(other, "utf8")).toBe(key);
  });

  it.skipIf(process.platform === "win32")(
    "rejects symbolic links and broadly readable files",
    () => {
      const other = join(directory, "other-key");
      writeFileSync(other, key, { mode: 0o600 });
      symlinkSync(other, join(directory, "auth-seed"));
      expect(persisted).toThrow(
        "Cannot securely load persistent authentication seed",
      );
      rmSync(join(directory, "auth-seed"));
      writeSeed(key);
      chmodSync(join(directory, "auth-seed"), 0o644);
      expect(persisted).toThrow(
        "Cannot securely load persistent authentication seed",
      );
      expect(readFileSync(other, "utf8")).toBe(key);
    },
  );

  it("rejects a linked configuration directory", () => {
    const real = join(directory, "real-directory");
    const linked = join(directory, "linked-directory");
    mkdirSync(real, { mode: 0o700 });
    symlinkSync(
      real,
      linked,
      process.platform === "win32" ? "junction" : "dir",
    );
    expect(() =>
      createAuthSeed(undefined, { persist: true, configDirectory: linked }),
    ).toThrow("Cannot securely load persistent authentication seed");
    expect(existsSync(join(real, "auth-seed"))).toBe(false);
  });

  it("never includes key contents or configuration paths in failure messages", () => {
    const invalidSecret = "sensitive-invalid-seed-contents";
    writeSeed(invalidSecret);
    try {
      persisted();
      expect.fail("Invalid key was accepted");
    } catch (error) {
      expect(String(error)).not.toContain(invalidSecret);
      expect(String(error)).not.toContain(directory);
    }
  });
});
