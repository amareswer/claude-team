# claude-team pilot guide

**What we're testing:** can you hand a small feature to a team of Claude Code agents, keep control of what gets accepted, and pick the work back up the next day — with *less* supervision than running agents by hand?

One week. One small real feature. A project you have backed up.

---

## 1. Before you start (≈15 min)

**Back up first.** Agents edit your files with your permissions. Use a **separate git branch** (or a copy of the project) and make sure the work is committed or backed up.

**Don't put the project in a cloud-synced folder** (Dropbox, iCloud Drive, OneDrive). Locks assume a normal local disk.

**You need:** Node.js 20.17+ (or 22.13+/23.5+), git, and Claude Code (`claude`) logged in. Agents use *your* Claude subscription — each launched agent is its own session with its own usage.

**Where this release comes from:** the `main` branch at tag/commit given by whoever sent you this. Clone it somewhere *outside* your project:

```bash
git clone https://github.com/amareswer/claude-team.git
cd claude-team && npm ci          # builds node-pty (needed to launch agents from the Office)
```

If `npm ci` can't build `node-pty` (common on Windows without build tools), carry on — the Office will run in **view-only** mode and you launch agents yourself in terminals (`claude-team start` prints the commands). Note that in your feedback.

In **your project folder** (run everything from there):

```bash
node /path/to/claude-team/bin/claude-team.js init
```

(`claude-team` below means that command. Windows: PowerShell or cmd, same form.)

**Suggested `.gitignore` line:** `.claude-team/` — state files change constantly. `init` adds a managed section to `CLAUDE.md` between `<!-- claude-team:start -->` / `<!-- claude-team:end -->`; your own text there is kept.

**Pick a small team:** the `simple` hierarchy with 2 workers is plenty. Every agent is a separate paid session — don't launch more than the task needs.

## 2. Define one acceptance check (≈5 min)

Open `.claude-team/config.json` and add a `checks` section using a command your project already has (tests, lint, build):

```json
"checks": { "unit": { "command": "npm test", "timeoutSeconds": 120 } }
```

Then approve it yourself, in a real terminal:

```bash
claude-team checks approve unit
```

Anything not approved (or edited afterwards) will refuse to run.

## 3. The one workflow

| Step | Do this | You should see |
|---|---|---|
| **Assign** | `claude-team office` → open the printed link (it contains a private key) → the **You** desk → add a task with a clear "what done looks like". | Task appears on the board. |
| | Ask the orchestrator (or edit `.claude-team/tasks/master.json`) to give the task `"acceptanceCriteria": ["…"], "checks": ["unit"]`. *The Office task form can't set these yet — that's a known gap; tell us how annoying it is.* | |
| **Implement** | Click the agent's desk → **Launch** (or `claude-team start` and use terminals). Watch/steer in the terminal pane. | Agent works; status updates. |
| **Check** | The orchestrator runs `claude-team check <task-id>` when work is ready (or run it yourself). | ✅/❌ per check, saved with exit code + git revision. Never changes task status. |
| **Review** | Agent/orchestrator runs `claude-team review request <task-id> -s "what changed"`. Then in the Office click **👀 N to review**, or `claude-team review show <task-id>`. | One page: explanation, criteria, check evidence, diff. |
| **Decide** | **Approve** (task → done) or **Reject** with a note (task → back to the agent, note in their inbox). | Approval is refused if checks failed/stale unless you tick "approve anyway". |
| **Resume (next day)** | `claude-team resume` | What finished, what's blocked, what waits on you, suggested next steps. |

Useful any time: `claude-team status`, `claude-team review`, `claude-team resume --json`.

## 4. Rules for the pilot

- Read the diff before approving. The tool records decisions; it can't tell whether the code is right.
- Anything you did by hand that the tool should have done — **write it down** (feedback sheet: "manual interventions").
- If something looks wrong, don't fix it silently: note it, then fix it.
- Stop an agent from the Office drawer (or Ctrl+C the terminal); stop the Office with Ctrl+C.

## 5. Known limitations (so you don't have to rediscover them)

- **Approvals and checks are workflow safeguards, not security.** Agents run as you and could edit `.claude-team/` files. The audit trail shows what was recorded, not who really acted.
- **Platforms:** automated tests pass on macOS, Ubuntu and Windows (Node 20.19/22/24). The *Office UI, agent launch and terminal* have been exercised by hand only on macOS. Linux/Windows interactive use is unverified (Windows has its own smoke-test checklist).
- **Office task form** has no fields for acceptance criteria/checks (see step 3).
- **Checks are defined by hand-editing `config.json`**, then approved with the CLI.
- **Review diffs** start from where the task was assigned (recorded or inferred from timestamps). If several agents commit to the same checkout, the diff/commit list can include someone else's work. No per-agent git worktrees yet.
- **Spend limits are opt-in and partial.** Set `limits` in `config.json` (or Your Inbox → Spend limits) to warn at 80% and pause an agent's auto-checks at 100%. They only see office-launched agents, are checked every few seconds (a turn in progress can overshoot), and "$" is an API-equivalent estimate. Idle auto-checks back off automatically. There is no detection of an agent looping *while it is actively working*.
- **Agents are confined to the project folder** by `.claude/settings.json` (written by `init` and at launch; `claude-team permissions --check` to verify). Not confined on native Windows Bash (no OS sandbox), and sandboxed Bash can still read outside the project. See the README section "Project-folder confinement".
- **One Office per project**; token totals are per Office run.
- **A crash can leave a review decision half-applied** → `claude-team resume` will tell you; fix with `claude-team review repair`.
- **Locks are same-machine only** (local disk). A reused process id can make a lock wait until it times out (it fails safe, not unsafe).

## 6. If something breaks

1. Run `claude-team resume` — it lists unreadable state files and interrupted decisions.
2. Note the exact command, what you expected, what happened.
3. File it (see `FEEDBACK.md` → *Bug report*): GitHub issue at **https://github.com/amareswer/claude-team/issues**, or send the filled-in template to whoever invited you. Include `node -v`, OS, `claude-team --version`, and the last ~30 lines of terminal output. **Redact** anything private (paths, secrets, task text) — don't attach whole `.claude-team/` folders.

## 7. Wrap-up (day 5–7)

Fill in the weekly section of `FEEDBACK.md` and send it back. The most useful answer to "would you use it again?" is whether you *did* choose it over doing the work by hand on the last day.
