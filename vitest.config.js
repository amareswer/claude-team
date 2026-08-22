import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Some tests (generateCoordination writes relative `.claude-team/...`
    // paths) need `process.chdir` into a temp directory. That throws
    // inside a worker_thread, so run test files in child processes instead.
    pool: 'forks',
  },
});
