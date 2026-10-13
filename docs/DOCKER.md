# PlayStash on a server

The standard installation needs only a Linux server with Docker Engine and the
Docker Compose plugin. Images are built by GitHub for AMD64 and ARM64. The image
includes the web interface, so the server needs no source checkout, compiler,
GitHub account, registry login, frontend ZIP, environment file or default password.

## Start

Copy `docker-compose.yml` to an empty directory on the server, change into that
directory, and run:

```sh
docker compose up -d
```

Open `http://SERVER-IP:8080` and register your own account. The first registered
account becomes the administrator and is immediately active. Later accounts need
administrator activation. Complete this first registration before giving other
people access to the server. There are no shared administrator credentials.

The standard Compose file uses a separate PostgreSQL container. It automatically
starts the database, imports the bundled web interface, creates random private
database and signing keys and prepares the writable directories. Keep the Compose file in the
same directory on subsequent starts. The server needs outbound internet access
for the initial image download and optional external metadata providers.

## Data and games

All writable data lives beside the Compose file:

| Directory         | Contents                                                           |
| ----------------- | ------------------------------------------------------------------ |
| `games/`          | Game archives and ordinary game folders                            |
| `data/config/`    | Configuration, cached web interface and private authentication key |
| `data/postgres/`  | PostgreSQL database                                                |
| `data/db/`        | Database backups                                                   |
| `data/secrets/`   | Private, automatically generated PostgreSQL password               |
| `data/media/`     | Covers, screenshots and other media                                |
| `data/savefiles/` | Uploaded game saves                                                |
| `data/plugins/`   | Server plugins                                                     |
| `data/logs/`      | Server logs                                                        |

Add games through the clients or place them in `games/` using the container's
service account (UID/GID 1000 by default). Container startup creates and assigns
these folders automatically. For an existing directory with another owner, run
`PUID=1001 PGID=1001 docker compose up -d` with the intended account IDs, applying
them to both the initializer and backend. Keep the same IDs on later starts.
Subdirectories and files must be ordinary files rather than filesystem links.

For a consistent backup, run `docker compose stop`, back up both `data/` and
`games/`, then run `docker compose start`. A complete restoration includes
`data/config/auth-seed`; preserving that private key keeps existing sessions
valid after a restart. Keep backup access restricted to trusted administrators.

## Status, updates and stopping

```sh
docker compose ps
docker compose logs --tail=100
```

The image's health check reports when the API is ready. The initial startup may
take a short time while PostgreSQL and the empty database are prepared. The
`playstash-init` service generates the database password once and exits with
status 0; that completed service is expected. The database becomes healthy before
the server starts. PostgreSQL is reachable only inside the Compose network.

The standard file follows stable `main` releases and checks the registry on every
`up`. Apply an available update with the same command:

```sh
docker compose up -d
```

`docker compose down` removes the containers and network while keeping the host
data directories. Start again with `docker compose up -d`. Do not delete `data/`
or `games/` when updating. To keep a specific release, change the image tag from
`latest` to a published version such as `v17.1.3` for both the initializer and
backend. Pin the database image to `postgres16-v17.1.3` at the same time.

Use `PLAYSTASH_PORT=8090 docker compose up -d` when host port 8080 is already in
use. For access over the internet, serve the instance through your existing HTTPS
reverse proxy. The bundled frontend and API share the same server address.

## PostgreSQL and private keys

`docker-compose.postgres.yml` is an identical, explicitly named alternative to
`docker-compose.yml`. Both install PostgreSQL without a password placeholder or
an environment file. The initialization service generates a unique 32-byte random
password in `data/secrets/postgres-password`. The backend and PostgreSQL read that
same file through read-only mounts. Later starts reuse it rather than changing
the database password. It is never printed in the initialization log.

Back up and restore `data/secrets/` together with `data/postgres/`; a database and
its password belong to the same installation. Keep the private signing key in
`data/config/auth-seed` with the same backup. Invalid or unsafe key files stop
startup rather than silently generating replacement keys.

The database image `ghcr.io/playstash/playstash-backend:postgres16` builds on the
official PostgreSQL 16 Alpine image with updated system packages and an Alpine
privilege-switch helper. The official PostgreSQL initialization remains intact.
GitHub publishes both server and database images for AMD64 and ARM64 and scans
their actual runtime contents for known vulnerabilities before release.

Existing PostgreSQL installations should keep their current connection settings,
credentials and data directories. These Compose files are for a fresh
installation and do not move or convert an existing database.

## Image contents and custom configuration

Each server image ships a verified, pinned frontend release under
`/opt/playstash/frontend/`; its version, source commit, ZIP checksum and licenses
are recorded there. The same bundled frontend is available without any GitHub
request at startup. A new frontend release is included in a server release by
updating its pinned bundle and provenance; a frontend repository push alone does
not change an already published server image.

`WEB_UI_LOCAL_BUNDLE` can override the bundled ZIP for a custom frontend.
`WEB_UI_ENABLED=false` runs only the API. The default container enables
`AUTH_SEED_PERSIST=true`, generating and reusing the private key in `/config`.
An explicit `AUTH_SEED`, `AUTH_SEED_FILE` or corresponding YAML setting takes
precedence. Standalone Node installations retain the existing random-per-start
behavior unless persistence is enabled.

To fetch a different private GitHub frontend release instead of using the bundled
one, set `WEB_UI_LOCAL_BUNDLE: ""`, then provide `WEB_UI_VERSION` and a read-only
`WEB_UI_GITHUB_TOKEN` or `WEB_UI_GITHUB_TOKEN_FILE`. The default bundle takes
precedence over GitHub version selection and corresponding YAML settings.

Container image visibility is independent of the private source repository. The
published server package must remain public so new servers can pull it without
credentials; GitHub Actions verifies anonymous access when publishing releases.
