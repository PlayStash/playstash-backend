# Shared game options, providers and access

For provider setup, IGDB credentials, Steam activation, manual covers and the
current web-interface steps, see [Metadata, covers and game descriptions](metadata.md).

Game metadata supports `archive_password`, Markdown
`system_requirements_minimum`/`system_requirements_recommended`, and an array of
named `launch_profiles`. A profile contains `name`, a relative `executable`
inside the installed game, and optional `parameters`. Absolute paths, parent
directory traversal and duplicate profile names are rejected. An explicit empty
profile array disables provider defaults. These are shared library settings;
the server never executes launch profiles itself.

Set `METADATA_STEAM_ENABLED=true` to enable the Steam Store provider. Its default
priority is 5 and request interval is 1,000 ms; configure
`METADATA_STEAM_PRIORITY` and `METADATA_STEAM_REQUEST_INTERVAL_MS` if needed.
Search by title, an App ID, or an exact Steam Store app URL. The provider obtains
images, description, tags and minimum/recommended requirements from the Steam
Store without an account or API key. Existing user metadata overrides provider
values. Provider failures leave existing library data available.

Administrators can use `POST /api/metadata/recache` to queue a full background
refresh. HTTP 202 reports `{ "queued_games": 123, "processing": true }`.
Another full batch while one is active returns 409. Refreshes bypass metadata
TTL and clear provider response caches, respect provider rate limits and
`(NC)` paths, preserve chosen provider IDs/priorities and keep user overrides.
They do not delete game files or rebuild the filesystem index. Provider failures
are logged and other games continue; this response confirms queueing, not that
every remote provider succeeded.

Administrators can update a game with `access_restricted: true` and a list of
`allowed_user_ids`. Restricted games are visible only to those users and admins,
including their downloads, images, save versions, progress, package assets and
game chat rooms. The normal age restriction still applies to non-admin users.
Restricting a game without selected users keeps it admin-only.

`share_restricted_activity` is disabled by default. It controls whether other
users who have game access can see your restricted-game activity/progress and
whether admins can inspect your restricted-game metrics. Simple progress
filters default to your own user. Filtering another user's restricted progress
requires their sharing preference; arbitrary cross-user progress expressions
operate on public games only. Library filtering happens on the server before
pagination, including `filter.created_at` and
`filter.versions.file_path=$sw:<folder prefix>/`.

Save owners and admins can list
`GET /api/savefiles/user/{user_id}/game/{game_id}/versions`, download a selected
`.../versions/{filename}`, and delete that same version with `DELETE`. Results
contain only filenames, sizes, creation times and optional installation IDs;
the server does not return private filesystem paths.

Decodable WebP, AVIF, TIFF and other image uploads are converted when their input
format is not allowed by `MEDIA_SUPPORTED_FORMATS`. Passive SVGs are always
rasterized; SVG scripts, external references and active elements are rejected.
Both input and converted output must meet the configured media size limit.
