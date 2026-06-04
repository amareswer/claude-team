import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import gradient from 'gradient-string';
import boxen from 'boxen';
import fs from 'fs-extra';
import path from 'path';
import { generateOrchestratorMd } from './generators/orchestrator.js';
import { generateAgentMd } from './generators/agent.js';
import { generateCoordination } from './generators/coordination.js';
import { generateClaudeMd } from './generators/claudeMd.js';
import { generateRulesMd } from './generators/docs/rules.js';
import { generateMasterMd } from './generators/docs/master.js';
import { generateAgentDocMd } from './generators/docs/agentDoc.js';
import { generateChangelogMd, generateDecisionsMd } from './generators/docs/changelog.js';
import { saveConfig } from './config.js';
import { printBanner } from './ui.js';

export async function runInit() {
  printBanner();

  console.log(
    boxen(
      chalk.white(
        'This wizard configures a team of Claude Code agents.\n' +
        'Each agent gets a role, memory doc, token safety rules,\n' +
        'and a two-way coordination channel.\n\n' +
        chalk.dim('Run this in the root of any project.')
      ),
      { padding: 1, borderColor: 'cyan', borderStyle: 'round',
        title: '👋 Welcome', titleAlignment: 'center' }
  ));

  console.log();

  // ── Step 1: Project basics ────────────────────────────────────────────────
  console.log(chalk.cyan.bold('  Step 1 of 4 — Project Basics\n'));

  const basics = await inquirer.prompt([
    {
      type: 'input', name: 'projectName',
      message: 'Project name:',
      default: path.basename(process.cwd()),
      validate: v => v.trim().length > 0 || 'Required',
    },
    {
      type: 'input', name: 'projectGoal',
      message: 'Main goal of this project:',
      validate: v => v.trim().length > 0 || 'Required',
    },
    {
      type: 'list', name: 'projectType',
      message: 'Project type:',
      choices: [
        { name: '🌐  Web Application', value: 'web' },
        { name: '⚙️   API / Backend Service', value: 'api' },
        { name: '📱  Mobile App', value: 'mobile' },
        { name: '🖥️   CLI Tool', value: 'cli' },
        { name: '📦  Library / Package', value: 'library' },
        { name: '🗂️   Monorepo / Full-Stack', value: 'monorepo' },
        { name: '🤖  AI / ML Project', value: 'ai' },
        { name: '🔧  Other / Generic', value: 'generic' },
      ],
    },
    {
      type: 'list', name: 'techStack',
      message: 'Primary tech stack:',
      choices: [
        { name: 'Node.js / TypeScript', value: 'node-ts' },
        { name: 'Python', value: 'python' },
        { name: 'React / Next.js', value: 'react' },
        { name: 'Vue / Nuxt', value: 'vue' },
        { name: 'Go', value: 'go' },
        { name: 'Rust', value: 'rust' },
        { name: 'Java / Spring', value: 'java' },
        { name: 'Ruby on Rails', value: 'rails' },
        { name: 'Mixed / Other', value: 'mixed' },
      ],
    },
  ]);

  // ── Step 2: Team structure ────────────────────────────────────────────────
  console.log();
  console.log(chalk.cyan.bold('  Step 2 of 4 — Team Structure\n'));

  const { teamSize } = await inquirer.prompt([{
    type: 'list', name: 'teamSize',
    message: 'How many agents?',
    choices: [
      { name: '2 agents  — Orchestrator + 1 Worker (minimal)', value: 2 },
      { name: '3 agents  — Orchestrator + 2 Workers (recommended)', value: 3 },
      { name: '4 agents  — Orchestrator + 3 Workers', value: 4 },
      { name: '5 agents  — Orchestrator + 4 Workers (full team)', value: 5 },
      { name: 'Custom    — Define each role myself', value: 'custom' },
    ],
  }]);

  let agents = [];

  if (teamSize === 'custom') {
    const { customCount } = await inquirer.prompt([{
      type: 'number', name: 'customCount',
      message: 'How many worker agents (not counting orchestrator)?',
      default: 2,
      validate: v => (v >= 1 && v <= 8) || 'Choose 1–8',
    }]);
    console.log();
    for (let i = 0; i < customCount; i++) {
      const a = await inquirer.prompt([
        { type: 'input', name: 'name', message: `  Agent ${i+1} name:`, default: `agent-${i+1}` },
        { type: 'input', name: 'role', message: `  Agent ${i+1} role:`, validate: v => v.trim().length > 0 || 'Required' },
        { type: 'input', name: 'responsibilities', message: `  Agent ${i+1} responsibilities (comma separated):`, default: 'Implement features, Write tests, Fix bugs' },
      ]);
      agents.push({
        name: a.name.toLowerCase().replace(/\s+/g, '-'),
        role: a.role,
        responsibilities: a.responsibilities.split(',').map(r => r.trim()),
      });
    }
  } else {
    const workerCount = teamSize - 1;
    const suggested = getSuggestedRoles(basics.projectType, basics.techStack, workerCount);
    console.log(chalk.dim(`\n  Suggested roles for ${basics.projectType} project. Customize each.\n`));
    for (let i = 0; i < workerCount; i++) {
      const s = suggested[i];
      const a = await inquirer.prompt([
        { type: 'input', name: 'name', message: `  Agent ${i+1} name:`, default: s.name },
        { type: 'input', name: 'role', message: `  Agent ${i+1} role:`, default: s.role },
        { type: 'input', name: 'responsibilities', message: `  Agent ${i+1} responsibilities:`, default: s.responsibilities.join(', ') },
      ]);
      agents.push({
        name: a.name.toLowerCase().replace(/\s+/g, '-'),
        role: a.role,
        responsibilities: a.responsibilities.split(',').map(r => r.trim()),
      });
    }
  }

  // ── Step 3: Coordination ──────────────────────────────────────────────────
  console.log();
  console.log(chalk.cyan.bold('  Step 3 of 4 — Coordination\n'));

  const coordination = await inquirer.prompt([
    {
      type: 'list', name: 'taskStyle',
      message: 'Task coordination style:',
      choices: [
        { name: '📋  Queue    — agents pick tasks one at a time', value: 'queue' },
        { name: '🔀  Parallel — agents work simultaneously', value: 'parallel' },
        { name: '🔁  Pipeline — output feeds into next agent', value: 'pipeline' },
      ],
    },
    { type: 'confirm', name: 'useGit', message: 'Use git commits as checkpoints?', default: true },
    { type: 'confirm', name: 'enableReview', message: 'Agents review each other\'s work?', default: true },
    { type: 'input', name: 'pollInterval', message: 'Agent check interval (seconds):', default: '10',
      validate: v => !isNaN(parseInt(v)) || 'Enter a number' },
  ]);

  // ── Step 4: First task ────────────────────────────────────────────────────
  console.log();
  console.log(chalk.cyan.bold('  Step 4 of 4 — First Task\n'));

  const { addTask } = await inquirer.prompt([{
    type: 'confirm', name: 'addTask',
    message: 'Add a starting task now?', default: true,
  }]);

  let initialTask = null;
  if (addTask) {
    const t = await inquirer.prompt([
      { type: 'input', name: 'title', message: 'Task title:', validate: v => v.trim().length > 0 || 'Required' },
      { type: 'input', name: 'description', message: 'Task description:', validate: v => v.trim().length > 0 || 'Required' },
      { type: 'list', name: 'priority', message: 'Priority:', choices: ['high', 'medium', 'low'], default: 'high' },
      {
        type: 'list', name: 'assignTo',
        message: 'Assign to:',
        choices: [
          { name: '🎯  Orchestrator (will delegate)', value: 'orchestrator' },
          ...agents.map(a => ({ name: `🤖  ${a.name} (${a.role})`, value: a.name })),
          { name: '🔓  Unassigned', value: 'unassigned' },
        ],
      },
    ]);
    initialTask = t;
  }

  // ── Generate all files ────────────────────────────────────────────────────
  console.log();
  const spinner = ora('Generating team configuration...').start();

  const config = {
    projectName: basics.projectName,
    projectGoal: basics.projectGoal,
    projectType: basics.projectType,
    techStack: basics.techStack,
    agents,
    coordination: {
      taskStyle: coordination.taskStyle,
      useGit: coordination.useGit,
      enableReview: coordination.enableReview,
      pollInterval: parseInt(coordination.pollInterval),
    },
    createdAt: new Date().toISOString(),
  };

  try {
    await fs.ensureDir('.claude-team/agents');

    spinner.text = 'Writing orchestrator instructions...';
    await fs.writeFile('.claude-team/ORCHESTRATOR.md', generateOrchestratorMd(config));

    spinner.text = 'Writing agent instructions...';
    for (const agent of agents) {
      await fs.writeFile(`.claude-team/agents/${agent.name}.md`, generateAgentMd(agent, config));
    }

    spinner.text = 'Setting up coordination files...';
    await generateCoordination(config, initialTask);

    spinner.text = 'Generating RULES.md...';
    await fs.writeFile('.claude-team/docs/RULES.md', generateRulesMd(config));

    spinner.text = 'Generating MASTER.md...';
    await fs.writeFile('.claude-team/docs/MASTER.md', generateMasterMd(config));

    spinner.text = 'Generating agent memory docs...';
    for (const agent of agents) {
      await fs.writeFile(`.claude-team/docs/agents/${agent.name}.md`, generateAgentDocMd(agent, config));
    }

    spinner.text = 'Generating changelog + decisions...';
    await fs.writeFile('.claude-team/docs/changelog.md', generateChangelogMd(config));
    await fs.writeFile('.claude-team/docs/decisions.md', generateDecisionsMd(config));

    spinner.text = 'Writing CLAUDE.md...';
    await fs.writeFile('CLAUDE.md', generateClaudeMd(config));

    spinner.text = 'Saving config...';
    await saveConfig(config);

    spinner.succeed(chalk.green('Team ready!'));
  } catch (err) {
    spinner.fail('Failed to generate configuration');
    console.error(chalk.red(err.message));
    process.exit(1);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log();
  console.log(boxen(
    [
      chalk.white.bold(`🚀  ${basics.projectName} — Team Ready!\n`),
      chalk.dim('Instruction files:'),
      chalk.dim('  Orchestrator  ') + chalk.cyan('.claude-team/ORCHESTRATOR.md'),
      ...agents.map(a => chalk.dim(`  ${a.name.padEnd(12)}`) + chalk.cyan(`.claude-team/agents/${a.name}.md`)),
      '',
      chalk.dim('Living docs:'),
      chalk.dim('  MASTER.md     ') + chalk.cyan('.claude-team/docs/MASTER.md'),
      chalk.dim('  RULES.md      ') + chalk.cyan('.claude-team/docs/RULES.md'),
      chalk.dim('  changelog.md  ') + chalk.cyan('.claude-team/docs/changelog.md'),
      chalk.dim('  decisions.md  ') + chalk.cyan('.claude-team/docs/decisions.md'),
      ...agents.map(a => chalk.dim(`  ${a.name.padEnd(12)}`) + chalk.cyan(`.claude-team/docs/agents/${a.name}.md`)),
      '',
      chalk.white.bold('Next steps:'),
      chalk.yellow('  1.') + '  Open Terminal 1 → ' + chalk.green('claude') + ' → "Read CLAUDE.md and ORCHESTRATOR.md"',
      ...agents.map((a, i) =>
        chalk.yellow(`  ${i+2}.`) + `  Open Terminal ${i+2} → ` + chalk.green('claude') + ` → "Read .claude-team/agents/${a.name}.md"`
      ),
      '',
      chalk.dim('Monitor: ') + chalk.green('claude-team status'),
      chalk.dim('Archive: ') + chalk.green('claude-team archive') + chalk.dim(' (when project complete)'),
    ].join('\n'),
    { padding: 1, borderColor: 'green', borderStyle: 'round', title: '✅ Done', titleAlignment: 'center' }
  ));
}

function getSuggestedRoles(projectType, techStack, count) {
  const roleLibrary = {
    web: [
      { name: 'frontend', role: 'Frontend Developer', responsibilities: ['Build UI components', 'Implement styling', 'Handle client-side logic', 'Write frontend tests'] },
      { name: 'backend', role: 'Backend Developer', responsibilities: ['Build APIs', 'Design database schema', 'Handle authentication', 'Write server tests'] },
      { name: 'devops', role: 'DevOps Engineer', responsibilities: ['CI/CD pipelines', 'Configure deployments', 'Environment configs', 'Monitor performance'] },
      { name: 'qa', role: 'QA Engineer', responsibilities: ['Integration tests', 'Review code quality', 'Test edge cases', 'Report bugs'] },
    ],
    api: [
      { name: 'api-dev', role: 'API Developer', responsibilities: ['Design endpoints', 'Write route handlers', 'Validate schemas', 'Document APIs'] },
      { name: 'db-engineer', role: 'Database Engineer', responsibilities: ['Design data models', 'Write migrations', 'Optimise queries', 'Data integrity'] },
      { name: 'security', role: 'Security Engineer', responsibilities: ['Authentication', 'Authorisation', 'Security audits', 'Secure sensitive data'] },
      { name: 'qa', role: 'QA Engineer', responsibilities: ['Write API tests', 'Test edge cases', 'Validate responses', 'Performance testing'] },
    ],
    ai: [
      { name: 'ml-engineer', role: 'ML Engineer', responsibilities: ['Build models', 'Feature engineering', 'Evaluate performance', 'Tune hyperparameters'] },
      { name: 'data-engineer', role: 'Data Engineer', responsibilities: ['Build pipelines', 'Clean data', 'Manage datasets', 'Monitor quality'] },
      { name: 'api-dev', role: 'API Developer', responsibilities: ['Wrap models in APIs', 'Inference endpoints', 'Model versioning', 'Rate limiting'] },
      { name: 'eval', role: 'Evaluation Engineer', responsibilities: ['Design evals', 'Track metrics', 'A/B testing', 'Regression testing'] },
    ],
    mobile: [
      { name: 'ui-dev', role: 'UI Developer', responsibilities: ['Build screens', 'UI components', 'Animations', 'Responsive design'] },
      { name: 'backend', role: 'Backend Developer', responsibilities: ['Mobile APIs', 'Push notifications', 'User data', 'Sync logic'] },
      { name: 'qa', role: 'QA Engineer', responsibilities: ['Multi-device testing', 'Edge cases', 'Offline behaviour', 'Performance'] },
      { name: 'platform', role: 'Platform Engineer', responsibilities: ['Build system', 'Native modules', 'App store setup', 'CI/CD'] },
    ],
    monorepo: [
      { name: 'architect', role: 'Software Architect', responsibilities: ['System boundaries', 'Cross-package interfaces', 'Cross-cutting concerns', 'Consistency'] },
      { name: 'frontend', role: 'Frontend Developer', responsibilities: ['UI packages', 'Component library', 'Web apps', 'Frontend tests'] },
      { name: 'backend', role: 'Backend Developer', responsibilities: ['Service packages', 'Shared interfaces', 'Data layer', 'Backend tests'] },
      { name: 'devops', role: 'DevOps Engineer', responsibilities: ['Monorepo tooling', 'CI/CD', 'Versioning', 'Deployment'] },
    ],
    cli: [
      { name: 'core-dev', role: 'Core Developer', responsibilities: ['Core commands', 'Argument parsing', 'Main logic', 'Unit tests'] },
      { name: 'ux', role: 'UX Developer', responsibilities: ['Command interfaces', 'Help text', 'Error messages', 'Progress indicators'] },
      { name: 'qa', role: 'QA Engineer', responsibilities: ['Integration tests', 'CLI flags testing', 'Cross-platform', 'Edge cases'] },
      { name: 'docs', role: 'Documentation Engineer', responsibilities: ['README', 'Usage examples', 'Changelog', 'API docs'] },
    ],
  };

  const fallback = [
    { name: 'developer-1', role: 'Developer', responsibilities: ['Implement features', 'Write tests', 'Review code', 'Fix bugs'] },
    { name: 'developer-2', role: 'Developer', responsibilities: ['Implement features', 'Write docs', 'Code review', 'Refactor'] },
    { name: 'reviewer', role: 'Code Reviewer', responsibilities: ['Review PRs', 'Code quality', 'Bug detection', 'Improvements'] },
    { name: 'qa', role: 'QA Engineer', responsibilities: ['Write tests', 'Edge cases', 'Verify behaviour', 'Report issues'] },
  ];

  return (roleLibrary[projectType] || fallback).slice(0, count);
}