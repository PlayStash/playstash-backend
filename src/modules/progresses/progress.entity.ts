import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Column, Entity, Index, ManyToOne, type Relation } from "typeorm";

import { DatabaseEntity } from "../database/database.entity.js";
import { PlaystashGame } from "../games/playstash-game.entity.js";
import { PlaystashUser } from "../users/playstash-user.entity.js";
import { State } from "./models/state.enum.js";

@Entity()
export class Progress extends DatabaseEntity {
  @Index()
  @ManyToOne(() => PlaystashUser, (user) => user.progresses)
  @ApiPropertyOptional({
    description: "user the progress belongs to",
    type: () => PlaystashUser,
  })
  user?: Relation<PlaystashUser>;

  @Index()
  @ManyToOne(() => PlaystashGame, (game) => game.progresses)
  @ApiPropertyOptional({
    description: "game the progress belongs to",
    type: () => PlaystashGame,
  })
  game?: Relation<PlaystashGame>;

  @Column({ type: "int", default: 0 })
  @ApiProperty({
    description: "playtime in minutes",
    example: 25,
  })
  minutes_played!: number;

  @Column({ type: "simple-enum", enum: State, default: State.UNPLAYED })
  @ApiProperty({
    description: "state of the game progress",
    type: "string",
    enum: State,
    example: State.PLAYING,
  })
  state!: State;

  @Column({ nullable: true })
  @ApiPropertyOptional({
    description: "date the progress was updated",
    example: "2020-01-01T00:00:00.000Z",
  })
  last_played_at?: Date;
}
