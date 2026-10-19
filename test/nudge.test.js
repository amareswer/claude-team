import { describe, it, expect } from 'vitest';
import { maybeNudge, NUDGE_TEXT, NUDGE_SUBMIT_DELAY_MS } from '../lib/office.js';
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
