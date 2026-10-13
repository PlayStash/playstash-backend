import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  type Relation,
} from "typeorm";
import { DatabaseEntity } from "../database/database.entity.js";
import { PlaystashGame } from "../games/playstash-game.entity.js";
import { PlaystashUser } from "../users/playstash-user.entity.js";

@Entity()
@Index(["game_id", "user_id"], { unique: true })
export class GameReview extends DatabaseEntity {
  @Column({ type: "int" })
  game_id!: number;

  @ManyToOne(() => PlaystashGame, { onDelete: "CASCADE" })
  @JoinColumn({ name: "game_id" })
  game!: Relation<PlaystashGame>;

  @Column({ type: "int" })
  user_id!: number;

  @ManyToOne(() => PlaystashUser, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user!: Relation<PlaystashUser>;

  @Column({ type: "int" })
  rating!: number;

  @Column({ type: "text", default: "" })
  comment!: string;
}
