import { randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  fchmodSync,
  fchownSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_DIRECTORY = "/run/playstash-secrets";
const PASSWORD_FILENAME = "postgres-password";
const MAX_SECRET_BYTES = 1024;
const unix = process.platform !== "win32";

function accountId(value, fallback) {
  const text = value === undefined ? String(fallback) : String(value);
  if (!/^\d+$/.test(text) || Number(text) > 2147483647) {
    throw new Error("Secret initializer requires valid numeric PUID and PGID.");
  }
  return Number(text);
}

function assertOwner(info, uid) {
  if (unix && info.uid !== uid && info.uid !== 0) {
    throw new Error("Secret storage has an unexpected owner.");
  }
}

function assertFile(info, uid) {
  assertOwner(info, uid);
  if (
    !info.isFile() ||
    info.nlink !== 1 ||
    (unix && (info.mode & 0o777) !== 0o600)
  ) {
    throw new Error(
      "Database password must be an ordinary private single-link file.",
    );
  }
}

/** Initialize once, then preserve the exact password for the persisted database. */
export function initializePostgresSecret({
  directory = DEFAULT_DIRECTORY,
  uid = accountId(process.env.PUID, 1000),
  gid = accountId(process.env.PGID, 1000),
} = {}) {
  let directoryDescriptor;
  let secretDescriptor;
  try {
    uid = accountId(uid, 1000);
    gid = accountId(gid, 1000);
    const currentUid = process.getuid?.();
    if (unix && currentUid !== 0 && currentUid !== uid) {
      throw new Error(
        "Secret initializer must run as root or the service owner.",
      );
    }
    if (
      typeof directory !== "string" ||
      !directory ||
      directory.includes("\0")
    ) {
      throw new Error("Secret storage directory is invalid.");
    }
    try {
      mkdirSync(directory, { mode: 0o700 });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    const initialDirectory = lstatSync(directory);
    if (!initialDirectory.isDirectory() || initialDirectory.isSymbolicLink()) {
      throw new Error("Secret storage must be an ordinary directory.");
    }
    assertOwner(initialDirectory, uid);
    if (unix) {
      directoryDescriptor = openSync(
        directory,
        constants.O_RDONLY |
          constants.O_DIRECTORY |
          (constants.O_NOFOLLOW ?? 0),
      );
      const openedDirectory = fstatSync(directoryDescriptor);
      if (
        !openedDirectory.isDirectory() ||
        openedDirectory.dev !== initialDirectory.dev ||
        openedDirectory.ino !== initialDirectory.ino
      ) {
        throw new Error(
          "Secret storage directory changed during initialization.",
        );
      }
      assertOwner(openedDirectory, uid);
      fchmodSync(directoryDescriptor, 0o700);
      if (openedDirectory.uid !== uid || openedDirectory.gid !== gid) {
        fchownSync(directoryDescriptor, uid, gid);
      }
    } else {
      // POSIX owner/mode enforcement is verified in the Linux deployment gate.
      chmodSync(directory, 0o700);
    }

    const filename = join(directory, PASSWORD_FILENAME);
    let created = false;
    try {
      secretDescriptor = openSync(
        filename,
        constants.O_RDWR |
          constants.O_CREAT |
          constants.O_EXCL |
          (constants.O_NOFOLLOW ?? 0),
        0o600,
      );
      created = true;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      assertFile(lstatSync(filename), uid);
      secretDescriptor = openSync(
        filename,
        constants.O_RDONLY |
          (constants.O_NOFOLLOW ?? 0) |
          (constants.O_NONBLOCK ?? 0),
      );
    }
    assertFile(fstatSync(secretDescriptor), uid);
    if (created) {
      writeFileSync(
        secretDescriptor,
        `${randomBytes(32).toString("hex")}\n`,
        "utf8",
      );
      fsyncSync(secretDescriptor);
    }
    const before = fstatSync(secretDescriptor);
    assertFile(before, uid);
    if (before.size < 64 || before.size > MAX_SECRET_BYTES) {
      throw new Error("Database password file has an invalid size.");
    }
    const buffer = Buffer.alloc(MAX_SECRET_BYTES + 1);
    const length = readSync(secretDescriptor, buffer, 0, buffer.length, 0);
    const after = fstatSync(secretDescriptor);
    const currentPath = lstatSync(filename);
    assertFile(after, uid);
    assertFile(currentPath, uid);
    if (
      length !== before.size ||
      after.size !== before.size ||
      after.ctimeMs !== before.ctimeMs ||
      after.mtimeMs !== before.mtimeMs ||
      currentPath.dev !== after.dev ||
      currentPath.ino !== after.ino ||
      !/^[a-f\d]{64}\n?$/.test(buffer.subarray(0, length).toString("utf8"))
    ) {
      throw new Error(
        "Database password file is invalid or changed during initialization.",
      );
    }
    if (unix) {
      if (after.uid !== uid || after.gid !== gid) {
        fchownSync(secretDescriptor, uid, gid);
      }
      const ready = fstatSync(secretDescriptor);
      assertFile(ready, uid);
      if (ready.uid !== uid || ready.gid !== gid) {
        throw new Error("Database password ownership could not be prepared.");
      }
      fsyncSync(secretDescriptor);
      fsyncSync(directoryDescriptor);
      const readyDirectory = lstatSync(directory);
      if (
        !readyDirectory.isDirectory() ||
        readyDirectory.isSymbolicLink() ||
        readyDirectory.dev !== initialDirectory.dev ||
        readyDirectory.ino !== initialDirectory.ino ||
        readyDirectory.uid !== uid ||
        readyDirectory.gid !== gid ||
        (readyDirectory.mode & 0o777) !== 0o700
      ) {
        throw new Error(
          "Secret storage directory could not be securely prepared.",
        );
      }
    }
    return { created };
  } catch (error) {
    // Never expose the password, path, account settings or nested error details.
    const code = error.code;
    throw new Error(
      `Cannot securely initialize PostgreSQL password${code ? ` (${code})` : ""}. Check the private secrets directory and service ownership.`,
    );
  } finally {
    if (secretDescriptor !== undefined) closeSync(secretDescriptor);
    if (directoryDescriptor !== undefined) closeSync(directoryDescriptor);
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    if (process.argv.length > 3)
      throw new Error("Provide only the secrets directory.");
    initializePostgresSecret({
      directory: process.argv[2] ?? DEFAULT_DIRECTORY,
    });
    console.log("Private PostgreSQL password is ready.");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
