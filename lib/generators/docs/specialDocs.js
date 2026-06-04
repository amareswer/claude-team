/**
 * Generates special project docs based on team composition.
 */

/**
 * HUMAN_INPUT.md — PM/Editor writes questions here, human replies.
 * The primary channel between the team and the human.
 */
export function generateHumanInputMd(config) {
  return `# Human Input — ${config.projectName}
<!-- This is how the team communicates with you. -->
<!-- Read open questions, write your answer below each HUMAN REPLY section, save the file. -->
<!-- The PM/Editor checks this file every session and unblocks the team. -->

## How This Works
1. Team writes a question in QUESTION-NNN format below
2. You read it, write your answer under HUMAN REPLY
3. Save the file
4. Team picks it up next session and unblocks

## Status Legend
- \`[open]\` — needs your answer
- \`[resolved]\` — answered, team has actioned it
- \`[cancelled]\` — no longer relevant

---

## QUESTION-001 [open]
- **Date**: ${new Date().toISOString().split('T')[0]}
- **From**: project-manager
- **Priority**: non-blocking
- **Question**: Please review the project goal and confirm the scope is correct.
- **Context**: Before the team starts work, we want to make sure we're building the right thing.
- **Goal as understood**: ${config.projectGoal}
- **Options**:
  - A) Correct — proceed as stated
  - B) Needs adjustment — see my reply below

## HUMAN REPLY:
<!-- Write your answer here -->


---
<!-- New questions will be added above this line by the team. -->
<!-- Format:
## QUESTION-NNN [open]
- **Date**: YYYY-MM-DD
- **From**: agent-name
- **Priority**: blocking|non-blocking
- **Question**: One clear question
- **Context**: Why this matters
- **Impact**: Which tasks are blocked
- **Options**:
  - A) ...
  - B) ...
- **Recommendation**: A — reason

## HUMAN REPLY:
(your answer here)
-->
`;
}

/**
 * ARCHITECTURE.md — Architect writes this before agents start.
 * Starting template — Architect fills it in during their first job.
 */
export function generateArchitectureMd(config) {
  return `# Architecture — ${config.projectName}
<!-- Owned by: Architect -->
<!-- All agents read this before starting any task. -->
<!-- Updated by Architect as the project evolves. -->
<!-- Token budget: keep under 2000 tokens — be concise. -->

> ⚠️ **DRAFT** — Architect has not completed initial exploration yet.
> No agent should start coding until this file is marked **READY**.

## Status: DRAFT | READY
<!-- Architect changes DRAFT → READY after completing initial exploration -->

## Stack
<!-- To be filled by Architect after exploration -->
- Language/Runtime: —
- Framework: —
- Key Libraries: —
- Database: —
- Testing: —

## Folder Structure
<!-- To be filled by Architect -->
\`\`\`
(Architect will document the project structure here)
\`\`\`

## Naming Conventions
<!-- To be filled by Architect -->
- Files: —
- Functions/Methods: —
- Variables: —
- Constants: —
- Components/Classes: —

## Patterns In Use
<!-- Established patterns all agents must follow -->
<!-- (none yet — Architect will fill after exploration) -->

## Interface Contracts
<!-- API endpoints, shared types, data schemas between agents -->
<!-- (none yet) -->

## Data Models
<!-- Core entities and their shapes -->
<!-- (none yet) -->

## Agent Ownership
<!-- Which agent owns which folders/files — prevents conflicts -->
| Agent | Owns | Can Read |
|-------|------|---------|
| (Architect will define after exploration) | | |

## Libraries — Approved for Use
<!-- Architect approves, agents don't install anything not listed -->
<!-- (none yet) -->

## Known Constraints
<!-- Technical limitations, legacy requirements, things to avoid -->
<!-- (none yet) -->

---
<!-- Architect: replace this entire file after exploration. -->
<!-- Change Status: DRAFT → READY when complete. -->
<!-- Signal orchestrator when ready so agents can start. -->
`;
}

/**
 * STYLE_GUIDE.md — Editor writes this before writers start.
 * Starting template — Editor fills it in during their first job.
 */
export function generateStyleGuideMd(config) {
  return `# Style Guide — ${config.projectName}
<!-- Owned by: Editor -->
<!-- All writers read this before starting any task. -->
<!-- Updated by Editor as the project evolves. -->

> ⚠️ **DRAFT** — Editor has not completed style guide yet.
> No writer should start until this file is marked **READY**.

## Status: DRAFT | READY

## Project Overview
- **Type**: ${config.projectType}
- **Goal**: ${config.projectGoal}
- **Target Audience**: — (Editor to define)

## Voice & Tone
<!-- (Editor to define) -->
- Formality: —
- Personality: —
- Perspective: —
- Examples of good tone: —

## Structure Rules
<!-- (Editor to define) -->
- Heading style: —
- Paragraph length: —
- Sentence length: —
- List usage: —

## Vocabulary
<!-- Words to use -->
<!-- (none yet) -->

<!-- Words to avoid -->
<!-- (none yet) -->

## Formatting
- Bold: use for —
- Italics: use for —
- Code blocks: use for —
- Callouts/notes: use for —

## Citations & Sources
- Format: —
- Required for: —

## SEO (if applicable)
- Primary keywords: —
- Secondary keywords: —
- Meta description style: —

## Word Count Targets
| Content Type | Target |
|---|---|
| (Editor to define) | — |

---
<!-- Editor: fill this out completely before signalling writers to start. -->
<!-- Change Status: DRAFT → READY when complete. -->
`;
}