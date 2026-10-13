import type {
  FindOptionsWhere,
  ObjectLiteral,
  SelectQueryBuilder,
} from "typeorm";
import type { Progress } from "../progresses/progress.entity.js";
import { Role } from "../users/models/role.enum.js";
import type { PlaystashUser } from "../users/playstash-user.entity.js";
import type { PlaystashGame } from "./playstash-game.entity.js";

export function canAccessGame(
  game: PlaystashGame,
  user?: PlaystashUser,
): boolean {
  return (
    !game.access_restricted ||
    user?.role === Role.ADMIN ||
    (!!user &&
      (game.allowed_user_ids?.includes(user.id) ||
        !!game.allowed_users?.some((allowed) => allowed.id === user.id)))
  );
}

export function gameAccessWhere(
  user: PlaystashUser | undefined,
  base: FindOptionsWhere<PlaystashGame> = {},
): FindOptionsWhere<PlaystashGame>[] | FindOptionsWhere<PlaystashGame> {
  if (!user || user.role === Role.ADMIN) return base;
  return [
    { ...base, access_restricted: false },
    { ...base, allowed_users: { id: user.id } },
  ];
}

/** Fixed aliases/identifiers; user IDs are always bound parameters. */
export function applyGameAccessFilter<T extends ObjectLiteral>(
  query: SelectQueryBuilder<T>,
  alias: string,
  user?: PlaystashUser,
): void {
  if (!user) {
    query.andWhere("1 = 0");
    return;
  }
  if (user.role === Role.ADMIN) return;
  if (!/^[a-zA-Z0-9_]+$/.test(alias))
    throw new Error("Invalid internal game query alias.");
  query.andWhere(
    `(${alias}.access_restricted = :accessPublic OR EXISTS (SELECT 1 FROM game_access allowed WHERE allowed.game_id = ${alias}.id AND allowed.user_id = :accessUserId))`,
    { accessPublic: false, accessUserId: user.id },
  );
}

export function redactRestrictedProgress(
  game: PlaystashGame,
  user?: PlaystashUser,
): PlaystashGame {
  if (game.allowed_users) {
    game.allowed_user_ids = game.allowed_users.map((allowed) => allowed.id);
    delete game.allowed_users;
  }
  if (game.access_restricted && game.progresses) {
    game.progresses = game.progresses.filter(
      (progress) =>
        progress.user?.id === user?.id ||
        progress.user?.share_restricted_activity === true,
    );
  }
  return game;
}

export function restrictedProgressWhere(
  user: PlaystashUser,
): FindOptionsWhere<Progress>[] {
  const restricted: FindOptionsWhere<PlaystashGame> =
    user.role === Role.ADMIN
      ? { access_restricted: true }
      : { access_restricted: true, allowed_users: { id: user.id } };
  return [
    { game: { access_restricted: false } },
    { game: restricted, user: { id: user.id } },
    { game: restricted, user: { share_restricted_activity: true } },
  ];
}
