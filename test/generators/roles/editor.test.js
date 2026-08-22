import { describe, it, expect } from 'vitest';
import { generateEditorMd } from '../../../lib/generators/roles/editor.js';
import { minimalContentConfig, findLeftoverPlaceholders } from '../../helpers.js';

describe('generateEditorMd', () => {
  it('produces a non-empty markdown string with the project name interpolated and no leftover placeholders', () => {
    const config = minimalContentConfig({ projectName: 'Tech Blog' });
    const md = generateEditorMd(config);
    expect(md.startsWith('# Editor — Tech Blog')).toBe(true);
    expect(md).toContain('.claude-team/docs/STYLE_GUIDE.md');
    expect(findLeftoverPlaceholders(md)).toEqual([]);
  });
});
