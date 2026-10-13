import {
  TableColumn,
  TableIndex,
  type MigrationInterface,
  type QueryRunner,
} from "typeorm";

export class SsoIdentities1791921600000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumns("playstash_user", [
      new TableColumn({
        name: "sso_provider",
        type: "varchar",
        length: "64",
        isNullable: true,
      }),
      new TableColumn({
        name: "sso_subject",
        type: "varchar",
        length: "255",
        isNullable: true,
      }),
    ]);
    await queryRunner.createIndex(
      "playstash_user",
      new TableIndex({
        name: "IDX_USER_SSO_IDENTITY",
        columnNames: ["sso_provider", "sso_subject"],
        isUnique: true,
      }),
    );
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex("playstash_user", "IDX_USER_SSO_IDENTITY");
    await queryRunner.dropColumn("playstash_user", "sso_subject");
    await queryRunner.dropColumn("playstash_user", "sso_provider");
  }
}
