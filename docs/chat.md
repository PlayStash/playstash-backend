# Online activity and chat

Connect a Socket.IO v4 client to the server's default namespace at `/socket.io`.
Authenticate every message with `X-Api-Key` in the handshake headers. Browser
clients can use the Socket.IO handshake auth object `{ "api_key": "..." }`, since
browser WebSockets cannot set custom headers. Do not put API keys in query URLs.
`SERVER_ONLINE_ACTIVITIES_DISABLED=true` disables the entire activity/chat gateway.

The gateway sends no library data on an unauthenticated connection. After
connecting, send `get-activities`; the reply event `activities` contains the
current visible users. Send `set-activity` with `{ "state": "ONLINE" }`, `BUSY`,
`INVISIBLE`, or `PLAYING` plus `game_id`. `activity` updates contain the trusted
`user_id`, `socket_id`, `state`, and optional `game_id`. `remove-activity` contains
`{ "user_id": 123 }` when someone disconnects or becomes invisible. An invisible
user sees their own state but is absent from other users' lists. Restricted game
names and IDs are hidden unless both the viewer has access and the player opted
into sharing restricted activity.

## Chat events

- Send `chat-history` with `{ "room": "lobby", "limit": 50 }` or
  `{ "room": "game:123" }`. It returns `chat-history` with
  `{ "conversation": "lobby", "messages": [...] }` and subscribes that socket
  to future `chat-message` events in that room.
- Send `chat-history` with `{ "recipient_user_id": 123 }` to read a direct
  conversation. Its opaque conversation ID is `dm:<smaller ID>:<larger ID>`.
- Send `chat-send` with `{ "room": "lobby", "text": "Hello",
"client_message_id": "a UUID v4" }`, or substitute `recipient_user_id` for
  `room`. Omitting both selects the lobby. The reply is `chat-sent` with the
  accepted message. New messages also arrive as `chat-message` for subscribed
  room members or the two direct-message participants.
- Send `chat-leave` with the room/recipient target to unsubscribe that socket.
  The reply is `chat-left` with its conversation ID.

Replies use the named response events; clients should listen for them and use
timeouts with the same client UUID when retrying a send. Message objects contain
`id`, optional `client_message_id`, `user_id`, `username`, `text`, `created_at`,
and either `room` or `recipient_user_id`. Clients must render `text` as plain
text. Only the server assigns sender IDs, names and timestamps.

The server rechecks activation, game permissions and parental age restrictions
for room history, sending and delivery. Direct messages are available only to
their two participants. At most five new messages per user are accepted in ten
seconds; text is limited to 2,000 characters. Reusing the same client UUID and
text in a retained conversation acknowledges the existing message without a
second broadcast; different text with that UUID is rejected.

History lasts at most 24 hours, with at most 100 messages in each of 100 active
conversations. Older conversations may be evicted earlier under load. History
is held in process memory and disappears on restart. Clients must not promise
persistent delivery or chat backups. A socket can subscribe to at most 100
conversations. Offline direct recipients can read retained messages after
reconnecting, but there is no external push notification service.

The machine-readable event contract is [activity.asyncapi.json](activity.asyncapi.json).
Refresh it after updating the DTOs:

```sh
pnpm build
node scripts/export-openapi.mjs .local/playstash.openapi.json
node scripts/export-activity-contract.mjs .local/playstash.openapi.json
```

After a production build, `node scripts/check-chat-runtime.mjs` verifies the
emitted DTO metadata with Nest's real validation pipeline, named chat replies,
message delivery, UUID retries and activity updates. The repository workflow
runs this check before publishing.
