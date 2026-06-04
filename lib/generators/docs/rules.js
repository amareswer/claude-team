import { TOKEN_BUDGETS } from '../../tokens.js';

/**
 * Generates RULES.md — the single source of truth for all agents.
 * Kept under TOKEN_BUDGETS.rulesDoc tokens so agents can read it every session
 * without burning significant context budget.
 */
export function generateRulesMd(config) {
  const stackRules = getStackRules(config.techStack);
  const typeRules = getTypeRules(config.projectType);

  return `# RULES.md — ${config.projectName}
<!-- Token budget: ${TOKEN_BUDGETS.rulesDoc} tokens max. Keep entries short. -->
<!-- Last updated: ${new Date().toISOString()} -->

## 🔒 Security (non-negotiable)
- Never hardcode secrets, API keys, or passwords — use env vars
- Validate all user inputs before processing
- Never log sensitive data (passwords, tokens, PII)
- Use HTTPS for all external calls
- Sanitise all database inputs — no raw string queries

## 📝 Code Style
- Every function/method needs a one-line comment above it
- No magic numbers — use named constants
- Meaningful variable names — no \`x\`, \`tmp\`, \`data\` without context
- Max function length: 40 lines — split if longer
- No commented-out dead code in main files — move to archive

## 📁 File & Doc Rules
- Bullet points only in docs — no paragraphs
- Archive over delete — comment out with \`<!-- archived: reason -->\`
- One concern per file — no 500-line god files
- Keep doc entries concise — one line per item max
- Never write secrets to any \`.md\` or \`.json\` file

## 🔀 Git Rules
- Commit format: \`[agent-name] action: short description\`
- Branch format: \`<agent>/<task-id>-short-description\`
- Commit after every completed subtask — not at end of session
- Never commit \`.env\` files or credentials

## 🧠 Token & Context Rules
- Read: your agent doc + MASTER.md + RULES.md before every task
- Do NOT read entire codebase — only files relevant to current task
- At 70% context: finish current step, write checkpoint, log it
- At 85% context: stop cleanly, save checkpoint, set status to \`paused\`
- Keep your agent doc under ${TOKEN_BUDGETS.agentDoc} tokens — compress when prompted
- Write changelog entries at milestones only — not every line of code

## 🏗️ Architecture Rules
- No circular dependencies
- Separate concerns — UI, logic, data in different layers
- Write tests alongside features — not after
- If a decision affects another agent — write it to decisions.md immediately
${stackRules}
${typeRules}

## 🔍 Research First (non-negotiable)
- NEVER write code or content without exploring what exists first
- Map project structure before reading any file
- Read relevant existing files before writing new ones
- Check other agents' memory docs before starting
- Check decisions.md — don't re-decide what's already decided
- Check \`.claude-team/docs/research/<task-id>.md\` before complex tasks
- If uncertain after exploring → ask, don't guess
- Write your plan in your memory doc before executing
- Follow patterns found — don't invent new ones without Architect approval

## ✅ Definition of Done (per task)
- [ ] Feature works as described
- [ ] Basic error handling added
- [ ] Function comments written
- [ ] Relevant tests written or updated
- [ ] Agent doc updated
- [ ] Changelog entry written
- [ ] No secrets or debug logs committed
`;
}

// ── Stack-specific rules ─────────────────────────────────────────────────────

function getStackRules(stack) {
  const rules = {
    'node-ts': `
## 🟦 TypeScript / Node.js Rules
- Strict mode enabled — no \`any\` types without comment explaining why
- Use \`async/await\` over raw Promise chains
- Handle all promise rejections — no unhandled rejections
- Use \`zod\` or similar for runtime validation at boundaries
- Export types alongside implementations`,

    'python': `
## 🐍 Python Rules
- Type hints on all function signatures
- Use \`dataclasses\` or \`pydantic\` for data models
- Virtual environment required — no global pip installs
- \`black\` formatting enforced
- Raise specific exceptions — never bare \`except:\``,

    'react': `
## ⚛️ React Rules
- Functional components only — no class components
- Custom hooks for reusable logic — prefix with \`use\`
- No direct DOM manipulation — use refs only when necessary
- Memoize expensive computations with \`useMemo\`
- Keep components under 150 lines — extract sub-components`,

    'vue': `
## 💚 Vue Rules
- Composition API only — no Options API in new files
- Props must have types and defaults defined
- Use \`defineEmits\` for all emitted events
- Pinia for state management — no direct mutation
- \`<script setup>\` syntax preferred`,

    'go': `
## 🐹 Go Rules
- Handle all errors explicitly — no \`_\` for error returns
- Use context for cancellation and timeouts
- Table-driven tests preferred
- Interfaces defined at point of use — not in implementation
- No init() functions unless absolutely necessary`,

    'mixed': `
## 🔧 Mixed Stack Rules
- Document which language/framework handles which concern
- Define clear API contracts between language boundaries
- Keep language-specific code isolated — no mixed files`,
  };

  return rules[stack] || '';
}

// ── Project-type-specific rules ──────────────────────────────────────────────

function getTypeRules(type) {
  const rules = {
    'api': `
## 🔌 API Rules
- All endpoints need input validation
- Return consistent error shapes: \`{ error, message, code }\`
- Version your API from day one: \`/api/v1/\`
- Rate limit all public endpoints
- Document every endpoint in comments above handler`,

    'web': `
## 🌐 Web App Rules
- Accessible by default — semantic HTML, ARIA labels where needed
- Mobile-first CSS
- No inline styles — use CSS modules or utility classes
- Lazy load routes and heavy components
- Handle loading, error, and empty states for every async operation`,

    'mobile': `
## 📱 Mobile Rules
- Handle offline state gracefully
- Test on both iOS and Android viewports
- No blocking operations on main thread
- Request only necessary permissions
- Handle keyboard appearance/disappearance in forms`,

    'ai': `
## 🤖 AI / ML Rules
- Log all model inputs/outputs for debugging (no PII)
- Version models and prompts alongside code
- Always have a fallback for model failures
- Set explicit timeouts on all inference calls
- Evaluate before deploying — no blind updates`,

    'cli': `
## 🖥️ CLI Rules
- Always show progress for operations > 1 second
- Provide \`--dry-run\` flag for destructive operations
- Exit codes: 0 success, 1 error, 2 misuse
- Never prompt in non-interactive mode
- Coloured output only when TTY detected`,
  };

  return rules[type] || '';
}

// Append research-first rules to any generated RULES.md
// This is called after generateRulesMd and appended

export function generateResearchRules() {
  return `
## 🔍 Research First (non-negotiable)
- NEVER write code or content without exploring what already exists first
- Map project structure before reading any file
- Read relevant existing files before writing new ones
- Check other agents' memory docs before starting
- Check decisions.md — don't re-decide what's already decided
- Check .claude-team/docs/research/<task-id>.md before starting complex tasks
- If uncertain after exploring → ask, don't guess
- Write your plan in your memory doc before executing
- Patterns found during exploration → follow them, don't invent new ones
`;
}