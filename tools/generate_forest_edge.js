// forest_edge 전환 타일 생성 (Node.js, 외부 패키지 불필요)
const fs   = require('fs');
const zlib = require('zlib');
const path = require('path');

const TILE_W  = 128;
const TILE_H  = 64;
const VARIANTS = 8;
const OUT_DIR = path.join(__dirname, '../web/assets/terrain_tiles');

// ── CRC32 ──────────────────────────────────────────────────────────────────
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (const b of buf) { c ^= b; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const l = Buffer.alloc(4); l.writeUInt32BE(data.length);
  const crcInput = Buffer.concat([t, data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc32(crcInput));
  return Buffer.concat([l, t, data, c]);
}

// ── PNG 인코더 ──────────────────────────────────────────────────────────────
function encodePNG(pixels) {
  const sig = Buffer.from([137,80,78,71,13,10,26,10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(TILE_W, 0);
  ihdr.writeUInt32BE(TILE_H, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA

  // 스캔라인 (필터 바이트 0 + RGBA 데이터)
  const rowLen = 1 + TILE_W * 4;
  const raw = Buffer.alloc(TILE_H * rowLen, 0);
  for (let y = 0; y < TILE_H; y++) {
    raw[y * rowLen] = 0; // filter None
    pixels.copy(raw, y * rowLen + 1, y * TILE_W * 4, (y + 1) * TILE_W * 4);
  }

  const compressed = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', compressed), pngChunk('IEND', Buffer.alloc(0))]);
}

// ── 유틸리티 ───────────────────────────────────────────────────────────────
function inDiamond(px, py) {
  const cx = TILE_W / 2, cy = TILE_H / 2;
  return Math.abs((px - cx) / (TILE_W / 2)) + Math.abs((py - cy) / (TILE_H / 2)) <= 1.0;
}

function edgeFactor(px, py) {
  const cx = TILE_W / 2, cy = TILE_H / 2;
  const d  = Math.abs((px - cx) / (TILE_W / 2)) + Math.abs((py - cy) / (TILE_H / 2));
  const margin = 0.08;
  return d > 1 - margin ? Math.max(0, (1 - d) / margin) : 1;
}

// LCG 시드 난수
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 0xFFFFFFFF; };
}

// ── 타일 생성 ──────────────────────────────────────────────────────────────
function makeForestEdge(variant) {
  const rand = rng(700 + variant * 137);
  const pixels = Buffer.alloc(TILE_W * TILE_H * 4, 0);

  // 1) 베이스: 숲 바닥 (중간 녹색) 수직 그라디언트
  for (let y = 0; y < TILE_H; y++) {
    const t = y / (TILE_H - 1);
    const bR = Math.round(72  - t * 18);
    const bG = Math.round(100 - t * 22);
    const bB = Math.round(55  - t * 12);
    for (let x = 0; x < TILE_W; x++) {
      if (!inDiamond(x, y)) continue;
      const noise = Math.round((rand() - 0.5) * 16);
      const ef    = edgeFactor(x, y);
      const idx   = (y * TILE_W + x) * 4;
      pixels[idx]     = Math.max(0, Math.min(255, bR + noise));
      pixels[idx + 1] = Math.max(0, Math.min(255, bG + noise));
      pixels[idx + 2] = Math.max(0, Math.min(255, bB + noise));
      pixels[idx + 3] = Math.round(255 * ef);
    }
  }

  // 2) 나무 클러스터 (전체 숲보다 듬성듬성: 8~12개)
  const numClusters = 8 + Math.floor(rand() * 5);
  for (let c = 0; c < numClusters; c++) {
    const cx = Math.floor(rand() * (TILE_W - 28)) + 14;
    const cy = Math.floor(rand() * (TILE_H - 18)) + 9;
    const rx = Math.floor(rand() * 9) + 5;
    const ry = Math.floor(rand() * 5) + 3;
    const dR = 28 + Math.floor(rand() * 18);
    const dG = 52 + Math.floor(rand() * 22);
    const dB = 22 + Math.floor(rand() * 14);

    for (let py = Math.max(0, cy - ry - 1); py <= Math.min(TILE_H - 1, cy + ry + 1); py++) {
      for (let px = Math.max(0, cx - rx - 1); px <= Math.min(TILE_W - 1, cx + rx + 1); px++) {
        if (!inDiamond(px, py)) continue;
        const dist = ((px - cx) / rx) ** 2 + ((py - cy) / ry) ** 2;
        if (dist > 1) continue;
        const blend = (1 - dist) * 0.75; // 투명하게 블렌딩
        const idx   = (py * TILE_W + px) * 4;
        pixels[idx]     = Math.round(pixels[idx]     * (1 - blend) + dR * blend);
        pixels[idx + 1] = Math.round(pixels[idx + 1] * (1 - blend) + dG * blend);
        pixels[idx + 2] = Math.round(pixels[idx + 2] * (1 - blend) + dB * blend);
      }
    }
  }

  // 3) 아웃라인 (기존 타일과 동일한 스타일)
  for (let py = 0; py < TILE_H; py++) {
    for (let px = 0; px < TILE_W; px++) {
      const ef = edgeFactor(px, py);
      if (ef > 0 && ef < 0.3 && inDiamond(px, py)) {
        const idx = (py * TILE_W + px) * 4;
        pixels[idx]     = Math.round(pixels[idx]     * 0.7);
        pixels[idx + 1] = Math.round(pixels[idx + 1] * 0.7);
        pixels[idx + 2] = Math.round(pixels[idx + 2] * 0.7);
      }
    }
  }

  return pixels;
}

// ── 실행 ───────────────────────────────────────────────────────────────────
fs.mkdirSync(OUT_DIR, { recursive: true });
for (let i = 0; i < VARIANTS; i++) {
  const pixels = makeForestEdge(i);
  const png    = encodePNG(pixels);
  const fname  = path.join(OUT_DIR, `forest_edge_${String(i).padStart(2,'0')}.png`);
  fs.writeFileSync(fname, png);
  console.log(`생성: ${path.basename(fname)}`);
}
console.log(`완료: ${VARIANTS}개 forest_edge 타일`);
