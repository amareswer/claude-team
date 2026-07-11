import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { createRequire } from 'module';
import chalk from 'chalk';
import fs from 'fs-extra';
import { requireConfig } from './config.js';
import { estimateTokens, TOKEN_BUDGETS } from './tokens.js';
import { addAgentToTeam } from './add.js';
import { normalizeModel } from './models.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const MAX_SCROLLBACK = 200_000; // chars of terminal history kept per session

// Live agent sessions: name -> { pty, buffer, sockets:Set, exited, exitCode }
const sessions = new Map();

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

  const server = http.createServer(async (req, res) => {
    const send = (code, body, type = 'application/json') => {
      res.writeHead(code, { 'Content-Type': type });
      res.end(type === 'application/json' ? JSON.stringify(body) : body);
    };
    try {
      if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
        send(200, await fs.readFile(htmlPath, 'utf8'), 'text/html; charset=utf-8');
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
      } else if (req.method === 'POST' && req.url === '/api/hire') {
        const body = await readBody(req);
        const config = await fs.readJson('.claude-team/config.json');
        const agent = await addAgentToTeam(config, body);
        send(200, { ok: true, name: agent.name });
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
        if (msg.type === 'input') session.pty.write(msg.data);
        if (msg.type === 'resize' && msg.cols > 0 && msg.rows > 0) session.pty.resize(msg.cols, msg.rows);
      } catch {}
    });
    ws.on('close', () => session.sockets.delete(ws));
  });

  // Localhost only — this server can spawn processes, never expose it on the network
  server.listen(port, '127.0.0.1', () => {
    const url = `http://localhost:${port}`;
    console.log();
    console.log(chalk.cyan.bold('  🏢 Office is open'));
    console.log(`     ${chalk.green(url)}`);
    console.log(chalk.dim('     Live team view — click a desk to launch or watch an agent.'));
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
    for (const [name, s] of sessions) {
      if (!s.exited) {
        console.log(chalk.dim(`  Stopping ${name}...`));
        try { s.pty.kill(); } catch {}
      }
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

  const proc = pty.spawn(cmd, [...modelArgs, prompt], {
    name: 'xterm-256color',
    cols: 100,
    rows: 30,
    cwd: process.cwd(),
    env: process.env,
  });

  const session = { pty: proc, buffer: '', sockets: new Set(), exited: false, exitCode: null };
  proc.onData((data) => {
    session.buffer = (session.buffer + data).slice(-MAX_SCROLLBACK);
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
  };
}

/**
 * Extracts QUESTION-NNN blocks still marked [open] from HUMAN_INPUT.md.
 */
function parseOpenQuestions(md = '') {
  return md
    .split(/^## /m)
    .filter(b => /^QUESTION-\d+ \[open\]/.test(b))
    .map(b => ({
      id: b.match(/^QUESTION-\d+/)[0],
      question: b.match(/\*\*Question\*\*: *(.+)/)?.[1]?.trim() || '',
      priority: b.match(/\*\*Priority\*\*: *(.+)/)?.[1]?.trim() || 'non-blocking',
      from: b.match(/\*\*From\*\*: *(.+)/)?.[1]?.trim() || 'team',
    }));
}
