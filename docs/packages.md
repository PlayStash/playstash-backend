# Game folders, extras, and optional addons

PlayStash accepts existing game archives. It also indexes an unarchived game folder containing a `setup.exe`, `install.exe`, `setup.sh`, or an explicit `playstash-package.json` manifest as one game. Sibling data files remain together. A portable folder can use a manifest to identify its title, version, and platform.

```text
/files/My Game (v1.2)/
  playstash-package.json
  setup.exe
  data1.bin
  data2.bin
  Extras/
    Manual.pdf
    Soundtrack.zip
  Addons/
    Patch 1.3.zip
    Community Mod.7z
```

`Extras` and `Addons` are reserved sidecar directories, with case-insensitive names. They do not appear as separate games and are excluded from the main game's generated download archive. Extras can contain any regular file. Automatically discovered addons must be supported archives. Categories containing games below another directory require `GAMES_SEARCH_RECURSIVE=true`.

## Optional manifest

```json
{
  "schema_version": 1,
  "title": "My Game",
  "version": "v1.2",
  "type": "WINDOWS_SETUP",
  "install": {
    "executable": "setup.exe",
    "parameters": "/S"
  },
  "launch_profiles": [
    { "name": "Single player", "executable": "bin/game.exe" },
    { "name": "Dedicated server", "executable": "bin/server.exe", "parameters": "--dedicated" }
  ],
  "extras": [
    { "path": "Extras/Manual.pdf", "title": "Manual", "kind": "manual" },
    { "path": "Extras/Soundtrack.zip", "title": "Soundtrack", "kind": "soundtrack" }
  ],
  "addons": [
    { "path": "Addons/Patch 1.3.zip", "title": "Patch 1.3", "kind": "patch" },
    { "path": "Addons/Community Mod.7z", "title": "Community Mod", "kind": "mod" }
  ]
}
```

The manifest is optional and limited to 1 MiB. Supported game types are `WINDOWS_SETUP`, `WINDOWS_PORTABLE`, `WINDOWS_SOFTWARE`, `LINUX_PORTABLE`, `LINUX_SOFTWARE`, and `UNDETECTABLE`. Addon kinds are `mod`, `dlc`, and `patch`; extra kinds are `extra`, `manual`, and `soundtrack`. An omitted list discovers files in its corresponding sidecar directory. An explicit empty list hides that category.

For an archived game with sidecars, add `"source": "My Game (v1.2).zip"` to keep the folder's existing archive as the main payload. Launch and installation recipes contain an executable path and arguments. All executable and asset paths must stay inside the game folder. The server never executes recipes or scripts; the client asks the user before applying installation recipes or addons. Addons are applied in the chosen order to an existing installation and may overwrite its files.

Unarchived folders cannot contain symbolic links. Archive such games explicitly. PlayStash validates folder contents before and after generating an archive, uses a fingerprint including file paths, sizes and modification times, and publishes the archive only after it is complete. Concurrent requests share the archive build; a changed payload receives a fresh archive. A game changing during archive generation returns a retry message instead of an inconsistent payload. Folder game deletion removes that version's whole folder, including sidecars, so review the folder before using the administrator's delete action.

## API

`GET /api/game/{game_id}/package` returns the validated manifest and the extra/addon lists with opaque asset IDs, relative paths, names, kinds, and sizes. `GET /api/game/{game_id}/package/assets/{asset_id}` downloads a listed asset. Both endpoints enforce the game's age and user access restrictions. Downloads support byte ranges and the server's download bandwidth limits. Clients cannot request arbitrary paths or follow links outside the game folder.

Main game downloads accept one `Range: bytes=start-end`, open-ended range, or
suffix range such as `bytes=-1024`. Successful range responses use HTTP 206 and
`Content-Range`; invalid, multiple or unavailable ranges return HTTP 416 with
`Content-Range: bytes */<size>`. Omit `Range` for a complete HTTP 200 download.
