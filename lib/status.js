import chalk from 'chalk';
import fs from 'fs-extra';
import boxen from 'boxen';
import { requireConfig } from './config.js';
import { tokenBar, estimateTokens, TOKEN_BUDGETS } from './tokens.js';

const STATUS_ICONS = {
  idle: '💤', working: '⚡', blocked: '🚧',
  paused: '🔴', review_needed: '👀', done: '✅',
};
const STATUS_COLORS = {
  idle: chalk.dim, working: chalk.green, blocked: chalk.red,
  paused: chalk.red, review_needed: chalk.yellow, done: chalk.cyan,
};

export async function runStatus() {
  let config;
  try { config = await requireConfig(); }
  catch (e) { console.error(chalk.red(e.message)); process.exit(1); }

  console.log();
  console.log(chalk.cyan.bold(`  📊 ${config.projectName} — Team Status\n`));

  // ── Agent rows ─────────────────────────────────────────────────────────
  for (const agent of config.agents) {
    let status = { status: 'unknown', currentTaskTitle: null, contextUsedPercent: 0, lastUpdated: null, blockedReason: null };
    try { status = await fs.readJson(`.claude-team/tasks/${agent.name}-status.json`); } catch {}

    // Doc token usage
    let docTokens = 0, docBudget = TOKEN_BUDGETS.agentDoc;
    try {
      const doc = await fs.readFile(`.claude-team/docs/agents/${agent.name}.md`, 'utf8');
      docTokens = estimateTokens(doc);
    } catch {}
    const docPct = Math.round((docTokens / docBudget) * 100);

    const icon = STATUS_ICONS[status.status] || '❓';
    const colorFn = STATUS_COLORS[status.status] || chalk.white;
    const ctxPct = status.contextUsedPercent || 0;
    const ctxColor = ctxPct >= 85 ? chalk.red : ctxPct >= 70 ? chalk.yellow : chalk.green;

    console.log(`  ${icon}  ${chalk.white.bold(agent.name.padEnd(14))} ${colorFn((status.status || 'unknown').padEnd(13))}`);
    if (status.currentTaskTitle) {
      console.log(`      ${chalk.dim('Task:')} ${status.currentTaskTitle}`);
    }
    console.log(`      ${chalk.dim('Context:')} ${ctxColor(tokenBar(ctxPct))}  ${chalk.dim('Doc:')} ${docPct}%/${docBudget}t`);
    if (status.blockedReason) {
      console.log(`      ${chalk.red('⚠ Blocked:')} ${status.blockedReason}`);
    }
    if (status.lastUpdated) {
      console.log(chalk.dim(`      Updated: ${new Date(status.lastUpdated).toLocaleTimeString()}`));
    }
    console.log();
  }

  // ── Doc health ─────────────────────────────────────────────────────────
  let masterTokens = 0;
  try {
    const master = await fs.readFile('.claude-team/docs/MASTER.md', 'utf8');
    masterTokens = estimateTokens(master);
  } catch {}
  const masterPct = Math.round((masterTokens / TOKEN_BUDGETS.masterDoc) * 100);
  const masterColor = masterPct >= 80 ? chalk.yellow : chalk.green;

  console.log(
    boxen(
      [
        chalk.white.bold('📄 Doc Health'),
        '',
        `  ${chalk.dim('MASTER.md  ')} ${masterColor(tokenBar(masterPct))}  ${masterTokens}/${TOKEN_BUDGETS.masterDoc} tokens`,
      ].join('\n'),
      { padding: 1, borderColor: 'dim', borderStyle: 'round' }
    )
  );
  console.log();

  // ── Task summary ───────────────────────────────────────────────────────
  let master = null;
  try { master = await fs.readJson('.claude-team/tasks/master.json'); } catch {}
  if (master?.tasks?.length > 0) {
    const total = master.tasks.length;
    const done = master.tasks.filter(t => t.status === 'done').length;
    const inProg = master.tasks.filter(t => ['in_progress','assigned'].includes(t.status)).length;
    const queued = master.tasks.filter(t => ['queued','not_started'].includes(t.status)).length;
    const paused = master.tasks.filter(t => t.status === 'paused').length;

    console.log(
      boxen(
        [
          chalk.white.bold('📋 Tasks'),
          '',
          `  ${chalk.green('✅ Done')}        ${done}/${total}`,
          `  ${chalk.yellow('⚡ In Progress')}  ${inProg}`,
          `  ${chalk.red('🔴 Paused')}      ${paused}`,
          `  ${chalk.dim('📋 Queued')}      ${queued}`,
        ].join('\n'),
        { padding: 1, borderColor: 'dim', borderStyle: 'round' }
      )
    );
    console.log();
  }

  // ── Recent completions ─────────────────────────────────────────────────
  console.log(chalk.dim('  Recent completions:\n'));
  let found = false;
  for (const agent of config.agents) {
    try {
      const outbox = await fs.readJson(`.claude-team/tasks/${agent.name}-outbox.json`);
      if (outbox.completedTasks?.length > 0) {
        const recent = outbox.completedTasks.slice(-2);
        for (const task of recent) {
          found = true;
          console.log(`  ✅ ${chalk.cyan(agent.name)}  ${task.title}`);
          if (task.summary) console.log(chalk.dim(`     ${task.summary}`));
        }
      }
    } catch {}
  }
  if (!found) console.log(chalk.dim('  No completed tasks yet.'));

  // ── Paused agents warning ──────────────────────────────────────────────
  const pausedAgents = [];
  for (const agent of config.agents) {
    try {
      const s = await fs.readJson(`.claude-team/tasks/${agent.name}-status.json`);
      if (s.status === 'paused') pausedAgents.push(agent.name);
    } catch {}
  }
  if (pausedAgents.length > 0) {
    console.log();
    console.log(chalk.red.bold(`  ⚠️  ${pausedAgents.length} agent(s) paused (hit token limit):`));
    pausedAgents.forEach(name => {
      console.log(chalk.red(`     - ${name} — check .claude-team/checkpoints/${name}-*.json`));
    });
    console.log(chalk.dim('  Orchestrator should re-assign with checkpoint context.'));
  }

  console.log();
}