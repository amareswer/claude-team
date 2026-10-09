import { describe, it, expect } from 'vitest';
import fs from 'fs-extra';
import { execFileSync } from 'child_process';
import { withTempCwd, minimalConfig, assertTempCwd } from './helpers.js';
import { approveCheck, approvalState, runTaskChecks, taskCheckStatus, codeState } from '../lib/checks.js';

const sh = (...a) => { assertTempCwd(); return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { stdio: 'pipe' }); };

async function project(checks, task = {}) {
  assertTempCwd();
  sh('init', '-q');
  await fs.writeFile('app.txt', 'v1\n');
  await fs.ensureDir('.claude-team/tasks');
  const config = minimalConfig({ checks });
  await fs.writeJson('.claude-team/config.json', config);
  const t = { id: 'task-1', title: 'T', status: 'in_progress', checks: Object.keys(checks), ...task };
  await fs.writeJson('.claude-team/tasks/master.json', { tasks: [t] });
  sh('add', '-A'); sh('commit', '-q', '-m', 'init');
  return { config, task: t };
}
const reload = () => fs.readJson('.claude-team/config.json');

describe('approval gate', () => {
  it('refuses to run unapproved or changed checks, and runs nothing', async () => {
    await withTempCwd(async () => {
      const { config } = await project({ unit: { command: 'touch RAN', timeoutSeconds: 5 } });
      expect(approvalState(config, 'unit')).toBe('unapproved');
      await expect(runTaskChecks(config, 'task-1')).rejects.toMatchObject({ code: 'NOT_APPROVED' });
      expect(await fs.pathExists('RAN')).toBe(false);

      await approveCheck('unit');
      let c = await reload();
      expect(approvalState(c, 'unit')).toBe('approved');

      c.checks.unit.command = 'touch RAN && echo tampered';
      expect(approvalState(c, 'unit')).toBe('changed');
      await expect(runTaskChecks(c, 'task-1')).rejects.toMatchObject({ code: 'NOT_APPROVED' });
      expect(await fs.pathExists('RAN')).toBe(false);
    });
  });
});

describe('running checks', () => {
  it('records exit code, timestamps, revision; never changes task status', async () => {
    await withTempCwd(async () => {
      await project({ ok: { command: 'echo hello' }, bad: { command: 'echo nope >&2; exit 3' } });
      await approveCheck('ok'); await approveCheck('bad');
      const config = await reload();
      const recs = await runTaskChecks(config, 'task-1');
      expect(recs.find((r) => r.check === 'ok')).toMatchObject({ passed: true, exitCode: 0 });
      expect(recs.find((r) => r.check === 'bad')).toMatchObject({ passed: false, exitCode: 3 });
      expect(recs.find((r) => r.check === 'bad').outputTail).toContain('nope');
      const r = recs[0];
      expect(r.revision).toMatch(/^[0-9a-f]{40}$/);
      expect(Date.parse(r.finishedAt)).toBeGreaterThanOrEqual(Date.parse(r.startedAt));
      const saved = await fs.readJson('.claude-team/checks/task-1.json');
      expect(saved.latest.ok.passed).toBe(true);
      // a passing/failing run is evidence only — the task itself is untouched
      expect((await fs.readJson('.claude-team/tasks/master.json')).tasks[0].status).toBe('in_progress');
      const st = await taskCheckStatus(config, (await fs.readJson('.claude-team/tasks/master.json')).tasks[0]);
      expect(st.overall).toBe('failed');
    });
  });

  it('kills a command that exceeds its timeout', async () => {
    await withTempCwd(async () => {
      await project({ slow: { command: 'sleep 10', timeoutSeconds: 0.4 } });
      await approveCheck('slow');
      const t0 = Date.now();
      const [r] = await runTaskChecks(await reload(), 'task-1');
      expect(Date.now() - t0).toBeLessThan(5000);
      expect(r).toMatchObject({ timedOut: true, passed: false });
    });
  });

  it('bounds captured output', async () => {
    await withTempCwd(async () => {
      await project({ loud: { command: 'head -c 600000 /dev/zero | tr "\\0" x' } });
      await approveCheck('loud');
      const [r] = await runTaskChecks(await reload(), 'task-1');
      expect(r.outputTail.length).toBeLessThanOrEqual(64 * 1024);
      expect(r.truncated).toBe(true);
      expect(r.passed).toBe(true);
    });
  });

  it('refuses a working directory outside the project', async () => {
    await withTempCwd(async () => {
      await project({ ok: { command: 'true' } }, { workingDir: '..' });
      await approveCheck('ok');
      await expect(runTaskChecks(await reload(), 'task-1')).rejects.toThrow(/outside the project/);
    });
  });
});

describe('staleness', () => {
  it('a result goes stale when tracked or untracked code changes, and is fresh again if restored', async () => {
    await withTempCwd(async () => {
      const { task } = await project({ unit: { command: 'true' } });
      await approveCheck('unit');
      const config = await reload();
      expect((await taskCheckStatus(config, task)).overall).toBe('not_run');
      await runTaskChecks(config, 'task-1');
      expect((await taskCheckStatus(config, task)).overall).toBe('passed');

      await fs.writeFile('app.txt', 'v2\n');
      expect((await taskCheckStatus(config, task)).overall).toBe('stale');
      await fs.writeFile('app.txt', 'v1\n');
      expect((await taskCheckStatus(config, task)).overall).toBe('passed');

      await fs.writeFile('new-file.js', 'x');
      expect((await taskCheckStatus(config, task)).overall).toBe('stale');
    });
  });

  it('is stale when the check definition changes after the run', async () => {
    await withTempCwd(async () => {
      const { task } = await project({ unit: { command: 'true' } });
      await approveCheck('unit');
      const config = await reload();
      await runTaskChecks(config, 'task-1');
      config.checks.unit.command = 'true && true';
      expect((await taskCheckStatus(config, task)).overall).toBe('stale');
    });
  });

  it('codeState ignores .claude-team churn', async () => {
    await withTempCwd(async () => {
      await project({ unit: { command: 'true' } });
      const a = await codeState('.');
      await fs.writeJson('.claude-team/tasks/backend-status.json', { x: Date.now() });
      expect((await codeState('.')).fingerprint).toBe(a.fingerprint);
    });
  });
});
