import { Command } from 'commander';
import { runInit } from './init.js';
import { runStart } from './start.js';
import { runStatus } from './status.js';
import { runAdd } from './add.js';
import { runArchive } from './archive.js';

export const program = new Command();

program
  .name('claude-team')
  .description('🤖 Multi-agent coordination for Claude Code — with token safety and living docs')
  .version('2.0.0');

program.command('init').description('Set up a new Claude team for this project').action(runInit);
program.command('start').description('Show launch instructions for every agent').action(runStart);
program.command('status').description('Live status — agents, token usage, doc health').action(runStatus);
program.command('add').description('Add a new agent to an existing team').action(runAdd);
program.command('archive').description('Archive completed project docs (human-triggered)').action(runArchive);