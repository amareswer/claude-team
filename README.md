<p align="center"><img src="lib/office/logo.svg" width="112" alt="claude-team — an office building whose lit windows are the team's status lights"></p>

<h1 align="center">claude-team</h1>

**Multi-agent coordination CLI for Claude Code**
Build a team of Claude Code instances that collaborate on any project — technical or content — with role hierarchy, two-way task coordination, token safety, living documentation, and a built-in channel for talking to you (the human).

---

## Install — project-local, not global

claude-team is **not** installed as a global npm command — nothing gets added to your system PATH or global npm state. Every project that wants a team runs it locally, scoped to just that project folder.

**Easiest — one command, works the same on macOS, Linux, and Windows (any language project, not just Node):**

```bash
cd your-project
npx /path/to/claude-team init
```

`npx` runs claude-team straight from the cloned folder — no install step, nothing written to your project, nothing left behind afterward. Same command works for every subcommand: swap `init` for `office`, `status`, `add`, `remove`, `start`, `archive`. On Windows, run it exactly the same way from PowerShell or cmd.exe — `npx` ships with Node and resolves the local path identically on every OS.

Replace `/path/to/claude-team` with wherever you cloned this repo, e.g. `~/projects/claude-team`.

**Alternatives, if you want something more permanent:**

- **Direct node invocation** — identical to the npx form, just spelled out: `node /path/to/claude-team/bin/claude-team.js init`. Useful if `npx` isn't on your PATH for some reason.
- **Local devDependency** — for target projects that are already Node projects and want claude-team pinned in their own `package.json`:
  ```bash
  cd your-project
  npm install --save-dev /path/to/claude-team
  npx claude-team init
  ```
  This records claude-team in *that project's* `package.json`/`node_modules` only — nothing global, nothing shared across projects.
- **Shell alias** (macOS/Linux only — skip on Windows, the `npx` form above is already just as short): add to `~/.zshrc` / `~/.bashrc`:
  ```bash
  alias claude-team='npx /path/to/claude-team'
  ```

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

(`claude-team` above stands for whichever invocation you're using — `npx /path/to/claude-team`, the alias, or the full `node /path/to/.../bin/claude-team.js`.)

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
| `claude-team remove` | Remove an agent from the team (deletes its instructions, memory doc, and task files) |
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
- **Your desk** shows the team's unanswered questions from `HUMAN_INPUT.md` as a red inbox badge — click it to read them and **answer right there**: your reply is written under the question's `HUMAN REPLY:` section (same as editing the file by hand) and the asker's inbox gets a `human_reply` message so they notice without polling the file.
- Your desk drawer also has a **Hand out a task** form (title, description, priority, assignee). Tasks go to `queue.json` + `master.json`; assigning to a specific agent also delivers it straight to their inbox.
- The **project name and goal** in the header are editable too — click the ✏️ next to the title (or open your desk drawer) to rename the project or reword the goal; the change is saved to `config.json` and mirrored to `master.json`.
- A completions feed at the bottom shows recent finished work from every agent's outbox.

**Launch agents from the office:**
- Every desk shows the agent's model (OPUS / SONNET / HAIKU / DEFAULT) under its role. Click a desk → pick a model (defaults to whatever's saved) → **▶ Launch agent** starts a real `claude --model <x>` session for that agent in a pseudo-terminal, with the kickoff prompt already sent. The desk gets a green **LIVE** tag, and the chosen model is remembered for next time.
- The drawer shows the agent's **live terminal** (a real interactive session — type into it to approve permission prompts or give instructions), plus a **⏹ Stop** button. If a live agent reports `paused` (token limit hit), a **🔄 Respawn** button appears — it kills the stuck session and starts a fresh one with the same instructions and memory doc.
- Sessions launched from the office end when you close the office (Ctrl+C). Agents you launched manually in your own terminals are untouched — the office only observes them.

**Agents actually keep checking in — not just on paper:** ORCHESTRATOR.md describes a recurring loop ("every N seconds, re-check inboxes and assign tasks"), but a real CLI session doesn't repeat on its own — it does the work it's given and stops. Agents launched from the office now get that loop for real: while a session has been quiet (no output, and nobody's mid-keystroke in its terminal) for at least the project's configured poll interval, the office types a check-in prompt into it — "re-check your inbox/status/outboxes, then continue." This applies to every launched agent, not just the orchestrator, so workers also notice new inbox tasks without a human nudging them. It's on by default and toggleable per agent (**⏸ Pause auto-check** / **🔁 Resume**) in the drawer — pause it if you want to drive an agent by hand. Agents launched in a plain terminal don't get this; they're on their own to re-check, as before.

**Hire from the office:**
- The dashed **➕ Hire** desk opens a form (name, role, responsibilities, model). Hiring generates the agent's instruction file, memory doc, and coordination files — same as `claude-team add` — and the new character walks in, ready to launch with the model you picked.

**Fire from the office:**
- Every agent's drawer (except the orchestrator's) has a **🔥 Remove agent** button with an inline confirm step — same as `claude-team remove`. If the agent has a live session launched from the office, it's stopped first; then the character walks out, the desk disappears, and the agent's instruction file and inbox/outbox/status files are deleted.
- **Memory handover**: the fired agent's memory doc isn't deleted — it's archived to `.claude-team/docs/archive/<name>-memory-<date>.md`, and the orchestrator gets a handover note in its inbox (who left, where the memory is archived, how many tasks were requeued). Their unfinished tasks in `master.json` and `queue.json` go back to the queue as `unassigned` for the orchestrator to hand out again; completed tasks keep their history.

**Real token usage, not a guess:** every launched agent's desk shows a compact 🪙 total, and its drawer shows a live "🪙 Tokens used" line — exact `input`/`output`/`cache write`/`cache read` counts, not the self-reported `contextUsedPercent` (which is just the agent's own estimate of how full its context window is; the two measure different things and are both shown). The header also totals it across the whole team for the current office run. This works by correlating the agent's session to the transcript file Claude Code writes for it under `~/.claude/projects/`, so it only applies to agents launched from the office — one launched in a plain terminal has no such correlation and won't show a token count. If the office can't find the transcript within ~20s (rare), the drawer says so instead of showing a wrong number.

**Notes:**
- The server binds to `localhost` only (`http://localhost:4753`, change with `--port`). Never expose it — it can spawn processes.
- The terminal view uses xterm.js from a CDN, so it needs internet; everything else works offline.
- Launching requires `node-pty` (installed automatically). If it can't build on your machine, the office falls back to view-only mode and tells you.
- Each launched agent is a full Claude Code session on your Claude subscription — launch what you need, not the whole roster at once.
- **First launch in a brand-new project directory**: Claude Code shows a one-time "do you trust this folder?" prompt before it does anything. The office can't detect or answer this for you yet (its exact on-screen text is rendered with per-word cursor-positioning codes that don't survive a simple text match) — if a freshly-launched agent looks stuck at "idle" and never does anything, open its terminal in the drawer and check.
- Token totals are cumulative across office runs, persisted to `.claude-team/logs/token-usage.json`.

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

## Pros, Cons & Limitations

### Pros
- **Everything is plain files.** The whole team — config, instructions, inboxes, statuses, docs — lives in `.claude-team/`. No daemon, no database, no lock-in: commit the folder and team state is versioned; delete it and claude-team is gone without a trace.
- **Works on any project, any language.** Team definitions are markdown and JSON, not code hooks — a Rust repo, a blog, and a Node app all get the same treatment.
- **Real token accounting.** Office-launched agents report exact input/output/cache token counts from Claude Code's own session transcripts, not self-reported estimates.
- **One glance, whole team.** The office shows every agent's status, context bar, current task, and live terminal — plus the questions waiting on you.
- **Project-local by design.** No global npm install, no PATH changes, no shared state between projects.
- **Token budgets on docs** (agent memory 1500, MASTER.md 3000, RULES.md 800) keep agent context lean as the project grows.

### Cons
- **Coordination is file polling.** A few seconds of latency, and no file locking — two agents writing the same file in the same moment can clobber each other. Rare in practice, real in principle.
- **Cost scales with team size.** Every agent is a full Claude Code session on your subscription — launch the agents you need, not the whole roster.
- **Launched agents live and die with the office.** Ctrl+C on the office stops every session it started (manually-launched agents are unaffected).
- **Some behaviors are heuristics, not guarantees.** The idle auto-check nudge and transcript correlation use sensible timing rules; e.g. two sessions starting in the same second could be matched to the wrong transcript.

### Known limitations
- **The trust-folder prompt needs a human.** The first-ever launch in a new project directory hits Claude Code's one-time "do you trust this folder?" prompt, and the session waits until someone answers it in the agent's terminal. The office can't reliably detect or answer it (see Notes in the Office section).
- **Token usage only covers office-launched agents.** Sessions you start in your own terminal can't be correlated to a transcript, so their usage never shows up in the totals.
- **Terminal view needs internet.** xterm.js loads from a CDN; everything else works offline.
- **Single machine, localhost only, no auth.** The office server binds to `127.0.0.1` and must never be exposed — it can spawn processes.
- **Removal doesn't rewrite history.** Firing an agent archives their memory doc and requeues their unfinished tasks, but past outbox entries, changelog lines, and doc mentions of them stay as written.
- **Recovery for `paused` agents is one click, not automatic.** An agent that hits its token limit stays paused until you press 🔄 Respawn in its drawer (or relaunch it yourself) — the office never restarts sessions on its own.

---

## License

MIT
