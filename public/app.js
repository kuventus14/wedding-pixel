import { W, H, DOOR, ENTRY, COUPLE, CANDLES, STAGE_PHOTOS, drawBackground, buildProps, isBlocked } from './hallmap.js';
import { lookFor, sprite, spriteDataUrl, SPRITE_W, SPRITE_H } from './sprites.js';

const $ = s => document.querySelector(s);
const cv = $('#hall'), g = cv.getContext('2d');
const SIDE = { groom: { label: '신랑측', color: '#8FB4FF' }, bride: { label: '신부측', color: '#FF9DB8' } };
const IDLE_MS = 60_000;   // my character starts wandering after a minute without a tap
const SAY_EVERY = 120_000, SAY_MS = 6000; // every character pops its message every 2 minutes, for 6 seconds
const CELL = 4, GW = W / CELL, GH = H / CELL;
const TOP = 76, BOTTOM = 96; // css px kept for the header and for the buttons under the doors

let state = { couple: { groom: '신랑', bride: '신부', date: '' }, photos: [], guests: [] };
let me = localStorage.getItem('pw.me');
let myKey = localStorage.getItem('pw.key');
let myRole = localStorage.getItem('pw.role'), coupleKey = localStorage.getItem('pw.coupleKey'); // set when the bride or groom signs in
const ents = new Map();   // id → character
let bubble = null;        // { ent, until }
let marker = null;        // tap target marker { x, y, t }
let view = { s: 1, ox: 0, oy: 0, dpr: 1 };

// ---------- walk grid + pathfinding ----------
const walk = new Uint8Array(GW * GH);
for (let cy = 0; cy < GH; cy++) for (let cx = 0; cx < GW; cx++) walk[cy * GW + cx] = isBlocked(cx * CELL + 2, cy * CELL + 2) ? 0 : 1;
const freeCells = [...walk.keys()].filter(i => walk[i]);
const cellOf = (x, y) => Math.min(GH - 1, Math.max(0, Math.floor(y / CELL))) * GW + Math.min(GW - 1, Math.max(0, Math.floor(x / CELL)));
const center = i => ({ x: (i % GW) * CELL + 2, y: Math.floor(i / GW) * CELL + 2 });

function nearestFree(x, y) {
  const i = cellOf(x, y);
  if (walk[i]) return i;
  let best = freeCells[0], bd = Infinity;
  for (const j of freeCells) { const c = center(j), d = (c.x - x) ** 2 + (c.y - y) ** 2; if (d < bd) { bd = d; best = j; } }
  return best;
}

function clearLine(a, b) {
  const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 2);
  for (let k = 1; k < n; k++) if (!walk[cellOf(a.x + (b.x - a.x) * k / n, a.y + (b.y - a.y) * k / n)]) return false;
  return true;
}

function findPath(from, toCell) {
  const start = nearestFree(from.x, from.y);
  const prev = new Int32Array(GW * GH).fill(-1);
  prev[start] = start;
  const q = [start];
  for (let h = 0; h < q.length && prev[toCell] < 0; h++) {
    const i = q[h], cx = i % GW, cy = (i / GW) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const nx = cx + dx, ny = cy + dy, j = ny * GW + nx;
      if (nx < 0 || ny < 0 || nx >= GW || ny >= GH || !walk[j] || prev[j] >= 0) continue;
      if (dx && dy && (!walk[cy * GW + nx] || !walk[ny * GW + cx])) continue; // no corner cutting
      prev[j] = i; q.push(j);
    }
  }
  if (prev[toCell] < 0) return [];
  const cells = [];
  for (let i = toCell; i !== start; i = prev[i]) cells.push(center(i));
  cells.reverse();
  // string-pull: skip waypoints we can walk to in a straight line
  const out = []; let cur = from;
  for (let k = 0; k < cells.length; k++) {
    let far = k;
    while (far + 1 < cells.length && clearLine(cur, cells[far + 1])) far++;
    out.push(cells[far]); cur = cells[far]; k = far;
  }
  return out;
}

// ---------- characters ----------
function addGuest(gst, entering) {
  const start = entering ? { ...DOOR } : center(freeCells[Math.floor(Math.random() * freeCells.length)]);
  const now = performance.now();
  const e = { id: gst.id, g: gst, L: lookFor(gst.look, gst.gender), x: start.x, y: start.y, path: [], wait: Math.random() * 4,
    mode: 'wander', face: 'down', step: 0, last: 0, speed: 10,
    sayIdx: 0, sayUntil: 0, sayText: '', sayImg: null, nextSay: now + Math.random() * SAY_EVERY }; // staggered so bubbles trickle in
  if (entering) {
    e.mode = 'enter'; e.speed = 18;
    e.path = findPath(e, gst.id === me ? nearestFree(ENTRY.x, ENTRY.y) : freeCells[Math.floor(Math.random() * freeCells.length)]);
    say(e, gst.messages.at(-1), Infinity); // stays up while walking in, then 6 more seconds
    e.nextSay = now + SAY_EVERY;
  }
  if (gst.id === me && !entering) { e.mode = 'manual'; e.last = performance.now() - IDLE_MS; }
  ents.set(gst.id, e);
  return e;
}

function say(e, text, until) { e.sayText = text; e.sayUntil = until; e.sayImg = null; }

function randomNear(x, y, r) {
  for (let t = 0; t < 30; t++) {
    const i = cellOf(x + (Math.random() * 2 - 1) * r, y + (Math.random() * 2 - 1) * r);
    if (walk[i]) return i;
  }
  return nearestFree(x, y);
}

const couple = ['groom', 'bride'].map(role => ({ id: role, role, k: 1.4, // k: drawn bigger — they're the stars
  L: lookFor(role === 'groom' ? 7 : 9, role === 'groom' ? 'm' : 'f', role), ...COUPLE[role],
  sayIdx: 0, sayUntil: 0, sayText: '', sayImg: null, nextSay: performance.now() + Math.random() * SAY_EVERY }));
const msgsOf = e => (e.role ? state.couple.greetings?.[e.role] ?? [] : e.g.messages); // couple: greetings, guest: messages
const isMine = e => e.id === me || (!!e.role && e.role === myRole);

function tickSay(e, now) {
  // long overdue = the tab was in the background; re-spread instead of popping everyone at once
  if (now - e.nextSay > 5000) e.nextSay = now + Math.random() * SAY_EVERY;
  else if (now >= e.nextSay) {
    const ms = msgsOf(e);
    if (ms.length) say(e, ms[e.sayIdx++ % ms.length], now + SAY_MS);
    e.nextSay = now + SAY_EVERY;
  }
}

function update(dt, now) {
  for (const c of couple) tickSay(c, now);
  for (const e of ents.values()) {
    tickSay(e, now);
    if (e.path.length) {
      const p = e.path[0], dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy), stepLen = e.speed * dt;
      if (Math.abs(dy) > Math.abs(dx) * 0.6) e.face = dy < 0 ? 'up' : 'down';
      if (d <= stepLen) { e.x = p.x; e.y = p.y; e.path.shift(); } else { e.x += dx / d * stepLen; e.y += dy / d * stepLen; }
      e.step += dt;
      if (!e.path.length) { e.face = 'down'; e.wait = 1.5 + Math.random() * 5; if (e.mode === 'enter') { e.mode = e.id === me ? 'manual' : 'wander'; e.last = now; e.speed = 10; if (e.sayUntil === Infinity) e.sayUntil = now + SAY_MS; } }
      continue;
    }
    if (e.mode === 'manual' && now - e.last > IDLE_MS) e.mode = 'wander';
    if (e.mode === 'wander' && (e.wait -= dt) <= 0) { e.speed = 10; e.path = findPath(e, randomNear(e.x, e.y, 50)); }
  }
}

// ---------- drawing ----------
const bg = drawBackground();
const props = buildProps();
const tagCache = new Map();
const stagePhotos = STAGE_PHOTOS.map((_, i) => Object.assign(new Image(), { src: `/stage/${i + 1}.jpg` }));
let stageAlbum = []; // album photo file behind each curtain frame
fetch('/stage/album.json').then(r => (r.ok ? r.json() : [])).then(a => (stageAlbum = a)).catch(() => {});

function nameTag(e) {
  const key = `${e.id}|${view.dpr}`;
  let t = tagCache.get(key);
  if (t) return t;
  const name = e.role ? state.couple[e.role] : e.g.name;
  const color = e.role ? '#FFE7A8' : SIDE[e.g.side].color;
  const fs = (e.role ? 13 : 10) * view.dpr, font = e.role ? `bold ${fs}px Galmuri11` : `${fs}px Galmuri9`;
  t = document.createElement('canvas');
  const tg = t.getContext('2d');
  tg.font = font;
  t.width = Math.ceil(tg.measureText(name).width + 4 * view.dpr); t.height = Math.ceil(fs + 4 * view.dpr);
  tg.font = font; tg.textBaseline = 'top';
  if (e.role) { tg.fillStyle = 'rgba(11,10,18,.88)'; tg.fillRect(0, 0, t.width, t.height); } // couple sits on the candle row — plate keeps it readable
  tg.lineWidth = 3 * view.dpr; tg.strokeStyle = '#0B0A12'; tg.lineJoin = 'round';
  tg.strokeText(name, 2 * view.dpr, 2 * view.dpr);
  tg.fillStyle = color; tg.fillText(name, 2 * view.dpr, 2 * view.dpr);
  tagCache.set(key, t);
  return t;
}

const flame = (() => { const c = document.createElement('canvas'); c.width = c.height = 32; const gg = c.getContext('2d');
  const gr = gg.createRadialGradient(16, 16, 0, 16, 16, 16); gr.addColorStop(0, 'rgba(255,214,130,.9)'); gr.addColorStop(1, 'rgba(255,190,90,0)');
  gg.fillStyle = gr; gg.fillRect(0, 0, 32, 32); return c; })();

// The hall fills the phone's width and is taller than the screen: the page scrolls,
// the canvas stays pinned (sticky) and draws the slice that is in view.
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const s = Math.min(innerWidth / W, 3);
  if (dpr !== view.dpr) tagCache.clear(); // phone toolbars fire resize while scrolling; keep the cache then
  view = { s: s * dpr, dpr, ox: (innerWidth - W * s) / 2 * dpr, oy: 0 };
  cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; cv.style.height = `${innerHeight}px`;
  $('#world').style.height = `${TOP + H * s + BOTTOM}px`;
}

function draw(now) {
  view.oy = (TOP - scrollY) * view.dpr;
  const { s, ox, oy, dpr } = view;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = '#07060B'; g.fillRect(0, 0, cv.width, cv.height);
  g.imageSmoothingEnabled = false;
  const y0 = Math.max(0, Math.floor(-oy / s)), y1 = Math.min(H, Math.ceil((cv.height - oy) / s));
  if (y1 > y0) g.drawImage(bg, 0, y0, W, y1 - y0, ox, oy + y0 * s, W * s, (y1 - y0) * s);

  // wedding photos framed on the stage curtain — real photos, so drawn smooth, not pixelated
  g.imageSmoothingEnabled = true;
  STAGE_PHOTOS.forEach((f, i) => {
    const img = stagePhotos[i];
    if (!img.naturalWidth) return;
    g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(ox + (f.x + 0.7) * s, oy + (f.y + 0.7) * s, f.w * s, f.h * s);
    g.fillStyle = '#C9A24A'; g.fillRect(ox + f.x * s, oy + f.y * s, f.w * s, f.h * s);
    g.drawImage(img, ox + (f.x + 1) * s, oy + (f.y + 1) * s, (f.w - 2) * s, (f.h - 2) * s);
  });
  g.imageSmoothingEnabled = false;

  // candle flicker
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < CANDLES.length; i++) {
    const [x, y] = CANDLES[i], f = 0.55 + 0.45 * Math.sin(now / 160 + i * 1.7) * Math.sin(now / 410 + i);
    g.globalAlpha = 0.35 + 0.25 * f;
    const r = 3.2 * s;
    g.drawImage(flame, ox + (x + 0.5) * s - r, oy + (y + 0.5) * s - r, r * 2, r * 2);
  }
  g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';

  if (marker && now - marker.t < 700) {
    const k = (now - marker.t) / 700;
    g.strokeStyle = `rgba(255,231,168,${1 - k})`; g.lineWidth = 2 * dpr;
    g.beginPath(); g.ellipse(ox + marker.x * s, oy + marker.y * s, (3 + k * 6) * s, (1.5 + k * 3) * s, 0, 0, Math.PI * 2); g.stroke();
  }

  const list = [...props.map(p => ({ prop: p, y: p.y })), ...couple, ...ents.values()].sort((a, b) => a.y - b.y);
  for (const it of list) {
    if (it.prop) { const p = it.prop; g.drawImage(p.img, ox + (p.x - p.ox) * s, oy + (p.y - p.oy) * s, p.img.width * s, p.img.height * s); continue; }
    const walking = it.path?.length;
    const frame = walking ? 1 + (Math.floor(it.step * 7) % 2) : 0;
    const bob = it.role ? Math.round(Math.sin(now / 500 + (it.role === 'bride' ? 1 : 0)) * 0.4) : 0;
    const img = sprite(it.L, frame, it.face === 'up'), k = it.k || 1;
    // soft shadow
    g.fillStyle = 'rgba(0,0,0,.35)';
    g.beginPath(); g.ellipse(ox + it.x * s, oy + it.y * s, 5 * s * k, 1.6 * s * k, 0, 0, Math.PI * 2); g.fill();
    g.drawImage(img, ox + (it.x - SPRITE_W * k / 2) * s, oy + (it.y - (SPRITE_H - 1) * k + bob) * s, SPRITE_W * s * k, SPRITE_H * s * k);
    if (!it.role) drawTag(it);
    if (isMine(it)) drawMeArrow(it, now);
  }
  for (const c of couple) drawTag(c); // the couple's names always stay on top
  for (const it of list) if (it.sayUntil > now && bubble?.ent !== it) drawSay(it, now);
  if (bubble) drawBubble(bubble.ent, now);
}

function drawSay(e, now) {
  const { s, ox, oy, dpr } = view;
  if (!e.sayImg || e.sayImg.dpr !== dpr) e.sayImg = sayCanvas(e.sayText, dpr);
  const c = e.sayImg;
  const x = Math.max(4 * dpr, Math.min(cv.width - c.width - 4 * dpr, ox + e.x * s - c.width / 2));
  // never tuck a bubble under the fixed header (the couple stands right at the top)
  const y = Math.max((TOP + 12) * dpr, oy + (e.y - SPRITE_H * (e.k || 1) - (isMine(e) ? 8 : 1)) * s - c.height);
  g.globalAlpha = Math.min(1, (e.sayUntil - now) / 400);
  g.drawImage(c, Math.round(x), Math.round(y));
  g.globalAlpha = 1;
}

// compact bubble: message only (the name is already under the character)
function sayCanvas(text, d) {
  const c = document.createElement('canvas'), cg = c.getContext('2d');
  const pad = 5 * d, lh = 13 * d, tail = 5 * d;
  cg.font = `${11 * d}px Galmuri11`;
  const lines = wrap(cg, text, 112 * d, 3);
  const w = Math.ceil(Math.max(...lines.map(l => cg.measureText(l).width)) + pad * 2), h = Math.ceil(lines.length * lh + pad * 2);
  c.width = w + 2 * d; c.height = h + tail + 2 * d; c.dpr = d;
  cg.fillStyle = 'rgba(11,10,18,.55)'; cg.fillRect(2 * d, 2 * d, w, h);
  cg.fillStyle = '#FFFDF8'; cg.fillRect(0, 0, w, h);
  cg.strokeStyle = '#2A2540'; cg.lineWidth = 1.5 * d; cg.strokeRect(0.75 * d, 0.75 * d, w - 1.5 * d, h - 1.5 * d);
  cg.beginPath(); cg.moveTo(w / 2 - 4 * d, h - d); cg.lineTo(w / 2, h + tail); cg.lineTo(w / 2 + 4 * d, h - d); cg.closePath(); cg.fill(); cg.stroke();
  cg.fillRect(w / 2 - 3 * d, h - 2.5 * d, 6 * d, 2 * d);
  cg.font = `${11 * d}px Galmuri11`; cg.textBaseline = 'top'; cg.fillStyle = '#2A2540';
  lines.forEach((l, i) => cg.fillText(l, pad, pad + i * lh));
  return c;
}

function drawTag(e) {
  const { s, ox, oy } = view, t = nameTag(e);
  g.drawImage(t, Math.round(ox + e.x * s - t.width / 2), Math.round(oy + (e.y + 1) * s));
}

function drawMeArrow(e, now) {
  const { s, ox, oy, dpr } = view;
  const x = ox + e.x * s, y = oy + (e.y - SPRITE_H * (e.k || 1) - 3) * s + Math.sin(now / 220) * 2 * dpr;
  g.fillStyle = '#FFD45A'; g.strokeStyle = '#0B0A12'; g.lineWidth = 2 * dpr;
  g.beginPath(); g.moveTo(x - 5 * dpr, y - 6 * dpr); g.lineTo(x + 5 * dpr, y - 6 * dpr); g.lineTo(x, y); g.closePath(); g.stroke(); g.fill();
}

// breaks at spaces; a word longer than the bubble is split by character
function wrap(ctx, text, maxW, maxLines) {
  const lines = []; let line = '';
  for (const word of text.split(' ')) {
    const tryLine = line ? line + ' ' + word : word;
    if (ctx.measureText(tryLine).width <= maxW) { line = tryLine; continue; }
    if (line) lines.push(line);
    line = '';
    for (const ch of word) {
      if (ctx.measureText(line + ch).width > maxW && line) { lines.push(line); line = ch; } else line += ch;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = lines[maxLines - 1].slice(0, -1) + '…'; }
  return lines;
}

function drawBubble(e, now) {
  if (now > bubble.until || (!e.role && !ents.has(e.id))) { bubble = null; return; }
  const { s, ox, oy, dpr } = view;
  const head = e.role ? (e.role === 'groom' ? '신랑' : '신부') : SIDE[e.g.side].label;
  const name = e.role ? state.couple[e.role] : e.g.name;
  const msgs = msgsOf(e).length ? msgsOf(e) : ['와 주셔서 고마워요!'];
  const pad = 8 * dpr, maxW = 170 * dpr;
  g.font = `${12 * dpr}px Galmuri11`;
  const lines = msgs.flatMap((m, i) => wrap(g, msgs.length > 1 ? `${i + 1}. ${m}` : m, maxW, 4)).slice(0, 12);
  const lh = 16 * dpr;
  const w = Math.max(...lines.map(l => g.measureText(l).width), g.measureText(`${head} ${name}`).width + 10 * dpr) + pad * 2;
  const h = lh * (lines.length + 1) + pad * 2 - 2 * dpr;
  let x = ox + e.x * s - w / 2, y = oy + (e.y - SPRITE_H * (e.k || 1) - 4) * s - h - 8 * dpr;
  x = Math.max(6 * dpr, Math.min(cv.width - w - 6 * dpr, x));
  y = Math.max((TOP + 12) * dpr, y);
  g.fillStyle = '#0B0A12'; g.fillRect(x + 3 * dpr, y + 3 * dpr, w, h); // hard pixel shadow
  g.fillStyle = '#FFFDF8'; g.fillRect(x, y, w, h);
  g.strokeStyle = '#2A2540'; g.lineWidth = 2 * dpr; g.strokeRect(x, y, w, h);
  const tx = Math.min(Math.max(ox + e.x * s, x + 10 * dpr), x + w - 10 * dpr);
  g.fillStyle = '#FFFDF8'; g.beginPath(); g.moveTo(tx - 5 * dpr, y + h - 1); g.lineTo(tx + 5 * dpr, y + h - 1); g.lineTo(tx, y + h + 7 * dpr); g.closePath(); g.fill();
  g.beginPath(); g.moveTo(tx - 5 * dpr, y + h); g.lineTo(tx, y + h + 7 * dpr); g.lineTo(tx + 5 * dpr, y + h); g.stroke();
  g.textBaseline = 'top';
  g.font = `${11 * dpr}px Galmuri11`;
  const sideColor = e.role ? '#B8862B' : e.g.side === 'groom' ? '#3D6FD9' : '#E0507A';
  g.fillStyle = sideColor; g.fillText(head, x + pad, y + pad);
  g.fillStyle = '#2A2540'; g.font = `bold ${11 * dpr}px Galmuri11`;
  g.fillText(name, x + pad + g.measureText(head + ' ').width + 4 * dpr, y + pad);
  g.font = `${12 * dpr}px Galmuri11`;
  lines.forEach((l, i) => g.fillText(l, x + pad, y + pad + lh * (i + 1)));
}

// ---------- input ----------
// click, not pointerdown: browsers don't fire it after a scroll swipe
cv.addEventListener('click', ev => {
  const { s, ox, dpr } = view, oy = (TOP - scrollY) * dpr;
  const wx = (ev.clientX * dpr - ox) / s, wy = (ev.clientY * dpr - oy) / s;
  // a curtain frame opens the album on that same photo
  const frame = STAGE_PHOTOS.findIndex((f, i) => stagePhotos[i].naturalWidth && wx >= f.x && wx <= f.x + f.w && wy >= f.y && wy <= f.y + f.h);
  if (frame >= 0) return openGallery(Math.max(0, state.photos.findIndex(p => p.src === `/photos/${stageAlbum[frame]}`)));
  const hit = [...couple, ...ents.values()].sort((a, b) => b.y - a.y)
    .find(e => { const k = e.k || 1; return wx > e.x - 8 * k && wx < e.x + 8 * k && wy > e.y - SPRITE_H * k - 2 && wy < e.y + 4; });
  if (hit) { bubble = { ent: hit, until: performance.now() + 6000 }; return; }
  bubble = null;
  const mine = ents.get(me);
  if (!mine || wx < 0 || wy < 0 || wx > W || wy > H) return;
  const target = nearestFree(wx, wy);
  mine.path = findPath(mine, target); mine.mode = 'manual'; mine.last = performance.now(); mine.speed = 24;
  marker = { ...center(target), t: performance.now() };
  $('#hint').hidden = true;
});

// ---------- data ----------
function applyState(next, entering = new Set()) {
  const prevGreet = state.couple.greetings;
  state = next;
  for (const gst of state.guests) {
    const e = ents.get(gst.id);
    if (!e) { addGuest(gst, entering.has(gst.id)); continue; }
    const before = e.g.messages.length;
    e.g = gst;
    if (gst.messages.length > before) say(e, gst.messages.at(-1), performance.now() + SAY_MS);
  }
  for (const c of couple) { // a new greeting pops up right away on every phone
    const list = msgsOf(c), before = prevGreet?.[c.role]?.length ?? list.length;
    if (list.length > before) say(c, list.at(-1), performance.now() + SAY_MS);
  }
  $('#groomName').textContent = state.couple.groom;
  $('#brideName').textContent = state.couple.bride;
  $('#weddingDate').textContent = state.couple.date;
  $('#weddingDate').hidden = !state.couple.date;
  $('#cntGroom').textContent = state.guests.filter(x => x.side === 'groom').length;
  $('#cntBride').textContent = state.guests.filter(x => x.side === 'bride').length;
  $('#btnEnter').hidden = !!(me && ents.has(me)) || !!myRole;
  $('#btnMore').hidden = !((me && myKey && ents.has(me)) || myRole);
  $('#btnMore').textContent = myRole ? '인삿말 남기기' : '메시지 더 남기기';
  tagCache.forEach((_, k) => { if (k.startsWith('groom|') || k.startsWith('bride|')) tagCache.delete(k); });
}

let firstLoad = true;
// The host's CDN may answer /api/state from a copy up to 5 s old; right after we write, ask past it
// so our own new character or message is never rolled back (or, worse, our key forgotten).
let freshUntil = 0;
const wrote = () => (freshUntil = Date.now() + 10000);
async function poll() {
  try {
    const next = await (await fetch('/api/state' + (Date.now() < freshUntil ? `?t=${Date.now()}` : ''))).json();
    if (me && !next.guests.some(x => x.id === me)) { me = myKey = null; localStorage.removeItem('pw.me'); localStorage.removeItem('pw.key'); }
    // after the first load, newcomers walk in through the doors
    applyState(next, firstLoad ? new Set() : new Set(next.guests.map(x => x.id)));
    firstLoad = false;
  } catch { /* offline for a moment — try again on the next tick */ }
  setTimeout(poll, 5000);
}

// ---------- entry form ----------
const dlgEnter = $('#dlgEnter'), form = $('#enterForm');
let previewSeed = Math.floor(Math.random() * 2 ** 31);
function renderPreview() {
  const gender = form.gender.value || 'm';
  $('#preview').src = spriteDataUrl(lookFor(previewSeed, gender), 5);
  $('#preview').className = 'preview ' + (form.side.value || '');
}
$('#btnEnter').onclick = () => { renderPreview(); dlgEnter.showModal(); };
$('#reroll').onclick = () => { previewSeed = Math.floor(Math.random() * 2 ** 31); renderPreview(); };
form.addEventListener('change', renderPreview);
form.message.addEventListener('input', () => { $('#msgCount').textContent = [...form.message.value].length; });
form.addEventListener('submit', async ev => {
  ev.preventDefault();
  if (ev.submitter?.value === 'cancel') return dlgEnter.close();
  const err = $('#enterError'); err.textContent = '';
  if (!form.side.value) return (err.textContent = '신랑측인지 신부측인지 골라 주세요');
  if (!form.gender.value) return (err.textContent = '성별을 골라 주세요');
  const btn = form.querySelector('[type=submit]:not([value])'); btn.disabled = true;
  try {
    const r = await fetch('/api/guests', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ side: form.side.value, gender: form.gender.value, name: form.guestName.value, message: form.message.value, look: previewSeed }) });
    const body = await r.json();
    if (!r.ok) throw new Error(body.error);
    me = body.id; myKey = body.key; wrote();
    localStorage.setItem('pw.me', me); localStorage.setItem('pw.key', myKey);
    applyState({ ...state, guests: [...state.guests, body] }, new Set([me]));
    dlgEnter.close();
    $('#hint').hidden = false;
    scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' }); // watch yourself come through the doors
  } catch (e) { err.textContent = e.message || '입장하지 못했어요. 다시 눌러 주세요'; }
  finally { btn.disabled = false; }
});

// ---------- bride & groom sign-in (admin password, nothing else to fill in) ----------
let rolePick = null;
for (const b of document.querySelectorAll('[data-role]')) b.onclick = () => {
  rolePick = b.dataset.role;
  document.querySelectorAll('[data-role]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  $('#coupleAsk').hidden = false; $('#coupleError').textContent = ''; $('#couplePw').focus();
};
async function coupleSignIn() {
  const pw = $('#couplePw').value.trim(), err = $('#coupleError');
  if (!pw) return (err.textContent = '비밀번호를 넣어 주세요');
  const r = await fetch('/api/admin/config', { headers: { 'x-admin-token': pw } }).catch(() => null);
  if (!r?.ok) return (err.textContent = r?.status === 401 ? '비밀번호가 맞지 않아요' : '연결이 안 돼요. 다시 눌러 주세요');
  myRole = rolePick; coupleKey = pw;
  localStorage.setItem('pw.role', myRole); localStorage.setItem('pw.coupleKey', pw);
  dlgEnter.close(); applyState(state);
  scrollTo({ top: 0, behavior: 'smooth' });
  say(couple.find(c => c.role === myRole), `${myRole === 'groom' ? '신랑' : '신부'} 입장!`, performance.now() + SAY_MS);
}
$('#coupleGo').onclick = coupleSignIn;
$('#couplePw').addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); coupleSignIn(); } });

// ---------- more messages (adds, never edits) ----------
const dlgMore = $('#dlgMore'), moreForm = $('#moreForm');
// the same sheet serves guests (more messages) and the bride/groom (greetings)
$('#btnMore').onclick = () => {
  const mine = myRole ? msgsOf(couple.find(c => c.role === myRole)) : state.guests.find(x => x.id === me).messages;
  $('#moreTitle').textContent = myRole ? '인삿말 남기기' : '축하 메시지 더 남기기';
  $('#mineLabel').textContent = myRole ? '지금까지 남긴 인삿말' : '지금까지 남긴 메시지';
  $('#myMessages').replaceChildren(...mine.map(m => Object.assign(document.createElement('li'), { textContent: m })));
  $('#mineLabel').hidden = $('#myMessages').hidden = !mine.length;
  moreForm.reset(); $('#moreCount').textContent = 0; $('#moreError').textContent = '';
  moreForm.message.placeholder = myRole ? '하객들에게 전할 인사' : '하고 싶은 말을 더 남겨 주세요';
  dlgMore.showModal();
};
moreForm.message.addEventListener('input', () => { $('#moreCount').textContent = [...moreForm.message.value].length; });
moreForm.addEventListener('submit', async ev => {
  ev.preventDefault();
  if (ev.submitter?.value === 'cancel') return dlgMore.close();
  const err = $('#moreError'), btn = moreForm.querySelector('[type=submit]:not([value])');
  err.textContent = ''; btn.disabled = true;
  try {
    const [url, headers] = myRole
      ? [`/api/couple/${myRole}/greetings`, { 'x-admin-token': coupleKey }]
      : [`/api/guests/${me}/messages`, { 'x-guest-key': myKey }];
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ message: moreForm.message.value }) });
    const body = await r.json();
    if (!r.ok) throw new Error(body.error);
    wrote();
    applyState(myRole ? { ...state, couple: body } : { ...state, guests: state.guests.map(x => (x.id === me ? body : x)) });
    dlgMore.close();
    scrollTo({ top: 0, behavior: 'smooth' }); // back to the stage, where the new bubble shows
  } catch (e) { err.textContent = e.message || '남기지 못했어요. 다시 눌러 주세요'; }
  finally { btn.disabled = false; }
});

// ---------- guestbook list ----------
const dlgList = $('#dlgList');
$('#btnList').onclick = () => {
  for (const side of ['groom', 'bride']) {
    const ul = $(`#list-${side}`); ul.replaceChildren();
    const rows = state.guests.filter(x => x.side === side).slice().reverse();
    $(`#listCount-${side}`).textContent = rows.length;
    if (!rows.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = '아직 아무도 없어요'; ul.append(li); }
    for (const gst of rows) {
      const li = document.createElement('li');
      const b = document.createElement('button'); b.type = 'button';
      const img = new Image(); img.src = spriteDataUrl(lookFor(gst.look, gst.gender), 3); img.alt = '';
      const name = document.createElement('strong'); name.textContent = gst.name;
      let msg;
      if (gst.messages.length === 1) { msg = document.createElement('p'); msg.textContent = gst.messages[0]; }
      else { msg = document.createElement('ol'); for (const m of gst.messages) msg.append(Object.assign(document.createElement('li'), { textContent: m })); }
      b.append(img, name, msg);
      b.onclick = () => {
        const e = ents.get(gst.id);
        if (e) { bubble = { ent: e, until: performance.now() + 6000 }; scrollTo({ top: TOP + e.y * view.s / view.dpr - innerHeight / 2, behavior: 'smooth' }); }
        dlgList.close();
      };
      li.append(b); ul.append(li);
    }
  }
  dlgList.showModal();
};

// ---------- excel (csv) download — admin password ----------
async function downloadCsv(pw) {
  const r = await fetch('/api/admin/messages.csv', { headers: { 'x-admin-token': pw } });
  if (!r.ok) throw new Error(r.status === 401 ? '비밀번호가 맞지 않아요' : '내려받지 못했어요');
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(await r.blob()),
    download: `축하메시지_${state.couple.groom}_${state.couple.bride}.csv` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
$('#csvOpen').onclick = async () => {
  if (coupleKey) { try { return await downloadCsv(coupleKey); } catch { /* password changed — ask below */ } }
  $('#csvAsk').hidden = false; $('#csvForm').pw.focus();
};
$('#csvForm').onsubmit = async ev => {
  ev.preventDefault();
  const err = $('#csvError'); err.textContent = '';
  try { await downloadCsv(ev.target.pw.value.trim()); ev.target.reset(); $('#csvAsk').hidden = true; }
  catch (e) { err.textContent = e.message; }
};

// ---------- background music: three pieces, then round again ----------
const TRACKS = [
  { src: '/music/1-canon-in-d.mp3', title: 'Canon in D', by: 'Felted Classics', lic: 'CC BY 3.0' },
  { src: '/music/2-clair-de-lune.mp3', title: 'Clair de lune', by: 'Laurens Goedhart', lic: 'CC BY 3.0' },
  { src: '/music/3-gymnopedie-1.mp3', title: 'Gymnopédie No.1', by: 'Teknopazzo', lic: 'CC0' },
];
const bgm = new Audio(); bgm.preload = 'none'; bgm.volume = 0.5;
let trackNo = 0, musicOn = true; // on by default every visit; the button only mutes this visit
function playTrack() { bgm.src = TRACKS[trackNo].src; bgm.play().catch(() => {}); }
bgm.addEventListener('ended', () => { trackNo = (trackNo + 1) % TRACKS.length; playTrack(); });
bgm.addEventListener('play', () => {
  $('#btnMusic').setAttribute('aria-pressed', 'true');
  const t = TRACKS[trackNo], np = $('#nowPlaying'); // CC BY needs the credit shown while it plays
  np.textContent = `♪ ${t.title} – ${t.by} (${t.lic})`; np.hidden = false;
  clearTimeout(np.timer); np.timer = setTimeout(() => (np.hidden = true), 5000);
});
bgm.addEventListener('pause', () => $('#btnMusic').setAttribute('aria-pressed', 'false'));
$('#btnMusic').onclick = () => {
  musicOn = bgm.paused;
  if (!musicOn) bgm.pause(); else if (bgm.src) bgm.play().catch(() => {}); else playTrack();
};
// phones only allow sound after a tap, so if the start below is refused the first tap anywhere starts it
function unlockMusic(ev) {
  if (ev.target.closest?.('#btnMusic')) return;
  removeEventListener('pointerup', unlockMusic, true);
  if (musicOn && bgm.paused) bgm.src ? bgm.play().catch(() => {}) : playTrack();
}
addEventListener('pointerup', unlockMusic, true);
playTrack(); // PCs often allow sound right away; phones refuse until the first tap above

// ---------- wedding photos ----------
const dlgPhotos = $('#dlgPhotos'), track = $('#photoTrack');
function openGallery(start) {
  track.replaceChildren(...(state.photos.length ? state.photos.map((p, i) => {
    const fig = document.createElement('figure'); const img = new Image(); img.src = p.src; img.alt = `웨딩 사진 ${i + 1}`; img.loading = 'lazy'; fig.append(img); return fig;
  }) : [Object.assign(document.createElement('p'), { className: 'empty', textContent: '아직 올라온 사진이 없어요' })]));
  dlgPhotos.showModal();
  track.scrollLeft = start * track.clientWidth; updateCounter();
  loadPhotoMeta();
}
$('#btnPhotos').onclick = () => openGallery(0);
const updateCounter = () => {
  const n = state.photos.length, i = Math.round(track.scrollLeft / (track.clientWidth || 1));
  $('#photoCount').textContent = n ? `${i + 1} / ${n}` : '';
  renderReel();
};
track.addEventListener('scroll', updateCounter, { passive: true });
$('#prevPhoto').onclick = () => track.scrollBy({ left: -track.clientWidth, behavior: 'smooth' });
$('#nextPhoto').onclick = () => track.scrollBy({ left: track.clientWidth, behavior: 'smooth' });
// ---------- album likes & comments (reels style) ----------
const dlgComments = $('#dlgComments'), commentForm = $('#commentForm');
let photoMeta = {}, commentPhoto = null, replyTo = null;
// the bride/groom act with the password, a guest with the key from entering; anyone else can only look
const identity = () => (myRole && coupleKey) ? { who: `c:${myRole}`, headers: { 'x-couple-role': myRole, 'x-admin-token': coupleKey } }
  : (me && myKey) ? { who: `g:${me}`, headers: { 'x-guest-id': me, 'x-guest-key': myKey } } : null;
const currentPhoto = () => state.photos[Math.round(track.scrollLeft / (track.clientWidth || 1))];

async function loadPhotoMeta() {
  const id = identity();
  try { photoMeta = await (await fetch('/api/photos/meta' + (id ? `?who=${encodeURIComponent(id.who)}` : ''))).json(); } catch { photoMeta = {}; }
  renderReel();
}
function renderReel() {
  const p = currentPhoto(), m = (p && photoMeta[p.id]) || { likes: 0, comments: 0, liked: false };
  $('.reel-actions').hidden = !p;
  $('#likeBtn').setAttribute('aria-pressed', String(!!m.liked));
  $('#likeCount').textContent = m.likes; $('#commentCount').textContent = m.comments;
}
function askToEnter() {
  if (!confirm('입장한 하객만 좋아요·댓글을 남길 수 있어요. 입장할까요?')) return;
  dlgComments.close(); dlgPhotos.close(); $('#btnEnter').click();
}
$('#likeBtn').onclick = async () => {
  const p = currentPhoto(), id = identity();
  if (!p) return;
  if (!id) return askToEnter();
  const r = await fetch(`/api/photos/${p.id}/like`, { method: 'POST', headers: id.headers });
  if (!r.ok) return;
  const b = await r.json();
  photoMeta[p.id] = { ...photoMeta[p.id], likes: b.likes, liked: b.liked };
  renderReel();
  const btn = $('#likeBtn'); btn.classList.remove('pop'); void btn.offsetWidth; if (b.liked) btn.classList.add('pop');
};

const ago = t => { const mins = Math.floor((Date.now() - t) / 60000); return mins < 1 ? '방금' : mins < 60 ? `${mins}분` : mins < 1440 ? `${Math.floor(mins / 60)}시간` : `${Math.floor(mins / 1440)}일`; };
function authorOf(c) {
  if (c.by.role) return { name: state.couple[c.by.role], badge: c.by.role === 'groom' ? '신랑' : '신부', cls: 'couple', L: couple.find(x => x.role === c.by.role).L };
  const g = state.guests.find(x => x.id === c.by.guestId);
  return { name: c.by.name, badge: SIDE[c.by.side].label, cls: c.by.side, L: g && lookFor(g.look, g.gender) };
}
function commentItem(c) {
  const a = authorOf(c), li = document.createElement('li');
  li.className = c.parentId ? 'comment reply' : 'comment';
  const img = new Image(); img.alt = ''; if (a.L) img.src = spriteDataUrl(a.L, 3);
  const who = document.createElement('div'); who.className = 'who';
  who.append(Object.assign(document.createElement('strong'), { textContent: a.name }), Object.assign(document.createElement('span'), { className: `badge ${a.cls}`, textContent: a.badge }));
  const acts = document.createElement('div'); acts.className = 'acts';
  const reply = Object.assign(document.createElement('button'), { type: 'button', textContent: '답글 달기' });
  reply.onclick = () => { replyTo = c; $('#replyTo').hidden = false; $('#replyTo span').textContent = `${a.name}님에게 답글 남기는 중`; commentForm.text.focus(); };
  acts.append(Object.assign(document.createElement('span'), { textContent: ago(c.createdAt) }), reply);
  if (myRole && coupleKey) { // the bride and groom can remove comments they don't like
    const del = Object.assign(document.createElement('button'), { type: 'button', className: 'del', textContent: '삭제' });
    del.onclick = () => deleteComment(c);
    acts.append(del);
  }
  const body = document.createElement('div');
  body.append(who, Object.assign(document.createElement('p'), { textContent: c.text }), acts);
  li.append(img, body);
  return li;
}
function renderComments(list) {
  photoMeta[commentPhoto.id] = { ...photoMeta[commentPhoto.id], comments: list.length };
  renderReel();
  $('#commentsTitle').textContent = `댓글 ${list.length}`;
  const ul = $('#commentList'); ul.replaceChildren();
  if (!list.length) ul.append(Object.assign(document.createElement('li'), { className: 'empty', textContent: '첫 댓글을 남겨 보세요' }));
  for (const top of list.filter(c => !c.parentId))
    for (const c of [top, ...list.filter(r => r.parentId === top.id)]) ul.append(commentItem(c));
}
$('#commentBtn').onclick = async () => {
  commentPhoto = currentPhoto();
  if (!commentPhoto) return;
  replyTo = null; $('#replyTo').hidden = true; commentForm.reset(); $('#commentError').textContent = '';
  $('#commentList').replaceChildren();
  dlgComments.showModal();
  renderComments(await (await fetch(`/api/photos/${commentPhoto.id}/comments`)).json());
};
$('#replyCancel').onclick = () => { replyTo = null; $('#replyTo').hidden = true; };
commentForm.addEventListener('submit', async ev => {
  ev.preventDefault();
  const id = identity();
  if (!id) return askToEnter();
  const err = $('#commentError'); err.textContent = '';
  const r = await fetch(`/api/photos/${commentPhoto.id}/comments`, { method: 'POST', headers: { 'content-type': 'application/json', ...id.headers },
    body: JSON.stringify({ text: commentForm.text.value, parentId: replyTo?.id }) });
  const b = await r.json();
  if (!r.ok) return (err.textContent = b.error);
  commentForm.reset(); replyTo = null; $('#replyTo').hidden = true;
  renderComments(b);
});
async function deleteComment(c) {
  if (!confirm('이 댓글을 지울까요? 답글도 함께 지워지고 되돌릴 수 없어요.')) return;
  const r = await fetch(`/api/photos/${commentPhoto.id}/comments/${c.id}`, { method: 'DELETE', headers: identity().headers });
  const b = await r.json();
  if (!r.ok) return ($('#commentError').textContent = b.error);
  renderComments(b);
}

for (const d of [dlgEnter, dlgMore, dlgList, dlgPhotos, dlgComments]) d.addEventListener('click', ev => { if (ev.target === d) d.close(); });

// ---------- loop ----------
let lastT = performance.now();
function frame(now) {
  update(Math.min(0.1, (now - lastT) / 1000), now); lastT = now;
  draw(now);
  requestAnimationFrame(frame);
}
addEventListener('resize', resize);
resize();
await document.fonts.load('10px Galmuri9').catch(() => {});
await document.fonts.load('12px Galmuri11').catch(() => {});
poll();
requestAnimationFrame(frame);