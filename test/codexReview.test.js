import { describe, it, expect } from 'vitest';
import fs from 'fs-extra';
import { execFileSync } from 'child_process';
import { withTempCwd, minimalConfig, assertTempCwd } from './helpers.js';
import { requestReview, reviewDetail } from '../lib/review.js';
import { codexReview, buildCodexPrompt } from '../lib/codexReview.js';

const git = (...a) => { assertTempCwd(); return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { stdio: 'pipe' }); };

async function project() {
  assertTempCwd();
  git('init', '-q');
  await fs.writeFile('app.js', 'one\n');
  await fs.ensureDir('.claude-team/tasks');
  const config = minimalConfig();
  await fs.writeJson('.claude-team/config.json', config);
  const task = { id: 'task-1', title: 'Login API', status: 'in_progress', assignedTo: 'backend', acceptanceCriteria: ['401 on bad login'] };
  for (const f of ['master', 'queue']) await fs.writeJson(`.claude-team/tasks/${f}.json`, { tasks: [{ ...task }] });
  await fs.writeJson('.claude-team/tasks/backend-inbox.json', { tasks: [], messages: [] });
  await fs.writeJson('.claude-team/tasks/backend-outbox.json', { completedTasks: [{ id: 'task-1', title: 'Login API', completedAt: '2026-10-01T00:00:00Z', summary: 'Added /login', filesChanged: ['app.js'] }] });
  git('add', '-A'); git('commit', '-q', '-m', 'init');
  await fs.writeFile('app.js', 'one\ntwo\n');
  return config;
}

describe('codexReview', () => {
  it('sends task, criteria and diff to Codex and saves a peer review note', async () => {
    await withTempCwd(async () => {
      const config = await project();
      await requestReview(config, 'task-1');
      let seen = '';
      const file = await codexReview(config, 'task-1', { run: async (p) => { seen = p; return 'Looks fine.\nSAFE TO MERGE\n'; } });
      expect(seen).toMatch(/401 on bad login/);
      expect(seen).toMatch(/\+two/);
      expect(file.endsWith('.claude-team/reviews/task-1-codex.md')).toBe(true);
      expect(await fs.readFile(file, 'utf8')).toMatch(/SAFE TO MERGE/);
      expect((await reviewDetail(config, 'task-1')).peerReviews).toContain('.claude-team/reviews/task-1-codex.md');
    });
  });
  it('refuses an empty Codex answer instead of saving a blank review', async () => {
    await withTempCwd(async () => {
      const config = await project();
      await requestReview(config, 'task-1');
      await expect(codexReview(config, 'task-1', { run: async () => '  \n' })).rejects.toThrow(/no review text/);
      expect(await fs.pathExists('.claude-team/reviews/task-1-codex.md')).toBe(false);
    });
  });
  it('says so when the diff is unavailable', () => {
    expect(buildCodexPrompt({ taskId: 't', title: 'x', diff: { error: 'bad base' } })).toMatch(/diff unavailable: bad base/);
  });
});
