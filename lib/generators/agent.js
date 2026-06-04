import { TOKEN_BUDGETS, TOKEN_THRESHOLDS } from '../tokens.js';

/**
 * Generates the per-agent instruction .md file.
 * Includes token safety protocol, doc update duties, checkpoint format.
 */
export function generateAgentMd(agent, config) {
  const otherAgents = config.agents
    .filter(a => a.name !== agent.name)
    .map(a => `- **${a.name}** (${a.role})`)
    .join('\n');

  const warnPct = Math.round(TOKEN_THRESHOLDS.warn * 100);
  const hardPct = Math.round(TOKEN_THRESHOLDS.hard * 100);

  return `# Agent: ${agent.name} — ${config.projectName}
<!-- Read this file + MASTER.md + RULES.md at the start of every task session. -->

## 🧠 Identity
- **Name**: ${agent.name}
- **Role**: ${agent.role}
- **Responsibilities**: ${agent.responsibilities.join(', ')}

## 📖 Session Start Checklist
1. Read \`.claude-team/docs/agents/${agent.name}.md\` (your memory doc)
2. Read \`.claude-team/docs/MASTER.md\` (project overview)
3. Read \`.claude-team/docs/RULES.md\` (non-negotiable rules)
4. Read \`.claude-team/tasks/${agent.name}-inbox.json\` (your tasks)
5. If resuming: read \`.claude-team/checkpoints/${agent.name}-<task-id>.json\`
6. Update your status to \`working\`

## 👥 Your Team
${otherAgents || '- (solo agent)'}
- **orchestrator** — assigns tasks, monitors progress

## 📥 Receiving Tasks

### Your inbox:
\`\`\`
.claude-team/tasks/${agent.name}-inbox.json
\`\`\`

### Task format:
\`\`\`json
{
  "tasks": [{
    "id": "task-001",
    "title": "Task title",
    "description": "What to build",
    "priority": "high|medium|low",
    "dependencies": [],
    "acceptanceCriteria": ["criterion 1"]
  }]
}
\`\`\`

## 📤 Reporting Completion

### Write to your outbox:
\`\`\`
.claude-team/tasks/${agent.name}-outbox.json
\`\`\`

\`\`\`json
{
  "completedTasks": [{
    "id": "task-001",
    "title": "Task title",
    "completedAt": "ISO-timestamp",
    "summary": "One sentence: what was built",
    "filesChanged": ["src/foo.ts"],
    "notes": "Anything orchestrator or other agents need to know",
    "nextSuggested": "Optional next step"
  }]
}
\`\`\`

## 📊 Status File
Keep \`.claude-team/tasks/${agent.name}-status.json\` current at all times:
\`\`\`json
{
  "agent": "${agent.name}",
  "status": "working",
  "currentTask": "task-001",
  "currentTaskTitle": "What you're doing",
  "contextUsedPercent": 42,
  "startedAt": "ISO-timestamp",
  "lastUpdated": "ISO-timestamp",
  "blockedReason": null
}
\`\`\`
Status values: \`idle\` | \`working\` | \`blocked\` | \`paused\` | \`review_needed\` | \`done\`

## 🔴 Token Safety Protocol (CRITICAL)

### Monitor your own context usage as you work.

**At ${warnPct}% context used:**
1. Finish the current logical step (complete the function/section you're in)
2. Write a checkpoint (see format below)
3. Update your status: \`contextUsedPercent\` + note
4. Log to changelog: \`[time] [${agent.name}] PAUSED: task-title at checkpoint-N\`
5. Continue if still under ${hardPct}%, otherwise stop

**At ${hardPct}% context used:**
1. STOP immediately after finishing current statement/line
2. Write checkpoint with everything needed to resume
3. Update status to \`paused\`
4. Write to \`orchestrator-inbox.json\`: notify you've paused
5. Do NOT start new work

### Checkpoint format:
\`\`\`
.claude-team/checkpoints/${agent.name}-<task-id>.json
\`\`\`
\`\`\`json
{
  "agent": "${agent.name}",
  "taskId": "task-001",
  "taskTitle": "Task title",
  "checkpointAt": "ISO-timestamp",
  "contextPercentAtSave": 85,
  "summary": "One paragraph: what was done, what remains",
  "completedSteps": ["step 1 done", "step 2 done"],
  "remainingSteps": ["step 3 todo", "step 4 todo"],
  "filesModified": ["src/foo.ts"],
  "importantContext": "Key facts needed to resume without re-reading everything",
  "resumeInstruction": "Start from step 3 — function X is complete, now do Y"
}
\`\`\`

## 📝 Documentation Duties (after every task)

### Update your agent memory doc:
\`\`\`
.claude-team/docs/agents/${agent.name}.md
\`\`\`
- Add completed task to "Completed" section
- Update "Current Task" section
- Add any new "Active Context" facts
- Add decisions to "My Decisions" section
- Clear "Session Notes"

### Write to changelog:
\`\`\`
.claude-team/docs/changelog.md
\`\`\`
Format: \`[ISO-timestamp] [${agent.name}] ACTION: description\`
Actions: \`STARTED\` | \`COMPLETED\` | \`DECISION\` | \`BLOCKED\` | \`PAUSED\` | \`RESUMED\`

### Write decisions to:
\`\`\`
.claude-team/docs/decisions.md
\`\`\`
Use format DEC-NNN. Reference in code: \`// see decisions.md#DEC-NNN\`

## 🚧 When Blocked
1. Update status to \`blocked\` with \`blockedReason\`
2. Write to \`.claude-team/tasks/orchestrator-inbox.json\`:
\`\`\`json
{
  "from": "${agent.name}",
  "type": "blocked",
  "taskId": "task-001",
  "reason": "Specific reason",
  "waitingOn": "what or who",
  "timestamp": "ISO-timestamp"
}
\`\`\`
3. Log to changelog: \`[time] [${agent.name}] BLOCKED: reason\`

## 💬 Messaging Another Agent
Write to their inbox \`.claude-team/tasks/<agent>-inbox.json\`:
\`\`\`json
{
  "from": "${agent.name}",
  "type": "request",
  "taskId": "task-001",
  "request": "Specific ask",
  "timestamp": "ISO-timestamp"
}
\`\`\`

## ✅ Task Complete Checklist
- [ ] Feature works per acceptance criteria
- [ ] Error handling added
- [ ] Function comments written (per RULES.md)
- [ ] Tests written/updated
- [ ] Agent memory doc updated
- [ ] Changelog entry written
- [ ] No secrets or debug logs in code
- [ ] Outbox updated with completion report
- [ ] Status set to \`done\`
`;
}