import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import {
  costFor, normalizeLimits, evaluateLimits,
  newSpin, observeFingerprint, recordNudge, spinDelayMs, isSpinning,
  inputFingerprint, logGuardEvent, readGuardEvents,
} from '../lib/guard.js';

const U = (i = 0, o = 0, cw = 0, cr = 0) => ({ inputTokens: i, outputTokens: o, cacheCreationTokens: cw, cacheReadTokens: cr });

describe('costFor', () => {
  it('prices input/output per MTok with cache write 1.25x and read 0.1x input', () => {
    // sonnet 3/15: 1M in + 1M out = 18
    expect(costFor(U(1e6, 1e6), 'sonnet')).toBeCloseTo(18);
    // opus 5/25, cache write 1M = 6.25, read 1M = 0.5
    expect(costFor(U(0, 0, 1e6, 1e6), 'opus')).toBeCloseTo(6.75);
  });
  it('treats unknown/default models as sonnet and null usage as zero', () => {
    expect(costFor(U(1e6), 'default')).toBeCloseTo(3);
    expect(costFor(U(1e6), 'mystery')).toBeCloseTo(3);
    expect(costFor(null, 'opus')).toBe(0);
  });
});

describe('normalizeLimits', () => {
  it('returns null when nothing is configured (guard off)', () => {
    expect(normalizeLimits(undefined)).toBeNull();
    expect(normalizeLimits({})).toBeNull();
    expect(normalizeLimits({ agentTokens: 0, teamTokens: -5, teamCostUsd: 'abc' })).toBeNull();
  });
  it('keeps positive numbers and defaults the action to pause', () => {
    expect(normalizeLimits({ agentTokens: 1000, teamCostUsd: 5 })).toEqual({ agentTokens: 1000, teamTokens: null, teamCostUsd: 5, action: 'pause', burnUsdPerHour: null });
  });
  it('only accepts pause|stop for the action', () => {
    expect(normalizeLimits({ teamTokens: 10, action: 'stop' }).action).toBe('stop');
    expect(normalizeLimits({ teamTokens: 10, action: 'explode' }).action).toBe('pause');
  });
});

describe('evaluateLimits', () => {
  const agents = (o) => o;
  it('is all ok with no limits', () => {
    const r = evaluateLimits(null, agents({ a: { usage: U(1e9), model: 'opus' } }));
    expect(r.teamLevel).toBe('ok');
    expect(r.agents.a.level).toBe('ok');
  });
  it('warns at 80% and stops at 100% of the per-agent token limit', () => {
    const limits = normalizeLimits({ agentTokens: 1000 });
    const r = evaluateLimits(limits, agents({
      ok: { usage: U(700), model: 'sonnet' },
      warn: { usage: U(800), model: 'sonnet' },
      stop: { usage: U(600, 400), model: 'sonnet' },
    }));
    expect(r.agents.ok.level).toBe('ok');
    expect(r.agents.warn.level).toBe('warn');
    expect(r.agents.stop.level).toBe('stop');
    expect(r.agents.stop.reason).toMatch(/1[, ]?000/);
  });
  it('counts cache tokens toward totals', () => {
    const limits = normalizeLimits({ agentTokens: 1000 });
    expect(evaluateLimits(limits, { a: { usage: U(0, 0, 500, 500), model: 'haiku' } }).agents.a.level).toBe('stop');
  });
  it('a team token limit stops every agent', () => {
    const limits = normalizeLimits({ teamTokens: 1000 });
    const r = evaluateLimits(limits, agents({ a: { usage: U(600), model: 'sonnet' }, b: { usage: U(500), model: 'sonnet' }, c: { usage: U(0), model: 'sonnet' } }));
    expect(r.teamLevel).toBe('stop');
    expect(r.team.tokens).toBe(1100);
    for (const n of ['a', 'b', 'c']) expect(r.agents[n].level).toBe('stop');
  });
  it('a team cost limit uses per-agent model pricing', () => {
    const limits = normalizeLimits({ teamCostUsd: 10 });
    // opus 1M in = $5, sonnet 1M in = $3 → $8 = 80% → warn
    const r = evaluateLimits(limits, agents({ a: { usage: U(1e6), model: 'opus' }, b: { usage: U(1e6), model: 'sonnet' } }));
    expect(r.team.costUsd).toBeCloseTo(8);
    expect(r.teamLevel).toBe('warn');
    expect(r.agents.a.level).toBe('warn');
    // add a third → $11 → stop
    const r2 = evaluateLimits(limits, agents({ a: { usage: U(1e6), model: 'opus' }, b: { usage: U(1e6), model: 'sonnet' }, c: { usage: U(1e6), model: 'sonnet' } }));
    expect(r2.teamLevel).toBe('stop');
  });
  it('the worse of agent-level and team-level wins', () => {
    const limits = normalizeLimits({ agentTokens: 1000, teamTokens: 100000 });
    const r = evaluateLimits(limits, agents({ a: { usage: U(1200), model: 'sonnet' }, b: { usage: U(10), model: 'sonnet' } }));
    expect(r.agents.a.level).toBe('stop');
    expect(r.agents.b.level).toBe('ok');
    expect(r.teamLevel).toBe('ok');
  });
});

describe('spin backoff', () => {
  const BASE = 15_000;
  it('never spins before the threshold; nudges at the base cadence', () => {
    const s = newSpin();
    observeFingerprint(s, 'fp1');
    for (let i = 0; i < 4; i++) recordNudge(s);
    expect(isSpinning(s)).toBe(false);
    expect(spinDelayMs(s, BASE)).toBe(BASE);
  });
  it('after 5 consecutive unchanged nudges it backs off exponentially, capped at 30 minutes', () => {
    const s = newSpin();
    observeFingerprint(s, 'fp1');
    for (let i = 0; i < 5; i++) recordNudge(s);
    expect(isSpinning(s)).toBe(true);
    expect(spinDelayMs(s, BASE)).toBe(BASE * 2);
    recordNudge(s);
    expect(spinDelayMs(s, BASE)).toBe(BASE * 4);
    for (let i = 0; i < 20; i++) recordNudge(s);
    expect(spinDelayMs(s, BASE)).toBe(30 * 60_000);
  });
  it('a changed fingerprint (new input arrived) resets immediately', () => {
    const s = newSpin();
    observeFingerprint(s, 'fp1');
    for (let i = 0; i < 8; i++) recordNudge(s);
    expect(isSpinning(s)).toBe(true);
    observeFingerprint(s, 'fp2');
    expect(isSpinning(s)).toBe(false);
    expect(spinDelayMs(s, BASE)).toBe(BASE);
  });
  it('observing the same fingerprint does not reset', () => {
    const s = newSpin();
    observeFingerprint(s, 'fp1');
    for (let i = 0; i < 6; i++) recordNudge(s);
    observeFingerprint(s, 'fp1');
    expect(isSpinning(s)).toBe(true);
  });
});

describe('inputFingerprint', () => {
  let dir, prev;
  beforeEach(async () => {
    prev = process.cwd();
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'guard-'));
    await fs.ensureDir(path.join(dir, '.claude-team/tasks'));
    process.chdir(dir);
  });
  afterEach(async () => { process.chdir(prev); await fs.remove(dir); });

  it('changes when an inbox/outbox/queue/master file or HUMAN_INPUT changes', async () => {
    await fs.writeJson('.claude-team/tasks/a-inbox.json', { tasks: [] });
    const f0 = await inputFingerprint();
    await fs.writeJson('.claude-team/tasks/a-inbox.json', { tasks: [{ id: 1 }] });
    const f1 = await inputFingerprint();
    expect(f1).not.toBe(f0);
    await fs.writeFile('.claude-team/HUMAN_INPUT.md', 'q');
    expect(await inputFingerprint()).not.toBe(f1);
  });
  it('ignores status files (the agent rewrites them every turn)', async () => {
    await fs.writeJson('.claude-team/tasks/a-inbox.json', { tasks: [] });
    const f0 = await inputFingerprint();
    await fs.writeJson('.claude-team/tasks/a-status.json', { lastUpdated: 'now' });
    expect(await inputFingerprint()).toBe(f0);
  });
  it('does not throw when the folder is missing', async () => {
    await fs.remove('.claude-team');
    expect(typeof (await inputFingerprint())).toBe('string');
  });
});

describe('guard log', () => {
  let dir, prev;
  beforeEach(async () => { prev = process.cwd(); dir = await fs.mkdtemp(path.join(os.tmpdir(), 'guard-')); process.chdir(dir); });
  afterEach(async () => { process.chdir(prev); await fs.remove(dir); });

  it('appends events and reads back the most recent ones', async () => {
    await logGuardEvent({ agent: 'a', kind: 'budget-warn', detail: 'x' });
    await logGuardEvent({ agent: 'b', kind: 'budget-stop', detail: 'y' });
    const ev = await readGuardEvents(10);
    expect(ev).toHaveLength(2);
    expect(ev[1]).toMatchObject({ agent: 'b', kind: 'budget-stop' });
    expect(ev[0].at).toBeTruthy();
    expect(await readGuardEvents(1)).toHaveLength(1);
  });
  it('returns [] when no log exists and skips corrupt lines', async () => {
    expect(await readGuardEvents(5)).toEqual([]);
    await fs.ensureDir('.claude-team/logs');
    await fs.writeFile('.claude-team/logs/guard.log', '{"kind":"ok"}\nnot json\n');
    expect(await readGuardEvents(5)).toHaveLength(1);
  });
});

import { newBurn, observeBurn, burnRatePerHour, newRepeat, observeToolCall, isRepeating, REPEAT_THRESHOLD } from '../lib/guard.js';

describe('burn rate', () => {
  const MIN = 60_000;
  it('is null until there are two samples at least 2 minutes apart', () => {
    const b = newBurn();
    expect(burnRatePerHour(b)).toBeNull();
    observeBurn(b, 0, 0);
    observeBurn(b, 1 * MIN, 5);
    expect(burnRatePerHour(b)).toBeNull();
  });
  it('is $/hour over the samples in the window', () => {
    const b = newBurn();
    observeBurn(b, 0, 0);
    observeBurn(b, 6 * MIN, 1); // $1 in 6 minutes = $10/h
    expect(burnRatePerHour(b)).toBeCloseTo(10);
  });
  it('forgets samples older than 10 minutes, so a past spike fades', () => {
    const b = newBurn();
    observeBurn(b, 0, 0);
    observeBurn(b, 5 * MIN, 5);
    observeBurn(b, 20 * MIN, 5.1);
    observeBurn(b, 25 * MIN, 5.2);
    expect(burnRatePerHour(b)).toBeLessThan(2);
  });
  it('a burn limit alone turns the guard on', () => {
    expect(normalizeLimits({ burnUsdPerHour: 12 })).toMatchObject({ burnUsdPerHour: 12, agentTokens: null });
    expect(normalizeLimits({ burnUsdPerHour: 0 })).toBeNull();
  });
});

describe('repeated tool calls', () => {
  it('fires once when the same call is made REPEAT_THRESHOLD times in a row', () => {
    const r = newRepeat();
    const fired = [];
    for (let i = 0; i < REPEAT_THRESHOLD + 2; i++) fired.push(observeToolCall(r, 'Bash', { command: 'npm test' }, 'npm test'));
    expect(fired.filter(Boolean)).toHaveLength(1);
    expect(fired[REPEAT_THRESHOLD - 1]).toBe(true);
    expect(isRepeating(r)).toBe(true);
  });
  it('a different call, or different input, resets the run', () => {
    const r = newRepeat();
    for (let i = 0; i < 3; i++) observeToolCall(r, 'Read', { file_path: 'a' });
    observeToolCall(r, 'Read', { file_path: 'b' });
    expect(isRepeating(r)).toBe(false);
    expect(r.count).toBe(1);
  });
  it('keeps the tool and detail of the repeated call', () => {
    const r = newRepeat();
    for (let i = 0; i < 4; i++) observeToolCall(r, 'Bash', { command: 'x' }, 'x');
    expect(r).toMatchObject({ tool: 'Bash', detail: 'x', count: 4 });
  });
});
