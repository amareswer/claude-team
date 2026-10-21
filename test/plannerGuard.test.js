import { describe, it, expect } from 'vitest';
import { plannerWorkProblem, isPlanner } from '../lib/plannerGuard.js';

describe('plannerWorkProblem', () => {
  it('flags hands-on work given to a planner', () => {
    expect(plannerWorkProblem('project-manager', { title: 'Data test', description: 'Write the script and a short report.' })).toMatch(/does not do hands-on work/);
    expect(plannerWorkProblem('editor', { title: 'Implement the parser', description: 'x' })).toMatch(/"Implement"/);
  });
  it('allows planning tasks, including ones that say not to code', () => {
    expect(plannerWorkProblem('project-manager', { title: 'Plan v1 and delegate (no coding)', description: 'You are the manager: do NOT write code, scripts or tests. Break v1 into milestones and hand each task to a worker.' })).toBeNull();
  });
  it('never flags workers or the orchestrator', () => {
    expect(plannerWorkProblem('frontend', { title: 'Write the script', description: 'implement it' })).toBeNull();
    expect(plannerWorkProblem('orchestrator', { title: 'Write the script', description: '' })).toBeNull();
    expect(plannerWorkProblem(undefined, { title: 'Write the script' })).toBeNull();
  });
  it('knows which roles are planners', () => {
    expect(isPlanner('project-manager')).toBe(true);
    expect(isPlanner('editor')).toBe(true);
    expect(isPlanner('architect')).toBe(false);
  });
});
