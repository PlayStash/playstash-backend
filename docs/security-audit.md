# Backend security review — 2026-10-14

The review includes direct, transitive, development and optional dependencies, plus authentication, library permissions, uploads, filesystem paths, image decoding, frontend bundles, chat, requests/reviews and outbound notifications. This records verified findings and safeguards, not a claim that every possible vulnerability has been excluded.

## Authentication and runtime fixes

- Persisted deactivation blocks every role, including administrators, across Basic/JWT/refresh/SSO, API keys and issued download tokens. Account deactivation/deletion immediately disconnects existing chat/activity sockets, and broadcasts recheck recipient activation. Fresh SQLite/PostgreSQL checks exercise real HTTP/Socket.IO routes against persisted account changes; configured bootstrap administrators remain activated on startup.
- JWT access and refresh tokens identify users only by immutable database ID. Username and email comparisons use bound exact case-insensitive equality, so underscores and percent signs cannot select another account. Real SQLite/PostgreSQL schema checks exercise these lookups and provider-specific identity uniqueness.
- SSO identity comes exclusively from the configured authenticated UserInfo endpoint, with a timeout, response size limit and redirects disabled. Unsigned token decoding supplies no identity. Provider/subject is stored atomically on registration; names and emails never automatically link a local account. SSO fallback tokens use URL fragments, never request query strings.
- Signing keys are independently random or derived solely from an explicit minimum-32-byte AUTH_SEED, never a database, administrator or provider password. OAuth session cookies are HttpOnly/SameSite=Lax, expire after 15 minutes and follow the request's transport security; arbitrary credentialed CORS origins are disabled.
- OAuth/provider response bodies, password hashes and signed media URLs are not logged. HTTP request logs omit query strings. The production Winston sink redacts nested credentials and symbol-backed interpolation metadata before file serialization or console inspection, including ordinary login and session records.
- Production containers use an updated Alpine base, retain only runtime tools, drop privileges with su-exec, and do not make code/storage world-writable. Application code remains readable by explicitly selected non-root users; data volumes are private to their owner and new data uses umask 0077. Official static 7-Zip 26.04 binaries for AMD64 and ARM64 are downloaded from the maintainer release and checked against pinned SHA-256 hashes; its license is included.

## Dependency patches (13 October review checkpoint)

Run the repository's declared package manager (`corepack pnpm`, currently pnpm 11.7.0), because its workspace overrides are part of the resolved security policy. The initial full audit reported 21 advisories: 1 critical, 11 high, 8 moderate and 1 low. After the updates below and addition of the ZIP parser, the full audit covered 609 resolved dependencies and reported zero advisories at every severity.

| Package         | Previous version | Patched version | Maintainer evidence                                                                                               |
| --------------- | ---------------- | --------------- | ----------------------------------------------------------------------------------------------------------------- |
| multer          | 2.2.0            | 2.4.0           | [Multipart upload advisory](https://github.com/expressjs/multer/security/advisories/GHSA-3pph-fpjx-jg34)          |
| morgan          | 1.12.0           | 1.12.1          | [Request logging advisory](https://github.com/expressjs/morgan/security/advisories/GHSA-9f6g-j8ch-79g4)           |
| fast-uri        | 3.1.7 / 4.1.4    | 3.1.8 / 4.1.5   | [URI handling advisory](https://github.com/fastify/fast-uri/security/advisories/GHSA-hrr3-gc8f-f4qj)              |
| moment          | 2.30.1           | 2.31.0          | [Locale loading advisory](https://github.com/moment/moment/security/advisories/GHSA-4p3w-j4w9-5jqw)               |
| brace-expansion | 5.0.9            | 5.0.12          | [Expansion advisory](https://github.com/juliangruber/brace-expansion/security/advisories/GHSA-q2hr-2g5m-vwhr)     |
| fastify         | 5.12.1           | 5.12.5          | [HTTP parsing advisory](https://github.com/fastify/fastify/security/advisories/GHSA-4mh8-r7rc-xpvc)               |
| source-map-js   | 1.2.1            | 1.2.2           | [Maintainer release notes](https://github.com/7rulnik/source-map-js/releases/tag/v1.2.2)                          |
| proxy-addr      | 2.0.7            | 2.0.8           | [Proxy address advisory](https://github.com/jshttp/proxy-addr/security/advisories/GHSA-jqcg-44mw-7w3h)            |
| compression     | 1.8.1            | 1.8.2           | [Response compression advisory](https://github.com/expressjs/compression/security/advisories/GHSA-vc2v-76pw-4v95) |

Direct dependencies use compatible patch ranges. Narrow, major-preserving overrides in `pnpm-workspace.yaml` patch vulnerable transitive ranges, and the committed lockfile records the selected versions. `yauzl` 3.4.0 provides strict central-directory ZIP parsing and size validation; extraction applies additional path, entry type and byte limits.

## Application changes

- Remote artwork downloads accept only HTTP(S) without URL credentials. Every DNS answer and redirect must resolve to public addresses. Connections use those validated addresses, preventing a second DNS lookup from bypassing the check. A 30-second total deadline covers DNS, redirects and response streaming. The body is limited by `MEDIA_MAX_SIZE`, or 64 MiB when that limit is disabled.
- SVG/XML external resources and active constructs are rejected before native decoding. SVG input is UTF-8; passive SVG is rasterized rather than served as executable XML. Conversion retains its pixel and processing-time limits.
- In 17.1.4, frontend assets were a pinned backend release-build input, not a backend runtime download. From 17.1.5 the frontend repository owns that image build and its license notices; no frontend assets or runtime definitions are copied into the backend repository or its image.
- The retained safe-ZIP utility checks actual entry sizes, limits expanded data and rejects absolute/parent paths, unsafe names, links, encrypted/nonordinary entries and duplicates. It is not wired into the API runtime or release pipeline; the API-only backend has no frontend cache to replace.
- Uploaded streams close both input and output on errors or aborts and remove partial temporary files. Temporary output uses exclusive creation. Game, media and save paths are resolved inside their configured volume and reject nested symlinks/junctions before reads, writes or deletion.
- Existing game ACL, save owner/admin checks, feedback visibility and authenticated chat checks remain in effect. Regression coverage includes denied private-game access and real ORM checks for SQLite/PostgreSQL.

## Boundaries

Container startup restricts existing data directories and files to the configured
service UID/GID, and sets umask `0077` for new database, API-key, configuration and
save data. This replaces inherited world-readable database permissions on Linux
bind mounts. The Docker build context excludes local data, environment files and
audit output so these cannot enter exported build caches.

Configured filesystem volumes, OAuth providers and notification endpoints are operator-controlled trust inputs. Volume roots may be mount points or explicitly configured links, but nested storage links are rejected. These path checks do not isolate the process from a privileged local attacker concurrently replacing filesystem components; restrict write access to trusted operators and the server account.

An administrator may intentionally configure a webhook on the private network. That endpoint is not subject to the public-artwork restriction: notifications already reject redirects, use a short timeout and a bounded queue, and exclude restricted games. Artwork hosted only on a private network must instead be uploaded through the authenticated media endpoint.

Keep upload limits enabled in exposed installations. A clean dependency audit is a snapshot, not a future guarantee. Host/container OS packages are reviewed separately from this Node dependency audit. Hosted CI runs normally; any future self-hosted runner job must explicitly require `PLAYSTASH_RUN_SELF_HOSTED == 'true'`, disabled by default.

## Separate frontend/API/PostgreSQL deployment (17.1.4)

The production Compose starts separate frontend, API and PostgreSQL 16 containers
and a one-shot credential initializer. Only the frontend publishes port 8080;
API and database ports stay on the private network. The API image contains no
product frontend or ZIP, and the frontend has no backend runtime or private data
mounts. Nginx runs as UID/GID 101 with a read-only filesystem, dropped capabilities,
no-new-privileges and a bounded writable tmpfs.

The initializer generates 32 random bytes once for the private PostgreSQL
password file. Existing ordinary single-link keys are validated and reused.
AUTH_SEED_PERSIST=true independently generates and reuses /config/auth-seed;
explicit operator keys retain precedence. Concurrent first registrations can
create only one bootstrap administrator.

The frontend proxies API, authenticated WebSockets, uploads and range downloads.
Only explicitly configured PLAYSTASH_TRUSTED_PROXY_CIDRS peers may supply client
address and protocol headers. PostgreSQL readiness is checked over TCP before
API startup. Backend/ frontend replacement and full down/up retain stored data,
accounts, password and authentication key.

PostgreSQL 16 backup/restore uses matching version 16 tools. Failed restore returns
an error and rolls back the original database. Failed rollback preserves its
private recovery snapshot in the persistent database-backup directory.

The database image refreshes Alpine packages and replaces the outdated Go
privilege-switch helper with su-exec while preserving the PostgreSQL entrypoint.
Hosted release jobs scan all three actual images for AMD64 and ARM64 at every
severity, exercise the complete Compose stack and backup/restore/rollback, and
verify anonymous pulls before publishing. Weekly/manual jobs scan all three
published image families. Source privacy is independent of image visibility.

The exact 17.1.4 main/dev publication runs on 14 October 2026 produced twelve
image reports with zero known findings (three images, two architectures, two
branches). This is a dated verification, not a permanent security guarantee.

## Independently published frontend (17.1.5)

The frontend is published by its own private source repository to the public
`ghcr.io/playstash/playstash-frontend` package. Backend builds produce only API
and PostgreSQL images. Deployment CI resolves the frontend's public `latest`
or `dev` channel without registry/GitHub credentials, verifies its index bytes
against the immutable digest and requires both Linux architectures. The same
digest is scanned and used by both deployment jobs, preventing a channel update
from changing the frontend between their checks. Anonymous image pulls, all
severity scans, private storage, complete Compose roundtrips and actual
PostgreSQL backup/restore/rollback remain required. No cross-repository token is
needed, and weekly/manual scans follow the frontend's own public stable image.
