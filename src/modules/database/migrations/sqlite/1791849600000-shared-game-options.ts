import { type MigrationInterface, type QueryRunner } from "typeorm";

export class SharedGameOptions1791849600000 implements MigrationInterface {
  name = "SharedGameOptions1791849600000";

  async up(queryRunner: QueryRunner): Promise<void> {
    for (const column of [
      "archive_password",
      "system_requirements_minimum",
      "system_requirements_recommended",
      "launch_profiles",
    ]) {
      await queryRunner.query(
        `ALTER TABLE game_metadata ADD COLUMN ${column} text`,
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const column of [
      "launch_profiles",
      "system_requirements_recommended",
      "system_requirements_minimum",
      "archive_password",
    ]) {
      await queryRunner.query(
        `ALTER TABLE game_metadata DROP COLUMN ${column}`,
      );
    }
  }
}
