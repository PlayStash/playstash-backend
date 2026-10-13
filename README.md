# PlayStash Backend

PlayStash is a self-hosted gaming platform for organizing and sharing legally obtained DRM-free games with your friends. This repository contains the backend server.

Find the source, releases and issue tracker in the [PlayStash backend repository](https://github.com/PlayStash/playstash-backend). See [INSTALL.md](INSTALL.md) for local development setup and the Docker Compose examples for a fresh installation.

See [Game packages](docs/packages.md) for unarchived game folders, optional installation manifests, extras, and separate mod/DLC/patch archives.

Additional guides cover [folder tags](docs/folder-tags.md), [requests and reviews](docs/feedback.md), [chat](docs/chat.md), [game metrics](docs/metrics.md), [library options](docs/library-options.md), and [administrator logs](docs/admin-logs.md).

See the [upstream issue status](docs/upstream-issue-status.md) for implemented requests and the remaining achievement format/adapter clarification.

PlayStash features do not require a paid subscription.

## Authentication security

Set `AUTH_SEED` to at least 32 bytes of independently generated randomness to keep
sessions valid across restarts. Token keys are never derived from an administrator,
database or provider password; without `AUTH_SEED`, each restart generates a new
key and invalidates existing tokens. If `SERVER_ADMIN_USERNAME` is configured,
registration of that reserved account requires `SERVER_ADMIN_PASSWORD`; other
registrations cannot claim administrator privileges by choosing that name.
SSO requires `AUTH_OAUTH2_USERINFO_URL`, binds accounts to that
configured provider's immutable subject, and rejects collisions with existing
local usernames or emails instead of automatically linking accounts. Use HTTPS
for identity-provider endpoints. Cross-origin cookie clients require their exact
origin in `SERVER_CORS_ALLOWED_ORIGINS`.

See [the security review](docs/security-audit.md) for verified fixes and scan scope.

Container data directories and newly created files are private to the service
account. Set `PUID` and `PGID` to the owner of your mounted volumes; explicitly
managed non-root deployments must provide that account with access themselves.

## GitHub Actions

The repository uses `main` for stable releases and `dev` for development builds.

GitHub-hosted jobs run automatically on their declared triggers. Pull requests run the checks; pushes to `main` and `dev` or matching version tags run checks and container publishing. Branch, dependency and optional project conditions still apply. The image-deletion workflow remains manual through `workflow_dispatch`.

This repository currently defines no self-hosted runner jobs. Any future jobs on user-installed runners must require the repository Actions variable `PLAYSTASH_RUN_SELF_HOSTED` to equal the exact value `true`; unset or `false` keeps those jobs disabled by default. Configure the variable under Settings → Secrets and variables → Actions → Variables. It does not gate GitHub-hosted jobs.

Successful builds publish AMD64 and ARM64 container images to `ghcr.io/playstash/playstash-backend`: `dev` follows development, `latest` follows `main`, and `v17.1.1` is the immutable version tag. Increase `package.json`'s version and add matching changelog notes for the next GitHub release; matching `v<VERSION>` Git tags are also supported. Publishing uses the repository's own `GITHUB_TOKEN`, with no Docker Hub credentials required. Private container images require an authenticated registry login.

For optional SonarCloud scans, set `PLAYSTASH_SONAR_PROJECT_KEY`, `PLAYSTASH_SONAR_ORGANIZATION`, and the `SONAR_TOKEN` secret for your own account.

## Attribution and license

This project builds on the work of Alkan Alper, Schäfer Philip GbR / Phalcode and its contributors. The original author and copyright notices remain in the source and license.

This work is source-available and licensed under the [Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International License](https://creativecommons.org/licenses/by-nc-sa/4.0/). See [LICENSE](LICENSE) for the full terms.

## Responsible use

PlayStash manages DRM-free games. Users are responsible for the content they store or share and for complying with copyright laws. The project does not endorse piracy.
