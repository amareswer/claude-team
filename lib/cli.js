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
import { runCodexReview } from './codexReview.js';
import { runReviewList, runReviewShow, runReviewRequest, runReviewApprove, runReviewReject, runReviewRepair } from './review.js';
import { runPermissions } from './permissions.js';
import { runCheckCommand, runChecksList, runChecksApprove } from './checks.js';
import { enterProjectRoot } from './worktrees.js';

// Run from an agent's worktree, act on the main project but remember where the agent was.
const worktreeRel = enterProjectRoot();
if (worktreeRel) process.env.CLAUDE_TEAM_WORKDIR = worktreeRel;

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

export const program = new Command();

program
  .name('claude-team')
  .description('🤖 Multi-agent coordination for Claude Code — with token safety and living docs')
  .version(pkg.version);

program.command('init').description('Set up a new Claude team for this project').action(runInit);
program.command('permissions').description('Confine agents to this project folder (writes .claude/settings.json); --check to only report').option('--check', 'report what is missing without changing anything').option('--allow-domain <host...>', 'let agents reach this host from the sandbox (e.g. registry.npmjs.org); saved in config.json').option('--remove-domain <host...>', 'stop allowing a host').action(runPermissions);
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
const review = program.command('review').description('Human review queue — what is waiting for you, with diff, checks and the agent\'s explanation').action(runReviewList);
review.command('show <task-id>').description('Diff, checks, criteria and explanation for one task').option('--lines <n>', 'diff lines to show', '300').action(runReviewShow);
review.command('request <task-id>').description('(agents/orchestrator) put a finished task in front of the human').option('-s, --summary <text>', 'what was done, in a sentence or two').option('--base <rev>', 'diff against this revision instead of HEAD').option('--by <name>', 'who is requesting').action(runReviewRequest);
review.command('approve <task-id>').description('(human, interactive) accept the work and mark the task done').option('-m, --message <note>', 'optional note').option('--accept-unverified', 'approve even though checks have not passed on the current code').action(runReviewApprove);
review.command('reject <task-id>').description('(human, interactive) send back with feedback for the assignee').requiredOption('-m, --message <note>', 'what needs to change').action(runReviewReject);
review.command('codex <task-id>').description('Ask the Codex CLI for a read-only second opinion on a task\'s diff (sends the diff to Codex; saved under .claude-team/reviews/)').option('--lines <n>', 'diff lines to send', '1500').action(runCodexReview);
review.command('repair').description('Finish decisions an interruption left half-applied (idempotent)').option('--dry-run', 'only list what would be done').action(runReviewRepair);
program.command('office')
  .description('🏢 Open a live visual office view of your team in the browser')
  .option('-p, --port <port>', 'port to serve on', '4753')
  .option('--no-open', 'don\'t auto-open the browser')
  .action(runOffice);