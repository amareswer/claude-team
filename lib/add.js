import inquirer from "inquirer";
import chalk from "chalk";
import ora from "ora";
import fs from "fs-extra";
import { requireConfig, saveConfig } from "./config.js";
import { generateAgentMd } from "./generators/agent.js";

export async function runAdd() {
  let config;
  try {
    config = await requireConfig();
  } catch (e) {
    console.error(chalk.red(e.message));
    process.exit(1);
  }

  console.log();
  console.log(chalk.cyan.bold("  ➕ Add a New Agent\n"));

  const answers = await inquirer.prompt([
    {
      type: "input",
      name: "name",
      message: "Agent name:",
      validate: (v) => {
        if (!v.trim()) return "Name is required";
        if (config.agents.find((a) => a.name === v.trim().toLowerCase().replace(/\s+/g, "-")))
          return "An agent with that name already exists";
        return true;
      },
    },
    {
      type: "input",
      name: "role",
      message: "Agent role / specialty:",
      validate: (v) => v.trim().length > 0 || "Role is required",
    },
    {
      type: "input",
      name: "responsibilities",
      message: "Responsibilities (comma separated):",
      default: "Implement features, Write tests, Fix bugs",
    },
  ]);

  const agent = {
    name: answers.name.toLowerCase().replace(/\s+/g, "-"),
    role: answers.role,
    responsibilities: answers.responsibilities.split(",").map((r) => r.trim()),
  };

  const spinner = ora("Adding agent...").start();

  try {
    // Add to config
    config.agents.push(agent);
    await saveConfig(config);

    // Generate agent md
    await fs.writeFile(
      `.claude-team/agents/${agent.name}.md`,
      generateAgentMd(agent, config)
    );

    // Create inbox/outbox/status
    const now = new Date().toISOString();
    await fs.writeJson(`.claude-team/tasks/${agent.name}-inbox.json`, { tasks: [] }, { spaces: 2 });
    await fs.writeJson(`.claude-team/tasks/${agent.name}-outbox.json`, { completedTasks: [] }, { spaces: 2 });
    await fs.writeJson(
      `.claude-team/tasks/${agent.name}-status.json`,
      { agent: agent.name, role: agent.role, status: "idle", currentTask: null, currentTaskTitle: null, startedAt: null, lastUpdated: now, blockedReason: null },
      { spaces: 2 }
    );

    spinner.succeed(chalk.green(`Agent "${agent.name}" added!`));
    console.log();
    console.log(chalk.dim(`  Instructions: .claude-team/agents/${agent.name}.md`));
    console.log(
      chalk.dim(`  Launch with: `) +
        chalk.yellow(
          `claude → "Read .claude-team/agents/${agent.name}.md and start working"`
        )
    );
    console.log();
  } catch (err) {
    spinner.fail("Failed to add agent");
    console.error(chalk.red(err.message));
    process.exit(1);
  }
}