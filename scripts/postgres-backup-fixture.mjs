import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Executed inside the built backend image by check-postgres-backup.mjs.
const require = createRequire("/app/package.json");
require("reflect-metadata");
const { DataSource } = require("typeorm");
const configuration = (await import("/app/dist/src/configuration.js")).default;
const { DatabaseService } =
  await import("/app/dist/src/modules/database/database.service.js");
const { selectPostgresClients } =
  await import("/app/dist/src/modules/database/postgres-client.js");
const password = process.env.PG_REVIEW_PASSWORD;
assert.ok(password, "An isolated test password is required.");

class BackupRestoreMigration1760000000000 {
  async up(queryRunner) {
    await queryRunner.query(
      "CREATE TABLE restore_migration (marker text NOT NULL)",
    );
    await queryRunner.query(
      "INSERT INTO restore_migration VALUES ('migration ran')",
    );
  }
  async down(queryRunner) {
    await queryRunner.query("DROP TABLE restore_migration");
  }
}

const database = new DataSource({
  type: "postgres",
  host: "pg",
  port: 5432,
  username: "review",
  password,
  database: "review_source",
  migrations: [BackupRestoreMigration1760000000000],
});
const config = {
  ...configuration,
  DB: {
    ...configuration.DB,
    SYSTEM: "POSTGRESQL",
    HOST: "pg",
    PORT: 5432,
    USERNAME: "review",
    PASSWORD: password,
    DATABASE: "review_source",
  },
  VOLUMES: { ...configuration.VOLUMES, SQLITEDB: "/db" },
  TESTING: { ...configuration.TESTING, IN_MEMORY_DB: false },
};
const directory = await mkdtemp(join(tmpdir(), "playstash-backup-fixture-"));
try {
  await database.initialize();
  const serverVersion = (await database.query("SHOW server_version"))[0]
    .server_version;
  assert.match(serverVersion, /^16\./);
  const clients = await selectPostgresClients(database);
  assert.equal(clients.dump, "/usr/libexec/postgresql16/pg_dump");
  assert.equal(clients.restore, "/usr/libexec/postgresql16/pg_restore");
  const dumpVersion = execFileSync(clients.dump, ["--version"], {
    encoding: "utf8",
  }).trim();
  const restoreVersion = execFileSync(clients.restore, ["--version"], {
    encoding: "utf8",
  }).trim();
  assert.match(dumpVersion, /PostgreSQL\) 16\./);
  assert.match(restoreVersion, /PostgreSQL\) 16\./);
  await database.query(
    "CREATE TABLE restore_parent (id integer PRIMARY KEY, marker text NOT NULL)",
  );
  await database.query(
    "CREATE TABLE restore_child (id integer PRIMARY KEY, parent_id integer NOT NULL REFERENCES restore_parent(id), marker text NOT NULL)",
  );
  await database.query(
    "INSERT INTO restore_parent VALUES (1, 'original parent')",
  );
  await database.query(
    "INSERT INTO restore_child VALUES (2, 1, 'original child')",
  );
  const readState = async () => ({
    parents: await database.query("SELECT * FROM restore_parent ORDER BY id"),
    children: await database.query("SELECT * FROM restore_child ORDER BY id"),
  });
  const original = await readState();
  const service = new DatabaseService(database, config);
  const tar = join(directory, "backup with spaces.tar");
  (await service.backupPostgresql(tar)).getStream().destroy();
  assert.ok(
    (await stat(tar)).size > 512,
    "The backup must contain a real TAR archive.",
  );
  const contents = execFileSync(
    clients.restore,
    ["--list", "--format=t", tar],
    { encoding: "utf8" },
  );
  assert.match(contents, /TABLE DATA public restore_parent/);
  assert.match(contents, /FK CONSTRAINT public restore_child/);
  await database.query("UPDATE restore_parent SET marker = 'changed parent'");
  await database.query("DELETE FROM restore_child");
  await service.restore({ path: tar }, password);
  assert.deepEqual(await readState(), original);
  const migrationState = await database.query(
    "SELECT * FROM restore_migration",
  );
  assert.deepEqual(migrationState, [{ marker: "migration ran" }]);
  await assert.rejects(stat(tar), { code: "ENOENT" });
  const badTar = join(directory, "invalid incoming; literal.tar");
  await writeFile(badTar, "This is not a PostgreSQL backup.");
  await assert.rejects(service.restore({ path: badTar }, password), (error) => {
    assert.equal(error.getStatus(), 500);
    assert.match(error.message, /original database was retained or recovered/);
    return true;
  });
  assert.deepEqual(await readState(), original);
  assert.deepEqual(
    await database.query("SELECT * FROM restore_migration"),
    migrationState,
  );
  await assert.rejects(stat(badTar), { code: "ENOENT" });
  await assert.rejects(
    database.query("INSERT INTO restore_child VALUES (3, 999, 'orphan')"),
    { code: "23503" },
  );
  console.log(
    `PLAYSTASH_POSTGRES_BACKUP_RESULT ${JSON.stringify({
      actualService: "DatabaseService.restore",
      serverVersion,
      dumpVersion,
      restoreVersion,
      selectedPostgreSQL16Clients: true,
      tarBackupRestoreRoundtrip: true,
      migrationsAfterSuccessfulRestore: true,
      invalidRestoreHttpStatus: 500,
      rollbackPreservedAllFixtureRows: true,
      foreignKeyConstraintRetained: true,
      temporaryUploadsRemoved: true,
    })}`,
  );
} finally {
  if (database.isInitialized) await database.destroy();
  await rm(directory, { recursive: true, force: true });
}
