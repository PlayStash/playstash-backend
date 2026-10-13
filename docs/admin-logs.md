# Recent server logs

Administrators can use `GET /api/admin/logs` to read the newest PlayStash backend
file log in `VOLUMES_LOGS`. It returns at most 200 records from a read of at most
64 KiB. Records contain only `level`, optional `context` and `timestamp`, and
plain-text `message`; nested configuration, game, user and error/stack objects
are omitted. Configured secrets, Bearer/Basic credentials, token assignments and
URL passwords are redacted. Clients must display the fields as text.

Only server-owned rotating names `playstash-backend-YYYY-MM-DD.log` and their
numeric rotation suffixes are accepted. Linked directories/files and files
outside the configured log volume are rejected. The endpoint accepts no file
path or filename parameters. When `SERVER_LOG_FILES_ENABLED` is false or no log
file exists, the response is `[]`. Partial, non-JSON and oversized leading
records are skipped; this is a diagnostic tail, not a full log export.
