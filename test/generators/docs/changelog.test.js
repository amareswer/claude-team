import { describe, it, expect } from 'vitest';
import { generateChangelogMd, generateDecisionsMd } from '../../../lib/generators/docs/changelog.js';
import { minimalConfig, findLeftoverPlaceholders } from '../../helpers.js';

describe('generateChangelogMd', () => {
  it('produces a non-empty markdown string with a valid first entry', () => {
    const config = minimalConfig();
    const md = generateChangelogMd(config);
    expect(md.startsWith(`# Changelog — ${config.projectName}`)).toBe(true);
    expect(md).toContain(`STARTED: project initialised — ${config.agents.length} agents configured`);
    // The seed entry itself must be a well-formed [ISO-date] [agent] ACTION: ... line
    expect(md).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] \[orchestrator\] STARTED: /);
    expect(findLeftoverPlaceholders(md)).toEqual([]);
  });
});

describe('generateDecisionsMd', () => {
  it('produces a non-empty markdown string with a valid DEC-001 entry', () => {
    const config = minimalConfig({ techStack: 'go', projectType: 'api' });
    const md = generateDecisionsMd(config);
    expect(md.startsWith(`# Decisions — ${config.projectName}`)).toBe(true);
    expect(md).toContain('## DEC-001: Project Initialisation');
    expect(md).toContain('Use go for api project');
    expect(findLeftoverPlaceholders(md)).toEqual([]);
  });
});
