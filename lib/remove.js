import inquirer from "inquirer";
import chalk from "chalk";
import ora from "ora";
import { requireConfig } from "./config.js";
import { removeAgentFromTeam } from "./add.js";

export async function runRemove() {
  let config;
  try {
    config = await requireConfig();
  } catch (e) {
    console.error(chalk.red(e.message));
    process.exit(1);
  }

  if (!config.agents.length) {
    console.log(chalk.yellow("\n  No agents to remove.\n"));
    return;
  }

  console.log();
  console.log(chalk.cyan.bold("  🔥 Remove an Agent\n"));

  const { name } = await inquirer.prompt([
    {
      type: "select",
      name: "name",
      message: "Which agent?",
      choices: config.agents.map((a) => ({ name: `${a.name} (${a.role})`, value: a.name })),
    },
  ]);

  const { confirm } = await inquirer.prompt([
    {
      type: "confirm",
      name: "confirm",
      message: `Remove "${name}"? Their memory doc is archived and unfinished tasks are requeued; instructions and task files are deleted.`,
      default: false,
    },
  ]);
  if (!confirm) {
    console.log(chalk.dim("  Cancelled."));
    return;
  }

  const spinner = ora("Removing agent...").start();
  try {
    await removeAgentFromTeam(config, name);
    spinner.succeed(chalk.green(`Agent "${name}" removed.`));
  } catch (err) {
    spinner.fail("Failed to remove agent");
    console.error(chalk.red(err.message));
    process.exit(1);
  }
}
