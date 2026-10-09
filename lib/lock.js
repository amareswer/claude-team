import fs from "fs-extra";
import path from "path";
import crypto from "crypto";

// ── File locking for shared coordination files ─────────────────────────────
//
// Multiple agents (and the office server, and CLI commands run by the
// human) can read-modify-write the same JSON/markdown files concurrently.
// Without coordination, two writers both read the old contents and the last
// write silently erases the other's change. See README "Concurrency & Locking".
//
// Design goal: **two live holders must never exist at once**, even if a
// process is paused for an arbitrary time between filesystem operations.
// That rules out every time-based takeover ("it hasn't touched the lock in
// 30s, steal it") — a merely paused owner would resume believing it still
// holds a lock someone else now owns. So:
//
//   1. A lock is never taken from a process that is still alive. Staleness
//      is decided only by "the owning pid no longer exists" (same-machine
//      locks, which is all this tool uses). A dead process cannot resume. A
//      reused pid just makes waiters time out — it fails safe, never unsafe.
//   2. There is no check-then-delete anywhere. Lock files are named by
//      epoch — `<file>.lock.<epoch>` — and created exclusively (link()), so
//      a given name has exactly one creator. Nothing is ever replaced.
//   3. A new owner must prove exclusivity AFTER publishing its file: its
//      epoch must be the highest, and the only other files present must be
//      the exact dead locks it judged (same contents) beforehand. Anything
//      else — a rival who published between its snapshot and its check —
//      makes it abort and retry. Every pair of rivals sees at least one
//      another, so at least one aborts; both aborting is safe (retry with
//      jittered backoff).
//   4. Release is a plain unlink of the owner's own file. That is safe by
//      (1): nobody removes a live owner's file, so the file is still ours.

const DEFAULT_TIMEOUT_MS = 5000;
const RETRY_BASE_MS = 50;
const RETRY_MAX_MS = 400;
// A lock file with unparseable contents cannot name an owner. Locks are
// published fully-formed (see below) so this only covers foreign or
// hand-damaged files; they count as dead after this grace period.
const UNREADABLE_GRACE_MS = 2_000;

function isPidAlive(pid) {
  if (!pid || typeof pid !== "number") return false;
  try {
    process.kill(pid, 0); // probes existence; kills nothing
    return true;
  } catch (err) {
    return err.code === "EPERM"; // exists, owned by another user
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// All epoch lock files for `filePath`, ascending, with their raw contents.
async function snapshot(filePath) {
  const dir = path.dirname(filePath);
  const re = new RegExp(`^${escapeRe(path.basename(filePath))}\\.lock\\.(\\d+)$`);
  let names;
  try {
    names = await fs.readdir(dir);
  } catch (err) {
    // Only a missing directory means "no locks". Anything else (EACCES, EIO…)
    // must fail closed — an unreadable lock directory is not an empty one.
    if (err.code === "ENOENT") return [];
    throw err;
  }
  const tmpRe = new RegExp(`^${escapeRe(path.basename(filePath))}\\.lock\\.tmp-(\\d+)-`);
  const entries = [];
  for (const name of names) {
    // Private temp files from an acquirer that died between write and link.
    // Only the creator ever links them, and a dead process can't, so a temp
    // file whose pid is gone is garbage and safe to delete.
    const t = tmpRe.exec(name);
    if (t) {
      if (!isPidAlive(Number(t[1]))) await fs.remove(path.join(dir, name)).catch(() => {});
      continue;
    }
    const m = re.exec(name);
    if (!m) continue;
    const p = path.join(dir, name);
    let raw = null;
    let mtimeMs = 0;
    try {
      raw = await fs.readFile(p, "utf8");
      mtimeMs = (await fs.stat(p)).mtimeMs;
    } catch (err) {
      if (err.code === "ENOENT") continue; // released/cleaned between readdir and read
      throw err; // unreadable lock: fail closed rather than treat it as absent
    }
    let info = null;
    try { info = JSON.parse(raw); } catch {}
    entries.push({ epoch: Number(m[1]), path: p, raw, info, mtimeMs });
  }
  return entries.sort((a, b) => a.epoch - b.epoch);
}

function ownerIsDead(entry) {
  if (entry.info && typeof entry.info.pid === "number") return !isPidAlive(entry.info.pid);
  return Date.now() - entry.mtimeMs > UNREADABLE_GRACE_MS;
}

/**
 * Acquires an exclusive lock on `filePath`. Retries with jittered backoff
 * until `timeoutMs` elapses, then throws. Locks left by dead processes are
 * cleaned up; locks held by live processes are always waited out.
 *
 * Returns `{ release }` — always release it in a `finally`, or use
 * `withLock` below instead of calling this directly.
 */
export async function acquireLock(filePath, { timeoutMs = DEFAULT_TIMEOUT_MS, hooks = {} } = {}) {
  // `hooks` (afterSnapshot / afterPublish) exist only so tests can pause a
  // contender at an exact step of the protocol; production callers omit them.
  const deadline = Date.now() + timeoutMs;
  await fs.ensureDir(path.dirname(filePath));
  const token = crypto.randomUUID();
  const payload = JSON.stringify({ pid: process.pid, token, acquiredAt: new Date().toISOString() });
  let attempt = 0;
  let holder = null;

  for (;;) {
    const before = await snapshot(filePath);
    await hooks.afterSnapshot?.();
    const live = before.find((e) => !ownerIsDead(e));
    if (live) {
      holder = live;
    } else {
      const epoch = (before.length ? before[before.length - 1].epoch : 0) + 1;
      const mine = `${filePath}.lock.${epoch}`;
      const tmp = `${filePath}.lock.tmp-${process.pid}-${token}`;
      let published = false;
      try {
        // Write the full contents privately, then link into place: link()
        // fails with EEXIST if that epoch is taken, and the lock is never
        // visible half-written.
        await fs.writeFile(tmp, payload);
        await fs.link(tmp, mine);
        published = true;
      } catch (err) {
        if (err.code !== "EEXIST") throw err;
      } finally {
        await fs.remove(tmp).catch(() => {});
      }

      if (published) {
        // From here on our file is visible to rivals and owned by a LIVE pid,
        // so nobody will ever reclaim it. Any exit that is not a successful
        // acquisition — including an error while verifying — must remove it.
        let acquired = false;
        try {
          await hooks.afterPublish?.();
          // Prove exclusivity: nothing but the dead locks we judged may exist.
          const judged = new Map(before.map((e) => [e.path, e.raw]));
          const after = await snapshot(filePath);
          const clean = after.every((e) => e.path === mine || (judged.has(e.path) && judged.get(e.path) === e.raw))
            && after[after.length - 1]?.path === mine;
          if (clean) {
            for (const e of before) await fs.remove(e.path).catch(() => {});
            acquired = true;
            return { release: () => fs.remove(mine).catch(() => {}) };
          }
          // a rival is in play — fall through, back off and retry
        } finally {
          if (!acquired) await fs.remove(mine).catch(() => {});
        }
      }
    }

    if (Date.now() >= deadline) {
      throw new Error(
        `Timed out waiting for lock on ${filePath} (held by pid ${holder?.info?.pid ?? "?"} since ${holder?.info?.acquiredAt ?? "?"})`
      );
    }
    const backoff = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** attempt);
    attempt++;
    await sleep(backoff * (0.5 + Math.random() * 0.5)); // jitter
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
