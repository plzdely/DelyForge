# Development Status

_Last updated: 2026-11-15 — All ten phases built. Final review pending with you._

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

## Phase 5 — Builders

| Item | Status | Verification |
|---|---|---|
| Shared schemas: custom commands (Discord naming rules, reserved names, option order, https-only link buttons), embeds (all Discord limits incl. 6,000 total), workflows (20 steps, 1 h waits, trigger/step compatibility), templates | ✅ | 12 tests |
| Command Builder: slash + right-click user/message commands, options, variables, text/embed reply, link buttons, access presets, per-member cooldown, live Discord-style preview | ✅ / 🟡 | smoke test builds and saves a command through the UI; running it needs Discord |
| Embed Builder: every embed field, inline fields, character counter, live preview, duplicate/delete (Pro) | ✅ | typecheck + smoke screenshot |
| Automation Studio: 4 triggers, 9 step types incl. conditions and waits, reorder, run history, rate limit (30/min), intent warnings | ✅ / 🟡 | engine tests with fakes; real events need Discord |
| Plan limits: Free = 3 workflows, saved embeds = Pro; downgrade keeps data and runs only the allowed workflows | ✅ | service tests |
| Live updates: saved builders reach a running bot without restart; commands synced per server (only DelyForge-created ones removed) | ✅ / 🟡 | tests; real sync needs Discord |
| Template library: 10 templates (3 Free, 4 Pro, 3 Business), apply to a server, locked modules added switched off | ✅ | service tests + smoke screenshot |

**Not built (honest):** a free-form drag-and-drop canvas (the editor is a clear vertical step list), workflow test mode
against a fake member, template sharing/export, select menus and modals in custom commands, required-role checks
per command (use Discord's Integrations settings).

## Phase 7 — Accounts, billing, entitlements

| Item | Status | Verification |
|---|---|---|
| API: register, login, logout, refresh-token rotation with theft detection, sessions, profile, change password | ✅ | integration test against real PostgreSQL |
| API: email verification and password reset (single-use, expiring, hashed tokens; generic answers so emails can't be probed) | ✅ | integration test |
| Passwords hashed with scrypt; access tokens HS256 15 min; strict rate limits on auth routes | ✅ | unit + integration tests |
| Signed plan certificates (Ed25519, 24 h) computed server-side from subscription + overrides | ✅ | unit + integration tests |
| Stripe: Checkout, customer portal, invoices, signed + idempotent webhooks syncing subscriptions | ✅ / 🟡 | webhook verified with Stripe's own test signatures; real checkout needs Stripe keys |
| Desktop: sign in / create account / forgot password, profile, plan status, 7-day offline grace, encrypted refresh token | ✅ | 5 tests with a fake API + smoke screenshot |
| Desktop: upgrade buttons open Stripe Checkout, Manage billing, billing history, auto-refresh after paying | 🟡 | needs Stripe keys and products |

### Needs you before launch
1. **Stripe:** create an account, two Products (Pro, Business) with monthly + yearly Prices, then put the keys and the four
   price IDs in `apps/api/.env` and run `pnpm db:seed`. Add a webhook endpoint pointing at `/v1/billing/webhook`.
2. **Email provider:** emails are printed to the API console in development. A real provider (e.g. Postmark or SES) must be
   added behind `apps/api/src/mail/mailer.ts` before launch.
3. **Production secrets:** `pnpm --filter @delyforge/api keys:generate`.

## Phase 6 — AI

| Item | Status | Verification |
|---|---|---|
| API AI gateway: plan check, monthly credits reserved under a per-workspace lock (parallel requests can't overspend), usage + cost recorded per request; outages cost nothing, generated answers are charged even if unusable | ✅ | 7 integration tests with a fake provider (real PostgreSQL) |
| Claude via Anthropic's official SDK: typed JSON answers, cached instructions, automatic refusal fallback | 🟡 | type-checked against the installed SDK; **never called for real** (needs an API key) |
| AI Bot Builder: prompt → proposal → every item checked against the real settings rules and the server's real channels/roles → user approves → applied through the normal save paths | ✅ / 🟡 | shared + desktop tests; screen in smoke screenshots; real AI output untested |
| AI troubleshooting from the console (status + last 120 log lines, secrets removed) | ✅ / 🟡 | desktop test checks tokens are stripped; real answers untested |
| Webhook hardening (from the automated security review): plan taken from the Stripe price, failed events retried, out-of-order events ignored | ✅ | integration test |

### Needs you
1. **Anthropic API key:** create one at console.anthropic.com, put it in `apps/api/.env` as `ANTHROPIC_API_KEY=`, run
   `pnpm db:seed`, restart the API. Without it the AI screen says "AI isn't set up yet" — nothing pretends to work.
2. Check the AI's real proposals on a test server before selling (quality, cost per request).

### Not built (named, not hidden)
- A second AI provider (e.g. OpenAI). The gateway takes any provider through one small interface and the database
  already lists providers/models, but only Claude is wired up.
- Picking individual items from a proposal: it is apply-all or discard.

## Phase 8 — Marketplace

| Item | Status | Verification |
|---|---|---|
| Browse, search, filter, sort; listing details with contents and reviews | ✅ | 4 integration tests (real PostgreSQL) |
| Packs are declarative only (module settings, commands, embeds, workflows), checked by the same rules as the settings screens, and may not contain any server's channel/role IDs | ✅ | shared + API tests |
| Developer profile, submitting listings and new versions, review status and staff notes | ✅ | integration test |
| Staff review queue: approving signs the exact pack with the DelyForge key; the app refuses packs whose signature or content doesn't check out | ✅ | integration + desktop tests |
| Install into one server (plan-checked, embeds re-linked, name clashes skipped), installs counted once | ✅ | integration test; templates use the same install path |
| Ratings and reviews (only after installing) | ✅ | integration test |
| Marketplace screen (Browse / Publish / Review queue for staff) | 🟡 | renders in the smoke test; not clicked through against a running API |

### Not built (named, not hidden)
- **Paid listings and developer payouts:** need Stripe Connect and your Stripe account. Every listing is free for now.
- **Code plugins** (third-party code running in a sandbox): a separate, security-heavy project. The marketplace only
  carries data, never code, so it can't run anything harmful.
- Publishing modules or workflows from the app (the API accepts them; the app's publish form offers commands and embeds).
- Hiding abusive reviews and suspending listings need staff tools — planned for the Phase 9 admin dashboard.

### Making yourself staff (to review submissions)
In `apps/api`, run `pnpm exec prisma studio`, open the **User** table, set your account's `role` to `ADMIN`, save, then
sign out and in again in the app. A **Review queue** tab appears on the Marketplace page.

## Phase 9 — Teams, analytics, backups, admin

| Item | Status | Verification |
|---|---|---|
| Analytics: online time, commands, failures, crashes per day; top commands; 7 days (basic) or 90 days + CSV export (Pro) | ✅ | 2 desktop tests; screen in smoke test |
| Automatic daily backups of every bot's settings (no tokens), 14 kept, back up now, restore in place (Pro) | ✅ | 3 desktop tests |
| Team workspaces (Business): invite by email, seats incl. pending invites, accept in-app with a confirmed email, switch workspace, remove/leave; removal applies immediately; only the owner can buy | ✅ | 4 integration tests (real PostgreSQL) |
| Admin dashboard (staff): overview, customer search, suspend/reactivate, grant "Pro/Business for N days", suspend listings, hide reviews, audit log | ✅ | 3 integration tests; screen not clicked through |
| Unbuilt plan promises labelled "(coming soon)" on the pricing page | ✅ | — |

### Not built (named, not hidden)
- **Cloud features:** remote monitoring/management, cloud hosting of bots, the web dashboard, sharing bots between team
  members and per-bot permissions. They all need bots synced to the cloud — a hosting and cost decision for you.
  The database already has `CloudBotProject` and `BotAccessGrant` tables for this.
- Changing a team member's role (remove and re-invite instead), a customer-facing audit log (Enterprise), advanced
  integrations, advanced automation/monitoring tiers.

### Making yourself staff
See "Making yourself staff" under Phase 8: set your `role` to `ADMIN` in Prisma Studio. The Account page then shows
**Admin dashboard**.

## Phase 10 — Installer, updates, hardening

| Item | Status | Verification |
|---|---|---|
| One-click Windows installer (NSIS, per-user, no admin, shortcuts, data kept on uninstall), app icon | ✅ | built `DelyForge-Setup-0.1.0.exe` (125 MB) |
| Everything bundled (bot runtime + discord.js included), no node_modules shipped | ✅ | smoke test on the **packaged** app: all screens render, a real bot process starts and rejects a fake token |
| Release builds bake in API address + signing key and ignore environment overrides; build refuses to run without them (https only) | ✅ | release script checks |
| Automatic updates: background download over HTTPS, customer chooses when to restart, signature check when code-signed | 🟡 | built and type-checked; **never run against a real update server** |
| Smoke-test switch can't touch a customer's real data in installed copies | ✅ | — |
| Dependency audit | ✅ | 1 moderate issue, build tooling only (not shipped) |

### Needs you before selling (the full list)
1. **Host the API** on a server with HTTPS and a PostgreSQL database (e.g. Railway, Render, Fly.io + managed Postgres).
   Run `pnpm --filter @delyforge/api keys:generate`, put the private values in the server's environment, then
   `prisma migrate deploy` and `pnpm db:seed`.
2. **Stripe** (Phase 7 list): products, prices, webhook to `https://<api>/v1/billing/webhook`.
3. **Email provider** behind `apps/api/src/mail/mailer.ts` (Postmark, SES, Resend…). Until then no emails are sent in
   production (the API refuses rather than pretending).
4. **Discord application** for account linking (steps under "Setting up Discord linking").
5. **Anthropic API key** for the AI features (`ANTHROPIC_API_KEY` on the server).
6. **Update hosting:** any HTTPS static folder (S3/R2 bucket, your website) for installers + `latest.yml`.
7. **Code-signing certificate** (OV or EV) so Windows doesn't warn customers. Then set `publisherName` in
   `apps/desktop/electron-builder.yml` so updates must carry your signature.
8. **Make yourself staff:** set your own role to `ADMIN` once in Prisma Studio; after that, give or remove staff access from the Admin dashboard.
9. Real-world checks no test can do: a real Discord link, a Stripe test-mode purchase, a real AI proposal, a teammate invite end-to-end,
   and installing + updating on a second PC.

## Discord linking, bans and staff access (after Phase 10)

| Item | Status | Verification |
|---|---|---|
| Customers link their Discord account through Discord's own sign-in page (name + picture only, no Discord token kept) | ✅ / 🟡 | integration tests with a fake Discord; **real Discord needs your app's client ID + secret** |
| Customer builds can't be used until signed in **and** Discord is linked; bots stop if access is lost | ✅ | desktop tests; the gate is part of the signed plan certificate, so it can't be faked by editing local files |
| Ban (Admin dashboard): signs out everywhere, blocks the email from signing up and the Discord account from being linked again; Unban lifts all of it | ✅ | integration test |
| Give or remove staff access (Customer / Support / Admin) from the Admin dashboard; nobody can change their own role | ✅ | integration test |
| Admin search finds people by Discord name or ID | ✅ | integration test |

### Setting up Discord linking (you, once)
1. Go to <https://discord.com/developers/applications> → **New Application** → name it "DelyForge" → Create.
   (Use a different application from any bot you run.)
2. Left menu **OAuth2** → under **Redirects** click **Add Redirect** and enter
   `http://localhost:4000/v1/auth/discord/callback` for testing (later also `https://<your API>/v1/auth/discord/callback`)
   → **Save Changes**.
3. Same page: copy **Client ID**; click **Reset Secret** → copy the secret.
4. Put them in `apps/api/.env` as `DISCORD_CLIENT_ID=...` and `DISCORD_CLIENT_SECRET=...`, then restart the API.
   Never share the secret or commit it.
5. To try the sign-in gate in development: start the app with `DELYFORGE_REQUIRE_ACCOUNT=1 pnpm dev:desktop`
   (PowerShell: `$env:DELYFORGE_REQUIRE_ACCOUNT='1'; pnpm dev:desktop`).

### Not built
- Banning someone from **your own Discord server** when they're banned in DelyForge (needs a bot with ban permission in
  that server). Unlinking/changing the linked Discord account (staff can unban + the person relinks; ask if needed).

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

## Next up — final test and review with you
