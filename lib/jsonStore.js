import fs from "fs-extra";
import { withLock, acquireLock } from "./lock.js";

/**
 * Locked read-modify-write for a shared JSON coordination file. Reads the
 * current contents (or `fallback` if the file is missing/unparseable),
 * hands a mutable doc to `mutate`, and writes the result back — all while
 * holding `<filePath>.lock`, so a concurrent writer (another agent, the
 * office server, a CLI command) can't interleave and drop an update.
 *
 * `mutate` may either mutate the doc in place and return nothing, or
 * return a replacement value to write instead. `fallback` may be a plain
 * value or a function (called fresh each time, so array/object literals
 * aren't shared across calls).
 */
export async function updateJson(filePath, mutate, fallback) {
  return withLock(filePath, async () => {
    let doc;
    try {
      doc = await fs.readJson(filePath);
    } catch {
      doc = typeof fallback === "function" ? fallback() : fallback;
    }
    const result = await mutate(doc);
    const toWrite = result === undefined ? doc : result;
    await fs.writeJson(filePath, toWrite, { spaces: 2 });
    return toWrite;
  });
}

/**
 * Locked write for a shared JSON file that isn't being read first (e.g.
 * creating a brand-new inbox, or an unconditional overwrite like
 * saveConfig). Still worth locking — it prevents this write from landing
 * in the middle of someone else's read-modify-write cycle on the same
 * file.
 */
export async function writeJsonLocked(filePath, doc) {
  return withLock(filePath, () => fs.writeJson(filePath, doc, { spaces: 2 }));
}

/**
 * Moves one task between two different JSON task files — e.g. reassigning
 * a task from one agent's inbox to another's, or between the queue and an
 * inbox. `withLock`/`updateJson` only protect a single file; a task move
 * touches two, and a plain lock on each (acquired one after the other)
 * can't make the pair atomic — a crash between the two writes is always
 * possible. `moveTask` can't eliminate that gap, but it controls which
 * way it fails:
 *
 * - **Both locks are acquired up front**, always in the same
 *   deterministic order — the two file paths sorted, not "fromFile then
 *   toFile" — so two concurrent moves crossing the same two files in
 *   opposite directions (A→B and B→A) always contend for the same lock
 *   first instead of each grabbing one and waiting on the other. That's
 *   what would deadlock; sorting makes it impossible.
 * - **`toFile` is written before `fromFile`.** If the process dies
 *   between the two writes, the task is left in *both* files — a
 *   duplicate — never in neither. Duplication is recoverable (surfaced by
 *   `reconcileDuplicateTasks` below, deduped by a human or the
 *   orchestrator on its next pass); loss isn't recoverable at all.
 *
 * `transform(task)` runs on the task after it's removed from `fromFile`
 * and before it's inserted into `toFile` — e.g. setting `assignedTo` to
 * the new owner. It may mutate the task in place and return nothing, or
 * return a replacement object.
 *
 * Throws if `taskId` isn't found in `fromFile`.
 */
export async function moveTask({ fromFile, toFile, taskId, transform }) {
  if (fromFile === toFile) {
    // Nothing physically moves — one lock, one read-modify-write.
    return updateJson(fromFile, async (doc) => {
      doc.tasks = doc.tasks || [];
      const idx = doc.tasks.findIndex((t) => t.id === taskId);
      if (idx === -1) throw Object.assign(new Error(`Task "${taskId}" not found in ${fromFile}`), { code: 'TASK_NOT_FOUND' });
      const transformed = await transform?.(doc.tasks[idx]);
      if (transformed !== undefined) doc.tasks[idx] = transformed;
    });
  }

  // Deterministic order — not fromFile/toFile order — so every concurrent
  // mover of this same pair of files contends for the same first lock.
  const [firstPath, secondPath] = [fromFile, toFile].sort();
  const firstLock = await acquireLock(firstPath);
  try {
    const secondLock = await acquireLock(secondPath);
    try {
      let fromDoc;
      try { fromDoc = await fs.readJson(fromFile); } catch { fromDoc = { tasks: [] }; }
      fromDoc.tasks = fromDoc.tasks || [];
      const idx = fromDoc.tasks.findIndex((t) => t.id === taskId);
      if (idx === -1) throw Object.assign(new Error(`Task "${taskId}" not found in ${fromFile}`), { code: 'TASK_NOT_FOUND' });
      let [task] = fromDoc.tasks.splice(idx, 1);

      const transformed = await transform?.(task);
      if (transformed !== undefined) task = transformed;

      let toDoc;
      try { toDoc = await fs.readJson(toFile); } catch { toDoc = { tasks: [] }; }
      toDoc.tasks = toDoc.tasks || [];
      toDoc.tasks.push(task);

      // toFile first — see the "left in both, not neither" note above.
      await fs.writeJson(toFile, toDoc, { spaces: 2 });
      await fs.writeJson(fromFile, fromDoc, { spaces: 2 });
      return task;
    } finally {
      await secondLock.release();
    }
  } finally {
    await firstLock.release();
  }
}

/**
 * Scans every inbox for a task ID present in more than one — the exact
 * signature a `moveTask` reassignment leaves behind if the process dies
 * between its two writes (see above). Read-only: reports what it finds,
 * changes nothing. Deciding which copy is authoritative and removing the
 * other(s) is a human call, same as every other destructive action in
 * this tool.
 *
 * `master.json` and `queue.json` are both deliberately excluded. Every
 * task gets an entry in each at creation and it's never pruned back out
 * as the task is later assigned/reassigned/completed — they're permanent
 * trackers-of-record, not part of the "held by at most one agent at a
 * time" invariant `moveTask` enforces. Including either would flag most
 * ordinary assigned tasks as false positives, not just real interrupted
 * moves.
 */
export async function reconcileDuplicateTasks(config) {
  const files = [
    '.claude-team/tasks/orchestrator-inbox.json',
    ...(config.agents || []).map((a) => `.claude-team/tasks/${a.name}-inbox.json`),
  ];

  const locationsById = new Map(); // taskId -> [{ file, title }]
  for (const file of files) {
    let doc;
    try { doc = await fs.readJson(file); } catch { continue; }
    for (const task of doc.tasks || []) {
      if (!task?.id) continue;
      const entry = locationsById.get(task.id) || [];
      entry.push({ file, title: task.title });
      locationsById.set(task.id, entry);
    }
  }

  const duplicates = [];
  for (const [taskId, locations] of locationsById) {
    if (locations.length > 1) {
      duplicates.push({ taskId, title: locations[0].title, files: locations.map((l) => l.file) });
    }
  }
  return duplicates;
}
