import { ApiProperty } from "@nestjs/swagger";
import { Column, Entity, Index } from "typeorm";
import { DatabaseEntity } from "../database/database.entity.js";

@Entity()
export class PlaystashServer extends DatabaseEntity {
  @Index({ unique: true })
  @Column({ unique: true, nullable: false })
  @ApiProperty({
    description: "Persistent unique identifier of the playstash server",
    example: "550e8400-e29b-41d4-a716-446655440000",
  })
  uuid!: string;
}
