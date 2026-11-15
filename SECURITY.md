# DelyForge Security

Security model, identified risks and mitigations. Update this file when a risk is added or a mitigation ships.

## Reporting a vulnerability
Email the maintainers privately (address to be published before release). Do not open public issues for vulnerabilities.

## Principles
1. **Secrets stay where they belong.** Discord bot tokens stay on the customer's machine, encrypted. AI and Stripe keys
   stay on the server. Nothing secret is ever logged.
2. **The server is the authority** for anything that involves money, entitlements or shared data.
3. **Everything from outside is validated** — IPC payloads, API bodies, webhooks, configs, templates, AI output and
   marketplace packages all pass Zod schemas.
4. **Third-party code is untrusted** and sandboxed with least privilege.
5. **Least privilege everywhere** — Electron renderer sandboxed, bots request minimal intents/permissions, team members
   get only the access they are granted.

## Threats and mitigations

| # | Risk | Mitigation | Status |
|---|---|---|---|
| S1 | Bot token theft from disk | Encrypted with Electron `safeStorage` (Windows DPAPI, tied to the OS user); refuses to save if encryption is unavailable. Separate `bot_secrets` table, never exported. The raw token is never returned to the UI (only a 4-character hint). | Shipped (Phase 3) |
| S2 | Token leakage in logs / errors / screenshots | Central redactor (Discord token pattern + registered secrets) on every log line; tokens shown masked in UI; never sent on command lines or env vars. | Shipped — runtime and supervisor both redact; the live token is registered as a secret |
| S3 | Renderer compromise (XSS → Node access) | `contextIsolation`, `sandbox`, `nodeIntegration: false`, strict CSP, navigation/new-window blocked, typed preload API only, Zod validation of every IPC payload in main. | Shipped (Phase 1) |
| S4 | Command injection when spawning bots | Fixed entry file via `utilityProcess.fork`; no shell; no user input in argv; token sent only over the private message channel; runtime messages validated as untrusted. | Shipped (Phase 3) |
| S5 | Password compromise | scrypt (N=2^15, r=8, p=1, 16-byte salt) via Node's built-in crypto, constant-time compare, dummy hash for unknown emails, rate-limited login, generic error messages. | Shipped (Phase 7) |
| S6 | Session hijacking | 15-minute HS256 access tokens checked against a live session; rotating refresh tokens stored as SHA-256; reuse of a rotated token revokes the whole family; desktop keeps the refresh token encrypted with `safeStorage`. | Shipped (Phase 7) |
| S7 | Subscription bypass | Server-side entitlements; Ed25519-signed 24 h plan certificates verified by the desktop with an embedded public key; 7-day offline grace; AI/marketplace/team enforced server-side. | Shipped (Phase 7) |
| S8 | Forged Stripe webhooks / replays | Stripe SDK signature verification over the raw body, unique event IDs (idempotent), subscription state copied from Stripe objects. | Shipped (Phase 7) |
| S9 | SQL injection | Prisma parameterized queries (cloud); prepared statements only (local SQLite). No string-built SQL. | Shipped (Phase 1) |
| S10 | API abuse / brute force | Global rate limiting (`@nestjs/throttler`), stricter limits on auth & AI routes, Helmet security headers, CORS allow-list. | Shipped (Phase 1) |
| S11 | Malicious marketplace plugins | Declarative content by default; code plugins sandboxed with capability permissions; review + DelyForge signature required. | Design done; Phase 8 |
| S12 | AI prompt injection / unsafe changes | AI output is parsed item by item against the real config schemas and may only reference the server's real channel/role IDs; proposals are applied only after the user approves them, through the normal validated save paths; logs are redacted again before being sent; AI keys exist only on the API. | Shipped (Phase 6) |
| S13 | Malicious update | Code-signed installer, HTTPS update feed, signature verification before install, no silent execution. | Planned (Phase 10) |
| S14 | Privilege escalation to admin | Separate admin role checked by server guard on every admin route; all admin actions audit-logged. | Planned (Phase 7/9) |
| S15 | Dependency supply chain | pnpm blocks install scripts except an explicit allow-list; lockfile committed; `pnpm audit` in CI. | Allow-list shipped (Phase 1) |
| S16 | Backup leakage | Backups exclude tokens by default; optional token inclusion encrypted with a user passphrase (AES-256-GCM, scrypt KDF). | Planned (Phase 5/10) |
| S17 | Discord ToS / API abuse | Only officially supported APIs; respect rate limits (discord.js limiter); no self-bots; no automation of the Developer Portal. | Policy |

## Development rules
* Never commit `.env` files (they are git-ignored; use `.env.example`).
* Never print a token, key or password — use the redactor for anything that might contain one.
* Any new IPC channel or API route must have a Zod schema.
