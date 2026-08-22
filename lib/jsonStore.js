import fs from "fs-extra";
import { withLock } from "./lock.js";

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
