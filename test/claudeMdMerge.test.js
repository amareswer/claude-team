import { describe, it, expect } from 'vitest';
import fs from 'fs-extra';
import { withTempCwd } from './helpers.js';
import { mergeClaudeMd, writeClaudeMd } from '../lib/claudeMdMerge.js';

describe('mergeClaudeMd', () => {
  it('creates the block when there is no existing file', () => {
    expect(mergeClaudeMd(null, '# Team')).toContain('# Team');
  });
  it('preserves existing instructions and appends the block', () => {
    const out = mergeClaudeMd('# My rules\nuse tabs\n', '# Team');
    expect(out.startsWith('# My rules\nuse tabs')).toBe(true);
    expect(out).toContain('# Team');
  });
  it('re-init replaces only its own block', () => {
    const once = mergeClaudeMd('# Mine\n', '# Team v1');
    const twice = mergeClaudeMd(once, '# Team v2');
    expect(twice).toContain('# Mine');
    expect(twice).toContain('# Team v2');
    expect(twice).not.toContain('# Team v1');
  });
  it('writeClaudeMd does not clobber a user CLAUDE.md on disk', async () => {
    await withTempCwd(async () => {
      await fs.writeFile('CLAUDE.md', 'keep me\n');
      expect(await writeClaudeMd('# Team')).toBe(true);
      expect(await fs.readFile('CLAUDE.md', 'utf8')).toContain('keep me');
    });
  });
});
