import { describe, it, expect } from 'vitest';
import { generateRulesMd } from '../../../lib/generators/docs/rules.js';
import { TOKEN_BUDGETS } from '../../../lib/tokens.js';
import { minimalConfig, findLeftoverPlaceholders } from '../../helpers.js';

describe('generateRulesMd', () => {
  it('produces a non-empty markdown string with no leftover placeholders', () => {
    const config = minimalConfig();
    const md = generateRulesMd(config);
    expect(md.startsWith(`# RULES.md — ${config.projectName}`)).toBe(true);
    expect(md).toContain(`${TOKEN_BUDGETS.rulesDoc} tokens`);
    expect(findLeftoverPlaceholders(md)).toEqual([]);
  });

  it.each([
    ['node-ts', '## 🟦 TypeScript / Node.js Rules'],
    ['python', '## 🐍 Python Rules'],
    ['react', '## ⚛️ React Rules'],
    ['vue', '## 💚 Vue Rules'],
    ['go', '## 🐹 Go Rules'],
    ['mixed', '## 🔧 Mixed Stack Rules'],
  ])('includes the %s stack section', (techStack, heading) => {
    const md = generateRulesMd(minimalConfig({ techStack }));
    expect(md).toContain(heading);
  });

  it.each([
    ['api', '## 🔌 API Rules'],
    ['web', '## 🌐 Web App Rules'],
    ['mobile', '## 📱 Mobile Rules'],
    ['ai', '## 🤖 AI / ML Rules'],
    ['cli', '## 🖥️ CLI Rules'],
  ])('includes the %s project-type section', (projectType, heading) => {
    const md = generateRulesMd(minimalConfig({ projectType }));
    expect(md).toContain(heading);
  });

  it('degrades gracefully (no leftover placeholders) for an unknown stack/type', () => {
    const md = generateRulesMd(minimalConfig({ techStack: 'cobol-mainframe', projectType: 'quantum-toaster' }));
    expect(findLeftoverPlaceholders(md)).toEqual([]);
    expect(md).not.toContain('## 🟦');
    expect(md).not.toContain('## 🔌');
  });
});
