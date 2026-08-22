import { describe, it, expect } from 'vitest';
import { generateHumanInputMd, generateArchitectureMd, generateStyleGuideMd } from '../../../lib/generators/docs/specialDocs.js';
import { minimalConfig, findLeftoverPlaceholders } from '../../helpers.js';

describe('generateHumanInputMd', () => {
  it('produces QUESTION-001 open, with the project goal interpolated', () => {
    const config = minimalConfig({ projectGoal: 'Build a CLI that never crashes' });
    const md = generateHumanInputMd(config);
    expect(md.startsWith(`# Human Input — ${config.projectName}`)).toBe(true);
    expect(md).toContain('## QUESTION-001 [open]');
    expect(md).toContain('Build a CLI that never crashes');
    expect(md).toContain('## HUMAN REPLY:');
    expect(findLeftoverPlaceholders(md)).toEqual([]);
  });
});

describe('generateArchitectureMd', () => {
  it('produces a DRAFT-status doc with no leftover placeholders', () => {
    const config = minimalConfig();
    const md = generateArchitectureMd(config);
    expect(md.startsWith(`# Architecture — ${config.projectName}`)).toBe(true);
    expect(md).toContain('## Status: DRAFT | READY');
    expect(findLeftoverPlaceholders(md)).toEqual([]);
  });
});

describe('generateStyleGuideMd', () => {
  it('interpolates project type and goal with no leftover placeholders', () => {
    const config = minimalConfig({ projectType: 'blog', projectGoal: 'Grow organic traffic' });
    const md = generateStyleGuideMd(config);
    expect(md.startsWith(`# Style Guide — ${config.projectName}`)).toBe(true);
    expect(md).toContain('**Type**: blog');
    expect(md).toContain('Grow organic traffic');
    expect(findLeftoverPlaceholders(md)).toEqual([]);
  });
});
