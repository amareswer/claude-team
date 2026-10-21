// Planner roles (project-manager, editor) plan, define and unblock; they never write code
// or content (see their instruction files). Handing one an implementation task makes it
// ignore its own rules and do a worker's job, so the task paths refuse that up front.

const PLANNERS = new Set(['project-manager', 'editor']);

// Implementation work. Sentences that negate it ("do NOT write code") are skipped.
const WORK = /\b(writes?|build|implements?|code|coding|scripts?|unit tests?|tests?|refactor|debug|fix(?:es)? bugs?|prototype)\b/i;
const NEGATED = /\b(not|never|no|don'?t|without|instead of)\b/i;

export function isPlanner(name) {
  return PLANNERS.has(name);
}

/** Returns an explanation when `assignee` is a planner and the text asks for hands-on work, else null. */
export function plannerWorkProblem(assignee, { title = '', description = '' } = {}) {
  if (!isPlanner(assignee)) return null;
  const hits = `${title}. ${description}`
    .split(/(?<=[.!?;:])\s+|\n+/)
    .filter((s) => !NEGATED.test(s) && WORK.test(s));
  if (!hits.length) return null;
  const word = hits[0].match(WORK)[0];
  return `${assignee} plans and delegates, it does not do hands-on work ("${word}" in this task). `
    + 'Assign it to a worker, or give the planner a planning task such as "break this into tasks and delegate". '
    + 'To override, pass allowPlannerWork.';
}
