# PlayStash Backend

PlayStash is a self-hosted gaming platform for organizing and sharing legally obtained DRM-free games with your friends. This repository contains the backend server.

Find the source, releases and issue tracker in the [PlayStash backend repository](https://github.com/PlayStash/playstash-backend). See [INSTALL.md](INSTALL.md) for local development setup and the Docker Compose examples for a fresh installation.

PlayStash features do not require a paid subscription.

## GitHub Actions

Workflow jobs are disabled by default. To enable them deliberately, set the repository Actions variable `PLAYSTASH_RUN_WORKFLOWS` to the exact value `true` under Settings → Secrets and variables → Actions → Variables. An unset variable, `false`, or any other value keeps every job disabled. Existing branch and project conditions still apply after enabling workflows.

Optional integrations use your own accounts. For SonarCloud, set the repository variables `PLAYSTASH_SONAR_PROJECT_KEY` and `PLAYSTASH_SONAR_ORGANIZATION`, and add the `SONAR_TOKEN` secret; the scan job stays disabled when either variable is unset. For Discord release notices, set `PLAYSTASH_DISCORD_NOTIFICATIONS` to `true` and add the `DISCORD_RELEASE_BOT_WEBHOOK` secret. Notices stay disabled by default. Container publishing requires your own Docker Hub account and the `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` secrets.

## Attribution and license

This project builds on the work of Alkan Alper, Schäfer Philip GbR / Phalcode and its contributors. The original author and copyright notices remain in the source and license.

This work is source-available and licensed under the [Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International License](https://creativecommons.org/licenses/by-nc-sa/4.0/). See [LICENSE](LICENSE) for the full terms.

## Responsible use

PlayStash manages DRM-free games. Users are responsible for the content they store or share and for complying with copyright laws. The project does not endorse piracy.
