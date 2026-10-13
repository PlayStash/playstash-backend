import { UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import configuration from "../../../configuration.js";

import type { Mocked } from "vitest";
import { Role } from "../../users/models/role.enum.js";
import { ApiKeyGuard } from "./api-key.guard.js";

vi.mock("../../../configuration.js", () => ({
  __esModule: true,
  default: {
    TESTING: { AUTHENTICATION_DISABLED: false },
  },
}));

vi.mock("../../../logging.js", () => ({
  __esModule: true,
  default: {
    log: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
  logPlaystashGame: vi.fn(),
  logPlaystashUser: vi.fn(),
  logMedia: vi.fn(),
  logMetadata: vi.fn(),
  logMetadataProvider: vi.fn(),
  logProgress: vi.fn(),
}));

describe("ApiKeyGuard", () => {
  let guard: ApiKeyGuard;
  let reflector: Mocked<Reflector>;
  let mockApiKeyService: any;

  beforeEach(() => {
    reflector = {
      getAllAndOverride: vi.fn(),
    } as any;

    mockApiKeyService = {
      findUserByApiKeyOrFail: vi.fn(),
    };

    guard = new ApiKeyGuard(mockApiKeyService, reflector, configuration as any);
  });

  function httpContext(apiKey?: string) {
    const req: any = { headers: {}, user: undefined };
    if (apiKey) req.headers["x-api-key"] = apiKey;
    return {
      getHandler: vi.fn(),
      getClass: vi.fn(),
      getType: () => "http",
      switchToHttp: () => ({ getRequest: () => req }),
      switchToWs: vi.fn(),
    } as any;
  }

  function wsContext(apiKey?: string) {
    const client: any = {
      handshake: { headers: {} },
      emit: vi.fn(),
      disconnect: vi.fn(),
      id: "ws-1",
      user: undefined,
    };
    if (apiKey) client.handshake.headers["x-api-key"] = apiKey;
    return {
      getHandler: vi.fn(),
      getClass: vi.fn(),
      getType: () => "ws",
      switchToWs: () => ({ getClient: () => client }),
      switchToHttp: vi.fn(),
    } as any;
  }

  // ─── Skip guards ──────────────────────────────────────────────────

  it("should skip when guard name is in skip-guards", async () => {
    reflector.getAllAndOverride.mockReturnValue(["ApiKeyGuard"]);
    const result = await guard.canActivate(httpContext("key-123"));
    expect(result).toBe(true);
  });

  // ─── No API key ───────────────────────────────────────────────────

  it("should pass through when no API key is provided (HTTP)", async () => {
    reflector.getAllAndOverride.mockReturnValue(null);
    const result = await guard.canActivate(httpContext());
    expect(result).toBe(true);
  });

  it("rejects unauthenticated WebSocket messages instead of invoking HTTP JWT authentication", async () => {
    reflector.getAllAndOverride.mockReturnValue(null);
    const ctx = wsContext();
    const result = await guard.canActivate(ctx);
    expect(result).toBe(false);
    const client = ctx.switchToWs().getClient();
    expect(client.emit).toHaveBeenCalledWith(
      "exception",
      expect.objectContaining({ status: "error" }),
    );
  });

  // ─── Valid API key ────────────────────────────────────────────────

  it("should authenticate user via API key (HTTP)", async () => {
    reflector.getAllAndOverride.mockReturnValue(null);
    const user = {
      username: "testuser",
      role: Role.USER,
      activated: true,
      deleted_at: null,
    };
    mockApiKeyService.findUserByApiKeyOrFail.mockResolvedValue(user);

    const ctx = httpContext("valid-key");
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
    expect(ctx.switchToHttp().getRequest().user).toBe(user);
  });

  it("should authenticate user via API key (WebSocket)", async () => {
    reflector.getAllAndOverride.mockReturnValue(null);
    const user = {
      username: "testuser",
      role: Role.USER,
      activated: true,
      deleted_at: null,
    };
    mockApiKeyService.findUserByApiKeyOrFail.mockResolvedValue(user);

    const ctx = wsContext("valid-key");
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
    expect(ctx.switchToWs().getClient().user).toBe(user);
  });
  it("authenticates browser WebSockets through handshake auth without a query-string key", async () => {
    const user = { id: 1, role: Role.USER, activated: true };
    mockApiKeyService.findUserByApiKeyOrFail.mockResolvedValue(user);
    const context = wsContext();
    context.switchToWs().getClient().handshake.auth = {
      api_key: "browser-key",
    };
    expect(await guard.canActivate(context)).toBe(true);
    expect(mockApiKeyService.findUserByApiKeyOrFail).toHaveBeenCalledWith(
      "browser-key",
    );
    expect(context.switchToWs().getClient().user).toBe(user);
  });

  // ─── Deleted user ─────────────────────────────────────────────────

  it("should throw UnauthorizedException for deleted user", async () => {
    reflector.getAllAndOverride.mockReturnValue(null);
    mockApiKeyService.findUserByApiKeyOrFail.mockResolvedValue({
      username: "deleted",
      deleted_at: new Date(),
      activated: true,
      role: Role.USER,
    });

    await expect(guard.canActivate(httpContext("key"))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  // ─── Inactive user ────────────────────────────────────────────────

  it("should throw NotAcceptableException for inactive non-admin user", async () => {
    reflector.getAllAndOverride.mockReturnValue(null);
    mockApiKeyService.findUserByApiKeyOrFail.mockResolvedValue({
      username: "inactive",
      deleted_at: null,
      activated: false,
      role: Role.USER,
    });

    // The NotAcceptableException is thrown inside the try, caught by catch,
    // and re-thrown as UnauthorizedException for HTTP
    await expect(guard.canActivate(httpContext("key"))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it("rejects inactive administrators for HTTP and disconnects their WebSockets", async () => {
    reflector.getAllAndOverride.mockReturnValue(null);
    mockApiKeyService.findUserByApiKeyOrFail.mockResolvedValue({
      username: "admin",
      deleted_at: null,
      activated: false,
      role: Role.ADMIN,
    });

    await expect(guard.canActivate(httpContext("key"))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    const context = wsContext("key");
    expect(await guard.canActivate(context)).toBe(false);
    expect(context.switchToWs().getClient().disconnect).toHaveBeenCalledWith(
      true,
    );
  });

  // ─── Invalid API key ──────────────────────────────────────────────

  it("should throw UnauthorizedException for invalid API key (HTTP)", async () => {
    reflector.getAllAndOverride.mockReturnValue(null);
    mockApiKeyService.findUserByApiKeyOrFail.mockRejectedValue(
      new Error("Invalid"),
    );

    await expect(guard.canActivate(httpContext("bad-key"))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it("should return false and emit exception for invalid API key (WS)", async () => {
    reflector.getAllAndOverride.mockReturnValue(null);
    mockApiKeyService.findUserByApiKeyOrFail.mockRejectedValue(
      new Error("Invalid"),
    );

    const ctx = wsContext("bad-key");
    const result = await guard.canActivate(ctx);
    expect(result).toBe(false);
    const client = ctx.switchToWs().getClient();
    expect(client.emit).toHaveBeenCalledWith(
      "exception",
      expect.objectContaining({ message: "Unauthorized" }),
    );
  });
});
