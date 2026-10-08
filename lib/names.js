// One validator for agent names, shared by `init`, `add`, `remove`, and the
// office API. Names become filesystem path segments, so they must be plain
// slugs; they must also be unique and not collide with the orchestrator or
// a leadership role.

const VALID_AGENT_NAME = /^[a-z0-9-]+$/;

export function normalizeAgentName(name) {
  return String(name || "").trim().toLowerCase().replace(/\s+/g, "-");
}

export function assertSafeAgentName(name) {
  if (!VALID_AGENT_NAME.test(name)) {
    throw Object.assign(
      new Error(`Invalid agent name "${name}" — use only lowercase letters, numbers, and hyphens`),
      { statusCode: 400 }
    );
  }
}

/**
 * Returns an error string, or null if `name` is acceptable. `taken` is the
 * list of names already in use (leadership, other workers, "orchestrator").
 */
export function validateAgentName(name, taken = []) {
  const n = normalizeAgentName(name);
  if (!n) return "Name is required";
  if (!VALID_AGENT_NAME.test(n)) return "Use only lowercase letters, numbers, and hyphens";
  if (n === "orchestrator" || taken.includes(n)) return `The name "${n}" is already taken or reserved`;
  return null;
}
