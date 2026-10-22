import { describe, it, expect } from 'vitest';
import fs from 'fs-extra';
import { maybeNudge, hasActionableWork, NUDGE_TEXT, NUDGE_SUBMIT_DELAY_MS } from '../lib/office.js';
import { withTempCwd, minimalConfig } from './helpers.js';
import { newSpin } from '../lib/guard.js';

const fakeSession = (overrides = {}) => {
  const writes = [];
  return {
    writes,
    name: 'backend', exited: false, buffer: '', autoLoop: true,
    pollIntervalMs: 15_000, lastOutputAt: 0, lastInputAt: 0, lastNudgeAt: 0,
    spin: newSpin(), spinLogged: false,
    pty: { write: (d) => writes.push({ d, at: Date.now() }) },
    ...overrides,
  };
};

describe('auto-check nudge delivery', () => {
  it('types the text, then presses Enter in a SEPARATE write after a pause', async () => {
    // Claude Code treats text+Enter arriving in one chunk as a paste: the text
    // lands in the input box and is never submitted (seen live on 2.1.302).
    const s = fakeSession();
    await maybeNudge(s, Date.now());
    expect(s.writes.map((w) => w.d)).toEqual([NUDGE_TEXT, '\r']);
    expect(s.writes[1].at - s.writes[0].at).toBeGreaterThanOrEqual(NUDGE_SUBMIT_DELAY_MS - 20);
    expect(s.writes[0].d).not.toContain('\r');
  });

  it('records the nudge only once it was sent', async () => {
    const s = fakeSession();
    const now = Date.now();
    await maybeNudge(s, now);
    expect(s.lastNudgeAt).toBe(now);
  });

  it('does not nudge a session that is quiet for too short a time, or showing a prompt', async () => {
    const now = Date.now();
    const busy = fakeSession({ lastOutputAt: now - 1000 });
    await maybeNudge(busy, now);
    const prompt = fakeSession({ buffer: 'Do you want to proceed? 1. Yes 2. No Esc to cancel Tab to amend' });
    await maybeNudge(prompt, now);
    expect(busy.writes).toEqual([]);
    expect(prompt.writes).toEqual([]);
  });

  it('does not press Enter if the session ended during the pause', async () => {
    const s = fakeSession();
    const p = maybeNudge(s, Date.now());
    s.exited = true;
    await p;
    expect(s.writes.map((w) => w.d)).toEqual([NUDGE_TEXT]);
  });
});

describe('no nudging of a worker that is only waiting', () => {
  const project = async (tasks) => {
    await fs.outputJson('.claude-team/config.json', { ...minimalConfig(), agents: [{ name: 'backend', isLeadership: false }, { name: 'lead', isLeadership: true }] });
    await fs.outputJson('.claude-team/tasks/master.json', { tasks });
  };
  const quiet = () => ({ lastOutputAt: 0, lastInputAt: 0, lastNudgeAt: 0 });

  it('knows whether a worker has anything to act on', async () => {
    await withTempCwd(async () => {
      await project([{ id: 'a', assignedTo: 'backend', status: 'review' }, { id: 'b', assignedTo: 'backend', status: 'done' }]);
      expect(await hasActionableWork('backend')).toBe(false);
      await project([{ id: 'a', assignedTo: 'backend', status: 'review' }, { id: 'c', assignedTo: 'backend', status: 'assigned' }]);
      expect(await hasActionableWork('backend')).toBe(true);
      expect(await hasActionableWork('lead')).toBe(true);
      expect(await hasActionableWork('orchestrator')).toBe(true);
      expect(await hasActionableWork('unknown-agent')).toBe(true);
    });
  });

  it('nudges once for a change, then stays quiet while the worker only waits on review', async () => {
    await withTempCwd(async () => {
      await project([{ id: 'a', assignedTo: 'backend', status: 'review' }]);
      const s = fakeSession({ ...quiet() });
      const t = Date.now();
      await maybeNudge(s, t);
      expect(s.writes.length).toBe(2);
      await maybeNudge(s, t + 60_000);
      await maybeNudge(s, t + 120_000);
      expect(s.writes.length).toBe(2);
    });
  });

  it('keeps nudging a worker that has an assigned task', async () => {
    await withTempCwd(async () => {
      await project([{ id: 'a', assignedTo: 'backend', status: 'assigned' }]);
      const s = fakeSession({ ...quiet() });
      const t = Date.now();
      await maybeNudge(s, t);
      await maybeNudge(s, t + 60_000);
      expect(s.writes.length).toBe(4);
    });
  });
});

describe('an agent that keeps finding nothing new', () => {
  it('is nudged a few times, then left alone until a team file changes', async () => {
    await withTempCwd(async () => {
      await fs.outputJson('.claude-team/config.json', { ...minimalConfig(), agents: [{ name: 'lead', isLeadership: true }] });
      await fs.outputJson('.claude-team/tasks/master.json', { tasks: [] });
      const s = fakeSession({ name: 'lead', lastOutputAt: 0, lastInputAt: 0, lastNudgeAt: 0, pollIntervalMs: 1000 });
      let t = Date.now();
      for (let i = 0; i < 12; i++) { await maybeNudge(s, t); t += 3_600_000; }
      const nudges = s.writes.filter((w) => w.d === NUDGE_TEXT).length;
      expect(nudges).toBeLessThanOrEqual(6); // SPIN_THRESHOLD, then silence even hours later
      await fs.outputJson('.claude-team/tasks/master.json', { tasks: [{ id: 'x', status: 'assigned', assignedTo: 'lead' }] });
      await maybeNudge(s, t + 3_600_000); // a file changed: it is told again
      expect(s.writes.filter((w) => w.d === NUDGE_TEXT).length).toBe(nudges + 1);
    });
  });
});
