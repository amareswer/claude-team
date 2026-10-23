// Second opinion on a finished task from the Codex CLI. Read-only: Codex gets the task, its
// acceptance criteria and the diff, and writes a markdown note into .claude-team/reviews/,
// which `review show` already lists as a peer review. It never approves anything.
import chalk from "chalk";
import fs from "fs-extra";
import path from "path";
import { execFile } from "child_process";
import { requireConfig } from "./config.js";
import { reviewDetail } from "./review.js";

const REVIEW_DIR = ".claude-team/reviews";

export function buildCodexPrompt(d) {
  const criteria = d.acceptanceCriteria?.length ? d.acceptanceCriteria.map((c) => `- ${c}`).join("\n") : "(none listed)";
  const diff = d.diff?.error ? `(diff unavailable: ${d.diff.error})` : d.diff?.patch || "(no tracked changes)";
  const extra = d.diff?.truncated ? `\n(diff truncated: ${d.diff.totalLines} lines in total)` : "";
  return [
    "You are a second reviewer on a small software team. Review the change below. Do not edit files.",
    "Report only real problems: bugs, missed acceptance criteria, missing tests, privacy or security issues, scope creep.",
    "For each: file, what is wrong, how it fails. Then one line: SAFE TO MERGE or CHANGES NEEDED. If nothing is wrong, say so briefly.",
    "",
    `Task ${d.taskId}: ${d.title}`,
    `Agent's summary: ${d.summary || "(none)"}`,
    "Acceptance criteria:",
    criteria,
    "",
    "Diff:",
    diff + extra,
  ].join("\n");
}

function runCodex(prompt, cwd) {
  return new Promise((resolve, reject) => {
    const child = execFile("codex", ["exec", "--sandbox", "read-only", "--ephemeral", "--skip-git-repo-check", "--color", "never", "-C", cwd, "-"],
      { maxBuffer: 16 * 1024 * 1024, timeout: 10 * 60 * 1000 },
      (err, stdout, stderr) => (err ? reject(Object.assign(err, { stderr })) : resolve(stdout)));
    child.stdin.end(prompt);
  });
}

/** Writes .claude-team/reviews/<taskId>-codex.md and returns its path. `run` is injectable for tests. */
export async function codexReview(config, taskId, { root = ".", lines = 1500, run = runCodex } = {}) {
  const d = await reviewDetail(config, taskId, { root, maxDiffLines: lines });
  const out = (await run(buildCodexPrompt(d), path.resolve(root))).trim();
  if (!out) throw new Error("Codex returned no review text");
  const file = path.join(root, REVIEW_DIR, `${taskId}-codex.md`);
  await fs.ensureDir(path.dirname(file));
  await fs.writeFile(file, `# Codex review of ${taskId}\n\nSecond opinion only; the human decides.\n\n${out}\n`);
  return file;
}

export async function runCodexReview(taskId, opts = {}) {
  try {
    const config = await requireConfig();
    console.log(chalk.dim("\n  Sending this task's diff to the Codex CLI (read-only)…"));
    const file = await codexReview(config, taskId, { lines: opts.lines ? Number(opts.lines) : 1500 });
    console.log(chalk.green(`\n  ✓ Codex review saved: ${file}\n`));
  } catch (e) {
    console.error(chalk.red(`\n  ✗ ${e.message}${e.stderr ? `\n${String(e.stderr).slice(0, 400)}` : ""}\n`));
    process.exitCode = 1;
  }
}
