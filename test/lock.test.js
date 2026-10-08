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

// Deterministic interleavings: each contender is frozen at an exact protocol
// step via test hooks while rivals run, then released.
function gate() {
  let open;
  const promise = new Promise((r) => (open = r));
  return { promise, open };
}
const settleSoon = (ms = 150) => new Promise((r) => setTimeout(r, ms));

describe('deterministic acquisition interleavings', () => {
  it('paused after snapshot (before publish): rival wins; the paused one cannot co-own', async () => {
    const file = await tmpFile();
    const g = gate();
    const state = { x: false, y: false };
    const x = acquireLock(file, { hooks: { afterSnapshot: () => g.promise } }).then((l) => { state.x = true; return l; });
    await settleSoon();
    const y = await acquireLock(file); // Y runs to completion while X is frozen
    state.y = true;
    g.open();
    await settleSoon();
    expect(state.x).toBe(false); // X resumed, hit EEXIST, now waits behind live Y
    await y.release();
    const xl = await x;
    expect(state.x).toBe(true);
    await xl.release();
    expect(await lockFiles(file)).toEqual([]);
  });

  it('paused after publish (before verification): rival cannot enter; resumed owner then holds', async () => {
    const file = await tmpFile();
    const g = gate();
    let xHolds = false, yHolds = false;
    const x = acquireLock(file, { hooks: { afterPublish: () => g.promise } }).then((l) => { xHolds = true; return l; });
    await settleSoon();
    const y = acquireLock(file).then((l) => { yHolds = true; return l; });
    await settleSoon(300);
    expect(yHolds).toBe(false); // sees X's published file, X is alive → waits
    g.open();
    const xl = await x;
    expect(yHolds).toBe(false);
    await xl.release();
    const yl = await y;
    expect(xHolds && yHolds).toBe(true);
    await yl.release();
  });

  it('stale EMPTY snapshot: newcomer publishes a lower epoch after a rival took over — it backs off', async () => {
    const file = await tmpFile();
    const g = gate();
    let fHolds = false;
    // F snapshots an empty directory, then freezes.
    const f = acquireLock(file, { hooks: { afterSnapshot: () => g.promise } }).then((l) => { fHolds = true; return l; });
    await settleSoon();
    // Meanwhile a dead lock appears and E takes over to epoch 2, deleting it.
    await plant(file, 1, { pid: 999999, token: 'dead', acquiredAt: new Date().toISOString() });
    const e = await acquireLock(file);
    expect(await lockFiles(file)).toEqual([`${path.basename(file)}.lock.2`]);
    // F resumes: publishes epoch 1 (no EEXIST!) but its verification sees epoch 2 → abort.
    g.open();
    await settleSoon(300);
    expect(fHolds).toBe(false);
    expect(await lockFiles(file)).toEqual([`${path.basename(file)}.lock.2`]); // F removed its epoch-1 file
    await e.release();
    await (await f).release();
  });

  it('two newcomers both snapshot the same dead lock: exactly one proceeds at a time', async () => {
    const file = await tmpFile();
    await plant(file, 1, { pid: 999999, token: 'dead', acquiredAt: new Date().toISOString() });
    const g = gate();
    let live = 0, max = 0;
    const run = () => withLock(file, async () => {
      live++; max = Math.max(max, live);
      await settleSoon(30);
      live--;
    }, { hooks: { afterSnapshot: () => g.promise }, timeoutMs: 10000 });
    const runs = [run(), run(), run(), run()];
    await settleSoon();
    g.open(); // all four proceed from an identical snapshot simultaneously
    await Promise.all(runs);
    expect(max).toBe(1);
    expect(await lockFiles(file)).toEqual([]);
  });
});

describe('fail-closed filesystem errors', () => {
  it('an unreadable lock file is an error, not an absent lock', async () => {
    const file = await tmpFile();
    await plant(file, 1, { pid: process.pid, token: 'x', acquiredAt: new Date().toISOString() });
    const lockPath = `${file}.lock.1`;
    await fs.chmod(lockPath, 0o000);
    try {
      if (process.getuid?.() === 0) return; // root ignores modes
      await expect(acquireLock(file, { timeoutMs: 300 })).rejects.toThrow(/EACCES/);
    } finally {
      await fs.chmod(lockPath, 0o644);
    }
  });
});
