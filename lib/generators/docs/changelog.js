/**
 * Generates the initial changelog.md
 * Milestone-level entries only — not every line of code.
 * Each entry: [timestamp] [agent] ACTION: description
 */
export function generateChangelogMd(config) {
  const now = new Date().toISOString();
  return `# Changelog — ${config.projectName}
<!-- One line per entry. Milestone-level only — not every code change. -->
<!-- Format: [ISO-date] [agent] ACTION: description -->
<!-- Actions: STARTED | COMPLETED | DECISION | BLOCKED | UNBLOCKED | PAUSED | RESUMED | ARCHIVED -->
<!-- Never delete entries — this is the permanent record. -->

## Log

\`\`\`
[${now}] [orchestrator] STARTED: project initialised — ${config.agents.length} agents configured
\`\`\`

---
<!-- Append new entries inside the code block above, newest at bottom. -->
<!-- Keep descriptions under 100 characters. -->
`;
}

/**
 * Generates the initial decisions.md
 * All architectural and significant decisions go here with reasoning.
 */
export function generateDecisionsMd(config) {
  const now = new Date().toISOString().split('T')[0];
  return `# Decisions — ${config.projectName}
<!-- All significant decisions with reasoning. Never delete — archive old ones. -->
<!-- Format: ## DEC-NNN below -->

## How to Add a Decision
\`\`\`
## DEC-NNN: Short title
- **Date**: YYYY-MM-DD
- **Agent**: who decided
- **Decision**: what was decided (one sentence)
- **Reason**: why (one sentence)
- **Alternatives**: what else was considered
- **Impact**: which agents/files are affected
\`\`\`

---

## DEC-001: Project Initialisation
- **Date**: ${now}
- **Agent**: orchestrator
- **Decision**: Use ${config.techStack} for ${config.projectType} project
- **Reason**: Selected during project setup
- **Alternatives**: —
- **Impact**: All agents

---
<!-- Add new decisions above this line. -->
<!-- Reference decisions in code comments as: // see decisions.md#DEC-NNN -->
`;
}