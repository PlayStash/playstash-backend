import { MigrationInterface, type QueryRunner } from "typeorm";

export class PlaystashServer1785146645374 implements MigrationInterface {
  name = "PlaystashServer1785146645374";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS playstash_server (
        id SERIAL NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT now(),
        updated_at TIMESTAMP NOT NULL DEFAULT now(),
        deleted_at TIMESTAMP,
        entity_version integer NOT NULL DEFAULT 1,
        uuid character varying NOT NULL,
        CONSTRAINT PK_playstash_server_id PRIMARY KEY (id),
        CONSTRAINT UQ_playstash_server_uuid UNIQUE (uuid)
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS IDX_playstash_server_id ON playstash_server (id);
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS IDX_playstash_server_uuid ON playstash_server (uuid);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS IDX_playstash_server_uuid;
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS IDX_playstash_server_id;
    `);

    await queryRunner.query(`
      DROP TABLE IF EXISTS playstash_server;
    `);
  }
}
