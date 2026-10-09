import chalk from "chalk";
import fs from "fs-extra";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { requireConfig } from "./config.js";
import { reconcileDuplicateTasks } from "./jsonStore.js";
import { parseOpenQuestions } from "./questions.js";
import { taskCheckStatus } from "./checks.js";

const run = promisify(execFile);

async function readJsonSafe(file) {
  try { return { doc: await fs.readJson(file) }; }
  catch (err) {
    if (err.code === "ENOENT") return { doc: null };
    return { doc: null, error: `${file}: ${err.message}` }; // surfaced, not hidden
  }
}

async function git(args, cwd) {
  try { return (await run("git", args, { cwd })).stdout.trim(); } catch { return null; }
}

const ts = (v) => { const t = Date.parse(v); return Number.isNaN(t) ? 0 : t; };

/**
 * Builds the "where did I leave off" picture purely from files already on
 * disk (task files, status files, HUMAN_INPUT.md, git) — no agent session,
 * no tokens. Returns plain data; `renderResume` formats it. `root` defaults
 * to the current directory.
 */
export async function buildResume(config, { root = ".", now = Date.now() } = {}) {
  const t = (...p) => path.join(root, ".claude-team", ...p);
  const problems = [];
  const note = (r) => { if (r.error) problems.push(r.error); return r.doc; };

  // Agents: status files
  const agents = [];
  for (const a of config.agents || []) {
    const st = note(await readJsonSafe(t("tasks", `${a.name}-status.json`)));
    agents.push({
      name: a.name, role: a.role,
      status: st?.status || "unknown",
      currentTaskTitle: st?.currentTaskTitle || null,
      blockedReason: st?.blockedReason || null,
      lastUpdated: st?.lastUpdated || null,
    });
  }

  // Tasks
  const master = note(await readJsonSafe(t("tasks", "master.json")));
  const tasks = master?.tasks || [];
  const byStatus = (...s) => tasks.filter((x) => s.includes(x.status));
  const inProgress = byStatus("in_progress", "assigned");
  const queued = byStatus("queued", "not_started");
  const unassigned = queued.filter((x) => !x.assignedTo || x.assignedTo === "unassigned");
  const blockedTasks = byStatus("blocked", "paused");
  const reviewTasks = byStatus("review", "review_needed");

  // Recent completions from outboxes, newest first
  const completions = [];
  for (const a of [...(config.agents || []).map((x) => x.name)]) {
    const ob = note(await readJsonSafe(t("tasks", `${a}-outbox.json`)));
    for (const c of ob?.completedTasks || []) completions.push({ agent: a, ...c });
  }
  completions.sort((x, y) => ts(y.completedAt) - ts(x.completedAt));

  // Questions waiting on the human
  let questions = [];
  try { questions = parseOpenQuestions(await fs.readFile(t("HUMAN_INPUT.md"), "utf8")).filter((q) => !q.answered); }
  catch (err) { if (err.code !== "ENOENT") problems.push(`HUMAN_INPUT.md: ${err.message}`); }

  // Saved acceptance-check evidence for unfinished tasks that declare checks.
  // "Checks passed" is reported separately from review/approval — it never
  // implies the task is accepted.
  const checkRows = [];
  for (const x of tasks.filter((x) => (x.checks || []).length && !["done", "cancelled"].includes(x.status))) {
    try {
      const st = await taskCheckStatus(config, x, { root });
      checkRows.push({ taskId: x.id, title: x.title, status: x.status, overall: st.overall, checks: st.checks });
    } catch (err) { problems.push(`checks for ${x.id}: ${err.message}`); }
  }

  const duplicates = await reconcileDuplicateTasks(config).catch(() => []);

  // Last activity = newest of status updates and completions
  const stamps = [...agents.map((a) => ts(a.lastUpdated)), ...completions.map((c) => ts(c.completedAt))].filter(Boolean);
  const lastActivity = stamps.length ? new Date(Math.max(...stamps)).toISOString() : null;

  // Git: what changed in the working tree and recently
  let gitInfo = null;
  if ((await git(["rev-parse", "--is-inside-work-tree"], root)) === "true") {
    const porcelain = (await git(["status", "--porcelain", "--", ".", ":(exclude).claude-team"], root)) || "";
    const log = (await git(["log", "-n", "5", "--pretty=format:%h\t%cI\t%s"], root)) || "";
    gitInfo = {
      uncommitted: porcelain ? porcelain.split("\n").length : 0,
      recentCommits: log ? log.split("\n").map((l) => { const [hash, date, subject] = l.split("\t"); return { hash, date, subject }; }) : [],
    };
  }

  // Needs-attention list, ordered by how much it blocks progress
  const blockedAgents = agents.filter((a) => ["blocked", "paused"].includes(a.status));
  const reviewAgents = agents.filter((a) => a.status === "review_needed");
  const next = [];
  for (const q of questions) next.push({ kind: "question", text: `Answer ${q.id} (${q.priority}, from ${q.from}): ${q.question}`, blocking: /block/i.test(q.priority) && !/non-?block/i.test(q.priority) });
  for (const a of blockedAgents) next.push({ kind: "blocked", text: `Unblock ${a.name}${a.blockedReason ? ` — ${a.blockedReason}` : ` (${a.status})`}` });
  for (const x of blockedTasks) next.push({ kind: "blocked", text: `Task ${x.id} "${x.title}" is ${x.status}` });
  for (const c of checkRows.filter((c) => c.overall === "failed")) next.push({ kind: "checks", text: `Checks failing on ${c.taskId} "${c.title}": ${c.checks.filter((k) => k.state === "failed").map((k) => k.name).join(", ")}` });
  for (const c of checkRows.filter((c) => c.status === "review" || c.status === "review_needed")) {
    if (["stale", "not_run"].includes(c.overall)) next.push({ kind: "checks", text: `Run \`claude-team check ${c.taskId}\` — ${c.overall === "stale" ? "results are stale (code changed since)" : "no results yet"}` });
  }
  for (const a of reviewAgents) next.push({ kind: "review", text: `Review ${a.name}'s work${a.currentTaskTitle ? ` on "${a.currentTaskTitle}"` : ""}` });
  for (const x of reviewTasks) next.push({ kind: "review", text: `Review task ${x.id} "${x.title}"` });
  if (duplicates.length) next.push({ kind: "repair", text: `Resolve ${duplicates.length} duplicated task(s): ${duplicates.map((d) => d.taskId).join(", ")}` });
  if (unassigned.length) next.push({ kind: "assign", text: `Assign ${unassigned.length} queued task(s) — start the orchestrator or use the Office task board` });
  if (!next.length && inProgress.length) next.push({ kind: "wait", text: `${inProgress.length} task(s) in progress — nothing needs you right now` });
  if (!next.length) next.push({ kind: "idle", text: "Nothing pending. Add a task from the Office or via the orchestrator." });

  return {
    project: config.projectName,
    goal: config.projectGoal,
    generatedAt: new Date(now).toISOString(),
    lastActivity,
    counts: { total: tasks.length, done: byStatus("done").length, inProgress: inProgress.length, queued: queued.length, blocked: blockedTasks.length },
    agents, inProgress, checks: checkRows, completions: completions.slice(0, 5), questions, duplicates, git: gitInfo, next, problems,
  };
}

function ago(iso, now) {
  if (!iso) return "never";
  const m = Math.max(0, Math.round((now - Date.parse(iso)) / 60000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} days ago`;
}

export function renderResume(r) {
  const now = Date.parse(r.generatedAt);
  const out = [];
  out.push("", chalk.cyan.bold(`  ▶ ${r.project} — pick up where you left off`));
  if (r.goal) out.push(chalk.dim(`    ${r.goal}`));
  out.push(chalk.dim(`    Last activity: ${ago(r.lastActivity, now)}`), "");

  const c = r.counts;
  out.push(`  ${chalk.white.bold("Tasks")}  ${c.done}/${c.total} done · ${c.inProgress} in progress · ${c.queued} queued${c.blocked ? chalk.red(` · ${c.blocked} blocked`) : ""}`, "");

  if (r.completions.length) {
    out.push(chalk.white.bold("  Recently finished"));
    for (const x of r.completions) out.push(`   ✅ ${chalk.cyan(x.agent)}  ${x.title || x.id}${x.completedAt ? chalk.dim(`  (${ago(x.completedAt, now)})`) : ""}`);
    out.push("");
  }
  if (r.inProgress.length) {
    out.push(chalk.white.bold("  In progress"));
    for (const x of r.inProgress) out.push(`   ⚡ ${x.title || x.id}${x.assignedTo ? chalk.dim(`  → ${x.assignedTo}`) : ""}`);
    out.push("");
  }
  const attention = r.agents.filter((a) => ["blocked", "paused", "review_needed"].includes(a.status));
  if (attention.length) {
    out.push(chalk.white.bold("  Agents needing attention"));
    for (const a of attention) out.push(`   ${a.status === "review_needed" ? "👀" : "🚧"} ${chalk.cyan(a.name)}  ${a.status}${a.blockedReason ? chalk.dim(` — ${a.blockedReason}`) : ""}`);
    out.push("");
  }
  if (r.checks.length) {
    const icon = { passed: "✅", failed: "❌", stale: "♻️ ", not_run: "⏳", unapproved: "🔒" };
    out.push(chalk.white.bold("  Acceptance checks") + chalk.dim("  (evidence only — not review or approval)"));
    for (const c of r.checks) {
      out.push(`   ${icon[c.overall] || "•"} ${c.taskId} ${chalk.dim(c.title || "")}  ${c.checks.map((k) => `${k.name}:${k.state}`).join(", ")}`);
    }
    out.push("");
  }
  if (r.git) {
    out.push(chalk.white.bold("  Code"));
    out.push(`   ${r.git.uncommitted ? chalk.yellow(`${r.git.uncommitted} uncommitted change(s)`) : chalk.green("working tree clean")}`);
    for (const g of r.git.recentCommits.slice(0, 3)) out.push(chalk.dim(`   ${g.hash}  ${g.subject}`));
    out.push("");
  }
  out.push(chalk.white.bold("  Suggested next steps"));
  r.next.forEach((n, i) => out.push(`   ${i + 1}. ${n.blocking ? chalk.red("[blocking] ") : ""}${n.text}`));
  if (r.problems.length) {
    out.push("", chalk.red.bold("  ⚠ Unreadable state files (not summarised — fix or restore these):"));
    for (const p of r.problems) out.push(chalk.red(`   ${p}`));
  }
  out.push("");
  return out.join("\n");
}

export async function runResume(options = {}) {
  let config;
  try { config = await requireConfig(); }
  catch (e) { console.error(chalk.red(e.message)); process.exit(1); }
  const r = await buildResume(config);
  if (options.json) console.log(JSON.stringify(r, null, 2));
  else console.log(renderResume(r));
}
