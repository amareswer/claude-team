import { TOKEN_BUDGETS } from '../../tokens.js';

/**
 * Generates the initial per-agent memory doc.
 * Agents read this at the start of every task session.
 * Hard cap: TOKEN_BUDGETS.agentDoc tokens.
 */
export function generateAgentDocMd(agent, config) {
  return `# Agent Memory: ${agent.name}
<!-- Role: ${agent.role} | Project: ${config.projectName} -->
<!-- Token budget: ${TOKEN_BUDGETS.agentDoc} tokens max. Compress when > 80% full. -->
<!-- Updated: ${new Date().toISOString()} -->

## 🧠 Identity
- **Name**: ${agent.name}
- **Role**: ${agent.role}
- **Project**: ${config.projectName}
- **Stack**: ${config.techStack}
- **Responsibilities**: ${agent.responsibilities.join(', ')}

## 📖 Read at Session Start
1. This file (your memory)
2. \`.claude-team/docs/MASTER.md\` (project overview)
3. \`.claude-team/docs/RULES.md\` (rules — non-negotiable)
4. Your current task from \`.claude-team/tasks/${agent.name}-inbox.json\`

## 🔄 Current Task
<!-- Updated by you each session -->
- Task ID: —
- Title: —
- Started: —
- Status: idle

## 📋 Active Context
<!-- Key facts you need to remember across sessions -->
<!-- Format: - Fact | source: where you learned it -->
<!-- (none yet) -->

## ✅ Completed (last 5)
<!-- Format: - [x] [date] Task title (task-id) -->
<!-- Older items auto-compressed to summary -->
<!-- (none yet) -->

## 🚧 My Decisions
<!-- Decisions YOU made in your domain -->
<!-- Format: - [date] Decision | reason | ref: decisions.md#id -->
<!-- (none yet) -->

## ⚠️ Blocked / Waiting
<!-- Format: - Blocker | waiting on: agent/person | since: date -->
<!-- (none yet) -->

## 🔗 Interfaces I Own
<!-- APIs, functions, types that other agents depend on -->
<!-- Format: - Name | description | status: stable/draft/changed -->
<!-- (none yet) -->

## 📝 Session Notes
<!-- Scratch pad — clear at end of each session, summarise key points above -->
<!-- (none yet) -->

---
<!-- TOKEN RULES: -->
<!-- At 70% context used → finish step, write checkpoint, log to changelog -->
<!-- At 85% context used → stop cleanly, save checkpoint, set status paused -->
<!-- When this doc hits 80% of ${TOKEN_BUDGETS.agentDoc} tokens → compress Completed section -->
`;
}