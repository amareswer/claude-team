/**
 * Token budget constants and utilities.
 * Approximation: 1 token ≈ 0.75 words ≈ 4 characters (English prose).
 * All agents and doc writers import from here — single source of truth.
 */

export const TOKEN_BUDGETS = {
  agentDoc: 1500,       // per-agent memory doc hard cap
  masterDoc: 3000,      // MASTER.md hard cap
  rulesDoc: 800,        // RULES.md — kept lean, agents read every session
  changelogEntry: 30,   // one changelog line max (chars ~120)
  checkpoint: 2000,     // per checkpoint save
  taskDescription: 200, // max tokens for a single task description
};

export const TOKEN_THRESHOLDS = {
  warn: 0.70,   // 70% — finish step, write checkpoint
  hard: 0.85,   // 85% — stop, save, set paused
  compress: 0.80, // 80% of doc budget — compress older entries
};

/**
 * Rough token estimate for a string.
 * Uses the 4-chars-per-token approximation.
 */
export function estimateTokens(text = '') {
  return Math.ceil(text.length / 4);
}

/**
 * Returns a visual bar: [████████░░░░░░░░░░░░] 20 chars wide.
 */
export function tokenBar(percent) {
  const filled = Math.round((percent / 100) * 20);
  const empty = 20 - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  const warning = percent >= 85 ? ' 🔴' : percent >= 70 ? ' ⚠️ ' : '';
  return `[${bar}] ${percent}%${warning}`;
}