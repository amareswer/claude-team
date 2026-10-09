import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs-extra';
import inquirer from 'inquirer';
import { withTempCwd, minimalConfig } from './helpers.js';

vi.mock('inquirer', () => ({ default: { prompt: vi.fn() } }));
vi.mock('ora', () => ({
  default: () => ({ start: () => ({ succeed() {}, fail() {}, set text(_) {} }) }),
}));

beforeEach(() => {
  inquirer.prompt.mockReset();
  inquirer.prompt.mockResolvedValue({ confirm: true });
});

async function seed() {
  const config = minimalConfig({ projectName: 'Demo' });
  await fs.outputJson('.claude-team/config.json', config);
  await fs.outputFile('.claude-team/docs/MASTER.md', '# MASTER\nthe original project knowledge\n');
  await fs.outputFile('.claude-team/docs/decisions.md', '# Decisions\nuse sqlite\n');
  await fs.outputFile('.claude-team/docs/agents/backend.md', '# backend memory\nhard-won lesson\n');
  await fs.outputJson('.claude-team/tasks/master.json', { tasks: [] });
  return config;
}

describe('runArchive — recovery: repeated archives never destroy content', () => {
  it('a second archive on the same day gets its own folder and the first keeps the original documents', async () => {
    await withTempCwd(async () => {
      await seed();
      const { runArchive } = await import('../lib/archive.js');
      await runArchive();
      await runArchive();

      const root = '.claude-team/docs/archive';
      const dirs = (await fs.readdir(root)).filter((d) => d.startsWith('Demo-')).sort();
      expect(dirs).toHaveLength(2);
      const [first, second] = [dirs.find((d) => !/-2$/.test(d)), dirs.find((d) => /-2$/.test(d))];

      // first archive still holds the real documents, not pointer text
      expect(await fs.readFile(`${root}/${first}/MASTER.md`, 'utf8')).toContain('the original project knowledge');
      expect(await fs.readFile(`${root}/${first}/decisions.md`, 'utf8')).toContain('use sqlite');
      expect(await fs.readFile(`${root}/${first}/agents/backend.md`, 'utf8')).toContain('hard-won lesson');

      // the second run found only pointers and must not have archived those as if they were documents
      expect(await fs.pathExists(`${root}/${second}/MASTER.md`)).toBe(false);
      expect(await fs.pathExists(`${root}/${second}/agents/backend.md`)).toBe(false);

      // the live docs are still the pointer from the first run
      expect(await fs.readFile('.claude-team/docs/MASTER.md', 'utf8')).toMatch(/^# Archived\n/);
    });
  });
});
