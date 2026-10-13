import { createWriteStream } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import yauzl from "yauzl";

export const MAX_FRONTEND_ZIP_BYTES = 256 * 1024 * 1024;
const MAX_ENTRIES = 10_000;

/** Extract only ordinary files to fresh storage, then replace the validated cache. */
export async function extractFrontendZip(
  source: string,
  destination: string,
): Promise<void> {
  if ((await stat(source)).size > MAX_FRONTEND_ZIP_BYTES)
    throw new Error("Frontend ZIP exceeds the 256 MiB limit.");
  const existing = await lstat(destination).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    },
  );
  if (existing && (!existing.isDirectory() || existing.isSymbolicLink()))
    throw new Error("Frontend cache must be an ordinary directory.");
  const staging = await mkdtemp(
    join(dirname(destination), ".playstash-frontend-"),
  );
  let archive: yauzl.ZipFile | undefined;
  try {
    archive = await yauzl.openPromise(source, {
      lazyEntries: true,
      validateEntrySizes: true,
      strictFileNames: true,
    });
    if (archive.entryCount > MAX_ENTRIES)
      throw new Error("Frontend ZIP contains too many entries.");
    let totalSize = 0;
    const paths = new Set<string>();
    for await (const entry of archive.eachEntry()) {
      const filename = entry.fileName;
      const components = filename.replace(/\/$/, "").split("/");
      if (
        !filename ||
        filename.length > 1024 ||
        /[\\:*?"<>|]/.test(filename) ||
        Array.from(filename).some(
          (character) =>
            character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
        ) ||
        components.some(
          (part) =>
            !part ||
            part === "." ||
            part === ".." ||
            /[. ]$/.test(part) ||
            /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
        )
      )
        throw new Error("Frontend ZIP contains an unsafe path.");
      const normalized = components.join("/").toLowerCase();
      if (paths.has(normalized))
        throw new Error("Frontend ZIP contains duplicate paths.");
      paths.add(normalized);
      const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
      const directory = filename.endsWith("/");
      if (
        (mode !== 0 && mode !== (directory ? 0x4000 : 0x8000)) ||
        entry.isEncrypted() ||
        ![0, 8].includes(entry.compressionMethod)
      )
        throw new Error("Frontend ZIP contains a link or unsupported entry.");
      totalSize += entry.uncompressedSize;
      if (
        !Number.isSafeInteger(totalSize) ||
        totalSize > MAX_FRONTEND_ZIP_BYTES
      )
        throw new Error("Expanded frontend ZIP exceeds the 256 MiB limit.");
      const target = join(staging, ...components);
      if (directory) {
        if (entry.uncompressedSize !== 0)
          throw new Error("Invalid frontend ZIP directory.");
        await mkdir(target, { recursive: true });
      } else {
        await mkdir(dirname(target), { recursive: true });
        let written = 0;
        const limit = new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            written += chunk.length;
            callback(
              written > entry.uncompressedSize
                ? new Error("Invalid frontend ZIP entry size.")
                : null,
              chunk,
            );
          },
        });
        await pipeline(
          await archive.openReadStreamPromise(entry),
          limit,
          createWriteStream(target, { flags: "wx" }),
        );
        if (written !== entry.uncompressedSize)
          throw new Error("Invalid frontend ZIP entry size.");
      }
    }
    if (!(await lstat(join(staging, "dist", "index.html"))).isFile())
      throw new Error("Frontend ZIP must contain dist/index.html.");
    await mkdir(destination, { recursive: true });
    // No archive entry has touched the active cache until all entries validate.
    for (const name of await readdir(destination))
      await rm(join(destination, name), { recursive: true, force: true });
    for (const name of await readdir(staging))
      await rename(join(staging, name), join(destination, name));
  } finally {
    archive?.close();
    await rm(staging, { recursive: true, force: true });
  }
}
