# PlayStash Backend

PlayStash is a self-hosted gaming platform for organizing and sharing legally obtained DRM-free games with your friends. This repository contains the backend server.

Find the source, releases and issue tracker in the [PlayStash backend repository](https://github.com/PlayStash/playstash-backend). See [INSTALL.md](INSTALL.md) for local development setup.

## Install on a server

Copy `docker-compose.yml` into an empty directory on a Linux server with Docker
and the Compose plugin, then run:

```sh
docker compose up -d
```

Open `http://SERVER-IP:8080` and register your administrator account. GitHub builds
separate public AMD64/ARM64 frontend, backend and PostgreSQL images.
Persistent data directories, a unique database password and a private
authentication key are prepared automatically.
The first registered account becomes the administrator; later accounts need
activation. No source checkout, server build, registry login or environment file
is required. See [the server guide](docs/DOCKER.md) for games, backups, updates,
custom ports and the PostgreSQL configuration.

See [the central PlayStash documentation](https://github.com/PlayStash/playstash-docs) and [metadata setup](docs/metadata.md) for Steam, IGDB, remapping and covers. [Privacy and external services](docs/privacy.md) explains analytics, provider requests, own-server metrics and logs.

See [Game packages](docs/packages.md) for unarchived game folders, optional installation manifests, extras, and separate mod/DLC/patch archives.

Additional guides cover [folder tags](docs/folder-tags.md), [requests and reviews](docs/feedback.md), [chat](docs/chat.md), [game metrics](docs/metrics.md), [library options](docs/library-options.md), and [administrator logs](docs/admin-logs.md).

See the [upstream issue status](docs/upstream-issue-status.md) for implemented requests and the remaining achievement format/adapter clarification.

PlayStash features do not require a paid subscription.

## Authentication security

Containers automatically generate and privately persist a random authentication
key in `/config/auth-seed` when `AUTH_SEED_PERSIST=true`. Explicit `AUTH_SEED` or
`AUTH_SEED_FILE` settings take precedence and require at least 32 bytes of
independently generated randomness. Token keys are never derived from an
administrator, database or provider password. Without persistence or an explicit
key, each restart generates a new key and invalidates existing tokens.
If `SERVER_ADMIN_USERNAME` is configured,
registration of that reserved account requires `SERVER_ADMIN_PASSWORD`; other
registrations cannot claim administrator privileges by choosing that name.
SSO requires `AUTH_OAUTH2_USERINFO_URL`, binds accounts to that
configured provider's immutable subject, and rejects collisions with existing
local usernames or emails instead of automatically linking accounts. Use HTTPS
for identity-provider endpoints. Cross-origin cookie clients require their exact
origin in `SERVER_CORS_ALLOWED_ORIGINS`.

Deactivation blocks every role, including administrators, from using sign-in,
existing access/refresh tokens, API keys and issued download tokens. Deactivating
or deleting an account disconnects its live chat/activity sessions. A configured
`SERVER_ADMIN_USERNAME` is still recovered and activated on server startup.

See [the security review](docs/security-audit.md) for verified fixes and scan scope.

Container data directories and newly created files are private to the service
account. Application code remains readable by explicitly selected non-root users.
Set `PUID` and `PGID` to the owner of your mounted volumes; explicitly managed
non-root deployments must provide that account with access themselves.

## GitHub Actions

The repository uses `main` for stable releases and `dev` for development builds.

GitHub-hosted jobs run automatically on their declared triggers. Pull requests run the checks; pushes to `main` and `dev` or matching version tags run checks and container publishing. Branch, dependency and optional project conditions still apply. The image-deletion workflow remains manual through `workflow_dispatch`.

This repository currently defines no self-hosted runner jobs. Any future jobs on user-installed runners must require the repository Actions variable `PLAYSTASH_RUN_SELF_HOSTED` to equal the exact value `true`; unset or `false` keeps those jobs disabled by default. Configure the variable under Settings → Secrets and variables → Actions → Variables. It does not gate GitHub-hosted jobs.

Successful builds publish AMD64 and ARM64 container images to `ghcr.io/playstash/playstash-backend`: `dev` follows development, `latest` follows `main`, and `v17.1.4` is the immutable backend version tag. Increase `package.json`'s version and add matching changelog notes for the next GitHub release; matching `v<VERSION>` Git tags are also supported. Publishing uses the repository's own `GITHUB_TOKEN`, with no Docker Hub credentials required. The server container package is public for anonymous pulls while the source repository stays private. Distinct `frontend` / `frontend-dev` / `frontend-v17.1.4` tags contain the web interface; `postgres16` / `postgres16-dev` / `postgres16-v17.1.4` contain the database. Stable releases include the single Compose file that starts all separate services and the server guide.

For optional SonarCloud scans, set `PLAYSTASH_SONAR_PROJECT_KEY`, `PLAYSTASH_SONAR_ORGANIZATION`, and the `SONAR_TOKEN` secret for your own account.

## Attribution and license

This project builds on the work of Alkan Alper, Schäfer Philip GbR / Phalcode and its contributors. The original author and copyright notices remain in the source and license.

This work is source-available and licensed under the [Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International License](https://creativecommons.org/licenses/by-nc-sa/4.0/). See [LICENSE](LICENSE) for the full terms.

## Responsible use

PlayStash manages DRM-free games. Users are responsible for the content they store or share and for complying with copyright laws. The project does not endorse piracy.
