import http from 'http';
import path from 'path';
import os from 'os';
import fsp from 'fs/promises';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { createRequire } from 'module';
import chalk from 'chalk';
import fs from 'fs-extra';
import { requireConfig } from './config.js';
import { estimateTokens, TOKEN_BUDGETS } from './tokens.js';
import { addAgentToTeam, removeAgentFromTeam } from './add.js';
import { normalizeModel } from './models.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const MAX_SCROLLBACK = 200_000; // chars of terminal history kept per session

// Live agent sessions: name -> { pty, buffer, sockets:Set, exited, exitCode, ... }
const sessions = new Map();

// ── Auto-check watchdog ─────────────────────────────────────────────────────
//
// A real `claude` session does the work it's given and then stops — the
// "every N seconds, re-check your inbox" loop described in ORCHESTRATOR.md
// doesn't run on its own. This watchdog makes that promise true: while a
// session is quiet (no output AND no input for QUIET_MS), it types a
// check-in message into the same PTY at roughly the project's configured
// pollInterval, so the agent notices new tasks without a human nudging it.
//
// "Quiet on both sides" is a deliberate safety margin — it avoids firing
// while the agent is mid-turn (streaming output) or while a human is
// mid-keystroke in the live terminal (no output yet, but recent input).
const QUIET_MS = 8_000;
const MIN_NUDGE_MS = 15_000; // floor, even if pollInterval is configured lower
const WATCHDOG_TICK_MS = 4_000;
const NUDGE_TEXT = '[auto-check] Re-check your inbox, status files, and any relevant outboxes now, then continue accordingly. If nothing is new, say so briefly and wait.';

let supervisorHandle = null;
function startSupervisorLoop() {
  if (supervisorHandle) return;
  supervisorHandle = setInterval(() => {
    const now = Date.now();
    for (const [name, session] of sessions) {
      if (!session.exited && session.autoLoop) {
        const quietFor = now - Math.max(session.lastOutputAt, session.lastInputAt);
        const sinceNudge = now - session.lastNudgeAt;
        if (quietFor >= QUIET_MS && sinceNudge >= session.pollIntervalMs) {
          try {
            session.pty.write(NUDGE_TEXT + '\r');
            session.lastNudgeAt = now;
            session.lastInputAt = now;
          } catch {}
        }
      }
      pumpTokenUsage(session).catch(() => {});
      if (!session.exited && !session.transcriptPath) correlateTranscript(session).catch(() => {});
    }
    flushPersistedTokens().catch(() => {});
  }, WATCHDOG_TICK_MS);
  supervisorHandle.unref?.();
}

// ── Real token usage, read from Claude Code's own session transcripts ───────
//
// Claude Code writes every session's turns to a JSONL file under
// ~/.claude/projects/<encoded-cwd>/<session-id>.jsonl, and each assistant
// turn logs exact usage: { input_tokens, output_tokens,
// cache_creation_input_tokens, cache_read_input_tokens }. That's the real
// number — status.json's contextUsedPercent is just the agent's own guess.
//
// We don't get a session ID back from `pty.spawn`, so correlation is a
// heuristic — and predicting the exact encoded directory name turned out to
// be unreliable (symlinks like macOS's /tmp -> /private/tmp change what
// gets encoded). Instead: scan every project directory for a .jsonl file
// created at/after this agent's launch time that no other session has
// already claimed. Broader, but avoids guessing Claude Code's path
// normalization rules.
const TRANSCRIPT_CORRELATE_TIMEOUT_MS = 20_000;
const claimedTranscripts = new Set();

// Cumulative per-agent token usage, persisted across office runs.
// pumpTokenUsage() adds every delta here too; flushed by the supervisor
// loop when dirty and synchronously on Ctrl+C.
const TOKEN_STORE = '.claude-team/logs/token-usage.json';
let persistedTokens = { agents: {} };
let persistedTokensDirty = false;

function persistedUsageFor(name) {
  return (persistedTokens.agents[name] ||= { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 });
}

async function loadPersistedTokens() {
  try {
    const doc = await fs.readJson(TOKEN_STORE);
    if (doc && typeof doc.agents === 'object') persistedTokens = { agents: doc.agents };
  } catch {}
}

async function flushPersistedTokens() {
  if (!persistedTokensDirty) return;
  persistedTokensDirty = false;
  try {
    await fs.ensureDir('.claude-team/logs');
    await fs.writeJson(TOKEN_STORE, { agents: persistedTokens.agents, updatedAt: new Date().toISOString() }, { spaces: 2 });
  } catch { persistedTokensDirty = true; }
}

async function correlateTranscript(session) {
  if (session.transcriptPath || session.exited) return;
  if (Date.now() - session.launchedAt > TRANSCRIPT_CORRELATE_TIMEOUT_MS) { session.transcriptGaveUp = true; return; }
  const projectsRoot = path.join(os.homedir(), '.claude', 'projects');
  try {
    const projectDirs = await fs.readdir(projectsRoot);
    const candidates = [];
    for (const dir of projectDirs) {
      const dirPath = path.join(projectsRoot, dir);
      let files;
      try { files = await fs.readdir(dirPath); } catch { continue; }
      for (const f of files) {
        if (!f.endsWith('.jsonl')) continue;
        const filePath = path.join(dirPath, f);
        if (claimedTranscripts.has(filePath)) continue;
        try {
          const st = await fs.stat(filePath);
          const createdAt = st.birthtimeMs || st.ctimeMs;
          if (createdAt >= session.launchedAt - 1000) candidates.push({ filePath, createdAt });
        } catch {}
      }
    }
    if (candidates.length === 0) return;
    candidates.sort((a, b) => a.createdAt - b.createdAt); // earliest new file after launch = most likely ours
    session.transcriptPath = candidates[0].filePath;
    claimedTranscripts.add(candidates[0].filePath);
  } catch {}
}

async function pumpTokenUsage(session) {
  if (!session.transcriptPath) return;
  let stat;
  try { stat = await fsp.stat(session.transcriptPath); } catch { return; }
  if (stat.size <= session.transcriptOffset) return;

  const length = stat.size - session.transcriptOffset;
  const buf = Buffer.alloc(length);
  let fh;
  try {
    fh = await fsp.open(session.transcriptPath, 'r');
    await fh.read(buf, 0, length, session.transcriptOffset);
  } catch {
    return;
  } finally {
    await fh?.close().catch(() => {});
  }
  session.transcriptOffset = stat.size;

  const text = session.transcriptPartialLine + buf.toString('utf8');
  const lines = text.split('\n');
  session.transcriptPartialLine = lines.pop() ?? '';

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const evt = JSON.parse(line);
      const usage = evt?.message?.usage;
      if (evt.type === 'assistant' && usage) {
        session.tokenUsage.inputTokens += usage.input_tokens || 0;
        session.tokenUsage.outputTokens += usage.output_tokens || 0;
        session.tokenUsage.cacheCreationTokens += usage.cache_creation_input_tokens || 0;
        session.tokenUsage.cacheReadTokens += usage.cache_read_input_tokens || 0;
        const p = persistedUsageFor(session.name);
        p.inputTokens += usage.input_tokens || 0;
        p.outputTokens += usage.output_tokens || 0;
        p.cacheCreationTokens += usage.cache_creation_input_tokens || 0;
        p.cacheReadTokens += usage.cache_read_input_tokens || 0;
        persistedTokensDirty = true;
      }
    } catch {}
  }
}

/**
 * Office command — live visual dashboard of the team as an office.
 * Serves the page + /api/state (polled), and can hire agents and launch
 * real `claude` sessions in pseudo-terminals streamed over WebSocket.
 */
export async function runOffice(options = {}) {
  try { await requireConfig(); }
  catch (e) { console.error(chalk.red(e.message)); process.exit(1); }

  // node-pty is a native module — load lazily so the rest of the CLI
  // never breaks if it failed to build on this machine.
  let pty = null;
  try {
    fixSpawnHelperPermissions();
    pty = require('node-pty');
  } catch {
    console.log(chalk.yellow('  ⚠️  node-pty unavailable — office runs in view-only mode (no launching from the browser).'));
  }

  const port = parseInt(options.port, 10) || 4753;
  const htmlPath = path.join(__dirname, 'office', 'index.html');
  await loadPersistedTokens();

  const server = http.createServer(async (req, res) => {
    const send = (code, body, type = 'application/json') => {
      res.writeHead(code, { 'Content-Type': type });
      res.end(type === 'application/json' ? JSON.stringify(body) : body);
    };
    try {
      if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
        send(200, await fs.readFile(htmlPath, 'utf8'), 'text/html; charset=utf-8');
      } else if (req.method === 'GET' && req.url === '/logo.svg') {
        send(200, await fs.readFile(path.join(__dirname, 'office', 'logo.svg'), 'utf8'), 'image/svg+xml');
      } else if (req.method === 'GET' && req.url === '/api/state') {
        send(200, await collectState(!!pty));
      } else if (req.method === 'POST' && req.url === '/api/launch') {
        if (!pty) return send(501, { error: 'node-pty unavailable — launch from a terminal instead' });
        const { agent, model } = await readBody(req);
        await launchAgent(pty, agent, model);
        send(200, { ok: true });
      } else if (req.method === 'POST' && req.url === '/api/stop') {
        const { agent } = await readBody(req);
        const s = sessions.get(agent);
        if (s && !s.exited) s.pty.kill();
        send(200, { ok: true });
      } else if (req.method === 'POST' && req.url === '/api/autoloop') {
        const { agent, enabled } = await readBody(req);
        const s = sessions.get(agent);
        if (!s || s.exited) return send(404, { error: `${agent} has no live session` });
        s.autoLoop = !!enabled;
        if (s.autoLoop) { s.lastNudgeAt = Date.now(); s.lastOutputAt = Date.now(); s.lastInputAt = Date.now(); }
        send(200, { ok: true, autoLoop: s.autoLoop });
      } else if (req.method === 'POST' && req.url === '/api/hire') {
        const body = await readBody(req);
        const config = await fs.readJson('.claude-team/config.json');
        const agent = await addAgentToTeam(config, body);
        send(200, { ok: true, name: agent.name });
      } else if (req.method === 'POST' && req.url === '/api/remove') {
        const { agent: name } = await readBody(req);
        if (name === 'orchestrator') return send(400, { error: 'The orchestrator can\'t be removed' });
        const existing = sessions.get(name);
        if (existing && !existing.exited) { existing.pty.kill(); sessions.delete(name); }
        const config = await fs.readJson('.claude-team/config.json');
        await removeAgentFromTeam(config, name);
        send(200, { ok: true });
      } else if (req.method === 'POST' && req.url === '/api/respawn') {
        if (!pty) return send(501, { error: 'node-pty unavailable — relaunch from a terminal instead' });
        const { agent, model } = await readBody(req);
        const existing = sessions.get(agent);
        if (existing && !existing.exited) { existing.pty.kill(); sessions.delete(agent); }
        await launchAgent(pty, agent, model);
        send(200, { ok: true });
      } else if (req.method === 'POST' && req.url === '/api/answer') {
        const { id, answer } = await readBody(req);
        await answerQuestion(String(id || '').trim(), String(answer || '').trim());
        send(200, { ok: true });
      } else if (req.method === 'POST' && req.url === '/api/task') {
        const body = await readBody(req);
        const task = await createTask(body);
        send(200, { ok: true, id: task.id });
      } else {
        send(404, 'Not found', 'text/plain');
      }
    } catch (err) {
      send(err.statusCode || 500, { error: err.message });
    }
  });

  // Terminal streaming: ws://host/term?agent=<name>
  const { WebSocketServer } = require('ws');
  const wss = new WebSocketServer({ server, path: '/term' });
  wss.on('connection', (ws, req) => {
    const name = new URL(req.url, 'http://localhost').searchParams.get('agent');
    const session = sessions.get(name);
    if (!session) { ws.close(4004, 'no session'); return; }
    session.sockets.add(ws);
    ws.send(JSON.stringify({ type: 'data', data: session.buffer }));
    if (session.exited) ws.send(JSON.stringify({ type: 'exit', code: session.exitCode }));
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);
        if (session.exited) return;
        if (msg.type === 'input') { session.pty.write(msg.data); session.lastInputAt = Date.now(); }
        if (msg.type === 'resize' && msg.cols > 0 && msg.rows > 0) session.pty.resize(msg.cols, msg.rows);
      } catch {}
    });
    ws.on('close', () => session.sockets.delete(ws));
  });

  if (pty) startSupervisorLoop();

  // Localhost only — this server can spawn processes, never expose it on the network
  server.listen(port, '127.0.0.1', () => {
    const url = `http://localhost:${port}`;
    console.log();
    console.log(chalk.cyan.bold('  🏢 Office is open'));
    console.log(`     ${chalk.green(url)}`);
    console.log(chalk.dim('     Live team view — click a desk to launch or watch an agent.'));
    console.log(chalk.dim('     Launched agents get auto-checked for new work while idle — toggle per agent in its drawer.'));
    console.log(chalk.dim('     Ctrl+C closes the office AND stops agents launched from it.\n'));
    if (process.platform === 'darwin') exec(`open ${url}`, () => {});
    else if (process.platform === 'win32') exec(`start ${url}`, () => {});
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(chalk.red(`  Port ${port} is in use. Try: claude-team office --port ${port + 1}`));
    } else {
      console.error(chalk.red(`  ${err.message}`));
    }
    process.exit(1);
  });

  process.on('SIGINT', () => {
    if (supervisorHandle) clearInterval(supervisorHandle);
    for (const [name, s] of sessions) {
      if (!s.exited) {
        console.log(chalk.dim(`  Stopping ${name}...`));
        try { s.pty.kill(); } catch {}
      }
    }
    if (persistedTokensDirty) {
      try {
        fs.ensureDirSync('.claude-team/logs');
        fs.writeJsonSync(TOKEN_STORE, { agents: persistedTokens.agents, updatedAt: new Date().toISOString() }, { spaces: 2 });
      } catch {}
    }
    console.log(chalk.dim('  Office closed.\n'));
    process.exit(0);
  });
}

// ── Agent sessions ────────────────────────────────────────────────────────────

async function launchAgent(pty, name, requestedModel) {
  const config = await fs.readJson('.claude-team/config.json');
  const isOrchestrator = name === 'orchestrator';
  const agentEntry = isOrchestrator ? null : config.agents.find(a => a.name === name);
  if (!isOrchestrator && !agentEntry) throw Object.assign(new Error(`Unknown agent: ${name}`), { statusCode: 400 });
  const existing = sessions.get(name);
  if (existing && !existing.exited) throw Object.assign(new Error(`${name} is already running`), { statusCode: 409 });

  // An explicit model choice from the launch UI is remembered for next time.
  let model;
  if (requestedModel) {
    model = normalizeModel(requestedModel, isOrchestrator || !!agentEntry?.isLeadership);
    if (isOrchestrator) config.orchestratorModel = model;
    else agentEntry.model = model;
    await fs.writeJson('.claude-team/config.json', config, { spaces: 2 });
  } else {
    model = normalizeModel(isOrchestrator ? config.orchestratorModel : agentEntry.model, isOrchestrator || !!agentEntry?.isLeadership);
  }

  const instrFile = isOrchestrator ? '.claude-team/ORCHESTRATOR.md' : `.claude-team/agents/${name}.md`;
  const prompt = `Read CLAUDE.md and ${instrFile}, then start working on your assigned tasks. Keep your status file updated as you work.`;
  // Overridable for testing / non-standard installs
  const cmd = process.env.CLAUDE_TEAM_CLAUDE_CMD || 'claude';
  const modelArgs = model !== 'default' ? ['--model', model] : [];

  // Each launched agent must be its own independent top-level session — if
  // `claude-team office` itself happens to be running inside a Claude Code
  // session (e.g. someone driving it from within Claude Code, or a nested
  // shell), these identity/nesting markers would otherwise get inherited
  // and the spawned agent would attach as a "child" instead of starting
  // fresh (which also means it never gets its own transcript file).
  const childEnv = { ...process.env };
  delete childEnv.CLAUDECODE;
  delete childEnv.CLAUDE_CODE_SESSION_ID;
  delete childEnv.CLAUDE_CODE_CHILD_SESSION;

  const proc = pty.spawn(cmd, [...modelArgs, prompt], {
    name: 'xterm-256color',
    cols: 100,
    rows: 30,
    cwd: process.cwd(),
    env: childEnv,
  });

  const now = Date.now();
  const configuredIntervalMs = (config.coordination?.pollInterval || 10) * 1000;

  const session = {
    name, pty: proc, buffer: '', sockets: new Set(), exited: false, exitCode: null,
    autoLoop: true,
    pollIntervalMs: Math.max(configuredIntervalMs, MIN_NUDGE_MS),
    lastOutputAt: now, lastInputAt: now, lastNudgeAt: now,
    launchedAt: now,
    transcriptPath: null, transcriptGaveUp: false,
    transcriptOffset: 0, transcriptPartialLine: '',
    tokenUsage: { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 },
  };
  proc.onData((data) => {
    session.buffer = (session.buffer + data).slice(-MAX_SCROLLBACK);
    session.lastOutputAt = Date.now();
    for (const ws of session.sockets) {
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'data', data }));
    }
  });
  proc.onExit(({ exitCode }) => {
    session.exited = true;
    session.exitCode = exitCode;
    for (const ws of session.sockets) {
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'exit', code: exitCode }));
    }
  });
  sessions.set(name, session);
}

/**
 * npm strips the execute bit from node-pty's prebuilt spawn-helper on macOS,
 * which makes every spawn fail with "posix_spawnp failed". Repair it.
 */
function fixSpawnHelperPermissions() {
  if (process.platform !== 'darwin') return;
  try {
    const helper = path.join(
      path.dirname(require.resolve('node-pty/package.json')),
      'prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper'
    );
    fs.chmodSync(helper, 0o755);
  } catch {}
}

/**
 * Writes the human's answer under a question's "## HUMAN REPLY:" line in
 * HUMAN_INPUT.md (the question stays [open] — the team flips it to
 * [resolved] once actioned, per the file's own legend), and notifies the
 * asker's inbox so they don't have to poll the file to notice.
 */
async function answerQuestion(id, answer) {
  if (!/^QUESTION-\d+$/.test(id)) throw Object.assign(new Error('Invalid question id'), { statusCode: 400 });
  if (!answer) throw Object.assign(new Error('Answer is required'), { statusCode: 400 });

  const filePath = '.claude-team/HUMAN_INPUT.md';
  let md;
  try { md = await fs.readFile(filePath, 'utf8'); }
  catch { throw Object.assign(new Error('HUMAN_INPUT.md not found'), { statusCode: 404 }); }

  // The reply section belonging to this question is the first
  // "## HUMAN REPLY:" after its heading — without crossing into the next
  // question's block.
  const re = new RegExp(
    `(## ${id} \\[open\\](?:(?!\\n## QUESTION-)[\\s\\S])*?## HUMAN REPLY:)[ \\t]*\\n(<!-- Write your answer here -->\\n?)?`
  );
  if (!re.test(md)) throw Object.assign(new Error(`${id} not found or not [open]`), { statusCode: 404 });

  const stamp = new Date().toISOString().split('T')[0];
  md = md.replace(re, `$1\n${answer}\n\n_(answered from the office, ${stamp})_\n`);
  await fs.writeFile(filePath, md);

  // Tell the asker (fall back to the orchestrator for "team"/unknown askers).
  const block = md.split(/^## /m).find(b => b.startsWith(`${id} [open]`)) || '';
  const asker = block.match(/\*\*From\*\*: *(.+)/)?.[1]?.trim();
  const config = await fs.readJson('.claude-team/config.json');
  const target = config.agents.some(a => a.name === asker) || asker === 'orchestrator' ? asker : 'orchestrator';
  try {
    const inboxPath = `.claude-team/tasks/${target}-inbox.json`;
    let inbox;
    try { inbox = await fs.readJson(inboxPath); } catch { inbox = { tasks: [], messages: [] }; }
    inbox.messages = inbox.messages || [];
    inbox.messages.push({ from: 'human', type: 'human_reply', questionId: id, answer, sentAt: new Date().toISOString() });
    await fs.writeJson(inboxPath, inbox, { spaces: 2 });
  } catch {}
}

/**
 * Creates a task from the office UI — same shape and delivery rules as the
 * init wizard's initial task: queued in queue.json + master.json, and
 * delivered straight to an agent's inbox when assigned to a real agent.
 */
async function createTask({ title, description, priority, assignTo }) {
  title = String(title || '').trim();
  description = String(description || '').trim();
  if (!title || !description) throw Object.assign(new Error('Title and description are required'), { statusCode: 400 });
  priority = ['high', 'medium', 'low'].includes(priority) ? priority : 'medium';

  const config = await fs.readJson('.claude-team/config.json');
  const agentNames = new Set([...config.agents.map(a => a.name), 'orchestrator']);
  const deliverTo = agentNames.has(assignTo) ? assignTo : null;
  const now = new Date().toISOString();
  const task = {
    id: `task-${Date.now()}`,
    title, description, priority,
    assignedTo: deliverTo || 'unassigned',
    status: deliverTo ? 'assigned' : 'queued',
    createdAt: now,
    dependencies: [],
    acceptanceCriteria: [],
    humanApprovalRequired: false,
    blockedByQuestion: null,
  };

  for (const file of ['.claude-team/tasks/queue.json', '.claude-team/tasks/master.json']) {
    let doc;
    try { doc = await fs.readJson(file); } catch { doc = { tasks: [] }; }
    doc.tasks = doc.tasks || [];
    doc.tasks.push(task);
    if ('lastUpdated' in doc) doc.lastUpdated = now;
    await fs.writeJson(file, doc, { spaces: 2 });
  }

  if (deliverTo) {
    const inboxPath = `.claude-team/tasks/${deliverTo}-inbox.json`;
    let inbox;
    try { inbox = await fs.readJson(inboxPath); } catch { inbox = { tasks: [], messages: [] }; }
    inbox.tasks = inbox.tasks || [];
    inbox.tasks.push({ ...task, assignedAt: now });
    await fs.writeJson(inboxPath, inbox, { spaces: 2 });
  }
  return task;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); }
      catch { reject(Object.assign(new Error('Invalid JSON body'), { statusCode: 400 })); }
    });
    req.on('error', reject);
  });
}

// ── State aggregation ─────────────────────────────────────────────────────────

async function collectState(canLaunch) {
  // Re-read config every poll so hires and `claude-team add` show up live
  const config = await fs.readJson('.claude-team/config.json');

  const agents = [];
  for (const agent of config.agents) {
    agents.push(await readAgent(agent));
  }
  // Orchestrator is not in config.agents but is part of the office
  agents.unshift(await readAgent(
    { name: 'orchestrator', role: 'Orchestrator', isLeadership: true, responsibilities: ['Assign tasks', 'Monitor agents', 'Keep MASTER.md current'], model: config.orchestratorModel }
  ));

  // Task summary from master.json
  let taskSummary = { total: 0, done: 0, inProgress: 0, queued: 0, paused: 0 };
  try {
    const master = await fs.readJson('.claude-team/tasks/master.json');
    const tasks = master.tasks || [];
    taskSummary = {
      total: tasks.length,
      done: tasks.filter(t => t.status === 'done').length,
      inProgress: tasks.filter(t => ['in_progress', 'assigned'].includes(t.status)).length,
      queued: tasks.filter(t => ['queued', 'not_started'].includes(t.status)).length,
      paused: tasks.filter(t => t.status === 'paused').length,
    };
  } catch {}

  // Recent completions across all outboxes
  let completions = [];
  for (const agent of config.agents) {
    try {
      const outbox = await fs.readJson(`.claude-team/tasks/${agent.name}-outbox.json`);
      for (const t of outbox.completedTasks || []) {
        completions.push({ agent: agent.name, title: t.title, summary: t.summary || '', completedAt: t.completedAt || '' });
      }
    } catch {}
  }
  completions.sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''));
  completions = completions.slice(0, 8);

  // Open questions for the human
  let openQuestions = [];
  try {
    openQuestions = parseOpenQuestions(await fs.readFile('.claude-team/HUMAN_INPUT.md', 'utf8'));
  } catch {}

  // MASTER.md doc health
  let masterDoc = { tokens: 0, budget: TOKEN_BUDGETS.masterDoc };
  try {
    masterDoc.tokens = estimateTokens(await fs.readFile('.claude-team/docs/MASTER.md', 'utf8'));
  } catch {}

  const totalTeamTokens = agents.reduce((sum, a) => sum + (a.tokenUsage?.total || 0), 0);

  return {
    projectName: config.projectName,
    projectGoal: config.projectGoal,
    hierarchyType: config.hierarchyType,
    coordination: config.coordination,
    archivedAt: config.archivedAt || null,
    canLaunch,
    agents,
    taskSummary,
    completions,
    openQuestions,
    masterDoc,
    totalTeamTokens,
    generatedAt: new Date().toISOString(),
  };
}

async function readAgent(agent) {
  let status = null;
  try { status = await fs.readJson(`.claude-team/tasks/${agent.name}-status.json`); } catch {}

  let docTokens = 0;
  try {
    docTokens = estimateTokens(await fs.readFile(`.claude-team/docs/agents/${agent.name}.md`, 'utf8'));
  } catch {}

  let inboxCount = 0;
  try {
    const inbox = await fs.readJson(`.claude-team/tasks/${agent.name}-inbox.json`);
    inboxCount = (inbox.tasks || []).length + (inbox.messages || []).length;
  } catch {}

  const session = sessions.get(agent.name);

  // Cumulative across office runs (pumpTokenUsage keeps the persisted store
  // in sync live), so historical usage shows even before a relaunch.
  let tokenUsage = null;
  const p = persistedTokens.agents[agent.name];
  const pTotal = p ? p.inputTokens + p.outputTokens + p.cacheCreationTokens + p.cacheReadTokens : 0;
  if (session || pTotal > 0) {
    tokenUsage = {
      inputTokens: p?.inputTokens || 0,
      outputTokens: p?.outputTokens || 0,
      cacheCreationTokens: p?.cacheCreationTokens || 0,
      cacheReadTokens: p?.cacheReadTokens || 0,
      total: pTotal,
      // Real usage read from Claude Code's own transcript; false while we're
      // still looking for which session file belongs to this agent.
      transcriptFound: session ? !!session.transcriptPath : true,
      transcriptGaveUp: !!session?.transcriptGaveUp,
    };
  }

  return {
    name: agent.name,
    role: agent.role,
    isLeadership: !!agent.isLeadership,
    responsibilities: agent.responsibilities || [],
    status: status?.status || 'unknown',
    currentTaskTitle: status?.currentTaskTitle || null,
    currentPhase: status?.currentPhase || null,
    contextUsedPercent: status?.contextUsedPercent || 0,
    blockedReason: status?.blockedReason || null,
    lastUpdated: status?.lastUpdated || null,
    docTokens,
    docBudget: TOKEN_BUDGETS.agentDoc,
    inboxCount,
    model: normalizeModel(agent.model, !!agent.isLeadership),
    session: session ? (session.exited ? 'ended' : 'live') : null,
    autoLoop: session && !session.exited ? session.autoLoop : null,
    pollIntervalSeconds: session && !session.exited ? Math.round(session.pollIntervalMs / 1000) : null,
    tokenUsage,
  };
}

/**
 * Extracts QUESTION-NNN blocks still marked [open] from HUMAN_INPUT.md.
 * A question stays [open] until the team actions it, so `answered` tracks
 * whether its HUMAN REPLY section (the next ## block) already has content.
 */
function parseOpenQuestions(md = '') {
  const blocks = md.split(/^## /m);
  return blocks
    .map((b, i) => ({ b, next: blocks[i + 1] || '' }))
    .filter(({ b }) => /^QUESTION-\d+ \[open\]/.test(b))
    .map(({ b, next }) => ({
      id: b.match(/^QUESTION-\d+/)[0],
      question: b.match(/\*\*Question\*\*: *(.+)/)?.[1]?.trim() || '',
      priority: b.match(/\*\*Priority\*\*: *(.+)/)?.[1]?.trim() || 'non-blocking',
      from: b.match(/\*\*From\*\*: *(.+)/)?.[1]?.trim() || 'team',
      // Reply content ends at the `---` separator; anything past it is the
      // file's own boilerplate (including comments the `## ` split can cut
      // in half).
      answered: /^HUMAN REPLY:/.test(next) &&
        next.replace(/^HUMAN REPLY:/, '')
            .split(/^-{3,}\s*$/m)[0]
            .replace(/<!--[\s\S]*?-->/g, '')
            .trim().length > 0,
    }));
}
