import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
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
import { generateHumanInputMd, generateArchitectureMd, generateStyleGuideMd } from './generators/docs/specialDocs.js';
import { generateProjectManagerMd } from './generators/roles/projectManager.js';
import { generateArchitectMd } from './generators/roles/architect.js';
import { generateEditorMd } from './generators/roles/editor.js';
import { generateResearcherMd } from './generators/roles/researcher.js';
import { saveConfig } from './config.js';
import { printBanner } from './ui.js';
import { MODEL_CHOICES, defaultModelForRole } from './models.js';

export async function runInit() {
  printBanner();

  // Guard: never silently destroy an existing team (docs, changelog, task state)
  if (await fs.pathExists('.claude-team/config.json')) {
    console.log(chalk.yellow('  ⚠️  A claude-team already exists in this project.'));
    console.log(chalk.dim('  Re-initialising will overwrite MASTER.md, changelog, decisions, and all task state.\n'));
    const { overwrite } = await inquirer.prompt([{
      type: 'confirm', name: 'overwrite',
      message: 'Overwrite the existing team?', default: false,
    }]);
    if (!overwrite) {
      console.log(chalk.dim('\n  Init cancelled. Existing team untouched.\n'));
      return;
    }
    console.log();
  }

  console.log(boxen(
    chalk.white(
      'This wizard configures a team of Claude Code agents.\n' +
      'Each agent gets a role, memory doc, research protocol,\n' +
      'token safety rules, and two-way coordination.\n\n' +
      chalk.dim('Run this in the root of any project.')
    ),
    { padding: 1, borderColor: 'cyan', borderStyle: 'round',
      title: '👋 Welcome', titleAlignment: 'center' }
  ));
  console.log();

  // ── Step 1: Project basics ────────────────────────────────────────────────
  console.log(chalk.cyan.bold('  Step 1 of 6 — Project Basics\n'));

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
      type: 'list', name: 'projectCategory',
      message: 'Project category:',
      choices: [
        { name: '💻  Technical    — software, APIs, tools', value: 'technical' },
        { name: '✍️   Content     — blog, book, docs, scripts', value: 'content' },
        { name: '🔀  Mixed       — technical with documentation', value: 'mixed' },
      ],
    },
  ]);

  // Category-specific type + stack questions
  let projectType, techStack;

  if (basics.projectCategory === 'technical' || basics.projectCategory === 'mixed') {
    const techAnswers = await inquirer.prompt([
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
          { name: '🔧  Other', value: 'generic' },
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
    projectType = techAnswers.projectType;
    techStack = techAnswers.techStack;
  } else {
    const contentAnswers = await inquirer.prompt([{
      type: 'list', name: 'projectType',
      message: 'Content type:',
      choices: [
        { name: '📝  Blog / Articles', value: 'blog' },
        { name: '📚  Book / Long-form', value: 'book' },
        { name: '📖  Documentation', value: 'documentation' },
        { name: '🎬  Scripts / Screenplays', value: 'scripts' },
        { name: '📢  Marketing / Copywriting', value: 'marketing' },
        { name: '📋  Other Content', value: 'content' },
      ],
    }]);
    projectType = contentAnswers.projectType;
    techStack = 'content';
  }

  // ── Step 2: Team hierarchy ────────────────────────────────────────────────
  console.log();
  console.log(chalk.cyan.bold('  Step 2 of 6 — Team Hierarchy\n'));

  console.log(chalk.dim('  How complex is this project? This determines team structure.\n'));

  const { hierarchyType } = await inquirer.prompt([{
    type: 'list', name: 'hierarchyType',
    message: 'Team hierarchy:',
    choices: getHierarchyChoices(basics.projectCategory),
  }]);

  // Leadership roles based on hierarchy
  const leadershipRoles = getLeadershipRoles(hierarchyType, basics.projectCategory);

  if (leadershipRoles.length > 0) {
    console.log();
    console.log(chalk.dim('  Your team will include these leadership roles:\n'));
    leadershipRoles.forEach(r => console.log(`    ${r.icon}  ${chalk.white(r.name)} — ${chalk.dim(r.description)}`));
    console.log();
  }

  // ── Step 3: Worker agents ─────────────────────────────────────────────────
  console.log();
  console.log(chalk.cyan.bold('  Step 3 of 6 — Worker Agents\n'));

  const { teamSize } = await inquirer.prompt([{
    type: 'list', name: 'teamSize',
    message: 'How many worker agents?',
    choices: [
      { name: '1 worker  — minimal', value: 1 },
      { name: '2 workers — recommended for small projects', value: 2 },
      { name: '3 workers — recommended for medium projects', value: 3 },
      { name: '4 workers — full team', value: 4 },
      { name: 'Custom    — define each role myself', value: 'custom' },
    ],
  }]);

  let workerAgents = [];
  const workerCount = teamSize === 'custom' ? null : teamSize;

  if (teamSize === 'custom') {
    const { customCount } = await inquirer.prompt([{
      type: 'number', name: 'customCount',
      message: 'How many workers?',
      default: 2,
      validate: v => (v >= 1 && v <= 8) || 'Choose 1–8',
    }]);
    console.log();
    for (let i = 0; i < customCount; i++) {
      const a = await inquirer.prompt([
        { type: 'input', name: 'name', message: `  Worker ${i+1} name:`, default: `agent-${i+1}` },
        { type: 'input', name: 'role', message: `  Worker ${i+1} role:`, validate: v => v.trim().length > 0 || 'Required' },
        { type: 'input', name: 'responsibilities', message: `  Worker ${i+1} responsibilities (comma separated):`, default: 'Implement features, Write tests' },
      ]);
      workerAgents.push({
        name: a.name.toLowerCase().replace(/\s+/g, '-'),
        role: a.role,
        responsibilities: a.responsibilities.split(',').map(r => r.trim()),
        isLeadership: false,
      });
    }
  } else {
    const suggested = getSuggestedWorkers(projectType, techStack, basics.projectCategory, workerCount);
    console.log(chalk.dim(`\n  Suggested workers for ${projectType}. Customize each.\n`));
    for (let i = 0; i < workerCount; i++) {
      const s = suggested[i];
      const a = await inquirer.prompt([
        { type: 'input', name: 'name', message: `  Worker ${i+1} name:`, default: s.name },
        { type: 'input', name: 'role', message: `  Worker ${i+1} role:`, default: s.role },
        { type: 'input', name: 'responsibilities', message: `  Worker ${i+1} responsibilities:`, default: s.responsibilities.join(', ') },
      ]);
      workerAgents.push({
        name: a.name.toLowerCase().replace(/\s+/g, '-'),
        role: a.role,
        responsibilities: a.responsibilities.split(',').map(r => r.trim()),
        isLeadership: false,
      });
    }
  }

  // ── Step 4: Models ────────────────────────────────────────────────────────
  console.log();
  console.log(chalk.cyan.bold('  Step 4 of 6 — Models\n'));
  console.log(chalk.dim('  Which Claude model should each agent use when launched?\n'));

  // Throwaway roster just for the prompts below — orchestrator isn't stored
  // in leadershipRoles/workerAgents, so it's tracked separately as orchestratorModel.
  const modelRoster = [
    { name: 'orchestrator', role: 'Orchestrator', isLeadership: true },
    ...leadershipRoles,
    ...workerAgents,
  ];

  const { modelStrategy } = await inquirer.prompt([{
    type: 'list', name: 'modelStrategy',
    message: 'Model assignment:',
    choices: [
      { name: '✨  Recommended — Opus for leadership, Sonnet for workers', value: 'recommended' },
      { name: '🎯  Same model for everyone', value: 'uniform' },
      { name: '🔧  Choose individually per agent', value: 'custom' },
    ],
  }]);

  let orchestratorModel = 'opus';
  if (modelStrategy === 'recommended') {
    leadershipRoles.forEach(r => { r.model = 'opus'; });
    workerAgents.forEach(a => { a.model = 'sonnet'; });
  } else if (modelStrategy === 'uniform') {
    const { model } = await inquirer.prompt([{
      type: 'list', name: 'model', message: 'Model for every agent:',
      choices: MODEL_CHOICES.map(m => ({ name: `${m.label} — ${m.description}`, value: m.value })),
    }]);
    orchestratorModel = model;
    leadershipRoles.forEach(r => { r.model = model; });
    workerAgents.forEach(a => { a.model = model; });
  } else {
    for (const r of modelRoster) {
      const { model } = await inquirer.prompt([{
        type: 'list', name: 'model', message: `  Model for ${r.name} (${r.role}):`,
        default: defaultModelForRole(r.isLeadership),
        choices: MODEL_CHOICES.map(m => ({ name: `${m.label} — ${m.description}`, value: m.value })),
      }]);
      if (r.name === 'orchestrator') orchestratorModel = model;
      else r.model = model;
    }
  }

  // Combine all agents (leadership + workers)
  const allAgents = [
    ...leadershipRoles.map(r => ({ name: r.name, role: r.role, responsibilities: r.responsibilities, isLeadership: true, model: r.model })),
    ...workerAgents,
  ];

  // ── Step 5: Coordination ──────────────────────────────────────────────────
  console.log();
  console.log(chalk.cyan.bold('  Step 5 of 6 — Coordination\n'));

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

  // ── Step 6: First task ────────────────────────────────────────────────────
  console.log();
  console.log(chalk.cyan.bold('  Step 6 of 6 — First Task\n'));

  const { addTask } = await inquirer.prompt([{
    type: 'confirm', name: 'addTask',
    message: 'Add a starting task now?', default: true,
  }]);

  let initialTask = null;
  if (addTask) {
    // Only offer planners that actually exist in this hierarchy
    const planners = leadershipRoles
      .filter(r => ['project-manager', 'editor'].includes(r.name))
      .map(r => ({ name: `🎯  ${r.role} (will plan and delegate)`, value: r.name }));
    const assignChoices = [
      ...planners,
      { name: '🎯  Orchestrator (will assign)', value: 'orchestrator' },
      ...workerAgents.map(a => ({ name: `🤖  ${a.name} (${a.role})`, value: a.name })),
      { name: '🔓  Unassigned', value: 'unassigned' },
    ];
    const t = await inquirer.prompt([
      { type: 'input', name: 'title', message: 'Task title:', validate: v => v.trim().length > 0 || 'Required' },
      { type: 'input', name: 'description', message: 'Task description:', validate: v => v.trim().length > 0 || 'Required' },
      { type: 'list', name: 'priority', message: 'Priority:', choices: ['high', 'medium', 'low'], default: 'high' },
      { type: 'list', name: 'assignTo', message: 'Assign to:', choices: assignChoices },
    ]);
    initialTask = t;
  }

  // ── Generate everything ───────────────────────────────────────────────────
  console.log();
  const spinner = ora('Generating team configuration...').start();

  const config = {
    projectName: basics.projectName,
    projectGoal: basics.projectGoal,
    projectCategory: basics.projectCategory,
    projectType,
    techStack,
    hierarchyType,
    leadershipRoles,
    agents: allAgents,
    workerAgents,
    orchestratorModel,
    coordination: {
      taskStyle: coordination.taskStyle,
      useGit: coordination.useGit,
      enableReview: coordination.enableReview,
      pollInterval: parseInt(coordination.pollInterval),
    },
    createdAt: new Date().toISOString(),
  };

  const isContent = basics.projectCategory === 'content';
  const hasArchitect = leadershipRoles.some(r => r.name === 'architect');
  const hasPM = leadershipRoles.some(r => r.name === 'project-manager');
  const hasEditor = leadershipRoles.some(r => r.name === 'editor');
  const hasResearcher = leadershipRoles.some(r => r.name === 'researcher');

  try {
    await fs.ensureDir('.claude-team/agents');

    spinner.text = 'Writing orchestrator instructions...';
    await fs.writeFile('.claude-team/ORCHESTRATOR.md', generateOrchestratorMd(config));

    spinner.text = 'Writing leadership role instructions...';
    if (hasPM) await fs.writeFile('.claude-team/agents/project-manager.md', generateProjectManagerMd(config));
    if (hasArchitect) await fs.writeFile('.claude-team/agents/architect.md', generateArchitectMd(config));
    if (hasEditor) await fs.writeFile('.claude-team/agents/editor.md', generateEditorMd(config));
    if (hasResearcher) await fs.writeFile('.claude-team/agents/researcher.md', generateResearcherMd(config));

    spinner.text = 'Writing worker agent instructions...';
    for (const agent of workerAgents) {
      await fs.writeFile(`.claude-team/agents/${agent.name}.md`, generateAgentMd(agent, config));
    }

    spinner.text = 'Setting up coordination files...';
    await generateCoordination(config, initialTask);

    spinner.text = 'Generating RULES.md...';
    await fs.writeFile('.claude-team/docs/RULES.md', generateRulesMd(config));

    spinner.text = 'Generating MASTER.md...';
    await fs.writeFile('.claude-team/docs/MASTER.md', generateMasterMd(config));

    spinner.text = 'Generating HUMAN_INPUT.md...';
    await fs.writeFile('.claude-team/HUMAN_INPUT.md', generateHumanInputMd(config));

    spinner.text = 'Generating foundation doc...';
    if (isContent) {
      await fs.writeFile('.claude-team/docs/STYLE_GUIDE.md', generateStyleGuideMd(config));
    } else {
      await fs.writeFile('.claude-team/docs/ARCHITECTURE.md', generateArchitectureMd(config));
    }

    spinner.text = 'Generating agent memory docs...';
    for (const agent of allAgents) {
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
    spinner.fail('Failed');
    console.error(chalk.red(err.message));
    process.exit(1);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log();

  const startupOrder = getStartupOrder(hierarchyType, isContent, config);

  console.log(boxen(
    [
      chalk.white.bold(`🚀  ${basics.projectName} — Team Ready!\n`),
      chalk.dim('Leadership:'),
      ...leadershipRoles.map(r => chalk.dim(`  ${r.icon}  ${r.name.padEnd(18)}`) + chalk.cyan(`.claude-team/agents/${r.name}.md`) + chalk.dim(`  [${r.model}]`)),
      '',
      chalk.dim('Workers:'),
      ...workerAgents.map(a => chalk.dim(`  🤖  ${a.name.padEnd(18)}`) + chalk.cyan(`.claude-team/agents/${a.name}.md`) + chalk.dim(`  [${a.model}]`)),
      '',
      chalk.dim('Docs:'),
      chalk.dim('  📋  MASTER.md         ') + chalk.cyan('.claude-team/docs/MASTER.md'),
      chalk.dim('  📏  RULES.md          ') + chalk.cyan('.claude-team/docs/RULES.md'),
      chalk.dim(`  📐  ${isContent ? 'STYLE_GUIDE.md    ' : 'ARCHITECTURE.md  '}`) + chalk.cyan(`.claude-team/docs/${isContent ? 'STYLE_GUIDE' : 'ARCHITECTURE'}.md`),
      chalk.dim('  ❓  HUMAN_INPUT.md    ') + chalk.cyan('.claude-team/HUMAN_INPUT.md'),
      '',
      chalk.white.bold('⚠️  Answer QUESTION-001 in HUMAN_INPUT.md first!\n'),
      chalk.white.bold('Startup order:'),
      ...startupOrder.map((s, i) => chalk.yellow(`  ${i+1}.`) + `  ${s}`),
      '',
      chalk.dim('Monitor: ') + chalk.green('claude-team status'),
      chalk.dim('Office:  ') + chalk.green('claude-team office') + chalk.dim('  ← live visual view in browser'),
      chalk.dim('Archive: ') + chalk.green('claude-team archive'),
    ].join('\n'),
    { padding: 1, borderColor: 'green', borderStyle: 'round', title: '✅ Done', titleAlignment: 'center' }
  ));
}

// ── Hierarchy choices ─────────────────────────────────────────────────────────

function getHierarchyChoices(category) {
  if (category === 'content') {
    return [
      { name: '✍️   Simple    — Orchestrator + Writers (small project)', value: 'simple' },
      { name: '📝  Standard  — Editor + Writers + Reviewer', value: 'standard' },
      { name: '📚  Full      — Editor + Researcher + Writers + Reviewer', value: 'full' },
    ];
  }
  return [
    { name: '🔧  Simple    — Orchestrator + Workers (small project)', value: 'simple' },
    { name: '🏗️   Standard  — PM + Orchestrator + Workers', value: 'standard' },
    { name: '🏢  Full      — PM + Architect + Orchestrator + Workers', value: 'full' },
    { name: '🔬  Research  — PM + Architect + Researcher + Workers', value: 'research' },
  ];
}

// ── Leadership roles from hierarchy ──────────────────────────────────────────

function getLeadershipRoles(hierarchyType, category) {
  const isContent = category === 'content';

  const roleMap = {
    simple: [],
    standard: isContent
      ? [{ name: 'editor', role: 'Editor', icon: '✏️', description: 'Owns style, quality, structure', responsibilities: ['Style guide', 'Content review', 'Human communication', 'Quality control'] }]
      : [{ name: 'project-manager', role: 'Project Manager', icon: '📋', description: 'Owns roadmap and human communication', responsibilities: ['Milestone planning', 'Task definition', 'Human Q&A', 'Progress tracking'] }],
    full: isContent
      ? [
          { name: 'editor', role: 'Editor', icon: '✏️', description: 'Owns style, quality, structure', responsibilities: ['Style guide', 'Content review', 'Human communication', 'Quality control'] },
          { name: 'researcher', role: 'Researcher', icon: '🔍', description: 'Pre-researches topics for writers', responsibilities: ['Topic research', 'Source gathering', 'Fact checking', 'Pre-task research'] },
        ]
      : [
          { name: 'project-manager', role: 'Project Manager', icon: '📋', description: 'Owns roadmap and human communication', responsibilities: ['Milestone planning', 'Task definition', 'Human Q&A', 'Progress tracking'] },
          { name: 'architect', role: 'Architect', icon: '📐', description: 'Owns technical foundation and patterns', responsibilities: ['Codebase exploration', 'ARCHITECTURE.md', 'Interface contracts', 'Pattern enforcement'] },
        ],
    research: [
      { name: 'project-manager', role: 'Project Manager', icon: '📋', description: 'Owns roadmap and human communication', responsibilities: ['Milestone planning', 'Task definition', 'Human Q&A', 'Progress tracking'] },
      { name: 'architect', role: 'Architect', icon: '📐', description: 'Owns technical foundation and patterns', responsibilities: ['Codebase exploration', 'ARCHITECTURE.md', 'Interface contracts', 'Pattern enforcement'] },
      { name: 'researcher', role: 'Researcher', icon: '🔍', description: 'Pre-researches for all agents', responsibilities: ['Codebase research', 'Library research', 'Pre-task research', 'Conflict detection'] },
    ],
  };

  return roleMap[hierarchyType] || [];
}

// ── Startup order instructions ────────────────────────────────────────────────

function getStartupOrder(hierarchyType, isContent, config) {
  const base = [
    `Open Terminal 1 → ${chalk.green('claude')} → "Read CLAUDE.md and ORCHESTRATOR.md"`,
  ];

  if (hierarchyType === 'simple') {
    config.workerAgents.forEach((a, i) => {
      base.push(`Open Terminal ${i+2} → ${chalk.green('claude')} → "Read .claude-team/agents/${a.name}.md"`);
    });
    return base;
  }

  const order = [];
  let terminal = 1;

  // Answer human questions first
  order.push(`${chalk.yellow('FIRST')} — Answer QUESTION-001 in ${chalk.cyan('.claude-team/HUMAN_INPUT.md')}`);

  if (isContent) {
    order.push(`Terminal ${terminal++} → ${chalk.green('claude')} → "Read .claude-team/agents/editor.md — complete your first job"`);
    if (config.leadershipRoles.some(r => r.name === 'researcher')) {
      order.push(`Terminal ${terminal++} → ${chalk.green('claude')} → "Read .claude-team/agents/researcher.md"`);
    }
  } else {
    if (config.leadershipRoles.some(r => r.name === 'project-manager')) {
      order.push(`Terminal ${terminal++} → ${chalk.green('claude')} → "Read .claude-team/agents/project-manager.md — complete your first job"`);
    }
    if (config.leadershipRoles.some(r => r.name === 'architect')) {
      order.push(`Terminal ${terminal++} → ${chalk.green('claude')} → "Read .claude-team/agents/architect.md — complete your first job"`);
      order.push(`${chalk.yellow('WAIT')} — Let Architect complete ARCHITECTURE.md before starting workers`);
    }
    if (config.leadershipRoles.some(r => r.name === 'researcher')) {
      order.push(`Terminal ${terminal++} → ${chalk.green('claude')} → "Read .claude-team/agents/researcher.md"`);
    }
  }

  order.push(`Terminal ${terminal++} → ${chalk.green('claude')} → "Read CLAUDE.md and ORCHESTRATOR.md"`);

  config.workerAgents.forEach(a => {
    order.push(`Terminal ${terminal++} → ${chalk.green('claude')} → "Read .claude-team/agents/${a.name}.md"`);
  });

  return order;
}

// ── Suggested workers ─────────────────────────────────────────────────────────

function getSuggestedWorkers(projectType, techStack, category, count) {
  if (category === 'content') {
    const contentRoles = [
      { name: 'writer-1', role: 'Writer', responsibilities: ['Write assigned sections', 'Follow style guide', 'Research topics', 'Revise based on review'] },
      { name: 'writer-2', role: 'Writer', responsibilities: ['Write assigned sections', 'Follow style guide', 'Research topics', 'Revise based on review'] },
      { name: 'reviewer', role: 'Content Reviewer', responsibilities: ['Review drafts', 'Check consistency', 'Fact-check', 'Suggest improvements'] },
      { name: 'seo-writer', role: 'SEO Writer', responsibilities: ['Keyword optimisation', 'Meta descriptions', 'Headlines', 'Content structure for SEO'] },
    ];
    return contentRoles.slice(0, count);
  }

  const techRoles = {
    web: [
      { name: 'frontend', role: 'Frontend Developer', responsibilities: ['Build UI components', 'Implement styling', 'Client-side logic', 'Frontend tests'] },
      { name: 'backend', role: 'Backend Developer', responsibilities: ['Build APIs', 'Database schema', 'Authentication', 'Server tests'] },
      { name: 'qa', role: 'QA Engineer', responsibilities: ['Integration tests', 'Edge cases', 'Bug reports', 'Code review'] },
      { name: 'devops', role: 'DevOps Engineer', responsibilities: ['CI/CD', 'Deployments', 'Environment config', 'Monitoring'] },
    ],
    api: [
      { name: 'api-dev', role: 'API Developer', responsibilities: ['REST/GraphQL endpoints', 'Route handlers', 'Schema validation', 'API docs'] },
      { name: 'db-engineer', role: 'Database Engineer', responsibilities: ['Data models', 'Migrations', 'Query optimisation', 'Data integrity'] },
      { name: 'security', role: 'Security Engineer', responsibilities: ['Auth/AuthZ', 'Security audits', 'Input validation', 'Secrets management'] },
      { name: 'qa', role: 'QA Engineer', responsibilities: ['API tests', 'Edge cases', 'Performance testing', 'Documentation'] },
    ],
    ai: [
      { name: 'ml-engineer', role: 'ML Engineer', responsibilities: ['Model development', 'Feature engineering', 'Evaluation', 'Tuning'] },
      { name: 'data-engineer', role: 'Data Engineer', responsibilities: ['Data pipelines', 'Data cleaning', 'Dataset management', 'Quality monitoring'] },
      { name: 'api-dev', role: 'API Developer', responsibilities: ['Model APIs', 'Inference endpoints', 'Model versioning', 'Rate limiting'] },
      { name: 'eval', role: 'Evaluation Engineer', responsibilities: ['Eval frameworks', 'Metrics tracking', 'A/B testing', 'Regression testing'] },
    ],
    mobile: [
      { name: 'ui-dev', role: 'UI Developer', responsibilities: ['Screens', 'Components', 'Animations', 'Responsive design'] },
      { name: 'backend', role: 'Backend Developer', responsibilities: ['Mobile APIs', 'Push notifications', 'User data', 'Sync'] },
      { name: 'qa', role: 'QA Engineer', responsibilities: ['Device testing', 'Offline behaviour', 'Performance', 'Edge cases'] },
      { name: 'platform', role: 'Platform Engineer', responsibilities: ['Build system', 'Native modules', 'App store', 'CI/CD'] },
    ],
    cli: [
      { name: 'core-dev', role: 'Core Developer', responsibilities: ['Core commands', 'Argument parsing', 'Main logic', 'Unit tests'] },
      { name: 'ux', role: 'UX Developer', responsibilities: ['Command UX', 'Help text', 'Error messages', 'Progress indicators'] },
      { name: 'qa', role: 'QA Engineer', responsibilities: ['Integration tests', 'Flag testing', 'Cross-platform', 'Edge cases'] },
      { name: 'docs', role: 'Documentation Engineer', responsibilities: ['README', 'Usage examples', 'Changelog', 'API docs'] },
    ],
  };

  const fallback = [
    { name: 'developer-1', role: 'Developer', responsibilities: ['Implement features', 'Write tests', 'Code review', 'Fix bugs'] },
    { name: 'developer-2', role: 'Developer', responsibilities: ['Implement features', 'Write docs', 'Code review', 'Refactor'] },
    { name: 'qa', role: 'QA Engineer', responsibilities: ['Write tests', 'Edge cases', 'Verify behaviour', 'Report issues'] },
    { name: 'devops', role: 'DevOps Engineer', responsibilities: ['CI/CD', 'Deployments', 'Monitoring', 'Infrastructure'] },
  ];

  return (techRoles[projectType] || fallback).slice(0, count);
}