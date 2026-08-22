import { describe, it, expect } from 'vitest';
import fs from 'fs-extra';
import { generateCoordination } from '../../lib/generators/coordination.js';
import { minimalConfig, withTempCwd } from '../helpers.js';

describe('generateCoordination', () => {
  it('creates a valid inbox/outbox/status triplet per agent', async () => {
    await withTempCwd(async () => {
      const config = minimalConfig();
      await generateCoordination(config, null);

      for (const agent of config.agents) {
        const inbox = await fs.readJson(`.claude-team/tasks/${agent.name}-inbox.json`);
        expect(inbox).toEqual({ tasks: [], messages: [] });

        const outbox = await fs.readJson(`.claude-team/tasks/${agent.name}-outbox.json`);
        expect(outbox).toEqual({ completedTasks: [] });

        const status = await fs.readJson(`.claude-team/tasks/${agent.name}-status.json`);
        expect(status.agent).toBe(agent.name);
        expect(status.role).toBe(agent.role);
        expect(status.status).toBe('idle');
      }
    });
  });

  it('creates valid queue.json and master.json', async () => {
    await withTempCwd(async () => {
      const config = minimalConfig();
      await generateCoordination(config, null);

      const queue = await fs.readJson('.claude-team/tasks/queue.json');
      expect(queue).toEqual({ tasks: [] });

      const master = await fs.readJson('.claude-team/tasks/master.json');
      expect(master.projectName).toBe(config.projectName);
      expect(master.projectGoal).toBe(config.projectGoal);
      expect(master.tasks).toEqual([]);
      expect(master.agents.map((a) => a.name)).toEqual(config.agents.map((a) => a.name));
    });
  });

  it('delivers an initial task assigned to a real agent straight to their inbox', async () => {
    await withTempCwd(async () => {
      const config = minimalConfig();
      const initialTask = {
        title: 'Set up CI',
        description: 'Add a GitHub Actions workflow',
        priority: 'high',
        assignTo: 'backend',
      };
      await generateCoordination(config, initialTask);

      const inbox = await fs.readJson('.claude-team/tasks/backend-inbox.json');
      expect(inbox.tasks).toHaveLength(1);
      expect(inbox.tasks[0].title).toBe('Set up CI');
      expect(inbox.tasks[0].status).toBe('assigned');

      const master = await fs.readJson('.claude-team/tasks/master.json');
      expect(master.tasks).toHaveLength(1);
      expect(master.tasks[0].assignedTo).toBe('backend');

      // Not delivered to an unrelated agent's inbox
      const otherInbox = await fs.readJson('.claude-team/tasks/frontend-inbox.json');
      expect(otherInbox.tasks).toEqual([]);
    });
  });

  it('leaves an initial task unassigned in the queue when not assigned to a real agent', async () => {
    await withTempCwd(async () => {
      const config = minimalConfig();
      const initialTask = {
        title: 'Decide on hosting',
        description: 'Compare providers',
        priority: 'medium',
        assignTo: 'unassigned',
      };
      await generateCoordination(config, initialTask);

      const master = await fs.readJson('.claude-team/tasks/master.json');
      expect(master.tasks[0].status).toBe('queued');
      expect(master.tasks[0].assignedTo).toBe('unassigned');
    });
  });

  it('creates special-role inboxes only for roles that do not already have one', async () => {
    await withTempCwd(async () => {
      const config = minimalConfig();
      await generateCoordination(config, null);

      // orchestrator-inbox.json is a special role, not in config.agents
      const orchestratorInbox = await fs.readJson('.claude-team/tasks/orchestrator-inbox.json');
      expect(orchestratorInbox).toEqual({ tasks: [], messages: [] });
    });
  });
});
