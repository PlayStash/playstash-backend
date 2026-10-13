import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readSync,
  type Stats,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

interface AuthSeedPersistence {
  persist: boolean;
  configDirectory: string;
}

const MAX_PERSISTED_SEED_BYTES = 1024;

function assertPrivateSeedFile(info: Stats): void {
  if (!info.isFile() || info.nlink !== 1) {
    throw new Error("Authentication seed must be an ordinary, unlinked file.");
  }
  if (
    process.platform !== "win32" &&
    ((info.mode & 0o777) !== 0o600 || info.uid !== process.getuid?.())
  ) {
    throw new Error(
      "Authentication seed must belong to the service user with mode 0600.",
    );
  }
}

function persistentAuthSeed(configDirectory: string): string {
  let descriptor: number | undefined;
  try {
    const directory = lstatSync(configDirectory);
    if (!directory.isDirectory() || directory.isSymbolicLink()) {
      throw new Error(
        "Authentication seed directory must be an ordinary directory.",
      );
    }
    const filename = join(configDirectory, "auth-seed");
    let created = false;
    try {
      descriptor = openSync(
        filename,
        constants.O_RDWR |
          constants.O_CREAT |
          constants.O_EXCL |
          (constants.O_NOFOLLOW ?? 0),
        0o600,
      );
      created = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      // lstat also rejects links on platforms without O_NOFOLLOW.
      assertPrivateSeedFile(lstatSync(filename));
      descriptor = openSync(
        filename,
        constants.O_RDONLY |
          (constants.O_NOFOLLOW ?? 0) |
          (constants.O_NONBLOCK ?? 0),
      );
    }
    assertPrivateSeedFile(fstatSync(descriptor));
    if (created) {
      writeFileSync(descriptor, `${randomBytes(32).toString("hex")}\n`, "utf8");
      fsyncSync(descriptor);
    }
    const before = fstatSync(descriptor);
    assertPrivateSeedFile(before);
    if (before.size < 32 || before.size > MAX_PERSISTED_SEED_BYTES) {
      throw new Error("Authentication seed file has an invalid size.");
    }
    const buffer = Buffer.alloc(MAX_PERSISTED_SEED_BYTES + 1);
    const length = readSync(descriptor, buffer, 0, buffer.length, 0);
    const after = fstatSync(descriptor);
    const currentPath = lstatSync(filename);
    assertPrivateSeedFile(after);
    assertPrivateSeedFile(currentPath);
    if (
      length !== before.size ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs ||
      currentPath.dev !== after.dev ||
      currentPath.ino !== after.ino
    ) {
      throw new Error("Authentication seed file changed while being read.");
    }
    const contents = buffer.subarray(0, length).toString("utf8").trim();
    if (!/^[\da-f]{64}$/.test(contents)) {
      throw new Error(
        "Authentication seed file must contain a generated 32-byte hexadecimal key.",
      );
    }
    return contents;
  } catch (error) {
    // Never include file contents, paths or nested errors in startup logs.
    const code = (error as NodeJS.ErrnoException).code;
    throw new Error(
      `Cannot securely load persistent authentication seed${code ? ` (${code})` : ""}. Check the private auth-seed file and configuration volume.`,
    );
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function createAuthSeed(
  seed: string | undefined,
  persistence?: AuthSeedPersistence,
): string {
  if (!seed) {
    if (!persistence?.persist) return randomBytes(32).toString("hex");
    seed = persistentAuthSeed(persistence.configDirectory);
  }
  if (Buffer.byteLength(seed, "utf8") < 32) {
    throw new Error(
      "AUTH_SEED must contain at least 32 bytes of independently generated randomness.",
    );
  }
  return createHash("sha256").update(seed).digest("hex");
}
