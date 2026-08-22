import { describe, it, expect } from 'vitest';
import { generateMasterMd } from '../../../lib/generators/docs/master.js';
import { TOKEN_BUDGETS } from '../../../lib/tokens.js';
import { minimalConfig, findLeftoverPlaceholders } from '../../helpers.js';

describe('generateMasterMd', () => {
  it('produces a non-empty markdown string with no leftover placeholders', () => {
    const config = minimalConfig();
    const md = generateMasterMd(config);
    expect(md.startsWith(`# MASTER.md — ${config.projectName}`)).toBe(true);
    expect(findLeftoverPlaceholders(md)).toEqual([]);
  });

  it('interpolates goal, overview fields, the token budget, and every agent row', () => {
    const config = minimalConfig({ projectGoal: 'Ship the v2 API', projectType: 'api', techStack: 'go' });
    const md = generateMasterMd(config);

    expect(md).toContain('Ship the v2 API');
    expect(md).toContain('| Type | api |');
    expect(md).toContain('| Stack | go |');
    expect(md).toContain(`${TOKEN_BUDGETS.masterDoc} tokens`);
    expect(md).toContain('| orchestrator | Orchestrator | idle | — |');
    for (const agent of config.agents) {
      expect(md).toContain(`| ${agent.name} | ${agent.role} | idle | — |`);
    }
  });
});
