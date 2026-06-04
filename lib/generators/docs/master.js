import { TOKEN_BUDGETS } from '../../tokens.js';

/**
 * Generates the initial MASTER.md.
 * This is the project-wide living document — updated by orchestrator + agents.
 * Hard cap: TOKEN_BUDGETS.masterDoc tokens.
 */
export function generateMasterMd(config) {
  const agentTable = config.agents
    .map(a => `| ${a.name} | ${a.role} | idle | — |`)
    .join('\n');

  return `# MASTER.md — ${config.projectName}
<!-- Token budget: ${TOKEN_BUDGETS.masterDoc} tokens max. Orchestrator owns this file. -->
<!-- Updated: ${new Date().toISOString()} -->

## 🎯 Project Goal
${config.projectGoal}

## 📋 Overview
| Field | Value |
|-------|-------|
| Type | ${config.projectType} |
| Stack | ${config.techStack} |
| Coordination | ${config.coordination.taskStyle} |
| Started | ${new Date().toISOString().split('T')[0]} |
| Status | 🟡 in_progress |

## 👥 Team
| Agent | Role | Status | Current Task |
|-------|------|--------|-------------|
| orchestrator | Orchestrator | idle | — |
${agentTable}

## ✅ Completed
<!-- Format: - [x] [date] Description (agent) -->
<!-- (none yet) -->

## 🔄 In Progress
<!-- Format: - [ ] Description (agent) -->
<!-- (none yet) -->

## 📋 Up Next
<!-- Format: - Description | priority: high/medium/low -->
<!-- (none yet) -->

## ⚠️ Blockers
<!-- Format: - [agent] Blocker description | waiting on: X -->
<!-- (none yet) -->

## 💡 Key Decisions
<!-- Format: - [date] Decision (see decisions.md#id) -->
<!-- (none yet) -->

## 🔌 Interfaces & Contracts
<!-- API endpoints, shared types, data schemas agreed between agents -->
<!-- (none yet) -->

## 📝 Notes
<!-- Important project-wide context agents should know -->
<!-- (none yet) -->

---
<!-- ORCHESTRATOR: Update this file after every task assignment and completion. -->
<!-- Keep entries short — one line per item. Archive completed items after 10 entries. -->
<!-- Token budget: ${TOKEN_BUDGETS.masterDoc} tokens max. Run \`claude-team status\` to check. -->
`;
}