# How to Set Up PlayStash Backend for Local Development

For a fresh server installation, copy `docker-compose.yml` and run
`docker compose up -d`; see [the server guide](docs/DOCKER.md). The default Compose
file loads a prebuilt image with the web interface, automatically creates a
PostgreSQL database with a unique generated password, and persists all writable data beside the Compose file. The
steps below are for local source development.

To generate the frontend API specification from this backend without starting a server or connecting to a database, run `pnpm export:openapi ../playstash-frontend/api-spec/playstash.openapi.json` after installing development dependencies.

Run `pnpm check:fresh-schema sqlite` to verify all migrations against an empty, in-memory SQLite database. To check PostgreSQL, set `PLAYSTASH_TEST_DATABASE_URL` to an empty test database and run `pnpm check:fresh-schema postgres`.

## Web interface and private repositories

The published Docker image already contains a verified `playstash-frontend.zip`
release bundle and serves it without a GitHub download or token. For custom or
standalone installations, mount a different bundle and set
`WEB_UI_LOCAL_BUNDLE=/path/to/playstash-frontend.zip`. Its ZIP must contain
`dist/index.html`; changes to the ZIP are detected by its content hash on server
restart. This option takes precedence over GitHub release lookup and works
without credentials or a network connection.

Alternatively, set `WEB_UI_LOCAL_BUNDLE: ""` to enable GitHub release lookup in a
container. Private frontend releases require `WEB_UI_GITHUB_TOKEN` or
`WEB_UI_GITHUB_TOKEN_FILE`, with a fine-grained token granting **Contents: read** on
`PlayStash/playstash-frontend`. The token remains server-side, is redacted from the
configuration API, and is omitted from asset-download redirects. Public
repositories need no token. `WEB_UI_VERSION=v17.2.1` pins a release in this mode.
Set `WEB_UI_ENABLED=false` to run only the API.

The server container package supports anonymous pulls; source repositories and
installer releases remain private. Those GitHub releases require an account with
repository access. A private release feed cannot be used anonymously by the
desktop updater; distribute updates through an accessible feed or download
installers while authenticated.

## Scheduled download bandwidth

Download limits apply per transfer in KiB/s. A client can request a slower speed but cannot exceed the server limit. `0` means unlimited.

Set `SERVER_MAX_DOWNLOAD_BANDWIDTH_SCHEDULE` to a five-field cron expression. Every minute matching it uses `SERVER_MAX_DOWNLOAD_BANDWIDTH_IN_KBPS_IN_SCHEDULE`; other minutes use `SERVER_MAX_DOWNLOAD_BANDWIDTH_IN_KBPS_OUT_SCHEDULE` (unlimited by default). If the inside limit is omitted, it inherits `SERVER_MAX_DOWNLOAD_BANDWIDTH_IN_KBPS`. Without a schedule, the original limit applies at all times.

```yaml
environment:
  SERVER_MAX_DOWNLOAD_BANDWIDTH_SCHEDULE: "* 6-18 * * MON-FRI"
  SERVER_MAX_DOWNLOAD_BANDWIDTH_SCHEDULE_TIMEZONE: "Europe/Berlin"
  SERVER_MAX_DOWNLOAD_BANDWIDTH_IN_KBPS_IN_SCHEDULE: "2048"
  SERVER_MAX_DOWNLOAD_BANDWIDTH_IN_KBPS_OUT_SCHEDULE: "0"
```

This limits weekday downloads from 06:00 through 18:59 to 2 MiB/s. The optional timezone defaults to the server timezone. Schedule changes take effect during ongoing downloads without restarting the server; changing the environment configuration itself requires a restart. Invalid schedules or timezone names are rejected.

## External library notifications

Set `NOTIFICATIONS_WEBHOOK_URL` to enable optional notifications when a game is added, restored, or a release file changes. Unchanged rescans do not send notifications. `NOTIFICATIONS_WEBHOOK_FORMAT=json` (default) sends an event with the game ID, title, version, and timestamp; use `discord` for a Discord-compatible webhook. `NOTIFICATIONS_WEBHOOK_TOKEN` optionally supplies a Bearer token. Both the webhook URL and token support the `_FILE` secrets mechanism and are redacted from the configuration API.

Notifications are sent asynchronously, with timeouts, a bounded queue, and retries for temporary delivery failures. A notification failure does not fail uploads or library scans. No webhook is configured by default.

## Local development prerequisites

- [Git](https://git-scm.com/)
- [Node.js LTS](https://nodejs.org/)
- [pnpm](https://pnpm.io)
- [Visual Studio Code (\*)](https://code.visualstudio.com/)
- [Docker (\*)](https://www.docker.com/)

`Items with an asterisk (*) are optional, but recommended.`

## Steps to Get Started

1. **Clone the Repository**

   Open your terminal and run:

   ```bash
   git clone https://github.com/PlayStash/playstash-backend
   ```

2. **Go to the Project Folder**

   Navigate to the directory you just downloaded:

   ```bash
   cd playstash-backend
   ```

3. **Install the Required Dependencies**

   Install all necessary packages:

   ```bash
   pnpm install
   ```

4. **Set Up Your Environment**

   Copy the sample environment file:

   ```bash
   cp .dev.env .env
   ```

5. **Start the App or Run Tests**

   To start the app:

   ```bash
   pnpm start
   ```

   To run tests:

   ```bash
   pnpm test
   ```

## Contributing

Before contributing, please review and agree to the [Contributors License Agreement](CONTRIBUTING.md) and the [License](LICENSE.md).
