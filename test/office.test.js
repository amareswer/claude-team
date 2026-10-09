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

describe('office review decisions', () => {
  let cookie;
  const H = (extra = {}) => ({ host: `localhost:${PORT}`, 'content-type': 'application/json', ...extra });
  const post = (p, body, headers) => request({ path: p, method: 'POST', headers: H(headers) }, JSON.stringify(body));

  beforeAll(async () => {
    const { requestReview } = await import('../lib/review.js');
    const t = { id: 'rv-1', title: 'Review me', status: 'in_progress', assignedTo: 'backend' };
    await fs.writeJson(path.join(dir, '.claude-team/tasks/master.json'), { tasks: [{ ...t }, { ...t, id: 'rv-2' }] });
    await fs.writeJson(path.join(dir, '.claude-team/tasks/backend-inbox.json'), { tasks: [], messages: [] });
    const config = await fs.readJson(path.join(dir, '.claude-team/config.json'));
    await requestReview(config, 'rv-1', { summary: 'did it', root: dir });
    await requestReview(config, 'rv-2', { summary: 'did it too', root: dir });
    const boot = await request({ path: `/?key=${key}`, headers: { host: `localhost:${PORT}` } });
    cookie = boot.headers['set-cookie'][0].split(';')[0];
  });

  it('serves the review detail only to an authenticated client', async () => {
    expect((await request({ path: '/api/review?id=rv-1', headers: { host: `localhost:${PORT}` } })).status).toBe(401);
    const r = await request({ path: '/api/review?id=rv-1', headers: H({ cookie }) });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toMatchObject({ taskId: 'rv-1', state: 'pending', summary: 'did it' });
    expect((await request({ path: '/api/review?id=missing', headers: H({ cookie }) })).status).toBe(404);
  });

  it('refuses decisions without the cookie or from a foreign origin, and changes nothing', async () => {
    expect((await post('/api/review/approve', { id: 'rv-1' })).status).toBe(401);
    expect((await post('/api/review/approve', { id: 'rv-1' }, { cookie, origin: 'http://evil.example' })).status).toBe(403);
    const m = await fs.readJson(path.join(dir, '.claude-team/tasks/master.json'));
    expect(m.tasks.find((x) => x.id === 'rv-1').status).toBe('review');
  });

  it('reject needs a note; approve marks done; deciding twice is a 409', async () => {
    const auth = { cookie, origin: `http://localhost:${PORT}` };
    expect((await post('/api/review/reject', { id: 'rv-2', note: '  ' }, auth)).status).toBe(400);
    const rej = await post('/api/review/reject', { id: 'rv-2', note: 'add tests' }, auth);
    expect(rej.status).toBe(200);
    const inbox = await fs.readJson(path.join(dir, '.claude-team/tasks/backend-inbox.json'));
    expect(inbox.messages.at(-1)).toMatchObject({ type: 'review_rejected', taskId: 'rv-2' });

    const ok = await post('/api/review/approve', { id: 'rv-1', note: 'good' }, auth);
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.body).decision.by).toBe('human (office)');
    const m = await fs.readJson(path.join(dir, '.claude-team/tasks/master.json'));
    expect(m.tasks.find((x) => x.id === 'rv-1').status).toBe('done');
    expect(m.tasks.find((x) => x.id === 'rv-2').status).toBe('assigned');
    expect((await post('/api/review/approve', { id: 'rv-1' }, auth)).status).toBe(409);
  });
});

describe('one Office per project', () => {
  const start = (port) => {
    const c = spawn(process.execPath, [bin, 'office', '--port', String(port), '--no-open'], { cwd: dir });
    let out = '', err = '';
    c.stdout.on('data', (d) => (out += d));
    c.stderr.on('data', (d) => (err += d));
    const exited = new Promise((r) => c.on('exit', (code) => r(code)));
    return { c, exited, out: () => out, err: () => err };
  };
  const until = async (fn, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await new Promise((r) => setTimeout(r, 50)); } return false; };

  it('a second Office in the same project refuses to start and points at the first', async () => {
    const second = start(PORT + 1);
    expect(await second.exited).toBe(1);
    expect(second.err()).toMatch(/already running for this project/);
    expect(second.err()).toContain(`http://localhost:${PORT}`);
    expect(second.err()).toContain(`pid ${child.pid}`);
  });

  it('after the first one stops, a new Office can start', async () => {
    child.kill('SIGINT');
    await new Promise((r) => child.on('exit', r));
    const again = start(PORT + 2);
    expect(await until(() => /Office is open/.test(again.out()))).toBe(true);
    again.c.kill('SIGINT');
    await again.exited;
  });
});
