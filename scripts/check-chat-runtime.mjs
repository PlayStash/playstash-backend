import { BadRequestException, ValidationPipe } from "@nestjs/common";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import "reflect-metadata";
import { ActivityGateway } from "../dist/src/modules/users/activity.gateway.js";
import { ChatService } from "../dist/src/modules/users/chat.service.js";
import { ActivityState } from "../dist/src/modules/users/models/activity-state.enum.js";
import { Activity } from "../dist/src/modules/users/models/activity.dto.js";
import {
  ChatHistoryDto,
  ChatSendDto,
} from "../dist/src/modules/users/models/chat.dto.js";
import { Role } from "../dist/src/modules/users/models/role.enum.js";

// Vitest transpilation does not verify tsc's decorator metadata. Exercise the
// actual production build and Nest's transformation pipeline before releasing.
const expectedTypes = {
  setActivity: Activity,
  chatHistory: ChatHistoryDto,
  chatLeave: ChatHistoryDto,
  chatSend: ChatSendDto,
};
const pipe = new ValidationPipe({ transform: true });
async function payload(handler, value) {
  const metatype = Reflect.getMetadata(
    "design:paramtypes",
    ActivityGateway.prototype,
    handler,
  )?.[1];
  assert.equal(
    metatype,
    expectedTypes[handler],
    `${handler} must emit its actual DTO class, not Function`,
  );
  return pipe.transform(value, { type: "body", metatype });
}
const users = new Map([
  [1, { id: 1, username: "sender", role: Role.USER, activated: true }],
  [2, { id: 2, username: "viewer", role: Role.USER, activated: true }],
]);
const usersService = {
  findOneByUserIdOrFail: async (id) => users.get(id),
  findUserAgeByUsername: async () => undefined,
};
const gamesService = {
  findOneByGameIdOrFail: async () => ({ id: 10, access_restricted: false }),
};
const deliveries = [];
const socket = (id) => ({
  id: `socket-${id}`,
  user: users.get(id),
  emit: (event, data) => deliveries.push({ id, event, data }),
});
const sender = socket(1),
  viewer = socket(2);
const gateway = new ActivityGateway(
  usersService,
  gamesService,
  new ChatService(usersService, gamesService),
);
gateway.server = {
  sockets: {
    sockets: new Map([
      [sender.id, sender],
      [viewer.id, viewer],
    ]),
  },
};

for (const client of [sender, viewer]) {
  const history = await gateway.chatHistory(
    client,
    await payload("chatHistory", { room: "lobby", limit: 50 }),
  );
  assert.deepEqual(history, {
    event: "chat-history",
    data: { conversation: "lobby", messages: [] },
  });
}
const body = {
  room: "lobby",
  text: "Production DTO smoke",
  client_message_id: randomUUID(),
};
const sent = await gateway.chatSend(sender, await payload("chatSend", body));
assert.equal(sent.event, "chat-sent");
assert.equal(sent.data.text, body.text);
assert.equal(sent.data.user_id, 1);
assert.equal(
  deliveries.filter(({ event, id }) => event === "chat-message" && id === 2)
    .length,
  1,
);
const retry = await gateway.chatSend(sender, await payload("chatSend", body));
assert.equal(retry.data.id, sent.data.id);
assert.equal(
  deliveries.filter(({ event, id }) => event === "chat-message" && id === 2)
    .length,
  1,
  "UUID retry must not rebroadcast",
);
const history = await gateway.chatHistory(
  viewer,
  await payload("chatHistory", { room: "lobby", limit: 50 }),
);
assert.equal(history.data.messages[0].id, sent.data.id);
const left = await gateway.chatLeave(
  viewer,
  await payload("chatLeave", { room: "lobby" }),
);
assert.deepEqual(left, { event: "chat-left", data: { conversation: "lobby" } });
await gateway.setActivity(
  sender,
  await payload("setActivity", { state: ActivityState.BUSY }),
);
assert.equal(gateway.getAll()[0].state, ActivityState.BUSY);
await assert.rejects(
  payload("chatHistory", { room: "lobby", limit: 101 }),
  BadRequestException,
);
await assert.rejects(
  payload("chatSend", { room: "lobby", text: "x".repeat(2001) }),
  BadRequestException,
);
await assert.rejects(
  payload("setActivity", { state: ActivityState.ONLINE, user_id: 99 }),
  BadRequestException,
);
console.log(
  "Compiled Socket.IO DTO metadata, real Nest validation, activity and chat named replies, delivery and UUID retries verified.",
);
