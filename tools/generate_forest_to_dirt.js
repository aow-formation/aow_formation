/**
 * forest_to_dirt 경계 타일 생성
 * - 크기: 42×21px (기존 128×64의 1/3, 면적 1/9)
 * - 8방향 각각 dirt↔forest 블렌드
 * - 방향 0 = 화면 위쪽이 dirt, 시계방향 45° 씩 회전
 */
const fs   = require('fs');
const zlib = require('zlib');
const path = require('path');

const W   = 42;          // 128 / ~3
const H   = 21;          // 64  / ~3   (2:1 비율 유지)
const OUT = path.join(__dirname, '../web/assets/terrain_tiles');

// ── PNG 인코더 ─────────────────────────────────────────────────────────────
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (const b of buf) { c ^= b; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); }
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const l = Buffer.alloc(4); l.writeUInt32BE(data.length);
  const ci = Buffer.alloc(4); ci.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([l, t, data, ci]);
}
function encodePNG(pixels, w, h) {
  const sig  = Buffer.from([137,80,78,71,13,10,26,10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const row = 1 + w * 4;
  const raw = Buffer.alloc(h * row, 0);
  for (let y = 0; y < h; y++) pixels.copy(raw, y * row + 1, y * w * 4, (y + 1) * w * 4);
  return Buffer.concat([sig, chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ── 유틸 ──────────────────────────────────────────────────────────────────
function inDiamond(px, py) {
  return Math.abs((px - W/2) / (W/2)) + Math.abs((py - H/2) / (H/2)) <= 1.0;
}
function edgeAlpha(px, py) {
  const d = Math.abs((px - W/2) / (W/2)) + Math.abs((py - H/2) / (H/2));
  return d > 0.92 ? Math.max(0, (1 - d) / 0.08) : 1;
}
function smoothstep(a, b, t) {
  const x = Math.max(0, Math.min(1, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
}
function rng(seed) {
  let s = (seed * 1664525 + 1013904223) >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 0xFFFFFFFF; };
}

// ── 타일 생성 ──────────────────────────────────────────────────────────────
// angle: 화면 공간에서 DIRT 방향 (라디안, 0=위, 시계방향)
function makeTile(variant) {
  const angle = variant * Math.PI / 4;          // 45° 씩
  const dirX  =  Math.sin(angle);               // dirt 방향 단위벡터 (화면 x)
  const dirY  = -Math.cos(angle);               // dirt 방향 단위벡터 (화면 y, y↓양수)
  const cx = W / 2, cy = H / 2;

  // 최대 투영 거리 (정규화용)
  let maxProj = 0;
  for (const [px, py] of [[0, cy], [W-1, cy], [cx, 0], [cx, H-1]])
    maxProj = Math.max(maxProj, Math.abs((px-cx)*dirX + (py-cy)*dirY));

  const rand  = rng(800 + variant * 97);
  const pixels = Buffer.alloc(W * H * 4, 0);

  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      if (!inDiamond(px, py)) continue;

      // dirt쪽 +1, forest쪽 -1 → 0~1로 정규화
      const proj = (px - cx) * dirX + (py - cy) * dirY;
      const raw  = 0.5 + proj / (maxProj * 1.6);
      const t    = smoothstep(0.28, 0.72, Math.max(0, Math.min(1, raw)));

      // 색상 팔레트 (dirt / forest)
      const noise = (rand() - 0.5) * 20;
      const dR = 155 + noise, dG = 128 + noise, dB = 88 + noise;  // dirt
      const fR =  48 + noise, fG =  78 + noise, fB =  38 + noise; // forest

      const idx = (py * W + px) * 4;
      // t=1 → dirt 방향(이웃 쪽), t=0 → forest 방향(내부)
      pixels[idx]     = Math.round(Math.max(0, Math.min(255, fR*(1-t) + dR*t)));
      pixels[idx + 1] = Math.round(Math.max(0, Math.min(255, fG*(1-t) + dG*t)));
      pixels[idx + 2] = Math.round(Math.max(0, Math.min(255, fB*(1-t) + dB*t)));
      pixels[idx + 3] = Math.round(255 * edgeAlpha(px, py));
    }
  }

  return pixels;
}

// ── 실행 ──────────────────────────────────────────────────────────────────
fs.mkdirSync(OUT, { recursive: true });
for (let v = 0; v < 8; v++) {
  const pixels = makeTile(v);
  const fname  = path.join(OUT, `forest_to_dirt_${String(v).padStart(2,'0')}.png`);
  fs.writeFileSync(fname, encodePNG(pixels, W, H));
  console.log(`생성: forest_to_dirt_${String(v).padStart(2,'0')}.png  (variant ${v}, angle ${v*45}°)`);
}
console.log('완료: 8개 forest_to_dirt 타일');
