import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
const root = resolve(import.meta.dirname, '..');
process.chdir(root);
if (existsSync('.env')) {
  console.log(
    '.env already exists; existing credentials were preserved. Use the database start command in docs/SETUP.en.md.',
  );
  process.exit(0);
}
const password = randomBytes(24).toString('hex');
let adminPassword = randomBytes(24).toString('hex');
const base = resolve('artifacts/local-postgres');
mkdirSync(base, { recursive: true });
const bin =
  process.env.PG_BIN ??
  (process.platform === 'win32'
    ? 'C:/Program Files/PostgreSQL/18/bin'
    : '/usr/lib/postgresql/18/bin');
const exe = (name) => join(bin, name + (process.platform === 'win32' ? '.exe' : ''));
const env = `APP_MODE=demo\nNODE_ENV=development\nHOST=127.0.0.1\nPORT=4348\nPUBLIC_ORIGIN=http://127.0.0.1:4348\nDATABASE_URL=postgresql://accesslease:${password}@127.0.0.1:5448/accesslease\nPOSTGRES_PASSWORD=${randomBytes(24).toString('hex')}\nAPP_DB_PASSWORD=${password}\n`;
if (!existsSync(exe('initdb'))) {
  writeFileSync('.env', env, { mode: 0o600 });
  console.log('Private .env created. Run: docker compose up -d db; npm run build; npm start');
  process.exit(0);
}
const data = join(base, 'data'),
  existing = existsSync(join(data, 'PG_VERSION'));
if (existing && !process.argv.includes('--resume-local'))
  throw new Error(
    'Existing local cluster found without .env; restore .env or explicitly resume your own cluster with --resume-local. No data was modified.',
  );
const pw = join(base, 'admin-password');
if (existing) adminPassword = readFileSync(pw, 'utf8');
else writeFileSync(pw, adminPassword, { mode: 0o600 });
const run = (name, args) => {
  const r = spawnSync(exe(name), args, { windowsHide: true, stdio: 'ignore', timeout: 60000 });
  if (r.status !== 0)
    throw new Error(`${name} failed. Check artifacts/local-postgres/postgres.log.`);
};
if (!existing)
  run('initdb', [
    '-D',
    data,
    '-U',
    'accesslease_admin',
    '--encoding=UTF8',
    '--locale=C',
    '--auth=scram-sha-256',
    '--pwfile',
    pw,
  ]);
if (
  spawnSync(exe('pg_ctl'), ['-D', data, 'status'], { windowsHide: true, stdio: 'ignore' })
    .status !== 0
)
  run('pg_ctl', [
    '-D',
    data,
    '-l',
    join(base, 'postgres.log'),
    '-o',
    '-p 5448 -h 127.0.0.1',
    '-w',
    'start',
  ]);
const admin = new pg.Client({
  host: '127.0.0.1',
  port: 5448,
  user: 'accesslease_admin',
  password: adminPassword,
  database: 'postgres',
});
await admin.connect();
try {
  await admin.query(
    `CREATE ROLE accesslease LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE`,
  );
  await admin.query('CREATE DATABASE accesslease OWNER accesslease');
} finally {
  await admin.end();
}
writeFileSync('.env', env, { mode: 0o600 });
console.log(
  'Private local PostgreSQL is ready on 127.0.0.1:5448. No Discord connection is enabled.',
);
