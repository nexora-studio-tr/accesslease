import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync, gzipSync, constants } from 'node:zlib';
function compress(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) compress(file);
    else if (/\.(js|css|html|svg)$/.test(file)) {
      const data = readFileSync(file);
      writeFileSync(file + '.gz', gzipSync(data, { level: 9 }));
      writeFileSync(
        file + '.br',
        brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 6 } }),
      );
    }
  }
}
compress('web-dist');
