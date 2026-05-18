import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'web', 'data', 'scenarios');
const outFile = path.join(outDir, 'bomangpa_terrain.json');

const MAP_WIDTH = 240;
const MAP_HEIGHT = 160;
const seed = Number(process.env.BOMANGPA_TERRAIN_SEED || 20260517);

function hash(x, y) {
  let h = Math.imul(x + 374761393, 668265263) ^ Math.imul(y + 1442695041, 2246822519) ^ seed;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

const tiles = Array.from({ length: MAP_HEIGHT }, () =>
  Array.from({ length: MAP_WIDTH }, () => 'grassland'));

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
      const n = ((hash(Math.round(x0 + step), Math.round(y0 + step)) % 1000) / 1000 - 0.5) * 1.2;
      paintDisc(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, radius + n, type);
    }
  }
}

// Dense forest belts around the narrow road.
paintRect(0, 0, MAP_WIDTH - 1, 48, 'mountain');
paintRect(0, 112, MAP_WIDTH - 1, 47, 'mountain');
paintRibbon([[20, 80], [64, 82], [100, 78], [134, 82], [176, 78], [222, 82]], 11, 'plain');
paintRibbon([[20, 80], [64, 82], [100, 78], [134, 82], [176, 78], [222, 82]], 5, 'road');

// Ambush pockets and retreat basin.
paintRect(94, 38, 42, 22, 'grassland');
paintRect(94, 102, 42, 22, 'grassland');
paintDisc(58, 80, 18, 'plain');
paintDisc(126, 80, 20, 'plain');
paintDisc(196, 80, 18, 'plain');

// Fire trap: dry central forest mouth.
paintRect(116, 58, 42, 46, 'grassland');
paintRibbon([[112, 72], [128, 80], [154, 88]], 4, 'road');

// Rougher woods, small ponds, and visual variation.
for (let i = 0; i < 55; i += 1) {
  const x = 6 + (hash(i, 11) % 228);
  const y = 8 + (hash(i, 17) % 144);
  if (tiles[y][x] === 'mountain' && hash(i, 23) % 100 < 45) {
    paintDisc(x, y, 2 + (hash(i, 29) % 4), 'grassland');
  } else if (tiles[y][x] === 'grassland' && hash(i, 31) % 100 < 22) {
    paintDisc(x, y, 1 + (hash(i, 37) % 3), 'mountain');
  }
}

const terrain = {
  id: 'bomangpa',
  name: 'Battle of Bowangpo',
  generatedAt: new Date().toISOString(),
  generator: 'scripts/generate-bomangpa-terrain.mjs',
  seed,
  mapWidth: MAP_WIDTH,
  mapHeight: MAP_HEIGHT,
  tiles,
  playerStart: { x: 48, y: 82 },
  enemyStart: { x: 196, y: 82 },
  markers: {
    zhaoYunStart: { x: 58, y: 80, radius: 8 },
    lureEntryRect: { x: 92, y: 64, w: 26, h: 34 },
    ambushForestRect: { x: 116, y: 50, w: 42, h: 60 },
    fireTrapRect: { x: 118, y: 58, w: 38, h: 46 },
    retreatPoint: { x: 62, y: 82, radius: 10 },
    northAmbush: { x: 106, y: 48, radius: 8 },
    southAmbush: { x: 106, y: 112, radius: 8 },
    liuBeiRearRect: { x: 42, y: 70, w: 24, h: 24 },
    enemyEntryRect: { x: 184, y: 60, w: 26, h: 44 },
    enemyEscape: { x: 238, y: 82, radius: 8 }
  }
};

await mkdir(outDir, { recursive: true });
await writeFile(outFile, `${JSON.stringify(terrain, null, 2)}\n`, 'utf8');
console.log(`Wrote ${path.relative(root, outFile)} (${MAP_WIDTH}x${MAP_HEIGHT}, seed ${seed})`);
