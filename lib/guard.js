import crypto from 'crypto';
import fs from 'fs-extra';

// Spend limits and idle-spin backoff for office-launched agents. Pure logic
// plus a few small file helpers; lib/office.js wires them into the supervisor.

// ── Cost ────────────────────────────────────────────────────────────────────

// API-equivalent $ per MTok [input, output]; cache writes bill at 1.25× input,
// cache reads at 0.1×. "default" is assumed Sonnet — it's an estimate either way.
const PRICING = { opus: [5, 25], sonnet: [3, 15], haiku: [1, 5], default: [3, 15] };

export function costFor(u, model) {
  if (!u) return 0;
  const [inP, outP] = PRICING[model] || PRICING.default;
  return (u.inputTokens * inP + u.outputTokens * outP
        + u.cacheCreationTokens * 1.25 * inP + u.cacheReadTokens * 0.1 * inP) / 1e6;
}

export function totalTokens(u) {
  return u ? u.inputTokens + u.outputTokens + u.cacheCreationTokens + u.cacheReadTokens : 0;
}

// ── Budgets ─────────────────────────────────────────────────────────────────

const WARN_AT = 0.8;
const positive = (n) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null);

/** config.limits → normalized limits, or null when no limit is set (guard off). */
export function normalizeLimits(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const limits = {
    agentTokens: positive(raw.agentTokens),
    teamTokens: positive(raw.teamTokens),
    teamCostUsd: positive(raw.teamCostUsd),
    action: raw.action === 'stop' ? 'stop' : 'pause',
    burnUsdPerHour: positive(raw.burnUsdPerHour), // warn-only: an agent spending faster than this
  };
  return limits.agentTokens || limits.teamTokens || limits.teamCostUsd || limits.burnUsdPerHour ? limits : null;
}

const RANK = { ok: 0, warn: 1, stop: 2 };
const worse = (a, b) => (RANK[b.level] > RANK[a.level] ? b : a);

function levelFor(used, limit, label, fmt = (n) => n.toLocaleString('en-US')) {
  if (!limit) return { level: 'ok', reason: null };
  if (used >= limit) return { level: 'stop', reason: `${label} limit reached (${fmt(used)} of ${fmt(limit)})` };
  if (used >= limit * WARN_AT) return { level: 'warn', reason: `${label} at ${Math.round((used / limit) * 100)}% of limit (${fmt(used)} of ${fmt(limit)})` };
  return { level: 'ok', reason: null };
}

/**
 * agents: { name: { usage, model } } with cumulative usage.
 * Returns { team: {tokens, costUsd}, teamLevel, agents: { name: {level, reason} } }.
 * A team-level limit applies to every agent; the worse of agent- and team-level wins.
 */
export function evaluateLimits(limits, agents) {
  let tokens = 0, costUsd = 0;
  for (const a of Object.values(agents)) { tokens += totalTokens(a.usage); costUsd += costFor(a.usage, a.model); }
  const team = { tokens, costUsd };
  const usd = (n) => `$${n.toFixed(2)}`;
  let teamResult = { level: 'ok', reason: null };
  if (limits) {
    teamResult = worse(levelFor(tokens, limits.teamTokens, 'Team token'), levelFor(costUsd, limits.teamCostUsd, 'Team cost', usd));
  }
  const out = {};
  for (const [name, a] of Object.entries(agents)) {
    const own = limits ? levelFor(totalTokens(a.usage), limits.agentTokens, 'Agent token') : { level: 'ok', reason: null };
    out[name] = worse(own, teamResult);
  }
  return { team, teamLevel: teamResult.level, teamReason: teamResult.reason, agents: out };
}

// ── Idle-spin backoff ───────────────────────────────────────────────────────
//
// A nudge to an agent whose inputs haven't changed just buys a "nothing new"
// turn. After SPIN_THRESHOLD such nudges in a row, the nudge interval doubles
// each time (capped), and snaps back the moment an input file changes.

const SPIN_THRESHOLD = 5;
const SPIN_MAX_MS = 30 * 60_000;

export const newSpin = () => ({ fingerprint: null, unchanged: 0 });

export function observeFingerprint(spin, fingerprint) {
  if (fingerprint !== spin.fingerprint) { spin.fingerprint = fingerprint; spin.unchanged = 0; }
}
export function recordNudge(spin) { spin.unchanged++; }
export function isSpinning(spin) { return spin.unchanged >= SPIN_THRESHOLD; }
export function spinDelayMs(spin, baseMs) {
  if (!isSpinning(spin)) return baseMs;
  return Math.min(baseMs * 2 ** (spin.unchanged - SPIN_THRESHOLD + 1), SPIN_MAX_MS);
}

/**
 * Hash of everything that is *input* to an agent: inboxes, outboxes, the queue
 * and master task files, and HUMAN_INPUT.md. Status files are excluded — the
 * agent rewrites those every turn, which would make every nudge look like progress.
 */
export async function inputFingerprint() {
  const h = crypto.createHash('sha1');
  const dir = '.claude-team/tasks';
  let names = [];
  try { names = (await fs.readdir(dir)).filter((f) => /-(inbox|outbox)\.json$|^(queue|master)\.json$/.test(f)).sort(); } catch {}
  const files = names.map((f) => `${dir}/${f}`).concat('.claude-team/HUMAN_INPUT.md');
  for (const f of files) {
    try { h.update(f).update(await fs.readFile(f)); } catch {}
  }
  return h.digest('hex');
}

// ── Runaway burn ────────────────────────────────────────────────────────────
//
// Cumulative $ samples per session; the rate over the last few minutes is
// compared with limits.burnUsdPerHour. Warn-only — a human decides.

const BURN_WINDOW_MS = 10 * 60_000;
const BURN_MIN_SPAN_MS = 2 * 60_000; // too short a span makes the rate meaningless

export const newBurn = () => ({ samples: [] });

export function observeBurn(burn, now, costUsd) {
  burn.samples.push({ t: now, cost: costUsd });
  while (burn.samples.length > 1 && now - burn.samples[0].t > BURN_WINDOW_MS) burn.samples.shift();
}

/** $/hour over the window, or null until there is enough history. */
export function burnRatePerHour(burn) {
  const { samples } = burn;
  if (samples.length < 2) return null;
  const first = samples[0], last = samples[samples.length - 1];
  const span = last.t - first.t;
  return span < BURN_MIN_SPAN_MS ? null : ((last.cost - first.cost) / span) * 3_600_000;
}

// ── Repeated tool calls ─────────────────────────────────────────────────────
//
// The same tool call with the same input several times in a row is an agent
// going round in circles (a failing command retried verbatim, the same file
// re-read). Any different call resets the run.

export const REPEAT_THRESHOLD = 4;

export const newRepeat = () => ({ sig: null, count: 0, tool: null, detail: '' });

/** Returns true exactly when this call is the one that crosses the threshold. */
export function observeToolCall(rep, tool, input, detail = '') {
  const sig = tool + '\0' + JSON.stringify(input ?? null);
  if (sig === rep.sig) rep.count++;
  else { rep.sig = sig; rep.count = 1; rep.tool = tool; rep.detail = detail; }
  return rep.count === REPEAT_THRESHOLD;
}
export const isRepeating = (rep) => rep.count >= REPEAT_THRESHOLD;

// ── Event log ───────────────────────────────────────────────────────────────

const GUARD_LOG = '.claude-team/logs/guard.log';

export async function logGuardEvent(event) {
  try {
    await fs.ensureDir('.claude-team/logs');
    await fs.appendFile(GUARD_LOG, JSON.stringify({ at: new Date().toISOString(), ...event }) + '\n');
  } catch {}
}

export async function readGuardEvents(limit = 10) {
  let text;
  try { text = await fs.readFile(GUARD_LOG, 'utf8'); } catch { return []; }
  const events = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { events.push(JSON.parse(line)); } catch {}
  }
  return events.slice(-limit);
}
