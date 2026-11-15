# DelyForge Roadmap

Each phase ends with working, tested features — not UI mock-ups. A feature is "done" only when it works end to end
and has tests. Progress is tracked in [DEVELOPMENT_STATUS.md](DEVELOPMENT_STATUS.md).

## Phase 1 — Foundation ✅
- Monorepo (pnpm workspaces), TypeScript, docs
- `packages/shared`: plan catalogue, entitlement logic, IPC contract, secret redaction, Zod schemas
- Desktop: secure Electron shell (sandbox, CSP, typed preload bridge), local SQLite with migrations
- Design system (tokens, dark/light themes, core components) and sidebar navigation with feature gating
- Dashboard with real (empty-state) data from the local database; Settings (theme persisted)
- Cloud API: NestJS skeleton, validated config, health check, rate limiting, error handling, Prisma schema + migration, plans endpoint
- Tests for shared logic, desktop DB and API

## Phase 2 — Desktop interface ✅
- Bot projects CRUD (create, rename, duplicate, delete with confirm, favorite, group, search/filter)
- Import/export project configuration (JSON, schema-validated, tokens excluded)
- Activity feed for every bot change, dashboard "Your bots"

## Phase 3 — Discord integration ✅
- Notifications inbox (moved from Phase 2 — ships with the first real notification sources)
- Guided bot creation wizard with Developer Portal walkthrough
- Token validation (`GET /users/@me`), encrypted token storage
- Intents & permission calculator, OAuth2 invite link generator
- `packages/bot-runtime`, BotSupervisor (start/stop/restart/auto-restart/start-on-launch/start-all)
- Live console (stream, search, filter, download, clear, retention), monitoring (latency, CPU, memory, uptime)

## Phase 4 — Bot modules ✅
Moderation, Welcome, Tickets, Leveling, Logging, Utility, Verification, Reaction Roles, Suggestions, Giveaways — each with
config schema, config page, runtime implementation, required intents/permissions declaration and tests.

## Phase 5 — Builders ✅
Command Builder (slash/user/message commands, components, modals, live preview, publish), Embed Builder (Discord-accurate
preview, limit validation, reusable templates), Automation Studio (node editor + execution engine with limits, history,
test mode, versioning), Template Library (built-in templates, import/export/share).

## Phase 6 — AI ✅
AI gateway on the API, provider adapters, usage metering, AI Bot Builder (prompt → validated proposal → preview → approve),
AI command/embed/workflow generation, AI troubleshooting.

## Phase 7 — Commercial system ✅ (built before Phase 6)
Accounts (register, verify email, login, reset, sessions, profile), Stripe Checkout + Billing Portal + webhooks,
subscriptions (monthly/annual, upgrade/downgrade/cancel, grace periods), signed entitlement tokens, billing history.

## Phase 8 — Ecosystem
Marketplace (listings, search, reviews, purchases, developer onboarding, review queue, signing), plugin system (manifest,
permissions, sandbox, updates, dependency/compatibility checks), integrations, developer docs.

## Phase 9 — Advanced platform
Team workspaces & per-bot permissions, audit logs, advanced analytics & exports, remote monitoring (WebSocket),
cloud hosting foundation (`CloudBotHost`, isolated runtimes), web dashboard, internal admin dashboard.

## Phase 10 — Production
Security audit, performance work, E2E test suite, code signing, Windows NSIS installer, auto-updates with rollback,
user documentation, release.

## Ideas worth adding (beyond the original spec)
- **Dry-run / sandbox server mode** — test a bot against a private test guild with one click before going live.
- **Config diff & history** — every change to a bot is versioned; one-click rollback.
- **Permission doctor** — scans a guild and explains exactly why a command fails (missing permission, role hierarchy).
- **Health score** per bot (uptime, error rate, latency) on the dashboard.
- **Command palette** (Ctrl+K) for power users.
- **Status page** generator for a community's bot uptime.
