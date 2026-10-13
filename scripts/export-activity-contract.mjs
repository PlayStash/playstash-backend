import { readFile, writeFile } from "node:fs/promises";

// Reuse the authoritative Swagger DTO schemas instead of duplicating their fields.
const api = JSON.parse(
  await readFile(process.argv[2] ?? ".local/playstash.openapi.json", "utf8"),
);
const model = (name) => ({ $ref: `#/components/schemas/${name}` });
const schemaNames = [
  "Activity",
  "ChatSendDto",
  "ChatHistoryDto",
  "ChatMessageDto",
];
const schemas = Object.fromEntries(
  schemaNames.map((name) => {
    if (!api.components.schemas[name])
      throw new Error(`Missing API model ${name}; export OpenAPI first.`);
    return [name, api.components.schemas[name]];
  }),
);
const channels = {};
const operations = {};
const channel = (event, input, output) => {
  const messages = {};
  for (const [direction, schema] of Object.entries({
    receive: input,
    send: output,
  })) {
    if (!schema) continue;
    messages[direction] = { name: event, payload: schema };
    operations[`${direction}_${event.replaceAll("-", "_")}`] = {
      action: direction,
      channel: { $ref: `#/channels/${event}` },
      messages: [{ $ref: `#/channels/${event}/messages/${direction}` }],
    };
  }
  channels[event] = { address: event, messages };
};
const userId = {
  type: "object",
  properties: { user_id: { type: "integer" } },
  required: ["user_id"],
};
const history = {
  type: "object",
  properties: {
    conversation: { type: "string" },
    messages: { type: "array", items: model("ChatMessageDto") },
  },
  required: ["conversation", "messages"],
};
channel("set-activity", model("Activity"));
channel("get-activities", { type: "object" });
channel("activities", undefined, { type: "array", items: model("Activity") });
channel("activity", undefined, model("Activity"));
channel("remove-activity", undefined, userId);
channel("chat-send", model("ChatSendDto"));
channel("chat-sent", undefined, model("ChatMessageDto"));
channel("chat-message", undefined, model("ChatMessageDto"));
channel("chat-history", model("ChatHistoryDto"), history);
channel("chat-leave", model("ChatHistoryDto"));
channel("chat-left", undefined, {
  type: "object",
  properties: { conversation: { type: "string" } },
  required: ["conversation"],
});
channel("exception", undefined, {
  type: "object",
  properties: { status: { type: "string" }, message: { type: "string" } },
});
const contract = {
  asyncapi: "3.0.0",
  info: {
    title: "PlayStash activity and chat",
    version: api.info.version,
    description:
      "Socket.IO v4 event names on the default namespace, using /socket.io. Authenticate with X-Api-Key handshake headers or Socket.IO auth {api_key}. Replies use named response events, not acknowledgment callbacks. Chat is transient: at most 100 conversations of 100 messages retained for 24 hours; server restarts clear history. See docs/chat.md for permission and delivery semantics.",
  },
  servers: {
    local: {
      host: "localhost:8080",
      pathname: "/socket.io",
      protocol: "ws",
      description:
        "Socket.IO/Engine.IO transport; use a Socket.IO client, not raw JSON WebSocket frames.",
    },
  },
  channels,
  operations,
  components: { schemas },
};
const destination = process.argv[3] ?? "docs/activity.asyncapi.json";
await writeFile(destination, `${JSON.stringify(contract, null, 2)}\n`);
console.log(
  `Exported ${Object.keys(channels).length} Socket.IO channels to ${destination}.`,
);
