# PlayStash Backend Changelog

## 17.1.3

### Breaking Changes & Migration

- The default Docker Compose installation uses the published stable image and PostgreSQL with persistent host directories instead of building the source and using a placeholder database password. -> **For a fresh server, copy `docker-compose.yml` and run `docker compose up -d`; existing PostgreSQL deployments must keep their current credentials and data directories.**

### Changes

- The server image includes a verified frontend release, making the web interface available without a separate frontend download, GitHub token or source build.
- Container installations automatically create and reuse a private authentication key in the persisted configuration directory; explicit operator-provided keys retain precedence.
- Compose creates persistent directories for games, database, media, saves, plugins, configuration and logs without shared administrator credentials; the first registered account becomes the administrator.
- PostgreSQL receives a unique, automatically generated private password that is reused across restarts; no password placeholder or environment file is required.
- The PostgreSQL container uses updated system packages and replaces the outdated privilege-switch binary; both database and server runtime images are scanned before publishing.
- Concurrent first registrations can create only one bootstrap administrator.
- Published server releases include ready-to-run Compose files and a server setup guide; stable image updates follow `main` and keep stored data.
- Simultaneous pushes to `main` and `dev` build both image channels without one pending branch build replacing the other.
- Automated ARM64 server releases use native GitHub runners to prevent emulator crashes and stalled builds during dependency installation.

## 17.1.2

### Breaking Changes & Migration

- Deactivation blocks sign-in, existing tokens, API keys, download tokens and live chat/activity connections for every role, including administrators. -> **Activate an administrator before using that account; configured bootstrap administrators are still recovered on server startup.**

### Changes

- Fixed container startup with an explicitly selected non-root user by keeping application code readable while preserving private data volumes and restrictive permissions for new files.
- Deactivating or deleting an account immediately disconnects its live chat/activity connections and removes its presence.

## 17.1.1

### Breaking Changes & Migration

- A configured administrator name is reserved and registration requires the operator's configured password. -> **Set `SERVER_ADMIN_PASSWORD` before registering `SERVER_ADMIN_USERNAME`; SSO cannot claim that reserved name.**
- SSO identities are bound to the configured provider and its immutable subject, with no automatic linking by username or email; the authenticated UserInfo endpoint is required. -> **Set `AUTH_OAUTH2_USERINFO_URL` and create separate SSO accounts when local names or emails already exist.**
- Token-signing keys are no longer derived from database, administrator or provider passwords. -> **Configure an independently generated `AUTH_SEED` of at least 32 bytes for stable sessions; otherwise a new random key is generated at every restart.**
- Credentialed cross-origin requests require an explicit allowed origin. -> **Set `SERVER_CORS_ALLOWED_ORIGINS` for cross-origin cookie-based clients; bearer-authenticated clients remain supported.**
- Container data volumes are private to the service account, including existing database and save files. -> **Set `PUID`/`PGID` to the account that owns mounted data and grant any additional host access only to trusted accounts.**
- Remote metadata artwork must resolve to public HTTP(S) addresses, and downloaded media observes `MEDIA_MAX_SIZE` with a 64 MiB fallback when the limit is disabled. -> **Upload local artwork directly instead of using private-network URLs.**
- Game, media and save paths reject nested filesystem links; frontend ZIPs must contain ordinary relative files and stay within 256 MiB compressed and expanded. -> **Replace nested links with ordinary files and use a compatible frontend bundle.**

### Changes

- Fixed account confusion caused by wildcard usernames and recycled usernames or email addresses in old access/refresh tokens.
- SSO redirect handoffs carry tokens only in URL fragments; server logs omit query strings and redact nested credentials, password hashes and session tokens before console or file output.
- Server images use a smaller updated Alpine runtime, verified 7-Zip 26.04, private service-user file permissions and no compiler or package manager at runtime. New files use a restrictive umask; other local accounts cannot read stored API keys.
- Security updates patch known vulnerabilities across direct and transitive runtime/development dependencies, including multipart uploads, request logging, proxy address handling and HTTP parsing.
- Metadata image downloads validate every redirect and pin checked DNS addresses, limit streamed response sizes and omit signed URLs from download failures; active SVG/XML resources are rejected before decoding.
- Frontend ZIP downloads restrict redirects to approved GitHub HTTPS hosts and limit downloaded/extracted bytes; unsafe paths, links, duplicate files and oversized archives cannot replace the active cache.
- Aborted streamed uploads close their output files and remove partial data; game/media/save operations reject paths outside their configured volume or through nested links.

## 17.1.0

### Breaking Changes & Migration

- The database schema, migration history and default PostgreSQL database name use PlayStash. -> **Initialize a fresh database for this setup.**
- Stable releases and development builds use the `main` and `dev` branches. -> **Update local branch tracking and external automation to these branch names.**
- Activity data is sent only after an authenticated `get-activities` WebSocket message. -> **Clients must request activities after connecting.**
- Invalid or unavailable download byte ranges return HTTP 416 instead of silently downloading the whole file. -> **Send a valid single byte range, or restart the download without the Range header.**

### Changes

- OAuth2 sign-in returns to the initiating trusted client, including the desktop app, without exposing tokens to arbitrary redirect destinations.
- Uploads stream to disk instead of being buffered in memory, and incomplete uploads are cleaned up.
- Newly uploaded games remain visible during filesystem integrity checks.
- Resumable game downloads return accurate suffix bytes and HTTP 206 range headers; empty files remain downloadable.
- Game folder downloads work before indexing, archive caches notice changes to empty folders, and extras/addon folder names are recognized regardless of capitalization.
- Files whose game titles differ only by capitalization merge into the same game.
- [#350](https://github.com/Phalcode/gamevault-backend/issues/350), [#346](https://github.com/Phalcode/gamevault-backend/issues/346), [#336](https://github.com/Phalcode/gamevault-backend/issues/336) Game metadata supports a per-game archive password, minimum/recommended system requirements and named launch profiles.
- Library queries can filter every stored game version by its folder prefix.
- Save owners and administrators can list, download and delete individual save versions; deleting all saves now uses the authenticated user's permissions correctly.
- [#414](https://github.com/Phalcode/gamevault-backend/issues/414) Download limits support cron schedules and time zones, change during active downloads and cannot be bypassed by a client requesting a higher limit.
- [#237](https://github.com/Phalcode/gamevault-backend/issues/237) Optional webhook notifications announce newly added, restored and updated games without repeating unchanged library scans.
- [#356](https://github.com/Phalcode/gamevault-backend/issues/356) An optional Steam Store metadata provider supports title/App ID searches, images and automatic system requirements without a Steam account.
- [#241](https://github.com/Phalcode/gamevault-backend/issues/241) Unsupported WebP, AVIF and other decodable images are converted to an allowed image format; passive SVGs are rasterized and active SVG content is rejected.
- [#340](https://github.com/Phalcode/gamevault-backend/issues/340) Administrators can restrict individual games to selected users; hidden games stay out of library queries, downloads, save/progress access and activity data, with private activity sharing disabled by default.
- [#247](https://github.com/Phalcode/gamevault-backend/issues/247) Clients can report completed download/install/uninstall/play events with retry-safe UUIDs; administrators can inspect per-game totals and user events, with user opt-out, restricted-game privacy and configurable retention.
- [#280](https://github.com/Phalcode/gamevault-backend/issues/280), [#148](https://github.com/Phalcode/gamevault-backend/issues/148) Game folders can be indexed with an optional PlayStash manifest and downloaded as one archive; installation and launch recipes remain client-controlled.
- [#149](https://github.com/Phalcode/gamevault-backend/issues/149), [#142](https://github.com/Phalcode/gamevault-backend/issues/142) Games can provide separately downloadable extras and ordered mod/DLC/patch packages with game access checks.
- [#454](https://github.com/Phalcode/gamevault-app/issues/454) Users can request games, optionally anonymously; administrators manage fulfillment and requesters can acknowledge status updates.
- [#537](https://github.com/Phalcode/gamevault-app/issues/537) Game pages support one five-star rating and comment per user, with community averages.
- [#205](https://github.com/Phalcode/gamevault-app/issues/205) Authenticated users can chat in the lobby, game rooms and direct conversations, select busy/invisible status and receive disconnection updates; chat history is transient and respects game access restrictions.
- Browser and desktop Socket.IO messages authenticate through API keys and retain validated chat/activity payloads; missing or invalid socket keys are rejected.
- [#451](https://github.com/Phalcode/gamevault-app/issues/451) Administrators can view a bounded, sanitized tail of enabled server file logs without exposing nested configuration or user objects.
- [#451](https://github.com/Phalcode/gamevault-app/issues/451) Administrators can queue a full metadata refresh that bypasses cache TTL while retaining provider mappings, priorities and user overrides, with concurrent batches rejected.
- [#24](https://github.com/Phalcode/gamevault-frontend/issues/24) Administrators can persist folder-prefix rules that automatically add tags during indexing and metadata refreshes.
- Game metadata can define UMU launcher defaults for the game ID, store and Proton path.
- Added PlayStash branding throughout the server, configuration, API models, metadata identifiers, logs and deployment examples.
- All PlayStash features are available without a paid subscription.
- The OpenAPI specification documents required path parameters and can be exported locally for client generation.
- GitHub-hosted checks and releases run automatically on their declared triggers; only future self-hosted runner jobs require `PLAYSTASH_RUN_SELF_HOSTED=true`, disabled by default.
- Optional SonarCloud scans require your own account and explicit configuration.
- GitHub builds AMD64/ARM64 server images on `main` and `dev`; versioned releases reserve their commit in a draft before publishing images, reliably find pending drafts on retries, reject failed release lookups and retain published version images unchanged.
- The web interface can load an offline frontend ZIP or private GitHub releases using a server-only read token.
- Server containers start correctly from Windows checkouts by preserving Unix line endings in the entry script.

### Thanks

- @Astro1247
- @OmniNoesis
- @an0t8
- @Makhuta
- @Bovive
- @binarygeek119
- @strese
- @KairuByte
- @TheDuckMan64
- @ChaosTherum
- @PhuriousGeorge
- @JoaGamo
- @ozma6464
