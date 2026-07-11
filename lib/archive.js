import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs-extra';
import path from 'path';
import { requireConfig } from './config.js';

/**
 * Archive command — human-triggered when project is complete.
 * Moves all docs to .claude-team/docs/archive/<project>-<date>/
 * Writes a final SUMMARY.md.
 */
export async function runArchive() {
  let config;
  try { config = await requireConfig(); }
  catch (e) { console.error(chalk.red(e.message)); process.exit(1); }

  console.log();
  console.log(chalk.cyan.bold('  📦 Archive Project\n'));
  console.log(chalk.dim(`  This will archive all docs for: ${chalk.white(config.projectName)}`));
  console.log(chalk.dim('  Docs move to .claude-team/docs/archive/ — nothing is deleted.\n'));

  const { confirm } = await inquirer.prompt([{
    type: 'confirm', name: 'confirm',
    message: `Archive "${config.projectName}" now?`,
    default: false,
  }]);

  if (!confirm) {
    console.log(chalk.dim('\n  Archive cancelled.\n'));
    return;
  }

  const spinner = ora('Archiving project...').start();

  try {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const archiveDir = `.claude-team/docs/archive/${config.projectName}-${dateStr}`;

    await fs.ensureDir(archiveDir);

    // Read changelog and decisions for summary
    let changelog = '';
    let decisions = '';
    try { changelog = await fs.readFile('.claude-team/docs/changelog.md', 'utf8'); } catch {}
    try { decisions = await fs.readFile('.claude-team/docs/decisions.md', 'utf8'); } catch {}

    // Read master task list
    let masterTasks = null;
    try { masterTasks = await fs.readJson('.claude-team/tasks/master.json'); } catch {}

    // Count completed tasks
    const completedCount = masterTasks?.tasks?.filter(t => t.status === 'done').length || 0;
    const totalCount = masterTasks?.tasks?.length || 0;

    // Write SUMMARY.md
    spinner.text = 'Writing project summary...';
    const summary = generateSummaryMd(config, {
      archivedAt: now.toISOString(),
      completedCount,
      totalCount,
      changelog,
      decisions,
    });
    await fs.writeFile(path.join(archiveDir, 'SUMMARY.md'), summary);

    // Move all docs into archive
    spinner.text = 'Moving docs to archive...';
    const docsToMove = [
      '.claude-team/docs/MASTER.md',
      '.claude-team/docs/RULES.md',
      '.claude-team/docs/changelog.md',
      '.claude-team/docs/decisions.md',
      '.claude-team/docs/NOTES.md',
      '.claude-team/docs/ARCHITECTURE.md',
      '.claude-team/docs/STYLE_GUIDE.md',
      '.claude-team/HUMAN_INPUT.md',
    ];

    for (const docPath of docsToMove) {
      try {
        const content = await fs.readFile(docPath, 'utf8');
        const filename = path.basename(docPath);
        await fs.writeFile(path.join(archiveDir, filename), content);
        // Replace original with a pointer
        await fs.writeFile(docPath,
          `# Archived\nThis project has been archived.\nSee: ${archiveDir}/${filename}\nArchived: ${now.toISOString()}\n`
        );
      } catch {}
    }

    // Copy research docs (left in place — they're per-task reference material)
    spinner.text = 'Archiving research docs...';
    try {
      const researchFiles = await fs.readdir('.claude-team/docs/research');
      if (researchFiles.length > 0) {
        await fs.copy('.claude-team/docs/research', path.join(archiveDir, 'research'));
      }
    } catch {}

    // Move agent memory docs
    spinner.text = 'Archiving agent docs...';
    const agentDocsDir = path.join(archiveDir, 'agents');
    await fs.ensureDir(agentDocsDir);
    for (const agent of config.agents) {
      try {
        const agentDoc = `.claude-team/docs/agents/${agent.name}.md`;
        const content = await fs.readFile(agentDoc, 'utf8');
        await fs.writeFile(path.join(agentDocsDir, `${agent.name}.md`), content);
        await fs.writeFile(agentDoc,
          `# Archived\nThis agent's memory has been archived.\nSee: ${agentDocsDir}/${agent.name}.md\n`
        );
      } catch {}
    }

    // Write archive index
    spinner.text = 'Writing archive index...';
    await updateArchiveIndex(config, archiveDir, dateStr);

    // Mark config as archived
    config.archivedAt = now.toISOString();
    config.archivePath = archiveDir;
    await fs.writeJson('.claude-team/config.json', config, { spaces: 2 });

    spinner.succeed(chalk.green('Project archived!'));

    console.log();
    console.log(chalk.dim(`  Archive location: ${chalk.white(archiveDir)}`));
    console.log(chalk.dim(`  Summary:          ${chalk.white(path.join(archiveDir, 'SUMMARY.md'))}`));
    console.log(chalk.dim(`  Tasks completed:  ${chalk.white(`${completedCount}/${totalCount}`)}`));
    console.log();

  } catch (err) {
    spinner.fail('Archive failed');
    console.error(chalk.red(err.message));
    process.exit(1);
  }
}

// ── Summary generator ────────────────────────────────────────────────────────

function generateSummaryMd(config, { archivedAt, completedCount, totalCount, changelog, decisions }) {
  const agentList = config.agents
    .map(a => `- **${a.name}** — ${a.role}`)
    .join('\n');

  // Extract decision count
  const decisionCount = (decisions.match(/^## DEC-\d+/gm) || []).length;

  // Extract last 10 changelog entries
  const logLines = changelog
    .split('\n')
    .filter(l => l.match(/^\[2\d{3}-/))
    .slice(-10);

  return `# Project Summary — ${config.projectName}
<!-- Archived: ${archivedAt} -->

## Overview
- **Goal**: ${config.projectGoal}
- **Type**: ${config.projectType}
- **Stack**: ${config.techStack}
- **Started**: ${config.createdAt?.split('T')[0] || '—'}
- **Archived**: ${archivedAt.split('T')[0]}

## Team
${agentList}

## Outcomes
- **Tasks completed**: ${completedCount}/${totalCount}
- **Decisions recorded**: ${decisionCount}
- **Coordination style**: ${config.coordination.taskStyle}

## Final Changelog (last 10 entries)
\`\`\`
${logLines.join('\n') || '(none)'}
\`\`\`

## Files in This Archive
- \`SUMMARY.md\` — this file
- \`MASTER.md\` — final project state
- \`RULES.md\` — rules used for this project
- \`changelog.md\` — full event log
- \`decisions.md\` — all decisions + reasoning
- \`NOTES.md\` — shared notes
- \`ARCHITECTURE.md\` / \`STYLE_GUIDE.md\` — foundation doc (whichever the project used)
- \`HUMAN_INPUT.md\` — full Q&A history with the human
- \`research/\` — research docs (if any were written)
- \`agents/\` — each agent's final memory doc

---
_Archived by: claude-team archive_
`;
}

// ── Archive index ─────────────────────────────────────────────────────────────

async function updateArchiveIndex(config, archiveDir, dateStr) {
  const indexPath = '.claude-team/docs/archive/INDEX.md';
  let existing = '';
  try { existing = await fs.readFile(indexPath, 'utf8'); } catch {}

  const entry = `- [${config.projectName} (${dateStr})](${path.basename(archiveDir)}/SUMMARY.md)`;

  if (!existing) {
    await fs.writeFile(indexPath,
      `# Archive Index\n<!-- All archived projects -->\n\n## Projects\n${entry}\n`
    );
  } else if (!existing.includes(entry)) {
    await fs.writeFile(indexPath, existing.trimEnd() + '\n' + entry + '\n');
  }
}