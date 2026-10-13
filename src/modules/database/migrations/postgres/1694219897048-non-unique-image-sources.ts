import { MigrationInterface, type QueryRunner } from "typeorm";

export class NonUniqueImageSources1694219897048 implements MigrationInterface {
  name = "NonUniqueImageSources1694219897048";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "image" DROP CONSTRAINT IF EXISTS "UQ_e0626148aee5829fd312447001a"
        `);
    await queryRunner.query(`
            ALTER TABLE "progress" DROP CONSTRAINT "FK_ddcaca3a9db9d77105d51c02c24"
        `);
    await queryRunner.query(`
            ALTER TABLE "image" DROP CONSTRAINT "FK_81cba867ad852a0b6402f0e82fb"
        `);
    await queryRunner.query(`
            CREATE SEQUENCE IF NOT EXISTS "playstash_user_id_seq" OWNED BY "playstash_user"."id"
        `);
    await queryRunner.query(`
            ALTER TABLE "playstash_user"
            ALTER COLUMN "id"
            SET DEFAULT nextval('"playstash_user_id_seq"')
        `);
    await queryRunner.query(`
            ALTER TABLE "image"
            ADD CONSTRAINT "FK_81cba867ad852a0b6402f0e82fb" FOREIGN KEY ("uploader_id") REFERENCES "playstash_user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "progress"
            ADD CONSTRAINT "FK_ddcaca3a9db9d77105d51c02c24" FOREIGN KEY ("user_id") REFERENCES "playstash_user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "progress" DROP CONSTRAINT "FK_ddcaca3a9db9d77105d51c02c24"
        `);
    await queryRunner.query(`
            ALTER TABLE "image" DROP CONSTRAINT "FK_81cba867ad852a0b6402f0e82fb"
        `);
    await queryRunner.query(`
            ALTER TABLE "playstash_user"
            ALTER COLUMN "id" DROP DEFAULT
        `);
    await queryRunner.query(`
            DROP SEQUENCE "playstash_user_id_seq"
        `);
    await queryRunner.query(`
            ALTER TABLE "image"
            ADD CONSTRAINT "FK_81cba867ad852a0b6402f0e82fb" FOREIGN KEY ("uploader_id") REFERENCES "playstash_user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "progress"
            ADD CONSTRAINT "FK_ddcaca3a9db9d77105d51c02c24" FOREIGN KEY ("user_id") REFERENCES "playstash_user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "image"
            ADD CONSTRAINT "UQ_e0626148aee5829fd312447001a" UNIQUE ("source")
        `);
  }
}
