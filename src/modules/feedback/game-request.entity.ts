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

export enum RequestStatus {
  OPEN = "open",
  APPROVED = "approved",
  FULFILLED = "fulfilled",
  REJECTED = "rejected",
}

@Entity()
@Index(["user_id", "created_at"])
export class GameRequest extends DatabaseEntity {
  @Column({ type: "int" })
  user_id!: number;

  @ManyToOne(() => PlaystashUser, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user!: Relation<PlaystashUser>;

  @Column({ type: "varchar", length: 256 })
  title!: string;

  @Column({ type: "text", default: "" })
  note!: string;

  @Column({ type: "boolean", default: false })
  anonymous!: boolean;

  @Column({
    type: "simple-enum",
    enum: RequestStatus,
    default: RequestStatus.OPEN,
  })
  status!: RequestStatus;

  @Column({ type: "int", nullable: true })
  game_id!: number | null;

  @ManyToOne(() => PlaystashGame, { onDelete: "SET NULL", nullable: true })
  @JoinColumn({ name: "game_id" })
  game?: Relation<PlaystashGame> | null;

  @Column({ type: Date, nullable: true })
  user_seen_at!: Date | null;
}
