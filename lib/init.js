import inquirer from "inquirer";
import chalk from "chalk";
import ora from "ora";
import gradient from "gradient-string";
import boxen from "boxen";
import fs from "fs-extra";
import path from "path";
import { generateOrchestratorMd } from "./generators/orchestrator.js";
import { generateAgentMd } from "./generators/agent.js";
import { generateCoordination } from "./generators/coordination.js";
import { generateClaudeMd } from "./generators/claudeMd.js";
import { saveConfig } from "./config.js";
import { printBanner } from "./ui.js";

export async function runInit() {
  printBanner();

  console.log(
    boxen(
      chalk.white(
        "This wizard will configure a team of Claude Code agents\nfor your project. Each agent gets a role, responsibilities,\nand a two-way coordination channel to collaborate.\n\n" +
          chalk.dim("Run this in the root of any project.")
      ),
      {
        padding: 1,
        borderColor: "cyan",
        borderStyle: "round",
        title: "👋 Welcome",
        titleAlignment: "center",
      }
    )
  );

  console.log();

  // ── Step 1: Project basics ──────────────────────────────────────────────
  console.log(chalk.cyan.bold("  Step 1 of 4 — Project Basics\n"));

  const basics = await inquirer.prompt([
    {
      type: "input",
      name: "projectName",
      message: "Project name:",
      default: path.basename(process.cwd()),
      validate: (v) => v.trim().length > 0 || "Please enter a project name",
    },
    {
      type: "input",
      name: "projectGoal",
      message: "What is the main goal of this project?",
      placeholder: "e.g. Build a SaaS dashboard with auth and billing",
      validate: (v) => v.trim().length > 0 || "Please describe the goal",
    },
    {
      type: "list",
      name: "projectType",
      message: "Project type:",
      choices: [
        { name: "🌐  Web Application", value: "web" },
        { name: "⚙️   API / Backend Service", value: "api" },
        { name: "📱  Mobile App", value: "mobile" },
        { name: "🖥️   CLI Tool", value: "cli" },
        { name: "📦  Library / Package", value: "library" },
        { name: "🗂️   Monorepo / Full-Stack", value: "monorepo" },
        { name: "🤖  AI / ML Project", value: "ai" },
        { name: "🔧  Other / Generic", value: "generic" },
      ],
    },
    {
      type: "list",
      name: "techStack",
      message: "Primary tech stack:",
      choices: [
        { name: "Node.js / TypeScript", value: "node-ts" },
        { name: "Python", value: "python" },
        { name: "React / Next.js", value: "react" },
        { name: "Vue / Nuxt", value: "vue" },
        { name: "Go", value: "go" },
        { name: "Rust", value: "rust" },
        { name: "Java / Spring", value: "java" },
        { name: "Ruby on Rails", value: "rails" },
        { name: "Mixed / Other", value: "mixed" },
      ],
    },
  ]);

  // ── Step 2: Team structure ──────────────────────────────────────────────
  console.log();
  console.log(chalk.cyan.bold("  Step 2 of 4 — Team Structure\n"));

  const teamSetup = await inquirer.prompt([
    {
      type: "list",
      name: "teamSize",
      message: "How many agents do you want?",
      choices: [
        { name: "2 agents  — Orchestrator + 1 Worker (minimal)", value: 2 },
        { name: "3 agents  — Orchestrator + 2 Workers (recommended)", value: 3 },
        { name: "4 agents  — Orchestrator + 3 Workers", value: 4 },
        { name: "5 agents  — Orchestrator + 4 Workers (full team)", value: 5 },
        { name: "Custom    — I'll define each role myself", value: "custom" },
      ],
    },
  ]);

  let agents = [];
  const workerCount =
    teamSetup.teamSize === "custom" ? null : teamSetup.teamSize - 1;

  if (teamSetup.teamSize === "custom") {
    // Custom: ask how many workers
    const { customCount } = await inquirer.prompt([
      {
        type: "number",
        name: "customCount",
        message: "How many worker agents (not counting orchestrator)?",
        default: 2,
        validate: (v) => (v >= 1 && v <= 8) || "Choose between 1 and 8",
      },
    ]);

    console.log();
    console.log(
      chalk.dim(
        "  Define each worker agent. Leave role blank to auto-generate.\n"
      )
    );

    for (let i = 0; i < customCount; i++) {
      const agent = await inquirer.prompt([
        {
          type: "input",
          name: "name",
          message: `  Agent ${i + 1} name:`,
          default: `agent-${i + 1}`,
        },
        {
          type: "input",
          name: "role",
          message: `  Agent ${i + 1} role / specialty:`,
          placeholder: "e.g. Frontend Developer, Database Expert",
          validate: (v) => v.trim().length > 0 || "Please enter a role",
        },
        {
          type: "input",
          name: "responsibilities",
          message: `  Agent ${i + 1} key responsibilities (comma separated):`,
          default: "Implement features, Write tests, Fix bugs",
        },
      ]);
      agents.push({
        name: agent.name.toLowerCase().replace(/\s+/g, "-"),
        role: agent.role,
        responsibilities: agent.responsibilities
          .split(",")
          .map((r) => r.trim()),
      });
    }
  } else {
    // Auto-suggest roles based on project type
    const suggestedRoles = getSuggestedRoles(
      basics.projectType,
      basics.techStack,
      workerCount
    );

    console.log();
    console.log(
      chalk.dim(
        `  Based on your project type, here are suggested roles.\n  You can customize each one.\n`
      )
    );

    for (let i = 0; i < workerCount; i++) {
      const suggested = suggestedRoles[i];
      const agent = await inquirer.prompt([
        {
          type: "input",
          name: "name",
          message: `  Agent ${i + 1} name:`,
          default: suggested.name,
        },
        {
          type: "input",
          name: "role",
          message: `  Agent ${i + 1} role:`,
          default: suggested.role,
        },
        {
          type: "input",
          name: "responsibilities",
          message: `  Agent ${i + 1} responsibilities (comma separated):`,
          default: suggested.responsibilities.join(", "),
        },
      ]);
      agents.push({
        name: agent.name.toLowerCase().replace(/\s+/g, "-"),
        role: agent.role,
        responsibilities: agent.responsibilities
          .split(",")
          .map((r) => r.trim()),
      });
    }
  }

  // ── Step 3: Coordination style ──────────────────────────────────────────
  console.log();
  console.log(chalk.cyan.bold("  Step 3 of 4 — Coordination Settings\n"));

  const coordination = await inquirer.prompt([
    {
      type: "list",
      name: "taskStyle",
      message: "How should tasks be structured?",
      choices: [
        {
          name: "📋  Simple queue  — agents pick up tasks one at a time",
          value: "queue",
        },
        {
          name: "🔀  Parallel     — agents work on different tasks simultaneously",
          value: "parallel",
        },
        {
          name: "🔁  Pipeline     — agent output feeds into next agent input",
          value: "pipeline",
        },
      ],
    },
    {
      type: "confirm",
      name: "useGit",
      message: "Use git commits as coordination checkpoints?",
      default: true,
    },
    {
      type: "confirm",
      name: "enableReview",
      message: "Should agents review each other's work before merging?",
      default: true,
    },
    {
      type: "input",
      name: "pollInterval",
      message: "How often should agents check for new tasks? (seconds)",
      default: "10",
      validate: (v) => !isNaN(parseInt(v)) || "Enter a number",
    },
  ]);

  // ── Step 4: Starting task ───────────────────────────────────────────────
  console.log();
  console.log(chalk.cyan.bold("  Step 4 of 4 — First Task\n"));

  const firstTask = await inquirer.prompt([
    {
      type: "confirm",
      name: "addTask",
      message: "Add a starting task for the team right now?",
      default: true,
    },
  ]);

  let initialTask = null;
  if (firstTask.addTask) {
    const taskDetails = await inquirer.prompt([
      {
        type: "input",
        name: "title",
        message: "Task title:",
        validate: (v) => v.trim().length > 0 || "Please enter a title",
      },
      {
        type: "input",
        name: "description",
        message: "Task description:",
        validate: (v) => v.trim().length > 0 || "Please describe the task",
      },
      {
        type: "list",
        name: "priority",
        message: "Priority:",
        choices: ["high", "medium", "low"],
        default: "high",
      },
      {
        type: "list",
        name: "assignTo",
        message: "Assign to:",
        choices: [
          { name: "🎯  Orchestrator (will delegate)", value: "orchestrator" },
          ...agents.map((a) => ({ name: `🤖  ${a.name} (${a.role})`, value: a.name })),
          { name: "🔓  Unassigned (first available agent)", value: "unassigned" },
        ],
      },
    ]);
    initialTask = taskDetails;
  }

  // ── Generate files ──────────────────────────────────────────────────────
  console.log();
  const spinner = ora("Generating team configuration...").start();

  const config = {
    projectName: basics.projectName,
    projectGoal: basics.projectGoal,
    projectType: basics.projectType,
    techStack: basics.techStack,
    agents,
    coordination: {
      taskStyle: coordination.taskStyle,
      useGit: coordination.useGit,
      enableReview: coordination.enableReview,
      pollInterval: parseInt(coordination.pollInterval),
    },
    createdAt: new Date().toISOString(),
  };

  try {
    // Create folder structure
    await fs.ensureDir(".claude-team/agents");
    await fs.ensureDir(".claude-team/tasks");
    await fs.ensureDir(".claude-team/logs");
    await fs.ensureDir(".claude-team/reviews");

    spinner.text = "Writing orchestrator instructions...";
    await fs.writeFile(
      ".claude-team/ORCHESTRATOR.md",
      generateOrchestratorMd(config)
    );

    spinner.text = "Writing agent instructions...";
    for (const agent of agents) {
      await fs.writeFile(
        `.claude-team/agents/${agent.name}.md`,
        generateAgentMd(agent, config)
      );
    }

    spinner.text = "Setting up coordination layer...";
    await generateCoordination(config, initialTask);

    spinner.text = "Writing CLAUDE.md...";
    await fs.writeFile("CLAUDE.md", generateClaudeMd(config));

    spinner.text = "Saving team config...";
    await saveConfig(config);

    spinner.succeed(chalk.green("Team configuration complete!"));
  } catch (err) {
    spinner.fail("Failed to generate configuration");
    console.error(chalk.red(err.message));
    process.exit(1);
  }

  // ── Summary ─────────────────────────────────────────────────────────────
  console.log();
  console.log(
    boxen(
      [
        chalk.white.bold(`🚀  ${basics.projectName} — Team Ready!\n`),
        chalk.dim("Orchestrator  ") + chalk.cyan("ORCHESTRATOR.md"),
        ...agents.map(
          (a) =>
            chalk.dim(`${a.name.padEnd(14)}`) +
            chalk.cyan(`.claude-team/agents/${a.name}.md`)
        ),
        "",
        chalk.dim("Tasks folder  ") + chalk.cyan(".claude-team/tasks/"),
        chalk.dim("Config        ") + chalk.cyan(".claude-team/config.json"),
        chalk.dim("CLAUDE.md     ") + chalk.cyan("CLAUDE.md (project root)"),
        "",
        chalk.white.bold("Next steps:"),
        chalk.yellow("  1.") + "  Open Terminal 1 → run " + chalk.green("claude") + " (orchestrator)",
        chalk.yellow("  2.") + "  Open Terminal 2+ → run " + chalk.green("claude") + " (one per agent)",
        chalk.yellow("  3.") + "  Each agent reads their .md file to know their role",
        chalk.yellow("  4.") + "  Run " + chalk.green("claude-team status") + " to monitor progress",
        "",
        chalk.dim("Or run: ") + chalk.green("claude-team start") + chalk.dim(" for launch instructions"),
      ].join("\n"),
      {
        padding: 1,
        borderColor: "green",
        borderStyle: "round",
        title: "✅ Done",
        titleAlignment: "center",
      }
    )
  );
}

// ── Suggest roles based on project type ────────────────────────────────────
function getSuggestedRoles(projectType, techStack, count) {
  const roleLibrary = {
    web: [
      { name: "frontend", role: "Frontend Developer", responsibilities: ["Build UI components", "Implement styling and layouts", "Handle client-side logic", "Write frontend tests"] },
      { name: "backend", role: "Backend Developer", responsibilities: ["Build APIs and endpoints", "Design database schema", "Handle authentication", "Write server-side tests"] },
      { name: "devops", role: "DevOps Engineer", responsibilities: ["Set up CI/CD pipelines", "Configure deployments", "Manage environment configs", "Monitor performance"] },
      { name: "qa", role: "QA Engineer", responsibilities: ["Write integration tests", "Review code quality", "Test edge cases", "Report bugs"] },
    ],
    api: [
      { name: "api-dev", role: "API Developer", responsibilities: ["Design REST/GraphQL endpoints", "Write route handlers", "Validate request/response schemas", "Document APIs"] },
      { name: "db-engineer", role: "Database Engineer", responsibilities: ["Design data models", "Write migrations", "Optimize queries", "Handle data integrity"] },
      { name: "security", role: "Security Engineer", responsibilities: ["Implement authentication", "Handle authorization", "Audit for vulnerabilities", "Secure sensitive data"] },
      { name: "qa", role: "QA Engineer", responsibilities: ["Write API tests", "Test edge cases", "Validate responses", "Performance testing"] },
    ],
    mobile: [
      { name: "ui-dev", role: "UI Developer", responsibilities: ["Build screens and navigation", "Implement UI components", "Handle animations", "Ensure responsive design"] },
      { name: "backend", role: "Backend Developer", responsibilities: ["Build mobile APIs", "Handle push notifications", "Manage user data", "Sync logic"] },
      { name: "qa", role: "QA Engineer", responsibilities: ["Test on multiple devices", "Check edge cases", "Verify offline behavior", "Test performance"] },
      { name: "platform", role: "Platform Engineer", responsibilities: ["Configure build system", "Handle native modules", "Manage app store setup", "CI/CD pipelines"] },
    ],
    ai: [
      { name: "ml-engineer", role: "ML Engineer", responsibilities: ["Build and train models", "Feature engineering", "Evaluate model performance", "Tune hyperparameters"] },
      { name: "data-engineer", role: "Data Engineer", responsibilities: ["Build data pipelines", "Clean and transform data", "Manage datasets", "Monitor data quality"] },
      { name: "api-dev", role: "API Developer", responsibilities: ["Wrap models in APIs", "Handle inference endpoints", "Manage model versions", "Rate limiting and caching"] },
      { name: "eval", role: "Evaluation Engineer", responsibilities: ["Design eval frameworks", "Track metrics", "A/B testing", "Regression testing"] },
    ],
    monorepo: [
      { name: "architect", role: "Software Architect", responsibilities: ["Design system boundaries", "Define interfaces between packages", "Review cross-cutting concerns", "Ensure consistency"] },
      { name: "frontend", role: "Frontend Developer", responsibilities: ["Build UI packages", "Maintain component library", "Handle web apps", "Write frontend tests"] },
      { name: "backend", role: "Backend Developer", responsibilities: ["Build service packages", "Define shared interfaces", "Handle data layer", "Write backend tests"] },
      { name: "devops", role: "DevOps Engineer", responsibilities: ["Manage monorepo tooling", "Configure CI/CD", "Handle versioning", "Deployment automation"] },
    ],
    cli: [
      { name: "core-dev", role: "Core Developer", responsibilities: ["Build core commands", "Handle argument parsing", "Implement main logic", "Write unit tests"] },
      { name: "ux", role: "UX Developer", responsibilities: ["Design command interfaces", "Implement help text", "Handle errors gracefully", "Add progress indicators"] },
      { name: "qa", role: "QA Engineer", responsibilities: ["Write integration tests", "Test CLI flags and options", "Cross-platform testing", "Document behavior"] },
      { name: "docs", role: "Documentation Engineer", responsibilities: ["Write README and docs", "Create usage examples", "Maintain changelog", "API documentation"] },
    ],
  };

  const fallback = [
    { name: "developer-1", role: "Developer", responsibilities: ["Implement features", "Write tests", "Review code", "Fix bugs"] },
    { name: "developer-2", role: "Developer", responsibilities: ["Implement features", "Write documentation", "Code review", "Refactor"] },
    { name: "reviewer", role: "Code Reviewer", responsibilities: ["Review pull requests", "Ensure code quality", "Check for bugs", "Suggest improvements"] },
    { name: "qa", role: "QA Engineer", responsibilities: ["Write tests", "Find edge cases", "Verify behavior", "Report issues"] },
  ];

  const roles = roleLibrary[projectType] || fallback;
  return roles.slice(0, count);
}