import { describe, it, expect } from 'vitest';
import fs from 'fs-extra';
import { withTempCwd, minimalConfig } from './helpers.js';
import { addAgentToTeam, removeAgentFromTeam } from '../lib/add.js';
import { validateAgentName } from '../lib/names.js';

async function seed() {
  const config = minimalConfig({ agents: [], workerAgents: [] });
  await fs.ensureDir('.claude-team/tasks');
  await fs.ensureDir('.claude-team/agents');
  await fs.writeJson('.claude-team/config.json', config);
  return config;
}

describe('validateAgentName', () => {
  it('rejects path separators, reserved and duplicate names', () => {
    expect(validateAgentName('../x')).toMatch(/lowercase/);
    expect(validateAgentName('a/b')).toBeTruthy();
    expect(validateAgentName('orchestrator')).toBeTruthy();
    expect(validateAgentName('dev', ['dev'])).toBeTruthy();
    expect(validateAgentName('Dev Two', [])).toBeNull();
  });
});

describe('addAgentToTeam', () => {
  it('concurrent hires from stale snapshots both land in config', async () => {
    await withTempCwd(async () => {
      const a = await seed();
      const b = structuredClone(a);
      await Promise.all([
        addAgentToTeam(a, { name: 'alpha', role: 'r' }),
        addAgentToTeam(b, { name: 'beta', role: 'r' }),
      ]);
      const cfg = await fs.readJson('.claude-team/config.json');
      expect(cfg.agents.map((x) => x.name).sort()).toEqual(['alpha', 'beta']);
    });
  });

  it('concurrent hires of the same name: exactly one wins', async () => {
    await withTempCwd(async () => {
      const a = await seed();
      const results = await Promise.allSettled([
        addAgentToTeam(structuredClone(a), { name: 'dup', role: 'r' }),
        addAgentToTeam(structuredClone(a), { name: 'dup', role: 'r' }),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect((await fs.readJson('.claude-team/config.json')).agents).toHaveLength(1);
    });
  });

  it('removes an agent from the on-disk config', async () => {
    await withTempCwd(async () => {
      const cfg = await seed();
      await addAgentToTeam(cfg, { name: 'gone', role: 'r' });
      await removeAgentFromTeam(cfg, 'gone');
      expect((await fs.readJson('.claude-team/config.json')).agents).toEqual([]);
    });
  });
});
