import type { MigrationInterface, QueryRunner } from "typeorm";
export class GameClientEvents1791849720000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "playstash_user" ADD COLUMN "report_game_metrics" boolean NOT NULL DEFAULT 1',
    );
    await queryRunner.query(`CREATE TABLE "game_client_event" (
      "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      "created_at" datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "deleted_at" datetime, "entity_version" integer NOT NULL DEFAULT 1,
      "event_id" varchar(36) NOT NULL,
      "type" varchar NOT NULL CHECK ("type" IN ('downloaded', 'installed', 'uninstalled', 'played')),
      "user_id" integer NOT NULL REFERENCES "playstash_user" ("id") ON DELETE CASCADE,
      "game_id" integer NOT NULL REFERENCES "playstash_game" ("id") ON DELETE CASCADE,
      "version_id" integer REFERENCES "game_version" ("id") ON DELETE SET NULL,
      "installation_id" varchar(36), "occurred_at" datetime NOT NULL,
      "minutes_played" integer NOT NULL DEFAULT 0 CHECK ("minutes_played" >= 0))`);
    await queryRunner.query(
      'CREATE UNIQUE INDEX "UQ_GAME_CLIENT_EVENT_ID" ON "game_client_event" ("event_id")',
    );
    await queryRunner.query(
      'CREATE INDEX "IDX_GAME_CLIENT_EVENT_OCCURRED" ON "game_client_event" ("occurred_at")',
    );
    await queryRunner.query(
      'CREATE INDEX "IDX_GAME_CLIENT_EVENT_GAME_USER" ON "game_client_event" ("game_id", "user_id")',
    );
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "game_client_event"');
    await queryRunner.query(
      'ALTER TABLE "playstash_user" DROP COLUMN "report_game_metrics"',
    );
  }
}
