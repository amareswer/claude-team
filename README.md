<p align="center"><img src="lib/office/logo.svg" width="112" alt="claude-team — an office building whose lit windows are the team's status lights"></p>

<h1 align="center">claude-team</h1>

claude-team is a git-committable, resumable project-memory layer for multi-day Claude Code projects. A team's full state — role instructions, task inboxes/outboxes, status files, and living docs (`MASTER.md`, `RULES.md`, `decisions.md`, `changelog.md`) — lives entirely as plain files under `.claude-team/`, committed alongside your code. Close every terminal and come back a week later: the docs and task state are still there, exactly as they were last written.

This is not the same thing as Claude Code's built-in Agent Teams feature, which coordinates multiple agents live within a single session — that's scoped to the session it runs in, with no persistent doc layer that survives after it ends. claude-team instead generates a standing set of instruction files and coordination state on disk that any number of separate `claude` sessions — run today, tomorrow, or next week — read from and write back to.

It's also not a GUI or office-simulation desktop app like Munder Difflin. The optional `claude-team office` view is a thin, read/write layer over the same `.claude-team/` files, not a separate application with its own state — no Electron, no daemon. Delete `.claude-team/` and claude-team is gone without a trace.

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

**Requirements**: Node.js 20.17+ (or 22.13+ / 23.5+; declared in `package.json` `engines`, driven by the Inquirer dependency) and Claude Code (`claude` CLI) installed. `claude-team office`'s launch/hire features use `node-pty` (a native module, built automatically the first time you run `npm install` inside the claude-team repo itself); if it can't build on your machine the office still runs, just in view-only mode.

---

## Quick Start

```bash
cd your-project
claude-team init       # 🧙 Answer a few questions — the team is generated
claude-team start      # 🚀 Exact launch command for every agent
claude-team status     # 📊 Terminal view: agents, token usage, doc health
claude-team resume     # ▶ Where you left off + suggested next steps (free, no agent)
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
| `claude-team resume` | Where the project stands: what finished, what's in progress, who's blocked or waiting on review, open questions for you, code changes, and ordered next steps. Built only from `.claude-team/` files and git — no agent session, no tokens. `--json` for scripts. State files that can't be parsed are listed, never silently skipped. |
| `claude-team check <task-id>` | Runs the task's acceptance checks (named commands from `config.checks`) with timeouts and bounded logs, and saves exit codes, timestamps, git revision and a working-tree fingerprint to `.claude-team/checks/<task-id>.json`. Exit code 0 only if all pass. Never changes the task's status. |
| `claude-team checks` / `checks approve <name>` | List checks and their approval state / approve a check's exact command (interactive terminal only). |
| `claude-team review` / `review show <id>` | The human review queue: what's waiting for you, and for one task the agent's explanation, acceptance criteria, check evidence and the code diff (tracked + untracked, `--lines` to see more). |
| `claude-team review request <id>` | (agents/orchestrator) put a finished task in the queue; sets its status to `review`. |
| `claude-team review repair [--dry-run]` | Finish review decisions an interruption left half-applied. |
| `claude-team review approve <id>` / `reject <id> -m "…"` | (human, interactive terminal only) accept → task `done`; or send back → task `assigned` and your note lands in the assignee's inbox as a `review_rejected` message. |
| `claude-team office` | Live visual office view of the team in your browser (`--port` to change port, `--no-open` to skip auto-opening a tab). The printed URL carries a per-run access key; the server also validates Host/Origin on every request and WebSocket, so other web pages can't drive your terminals. |
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
5. **Coordination** — queue / parallel / pipeline task style, git checkpoints, cross-agent review, poll interval, and (off by default) experimental direct agent-to-agent messaging — see [Cross-Session Messaging](#cross-session-messaging-experimental-opt-in) below.
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

## Concurrency & Locking

Every shared coordination file — inboxes, outboxes, status files, `MASTER.md`, `tasks/master.json`, `tasks/queue.json`, `config.json`, `HUMAN_INPUT.md` — can be read-modify-written by more than one actor: two agents, an agent and the office server, or the office and a CLI command, all in the same few seconds. Without coordination, a classic race applies: both read the old contents, both mutate their own in-memory copy, and whichever writes last silently erases the other's change.

claude-team guards every such read-modify-write with a plain file lock — no daemon, no new dependency, consistent with the rest of the project being "just files":

- **The lock is a numbered sentinel file**, `<file>.lock.<epoch>` (e.g. `tasks/backend-inbox.json.lock.1`), created next to the file it protects. It is published fully-formed and exclusively (write to a temp file, then `link()` — fails if that epoch exists) and holds `{ "pid", "token", "acquiredAt" }`. After publishing, a new owner checks it is the highest epoch and that the only other lock files present are the exact dead ones it judged beforehand; otherwise it backs off and retries.
- **A writer holds the lock only for the read-modify-write itself**: acquire → read the current file → apply the change → write it back → release. Nothing else waits on it.
- **Contention retries with backoff** — up to a 5-second timeout, with jittered exponential backoff between attempts (starting at 50ms, capped at 400ms), so a burst of concurrent writers drains without a thundering herd.
- **A lock is never taken from a live process.** Time-based takeover ("not touched in 30s, steal it") can give a paused-but-alive owner and its successor the lock at the same time, so there is none. A lock is reclaimed only when its owner pid no longer exists (signal-0 probe) — a dead process cannot resume — and release is a plain delete of the owner's own file. A reused pid just makes waiters time out (fails safe). Same-machine only; not safe on network filesystems.
- **Contention times out rather than hangs.** If a live process holds the lock for the full 5 seconds, `acquireLock` throws. A critical section that outlives that must pass a larger `timeoutMs` to its waiters.

This lives in `lib/lock.js` (the primitive: `withLock(filePath, fn)`) and `lib/jsonStore.js` (the common case: `updateJson(filePath, mutate, fallback)` — read, mutate, write, all under one lock). Every read-modify-write on a shared file in `lib/add.js`, `lib/config.js`, and `lib/office.js` goes through one of these. Plain reads (status displays, the office's polling `/api/state`) aren't locked — only writes that follow a read of the same file are, since those are the ones a race can corrupt.

**What this does and doesn't fix:** it eliminates lost updates on a single file — two agents delivering a task to the same inbox in the same instant both land, instead of one clobbering the other (verified with a 15-way concurrent write test; see the PR/commit history for the harness). A plain lock still can't make a *multi-file* operation atomic — reassigning a task moves it out of one agent's inbox and into another's, two separate files, and no amount of per-file locking makes that pair a single transaction; a crash between the two writes is always possible.

What it can control is which way that crash fails. `moveTask` (`lib/jsonStore.js`) is what every such move goes through — task reassignment via the office task board (`lib/office.js`) is currently the one case in this codebase where a task's presence in one file is supposed to become its presence in a different file, and it's not lossy anymore: `moveTask` locks both files up front, always in the same deterministic order (the two paths sorted, not "source then destination") so two moves crossing the same pair of files head-on can't deadlock waiting on each other, and it writes the destination file *before* removing the task from the source. If the process dies in between, the task is left in **both** files — a duplicate — never in neither. Duplication is recoverable; loss isn't. `claude-team status` runs `reconcileDuplicateTasks` on every invocation and reports any task ID it finds sitting in more than one agent's inbox — it doesn't touch anything, the same as every other destructive-adjacent check in this tool; picking the authoritative copy and removing the other is a human call.

**The gap the file lock can't close:** a lock only protects a single read-then-write pair. It doesn't help when the orchestrator reads `MASTER.md` at the start of a cycle, spends several turns assigning tasks, and only writes it back minutes later — nothing stops another agent or the human from having changed it in between. `ORCHESTRATOR.md` (generated per-project by `lib/generators/orchestrator.js`) bakes in a session-level protocol for exactly that: before writing back to a shared file, the orchestrator re-checks a fingerprint it took when it first read the file; on a mismatch it stops, logs a `CONFLICT` line to `changelog.md`, notifies every affected agent's inbox with a `"type": "conflict"` message, and re-reads + re-applies its change on the current contents instead of overwriting blind. See that file's "🔒 Conflict Detection Protocol" section for the exact steps.

---

## Pilot

Running a small pilot? See [`docs/pilot/PILOT_GUIDE.md`](docs/pilot/PILOT_GUIDE.md) (one workflow, setup, known limitations, how to report bugs), [`docs/pilot/FEEDBACK.md`](docs/pilot/FEEDBACK.md) (daily log, weekly questions, bug template) and [`docs/pilot/WINDOWS_SMOKE_TEST.md`](docs/pilot/WINDOWS_SMOKE_TEST.md) (manual Office checks CI can't cover).

## Acceptance checks

Define named checks in `.claude-team/config.json`, reference them from tasks, and let the CLI be the one thing that runs them:

```json
{ "checks": { "unit": { "command": "npm test", "timeoutSeconds": 120 } } }
```
```json
{ "id": "task-007", "acceptanceCriteria": ["Invalid login returns 401"], "checks": ["unit"] }
```

- **A human approves each command.** `claude-team checks approve unit` shows the exact command and asks; the approval is a hash of the definition, so a new or edited command is refused (`needs approval` / `CHANGED`) until approved again. Approval requires an interactive terminal, which stops accidental or scripted approvals from an agent's shell. **This is a workflow safeguard, not enforced identity:** everything lives in plain files under your user account, so any process running as you (including an agent) that can edit `config.json` and rewrite the hash — or call the code directly — can get around it.
- **`claude-team check <task-id>`** refuses to start if any listed check is undefined or unapproved, otherwise runs each in the task's `workingDir` (must stay inside the project) with its timeout (process tree killed on expiry) and keeps the last 64 KB of output. The orchestrator is instructed to call this when implementation is ready.
- **Evidence, not acceptance.** Results record task ID, command, start/finish time, exit code, timeout flag, git revision and a fingerprint of all uncommitted and untracked changes (ignoring `.claude-team/`). A result is **stale** once the code or the check's definition changes. *Checks passed*, *review* and *approved* are separate facts — a pass never marks a task done.
- **Where it shows:** `claude-team resume` lists check state for unfinished tasks and flags failing or stale ones; the Office task board shows a badge per task; the Office "add task" API accepts `acceptanceCriteria` and `checks` (names must exist in `config.checks`). A "Run checks" button can later call the same code.

## Review queue

Finished work goes through a human decision that is separate from "the agent says it's done" and from "the checks passed":

1. **Request** — `claude-team review request <task-id> -s "what changed"` (the orchestrator is told to do this once an agent reports done and checks have run). It snapshots the agent's explanation and files from its outbox, the acceptance criteria, the check evidence and a code fingerprint into `.claude-team/review-queue/<task-id>.json`, and sets the task to `review`.
2. **Look** — `claude-team review` lists what's waiting; `review show <id>` puts explanation, criteria, check state and the diff in one place. It flags *code changed since requested* and stale/failed checks.
3. **Decide** — `review approve` marks the task done; `review reject -m` sends it back with your note. Both need an interactive terminal, which blocks accidental or scripted approval from an agent's shell. Approval is refused while checks are failed, stale or not run on the current code unless you pass `--accept-unverified` (recorded in the decision). A rejection requires a note, and a task can be re-requested afterwards (history is kept).

Passing checks never approve anything, and approving never rewrites check results. `claude-team resume` lists pending reviews first among next steps; the Office task board has an "Awaiting your review" group. In the Office, the header shows a **👀 N to review** chip and each task in the board's "Awaiting your review" group has a **Review** button that opens the same bundle (explanation, criteria, checks, colour diff) with a note box and Approve (with a confirm step) / Reject buttons. The Office uses the same code and the same rules as the CLI — failed, stale or unrun checks block approval unless you tick "approve anyway", and a rejection needs a note. Decisions made there are recorded as `human (office)`. They require the per-run access key cookie, and no agent session is handed the key.

**What the review trail is — and isn't.** Approvals, rejections, check results and the `decision.by` field are an audit trail for a *workflow*: they show what was recorded and in what order, and the checks above stop the easy mistakes. They are **not proof of who acted**. Agents run as the same OS user as you and can in principle read or edit `.claude-team/` files, run the CLI with a pseudo-terminal, or call the library; the browser cookie only protects the Office from other web pages. If you need a hard boundary, run agents under a separate user or container with no write access to `.claude-team/review-queue/`, `config.json` and `checks/`.

**Approval is tied to what you saw.** The Office panel and the CLI send the request version *and* a fingerprint of the code they displayed; if either changed before you confirm, the approval is refused (`409`) and you reload and review again. If the diff base can't be used (e.g. rewritten history) the review shows an error instead of an empty diff.

**Interrupted decisions.** A decision is recorded first and then applied to the task. If the process dies in between, `claude-team resume` flags it and `claude-team review repair` (`--dry-run` to preview) finishes it — idempotently, only for tasks still in the state the interruption leaves, and it never re-sends feedback an assignee already cleared.

**Concurrent decisions.** Each request has a `requestId`; the pending check and the decision are one locked update, so of several simultaneous approve/reject calls exactly one succeeds and the others get `409`, and a decision made against an out-of-date request is refused (`STALE_REQUEST`).

**What the diff is compared against.** Not current `HEAD` (that hides work an agent already committed). In order: `--base <rev>`; the revision recorded when the Office first assigned the task; the last commit before the task's assignment time (inferred, and labelled as such); otherwise `HEAD`. The review shows the commits since that point. If several agents commit to one checkout, unrelated commits can appear in the list — separate worktrees per agent would remove that.

## Cross-Session Messaging (experimental, opt-in)

Claude Code 2.1.224+ ships `ListAgents`/`SendMessage` tools that let one live session message another directly, instead of writing to a file and waiting for the other side to poll. **Off by default** — enable it with a yes/no question in `init`'s Coordination step. When on, agents' instruction files get guidance to use it for anything time-sensitive (an urgent unblock, a question that'd otherwise sit until the next poll), always *in addition to* — never instead of — the normal inbox/outbox record, since the office UI and any agent that isn't currently live only ever see the files.

**Why it's opt-in:** `ListAgents` isn't scoped to this team, or even to this project — it lists every Claude Code session running on the machine. Verified live: in a two-agent test, one agent's `ListAgents` call surfaced an unrelated session and it briefly (mistakenly) treated it as a possible teammate. The generated instructions tell agents to only act on messages from names matching the actual team roster and to treat anything else as untrusted — but that's a prompt-level safeguard, not a structural one, since the underlying tool has no team-scoping concept. If you'd ever run claude-team alongside other unrelated Claude Code sessions on the same machine, know that those sessions are visible to (and can message, and be messaged by) your team's agents once this is on.

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

**Task board:**
- Click the 📋 task chip in the header to open the board — every task from `master.json` grouped by state (in progress / queued / done / cancelled). Each open task has an assignee dropdown (reassigning moves it between inboxes, so two agents never hold the same work) and a 🚫 Cancel button. Done and cancelled tasks are read-only history.

**"Needs you" indicator:**
- If an agent's terminal is showing a modal waiting on a human (the trust-folder prompt, or Claude Code's onboarding "set up auto mode?" question), its desk gets a pulsing **🔒 needs you** badge and its drawer explains what's blocking it — even though the agent's own self-reported status can't reflect this yet (it hasn't started its turn). Open the drawer's live terminal to answer the prompt directly; the badge clears automatically once you do.

**Desktop notifications:**
- The 🔕/🔔 chip in the header toggles browser notifications: you get pinged when a new question lands in your inbox, an agent becomes blocked/paused, or an agent needs you at a terminal prompt — useful while the office tab is in the background. Uses the browser's Notification permission; nothing is sent anywhere.

**What did it cost?**
- Token chips show an **≈ $ estimate** next to the counts (header team total and per-agent in the drawer), computed from exact token counts at each agent's model's API rates — cache writes at 1.25× and cache reads at 0.1× the input rate. It's the API-equivalent value (on a subscription you don't pay per token); agents on the `default` model are priced as Sonnet.

**Full work history per agent:**
- The completions feed shows the 8 most recent finishes across the team; each agent's drawer now also has a **Completed work** section listing their entire outbox history.
- A completions feed at the bottom shows recent finished work from every agent's outbox.

**Launch agents from the office:**
- Every desk shows the agent's model (OPUS / SONNET / HAIKU / DEFAULT) under its role. Click a desk → pick a model (defaults to whatever's saved) → **▶ Launch agent** starts a real `claude --model <x>` session for that agent in a pseudo-terminal, with the kickoff prompt already sent. The desk gets a green **LIVE** tag, and the chosen model is remembered for next time.
- The drawer shows the agent's **live terminal** (a real interactive session — type into it to approve permission prompts or give instructions), plus a **⏹ Stop** button. If a live agent reports `paused` (token limit hit), a **🔄 Respawn** button appears — it kills the stuck session and starts a fresh one with the same instructions and memory doc.
- Sessions launched from the office end when you close the office (Ctrl+C). Agents you launched manually in your own terminals are untouched — the office only observes them.

**Agents actually keep checking in — not just on paper:** ORCHESTRATOR.md describes a recurring loop ("every N seconds, re-check inboxes and assign tasks"), but a real CLI session doesn't repeat on its own — it does the work it's given and stops. Agents launched from the office now get that loop for real: while a session has been quiet (no output, and nobody's mid-keystroke in its terminal) for at least the project's configured poll interval, the office types a check-in prompt into it — "re-check your inbox/status/outboxes, then continue." This applies to every launched agent, not just the orchestrator, so workers also notice new inbox tasks without a human nudging them. It's on by default and toggleable per agent (**⏸ Pause auto-check** / **🔁 Resume**) in the drawer — pause it if you want to drive an agent by hand. Agents launched in a plain terminal don't get this; they're on their own to re-check, as before.

**Spend limits and idle backoff:** *Your Inbox → Spend limits* (or `limits` in `config.json`) sets optional caps — tokens per agent, tokens for the whole team, and an approximate USD cost for the team — checked against the cumulative office-launched usage. At 80% the desk shows **⚠️ near budget** (and a desktop notification, if enabled); at 100% it shows **⛔ budget reached**, the agent gets no more auto-checks, and launching it is refused until you raise the limit. By default the session is left open so you can see what it was doing (`"action": "pause"`); `"action": "stop"` ends it instead. Pausing stops the auto-check prompts, not a turn already in progress. Limits are off unless you set one, only a human can change them, and they only see office-launched agents (see Known limitations). Separately, when 5 auto-checks in a row find nothing new (no change to any inbox, outbox, queue/master file or `HUMAN_INPUT.md`), the nudge interval doubles each time up to 30 minutes — shown as **🔁 idle, backing off** — and snaps back the moment something changes. Threshold crossings and idle-backoff starts are appended to `.claude-team/logs/guard.log` and shown in `claude-team status`.

```json
"limits": { "agentTokens": 2000000, "teamTokens": 8000000, "teamCostUsd": 25, "action": "pause" }
```

**Hire from the office:**
- The dashed **➕ Hire** desk opens a form (name, role, responsibilities, model). Hiring generates the agent's instruction file, memory doc, and coordination files — same as `claude-team add` — and the new character walks in, ready to launch with the model you picked.

**Fire from the office:**
- Every agent's drawer (except the orchestrator's) has a **🔥 Remove agent** button with an inline confirm step — same as `claude-team remove`. If the agent has a live session launched from the office, it's stopped first; then the character walks out, the desk disappears, and the agent's instruction file and inbox/outbox/status files are deleted.
- **Memory handover**: the fired agent's memory doc isn't deleted — it's archived to `.claude-team/docs/archive/<name>-memory-<date>.md`, and the orchestrator gets a handover note in its inbox (who left, where the memory is archived, how many tasks were requeued). Their unfinished tasks in `master.json` and `queue.json` go back to the queue as `unassigned` for the orchestrator to hand out again; completed tasks keep their history.

**Real token usage, not a guess:** every launched agent's desk shows a compact 🪙 total, and its drawer shows a live "🪙 Tokens used" line — exact `input`/`output`/`cache write`/`cache read` counts, not the self-reported `contextUsedPercent` (which is just the agent's own estimate of how full its context window is; the two measure different things and are both shown). The header also totals it across the whole team for the current office run. This works by correlating the agent's session to the transcript file Claude Code writes for it under `~/.claude/projects/`, so it only applies to agents launched from the office — one launched in a plain terminal has no such correlation and won't show a token count. If the office can't find the transcript within ~20s (rare), the drawer says so instead of showing a wrong number.

**Notes:**
- The server binds to `localhost` only (`http://localhost:4753`, change with `--port`). Never expose it — it can spawn processes.
- Starting the office auto-opens a browser tab; pass `--no-open` to skip that (useful for scripts and restarts, so you don't accumulate tabs).
- The terminal view uses xterm.js from a CDN, so it needs internet; everything else works offline.
- **One Office per project.** A second `claude-team office` in the same project refuses to start and tells you where the first one is running (a crashed Office's lock is cleaned up automatically). This keeps token totals and agent nudging in one place.
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

## Project-folder confinement

`claude-team init` (and every Office launch) makes sure the project's own `.claude/settings.json` carries this policy, so agents work inside the project folder only — nothing depends on your global Claude Code settings. Run `claude-team permissions` to apply it to an existing project, or `claude-team permissions --check` to see what's missing. Your other settings and rules in that file are kept; commit it with the project.

- **`dontAsk` mode** — only pre-approved actions run; everything else is denied on the spot. Agents never sit waiting on a permission prompt, and auto mode's classifier never gets to approve something outside the project. Office launches also pass `--permission-mode dontAsk`.
- **File tools** — edits are allowed inside the project only; reads outside it are blocked (`blockReadsOutsideWorkingDirectories`).
- **Bash** is allowed outright, but only because it runs in Claude Code's OS sandbox: writes confined to the project, reads of your home folder and mounted volumes blocked, no unsandboxed escape hatch, and `failIfUnavailable` so a machine that can't sandbox refuses to start the session rather than run Bash unconfined. Verified with real Haiku agents: `npm test` and `git commit` inside the project work; writes outside (file tool and Bash) and reads of `~/.zshrc` are refused.
- **The `claude-team` command inside the sandbox.** Agents are told to run `claude-team review request …`, but claude-team's own install folder is normally outside the project, so the sandbox would hide it. Applying the policy therefore also writes a launcher at `.claude-team/bin/claude-team` (the Office puts it first on each agent's PATH) and a read-only grant for the install folder in `.claude/settings.local.json` (per-machine, not shared). A node installed under your home folder (nvm, volta…) gets the same grant; other toolchains under `~` (pyenv, cargo…) need their folders added to `sandbox.filesystem.allowRead` in that file. Add `.claude-team/bin/` to `.gitignore`.
- **Agents can't edit** `.claude/` (this policy) or `.claude-team/config.json` (spend limits, check definitions and approvals). Deny rules beat allow rules in every settings scope, so a looser global setting can't reopen them.
- **Caveats:** the Bash sandbox needs macOS, Linux or WSL2 — on native Windows Bash is not sandboxed, so only the file-tool rules apply and Bash commands outside the allowlist are denied rather than prompted. Sandboxed Bash can still read system paths like `/etc` (home folders and mounted volumes are blocked), and new network hosts are denied rather than prompted, so e.g. `npm install` may need a `sandbox.network` allowlist in that file. Your own deny rules and `allow` rules for specific commands (e.g. `Bash(npm test)`) are yours to add.

## Pros, Cons & Limitations

### Pros
- **Everything is plain files.** The whole team — config, instructions, inboxes, statuses, docs — lives in `.claude-team/`. No daemon, no database, no lock-in: commit the folder and team state is versioned; delete it and claude-team is gone without a trace.
- **Works on any project, any language.** Team definitions are markdown and JSON, not code hooks — a Rust repo, a blog, and a Node app all get the same treatment.
- **Real token accounting.** Office-launched agents report exact input/output/cache token counts from Claude Code's own session transcripts, not self-reported estimates.
- **One glance, whole team.** The office shows every agent's status, context bar, current task, and live terminal — plus the questions waiting on you.
- **Project-local by design.** No global npm install, no PATH changes, no shared state between projects.
- **Token budgets on docs** (agent memory 1500, MASTER.md 3000, RULES.md 800) keep agent context lean as the project grows.

### Cons
- **Coordination is file polling.** A few seconds of latency is inherent to that — file writes themselves are lock-protected (see [Concurrency & Locking](#concurrency--locking)), so concurrent writers no longer clobber each other. A multi-file move (reassigning a task between inboxes) still isn't a true atomic transaction, but it's duplicate-safe rather than lossy, and `claude-team status` flags any duplicate it finds for a human to resolve.
- **Cost scales with team size.** Every agent is a full Claude Code session on your subscription — launch the agents you need, not the whole roster.
- **Launched agents live and die with the office.** Ctrl+C on the office stops every session it started (manually-launched agents are unaffected).
- **Some behaviors are heuristics, not guarantees.** The idle auto-check nudge and transcript correlation use sensible timing rules; e.g. two sessions starting in the same second could be matched to the wrong transcript.

### Known limitations
- **The trust-folder prompt (and similar first-run modals) need a human.** The first-ever launch in a new project directory hits Claude Code's one-time "do you trust this folder?" prompt — and, as of Claude Code 2.1.232, a second "set up auto mode?" onboarding modal can also appear mid-session. Either way the session waits until someone answers it in the agent's terminal. The office detects that one of these is showing — it won't type an auto-check nudge into it (a nudge ending in Enter could otherwise silently confirm the modal's default option), and the desk gets a pulsing **🔒 needs you** badge plus a desktop notification if enabled — but deliberately doesn't answer it for you; that's still a human call, made from the desk's live terminal.
- **Cross-session messaging (if enabled) isn't scoped to this team.** See [Cross-Session Messaging](#cross-session-messaging-experimental-opt-in) above — it's off by default for this reason.
- **Token usage only covers office-launched agents.** Sessions you start in your own terminal can't be correlated to a transcript, so their usage never shows up in the totals — and spend limits can't see them either. Limits are checked every few seconds, so an agent mid-turn can overshoot a little, and the dollar figure is an API-equivalent estimate, not your bill.
- **Terminal view needs internet.** xterm.js loads from a CDN; everything else works offline.
- **Single machine, localhost only, no auth.** The office server binds to `127.0.0.1` and must never be exposed — it can spawn processes.
- **Removal doesn't rewrite history.** Firing an agent archives their memory doc and requeues their unfinished tasks, but past outbox entries, changelog lines, and doc mentions of them stay as written.
- **Recovery for `paused` agents is one click, not automatic.** An agent that hits its token limit stays paused until you press 🔄 Respawn in its drawer (or relaunch it yourself) — the office never restarts sessions on its own.

---

## License

MIT
