# PlayStash Backend

PlayStash is a self-hosted gaming platform for organizing and sharing legally obtained DRM-free games with your friends. This repository contains the backend server.

Find the source, releases and issue tracker in the [PlayStash backend repository](https://github.com/PlayStash/playstash-backend). See [INSTALL.md](INSTALL.md) for local development setup and the Docker Compose examples for a fresh installation.

See [Game packages](docs/packages.md) for unarchived game folders, optional installation manifests, extras, and separate mod/DLC/patch archives.

Additional guides cover [folder tags](docs/folder-tags.md), [requests and reviews](docs/feedback.md), [chat](docs/chat.md), [game metrics](docs/metrics.md), [library options](docs/library-options.md), and [administrator logs](docs/admin-logs.md).

See the [upstream issue status](docs/upstream-issue-status.md) for implemented requests and the remaining achievement format/adapter clarification.

PlayStash features do not require a paid subscription.

## GitHub Actions

The repository uses `main` for stable releases and `dev` for development builds.

Workflow jobs are disabled by default. To enable them deliberately, set the repository Actions variable `PLAYSTASH_RUN_WORKFLOWS` to the exact value `true` under Settings → Secrets and variables → Actions → Variables. An unset variable, `false`, or any other value keeps every job disabled. Existing branch and project conditions still apply after enabling workflows.

Enabling workflows builds and checks each push. Successful builds publish AMD64 and ARM64 container images to `ghcr.io/playstash/playstash-backend`: `dev` follows development, `latest` follows `main`, and `v17.1.0` is the immutable version tag. Increase `package.json`'s version and add matching changelog notes for the next GitHub release; matching `v<VERSION>` Git tags are also supported. Publishing uses the repository's own `GITHUB_TOKEN`, with no Docker Hub credentials required. Private container images require an authenticated registry login.

For optional SonarCloud scans, set `PLAYSTASH_SONAR_PROJECT_KEY`, `PLAYSTASH_SONAR_ORGANIZATION`, and the `SONAR_TOKEN` secret for your own account.

## Attribution and license

This project builds on the work of Alkan Alper, Schäfer Philip GbR / Phalcode and its contributors. The original author and copyright notices remain in the source and license.

This work is source-available and licensed under the [Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International License](https://creativecommons.org/licenses/by-nc-sa/4.0/). See [LICENSE](LICENSE) for the full terms.

## Responsible use

PlayStash manages DRM-free games. Users are responsible for the content they store or share and for complying with copyright laws. The project does not endorse piracy.
