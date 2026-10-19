import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { correlateTranscript, claimedTranscripts } from '../lib/office.js';

const promptFor = (instr) => `Read CLAUDE.md and ${instr}, then start working on your assigned tasks.`;
const session = (name, instr, launchedAt) => ({ name, launchPrompt: promptFor(instr), launchedAt, exited: false, transcriptPath: null, transcriptGaveUp: false });

// A transcript's early lines mention the launch prompt (Claude Code logs it as the first user turn).
const writeTranscript = (file, prompt) => fs.outputFile(file, JSON.stringify({ type: 'user', message: { content: prompt } }) + '\n' + JSON.stringify({ type: 'last-prompt', lastPrompt: prompt }) + '\n');

describe('correlateTranscript', () => {
  let root;
  beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'tx-')); claimedTranscripts.clear(); });
  afterEach(async () => { await fs.remove(root); });

  it('gives two agents launched together their own transcripts, even when the files appear in the opposite order', async () => {
    const now = Date.now();
    // backend's file shows up first on disk, orchestrator's second — creation order must not decide who owns which
    await writeTranscript(path.join(root, 'proj', 'a-backend.jsonl'), promptFor('.claude-team/agents/backend.md'));
    await writeTranscript(path.join(root, 'proj', 'b-orch.jsonl'), promptFor('.claude-team/ORCHESTRATOR.md'));
    const orch = session('orchestrator', '.claude-team/ORCHESTRATOR.md', now - 500);
    const backend = session('backend', '.claude-team/agents/backend.md', now - 400);
    await Promise.all([correlateTranscript(orch, root), correlateTranscript(backend, root)]);
    expect(path.basename(orch.transcriptPath)).toBe('b-orch.jsonl');
    expect(path.basename(backend.transcriptPath)).toBe('a-backend.jsonl');
  });

  it('never gives one transcript to two sessions', async () => {
    const now = Date.now();
    await writeTranscript(path.join(root, 'p', 'x.jsonl'), promptFor('.claude-team/agents/backend.md'));
    const s1 = session('backend', '.claude-team/agents/backend.md', now - 500);
    const s2 = session('backend', '.claude-team/agents/backend.md', now - 500); // e.g. a respawn racing the old session
    await Promise.all([correlateTranscript(s1, root), correlateTranscript(s2, root)]);
    expect([s1.transcriptPath, s2.transcriptPath].filter(Boolean)).toHaveLength(1);
  });

  it('waits (does not guess) when no transcript mentions the launch prompt yet', async () => {
    const now = Date.now();
    await writeTranscript(path.join(root, 'p', 'other.jsonl'), promptFor('.claude-team/agents/frontend.md'));
    const s = session('backend', '.claude-team/agents/backend.md', now - 500);
    await correlateTranscript(s, root);
    expect(s.transcriptPath).toBeNull();
    expect(s.transcriptGaveUp).toBe(false);
    await writeTranscript(path.join(root, 'p', 'mine.jsonl'), promptFor('.claude-team/agents/backend.md'));
    await correlateTranscript(s, root);
    expect(path.basename(s.transcriptPath)).toBe('mine.jsonl');
  });

  it('ignores transcripts that existed before the launch', async () => {
    const f = path.join(root, 'p', 'old.jsonl');
    await writeTranscript(f, promptFor('.claude-team/agents/backend.md'));
    const s = session('backend', '.claude-team/agents/backend.md', Date.now() + 60_000);
    await correlateTranscript(s, root);
    expect(s.transcriptPath).toBeNull();
  });

  it('gives up after the timeout with no match', async () => {
    const s = session('backend', '.claude-team/agents/backend.md', Date.now() - 120_000);
    await correlateTranscript(s, root);
    expect(s.transcriptGaveUp).toBe(true);
  });
});
