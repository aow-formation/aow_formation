import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'web', 'data', 'scenarios');
const outFile = path.join(outDir, 'gwiju_terrain.json');

const MAP_WIDTH = 240;
const MAP_HEIGHT = 160;
const seed = Number(process.env.GWIJU_TERRAIN_SEED || 20260517);

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
      const n = ((hash(Math.round(x0 + step), Math.round(y0 + step)) % 1000) / 1000 - 0.5) * 1.4;
      paintDisc(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, radius + n, type);
    }
  }
}

// River crossing: a broad diagonal river that traps the Khitan center.
const river = [[104, -12], [112, 24], [120, 58], [126, 88], [136, 122], [148, 172]];
paintRibbon(river, 19, 'wetland');
paintRibbon(river, 10, 'river');

// Ford and approach roads.
paintRibbon([[198, 82], [164, 82], [136, 82], [112, 82], [72, 84], [38, 82]], 5, 'road');
paintRibbon([[192, 58], [158, 66], [128, 76], [100, 86]], 3, 'road');

// Goryeo ambush cover and Khitan entry plain.
paintRect(22, 46, 58, 82, 'grassland');
paintRect(176, 48, 48, 72, 'plain');
paintDisc(52, 42, 12, 'grassland');
paintDisc(52, 116, 12, 'grassland');

// Flood gate bank and muddy lower river.
paintDisc(96, 30, 7, 'grassland');
paintDisc(138, 118, 14, 'wetland');
paintDisc(120, 44, 10, 'wetland');

// Small organic plain/grass variation.
for (let i = 0; i < 32; i += 1) {
  const x = 10 + (hash(i, 3) % 220);
  const y = 18 + (hash(i, 5) % 124);
  if (tiles[y][x] === 'plain' && hash(i, 7) % 100 < 30) paintDisc(x, y, 2 + (hash(i, 9) % 4), 'grassland');
}

const terrain = {
  id: 'gwiju',
  name: 'Battle of Gwiju',
  generatedAt: new Date().toISOString(),
  generator: 'scripts/generate-gwiju-terrain.mjs',
  seed,
  mapWidth: MAP_WIDTH,
  mapHeight: MAP_HEIGHT,
  tiles,
  playerStart: { x: 48, y: 82 },
  enemyStart: { x: 196, y: 82 },
  markers: {
    goryeoHoldRect: { x: 42, y: 58, w: 24, h: 44 },
    cavalryAmbushNorth: { x: 52, y: 42, radius: 8 },
    cavalryAmbushSouth: { x: 52, y: 116, radius: 8 },
    khitanCrossingRect: { x: 108, y: 42, w: 34, h: 76 },
    floodGate: { x: 96, y: 30, radius: 8 },
    floodDamageRect: { x: 98, y: 38, w: 52, h: 88 },
    pursuitLineRect: { x: 126, y: 56, w: 24, h: 52 },
    khitanEntryRect: { x: 190, y: 56, w: 24, h: 52 },
    khitanRetreat: { x: 238, y: 82, radius: 8 }
  }
};

await mkdir(outDir, { recursive: true });
await writeFile(outFile, `${JSON.stringify(terrain, null, 2)}\n`, 'utf8');
console.log(`Wrote ${path.relative(root, outFile)} (${MAP_WIDTH}x${MAP_HEIGHT}, seed ${seed})`);
