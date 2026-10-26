import { config } from './config.js';
import { Database } from './store/db.js';
const db = new Database(config().DATABASE_URL);
try {
  await db.migrate();
  console.log('AccessLease schema is ready.');
} finally {
  await db.close();
}
