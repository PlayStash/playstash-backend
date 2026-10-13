import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

/** Resolve a child of a configured volume without following nested symlinks. */
export async function resolveStoragePath(
  root: string,
  target: string,
  allowMissing = false,
): Promise<string> {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  )
    throw new Error("Storage path is outside its configured volume.");
  const canonicalRoot = await realpath(root);
  let current = canonicalRoot;
  let missing = false;
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    if (missing) continue;
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink())
        throw new Error("Storage paths cannot follow symbolic links.");
    } catch (error) {
      if (!allowMissing || (error as NodeJS.ErrnoException).code !== "ENOENT")
        throw error;
      missing = true;
    }
  }
  return current;
}
