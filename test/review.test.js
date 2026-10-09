import { describe, it, expect } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import { withTempCwd, minimalConfig } from './helpers.js';
import { approveCheck, runTaskChecks } from '../lib/checks.js';
import { requestReview, approveReview, rejectReview, listReviews, reviewDetail } from '../lib/review.js';

const git = (...a) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { stdio: 'pipe' });
const master = () => fs.readJson('.claude-team/tasks/master.json');

async function project({ checks, taskExtra = {} } = {}) {
  git('init', '-q');
  await fs.writeFile('app.js', 'one\n');
  await fs.ensureDir('.claude-team/tasks');
  const config = minimalConfig({ checks });
  await fs.writeJson('.claude-team/config.json', config);
  const task = { id: 'task-1', title: 'Login API', status: 'in_progress', assignedTo: 'backend', acceptanceCriteria: ['401 on bad login'], ...(checks ? { checks: Object.keys(checks) } : {}), ...taskExtra };
  for (const f of ['master', 'queue']) await fs.writeJson(`.claude-team/tasks/${f}.json`, { tasks: [{ ...task }] });
  await fs.writeJson('.claude-team/tasks/backend-inbox.json', { tasks: [], messages: [] });
  await fs.writeJson('.claude-team/tasks/backend-outbox.json', { completedTasks: [{ id: 'task-1', title: 'Login API', completedAt: '2026-10-01T00:00:00Z', summary: 'Added /login with 401 handling', filesChanged: ['app.js'], notes: 'uses bcrypt' }] });
  git('add', '-A'); git('commit', '-q', '-m', 'init');
  return config;
}

describe('requestReview', () => {
  it('bundles the agent explanation, criteria and check state, and sets the task to review', async () => {
    await withTempCwd(async () => {
      const config = await project();
      const rec = await requestReview(config, 'task-1');
      expect(rec).toMatchObject({ state: 'pending', summary: 'Added /login with 401 handling', filesChanged: ['app.js'], agentNotes: 'uses bcrypt', assignedTo: 'backend' });
      expect(rec.acceptanceCriteria).toEqual(['401 on bad login']);
      expect(rec.requested.checks).toBe('none');
      expect((await master()).tasks[0].status).toBe('review');
      expect((await fs.readJson('.claude-team/tasks/queue.json')).tasks[0].status).toBe('review');
    });
  });
  it('rejects unsafe ids, unknown tasks and finished tasks', async () => {
    await withTempCwd(async () => {
      const config = await project({ taskExtra: {} });
      await expect(requestReview(config, '../../etc/passwd')).rejects.toThrow(/Invalid task id/);
      await expect(requestReview(config, 'nope')).rejects.toMatchObject({ code: 'TASK_NOT_FOUND' });
      const m = await master(); m.tasks[0].status = 'done'; await fs.writeJson('.claude-team/tasks/master.json', m);
      await expect(requestReview(config, 'task-1')).rejects.toThrow(/already done/);
    });
  });
});

describe('approve / reject', () => {
  it('approve marks the task done only after a pending review, and only once', async () => {
    await withTempCwd(async () => {
      const config = await project();
      await expect(approveReview(config, 'task-1')).rejects.toMatchObject({ code: 'NO_REVIEW' });
      await requestReview(config, 'task-1');
      const d = await approveReview(config, 'task-1', { note: 'lgtm' });
      expect(d).toMatchObject({ by: 'human', note: 'lgtm', checks: 'none' });
      expect((await master()).tasks[0].status).toBe('done');
      await expect(approveReview(config, 'task-1')).rejects.toMatchObject({ code: 'NOT_PENDING' });
    });
  });

  it('refuses approval while checks fail or are stale unless explicitly accepted — and records that', async () => {
    await withTempCwd(async () => {
      await project({ checks: { unit: { command: 'exit 1' } } });
      await approveCheck('unit');
      const config = await fs.readJson('.claude-team/config.json');
      await runTaskChecks(config, 'task-1');
      await requestReview(config, 'task-1');
      await expect(approveReview(config, 'task-1')).rejects.toMatchObject({ code: 'CHECKS_NOT_PASSED' });
      expect((await master()).tasks[0].status).toBe('review'); // untouched by the refusal
      const d = await approveReview(config, 'task-1', { acceptUnverified: true });
      expect(d).toMatchObject({ acceptedUnverified: true, checks: 'failed' });
      expect((await master()).tasks[0].status).toBe('done');
    });
  });

  it('passing checks alone never approve: task stays in review until the human decides', async () => {
    await withTempCwd(async () => {
      await project({ checks: { unit: { command: 'true' } } });
      await approveCheck('unit');
      const config = await fs.readJson('.claude-team/config.json');
      await runTaskChecks(config, 'task-1');
      await requestReview(config, 'task-1');
      expect((await listReviews(config, { state: 'pending' }))[0].live.checks.overall).toBe('passed');
      expect((await master()).tasks[0].status).toBe('review');
      await approveReview(config, 'task-1');
      expect((await master()).tasks[0].status).toBe('done');
    });
  });

  it('code edited after checks passed makes approval require acceptance (stale)', async () => {
    await withTempCwd(async () => {
      await project({ checks: { unit: { command: 'true' } } });
      await approveCheck('unit');
      const config = await fs.readJson('.claude-team/config.json');
      await runTaskChecks(config, 'task-1');
      await requestReview(config, 'task-1');
      await fs.writeFile('app.js', 'two\n');
      const [r] = await listReviews(config, { state: 'pending' });
      expect(r.live).toMatchObject({ codeChanged: true });
      await expect(approveReview(config, 'task-1')).rejects.toMatchObject({ code: 'CHECKS_NOT_PASSED' });
    });
  });

  it('reject needs a note, returns the task to its assignee with feedback, and can be re-requested', async () => {
    await withTempCwd(async () => {
      const config = await project();
      await requestReview(config, 'task-1');
      await expect(rejectReview(config, 'task-1', { note: '  ' })).rejects.toThrow(/needs a note/);
      await rejectReview(config, 'task-1', { note: 'handle empty password' });
      expect((await master()).tasks[0].status).toBe('assigned');
      const inbox = await fs.readJson('.claude-team/tasks/backend-inbox.json');
      expect(inbox.messages[0]).toMatchObject({ type: 'review_rejected', taskId: 'task-1' });
      expect(inbox.messages[0].message).toContain('handle empty password');
      await expect(rejectReview(config, 'task-1', { note: 'again' })).rejects.toMatchObject({ code: 'NOT_PENDING' });
      const again = await requestReview(config, 'task-1');
      expect(again.state).toBe('pending');
      expect(again.history[0]).toMatchObject({ state: 'rejected' });
    });
  });
});

describe('reviewDetail', () => {
  it('shows the diff (tracked + untracked) and truncates long patches', async () => {
    await withTempCwd(async () => {
      const config = await project();
      await fs.writeFile('app.js', Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n'));
      await fs.writeFile('added.js', 'x');
      await requestReview(config, 'task-1');
      const d = await reviewDetail(config, 'task-1', { maxDiffLines: 10 });
      expect(d.diff.stat).toContain('app.js');
      expect(d.diff.untracked).toContain('added.js');
      expect(d.diff.truncated).toBe(true);
      expect(d.diff.patch.split('\n').length).toBe(10);
      expect(d.diff.stat).not.toContain('.claude-team');
    });
  });
  it('a corrupt review record fails loudly instead of vanishing from the queue', async () => {
    await withTempCwd(async () => {
      const config = await project();
      await requestReview(config, 'task-1');
      await fs.writeFile('.claude-team/review-queue/task-1.json', '{broken');
      await expect(listReviews(config)).rejects.toThrow();
    });
  });
});

describe('human-only decisions', () => {
  it('the CLI refuses approve/reject without an interactive terminal', async () => {
    await withTempCwd(async () => {
      await project();
      for (const args of [['review', 'approve', 'task-1'], ['review', 'reject', 'task-1', '-m', 'no']]) {
        const r = spawnSync(process.execPath, [path.resolve(import.meta.dirname, '../bin/claude-team.js'), ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        expect(r.status).toBe(1);
        expect(r.stderr).toMatch(/interactive terminal/);
      }
      expect((await master()).tasks[0].status).toBe('in_progress');
    });
  });
});
