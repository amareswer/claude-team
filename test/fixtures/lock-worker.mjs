// Child process for the cross-process lock test: increments a counter file under the lock.
import fs from 'fs-extra';
import { withLock } from '../../lib/lock.js';
const [file, n] = process.argv.slice(2);
for (let i = 0; i < Number(n); i++) {
  await withLock(file, async () => {
    const doc = await fs.readJson(file);
    doc.count += 1;
    await fs.writeJson(file, doc);
  }, { timeoutMs: 20000 });
}
