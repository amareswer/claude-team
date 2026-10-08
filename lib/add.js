import inquirer from "inquirer";
import chalk from "chalk";
import ora from "ora";
import fs from "fs-extra";
import { requireConfig, CONFIG_PATH } from "./config.js";
import { assertSafeAgentName, normalizeAgentName, validateAgentName } from "./names.js";
import { generateAgentMd } from "./generators/agent.js";
import { generateAgentDocMd } from "./generators/docs/agentDoc.js";
import { normalizeModel } from "./models.js";
import { updateJson, updateJsonIfExists, writeJsonLocked } from "./jsonStore.js";

// Refresh the caller's in-memory config object from what was just written.
function syncConfig(target, latest) {
  for (const k of Object.keys(target)) delete target[k];
  Object.assign(target, latest);
}

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
        return validateAgentName(v, config.agents.map((a) => a.name)) || true;
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

  const spinner = ora("Adding agent...").start();

  let agent;
  try {
    agent = await addAgentToTeam(config, answers);
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

/**
 * Creates a new worker agent: config entry, instruction file, memory doc,
 * and coordination files. Shared by `claude-team add` and the office UI's
 * hire endpoint. Throws on duplicate names.
 */
export async function addAgentToTeam(config, { name, role, responsibilities, model }) {
  const agent = {
    name: normalizeAgentName(name),
    role: String(role || "").trim(),
    responsibilities: (Array.isArray(responsibilities)
      ? responsibilities
      : String(responsibilities || "Implement features, Write tests").split(","))
      .map((r) => String(r).trim())
      .filter(Boolean),
    isLeadership: false,
    model: normalizeModel(model, false),
  };
  if (!agent.name || !agent.role) throw new Error("Name and role are required");
  assertSafeAgentName(agent.name);
  const nameErr = validateAgentName(agent.name, config.agents.map((a) => a.name));
  if (nameErr) throw Object.assign(new Error(`An agent named "${agent.name}" already exists or is reserved`), { statusCode: 409 });

  // Duplicate check + append happen inside one lock on config.json, against
  // the on-disk copy, so two concurrent hires can't both pass the check or
  // overwrite each other's entry.
  // Create the target dirs first so a failure here can't leave a config entry
  // with no files behind it.
  await fs.ensureDir(".claude-team/agents");
  await fs.ensureDir(".claude-team/docs/agents");
  await fs.ensureDir(".claude-team/tasks");
  const latest = await updateJson(CONFIG_PATH, (doc) => {
    doc.agents = doc.agents || [];
    const err = validateAgentName(agent.name, doc.agents.map((a) => a.name));
    if (err) throw Object.assign(new Error(`An agent named "${agent.name}" already exists or is reserved`), { statusCode: 409 });
    doc.agents.push(agent);
    if (Array.isArray(doc.workerAgents)) doc.workerAgents.push(agent);
  }, () => config);
  syncConfig(config, latest);

  // Generate agent instructions + memory doc
  await fs.writeFile(`.claude-team/agents/${agent.name}.md`, generateAgentMd(agent, config));
  await fs.ensureDir(".claude-team/docs/agents");
  await fs.writeFile(`.claude-team/docs/agents/${agent.name}.md`, generateAgentDocMd(agent, config));

  // Create inbox/outbox/status
  const now = new Date().toISOString();
  await writeJsonLocked(`.claude-team/tasks/${agent.name}-inbox.json`, { tasks: [], messages: [] });
  await writeJsonLocked(`.claude-team/tasks/${agent.name}-outbox.json`, { completedTasks: [] });
  await writeJsonLocked(
    `.claude-team/tasks/${agent.name}-status.json`,
    { agent: agent.name, role: agent.role, status: "idle", currentTask: null, currentTaskTitle: null, currentPhase: null, contextUsedPercent: 0, startedAt: null, lastUpdated: now, blockedReason: null }
  );
  return agent;
}

/**
 * Removes an agent: config entry, instruction file, and coordination files.
 * Their memory doc is archived (not deleted), unfinished tasks are requeued,
 * and the orchestrator gets a handover note in its inbox. Shared by
 * `claude-team remove` and the office UI's remove endpoint. Does not touch
 * a live session — callers must stop it first. Throws if the agent doesn't
 * exist.
 */
export async function removeAgentFromTeam(config, name) {
  const key = normalizeAgentName(name);
  assertSafeAgentName(key);
  let agent;
  const latest = await updateJson(CONFIG_PATH, (doc) => {
    const idx = (doc.agents || []).findIndex((a) => a.name === key);
    if (idx === -1) throw Object.assign(new Error(`No agent named "${key}" found`), { statusCode: 404 });
    [agent] = doc.agents.splice(idx, 1);
    if (Array.isArray(doc.workerAgents)) {
      const wIdx = doc.workerAgents.findIndex((a) => a.name === key);
      if (wIdx !== -1) doc.workerAgents.splice(wIdx, 1);
    }
  }, () => config);
  syncConfig(config, latest);

  await fs.remove(`.claude-team/agents/${key}.md`);
  await fs.remove(`.claude-team/tasks/${key}-inbox.json`);
  await fs.remove(`.claude-team/tasks/${key}-outbox.json`);
  await fs.remove(`.claude-team/tasks/${key}-status.json`);

  // Memory handover: the agent's memory doc is team knowledge — archive it
  // instead of deleting it.
  const memoryDoc = `.claude-team/docs/agents/${key}.md`;
  let archivedTo = null;
  if (await fs.pathExists(memoryDoc)) {
    archivedTo = `.claude-team/docs/archive/${key}-memory-${new Date().toISOString().slice(0, 10)}.md`;
    await fs.ensureDir(".claude-team/docs/archive");
    await fs.move(memoryDoc, archivedTo, { overwrite: true });
  }

  // Requeue the removed agent's unfinished tasks so the orchestrator can
  // reassign them, and drop the agent from master.json's roster mirror.
  const requeuedIds = new Set();
  for (const file of [".claude-team/tasks/master.json", ".claude-team/tasks/queue.json"]) {
    await updateJsonIfExists(file, (doc) => {
      let changed = false;
      for (const t of doc.tasks || []) {
        if (t.assignedTo === key && t.status !== "done") {
          t.assignedTo = "unassigned";
          t.status = "queued";
          requeuedIds.add(t.id);
          changed = true;
        }
      }
      if (Array.isArray(doc.agents) && doc.agents.some((a) => a.name === key)) {
        doc.agents = doc.agents.filter((a) => a.name !== key);
        changed = true;
      }
      if (!changed) return false;
      if ("lastUpdated" in doc) doc.lastUpdated = new Date().toISOString();
    });
  }

  // Handover note so the orchestrator learns about the departure on its
  // next inbox check, instead of discovering a missing agent.
  try {
    const inboxPath = ".claude-team/tasks/orchestrator-inbox.json";
    await updateJson(inboxPath, (inbox) => {
      inbox.messages = inbox.messages || [];
      inbox.messages.push({
        from: "system",
        type: "agent_removed",
        agent: key,
        message: `${key} (${agent.role}) was removed from the team.`
          + (archivedTo ? ` Their memory doc is archived at ${archivedTo} — review it for anything worth folding into MASTER.md or NOTES.md.` : "")
          + (requeuedIds.size ? ` ${requeuedIds.size} unfinished task(s) went back to the queue as unassigned — reassign them.` : ""),
        sentAt: new Date().toISOString(),
      });
    }, { tasks: [], messages: [] });
  } catch {}

  return agent;
}