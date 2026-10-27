# AccessLease

**Deliberate access. Verified endings.**

Temporary Discord access with a reason, an independent approval, an explainable permission preview, and a verified ending.

[Türkçe](README.tr.md) · [Setup](docs/SETUP.en.md) · [Renewals](docs/RENEWALS.md) · [Architecture](docs/ARCHITECTURE.md) · [Security](SECURITY.md) · [Validation](docs/VALIDATION.md)

![AccessLease ledger with synthetic demo data](docs/images/ledger-en.png)

## The problem

An external developer needs a private channel for two days. Someone grants a role. Two weeks later, nobody remembers why it is still there.

AccessLease turns that decision into a bounded lease: **request → inspect → approve → grant → verify → expire → verify again**. It also explains when another role or channel overwrite will keep access open after the leased role is removed.

## What makes it useful

- **Explain the change:** compare channel visibility, writing and voice permissions before approval, and preview the effect of removal.
- **Separate requesting from approving:** even a server owner cannot approve their own request.
- **Review extra time:** a holder can request a linked renewal. Another person must approve it; the original deadline stays in force while review is pending.
- **Preserve existing access:** do not adopt a pre-existing role; retain a managed role while another valid lease still needs it.
- **Respect administrator intervention:** observed role removals and permission drift require review rather than silent restoration.
- **Persist the work:** PostgreSQL-backed jobs, fixed deadlines, retries, restart recovery and explicit uncertain outcomes.
- **Show the truth:** a queued removal is not a completed removal. Removing one role is not proof that every channel became private again.
- **Run a useful demo:** isolated browser workspaces, three personas, time travel and failure scenarios, without Discord credentials or external API bills.

## Try it locally

Requirements: **Node.js 24**, npm, and **PostgreSQL 18 or Docker Compose**.

```sh
npm ci
npm run setup
```

Setup generates a private `.env`. If a supported local PostgreSQL binary is available, it starts a separate loopback-only development cluster. Otherwise start the database with `docker compose up -d db`. Then:

```sh
npm run build
npm start
```

Open **http://127.0.0.1:4348**. The default is a clearly labelled **simulation**, with no Discord network connection. Each browser receives its own workspace. The owner, reviewer and member personas let you inspect both authorization and privacy boundaries.

For an entirely containerized setup, run `docker compose up --build` after setup, using the Docker database path rather than the native cluster. See [setup](docs/SETUP.en.md) for exact alternatives.

## A two-minute walkthrough

1. Inspect Mina's **Build Lab** request. Compare the grant and removal previews.
2. Approve as Nora. The worker grants the role and verifies it.
3. Open **Try a scenario → Advance 49 hours**. Inspect the observed removal result.
4. In a fresh browser context, give Mina a second path to Build Lab **before approval**. Repeat the flow: the leased role disappears while the other path stays visible.
5. Switch to Mina. Only her requests and eligible catalog are visible; she cannot approve her own access.

The offline scenario simulates failed role-write operations while the simulator can still display its known state. It is not a real Discord outage benchmark.

## Connect a real server

Use a **new, dedicated Discord application** and a private test server. Configure its bot token, OAuth secret and explicit guild allow-list only in your local `.env`, then select `APP_MODE=live`. The exact callback is:

```text
http://127.0.0.1:4348/auth/callback
```

The bot uses official APIs and requests **Manage Roles**, not Administrator or Message Content. Enable the Server Members privileged intent. Create a dedicated role with **zero server-wide permissions**, add safe overwrites only to selected standard text/voice channels, and place it below the bot and reviewer roles. The server owner creates the policy in the panel. [Full instructions](docs/SETUP.en.md).

## Quality gates

```sh
npm run lint
npm run format:check
npm run check
npx playwright install chromium
npm run test:browser
```

Integration tests create and remove uniquely named schemas in the explicitly configured test/development database. They use actual PostgreSQL, not an in-memory SQL approximation. Use `TEST_DATABASE_URL` to select a separate disposable test database.

## Release scope

This is an **alpha** for small, self-hosted teams. It supports standard text and voice channel permission analysis, one role per package and one active runtime per database. It does not manage threads/forums/stages, edit channel rules, collect payments or provide a hosted SLA. Live human Discord testing is a separate validation gate; its current status is recorded in [VALIDATION.md](docs/VALIDATION.md).

The software is available under [MIT](LICENSE), with third-party license notices in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). No commercial bot source or credentials are included.
