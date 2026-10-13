import { type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { type Socket } from "socket.io";
import { ApiKeyGuard } from "../auth/guards/api-key.guard.js";
import { AuthenticationGuard } from "../auth/guards/authentication.guard.js";
import { ActivityGateway } from "./activity.gateway.js";
import { Role } from "./models/role.enum.js";

describe("activity message guard order", () => {
  const user = { id: 7, username: "reader", role: Role.USER, activated: true };
  const config = { TESTING: { AUTHENTICATION_DISABLED: false } } as any;
  let apiKeys: { findUserByApiKeyOrFail: ReturnType<typeof vi.fn> };
  let apiGuard: ApiKeyGuard;
  let jwtGuard: AuthenticationGuard;
  let client: Socket;
  let context: ExecutionContext;

  beforeEach(() => {
    const reflector = new Reflector();
    apiKeys = { findUserByApiKeyOrFail: vi.fn().mockResolvedValue(user) };
    apiGuard = new ApiKeyGuard(apiKeys as any, reflector, config);
    jwtGuard = new AuthenticationGuard(reflector, config);
    client = {
      id: "browser-socket",
      handshake: { headers: {}, auth: { api_key: "browser-key" } },
      emit: vi.fn(),
      disconnect: vi.fn(),
    } as unknown as Socket;
    context = {
      getHandler: () => ActivityGateway.prototype.chatHistory,
      getClass: () => ActivityGateway,
      getType: () => "ws",
      // This is what Nest passes to HTTP-oriented global guards for a socket.
      // The client deliberately has no HTTP request.headers property.
      switchToHttp: () => ({ getRequest: () => client }),
      switchToWs: () => ({ getClient: () => client }),
    } as unknown as ExecutionContext;
  });

  it("skips HTTP JWT extraction and then authenticates a browser key for chat", async () => {
    expect(await jwtGuard.canActivate(context)).toBe(true);
    expect(await apiGuard.canActivate(context)).toBe(true);
    expect(apiKeys.findUserByApiKeyOrFail).toHaveBeenCalledWith("browser-key");
    const users = { findOneByUserIdOrFail: vi.fn().mockResolvedValue(user) };
    const chat = {
      history: vi
        .fn()
        .mockResolvedValue({ conversation: "lobby", messages: [] }),
    };
    const gateway = new ActivityGateway(users as any, {} as any, chat as any);
    expect(await gateway.chatHistory(client, { room: "lobby" })).toEqual({
      event: "chat-history",
      data: { conversation: "lobby", messages: [] },
    });
    expect(chat.history).toHaveBeenCalledWith({ room: "lobby" }, user);
  });

  it.each(["missing", "invalid"])(
    "still blocks %s API keys before message handlers",
    async (failure) => {
      if (failure === "missing") client.handshake.auth = {};
      else
        apiKeys.findUserByApiKeyOrFail.mockRejectedValue(
          new Error("Invalid key"),
        );
      expect(await jwtGuard.canActivate(context)).toBe(true);
      expect(await apiGuard.canActivate(context)).toBe(false);
      expect((client as any).user).toBeUndefined();
      expect(client.emit).toHaveBeenCalledWith(
        "exception",
        expect.objectContaining({ status: "error" }),
      );
    },
  );
});
