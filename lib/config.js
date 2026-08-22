import fs from "fs-extra";
import { writeJsonLocked } from "./jsonStore.js";

const CONFIG_PATH = ".claude-team/config.json";

export async function saveConfig(config) {
  await fs.ensureDir(".claude-team");
  await writeJsonLocked(CONFIG_PATH, config);
}

export async function loadConfig() {
  if (!(await fs.pathExists(CONFIG_PATH))) {
    return null;
  }
  return fs.readJson(CONFIG_PATH);
}

export async function requireConfig() {
  const config = await loadConfig();
  if (!config) {
    throw new Error(
      "No claude-team config found. Run `claude-team init` first."
    );
  }
  return config;
}
