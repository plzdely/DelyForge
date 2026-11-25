# Changelog

All notable changes to DelyForge are documented here. Format based on [Keep a Changelog](https://keepachangelog.com/);
versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.4.0] - 2026-11-25

Every module got deeper. No new modules — new options and commands inside the ones you have.

### Added
- **Welcome:** banner image on the card, up to 3 link buttons, goodbye as a card, auto-roles after a delay, separate
  roles for bots, and a quick ping in chosen channels (e.g. #rules) so new members notice them.
- **Verification:** a log channel (who, account age, result), an optional sum question, removing members who never
  verify (only members with no roles — staff are never kicked), and a DM after verifying.
- **Reaction roles:** "one role only" button panels (e.g. colours) and a required role per panel.
- **Moderation:** warnings that expire, appeal text in ban DMs, `/softban`, `/role give|take`, `/nick`, `/purge` by bots
  or by text, and AutoMod exempt channels.
- **Logging:** ignored roles. **Raid protection:** optional server lockdown during a raid and a "raid over" alert.
- **Leveling:** XP boosts per role, voice XP, level-up DMs, `/xp give|take|set`, and resetting XP when someone leaves.
- **Invites:** reward roles (taken back if invited members leave). **Giveaways:** bonus entries per role, and the entry
  count on the message updates live. **Starboard:** `/stars` leaderboard.
- **Tickets:** "what do you need help with?" pop-up, Claim button, `/ticket remove` and `/ticket rename`, and closing
  idle tickets automatically (with a transcript).
- **Suggestions:** discussion threads, anonymous mode and a DM to the author when decided.
- **Temporary voice:** `/voice lock|unlock|limit|rename|claim` for channel owners, and one channel per member.
- **Utility:** `/remind` and `/roll`. **Sticky messages:** card style and quiet time. **Birthdays:** a DM.
  **Social alerts:** keyword filter and "skip Shorts". **Scheduled messages:** card style and "delete the previous post".
- The app asks before leaving a screen with unsaved changes.

### Fixed
- A double click could open two tickets; a reroll no longer drops earlier winners from the giveaway message.
- Failed role changes in verification, and failed suggestion posts, now give a clear answer instead of an error.
- During a raid, the accounts that set it off are removed too (when the raid action is kick or ban).
- If one saved custom command, embed or workflow stops passing the rules, only that item is dropped — not all of them.

## [0.3.0] - 2026-11-25

### Added
- **Setup Doctor** (Modules tab): the running bot checks the chosen server for every module that's on — deleted or
  unset channels, channels it can't post in, roles it can't give, missing permissions — and says how to fix each one,
  with a re-invite link for missing permissions.
- **Send a test** buttons for welcome, goodbye, level-up, birthday, scheduled and feed messages (posts once with you as
  the example member; never pings roles). Every message box now shows a Discord-style preview.
- **Problem alerts:** a notification when a bot loses a permission one of its modules needs, and the bot DMs its owner
  after a crash, a crash loop or a lost permission (at most once per 15 minutes; Settings → Notifications).
- **Moderation 2.0:** numbered cases with `/history`, `/case` and `/note`; temporary bans (`/ban duration:`);
  `/lock`, `/unlock` and `/slowmode`; five new AutoMod filters (caps, mass mentions, emoji spam, scam links, repeats).
- Two new modules: **Social Alerts** (new YouTube videos and RSS/news posts) and **Scheduled Messages** (chosen days
  and time, in your time zone).
- **Automations:** new triggers (schedule, reaction, boost, voice join), new steps (start a thread, time out, random
  message, saved variables), and **If / Otherwise / End if** blocks with text and number checks.

### Fixed
- `{option:NAME}` in custom commands was never filled in; it is now (as is the new `{var:NAME}`).
- One-per-line boxes (AutoMod words, allowed websites) swallowed the Enter key.
- A permanent ban no longer gets lifted by an earlier temporary ban; `/lock` checks the moderator's rights in that
  channel and `/unlock` restores the channel's previous permissions.
- Social Alerts download at most 1 MB and read feeds without slow pattern matching, so a hostile feed can't stall a bot.

## [0.2.1] - 2026-11-25

### Added
- Logging now records **who did what**, live from Discord's audit log: channels and permission changes, roles,
  nicknames, timeouts, kicks, bans, voice moves, server settings, invites, pins, bulk deletes, emojis, webhooks and
  more — each with what changed (old → new) and the reason. Deleted messages say which moderator deleted them, and
  DelyForge's own moderation commands are credited to the moderator. Optional separate log channel per group; joins
  warn about new accounts and show who invited them; leaves show time in the server and roles.
- Seven new modules: **Invite Tracker** (`/invites`, `/inviteboard`), **Starboard**, **Temporary Voice**
  (join to create), **Raid Protection** (join-flood alerts, kick/ban during raids, new-account filter),
  **Sticky Messages**, **Server Stats** counters and **Birthdays** (`/birthday set|remove|upcoming`, birthday role).
- Updates: the installer closes DelyForge and removes any older copy, so there is only ever one installed. Installed
  copies watch this PC's installer folder and offer "Restart to update" as soon as a newer installer is built (GitHub
  Releases can be used instead later).

## [0.1.0] - 2026-11-15

First public release: https://github.com/plzdely/DelyForge/releases/tag/v0.1.0

### Added
- README rewritten as a showcase with screenshots, install steps and a first-bot guide; smoke-test screenshots hide
  pop-up notices; clearer Tickets and Verification descriptions.
- Members tab on each bot: see and remove warnings, see levels, reset XP — names shown once members are active.
- Giveaways can require a role to enter; staff can give a reason when approving or rejecting a suggestion.
- Bots keep running when the window is closed (DelyForge moves to the tray), and DelyForge can start with Windows.
- UI refresh: readable contrast everywhere, more depth, a single Modules page, a new dashboard, bot cards and bot
  page headers with each bot’s own colour banner, and a three-step guide on unconnected bots.
- Personal edition (on by default): everything unlocked locally, no sign-in, server-only screens hidden. One switch
  (`PERSONAL_EDITION` in `packages/shared/src/brand.ts`) brings the commercial edition back.
- Discord account linking (required in customer builds), bans that block the email and Discord account, and staff
  roles managed from the Admin dashboard.
- Phase 10: one-click Windows installer with app icon, automatic updates (customer chooses when to restart), release
  builds with the production API and signing key baked in, packaged-app smoke test.
- Phase 9: analytics with CSV export, automatic daily backups, team workspaces with invites, and an internal admin
  dashboard. Unbuilt plan features are labelled “coming soon”.
- Phase 8: Marketplace — browse, install signed community packs (commands, embeds, templates, workflows), reviews,
  developer publishing and a staff review queue.
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
