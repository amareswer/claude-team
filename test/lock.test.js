import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { acquireLock, withLock } from '../lib/lock.js';
import { execFile, spawn } from 'child_process';

async function lockFiles(file) {
  return (await fs.readdir(path.dirname(file))).filter((f) => f.startsWith(`${path.basename(file)}.lock`));
}
const plant = (file, epoch, info) => fs.writeJson(`${file}.lock.${epoch}`, info);

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
    expect(await lockFiles(file)).toEqual([]);
  });

  it('releases the lock even when the wrapped function throws', async () => {
    const file = await tmpFile();
    await fs.writeJson(file, {});
    await expect(withLock(file, async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(await lockFiles(file)).toEqual([]);
  });
});

describe('acquireLock', () => {
  it('takes over a lock left by a process that is no longer running', async () => {
    const file = await tmpFile();
    await plant(file, 1, { pid: 999999, token: 'dead', acquiredAt: new Date().toISOString() });
    const start = Date.now();
    const lock = await acquireLock(file, { timeoutMs: 5000 });
    expect(Date.now() - start).toBeLessThan(1000);
    expect(await lockFiles(file)).toEqual([`${path.basename(file)}.lock.2`]); // dead lock cleaned up
    await lock.release();
    expect(await lockFiles(file)).toEqual([]);
  });

  it('publishes a fully-populated lock — never empty', async () => {
    const file = await tmpFile();
    const lock = await acquireLock(file);
    const [name] = await lockFiles(file);
    const info = await fs.readJson(path.join(path.dirname(file), name));
    expect(info.token).toBeTruthy();
    expect(info.pid).toBe(process.pid);
    await lock.release();
  });
});

// Regression for the paused-owner interleaving: A stops making progress (as
// if SIGSTOPped / swapped out) while B and C contend. A live owner must NEVER
// be displaced, however old its lock looks, so B and C can never also hold it.
describe('paused-owner interleaving', () => {
  it('a live owner is not displaced by age; B and C stay locked out until A releases', async () => {
    const file = await tmpFile();
    const a = await acquireLock(file);
    // Make A's lock look ancient — under the old mtime/heartbeat design this
    // is exactly what let B steal it.
    const [name] = await lockFiles(file);
    const long = new Date(Date.now() - 24 * 3600 * 1000);
    await fs.utimes(path.join(path.dirname(file), name), long, long);

    const results = await Promise.allSettled([
      acquireLock(file, { timeoutMs: 400 }),
      acquireLock(file, { timeoutMs: 400 }),
    ]);
    for (const r of results) {
      expect(r.status).toBe('rejected');
      expect(String(r.reason)).toMatch(/Timed out/);
    }

    // A resumes and releases: its own file is still there to remove, and the
    // lock is then free for exactly one successor at a time.
    await a.release();
    const holders = [];
    await Promise.all([1, 2, 3].map(() => withLock(file, async () => {
      holders.push(1);
      expect(holders.length).toBe(1);
      await new Promise((r) => setTimeout(r, 20));
      holders.pop();
    })));
  });

  it('a lock whose owner actually died is taken over, and its epoch is superseded', async () => {
    const file = await tmpFile();
    const child = spawn(process.execPath, ['-e', '']);
    await new Promise((r) => child.on('exit', r));
    await plant(file, 7, { pid: child.pid, token: 'gone', acquiredAt: new Date().toISOString() });
    const lock = await acquireLock(file, { timeoutMs: 2000 });
    expect(await lockFiles(file)).toEqual([`${path.basename(file)}.lock.8`]);
    await lock.release();
  });

  it('a rival that publishes between snapshot and check makes the newcomer back off, not co-own', async () => {
    const file = await tmpFile();
    // A live rival at a LOWER epoch alongside a dead one: a newcomer that
    // only saw the dead one must not proceed.
    await plant(file, 1, { pid: process.pid, token: 'live-rival', acquiredAt: new Date().toISOString() });
    await expect(acquireLock(file, { timeoutMs: 300 })).rejects.toThrow(/Timed out/);
    expect(await lockFiles(file)).toEqual([`${path.basename(file)}.lock.1`]);
  });
});

describe('cross-process locking', () => {
  const worker = () => path.resolve('test/fixtures/lock-worker.mjs');
  const run = (file, n) => new Promise((resolve, reject) =>
    execFile(process.execPath, [worker(), file, String(n)], (err, _o, stderr) => (err ? reject(new Error(stderr)) : resolve())));

  it('serializes increments across 8 separate processes', async () => {
    const file = await tmpFile();
    await fs.writeJson(file, { count: 0 });
    await Promise.all(Array.from({ length: 8 }, () => run(file, 10)));
    expect((await fs.readJson(file)).count).toBe(80);
    expect(await lockFiles(file)).toEqual([]);
  }, 120000);

  it('8 processes racing over a dead-owner lock lose no updates', async () => {
    const file = await tmpFile();
    await fs.writeJson(file, { count: 0 });
    await plant(file, 3, { pid: 999999, token: 'dead', acquiredAt: new Date().toISOString() });
    await Promise.all(Array.from({ length: 8 }, () => run(file, 5)));
    expect((await fs.readJson(file)).count).toBe(40);
    expect(await lockFiles(file)).toEqual([]);
  }, 120000);
});
