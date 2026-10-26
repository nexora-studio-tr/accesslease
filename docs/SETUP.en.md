# Setup and operations

## Local demonstration

1. Install Node.js 24 and PostgreSQL 18, or make Docker Compose available.
2. Run `npm ci`, then `npm run setup` from this project's directory.
3. The setup script generates random database credentials in `.env`; it does not print them or connect to Discord.
4. On Windows, PostgreSQL binaries are detected at `C:/Program Files/PostgreSQL/18/bin`. Set `PG_BIN` for a different installation. The separate cluster lives under ignored `artifacts/local-postgres/data`, on port 5448, bound to 127.0.0.1. Existing clusters or `.env` files are preserved.
5. If native binaries are unavailable, run `docker compose up -d db`. This creates a dedicated non-superuser application login. The example `.env` is a reference; use setup to generate actual passwords.
6. Run `npm run build` and `npm start`. Open http://127.0.0.1:4348.

To start the generated native cluster after a restart, run the following in PowerShell, replacing the binary path if necessary:

```powershell
& 'C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe' -D '.\artifacts\local-postgres\data' -l '.\artifacts\local-postgres\postgres.log' -o '-p 5448 -h 127.0.0.1' -w start
```

To stop it cleanly:

```powershell
& 'C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe' -D '.\artifacts\local-postgres\data' -m fast -w stop
```

## Entirely Docker

Use the Docker database path instead of the native cluster. `npm run setup` creates `.env`; if native PostgreSQL is installed but you want Docker, set `PG_BIN` to a nonexistent directory for that setup invocation. Then run:

```sh
docker compose up --build -d
docker compose logs -f app
```

The application and database ports bind only to loopback. The application is unprivileged, read-only, and has no Linux capabilities. Database data persists in a named volume. `docker compose down` preserves that volume. The Docker daemon must be running.

## Dedicated Discord test installation

1. Create a **new** application in the [Discord Developer Portal](https://discord.com/developers/applications). Do not reuse another product's credentials.
2. In Bot settings, enable **Server Members Intent**. Keep Message Content disabled. Discord may impose privileged-intent approval requirements as an application grows.
3. Invite the bot into a private test server with `bot` and `applications.commands` scopes and **Manage Roles**. Do not grant Administrator.
4. In OAuth2 settings, register exactly `http://127.0.0.1:4348/auth/callback`. `localhost` and `127.0.0.1` are different origins.
5. In your local `.env`, set:

```dotenv
APP_MODE=live
DISCORD_APPLICATION_ID=YOUR_APPLICATION_ID
DISCORD_CLIENT_SECRET=YOUR_REAL_OAUTH_SECRET
DISCORD_BOT_TOKEN=YOUR_DEDICATED_BOT_TOKEN
DISCORD_GUILD_IDS=YOUR_TEST_SERVER_ID
```

Multiple explicitly authorized server IDs can be comma-separated. A client secret is not the numeric application ID. Never put secrets in an issue, screenshot, commit, or chat.

6. Restart AccessLease. It registers `/access panel`, `/access request`, and `/access mine` only in configured servers.
7. Create a dedicated **Build Lab** role with **no guild-wide permission bits**. Place it below the bot role and below reviewer roles. Give it only the intended safe permission overwrites on a standard private text/voice channel. Existing integration-managed roles and `@everyone` are rejected.
8. Sign in to the panel as the Discord server owner. Add a policy under **Policies**. Select the dedicated role, every channel with an overwrite for that role, the eligible roles (empty means all server members), reviewer roles, and a maximum duration. Owner approval remains available even if no reviewer role is selected.
9. Ask a different member without that access role to request it. An independent reviewer checks the preview and approves. The minimum test duration is five minutes.
10. Verify the role and channel access in Discord, wait for expiry, then verify both again. Repeat with an overlapping lease and an external manual role removal.

If permission configuration changes, review conflicts explicitly. Releasing management does **not** remove the role. Remove any remaining role in Discord, then choose **Allow new requests** on the released lease. AccessLease must observe the role absent before a new independently approved request can proceed.

## Public installation

Use HTTPS, `NODE_ENV=production`, and `PUBLIC_ORIGIN=https://your-host`. Preserve that Host header in your reverse proxy; forwarded headers are not trusted. Register the matching HTTPS OAuth callback. The same origin serves UI and API. Never expose the database port outside loopback. Production session cookies are Secure when the public origin is HTTPS.

The default Docker app bind is loopback. Configure a reverse proxy on that host to reach port 4348. For a public simulation, retain `APP_MODE=demo`: do not put real credentials or private Discord data into it. Demo workspaces expire after one day; sessions expire after eight hours. Proxy-wide rate limiting may be needed for larger deployments.

## Backup and restore

Back up the PostgreSQL **database**, not a live copy of its data directory. Use `pg_dump --format=custom` with the application database connection configured privately through PostgreSQL environment variables or a protected password file. Do not paste the connection string into shared terminals or logs. Store backups encrypted with restricted access.

For recovery: stop the application, restore into a **new isolated database** with `pg_restore`, update the private `DATABASE_URL`, start a single runtime, and inspect queued and conflicted leases. Do not run an old and restored installation against the same Discord guild at the same time. Test restoration in demo mode first. Backup restoration is an operational check, not a guarantee that an unobserved Discord change can be inferred.

## Development

`npm run dev` runs the TypeScript server. Rebuild the UI after changes, or use `npm run web:dev` with `PUBLIC_ORIGIN=http://127.0.0.1:4349` on the API and update the OAuth callback to that origin. The Vite development proxy preserves browser-facing origin semantics. For test commands use a disposable database and `npm run check` before Playwright.
