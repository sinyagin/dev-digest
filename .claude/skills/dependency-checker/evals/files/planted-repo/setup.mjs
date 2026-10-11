// Generates stub node_modules for this fixture (node_modules/ is git-ignored
// repo-wide, so installs can't be committed). Run once before each eval:
//   node setup.mjs
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname);
const stub = (pkg, name, version, kb, deps = {}, bin) => {
  const dir = path.join(here, pkg, 'node_modules', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version, dependencies: deps, ...(bin ? { bin } : {}) }, null, 2));
  fs.writeFileSync(path.join(dir, 'index.js'), 'x'.repeat(kb * 1024));
};

stub('api', 'express', '4.21.2', 200, { 'body-parser': '^1.20.0' });
stub('api', 'body-parser', '1.20.3', 80);
stub('api', '@types/express', '4.17.21', 40);
stub('api', 'left-pad', '1.3.0', 4);
stub('api', 'zod', '4.1.5', 1500);
stub('api', 'tsx', '4.19.2', 500, {}, { tsx: 'dist/cli.mjs' });
stub('api', 'typescript', '5.7.3', 20000, {}, { tsc: 'bin/tsc' });

stub('web', 'react', '19.0.0', 170);
stub('web', 'zod', '3.24.1', 1200);
stub('web', 'typescript', '5.7.3', 20000, {}, { tsc: 'bin/tsc' });
console.log('stub node_modules written');
