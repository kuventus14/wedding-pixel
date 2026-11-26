import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3120);
const DATA = process.env.DATA_DIR || path.join(ROOT, 'data');
const PHOTOS = path.join(DATA, 'photos');
const STAGE = path.join(DATA, 'stage'); // the three photos on the stage curtain
const DB_FILE = path.join(DATA, 'db.json');
const PUBLIC = path.join(ROOT, 'public');
const FONTS = path.join(ROOT, 'node_modules/galmuri/dist');
const MAX_GUESTS = 1000, MAX_MESSAGES = 10, MAX_GREETINGS = 20, MAX_COMMENTS = 500;

// Two ways to store: files in data/ (running on a computer), or Upstash Redis + Vercel Blob
// (on Vercel, whose disk is read-only and forgets everything between requests).
const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const CLOUD = !!(REDIS_URL && REDIS_TOKEN);
const NO_STORE = !!process.env.VERCEL && !CLOUD; // deployed to Vercel before Redis was connected
const FILES = !CLOUD && !NO_STORE;

// On a host, set ADMIN_TOKEN in its settings — the password must never live in the public repo.
const TOKEN_FILE = path.join(DATA, 'admin-token.txt');
if (FILES) {
  fs.mkdirSync(PHOTOS, { recursive: true });
  if (!process.env.ADMIN_TOKEN && !fs.existsSync(TOKEN_FILE)) fs.writeFileSync(TOKEN_FILE, crypto.randomBytes(12).toString('hex'), { mode: 0o600 });
}
const ADMIN_TOKEN = (process.env.ADMIN_TOKEN || (FILES ? fs.readFileSync(TOKEN_FILE, 'utf8') : '')).trim();
if (!ADMIN_TOKEN) console.warn('ADMIN_TOKEN 이 없어 관리자·신랑신부 기능이 꺼져 있어요');

function normalize(db) {
  // older saves kept one message per guest
  for (const g of db.guests) if (!g.messages) { g.messages = [g.message]; delete g.message; }
  db.couple.greetings ??= { groom: [], bride: [] };
  db.photoMeta ??= {}; // album likes & comments, by photo id
  return db;
}
const fileDb = !FILES ? null : normalize(fs.existsSync(DB_FILE)
  ? JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))
  : { couple: { groom: '신랑', bride: '신부', date: '', siteUrl: '' }, guests: [], photos: [] });

async function redis(...cmd) {
  const r = await fetch(REDIS_URL, { method: 'POST', headers: { Authorization: `Bearer ${REDIS_TOKEN}` }, body: JSON.stringify(cmd) });
  const body = await r.json().catch(() => ({}));
  if (!r.ok || body.error) throw new Error(`redis ${cmd[0]}: ${body.error || r.status}`);
  return body.result;
}
const DB_KEY = 'pw:db', LOCK_KEY = 'pw:lock';
async function loadDb() {
  let raw = await redis('GET', DB_KEY);
  if (raw == null) { // first run on the host: start from the state committed in data/db.json
    await redis('SET', DB_KEY, fs.readFileSync(path.join(ROOT, 'data/db.json'), 'utf8'), 'NX');
    raw = await redis('GET', DB_KEY);
  }
  return normalize(JSON.parse(raw));
}
// One writer at a time across every server instance, so two guests entering together both get saved.
async function locked(fn) {
  const me = crypto.randomUUID(), giveUp = Date.now() + 8000;
  while ((await redis('SET', LOCK_KEY, me, 'NX', 'PX', '10000')) !== 'OK') {
    if (Date.now() > giveUp) throw new HttpError(503, '사람이 많아요. 잠시 후 다시 눌러 주세요');
    await new Promise(r => setTimeout(r, 30 + Math.random() * 70));
  }
  try { return await fn(); }
  finally {
    await redis('EVAL', "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0", '1', LOCK_KEY, me)
      .catch(err => console.error(err));
  }
}
async function save(db) {
  if (CLOUD) return redis('SET', DB_KEY, JSON.stringify(db));
  // write-then-rename so a crash mid-write never leaves a half-written db
  fs.writeFileSync(DB_FILE + '.tmp', JSON.stringify(db));
  fs.renameSync(DB_FILE + '.tmp', DB_FILE);
}

let server; // only when run directly (npm start); on Vercel the handler is called per request
function lanUrl() {
  if (!server) return process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}/` : null;
  for (const list of Object.values(os.networkInterfaces()))
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) return `http://${a.address}:${server.address().port}/`;
  return `http://localhost:${server.address().port}/`;
}
const guestUrl = (db, req) => db.couple.siteUrl || process.env.PUBLIC_URL || lanUrl()
  || `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers['x-forwarded-host'] || req.headers.host}/`; // the address this request came to

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

function readJson(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, '파일이 너무 커요')); req.destroy(); } else chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new HttpError(400, '잘못된 요청이에요')); }
    });
    req.on('error', reject);
  });
}

// trims, strips control chars, enforces length — every user string passes through here
function text(v, max, field, required = true) {
  const s = String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (required && !s) throw new HttpError(400, `${field}을(를) 입력해 주세요`);
  if ([...s].length > max) throw new HttpError(400, `${field}은(는) ${max}자까지 쓸 수 있어요`);
  return s;
}

function sameSecret(given, expected) {
  const t = Buffer.from(String(given || '')), a = Buffer.from(String(expected || ''));
  return a.length > 0 && t.length === a.length && crypto.timingSafeEqual(t, a);
}
const isAdmin = req => sameSecret(req.headers['x-admin-token'], ADMIN_TOKEN);

// who is liking/commenting: the bride or groom (admin password + role) or a guest who entered (id + key)
function actor(req, db) {
  const role = req.headers['x-couple-role'];
  if ((role === 'groom' || role === 'bride') && isAdmin(req)) return { key: `c:${role}`, role };
  const g = db.guests.find(x => x.id === req.headers['x-guest-id']);
  if (g && sameSecret(req.headers['x-guest-key'], g.key)) return { key: `g:${g.id}`, guestId: g.id, name: g.name, side: g.side };
  throw new HttpError(401, '입장한 하객만 남길 수 있어요');
}

const IMAGE_SIG = { jpg: [0xff, 0xd8, 0xff], png: [0x89, 0x50, 0x4e, 0x47], webp: [0x52, 0x49, 0x46, 0x46] };
function decodeImage(dataUrl) {
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw new HttpError(400, 'JPG·PNG·WEBP 사진만 올릴 수 있어요');
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
  const buf = Buffer.from(m[2], 'base64');
  if (!IMAGE_SIG[ext].every((b, i) => buf[i] === b)) throw new HttpError(400, '사진 파일이 아니에요');
  return { ext, buf };
}

const publicGuest = ({ id, side, name, gender, messages, look, createdAt }) => ({ id, side, name, gender, messages, look, createdAt });
const publicState = db => ({
  couple: { groom: db.couple.groom, bride: db.couple.bride, date: db.couple.date, greetings: db.couple.greetings },
  photos: db.photos.map(p => ({ id: p.id, src: p.url || `/photos/${p.file}` })), // url: uploaded to Vercel Blob
  guests: db.guests.map(publicGuest),
});

// Excel-friendly CSV: BOM so Korean opens correctly, one block per side, guest text never runs as a formula
function messagesCsv(db) {
  const cell = v => {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const rows = [];
  for (const [side, label] of [['groom', '신랑측'], ['bride', '신부측']]) {
    const list = db.guests.filter(g => g.side === side);
    rows.push([`${label} (${list.length}명)`], ['이름', '성별', '축하 메시지']);
    for (const g of list) rows.push([g.name, g.gender === 'm' ? '남' : '여',
      g.messages.length > 1 ? g.messages.map((t, i) => `${i + 1}. ${t}`).join('\n') : g.messages[0]]);
    rows.push([]);
  }
  return '﻿' + rows.map(r => r.map(cell).join(',')).join('\r\n');
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg' };

// Byte ranges matter: iPhone Safari won't play audio from a server that can't answer `Range:` requests.
function sendFile(req, res, base, rel) {
  const file = path.join(base, rel);
  if (!file.startsWith(base + path.sep)) throw new HttpError(403, 'forbidden');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('없는 페이지예요'); }
    const head = { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'Accept-Ranges': 'bytes' };
    const r = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (r && (r[1] || r[2])) {
      const start = r[1] ? Number(r[1]) : Math.max(0, st.size - Number(r[2]));
      const end = r[1] && r[2] ? Math.min(Number(r[2]), st.size - 1) : st.size - 1;
      if (start >= st.size || start > end) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
      res.writeHead(206, { ...head, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
      return req.method === 'HEAD' ? res.end() : fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { ...head, 'Content-Length': st.size });
    if (req.method === 'HEAD') res.end(); else fs.createReadStream(file).pipe(res);
  });
}

function json(res, status, body, extra) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
  res.end(JSON.stringify(body));
}

async function route(req, res, db) {
  const url = new URL(req.url, 'http://x');
  const p = decodeURIComponent(url.pathname);
  const m = req.method;

  // Every open phone asks for this every 5 s; on Vercel its CDN answers repeats for 2 s so the
  // database sees a handful of reads instead of hundreds. Writers ask with ?t= for a fresh copy.
  if (m === 'GET' && p === '/api/state')
    return json(res, 200, publicState(db), url.search ? {} : { 'Vercel-CDN-Cache-Control': 'max-age=2, stale-while-revalidate=3' });

  if (m === 'POST' && p === '/api/guests') {
    if (db.guests.length >= MAX_GUESTS) throw new HttpError(429, '방명록이 가득 찼어요');
    const b = await readJson(req, 4096);
    if (!['groom', 'bride'].includes(b.side)) throw new HttpError(400, '신랑측·신부측을 골라 주세요');
    if (!['m', 'f'].includes(b.gender)) throw new HttpError(400, '성별을 골라 주세요');
    const guest = {
      id: crypto.randomUUID(), side: b.side, gender: b.gender,
      name: text(b.name, 10, '이름'), messages: [text(b.message, 80, '축하 메시지')],
      key: crypto.randomBytes(16).toString('hex'), // lets only this guest's phone add more messages
      look: Number.isInteger(b.look) && b.look > 0 && b.look < 2 ** 31 ? b.look : crypto.randomInt(1, 2 ** 31), createdAt: Date.now(),
    };
    db.guests.push(guest); await save(db);
    return json(res, 201, { ...publicGuest(guest), key: guest.key });
  }

  // the bride and groom sign in with the admin password and leave greetings that float over them
  if (m === 'GET' && p === '/api/photos/meta') {
    const who = url.searchParams.get('who') || '';
    return json(res, 200, Object.fromEntries(db.photos.map(ph => {
      const x = db.photoMeta[ph.id];
      return [ph.id, { likes: x?.likes.length ?? 0, comments: x?.comments.length ?? 0, liked: !!who && !!x?.likes.includes(who) }];
    })));
  }

  const pm = /^\/api\/photos\/([0-9a-f-]{36})\/(like|comments)(?:\/([0-9a-f-]{36}))?$/.exec(p);
  if (pm) {
    const [, pid, what, cid] = pm;
    if (!db.photos.some(x => x.id === pid)) throw new HttpError(404, '없는 사진이에요');
    const x = (db.photoMeta[pid] ??= { likes: [], comments: [] });
    const list = () => x.comments.map(({ id, parentId, by, text, createdAt }) => ({ id, parentId, by, text, createdAt }));
    if (what === 'like' && m === 'POST' && !cid) {
      const a = actor(req, db), i = x.likes.indexOf(a.key);
      if (i >= 0) x.likes.splice(i, 1); else x.likes.push(a.key);
      await save(db);
      return json(res, 200, { likes: x.likes.length, liked: i < 0 });
    }
    if (what === 'comments' && m === 'GET' && !cid) return json(res, 200, list());
    if (what === 'comments' && m === 'POST' && !cid) {
      const a = actor(req, db);
      if (x.comments.length >= MAX_COMMENTS) throw new HttpError(400, '댓글이 너무 많아요');
      const b = await readJson(req, 4096);
      let parentId = null;
      if (b.parentId) { // replies stay one level deep, like Instagram
        const parent = x.comments.find(c => c.id === String(b.parentId));
        if (!parent) throw new HttpError(400, '답글을 달 댓글이 없어요');
        parentId = parent.parentId || parent.id;
      }
      x.comments.push({ id: crypto.randomUUID(), parentId, text: text(b.text, 100, '댓글'), createdAt: Date.now(),
        by: a.role ? { role: a.role } : { guestId: a.guestId, name: a.name, side: a.side } });
      await save(db);
      return json(res, 201, list());
    }
    if (what === 'comments' && m === 'DELETE' && cid) {
      if (!actor(req, db).role) throw new HttpError(403, '댓글은 신랑·신부만 지울 수 있어요');
      if (!x.comments.some(c => c.id === cid)) throw new HttpError(404, '없는 댓글이에요');
      x.comments = x.comments.filter(c => c.id !== cid && c.parentId !== cid); // its replies go too
      await save(db);
      return json(res, 200, list());
    }
    throw new HttpError(405, 'method not allowed');
  }

  const greet = /^\/api\/couple\/(groom|bride)\/greetings$/.exec(p);
  if (m === 'POST' && greet) {
    if (!isAdmin(req)) throw new HttpError(401, '비밀번호가 맞지 않아요');
    const list = db.couple.greetings[greet[1]];
    if (list.length >= MAX_GREETINGS) throw new HttpError(400, `인삿말은 ${MAX_GREETINGS}개까지 남길 수 있어요`);
    const b = await readJson(req, 4096);
    list.push(text(b.message, 80, '인삿말')); await save(db);
    return json(res, 201, publicState(db).couple);
  }

  const more = /^\/api\/guests\/([0-9a-f-]{36})\/messages$/.exec(p);
  if (m === 'POST' && more) {
    const guest = db.guests.find(x => x.id === more[1]);
    if (!guest) throw new HttpError(404, '없는 하객이에요');
    if (!sameSecret(req.headers['x-guest-key'], guest.key)) throw new HttpError(403, '내 캐릭터에만 메시지를 더 남길 수 있어요');
    if (guest.messages.length >= MAX_MESSAGES) throw new HttpError(400, `축하 메시지는 ${MAX_MESSAGES}개까지 남길 수 있어요`);
    const b = await readJson(req, 4096);
    guest.messages.push(text(b.message, 80, '축하 메시지')); await save(db);
    return json(res, 201, publicGuest(guest));
  }

  if (m === 'GET' && p === '/qr.png') {
    const png = await QRCode.toBuffer(guestUrl(db, req), { width: 1024, margin: 2, errorCorrectionLevel: 'M' });
    const headers = { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' };
    if (url.searchParams.has('download')) headers['Content-Disposition'] = 'attachment; filename="wedding-qr.png"';
    res.writeHead(200, headers); return res.end(png);
  }

  if (p.startsWith('/api/admin/')) {
    if (!isAdmin(req)) throw new HttpError(401, '관리자 비밀번호가 맞지 않아요');
    const sub = p.slice('/api/admin/'.length);

    if (m === 'GET' && sub === 'messages.csv') {
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store',
        'Content-Disposition': `attachment; filename="messages.csv"; filename*=UTF-8''${encodeURIComponent('축하메시지.csv')}` });
      return res.end(messagesCsv(db));
    }

    if (m === 'GET' && sub === 'config') return json(res, 200, { couple: db.couple, guestUrl: guestUrl(db, req), lanUrl: lanUrl(), cloud: CLOUD, photos: db.photos });

    if (m === 'PUT' && sub === 'couple') {
      const b = await readJson(req, 4096);
      const siteUrl = text(b.siteUrl, 300, '사이트 주소', false);
      if (siteUrl && !/^https?:\/\/\S+$/.test(siteUrl)) throw new HttpError(400, '사이트 주소는 http:// 또는 https:// 로 시작해야 해요');
      db.couple = { ...db.couple, groom: text(b.groom, 10, '신랑 이름'), bride: text(b.bride, 10, '신부 이름'), date: text(b.date, 40, '날짜', false), siteUrl };
      await save(db);
      return json(res, 200, { couple: db.couple, guestUrl: guestUrl(db, req) });
    }

    if (m === 'POST' && sub === 'photos') {
      const b = await readJson(req, 12 * 1024 * 1024);
      const { ext, buf } = decodeImage(b.dataUrl);
      const id = crypto.randomUUID(), photo = { id, file: `${id}.${ext}` };
      if (CLOUD) {
        const { put } = await import('@vercel/blob');
        try { photo.url = (await put(`photos/${photo.file}`, buf, { access: 'public', contentType: TYPES['.' + ext] })).url; }
        catch (err) { console.error(err); throw new HttpError(503, '사진 저장소(Vercel Blob)에 올리지 못했어요. Blob 이 연결됐는지 확인해 주세요'); }
      } else fs.writeFileSync(path.join(PHOTOS, photo.file), buf);
      db.photos.push(photo); await save(db);
      return json(res, 201, { photos: db.photos });
    }

    const del = /^photos\/([0-9a-f-]{36})$/.exec(sub);
    if (m === 'DELETE' && del) {
      const photo = db.photos.find(x => x.id === del[1]);
      if (!photo) throw new HttpError(404, '없는 사진이에요');
      db.photos = db.photos.filter(x => x !== photo); delete db.photoMeta[photo.id]; await save(db);
      // photos that shipped with the repo are static files on Vercel: dropping them from the list is enough
      if (photo.url) await (await import('@vercel/blob')).del(photo.url).catch(err => console.error(err));
      else if (!CLOUD) fs.rm(path.join(PHOTOS, photo.file), () => {});
      return json(res, 200, { photos: db.photos });
    }
    throw new HttpError(404, '없는 요청이에요');
  }

  if (m !== 'GET' && m !== 'HEAD') throw new HttpError(405, 'method not allowed');
  if (p.startsWith('/photos/')) return sendFile(req, res, PHOTOS, p.slice(8));
  if (p.startsWith('/stage/')) return sendFile(req, res, STAGE, p.slice(7));
  if (p.startsWith('/fonts/')) return sendFile(req, res, FONTS, p.slice(7));
  if (p === '/' ) return sendFile(req, res, PUBLIC, 'index.html');
  if (p === '/admin') return sendFile(req, res, PUBLIC, 'admin.html');
  return sendFile(req, res, PUBLIC, p.slice(1));
}

// The request handler: Vercel calls it from api/index.mjs, `npm start` wraps it in a server.
export async function handler(req, res) {
  try {
    if (NO_STORE) throw new HttpError(503, '저장소(Upstash Redis)가 아직 연결되지 않았어요');
    if (!CLOUD) return await route(req, res, fileDb);
    if (req.method === 'GET' || req.method === 'HEAD') return await route(req, res, await loadDb());
    await locked(async () => route(req, res, await loadDb())); // read-change-write while nobody else writes
  } catch (err) {
    if (!(err instanceof HttpError)) console.error(err);
    if (!res.headersSent) json(res, err.status || 500, { error: err instanceof HttpError ? err.message : '서버 오류가 났어요' });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  server = http.createServer(handler);
  server.listen(PORT, '0.0.0.0', () => {
    const port = server.address().port;
    console.log(`listening ${port}${CLOUD ? ' (Redis 저장)' : ''}`);
    console.log(`하객 화면:   http://localhost:${port}/`);
    console.log(`관리자 화면: http://localhost:${port}/admin  (비밀번호: ${ADMIN_TOKEN})`);
  });
}
