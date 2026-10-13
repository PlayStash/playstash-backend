import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  type Relation,
} from "typeorm";
import { DatabaseEntity } from "../database/database.entity.js";
import { GameVersion } from "../games/game-version.entity.js";
import { PlaystashGame } from "../games/playstash-game.entity.js";
import { PlaystashUser } from "../users/playstash-user.entity.js";
import { GameClientEventType } from "./models/game-client-event.dto.js";

@Entity({ name: "game_client_event" })
export class GameClientEvent extends DatabaseEntity {
  @Column({ length: 36 })
  @Index("UQ_GAME_CLIENT_EVENT_ID", { unique: true })
  event_id!: string;
  @Column({ type: "simple-enum", enum: GameClientEventType })
  type!: GameClientEventType;
  @ManyToOne(() => PlaystashUser, { nullable: false, onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user!: Relation<PlaystashUser>;
  @ManyToOne(() => PlaystashGame, { nullable: false, onDelete: "CASCADE" })
  @JoinColumn({ name: "game_id" })
  game!: Relation<PlaystashGame>;
  @ManyToOne(() => GameVersion, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "version_id" })
  version?: Relation<GameVersion> | null;
  @Column({ type: "varchar", nullable: true, length: 36 }) installation_id?:
    string | null;
  @Column() @Index("IDX_GAME_CLIENT_EVENT_OCCURRED") occurred_at!: Date;
  @Column({ default: 0 }) minutes_played!: number;
}
