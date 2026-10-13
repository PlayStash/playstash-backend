import type { MigrationInterface, QueryRunner } from "typeorm";

export class LibraryFeedback1791849780000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "game_request" (
      "id" SERIAL PRIMARY KEY,
      "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "deleted_at" timestamp, "entity_version" integer NOT NULL DEFAULT 1,
      "user_id" integer NOT NULL REFERENCES "playstash_user" ("id") ON DELETE CASCADE,
      "title" varchar(256) NOT NULL, "note" text NOT NULL DEFAULT '',
      "anonymous" boolean NOT NULL DEFAULT false,
      "status" varchar NOT NULL DEFAULT 'open' CHECK ("status" IN ('open','approved','fulfilled','rejected')),
      "game_id" integer REFERENCES "playstash_game" ("id") ON DELETE SET NULL,
      "user_seen_at" timestamp
    )`);
    await queryRunner.query(
      'CREATE INDEX "IDX_REQUEST_USER_CREATED" ON "game_request" ("user_id", "created_at")',
    );
    await queryRunner.query(`CREATE TABLE "game_review" (
      "id" SERIAL PRIMARY KEY,
      "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "deleted_at" timestamp, "entity_version" integer NOT NULL DEFAULT 1,
      "game_id" integer NOT NULL REFERENCES "playstash_game" ("id") ON DELETE CASCADE,
      "user_id" integer NOT NULL REFERENCES "playstash_user" ("id") ON DELETE CASCADE,
      "rating" integer NOT NULL CHECK ("rating" BETWEEN 1 AND 5),
      "comment" text NOT NULL DEFAULT ''
    )`);
    await queryRunner.query(
      'CREATE UNIQUE INDEX "IDX_REVIEW_GAME_USER" ON "game_review" ("game_id", "user_id")',
    );
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "game_review"');
    await queryRunner.query('DROP TABLE "game_request"');
  }
}
