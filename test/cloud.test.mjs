// The Vercel setup: data lives in Redis (Upstash REST API), not in files.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// A stand-in for Upstash's REST API with just the commands the server uses.
const store = new Map(); // key -> { v, exp }
const live = k => { const e = store.get(k); if (e?.exp && e.exp < Date.now()) store.delete(k); return store.get(k); };
const fake = http.createServer(async (req, res) => {
  let body = ''; for await (const c of req) body += c;
  const reply = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
  if (req.headers.authorization !== 'Bearer test-token') return reply(401, { error: 'unauthorized' });
  const [cmd, ...a] = JSON.parse(body);
  if (cmd === 'GET') return reply(200, { result: live(a[0])?.v ?? null });
  if (cmd === 'SET') {
    if (a.includes('NX') && live(a[0])) return reply(200, { result: null });
    const px = a.indexOf('PX');
    store.set(a[0], { v: a[1], exp: px > 0 ? Date.now() + Number(a[px + 1]) : 0 });
    return reply(200, { result: 'OK' });
  }
  if (cmd === 'EVAL') { // the unlock script: delete the key only if it still holds our value
    const [, , key, val] = a;
    if (live(key)?.v === val) { store.delete(key); return reply(200, { result: 1 }); }
    return reply(200, { result: 0 });
  }
  reply(400, { error: `unknown command ${cmd}` });
});

const seedFile = new URL('../data/db.json', import.meta.url);
const seedBefore = fs.readFileSync(seedFile, 'utf8');
const seed = JSON.parse(seedBefore);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-cloud-'));
let proc, base;

before(async () => {
  await new Promise(r => fake.listen(0, '127.0.0.1', r));
  proc = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: '0', DATA_DIR: dir, ADMIN_TOKEN: 'pw-test',
    KV_REST_API_URL: `http://127.0.0.1:${fake.address().port}`, KV_REST_API_TOKEN: 'test-token', BLOB_READ_WRITE_TOKEN: '' } });
  const port = await new Promise(r => proc.stdout.on('data', d => { const m = /listening (\d+)/.exec(d); if (m) r(m[1]); }));
  base = `http://127.0.0.1:${port}`;
});
after(() => { proc.kill(); fake.close(); fs.rmSync(dir, { recursive: true, force: true }); });

const post = (p, body, headers = {}) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('first run starts from the committed data/db.json, and the CDN may hold the state for 2 s', async () => {
  const r = await fetch(base + '/api/state');
  const s = await r.json();
  assert.equal(s.guests.length, seed.guests.length);
  assert.deepEqual(s.photos.map(p => p.src), seed.photos.map(p => `/photos/${p.file}`)); // shipped photos stay static files
  assert.match(r.headers.get('vercel-cdn-cache-control'), /max-age=2/);
  assert.equal((await fetch(base + '/api/state?t=1')).headers.get('vercel-cdn-cache-control'), null); // writers read fresh
});

test('guests entering at the same moment are all saved', async () => {
  const rs = await Promise.all(Array.from({ length: 25 }, (_, i) =>
    post('/api/guests', { side: i % 2 ? 'groom' : 'bride', gender: 'f', name: `동시${i}`, message: '축하해요' })));
  assert.deepEqual(rs.map(r => r.status), Array(25).fill(201));
  const s = await (await fetch(base + '/api/state?t=2')).json();
  assert.equal(s.guests.length, seed.guests.length + 25);
  assert.equal(live('pw:lock'), undefined); // the lock is let go
});

test('the password comes from ADMIN_TOKEN, and greetings and likes are kept', async () => {
  assert.equal((await fetch(base + '/api/admin/config', { headers: { 'x-admin-token': 'nope' } })).status, 401);
  const cfg = await (await fetch(base + '/api/admin/config', { headers: { 'x-admin-token': 'pw-test' } })).json();
  assert.equal(cfg.cloud, true);
  assert.equal((await post('/api/couple/bride/greetings', { message: '와 주셔서 고마워요' }, { 'x-admin-token': 'pw-test' })).status, 201);
  const bride = { 'x-couple-role': 'bride', 'x-admin-token': 'pw-test' };
  const pid = seed.photos[0].id;
  assert.deepEqual(await (await post(`/api/photos/${pid}/like`, {}, bride)).json(), { likes: 1, liked: true });
  const s = await (await fetch(base + '/api/state?t=3')).json();
  assert.equal(s.couple.greetings.bride.at(-1), '와 주셔서 고마워요');
  const meta = await (await fetch(`${base}/api/photos/meta?who=c:bride`)).json();
  assert.deepEqual(meta[pid], { likes: 1, comments: 0, liked: true });
});

test('a photo upload without Blob connected says so, changes nothing and frees the lock', async () => {
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const r = await post('/api/admin/photos', { dataUrl: 'data:image/png;base64,' + png }, { 'x-admin-token': 'pw-test' });
  assert.equal(r.status, 503);
  assert.equal((await (await fetch(base + '/api/state?t=4')).json()).photos.length, seed.photos.length);
  assert.equal((await post('/api/guests', { side: 'groom', gender: 'm', name: '다음', message: '됩니다' })).status, 201);
});

test('nothing is written to files in this mode', () => {
  assert.equal(fs.readFileSync(seedFile, 'utf8'), seedBefore);
  assert.deepEqual(fs.readdirSync(dir), []);
});
