import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
const root = resolve(import.meta.dirname, '..');
process.chdir(root);
const top = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  encoding: 'utf8',
  windowsHide: true,
}).trim();
if (resolve(top) !== root)
  throw new Error(
    'Initialize this project as its own repository first. The parent workspace must never be archived.',
  );
if (execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8', windowsHide: true }).trim())
  throw new Error('Commit and review the source tree before packaging.');
const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', windowsHide: true })
  .split('\0')
  .filter(Boolean);
if (
  files.some(
    (f) =>
      f !== '.env.example' &&
      f
        .split('/')
        .some(
          (segment) =>
            segment === '.env' ||
            segment.startsWith('.env.') ||
            [
              'artifacts',
              'node_modules',
              'dist',
              'web-dist',
              '.git',
              'test-results',
              'playwright-report',
            ].includes(segment),
        ),
  )
)
  throw new Error('Private/generated files found in tracked source.');
const { version } = JSON.parse(readFileSync('package.json', 'utf8')),
  out = 'artifacts/release';
mkdirSync(out, { recursive: true });
const file = `accesslease-${version}-source.zip`;
execFileSync(
  'git',
  ['archive', '--format=zip', `--prefix=accesslease/`, `--output=${out}/${file}`, 'HEAD'],
  { windowsHide: true },
);
const sum = createHash('sha256')
  .update(readFileSync(`${out}/${file}`))
  .digest('hex');
writeFileSync(`${out}/SHA256SUMS.txt`, `${sum}  ${file}\n`);
writeFileSync(
  `${out}/MANIFEST.json`,
  JSON.stringify(
    {
      version,
      commit: execFileSync('git', ['rev-parse', 'HEAD'], {
        encoding: 'utf8',
        windowsHide: true,
      }).trim(),
      sourceFiles: files.length,
      sha256: sum,
    },
    null,
    2,
  ) + '\n',
);
console.log(`${file}: ${files.length} tracked source files; SHA256SUMS.txt generated.`);
