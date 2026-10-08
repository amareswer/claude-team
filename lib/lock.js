import fs from "fs-extra";
import path from "path";
import crypto from "crypto";

// ── File locking for shared coordination files ─────────────────────────────
//
// Multiple agents (and the office server, and CLI commands run by the
// human) can read-modify-write the same JSON/markdown files concurrently —
// inboxes, outboxes, status files, MASTER.md, tasks/master.json. Without
// coordination, two writers can race: both read the old contents, both
// mutate their own in-memory copy, and whichever writes last silently
// erases the other's change.
//
// The lock is a plain sentinel file, `<file>.lock`, created exclusively
// (fails if it already exists) and containing the holder's PID + timestamp
// as JSON. No daemon, no new dependency — just another file in
// `.claude-team/`, consistent with the rest of the project. See README's
// "Concurrency & Locking" section.

const DEFAULT_TIMEOUT_MS = 5000;
const RETRY_BASE_MS = 50;
const RETRY_MAX_MS = 400;
// A live holder refreshes the lock file's mtime every HEARTBEAT_MS, so a
// lock is only stale when its owner is dead (pid gone) or has stopped
// heartbeating for STALE_LOCK_MS — a long-running critical section is never
// mistaken for an abandoned one.
const HEARTBEAT_MS = 5_000;
const STALE_LOCK_MS = 30_000;
// An unparseable/empty lock file is only treated as abandoned once it has
// sat this long. Locks are published atomically (see acquireLock) so this
// only matters for foreign or hand-damaged files, never a fresh lock.
const UNREADABLE_GRACE_MS = 2_000;

function lockPathFor(filePath) {
  return `${filePath}.lock`;
}

function isPidAlive(pid) {
  if (!pid || typeof pid !== "number") return false;
  try {
    // Signal 0 doesn't kill anything — it just probes whether the process
    // exists and is ours to signal.
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means it exists but belongs to another user — still alive.
    return err.code === "EPERM";
  }
}

async function readLockInfo(lockPath) {
  try {
    return await fs.readJson(lockPath);
  } catch {
    return null;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Acquires an exclusive lock on `filePath` by creating `<filePath>.lock`.
 * Retries with jittered backoff until `timeoutMs` elapses. A lock left
 * behind by a process that's no longer running (or that's simply too old)
 * is treated as stale and taken over rather than waited out.
 *
 * Returns `{ release }` — always release it in a `finally`, or use
 * `withLock` below instead of calling this directly.
 */
export async function acquireLock(filePath, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const lockPath = lockPathFor(filePath);
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;

  await fs.ensureDir(path.dirname(lockPath));
  const token = crypto.randomUUID();
  const payload = JSON.stringify({ pid: process.pid, token, acquiredAt: new Date().toISOString() });

  for (;;) {
    // Write the full contents to a private temp file, then hard-link it into
    // place. link() fails with EEXIST if a lock exists and, unlike
    // create-then-write, the lock is never visible half-written/empty.
    const tmp = `${lockPath}.${process.pid}.${token}.tmp`;
    try {
      await fs.writeFile(tmp, payload);
      try {
        await fs.link(tmp, lockPath);
        const beat = setInterval(() => {
          const now = new Date();
          fs.utimes(lockPath, now, now).catch(() => {});
        }, HEARTBEAT_MS);
        beat.unref();
        return { release: () => { clearInterval(beat); return releaseLock(filePath, token); } };
      } finally {
        await fs.remove(tmp).catch(() => {});
      }
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
    }

    const info = await readLockInfo(lockPath);
    const st = await fs.stat(lockPath).catch(() => null);
    if (!st) continue; // vanished between EEXIST and now — just retry
    const idle = Date.now() - st.mtimeMs; // refreshed by the holder's heartbeat
    const stale = info
      ? idle > STALE_LOCK_MS || !isPidAlive(info.pid)
      : idle > UNREADABLE_GRACE_MS;
    if (stale && (await reapStale(lockPath, info))) continue;

    if (Date.now() >= deadline) {
      throw new Error(
        `Timed out waiting for lock on ${filePath} (held by pid ${info?.pid ?? "?"} since ${info?.acquiredAt ?? "?"})`
      );
    }
    const backoff = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** attempt);
    attempt++;
    await sleep(backoff * (0.5 + Math.random() * 0.5)); // jitter
  }
}

// Removes `lockPath` only if it is still the lock described by `matches`.
// A check-then-delete is racy (the file can be replaced in between), so the
// file is first renamed to a private name — atomic, and it leaves exactly one
// caller holding it — and verified there. If it turns out to be someone
// else's live lock, it is linked straight back (link fails rather than
// overwrites, so we can never clobber a newer lock).
async function removeIfMatches(lockPath, matches) {
  const mine = `${lockPath}.${process.pid}.${crypto.randomUUID()}.rm`;
  try {
    await fs.rename(lockPath, mine);
  } catch {
    return false; // already gone
  }
  try {
    const info = await readLockInfo(mine);
    if (matches(info)) return true;
    try { await fs.link(mine, lockPath); } catch {}
    return false;
  } finally {
    await fs.remove(mine).catch(() => {});
  }
}

// Stale-lock takeover is itself serialized by a `<lock>.reap` guard so only
// one contender at a time is judging/removing a stale lock.
async function reapStale(lockPath, judged) {
  const guard = `${lockPath}.reap`;
  try {
    await fs.writeFile(guard, String(process.pid), { flag: "wx" });
  } catch (err) {
    if (err.code === "EEXIST") {
      // A crashed reaper must not wedge everyone: expire its guard quickly.
      const st = await fs.stat(guard).catch(() => null);
      if (st && Date.now() - st.mtimeMs > UNREADABLE_GRACE_MS) await fs.remove(guard).catch(() => {});
      return false;
    }
    throw err;
  }
  try {
    const same = (info) => (info?.token ?? null) === (judged?.token ?? null)
      && (info?.acquiredAt ?? null) === (judged?.acquiredAt ?? null)
      && (info?.pid ?? null) === (judged?.pid ?? null);
    return await removeIfMatches(lockPath, same);
  } finally {
    await fs.remove(guard).catch(() => {});
  }
}

async function releaseLock(filePath, token) {
  // Only remove the lock if it is still the one we created (matched by
  // unique token) — never one another process took over after ours went stale.
  await removeIfMatches(lockPathFor(filePath), (info) => info?.token === token);
}

/**
 * Runs `fn` while holding an exclusive lock on `filePath`. This is the
 * primitive every read-modify-write on a shared coordination file should
 * go through — see `updateJson` in `lib/jsonStore.js` for the common case
 * of "read this JSON file, mutate it, write it back."
 */
export async function withLock(filePath, fn, opts) {
  const lock = await acquireLock(filePath, opts);
  try {
    return await fn();
  } finally {
    await lock.release();
  }
}
