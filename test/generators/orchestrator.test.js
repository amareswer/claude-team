import { describe, it, expect } from 'vitest';
import { generateOrchestratorMd } from '../../lib/generators/orchestrator.js';
import { minimalConfig, findLeftoverPlaceholders } from '../helpers.js';

describe('generateOrchestratorMd', () => {
  it('produces a non-empty markdown string with no leftover placeholders', () => {
    const config = minimalConfig();
    const md = generateOrchestratorMd(config);
    expect(typeof md).toBe('string');
    expect(md.startsWith(`# ORCHESTRATOR.md — ${config.projectName}`)).toBe(true);
    expect(findLeftoverPlaceholders(md)).toEqual([]);
  });

  it('lists every agent with their role and responsibilities', () => {
    const config = minimalConfig();
    const md = generateOrchestratorMd(config);
    for (const agent of config.agents) {
      expect(md).toContain(`- **${agent.name}** (${agent.role}): ${agent.responsibilities.join(', ')}`);
      expect(md).toContain(`.claude-team/tasks/${agent.name}-inbox.json`);
    }
  });

  it('renders the configured poll interval in the loop section', () => {
    const config = minimalConfig({ coordination: { ...minimalConfig().coordination, pollInterval: 42 } });
    const md = generateOrchestratorMd(config);
    expect(md).toContain('Every 42 seconds:');
  });

  it('always includes the conflict detection protocol', () => {
    const md = generateOrchestratorMd(minimalConfig());
    expect(md).toContain('## 🔒 Conflict Detection Protocol');
    expect(md).toContain('"type": "conflict"');
    expect(md).toContain('.claude-team/docs/changelog.md');
  });

  it('includes the messaging section only when cross-session messaging is enabled', () => {
    const on = minimalConfig({ coordination: { ...minimalConfig().coordination, enableCrossSessionMessaging: true } });
    const mdOn = generateOrchestratorMd(on);
    expect(mdOn).toContain('Talking to a Live Peer Directly');
    expect(mdOn).toContain(`orchestrator, ${on.agents.map((a) => a.name).join(', ')}`);
    expect(findLeftoverPlaceholders(mdOn)).toEqual([]);

    const off = minimalConfig({ coordination: { ...minimalConfig().coordination, enableCrossSessionMessaging: false } });
    const mdOff = generateOrchestratorMd(off);
    expect(mdOff).not.toContain('Talking to a Live Peer Directly');
    expect(findLeftoverPlaceholders(mdOff)).toEqual([]);
  });
});
