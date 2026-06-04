export function generateAgentMd(agent, config) {
  const otherAgents = config.agents
    .filter((a) => a.name !== agent.name)
    .map((a) => `- **${a.name}** (${a.role})`)
    .join("\n");

  const reviewSection = config.coordination.enableReview
    ? `
## Code Review Duties
When the orchestrator assigns you a \`"type": "review"\` task:
1. Read the files/changes specified in the task
2. Check for correctness, edge cases, style, and tests
3. Write your review to \`.claude-team/reviews/${agent.name}-review-<task-id>.md\`
4. Update your status to \`done\` when review is complete
`
    : "";

  const gitSection = config.coordination.useGit
    ? `
## Git Commits
After completing work, commit with:
\`\`\`
git commit -m "[${agent.name}] <what you did>"
\`\`\`
`
    : "";

  return `# 🤖 Agent: ${agent.name}

## Your Identity
- **Name**: ${agent.name}
- **Role**: ${agent.role}
- **Project**: ${config.projectName}
- **Stack**: ${config.techStack}

## Your Responsibilities
${agent.responsibilities.map((r) => `- ${r}`).join("\n")}

## Your Team
You are working alongside:
${otherAgents || "- (You are the only worker agent)"}

The **Orchestrator** manages task assignment and coordination.

## How to Receive Tasks

### Check Your Inbox
Your tasks come from the orchestrator at:
\`\`\`
.claude-team/tasks/${agent.name}-inbox.json
\`\`\`

A task looks like:
\`\`\`json
{
  "tasks": [
    {
      "id": "task-001",
      "title": "Task title here",
      "description": "Detailed description",
      "priority": "high",
      "dependencies": [],
      "acceptanceCriteria": ["criterion 1", "criterion 2"]
    }
  ]
}
\`\`\`

### Update Your Status
Always keep your status file current so the orchestrator knows what you're doing:
\`\`\`
.claude-team/tasks/${agent.name}-status.json
\`\`\`

\`\`\`json
{
  "agent": "${agent.name}",
  "status": "working",
  "currentTask": "task-001",
  "currentTaskTitle": "What you're doing right now",
  "startedAt": "<timestamp>",
  "lastUpdated": "<timestamp>",
  "blockedReason": null
}
\`\`\`

Status values:
- \`idle\` — waiting for tasks
- \`working\` — actively working on a task  
- \`blocked\` — need help or waiting on dependency
- \`review_needed\` — finished, needs review before closing
- \`done\` — task complete

### Report Completed Work
When you finish a task, write to your outbox:
\`\`\`
.claude-team/tasks/${agent.name}-outbox.json
\`\`\`

\`\`\`json
{
  "completedTasks": [
    {
      "id": "task-001",
      "title": "Task title",
      "completedAt": "<timestamp>",
      "summary": "What you built/changed",
      "filesChanged": ["src/foo.ts", "tests/foo.test.ts"],
      "notes": "Any important notes for the orchestrator or other agents",
      "nextSuggested": "Optional: what should be done next"
    }
  ]
}
\`\`\`

## How to Request Help or Unblock

If you're blocked, update your status to \`blocked\` and write to:
\`\`\`
.claude-team/tasks/orchestrator-inbox.json
\`\`\`

\`\`\`json
{
  "from": "${agent.name}",
  "type": "blocked",
  "taskId": "task-001",
  "reason": "Explain what you need",
  "timestamp": "<timestamp>"
}
\`\`\`

## Need Something from Another Agent?

Write directly to their inbox with \`"type": "request"\`:
\`\`\`json
{
  "from": "${agent.name}",
  "type": "request",
  "taskId": "task-001",
  "request": "What you need",
  "timestamp": "<timestamp>"
}
\`\`\`
${reviewSection}
${gitSection}

## Agent Loop
Every ${config.coordination.pollInterval} seconds:
1. Check \`.claude-team/tasks/${agent.name}-inbox.json\` for new tasks
2. If you have tasks, work on the highest priority one
3. Update your status file as you progress
4. When done, write to your outbox
5. Pick up the next task or mark yourself \`idle\`

## Start Here
1. Read your inbox: \`.claude-team/tasks/${agent.name}-inbox.json\`
2. Update your status to \`working\` on the first task
3. Complete the task and report results to your outbox
4. Repeat
`;
}