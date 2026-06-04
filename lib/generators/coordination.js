import fs from "fs-extra";

export async function generateCoordination(config, initialTask) {
  const now = new Date().toISOString();

  // Create inbox/outbox/status for each agent
  for (const agent of config.agents) {
    // Inbox — starts empty
    await fs.writeJson(
      `.claude-team/tasks/${agent.name}-inbox.json`,
      { tasks: [] },
      { spaces: 2 }
    );

    // Outbox — starts empty
    await fs.writeJson(
      `.claude-team/tasks/${agent.name}-outbox.json`,
      { completedTasks: [] },
      { spaces: 2 }
    );

    // Status — starts idle
    await fs.writeJson(
      `.claude-team/tasks/${agent.name}-status.json`,
      {
        agent: agent.name,
        role: agent.role,
        status: "idle",
        currentTask: null,
        currentTaskTitle: null,
        startedAt: null,
        lastUpdated: now,
        blockedReason: null,
      },
      { spaces: 2 }
    );
  }

  // Orchestrator inbox (for agents to send messages back)
  await fs.writeJson(
    `.claude-team/tasks/orchestrator-inbox.json`,
    { messages: [] },
    { spaces: 2 }
  );

  // Queue — initial tasks before orchestrator assigns them
  const queueTask = initialTask
    ? [
        {
          id: `task-${Date.now()}`,
          title: initialTask.title,
          description: initialTask.description,
          priority: initialTask.priority,
          assignedTo: initialTask.assignTo,
          status: "queued",
          createdAt: now,
          dependencies: [],
          acceptanceCriteria: [],
        },
      ]
    : [];

  await fs.writeJson(
    `.claude-team/tasks/queue.json`,
    { tasks: queueTask },
    { spaces: 2 }
  );

  // Master task tracker
  await fs.writeJson(
    `.claude-team/tasks/master.json`,
    {
      projectName: config.projectName,
      projectGoal: config.projectGoal,
      overallStatus: "not_started",
      createdAt: now,
      lastUpdated: now,
      agents: config.agents.map((a) => ({
        name: a.name,
        role: a.role,
        status: "idle",
      })),
      tasks: queueTask,
    },
    { spaces: 2 }
  );

  // Shared notes file — agents can write observations here
  await fs.writeFile(
    `.claude-team/NOTES.md`,
    `# Team Notes — ${config.projectName}

This file is shared across all agents. Use it to:
- Record decisions and context
- Leave notes for other agents
- Document blockers or important discoveries

---

_Created: ${now}_
`
  );
}