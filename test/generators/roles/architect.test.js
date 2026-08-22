import { describe, it, expect } from 'vitest';
import { generateArchitectMd } from '../../../lib/generators/roles/architect.js';
import { minimalConfig, findLeftoverPlaceholders } from '../../helpers.js';

describe('generateArchitectMd', () => {
  it('produces a non-empty markdown string with the project name interpolated and no leftover placeholders', () => {
    const config = minimalConfig({ projectName: 'Rocket Ship' });
    const md = generateArchitectMd(config);
    expect(md.startsWith('# Architect — Rocket Ship')).toBe(true);
    expect(md).toContain('.claude-team/tasks/architect-inbox.json');
    expect(findLeftoverPlaceholders(md)).toEqual([]);
  });
});
