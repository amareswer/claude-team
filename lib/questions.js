/**
 * Extracts QUESTION-NNN blocks still marked [open] from HUMAN_INPUT.md.
 * A question stays [open] until the team actions it, so `answered` tracks
 * whether its HUMAN REPLY section (the next ## block) already has content.
 */
export function parseOpenQuestions(md = '') {
  const blocks = md.split(/^## /m);
  return blocks
    .map((b, i) => ({ b, next: blocks[i + 1] || '' }))
    .filter(({ b }) => /^QUESTION-\d+ \[open\]/.test(b))
    .map(({ b, next }) => ({
      id: b.match(/^QUESTION-\d+/)[0],
      question: b.match(/\*\*Question\*\*: *(.+)/)?.[1]?.trim() || '',
      priority: b.match(/\*\*Priority\*\*: *(.+)/)?.[1]?.trim() || 'non-blocking',
      from: b.match(/\*\*From\*\*: *(.+)/)?.[1]?.trim() || 'team',
      // Reply content ends at the `---` separator; anything past it is the
      // file's own boilerplate (including comments the `## ` split can cut
      // in half).
      answered: /^HUMAN REPLY:/.test(next) &&
        next.replace(/^HUMAN REPLY:/, '')
            .split(/^-{3,}\s*$/m)[0]
            .replace(/<!--[\s\S]*?-->/g, '')
            .trim().length > 0,
    }));
}
