import chalk from "chalk";
import boxen from "boxen";
import { requireConfig } from "./config.js";
import { checkProjectPermissions } from "./permissions.js";

// Same mode the Office launches agents with: anything the project settings don't pre-approve is denied, not auto-approved.
export const LAUNCH_COMMAND = "claude --permission-mode dontAsk";

export async function runStart() {
  let config;
  try {
    config = await requireConfig();
  } catch (e) {
    console.error(chalk.red(e.message));
    process.exit(1);
  }

  console.log();
  console.log(
    chalk.cyan.bold(`  🚀 Launching Team — ${config.projectName}\n`)
  );
  console.log(
    chalk.dim(
      `  Open ${config.agents.length + 1} terminals and run each command below.\n`
    )
  );

  const perms = await checkProjectPermissions();
  if (!perms.ok) {
    console.log(chalk.yellow("  ⚠️  Project-folder confinement is not fully set up (" + perms.missing.join("; ") + ")."));
    console.log(chalk.dim("  Run: claude-team permissions\n"));
  }
  console.log(chalk.dim("  Claude Code asks once per project whether you trust the folder — answer it before the agent starts working.\n"));

  // Orchestrator
  console.log(
    boxen(
      [
        chalk.white.bold("Terminal 1 — Orchestrator"),
        "",
        chalk.dim("Run:") + "  " + chalk.green(LAUNCH_COMMAND),
        "",
        chalk.dim("Then say:"),
        chalk.yellow(
          `  "Read CLAUDE.md then .claude-team/ORCHESTRATOR.md and begin coordinating the team for: ${config.projectGoal}"`
        ),
      ].join("\n"),
      {
        padding: 1,
        borderColor: "cyan",
        borderStyle: "round",
        margin: { left: 2 },
      }
    )
  );

  console.log();

  // Each agent
  config.agents.forEach((agent, i) => {
    console.log(
      boxen(
        [
          chalk.white.bold(`Terminal ${i + 2} — ${agent.name} (${agent.role})`),
          "",
          chalk.dim("Run:") + "  " + chalk.green(LAUNCH_COMMAND),
          "",
          chalk.dim("Then say:"),
          chalk.yellow(
            `  "Read CLAUDE.md then .claude-team/agents/${agent.name}.md and start working on your assigned tasks"`
          ),
        ].join("\n"),
        {
          padding: 1,
          borderColor: "yellow",
          borderStyle: "round",
          margin: { left: 2 },
        }
      )
    );
    console.log();
  });

  console.log(
    chalk.dim(
      `  Monitor progress anytime with: ${chalk.white("claude-team status")}\n` +
      `  Or watch the team live in your browser: ${chalk.white("claude-team office")}\n`
    )
  );
}