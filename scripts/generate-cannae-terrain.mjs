import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'web', 'data', 'scenarios');
const outFile = path.join(outDir, 'cannae_terrain.json');

const MAP_WIDTH = 240;
const MAP_HEIGHT = 160;
const seed = Number(process.env.CANNAE_TERRAIN_SEED || 20260516);

function mulberry32(value) {
  let state = value >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(seed);
const tiles = Array.from({ length: MAP_HEIGHT }, () =>
  Array.from({ length: MAP_WIDTH }, () => 'plain'));

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

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

function paintPolygon(points, type) {
  const minX = clamp(Math.floor(Math.min(...points.map(p => p[0]))), 0, MAP_WIDTH - 1);
  const maxX = clamp(Math.ceil(Math.max(...points.map(p => p[0]))), 0, MAP_WIDTH - 1);
  const minY = clamp(Math.floor(Math.min(...points.map(p => p[1]))), 0, MAP_HEIGHT - 1);
  const maxY = clamp(Math.ceil(Math.max(...points.map(p => p[1]))), 0, MAP_HEIGHT - 1);
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      let inside = false;
      for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
        const xi = points[i][0], yi = points[i][1];
        const xj = points[j][0], yj = points[j][1];
        const intersect = ((yi > y) !== (yj > y)) &&
          (x < (xj - xi) * (y - yi) / ((yj - yi) || 0.0001) + xi);
        if (intersect) inside = !inside;
      }
      if (inside) tiles[y][x] = type;
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
      const x = x0 + (x1 - x0) * t;
      const y = y0 + (y1 - y0) * t;
      const edgeNoise = ((hash(Math.round(x), Math.round(y)) % 1000) / 1000 - 0.5) * 1.8;
      paintDisc(x, y, radius + edgeNoise, type);
    }
  }
}

function hash(x, y) {
  let h = Math.imul(x + 374761393, 668265263) ^ Math.imul(y + 1442695041, 2246822519) ^ seed;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

function noise01(x, y, scale = 1) {
  const sx = Math.floor(x / scale);
  const sy = Math.floor(y / scale);
  return (hash(sx, sy) % 1000) / 1000;
}

function smoothNoise(x, y, scale = 12) {
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

// Northern Aufidus river: broad, winding, and close to the upper edge.
const riverPath = [
  [-12, 12], [18, 11], [48, 19], [82, 31], [116, 40],
  [156, 42], [178, 36], [202, 24], [226, 10], [252, -4],
];
paintRibbon(riverPath, 15, 'wetland');
paintRibbon(riverPath, 9, 'river');

// Left-side green river plain, kept as a large organic mass.
paintPolygon([
  [-8, 35], [8, 35], [28, 40], [44, 48], [54, 58],
  [50, 66], [36, 73], [18, 77], [5, 84], [-8, 88],
], 'grassland');

// Southern green belt and mountain base.
for (let x = 0; x < MAP_WIDTH; x += 1) {
  const broad = (smoothNoise(x, 40, 30) - 0.5) * 9;
  const mid = (smoothNoise(x, 90, 14) - 0.5) * 6;
  const fine = (smoothNoise(x, 130, 7) - 0.5) * 3;
  const grassEdge = 124 + Math.sin(x / 20) * 5 + Math.sin((x - 75) / 11) * 2
    - Math.exp(-((x - 190) ** 2) / 900) * 10 + broad + mid;
  const mountainEdge = 145 + Math.sin((x - 20) / 15) * 6
    - Math.exp(-((x - 112) ** 2) / 500) * 9
    - Math.exp(-((x - 220) ** 2) / 320) * 16 + broad * 0.5 + mid + fine;
  for (let y = 0; y < MAP_HEIGHT; y += 1) {
    const n = (smoothNoise(x, y, 9) - 0.5) * 5;
    if (y >= grassEdge + n) tiles[y][x] = 'grassland';
    if (y >= mountainEdge + n) tiles[y][x] = 'mountain';
  }
}

// Slightly break up the large plain/grass boundaries without changing the mission layout.
for (let i = 0; i < 36; i += 1) {
  const cx = 8 + Math.floor(rand() * 224);
  const cy = 46 + Math.floor(rand() * 86);
  const radius = 2 + Math.floor(rand() * 4);
  const current = tiles[cy]?.[cx];
  if (current === 'plain' && rand() < 0.45) paintDisc(cx, cy, radius, 'grassland');
  if (current === 'grassland' && rand() < 0.55) paintDisc(cx, cy, radius, 'plain');
}

// A pale dry track across the lower half of the central plain.
const roadPath = [
  [-10, 102], [40, 103], [82, 100], [118, 94],
  [154, 88], [190, 79], [250, 70],
];
paintRibbon(roadPath, 6, 'road');

// Small southern rocky/green accents matching the hand-painted reference.
paintDisc(176, 135, 6, 'mountain');
paintDisc(207, 133, 10, 'grassland');
paintDisc(224, 144, 16, 'mountain');
paintDisc(112, 150, 18, 'mountain');
paintDisc(15, 153, 9, 'mountain');

const terrain = {
  id: 'cannae',
  name: 'Battle of Cannae',
  generatedAt: new Date().toISOString(),
  generator: 'scripts/generate-cannae-terrain.mjs',
  seed,
  mapWidth: MAP_WIDTH,
  mapHeight: MAP_HEIGHT,
  tiles,
  playerStart: { x: 42, y: 80 },
  enemyStart: { x: 178, y: 80 },
  markers: {
    playerRallyRect: { x: 78, y: 42, w: 18, h: 78 },
    enemyRallyRect: { x: 118, y: 56, w: 26, h: 50 },
    retreatRect: { x: 40, y: 66, w: 28, h: 34 },
    romanCenterTrap: { x: 98, y: 82 },
    romanNorthCavalry: { x: 128, y: 60 },
    romanSouthCavalry: { x: 128, y: 100 }
  }
};

await mkdir(outDir, { recursive: true });
await writeFile(outFile, `${JSON.stringify(terrain, null, 2)}\n`, 'utf8');
console.log(`Wrote ${path.relative(root, outFile)} (${MAP_WIDTH}x${MAP_HEIGHT}, seed ${seed})`);
