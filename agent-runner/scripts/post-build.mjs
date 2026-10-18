// ncc emits a directory; the server copies every file flat into .devdigest/runner/.
// A "type":"module" package.json keeps ESM resolution working in any target repo (C5).
import { writeFileSync, readdirSync, statSync } from 'node:fs';
writeFileSync('dist/package.json', '{"type":"module"}\n');
let total = 0;
for (const f of readdirSync('dist')) total += statSync(`dist/${f}`).size;
console.log(`dist: ${readdirSync('dist').length} files, ${(total / 1024).toFixed(0)} KB`);
if (total > 5 * 1024 * 1024) { console.error('dist exceeds 5 MB'); process.exit(1); }
