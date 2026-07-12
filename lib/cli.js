import { Command } from 'commander';
import { createRequire } from 'module';
import { runInit } from './init.js';
import { runStart } from './start.js';
import { runStatus } from './status.js';
import { runAdd } from './add.js';
import { runRemove } from './remove.js';
import { runArchive } from './archive.js';
import { runOffice } from './office.js';

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
program.command('office')
  .description('🏢 Open a live visual office view of your team in the browser')
  .option('-p, --port <port>', 'port to serve on', '4753')
  .action(runOffice);