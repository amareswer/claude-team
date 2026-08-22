import { describe, it, expect } from 'vitest';
import { generateAgentMd, isContentProject } from '../../lib/generators/agent.js';
import { TOKEN_THRESHOLDS } from '../../lib/tokens.js';
import { minimalConfig, minimalContentConfig, minimalAgent, findLeftoverPlaceholders } from '../helpers.js';

describe('generateAgentMd', () => {
  it('produces a non-empty markdown string', () => {
    const md = generateAgentMd(minimalAgent(), minimalConfig());
    expect(typeof md).toBe('string');
    expect(md.length).toBeGreaterThan(0);
    expect(md.startsWith('# Agent: backend')).toBe(true);
  });

  it('interpolates every agent field with no leftover placeholders', () => {
    const agent = minimalAgent({
      name: 'db-engineer',
      role: 'Database Engineer',
      responsibilities: ['Design schemas', 'Write migrations', 'Tune queries'],
    });
    const config = minimalConfig({ projectName: 'Acme Rocket' });
    const md = generateAgentMd(agent, config);

    expect(md).toContain('db-engineer');
    expect(md).toContain('Database Engineer');
    expect(md).toContain('Design schemas, Write migrations, Tune queries');
    expect(md).toContain('Acme Rocket');
    // Every path referencing this agent's own files is interpolated, not templated
    expect(md).toContain('.claude-team/docs/agents/db-engineer.md');
    expect(md).toContain('.claude-team/tasks/db-engineer-inbox.json');
    expect(md).toContain('.claude-team/tasks/db-engineer-outbox.json');
    expect(md).toContain('.claude-team/tasks/db-engineer-status.json');
    // Token thresholds are rendered as rounded percentages, not raw fractions
    expect(md).toContain(`${Math.round(TOKEN_THRESHOLDS.warn * 100)}%`);
    expect(md).toContain(`${Math.round(TOKEN_THRESHOLDS.hard * 100)}%`);

    expect(findLeftoverPlaceholders(md)).toEqual([]);
  });

  it('lists every other agent under "Your Team" but not itself', () => {
    const config = minimalConfig({
      agents: [
        minimalAgent({ name: 'backend' }),
        minimalAgent({ name: 'frontend', role: 'Frontend' }),
        minimalAgent({ name: 'qa', role: 'QA' }),
      ],
    });
    const md = generateAgentMd(config.agents[0], config);
    expect(md).toContain('- **frontend** (Frontend)');
    expect(md).toContain('- **qa** (QA)');
    // Should not list itself as a teammate
    expect(md).not.toContain('**backend** (Backend Engineer)');
  });

  it('falls back to "(solo agent)" when it is the only agent', () => {
    const agent = minimalAgent();
    const config = minimalConfig({ agents: [agent] });
    const md = generateAgentMd(agent, config);
    expect(md).toContain('(solo agent)');
  });

  it('points at STYLE_GUIDE.md for content projects and ARCHITECTURE.md for technical', () => {
    const techConfig = minimalConfig();
    const techMd = generateAgentMd(techConfig.agents[0], techConfig);
    expect(techMd).toContain('.claude-team/docs/ARCHITECTURE.md');
    expect(techMd).not.toContain('.claude-team/docs/STYLE_GUIDE.md');

    const contentConfig = minimalContentConfig();
    const contentMd = generateAgentMd(contentConfig.agents[0], contentConfig);
    expect(contentMd).toContain('.claude-team/docs/STYLE_GUIDE.md');
    expect(contentMd).not.toContain('.claude-team/docs/ARCHITECTURE.md');
  });

  it('includes the cross-session messaging section only when enabled, with no leftover placeholders either way', () => {
    const on = minimalConfig({ coordination: { ...minimalConfig().coordination, enableCrossSessionMessaging: true } });
    const mdOn = generateAgentMd(on.agents[0], on);
    expect(mdOn).toContain('ListAgents');
    expect(mdOn).toContain('SendMessage');
    expect(findLeftoverPlaceholders(mdOn)).toEqual([]);

    const off = minimalConfig({ coordination: { ...minimalConfig().coordination, enableCrossSessionMessaging: false } });
    const mdOff = generateAgentMd(off.agents[0], off);
    expect(mdOff).not.toContain('ListAgents');
    expect(findLeftoverPlaceholders(mdOff)).toEqual([]);
  });
});

describe('isContentProject', () => {
  it('reads projectCategory when present', () => {
    expect(isContentProject({ projectCategory: 'content' })).toBe(true);
    expect(isContentProject({ projectCategory: 'technical' })).toBe(false);
  });

  it('falls back to projectType for configs saved before projectCategory existed', () => {
    expect(isContentProject({ projectType: 'blog' })).toBe(true);
    expect(isContentProject({ projectType: 'book' })).toBe(true);
    expect(isContentProject({ projectType: 'cli' })).toBe(false);
    expect(isContentProject({ projectType: 'web' })).toBe(false);
  });
});
