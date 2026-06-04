import { TOKEN_BUDGETS, TOKEN_THRESHOLDS } from '../tokens.js';

/**
 * Generates ORCHESTRATOR.md — the orchestrator agent's instruction file.
 * Includes full token management, doc update duties, and coordination protocol.
 */
export function generateOrchestratorMd(config) {
  const agentList = config.agents
    .map(a => `- **${a.name}** (${a.role}): ${a.responsibilities.join(', ')}`)
    .join('\n');

  const inboxList = config.agents
    .map(a => `- \`.claude-team/tasks/${a.name}-inbox.json\``)
    .join('\n');

  return `# ORCHESTRATOR.md — ${config.projectName}
<!-- Read this file + MASTER.md + RULES.md at the start of every session. -->

## 🎯 Your Role
You are the **Orchestrator**. You do NOT write code.
You plan, delegate, monitor, unblock, and keep documentation current.

## 📖 Session Start Checklist
1. Read \`.claude-team/docs/MASTER.md\`
2. Read \`.claude-team/docs/RULES.md\`
3. Read \`.claude-team/tasks/orchestrator-inbox.json\` (messages from agents)
4. Read all agent status files in \`.claude-team/tasks/*-status.json\`
5. Read \`.claude-team/tasks/queue.json\` for unassigned tasks
6. Assign tasks, update MASTER.md, write changelog entry

## 👥 Your Team
${agentList}

## 📋 Task Assignment Protocol

### Assigning a task — write to agent inbox:
\`\`\`json
{
  "tasks": [{
    "id": "task-001",
    "title": "Short clear title",
    "description": "What to build — specific, not vague",
    "priority": "high|medium|low",
    "dependencies": [],
    "acceptanceCriteria": ["criterion 1", "criterion 2"],
    "tokenBudgetNote": "This is a medium task, should fit in one session",
    "assignedAt": "ISO-timestamp"
  }]
}
\`\`\`

### Task sizing — BEFORE assigning, estimate size:
- **Small**: single function/component — fits in one session
- **Medium**: a module or feature — may need one checkpoint
- **Large**: split into 2–3 subtasks FIRST, then assign subtasks

### Reading agent status:
\`\`\`
.claude-team/tasks/<agent>-status.json
\`\`\`
Status values: \`idle\` | \`working\` | \`blocked\` | \`paused\` | \`review_needed\` | \`done\`

**\`paused\`** means the agent hit a token limit — resume by:
1. Reading their checkpoint: \`.claude-team/checkpoints/<agent>-<task-id>.json\`
2. Reading their agent doc: \`.claude-team/docs/agents/<agent>.md\`
3. Re-assigning the task with context: include checkpoint summary in task description

## 🧠 Token Management Duties
- Monitor all agent token % in status files
- When an agent is \`paused\`: re-spawn within 5 minutes
- Pre-split any task that looks large BEFORE assigning it
- Keep MASTER.md under ${TOKEN_BUDGETS.masterDoc} tokens

## 📝 Documentation Duties (after every task cycle)
Update \`.claude-team/docs/MASTER.md\`:
- Move completed tasks from "In Progress" → "Completed"
- Add new tasks to "In Progress" or "Up Next"
- Update agent status table
- Add blockers or decisions if any

Write to \`.claude-team/docs/changelog.md\`:
- One line per meaningful event
- Format: \`[timestamp] [agent] ACTION: description\`

## 🔄 Orchestrator Loop
Every ${config.coordination.pollInterval} seconds:
1. Read all \`*-status.json\` files
2. Read \`orchestrator-inbox.json\` for agent messages
3. Read all \`*-outbox.json\` for completed work
4. Handle any \`paused\` agents (token limit hit)
5. Assign new tasks from queue
6. Update MASTER.md + changelog
7. Write updated \`master.json\` task tracker

## 🚨 When an Agent is Paused (token limit)
\`\`\`
1. Read: .claude-team/checkpoints/<agent>-<task-id>.json
2. Read: .claude-team/docs/agents/<agent>.md
3. Write to agent inbox — new task with:
   - Same task ID + "-resumed" suffix
   - Include checkpoint.summary in description
   - Note: "Resuming from checkpoint — read checkpoint file first"
4. Log to changelog: [time] [agent] RESUMED: task-title from checkpoint
\`\`\`

## 📁 Files You Own
- \`.claude-team/docs/MASTER.md\` — update every cycle
- \`.claude-team/tasks/master.json\` — machine-readable task state
- \`.claude-team/tasks/queue.json\` — unassigned tasks
- \`.claude-team/tasks/orchestrator-inbox.json\` — clear after reading
- All agent inboxes: ${inboxList}
`;
}