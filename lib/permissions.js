import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import { isDeepStrictEqual } from 'util';
import { updateJson } from './jsonStore.js';
import { worktreeSettingsFor } from './worktrees.js';

// Project-local permission policy: launched agents work inside this project
// folder only, and the rules that say so live in the project too
// (.claude/settings.json), not in anyone's global settings.
//
//  - dontAsk mode: only what is pre-approved runs; everything else is denied
//    on the spot, so an agent never sits waiting on a permission prompt (and
//    auto mode's classifier never gets to approve something outside the project).
//  - File tools: edits are pre-approved inside the project only; reads outside
//    it are blocked (blockReadsOutsideWorkingDirectories).
//  - Bash: runs in Claude Code's OS sandbox — writes confined to the project,
//    no escape hatch, no per-command prompts. (The sandbox needs macOS, Linux
//    or WSL2; on native Windows Bash is not sandboxed and will still prompt.)
//  - Agents can't edit .claude/ (this policy) or .claude-team/config.json
//    (spend limits, check definitions, approvals). Deny rules beat allow rules
//    in every settings scope, so a looser global setting can't reopen these.
//
//  - Network: sandboxed Bash can reach nothing by default (npm install, git
//    push, curl all fail). The human opts hosts in with
//    `claude-team permissions --allow-domain <host>`, stored in config.json
//    (which agents can't edit) as `allowedDomains` and written to
//    sandbox.network.allowedDomains. npm also needs a cache inside the project
//    (the Office sets npm_config_cache), since writes outside it are blocked.
//
// mergeSettings only adds to what the user already has (other keys and rules
// are kept), except the confinement flags, which are forced on.

const SETTINGS_PATH = '.claude/settings.json';
const LOCAL_SETTINGS_PATH = '.claude/settings.local.json';
const BIN_DIR = '.claude-team/bin';
const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ── Running the claude-team CLI from inside the sandbox ──────────────────────
// Agents are told to run `claude-team review request …`. Inside the sandbox
// that command has to exist (a launcher in the project, put first on the
// session's PATH by the Office) and its install folder has to be readable
// (blockReadsOutsideWorkingDirectories hides the home folder, and a global or
// sibling-folder install lives there). Both are machine-specific, so the read
// grant goes in settings.local.json, not the shared settings.json.
export function cliAccessFor({ root = PKG_ROOT, execPath = process.execPath, home = os.homedir(), platform = process.platform } = {}) {
  if (platform === 'win32') {
    return { wrapper: { name: 'claude-team.cmd', content: `@echo off\r\n"${execPath}" "${root}\\bin\\claude-team.js" %*\r\n` }, allowRead: [] };
  }
  const allowRead = [root];
  // A node installed under the home folder (nvm, volta…) is hidden by the same rule.
  const nodePrefix = path.dirname(path.dirname(execPath));
  if (home && execPath.startsWith(home + '/') && !allowRead.includes(nodePrefix)) allowRead.push(nodePrefix);
  return { wrapper: { name: 'claude-team', content: `#!/bin/sh\nexec "${execPath}" "${root}/bin/claude-team.js" "$@"\n` }, allowRead };
}


// Bash under dontAsk: ordinary commands (npm test, git commit, compound
// pipelines) are denied unless allowed. Where the OS sandbox exists we allow
// Bash outright — the sandbox is what confines it — and set failIfUnavailable
// so a machine that can't sandbox refuses to start the session instead of
// running Bash unconfined. Native Windows has no sandbox, so there Bash stays
// closed except for a short git/test allowlist.
const WINDOWS_BASH_ALLOW = ['Bash(git status*)', 'Bash(git diff*)', 'Bash(git log*)', 'Bash(git add*)', 'Bash(git commit*)', 'Bash(npm test*)'];

export function policyFor(platform = process.platform) {
  const sandboxed = platform !== 'win32';
  return {
    flags: [
      ['permissions.defaultMode', 'dontAsk'],
      ['permissions.blockReadsOutsideWorkingDirectories', true],
      ['sandbox.enabled', true],
      ['sandbox.allowUnsandboxedCommands', false],
      ...(sandboxed ? [['sandbox.failIfUnavailable', true]] : []),
    ],
    allow: ['Edit(./**)', ...(sandboxed ? ['Bash'] : WINDOWS_BASH_ALLOW)],
    deny: ['Edit(./.claude/**)', 'Edit(./.claude-team/config.json)'],
    // Rules the other platform's policy adds that must not linger here.
    remove: sandboxed ? WINDOWS_BASH_ALLOW : ['Bash'],
  };
}
export const PROJECT_POLICY = policyFor();

function setPath(obj, dotted, value) {
  const keys = dotted.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) o = (o[k] = o[k] && typeof o[k] === 'object' ? o[k] : {});
  o[keys.at(-1)] = value;
}
const getPath = (obj, dotted) => dotted.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

const DOMAIN_RE = /^(\*\.)?([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i;

/** Normalises and validates a host the human wants agents to reach; throws on anything else. */
export function validateDomain(input) {
  const d = String(input ?? '').trim().toLowerCase();
  if (!DOMAIN_RE.test(d)) throw new Error(`"${input}" is not a hostname (use e.g. registry.npmjs.org or *.npmjs.org — no scheme, path or port)`);
  return d;
}

export function mergeSettings(existing, platform = process.platform, { allowedDomains = [], removeDomains = [] } = {}) {
  const policy = policyFor(platform);
  const s = structuredClone(existing && typeof existing === 'object' ? existing : {});
  s.permissions = s.permissions && typeof s.permissions === 'object' ? s.permissions : {};
  const asList = (v) => (Array.isArray(v) ? v : []);
  // An allow rule that would reopen something the policy denies is dropped.
  s.permissions.allow = asList(s.permissions.allow).filter((r) => !policy.deny.includes(r) && !policy.remove.includes(r));
  s.permissions.deny = asList(s.permissions.deny);
  for (const r of policy.allow) if (!s.permissions.allow.includes(r)) s.permissions.allow.push(r);
  for (const r of policy.deny) if (!s.permissions.deny.includes(r)) s.permissions.deny.push(r);
  for (const [key, value] of policy.flags) setPath(s, key, value);
  if (platform === 'win32' && s.sandbox) delete s.sandbox.failIfUnavailable;
  const have = Array.isArray(s.sandbox?.network?.allowedDomains) ? s.sandbox.network.allowedDomains : null;
  if (have || allowedDomains.length) {
    const next = [...(have || [])].filter((d) => !removeDomains.includes(d));
    for (const d of allowedDomains) if (!next.includes(d)) next.push(d);
    s.sandbox.network = { ...(s.sandbox.network || {}), allowedDomains: next };
  }
  return s;
}

async function readSettings() {
  try { return await fs.readJson(SETTINGS_PATH); }
  catch (err) {
    if (err.code === 'ENOENT') return null;
    if (err instanceof SyntaxError) {
      throw Object.assign(new Error(`${SETTINGS_PATH} contains invalid JSON; fix it by hand, then re-run (nothing was changed)`), { code: 'CORRUPT_JSON' });
    }
    throw err;
  }
}

async function configuredDomains() {
  try { const c = await fs.readJson('.claude-team/config.json'); return Array.isArray(c.allowedDomains) ? c.allowedDomains : []; }
  catch { return []; }
}

/** What the project's settings are missing from the policy. */
export async function checkProjectPermissions(platform = process.platform) {
  const existing = await readSettings();
  const policy = policyFor(platform);
  const missing = [];
  for (const [key, value] of policy.flags) if (getPath(existing, key) !== value) missing.push(`${key} = ${value}`);
  const allow = existing?.permissions?.allow || [];
  const deny = existing?.permissions?.deny || [];
  for (const r of policy.allow) if (!allow.includes(r)) missing.push(`allow ${r}`);
  for (const r of policy.deny) if (!deny.includes(r)) missing.push(`deny ${r}`);
  for (const r of allow.filter((r) => policy.deny.includes(r) || policy.remove.includes(r))) missing.push(`remove allow ${r}`);
  const haveDomains = existing?.sandbox?.network?.allowedDomains || [];
  for (const d of await configuredDomains()) if (!haveDomains.includes(d)) missing.push(`sandbox network domain ${d}`);
  for (const e of await gitignoreMissing()) missing.push(`.gitignore entry ${e}`);
  const { wrapper, allowRead } = cliAccessFor();
  if (!(await fs.pathExists(path.join(BIN_DIR, wrapper.name)))) missing.push(`CLI launcher ${BIN_DIR}/${wrapper.name}`);
  let local = null;
  try { local = await fs.readJson(LOCAL_SETTINGS_PATH); } catch {}
  for (const p of allowRead) if (!(local?.sandbox?.filesystem?.allowRead || []).includes(p)) missing.push(`sandbox read grant for ${p} (${LOCAL_SETTINGS_PATH})`);
  return { ok: missing.length === 0, missing };
}

// Machine-local or generated: never meant to be committed.
export const GITIGNORE_ENTRIES = ['.claude-team/bin/', '.claude-team/npm-cache/', '.claude/settings.local.json', '.claude-worktrees/'];

const ignoredLines = (text) => new Set(text.split('\n').map((l) => l.trim().replace(/^\//, '')));

/** Only touches projects that use git (a .git folder or an existing .gitignore). */
async function gitignoreMissing() {
  const hasIgnore = await fs.pathExists('.gitignore');
  if (!hasIgnore && !(await fs.pathExists('.git'))) return [];
  const have = ignoredLines(hasIgnore ? await fs.readFile('.gitignore', 'utf8') : '');
  return GITIGNORE_ENTRIES.filter((e) => !have.has(e));
}

async function applyGitignore() {
  const missing = await gitignoreMissing();
  if (!missing.length) return false;
  let text = '';
  try { text = await fs.readFile('.gitignore', 'utf8'); } catch {}
  const sep = text && !text.endsWith('\n') ? '\n' : '';
  await fs.outputFile('.gitignore', `${text}${sep}${text ? '\n' : ''}# claude-team: machine-local files\n${missing.join('\n')}\n`);
  return true;
}

async function applyCliAccess() {
  const { wrapper, allowRead } = cliAccessFor();
  let changed = false;
  const target = path.join(BIN_DIR, wrapper.name);
  let current = null;
  try { current = await fs.readFile(target, 'utf8'); } catch {}
  if (current !== wrapper.content) {
    await fs.outputFile(target, wrapper.content);
    changed = true;
  }
  await fs.chmod(target, 0o755).catch(() => {});
  if (allowRead.length) {
    await updateJson(LOCAL_SETTINGS_PATH, (doc) => {
      const list = doc?.sandbox?.filesystem?.allowRead;
      const have = Array.isArray(list) ? list : [];
      const missing = allowRead.filter((p) => !have.includes(p));
      if (missing.length === 0) return doc;
      changed = true;
      const next = structuredClone(doc || {});
      next.sandbox = next.sandbox || {};
      next.sandbox.filesystem = next.sandbox.filesystem || {};
      next.sandbox.filesystem.allowRead = [...have, ...missing];
      return next;
    }, () => ({}));
  }
  return changed;
}

/**
 * Settings for an agent whose cwd is a worktree of this project: the same
 * confinement (its own .claude/settings.json is a checkout/copy of ours), plus
 * what a worktree needs that the main folder doesn't — the shared team files
 * and the repository, both outside its cwd, and read access for the claude-team
 * install. Machine-specific, so it goes in the worktree's settings.local.json.
 */
export async function applyWorktreePermissions(worktreeDir, root = process.cwd()) {
  const w = worktreeSettingsFor(root);
  const { allowRead } = cliAccessFor();
  const target = path.join(worktreeDir, LOCAL_SETTINGS_PATH);
  const union = (have, add) => [...(Array.isArray(have) ? have : []), ...add.filter((x) => !(Array.isArray(have) ? have : []).includes(x))];
  await updateJson(target, (doc) => {
    const next = structuredClone(doc || {});
    next.permissions = { ...(next.permissions || {}) };
    next.permissions.additionalDirectories = union(next.permissions.additionalDirectories, w.additionalDirectories);
    next.permissions.allow = union(next.permissions.allow, w.allow);
    next.permissions.deny = union(next.permissions.deny, w.deny);
    next.sandbox = { ...(next.sandbox || {}), filesystem: { ...(next.sandbox?.filesystem || {}) } };
    next.sandbox.filesystem.allowRead = union(next.sandbox.filesystem.allowRead, allowRead);
    next.sandbox.filesystem.allowWrite = union(next.sandbox.filesystem.allowWrite, w.allowWrite);
    return next;
  }, () => ({}));
}

/** Merge the policy into .claude/settings.json (created if absent). Idempotent. */
export async function applyProjectPermissions({ removeDomains = [] } = {}) {
  let created = false, changed = false;
  await readSettings(); // fail early on invalid JSON, before taking any lock
  const allowedDomains = (await configuredDomains()).filter((d) => !removeDomains.includes(d));
  await updateJson(SETTINGS_PATH, (doc) => {
    created = !doc || Object.keys(doc).length === 0;
    const merged = mergeSettings(doc, process.platform, { allowedDomains, removeDomains });
    changed = !isDeepStrictEqual(merged, doc);
    return merged;
  }, () => ({}));
  const cliChanged = await applyCliAccess();
  const ignoreChanged = await applyGitignore();
  return { created: created && changed, changed: changed || cliChanged || ignoreChanged };
}

/** Human-only: records hosts in config.json (agents can't edit it) so the next apply opens them in the sandbox. */
async function editDomains({ add = [], remove = [] }) {
  const toAdd = add.map(validateDomain);
  const toRemove = remove.map(validateDomain);
  if (!(await fs.pathExists('.claude-team/config.json'))) throw new Error('No claude-team in this folder — run `claude-team init` first.');
  await updateJson('.claude-team/config.json', (doc) => {
    const list = (Array.isArray(doc.allowedDomains) ? doc.allowedDomains : []).filter((d) => !toRemove.includes(d));
    for (const d of toAdd) if (!list.includes(d)) list.push(d);
    const next = { ...doc };
    if (list.length) next.allowedDomains = list; else delete next.allowedDomains;
    return next;
  });
  return { removeDomains: toRemove };
}

export async function runPermissions(options = {}) {
  try {
    let removeDomains = [];
    if (!options.check && (options.allowDomain || options.removeDomain)) {
      ({ removeDomains } = await editDomains({ add: options.allowDomain || [], remove: options.removeDomain || [] }));
    }
    if (options.check) {
      const r = await checkProjectPermissions();
      if (r.ok) { console.log(chalk.green('  ✓ Project permissions are in place (.claude/settings.json).')); return; }
      console.log(chalk.yellow('  Project permissions are incomplete:'));
      r.missing.forEach((m) => console.log(chalk.dim(`   - ${m}`)));
      console.log(chalk.dim('  Run `claude-team permissions` to apply them.'));
      process.exitCode = 1;
      return;
    }
    const r = await applyProjectPermissions({ removeDomains });
    console.log(r.changed
      ? chalk.green(`  ✓ ${r.created ? 'Created' : 'Updated'} ${SETTINGS_PATH} — agents are confined to this project folder.`)
      : chalk.green('  ✓ Already up to date.'));
    console.log(chalk.dim('  Edits allowed in this project only; reads outside it blocked; Bash sandboxed to it (macOS/Linux/WSL2).'));
    const domains = await configuredDomains();
    console.log(chalk.dim(domains.length ? `  Network: agents can reach ${domains.join(', ')} and nothing else.` : '  Network: agents can reach nothing (allow a host with --allow-domain <host>).'));
  } catch (e) {
    console.error(chalk.red(`  ${e.message}`));
    process.exitCode = 1;
  }
}
