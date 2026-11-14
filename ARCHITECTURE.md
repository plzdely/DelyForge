# DelyForge Architecture

> Build. Automate. Control. — by plzdely

This document records the architectural decisions behind DelyForge and the reasoning for them.
It is the source of truth for "how the system fits together". When a decision changes, update this file.

---

## 1. Products and how they connect

```
┌──────────────────────────────┐        HTTPS (REST + WebSocket)       ┌──────────────────────────────┐
│ DelyForge Desktop (Electron) │ ───────────────────────────────────▶ │ DelyForge Cloud (NestJS API) │
│  • UI (React)                │   account, billing, entitlements,    │  • Auth / sessions           │
│  • Local bot supervisor      │   AI proxy, marketplace, sync         │  • Stripe billing + webhooks │
│  • Local SQLite              │                                       │  • Entitlements / licensing  │
│  • Bot tokens (encrypted,    │                                       │  • AI provider gateway       │
│    never leave the machine)  │                                       │  • Marketplace / plugins     │
└──────────────┬───────────────┘                                       │  • PostgreSQL (Prisma)       │
               │ spawns + supervises                                   └──────────────┬───────────────┘
               ▼                                                                      │ same API + auth
┌──────────────────────────────┐                                       ┌──────────────▼───────────────┐
│ Bot runtime processes        │                                       │ DelyForge Web (future)       │
│ (one Node process per bot,   │                                       │  account, billing, remote    │
│  discord.js, config-driven)  │                                       │  monitoring, marketplace     │
└──────────────────────────────┘                                       └──────────────────────────────┘
```

* **Desktop is the first product.** Bots run on the customer's own computer in v1.
* **Cloud** owns everything that must be trusted: accounts, money, entitlements, AI keys, marketplace.
* **Web** is a future client of the same API. Business logic lives in the API and in `packages/shared`, never only in a UI.

---

## 2. Technology decisions

| Area | Choice | Why |
|---|---|---|
| Desktop shell | **Electron** | Discord bots require Node.js (discord.js). Electron ships Node, so the app, the supervisor and the bot runtime are one language (TypeScript) with no extra runtime to bundle. Mature Windows installer + signed auto-update (electron-builder / electron-updater). OS-level secret encryption (`safeStorage` → Windows DPAPI, macOS Keychain). |
| Desktop build | **electron-vite** + **electron-builder** | One config for main / preload / renderer builds with fast HMR; electron-builder produces the NSIS `.exe` installer and update metadata. |
| UI | **React 19 + TypeScript + Tailwind CSS v4** | Industry standard, huge ecosystem, easy to hire for. |
| Components | **Own design system on Radix UI primitives** (shadcn-style) | Radix gives accessible behaviour (focus, keyboard, ARIA); we own the look so DelyForge does not look like every other template. |
| Icons / type | **lucide-react**, **Geist / Geist Mono** (bundled, no CDN) | Clean developer-tool aesthetic; fonts ship inside the app (works offline, strict CSP). |
| Client state | **TanStack Query** (server/IPC data) + **Zustand** (UI state) | Clear split between "data we fetched" and "UI preferences". |
| Validation | **Zod** in `packages/shared` | One schema validates IPC payloads, API bodies, bot configs, templates and AI output. |
| Local DB | **SQLite via Node's built-in `node:sqlite`** in the Electron main process | Zero-setup, transactional, fast. Built into Electron's Node — no native add-on to compile per Electron version, simpler installers. Only the main process touches it. |
| Cloud API | **NestJS + TypeScript** | Opinionated module structure (guards, pipes, interceptors) scales to a large team and long-lived codebase. |
| Cloud DB | **PostgreSQL + Prisma 7** | Relational data (users, subscriptions, teams, marketplace) with type-safe queries and versioned migrations. |
| Discord | **discord.js v14** | Most complete, best-maintained Node Discord library; handles gateway, sharding hooks and rate limits. |
| Payments | **Stripe** (Checkout, Billing Portal, webhooks) | Handles PCI scope, tax, invoices, dunning. We never touch card data. |
| Tests | **Vitest** (unit/integration), **Supertest** (API), **Playwright** (desktop E2E, later) | Fast, TypeScript-native. |
| Package manager | **pnpm workspaces** | Fast, strict, monorepo-native, blocks untrusted install scripts by default. |

Pinned toolchain notes (Nov 2026): TypeScript is pinned to **6.0.x** (TS 7's native compiler is not yet supported by
typescript-eslint/NestJS tooling). Prisma is pinned to **7.10.x** stable (8.0 is a release candidate).

---

## 3. Repository layout (monorepo)

```
DelyForge/
├─ apps/
│  ├─ desktop/            Electron app
│  │  ├─ src/main/        Main process: windows, IPC handlers, local DB, secrets, bot supervisor
│  │  ├─ src/preload/     The ONLY bridge between UI and Node — exposes a typed, minimal API
│  │  └─ src/renderer/    React UI (sandboxed, no Node access)
│  └─ api/                NestJS cloud API + Prisma schema/migrations
├─ packages/
│  ├─ shared/             Types, Zod schemas, plan catalogue, entitlement logic, IPC contract
│  └─ (future) bot-runtime/  The process each bot runs in (Phase 3)
│  └─ (future) ui/           Design system extracted for the Web dashboard (Phase 9)
└─ docs (root *.md files)
```

`packages/shared` is pure TypeScript with no Node or DOM dependencies so it can be used by desktop main, renderer, API, bot runtime and the future web app.

---

## 4. Desktop process model and IPC security

Electron has three kinds of code; DelyForge treats them as three trust zones:

| Zone | Trust | Can do |
|---|---|---|
| **Main process** | Trusted | File system, SQLite, secrets, spawn bot processes, talk to the API. |
| **Preload** | Bridge | Exposes `window.delyforge` — a frozen object of typed functions. No raw `ipcRenderer`. |
| **Renderer (UI)** | Untrusted | Only calls `window.delyforge.*`. `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, strict CSP, navigation and `window.open` blocked. |

**IPC contract** — every channel is declared once in `packages/shared/src/ipc.ts` with a Zod schema for its input.
The main process validates every payload before acting (`handle()` wrapper), so a compromised renderer cannot send
malformed or unexpected data. Results use a `{ ok: true, data } | { ok: false, error }` envelope; errors are
redacted (no stack traces or secrets cross the bridge).

---

## 5. Local data (SQLite)

Location: `%APPDATA%/DelyForge/data/delyforge.db`. Schema migrations are versioned SQL files applied in order inside a
transaction on startup (`PRAGMA user_version`). Tables (Phase 1 creates the first ones; later phases add more):

| Table | Purpose |
|---|---|
| `settings` | Key/value app preferences (theme, startup behaviour, notification prefs). |
| `bot_projects` | One row per bot: name, description, avatar, presence, intents, permissions, enabled modules, flags (favorite, auto-start, auto-restart), group. **No token column.** |
| `bot_secrets` | Bot token encrypted with `safeStorage` (DPAPI). Separate table so exports/backups can exclude it trivially. |
| `bot_modules` | Per-bot module config JSON (validated against the module's Zod schema). |
| `commands`, `embeds`, `workflows`, `workflow_versions`, `workflow_runs` | Builders (Phase 5). |
| `bot_logs` | Ring-buffered structured logs per bot with retention setting. |
| `metrics_samples` | Uptime, latency, CPU, memory, command counts (rolled up hourly). |
| `activity` | Recent activity feed for the dashboard. |
| `notifications` | Local notification inbox. |

The renderer never sees SQL; it calls typed IPC functions.

---

## 6. Cloud database (PostgreSQL / Prisma)

The full schema lives in `apps/api/prisma/schema.prisma`. Main groups:

* **Identity** — `User`, `Session` (hashed refresh tokens, device info, revocation), `EmailToken` (verify / reset, hashed, single-use, expiring), `UserRole` (USER / SUPPORT / ADMIN).
* **Workspaces & teams** — `Workspace` (every user gets a personal one), `WorkspaceMember` (OWNER / ADMIN / DEVELOPER / VIEWER), `WorkspaceInvite`, `BotAccessGrant` (per-bot permissions: view / configure / control).
* **Billing** — `Plan` and `PlanPrice` (DB-driven, editable by admins), `Subscription` (mirror of Stripe state), `BillingEvent` (idempotent webhook log), `EntitlementOverride` (admin grants, Enterprise deals).
* **Cloud bot metadata** — `CloudBotProject` (sync metadata + config snapshot **without tokens**), `ConfigBackup` (encrypted blobs).
* **AI** — `AiProvider`, `AiModel` (cost per token), `AiUsage` (per request: tokens, cost, feature), `AiChangeProposal`.
* **Marketplace** — `DeveloperProfile`, `Listing`, `ListingVersion` (signed package, manifest, review status), `Purchase`, `Review`, `Favorite`.
* **Operations** — `AuditLog` (actor, action, target, IP, metadata — append-only), `Announcement`, `Notification`, `SupportTicket`, `ErrorReport`.

---

## 7. Discord bot runtime architecture

```
Main process
 └─ BotSupervisor
     ├─ BotHandle (bot A) ── utilityProcess/child ──▶ bot-runtime (discord.js) ── Gateway ─▶ Discord
     ├─ BotHandle (bot B) ── ...
     └─ HealthMonitor (heartbeats, CPU/memory sampling, crash detection, restart backoff)
```

* **One OS process per bot.** A crash or memory leak in one bot cannot take down the app or other bots.
* Spawned with Electron's `utilityProcess.fork()` (Node runtime, no UI privileges) using a **fixed entry file** — never a
  shell, never a command string built from user input.
* **The token is passed over the private IPC channel after spawn**, never on the command line or in env vars that could
  be read by other processes or written to logs.
* The runtime receives a **validated config snapshot** (modules, commands, workflows) and is purely data-driven: it does
  not execute user code. Modules are built-in TypeScript implementations parameterized by config.
* Runtime → supervisor messages: `ready`, `log`, `metric`, `heartbeat`, `error`, `command-executed`, `workflow-run`.
* Supervisor handles: start / stop (graceful `client.destroy()` then hard-kill timeout) / restart / auto-restart with
  exponential backoff and a crash-loop circuit breaker, start-on-launch, start-all / stop-all.
* Logs pass through a **redactor** (Discord token regex, known secrets) before being stored or displayed.
* **Hosting abstraction:** the UI talks to a `BotHost` interface (`start`, `stop`, `restart`, `status`, `logs`,
  `metrics`). `LocalBotHost` is v1; `CloudBotHost` (Phase 9) implements the same interface over the API so cloud hosting
  adds a backend, not a rewrite.
* **Modules** declare the gateway intents, permissions and slash commands they need. The wizard computes the minimum
  intents/permissions for the enabled modules and warns about privileged intents (Message Content, Server Members,
  Presence) that must be switched on manually in the Discord Developer Portal.
* **Slash command publishing** uses the bulk-overwrite endpoint per guild (fast, for testing) or global, respecting
  discord.js's built-in rate limiter.

---

## 8. Subscriptions, entitlements and license verification

* Plans, prices and limits are **data in PostgreSQL**, seeded from `packages/shared/src/plans.ts` and editable in the
  admin dashboard. Code never hardcodes "Pro has 5 bots" outside the seed/default catalogue.
* Stripe is the payment source of truth. **Webhooks** (signature-verified, idempotent via `BillingEvent.stripeEventId`)
  update `Subscription`. The client never decides what a user has paid for.
* **Entitlements** are computed server-side: `plan limits + active overrides + subscription status (active / trialing /
  past_due grace / canceled)`.
* The API issues a short-lived **signed entitlement token** (Ed25519, ~24 h) to the desktop app. The desktop verifies the
  signature with the embedded public key and caches it, so the app keeps working offline for a **7-day grace window**.
  After that it falls back to Free limits — it never deletes projects.
* **Downgrade handling:** if a user exceeds their new plan limit, existing projects stay saved and editable, but only the
  allowed number can be running; the user chooses which.
* Enforcement points: the API enforces cloud features (AI, marketplace, team, cloud hosting); the desktop enforces local
  limits (number of running bots, workflows) using the signed token. Local enforcement on a customer machine can always
  be tampered with — that is acceptable because every **valuable** feature (AI, premium templates, marketplace, cloud)
  is enforced on the server.

---

## 9. AI provider architecture

* **AI keys never ship in the desktop app.** The desktop calls `POST /ai/*` on the DelyForge API; the API holds provider
  keys (environment / secret manager) and proxies requests.
* `AiProvider` interface (`generate`, `stream`, `estimateCost`) with adapters (Anthropic, OpenAI, others). Models,
  prices and which model serves which feature are configured in the DB, so they can change without an app release.
* **Structured output:** the AI returns JSON that must pass the same Zod schemas as hand-made configs. Invalid output is
  rejected or repaired — it is never applied blindly.
* **Change proposals, never silent edits:** AI results become an `AiChangeProposal` (a diff of modules / commands /
  workflows) that the user previews and explicitly approves before anything is written.
* **Metering:** every request records tokens and cost in `AiUsage`; monthly allowances per plan are checked before the
  call; remaining usage is shown in the UI; costs roll up for business reporting.
* Prompt-injection defences: user server data passed to AI is treated as data, and AI output can only produce
  configuration within the validated schema — it cannot run code or access tokens.

---

## 10. Plugins and marketplace

Third-party code is **untrusted**. Two tiers:

1. **Declarative content (default, safest)** — templates, workflow packs, embed packs, command packs, themes. Pure data
   validated by Zod schemas. No code runs. This covers most marketplace items.
2. **Code plugins (later, opt-in)** — run inside the bot runtime in an isolated sandbox (separate worker/isolate with no
   `require`, no file system, no network except through a capability API). A plugin's manifest declares the
   permissions it needs (e.g. `messages:send`, `roles:assign`, `http:fetch:api.example.com`); the user approves them at
   install; the host API enforces them at runtime with CPU/memory/time limits.

Marketplace flow: developer onboarding → upload package → automated checks (schema validation, static analysis,
size limits, dependency scan) → human review → **package signed by DelyForge** → published. The desktop app refuses
unsigned or tampered packages. Purchases go through Stripe (Connect for developer payouts, platform commission).

---

## 11. Updates

electron-updater with a signed NSIS installer. Update metadata and binaries are served over HTTPS; the installer's code
signature is verified before install. Updates are never executed silently: the user sees version, release notes and
chooses when to restart. Previous installer kept for rollback where practical.

---

## 12. Cross-cutting concerns

* **Errors:** API uses a global exception filter returning `{ error: { code, message, requestId } }`; desktop IPC uses
  the result envelope. Unexpected errors are logged with a request ID, never with secrets.
* **Logging:** structured JSON (Nest `ConsoleLogger` in JSON mode) on the API; desktop main logs redacted JSON lines
  to rotating files in `%APPDATA%/DelyForge/logs`.
* **Desktop UI serving:** production UI is served from a private `app://delyforge/` protocol (not `file://`) so a
  strict CSP header can be applied and file access is confined to the bundled renderer folder.
* **Desktop smoke test:** `pnpm test:smoke` launches the real Electron app with a throw-away profile, renders every
  screen, exercises the settings IPC → SQLite path, and saves screenshots to `apps/desktop/out/smoke/`.
* **Config:** API config is validated with Zod at boot — the server refuses to start with missing/invalid settings.
* **Real-time:** desktop bot status/logs stream over IPC events; cloud → clients uses WebSockets (Phase 9).
