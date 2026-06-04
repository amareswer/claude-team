import fs from 'fs-extra';

/**
 * Sets up all coordination files — tasks, checkpoints, docs.
 */
export async function generateCoordination(config, initialTask) {
  const now = new Date().toISOString();

  // Task folders
  await fs.ensureDir('.claude-team/tasks');
  await fs.ensureDir('.claude-team/checkpoints');
  await fs.ensureDir('.claude-team/logs');
  await fs.ensureDir('.claude-team/docs/agents');
  await fs.ensureDir('.claude-team/docs/archive');

  // Per-agent inbox / outbox / status
  for (const agent of config.agents) {
    await fs.writeJson(
      `.claude-team/tasks/${agent.name}-inbox.json`,
      { tasks: [] },
      { spaces: 2 }
    );
    await fs.writeJson(
      `.claude-team/tasks/${agent.name}-outbox.json`,
      { completedTasks: [] },
      { spaces: 2 }
    );
    await fs.writeJson(
      `.claude-team/tasks/${agent.name}-status.json`,
      {
        agent: agent.name,
        role: agent.role,
        status: 'idle',
        currentTask: null,
        currentTaskTitle: null,
        contextUsedPercent: 0,
        startedAt: null,
        lastUpdated: now,
        blockedReason: null,
      },
      { spaces: 2 }
    );
  }

  // Orchestrator inbox
  await fs.writeJson(
    '.claude-team/tasks/orchestrator-inbox.json',
    { messages: [] },
    { spaces: 2 }
  );

  // Queue
  const queueTask = initialTask
    ? [{
        id: `task-${Date.now()}`,
        title: initialTask.title,
        description: initialTask.description,
        priority: initialTask.priority,
        assignedTo: initialTask.assignTo,
        status: 'queued',
        createdAt: now,
        dependencies: [],
        acceptanceCriteria: [],
      }]
    : [];

  await fs.writeJson(
    '.claude-team/tasks/queue.json',
    { tasks: queueTask },
    { spaces: 2 }
  );

  // Master task tracker
  await fs.writeJson(
    '.claude-team/tasks/master.json',
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
    },
    { spaces: 2 }
  );

  // Shared notes
  await fs.writeFile(
    '.claude-team/docs/NOTES.md',
    `# Shared Notes — ${config.projectName}
<!-- Any agent can write here. Keep entries short and dated. -->
<!-- Format: - [date] [agent] Note -->

_Created: ${now}_
`
  );
}