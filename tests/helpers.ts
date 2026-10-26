import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Database } from '../src/store/db.js';
import { Simulator, createDemo, DEMO_ACTORS, IDS } from '../src/adapters/simulator.js';
import { Engine } from '../src/engine/service.js';
export { DEMO_ACTORS, IDS };
export async function fixture() {
  const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url)
    throw new Error(
      'PostgreSQL tests require TEST_DATABASE_URL or a private local .env. Run npm run setup.',
    );
  const admin = new Database(url),
    schema = 'accesslease_test_' + randomUUID().replaceAll('-', '');
  await admin.query(`CREATE SCHEMA ${schema}`);
  const isolated = new URL(url);
  isolated.searchParams.set('options', `-c search_path=${schema}`);
  const db = new Database(isolated.toString());
  await db.migrate();
  const sim = new Simulator(db),
    engine = new Engine(db, sim);
  return {
    db,
    sim,
    engine,
    seed: () => createDemo(db, engine),
    reset: () => db.query('TRUNCATE workspaces CASCADE'),
    close: async () => {
      await db.close();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.close();
    },
  };
}
