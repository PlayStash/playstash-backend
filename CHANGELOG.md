# PlayStash Backend Changelog

## 17.0.1

### Breaking Changes & Migration

- The database schema, migration history and default PostgreSQL database name use PlayStash. -> **Initialize a fresh database for this setup.**
- Stable releases and development builds use the `main` and `dev` branches. -> **Update local branch tracking and external automation to these branch names.**

### Changes

- Game metadata can define UMU launcher defaults for the game ID, store and Proton path.
- Added PlayStash branding throughout the server, configuration, API models, metadata identifiers, logs and deployment examples.
- All PlayStash features are available without a paid subscription.
- The OpenAPI specification documents required path parameters and can be exported locally for client generation.
- Workflow jobs run only when the repository Actions variable `PLAYSTASH_RUN_WORKFLOWS` is set to `true`; they are disabled by default.
- Optional SonarCloud scans and Discord release notices require your own accounts and explicit configuration.
