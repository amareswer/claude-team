import chalk from "chalk";
import crypto from "crypto";
import fs from "fs-extra";
import path from "path";
import { spawn, execFile } from "child_process";
import { promisify } from "util";
import { requireConfig, CONFIG_PATH } from "./config.js";
import { updateJson, updateJsonIfExists } from "./jsonStore.js";

const run = promisify(execFile);

// Acceptance checks. Tasks reference named checks defined in config.checks:
//   checks: { unit: { command: "npm test", timeoutSeconds: 120, cwd?: "." } }
//   task:   { acceptanceCriteria: ["…"], checks: ["unit"], workingDir?: "." }
//
// Trust model (a workflow safeguard, not enforced identity — same-user processes
// can still edit these files): a HUMAN approves each definition (`claude-team checks approve`,
// interactive terminal only). The approval stores a hash of the definition in
// config.checksApproved, so a new or edited command is refused until approved
// again. The CLI is the only execution engine; agents and the Office only call
// it. A passing check records evidence — it NEVER changes a task's status:
// "checks passed", "review pending" and "approved" are separate facts.
//
// Note: this is a file-based tool, so the approval hash protects against
// accidental or agent-edited commands, not against someone with write access
// to .claude-team/config.json who also rewrites the hash.

const MAX_LOG_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_S = 120;
const RESULTS_DIR = ".claude-team/checks";

export function definitionHash(def) {
  return crypto.createHash("sha256")
    .update(JSON.stringify({ command: def.command, timeoutSeconds: def.timeoutSeconds ?? null, cwd: def.cwd ?? null }))
    .digest("hex");
}

export function approvalState(config, name) {
  const def = config.checks?.[name];
  if (!def || typeof def.command !== "string" || !def.command.trim()) return "undefined";
  const approved = config.checksApproved?.[name];
  if (!approved) return "unapproved";
  return approved.hash === definitionHash(def) ? "approved" : "changed";
}

/** Human-only: record approval of the current definition of `name`. */
export async function approveCheck(name) {
  const latest = await updateJsonIfExists(CONFIG_PATH, (doc) => {
    const def = doc.checks?.[name];
    if (!def?.command) throw new Error(`No check named "${name}" in config.checks`);
    doc.checksApproved = { ...(doc.checksApproved || {}), [name]: { hash: definitionHash(def), approvedAt: new Date().toISOString() } };
  });
  if (!latest) throw new Error("No claude-team config found. Run `claude-team init` first.");
  return latest.checksApproved[name];
}

// ── Code state: git revision + a fingerprint of everything uncommitted ──────

async function git(args, cwd) {
  try { return (await run("git", args, { cwd, maxBuffer: 64 * 1024 * 1024 })).stdout; } catch { return null; }
}

/** HEAD commit of the work tree at `cwd`, or null (not a repo / no commits). */
export async function headRevision(cwd = ".") {
  return (await git(["rev-parse", "--verify", "-q", "HEAD"], cwd))?.trim() || null;
}

/** Returns { revision, dirty, fingerprint } or null outside a git work tree. */
export async function codeState(cwd) {
  if ((await git(["rev-parse", "--is-inside-work-tree"], cwd))?.trim() !== "true") return null;
  const excl = ["--", ".", ":(exclude).claude-team"];
  const revision = (await git(["rev-parse", "HEAD"], cwd))?.trim() || null; // null in a repo with no commits
  const diff = (await git(["diff", ...(revision ? ["HEAD"] : []), ...excl], cwd)) || "";
  const untracked = ((await git(["ls-files", "-o", "--exclude-standard", "-z", ...excl], cwd)) || "").split("\0").filter(Boolean).sort();
  const h = crypto.createHash("sha256").update(revision || "").update("\0").update(diff);
  for (const f of untracked) {
    h.update("\0" + f + "\0");
    try {
      const abs = path.join(cwd, f);
      const st = await fs.stat(abs);
      h.update(st.size > 4 * 1024 * 1024 ? `big:${st.size}:${st.mtimeMs}` : await fs.readFile(abs));
    } catch { /* vanished — name alone still changes the hash */ }
  }
  return { revision, dirty: diff.length > 0 || untracked.length > 0, fingerprint: h.digest("hex") };
}

// ── Running ────────────────────────────────────────────────────────────────

function resolveCwd(root, rel) {
  const base = fs.realpathSync(root);
  const target = fs.realpathSync(path.resolve(base, rel || "."));
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new Error(`Working directory "${rel}" is outside the project`);
  }
  return target;
}

function execCommand(command, cwd, timeoutMs) {
  return new Promise((resolve) => {
    const startedAt = new Date();
    const chunks = [];
    let size = 0;
    let truncated = false;
    const child = spawn(command, { cwd, shell: true, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
    const onData = (d) => {
      chunks.push(d); size += d.length;
      // keep only the tail: drop whole chunks from the front once over budget
      while (size > MAX_LOG_BYTES * 2 && chunks.length > 1) { size -= chunks.shift().length; truncated = true; }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    let timedOut = false;
    let done = false;
    // Kill the whole process tree: with shell:true the child is the shell, and
    // killing only it leaves the real command running with our pipes open.
    const killTree = () => {
      try {
        if (process.platform === "win32") spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" }).on("error", () => {});
        else process.kill(-child.pid, "SIGKILL");
      } catch {}
    };
    let giveUp;
    const timer = setTimeout(() => {
      timedOut = true;
      killTree();
      // Never hang on pipes a stubborn grandchild keeps open.
      giveUp = setTimeout(() => { child.stdout.destroy(); child.stderr.destroy(); finish(null, null); }, 2000);
    }, timeoutMs);
    const finish = (exitCode, signal, error) => {
      if (done) return;
      done = true;
      clearTimeout(timer); clearTimeout(giveUp);
      let out = Buffer.concat(chunks).toString("utf8");
      if (out.length > MAX_LOG_BYTES) { out = out.slice(-MAX_LOG_BYTES); truncated = true; }
      resolve({
        startedAt: startedAt.toISOString(), finishedAt: new Date().toISOString(), durationMs: Date.now() - startedAt.getTime(),
        exitCode, signal: signal || null, timedOut, spawnError: error || null, truncated, outputTail: out,
      });
    };
    child.on("error", (e) => finish(null, null, e.message));
    child.on("close", (code, signal) => finish(code, signal));
  });
}

const resultsFile = (root, taskId) => path.join(root, RESULTS_DIR, `${taskId}.json`);

export async function findTask(root, taskId) {
  const master = await fs.readJson(path.join(root, ".claude-team/tasks/master.json"));
  const task = (master.tasks || []).find((t) => t.id === taskId);
  if (!task) throw Object.assign(new Error(`No task "${taskId}" in master.json`), { code: "TASK_NOT_FOUND" });
  return task;
}

/**
 * Runs every check named on the task. Returns the per-check records. Refuses
 * (throws) if any referenced check is undefined or not currently approved —
 * before running anything, so a task is never partly checked by accident.
 */
export async function runTaskChecks(config, taskId, { root = "." } = {}) {
  const task = await findTask(root, taskId);
  const names = task.checks || [];
  if (!names.length) throw new Error(`Task ${taskId} has no checks listed`);
  const problems = names
    .map((n) => [n, approvalState(config, n)])
    .filter(([, s]) => s !== "approved")
    .map(([n, s]) => `  ${n}: ${s === "undefined" ? "not defined in config.checks" : s === "changed" ? "definition changed since approval" : "not approved"}`);
  if (problems.length) {
    throw Object.assign(new Error(`Refusing to run — these checks need human approval (claude-team checks approve <name>):\n${problems.join("\n")}`), { code: "NOT_APPROVED" });
  }
  const cwd = resolveCwd(root, task.workingDir);
  const state = await codeState(cwd);
  const records = [];
  for (const name of names) {
    const def = config.checks[name];
    const checkCwd = def.cwd ? resolveCwd(cwd, def.cwd) : cwd;
    const res = await execCommand(def.command, checkCwd, (def.timeoutSeconds ?? DEFAULT_TIMEOUT_S) * 1000);
    records.push({
      check: name, command: def.command, definitionHash: definitionHash(def), cwd: path.relative(fs.realpathSync(root), checkCwd) || ".",
      ...res, passed: res.exitCode === 0 && !res.timedOut && !res.spawnError,
      revision: state?.revision ?? null, dirty: state?.dirty ?? null, fingerprint: state?.fingerprint ?? null,
    });
  }
  await updateJson(resultsFile(root, taskId), (doc) => {
    doc.taskId = taskId;
    doc.latest = { ...(doc.latest || {}) };
    doc.history = doc.history || [];
    for (const r of records) {
      doc.latest[r.check] = r;
      doc.history.push({ check: r.check, finishedAt: r.finishedAt, exitCode: r.exitCode, passed: r.passed, revision: r.revision, dirty: r.dirty });
    }
    doc.history = doc.history.slice(-100);
  }, () => ({ taskId, latest: {}, history: [] }));
  return records;
}

/**
 * Current evidence for a task: per check one of passed | failed | stale |
 * not_run | unapproved. `stale` = it passed/failed against different code
 * than what is in the working tree now, or its definition has changed.
 * `overall`: passed (all passed & fresh) | failed | stale | not_run | none.
 */
export async function taskCheckStatus(config, task, { root = "." } = {}) {
  const names = task.checks || [];
  if (!names.length) return { overall: "none", checks: [] };
  let saved = null;
  try { saved = await fs.readJson(resultsFile(root, task.id)); } catch (e) { if (e.code !== "ENOENT") throw e; }
  let current = null;
  try { current = await codeState(resolveCwd(root, task.workingDir)); } catch {}
  const checks = names.map((name) => {
    const approval = approvalState(config, name);
    const r = saved?.latest?.[name];
    if (!r) return { name, state: approval === "approved" ? "not_run" : "unapproved", approval };
    const defChanged = approval === "undefined" || r.definitionHash !== definitionHash(config.checks[name] || {});
    const codeChanged = r.fingerprint != null && current && r.fingerprint !== current.fingerprint;
    const state = defChanged || codeChanged ? "stale" : r.passed ? "passed" : "failed";
    return { name, state, approval, finishedAt: r.finishedAt, exitCode: r.exitCode, timedOut: r.timedOut, revision: r.revision, dirty: r.dirty };
  });
  const states = checks.map((c) => c.state);
  const overall = states.every((s) => s === "passed") ? "passed"
    : states.includes("failed") ? "failed"
    : states.includes("stale") ? "stale"
    : "not_run";
  return { overall, checks };
}

// ── CLI ────────────────────────────────────────────────────────────────────

const ICON = { passed: "✅", failed: "❌", stale: "♻️ ", not_run: "⏳", unapproved: "🔒" };

export async function runCheckCommand(taskId) {
  let config;
  try { config = await requireConfig(); } catch (e) { console.error(chalk.red(e.message)); process.exit(1); }
  try {
    const records = await runTaskChecks(config, taskId);
    console.log();
    for (const r of records) {
      const why = r.timedOut ? "timed out" : r.spawnError ? `could not start: ${r.spawnError}` : `exit ${r.exitCode}`;
      console.log(`  ${r.passed ? "✅" : "❌"} ${chalk.white.bold(r.check)}  ${chalk.dim(r.command)}  ${chalk.dim(`(${why}, ${(r.durationMs / 1000).toFixed(1)}s)`)}`);
      if (!r.passed) console.log(chalk.dim(r.outputTail.split("\n").slice(-15).map((l) => "     " + l).join("\n")));
    }
    console.log(chalk.dim("\n  Results saved to " + resultsFile(".", taskId) + ". Task status is unchanged — review is a separate step.\n"));
    process.exitCode = records.every((r) => r.passed) ? 0 : 1;
  } catch (e) {
    console.error(chalk.red(`\n  ${e.message}\n`));
    process.exit(e.code === "NOT_APPROVED" ? 3 : 2);
  }
}

export async function runChecksList() {
  let config;
  try { config = await requireConfig(); } catch (e) { console.error(chalk.red(e.message)); process.exit(1); }
  const names = Object.keys(config.checks || {});
  console.log();
  if (!names.length) {
    console.log(chalk.dim('  No checks defined. Add to .claude-team/config.json, e.g. "checks": { "unit": { "command": "npm test", "timeoutSeconds": 120 } }, then run `claude-team checks approve unit`.\n'));
    return;
  }
  for (const n of names) {
    const s = approvalState(config, n);
    const tag = s === "approved" ? chalk.green("approved") : chalk.yellow(s === "changed" ? "CHANGED — re-approve" : "needs approval");
    console.log(`  ${chalk.white.bold(n.padEnd(14))} ${tag.padEnd(24)} ${chalk.dim(config.checks[n].command)}`);
  }
  console.log();
}

export async function runChecksApprove(name) {
  let config;
  try { config = await requireConfig(); } catch (e) { console.error(chalk.red(e.message)); process.exit(1); }
  const def = config.checks?.[name];
  if (!def?.command) { console.error(chalk.red(`\n  No check named "${name}".\n`)); process.exit(1); }
  // Approval must come from a person at a terminal — an agent's Bash tool has
  // no TTY, so it cannot approve its own (or a modified) command.
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error(chalk.red("\n  Approval needs an interactive terminal. Run this yourself, not from an agent session.\n"));
    process.exit(1);
  }
  const { default: inquirer } = await import("inquirer");
  console.log(`\n  ${chalk.white.bold(name)} will run this command in the project (timeout ${def.timeoutSeconds ?? DEFAULT_TIMEOUT_S}s):\n\n    ${chalk.yellow(def.command)}\n`);
  const { ok } = await inquirer.prompt([{ type: "confirm", name: "ok", message: "Approve this exact command?", default: false }]);
  if (!ok) { console.log(chalk.dim("\n  Not approved.\n")); return; }
  await approveCheck(name);
  console.log(chalk.green(`\n  ✓ "${name}" approved.\n`));
}

export { ICON as CHECK_ICON };
