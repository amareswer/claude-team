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

describe('office task form: criteria and checks', () => {
  let cookie;
  const auth = () => ({ host: `localhost:${PORT}`, 'content-type': 'application/json', cookie, origin: `http://localhost:${PORT}` });
  const post = (p, body) => request({ path: p, method: 'POST', headers: auth() }, JSON.stringify(body));

  beforeAll(async () => {
    const config = await fs.readJson(path.join(dir, '.claude-team/config.json'));
    config.checks = { unit: { command: 'node -e "process.exit(0)"' } };
    config.agents.push({ name: 'project-manager', role: 'Project Manager', responsibilities: ['Plan'], isLeadership: true, model: 'opus' });
    await fs.writeJson(path.join(dir, '.claude-team/config.json'), config);
    const boot = await request({ path: `/?key=${key}`, headers: { host: `localhost:${PORT}` } });
    cookie = boot.headers['set-cookie'][0].split(';')[0];
  });

  it('lists defined checks with their approval state', async () => {
    const state = JSON.parse((await request({ path: '/api/state', headers: auth() })).body);
    expect(state.checks).toEqual([{ name: 'unit', command: 'node -e "process.exit(0)"', approval: 'unapproved' }]);
  });

  it('stores criteria and checks on the new task, and rejects unknown checks', async () => {
    const bad = await post('/api/task', { title: 'T', description: 'D', checks: ['nope'] });
    expect(bad.status).toBe(400);
    const ok = await post('/api/task', { title: 'T', description: 'D', acceptanceCriteria: ['  works ', ''], checks: ['unit'] });
    expect(ok.status).toBe(200);
    const id = JSON.parse(ok.body).id;
    const master = await fs.readJson(path.join(dir, '.claude-team/tasks/master.json'));
    expect(master.tasks.find((t) => t.id === id)).toMatchObject({ acceptanceCriteria: ['works'], checks: ['unit'] });
  });

  it('planner guard: refuses hands-on work for the project manager unless overridden', async () => {
    const coding = { title: 'Data test', description: 'Write the script and a short report.', assignTo: 'project-manager' };
    const refused = await post('/api/task', coding);
    expect(refused.status).toBe(400);
    expect(JSON.parse(refused.body).error).toMatch(/does not do hands-on work/);
    expect((await post('/api/task', { ...coding, assignTo: 'orchestrator' })).status).toBe(200);
    expect((await post('/api/task', { ...coding, allowPlannerWork: true })).status).toBe(200);
    expect((await post('/api/task', { title: 'Plan v1 (no coding)', description: 'Do not write code. Break the goal into tasks.', assignTo: 'project-manager' })).status).toBe(200);
  });

  it('planner guard: refuses reassigning a coding task to the project manager', async () => {
    const made = JSON.parse((await post('/api/task', { title: 'Build the parser', description: 'Implement it.' })).body);
    const refused = await post('/api/taskupdate', { id: made.id, assignTo: 'project-manager' });
    expect(refused.status).toBe(400);
    expect((await post('/api/taskupdate', { id: made.id, assignTo: 'project-manager', allowPlannerWork: true })).status).toBe(200);
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

describe('office spend limits', () => {
  const LPORT = PORT + 10;
  let ldir, lchild, cookie;
  const H = () => ({ host: `localhost:${LPORT}`, 'content-type': 'application/json', cookie, origin: `http://localhost:${LPORT}` });
  const lreq = (opts, body) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: LPORT, ...opts }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
  const post = (p, body) => lreq({ path: p, method: 'POST', headers: H() }, JSON.stringify(body));
  const getState = async () => JSON.parse((await lreq({ path: '/api/state', headers: H() })).body);

  beforeAll(async () => {
    ldir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-team-limits-'));
    await fs.ensureDir(path.join(ldir, '.claude-team/tasks'));
    await fs.ensureDir(path.join(ldir, '.claude-team/logs'));
    await fs.writeJson(path.join(ldir, '.claude-team/config.json'), minimalConfig());
    // backend has used 1.5M tokens in earlier office runs
    await fs.writeJson(path.join(ldir, '.claude-team/logs/token-usage.json'), {
      agents: { backend: { inputTokens: 1_000_000, outputTokens: 500_000, cacheCreationTokens: 0, cacheReadTokens: 0 } },
    });
    lchild = spawn(process.execPath, [bin, 'office', '--port', String(LPORT), '--no-open'], { cwd: ldir });
    let out = '';
    const lkey = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('office did not start: ' + out)), 10000);
      lchild.stdout.on('data', (d) => { out += d; const m = out.match(/\?key=([0-9a-f]+)/); if (m) { clearTimeout(t); resolve(m[1]); } });
    });
    const boot = await lreq({ path: `/?key=${lkey}`, headers: { host: `localhost:${LPORT}` } });
    cookie = boot.headers['set-cookie'][0].split(';')[0];
  }, 15000);

  afterAll(async () => {
    lchild?.kill('SIGINT');
    await new Promise((r) => lchild?.on('exit', r));
    await fs.remove(ldir);
  });

  it('reports no limits and ok levels by default', async () => {
    const s = await getState();
    expect(s.limits).toMatchObject({ agentTokens: null, teamTokens: null, teamCostUsd: null, action: 'pause', active: false });
    expect(s.agents.every((a) => a.guard.level === 'ok')).toBe(true);
    expect(s.agents.find((a) => a.name === 'backend').tokenUsage.costUsd).toBeCloseTo(1 * 3 + 0.5 * 15);
  });

  it('validates limits input', async () => {
    expect((await post('/api/limits', { agentTokens: -1 })).status).toBe(400);
    expect((await post('/api/limits', { teamCostUsd: 'lots' })).status).toBe(400);
    expect((await post('/api/limits', { agentTokens: 10, action: 'explode' })).status).toBe(400);
    expect((await getState()).limits.active).toBe(false);
  });

  it('flags the over-limit agent, logs it, and refuses to launch it', async () => {
    expect((await post('/api/limits', { agentTokens: 1_000_000, action: 'pause' })).status).toBe(200);
    const s = await getState();
    expect(s.limits).toMatchObject({ agentTokens: 1_000_000, active: true });
    expect(s.agents.find((a) => a.name === 'backend').guard.level).toBe('stop');
    expect(s.agents.find((a) => a.name === 'frontend').guard.level).toBe('ok');
    expect(s.guardEvents.at(-1)).toMatchObject({ agent: 'backend', kind: 'budget-stop' });
    if (s.canLaunch) {
      const r = await post('/api/launch', { agent: 'backend' });
      expect(r.status).toBe(409);
      expect(JSON.parse(r.body).error).toMatch(/raise the limit/);
    }
  });

  it('raising the limit clears the stop and logs it; blank clears the limits', async () => {
    await post('/api/limits', { agentTokens: 5_000_000, action: 'pause' });
    let s = await getState();
    expect(s.agents.find((a) => a.name === 'backend').guard.level).toBe('ok');
    expect(s.guardEvents.at(-1)).toMatchObject({ agent: 'backend', kind: 'budget-cleared' });
    await post('/api/limits', { agentTokens: '', teamTokens: '', teamCostUsd: '', action: 'pause' });
    s = await getState();
    expect(s.limits.active).toBe(false);
    expect((await fs.readJson(path.join(ldir, '.claude-team/config.json'))).limits).toBeUndefined();
  });

  it('a team cost limit flags every agent', async () => {
    await post('/api/limits', { teamCostUsd: 5 }); // backend alone is $10.50
    const s = await getState();
    expect(s.guardTeam.level).toBe('stop');
    expect(s.agents.every((a) => a.guard.level === 'stop')).toBe(true);
  });
});
