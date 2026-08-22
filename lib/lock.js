import fs from "fs-extra";
import path from "path";

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

  for (;;) {
    try {
      await fs.ensureDir(path.dirname(lockPath));
      await fs.writeFile(
        lockPath,
        JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }),
        { flag: "wx" } // exclusive create — throws EEXIST if another holder is there first
      );
      return { release: () => releaseLock(filePath) };
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
    }

    const info = await readLockInfo(lockPath);
    const age = info?.acquiredAt ? Date.now() - Date.parse(info.acquiredAt) : Infinity;
    const stale = !info || Number.isNaN(age) || age > STALE_LOCK_MS || !isPidAlive(info.pid);
    if (stale) {
      // Best-effort steal. If another process wins the race to remove +
      // recreate it first, our next loop iteration's EEXIST just sends us
      // back through this same check.
      try { await fs.remove(lockPath); } catch {}
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

async function releaseLock(filePath) {
  const lockPath = lockPathFor(filePath);
  // Only remove it if it still looks like ours — guards against a slow
  // releaser deleting a lock a different process has since (legitimately)
  // acquired after treating ours as stale.
  const info = await readLockInfo(lockPath);
  if (!info || info.pid === process.pid) {
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
