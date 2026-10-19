import { describe, it, expect } from 'vitest';
import { newDenials, noteToolEvent, denialsView } from '../lib/denials.js';

const use = (id, name, input) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } });
const result = (id, text, is_error = true) => ({ type: 'user', timestamp: '2026-01-01T00:00:00Z', message: { content: [{ type: 'tool_result', tool_use_id: id, is_error, content: text }] } });
const DENY = "Permission to use Bash has been denied because Claude Code is running in don't ask mode. IMPORTANT: ...";

describe('noteToolEvent', () => {
  it('records a denied call with its tool and command', () => {
    const d = newDenials();
    noteToolEvent(d, use('t1', 'Bash', { command: 'cd x &&\n  echo ===' }));
    const hit = noteToolEvent(d, result('t1', DENY));
    expect(hit).toMatchObject({ tool: 'Bash', detail: 'cd x && echo ===', at: '2026-01-01T00:00:00Z' });
    expect(denialsView(d).count).toBe(1);
  });
  it('uses the file path for Edit/Write denials', () => {
    const d = newDenials();
    noteToolEvent(d, use('t1', 'Write', { file_path: '/etc/x', content: 'secret' }));
    expect(noteToolEvent(d, result('t1', DENY.replace('Bash', 'Write'))).detail).toBe('/etc/x');
  });
  it('ignores ordinary tool errors and successful results', () => {
    const d = newDenials();
    noteToolEvent(d, use('t1', 'Bash', { command: 'false' }));
    expect(noteToolEvent(d, result('t1', 'Exit code 1'))).toBeNull();
    noteToolEvent(d, use('t2', 'Bash', { command: 'ls' }));
    expect(noteToolEvent(d, result('t2', 'ok', false))).toBeNull();
    expect(d.count).toBe(0);
    expect(d.pending.size).toBe(0);
  });
  it('handles array content, unknown tool ids, and non-message events', () => {
    const d = newDenials();
    expect(noteToolEvent(d, { type: 'summary' })).toBeNull();
    const hit = noteToolEvent(d, result('zz', [{ type: 'text', text: DENY }]));
    expect(hit.tool).toBe('unknown');
  });
  it('keeps only the 10 most recent but counts all', () => {
    const d = newDenials();
    for (let i = 0; i < 13; i++) { noteToolEvent(d, use('t' + i, 'Bash', { command: 'c' + i })); noteToolEvent(d, result('t' + i, DENY)); }
    expect(d.count).toBe(13);
    expect(d.recent).toHaveLength(10);
    expect(d.recent[0].detail).toBe('c3');
  });
});
