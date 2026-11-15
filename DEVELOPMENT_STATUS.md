# Development Status

_Last updated: 2026-11-15 — Phase 4 complete._

Legend: ✅ done & verified · 🟡 done, not yet verified end-to-end · ⏳ pending · ⛔ blocked on an external action

## Phase 1 — Foundation

| Item | Status | Verification |
|---|---|---|
| Monorepo (pnpm workspaces, TypeScript 6, shared base config) | ✅ | `pnpm build`, `pnpm typecheck` |
| Documentation set (README, ARCHITECTURE, ROADMAP, SECURITY, CHANGELOG, this file) | ✅ | — |
| `@delyforge/shared`: plan catalogue, entitlement rules (grace periods, overrides), IPC contract, redaction | ✅ | 17 unit tests |
| Desktop: secure Electron shell (sandbox, context isolation, CSP, `app://` protocol, navigation & permission lockdown) | ✅ | smoke test |
| Desktop: typed preload bridge + Zod-validated IPC with trusted-sender check | ✅ | smoke test sends valid + invalid payloads |
| Desktop: local SQLite (`node:sqlite`) with transactional migrations | ✅ | 9 unit tests |
| Desktop: redacting rotating file logger | ✅ | used at runtime; redaction unit-tested in shared |
| Design system: tokens (dark + light), Geist fonts, Button, Card, Badge, StatusDot, Switch, Tooltip, Segmented, Skeleton, EmptyState, IconTile | ✅ | visual review of smoke screenshots |
| Sidebar navigation with feature gating + Roadmap preview mode | ✅ | smoke test + manual |
| Dashboard (real data: project counts, online/offline, activity, plan; onboarding checklist) | ✅ | smoke test |
| Settings (theme dark/light/system, reduce motion, roadmap preview, About) — persisted | ✅ | smoke test verifies persistence across reload |
| Subscription page (plan comparison, monthly/annual) | ✅ | smoke test. Upgrade buttons intentionally disabled until Phase 7 |
| API: NestJS app, Zod-validated config, request IDs, Helmet, CORS allow-list, rate limiting, error envelope | ✅ | 7 HTTP tests |
| API: `GET /health` (with DB check), `GET /v1/plans` | ✅ | HTTP tests with fake DB |
| Prisma schema (29 tables: identity, workspaces, billing, AI, marketplace, ops) + initial migration + seed | ✅ | migration applied, 4 plans seeded, `migrate dev` reports in sync |
| Local dev database without Docker (`pnpm db:up` → Prisma's built-in Postgres; Docker optional) | ✅ | data survives stop/start |
| DB integration tests | ✅ | 2 tests against real Postgres (`DELYFORGE_DB_TESTS=1`) |

## Phase 2 — Desktop interface: bot projects

| Item | Status | Verification |
|---|---|---|
| Shared bot schemas (create/update/export, strict, length limits matching Discord) | ✅ | 9 unit tests |
| Bot project repository: create, edit, favorite, group, duplicate (unique names, never copies token/app), delete (token cascades) | ✅ | 14 unit tests |
| Plan limits enforced in the main process for create / duplicate / import; over-limit projects kept after downgrade | ✅ | unit tests + smoke test (2nd bot refused on Free) |
| Export to `.delyforge.json` (no token ever) and import with strict validation, 1 MB cap, clear error messages | ✅ | unit tests incl. tampered/oversized files. Native file dialogs checked by type/build only — try it manually once |
| Entitlements now come from the main process (`account:get-entitlements`); dev-only `DELYFORGE_DEV_PLAN` override | ✅ | unit tests (ignored in packaged builds) |
| My Bots page: cards, search, All/Favorites, sort, group chips, actions menu, limit banner, empty & no-results states | ✅ | smoke screenshots |
| Create Bot page (step 1 of the future wizard) with inline validation | ✅ | smoke test fills and submits the real form |
| Bot detail page: header, favorite, actions, General settings form (dirty tracking, save/discard), project info | ✅ | smoke test renames via the form |
| Delete confirmation dialog, toasts for every action | ✅ | manual review |
| Dashboard: "Create bot" onboarding action, "Your bots" section, activity for every bot change | ✅ | smoke screenshots |

### Moved out of Phase 2
- **Notifications inbox → Phase 3.** Every notification type (bot crashed/disconnected, workflow failed, billing,
  updates) is produced by systems that don't exist yet. An inbox with nothing able to fill it would be a non-working
  page, so it ships together with the bot supervisor that produces the first real notifications.

## Phase 3 — Discord integration

| Item | Status | Verification |
|---|---|---|
| Shared Discord definitions: intents (privileged detection), permissions + presets, invite builder, presence, token checks | ✅ | 10 unit tests |
| Token checker that recognises Application ID / Public Key / Client Secret pasted by mistake | ✅ | unit tests + smoke test (wizard shows the right message) |
| Token verification with Discord (`/users/@me`, `/applications/@me`), duplicate-bot check, encrypted storage (`safeStorage` / DPAPI) | ✅ | 7 tests against a local fake Discord API; token never stored in plain text |
| `@delyforge/bot-runtime`: one process per bot (discord.js), validated protocol, heartbeats (ping/CPU/memory), `/ping`, presence | ✅ | 8 tests incl. a real forked process |
| Bot supervisor: start / stop (graceful → force) / restart / start all / stop all / start on launch / clean shutdown on quit | ✅ | 16 tests with a fake process |
| Crash handling: auto-restart with backoff, crash-loop pause, no restart after login failure, hang watchdog, plan limit on running bots | ✅ | unit tests |
| Real bot process inside Electron (utility process → discord.js → Discord) | ✅ | smoke test launches it with a fake token; Discord rejects it and the app reports INVALID_TOKEN |
| Connect wizard (application → token → invite & permissions → presence & go live) | ✅ | **Verified with a real Discord bot (2026-11-14)**: connected, invited, started, `/ping` answered ("Gateway latency: 60 ms") |
| Bot page tabs: Overview (live metrics, sparklines, error guidance, invite link), Console (live, search, filter, auto-scroll, download, clear), Settings | ✅ | smoke test + real bot run |
| Bot Monitoring page (all bots, live metrics, start/stop all) | ✅ | smoke screenshot |
| Notifications: inbox, unread badge, mark read, clear, per-type preferences, Windows notifications | ✅ | unit tests + smoke test (real login failure produced a notification) |
| Logs: redacted, 5,000 lines per bot, pruned by plan retention (3/14/30/90 days) | ✅ | unit tests |
| Dashboard: live online count, total servers, total commands, start/stop all, real onboarding steps | ✅ | smoke screenshot |

### Real-world check (2026-11-14)
The owner connected a real Discord bot through the wizard, started it and received a `/ping` reply in Discord.
Not yet confirmed by hand: Stop → bot goes offline in Discord, and the connection surviving a DelyForge restart
(both are covered by automated tests).

## Phase 4 — Bot modules (batch 1 of 2)

| Item | Status | Verification |
|---|---|---|
| Module system: per-server settings, Zod schemas, plan tiers, intents/permissions per module, entitlement filtering after downgrade | ✅ | 11 shared tests |
| Live settings: saved changes reach a running bot without restart; UI says when new intents need a restart | ✅ | supervisor tests |
| Main: server/channel/role lookup from Discord (works while the bot is offline), privileged-intent recheck | 🟡 | code + types; needs a real bot in a server |
| Plan checks on save (Logging + auto-moderation = Pro), invalid settings rejected with field path | ✅ | 6 service tests |
| Runtime module host: per-server dispatch, isolated handlers, slash command sync that only touches DelyForge's own commands | ✅ / 🟡 | planner + store tests; real sync needs Discord |
| Welcome: message (text or card), DM, goodbye, auto-roles (skips roles above the bot) | 🟡 | needs real verification |
| Moderation: /warn /warnings /clearwarnings /timeout /untimeout /kick /ban /unban /purge, hierarchy checks, DM reasons, mod log, warning thresholds | 🟡 | threshold + store logic tested; commands need Discord |
| Auto-moderation: invites, links (allow-list), blocked words (evasion-aware), spam; delete / warn / timeout; staff + exempt roles skipped | ✅ / 🟡 | 5 detection tests; actions need Discord |
| Logging: deletes, edits, joins, leaves, role changes, channels, bans (with who), voice; ignored channels | 🟡 | needs real verification |
| Utility: /serverinfo /userinfo /avatar /poll (native Discord polls) | ✅ / 🟡 | poll parsing tested; commands need Discord |
| UI: Modules tab with server picker, settings page per module (channel/role pickers, template variables + preview, warnings for missing intents/permissions with fix links), sidebar module pages | ✅ | typecheck + smoke screenshots (configured state needs a real server) |

### Batch 2

| Item | Status | Verification |
|---|---|---|
| Review fixes: link filter uses the real hostname; /clearwarnings and /untimeout check rank; /ban works on members who left; command sync re-runs after mid-sync changes; spam tracker forgets idle members; roadmap pages no longer blank | ✅ | 9 new tests |
| Module list defined once (types, schemas, defaults, IPC enum derived from it) | ✅ | typecheck |
| Panels: bot posts ticket / verify / role panels and edits or moves them when settings change | ✅ / 🟡 | panel builder tests; posting needs Discord |
| Leveling: XP with cooldown, no-XP channels/roles, level-up message, role rewards (stacking or highest only), /rank, /leaderboard | ✅ / 🟡 | maths, cooldown, reward tests |
| Tickets: panel → private channel with staff access, open limit, close with confirmation, transcript file to channel + DM, /ticket add, /ticket close | ✅ / 🟡 | name, transcript and close-once tests |
| Verification: verify button, role add/remove, minimum account age | 🟡 | needs Discord |
| Reaction roles: up to 10 panels, buttons or menu, roles re-checked against current settings on every click | 🟡 | panel tests; clicks need Discord |
| Suggestions: /suggest, 👍/👎 votes (change or take back), staff approve/reject | ✅ / 🟡 | vote tests |
| Giveaways: /giveaway start/end/reroll, enter/leave button, fair crypto-random winners, survives restarts | ✅ / 🟡 | duration, winner, end-once tests |
| Settings forms for all six modules | ✅ | typecheck + smoke |

**Not built (honest):** welcome images, moderation appeals, ticket ratings, suggestion reasons, giveaway role requirements, warnings/XP management screens in the app.

## Known limitations / honest notes
- No accounts yet — the desktop app runs on the local Free plan (accounts & Stripe are Phase 7).
- Bots run only while DelyForge is open on this computer (24/7 cloud hosting is Phase 9).
- Turning off `/ping` stops answering it, but Discord keeps listing it until the Phase 5 command builder manages commands.
- Packaging note for Phase 10: the bot runtime loads from `node_modules`; the installer must unpack it from the asar archive.
- Windows installer and auto-update are not configured yet (Phase 10).
- The renderer bundle (~1.5 MB) is not yet code-split; fine for a desktop app, to be optimized in Phase 10.
- Project lives inside a OneDrive-synced folder. OneDrive can lock files inside `node_modules` during installs;
  moving the project to e.g. `C:\dev\DelyForge` is recommended.

## Testing with a paid plan during development
The Free plan allows 1 bot. To test with more, start the app with a simulated plan (development builds only —
customer builds ignore it). In Git Bash: `DELYFORGE_DEV_PLAN=pro pnpm dev:desktop`. In PowerShell:
`$env:DELYFORGE_DEV_PLAN='pro'; pnpm dev:desktop`.

## Next up — Phase 5 (builders)
Command Builder, Embed Builder, Automation Studio, Template Library.
