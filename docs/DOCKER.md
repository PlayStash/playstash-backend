# PlayStash on a server

Copy `docker-compose.yml` to an empty directory on a Linux server with Docker
Engine and the Docker Compose plugin, change into that directory, and run:

```sh
docker compose up -d
```

The frontend repository builds its own AMD64/ARM64 image; the backend repository
builds only the API and PostgreSQL images. Compose downloads and starts all three, prepares persistent directories
and generates the private database password and authentication key. The server
needs no source checkout, compiler, registry login or environment file.

Open `http://SERVER-IP:8080` and register your account. The first account becomes
an active administrator; later accounts require administrator activation. Complete
this first registration before giving other people access to the instance.

To obtain game descriptions and covers, enable Steam or configure IGDB in the
backend environment. Steam needs no API key. See [Metadata, covers and game
descriptions](metadata.md) for the configuration, refreshing existing games,
correcting matches and setting your own images.

## Services and network

| Service              | Responsibility                                   | Reachability                            |
| -------------------- | ------------------------------------------------ | --------------------------------------- |
| `playstash-frontend` | Web interface, static files and proxy to the API | Host port 8080                          |
| `playstash-backend`  | API, authentication, games and WebSockets        | Compose network only, port 8080         |
| `db`                 | PostgreSQL 16 database                           | Compose network only, port 5432         |
| `playstash-init`     | Generate the database password once              | Exits successfully after initialization |

The frontend and backend run in distinct containers from distinct images. The
backend contains no frontend ZIP or web application and returns 404 at `/`.
The frontend contains static files and Nginx, with no backend runtime, database
password or user-data mounts. It runs as UID/GID 101 with a read-only filesystem
and a temporary `/tmp` mount. The initializer uses the backend image only to
create the private password file; it is not a fourth permanent server.

The frontend forwards `/api/` and `/socket.io/` to the backend and serves the SPA
for browser routes. Browser requests use the same public address. Authentication,
WebSocket upgrades, streaming uploads and ranged downloads pass through this
proxy. PostgreSQL and the backend need no externally published ports.

The images are public in two independently released GHCR packages:

| Image                   | Package                                | Stable       | Development      | Pinned release example |
| ----------------------- | -------------------------------------- | ------------ | ---------------- | ---------------------- |
| Backend and initializer | `ghcr.io/playstash/playstash-backend`  | `latest`     | `dev`            | `v17.1.6`              |
| PostgreSQL              | `ghcr.io/playstash/playstash-backend`  | `postgres16` | `postgres16-dev` | `postgres16-v17.1.6`   |
| Frontend                | `ghcr.io/playstash/playstash-frontend` | `latest`     | `dev`            | `v17.3.2`              |

The frontend repository owns its source build, runtime definition, license
notices and image publication. Its version is independent of the backend version.
The backend neither copies a frontend ZIP nor builds or retags the frontend image.
Backend CI anonymously resolves the matching published frontend channel once to
an immutable multiarch digest, tests the complete deployment and scans all three
runtime images on both architectures before publishing. Stable backend builds
test frontend `latest`; development builds test frontend `dev`. The distributed
Compose files follow stable `latest` images. Frontend and backend source
repositories are public; the other PlayStash repositories remain private.
GHCR package visibility is configured separately and permits anonymous image
downloads when public.

## Reverse proxy

Point your HTTPS reverse proxy at `http://SERVER-IP:8080`, the frontend service.
Use a dedicated hostname with `/` as its root. Forward all paths, enable WebSocket
upgrades and allow the desired upload size (game archives can be large). The
frontend routes API and WebSocket traffic internally, so one public proxy target
covers the whole installation.

If the outer proxy terminates HTTPS, it must set `Host`, `X-Forwarded-Proto` and
`X-Forwarded-For` correctly. Set `PLAYSTASH_TRUSTED_PROXY_CIDRS` to the explicit
IP or CIDR of the outer proxy as seen by the frontend container, for example:

```sh
PLAYSTASH_TRUSTED_PROXY_CIDRS=192.168.1.10/32 docker compose up -d
```

For a proxy running on the Docker host, the observed peer can be a Docker bridge
gateway rather than its public address; use that specific address. Keep the same
setting on subsequent starts, or put it in a local `.env` file. Leave it empty for
direct HTTP access. Only explicitly trusted peers can supply the client IP and
HTTPS protocol. Restrict access to port 8080 to the proxy when exposing a public
instance; do not trust `0.0.0.0/0` or `::/0`.

Use `PLAYSTASH_PORT=8090 docker compose up -d` if host port 8080 is already used.
To disable Basic self-registration after creating your administrator, add
`SERVER_REGISTRATION_DISABLED: "true"` under `playstash-backend.environment` and
run `docker compose up -d` again. SSO account provisioning is configured separately.

## Data and games

All persistent data lives beside the Compose file:

| Directory         | Contents                                     |
| ----------------- | -------------------------------------------- |
| `games/`          | Game archives and ordinary game folders      |
| `data/config/`    | Configuration and private authentication key |
| `data/postgres/`  | PostgreSQL database                          |
| `data/db/`        | Database backups                             |
| `data/secrets/`   | Automatically generated PostgreSQL password  |
| `data/media/`     | Covers, screenshots and other media          |
| `data/savefiles/` | Uploaded game saves                          |
| `data/plugins/`   | Backend plugins                              |
| `data/logs/`      | Backend logs                                 |

Upload games through the clients or place them in `games/` using the backend's
service account (UID/GID 1000 by default). Startup prepares these directories
and their permissions. For another owner use
`PUID=1001 PGID=1001 docker compose up -d` and keep those IDs on later starts.
Mounted data must use ordinary directories and files rather than filesystem
links. Frontend replacement does not change these directories.

For a consistent backup, run `docker compose stop`, back up `data/` and `games/`,
then run `docker compose start`. Preserve `data/config/auth-seed`,
`data/secrets/postgres-password` and `data/postgres/` together. PostgreSQL 16
backups use matching version 16 tools. A failed restore reports an error and
recovers the original database; if recovery itself fails, its private snapshot
remains in `data/db/playstash-restore-*/` for manual recovery. The password is
randomly generated once and never logged. Later starts reuse both private keys;
invalid or unsafe key files stop startup. Explicit `AUTH_SEED`, `AUTH_SEED_FILE`
or the corresponding YAML setting takes precedence over automatic persistence.

These Compose files use PostgreSQL for a fresh installation. They do not convert
an existing database. `docker-compose.postgres.yml` is an identical named
alternative to `docker-compose.yml`.

## Status, updates and stopping

```sh
docker compose ps
docker compose logs --tail=100
```

`playstash-init` finishes with status 0. PostgreSQL becomes healthy before the
backend starts, and the frontend starts after the API is healthy. The database,
backend and frontend each have health checks. The initial startup can take a
short time while the empty database is prepared.

The standard Compose file follows stable releases and checks for updates on each
start. Apply an available update from the same directory with:

```sh
docker compose up -d
```

`docker compose down` removes containers and the network, retaining host data.
Start again with `docker compose up -d`. Keep the same installation directory and
do not delete `data/` or `games/`. To pin releases, select backend and PostgreSQL
tags with the same backend version, including the initializer, and select the
frontend's own version separately using the table above. Backend and frontend can be
recreated independently without invalidating existing users or authentication
keys. API documentation is available at `/api/docs`.
