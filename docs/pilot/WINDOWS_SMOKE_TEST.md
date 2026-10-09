# Windows Office smoke test

CI proves the CLI and the test suite pass on Windows (Node 20.19/22/24). It does **not** prove the interactive parts. Run this once on a real Windows machine (PowerShell *and* cmd if you can) before sending the pilot to Windows users. Record the result of every line — a "fail" is useful information.

**Machine:** Windows ___ · Node ___ · Chrome/Edge ___ · Claude Code ___ · Antivirus ___ · Project path (try one with spaces, e.g. `C:\Users\you\My Projects\demo`) ___

Use a throwaway git repo for this, not a real project.

## A. Install

| # | Step | Expected | Result |
|---|---|---|---|
| A1 | `git clone` + `npm ci` in the claude-team folder | Completes. Note whether `node-pty` built or needed build tools. | |
| A2 | `node <path>\bin\claude-team.js --help` | Lists commands incl. `review`, `check`, `resume` | |
| A3 | In the test repo: `claude-team init` (simple, 2 workers) | `.claude-team\` created; `CLAUDE.md` has the managed block | |

## B. Office + browser access

| # | Step | Expected | Result |
|---|---|---|---|
| B1 | `claude-team office --no-open` | Prints `http://localhost:4753/?key=…` | |
| B2 | Open `http://localhost:4753/` **without** the key | "Unauthorized" message (readable dash, not mojibake) | |
| B3 | Open the full link with the key | Office loads, URL becomes `http://localhost:4753/` | |
| B4 | Open the key link in a second browser profile | Works there too (separate cookie); the first keeps working | |
| B5 | Start a second `claude-team office --port 4800` in the same project | Refuses: "An Office is already running…" | |

## C. Agents and terminal (needs node-pty)

| # | Step | Expected | Result |
|---|---|---|---|
| C1 | Click an agent desk → **Launch** | Terminal pane shows a live `claude` session | |
| C2 | Type in the pane (a short prompt) | Characters appear, the agent responds; arrow keys/backspace work | |
| C3 | Resize the browser window | Terminal reflows | |
| C4 | **Stop** the agent | Session ends; status returns to idle; no stray `claude`/`node` processes in Task Manager | |
| C5 | Launch the same agent again | Starts cleanly | |
| C6 | Close the browser tab, reopen the link | Terminal reattaches to the still-running session (or clearly shows it ended) | |
| C7 | If node-pty is missing: Launch button | Clear "view-only" message, no crash | |

## D. Restart and recovery

| # | Step | Expected | Result |
|---|---|---|---|
| D1 | Ctrl+C the Office | "Office closed"; agents it launched are stopped | |
| D2 | Start the Office again | Starts normally; token totals preserved | |
| D3 | Start the Office, then **End task** its `node.exe` in Task Manager (hard kill), start it again | Starts normally (stale single-instance lock is cleaned up); no leftover `*.lock.*` files blocking | |
| D4 | Hard-kill an agent session mid-task, then `claude-team resume` | Resume still works and shows sensible state | |

## E. Workflow

| # | Step | Expected | Result |
|---|---|---|---|
| E1 | Add `"checks": {"unit": {"command": "node -e \"process.exit(0)\""}}` to `config.json`; `claude-team checks` | Shows "needs approval" | |
| E2 | `claude-team checks approve unit` → answer `n`, then again `y` | `n` leaves it unapproved; `y` approves. (Real console, not piped input.) | |
| E3 | Add a task via the Office; give it `"checks": ["unit"]` in `master.json`; `claude-team check <id>` | ✅ passed; result in `.claude-team\checks\<id>.json` | |
| E4 | Change the check command to `node -e "setTimeout(()=>{},60000)"` with `timeoutSeconds: 2`, approve, run | Reports *timed out* in ≈2–4 s; **no `node.exe` left running** | |
| E5 | `claude-team review request <id> -s "test"`; then Office → **👀 to review** → Review | Panel shows explanation, checks, diff | |
| E6 | Approve with the checks stale (edit a file first) | Refused with a clear message; tick "approve anyway" → approved | |
| E7 | Reject another task with and without a note | Without: blocked. With: task returns, message in the agent's inbox | |
| E8 | `claude-team resume` | Sensible summary; no garbled characters; box-drawing/emoji acceptable in your terminal (note which terminal) | |

## F. Paths and environment

| # | Step | Expected | Result |
|---|---|---|---|
| F1 | Project path with spaces | Everything above still works | |
| F2 | Project on a different drive from Node/claude-team | Works | |
| F3 | Antivirus/Defender real-time scan on | No timeouts or "Timed out waiting for lock" during E3–E7 | |

## Sign-off

Blocking failures (must fix before Windows users join): ___
Non-blocking (document in the pilot guide): ___
Tested by / date: ___
