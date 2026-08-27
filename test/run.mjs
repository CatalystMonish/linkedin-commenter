/* No test framework, no dependencies: node test/run.mjs */
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const dir = path.dirname(fileURLToPath(import.meta.url));
let failed = 0;
for (const file of ['lib.test.mjs', 'interceptor.test.mjs']) {
  console.log(`\n=== ${file} ===`);
  try {
    execFileSync(process.execPath, [path.join(dir, file)], { stdio: 'inherit' });
  } catch (e) {
    failed++;
  }
}
process.exit(failed ? 1 : 0);
