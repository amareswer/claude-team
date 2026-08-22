import { describe, it, expect } from 'vitest';
import { generateReviewChecklistMd } from '../../../lib/generators/docs/reviewChecklist.js';
import { TOKEN_BUDGETS } from '../../../lib/tokens.js';
import { minimalConfig, findLeftoverPlaceholders } from '../../helpers.js';

describe('generateReviewChecklistMd', () => {
  it('produces a non-empty markdown string with no leftover placeholders', () => {
    const config = minimalConfig();
    const md = generateReviewChecklistMd(config);
    expect(md.startsWith(`# Review Checklist — ${config.projectName}`)).toBe(true);
    expect(findLeftoverPlaceholders(md)).toEqual([]);
  });

  it('declares the reviewChecklistDoc token budget and states it in the doc', () => {
    expect(TOKEN_BUDGETS.reviewChecklistDoc).toBeGreaterThan(0);
    const md = generateReviewChecklistMd(minimalConfig());
    expect(md).toContain(`${TOKEN_BUDGETS.reviewChecklistDoc} tokens`);
  });

  it('covers open questions, conflicts, rules violations, and outbox completeness', () => {
    const md = generateReviewChecklistMd(minimalConfig());
    expect(md).toContain('HUMAN_INPUT.md');
    expect(md).toContain('[open]');
    expect(md).toContain('CONFLICT');
    expect(md).toContain('changelog.md');
    expect(md).toContain('.claude-team/reviews/');
    expect(md).toContain('RULES.md');
    expect(md).toContain('filesChanged');
    expect(md).toContain('-outbox.json');
  });
});
