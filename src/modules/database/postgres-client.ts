import { constants } from "node:fs";
import { access, lstat } from "node:fs/promises";
import { platform } from "node:os";
import type { DataSource } from "typeorm";

export interface PostgresClients {
  dump: "pg_dump" | "/usr/libexec/postgresql16/pg_dump";
  restore: "pg_restore" | "/usr/libexec/postgresql16/pg_restore";
}

export async function selectPostgresClients(
  database: Pick<DataSource, "query">,
): Promise<PostgresClients> {
  const rows: unknown = await database.query("SHOW server_version_num");
  const value = Array.isArray(rows) ? rows[0]?.server_version_num : undefined;
  const version =
    (typeof value === "string" && /^\d{5,6}$/.test(value)) ||
    (typeof value === "number" && Number.isSafeInteger(value))
      ? Number(value)
      : NaN;
  if (!Number.isSafeInteger(version) || version < 90000 || version >= 1000000)
    throw new Error("PostgreSQL returned an invalid server version.");
  const standard: PostgresClients = { dump: "pg_dump", restore: "pg_restore" };
  if (Math.floor(version / 10000) !== 16 || platform() !== "linux")
    return standard;
  const matching: PostgresClients = {
    dump: "/usr/libexec/postgresql16/pg_dump",
    restore: "/usr/libexec/postgresql16/pg_restore",
  };
  try {
    for (const binary of [matching.dump, matching.restore]) {
      const info = await lstat(binary);
      if (!info.isFile() || info.isSymbolicLink()) return standard;
      await access(binary, constants.X_OK);
    }
    return matching;
  } catch {
    return standard;
  }
}
