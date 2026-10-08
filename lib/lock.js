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
// A lock is considered abandoned (and safe to steal) once it's older than
// this, even if its PID happens to look alive — a generous ceiling above
// the default acquire timeout so a slow-but-legitimate holder is never
// mistaken for a stale one.
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
        return { release: () => releaseLock(filePath, token) };
      } finally {
        await fs.remove(tmp).catch(() => {});
      }
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
    }

    const info = await readLockInfo(lockPath);
    let stale;
    if (info) {
      const age = info.acquiredAt ? Date.now() - Date.parse(info.acquiredAt) : Infinity;
      stale = Number.isNaN(age) || age > STALE_LOCK_MS || !isPidAlive(info.pid);
    } else {
      const st = await fs.stat(lockPath).catch(() => null);
      stale = !!st && Date.now() - st.mtimeMs > UNREADABLE_GRACE_MS;
      if (!st) continue; // vanished between EEXIST and now — just retry
    }
    if (stale) {
      // Re-read right before removing so we only delete the exact lock we
      // judged stale, not a fresh one a faster process just created.
      const again = await readLockInfo(lockPath);
      if ((again?.token ?? null) === (info?.token ?? null) && (again?.acquiredAt ?? null) === (info?.acquiredAt ?? null)) {
        try { await fs.remove(lockPath); } catch {}
      }
      continue;
    }

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

async function releaseLock(filePath, token) {
  const lockPath = lockPathFor(filePath);
  // Only remove the lock if it is still the one we created (matched by
  // unique token) — never one another process took over after ours went stale.
  const info = await readLockInfo(lockPath);
  if (info && info.token === token) {
    try { await fs.remove(lockPath); } catch {}
  }
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
