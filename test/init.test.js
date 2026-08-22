import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs-extra';
import inquirer from 'inquirer';
import { withTempCwd } from './helpers.js';

vi.mock('inquirer', () => ({ default: { prompt: vi.fn() } }));
// init.js's ora spinner writes control codes straight to stdout; keep test
// output clean without changing runInit's behavior.
vi.mock('ora', () => ({
  default: () => ({ start: () => ({ succeed() {}, fail() {}, set text(_) {} }) }),
}));

/**
 * A fresh mock per test: `inquirer.prompt(questions)` looks up an answer
 * for each question by its `name` in `answers`, regardless of call order —
 * robust against runInit's exact prompt sequence changing over time. Only
 * the specific fields each test cares about need to be listed.
 */
function stubAnswers(answers) {
  inquirer.prompt.mockImplementation(async (questions) => {
    const list = Array.isArray(questions) ? questions : [questions];
    const result = {};
    for (const q of list) {
      if (!(q.name in answers)) {
        throw new Error(`No stubbed answer for prompt "${q.name}" (message: ${q.message})`);
      }
      result[q.name] = answers[q.name];
    }
    return result;
  });
}

const baseAnswers = {
  projectName: 'Smoke Test',
  projectGoal: 'Verify the cost warning gate',
  projectCategory: 'technical',
  projectType: 'cli',
  techStack: 'node-ts',
  hierarchyType: 'simple', // no leadership roles — keeps the agent-count math simple
  teamSize: 2,
  name: 'worker', role: 'Worker', responsibilities: 'Do the thing',
  modelStrategy: 'recommended',
  taskStyle: 'queue', useGit: true, enableReview: false, pollInterval: '10',
  enableCrossSessionMessaging: false,
  addTask: false,
};

beforeEach(() => {
  inquirer.prompt.mockReset();
});

describe('runInit — cost/scale warning gate', () => {
  it('stops before generating anything when the human declines the team size', async () => {
    await withTempCwd(async () => {
      stubAnswers({ ...baseAnswers, confirmTeamSize: false });
      const { runInit } = await import('../lib/init.js');
      await runInit();

      expect(await fs.pathExists('.claude-team/config.json')).toBe(false);
      expect(await fs.pathExists('CLAUDE.md')).toBe(false);
      // The gate fires before any per-worker detail prompts — "worker" name
      // question is never reached. Exactly 5 prompt() calls happen before
      // it: basics, tech-stack sub-answers, hierarchy, team size, and the
      // gate's own confirm.
      expect(inquirer.prompt.mock.calls.length).toBe(5);
    });
  });

  it('proceeds to generate the full team once the human confirms', async () => {
    await withTempCwd(async () => {
      stubAnswers({ ...baseAnswers, confirmTeamSize: true });
      const { runInit } = await import('../lib/init.js');
      await runInit();

      expect(await fs.pathExists('.claude-team/config.json')).toBe(true);
      const config = await fs.readJson('.claude-team/config.json');
      // simple hierarchy → 0 leadership + 2 workers, orchestrator implicit
      expect(config.agents).toHaveLength(2);
      expect(await fs.pathExists('CLAUDE.md')).toBe(true);
    });
  });

  it('shows the correct total agent count (orchestrator + leadership + workers) before asking to confirm', async () => {
    await withTempCwd(async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      stubAnswers({ ...baseAnswers, hierarchyType: 'standard', teamSize: 3, confirmTeamSize: false });
      const { runInit } = await import('../lib/init.js');
      await runInit();

      // standard/technical → 1 leadership (project-manager) + 3 workers + 1 orchestrator = 5
      const printed = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(printed).toContain('5 agents');
      expect(printed).toMatch(/5 full Claude Code sessions? running concurrently/);
      logSpy.mockRestore();
    });
  });
});
