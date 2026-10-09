import { Command } from 'commander';
import { createRequire } from 'module';
import { runInit } from './init.js';
import { runStart } from './start.js';
import { runStatus } from './status.js';
import { runAdd } from './add.js';
import { runRemove } from './remove.js';
import { runArchive } from './archive.js';
import { runOffice } from './office.js';
import { runResume } from './resume.js';
import { runCheckCommand, runChecksList, runChecksApprove } from './checks.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

export const program = new Command();

program
  .name('claude-team')
  .description('🤖 Multi-agent coordination for Claude Code — with token safety and living docs')
  .version(pkg.version);

program.command('init').description('Set up a new Claude team for this project').action(runInit);
program.command('start').description('Show launch instructions for every agent').action(runStart);
program.command('status').description('Live status — agents, token usage, doc health').action(runStatus);
program.command('add').description('Add a new agent to an existing team').action(runAdd);
program.command('remove').description('Remove an agent from the team').action(runRemove);
program.command('archive').description('Archive completed project docs (human-triggered)').action(runArchive);
program.command('resume')
  .description('Summarise where the project stands — finished, blocked, needs you, next steps (no agent session)')
  .option('--json', 'machine-readable output')
  .action(runResume);
program.command('check <task-id>')
  .description('Run a task\'s approved acceptance checks and save the results (does not change task status)')
  .action(runCheckCommand);
const checks = program.command('checks').description('List acceptance checks and their approval state').action(runChecksList);
checks.command('approve <name>').description('Approve a check\'s command (human, interactive terminal only)').action(runChecksApprove);
program.command('office')
  .description('🏢 Open a live visual office view of your team in the browser')
  .option('-p, --port <port>', 'port to serve on', '4753')
  .option('--no-open', 'don\'t auto-open the browser')
  .action(runOffice);