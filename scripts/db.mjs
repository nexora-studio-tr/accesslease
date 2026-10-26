import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
const root = resolve(import.meta.dirname, '..'),
  data = join(root, 'artifacts/local-postgres/data');
const bin =
  process.env.PG_BIN ??
  (process.platform === 'win32'
    ? 'C:/Program Files/PostgreSQL/18/bin'
    : '/usr/lib/postgresql/18/bin');
const exe = join(bin, 'pg_ctl' + (process.platform === 'win32' ? '.exe' : '')),
  action = process.argv[2];
if (
  !['start', 'stop'].includes(action) ||
  !existsSync(join(data, 'PG_VERSION')) ||
  !existsSync(exe)
)
  throw new Error(
    'No generated native cluster found. Use Docker Compose or run npm run setup first.',
  );
const run = (args) =>
  spawnSync(exe, ['-D', data, ...args], { windowsHide: true, stdio: 'ignore', timeout: 60000 });
const running = run(['status']).status === 0;
if (action === 'start' && !running) {
  const r = run([
    '-l',
    join(root, 'artifacts/local-postgres/postgres.log'),
    '-o',
    '-p 5448 -h 127.0.0.1',
    '-w',
    'start',
  ]);
  if (r.status !== 0)
    throw new Error('Database start failed. Check artifacts/local-postgres/postgres.log.');
}
if (action === 'stop' && running && run(['-m', 'fast', '-w', 'stop']).status !== 0)
  throw new Error('Database stop failed.');
console.log(
  action === 'start'
    ? 'Local AccessLease database ready on 127.0.0.1:5448.'
    : 'Local AccessLease database stopped.',
);
