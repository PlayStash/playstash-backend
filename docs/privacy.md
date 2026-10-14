# Privacy, analytics and external services

## Help improve PlayStash

Frontend 17.2.3 stores this preference locally as app_analytics_consent.
It does not configure a destination.

Analytics starts only if the frontend was built with both
VITE_PLAYSTASH_ANALYTICS_PROJECT_ID and VITE_PLAYSTASH_ANALYTICS_API_URL and the
local preference permits it. It calls Swetrix trackViews and trackErrors at the
operator-selected URL. The supplied release workflow sets neither value, so the
published frontend does not send these analytics.

These are frontend build-time values. Runtime backend/Nginx environment settings
do not change an already built frontend. In an analytics-enabled custom build,
page views and client errors go to that configured endpoint. The preference
defaults to enabled when unset; changes take effect after reloading. It does
not control the following server functions and external connections.

## Your own server

Authenticated game progress/playtime go to your connected backend. Completed
download/install/uninstall/play events can also be collected there. Event rows
identify account and game; they are not anonymous external analytics.
METRICS_ENABLED defaults to true, METRICS_RETENTION_DAYS to 365; 0 retains events
indefinitely. Users can set report_game_metrics=false to stop future collection.
Existing history expires according to retention. Progress tracking is separate.

Restricted sharing defaults to disabled. share_restricted_activity determines
whether eligible viewers see restricted progress/activity and administrators
inspect that user's restricted metrics.

Chat belongs to your server. History stays in process memory for at most 24 hours
and disappears on restart. Direct messages are for their two participants; game
rooms require game access.

## External connections

| Service | When | Connection |
| --- | --- | --- |
| Steam Store and image hosts | Steam enabled | Backend searches titles/IDs and downloads metadata/artwork |
| Twitch/IGDB and image hosts | IGDB enabled with credentials | Backend obtains tokens and fetches metadata/artwork |
| rsms.me | Existing Inter stylesheet/fonts loaded | Browser loads remote font resources |
| YouTube | Embedded trailer opened/loaded | Browser/webview loads the remote player |
| GitHub/GHCR | Software install/update | Docker pulls images; desktop attempts its configured release feed |
| Your identity provider | SSO configured and used | Authentication with that provider |
| Your webhook | Notifications enabled | Backend sends configured library notifications |

Providers see the server's connection and search terms/selected IDs. Browser
services see the browser's connection. Find Images opens an external search;
it does not install an automatic provider. The documentation website has no
analytics or upstream demo widgets.

## Logs

Backend and proxy logs can contain client addresses, paths, status codes and
account context. Backend credential redaction and omitted query strings reduce
exposure; logs are not anonymous. Restrict access to logs, backups and secrets.
The admin log API returns only a bounded, redacted text tail.

See [configuration](../src/configuration.ts) and
[administrator logs](admin-logs.md).
