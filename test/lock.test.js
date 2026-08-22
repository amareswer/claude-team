import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { acquireLock, withLock } from '../lib/lock.js';

let tmpDirs = [];
async function tmpFile() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-team-lock-test-'));
  tmpDirs.push(dir);
  return path.join(dir, 'shared.json');
}
afterEach(async () => {
  await Promise.all(tmpDirs.map((d) => fs.remove(d)));
  tmpDirs = [];
});

describe('withLock', () => {
  it('serializes concurrent read-modify-write cycles — no lost updates', async () => {
    const file = await tmpFile();
    await fs.writeJson(file, { count: 0 });

    async function increment() {
      await withLock(file, async () => {
        const doc = await fs.readJson(file);
        await new Promise((r) => setTimeout(r, Math.random() * 15)); // widen the race window
        doc.count += 1;
        await fs.writeJson(file, doc);
      });
    }
    await Promise.all(Array.from({ length: 20 }, increment));

    const result = await fs.readJson(file);
    expect(result.count).toBe(20);
  });

  it('releases the lock file after the critical section completes', async () => {
    const file = await tmpFile();
    await fs.writeJson(file, {});
    await withLock(file, async () => {});
    expect(await fs.pathExists(`${file}.lock`)).toBe(false);
  });

  it('releases the lock even when the wrapped function throws', async () => {
    const file = await tmpFile();
    await fs.writeJson(file, {});
    await expect(withLock(file, async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(await fs.pathExists(`${file}.lock`)).toBe(false);
  });
});

describe('acquireLock', () => {
  it('takes over a lock left by a process that is no longer running', async () => {
    const file = await tmpFile();
    await fs.writeJson(`${file}.lock`, { pid: 999999, acquiredAt: new Date().toISOString() });

    const start = Date.now();
    const lock = await acquireLock(file, { timeoutMs: 5000 });
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(1000); // stolen immediately, not waited out
    await lock.release();
  });

  it('times out when a live process genuinely holds the lock', async () => {
    const file = await tmpFile();
    await fs.writeJson(`${file}.lock`, { pid: process.pid, acquiredAt: new Date().toISOString() });

    await expect(acquireLock(file, { timeoutMs: 300 })).rejects.toThrow(/Timed out waiting for lock/);

    await fs.remove(`${file}.lock`);
  });
});
