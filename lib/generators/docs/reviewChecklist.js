import { TOKEN_BUDGETS } from '../../tokens.js';

/**
 * Generates REVIEW_CHECKLIST.md — the human's pre-merge/pre-trust checklist.
 * Nothing here runs itself; agents self-report their own status and
 * compliance, so this is where the human actually verifies it. Kept under
 * TOKEN_BUDGETS.reviewChecklistDoc tokens, same discipline as RULES.md.
 */
export function generateReviewChecklistMd(config) {
  return `# Review Checklist — ${config.projectName}
<!-- Token budget: ${TOKEN_BUDGETS.reviewChecklistDoc} tokens max. Keep entries short. -->
<!-- Last updated: ${new Date().toISOString()} -->
<!-- Run through this before merging or trusting the team's work. Nothing on this list is enforced automatically — it's a human gate. -->

## ❓ Open Questions
- [ ] Any \`[open]\` questions left in \`.claude-team/HUMAN_INPUT.md\`? Answer or explicitly defer them before trusting work that depended on them.

## ⚠️ Conflicts
- [ ] Any \`CONFLICT\` lines in \`.claude-team/docs/changelog.md\` since your last review? Each one means a write was aborted, not silently overwritten — confirm the retry actually landed, don't just note that it happened.

## 📏 Rules Violations
- [ ] Any \`needs_revision\` or flagged issues in \`.claude-team/reviews/\`? Confirm they were fixed, not just acknowledged.
- [ ] Spot-check a recent completed task's output against \`.claude-team/docs/RULES.md\` — compliance is self-reported, not verified for you.

## 📤 Outbox Completeness
- [ ] Does every recent entry in \`.claude-team/tasks/*-outbox.json\` list \`filesChanged\`? Empty or missing usually means the summary is incomplete, not that nothing changed.
- [ ] Do those \`filesChanged\` paths match what's actually in your working tree / git diff?

## 📋 Task & Doc Consistency
- [ ] Does \`.claude-team/docs/MASTER.md\`'s "Completed" section match what's actually \`done\` in \`.claude-team/tasks/master.json\`?
- [ ] Any task stuck \`paused\` longer than expected — orchestrator stalled, or a respawn needed?

## 🔒 Security & Secrets
- [ ] No secrets, API keys, or credentials in anything an agent touched — \`RULES.md\` tells them not to; this is where you check.

## 🗃️ Decisions
- [ ] Any new \`decisions.md\` entries you disagree with or want revisited before they become load-bearing for later work?

---
<!-- Living doc — add project-specific checks as you find gaps. -->
<!-- Nothing here runs itself. It exists because agents self-report; this is where you verify. -->
`;
}
