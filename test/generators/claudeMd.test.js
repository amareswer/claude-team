import { describe, it, expect } from 'vitest';
import fs from 'fs-extra';
import { generateClaudeMd } from '../../lib/generators/claudeMd.js';
import { generateCoordination } from '../../lib/generators/coordination.js';
import { generateOrchestratorMd } from '../../lib/generators/orchestrator.js';
import { generateAgentMd } from '../../lib/generators/agent.js';
import { minimalConfig, findLeftoverPlaceholders, withTempCwd } from '../helpers.js';

describe('generateClaudeMd', () => {
  it('produces a non-empty markdown string with no leftover placeholders', () => {
    const config = minimalConfig();
    const md = generateClaudeMd(config);
    expect(typeof md).toBe('string');
    expect(md.startsWith(`# ${config.projectName}`)).toBe(true);
    expect(findLeftoverPlaceholders(md)).toEqual([]);
  });

  it('lists every agent in the team table and launch instructions', () => {
    const config = minimalConfig();
    const md = generateClaudeMd(config);
    for (const agent of config.agents) {
      expect(md).toContain(`| ${agent.name} | ${agent.role} |`);
      expect(md).toContain(`.claude-team/agents/${agent.name}.md`);
      expect(md).toContain(`.claude-team/tasks/${agent.name}-inbox.json`);
    }
    // Always includes the orchestrator, which isn't in config.agents
    expect(md).toContain('| orchestrator | Project Orchestrator |');
  });

  it("matches the file structure init.js actually generates", async () => {
    await withTempCwd(async () => {
      const config = minimalConfig();

      // Mirror what init.js writes for a real team (see lib/init.js) —
      // just the parts generateClaudeMd's tree diagram references.
      await fs.ensureDir('.claude-team/agents');
      await fs.writeFile('.claude-team/ORCHESTRATOR.md', generateOrchestratorMd(config));
      for (const agent of config.agents) {
        await fs.writeFile(`.claude-team/agents/${agent.name}.md`, generateAgentMd(agent, config));
      }
      await generateCoordination(config, null); // creates tasks/, config.json siblings, etc.
      await fs.ensureDir('.claude-team/logs');

      const md = generateClaudeMd(config);

      // Pull every `.claude-team/...` path mentioned in the doc and confirm
      // it actually exists on disk — this is the "matches the actual
      // generated file structure" contract.
      const referencedPaths = [...md.matchAll(/\.claude-team\/[A-Za-z0-9_.\-/]+/g)].map((m) => m[0]);
      expect(referencedPaths.length).toBeGreaterThan(0);

      for (const p of referencedPaths) {
        // `agents/` and `tasks/` are directories in the tree diagram, not files —
        // skip bare directory references, check everything with a file extension.
        if (!/\.[a-zA-Z]+$/.test(p)) continue;
        expect(await fs.pathExists(p), `${p} referenced by CLAUDE.md but not generated`).toBe(true);
      }
    });
  });
});
