import chalk from "chalk";
import fs from "fs-extra";
import boxen from "boxen";
import { requireConfig } from "./config.js";
import { printBanner } from "./ui.js";

const STATUS_ICONS = {
  idle: "💤",
  working: "⚡",
  blocked: "🚧",
  review_needed: "👀",
  done: "✅",
};

const STATUS_COLORS = {
  idle: chalk.dim,
  working: chalk.green,
  blocked: chalk.red,
  review_needed: chalk.yellow,
  done: chalk.cyan,
};

export async function runStatus() {
  let config;
  try {
    config = await requireConfig();
  } catch (e) {
    console.error(chalk.red(e.message));
    process.exit(1);
  }

  console.log();
  console.log(chalk.cyan.bold(`  📊 Team Status — ${config.projectName}\n`));

  // Read master task list
  let master = null;
  try {
    master = await fs.readJson(".claude-team/tasks/master.json");
  } catch {}

  // Print each agent status
  for (const agent of config.agents) {
    let status = { status: "unknown", currentTaskTitle: null, lastUpdated: null };
    try {
      status = await fs.readJson(`.claude-team/tasks/${agent.name}-status.json`);
    } catch {}

    const icon = STATUS_ICONS[status.status] || "❓";
    const colorFn = STATUS_COLORS[status.status] || chalk.white;
    const taskLine = status.currentTaskTitle
      ? chalk.dim(` → ${status.currentTaskTitle}`)
      : "";
    const blockedLine =
      status.status === "blocked" && status.blockedReason
        ? chalk.red(`\n    ⚠  ${status.blockedReason}`)
        : "";
    const updatedLine = status.lastUpdated
      ? chalk.dim(`\n    Updated: ${new Date(status.lastUpdated).toLocaleTimeString()}`)
      : "";

    console.log(
      `  ${icon}  ${chalk.white.bold(agent.name.padEnd(16))} ${colorFn(
        status.status.padEnd(14)
      )}${taskLine}${blockedLine}${updatedLine}`
    );
    console.log();
  }

  // Task summary
  if (master && master.tasks && master.tasks.length > 0) {
    const total = master.tasks.length;
    const done = master.tasks.filter((t) => t.status === "done").length;
    const inProgress = master.tasks.filter(
      (t) => t.status === "in_progress" || t.status === "assigned"
    ).length;
    const queued = master.tasks.filter(
      (t) => t.status === "queued" || t.status === "not_started"
    ).length;

    console.log(
      boxen(
        [
          chalk.white.bold("Task Overview"),
          "",
          `  ${chalk.green("✅ Done")}        ${done}/${total}`,
          `  ${chalk.yellow("⚡ In Progress")}  ${inProgress}`,
          `  ${chalk.dim("📋 Queued")}      ${queued}`,
          "",
          chalk.dim(`Overall: ${master.overallStatus}`),
        ].join("\n"),
        {
          padding: 1,
          borderColor: "dim",
          borderStyle: "round",
          title: "📋 Tasks",
          titleAlignment: "center",
        }
      )
    );
    console.log();
  }

  // Recent outbox messages
  console.log(chalk.dim("  Recent completions:\n"));
  let found = false;
  for (const agent of config.agents) {
    try {
      const outbox = await fs.readJson(
        `.claude-team/tasks/${agent.name}-outbox.json`
      );
      if (outbox.completedTasks && outbox.completedTasks.length > 0) {
        const recent = outbox.completedTasks.slice(-2);
        for (const task of recent) {
          found = true;
          console.log(
            `  ✅ ${chalk.cyan(agent.name)}  ${task.title}`
          );
          if (task.summary)
            console.log(chalk.dim(`     ${task.summary}`));
        }
      }
    } catch {}
  }

  if (!found) {
    console.log(chalk.dim("  No completed tasks yet."));
  }

  console.log();
}