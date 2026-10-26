import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const paths = execFileSync(
  process.execPath,
  [process.env.npm_execpath, 'ls', '--omit=dev', '--all', '--parseable'],
  { encoding: 'utf8', windowsHide: true },
)
  .trim()
  .split(/\r?\n/)
  .slice(1);
mkdirSync('licenses', { recursive: true });
const entries = new Map();
for (const path of paths) {
  const meta = join(path, 'package.json');
  if (!existsSync(meta)) continue;
  const p = JSON.parse(readFileSync(meta, 'utf8')),
    key = p.name + '@' + p.version;
  if (entries.has(key)) continue;
  const files = readdirSync(path).filter((f) =>
    /^licen[sc]e(?:[.-]|$)|^copying(?:[.-]|$)|^notice(?:[.-]|$)/i.test(f),
  );
  let text = files
    .map((f) => {
      try {
        return `${f}\n\n${readFileSync(join(path, f), 'utf8')}`;
      } catch {
        return '';
      }
    })
    .filter(Boolean)
    .join('\n\n---\n\n');
  const override = 'licenses/overrides/' + key.replaceAll('/', '__') + '.txt';
  if (!text && existsSync(override)) text = readFileSync(override, 'utf8');
  if (!text) throw new Error('Missing upstream license text: ' + key);
  const target = 'licenses/' + key.replaceAll('/', '__') + '.txt';
  writeFileSync(target, text);
  entries.set(key, {
    license: typeof p.license === 'string' ? p.license : JSON.stringify(p.license),
    target,
  });
}
writeFileSync(
  'THIRD_PARTY_NOTICES.md',
  '# Third-party notices\n\nAccessLease original source is MIT licensed. Upstream runtime dependencies retain their own licenses; copies are preserved below. This inventory is generated from the locked production dependency tree.\n\n| Package | Declared license | License text |\n| --- | --- | --- |\n' +
    [...entries]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, p]) => `| ${name} | ${p.license} | [Notice](${p.target}) |`)
      .join('\n') +
    '\n',
);
console.log(`Preserved ${entries.size} upstream license notices.`);
