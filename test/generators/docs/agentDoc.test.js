import { describe, it, expect } from 'vitest';
import { generateAgentDocMd } from '../../../lib/generators/docs/agentDoc.js';
import { TOKEN_BUDGETS } from '../../../lib/tokens.js';
import { minimalConfig, minimalAgent, findLeftoverPlaceholders } from '../../helpers.js';

describe('generateAgentDocMd', () => {
  it('produces a non-empty markdown string with no leftover placeholders', () => {
    const md = generateAgentDocMd(minimalAgent(), minimalConfig());
    expect(typeof md).toBe('string');
    expect(md.startsWith('# Agent Memory: backend')).toBe(true);
    expect(findLeftoverPlaceholders(md)).toEqual([]);
  });

  it('interpolates agent identity and the token budget', () => {
    const agent = minimalAgent({ name: 'qa', role: 'QA Engineer', responsibilities: ['Write tests', 'File bugs'] });
    const config = minimalConfig({ projectName: 'Acme', techStack: 'python' });
    const md = generateAgentDocMd(agent, config);

    expect(md).toContain('# Agent Memory: qa');
    expect(md).toContain('QA Engineer');
    expect(md).toContain('Acme');
    expect(md).toContain('python');
    expect(md).toContain('Write tests, File bugs');
    expect(md).toContain(`${TOKEN_BUDGETS.agentDoc} tokens`);
    expect(md).toContain('.claude-team/tasks/qa-inbox.json');
  });
});
