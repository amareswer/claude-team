/**
 * Shared model catalogue for the init wizard and the Office UI.
 * Values are Claude Code CLI model aliases; 'default' means no --model flag
 * is passed at launch (whatever `claude` resolves to on its own).
 */
export const MODEL_CHOICES = [
  { value: 'opus', label: 'Opus', description: 'Strongest reasoning — best for planning, architecture, leadership roles' },
  { value: 'sonnet', label: 'Sonnet', description: 'Balanced — good default for most implementation work' },
  { value: 'haiku', label: 'Haiku', description: 'Fastest & cheapest — good for narrow, repetitive tasks' },
  { value: 'default', label: 'Default', description: "Let Claude Code decide — don't pass --model" },
];

export const VALID_MODELS = MODEL_CHOICES.map((m) => m.value);

/** Recommended default: leadership/orchestrator get Opus, workers get Sonnet. */
export function defaultModelForRole(isLeadership) {
  return isLeadership ? 'opus' : 'sonnet';
}

/** Falls back to the role's recommended default if the given value isn't a known model. */
export function normalizeModel(model, isLeadership = false) {
  return VALID_MODELS.includes(model) ? model : defaultModelForRole(isLeadership);
}
