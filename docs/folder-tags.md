# Automatic tags from library folders

Administrators can store folder-based tag rules on the server. These tags become
part of each game's effective metadata and are visible to every permitted user,
so clients can organize and filter the same library consistently.

`GET /api/config/folder-tag-rules` reads the rules.
`PUT /api/config/folder-tag-rules` replaces them and refreshes existing games:

```json
{
  "rules": [
    { "folder_prefix": "Classics/Arcade", "tags": ["Arcade", "Classic"], "enabled": true },
    { "folder_prefix": "Role Playing", "tags": ["RPG"] }
  ]
}
```

Prefixes are relative to the configured game-library root. They match the folder
itself and its descendants, with case-insensitive names and proper folder
boundaries: `Arcade` also matches `Arcade/Coop`, but never `Arcade2`. Both Windows
and Unix separators are accepted. Absolute paths, traversal and empty folder
segments are rejected. Any stored version can match a rule, including unpacked
game folders. Rules can contain up to 100 entries and 20 tags per entry.

The update returns `applied_games` and `failed_games`. New or changed games get
the rules when indexed; reindexing retries any failed metadata refresh. Manual
and provider tags remain. Removing or disabling a rule removes the tags it alone
added on the next refresh; another provider, manual tag or remaining rule can
still contribute the same tag.

Rules are persisted as `folder-tag-rules.json` in the server's config volume.
Back up that volume alongside the database. Use the API/client editor to change
rules while the server is running; manual file edits are read after a restart.
