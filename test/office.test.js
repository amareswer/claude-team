import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import http from 'http';
import { spawn } from 'child_process';
import WebSocket from 'ws';
import { minimalConfig } from './helpers.js';
import { createOfficeAuth } from '../lib/officeAuth.js';

const PORT = 47531;
const bin = path.resolve('bin/claude-team.js');
let dir, child, key;

function request(opts, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, ...opts }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-team-office-'));
  await fs.ensureDir(path.join(dir, '.claude-team/tasks'));
  await fs.writeJson(path.join(dir, '.claude-team/config.json'), minimalConfig());
  child = spawn(process.execPath, [bin, 'office', '--port', String(PORT), '--no-open'], { cwd: dir });
  let out = '';
  key = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('office did not start: ' + out)), 10000);
    child.stdout.on('data', (d) => {
      out += d;
      const m = out.match(/\?key=([0-9a-f]+)/);
      if (m) { clearTimeout(t); resolve(m[1]); }
    });
  });
}, 15000);

afterAll(async () => {
  child?.kill('SIGINT');
  await fs.remove(dir);
});

describe('office access control', () => {
  it('rejects unauthenticated API requests', async () => {
    const r = await request({ path: '/api/state', headers: { host: `localhost:${PORT}` } });
    expect(r.status).toBe(401);
  });

  it('rejects a wrong key and a spoofed Host header', async () => {
    expect((await request({ path: '/?key=nope', headers: { host: `localhost:${PORT}` } })).status).toBe(403);
    expect((await request({ path: `/?key=${key}`, headers: { host: 'evil.example' } })).status).toBe(403);
  });

  it('exchanges the key for a cookie, then serves the API', async () => {
    const boot = await request({ path: `/?key=${key}`, headers: { host: `localhost:${PORT}` } });
    expect(boot.status).toBe(302);
    const cookie = boot.headers['set-cookie'][0].split(';')[0];
    expect(boot.headers['set-cookie'][0]).toMatch(/HttpOnly; SameSite=Strict/);
    const ok = await request({ path: '/api/state', headers: { host: `localhost:${PORT}`, cookie } });
    expect(ok.status).toBe(200);
    // cross-site POST with valid cookie is still refused
    const csrf = await request(
      { path: '/api/stop', method: 'POST', headers: { host: `localhost:${PORT}`, cookie, origin: 'http://evil.example', 'content-type': 'application/json' } },
      '{"agent":"x"}'
    );
    expect(csrf.status).toBe(403);
  });

  it('refuses WebSocket upgrades without a cookie or with a foreign Origin', async () => {
    const attempt = (headers) => new Promise((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${PORT}/term?agent=orchestrator`, { headers });
      ws.on('open', () => { ws.close(); resolve('open'); });
      ws.on('error', () => resolve('rejected'));
      ws.on('unexpected-response', () => resolve('rejected'));
    });
    expect(await attempt({ origin: `http://localhost:${PORT}` })).toBe('rejected');
    const boot = await request({ path: `/?key=${key}`, headers: { host: `localhost:${PORT}` } });
    const cookie = boot.headers['set-cookie'][0].split(';')[0];
    expect(await attempt({ cookie, origin: 'http://evil.example' })).toBe('rejected');
  });
});

describe('createOfficeAuth', () => {
  it('generates distinct secrets per run', () => {
    expect(createOfficeAuth(1).secret).not.toBe(createOfficeAuth(1).secret);
  });
});
