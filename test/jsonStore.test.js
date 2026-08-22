import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { moveTask, reconcileDuplicateTasks } from '../lib/jsonStore.js';
import { withTempCwd } from './helpers.js';

let tmpDirs = [];
async function tmpDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-team-jsonstore-test-'));
  tmpDirs.push(dir);
  return dir;
}
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tmpDirs.map((d) => fs.remove(d)));
  tmpDirs = [];
});

describe('moveTask', () => {
  it('ends with the task in exactly the destination file, not the source', async () => {
    const dir = await tmpDir();
    const fromFile = path.join(dir, 'queue.json');
    const toFile = path.join(dir, 'backend-inbox.json');
    await fs.writeJson(fromFile, { tasks: [{ id: 'task-1', title: 'Ship it', status: 'queued', assignedTo: 'unassigned' }] });
    await fs.writeJson(toFile, { tasks: [] });

    const moved = await moveTask({
      fromFile, toFile, taskId: 'task-1',
      transform: (task) => { task.assignedTo = 'backend'; task.status = 'assigned'; },
    });

    expect(moved.assignedTo).toBe('backend');

    const fromDoc = await fs.readJson(fromFile);
    const toDoc = await fs.readJson(toFile);
    expect(fromDoc.tasks.find((t) => t.id === 'task-1')).toBeUndefined();
    expect(toDoc.tasks.find((t) => t.id === 'task-1')).toBeTruthy();
    expect(toDoc.tasks[0].assignedTo).toBe('backend');
    expect(toDoc.tasks[0].status).toBe('assigned');
  });

  it('applies transform and leaves other tasks in both files untouched', async () => {
    const dir = await tmpDir();
    const fromFile = path.join(dir, 'alice-inbox.json');
    const toFile = path.join(dir, 'bob-inbox.json');
    await fs.writeJson(fromFile, { tasks: [{ id: 'task-1', title: 'A' }, { id: 'task-2', title: 'B' }] });
    await fs.writeJson(toFile, { tasks: [{ id: 'task-3', title: 'C' }] });

    await moveTask({ fromFile, toFile, taskId: 'task-1', transform: (t) => { t.assignedTo = 'bob'; } });

    const fromDoc = await fs.readJson(fromFile);
    const toDoc = await fs.readJson(toFile);
    expect(fromDoc.tasks.map((t) => t.id)).toEqual(['task-2']);
    expect(toDoc.tasks.map((t) => t.id).sort()).toEqual(['task-1', 'task-3']);
  });

  it('throws (TASK_NOT_FOUND) when the task is not in fromFile, and changes nothing', async () => {
    const dir = await tmpDir();
    const fromFile = path.join(dir, 'queue.json');
    const toFile = path.join(dir, 'backend-inbox.json');
    await fs.writeJson(fromFile, { tasks: [] });
    await fs.writeJson(toFile, { tasks: [] });

    await expect(moveTask({ fromFile, toFile, taskId: 'missing' })).rejects.toMatchObject({ code: 'TASK_NOT_FOUND' });
    expect((await fs.readJson(toFile)).tasks).toEqual([]);
  });

  it('a crash between the two writes leaves the task in BOTH files, not neither', async () => {
    const dir = await tmpDir();
    const fromFile = path.join(dir, 'queue.json');
    const toFile = path.join(dir, 'backend-inbox.json');
    await fs.writeJson(fromFile, { tasks: [{ id: 'task-1', title: 'Ship it' }] });
    await fs.writeJson(toFile, { tasks: [] });

    // toFile is written first, fromFile second — simulate the process
    // dying right after the first write by making the second (fromFile)
    // write throw.
    const originalWriteJson = fs.writeJson.bind(fs);
    vi.spyOn(fs, 'writeJson').mockImplementation(async (filePath, data, opts) => {
      if (filePath === fromFile) throw new Error('simulated crash');
      return originalWriteJson(filePath, data, opts);
    });

    await expect(moveTask({ fromFile, toFile, taskId: 'task-1' })).rejects.toThrow('simulated crash');

    vi.restoreAllMocks();
    const fromDoc = await fs.readJson(fromFile);
    const toDoc = await fs.readJson(toFile);
    // Duplicated, not lost: the on-disk fromFile write never happened, so
    // its original copy is still there; toFile's write succeeded first.
    expect(fromDoc.tasks.find((t) => t.id === 'task-1')).toBeTruthy();
    expect(toDoc.tasks.find((t) => t.id === 'task-1')).toBeTruthy();
  });

  it('two concurrent moves crossing the same two files in opposite directions do not deadlock', async () => {
    const dir = await tmpDir();
    const fileA = path.join(dir, 'a-inbox.json');
    const fileB = path.join(dir, 'b-inbox.json');
    await fs.writeJson(fileA, { tasks: [{ id: 'task-a', title: 'lives in A' }] });
    await fs.writeJson(fileB, { tasks: [{ id: 'task-b', title: 'lives in B' }] });

    const DEADLOCK_TIMEOUT_MS = 2000; // comfortably above real work, well below lock.js's own 5s acquire timeout
    const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error('deadlock: moves did not settle in time')), ms));

    const start = Date.now();
    await Promise.race([
      Promise.all([
        moveTask({ fromFile: fileA, toFile: fileB, taskId: 'task-a' }), // A → B
        moveTask({ fromFile: fileB, toFile: fileA, taskId: 'task-b' }), // B → A, opposite direction
      ]),
      timeout(DEADLOCK_TIMEOUT_MS),
    ]);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(DEADLOCK_TIMEOUT_MS);

    // Both moves actually completed (crossed over), not just "didn't hang".
    const docA = await fs.readJson(fileA);
    const docB = await fs.readJson(fileB);
    expect(docA.tasks.map((t) => t.id)).toEqual(['task-b']);
    expect(docB.tasks.map((t) => t.id)).toEqual(['task-a']);
  });

  it('moving within the same file is a no-op relocation (single lock, no self-deadlock)', async () => {
    const dir = await tmpDir();
    const file = path.join(dir, 'queue.json');
    await fs.writeJson(file, { tasks: [{ id: 'task-1', title: 'Ship it', priority: 'low' }] });

    await moveTask({ fromFile: file, toFile: file, taskId: 'task-1', transform: (t) => { t.priority = 'high'; } });

    const doc = await fs.readJson(file);
    expect(doc.tasks).toHaveLength(1);
    expect(doc.tasks[0].priority).toBe('high');
  });
});

describe('reconcileDuplicateTasks', () => {
  function config(names) {
    return { agents: names.map((name) => ({ name })) };
  }

  it('reports no duplicates when every task has exactly one inbox location', async () => {
    await withTempCwd(async () => {
      await fs.ensureDir('.claude-team/tasks');
      await fs.writeJson('.claude-team/tasks/backend-inbox.json', { tasks: [{ id: 'task-1' }] });
      await fs.writeJson('.claude-team/tasks/frontend-inbox.json', { tasks: [{ id: 'task-2' }] });
      await fs.writeJson('.claude-team/tasks/orchestrator-inbox.json', { tasks: [] });

      const duplicates = await reconcileDuplicateTasks(config(['backend', 'frontend']));
      expect(duplicates).toEqual([]);
    });
  });

  it('flags a task ID present in more than one inbox, listing every file it appears in', async () => {
    await withTempCwd(async () => {
      await fs.ensureDir('.claude-team/tasks');
      // The signature an interrupted reassignment leaves behind: still in
      // the old assignee's inbox (fromFile write never happened) as well
      // as the new one (toFile write succeeded).
      await fs.writeJson('.claude-team/tasks/backend-inbox.json', { tasks: [{ id: 'task-1', title: 'Ship it' }] });
      await fs.writeJson('.claude-team/tasks/frontend-inbox.json', { tasks: [{ id: 'task-1', title: 'Ship it' }] });
      await fs.writeJson('.claude-team/tasks/orchestrator-inbox.json', { tasks: [] });

      const duplicates = await reconcileDuplicateTasks(config(['backend', 'frontend']));
      expect(duplicates).toHaveLength(1);
      expect(duplicates[0].taskId).toBe('task-1');
      expect(duplicates[0].files).toEqual(
        expect.arrayContaining(['.claude-team/tasks/backend-inbox.json', '.claude-team/tasks/frontend-inbox.json'])
      );
    });
  });

  it('does not flag master.json or queue.json — both permanently retain every task regardless of assignment', async () => {
    await withTempCwd(async () => {
      await fs.ensureDir('.claude-team/tasks');
      await fs.writeJson('.claude-team/tasks/master.json', { tasks: [{ id: 'task-1' }] });
      await fs.writeJson('.claude-team/tasks/queue.json', { tasks: [{ id: 'task-1' }] });
      await fs.writeJson('.claude-team/tasks/backend-inbox.json', { tasks: [{ id: 'task-1' }] });
      await fs.writeJson('.claude-team/tasks/orchestrator-inbox.json', { tasks: [] });

      const duplicates = await reconcileDuplicateTasks(config(['backend']));
      expect(duplicates).toEqual([]); // only one *inbox* location — not a duplicate
    });
  });
});
