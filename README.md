# DelyForge

**Build. Automate. Control.** — by plzdely

DelyForge is an all-in-one platform for creating, configuring, running and monitoring Discord bots through a
beautiful desktop app — no programming required.

> Status: **Phase 1 (Foundation) complete.** See [DEVELOPMENT_STATUS.md](DEVELOPMENT_STATUS.md) for exactly what works
> today and [ROADMAP.md](ROADMAP.md) for what comes next.

> **Current mode: Personal edition** (`PERSONAL_EDITION = true` in `packages/shared/src/brand.ts`). Selling is on hold:
> every feature is unlocked on this PC with no limits and no sign-in, and the screens that need a paid DelyForge server
> (Account, Subscription, AI, Marketplace, Team) are hidden. All the commercial code below is still built and tested;
> set the switch to `false` to bring it back.

## Repository layout

| Path | What it is |
|---|---|
| `apps/desktop` | DelyForge Desktop — Electron + React + Tailwind app (Windows first) |
| `apps/api` | DelyForge Cloud API — NestJS + Prisma + PostgreSQL |
| `packages/shared` | Shared TypeScript: plans, entitlements, IPC contract, validation, secret redaction |

Read [ARCHITECTURE.md](ARCHITECTURE.md) for how it fits together and [SECURITY.md](SECURITY.md) for the security model.

## Prerequisites (one-time setup)

| Tool | Version | Why |
|---|---|---|
| [Node.js](https://nodejs.org) | 22.12 or newer (24 LTS recommended) | Runs all tooling |
| [pnpm](https://pnpm.io) | 11.x | Package manager (`npm install -g pnpm`) |
| Git | any recent | Version control |

No database installation is needed — `pnpm db:up` starts a local PostgreSQL that ships with the project's tooling.
(Docker is supported as an optional alternative: `pnpm db:up:docker`.)

> **Customers never install any of this.** They download one `DelyForge Setup.exe` and double-click it. The desktop
> app keeps its data in a built-in SQLite file, and the cloud database runs on DelyForge's own servers.

## Getting started

Open a terminal in the project folder and run:

```bash
pnpm install
```

### Run the desktop app

```bash
pnpm dev:desktop
```

A DelyForge window opens. Code changes to the UI reload instantly.

### Run the cloud API (optional for now)

1. Create your local config file (only once):
   ```bash
   cp apps/api/.env.example apps/api/.env
   ```
2. Start the database, create the tables, and load the plan catalogue (the database keeps running in the background
   until you run `pnpm db:down`; if `db:up` ever fails, run `pnpm db:down` and then `pnpm db:up` again):
   ```bash
   pnpm db:up
   ```
   ```bash
   pnpm db:migrate
   ```
   ```bash
   pnpm db:seed
   ```
3. Start the API:
   ```bash
   pnpm dev:api
   ```
   Then open http://localhost:4000/health and http://localhost:4000/v1/plans.

## Testing

```bash
pnpm test
```

```bash
pnpm typecheck
```

```bash
pnpm test:smoke
```

`test:smoke` builds and launches the real desktop app, checks every screen renders, and saves screenshots to
`apps/desktop/out/smoke/`. Database integration tests run when Postgres is up:
`DELYFORGE_DB_TESTS=1 pnpm --filter @delyforge/api test`.

## Building the Windows installer

Customers only ever download and double-click `DelyForge-Setup-<version>.exe`. It installs for the current user (no admin
prompt), adds Start-menu and desktop shortcuts, and keeps everyone's bots and settings when uninstalling or updating.

**Test installer on your own PC** (talks to `http://localhost:4000`, never auto-updates, not code-signed):

```bash
pnpm --filter @delyforge/desktop dist:unsigned
```

The installer appears in `apps/desktop/release/`. To check the packaged app works without installing it:

```bash
pnpm --filter @delyforge/desktop exec node scripts/smoke.mjs --packaged
```

**Customer installer:** set these first (the build refuses to run without them), then run `pnpm --filter @delyforge/desktop dist`:

| Variable | What it is |
|---|---|
| `DELYFORGE_API_URL` | Your live API address, e.g. `https://api.yourdomain.com` |
| `DELYFORGE_ENTITLEMENT_PUBLIC_KEY` | The public key printed by `pnpm --filter @delyforge/api keys:generate` (the server keeps the private half) |
| `DELYFORGE_UPDATE_URL` | An HTTPS folder where you upload each new installer **and** `latest.yml` |
| `CSC_LINK`, `CSC_KEY_PASSWORD` | Your code-signing certificate (optional, but without it Windows warns customers) |

Release builds ignore these as environment variables at run time, so nobody can point an installed copy at a fake server.
After building, upload `DelyForge-Setup-<version>.exe`, its `.blockmap` and `latest.yml` to the update folder — installed
copies find it within 6 hours, download it in the background and ask the customer to restart.

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) — technical design and decisions
- [ROADMAP.md](ROADMAP.md) — development phases
- [DEVELOPMENT_STATUS.md](DEVELOPMENT_STATUS.md) — what is done, verified, and pending
- [SECURITY.md](SECURITY.md) — threat model and mitigations
- [CHANGELOG.md](CHANGELOG.md) — release notes

© plzdely. All rights reserved.
