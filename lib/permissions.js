import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import { isDeepStrictEqual } from 'util';
import { updateJson } from './jsonStore.js';

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

export function mergeSettings(existing, platform = process.platform) {
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
  const { wrapper, allowRead } = cliAccessFor();
  if (!(await fs.pathExists(path.join(BIN_DIR, wrapper.name)))) missing.push(`CLI launcher ${BIN_DIR}/${wrapper.name}`);
  let local = null;
  try { local = await fs.readJson(LOCAL_SETTINGS_PATH); } catch {}
  for (const p of allowRead) if (!(local?.sandbox?.filesystem?.allowRead || []).includes(p)) missing.push(`sandbox read grant for ${p} (${LOCAL_SETTINGS_PATH})`);
  return { ok: missing.length === 0, missing };
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

/** Merge the policy into .claude/settings.json (created if absent). Idempotent. */
export async function applyProjectPermissions() {
  let created = false, changed = false;
  await readSettings(); // fail early on invalid JSON, before taking any lock
  await updateJson(SETTINGS_PATH, (doc) => {
    created = !doc || Object.keys(doc).length === 0;
    const merged = mergeSettings(doc);
    changed = !isDeepStrictEqual(merged, doc);
    return merged;
  }, () => ({}));
  const cliChanged = await applyCliAccess();
  return { created: created && changed, changed: changed || cliChanged };
}

export async function runPermissions(options = {}) {
  try {
    if (options.check) {
      const r = await checkProjectPermissions();
      if (r.ok) { console.log(chalk.green('  ✓ Project permissions are in place (.claude/settings.json).')); return; }
      console.log(chalk.yellow('  Project permissions are incomplete:'));
      r.missing.forEach((m) => console.log(chalk.dim(`   - ${m}`)));
      console.log(chalk.dim('  Run `claude-team permissions` to apply them.'));
      process.exitCode = 1;
      return;
    }
    const r = await applyProjectPermissions();
    console.log(r.changed
      ? chalk.green(`  ✓ ${r.created ? 'Created' : 'Updated'} ${SETTINGS_PATH} — agents are confined to this project folder.`)
      : chalk.green('  ✓ Already up to date.'));
    console.log(chalk.dim('  Edits allowed in this project only; reads outside it blocked; Bash sandboxed to it (macOS/Linux/WSL2).'));
  } catch (e) {
    console.error(chalk.red(`  ${e.message}`));
    process.exitCode = 1;
  }
}
