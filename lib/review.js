import chalk from "chalk";
import fs from "fs-extra";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import crypto from "crypto";
import { requireConfig } from "./config.js";
import { updateJson, updateJsonIfExists } from "./jsonStore.js";
import { codeState, taskCheckStatus, findTask } from "./checks.js";

const run = promisify(execFile);

// Human review queue. The lifecycle is deliberately separate from check
// results (see lib/checks.js):
//
//   agent/orchestrator:  review request  → task status "review", state "pending"
//   human:               review approve  → state "approved", task status "done"
//                        review reject   → state "rejected", task back to "assigned",
//                                          feedback delivered to the assignee's inbox
//
// A request snapshots what the reviewer needs together — agent explanation,
// files, criteria, check evidence, code fingerprint. Approve/reject are
// human decisions: the CLI requires an interactive terminal, which stops
// accidental or scripted approval. That is a workflow safeguard, not proof of
// identity — agents run as the same OS user and could edit these files. Passing checks never approve anything.

const DIR = ".claude-team/review-queue";
const SAFE_ID = /^[A-Za-z0-9._-]+$/;
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"; // git's well-known empty tree
const PEER_DIR = ".claude-team/reviews"; // markdown peer reviews written by editor/agents

function assertId(taskId) {
  if (!SAFE_ID.test(String(taskId || ""))) throw Object.assign(new Error(`Invalid task id "${taskId}"`), { statusCode: 400 });
}
const fileFor = (root, taskId) => path.join(root, DIR, `${taskId}.json`);

async function git(args, cwd, max = 64 * 1024 * 1024) {
  try { return (await run("git", args, { cwd, maxBuffer: max })).stdout; } catch { return null; }
}

async function setTaskStatus(root, taskId, status) {
  for (const f of ["master.json", "queue.json"]) {
    await updateJsonIfExists(path.join(root, ".claude-team/tasks", f), (doc) => {
      const t = (doc.tasks || []).find((x) => x.id === taskId);
      if (!t) return false;
      t.status = status;
      if ("lastUpdated" in doc) doc.lastUpdated = new Date().toISOString();
    });
  }
}

async function latestOutboxEntry(config, root, task) {
  let best = null;
  const names = [...(config.agents || []).map((a) => a.name)];
  for (const n of names) {
    let ob;
    try { ob = await fs.readJson(path.join(root, ".claude-team/tasks", `${n}-outbox.json`)); } catch (e) { if (e.code === "ENOENT") continue; throw e; }
    for (const c of ob.completedTasks || []) {
      if (c.id === task.id && (!best || String(c.completedAt) > String(best.completedAt))) best = { agent: n, ...c };
    }
  }
  return best;
}

/**
 * Which revision should the reviewer's diff start from? Comparing against
 * current HEAD hides work the agent already committed, so in order:
 *   1. an explicit --base,
 *   2. task.baseRevision, recorded when the Office assigned the task,
 *   3. the last commit before the task was assigned (from assignedAt in the
 *      assignee's inbox / task.assignedAt / task.createdAt) — inferred,
 *   4. HEAD, if nothing says when work started.
 * `source` is kept on the record so the reviewer can see how it was chosen.
 */
async function resolveBase(cwd, root, task, explicit) {
  if (explicit) return { rev: explicit, source: "explicit" };
  if ((await git(["rev-parse", "--is-inside-work-tree"], cwd))?.trim() !== "true") return { rev: null, source: null };
  if (task.baseRevision) return { rev: task.baseRevision, source: "recorded at assignment" };
  let ts = task.assignedAt || null;
  if (task.assignedTo) {
    try {
      const inbox = await fs.readJson(path.join(root, ".claude-team/tasks", `${task.assignedTo}-inbox.json`));
      ts = (inbox.tasks || []).find((x) => x.id === task.id)?.assignedAt || ts;
    } catch (e) { if (e.code !== "ENOENT") throw e; }
  }
  ts = ts || task.createdAt;
  if (ts && !Number.isNaN(Date.parse(ts))) {
    const before = (await git(["rev-list", "-1", `--before=${new Date(ts).toISOString()}`, "HEAD"], cwd))?.trim();
    if (before) return { rev: before, source: "inferred from assignment time" };
    if ((await git(["rev-parse", "--verify", "-q", "HEAD"], cwd))?.trim()) return { rev: EMPTY_TREE, source: "inferred (no commits before assignment)" };
  }
  return { rev: null, source: "HEAD (no start time recorded)" };
}

/** Agent/orchestrator action: put a task in front of the human. */
export async function requestReview(config, taskId, { summary, baseRevision, requestedBy = "agent", root = "." } = {}) {
  assertId(taskId);
  const task = await findTask(root, taskId);
  if (["done", "cancelled"].includes(task.status)) throw Object.assign(new Error(`Task ${taskId} is already ${task.status}`), { statusCode: 400 });
  const cwd = path.resolve(root, task.workingDir || ".");
  const state = await codeState(cwd);
  const checks = (task.checks || []).length ? await taskCheckStatus(config, task, { root }) : null;
  const outbox = await latestOutboxEntry(config, root, task);
  const base = await resolveBase(cwd, root, task, baseRevision);
  const now = new Date().toISOString();
  const record = await updateJson(fileFor(root, taskId), (doc) => {
    const prior = doc.state ? { state: doc.state, requestedAt: doc.requestedAt, decision: doc.decision } : null;
    doc.history = [...(doc.history || []), ...(prior ? [prior] : [])].slice(-20);
    Object.assign(doc, {
      taskId, title: task.title, assignedTo: task.assignedTo || null, state: "pending",
      requestId: crypto.randomUUID(), // identifies THIS request; decisions are bound to it
      requestedAt: now, requestedBy,
      summary: (summary || outbox?.summary || "").trim() || null,
      agentNotes: outbox?.notes || null,
      filesChanged: outbox?.filesChanged || [],
      acceptanceCriteria: task.acceptanceCriteria || [],
      baseRevision: base.rev, baseSource: base.source,
      requested: { revision: state?.revision ?? null, dirty: state?.dirty ?? null, fingerprint: state?.fingerprint ?? null, checks: checks?.overall ?? "none" },
      decision: null,
    });
  }, () => ({}));
  await setTaskStatus(root, taskId, "review");
  return record;
}

/** Live view of one review: record + whether code/checks moved since the request. */
async function enrich(config, rec, root) {
  let task = null;
  try { task = await findTask(root, rec.taskId); } catch {}
  const cwd = path.resolve(root, task?.workingDir || ".");
  const cur = await codeState(cwd).catch(() => null);
  const checks = task && (task.checks || []).length ? await taskCheckStatus(config, task, { root }).catch(() => ({ overall: "error", checks: [] })) : { overall: "none", checks: [] };
  const ref = rec.state === "approved" ? rec.decision?.fingerprint : rec.requested?.fingerprint;
  return { ...rec, live: { checks, codeChanged: !!(cur && ref && cur.fingerprint !== ref), taskStatus: task?.status ?? null } };
}

export async function listReviews(config, { root = ".", state } = {}) {
  let names = [];
  try { names = (await fs.readdir(path.join(root, DIR))).filter((f) => f.endsWith(".json")); } catch (e) { if (e.code !== "ENOENT") throw e; }
  const out = [];
  for (const f of names) {
    const rec = await fs.readJson(path.join(root, DIR, f)); // corrupt file → throws, not hidden
    if (state && rec.state !== state) continue;
    out.push(await enrich(config, rec, root));
  }
  return out.sort((a, b) => String(a.requestedAt).localeCompare(String(b.requestedAt)));
}

/** Everything the reviewer should see in one place. */
export async function reviewDetail(config, taskId, { root = ".", maxDiffLines = 300 } = {}) {
  assertId(taskId);
  let rec;
  try { rec = await fs.readJson(fileFor(root, taskId)); }
  catch (e) { if (e.code === "ENOENT") throw Object.assign(new Error(`No review requested for ${taskId}`), { code: "NO_REVIEW" }); throw e; }
  const full = await enrich(config, rec, root);
  const task = await findTask(root, taskId).catch(() => null);
  const cwd = path.resolve(root, task?.workingDir || ".");
  const base = rec.baseRevision || "HEAD";
  const excl = ["--", ".", ":(exclude).claude-team"];
  let diff = null;
  if ((await git(["rev-parse", "--is-inside-work-tree"], cwd))?.trim() === "true") {
    const stat = (await git(["diff", "--stat", base, ...excl], cwd)) || "";
    const patch = (await git(["diff", base, ...excl], cwd)) || "";
    const lines = patch.split("\n");
    const untracked = ((await git(["ls-files", "-o", "--exclude-standard", "-z", ...excl], cwd)) || "").split("\0").filter(Boolean);
    let commits = [];
    if ((await git(["rev-parse", "--verify", "-q", `${base}^{commit}`], cwd))?.trim()) {
      commits = ((await git(["log", "--oneline", "-n", "30", `${base}..HEAD`], cwd)) || "").split("\n").filter(Boolean);
    } else if (base === EMPTY_TREE) {
      commits = ((await git(["log", "--oneline", "-n", "30"], cwd)) || "").split("\n").filter(Boolean);
    }
    diff = { base, baseSource: rec.baseSource || (rec.baseRevision ? "explicit" : "HEAD"), commits, stat: stat.trim(), patch: lines.slice(0, maxDiffLines).join("\n"), truncated: lines.length > maxDiffLines, totalLines: lines.length, untracked };
  }
  let peer = [];
  try { peer = (await fs.readdir(path.join(root, PEER_DIR))).filter((f) => f.endsWith(".md") && f.includes(taskId)); } catch {}
  return { ...full, diff, peerReviews: peer.map((f) => path.join(PEER_DIR, f)) };
}

const conflict = (message, code) => Object.assign(new Error(message), { code, statusCode: 409 });

// Both decisions use the same pattern: the pending/request-version check and
// the state change happen in ONE locked update of the review file, so of any
// number of simultaneous decisions exactly one wins and the rest get a 409.
// Side effects (task status, inbox message) run only for the winner, after
// that linearisation point.
async function decide(root, taskId, expectedRequestId, apply) {
  const rec = await updateJsonIfExists(fileFor(root, taskId), (doc) => {
    if (doc.state !== "pending") throw conflict(`Review of ${taskId} is ${doc.state}, not pending`, "NOT_PENDING");
    if (expectedRequestId && doc.requestId !== expectedRequestId) {
      throw conflict(`The review request for ${taskId} changed since you looked at it — reload and review the new request`, "STALE_REQUEST");
    }
    apply(doc);
  });
  if (!rec) throw Object.assign(new Error(`No review requested for ${taskId}`), { code: "NO_REVIEW", statusCode: 404 });
  return rec;
}

/**
 * Accept the work. Refuses unverified work unless explicitly allowed.
 * `expectedRequestId` binds the decision to the request the reviewer actually
 * saw (defaults to the one current when this call starts).
 */
export async function approveReview(config, taskId, { note = "", by = "human", acceptUnverified = false, expectedRequestId, root = "." } = {}) {
  assertId(taskId);
  const detail = await reviewDetail(config, taskId, { root, maxDiffLines: 0 });
  if (detail.state !== "pending") throw conflict(`Review of ${taskId} is ${detail.state}, not pending`, "NOT_PENDING");
  const overall = detail.live.checks.overall;
  if (overall !== "none" && overall !== "passed" && !acceptUnverified) {
    throw Object.assign(new Error(`Checks for ${taskId} are "${overall}" (need "passed" on the current code). Re-run \`claude-team check ${taskId}\` or approve with --accept-unverified.`), { code: "CHECKS_NOT_PASSED", statusCode: 409 });
  }
  const task = await findTask(root, taskId);
  const cur = await codeState(path.resolve(root, task.workingDir || ".")).catch(() => null);
  const decision = {
    by, at: new Date().toISOString(), note: note.trim() || null,
    revision: cur?.revision ?? null, fingerprint: cur?.fingerprint ?? null,
    checks: overall, acceptedUnverified: overall !== "none" && overall !== "passed",
    codeChangedSinceRequest: detail.live.codeChanged,
  };
  await decide(root, taskId, expectedRequestId || detail.requestId, (doc) => { doc.state = "approved"; doc.decision = decision; });
  await setTaskStatus(root, taskId, "done");
  return decision;
}

/** Send back with feedback. The assignee finds it in their inbox. */
export async function rejectReview(config, taskId, { note, by = "human", expectedRequestId, root = "." } = {}) {
  assertId(taskId);
  if (!String(note || "").trim()) throw Object.assign(new Error("A rejection needs a note explaining what to change"), { statusCode: 400 });
  const decision = { by, at: new Date().toISOString(), note: note.trim() };
  const rec = await decide(root, taskId, expectedRequestId, (doc) => { doc.state = "rejected"; doc.decision = decision; });
  await setTaskStatus(root, taskId, "assigned");
  if (rec.assignedTo) {
    await updateJson(path.join(root, ".claude-team/tasks", `${rec.assignedTo}-inbox.json`), (inbox) => {
      inbox.messages = inbox.messages || [];
      inbox.messages.push({ from: "human-review", type: "review_rejected", taskId, message: `Review of "${rec.title}" was sent back: ${decision.note}`, sentAt: decision.at });
    }, () => ({ tasks: [], messages: [] }));
  }
  return decision;
}

// ── CLI ────────────────────────────────────────────────────────────────────

const CHECK_ICON = { passed: "✅ checks passed", failed: "❌ checks failed", stale: "♻️  checks stale", not_run: "⏳ checks not run", none: "no checks", error: "⚠️  checks unreadable", unapproved: "🔒 checks unapproved" };
const ago = (iso) => { const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000)); return m < 60 ? `${m}m` : m < 2880 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`; };

async function loadConfigOrExit() {
  try { return await requireConfig(); } catch (e) { console.error(chalk.red(e.message)); process.exit(1); }
}
function fail(e) {
  console.error(chalk.red(`\n  ${e.message}\n`));
  process.exit(e.code === "CHECKS_NOT_PASSED" ? 3 : 2);
}
function requireHuman(action) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error(chalk.red(`\n  ${action} is a a decision for you to make and needs an interactive terminal (this stops accidental or scripted approvals; it is not identity enforcement). Run it yourself, not from an agent session.\n`));
    process.exit(1);
  }
}

export async function runReviewList() {
  const config = await loadConfigOrExit();
  try {
    const all = await listReviews(config);
    const pending = all.filter((r) => r.state === "pending");
    console.log();
    if (!pending.length) console.log(chalk.dim("  Nothing waiting for review.\n"));
    else {
      console.log(chalk.cyan.bold(`  👀 ${pending.length} waiting for your review\n`));
      for (const r of pending) {
        console.log(`  ${chalk.white.bold(r.taskId)}  ${r.title}  ${chalk.dim(`→ ${r.assignedTo || "?"} · requested ${ago(r.requestedAt)} ago`)}`);
        console.log(`     ${CHECK_ICON[r.live.checks.overall] || r.live.checks.overall}${r.live.codeChanged ? chalk.yellow("  · code changed since requested") : ""}`);
        if (r.summary) console.log(chalk.dim(`     ${r.summary}`));
      }
      console.log(chalk.dim("\n  Details: claude-team review show <task-id>\n"));
    }
  } catch (e) { fail(e); }
}

export async function runReviewShow(taskId, opts = {}) {
  const config = await loadConfigOrExit();
  try {
    const d = await reviewDetail(config, taskId, { maxDiffLines: opts.lines ? Number(opts.lines) : 300 });
    console.log();
    console.log(`  ${chalk.cyan.bold(d.taskId)}  ${chalk.white.bold(d.title)}   ${chalk.dim(`[${d.state}]`)}`);
    console.log(chalk.dim(`  assignee: ${d.assignedTo || "?"} · requested ${d.requestedAt} by ${d.requestedBy}`));
    console.log(chalk.white.bold("\n  Agent's explanation"));
    console.log(`  ${d.summary || chalk.dim("(none given — ask the agent or use `review request -s`)")}`);
    if (d.agentNotes) console.log(chalk.dim(`  notes: ${d.agentNotes}`));
    if (d.acceptanceCriteria.length) { console.log(chalk.white.bold("\n  Acceptance criteria")); d.acceptanceCriteria.forEach((c) => console.log(`   • ${c}`)); }
    console.log(chalk.white.bold("\n  Checks") + chalk.dim("  (evidence, not approval)"));
    console.log(`  ${CHECK_ICON[d.live.checks.overall] || d.live.checks.overall}`);
    for (const c of d.live.checks.checks || []) console.log(chalk.dim(`   ${c.name}: ${c.state}${c.exitCode != null ? ` (exit ${c.exitCode})` : ""}${c.revision ? ` @ ${c.revision.slice(0, 8)}${c.dirty ? "+dirty" : ""}` : ""}`));
    if (d.live.codeChanged) console.log(chalk.yellow("  ⚠ code has changed since this review was requested"));
    console.log(chalk.white.bold(`\n  Code changes`) + chalk.dim(d.diff ? `  (vs ${d.diff.base.slice(0, 10)} — ${d.diff.baseSource})` : ""));
    if (d.diff?.commits?.length) console.log(chalk.dim(`  commits since then (${d.diff.commits.length}${d.diff.commits.length === 30 ? "+" : ""}):\n` + d.diff.commits.map((c) => "    " + c).join("\n")));
    if (!d.diff) console.log(chalk.dim("  not a git repository — no diff available"));
    else {
      console.log(d.diff.stat ? d.diff.stat.split("\n").map((l) => "  " + l).join("\n") : chalk.dim("  no tracked changes"));
      if (d.diff.untracked.length) console.log(chalk.dim(`  new untracked files: ${d.diff.untracked.join(", ")}`));
      if (d.diff.patch.trim()) console.log("\n" + d.diff.patch.split("\n").map((l) => (l.startsWith("+") && !l.startsWith("+++") ? chalk.green(l) : l.startsWith("-") && !l.startsWith("---") ? chalk.red(l) : l)).join("\n"));
      if (d.diff.truncated) console.log(chalk.dim(`\n  … diff truncated at ${d.diff.patch.split("\n").length} of ${d.diff.totalLines} lines — run \`git diff ${d.diff.base}\` for the rest, or pass --lines <n>`));
    }
    if (d.peerReviews.length) console.log(chalk.dim(`\n  Peer review notes: ${d.peerReviews.join(", ")}`));
    if (d.decision) console.log(chalk.dim(`\n  Decision: ${d.state} by ${d.decision.by} at ${d.decision.at}${d.decision.note ? ` — ${d.decision.note}` : ""}`));
    console.log();
  } catch (e) { fail(e); }
}

export async function runReviewRequest(taskId, opts = {}) {
  const config = await loadConfigOrExit();
  try {
    const r = await requestReview(config, taskId, { summary: opts.summary, baseRevision: opts.base, requestedBy: opts.by || "agent" });
    console.log(chalk.green(`\n  ✓ ${taskId} is waiting for human review (checks: ${r.requested.checks}). Task status → review.\n`));
  } catch (e) { fail(e); }
}

export async function runReviewApprove(taskId, opts = {}) {
  requireHuman("Approving a review");
  const config = await loadConfigOrExit();
  try {
    const d = await reviewDetail(config, taskId, { maxDiffLines: 0 });
    const overall = d.live.checks.overall;
    console.log(`\n  Approve ${chalk.white.bold(taskId)} "${d.title}"?  ${CHECK_ICON[overall] || overall}${d.live.codeChanged ? chalk.yellow("  · code changed since requested") : ""}`);
    console.log(chalk.dim("  This marks the task done. (See `claude-team review show` first if you haven't.)\n"));
    const { default: inquirer } = await import("inquirer");
    const { ok } = await inquirer.prompt([{ type: "confirm", name: "ok", message: "Approve?", default: false }]);
    if (!ok) { console.log(chalk.dim("\n  Not approved.\n")); return; }
    await approveReview(config, taskId, { note: opts.message, acceptUnverified: !!opts.acceptUnverified, expectedRequestId: d.requestId });
    console.log(chalk.green(`\n  ✓ ${taskId} approved and marked done.\n`));
  } catch (e) { fail(e); }
}

export async function runReviewReject(taskId, opts = {}) {
  requireHuman("Rejecting a review");
  const config = await loadConfigOrExit();
  try {
    await rejectReview(config, taskId, { note: opts.message });
    console.log(chalk.green(`\n  ✓ ${taskId} sent back with your note; the assignee will see it in their inbox.\n`));
  } catch (e) { fail(e); }
}
