import { UnauthorizedException } from "@nestjs/common";
import { ActivityGateway } from "./activity.gateway.js";
import { ActivityState } from "./models/activity-state.enum.js";
import { Role } from "./models/role.enum.js";

describe("activity privacy", () => {
  let gateway: ActivityGateway;
  let users: any;
  let games: any;
  const socket = (id: number) =>
    ({
      id: `socket-${id}`,
      user: { id, username: `user${id}`, role: Role.USER },
      emit: vi.fn(),
      disconnect: vi.fn(),
    }) as any;
  beforeEach(() => {
    users = {
      findOneByUserIdOrFail: vi.fn(async (id) => ({
        id,
        username: `user${id}`,
        role: Role.USER,
        activated: true,
        share_restricted_activity: false,
      })),
      findUserAgeByUsername: vi.fn(async () => undefined),
    };
    games = {
      findOneByGameIdOrFail: vi.fn(async () => ({
        id: 10,
        access_restricted: false,
      })),
    };
    gateway = new ActivityGateway(users, games);
    gateway.server = { sockets: { sockets: new Map() } } as any;
  });
  it("sends no activity on an unauthenticated connection", () => {
    const client = { id: "new", emit: vi.fn() } as any;
    gateway.handleConnection(client);
    expect(client.emit).not.toHaveBeenCalled();
  });
  it("requires authentication for activity messages", async () => {
    const client = { id: "new", emit: vi.fn() } as any;
    await expect(gateway.getActivities(client)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(
      gateway.setActivity(client, { state: ActivityState.ONLINE }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it("shares public game activity only with authenticated sockets", async () => {
    const owner = socket(1),
      viewer = socket(2),
      guest = { id: "guest", emit: vi.fn() } as any;
    gateway.server.sockets.sockets.set(viewer.id, viewer);
    gateway.server.sockets.sockets.set(guest.id, guest);
    await gateway.setActivity(owner, {
      state: ActivityState.PLAYING,
      game_id: 10,
    });
    expect(viewer.emit).toHaveBeenCalledWith(
      "activity",
      expect.objectContaining({ user_id: 1, game_id: 10 }),
    );
    expect(guest.emit).not.toHaveBeenCalled();
  });
  it("hides restricted game activity until its owner opts in", async () => {
    games.findOneByGameIdOrFail.mockResolvedValue({
      id: 10,
      access_restricted: true,
    });
    const owner = socket(1),
      viewer = socket(2);
    await gateway.setActivity(owner, {
      state: ActivityState.PLAYING,
      game_id: 10,
    });
    await gateway.getActivities(viewer);
    expect(viewer.emit).toHaveBeenLastCalledWith("activities", [
      expect.objectContaining({
        state: ActivityState.ONLINE,
        game_id: undefined,
      }),
    ]);
    users.findOneByUserIdOrFail.mockImplementation(async (id: number) => ({
      id,
      username: `user${id}`,
      role: Role.USER,
      activated: true,
      share_restricted_activity: true,
    }));
    await gateway.getActivities(viewer);
    expect(viewer.emit).toHaveBeenLastCalledWith("activities", [
      expect.objectContaining({ state: ActivityState.PLAYING, game_id: 10 }),
    ]);
  });
  it("rechecks rights when reading activities after revocation", async () => {
    const owner = socket(1),
      viewer = socket(2);
    await gateway.setActivity(owner, {
      state: ActivityState.PLAYING,
      game_id: 10,
    });
    games.findOneByGameIdOrFail.mockRejectedValue(new Error("access revoked"));
    await gateway.getActivities(viewer);
    expect(viewer.emit).toHaveBeenCalledWith("activities", [
      expect.objectContaining({ game_id: undefined }),
    ]);
  });
  it("clears game IDs outside PLAYING and removes disconnected activity", async () => {
    const owner = socket(1),
      viewer = socket(2);
    await gateway.setActivity(owner, {
      state: ActivityState.BUSY,
      game_id: 10,
    });
    await gateway.getActivities(viewer);
    expect(viewer.emit).toHaveBeenCalledWith("activities", [
      expect.objectContaining({
        state: ActivityState.BUSY,
        game_id: undefined,
      }),
    ]);
    await gateway.handleDisconnect(owner);
    await gateway.getActivities(viewer);
    expect(viewer.emit).toHaveBeenLastCalledWith("activities", []);
  });
  it("removes invisible users from other activity lists while retaining their own status", async () => {
    const owner = socket(1),
      viewer = socket(2);
    gateway.server.sockets.sockets.set(viewer.id, viewer);
    await gateway.setActivity(owner, { state: ActivityState.INVISIBLE });
    expect(viewer.emit).toHaveBeenCalledWith("remove-activity", { user_id: 1 });
    await gateway.getActivities(viewer);
    expect(viewer.emit).toHaveBeenLastCalledWith("activities", []);
    await gateway.getActivities(owner);
    expect(owner.emit).toHaveBeenLastCalledWith("activities", [
      expect.objectContaining({ state: ActivityState.INVISIBLE }),
    ]);
  });
  it("delivers room messages only to authenticated subscribers and directs DMs only to their participants", async () => {
    const owner = socket(1),
      viewer = socket(2),
      unjoined = socket(3);
    for (const client of [owner, viewer, unjoined])
      gateway.server.sockets.sockets.set(client.id, client);
    await gateway.chatHistory(viewer, { room: "lobby" });
    const sent = await gateway.chatSend(owner, { text: "hello" });
    expect(viewer.emit).toHaveBeenCalledWith("chat-message", sent.data);
    expect(unjoined.emit).not.toHaveBeenCalled();
    await gateway.chatLeave(viewer, { room: "lobby" });
    viewer.emit.mockClear();
    await gateway.chatSend(owner, { text: "no subscription" });
    expect(viewer.emit).not.toHaveBeenCalled();
    const direct = await gateway.chatSend(owner, {
      recipient_user_id: 2,
      text: "direct",
    });
    expect(viewer.emit).toHaveBeenCalledWith("chat-message", direct.data);
    expect(unjoined.emit).not.toHaveBeenCalled();
  });
  it("blocks revoked game-room subscribers and disabled users", async () => {
    const owner = socket(1),
      viewer = socket(2);
    gateway.server.sockets.sockets.set(viewer.id, viewer);
    await gateway.chatHistory(viewer, { room: "game:10" });
    games.findOneByGameIdOrFail.mockImplementation(
      async (_id: number, options: { requestingUser: { id: number } }) => {
        if (options.requestingUser.id === 2) throw new Error("revoked");
        return { id: 10 };
      },
    );
    await gateway.chatSend(owner, { room: "game:10", text: "secret" });
    expect(viewer.emit).not.toHaveBeenCalled();
    users.findOneByUserIdOrFail.mockResolvedValue({
      id: 1,
      role: Role.USER,
      activated: false,
    });
    await expect(
      gateway.chatSend(owner, { text: "disabled" }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      gateway.chatHistory({ id: "guest" } as any, {}),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("rechecks disabled administrators before broadcasts and removal updates", async () => {
    const owner = socket(1),
      viewer = socket(2);
    gateway.server.sockets.sockets.set(viewer.id, viewer);
    await gateway.chatHistory(viewer, { room: "lobby" });
    users.findOneByUserIdOrFail.mockImplementation(async (id: number) => ({
      id,
      username: `user${id}`,
      role: Role.ADMIN,
      activated: id !== 2,
    }));
    await gateway.chatSend(owner, { text: "private broadcast" });
    await gateway.setActivity(owner, { state: ActivityState.ONLINE });
    await gateway.handleDisconnect(owner);
    expect(viewer.emit).not.toHaveBeenCalled();
    expect(viewer.disconnect).toHaveBeenCalledWith(true);
  });
});
