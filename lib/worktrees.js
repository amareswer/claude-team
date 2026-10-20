import fs from 'fs-extra';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

// One git worktree per worker agent, so two agents committing in parallel
// don't share a working directory and HEAD (which made one agent's branch
// start from another's, and put both agents' work in each review diff).
//
// A worktree is a second checkout of the same repository, so the agent's
// commits, branches and the review diff all work against the one repo. It
// lives inside the project (.claude-worktrees/<agent>, gitignored) and the
// agent's cwd is that folder. The team's coordination files stay in the main
// checkout: the worktree gets a `.claude-team` symlink to them, so every
// `.claude-team/...` path in the agent docs keeps working, and `claude-team`
// run from a worktree acts on the main project (see enterProjectRoot).

const run = promisify(execFile);
export const WORKTREE_DIR = '.claude-worktrees';

const git = (args, cwd) => run('git', args, { cwd, maxBuffer: 16 * 1024 * 1024 }).then((r) => r.stdout);

export const isGitProject = (root = '.') => fs.pathExists(path.join(root, '.git'));

/** On by default only when there are parallel workers to keep apart; config.worktrees true/false overrides. */
export function shouldUseWorktrees(config, isGit) {
  if (!isGit || config?.worktrees === false) return false;
  if (config?.worktrees === true) return true;
  return (config?.agents || []).filter((a) => !a.isLeadership).length >= 2;
}

async function commonGitDir(cwd) {
  const out = (await git(['rev-parse', '--git-common-dir'], cwd)).trim();
  return path.resolve(cwd, out);
}

// Paths that exist only as links/copies in a worktree must not show up as
// untracked there. info/exclude lives in the shared git dir (git reads no
// per-worktree one), so these lines apply to the main checkout as well — they
// only ever hide untracked files, never tracked ones.
async function excludeLocally(root, lines) {
  const file = path.join(await commonGitDir(root), 'info', 'exclude');
  let text = '';
  try { text = await fs.readFile(file, 'utf8'); } catch {}
  const have = new Set(text.split('\n').map((l) => l.trim()));
  const add = lines.filter((l) => !have.has(l));
  if (!add.length) return;
  await fs.outputFile(file, `${text}${text && !text.endsWith('\n') ? '\n' : ''}${add.join('\n')}\n`);
}

async function lstatOrNull(p) { try { return await fs.lstat(p); } catch { return null; } }

/**
 * Creates (or reuses) the agent's worktree and links the team files into it.
 * Returns the absolute path. Throws a readable error if the repo has no commit yet.
 */
export async function ensureWorktree(name, root = process.cwd()) {
  root = await fs.realpath(root);
  const dir = path.join(root, WORKTREE_DIR, name);
  if (!(await lstatOrNull(path.join(dir, '.git')))) {
    try { await git(['rev-parse', '--verify', '-q', 'HEAD'], root); }
    catch { throw new Error('Per-agent worktrees need at least one commit in the repository — commit once, then launch.'); }
    await fs.ensureDir(path.dirname(dir));
    await git(['worktree', 'prune'], root).catch(() => {});
    await git(['worktree', 'add', '--detach', dir, 'HEAD'], root);
  }

  const toExclude = ['/.claude-team', '/.claude/settings.local.json'];

  // Team files: tracked copies in this checkout are hidden from git (skip-worktree)
  // and replaced by a link to the real ones, so no commit here can touch them.
  const tracked = (await git(['ls-files', '-z', '--', '.claude-team'], dir)).split('\0').filter(Boolean);
  for (let i = 0; i < tracked.length; i += 200) {
    await git(['update-index', '--skip-worktree', '--', ...tracked.slice(i, i + 200)], dir);
  }
  const link = path.join(dir, '.claude-team');
  const existing = await lstatOrNull(link);
  if (existing && !existing.isSymbolicLink()) await fs.remove(link);
  if (!existing || !existing.isSymbolicLink()) {
    await fs.ensureDir(path.join(root, '.claude-team'));
    await fs.symlink(path.relative(dir, path.join(root, '.claude-team')), link, process.platform === 'win32' ? 'junction' : 'dir');
  }

  // CLAUDE.md and the project's Claude settings, when this checkout lacks them (untracked in main).
  for (const rel of ['CLAUDE.md', '.claude/settings.json']) {
    if (!(await fs.pathExists(path.join(dir, rel))) && (await fs.pathExists(path.join(root, rel)))) {
      await fs.copy(path.join(root, rel), path.join(dir, rel));
      toExclude.push('/' + rel);
    }
  }
  await excludeLocally(root, toExclude);
  return dir;
}

/** Best-effort removal when an agent leaves the team. */
export async function removeWorktree(name, root = process.cwd()) {
  const dir = path.join(root, WORKTREE_DIR, name);
  if (!(await lstatOrNull(dir))) return false;
  await fs.remove(path.join(dir, '.claude-team')).catch(() => {}); // the link only — never follow it
  try { await git(['worktree', 'remove', '--force', dir], root); } catch { await fs.remove(dir).catch(() => {}); await git(['worktree', 'prune'], root).catch(() => {}); }
  return true;
}

/**
 * When `claude-team` runs inside a worktree (its `.claude-team` is the link
 * made above), switch to the main project so every command reads the one set
 * of team files, and report where the agent was — so a review or check of
 * that agent's work looks at its worktree, not the main checkout.
 * Returns the worktree path relative to the project, or null.
 */
export function enterProjectRoot(cwd = process.cwd()) {
  let st;
  try { st = fs.lstatSync(path.join(cwd, '.claude-team')); } catch { return null; }
  if (!st.isSymbolicLink()) return null;
  let real;
  try { real = fs.realpathSync(path.join(cwd, '.claude-team')); } catch { return null; }
  const root = path.dirname(real);
  const rel = path.relative(root, fs.realpathSync(cwd));
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  process.chdir(root);
  return rel.split(path.sep).join('/');
}

/** Permission/sandbox additions for an agent whose cwd is a worktree of `root`. */
export function worktreeSettingsFor(root) {
  const team = path.join(root, '.claude-team');
  return {
    additionalDirectories: [team],
    allow: [`Edit(//${team.replace(/^\//, '')}/**)`],
    deny: [`Edit(//${path.join(root, '.claude-team', 'config.json').replace(/^\//, '')})`],
    // Sandboxed Bash writes: the team files, and the repository itself (commits write objects and refs there).
    allowWrite: [team, path.join(root, '.git')],
  };
}
