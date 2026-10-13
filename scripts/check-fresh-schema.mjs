import { Logger } from "@nestjs/common";
import assert from "node:assert/strict";
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
  for (const name of [
    "playstash_user",
    "playstash_game",
    "playstash_server",
    "game_access",
    "game_client_event",
  ]) {
    if (!tables.some((table) => table.name === name)) {
      throw new Error(`Expected table ${name} is missing.`);
    }
  }
  for (const [tableName, columnName] of [
    ["playstash_game", "access_restricted"],
    ["playstash_user", "share_restricted_activity"],
    ["playstash_user", "report_game_metrics"],
  ]) {
    if (
      !tables
        .find((table) => table.name === tableName)
        ?.columns.some((column) => column.name === columnName)
    ) {
      throw new Error(
        `Expected access/privacy column ${tableName}.${columnName} is missing.`,
      );
    }
  }
  const bookmark = tables.find((table) => table.name === "bookmark");
  for (const name of ["playstash_user_id", "playstash_game_id"]) {
    if (!bookmark?.columns.some((column) => column.name === name)) {
      throw new Error(`Expected bookmark column ${name} is missing.`);
    }
  }
  const metadata = tables.find((table) => table.name === "game_metadata");
  for (const name of [
    "umu_game_id",
    "umu_store",
    "umu_proton_path",
    "archive_password",
    "system_requirements_minimum",
    "system_requirements_recommended",
    "launch_profiles",
  ]) {
    if (!metadata?.columns.some((column) => column.name === name)) {
      throw new Error(`Expected game metadata column ${name} is missing.`);
    }
  }
  const { PlaystashUser } =
    await import("../dist/src/modules/users/playstash-user.entity.js");
  const { PlaystashGame } =
    await import("../dist/src/modules/games/playstash-game.entity.js");
  const { GameVersion } =
    await import("../dist/src/modules/games/game-version.entity.js");
  const { GamesService } =
    await import("../dist/src/modules/games/games.service.js");
  const { applyGameAccessFilter } =
    await import("../dist/src/modules/games/game-access.js");
  const userRepository = source.getRepository(PlaystashUser);
  const gameRepository = source.getRepository(PlaystashGame);
  const permitted = await userRepository.save({
    username: "acl_allowed",
    password: "test-only",
    api_key: "a".repeat(64),
    role: 1,
    activated: true,
  });
  const denied = await userRepository.save({
    username: "acl_denied",
    password: "test-only",
    api_key: "b".repeat(64),
    role: 1,
    activated: true,
  });
  const publicGame = await gameRepository.save({
    title: "Public",
    file_path: "/public.zip",
    access_restricted: false,
  });
  const privateGame = await gameRepository.save({
    title: "Private",
    file_path: "/private.zip",
    access_restricted: true,
    allowed_users: [permitted],
  });
  const service = new GamesService(
    gameRepository,
    source.getRepository(GameVersion),
    {},
    {},
  );
  assert.equal((await service.find({ requestingUser: denied })).length, 1);
  assert.equal((await service.find({ requestingUser: permitted })).length, 2);
  await assert.rejects(
    service.findOneByGameIdOrFail(privateGame.id, { requestingUser: denied }),
  );
  assert.equal(
    (
      await service.findOneByGameIdOrFail(privateGame.id, {
        requestingUser: permitted,
      })
    ).id,
    privateGame.id,
  );
  assert.equal(
    (
      await service.findOneByGameIdOrFail(privateGame.id, {
        requestingUser: { ...denied, role: 3 },
      })
    ).id,
    privateGame.id,
  );
  const scopedQuery = gameRepository.createQueryBuilder("game");
  applyGameAccessFilter(scopedQuery, "game", denied);
  assert.deepEqual(
    (await scopedQuery.getMany()).map((game) => game.id),
    [publicGame.id],
  );
  await gameRepository
    .createQueryBuilder()
    .relation(PlaystashGame, "allowed_users")
    .of(privateGame)
    .remove(permitted);
  await assert.rejects(
    service.findOneByGameIdOrFail(privateGame.id, {
      requestingUser: permitted,
    }),
  );
  const { GameClientEvent } =
    await import("../dist/src/modules/metrics/game-client-event.entity.js");
  const { MetricsService } =
    await import("../dist/src/modules/metrics/metrics.service.js");
  const metrics = new MetricsService(
    source.getRepository(GameClientEvent),
    source.getRepository(GameVersion),
    service,
    { findUserAgeByUsername: async () => undefined },
    { METRICS: { ENABLED: true, RETENTION_DAYS: 365 } },
  );
  const event = {
    event_id: "54e25a99-f1ac-466d-a463-b0fd6e16baab",
    type: "installed",
  };
  assert.equal(
    (await metrics.record(publicGame.id, event, permitted)).accepted,
    true,
  );
  assert.equal(
    (await metrics.record(publicGame.id, event, permitted)).accepted,
    true,
  );
  assert.equal(await source.getRepository(GameClientEvent).count(), 1);
  await assert.rejects(metrics.record(publicGame.id, event, denied));
  assert.equal(
    (await metrics.summary(publicGame.id, { ...denied, role: 3 })).installed,
    1,
  );
  await assert.rejects(metrics.summary(publicGame.id, denied));
  const { Progress } =
    await import("../dist/src/modules/progresses/progress.entity.js");
  const { GamesController } =
    await import("../dist/src/modules/games/games.controller.js");
  const progressRepository = source.getRepository(Progress);
  await progressRepository.save([
    { user: denied, game: publicGame, state: "PLAYING" },
    { user: denied, game: privateGame, state: "PLAYING" },
  ]);
  const controller = new GamesController(
    service,
    {},
    gameRepository,
    progressRepository,
    {
      findUserAgeByUsername: async () => undefined,
      findOneByUserIdOrFail: (id) => userRepository.findOneByOrFail({ id }),
    },
    {},
  );
  const progressQuery = () => ({
    filter: {
      "progresses.user.id": `$eq:${denied.id}`,
      "progresses.state": "$eq:PLAYING",
    },
    path: "http://localhost/api/games",
  });
  assert.deepEqual(
    (
      await controller.findGames(
        { user: { ...permitted, role: 3 } },
        progressQuery(),
      )
    ).data.map((game) => game.id),
    [publicGame.id],
  );
  await userRepository.update(denied.id, { share_restricted_activity: true });
  assert.equal(
    (
      await controller.findGames(
        { user: { ...permitted, role: 3 } },
        progressQuery(),
      )
    ).data.length,
    2,
  );
  await userRepository.update(denied.id, { share_restricted_activity: false });
  assert.equal(
    (
      await controller.findGames(
        { user: { ...denied, role: 3 } },
        progressQuery(),
      )
    ).data.length,
    2,
  );
  const { checkLibraryFeedback } = await import("./check-feedback.mjs");
  await checkLibraryFeedback(source, {
    permitted,
    denied,
    publicGame,
    privateGame,
    service,
    userRepository,
  });
  const { checkFolderTags } = await import("./check-folder-tags.mjs");
  await checkFolderTags(source, { publicGame, service, gameRepository });
  console.log(
    `${system}: ${migrations.length} migrations passed; PlayStash tables, shared metadata, access/privacy and bookmarks verified.`,
  );
} catch (error) {
  if (error.query) console.error("Failing smoke-test SQL:", error.query);
  throw error;
} finally {
  await source.destroy();
}
