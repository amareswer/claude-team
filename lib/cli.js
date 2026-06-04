import { Command } from "commander";
import { runInit } from "./init.js";
import { runStart } from "./start.js";
import { runStatus } from "./status.js";
import { runAdd } from "./add.js";

export const program = new Command();

program
  .name("claude-team")
  .description("🤖 Build and launch a team of Claude Code agents for any project")
  .version("1.0.0");

program
  .command("init")
  .description("Set up a new Claude team for this project")
  .action(runInit);

program
  .command("start")
  .description("Launch all agents and start the coordination loop")
  .action(runStart);

program
  .command("status")
  .description("Check what each agent is working on")
  .action(runStatus);

program
  .command("add")
  .description("Add a new agent to an existing team")
  .action(runAdd);