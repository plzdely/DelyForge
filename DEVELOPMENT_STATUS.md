# Development Status

_Last updated: 2026-11-14 — end of Phase 2._

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

## Known limitations / honest notes
- No accounts yet — the desktop app runs on the local Free plan (accounts & Stripe are Phase 7).
- The bot supervisor does not exist yet, so "Online" is always 0 (Phase 3).
- Windows installer and auto-update are not configured yet (Phase 10).
- The renderer bundle (~1.5 MB) is not yet code-split; fine for a desktop app, to be optimized in Phase 10.
- Project lives inside a OneDrive-synced folder. OneDrive can lock files inside `node_modules` during installs;
  moving the project to e.g. `C:\dev\DelyForge` is recommended.

## Testing with a paid plan during development
The Free plan allows 1 bot. To test with more, start the app with a simulated plan (development builds only —
customer builds ignore it). In Git Bash: `DELYFORGE_DEV_PLAN=pro pnpm dev:desktop`. In PowerShell:
`$env:DELYFORGE_DEV_PLAN='pro'; pnpm dev:desktop`.

## Next up — Phase 3 (Discord integration)
Guided connection wizard with Developer Portal walkthrough, token validation + encrypted storage, intents & permission
calculator, invite link generator, bot runtime + supervisor (start/stop/restart/auto-restart), live console, monitoring,
notifications inbox.
