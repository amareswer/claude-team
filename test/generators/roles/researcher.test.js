import { describe, it, expect } from 'vitest';
import { generateResearcherMd } from '../../../lib/generators/roles/researcher.js';
import { minimalConfig, minimalContentConfig, findLeftoverPlaceholders } from '../../helpers.js';

describe('generateResearcherMd', () => {
  it('produces a non-empty markdown string with no leftover placeholders', () => {
    const config = minimalConfig({ projectName: 'Rocket Ship' });
    const md = generateResearcherMd(config);
    expect(md.startsWith('# Researcher — Rocket Ship')).toBe(true);
    expect(findLeftoverPlaceholders(md)).toEqual([]);
  });

  it('renders the Technical Research section for technical projects', () => {
    const md = generateResearcherMd(minimalConfig());
    expect(md).toContain('### Technical Research');
    expect(md).not.toContain('### Content Research');
  });

  it('renders the Content Research section for content projects', () => {
    const md = generateResearcherMd(minimalContentConfig());
    expect(md).toContain('### Content Research');
    expect(md).not.toContain('### Technical Research');
  });
});
