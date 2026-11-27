# Changelog

All notable changes to DelyForge are documented here. Format based on [Keep a Changelog](https://keepachangelog.com/);
versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.5.0] - 2026-11-27

233 new features: 11 new modules (124 features) and 109 additions to existing modules. Counted one per separate
thing you can switch on, set or run — options of the same feature aren't counted twice.

### New modules
- **Modmail** (14): members DM the bot to reach staff; each conversation is a thread in a staff-only channel with a
  member card (account age, join date, roles, earlier conversations); staff reply by typing in the thread; `//` notes
  stay private; anonymous replies option; files both ways; staff ping; server picker for members of several servers;
  ✅/❌ delivery reactions; `/modmail open | close (reason) | block | unblock`; custom greeting and closing messages.
- **Applications** (12): up to 10 forms, each with its own panel button and up to 5 questions (short/long, required);
  answers go to a review channel with account age and join date; Accept / Deny (with an optional reason); accepting
  gives a role and can take one away; templated DMs on accept and deny; cooldown after a decision; one waiting
  application per person; reviewer roles; optional discussion thread per application.
- **Economy** (20): `/balance`, `/daily` with streak bonus, `/work`, `/pay`, bank with `/deposit` and `/withdraw`,
  `/rob` with success chance, fines, cooldown and minimum wallet, coins for chatting, `/rich` leaderboard, coin shop
  (`/shopitems`, `/buy` with suggestions, roles given with refund if they can't be) and `/inventory`, `/coinflip`,
  `/slots`, maximum bet, `/eco give | take | set | reset`, custom currency name and emoji, starting balance, amounts like
  `all`, `half`, `50%`, `2k`.
- **Counting & Games** (13): counting channel, no counting twice in a row, reset-to-1 or delete-wrong modes, ✅ and 🎉
  reactions, record tracking, `/count` with top counters, `/trivia` with four buttons and a timer, 50 built-in questions,
  your own questions, coin prizes with Economy, the answer revealed when time runs out, `/rps`, `/8ball`.

- **Auto-responder** (13): replies when someone says a word or phrase — anywhere, as a whole word, at the start or
  as the whole message; several answers picked at random; reply, normal message or DM; card with a colour; a reaction;
  delete the trigger; only in chosen channels; only for / never for chosen roles; cooldown; `{args}` and `{channel}`.
- **Confessions** (10): `/confess` with an optional image, numbered posts, anonymous replies in a thread, an optional
  staff approval queue, a staff-only log of who wrote what (members are told), cooldown, `/confessions ban | unban`,
  custom title and colour.
- **Highlights** (11): `/highlight add | remove | list | clear | ignore`; a DM with a jump link and the messages around
  it; skipped while you're chatting there; only for channels you can read; DM cooldown; word limit; server-wide
  ignored channels.
- **Channel Automation** (10): per channel — auto-publish announcements, a thread on every message (name template),
  auto-reactions, media-only, text-only or link-only channels, auto-delete after a time, one post per member per N
  minutes/hours, staff bypass, a DM explaining why a message was removed.
- **Activity Stats** (8): messages and voice minutes per member per day, `/activity` (today, 7 and 30 days, all time),
  `/topchatters` and `/topvoice` by period, `/serveractivity` 7-day chart, weekly report, ignored channels.
- **Reputation** (8): `/rep give` (with a reason), cooldown, `/rep check`, `/rep top`, "thanks @name" gives rep (⭐
  reaction), role rewards, log channel, `/rep set`.
- **Member Tools** (5): roles given back on rejoin, nickname given back, roles that are never given back, a
  welcome-back message instead of the normal welcome, roles for time in the server.

### Added to existing modules
- **Tickets** (11 + 6): web-page (HTML) transcripts that look like Discord, opening hours (days, overnight, time zone),
  a server-wide open-ticket limit, `/ticket blacklist` and `unblacklist`, a staff reminder when the member has waited too
  long.
- **Moderation** (12 + 9): `/massban`, `/move`, `/disconnect`, `/report` and right-click **Report message** with
  Time out / Delete / Done buttons for staff, AutoMod rules for dangerous file types and too many files, invites to your
  own server allowed.
- **Logging** (2): name and avatar changes, boosts started and stopped.
- **Leveling** (+3): `/leaderboard page`, level-up message as a card, `/xp resetall` (typed confirmation).
- **Utility** (+10): `/quickpoll`, `/color`, `/calc`, `/servericon`, `/serverbanner`, `/firstmessage`, `/inrole`,
  `/say`, `/reminders` (list) and cancelling a reminder.
- **Giveaways** (+2): `/giveaway drop` (first click wins), `/giveaway delete`.
- **Temporary voice** (+2): `/voice bitrate`, `/voice info`.
- **Birthdays** (1): `/birthday month`. **Scheduled messages** (1): one-time messages on a date.
- **Economy** (+4): `/beg`, `/crime`, daily bank interest, pay boosts by role. **Counting & Games** (+4): `/tictactoe`
  against another member, `/wouldyourather`, `/truth`, `/dare`.
- **Modmail** (+3): saved-reply snippets, auto-close after idle hours, transcripts saved to a log channel.
  **Applications** (+3): open/closed switch, minimum account age, ping reviewers. **Reaction roles** (+1): descriptions
  under roles in menus.

### Earlier in 0.5.0
- **Tickets** (11): `/ticket add` and `/ticket remove` take a role as well as a member; `/ticket claim`, `unclaim`,
  `transfer`, `priority` (🟢🟡🔴 in the channel name), `closerequest` (the member confirms with a button), `close` with
  a reason, `stats`; 1–5 star rating DM after closing; ticket log channel. The module page now lists every command.
- **Moderation** (12): `/lockdown` and `/unlockdown` (every text channel, restored exactly), `/temprole`, `/reason`
  (edit a case), `/modstats`, `/dehoist` plus automatic dehoisting, `/purge` filters for links and attachments, AutoMod
  rules for zalgo text, too many lines and links from brand-new members.
- **Utility** (9): `/afk` (pingers are told, cleared when you talk), `/roleinfo`, `/channelinfo`, `/membercount`,
  `/choose`, `/emoji` (add an emoji from another server), `/timestamp`, `/banner`, DISBOARD bump reminder.
- **Welcome** (4): booster thank-you message, auto-delete for welcome messages, `{user.joined}` and `{boosts}` variables.
- **Leveling** (4): `/rewards`, double-XP weekends, announce only every N levels, channel XP boosts.
- **Giveaways** (3): minimum account age, minimum time in the server, DM the winners.
- **Suggestions** (1): cooldown between suggestions.
- **Temporary voice** (5): `/voice hide | unhide`, `permit`, `kick`, `ban`, `transfer`.
- **Raid protection** (4): anti-nuke (mass channel/role/emoji deletes, bans, kicks or webhooks by one person → roles
  removed or banned), trusted people list, choice of action, pausing invites during a raid.
- **Server stats** (4): `{textChannels}`, `{voiceChannels}`, `{emojis}`, `{boostTier}`.
- **Reaction roles** (1): most roles per member per panel.

### Notes
- Utility now listens to messages when `/afk` is on (no privileged intent needed). Modmail, the counting channel,
  Auto-responder, Highlights, Channel Automation and "thanks" rep need **Message Content Intent**; Member Tools needs
  **Server Members Intent**. The module pages say so.

## [0.4.4] - 2026-11-25 (local build, not published)

### Added
- **Shop module**: the bot posts your price list in a channel and keeps it up to date by editing its own messages.
  - Import an existing price list by pasting the Discord message; categories, items, ranges ($30-$50) and "and up"
    prices ($20+) are read in, with your header, divider and footer.
  - **Sales** start and end on their own: ~~old~~ and new prices, a sale banner with a countdown, on everything, some
    categories or some items; the biggest discount wins. Optional announcement with a role ping when a sale starts.
  - **Orders open/closed** switch and a 🛒 **Order** button: pick an item, describe it, optionally enter a discount
    code, and a ticket opens showing the item and its price at that moment.
  - **Discount codes** with a percentage, use limit and expiry (stack on top of a sale).
  - `/price` (with suggestions while typing) and `/vouch` (1–5 stars, review, optional screenshot, numbered cards).

## [0.4.3] - 2026-11-25

### Added
- **Add to server** button on every bot: opens Discord's invite page to add the bot to another server.
- **DM a role** in the Send message tab: every member with a role (or everyone) gets their own DM, with {user} filled in.
  Safety: a confirmation, one DM every 1.5 s, bots skipped, at most 1,000 people per run, one run per server at a time,
  and progress in the Console. Needs Server Members Intent; unwanted mass DMs can get a bot disabled by Discord.

## [0.4.2] - 2026-11-25

### Added
- **Send message** tab on every bot: write a message (optionally with a saved embed), pick a server channel or paste
  someone's user ID for a DM, and the running bot sends it as itself. Live preview, a choice whether mentions ping,
  clear reasons when it can't be sent, and links to what was sent this session.

## [0.4.1] - 2026-11-25

### Added
- **Tickets:** up to 5 extra ticket panels (e.g. Support, Report, Appeal), each with its own button, category, staff
  roles, first message and channel names; choose whether staff are pinged.
- **Welcome:** up to 10 extra versions of the welcome message — each new member gets one at random.
- **Temporary voice:** up to 5 extra “join to create” channels, each with its own name and limit (e.g. Duo, Squad).
- **Moderation:** `/unwarn` removes a single warning. **Giveaways:** `/giveaway list` shows the running ones.
- New message variable `{user.created}` (when the account was made, e.g. “3 years ago”).

### Fixed
- `/remind` only posts where the member can still talk themselves (otherwise it DMs them).

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
