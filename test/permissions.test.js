import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { PROJECT_POLICY, mergeSettings, applyProjectPermissions, checkProjectPermissions } from '../lib/permissions.js';
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
    expect(s.permissions.allow).toEqual(['Bash(npm test)', 'Edit(./**)']);
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
    expect(s.permissions.allow).toEqual(['Edit(./src/**)', 'Edit(./**)']);
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
