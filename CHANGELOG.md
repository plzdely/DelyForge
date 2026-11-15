# Changelog

All notable changes to DelyForge are documented here. Format based on [Keep a Changelog](https://keepachangelog.com/);
versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Phase 6: AI Bot Builder (describe a bot → reviewed proposal → apply) and AI troubleshooting in the console, running on
  the DelyForge API with monthly AI credits per plan.
- Phase 7: DelyForge accounts (sign-up, sign-in, email verification, password reset, sessions), Stripe subscriptions
  (checkout, portal, invoices, webhooks), server-signed plan certificates with 7-day offline grace in the desktop app.
- Phase 5: Command Builder (slash + right-click commands), Embed Builder with live preview, Automation Studio
  (triggers, steps, conditions, waits, run history), 10 bot templates.
- Phase 4 (batch 2): Leveling, Tickets, Verification, Reaction Roles, Suggestions and Giveaways modules; self-updating
  panel messages; security fixes to the link filter and moderation rank checks.
- Phase 4 (batch 1): module system with per-server settings — Welcome (messages, cards, DMs, goodbye, auto-roles),
  Moderation (9 staff commands, warning thresholds, auto-moderation for invites/links/words/spam), Logging (8 event
  types), Utility (/serverinfo, /userinfo, /avatar, /poll). Settings apply live; channel and role pickers load from
  Discord; warnings for missing intents and permissions. Slash commands are synced per server and DelyForge only ever
  removes commands it created.
- Phase 3: connect bots to Discord — guided 4-step wizard, token verification with Discord, encrypted token storage,
  permission presets and invite links, presence editor. Bot runtime (`@delyforge/bot-runtime`, one process per bot,
  built-in `/ping`). Supervisor with start/stop/restart, start all/stop all, start on launch, automatic restart with
  backoff, crash-loop protection and hang watchdog. Live console (search, filter, download, clear), live metrics
  (latency, CPU, memory, uptime, servers, commands), Bot Monitoring page, Notifications inbox with preferences and
  Windows notifications.
- Phase 2: bot projects — My Bots page (search, favorites, sort, groups), Create Bot page, bot detail page with editable
  settings, duplicate, delete with confirmation, export/import (`.delyforge.json`, tokens never included), plan limits
  enforced by the main process, dashboard "Your bots" section.
- Development-only plan simulation via `DELYFORGE_DEV_PLAN`.
- Phase 1 foundation: pnpm monorepo, architecture/security/roadmap documentation.
- `@delyforge/shared`: plan catalogue (Free/Pro/Business/Enterprise), entitlement resolution, typed IPC contract, secret redaction.
- `@delyforge/desktop`: secure Electron shell, local SQLite database with migrations, design system, sidebar navigation with feature gating, Dashboard, Settings (theme), Subscription plans view.
- `@delyforge/api`: NestJS API with validated configuration, health check, rate limiting, global error handling, Prisma schema and plans endpoint.
- Local development database without Docker (`pnpm db:up` uses Prisma's bundled Postgres; Docker remains optional).

### Fixed
- Stripe webhooks: the plan now comes from the price paid, failed events are retried instead of skipped, and older
  events arriving late no longer overwrite newer ones.
- Database tests no longer fail randomly when run together on the local development database.
