import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  chownSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { initializePostgresSecret } from "./init-postgres.mjs";

const script = fileURLToPath(new URL("./init-postgres.mjs", import.meta.url));
const uid = process.getuid?.() ?? 1000;
const gid = process.getgid?.() ?? 1000;

function fixture(run) {
  const directory = mkdtempSync(join(tmpdir(), "playstash-postgres-secret-"));
  try {
    const filename = join(directory, "postgres-password");
    const initialize = () => initializePostgresSecret({ directory, uid, gid });
    return run({ directory, filename, initialize });
  } finally {
    assert.equal(resolve(dirname(directory)), resolve(tmpdir()));
    rmSync(directory, { recursive: true, force: true });
  }
}

test("creates one random password with private storage and reuses it unchanged", () =>
  fixture(({ directory, filename, initialize }) => {
    assert.deepEqual(initialize(), { created: true });
    const raw = readFileSync(filename, "utf8");
    const before = lstatSync(filename);
    assert.match(raw, /^[a-f\d]{64}\n$/);
    assert.deepEqual(initialize(), { created: false });
    assert.equal(readFileSync(filename, "utf8"), raw);
    assert.equal(lstatSync(filename).mtimeMs, before.mtimeMs);
    assert.equal(lstatSync(filename).ino, before.ino);
    assert.equal(lstatSync(filename).nlink, 1);
    if (process.platform !== "win32") {
      assert.equal(lstatSync(directory).mode & 0o777, 0o700);
      assert.equal(lstatSync(filename).mode & 0o777, 0o600);
      assert.equal(lstatSync(filename).uid, uid);
      assert.equal(lstatSync(filename).gid, gid);
    }
    const independent = join(directory, "independent-installation");
    initializePostgresSecret({ directory: independent, uid, gid });
    assert.notEqual(
      readFileSync(join(independent, "postgres-password"), "utf8"),
      raw,
    );
  }));

test("reuses a valid existing password rather than rotating it", () =>
  fixture(({ filename, initialize }) => {
    const raw = `${"b".repeat(64)}\n`;
    writeFileSync(filename, raw, { mode: 0o600 });
    assert.deepEqual(initialize(), { created: false });
    assert.equal(readFileSync(filename, "utf8"), raw);
  }));

for (const [name, raw] of [
  ["empty", ""],
  ["short", "a".repeat(63)],
  ["invalid hexadecimal", "g".repeat(64)],
  ["too large", "a".repeat(1025)],
  ["embedded NUL", `${"a".repeat(64)}\0`],
  ["extra content", `${"a".repeat(64)}\nanother-line`],
]) {
  test(`rejects ${name} without changing stored data`, () =>
    fixture(({ filename, initialize }) => {
      writeFileSync(filename, raw, { mode: 0o600 });
      assert.throws(
        initialize,
        /Cannot securely initialize PostgreSQL password/,
      );
      assert.equal(readFileSync(filename, "utf8"), raw);
    }));
}

test("rejects directories and hard links instead of treating them as passwords", () =>
  fixture(({ directory, filename, initialize }) => {
    mkdirSync(filename);
    assert.throws(initialize, /Cannot securely initialize PostgreSQL password/);
    rmSync(filename, { recursive: true });
    const target = join(directory, "other-key");
    const raw = "c".repeat(64);
    writeFileSync(target, raw, { mode: 0o600 });
    linkSync(target, filename);
    assert.throws(initialize, /Cannot securely initialize PostgreSQL password/);
    assert.equal(readFileSync(target, "utf8"), raw);
  }));

test("rejects a symbolic-link secrets directory", () =>
  fixture(({ directory }) => {
    const real = join(directory, "real");
    const linked = join(directory, "linked");
    mkdirSync(real);
    symlinkSync(
      real,
      linked,
      process.platform === "win32" ? "junction" : "dir",
    );
    assert.throws(
      () => initializePostgresSecret({ directory: linked, uid, gid }),
      /Cannot securely initialize PostgreSQL password/,
    );
    assert.equal(existsSync(join(real, "postgres-password")), false);
  }));

test(
  "rejects file symlinks and publicly readable secrets on Linux",
  {
    skip: process.platform === "win32",
  },
  () =>
    fixture(({ directory, filename, initialize }) => {
      const target = join(directory, "target");
      const raw = "d".repeat(64);
      writeFileSync(target, raw, { mode: 0o600 });
      symlinkSync(target, filename);
      assert.throws(
        initialize,
        /Cannot securely initialize PostgreSQL password/,
      );
      assert.equal(readFileSync(target, "utf8"), raw);
      rmSync(filename);
      writeFileSync(filename, raw, { mode: 0o600 });
      chmodSync(filename, 0o644);
      assert.throws(
        initialize,
        /Cannot securely initialize PostgreSQL password/,
      );
      assert.equal(readFileSync(filename, "utf8"), raw);
    }),
);

test(
  "root prepares the requested owner while rejecting an unrelated existing owner",
  {
    skip: process.platform === "win32" || process.getuid?.() !== 0,
  },
  () =>
    fixture(({ directory, filename }) => {
      assert.deepEqual(
        initializePostgresSecret({ directory, uid: 1000, gid: 1000 }),
        { created: true },
      );
      assert.equal(lstatSync(directory).uid, 1000);
      assert.equal(lstatSync(directory).gid, 1000);
      assert.equal(lstatSync(filename).uid, 1000);
      assert.equal(lstatSync(filename).gid, 1000);
      assert.equal(lstatSync(filename).mode & 0o777, 0o600);
      const before = readFileSync(filename, "utf8");
      assert.deepEqual(
        initializePostgresSecret({ directory, uid: 1000, gid: 1000 }),
        { created: false },
      );
      chownSync(filename, 65534, 65534);
      assert.throws(
        () => initializePostgresSecret({ directory, uid: 1000, gid: 1000 }),
        /Cannot securely initialize PostgreSQL password/,
      );
      assert.equal(readFileSync(filename, "utf8"), before);
    }),
);

test("rejects invalid account settings before writing a password", () =>
  fixture(({ directory, filename }) => {
    for (const value of [-1, "1000x", 2147483648, "1e3", NaN]) {
      assert.throws(
        () => initializePostgresSecret({ directory, uid: value, gid }),
        /Cannot securely initialize PostgreSQL password/,
      );
      assert.throws(
        () => initializePostgresSecret({ directory, uid, gid: value }),
        /Cannot securely initialize PostgreSQL password/,
      );
    }
    assert.equal(existsSync(filename), false);
  }));

test("the CLI exits successfully without printing the password, then fails closed for corruption", () =>
  fixture(({ directory, filename }) => {
    const environment = {
      ...process.env,
      PUID: String(uid),
      PGID: String(gid),
    };
    const first = spawnSync(process.execPath, [script, directory], {
      encoding: "utf8",
      env: environment,
    });
    assert.equal(first.status, 0, first.stderr);
    assert.equal(first.stdout.trim(), "Private PostgreSQL password is ready.");
    const raw = readFileSync(filename, "utf8");
    assert.equal(first.stdout.includes(raw.trim()), false);
    assert.equal(first.stderr.includes(raw.trim()), false);
    const second = spawnSync(process.execPath, [script, directory], {
      encoding: "utf8",
      env: environment,
    });
    assert.equal(second.status, 0, second.stderr);
    assert.equal(readFileSync(filename, "utf8"), raw);
    const invalid = "private-content-that-must-never-appear-in-logs";
    writeFileSync(filename, invalid);
    const failed = spawnSync(process.execPath, [script, directory], {
      encoding: "utf8",
      env: environment,
    });
    assert.equal(failed.status, 1);
    assert.match(
      failed.stderr,
      /Cannot securely initialize PostgreSQL password/,
    );
    assert.equal(failed.stderr.includes(invalid), false);
    assert.equal(failed.stderr.includes(directory), false);
    assert.equal(readFileSync(filename, "utf8"), invalid);
  }));
