import { config } from './config.js';
import { Database } from './store/db.js';
import { Engine } from './engine/service.js';
import { Simulator } from './adapters/simulator.js';
import { LiveDiscord } from './adapters/discord.js';
import { buildApp } from './http/app.js';
const cfg = config(),
  db = new Database(cfg.DATABASE_URL);
await db.migrate();
const leader = await db.pool.connect();
const lock = await leader.query(
  "SELECT pg_try_advisory_lock(hashtextextended('accesslease:runtime',0)) AS locked",
);
if (!lock.rows[0].locked) {
  leader.release();
  await db.close();
  throw new Error('Another AccessLease runtime is using this database');
}
const adapter =
  cfg.APP_MODE === 'demo'
    ? new Simulator(db)
    : new LiveDiscord(
        cfg.DISCORD_BOT_TOKEN!,
        cfg.DISCORD_APPLICATION_ID!,
        cfg.guildIds,
        cfg.PUBLIC_ORIGIN,
      );
const engine = new Engine(db, adapter);
if (adapter instanceof LiveDiscord) await adapter.start(engine);
const app = await buildApp(cfg, db, engine);
let inFlight: Promise<void> | null = null;
const interval = setInterval(() => {
  if (!inFlight)
    inFlight = engine
      .tick()
      .catch(() => app.log.error('Worker cycle failed; persisted jobs remain queued'))
      .finally(() => {
        inFlight = null;
      });
}, 1000);
const cleanup = setInterval(() => {
  void db
    .query(
      "DELETE FROM sessions WHERE expires_at<now(); DELETE FROM oauth_states WHERE expires_at<now(); DELETE FROM workspaces WHERE mode='demo' AND created_at<now()-interval '1 day'",
    )
    .catch(() => app.log.error('Cleanup cycle failed'));
}, 3600000);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(interval);
  clearInterval(cleanup);
  await app.close();
  await inFlight;
  if (adapter instanceof LiveDiscord) await adapter.close();
  leader.release();
  await db.close();
}
process.on('SIGINT', () => {
  void stop();
});
process.on('SIGTERM', () => {
  void stop();
});
await app.listen({ host: cfg.HOST, port: cfg.PORT });
