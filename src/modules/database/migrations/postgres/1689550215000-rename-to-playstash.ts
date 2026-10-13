import { MigrationInterface, type QueryRunner } from "typeorm";

export class RenameToPlaystash1689550215000 implements MigrationInterface {
  name = "RenameToPlaystash1689550215000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "ALTER TABLE crackpipe_user RENAME TO playstash_user;",
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "ALTER TABLE playstash_user RENAME TO crackpipe_user;",
    );
  }
}
