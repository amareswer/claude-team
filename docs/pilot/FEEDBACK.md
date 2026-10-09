# Pilot feedback

Fill in the daily log as you go (2 minutes), the weekly summary at the end, and a bug report whenever something breaks.

## Setup (once)

| | |
|---|---|
| Name / project type / team size | |
| OS + Node version | |
| Time from "clone" to "first agent working" (minutes) | |
| Setup problems (what, how you got past it) | |
| `node-pty` built? (yes / no → view-only) | |

## Daily log

| Date | Task | Agents launched | **Manual interventions** (things you had to do by hand or fix that the tool should have handled) | **Lost context** (agent forgot/repeated work, `resume` was wrong or unhelpful) | Review outcome (approved / rejected / approved-then-found-a-problem) | Mistake caught in review? (what) | Minutes you spent supervising | Notes |
|---|---|---|---|---|---|---|---|---|
| | | | | | | | | |
| | | | | | | | | |
| | | | | | | | | |

*Count a "manual intervention" every time you edited a tool-managed file, restarted something, copy-pasted context into an agent, or worked around an error.*

## Weekly summary

1. **Did the feature get done?** (yes / partly / no) — roughly how long, compared with doing it your usual way?
2. **Supervision:** did you spend *less* time watching agents than usual? (much less / a bit less / same / more) Why?
3. **Resume:** the morning after, did `claude-team resume` get you back into the work faster? What was missing or wrong?
4. **Review:** did the review screen help you catch something you'd otherwise have merged? Example. Anything you wanted to see and couldn't?
5. **Checks:** did acceptance checks run when they should? Any false confidence ("passed" but wrong) or false alarms?
6. **Trust:** did anything happen that you didn't expect (file changed, task moved, agent did something odd)? Anything you stopped trusting?
7. **Cost/usage:** did agents burn more subscription usage than you expected? Any runaway loop?
8. **Top 3 annoyances**, in order.
9. **Top 1 thing you'd add** — only if you hit the need more than once.
10. **Would you choose to use it again next week without being asked?** (1 = no way … 5 = definitely) — and did you actually choose it on your last day?

## Bug report

```
Title:
What I was doing (command / button):
What I expected:
What happened (exact error text):
Repro steps (smallest you can find):
Environment: OS ___  Node ___  claude-team ___ (claude-team --version)  git commit ___  Claude Code ___
Interactive (Office/terminal) or CLI-only?
Output of `claude-team resume` (redacted):
Is any work lost or stuck right now?  (yes/no — if yes, don't delete .claude-team/, send us a redacted copy first)
```

## Facilitator tally (for whoever runs the pilot)

Per participant: setup minutes · manual interventions/day · lost-context incidents · reviews rejected vs approved-then-regretted · supervision minutes vs their baseline · reliability bugs filed · chose-again (Y/N). **Reliability bugs are fixed immediately; a feature is considered only when ≥2 participants hit the same need independently.**
