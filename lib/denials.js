// Tool calls Claude Code refused because the session runs in dontAsk mode —
// read off the session transcript so the Office can show what an agent was
// stopped from doing (otherwise it just looks stuck or gives up).

const DENIED = /has been denied because Claude Code is running in don't ask mode/;
const MAX_RECENT = 10;
const MAX_PENDING = 200;

export const newDenials = () => ({ count: 0, recent: [], pending: new Map() });

const textOf = (content) => (typeof content === 'string' ? content : Array.isArray(content) ? content.map((c) => c?.text || '').join(' ') : '');

export function detailOf(name, input = {}) {
  const raw = name === 'Bash' ? input.command : input.file_path || input.path || input.pattern || input.url || JSON.stringify(input);
  return String(raw ?? '').replace(/\s+/g, ' ').slice(0, 160);
}

/** Feed one parsed transcript event; returns the new denial record, if the event produced one. */
export function noteToolEvent(d, evt) {
  const content = evt?.message?.content;
  if (!Array.isArray(content)) return null;
  let found = null;
  for (const b of content) {
    if (b?.type === 'tool_use' && b.id) {
      d.pending.set(b.id, { tool: b.name, detail: detailOf(b.name, b.input) });
      if (d.pending.size > MAX_PENDING) d.pending.delete(d.pending.keys().next().value);
    } else if (b?.type === 'tool_result' && b.is_error && DENIED.test(textOf(b.content))) {
      const call = d.pending.get(b.tool_use_id) || { tool: 'unknown', detail: '' };
      found = { at: evt.timestamp || new Date().toISOString(), tool: call.tool, detail: call.detail };
      d.count++;
      d.recent.push(found);
      if (d.recent.length > MAX_RECENT) d.recent.shift();
    }
    if (b?.type === 'tool_result') d.pending.delete(b.tool_use_id);
  }
  return found;
}

/** JSON-safe view for /api/state. */
export const denialsView = (d) => ({ count: d.count, recent: d.recent });
