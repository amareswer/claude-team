import fs from 'fs-extra';
import os from 'os';
import path from 'path';

/**
 * A minimal but complete config object — the shape `init.js` actually
 * produces, trimmed to what the generators read. Individual tests override
 * fields with `{ ...minimalConfig(), foo: 'bar' }`.
 */
export function minimalConfig(overrides = {}) {
  return {
    projectName: 'Test Project',
    projectGoal: 'Ship a thing that works',
    projectCategory: 'technical',
    projectType: 'cli',
    techStack: 'node-ts',
    hierarchyType: 'standard',
    leadershipRoles: [{ name: 'project-manager' }],
    orchestratorModel: 'opus',
    agents: [
      { name: 'backend', role: 'Backend Engineer', responsibilities: ['Implement APIs', 'Write tests'], isLeadership: false, model: 'sonnet' },
      { name: 'frontend', role: 'Frontend Engineer', responsibilities: ['Build UI'], isLeadership: false, model: 'sonnet' },
    ],
    coordination: {
      taskStyle: 'queue',
      useGit: true,
      enableReview: false,
      pollInterval: 10,
      enableCrossSessionMessaging: false,
    },
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/** Same shape, but for the content (blog/book/docs) side of the wizard. */
export function minimalContentConfig(overrides = {}) {
  return minimalConfig({
    projectCategory: 'content',
    projectType: 'blog',
    techStack: undefined,
    leadershipRoles: [{ name: 'editor' }],
    agents: [
      { name: 'writer', role: 'Writer', responsibilities: ['Draft posts'], isLeadership: false, model: 'sonnet' },
    ],
    ...overrides,
  });
}

export function minimalAgent(overrides = {}) {
  return {
    name: 'backend',
    role: 'Backend Engineer',
    responsibilities: ['Implement APIs', 'Write tests'],
    isLeadership: false,
    model: 'sonnet',
    ...overrides,
  };
}

/**
 * Runs `fn` with process.cwd() pointed at a fresh temp directory (for
 * generators like generateCoordination that write relative `.claude-team/...`
 * paths), then restores cwd and removes the directory. Requires vitest's
 * `pool: 'forks'` (see vitest.config.js) — process.chdir throws inside a
 * worker_thread.
 */
export async function withTempCwd(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-team-test-'));
  const prevCwd = process.cwd();
  process.chdir(dir);
  try {
    return await fn(dir);
  } finally {
    process.chdir(prevCwd);
    await fs.remove(dir);
  }
}

/**
 * Placeholder text left behind by a template variable that was never
 * interpolated — a literal `${...}` (should be impossible from a template
 * literal, but catches a stray string built by concatenation), or a value
 * that stringified to "undefined"/"NaN" because a config field was missing.
 */
export function findLeftoverPlaceholders(text) {
  return text.match(/\$\{[^}]*\}|\bundefined\b|\bNaN\b/g) || [];
}
