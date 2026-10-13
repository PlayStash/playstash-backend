import { ValidationPipe } from "@nestjs/common";
import { APP_GUARD, Reflector } from "@nestjs/core";
import { JwtModule, JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import { hash } from "bcrypt";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import configuration from "../dist/src/configuration.js";
import { AuthenticationService } from "../dist/src/modules/auth/authentication.service.js";
import { PlaystashJwtController } from "../dist/src/modules/auth/controllers/authentication.controller.js";
import { BasicAuthController } from "../dist/src/modules/auth/controllers/basic-auth.controller.js";
import { ApiKeyGuard } from "../dist/src/modules/auth/guards/api-key.guard.js";
import { AuthenticationGuard } from "../dist/src/modules/auth/guards/authentication.guard.js";
import { AuthorizationGuard } from "../dist/src/modules/auth/guards/authorization.guard.js";
import { Session } from "../dist/src/modules/auth/session.entity.js";
import { AuthenticationStrategy } from "../dist/src/modules/auth/strategies/authentication.strategy.js";
import { BasicAuthenticationStrategy } from "../dist/src/modules/auth/strategies/basic-auth.strategy.js";
import { OAuth2Strategy } from "../dist/src/modules/auth/strategies/oauth2.strategy.js";
import { RefreshTokenStrategy } from "../dist/src/modules/auth/strategies/refresh-token.strategy.js";
import { GamesService } from "../dist/src/modules/games/games.service.js";
import { ActivityGateway } from "../dist/src/modules/users/activity.gateway.js";
import { ApiKeyService } from "../dist/src/modules/users/api-key.service.js";
import { ChatService } from "../dist/src/modules/users/chat.service.js";
import { Role } from "../dist/src/modules/users/models/role.enum.js";
import { PlaystashUser } from "../dist/src/modules/users/playstash-user.entity.js";
import { UserStatusEvents } from "../dist/src/modules/users/user-status.events.js";
import { UsersController } from "../dist/src/modules/users/users.controller.js";
import { UsersService } from "../dist/src/modules/users/users.service.js";
import { PLAYSTASH_CONFIG } from "../dist/src/playstash-config.js";

// A real Engine.IO/Socket.IO WebSocket client keeps this probe dependency-free.
// Production DTO metadata, Passport guards, HTTP routes and real ORM persistence
// are exercised together; neither authentication nor transport is mocked.
class LiveSocket {
  constructor(baseUrl, apiKey) {
    this.messages = [];
    this.pending = [];
    this.connected = new Promise((resolve, reject) => {
      this.resolveConnected = resolve;
      this.rejectConnected = reject;
    });
    this.closed = new Promise((resolve) => {
      this.resolveClosed = resolve;
    });
    this.socket = new WebSocket(
      `${baseUrl.replace("http", "ws")}/socket.io/?EIO=4&transport=websocket`,
    );
    this.socket.addEventListener("error", () =>
      this.rejectConnected(new Error("WebSocket connection failed")),
    );
    this.socket.addEventListener("close", () => this.resolveClosed());
    this.socket.addEventListener("message", ({ data }) => {
      const packet = String(data);
      if (packet.startsWith("0"))
        this.socket.send(`40${JSON.stringify({ api_key: apiKey })}`);
      else if (packet.startsWith("2")) this.socket.send(`3${packet.slice(1)}`);
      else if (packet.startsWith("40")) this.resolveConnected();
      else if (packet.startsWith("42")) {
        const [event, value] = JSON.parse(packet.slice(2));
        this.messages.push({ event, value });
        const index = this.pending.findIndex(
          (waiter) => waiter.event === event,
        );
        if (index >= 0) this.pending.splice(index, 1)[0].resolve(value);
      }
    });
  }

  send(event, value) {
    this.socket.send(`42${JSON.stringify([event, value])}`);
  }

  next(event) {
    return bounded(
      new Promise((resolve) => this.pending.push({ event, resolve })),
      event,
    );
  }

  close() {
    this.socket.close();
  }
}

async function bounded(promise, label) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`${label} timed out`)),
          10000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

export async function checkAccountDeactivation(source) {
  const userRepository = source.getRepository(PlaystashUser);
  const sessionRepository = source.getRepository(Session);
  const password = "deactivation-audit-password";
  const passwordHash = await hash(password, 4);
  const createAdmin = (username) =>
    userRepository.save(
      userRepository.create({
        username,
        password: passwordHash,
        api_key: randomBytes(32).toString("hex"),
        role: Role.ADMIN,
        activated: true,
      }),
    );
  const operator = await createAdmin("deactivation_operator");
  const target = await createAdmin("deactivation_target");
  const config = {
    ...configuration,
    SERVER: { ...configuration.SERVER, ADMIN_USERNAME: undefined },
    TESTING: { ...configuration.TESTING, AUTHENTICATION_DISABLED: false },
  };
  const statusEvents = new UserStatusEvents();
  const games = {
    findOneByGameIdOrFail: async () => ({ id: 1, access_restricted: false }),
  };
  const users = new UsersService(
    userRepository,
    {},
    games,
    config,
    statusEvents,
  );
  const apiKeys = new ApiKeyService(userRepository);
  const chat = new ChatService(users, games);
  const provider = (provide, useFactory, ...inject) => ({
    provide,
    useFactory,
    inject,
  });
  const module = await Test.createTestingModule({
    imports: [
      JwtModule.register({
        secret: config.AUTH.ACCESS_TOKEN.SECRET,
        signOptions: { expiresIn: "5m" },
      }),
    ],
    controllers: [UsersController, BasicAuthController, PlaystashJwtController],
    providers: [
      { provide: PLAYSTASH_CONFIG, useValue: config },
      { provide: UsersService, useValue: users },
      { provide: ApiKeyService, useValue: apiKeys },
      { provide: UserStatusEvents, useValue: statusEvents },
      { provide: GamesService, useValue: games },
      { provide: ChatService, useValue: chat },
      provider(
        AuthenticationService,
        (jwt) =>
          new AuthenticationService(users, jwt, sessionRepository, config),
        JwtService,
      ),
      provider(
        AuthenticationStrategy,
        () => new AuthenticationStrategy(users, config),
      ),
      provider(
        BasicAuthenticationStrategy,
        () => new BasicAuthenticationStrategy(users),
      ),
      provider(
        RefreshTokenStrategy,
        (auth) => new RefreshTokenStrategy(users, auth, config),
        AuthenticationService,
      ),
      provider(
        APP_GUARD,
        (reflector) => new ApiKeyGuard(apiKeys, reflector, config),
        Reflector,
      ),
      provider(
        APP_GUARD,
        (reflector) => new AuthenticationGuard(reflector, config),
        Reflector,
      ),
      provider(
        APP_GUARD,
        (reflector) => new AuthorizationGuard(reflector, users, config),
        Reflector,
      ),
      ActivityGateway,
    ],
  }).compile();
  const app = module.createNestApplication({ logger: false });
  app.setGlobalPrefix("api");
  app.useGlobalPipes(new ValidationPipe({ transform: true }));
  const sockets = [];
  try {
    await app.listen(0, "127.0.0.1");
    const baseUrl = `http://127.0.0.1:${app.getHttpServer().address().port}`;
    const basic = (user) => ({
      authorization: `Basic ${Buffer.from(`${user.username}:${password}`).toString("base64")}`,
    });
    const login = async (user) => {
      const response = await fetch(`${baseUrl}/api/auth/basic/login`, {
        headers: basic(user),
      });
      assert.equal(response.status, 200);
      return response.json();
    };
    const targetTokens = await login(target);
    const operatorTokens = await login(operator);
    const connect = async (user) => {
      const client = new LiveSocket(baseUrl, user.api_key);
      sockets.push(client);
      await bounded(client.connected, "Socket.IO connection");
      const history = client.next("chat-history");
      client.send("chat-history", { room: "lobby", limit: 50 });
      assert.equal((await history).conversation, "lobby");
      return client;
    };
    const targetSocket = await connect(target);
    const operatorSocket = await connect(operator);
    const presence = operatorSocket.next("activity");
    targetSocket.send("set-activity", { state: "ONLINE" });
    assert.equal((await presence).user_id, target.id);
    const change = async (activated) => {
      const response = await fetch(`${baseUrl}/api/users/${target.id}`, {
        method: "PUT",
        headers: {
          authorization: `Bearer ${operatorTokens.access_token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ activated }),
      });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).activated, activated);
      assert.equal(
        (await userRepository.findOneByOrFail({ id: target.id })).activated,
        activated,
      );
    };
    const removed = operatorSocket.next("remove-activity");
    await change(false);
    await bounded(targetSocket.closed, "Disabled administrator disconnect");
    assert.equal((await removed).user_id, target.id);
    for (const [path, init, status] of [
      ["/api/auth/basic/login", { headers: basic(target) }, 406],
      ["/api/users/me", { headers: { "x-api-key": target.api_key } }, 401],
      [
        "/api/users/me",
        { headers: { authorization: `Bearer ${targetTokens.access_token}` } },
        406,
      ],
      [
        "/api/auth/refresh",
        {
          method: "POST",
          headers: { authorization: `Bearer ${targetTokens.refresh_token}` },
        },
        406,
      ],
    ]) {
      assert.equal(
        (await fetch(`${baseUrl}${path}`, init)).status,
        status,
        `${path} must reject the inactive administrator`,
      );
    }
    const sent = operatorSocket.next("chat-sent");
    operatorSocket.send("chat-send", {
      room: "lobby",
      text: "after administrator deactivation",
    });
    assert.equal((await sent).text, "after administrator deactivation");
    assert.equal(
      targetSocket.messages.some(
        ({ event, value }) =>
          event === "chat-message" &&
          value.text === "after administrator deactivation",
      ),
      false,
    );

    // Verified SSO identities must also obey the same persisted activation state.
    const oauthConfig = {
      ...config,
      AUTH: {
        ...config.AUTH,
        OAUTH2: {
          ...config.AUTH.OAUTH2,
          AUTH_URL: "https://idp.example/auth",
          TOKEN_URL: "https://idp.example/token",
          USERINFO_URL: "https://idp.example/userinfo",
          CALLBACK_URL: "https://stash.example/callback",
          CLIENT_ID: "audit",
          CLIENT_SECRET: "audit-secret",
        },
      },
    };
    const oauth = new OAuth2Strategy(users, oauthConfig);
    await userRepository.update(target.id, {
      sso_provider: oauth.provider,
      sso_subject: "inactive-admin",
    });
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () =>
        new Response(JSON.stringify({ sub: "inactive-admin" }), {
          status: 200,
        });
      let accepted = false;
      await assert.rejects(
        oauth.validate({}, "verified-userinfo-token", "", {}, {}, () => {
          accepted = true;
        }),
        { message: /Authorization Failed: User is not activated/ },
      );
      assert.equal(accepted, false);
    } finally {
      globalThis.fetch = originalFetch;
    }

    await change(true);
    assert.equal(
      (
        await fetch(`${baseUrl}/api/users/me`, {
          headers: { authorization: `Bearer ${targetTokens.access_token}` },
        })
      ).status,
      200,
    );
    const reactivatedSocket = await connect(target);
    const deleted = await fetch(`${baseUrl}/api/users/${target.id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${operatorTokens.access_token}` },
    });
    assert.equal(deleted.status, 200);
    await bounded(reactivatedSocket.closed, "Deleted administrator disconnect");
    console.log(
      "Account deactivation: real ORM + HTTP Basic/API key/JWT/refresh/SSO rejection, existing Socket.IO disconnect/no delivery, reactivation and deletion verified.",
    );
  } finally {
    for (const socket of sockets) socket.close();
    await app.close();
  }
}
