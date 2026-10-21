import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { runStart, LAUNCH_COMMAND, launchCommandFor } from '../lib/start.js';
import { saveConfig } from '../lib/config.js';
import { applyProjectPermissions } from '../lib/permissions.js';

describe('claude-team start', () => {
  let dir, prev, out;
  beforeEach(async () => {
    prev = process.cwd();
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'start-'));
    process.chdir(dir);
    await saveConfig({ projectName: 'P', projectGoal: 'G', agents: [{ name: 'backend', role: 'Backend' }] });
    out = '';
    vi.spyOn(console, 'log').mockImplementation((...a) => { out += a.join(' ') + '\n'; });
  });
  afterEach(async () => { vi.restoreAllMocks(); process.chdir(prev); await fs.remove(dir); });

  it('tells every terminal to launch claude the way the Office does', async () => {
    await runStart();
    // Once, on a single unboxed line (a box would wrap it and break copy-paste); each terminal's box points at it.
    const lines = out.replace(/\x1b\[[0-9;]*m/g, '').split('\n');
    expect(lines.filter((l) => l.trim() === LAUNCH_COMMAND)).toHaveLength(1);
    expect(out.match(/the launch command above/g)).toHaveLength(2); // orchestrator + backend
    expect(LAUNCH_COMMAND).toMatch(/claude --permission-mode dontAsk$/);
  });
  it('puts the project launcher on PATH and the npm cache in the project, per platform', () => {
    expect(launchCommandFor('darwin')).toContain('PATH="$PWD/.claude-team/bin:$PATH"');
    expect(launchCommandFor('darwin')).toContain('npm_config_cache="$PWD/.claude-team/npm-cache"');
    expect(launchCommandFor('darwin')).toContain('CLAUDE_CODE_DISABLE_AUTO_MEMORY=1');
    expect(launchCommandFor('win32')).toContain('CLAUDE_CODE_DISABLE_AUTO_MEMORY=1');
    expect(launchCommandFor('win32')).toContain('.claude-team\\bin;%PATH%');
    expect(launchCommandFor('win32')).toContain('npm_config_cache=%CD%\\.claude-team\\npm-cache');
  });
  it('warns when confinement is not set up, and stays quiet once it is', async () => {
    await runStart();
    expect(out).toMatch(/claude-team permissions/);
    out = '';
    await applyProjectPermissions();
    await runStart();
    expect(out).not.toMatch(/not fully set up/);
  });
});
