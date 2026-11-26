// G-Tower Convention Grand Ballroom (2F), drawn as a top-down pixel map.
// Reference: venue photos on directwedding.co.kr/weddinghall/hall0444 — black hall and ceiling truss,
// crystal chandeliers, white pillars crowned with chandeliers, long navy runway lined with tea lights,
// tall flower walls at the runway start, navy-clothed rectangular tables, ivory pleated stage curtain
// with gold candelabras, and a wide sunset media wall on one side wall.
// Tall on purpose: phones scroll the hall up and down (the real runway is ~30 m long).
export const W = 200, H = 700;
const FRONT = H - 18;                         // front wall with the doors
const STEPS_Y = FRONT - 18;                   // three steps at the runway start
const FW_Y1 = FRONT - 14, FW_Y0 = FW_Y1 - 46; // flower walls flanking the runway start
export const DOOR = { x: 100, y: FRONT + 8 };
export const ENTRY = { x: 100, y: FW_Y0 - 14 }; // where a new guest walks to first
// the couple is drawn at 1.4× size, either side of the vow table; two 3-character name tags still don't touch
export const COUPLE = { groom: { x: 86, y: 60 }, bride: { x: 114, y: 60 } };
// three wedding photos on the stage curtain: same 2:3 frame, same gap, centred between the candelabras
export const STAGE_PHOTOS = [56, 90, 124].map(x => ({ x, y: 4, w: 20, h: 29 }));
export const AISLE = { x0: 88, x1: 112, y0: 68, y1: FRONT - 2 };

const range = (from, below, step) => { const a = []; for (let v = from; v < below; v += step) a.push(v); return a; };
const PILLAR_X = [78, 122], PILLAR_Y = range(104, FW_Y0 - 20, 40);
const TABLE_X = [26, 56, 144, 174], TABLE_Y = range(98, FW_Y0 - 14, 30);

// Rectangles guests cannot stand in: [x0, y0, x1, y1]
export const BLOCKED = [
  [0, 0, W, 68],          // back wall + stage
  [62, 68, 138, 84],      // keep a little space in front of the couple so guests don't hide them
  [0, 0, 4, H], [192, 0, W, H], // side walls, media wall
  [0, FRONT, W, H],       // front wall (doors handled by spawn point)
  [68, FW_Y0, 87, FW_Y1], [113, FW_Y0, 132, FW_Y1], // flower walls at runway start
  ...PILLAR_X.flatMap(x => PILLAR_Y.map(y => [x - 5, y - 4, x + 5, y + 1])),
  ...TABLE_X.flatMap(x => TABLE_Y.map(y => [x - 12, y - 9, x + 12, y + 6])),
];

function rng(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }

function glow(g, x, y, r, color, alpha) {
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, color); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.globalAlpha = alpha; g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); g.globalAlpha = 1;
}

function chandelier(g, cx, top, size = 1) {
  const tiers = size > 1 ? [3, 7, 11, 13, 11, 7, 3] : [3, 5, 7, 5, 3];
  glow(g, cx, top + tiers.length / 2, 10 * size, '#FFE7A8', 0.35);
  g.fillStyle = '#6B5A3A'; g.fillRect(cx, top - 3, 1, 3);
  tiers.forEach((w, i) => {
    const x0 = cx - Math.floor(w / 2);
    for (let x = 0; x < w; x++) {
      g.fillStyle = (x + i) % 3 === 0 ? '#FFFFFF' : (x + i) % 3 === 1 ? '#F3E3B0' : '#D9BF78';
      g.fillRect(x0 + x, top + i, 1, 1);
    }
  });
  g.fillStyle = '#FFF4CF'; g.fillRect(cx, top + tiers.length, 1, 1);
}

const FLOWERS = ['#F7C9D6', '#FFFFFF', '#CDBAE6', '#E99AB2', '#F5E6C9', '#B99BD6', '#F2B7A0'];
function flowerMass(g, x0, y0, w, h, seed, palette = FLOWERS) {
  const r = rng(seed);
  for (let i = 0; i < w * h * 0.9; i++) { // leaves first
    const x = x0 + Math.floor(r() * w), y = y0 + Math.floor(r() * h);
    g.fillStyle = r() < 0.5 ? '#4E6E47' : '#6F9363'; g.fillRect(x, y, 1, 1);
  }
  for (let i = 0; i < w * h * 0.22; i++) { // blossoms
    const x = x0 + Math.floor(r() * (w - 1)), y = y0 + Math.floor(r() * (h - 1));
    const c = palette[Math.floor(r() * palette.length)];
    g.fillStyle = c; g.fillRect(x, y, 2, 2);
    g.fillStyle = '#FFFFFF'; if (r() < 0.3) g.fillRect(x, y, 1, 1);
  }
}

function candelabra(g, x, base) {
  g.fillStyle = '#B88A2E'; g.fillRect(x, base - 14, 1, 14); g.fillRect(x - 3, base - 10, 7, 1);
  g.fillRect(x - 3, base - 13, 1, 3); g.fillRect(x + 3, base - 13, 1, 3); g.fillRect(x - 2, base, 5, 1);
  for (const dx of [-3, 0, 3]) {
    g.fillStyle = '#F2EBDD'; g.fillRect(x + dx, base - (dx ? 15 : 17), 1, 2);
    g.fillStyle = '#FFC85A'; g.fillRect(x + dx, base - (dx ? 16 : 18), 1, 1);
  }
}

// Candle positions (world px) that flicker each frame.
export const CANDLES = [];

export function drawBackground() {
  const [c, g] = canvas(W, H);
  // floor: dark carpet with a faint diamond weave
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    g.fillStyle = (x + y) % 6 === 0 || (x - y + 600) % 6 === 0 ? '#1A1A25' : '#14141D';
    g.fillRect(x, y, 1, 1);
  }
  // back wall: black truss with spotlights, side curtains, ivory pleated backdrop
  g.fillStyle = '#09080D'; g.fillRect(0, 0, W, 40);
  g.fillStyle = '#1F1E27'; g.fillRect(0, 2, W, 1);
  for (let x = 6; x < W; x += 14) { g.fillStyle = '#2C2A35'; g.fillRect(x, 1, 3, 3); g.fillStyle = '#FFF3D0'; g.fillRect(x + 1, 3, 1, 1); }
  for (let x = 0; x < W; x++) {
    if (x < 36 || x >= 164) { g.fillStyle = x % 3 ? '#14121B' : '#1C1925'; g.fillRect(x, 5, 1, 35); continue; }
    const lit = 1 - Math.abs(x - 100) / 90;
    for (let y = 5; y < 40; y++) {
      const base = x % 4 < 2 ? [237, 227, 209] : [214, 200, 175];
      const k = 0.72 + 0.28 * lit - (y < 8 ? 0.12 : 0);
      g.fillStyle = `rgb(${base.map(v => Math.round(v * k)).join(',')})`; g.fillRect(x, y, 1, 1);
    }
  }
  for (let x = 42; x < 160; x += 9) { g.fillStyle = '#FFF6D6'; g.fillRect(x, 12 + (x % 2) * 3, 1, 1); } // small pendants on the backdrop
  // stage
  g.fillStyle = '#26232F'; g.fillRect(22, 40, 156, 24);
  g.fillStyle = '#3A3646'; g.fillRect(22, 63, 156, 1);
  g.fillStyle = '#16141D'; g.fillRect(22, 64, 156, 4);
  for (let i = 0; i < 3; i++) { g.fillStyle = i % 2 ? '#2A2737' : '#34303F'; g.fillRect(88, 64 + i * 2, 24, 2); }
  glow(g, 100, 50, 34, '#FFE6B0', 0.22);
  flowerMass(g, 38, 34, 36, 12, 11, ['#FFFFFF', '#F2B7A0', '#E9874F', '#F5E6C9', '#E99AB2']);
  flowerMass(g, 126, 34, 36, 12, 12, ['#FFFFFF', '#F2B7A0', '#E9874F', '#F5E6C9', '#E99AB2']);
  for (const x of [32, 46, 154, 168]) { candelabra(g, x, 44); CANDLES.push([x, 26], [x - 3, 28], [x + 3, 28]); }
  g.fillStyle = '#F4EFE4'; g.fillRect(93, 44, 14, 5); g.fillStyle = '#D8D0C0'; g.fillRect(93, 49, 14, 2); // vow table
  flowerMass(g, 93, 40, 14, 5, 13, ['#FFFFFF', '#F5E6C9', '#FFFFFF']);
  for (const x of [44, 156]) chandelier(g, x, 6, 2); // to the sides, so they don't hang over the photos
  for (let x = 25; x < 176; x += 4) if (x < 86 || x > 114) { g.fillStyle = '#E9E4D0'; g.fillRect(x, 62, 1, 1); CANDLES.push([x, 61]); }

  // runway: raised navy platform, tea lights along both edges, three steps at the entrance end
  const runLen = STEPS_Y - AISLE.y0;
  g.fillStyle = '#1B2446'; g.fillRect(AISLE.x0, AISLE.y0, 24, runLen);
  g.fillStyle = '#22305C'; g.fillRect(AISLE.x0 + 8, AISLE.y0, 8, runLen);
  g.fillStyle = '#2E3C70'; g.fillRect(AISLE.x0, AISLE.y0, 1, runLen); g.fillRect(AISLE.x1 - 1, AISLE.y0, 1, runLen);
  for (let i = 0; i < 4; i++) { g.fillStyle = i % 2 ? '#1A2140' : '#2A3666'; g.fillRect(AISLE.x0 - 2, STEPS_Y + i * 4, 28, 4); }
  for (let y = 72; y < STEPS_Y - 4; y += 6) for (const x of [86, 113]) { g.fillStyle = '#E9E4D0'; g.fillRect(x, y, 1, 1); CANDLES.push([x, y - 1]); }
  for (const y of range(110, FW_Y0, 60)) glow(g, 100, y, 22, '#FFE2A0', 0.13);
  // small arrangements along the runway between pillars
  for (const y of PILLAR_Y.map(v => v + 20)) { flowerMass(g, 81, y - 3, 5, 4, y, FLOWERS); flowerMass(g, 114, y - 3, 5, 4, y + 1, FLOWERS); }

  // media wall on the right side wall (sunset video), dark left wall
  const mwEnd = FRONT - 56;
  for (let y = 80; y < mwEnd; y++) {
    const t = (y - 80) / (mwEnd - 80);
    const col = t < 0.5 ? mix([59, 46, 110], [199, 107, 152], t * 2) : mix([199, 107, 152], [242, 166, 107], (t - 0.5) * 2);
    g.fillStyle = `rgb(${col})`; g.fillRect(194, y, 5, 1);
  }
  g.fillStyle = '#0A0A0E'; g.fillRect(193, 78, 1, mwEnd - 76); g.fillRect(199, 78, 1, mwEnd - 76);
  for (const y of range(170, mwEnd, 180)) glow(g, 192, y, 40, '#B871A8', 0.12);
  g.fillStyle = '#0D0C12'; g.fillRect(0, 40, 4, H);
  for (const y of range(90, FRONT - 22, 40)) { g.fillStyle = '#FFE7B0'; g.fillRect(2, y, 1, 2); glow(g, 3, y + 1, 8, '#FFE2A0', 0.2); }

  // front wall with the double doors guests come in through
  g.fillStyle = '#0E0D14'; g.fillRect(0, FRONT, W, 18);
  g.fillStyle = '#2B201B'; g.fillRect(86, FRONT, 28, 18);
  g.fillStyle = '#3A2C24'; g.fillRect(88, FRONT + 2, 11, 16); g.fillRect(101, FRONT + 2, 11, 16);
  g.fillStyle = '#D4A73C'; g.fillRect(98, FRONT + 9, 1, 3); g.fillRect(101, FRONT + 9, 1, 3);
  glow(g, 100, FRONT, 18, '#FFE2A0', 0.18);
  return c;
}

function mix(a, b, t) { return a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(','); }

// Props are drawn depth-sorted with the characters so guests can walk behind them.
export function buildProps() {
  const props = [];
  // pillars crowned with chandeliers
  const [pc, pg] = canvas(15, 42);
  chandelier(pg, 7, 4);
  for (let y = 12; y < 39; y++) for (let x = 3; x < 12; x++) {
    pg.fillStyle = x < 5 ? '#FBF7EE' : x < 9 ? '#E7DECD' : '#BDB09B'; pg.fillRect(x, y, 1, 1);
  }
  pg.fillStyle = '#F6E9C4'; pg.fillRect(3, 12, 9, 1);
  pg.fillStyle = '#9A8E7B'; pg.fillRect(2, 39, 11, 3);
  for (const x of PILLAR_X) for (const y of PILLAR_Y) props.push({ x, y, img: pc, ox: 7, oy: 41 });

  // tables: navy cloth, white flowers and candles, black chairs on both long sides
  const [tc, tg] = canvas(26, 18);
  for (const cy of [0, 14]) for (const cx of [3, 10, 17]) { tg.fillStyle = '#0B0B10'; tg.fillRect(cx, cy, 5, 4); tg.fillStyle = '#25242E'; tg.fillRect(cx, cy, 5, 1); }
  tg.fillStyle = '#2B3B6C'; tg.fillRect(1, 4, 24, 7);
  tg.fillStyle = '#22305A'; tg.fillRect(1, 9, 24, 2);
  tg.fillStyle = '#161F3C'; tg.fillRect(1, 11, 24, 3);
  flowerMass(tg, 10, 5, 6, 3, 99, ['#FFFFFF', '#F5E6C9', '#F7C9D6']);
  for (const cx of [5, 20]) { tg.fillStyle = '#E9E4D0'; tg.fillRect(cx, 6, 1, 2); }
  for (const x of TABLE_X) for (const y of TABLE_Y) {
    props.push({ x, y: y + 6, img: tc, ox: 13, oy: 15 });
    CANDLES.push([x - 8, y - 4], [x + 7, y - 4]);
  }

  // tall flower walls flanking the runway start
  const fw = (seed) => { const [c, g] = canvas(20, 60); flowerMass(g, 1, 0, 18, 58, seed); g.fillStyle = '#1E1C26'; g.fillRect(0, 56, 20, 4); return c; };
  props.push({ x: 77, y: FW_Y1, img: fw(31), ox: 10, oy: 59 });
  props.push({ x: 123, y: FW_Y1, img: fw(32), ox: 10, oy: 59 });
  return props;
}

export function isBlocked(x, y) {
  for (const [x0, y0, x1, y1] of BLOCKED) if (x >= x0 && x < x1 && y >= y0 && y < y1) return true;
  return false;
}
