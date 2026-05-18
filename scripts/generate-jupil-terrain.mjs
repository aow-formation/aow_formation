import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'web', 'data', 'scenarios');
const outFile = path.join(outDir, 'jupil_terrain.json');

const MAP_WIDTH = 240;
const MAP_HEIGHT = 160;
const seed = Number(process.env.JUPIL_TERRAIN_SEED || 20260517);

function hash(x, y) {
  let h = Math.imul(x + 374761393, 668265263) ^ Math.imul(y + 1442695041, 2246822519) ^ seed;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function noise01(x, y, scale = 1) {
  return (hash(Math.floor(x / scale), Math.floor(y / scale)) % 1000) / 1000;
}

function smoothNoise(x, y, scale = 14) {
  const gx = x / scale;
  const gy = y / scale;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const tx = gx - x0;
  const ty = gy - y0;
  const easeX = tx * tx * (3 - 2 * tx);
  const easeY = ty * ty * (3 - 2 * ty);
  const a = noise01(x0, y0);
  const b = noise01(x0 + 1, y0);
  const c = noise01(x0, y0 + 1);
  const d = noise01(x0 + 1, y0 + 1);
  const top = a + (b - a) * easeX;
  const bottom = c + (d - c) * easeX;
  return top + (bottom - top) * easeY;
}

const tiles = Array.from({ length: MAP_HEIGHT }, () =>
  Array.from({ length: MAP_WIDTH }, () => 'plain'));

function paintDisc(cx, cy, radius, type) {
  const minX = clamp(Math.floor(cx - radius), 0, MAP_WIDTH - 1);
  const maxX = clamp(Math.ceil(cx + radius), 0, MAP_WIDTH - 1);
  const minY = clamp(Math.floor(cy - radius), 0, MAP_HEIGHT - 1);
  const maxY = clamp(Math.ceil(cy + radius), 0, MAP_HEIGHT - 1);
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= radius * radius) tiles[y][x] = type;
    }
  }
}

function paintRect(x, y, w, h, type) {
  for (let yy = clamp(y, 0, MAP_HEIGHT - 1); yy <= clamp(y + h, 0, MAP_HEIGHT - 1); yy += 1) {
    for (let xx = clamp(x, 0, MAP_WIDTH - 1); xx <= clamp(x + w, 0, MAP_WIDTH - 1); xx += 1) {
      tiles[yy][xx] = type;
    }
  }
}

function paintRibbon(points, radius, type) {
  for (let i = 0; i < points.length - 1; i += 1) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      paintDisc(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, radius, type);
    }
  }
}

// Mountain mass wrapping the lower route and eastern camp.
for (let y = 0; y < MAP_HEIGHT; y += 1) {
  for (let x = 0; x < MAP_WIDTH; x += 1) {
    const lowerEdge = 106 + Math.sin(x / 18) * 7 + (smoothNoise(x, y, 16) - 0.5) * 8;
    const upperRidge = 18 + Math.sin((x - 20) / 20) * 5 + (smoothNoise(x, y, 20) - 0.5) * 6;
    if (y > lowerEdge) tiles[y][x] = 'mountain';
    if (y < upperRidge && x > 70) tiles[y][x] = 'grassland';
  }
}

// Central battlefield and Tang approach.
paintRibbon([[18, 88], [56, 82], [92, 80], [126, 80], [164, 82]], 7, 'road');
paintRect(52, 62, 34, 48, 'plain');
paintRect(118, 54, 52, 58, 'plain');

// Mountain bypass, carved as a narrow readable path.
const bypass = [[48, 118], [68, 124], [94, 132], [124, 126], [154, 112], [178, 94]];
paintRibbon(bypass, 9, 'grassland');
paintRibbon(bypass, 4, 'road');

// Rear camp and command spaces.
paintRect(176, 74, 26, 24, 'plain');
paintRibbon([[166, 82], [186, 84], [206, 86]], 3, 'road');

// Small texture patches.
for (let i = 0; i < 28; i += 1) {
  const x = 12 + (hash(i, 4) % 210);
  const y = 24 + (hash(i, 9) % 104);
  const current = tiles[y][x];
  if (current === 'plain' && hash(i, 11) % 100 < 35) paintDisc(x, y, 2 + (hash(i, 13) % 4), 'grassland');
  if (current === 'grassland' && hash(i, 15) % 100 < 25) paintDisc(x, y, 2 + (hash(i, 17) % 3), 'plain');
}

const terrain = {
  id: 'jupil',
  name: 'Battle of Mount Jupil',
  generatedAt: new Date().toISOString(),
  generator: 'scripts/generate-jupil-terrain.mjs',
  seed,
  mapWidth: MAP_WIDTH,
  mapHeight: MAP_HEIGHT,
  tiles,
  playerStart: { x: 36, y: 92 },
  enemyStart: { x: 148, y: 82 },
  markers: {
    tangFrontLineRect: { x: 58, y: 66, w: 20, h: 34 },
    tangBypassStart: { x: 50, y: 112, radius: 8 },
    bypassPoint1: { x: 68, y: 124, radius: 8 },
    bypassPoint2: { x: 124, y: 126, radius: 8 },
    bypassPoint3: { x: 176, y: 96, radius: 8 },
    rearCampRect: { x: 178, y: 76, w: 22, h: 22 },
    goguryeoMainLineRect: { x: 128, y: 58, w: 34, h: 48 },
    goguryeoCommand: { x: 184, y: 84, radius: 10 },
    goguryeoRetreat: { x: 232, y: 84, radius: 8 }
  }
};

await mkdir(outDir, { recursive: true });
await writeFile(outFile, `${JSON.stringify(terrain, null, 2)}\n`, 'utf8');
console.log(`Wrote ${path.relative(root, outFile)} (${MAP_WIDTH}x${MAP_HEIGHT}, seed ${seed})`);
