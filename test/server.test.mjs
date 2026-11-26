import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-'));
let proc, base, token;

before(async () => {
  proc = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: '0', DATA_DIR: dir } });
  const port = await new Promise(r => proc.stdout.on('data', d => { const m = /listening (\d+)/.exec(d); if (m) r(m[1]); }));
  base = `http://127.0.0.1:${port}`;
  token = fs.readFileSync(path.join(dir, 'admin-token.txt'), 'utf8').trim();
});
after(() => { proc.kill(); fs.rmSync(dir, { recursive: true, force: true }); });

const post = (p, body, headers = {}) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('guest enters and shows up in state', async () => {
  const r = await post('/api/guests', { side: 'bride', gender: 'f', name: ' 수아 ', message: '결혼 축하해!' });
  assert.equal(r.status, 201);
  const g = await r.json();
  assert.equal(g.name, '수아');
  const s = await (await fetch(base + '/api/state')).json();
  assert.equal(s.guests.length, 1);
  assert.equal(s.guests[0].side, 'bride');
  assert.deepEqual(s.guests[0].messages, ['결혼 축하해!']);
  assert.equal(s.guests[0].key, undefined); // the secret never leaves in the public state
});

test('only the guest who entered can add more messages', async () => {
  const g = await (await post('/api/guests', { side: 'groom', gender: 'm', name: '도윤', message: '첫 메시지' })).json();
  assert.match(g.key, /^[0-9a-f]{32}$/);
  const url = `/api/guests/${g.id}/messages`;
  assert.equal((await post(url, { message: '남의 것' })).status, 403);
  assert.equal((await post(url, { message: '남의 것' }, { 'x-guest-key': 'f'.repeat(32) })).status, 403);
  const r = await post(url, { message: '두 번째' }, { 'x-guest-key': g.key });
  assert.equal(r.status, 201);
  assert.deepEqual((await r.json()).messages, ['첫 메시지', '두 번째']);
  for (let i = 2; i < 10; i++) assert.equal((await post(url, { message: `${i + 1}` }, { 'x-guest-key': g.key })).status, 201);
  assert.equal((await post(url, { message: '11번째' }, { 'x-guest-key': g.key })).status, 400);
});

test('guest input is validated', async () => {
  assert.equal((await post('/api/guests', { side: 'x', gender: 'f', name: 'a', message: 'b' })).status, 400);
  assert.equal((await post('/api/guests', { side: 'groom', gender: 'm', name: '', message: 'b' })).status, 400);
  assert.equal((await post('/api/guests', { side: 'groom', gender: 'm', name: 'a'.repeat(11), message: 'b' })).status, 400);
});

test('admin endpoints need the token', async () => {
  assert.equal((await fetch(base + '/api/admin/config')).status, 401);
  assert.equal((await fetch(base + '/api/admin/config', { headers: { 'x-admin-token': 'nope' } })).status, 401);
  assert.equal((await fetch(base + '/api/admin/config', { headers: { 'x-admin-token': token } })).status, 200);
});

test('bride and groom greetings need the password and survive a couple update', async () => {
  const url = '/api/couple/bride/greetings';
  assert.equal((await post(url, { message: '와 주셔서 감사해요' })).status, 401);
  assert.equal((await post(url, { message: '와 주셔서 감사해요' }, { 'x-admin-token': 'nope' })).status, 401);
  assert.equal((await post('/api/couple/uncle/greetings', { message: 'x' }, { 'x-admin-token': token })).status, 405);
  const r = await post(url, { message: '와 주셔서 감사해요' }, { 'x-admin-token': token });
  assert.equal(r.status, 201);
  assert.deepEqual((await r.json()).greetings.bride, ['와 주셔서 감사해요']);
  await fetch(base + '/api/admin/couple', { method: 'PUT', headers: { 'x-admin-token': token, 'content-type': 'application/json' },
    body: JSON.stringify({ groom: '명원', bride: '다솜', siteUrl: '' }) });
  const s = await (await fetch(base + '/api/state')).json();
  assert.deepEqual(s.couple.greetings, { groom: [], bride: ['와 주셔서 감사해요'] });
});

test('messages csv needs the admin password and splits the sides', async () => {
  assert.equal((await fetch(base + '/api/admin/messages.csv')).status, 401);
  const g = await (await post('/api/guests', { side: 'groom', gender: 'm', name: '=HYPERLINK', message: '+1 축하' })).json();
  await post(`/api/guests/${g.id}/messages`, { message: '두 번째, "따옴표"' }, { 'x-guest-key': g.key });
  const r = await fetch(base + '/api/admin/messages.csv', { headers: { 'x-admin-token': token } });
  assert.equal(r.status, 200);
  const buf = Buffer.from(await r.arrayBuffer());
  assert.deepEqual([...buf.subarray(0, 3)], [0xef, 0xbb, 0xbf]); // UTF-8 BOM for Excel
  const csv = buf.toString('utf8').slice(1);
  assert.ok(csv.indexOf('"신랑측 (') < csv.indexOf('"신부측 ('));
  assert.ok(csv.includes('"이름","성별","축하 메시지"'));
  // formula defused, quotes doubled, several messages numbered in one cell
  assert.ok(csv.includes(`"'=HYPERLINK","남","1. +1 축하\n2. 두 번째, ""따옴표"""`));
});

test('photo upload checks the file and serves it', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  const h = { 'x-admin-token': token };
  assert.equal((await post('/api/admin/photos', { dataUrl: 'data:image/png;base64,' + Buffer.from('hello').toString('base64') }, h)).status, 400);
  const r = await post('/api/admin/photos', { dataUrl: 'data:image/png;base64,' + png.toString('base64') }, h);
  assert.equal(r.status, 201);
  const s = await (await fetch(base + '/api/state')).json();
  assert.equal(s.photos.length, 1);
  assert.equal((await fetch(base + s.photos[0].src)).status, 200);
  assert.equal((await fetch(base + '/photos/..%2Fadmin-token.txt')).status, 403);
});

test('music is served as audio with byte ranges (iPhone needs them)', async () => {
  const full = await fetch(base + '/music/1-canon-in-d.mp3');
  assert.equal(full.headers.get('content-type'), 'audio/mpeg');
  assert.equal(full.headers.get('accept-ranges'), 'bytes');
  const size = Number(full.headers.get('content-length'));
  await full.arrayBuffer();
  const part = await fetch(base + '/music/1-canon-in-d.mp3', { headers: { range: 'bytes=100-199' } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), `bytes 100-199/${size}`);
  assert.equal((await part.arrayBuffer()).byteLength, 100);
  assert.equal((await fetch(base + '/music/1-canon-in-d.mp3', { headers: { range: `bytes=${size}-` } })).status, 416);
});

test('album likes and comments: guests react, replies stay one level, only the couple deletes', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  const up = await (await post('/api/admin/photos', { dataUrl: 'data:image/png;base64,' + png.toString('base64') }, { 'x-admin-token': token })).json();
  const pid = up.photos.at(-1).id;
  const g = await (await post('/api/guests', { side: 'bride', gender: 'f', name: '하린', message: '축하해' })).json();
  const guest = { 'x-guest-id': g.id, 'x-guest-key': g.key }, bride = { 'x-couple-role': 'bride', 'x-admin-token': token };

  assert.equal((await post(`/api/photos/${pid}/like`, {})).status, 401);
  assert.deepEqual(await (await post(`/api/photos/${pid}/like`, {}, guest)).json(), { likes: 1, liked: true });
  assert.deepEqual(await (await post(`/api/photos/${pid}/like`, {}, bride)).json(), { likes: 2, liked: true });
  assert.deepEqual(await (await post(`/api/photos/${pid}/like`, {}, guest)).json(), { likes: 1, liked: false });

  let list = await (await post(`/api/photos/${pid}/comments`, { text: '너무 예뻐요' }, guest)).json();
  const top = list[0];
  list = await (await post(`/api/photos/${pid}/comments`, { text: '고마워요', parentId: top.id }, bride)).json();
  list = await (await post(`/api/photos/${pid}/comments`, { text: '답글의 답글', parentId: list[1].id }, guest)).json();
  assert.equal(list.length, 3);
  assert.ok(list.slice(1).every(c => c.parentId === top.id)); // reply-to-reply hangs off the top comment
  assert.deepEqual(list[1].by, { role: 'bride' });

  const meta = await (await fetch(`${base}/api/photos/meta?who=c:bride`)).json();
  assert.deepEqual(meta[pid], { likes: 1, comments: 3, liked: true });

  const del = url => fetch(base + url, { method: 'DELETE', headers: guest });
  assert.equal((await del(`/api/photos/${pid}/comments/${top.id}`)).status, 403);
  const after = await fetch(`${base}/api/photos/${pid}/comments/${top.id}`, { method: 'DELETE', headers: bride });
  assert.deepEqual(await after.json(), []); // the comment and its replies are gone
});

test('qr png follows the saved site address', async () => {
  const h = { 'x-admin-token': token, 'content-type': 'application/json' };
  const bad = await fetch(base + '/api/admin/couple', { method: 'PUT', headers: h, body: JSON.stringify({ groom: 'a', bride: 'b', siteUrl: 'javascript:alert(1)' }) });
  assert.equal(bad.status, 400);
  const ok = await fetch(base + '/api/admin/couple', { method: 'PUT', headers: h, body: JSON.stringify({ groom: '명원', bride: '다솜', siteUrl: 'https://example.com/w' }) });
  assert.equal((await ok.json()).guestUrl, 'https://example.com/w');
  const qr = await fetch(base + '/qr.png');
  assert.equal(qr.headers.get('content-type'), 'image/png');
  assert.equal((await qr.arrayBuffer()).byteLength > 1000, true);
});
