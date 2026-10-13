# Branch consolidation — 2026-10-13

`main` and `dev` are synchronized. The four new upstream development commits
through `f07c825350b55f728d41d0ea52e9dce136e6ad4a` are merged into PlayStash.
Existing upstream stable history was already included.

The old branch heads below are retained in the Git commit graph before deleting
their branch references. Their older dependency/assets changes are superseded
by the current dependency set and new PlayStash logo; an `ours` merge records
that decision without restoring obsolete branding or dependency versions.

| Previous branch | Head | Current equivalent |
| --- | --- | --- |
| `early-access` | `1bb3222db8c74519662ec252204f34340d8abf1e` | Already an ancestor of the development baseline. |
| `imgbot` | `abbcf4d41deaefc3dbc6e2dca51e5891c72cab79` | Optimized old logo/demo images are replaced or removed. |
| `dependabot/npm_and_yarn/axios-1.16.1` | `c1b30852a545dda5c977cf78488c45d35f14cc2e` | Lockfile uses Axios 1.20.0. |
| `dependabot/npm_and_yarn/braces-3.0.3` | `b208b1a727e377abcb332d897d43ddaacfb62444` | Dependency no longer present. |
| `dependabot/npm_and_yarn/cross-spawn-7.0.6` | `5bc09f2edc8a4e94d136949a198eaa2be02759ad` | Dependency no longer present. |
| `dependabot/npm_and_yarn/dompurify-2.5.7` | `85a13ac02d3e7d07a4601a838f3373100559ca80` | Dependency no longer present. |
| `dependabot/npm_and_yarn/eslint/plugin-kit-0.2.3` | `6f92ec7b5310ad9f4e272c5bbff586254ad8043c` | Dependency no longer present. |
| `dependabot/npm_and_yarn/micromatch-4.0.8` | `13ea58e83aba930183aaae95bf948b1f436f2ddc` | Dependency no longer present. |
| `dependabot/npm_and_yarn/morgan-1.11.0` | `dfa910231a41a9c203980e1c022b0d02236cd5df` | Lockfile uses Morgan 1.12.0. |
| `dependabot/npm_and_yarn/rollup-2.79.2` | `1002e78da77d3c4f9abe0d96307262ed58f6aeb1` | Dependency no longer present. |
| `dependabot/npm_and_yarn/typeorm-0.3.31` | `76584c9ab6ca3e6ce0befc31399df12a06cfbb28` | TypeORM 1.1.1, checked against fresh schemas. |
| `dependabot/npm_and_yarn/ws-7.5.10` | `4d6f9354329cfe719de8f7caad257bb50746ec2d` | Remaining WebSocket dependency uses 8.21.3. |

The temporary upstream remotes are removed after consolidation. The original
commit history remains reachable through the merges; local and PlayStash GitHub
branch references contain only `main` and `dev`.
