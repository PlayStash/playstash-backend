import { Logger } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import configuration from "../../../configuration.js";
import { type UsersService } from "../../users/users.service.js";
import { AuthenticationStrategy } from "./authentication.strategy.js";
import { OAuth2Strategy } from "./oauth2.strategy.js";
import { RefreshTokenStrategy } from "./refresh-token.strategy.js";

describe("Authentication identity isolation", () => {
  const user = { id: 12, username: "renamed-user", activated: true };
  const config = {
    ...configuration,
    AUTH: {
      ...configuration.AUTH,
      OAUTH2: {
        ...configuration.AUTH.OAUTH2,
        AUTH_URL: "https://idp.example/auth",
        TOKEN_URL: "https://idp.example/token",
        USERINFO_URL: "https://idp.example/userinfo",
        CALLBACK_URL: "https://stash.example/callback",
        CLIENT_ID: "stash",
        CLIENT_SECRET: "test-secret",
      },
    },
    USERS: {
      ...configuration.USERS,
      REQUIRE_EMAIL: false,
      REQUIRE_FIRST_NAME: false,
      REQUIRE_LAST_NAME: false,
    },
  };
  let users: {
    findUserForAuthOrFail: ReturnType<typeof vi.fn>;
    findOneByUserIdOrFail: ReturnType<typeof vi.fn>;
    findUserBySsoIdentity: ReturnType<typeof vi.fn>;
    register: ReturnType<typeof vi.fn>;
  };
  beforeEach(() => {
    users = {
      findUserForAuthOrFail: vi.fn().mockResolvedValue(user),
      findOneByUserIdOrFail: vi.fn().mockResolvedValue(user),
      findUserBySsoIdentity: vi.fn().mockResolvedValue(user),
      register: vi.fn().mockResolvedValue(user),
    };
    vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  for (const kind of ["access", "refresh"]) {
    it(`${kind} token ignores recycled username and email`, async () => {
      const strategy =
        kind === "access"
          ? new AuthenticationStrategy(users as unknown as UsersService, config)
          : new RefreshTokenStrategy(
              users as unknown as UsersService,
              { isTokenRevoked: vi.fn().mockResolvedValue(false) } as any,
              config,
            );
      const dto = {
        payload: {
          sub: 12,
          preferred_username: "other-admin",
          email: "admin@example.com",
        },
      };
      await (kind === "access"
        ? (strategy as AuthenticationStrategy).validate(dto as any)
        : (strategy as RefreshTokenStrategy).validate(
            { headers: { authorization: "Bearer test" } } as any,
            dto as any,
          ));
      expect(users.findUserForAuthOrFail).toHaveBeenCalledWith({ id: 12 });
      expect(users.findOneByUserIdOrFail).toHaveBeenCalledWith(12, {
        loadRelations: false,
      });
    });
  }
  it.each([undefined, "", "abc", "0", "-1", "1.5", "Infinity"])(
    "rejects invalid JWT subject %s",
    async (sub) => {
      await expect(
        new AuthenticationStrategy(
          users as unknown as UsersService,
          config,
        ).validate({ payload: { sub } } as any),
      ).rejects.toThrow("Invalid token subject");
      expect(users.findUserForAuthOrFail).not.toHaveBeenCalled();
    },
  );
  it("uses authenticated UserInfo sub even when forged token/profile claims name an admin", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ sub: "real-sub", preferred_username: "admin" }),
          ),
        ),
    );
    const done = vi.fn();
    await new OAuth2Strategy(users as unknown as UsersService, config).validate(
      {} as any,
      "opaque-token",
      "refresh",
      { id_token: "forged-admin" },
      { id: "forged-admin" },
      done,
    );
    expect(users.findUserBySsoIdentity).toHaveBeenCalledWith(
      expect.stringMatching(/^[a-f0-9]{64}$/),
      "real-sub",
    );
    expect(users.register).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith(
      "https://idp.example/userinfo",
      expect.objectContaining({ redirect: "error" }),
    );
    expect(done).toHaveBeenCalledWith(null, user);
  });
  it("does not link an existing local admin by colliding username", async () => {
    users.findUserBySsoIdentity.mockResolvedValue(null);
    users.register.mockRejectedValue(new Error("username already exists"));
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ sub: "attacker", preferred_username: "admin" }),
          ),
        ),
    );
    const done = vi.fn();
    await expect(
      new OAuth2Strategy(users as unknown as UsersService, config).validate(
        {} as any,
        "token",
        "",
        {},
        {},
        done,
      ),
    ).rejects.toThrow("already exists");
    expect(users.findUserForAuthOrFail).not.toHaveBeenCalled();
    expect(done).not.toHaveBeenCalled();
  });
  it.each([
    { sub: "" },
    { sub: 123 },
    { sub: "valid", email: { token: "secret" } },
    { sub: "x".repeat(256) },
  ])("rejects invalid provider data", async (info) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify(info))),
    );
    await expect(
      new OAuth2Strategy(users as unknown as UsersService, config).validate(
        {} as any,
        "token",
        "",
        {},
        {},
        vi.fn(),
      ),
    ).rejects.toThrow("valid UserInfo");
    expect(users.findUserBySsoIdentity).not.toHaveBeenCalled();
  });
  it("rejects oversized UserInfo and does not log secrets in provider errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("secret-token".repeat(7000))),
    );
    await expect(
      new OAuth2Strategy(users as unknown as UsersService, config).validate(
        {} as any,
        "access-secret",
        "refresh-secret",
        {},
        {},
        vi.fn(),
      ),
    ).rejects.toThrow("valid UserInfo");
    expect(Logger.prototype.warn).toHaveBeenCalledWith(
      "OAuth2 UserInfo verification failed.",
    );
  });
});
