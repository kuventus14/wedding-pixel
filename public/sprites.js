// Procedural chibi pixel characters. Each look is a seed; same seed → same character everywhere.
export const SPRITE_W = 14, SPRITE_H = 20; // 12×18 body + 1px outline on every side

const SKIN = ['#F7D7BC', '#F0C3A0', '#E3AE86', '#C98F66'];
const HAIR = ['#1D1918', '#2A201B', '#3F2C22', '#5C4030', '#7A5A3E', '#A8794E', '#3B3940', '#C9C3BC'];
const SUIT = ['#23262F', '#2D3552', '#4A505C', '#6C6861', '#3A2E29', '#21406A', '#8A8F98', '#5B4636'];
const TIE = ['#8E2B3A', '#2E5C8A', '#C9A24A', '#3E6B4A', '#5A3A7A', '#B5555F'];
const DRESS = ['#F2B6C5', '#BCD6EC', '#F3DFA2', '#C8B4E4', '#2D3552', '#202026', '#9CC6A8', '#ECE7DE', '#D8826C', '#7B5EA7'];
const OUTLINE = '#1B1626';

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

export function lookFor(seed, gender, role = 'guest') {
  const r = rng(seed);
  const L = {
    gender, role,
    skin: pick(r, SKIN), hair: pick(r, HAIR.slice(0, gender === 'm' ? 7 : 8)),
    style: Math.floor(r() * 3), glasses: r() < 0.22,
    outfit: gender === 'm' ? pick(r, SUIT) : pick(r, DRESS), tie: pick(r, TIE),
  };
  if (role === 'groom') Object.assign(L, { outfit: '#17171C', tie: '#F4F1EA', style: 1, glasses: false });
  if (role === 'bride') Object.assign(L, { outfit: '#FBFAF6', style: 0, glasses: false });
  return L;
}

// frame: 0 = standing, 1/2 = steps. back: seen from behind.
function paint(L, frame, back) {
  const px = new Map();
  const set = (x, y, c) => { if (x >= 0 && x < 12 && y >= 0 && y < 18) px.set(y * 12 + x, c); };
  const rect = (x0, y0, x1, y1, c) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, c); };
  const bob = frame ? 1 : 0;
  const f = L.gender === 'f';

  // long hair falls behind the shoulders
  if (f && L.style === 0) rect(1, 4 + bob, 10, 12 + bob, L.hair);
  if (L.role === 'bride') rect(0, 2 + bob, 11, 15 + bob, '#EDEFF3'); // veil

  // legs + shoes
  const legC = f ? L.skin : L.outfit, shoe = f && L.role !== 'groom' ? '#3A2A2A' : '#15141A';
  const lUp = frame === 1 ? 1 : 0, rUp = frame === 2 ? 1 : 0;
  rect(3, 15, 4, 16 - lUp, legC); rect(3, 17 - lUp, 4, 17 - lUp, shoe);
  rect(7, 15, 8, 16 - rUp, legC); rect(7, 17 - rUp, 8, 17 - rUp, shoe);

  // body
  if (f) {
    rect(3, 10 + bob, 8, 11 + bob, L.outfit);
    rect(2, 12 + bob, 9, 14 + bob, L.outfit);
    if (L.role === 'bride') rect(1, 13 + bob, 10, 15, L.outfit);
    rect(1, 10 + bob, 1, 12 + bob, L.skin); rect(10, 10 + bob, 10, 12 + bob, L.skin);
  } else {
    rect(2, 10 + bob, 9, 14 + bob, L.outfit);
    rect(1, 10 + bob, 1, 13 + bob, L.outfit); rect(10, 10 + bob, 10, 13 + bob, L.outfit);
    set(1, 14 + bob, L.skin); set(10, 14 + bob, L.skin);
    if (!back) {
      rect(5, 10 + bob, 6, 11 + bob, '#F5F4EE');
      if (L.role === 'groom') { set(4, 10 + bob, L.tie); set(7, 10 + bob, L.tie); set(5, 10 + bob, '#17171C'); set(6, 10 + bob, '#17171C'); }
      else rect(5, 11 + bob, 6, 13 + bob, L.tie);
    }
  }

  // head
  rect(2, 3 + bob, 9, 9 + bob, L.skin);
  if (back) rect(2, 2 + bob, 9, 9 + bob, L.hair);
  else {
    rect(2, 1 + bob, 9, 3 + bob, L.hair);
    if (L.style === 0) { rect(2, 4 + bob, 5, 4 + bob, L.hair); set(1, 3 + bob, L.hair); set(10, 3 + bob, L.hair); }
    if (L.style === 1) { rect(2, 4 + bob, 9, 4 + bob, L.hair); set(4, 4 + bob, L.skin); }
    if (L.style === 2) { rect(6, 4 + bob, 9, 4 + bob, L.hair); }
    rect(1, 3 + bob, 1, 6 + bob, L.hair); rect(10, 3 + bob, 10, 6 + bob, L.hair);
    if (f && L.style === 1) { rect(1, 3 + bob, 1, 9 + bob, L.hair); rect(10, 3 + bob, 10, 9 + bob, L.hair); }
    if (f && L.style === 2) rect(4, -1 + bob, 7, 0 + bob, L.hair); // bun
    rect(4, 6 + bob, 4, 7 + bob, '#1B1626'); rect(7, 6 + bob, 7, 7 + bob, '#1B1626');
    if (f) { set(3, 8 + bob, '#EE9AA6'); set(8, 8 + bob, '#EE9AA6'); }
    if (L.glasses) { rect(3, 5 + bob, 5, 5 + bob, '#2A2540'); rect(6, 5 + bob, 8, 5 + bob, '#2A2540'); set(3, 7 + bob, '#2A2540'); set(8, 7 + bob, '#2A2540'); }
  }
  if (L.role === 'bride') { rect(3, 0 + bob, 8, 1 + bob, '#FFFFFF'); set(5, 0 + bob, '#F2C94C'); set(6, 0 + bob, '#F2C94C'); }
  return px;
}

const cache = new Map();
// Returns a canvas of SPRITE_W×SPRITE_H with a dark outline around every painted pixel.
export function sprite(L, frame = 0, back = false) {
  const key = `${L.gender}${L.role}${L.skin}${L.hair}${L.style}${L.glasses}${L.outfit}${L.tie}|${frame}${back}`;
  let c = cache.get(key);
  if (c) return c;
  const px = paint(L, frame, back);
  c = document.createElement('canvas');
  c.width = SPRITE_W; c.height = SPRITE_H;
  const g = c.getContext('2d');
  g.fillStyle = OUTLINE;
  for (const k of px.keys()) {
    const x = k % 12 + 1, y = Math.floor(k / 12) + 1;
    g.fillRect(x - 1, y, 1, 1); g.fillRect(x + 1, y, 1, 1); g.fillRect(x, y - 1, 1, 1); g.fillRect(x, y + 1, 1, 1);
  }
  for (const [k, col] of px) { g.fillStyle = col; g.fillRect(k % 12 + 1, Math.floor(k / 12) + 1, 1, 1); }
  cache.set(key, c);
  return c;
}

// Scaled-up PNG for list avatars and the entry preview.
export function spriteDataUrl(L, scale = 4) {
  const src = sprite(L);
  const c = document.createElement('canvas');
  c.width = SPRITE_W * scale; c.height = SPRITE_H * scale;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL();
}
