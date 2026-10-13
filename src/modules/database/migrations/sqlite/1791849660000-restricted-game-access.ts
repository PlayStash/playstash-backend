import type { MigrationInterface, QueryRunner } from "typeorm";

export class RestrictedGameAccess1791849660000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "playstash_game" ADD COLUMN "access_restricted" boolean NOT NULL DEFAULT 0',
    );
    await queryRunner.query(
      'ALTER TABLE "playstash_user" ADD COLUMN "share_restricted_activity" boolean NOT NULL DEFAULT 0',
    );
    await queryRunner.query(
      'CREATE TABLE "game_access" ("game_id" integer NOT NULL REFERENCES "playstash_game" ("id") ON DELETE CASCADE, "user_id" integer NOT NULL REFERENCES "playstash_user" ("id") ON DELETE CASCADE, PRIMARY KEY ("game_id", "user_id"))',
    );
    await queryRunner.query(
      'CREATE INDEX "IDX_GAME_ACCESS_USER" ON "game_access" ("user_id")',
    );
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "game_access"');
    await queryRunner.query(
      'ALTER TABLE "playstash_user" DROP COLUMN "share_restricted_activity"',
    );
    await queryRunner.query(
      'ALTER TABLE "playstash_game" DROP COLUMN "access_restricted"',
    );
  }
}
