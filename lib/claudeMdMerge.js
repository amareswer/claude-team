import fs from "fs-extra";

// claude-team owns only the block between these markers in CLAUDE.md; any
// instructions the user already had are preserved around it.
const START = "<!-- claude-team:start -->";
const END = "<!-- claude-team:end -->";

export function mergeClaudeMd(existing, generated) {
  const block = `${START}\n${generated.trimEnd()}\n${END}\n`;
  if (existing == null || existing.trim() === "") return block;
  const s = existing.indexOf(START);
  const e = existing.indexOf(END);
  if (s !== -1 && e > s) {
    return existing.slice(0, s) + block + existing.slice(e + END.length).replace(/^\n/, "");
  }
  return `${existing.trimEnd()}\n\n${block}`;
}

export async function writeClaudeMd(generated, file = "CLAUDE.md") {
  let existing = null;
  try { existing = await fs.readFile(file, "utf8"); } catch (err) { if (err.code !== "ENOENT") throw err; }
  await fs.writeFile(file, mergeClaudeMd(existing, generated));
  return existing != null;
}
