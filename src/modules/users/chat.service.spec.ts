import { WsException } from "@nestjs/websockets";
import { ChatService } from "./chat.service.js";
import { Role } from "./models/role.enum.js";

describe("authenticated transient chat", () => {
  let chat: ChatService;
  let users: any;
  let games: any;
  const user = {
    id: 1,
    username: "Alice",
    role: Role.USER,
    activated: true,
  } as any;
  const other = {
    id: 2,
    username: "Bob",
    role: Role.USER,
    activated: true,
  } as any;
  beforeEach(() => {
    users = {
      findOneByUserIdOrFail: vi.fn(async () => other),
      findUserAgeByUsername: vi.fn(async () => 17),
    };
    games = { findOneByGameIdOrFail: vi.fn(async () => ({ id: 5 })) };
    chat = new ChatService(users, games);
  });
  afterEach(() => vi.useRealTimers());

  it("uses authenticated names/IDs, stores plain text and replays the same UUID only once", async () => {
    const dto = {
      text: "  <b>hello</b>  ",
      client_message_id: "D1A41280-1D60-4147-A408-B5FDA5725850",
    };
    const first = await chat.send(dto, user);
    const replay = await chat.send(dto, user);
    expect(first.message).toMatchObject({
      user_id: 1,
      username: "Alice",
      text: "<b>hello</b>",
      room: "lobby",
    });
    expect(replay).toEqual({ ...first, replay: true });
    expect((await chat.history({}, user)).messages).toHaveLength(1);
    await expect(
      chat.send({ ...dto, text: "changed" }, user),
    ).rejects.toBeInstanceOf(WsException);
  });

  it("keeps direct messages between their two participants", async () => {
    const { message } = await chat.send(
      { recipient_user_id: 2, text: "private" },
      user,
    );
    expect(await chat.canReceive(message, user)).toBe(true);
    expect(await chat.canReceive(message, other)).toBe(true);
    expect(await chat.canReceive(message, { ...other, id: 3 })).toBe(false);
    expect(
      (await chat.history({ recipient_user_id: 1 }, other)).messages,
    ).toEqual([message]);
    expect(
      (await chat.history({ recipient_user_id: 1 }, { ...other, id: 3 }))
        .messages,
    ).toEqual([]);
    expect((await chat.history({}, other)).messages).toEqual([]);
  });

  it("rejects direct room spoofing, inactive users and unavailable recipients", async () => {
    for (const target of [
      { room: "dm:1:2" },
      { room: "lobby", recipient_user_id: 2 },
      { recipient_user_id: 1 },
      { room: "game:01" },
      { recipient_user_id: NaN },
    ]) {
      await expect(
        chat.send({ ...target, text: "hi" }, user),
      ).rejects.toBeInstanceOf(WsException);
    }
    users.findOneByUserIdOrFail.mockResolvedValue({
      ...other,
      activated: false,
    });
    await expect(
      chat.send({ recipient_user_id: 2, text: "hi" }, user),
    ).rejects.toBeInstanceOf(WsException);
  });

  it("checks current game permissions and parental age for send, history and delivery", async () => {
    const { message } = await chat.send(
      { room: "game:5", text: "hello" },
      user,
    );
    expect(games.findOneByGameIdOrFail).toHaveBeenCalledWith(
      5,
      expect.objectContaining({
        requestingUser: user,
        filterByAge: 17,
        loadDeletedEntities: false,
      }),
    );
    games.findOneByGameIdOrFail.mockRejectedValue(new Error("revoked"));
    await expect(chat.history({ room: "game:5" }, user)).rejects.toBeInstanceOf(
      WsException,
    );
    await expect(
      chat.send({ room: "game:5", text: "hello" }, user),
    ).rejects.toBeInstanceOf(WsException);
    expect(await chat.canReceive(message, other)).toBe(false);
  });

  it("validates messages and history limits before accepting them", async () => {
    for (const text of [" ", "x".repeat(2001), "unsafe\u0000", undefined])
      await expect(chat.send({ text } as any, user)).rejects.toBeInstanceOf(
        WsException,
      );
    await expect(
      chat.send({ text: "ok", client_message_id: "not-a-uuid" }, user),
    ).rejects.toBeInstanceOf(WsException);
    await expect(chat.history({ limit: 101 }, user)).rejects.toBeInstanceOf(
      WsException,
    );
    await expect(chat.history({ limit: 0 }, user)).rejects.toBeInstanceOf(
      WsException,
    );
  });

  it("limits each user to five messages per ten seconds", async () => {
    vi.useFakeTimers();
    for (let i = 0; i < 5; i++) await chat.send({ text: `message ${i}` }, user);
    await expect(chat.send({ text: "too fast" }, user)).rejects.toBeInstanceOf(
      WsException,
    );
    vi.advanceTimersByTime(10_001);
    await expect(
      chat.send({ text: "allowed again" }, user),
    ).resolves.toHaveProperty("message.text", "allowed again");
  });

  it("bounds history to 100 messages and expires it after 24 hours", async () => {
    vi.useFakeTimers();
    for (let i = 0; i < 110; i++) {
      await chat.send({ text: `message ${i}` }, user);
      vi.advanceTimersByTime(2001);
    }
    const history = await chat.history({ limit: 100 }, user);
    expect(history.messages).toHaveLength(100);
    expect(history.messages[0].text).toBe("message 10");
    vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    expect((await chat.history({}, user)).messages).toEqual([]);
  });
});
