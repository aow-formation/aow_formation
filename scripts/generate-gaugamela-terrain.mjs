import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'web', 'data', 'scenarios');
const outFile = path.join(outDir, 'gaugamela_terrain.json');

const MAP_WIDTH = 240;
const MAP_HEIGHT = 160;
const seed = Number(process.env.GAUGAMELA_TERRAIN_SEED || 20260517);

function hash(x, y) {
  let h = Math.imul(x + 374761393, 668265263) ^ Math.imul(y + 1442695041, 2246822519) ^ seed;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

function noise01(x, y, scale = 1) {
  return (hash(Math.floor(x / scale), Math.floor(y / scale)) % 1000) / 1000;
}

function smoothNoise(x, y, scale = 16) {
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
  return (a + (b - a) * easeX) + ((c + (d - c) * easeX) - (a + (b - a) * easeX)) * easeY;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
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

// A deliberately open plain. The edges are dry grass, but the center remains
// clear so cavalry and phalanx movement stays readable.
for (let y = 0; y < MAP_HEIGHT; y += 1) {
  for (let x = 0; x < MAP_WIDTH; x += 1) {
    const topEdge = 18 + Math.sin(x / 22) * 5 + (smoothNoise(x, 12, 18) - 0.5) * 7;
    const bottomEdge = 139 + Math.sin((x - 40) / 25) * 5 + (smoothNoise(x, 132, 18) - 0.5) * 8;
    if (y < topEdge || y > bottomEdge) tiles[y][x] = 'grassland';
    if ((x > 196 && y > 42 && y < 120 && smoothNoise(x, y, 11) > 0.73) ||
        (x < 28 && smoothNoise(x, y, 13) > 0.82)) {
      tiles[y][x] = 'grassland';
    }
  }
}

// Cleared approach lanes and the Persian royal road behind the line.
paintRibbon([[20, 80], [74, 80], [128, 80], [198, 80], [232, 80]], 4, 'road');
paintRibbon([[166, 64], [188, 72], [210, 82], [232, 88]], 3, 'road');

// Tiny patches that make the viewer less sterile without obstructing tactics.
paintDisc(32, 28, 7, 'grassland');
paintDisc(46, 133, 6, 'grassland');
paintDisc(210, 28, 8, 'grassland');
paintDisc(224, 132, 8, 'grassland');

const terrain = {
  id: 'gaugamela',
  name: 'Battle of Gaugamela',
  generatedAt: new Date().toISOString(),
  generator: 'scripts/generate-gaugamela-terrain.mjs',
  seed,
  mapWidth: MAP_WIDTH,
  mapHeight: MAP_HEIGHT,
  tiles,
  playerStart: { x: 42, y: 80 },
  enemyStart: { x: 182, y: 82 },
  markers: {
    macedonLineRect: { x: 48, y: 54, w: 18, h: 52 },
    alexanderRally: { x: 54, y: 42, radius: 8 },
    holdLineRect: { x: 72, y: 56, w: 18, h: 48 },
    persianGap: { x: 138, y: 76, radius: 10 },
    dariusCamp: { x: 188, y: 80, radius: 12 },
    parmenionWing: { x: 70, y: 112, radius: 8 },
    dariusRetreat: { x: 232, y: 82, radius: 8 }
  }
};

await mkdir(outDir, { recursive: true });
await writeFile(outFile, `${JSON.stringify(terrain, null, 2)}\n`, 'utf8');
console.log(`Wrote ${path.relative(root, outFile)} (${MAP_WIDTH}x${MAP_HEIGHT}, seed ${seed})`);
