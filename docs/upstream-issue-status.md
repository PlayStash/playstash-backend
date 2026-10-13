# Upstream issue coverage

This records the PlayStash backend's implementation checkpoint for version 17.1.0
on 2026-10-13. The source inventory contains all 15 open backend issues collected
for the upstream synchronization. These links identify the original requests;
this document does not claim that an upstream issue was closed or accepted.
PlayStash remains a self-hosted library with its existing license.

## Backend requests

| Upstream issue | PlayStash status | Implemented behavior and limits |
| --- | --- | --- |
| [#417](https://github.com/Phalcode/gamevault-backend/issues/417) — Multiple website links | Client presentation fix | The backend already stores and returns the website list. The frontend renders all saved links; this request does not require changing the metadata schema. |
| [#414](https://github.com/Phalcode/gamevault-backend/issues/414) — Timed download limits | Implemented | Validated cron schedules and time zones select download limits during an active transfer. Client headers cannot exceed the configured server cap. See [installation settings](../INSTALL.md). |
| [#356](https://github.com/Phalcode/gamevault-backend/issues/356) — Steam metadata provider | Implemented, opt-in | `METADATA_STEAM_ENABLED` enables Steam Store title/App ID searches and metadata, images and system requirements. Requests are queued, bounded and cached; upstream availability still applies. See [library options](library-options.md). |
| [#350](https://github.com/Phalcode/gamevault-backend/issues/350) — Per-game archive passwords | Implemented | Metadata exposes an optional `archive_password`. Clients use it for that game's extraction; the server does not extract or execute game installers. |
| [#346](https://github.com/Phalcode/gamevault-backend/issues/346) — System requirements | Implemented | Editable minimum and recommended Markdown fields are included in game metadata. The Steam provider can populate them while retaining user overrides. |
| [#340](https://github.com/Phalcode/gamevault-backend/issues/340) — Selected-user game access | Implemented | Administrators manage `access_restricted` and `allowed_user_ids`. Membership and age restrictions apply to library queries, downloads, media, saves, progress, packages, metadata facets and activity. Private activity sharing requires the owner's opt-in. See [library options](library-options.md). |
| [#336](https://github.com/Phalcode/gamevault-backend/issues/336) — Launch configurations | Implemented | Named `launch_profiles` carry relative executable paths and parameters. User metadata can override provider defaults, including an explicitly empty list. Optional folder manifests carry installation and launch recipes. See [packages](packages.md). |
| [#280](https://github.com/Phalcode/gamevault-backend/issues/280) — Unarchived games | Implemented | Supported setup folders or folders with an explicit manifest are indexed as one game and served as a generated archive, including before the in-memory directory index has warmed up. Containment checks reject symbolic links; fingerprints include empty directories and prevent stale or incomplete folder archives. |
| [#249](https://github.com/Phalcode/gamevault-backend/issues/249) — Achievements | Clarification and sample integration required | No achievement collection or DLL hooks have been implemented. The request identifies neither a stable game-independent event format nor a verified achievement file/API for a concrete game. A next implementation needs a redistributable sample format, achievement IDs and definitions, an import/update trigger, and a supported client adapter. Playtime and lifecycle metrics are not achievement completion data. |
| [#247](https://github.com/Phalcode/gamevault-backend/issues/247) — Game lifecycle metrics | Implemented | Authenticated clients report completed download/install/uninstall/play events with persistent UUIDs. Retries are idempotent; administrators receive game totals and user drilldown, with opt-out, retention and restricted-game privacy. Reporting never increments existing progress playtime. See [metrics](metrics.md). |
| [#241](https://github.com/Phalcode/gamevault-backend/issues/241) — Image conversion | Implemented | Unsupported decodable images are converted to an allowed PNG/JPEG/WebP format within size, pixel and time limits. SVGs are rasterized after rejecting active or external content. This is not a general arbitrary-file conversion API. |
| [#237](https://github.com/Phalcode/gamevault-backend/issues/237) — External notifications | Implemented, opt-in | Configured webhooks receive new/restored/updated game events. Unchanged scans do not repeat notifications and restricted games are omitted. No external account or webhook is configured by default. |
| [#149](https://github.com/Phalcode/gamevault-backend/issues/149) — Extra files | Implemented | Case-insensitive `Extras`/`Addons` sidecars or manifest entries expose separate downloadable files using opaque asset IDs and the game's access rules. They are excluded from a generated main payload. See [packages](packages.md). |
| [#148](https://github.com/Phalcode/gamevault-backend/issues/148) — Package manifests | Implemented with a bounded format | Optional `playstash-package.json` version 1 describes grouped files, an existing source archive, installation recipes, launch profiles, extras and addons. Paths remain inside the package. Recipes are client-controlled; the server does not run arbitrary scripts. |
| [#142](https://github.com/Phalcode/gamevault-backend/issues/142) — Modular mods/DLC/patches | Implemented server contract | Separate addon archives can be listed and downloaded in a client-selected order. Applying addons and confirming file overwrites are client operations. See [packages](packages.md). |

## Shared client requests and APIs

These additions support related desktop and frontend requests. Client integration
and platform-specific installation behavior are maintained in their repositories.

| Related request | Backend contract |
| --- | --- |
| [App #474](https://github.com/Phalcode/gamevault-app/issues/474) — Save management | Owners and administrators can list, download and delete save versions through `/api/savefiles/user/{user_id}/game/{game_id}/versions`. Filenames are validated, game access is checked and physical server paths stay private. |
| [App #205](https://github.com/Phalcode/gamevault-app/issues/205) — Presence and chat | Authenticated Socket.IO supports online/busy/invisible/playing states, lobby/game conversations and direct messages. Plain-text messages, history and retries are bounded; game rooms recheck current access. Replies use named events, not acknowledgement callbacks. History is in memory and expires or disappears on restart. See [chat](chat.md) and the generated [AsyncAPI contract](activity.asyncapi.json). |
| [App #451](https://github.com/Phalcode/gamevault-app/issues/451) — Server administration | Admin-only `/api/admin/logs` returns up to 200 sanitized records from at most 64 KiB of the server's own enabled file logs. `/api/metadata/recache` queues a real provider refresh that bypasses cache TTL, preserves mappings and user overrides, respects `NC`, and rejects concurrent batches. See [admin logs](admin-logs.md) and [library options](library-options.md). |
| [App #454](https://github.com/Phalcode/gamevault-app/issues/454) — Library requests | `/api/requests` supports personal requests, optional anonymity, administrator status/fulfillment and race-safe acknowledgement of updates. Fulfillment verifies the requester's access to the selected game. See [feedback](feedback.md). |
| [App #537](https://github.com/Phalcode/gamevault-app/issues/537) — Ratings and comments | `/api/games/{game_id}/reviews` provides one editable five-star review per user, paginated comments and averages. Reading and publishing require game access. See [feedback](feedback.md). |
| [Frontend #7](https://github.com/Phalcode/gamevault-frontend/issues/7), [Frontend #24](https://github.com/Phalcode/gamevault-frontend/issues/24) — Library views/categories | Server-side game queries support creation-date filters and folder prefixes through `filter.versions.file_path=$sw:<prefix>/`; tag filtering happens before pagination. Administrator `/api/config/folder-tag-rules` persists automatic folder-to-tag rules while retaining manual/provider tags. Named category presentation remains client-side. See [folder tags](folder-tags.md). |

The four synchronized upstream commits additionally retain the initiating OAuth2
client with a validated return origin, merge same-title games case-insensitively,
stream uploads through bounded temporary files, and keep newly uploaded games
visible during integrity checks. Authentication return URLs are validated against
configured trusted origins; arbitrary redirect targets are rejected.

## Validation checkpoint

- Backend type checking, production compilation and linting passed.
- The final complete suite passed after the production fixes: 70 test files and
  721 tests, with two workers.
- Subsequent download-range, case-insensitive sidecar and Socket.IO guard-order
  regressions passed together with the related suites: 8 files and 130 tests.
  Main downloads now return HTTP 206 with accurate ranges, reject unavailable
  ranges with HTTP 416, and support empty files without invalid stream offsets.
- The subsequent snapshot suite passed all 15 tests, including adding/removing
  empty directories without changing the reported payload size.
- The compiled gateway passed `scripts/check-chat-runtime.mjs`: actual emitted
  DTO metadata and Nest's validation preserve JSON activity/chat payloads,
  deliver named replies and messages, and deduplicate UUID retries. The related
  chat/authentication suites passed 30 tests. This check runs in CI after the
  production build and catches runtime metadata errors beyond unit transpilation.
- Fresh SQLite and PostgreSQL databases both applied all 31 migrations and passed
  real ORM checks for access restrictions, private progress, retry-safe metrics,
  requests/reviews and folder tag rules.
- The OpenAPI export includes the metadata, save, package, access, metrics,
  feedback, folder-rule and administration contracts. Socket events are described
  separately by the generated AsyncAPI document.
- The actual production container passed HTTP checks using native SQLite for
  folder TAR downloads, sidecar ranges, automatic tags, requests/reviews,
  retry-safe metrics and restricted-game visibility.
- Both real clients passed live chat delivery against that container. Chromium
  received the newly sent message without page errors. The actual WPF transport
  passed authenticated presence, history, named UUID-correlated replies, retry
  deduplication, a server heartbeat interval and room departure.

This checkpoint does not claim a deployed release, enabled workflows, live Steam
availability, a configured webhook, or an achievement implementation. Repository
workflow gates remain disabled until deliberately enabled by an operator.
