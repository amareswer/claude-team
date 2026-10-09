import { describe, it, expect } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import { withTempCwd, minimalConfig, assertTempCwd } from './helpers.js';
import { approveCheck, runTaskChecks } from '../lib/checks.js';
import { requestReview, approveReview, rejectReview, listReviews, reviewDetail } from '../lib/review.js';

const git = (...a) => { assertTempCwd(); return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { stdio: 'pipe' }); };
const master = () => fs.readJson('.claude-team/tasks/master.json');

async function project({ checks, taskExtra = {} } = {}) {
  assertTempCwd();
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

describe('concurrent decisions: exactly one wins, the rest get 409', () => {
  const outcome = (rs) => ({ ok: rs.filter((r) => r.status === 'fulfilled').length, conflicts: rs.filter((r) => r.status === 'rejected' && r.reason.statusCode === 409 && r.reason.code === 'NOT_PENDING').length });

  it('simultaneous rejects: one decision, one inbox message', async () => {
    await withTempCwd(async () => {
      const config = await project();
      await requestReview(config, 'task-1');
      const rs = await Promise.allSettled([
        rejectReview(config, 'task-1', { note: 'first' }),
        rejectReview(config, 'task-1', { note: 'second' }),
        rejectReview(config, 'task-1', { note: 'third' }),
      ]);
      expect(outcome(rs)).toEqual({ ok: 1, conflicts: 2 });
      const rec = await fs.readJson('.claude-team/review-queue/task-1.json');
      const winner = rs.find((r) => r.status === 'fulfilled').value;
      expect(rec.decision.note).toBe(winner.note); // not overwritten by a loser
      expect((await fs.readJson('.claude-team/tasks/backend-inbox.json')).messages).toHaveLength(1);
    });
  });

  it('simultaneous approves: one decision', async () => {
    await withTempCwd(async () => {
      const config = await project();
      await requestReview(config, 'task-1');
      const rs = await Promise.allSettled([approveReview(config, 'task-1', { note: 'a' }), approveReview(config, 'task-1', { note: 'b' })]);
      expect(outcome(rs)).toEqual({ ok: 1, conflicts: 1 });
      expect((await fs.readJson('.claude-team/review-queue/task-1.json')).decision.note).toBe(rs.find((r) => r.status === 'fulfilled').value.note);
    });
  });

  it('approve racing reject (20 rounds): never both; the loser leaves no side effects', async () => {
    for (let i = 0; i < 20; i++) {
      await withTempCwd(async () => {
        const config = await project();
        await requestReview(config, 'task-1');
        const rs = await Promise.allSettled([approveReview(config, 'task-1', { note: 'ok' }), rejectReview(config, 'task-1', { note: 'no' })]);
        expect(outcome(rs)).toEqual({ ok: 1, conflicts: 1 });
        const rec = await fs.readJson('.claude-team/review-queue/task-1.json');
        const status = (await master()).tasks[0].status;
        const msgs = (await fs.readJson('.claude-team/tasks/backend-inbox.json')).messages;
        if (rec.state === 'approved') { expect(status).toBe('done'); expect(msgs).toHaveLength(0); }
        else { expect(rec.state).toBe('rejected'); expect(status).toBe('assigned'); expect(msgs).toHaveLength(1); }
      });
    }
  }, 60000);

  it('a decision made against an OLD request version is refused after a re-request', async () => {
    await withTempCwd(async () => {
      const config = await project();
      const first = await requestReview(config, 'task-1');
      await rejectReview(config, 'task-1', { note: 'redo' });
      const second = await requestReview(config, 'task-1');
      expect(second.requestId).not.toBe(first.requestId);
      await expect(approveReview(config, 'task-1', { expectedRequestId: first.requestId })).rejects.toMatchObject({ code: 'STALE_REQUEST', statusCode: 409 });
      await expect(rejectReview(config, 'task-1', { note: 'x', expectedRequestId: first.requestId })).rejects.toMatchObject({ code: 'STALE_REQUEST' });
      expect((await fs.readJson('.claude-team/review-queue/task-1.json')).state).toBe('pending'); // untouched
      await approveReview(config, 'task-1', { expectedRequestId: second.requestId });
    });
  });
});

describe('base revision: committed work stays visible', () => {
  const commitAt = (date, msg) => (assertTempCwd(), execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-am', msg], { stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } }));

  async function committedWork(taskExtra = {}) {
    assertTempCwd();
    git('init', '-q');
    await fs.writeFile('app.js', 'v0\n');
    await fs.ensureDir('.claude-team/tasks');
    const config = minimalConfig({});
    await fs.writeJson('.claude-team/config.json', config);
    await fs.writeJson('.claude-team/tasks/master.json', { tasks: [{ id: 'task-1', title: 'T', status: 'in_progress', assignedTo: 'backend', createdAt: '2026-02-01T00:00:00Z', ...taskExtra }] });
    await fs.writeJson('.claude-team/tasks/backend-inbox.json', { tasks: [{ id: 'task-1', assignedAt: '2026-02-01T00:00:00Z' }], messages: [] });
    git('add', '-A'); commitAt('2026-01-01T00:00:00Z', 'before assignment');
    const before = execFileSync('git', ['rev-parse', 'HEAD']).toString().trim();
    await fs.writeFile('app.js', 'v1 feature\n'); // agent's work, then committed
    commitAt('2026-03-01T00:00:00Z', 'agent: implement feature');
    return { config, before };
  }

  it('infers the start from the assignment time, so committed work shows up even with a clean tree', async () => {
    await withTempCwd(async () => {
      const { config, before } = await committedWork();
      const rec = await requestReview(config, 'task-1');
      expect(rec).toMatchObject({ baseRevision: before, baseSource: 'inferred from assignment time' });
      const d = await reviewDetail(config, 'task-1');
      expect(d.diff.stat).toContain('app.js');           // diff vs HEAD would have been empty
      expect(d.diff.patch).toContain('+v1 feature');
      expect(d.diff.commits.join('\n')).toContain('agent: implement feature');
    });
  });

  it('prefers a base recorded at assignment, and an explicit --base beats both', async () => {
    await withTempCwd(async () => {
      const { config, before } = await committedWork({ baseRevision: 'HEAD~1' });
      const head = execFileSync('git', ['rev-parse', 'HEAD']).toString().trim();
      expect((await requestReview(config, 'task-1')).baseSource).toBe('recorded at assignment');
      const explicit = await requestReview(config, 'task-1', { baseRevision: head });
      expect(explicit).toMatchObject({ baseRevision: head, baseSource: 'explicit' });
      expect(before).not.toBe(head);
    });
  });

  it('assigned before the first commit: diffs against the empty tree', async () => {
    await withTempCwd(async () => {
      assertTempCwd();
      git('init', '-q');
      await fs.writeFile('app.js', 'only\n');
      await fs.ensureDir('.claude-team/tasks');
      const config = minimalConfig({});
      await fs.writeJson('.claude-team/config.json', config);
      await fs.writeJson('.claude-team/tasks/master.json', { tasks: [{ id: 'task-1', title: 'T', status: 'in_progress', assignedTo: 'backend', createdAt: '2020-01-01T00:00:00Z' }] });
      await fs.writeJson('.claude-team/tasks/backend-inbox.json', { tasks: [], messages: [] });
      git('add', '-A'); commitAt('2026-03-01T00:00:00Z', 'first');
      const rec = await requestReview(config, 'task-1');
      expect(rec.baseSource).toBe('inferred (no commits before assignment)');
      expect((await reviewDetail(config, 'task-1')).diff.stat).toContain('app.js');
    });
  });
});
