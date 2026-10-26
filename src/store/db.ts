import pg, { type PoolClient, type QueryResultRow } from 'pg';
import { schema } from './schema.js';
export type Client = Pick<PoolClient, 'query'>;
export class Database {
  pool: pg.Pool;
  constructor(url: string) {
    this.pool = new pg.Pool({
      connectionString: url,
      max: 8,
      connectionTimeoutMillis: 5000,
      statement_timeout: 20000,
    });
  }
  async migrate() {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended('accesslease:migrations',0))");
      await c.query(schema);
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }
  async query<T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []) {
    return this.pool.query<T>(sql, params);
  }
  async guild<T>(id: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    let locked = false;
    try {
      await c.query("SELECT pg_advisory_lock(hashtextextended('guild:' || $1,0))", [id]);
      locked = true;
      return await fn(c);
    } finally {
      let broken = false;
      if (locked) {
        try {
          await c.query("SELECT pg_advisory_unlock(hashtextextended('guild:' || $1,0))", [id]);
        } catch {
          broken = true;
        }
      }
      c.release(broken);
    }
  }
  async atomic<T>(c: Client, fn: () => Promise<T>): Promise<T> {
    await c.query('BEGIN');
    try {
      const result = await fn();
      await c.query('COMMIT');
      return result;
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    }
  }
  async now(c: Client, guild: string): Promise<Date> {
    const r = await c.query(
      "SELECT clock_timestamp() + clock_offset_ms * interval '1 millisecond' AS now FROM workspaces WHERE id=$1",
      [guild],
    );
    if (!r.rows[0]) throw new Error('Workspace missing');
    return r.rows[0].now;
  }
  async close() {
    await this.pool.end();
  }
}
