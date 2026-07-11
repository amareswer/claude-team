# claude-team 🤖

**Multi-agent coordination CLI for Claude Code**
Build a team of Claude Code instances that collaborate on any project — technical or content — with role hierarchy, two-way task coordination, token safety, living documentation, and a built-in channel for talking to you (the human).

---

## Install — project-local, not global

claude-team is **not** installed as a global npm command — nothing gets added to your system PATH or global npm state. Every project that wants a team runs it locally, scoped to just that project folder.

**Option A — zero install, works for any project (any language, not just Node):**

```bash
cd your-project
node /path/to/claude-team/bin/claude-team.js init
```

Every command works the same way — swap `init` for `office`, `status`, `add`, `start`, `archive`. If you use this a lot, add a shell alias in your `~/.zshrc` / `~/.bashrc` (this is a plain shell alias, not an npm install — it still runs the same local script):

```bash
alias claude-team='node /path/to/claude-team/bin/claude-team.js'
```

**Option B — local devDependency, for target projects that are already Node projects:**

```bash
cd your-project
npm install --save-dev /path/to/claude-team
npx claude-team init
```

This records claude-team in *that project's* `package.json`/`node_modules` only — nothing global, nothing shared across projects. `npx` finds the locally-installed binary automatically.

Replace `/path/to/claude-team` with wherever you cloned this repo, e.g. `/Users/nishita/Desktop/Amaresh/projects/claude-team`.

**Requirements**: Node.js 18+ and Claude Code (`claude` CLI) installed. `claude-team office`'s launch/hire features use `node-pty` (a native module, built automatically the first time you run `npm install` inside the claude-team repo itself); if it can't build on your machine the office still runs, just in view-only mode.

---

## Quick Start

```bash
cd your-project
claude-team init       # 🧙 Answer a few questions — the team is generated
claude-team start      # 🚀 Exact launch command for every agent
claude-team status     # 📊 Terminal view: agents, token usage, doc health
claude-team office     # 🏢 Visual office view in your browser (live)
```

(`claude-team` above stands for whichever invocation you set up — `npx claude-team`, the alias, or the full `node /path/to/.../bin/claude-team.js`.)

Then open one terminal per agent, run `claude` in each, and paste the prompt `claude-team start` gives you. That's the whole loop.

---

## Commands

| Command | Description |
|---------|-------------|
| `claude-team init` | Interactive wizard — generates the full team (asks before overwriting an existing one) |
| `claude-team start` | Print the launch instructions for every agent |
| `claude-team status` | Agent status, context usage, doc token health, task summary (terminal) |
| `claude-team office` | Live visual office view of the team in your browser (`--port` to change port) |
| `claude-team add` | Add a new worker agent to an existing team |
| `claude-team archive` | Archive all project docs when the project is done (human-triggered) |

---

## The Init Wizard

`claude-team init` walks through 6 steps:

1. **Project basics** — name, goal, and category (💻 technical / ✍️ content / 🔀 mixed). Technical projects also pick a type (web, API, CLI, …) and stack; content projects pick a format (blog, book, docs, scripts, …).
2. **Team hierarchy** — how much leadership the project needs (see below).
3. **Worker agents** — 1–4 suggested workers based on your project type, or fully custom roles.
4. **Models** — which Claude model each agent uses when launched: recommended defaults (Opus for leadership, Sonnet for workers), one model for everyone, or choose per agent. See [Models](#models-per-agent) below.
5. **Coordination** — queue / parallel / pipeline task style, git checkpoints, cross-agent review, poll interval.
6. **First task** — optionally define a starting task and assign it. If you assign it to a specific agent, it lands directly in their inbox.

### Hierarchy options

**Technical projects:**

| Hierarchy | Leadership generated |
|---|---|
| Simple | Orchestrator only |
| Standard | Project Manager + Orchestrator |
| Full | Project Manager + Architect + Orchestrator |
| Research | Project Manager + Architect + Researcher + Orchestrator |

**Content projects:**

| Hierarchy | Leadership generated |
|---|---|
| Simple | Orchestrator only |
| Standard | Editor + Orchestrator |
| Full | Editor + Researcher + Orchestrator |

---

## Models (per agent)

Every agent — including the orchestrator — has its own Claude model, stored in `config.json` and used whenever that agent is launched from the Office (see below):

| Model | Best for |
|---|---|
| **Opus** | Planning, architecture, ambiguous judgment calls — the recommended default for leadership roles |
| **Sonnet** | Most implementation work — the recommended default for workers |
| **Haiku** | Fast, narrow, repetitive tasks |
| **Default** | Don't pass `--model` at all — whatever `claude` resolves to on its own |

Set this during `init` (Step 4) — recommended defaults, one model for the whole team, or pick per agent — and change it any time from the Office UI, either when hiring a new agent or right before launching an existing one (the choice is remembered for next time).

---

## What Gets Generated

```
your-project/
├── CLAUDE.md                          ← Project overview (auto-read by Claude Code)
└── .claude-team/
    ├── ORCHESTRATOR.md                ← Orchestrator instructions
    ├── HUMAN_INPUT.md                 ← Q&A channel between the team and YOU
    ├── config.json                    ← Team config
    ├── agents/                        ← One instruction file per agent
    │   ├── project-manager.md         ←   (leadership roles, per hierarchy)
    │   ├── architect.md
    │   ├── frontend.md                ←   (workers)
    │   └── backend.md
    ├── docs/                          ← Living documentation
    │   ├── MASTER.md                  ←   Project roadmap + status (3000-token cap)
    │   ├── RULES.md                   ←   Non-negotiable rules (800-token cap)
    │   ├── ARCHITECTURE.md            ←   Technical foundation (or STYLE_GUIDE.md for content)
    │   ├── NOTES.md                   ←   Shared scratch notes
    │   ├── changelog.md               ←   One-line event log (permanent record)
    │   ├── decisions.md               ←   All decisions with reasoning (DEC-NNN)
    │   ├── agents/<name>.md           ←   Per-agent memory doc (1500-token cap)
    │   ├── research/                  ←   Researcher outputs, one file per task
    │   └── archive/                   ←   Archived projects (see `claude-team archive`)
    ├── tasks/
    │   ├── master.json                ←   Overall task tracker
    │   ├── queue.json                 ←   Unassigned task queue
    │   ├── orchestrator-inbox.json
    │   └── <agent>-{inbox,outbox,status}.json   ← per agent
    ├── checkpoints/                   ← Saved state when an agent nears its context limit
    ├── reviews/                       ← Cross-agent / editor review files
    └── logs/
```

---

## The Roles

- **Orchestrator** — assigns tasks, monitors status files, keeps MASTER.md current, resumes paused agents from checkpoints. Never writes code.
- **Project Manager** (technical) — breaks the goal into milestones → features → tasks, owns HUMAN_INPUT.md, unblocks the team when you answer questions.
- **Architect** (technical) — explores the codebase first, writes ARCHITECTURE.md, defines interfaces and conventions. Workers don't code until it's marked READY.
- **Editor** (content) — writes STYLE_GUIDE.md, outlines the content, reviews every draft. Writers don't start until it's marked READY.
- **Researcher** — pre-researches tasks (codebase patterns or topic sources) into `docs/research/<task-id>.md` so workers never start blind.
- **Workers** — the agents that actually build/write, following a mandatory research-first protocol (explore → understand → plan → confirm → execute).

---

## Two-Way Coordination

Every agent has three files in `.claude-team/tasks/`:

| File | Direction | Purpose |
|------|-----------|---------|
| `<agent>-inbox.json` | To the agent | `tasks` array (assigned work) + `messages` array (requests, notifications) |
| `<agent>-outbox.json` | From the agent | Completed tasks with summaries and files changed |
| `<agent>-status.json` | To everyone | `idle` / `working` / `blocked` / `paused` / `review_needed` / `done`, plus context % |

All inboxes share the same shape — tasks go in `tasks`, everything else (research requests, questions, ready signals) goes in `messages`. Agents write to `orchestrator-inbox.json` when blocked, and to `researcher-inbox.json` to request research.

---

## The Office View 🏢

`claude-team office` opens a live visual dashboard in your browser — your team rendered as an office you can actually run the project from:

```
┌─ LEADERSHIP ────────────────────────────────────────────┐
│   🧔 You      🧑‍✈️ orchestrator  🧑‍💼 PM [LIVE]  👷 architect │
│   ❓ inbox    (desk + status)   ⌨️ working    💤 idle     │
└─────────────────────────────────────────────────────────┘
┌─ WORKERS ───────────────────────────────────────────────┐
│   👩‍💻 frontend        👨‍💻 backend        ➕ Hire          │
│   ⌨️ working…         🚧 blocked!       (empty desk)    │
│   [▓▓▓░░░] 42% ctx    [▓▓▓▓▓░] 77% ctx                  │
└─────────────────────────────────────────────────────────┘
```

**Watch the team live:**
- Every agent gets a desk with a character, status LED, live context-usage bar, and current task. Working agents type, blocked agents raise a red speech bubble, idle agents doze. Refreshes every 2 seconds straight from the `.claude-team/` files.
- **Your desk** shows the team's open questions from `HUMAN_INPUT.md` as a red inbox badge — click it to read them.
- A completions feed at the bottom shows recent finished work from every agent's outbox.

**Launch agents from the office:**
- Every desk shows the agent's model (OPUS / SONNET / HAIKU / DEFAULT) under its role. Click a desk → pick a model (defaults to whatever's saved) → **▶ Launch agent** starts a real `claude --model <x>` session for that agent in a pseudo-terminal, with the kickoff prompt already sent. The desk gets a green **LIVE** tag, and the chosen model is remembered for next time.
- The drawer shows the agent's **live terminal** (a real interactive session — type into it to approve permission prompts or give instructions), plus a **⏹ Stop** button.
- Sessions launched from the office end when you close the office (Ctrl+C). Agents you launched manually in your own terminals are untouched — the office only observes them.

**Agents actually keep checking in — not just on paper:** ORCHESTRATOR.md describes a recurring loop ("every N seconds, re-check inboxes and assign tasks"), but a real CLI session doesn't repeat on its own — it does the work it's given and stops. Agents launched from the office now get that loop for real: while a session has been quiet (no output, and nobody's mid-keystroke in its terminal) for at least the project's configured poll interval, the office types a check-in prompt into it — "re-check your inbox/status/outboxes, then continue." This applies to every launched agent, not just the orchestrator, so workers also notice new inbox tasks without a human nudging them. It's on by default and toggleable per agent (**⏸ Pause auto-check** / **🔁 Resume**) in the drawer — pause it if you want to drive an agent by hand. Agents launched in a plain terminal don't get this; they're on their own to re-check, as before.

**Hire from the office:**
- The dashed **➕ Hire** desk opens a form (name, role, responsibilities, model). Hiring generates the agent's instruction file, memory doc, and coordination files — same as `claude-team add` — and the new character walks in, ready to launch with the model you picked.

**Real token usage, not a guess:** every launched agent's drawer shows a live "🪙 Tokens used" line — exact `input`/`output`/`cache write`/`cache read` counts, not the self-reported `contextUsedPercent` (which is just the agent's own estimate of how full its context window is; the two measure different things and are both shown). The header also totals it across the whole team for the current office run. This works by correlating the agent's session to the transcript file Claude Code writes for it under `~/.claude/projects/`, so it only applies to agents launched from the office — one launched in a plain terminal has no such correlation and won't show a token count. If the office can't find the transcript within ~20s (rare), the drawer says so instead of showing a wrong number.

**Notes:**
- The server binds to `localhost` only (`http://localhost:4753`, change with `--port`). Never expose it — it can spawn processes.
- The terminal view uses xterm.js from a CDN, so it needs internet; everything else works offline.
- Launching requires `node-pty` (installed automatically). If it can't build on your machine, the office falls back to view-only mode and tells you.
- Each launched agent is a full Claude Code session on your Claude subscription — launch what you need, not the whole roster at once.
- **First launch in a brand-new project directory**: Claude Code shows a one-time "do you trust this folder?" prompt before it does anything. The office can't detect or answer this for you yet (its exact on-screen text is rendered with per-word cursor-positioning codes that don't survive a simple text match) — if a freshly-launched agent looks stuck at "idle" and never does anything, open its terminal in the drawer and check.
- Token totals reset when you restart the office — they're not persisted across runs.

---

## Talking to the Team — HUMAN_INPUT.md

The team asks you questions in `.claude-team/HUMAN_INPUT.md`:

1. The PM/Editor writes a `QUESTION-NNN [open]` block with context, options, and a recommendation.
2. You write your answer under `## HUMAN REPLY:` and save the file.
3. Next session the PM/Editor reads it, marks the question `[resolved]`, and unblocks the affected tasks.

Init always creates **QUESTION-001** asking you to confirm the project scope — answer it before launching the team.

---

## Token Safety

Long-running agents burn context. Every generated instruction file bakes in the same protocol:

- **At 70% context** — finish the current step, write a checkpoint to `.claude-team/checkpoints/`, log it.
- **At 85% context** — stop cleanly, save a full checkpoint, set status to `paused`.
- The **orchestrator** watches for `paused` agents and re-assigns the task with the checkpoint summary, so a fresh session resumes without re-exploring.

Docs have hard token budgets too (agent memory 1500, MASTER.md 3000, RULES.md 800) — `claude-team status` shows a usage bar for each so nothing silently bloats.

---

## Launching the Team

Order matters for hierarchies with leadership:

1. **Answer QUESTION-001** in `.claude-team/HUMAN_INPUT.md`.
2. Start the **PM** (or **Editor**) — it plans milestones and defines tasks.
3. Start the **Architect** — wait for it to mark ARCHITECTURE.md READY before workers begin.
4. Start the **Researcher** (if any), then the **Orchestrator**, then the **workers**.

Each terminal is just:

```bash
claude
# then: "Read CLAUDE.md and .claude-team/agents/<name>.md and start working"
```

`claude-team start` prints the exact prompt for every agent so you can copy-paste.

---

## Finishing a Project — `claude-team archive`

When the project is done, run `claude-team archive`. It:

- Copies MASTER.md, RULES.md, changelog, decisions, notes, the foundation doc, HUMAN_INPUT.md, research docs, and every agent memory doc into `.claude-team/docs/archive/<project>-<date>/`
- Writes a final `SUMMARY.md` (goal, team, task completion count, last changelog entries)
- Replaces the live docs with pointer stubs and updates the archive `INDEX.md`

Nothing is deleted — it's all preserved for the next project in the same repo.

---

## Role Suggestions by Project Type

| Project Type | Suggested Workers |
|---|---|
| Web App | Frontend, Backend, QA, DevOps |
| API / Backend | API Dev, DB Engineer, Security, QA |
| Mobile | UI Dev, Backend, QA, Platform |
| AI / ML | ML Engineer, Data Engineer, API Dev, Eval |
| CLI Tool | Core Dev, UX, QA, Docs |
| Content | Writer ×2, Reviewer, SEO Writer |

You can rename or replace any suggestion during the wizard, or pick "Custom" and define every role yourself.

---

## Reusable Across Projects

One local clone of claude-team works against any number of projects — run it (via whichever invocation from Install above) in any project's root and it generates a fresh team tailored to that project, with no shared or global state between projects. Nothing is hard-coded. Re-running init on an existing team asks for confirmation before overwriting anything.

---

## License

MIT
