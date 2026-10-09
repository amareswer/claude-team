import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Some tests (generateCoordination writes relative `.claude-team/...`
    // paths) need `process.chdir` into a temp directory. That throws
    // inside a worker_thread, so run test files in child processes instead.
    pool: 'forks',
    // File-heavy tests (init writes dozens of files; every shared write takes
    // a lock) run ~6x slower on Windows CI runners than on Linux; the 5s
    // default made them time out there without being wrong.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
