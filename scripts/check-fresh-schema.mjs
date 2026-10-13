import { Logger } from "@nestjs/common";
import { DatabaseSync } from "node:sqlite";
import "reflect-metadata";
import { DataSource } from "typeorm";
import { SnakeNamingStrategy } from "typeorm-naming-strategies";

// Exercise the actual migration chain without requiring a native C++ build.
// Production still uses better-sqlite3; this adapter is only for this smoke test.
class BuiltinSqliteAdapter {
  constructor(path) {
    this.database = new DatabaseSync(path);
  }

  pragma(sql) {
    return this.database.prepare(`PRAGMA ${sql}`).all();
  }

  prepare(sql) {
    const statement = this.database.prepare(sql);
    return {
      reader: statement.columns().length > 0,
      all: (...parameters) => statement.all(...parameters),
      run: (...parameters) => statement.run(...parameters),
    };
  }

  close() {
    this.database.close();
  }
}

Logger.overrideLogger([]);
const system = process.argv[2] ?? "sqlite";
if (!["sqlite", "postgres"].includes(system)) {
  throw new Error("Choose sqlite or postgres.");
}
if (system === "postgres" && !process.env.PLAYSTASH_TEST_DATABASE_URL) {
  throw new Error("Set PLAYSTASH_TEST_DATABASE_URL to an empty test database.");
}
const source = new DataSource({
  ...(system === "sqlite"
    ? {
        type: "better-sqlite3",
        driver: BuiltinSqliteAdapter,
        database: ":memory:",
      }
    : { type: "postgres", url: process.env.PLAYSTASH_TEST_DATABASE_URL }),
  entities: ["dist/**/*.*entity.js"],
  migrations: [`dist/src/modules/database/migrations/${system}/*.js`],
  namingStrategy: new SnakeNamingStrategy(),
  synchronize: false,
  logging: false,
});

await source.initialize();
try {
  const runner = source.createQueryRunner();
  const existing =
    system === "postgres"
      ? await source.query(
          "SELECT tablename FROM pg_tables WHERE schemaname = current_schema()",
        )
      : await runner.getTables();
  if (existing.length > 0) {
    throw new Error("The smoke test requires an empty database.");
  }
  const migrations = await source.runMigrations();
  const tables = await runner.getTables();
  for (const name of ["playstash_user", "playstash_game", "playstash_server"]) {
    if (!tables.some((table) => table.name === name)) {
      throw new Error(`Expected table ${name} is missing.`);
    }
  }
  const bookmark = tables.find((table) => table.name === "bookmark");
  for (const name of ["playstash_user_id", "playstash_game_id"]) {
    if (!bookmark?.columns.some((column) => column.name === name)) {
      throw new Error(`Expected bookmark column ${name} is missing.`);
    }
  }
  console.log(
    `${system}: ${migrations.length} migrations passed; PlayStash tables and bookmark columns verified.`,
  );
} finally {
  await source.destroy();
}
