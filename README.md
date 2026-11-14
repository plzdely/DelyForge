# DelyForge

**Build. Automate. Control.** — by plzdely

DelyForge is an all-in-one platform for creating, configuring, running and monitoring Discord bots through a
beautiful desktop app — no programming required.

> Status: **Phase 1 (Foundation) complete.** See [DEVELOPMENT_STATUS.md](DEVELOPMENT_STATUS.md) for exactly what works
> today and [ROADMAP.md](ROADMAP.md) for what comes next.

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
| [Docker Desktop](https://www.docker.com/products/docker-desktop/) | any recent | Runs the local PostgreSQL database for the API |
| Git | any recent | Version control |

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

1. Start Docker Desktop and wait until it says "Engine running".
2. Create your local config file (only once):
   ```bash
   cp apps/api/.env.example apps/api/.env
   ```
3. Start the database, create the tables, and load the plan catalogue:
   ```bash
   pnpm db:up
   ```
   ```bash
   pnpm db:migrate
   ```
   ```bash
   pnpm db:seed
   ```
4. Start the API:
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

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) — technical design and decisions
- [ROADMAP.md](ROADMAP.md) — development phases
- [DEVELOPMENT_STATUS.md](DEVELOPMENT_STATUS.md) — what is done, verified, and pending
- [SECURITY.md](SECURITY.md) — threat model and mitigations
- [CHANGELOG.md](CHANGELOG.md) — release notes

© plzdely. All rights reserved.
