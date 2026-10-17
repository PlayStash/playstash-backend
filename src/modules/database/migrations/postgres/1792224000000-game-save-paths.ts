import { MigrationInterface, type QueryRunner } from "typeorm";

export class GameSavePaths1792224000000 implements MigrationInterface {
  name = "GameSavePaths1792224000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE game_metadata
      ADD COLUMN save_paths text;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE game_metadata
      DROP COLUMN save_paths;
    `);
  }
}
