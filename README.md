# claude-team# claude-team 🤖

**Multi-agent coordination CLI for Claude Code**  
Build a team of Claude Code instances that collaborate on any project — with automatic role assignment, two-way task coordination, and live status tracking.

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
claude-team init       # 🧙 Answer a few questions, team is generated
claude-team start      # 🚀 See exact commands to launch each agent
claude-team status     # 📊 Check what every agent is working on
```

---

## How It Works

```
claude-team init
```

Asks you:
- Project name, goal, and type
- How many agents and what roles
- Coordination style (queue / parallel / pipeline)
- Whether to use git checkpoints and cross-agent reviews
- An optional starting task

Then generates:

```
your-project/
├── CLAUDE.md                          ← Project overview (auto-read by Claude)
└── .claude-team/
    ├── ORCHESTRATOR.md                ← Orchestrator instructions
    ├── NOTES.md                       ← Shared notes across agents
    ├── config.json                    ← Team config
    ├── agents/
    │   ├── frontend.md                ← Each agent's role + instructions
    │   └── backend.md
    └── tasks/
        ├── master.json                ← Overall task tracker
        ├── queue.json                 ← Unassigned task queue
        ├── orchestrator-inbox.json    ← Messages to orchestrator
        ├── frontend-inbox.json        ← Tasks assigned to frontend
        ├── frontend-outbox.json       ← Work completed by frontend
        ├── frontend-status.json       ← Current status of frontend
        ├── backend-inbox.json
        ├── backend-outbox.json
        └── backend-status.json
```

---

## Two-Way Coordination

Each agent has **three files**:

| File | Direction | Purpose |
|------|-----------|---------|
| `{agent}-inbox.json` | Orchestrator → Agent | Tasks assigned to this agent |
| `{agent}-outbox.json` | Agent → Orchestrator | Completed work and results |
| `{agent}-status.json` | Agent → Everyone | Current status (idle/working/blocked/done) |

Agents can also message each other directly and write to `orchestrator-inbox.json` when blocked.

---

## Launching the Team

After `claude-team init`, open **one terminal per agent**:

```bash
# Terminal 1 — Orchestrator
claude
# Say: "Read CLAUDE.md then .claude-team/ORCHESTRATOR.md and begin coordinating"

# Terminal 2 — Frontend agent
claude  
# Say: "Read CLAUDE.md then .claude-team/agents/frontend.md and start working"

# Terminal 3 — Backend agent
claude
# Say: "Read CLAUDE.md then .claude-team/agents/backend.md and start working"
```

Or run `claude-team start` for the exact launch instructions for your team.

---

## Commands

| Command | Description |
|---------|-------------|
| `claude-team init` | Set up a new team (interactive wizard) |
| `claude-team start` | Print launch instructions for every agent |
| `claude-team status` | Live view of what each agent is doing |
| `claude-team add` | Add a new agent to an existing team |

---

## Reusable Across Projects

This tool is global — run `claude-team init` in any project's root and it generates a fresh team config tailored to that project. Nothing is hard-coded.

---

## Role Suggestions by Project Type

When you pick a project type, `claude-team` suggests appropriate roles:

| Project Type | Suggested Roles |
|---|---|
| Web App | Frontend, Backend, DevOps, QA |
| API / Backend | API Dev, DB Engineer, Security, QA |
| Mobile | UI Dev, Backend, QA, Platform |
| AI / ML | ML Engineer, Data Engineer, API Dev, Eval |
| Monorepo | Architect, Frontend, Backend, DevOps |
| CLI Tool | Core Dev, UX, QA, Docs |

You can always customize or use "Custom" to define your own roles.

---

## License

MIT