import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import { execFileSync } from 'child_process';
import { withTempCwd, minimalConfig, assertTempCwd } from './helpers.js';
import { shouldUseWorktrees, ensureWorktree, removeWorktree, enterProjectRoot, worktreeSettingsFor, WORKTREE_DIR } from '../lib/worktrees.js';
import { applyWorktreePermissions } from '../lib/permissions.js';
import { requestReview, reviewDetail } from '../lib/review.js';

const git = (cwd, ...a) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd, stdio: 'pipe' }).toString();

// A project whose .claude-team is committed (the awkward case for worktrees).
async function repo() {
  assertTempCwd();
  git('.', 'init', '-q', '-b', 'main');
  await fs.outputJson('.claude-team/config.json', minimalConfig());
  for (const f of ['master', 'queue']) await fs.outputJson(`.claude-team/tasks/${f}.json`, { tasks: [
    { id: 'task-a', title: 'A', status: 'assigned', assignedTo: 'adder' },
    { id: 'task-b', title: 'B', status: 'assigned', assignedTo: 'multiplier' },
  ] });
  await fs.outputJson('.claude-team/tasks/adder-outbox.json', { completedTasks: [] });
  await fs.writeFile('CLAUDE.md', 'rules\n');
  await fs.writeFile('base.js', 'base\n');
  git('.', 'add', '-A'); git('.', 'commit', '-q', '-m', 'init');
  return fs.realpath('.');
}

describe('shouldUseWorktrees', () => {
  const workers = (n) => ({ agents: Array.from({ length: n }, (_, i) => ({ name: 'w' + i })) });
  it('is on by default only for git projects with two or more workers', () => {
    expect(shouldUseWorktrees(workers(2), true)).toBe(true);
    expect(shouldUseWorktrees(workers(1), true)).toBe(false);
    expect(shouldUseWorktrees(workers(3), false)).toBe(false);
  });
  it('does not count leadership agents, and honours the config override', () => {
    expect(shouldUseWorktrees({ agents: [{ name: 'a' }, { name: 'lead', isLeadership: true }] }, true)).toBe(false);
    expect(shouldUseWorktrees({ ...workers(1), worktrees: true }, true)).toBe(true);
    expect(shouldUseWorktrees({ ...workers(4), worktrees: false }, true)).toBe(false);
    expect(shouldUseWorktrees({ ...workers(4), worktrees: true }, false)).toBe(false);
  });
});

describe('ensureWorktree', () => {
  it('creates an isolated checkout with the team files linked in, and git sees it as clean', async () => {
    await withTempCwd(async () => {
      const root = await repo();
      const dir = await ensureWorktree('adder', root);
      expect(dir).toBe(path.join(root, WORKTREE_DIR, 'adder'));
      expect(await fs.pathExists(path.join(dir, 'base.js'))).toBe(true);
      expect((await fs.lstat(path.join(dir, '.claude-team'))).isSymbolicLink()).toBe(true);
      expect(await fs.realpath(path.join(dir, '.claude-team'))).toBe(path.join(root, '.claude-team'));
      expect(git(dir, 'status', '--short')).toBe('');
      // a team file written through the link lands in the main project, and a commit here never touches it
      await fs.writeJson(path.join(dir, '.claude-team/tasks/adder-outbox.json'), { completedTasks: [{ id: 'task-a' }] });
      await fs.writeFile(path.join(dir, 'add.js'), 'add\n');
      git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'adder work');
      expect((await fs.readJson(path.join(root, '.claude-team/tasks/adder-outbox.json'))).completedTasks).toHaveLength(1);
      expect(git(dir, 'show', '--name-only', '--format=', 'HEAD').trim()).toBe('add.js');
    });
  });
  it('is idempotent and keeps the same checkout', async () => {
    await withTempCwd(async () => {
      const root = await repo();
      const a = await ensureWorktree('adder', root);
      await fs.writeFile(path.join(a, 'wip.txt'), 'keep me');
      expect(await ensureWorktree('adder', root)).toBe(a);
      expect(await fs.readFile(path.join(a, 'wip.txt'), 'utf8')).toBe('keep me');
    });
  });
  it('gives each agent its own HEAD, so branches never stack on each other', async () => {
    await withTempCwd(async () => {
      const root = await repo();
      const a = await ensureWorktree('adder', root), m = await ensureWorktree('multiplier', root);
      git(a, 'switch', '-q', '-c', 'adder/task-a', 'main');
      git(m, 'switch', '-q', '-c', 'multiplier/task-b', 'main');
      await fs.writeFile(path.join(a, 'add.js'), 'add\n'); git(a, 'add', '-A'); git(a, 'commit', '-q', '-m', 'add');
      await fs.writeFile(path.join(m, 'mul.js'), 'mul\n'); git(m, 'add', '-A'); git(m, 'commit', '-q', '-m', 'mul');
      expect(git(root, 'log', '--oneline', 'main..adder/task-a').trim().split('\n')).toHaveLength(1);
      expect(git(root, 'log', '--oneline', 'main..multiplier/task-b').trim().split('\n')).toHaveLength(1);
      expect(git(root, 'branch', '--show-current').trim()).toBe('main');
    });
  });
  it('copies CLAUDE.md when it is not tracked, without leaving untracked noise', async () => {
    await withTempCwd(async () => {
      const root = await repo();
      git(root, 'rm', '-q', '--cached', 'CLAUDE.md'); git(root, 'commit', '-q', '-m', 'untrack');
      const dir = await ensureWorktree('adder', root);
      expect(await fs.readFile(path.join(dir, 'CLAUDE.md'), 'utf8')).toBe('rules\n');
      expect(git(dir, 'status', '--short')).toBe('');
    });
  });
  it('explains itself when the repository has no commit yet', async () => {
    await withTempCwd(async () => {
      assertTempCwd(); git('.', 'init', '-q', '-b', 'main');
      await expect(ensureWorktree('adder', await fs.realpath('.'))).rejects.toThrow(/at least one commit/);
    });
  });
});

describe('removeWorktree', () => {
  it('removes the checkout without following the link into the real team files', async () => {
    await withTempCwd(async () => {
      const root = await repo();
      const dir = await ensureWorktree('adder', root);
      expect(await removeWorktree('adder', root)).toBe(true);
      expect(await fs.pathExists(dir)).toBe(false);
      expect(await fs.pathExists(path.join(root, '.claude-team/config.json'))).toBe(true);
      expect(git(root, 'worktree', 'list')).not.toMatch(/adder/);
      expect(await removeWorktree('adder', root)).toBe(false);
    });
  });
});

describe('enterProjectRoot', () => {
  it('from a worktree: switches to the main project and reports where it was; elsewhere: does nothing', async () => {
    await withTempCwd(async () => {
      const root = await repo();
      expect(enterProjectRoot()).toBeNull();
      const dir = await ensureWorktree('adder', root);
      const prev = process.cwd();
      try {
        process.chdir(dir);
        expect(enterProjectRoot()).toBe('.claude-worktrees/adder');
        expect(await fs.realpath(process.cwd())).toBe(root);
      } finally { process.chdir(prev); }
    });
  });
});

describe('review from a worktree', () => {
  afterEach(() => { delete process.env.CLAUDE_TEAM_WORKDIR; });
  it('records where the work is and shows only that agent\'s commit, even with a sibling committing in parallel', async () => {
    await withTempCwd(async () => {
      const root = await repo();
      const config = minimalConfig();
      const a = await ensureWorktree('adder', root), m = await ensureWorktree('multiplier', root);
      git(a, 'switch', '-q', '-c', 'adder/task-a', 'main');
      git(m, 'switch', '-q', '-c', 'multiplier/task-b', 'main');
      await fs.writeFile(path.join(m, 'mul.js'), 'mul\n'); git(m, 'add', '-A'); git(m, 'commit', '-q', '-m', 'mul');
      await fs.writeFile(path.join(a, 'add.js'), 'add\n'); git(a, 'add', '-A'); git(a, 'commit', '-q', '-m', 'add');
      process.env.CLAUDE_TEAM_WORKDIR = '.claude-worktrees/adder';
      await requestReview(config, 'task-a', { baseRevision: 'main' });
      delete process.env.CLAUDE_TEAM_WORKDIR;
      const master = (await fs.readJson('.claude-team/tasks/master.json')).tasks;
      expect(master.find((t) => t.id === 'task-a').workingDir).toBe('.claude-worktrees/adder');
      expect(master.find((t) => t.id === 'task-b').workingDir).toBeUndefined();
      const d = await reviewDetail(config, 'task-a');
      expect(d.diff.commits).toHaveLength(1);
      expect(d.diff.commits[0]).toMatch(/add/);
      expect(d.diff.stat).toMatch(/add\.js/);
      expect(d.diff.stat).not.toMatch(/mul\.js/);
    });
  });
});

describe('review requested from the main folder (the orchestrator\'s usual way)', () => {
  it('looks at the assignee\'s worktree, not the main checkout', async () => {
    await withTempCwd(async () => {
      const root = await repo();
      const config = minimalConfig();
      const a = await ensureWorktree('adder', root);
      git(a, 'switch', '-q', '-c', 'adder/task-a', 'main');
      await fs.writeFile(path.join(a, 'add.js'), 'add\n'); git(a, 'add', '-A'); git(a, 'commit', '-q', '-m', 'add');
      delete process.env.CLAUDE_TEAM_WORKDIR;
      await requestReview(config, 'task-a', { baseRevision: 'main' }); // cwd is the main folder
      expect((await fs.readJson('.claude-team/tasks/master.json')).tasks.find((t) => t.id === 'task-a').workingDir).toBe('.claude-worktrees/adder');
      const d = await reviewDetail(config, 'task-a');
      expect(d.diff.commits).toHaveLength(1);
      expect(d.diff.stat).toMatch(/add\.js/);
    });
  });
  it('leaves the task alone when the assignee has no worktree', async () => {
    await withTempCwd(async () => {
      await repo();
      await requestReview(minimalConfig(), 'task-b', { baseRevision: 'main' });
      expect((await fs.readJson('.claude-team/tasks/master.json')).tasks.find((t) => t.id === 'task-b').workingDir).toBeUndefined();
    });
  });
});

describe('applyWorktreePermissions', () => {
  it('writes the shared-files grants into the worktree settings.local.json, idempotently, keeping user keys', async () => {
    await withTempCwd(async () => {
      const root = await repo();
      const dir = await ensureWorktree('adder', root);
      await fs.outputJson(path.join(dir, '.claude/settings.local.json'), { env: { X: '1' }, sandbox: { filesystem: { allowWrite: ['/mine'] } } });
      await applyWorktreePermissions(dir, root);
      const w = worktreeSettingsFor(root);
      const s = await fs.readJson(path.join(dir, '.claude/settings.local.json'));
      expect(s.env).toEqual({ X: '1' });
      expect(s.permissions.additionalDirectories).toEqual(w.additionalDirectories);
      expect(s.sandbox.filesystem.allowWrite).toEqual(['/mine', ...w.allowWrite]);
      expect(s.permissions.deny).toEqual(w.deny); // config.json stays off limits via the link
      const before = JSON.stringify(s);
      await applyWorktreePermissions(dir, root);
      expect(JSON.stringify(await fs.readJson(path.join(dir, '.claude/settings.local.json')))).toBe(before);
    });
  });
});
