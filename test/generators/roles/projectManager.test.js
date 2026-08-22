import { describe, it, expect } from 'vitest';
import { generateProjectManagerMd } from '../../../lib/generators/roles/projectManager.js';
import { minimalConfig, findLeftoverPlaceholders } from '../../helpers.js';

describe('generateProjectManagerMd', () => {
  it('produces a non-empty markdown string with the project name interpolated and no leftover placeholders', () => {
    const config = minimalConfig({ projectName: 'Rocket Ship' });
    const md = generateProjectManagerMd(config);
    expect(md.startsWith('# Project Manager — Rocket Ship')).toBe(true);
    expect(md).toContain('.claude-team/HUMAN_INPUT.md');
    expect(findLeftoverPlaceholders(md)).toEqual([]);
  });
});
