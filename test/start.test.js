import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { runStart, LAUNCH_COMMAND } from '../lib/start.js';
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

  it('tells every terminal to launch claude in dontAsk mode', async () => {
    await runStart();
    expect(LAUNCH_COMMAND).toBe('claude --permission-mode dontAsk');
    expect(out.match(/claude --permission-mode dontAsk/g)).toHaveLength(2); // orchestrator + backend
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
