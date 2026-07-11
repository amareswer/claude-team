import fs from 'fs-extra';

/**
 * Sets up all coordination files — tasks, checkpoints, docs, research.
 */
export async function generateCoordination(config, initialTask) {
  const now = new Date().toISOString();

  // Core folders
  await fs.ensureDir('.claude-team/tasks');
  await fs.ensureDir('.claude-team/checkpoints');
  await fs.ensureDir('.claude-team/logs');
  await fs.ensureDir('.claude-team/docs/agents');
  await fs.ensureDir('.claude-team/docs/research');
  await fs.ensureDir('.claude-team/docs/archive');
  await fs.ensureDir('.claude-team/reviews');

  // Per-agent inbox / outbox / status
  // Every inbox has the same shape: `tasks` (assigned work) + `messages` (requests, notifications)
  for (const agent of config.agents) {
    await fs.writeJson(`.claude-team/tasks/${agent.name}-inbox.json`,
      { tasks: [], messages: [] }, { spaces: 2 });
    await fs.writeJson(`.claude-team/tasks/${agent.name}-outbox.json`,
      { completedTasks: [] }, { spaces: 2 });
    await fs.writeJson(`.claude-team/tasks/${agent.name}-status.json`,
      {
        agent: agent.name,
        role: agent.role,
        status: 'idle',
        currentTask: null,
        currentTaskTitle: null,
        currentPhase: null,
        contextUsedPercent: 0,
        startedAt: null,
        lastUpdated: now,
        blockedReason: null,
      }, { spaces: 2 });
  }

  // Special role inboxes (same shape as agent inboxes)
  const specialRoles = ['orchestrator', 'project-manager', 'architect', 'editor', 'researcher'];
  for (const role of specialRoles) {
    const inboxPath = `.claude-team/tasks/${role}-inbox.json`;
    if (!(await fs.pathExists(inboxPath))) {
      await fs.writeJson(inboxPath, { tasks: [], messages: [] }, { spaces: 2 });
    }
  }

  // Queue — if the task is assigned to a real agent, deliver it to their inbox too.
  // 'orchestrator' and 'unassigned' stay queued; the orchestrator assigns from the queue.
  const agentNames = new Set(config.agents.map(a => a.name));
  const deliverTo = initialTask && agentNames.has(initialTask.assignTo) ? initialTask.assignTo : null;

  const queueTask = initialTask
    ? [{
        id: `task-${Date.now()}`,
        title: initialTask.title,
        description: initialTask.description,
        priority: initialTask.priority,
        assignedTo: initialTask.assignTo,
        status: deliverTo ? 'assigned' : 'queued',
        createdAt: now,
        dependencies: [],
        acceptanceCriteria: [],
        humanApprovalRequired: false,
        blockedByQuestion: null,
      }]
    : [];

  await fs.writeJson('.claude-team/tasks/queue.json',
    { tasks: queueTask }, { spaces: 2 });

  if (deliverTo) {
    const inboxPath = `.claude-team/tasks/${deliverTo}-inbox.json`;
    const inbox = await fs.readJson(inboxPath);
    inbox.tasks.push({ ...queueTask[0], assignedAt: now });
    await fs.writeJson(inboxPath, inbox, { spaces: 2 });
  }

  // Master task tracker
  await fs.writeJson('.claude-team/tasks/master.json',
    {
      projectName: config.projectName,
      projectGoal: config.projectGoal,
      overallStatus: 'not_started',
      createdAt: now,
      lastUpdated: now,
      agents: config.agents.map(a => ({
        name: a.name,
        role: a.role,
        status: 'idle',
        contextUsedPercent: 0,
      })),
      tasks: queueTask,
      openHumanQuestions: 1,
    }, { spaces: 2 });

  // Shared notes
  await fs.writeFile('.claude-team/docs/NOTES.md',
    `# Shared Notes — ${config.projectName}
<!-- Any agent can write here. Keep entries short and dated. -->
<!-- Format: - [date] [agent] Note -->

_Created: ${now}_
`);
}