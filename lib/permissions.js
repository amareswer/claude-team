import fs from 'fs-extra';
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

export const PROJECT_POLICY = {
  flags: [
    ['permissions.defaultMode', 'dontAsk'],
    ['permissions.blockReadsOutsideWorkingDirectories', true],
    ['sandbox.enabled', true],
    ['sandbox.allowUnsandboxedCommands', false],
  ],
  allow: ['Edit(./**)'],
  deny: ['Edit(./.claude/**)', 'Edit(./.claude-team/config.json)'],
};

function setPath(obj, dotted, value) {
  const keys = dotted.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) o = (o[k] = o[k] && typeof o[k] === 'object' ? o[k] : {});
  o[keys.at(-1)] = value;
}
const getPath = (obj, dotted) => dotted.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

export function mergeSettings(existing) {
  const s = structuredClone(existing && typeof existing === 'object' ? existing : {});
  s.permissions = s.permissions && typeof s.permissions === 'object' ? s.permissions : {};
  const asList = (v) => (Array.isArray(v) ? v : []);
  // An allow rule that would reopen something the policy denies is dropped.
  s.permissions.allow = asList(s.permissions.allow).filter((r) => !PROJECT_POLICY.deny.includes(r));
  s.permissions.deny = asList(s.permissions.deny);
  for (const r of PROJECT_POLICY.allow) if (!s.permissions.allow.includes(r)) s.permissions.allow.push(r);
  for (const r of PROJECT_POLICY.deny) if (!s.permissions.deny.includes(r)) s.permissions.deny.push(r);
  for (const [key, value] of PROJECT_POLICY.flags) setPath(s, key, value);
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
export async function checkProjectPermissions() {
  const existing = await readSettings();
  const missing = [];
  for (const [key, value] of PROJECT_POLICY.flags) if (getPath(existing, key) !== value) missing.push(`${key} = ${value}`);
  const allow = existing?.permissions?.allow || [];
  const deny = existing?.permissions?.deny || [];
  for (const r of PROJECT_POLICY.allow) if (!allow.includes(r)) missing.push(`allow ${r}`);
  for (const r of PROJECT_POLICY.deny) if (!deny.includes(r)) missing.push(`deny ${r}`);
  for (const r of allow.filter((r) => PROJECT_POLICY.deny.includes(r))) missing.push(`remove allow ${r}`);
  return { ok: missing.length === 0, missing };
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
  return { created: created && changed, changed };
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
