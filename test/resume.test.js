import { describe, it, expect } from 'vitest';
import fs from 'fs-extra';
import { withTempCwd, minimalConfig } from './helpers.js';
import { buildResume, renderResume } from '../lib/resume.js';

async function seed(config, files = {}) {
  await fs.ensureDir('.claude-team/tasks');
  for (const a of config.agents) {
    await fs.writeJson(`.claude-team/tasks/${a.name}-status.json`, { status: 'idle', lastUpdated: '2026-10-01T10:00:00Z' });
    await fs.writeJson(`.claude-team/tasks/${a.name}-outbox.json`, { completedTasks: [] });
    await fs.writeJson(`.claude-team/tasks/${a.name}-inbox.json`, { tasks: [], messages: [] });
  }
  for (const [f, v] of Object.entries(files)) {
    if (typeof v === 'string') await fs.outputFile(f, v); else await fs.outputJson(f, v);
  }
}

describe('buildResume', () => {
  it('summarises finished work, blockers, questions and orders next steps by urgency', async () => {
    await withTempCwd(async () => {
      const config = minimalConfig();
      await seed(config, {
        '.claude-team/tasks/master.json': { tasks: [
          { id: 't1', title: 'Login API', status: 'done', assignedTo: 'backend' },
          { id: 't2', title: 'Login form', status: 'in_progress', assignedTo: 'frontend' },
          { id: 't3', title: 'Docs', status: 'queued', assignedTo: 'unassigned' },
        ] },
        '.claude-team/tasks/backend-outbox.json': { completedTasks: [{ id: 't1', title: 'Login API', completedAt: '2026-10-02T09:00:00Z' }] },
        '.claude-team/tasks/frontend-status.json': { status: 'blocked', blockedReason: 'needs response format', lastUpdated: '2026-10-03T09:00:00Z' },
        '.claude-team/HUMAN_INPUT.md': '## QUESTION-001 [open]\n**Question**: Which auth?\n**Priority**: blocking\n**From**: backend\n\n## HUMAN REPLY:\n<!-- Write your answer here -->\n\n---\n',
      });
      const r = await buildResume(config);
      expect(r.counts).toMatchObject({ total: 3, done: 1, inProgress: 1, queued: 1 });
      expect(r.completions[0]).toMatchObject({ agent: 'backend', title: 'Login API' });
      expect(r.lastActivity).toBe('2026-10-03T09:00:00.000Z');
      expect(r.next.map((n) => n.kind)).toEqual(['question', 'blocked', 'assign']);
      expect(r.next[0].blocking).toBe(true);
      expect(r.git).toBeNull(); // temp dir is not a git repo
      const text = renderResume(r);
      expect(text).toContain('Login API');
      expect(text).toContain('needs response format');
    });
  });

  it('reports unreadable state files instead of silently skipping them', async () => {
    await withTempCwd(async () => {
      const config = minimalConfig();
      await seed(config, { '.claude-team/tasks/master.json': '{ not json' });
      const r = await buildResume(config);
      expect(r.problems.join('\n')).toMatch(/master\.json/);
      expect(renderResume(r)).toContain('Unreadable state files');
    });
  });

  it('says nothing is pending for an idle project', async () => {
    await withTempCwd(async () => {
      const config = minimalConfig();
      await seed(config, { '.claude-team/tasks/master.json': { tasks: [] } });
      const r = await buildResume(config);
      expect(r.next).toEqual([{ kind: 'idle', text: expect.stringContaining('Nothing pending') }]);
    });
  });
});
