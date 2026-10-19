import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { policyFor, mergeSettings, applyProjectPermissions, checkProjectPermissions } from '../lib/permissions.js';
import { looksLikeBlockingPrompt } from '../lib/office.js';

describe('mergeSettings', () => {
  it('creates the full policy from nothing', () => {
    const s = mergeSettings(null);
    expect(s.permissions.defaultMode).toBe('dontAsk');
    expect(s.permissions.blockReadsOutsideWorkingDirectories).toBe(true);
    expect(s.permissions.allow).toContain('Edit(./**)');
    expect(s.permissions.deny).toEqual(expect.arrayContaining(['Edit(./.claude/**)', 'Edit(./.claude-team/config.json)']));
    expect(s.sandbox).toMatchObject({ enabled: true, allowUnsandboxedCommands: false });
  });
  it('keeps unrelated user keys and rules, adds ours, never duplicates', () => {
    const existing = { model: 'opus', permissions: { allow: ['Bash(npm test)', 'Edit(./**)'], deny: ['Read(./.env)'] }, sandbox: { network: { allowedDomains: ['example.com'] } } };
    const s = mergeSettings(existing);
    expect(s.model).toBe('opus');
    expect(s.permissions.allow).toEqual(['Bash(npm test)', 'Edit(./**)', 'Bash']);
    expect(s.permissions.deny[0]).toBe('Read(./.env)');
    expect(s.permissions.deny.filter((r) => r === 'Edit(./.claude/**)')).toHaveLength(1);
    expect(s.sandbox.network.allowedDomains).toEqual(['example.com']);
    expect(mergeSettings(s)).toEqual(s); // idempotent
  });
  it('forces the confinement flags on even if the user had them off', () => {
    const s = mergeSettings({ permissions: { defaultMode: 'auto', blockReadsOutsideWorkingDirectories: false }, sandbox: { enabled: false, allowUnsandboxedCommands: true } });
    expect(s.permissions.blockReadsOutsideWorkingDirectories).toBe(true);
    expect(s.permissions.defaultMode).toBe('dontAsk');
    expect(s.sandbox).toMatchObject({ enabled: true, allowUnsandboxedCommands: false });
  });
  it('drops an allow rule that would reopen what the policy denies', () => {
    const s = mergeSettings({ permissions: { allow: ['Edit(./.claude/**)', 'Edit(./.claude-team/config.json)', 'Edit(./src/**)'] } });
    expect(s.permissions.allow).toEqual(['Edit(./src/**)', 'Edit(./**)', 'Bash']);
  });
  it('allows Bash outright where the OS sandbox exists, and refuses to run unsandboxed', () => {
    for (const platform of ['darwin', 'linux']) {
      const s = mergeSettings(null, platform);
      expect(s.permissions.allow).toContain('Bash');
      expect(s.sandbox.failIfUnavailable).toBe(true);
    }
  });
  it('on native Windows (no sandbox) never allows bare Bash — only a short git/test allowlist', () => {
    const s = mergeSettings(null, 'win32');
    expect(s.permissions.allow).not.toContain('Bash');
    expect(s.permissions.allow).toEqual(expect.arrayContaining(['Bash(git commit*)', 'Bash(npm test*)']));
    expect(s.sandbox.failIfUnavailable).toBeUndefined();
  });
  it('a settings file committed from the other platform is corrected, not trusted', () => {
    const fromMac = mergeSettings(null, 'darwin');
    const onWindows = mergeSettings(fromMac, 'win32');
    expect(onWindows.permissions.allow).not.toContain('Bash');
    expect(onWindows.sandbox.failIfUnavailable).toBeUndefined();
    const backOnMac = mergeSettings(onWindows, 'darwin');
    expect(backOnMac.permissions.allow).toContain('Bash');
    expect(backOnMac.permissions.allow).not.toContain('Bash(git commit*)');
    expect(mergeSettings(backOnMac, 'darwin')).toEqual(backOnMac);
  });
  it('does not mutate its input', () => {
    const existing = { permissions: { allow: ['A'] } };
    mergeSettings(existing);
    expect(existing).toEqual({ permissions: { allow: ['A'] } });
  });
});

describe('applyProjectPermissions / checkProjectPermissions', () => {
  let dir, prev;
  beforeEach(async () => { prev = process.cwd(); dir = await fs.mkdtemp(path.join(os.tmpdir(), 'perm-')); process.chdir(dir); });
  afterEach(async () => { process.chdir(prev); await fs.remove(dir); });

  it('writes .claude/settings.json in the project, then reports no change', async () => {
    expect((await checkProjectPermissions()).ok).toBe(false);
    expect(await applyProjectPermissions()).toMatchObject({ changed: true, created: true });
    const written = await fs.readJson('.claude/settings.json');
    expect(written.permissions.blockReadsOutsideWorkingDirectories).toBe(true);
    expect((await checkProjectPermissions()).ok).toBe(true);
    expect(await applyProjectPermissions()).toMatchObject({ changed: false, created: false });
  });
  it('merges into an existing file without losing keys', async () => {
    await fs.outputJson('.claude/settings.json', { env: { A: '1' } });
    await applyProjectPermissions();
    const s = await fs.readJson('.claude/settings.json');
    expect(s.env).toEqual({ A: '1' });
    expect(s.sandbox.enabled).toBe(true);
  });
  it('refuses to overwrite an invalid settings file', async () => {
    await fs.outputFile('.claude/settings.json', '{ nope');
    await expect(applyProjectPermissions()).rejects.toThrow(/invalid JSON/);
    expect(await fs.readFile('.claude/settings.json', 'utf8')).toBe('{ nope');
  });
  it('check lists what is missing', async () => {
    await fs.outputJson('.claude/settings.json', { permissions: { allow: ['Edit(./**)'] } });
    const r = await checkProjectPermissions();
    expect(r.ok).toBe(false);
    expect(r.missing.join(' ')).toMatch(/sandbox/);
    expect((await checkProjectPermissions('win32')).missing.join(' ')).not.toMatch(/failIfUnavailable|allow Bash$/);
  });
});

import { looksLikeTrustPrompt, trustPromptState } from '../lib/office.js';

describe('looksLikeTrustPrompt', () => {
  const tui = (s) => s.split(' ').map((w) => `\x1b[1C${w}`).join('\x1b[1C');
  it('matches the trust-folder dialog', () => {
    expect(looksLikeTrustPrompt(tui('Quick safety check: Is this a project you trust? ❯ 1. Yes, I trust this folder 2. No, exit'))).toBe(true);
  });
  it('reports "answered" once enough output has flowed past the dialog', () => {
    const dialog = tui('Is this a project you trust? 1. Yes, I trust this folder 2. No, exit');
    expect(trustPromptState(dialog)).toBe('showing');
    expect(trustPromptState(dialog + tui('Welcome back. Reading CLAUDE.md and the project docs to get started on the first task now.'.repeat(4)))).toBe('answered');
    expect(trustPromptState(tui('nothing here'))).toBe('none');
  });
  it('ignores ordinary output and other modals', () => {
    expect(looksLikeTrustPrompt(tui('Reading CLAUDE.md esc to interrupt'))).toBe(false);
    expect(looksLikeTrustPrompt(tui('Set it up Enter to confirm Esc to cancel'))).toBe(false);
  });
});

describe('looksLikeBlockingPrompt', () => {
  const tui = (s) => s.split(' ').map((w) => `\x1b[1C${w}`).join('\x1b[1C'); // cursor jumps instead of spaces
  it('still catches the "Enter to confirm" modals', () => {
    expect(looksLikeBlockingPrompt(tui('Set it up Enter to confirm Esc to cancel'))).toBe(true);
  });
  it('catches a tool-permission prompt (Esc to cancel / Tab to amend)', () => {
    expect(looksLikeBlockingPrompt(tui('Do you want to proceed? ❯ 1. Yes 2. No Esc to cancel Tab to amend'))).toBe(true);
  });
  it('ignores normal working output', () => {
    expect(looksLikeBlockingPrompt(tui('Reading CLAUDE.md esc to interrupt'))).toBe(false);
  });
});

import { cliAccessFor } from '../lib/permissions.js';

describe('cliAccessFor (agents must be able to run the claude-team CLI from inside the sandbox)', () => {
  const base = { root: '/Users/me/tools/claude-team', execPath: '/opt/homebrew/bin/node', home: '/Users/me' };
  it('writes a POSIX launcher that runs this install, and grants read of that folder', () => {
    const a = cliAccessFor({ ...base, platform: 'darwin' });
    expect(a.wrapper.name).toBe('claude-team');
    expect(a.wrapper.content).toContain('exec "/opt/homebrew/bin/node" "/Users/me/tools/claude-team/bin/claude-team.js" "$@"');
    expect(a.allowRead).toEqual(['/Users/me/tools/claude-team']);
  });
  it("also grants the node install when it lives under the home folder (nvm etc.), which the sandbox otherwise hides", () => {
    const a = cliAccessFor({ ...base, platform: 'linux', execPath: '/Users/me/.nvm/versions/node/v22.1.0/bin/node' });
    expect(a.allowRead).toEqual(['/Users/me/tools/claude-team', '/Users/me/.nvm/versions/node/v22.1.0']);
  });
  it('on native Windows uses a .cmd launcher and needs no read grant (no sandbox)', () => {
    const a = cliAccessFor({ root: 'C:\\tools\\claude-team', execPath: 'C:\\node\\node.exe', home: 'C:\\Users\\me', platform: 'win32' });
    expect(a.wrapper.name).toBe('claude-team.cmd');
    expect(a.wrapper.content).toContain('"C:\\node\\node.exe" "C:\\tools\\claude-team\\bin\\claude-team.js" %*');
    expect(a.allowRead).toEqual([]);
  });
});

describe('applyProjectPermissions — CLI access', () => {
  let dir, prev;
  beforeEach(async () => { prev = process.cwd(); dir = await fs.mkdtemp(path.join(os.tmpdir(), 'perm-')); process.chdir(dir); });
  afterEach(async () => { process.chdir(prev); await fs.remove(dir); });

  it('creates an executable launcher in .claude-team/bin and a machine-local read grant, and is idempotent', async () => {
    await applyProjectPermissions();
    const wrapper = '.claude-team/bin/' + (process.platform === 'win32' ? 'claude-team.cmd' : 'claude-team');
    expect(await fs.pathExists(wrapper)).toBe(true);
    if (process.platform !== 'win32') expect((await fs.stat(wrapper)).mode & 0o111).not.toBe(0);
    const local = await fs.readJson('.claude/settings.local.json');
    if (process.platform !== 'win32') expect(local.sandbox.filesystem.allowRead.length).toBeGreaterThan(0);
    const before = await fs.readFile('.claude/settings.local.json', 'utf8');
    expect(await applyProjectPermissions()).toMatchObject({ changed: false });
    expect(await fs.readFile('.claude/settings.local.json', 'utf8')).toBe(before);
  });
  it('keeps the user\'s own settings.local.json keys and read grants', async () => {
    await fs.outputJson('.claude/settings.local.json', { env: { X: '1' }, sandbox: { filesystem: { allowRead: ['/my/own/dir'] } } });
    await applyProjectPermissions();
    const local = await fs.readJson('.claude/settings.local.json');
    expect(local.env).toEqual({ X: '1' });
    if (process.platform !== 'win32') expect(local.sandbox.filesystem.allowRead).toContain('/my/own/dir');
  });
  it('check reports a missing launcher', async () => {
    await applyProjectPermissions();
    await fs.remove('.claude-team/bin');
    const r = await checkProjectPermissions();
    expect(r.ok).toBe(false);
    expect(r.missing.join(' ')).toMatch(/launcher/);
  });
});

import { validateDomain } from '../lib/permissions.js';

describe('network allowlist', () => {
  it('validateDomain accepts hosts and wildcards, normalises case, rejects URLs/paths/ports/bare words', () => {
    expect(validateDomain(' Registry.NPMJS.org ')).toBe('registry.npmjs.org');
    expect(validateDomain('*.npmjs.org')).toBe('*.npmjs.org');
    for (const bad of ['https://registry.npmjs.org', 'npmjs.org/x', 'host:443', 'localhost', '*', '', 'a b.com']) expect(() => validateDomain(bad)).toThrow(/not a hostname/);
  });
  it('mergeSettings writes no network key by default, and adds configured hosts without duplicating or dropping the user\'s', () => {
    expect(mergeSettings(null).sandbox.network).toBeUndefined();
    const s = mergeSettings({ sandbox: { network: { allowedDomains: ['mine.example.com'] } } }, 'darwin', { allowedDomains: ['registry.npmjs.org', 'mine.example.com'] });
    expect(s.sandbox.network.allowedDomains).toEqual(['mine.example.com', 'registry.npmjs.org']);
    expect(mergeSettings(s, 'darwin', { allowedDomains: ['registry.npmjs.org'] })).toEqual(s);
  });
  it('removeDomains takes a host back out', () => {
    const s = mergeSettings({ sandbox: { network: { allowedDomains: ['a.com', 'b.com'] } } }, 'darwin', { removeDomains: ['a.com'] });
    expect(s.sandbox.network.allowedDomains).toEqual(['b.com']);
  });
});

describe('permissions --allow-domain / --remove-domain', () => {
  let dir, prev;
  beforeEach(async () => { prev = process.cwd(); dir = await fs.mkdtemp(path.join(os.tmpdir(), 'perm-')); process.chdir(dir); await fs.outputJson('.claude-team/config.json', { projectName: 'P', agents: [] }); });
  afterEach(async () => { process.chdir(prev); await fs.remove(dir); process.exitCode = 0; });

  it('saves the host in config.json and opens it in the sandbox; check then passes, and removal closes it again', async () => {
    const { runPermissions } = await import('../lib/permissions.js');
    await runPermissions({ allowDomain: ['registry.npmjs.org'] });
    expect((await fs.readJson('.claude-team/config.json')).allowedDomains).toEqual(['registry.npmjs.org']);
    expect((await fs.readJson('.claude/settings.json')).sandbox.network.allowedDomains).toEqual(['registry.npmjs.org']);
    expect((await checkProjectPermissions()).ok).toBe(true);
    await fs.writeJson('.claude/settings.json', { ...(await fs.readJson('.claude/settings.json')), sandbox: { ...(await fs.readJson('.claude/settings.json')).sandbox, network: { allowedDomains: [] } } });
    expect((await checkProjectPermissions()).missing.join(' ')).toMatch(/registry\.npmjs\.org/);
    await applyProjectPermissions();
    await runPermissions({ removeDomain: ['registry.npmjs.org'] });
    expect((await fs.readJson('.claude-team/config.json')).allowedDomains).toBeUndefined();
    expect((await fs.readJson('.claude/settings.json')).sandbox.network.allowedDomains).toEqual([]);
  });
  it('refuses a bad host and changes nothing', async () => {
    const { runPermissions } = await import('../lib/permissions.js');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await runPermissions({ allowDomain: ['https://evil.example/x'] });
    expect(process.exitCode).toBe(1);
    expect((await fs.readJson('.claude-team/config.json')).allowedDomains).toBeUndefined();
    spy.mockRestore();
  });
});
