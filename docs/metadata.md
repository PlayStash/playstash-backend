# Metadata, covers and game descriptions

PlayStash obtains metadata through the backend. Configure providers on the server;
the web interface currently has no form for adding provider credentials. The
supplied Compose starts the server without contacting a live metadata provider:
Steam is disabled by default, and IGDB needs your credentials.

Keep these provider settings under `playstash-backend.environment`; the separately
published `ghcr.io/playstash/playstash-frontend` image needs no provider credentials.

The built-in live providers are Steam and IGDB. `RAWG (Legacy)` is a compatibility
entry and does not fetch new metadata. SteamGridDB and other services are not
built-in providers.

## Enable Steam

Steam needs only `METADATA_STEAM_ENABLED: "true"` in the backend environment,
followed by applying the Compose change. No Steam account, API key or additional
container is required. The backend needs outbound HTTPS access to the Steam Store
and its image servers.

Edit the **existing** `playstash-backend.environment` mapping in your
`docker-compose.yml`. Add the Steam entry alongside the existing database and
authentication settings; do not add a second `environment` block or replace
those settings. This excerpt shows the location in the supplied Compose:

```yaml
services:
  playstash-backend:
    # Keep this service's existing image, volumes and other settings.
    environment:
      DB_SYSTEM: POSTGRESQL
      DB_HOST: db
      DB_USERNAME: playstash
      DB_DATABASE: playstash
      DB_PASSWORD_FILE: /run/playstash-secrets/postgres-password
      AUTH_SEED_PERSIST: "true"
      PUID: "${PUID:-1000}"
      PGID: "${PGID:-1000}"
      METADATA_STEAM_ENABLED: "true"
```

Then run from the directory containing the Compose file:

```sh
docker compose up -d
```

Compose recreates the backend with the changed environment. Existing users,
games and persistent data are retained. To fetch metadata for existing games
immediately, follow [Refresh your library](#refresh-your-library).

Adding `METADATA_STEAM_ENABLED=true` to `.env` alone does not enable the provider
in the supplied Compose. Compose uses `.env` for interpolation; an arbitrary key
is not automatically passed into a container. Put the value under the backend's
`environment`, or reference it there explicitly, for example:

```yaml
      METADATA_STEAM_ENABLED: "${METADATA_STEAM_ENABLED:-false}"
```

Steam supplies descriptions, images, genres, developers, publishers, screenshots,
trailers and system requirements where available. Its cover comes from Steam's
wide header image; you can replace it manually with a portrait cover.

## Enable IGDB

Create a Twitch developer application with client type `Confidential`, then
obtain its Client ID and Client Secret. Twitch requires two-factor authentication.
The redirect URL is not used by IGDB; its setup guide tells you to use `localhost`.
See the [official IGDB setup guide](https://api-docs.igdb.com/#account-creation).

Add these entries to the **same existing backend environment mapping**:

```yaml
      METADATA_IGDB_ENABLED: "true"
      METADATA_IGDB_CLIENT_ID: "YOUR_CLIENT_ID"
      METADATA_IGDB_CLIENT_SECRET: "YOUR_CLIENT_SECRET"
```

Run `docker compose up -d` again. PlayStash obtains and renews the access token
itself. Keep the secret on the server and out of committed configuration. You can
also use a mounted secret file as described under [Configuration alternatives](#configuration-alternatives).

IGDB supplies covers, descriptions, screenshots, genres, developer and publisher
information, and other available game details. Without both credentials, IGDB is
inactive even though its enable flag defaults to `true`. Setting its enable flag
to `false` disables fetching even when credentials are present.

Steam and IGDB can run together. Your server contacts the configured providers
to search for games, fetch metadata and download images. A provider cannot supply
metadata for a game it does not list, and provider outages may delay updates.

## Refresh your library

After enabling a provider, sign in as an administrator and open:

`Administration → Server diagnostics → Refresh all metadata → Queue refresh`

The server processes games in the background. Use `Read server logs` or
`Refresh logs` in the same card to inspect progress. Large libraries take time
because provider rate limits still apply. A successfully queued refresh does not
mean every remote provider request has already completed.

The refresh preserves your chosen provider mappings and manual metadata, bypasses
the normal metadata cache age, and clears provider response caches. It does not
delete games or rebuild the file index. Games with `(NC)` in a version's file path
remain excluded from provider fetching. Provider errors are logged while the
remaining games continue. Another full refresh while a batch is active is rejected.

`Administration → Actions → Reindex Games` scans game files. It is a separate
operation from refreshing metadata.

For API clients, administrators can call `POST /api/metadata/recache`. HTTP 202
reports `{ "queued_games": 123, "processing": true }`; another concurrent batch
returns HTTP 409. An empty queue reports `processing: false`.

## Correct an incorrect match

Open the game and select its `Settings` gear, then open:

`Game Settings → Metadata → provider → Search & Remap`

Search for the correct title and choose `Remap` on the correct result. Steam also
accepts a numeric Steam App ID or an exact HTTPS Steam Store app URL, such as
`https://store.steampowered.com/app/620/`. IGDB accepts titles and numeric IGDB game
IDs. Provider IDs belong to their respective providers and are not interchangeable.

Provider selection and mapping belong to each game. Enabling the provider itself
still requires the server configuration above. If an enabled provider does not
appear, check the backend configuration and server logs; IGDB is not registered
when its credentials are missing.

## Set your own covers and descriptions

For a cover, open:

`Game Settings → Edit Images → Cover`

Upload an image or use `Paste image URL`, then choose `Save Images`.
`Find Images` opens an image search; it does not add another automatic provider.

For the title, description or other manual fields, use:

`Game Settings → Custom Metadata → Save Custom Metadata`

Manual metadata overrides provider values and remains intact during a full
provider refresh. Image downloads and uploads remain subject to the server's
media validation and size limits.

## Optional provider settings

| Setting | Default |
| --- | --- |
| `METADATA_STEAM_ENABLED` | `false` |
| `METADATA_STEAM_PRIORITY` | `5` |
| `METADATA_STEAM_REQUEST_INTERVAL_MS` | `1000` |
| `METADATA_IGDB_ENABLED` | `true`; both credentials also required |
| `METADATA_IGDB_PRIORITY` | `10` |
| `METADATA_IGDB_REQUEST_INTERVAL_MS` | `250` |
| `METADATA_TTL_IN_DAYS` | `30` |

Higher priority provider values take precedence when both providers supply the
same field. Explicit manual metadata has the highest precedence. Keep provider
priorities distinct. A game's provider priority override can change that game's
merge order.

Intervals are measured in milliseconds. Preserve the defaults unless you
understand the provider's limits; IGDB documents a limit of four requests per
second. Normal refreshes reuse metadata until its configured cache age expires;
the full administrator refresh bypasses that age while preserving request limits.

## Configuration alternatives

The backend also reads these keys from mounted `/config/config.yaml` or
`/config/config.yml`, which is `data/config/` beside the supplied Compose file.
For example, put this in `data/config/config.yaml`:

```yaml
METADATA_STEAM_ENABLED: true
```

Restart the backend after changing this file:

```sh
docker compose restart playstash-backend
```

Explicit environment values override YAML, so remove a conflicting environment
entry if you want YAML to supply that value. If both YAML filenames exist, the
backend reads `config.yaml` first.

For credentials, `<KEY>_FILE` reads a file mounted into the backend and takes
precedence over the direct environment value. For example,
`METADATA_IGDB_CLIENT_SECRET_FILE: /run/secrets/igdb-client-secret` reads the secret
from that container path. You must provide the corresponding secret or read-only
file mount yourself; the supplied Compose does not create IGDB credentials.
