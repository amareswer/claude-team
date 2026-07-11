import { TOKEN_BUDGETS, TOKEN_THRESHOLDS } from '../tokens.js';

/**
 * A content project gets STYLE_GUIDE.md; a technical one gets ARCHITECTURE.md.
 * Must match the foundation doc init.js actually generates (based on projectCategory).
 * The type list is a fallback for configs saved before projectCategory existed.
 */
export function isContentProject(config) {
  if (config.projectCategory) return config.projectCategory === 'content';
  return ['blog', 'book', 'content', 'documentation', 'scripts', 'marketing'].includes(config.projectType);
}

/**
 * Generates the per-agent instruction .md file.
 * Includes: research-first protocol, token safety, doc duties, coordination.
 */
export function generateAgentMd(agent, config) {
  const otherAgents = config.agents
    .filter(a => a.name !== agent.name)
    .map(a => `- **${a.name}** (${a.role})`)
    .join('\n');

  const warnPct = Math.round(TOKEN_THRESHOLDS.warn * 100);
  const hardPct = Math.round(TOKEN_THRESHOLDS.hard * 100);
  const isContent = isContentProject(config);

  return `# Agent: ${agent.name} — ${config.projectName}
<!-- Read this + your memory doc + MASTER.md + RULES.md at every session start. -->

## 🧠 Identity
- **Name**: ${agent.name}
- **Role**: ${agent.role}
- **Responsibilities**: ${agent.responsibilities.join(', ')}

## 📖 Session Start Checklist
1. Read \`.claude-team/docs/agents/${agent.name}.md\` (your memory)
2. Read \`.claude-team/docs/MASTER.md\` (project overview)
3. Read \`.claude-team/docs/RULES.md\` (non-negotiable rules)
4. Read \`.claude-team/docs/${isContent ? 'STYLE_GUIDE' : 'ARCHITECTURE'}.md\` (foundation doc)
5. Read \`.claude-team/tasks/${agent.name}-inbox.json\` (your tasks)
6. If resuming: read your checkpoint file first
7. Update status to \`working\`

If you were launched via \`claude-team office\`, you'll get an automatic "re-check your inbox" nudge on a timer whenever you go quiet — you don't need to poll manually. Launched in a plain terminal, there's no such nudge; re-check your inbox yourself when you finish a task.

## 👥 Your Team
${otherAgents || '- (solo agent)'}

---

## 🔍 RESEARCH-FIRST PROTOCOL (MANDATORY)
**Never write a single line of code or content without completing this first.**
This is not optional. Skipping this causes rework, conflicts, and wasted tokens.

### Phase 1 — EXPLORE (understand what exists)
\`\`\`
Before touching anything:

1. Map the project structure
   - Run a file tree of the project root
   - Understand what every folder contains
   - Do NOT start reading files yet — just map

2. Identify relevant files for your task
   - Which files will you need to READ to understand context?
   - Which files will you CREATE or MODIFY?
   - Which files do other agents own that you'll interact with?

3. Read relevant existing files
   - Read files you'll modify — understand them fully
   - Read files you'll call or import from
   - Read similar existing implementations for patterns
   - Do NOT read the entire codebase — only what's relevant

4. Check what other agents have built
   - Read other agents' memory docs: .claude-team/docs/agents/*.md
   - Read recent outbox completions for context
   - Check decisions.md for decisions that affect your work
\`\`\`

### Phase 2 — UNDERSTAND (extract key knowledge)
\`\`\`
After exploring, answer these questions:

- What patterns are already established? (naming, structure, style)
- Is there existing code/content I should follow or reuse?
- What have other agents built that my work depends on?
- What decisions have already been made that constrain my approach?
- Is there a research doc for this task?
  → Check: .claude-team/docs/research/<task-id>.md
\`\`\`

### Phase 3 — PLAN (decide your approach)
\`\`\`
Write your plan in your memory doc BEFORE starting:

- What exactly will you build/write?
- What files will you create? What files will you modify?
- What is your step-by-step approach?
- Does your approach match existing patterns?
- Will your work affect any other agent's code/content?

If you can't write a clear plan → you need more exploration.
If your plan affects another agent's work → notify them first.
\`\`\`

### Phase 4 — CONFIRM (when uncertain)
\`\`\`
If after exploring and planning you still have uncertainties:

- Write question to the "messages" array in .claude-team/tasks/orchestrator-inbox.json
- Specify: what you're unsure about, what options you see
- Work on non-blocked parts while waiting
- Do NOT guess and proceed — guessing causes rework
\`\`\`

### Phase 5 — EXECUTE (only now start work)
\`\`\`
You have explored, understood, planned, confirmed.
Now build it — following the patterns you found.
\`\`\`

---

## 📥 Receiving Tasks

### Your inbox:
\`\`\`
.claude-team/tasks/${agent.name}-inbox.json
\`\`\`

### On receiving a task — DO THIS FIRST:
1. Read the task fully
2. Check if there's a research doc: \`.claude-team/docs/research/<task-id>.md\`
3. If no research doc exists for a complex task → request one:
\`\`\`json
// Append to the "messages" array in .claude-team/tasks/researcher-inbox.json
{
  "from": "${agent.name}",
  "type": "research_request",
  "taskId": "task-001",
  "question": "Specific question about what you need to know",
  "urgency": "blocking",
  "timestamp": "ISO-timestamp"
}
\`\`\`
4. Then run the full research-first protocol above
5. Only then start executing

---

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
    "summary": "One sentence: what was built/written",
    "filesChanged": ["src/foo.ts"],
    "patternsUsed": ["existing pattern you followed"],
    "notes": "What orchestrator/other agents need to know",
    "nextSuggested": "Optional next step"
  }]
}
\`\`\`

## 📊 Status File
Keep \`.claude-team/tasks/${agent.name}-status.json\` current:
\`\`\`json
{
  "agent": "${agent.name}",
  "status": "working",
  "currentTask": "task-001",
  "currentTaskTitle": "What you're doing",
  "currentPhase": "exploring|planning|executing",
  "contextUsedPercent": 42,
  "startedAt": "ISO-timestamp",
  "lastUpdated": "ISO-timestamp",
  "blockedReason": null
}
\`\`\`

---

## 🔴 Token Safety Protocol

**At ${warnPct}% context:**
1. Finish current logical step cleanly
2. Write checkpoint to \`.claude-team/checkpoints/${agent.name}-<task-id>.json\`
3. Update status with current context %
4. Log to changelog

**At ${hardPct}% context:**
1. STOP after finishing current statement
2. Write checkpoint — include everything needed to resume
3. Set status to \`paused\`
4. Notify orchestrator via inbox

### Checkpoint format:
\`\`\`json
{
  "agent": "${agent.name}",
  "taskId": "task-001",
  "checkpointAt": "ISO-timestamp",
  "contextPercentAtSave": 85,
  "explorationFindings": "Key things found during exploration",
  "summary": "What was done, what remains",
  "completedSteps": ["step 1", "step 2"],
  "remainingSteps": ["step 3", "step 4"],
  "filesModified": ["src/foo.ts"],
  "importantContext": "Key facts to resume without re-exploring",
  "resumeInstruction": "Start from step 3 — skip exploration, context is above"
}
\`\`\`

---

## 📝 Documentation Duties (after every task)

### Update your memory doc \`.claude-team/docs/agents/${agent.name}.md\`:
- Add completed task to Completed section
- Add any new patterns you discovered to Active Context
- Record decisions you made
- Clear Session Notes — summarise key points above

### Write to changelog \`.claude-team/docs/changelog.md\`:
Format: \`[ISO-timestamp] [${agent.name}] ACTION: description\`

### Write decisions to \`.claude-team/docs/decisions.md\`:
Any technical/content decision → DEC-NNN format
Reference in code/content: \`// see decisions.md#DEC-NNN\`

---

## ✅ Task Complete Checklist
- [ ] Research-first protocol completed
- [ ] Work matches existing patterns in codebase
- [ ] Feature/content works per acceptance criteria
- [ ] Error handling / edge cases covered
- [ ] Tests written (technical) / review requested (content)
- [ ] Memory doc updated with findings
- [ ] Changelog entry written
- [ ] No secrets or debug logs
- [ ] Outbox updated
- [ ] Status set to \`done\`
`;
}