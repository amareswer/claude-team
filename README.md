# claude-team 🤖

**Multi-agent coordination CLI for Claude Code**
Build a team of Claude Code instances that collaborate on any project — technical or content — with role hierarchy, two-way task coordination, token safety, living documentation, and a built-in channel for talking to you (the human).

---

## Install

```bash
# From the project folder:
npm install -g .

# Or run directly without installing:
npx claude-team init
```

**Requirements**: Node.js 18+ and Claude Code (`claude` CLI) installed.

---

## Quick Start

```bash
cd your-project
claude-team init       # 🧙 Answer a few questions — the team is generated
claude-team start      # 🚀 Exact launch command for every agent
claude-team status     # 📊 Live view: agents, token usage, doc health
```

Then open one terminal per agent, run `claude` in each, and paste the prompt `claude-team start` gives you. That's the whole loop.

---

## Commands

| Command | Description |
|---------|-------------|
| `claude-team init` | Interactive wizard — generates the full team (asks before overwriting an existing one) |
| `claude-team start` | Print the launch instructions for every agent |
| `claude-team status` | Agent status, context usage, doc token health, task summary |
| `claude-team add` | Add a new worker agent to an existing team |
| `claude-team archive` | Archive all project docs when the project is done (human-triggered) |

---

## The Init Wizard

`claude-team init` walks through 5 steps:

1. **Project basics** — name, goal, and category (💻 technical / ✍️ content / 🔀 mixed). Technical projects also pick a type (web, API, CLI, …) and stack; content projects pick a format (blog, book, docs, scripts, …).
2. **Team hierarchy** — how much leadership the project needs (see below).
3. **Worker agents** — 1–4 suggested workers based on your project type, or fully custom roles.
4. **Coordination** — queue / parallel / pipeline task style, git checkpoints, cross-agent review, poll interval.
5. **First task** — optionally define a starting task and assign it. If you assign it to a specific agent, it lands directly in their inbox.

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

This tool is global — run `claude-team init` in any project's root and it generates a fresh team tailored to that project. Nothing is hard-coded. Re-running init on an existing team asks for confirmation before overwriting anything.

---

## License

MIT
