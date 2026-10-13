# Completed client events

Signed-in users can report actual completed operations with
`POST /api/game/{game_id}/events`:

```json
{
  "event_id": "54e25a99-f1ac-466d-a463-b0fd6e16baab",
  "type": "installed",
  "version_id": 12,
  "installation_id": "11111111-1111-4111-8111-111111111111",
  "occurred_at": "2026-10-13T14:30:00.000Z"
}
```

Types are `downloaded`, `installed`, `uninstalled`, and `played`. Persist a UUID
v4 before sending, and retry the same payload with that same UUID after a network
failure. Identical retries are accepted once; reusing a UUID for another event
returns a conflict. Optional version IDs must belong to the indicated game.
The authenticated account supplies the event's owner; clients cannot submit
events for another user. An HTTP 200 reply contains `event_id` and `accepted`.
`accepted: false` means collection is disabled or the event is outside retention;
clients should remove it from their retry queue.

Only `played` can include optional integer `minutes_played` (0 through 10,080).
Omitting minutes is valid. Event reporting never updates game progress or its
playtime; the existing playtime tracker remains responsible for those records.
Report completed operations, not a download link handoff or a launched installer
whose completion has not been verified.

`METRICS_ENABLED` defaults to `true`. Each user can set `report_game_metrics` to
`false` through their normal user settings to stop future collection. Existing
history remains until retention removes it. `METRICS_RETENTION_DAYS` defaults to
365; `0` keeps events indefinitely. Events older than retention are rejected from
collection, and a daily cleanup removes expired history.

Administrators can inspect `GET /api/game/{game_id}/metrics` for operation counts
and session minutes, or `GET /api/game/{game_id}/events` for event rows. Event
queries support `limit` (1–500, default 100), `before_id`, and `user_id`.
For restricted games, another user's history is included only when that user
enabled `share_restricted_activity`. Users and clients cannot read the admin
metrics endpoints. Game membership and parental age apply when reporting events.
