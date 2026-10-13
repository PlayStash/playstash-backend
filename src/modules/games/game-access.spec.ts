import { Role } from "../users/models/role.enum.js";
import {
  applyGameAccessFilter,
  canAccessGame,
  gameAccessWhere,
  redactRestrictedProgress,
  restrictedProgressWhere,
} from "./game-access.js";

describe("game access", () => {
  const user = { id: 7, role: Role.USER } as any;
  it("allows public games and administrators but denies unlisted restricted users", () => {
    expect(canAccessGame({ access_restricted: false } as any, user)).toBe(true);
    expect(
      canAccessGame(
        { access_restricted: true, allowed_user_ids: [7] } as any,
        user,
      ),
    ).toBe(true);
    expect(
      canAccessGame(
        { access_restricted: true, allowed_users: [{ id: 8 }] } as any,
        user,
      ),
    ).toBe(false);
    expect(
      canAccessGame({ access_restricted: true } as any, {
        ...user,
        role: Role.ADMIN,
      }),
    ).toBe(true);
    expect(canAccessGame({ access_restricted: true } as any)).toBe(false);
  });
  it("keeps every preexisting query condition in both visibility branches", () => {
    expect(gameAccessWhere(user, { id: 42 })).toEqual([
      { id: 42, access_restricted: false },
      { id: 42, allowed_users: { id: 7 } },
    ]);
  });
  it("uses parameterized membership checks and rejects unsafe internal aliases", () => {
    const query = { andWhere: vi.fn() } as any;
    applyGameAccessFilter(query, "game", user);
    expect(query.andWhere).toHaveBeenCalledWith(
      expect.stringContaining("EXISTS"),
      { accessPublic: false, accessUserId: 7 },
    );
    expect(() =>
      applyGameAccessFilter(query, "game; DROP TABLE", user),
    ).toThrow();
  });
  it("fails closed for unauthenticated facet queries", () => {
    const query = { andWhere: vi.fn() } as any;
    applyGameAccessFilter(query, "game");
    expect(query.andWhere).toHaveBeenCalledWith("1 = 0");
  });
  it("restricts progress to public games, self, or explicitly shared private activity", () => {
    expect(restrictedProgressWhere(user)).toEqual([
      { game: { access_restricted: false } },
      {
        game: { access_restricted: true, allowed_users: { id: 7 } },
        user: { id: 7 },
      },
      {
        game: { access_restricted: true, allowed_users: { id: 7 } },
        user: { share_restricted_activity: true },
      },
    ]);
  });
  it("removes full allowed-user objects and hides other users' private progress", () => {
    const game = redactRestrictedProgress(
      {
        access_restricted: true,
        allowed_users: [{ id: 7, email: "secret" }],
        progresses: [
          { user: { id: 7 } },
          { user: { id: 8, share_restricted_activity: false } },
          { user: { id: 9, share_restricted_activity: true } },
        ],
      } as any,
      user,
    );
    expect(game.allowed_users).toBeUndefined();
    expect(game.allowed_user_ids).toEqual([7]);
    expect(game.progresses?.map((progress) => progress.user?.id)).toEqual([
      7, 9,
    ]);
  });
});
