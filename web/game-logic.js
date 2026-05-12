// ── 상수 ─────────────────────────────────────────────────────────────
export const MAP_WIDTH  = 240;
export const MAP_HEIGHT = 160;
export const CHUNK_TILES = 16;
export const SIMULATION_STEP = 1 / 30;
export const MAX_SIMULATION_STEPS = 4;
export const SPATIAL_CELL_SIZE = 4;
export const UNIT_RADIUS = 0.27;
export const TILE_W_MIN = 16;
export const TILE_W_MAX = 24;
export const DEFAULT_TILE_W = 24;
export const ZOOM_LEVELS = [16, 20, 24];

export const NAME_POOL = [
  "관우","장비","조조","유비","제갈량","사마의","손권","주유","여포","조운",
  "황충","마초","강유","육손","장료","허저","전위","문앙","등애","종회",
  "이순신","강감찬","을지문덕","계백","김유신","연개소문","최영","이성계",
  "오다노부나가","도요토미히데요시","도쿠가와이에야스","다케다신겐","우에스기겐신",
  "한니발","카이사르","알렉산드로스","나폴레옹","살라딘","아틸라"
];

export const terrainInfo = {
  plain:    { color: "#ae9360", move: 1.0,  defense:  0 },
  road:     { color: "#cfb07c", move: 1.6,  defense:  0 },
  river:    { color: "#6baed2", move: 0.3,  defense: -2 },
  mountain: { color: "#61705a", move: 0.70, defense:  3 },
};

export const densityInfo = {
  TIGHT:  { spacing: 0.60, defense:  1.5 },
  NORMAL: { spacing: 0.82, defense:  0.0 },
  WIDE:   { spacing: 1.08, defense: -1.5 },
};

export const speedInfo = {
  STOP:   { move: 0.0,  defense:  2.0, attack: 0.85, reaction: 2.5 },
  SLOW:   { move: 0.55, defense:  1.0, attack: 0.95, reaction: 3.2 },
  NORMAL: { move: 0.9,  defense:  0.0, attack: 1.05, reaction: 4.0 },
  FAST:   { move: 1.35, defense: -1.0, attack: 1.20, reaction: 5.0 },
};

// ── 수학 유틸 ─────────────────────────────────────────────────────────
export const rand  = (min, max) => Math.random() * (max - min) + min;
export const clamp = (v, mn, mx) => Math.max(mn, Math.min(mx, v));
export const len   = (x, y) => Math.hypot(x, y);

export function vec(x = 0, y = 0)  { return { x, y }; }
export function add(a, b) { return { x: a.x + b.x, y: a.y + b.y }; }
export function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y }; }
export function mul(v, s) { return { x: v.x * s,   y: v.y * s   }; }
export function normalize(v) {
  const l = len(v.x, v.y);
  return l > 0.0001 ? { x: v.x / l, y: v.y / l } : { x: 0, y: 0 };
}
export function lerp(a, b, t) { return a + (b - a) * t; }

// ── 좌표 변환 (게임 상태 의존, canvas 불필요) ─────────────────────────
export function getTileH() { return Math.floor(game.tileW / 2); }

export function isoPoint(x, y) {
  return { x: (x - y) * (game.tileW / 2), y: (x + y) * (getTileH() / 2) };
}

export function centerCameraOn(pos) {
  const iso = isoPoint(pos.x, pos.y);
  game.camera.x = iso.x;
  game.camera.y = iso.y - 140;
}

// ── 지형 노이즈 해시 ──────────────────────────────────────────────────
export function tileHash(x, y) {
  const value = Math.imul(x + 11, 374761393) ^ Math.imul(y + 17, 668265263);
  return (value ^ value >>> 13) >>> 0;
}

// ── 지형 생성 ─────────────────────────────────────────────────────────
export function buildTerrain() {
  const tiles = Array.from({ length: MAP_HEIGHT }, () =>
    Array.from({ length: MAP_WIDTH }, () => "plain"));

  function paintDisc(cx, cy, radius, type) {
    for (let y = Math.max(0, cy - radius); y <= Math.min(MAP_HEIGHT - 1, cy + radius); y++) {
      for (let x = Math.max(0, cx - radius); x <= Math.min(MAP_WIDTH - 1, cx + radius); x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 <= radius * radius) tiles[y][x] = type;
      }
    }
  }

  const playerStart = vec(MAP_WIDTH * 0.08, MAP_HEIGHT * 0.5);
  const enemyStart  = vec(MAP_WIDTH * 0.92, MAP_HEIGHT * 0.5);

  // 프랙탈 노이즈
  const noiseSeed = Math.floor(Math.random() * 99991);
  function noiseVal(xi, yi) {
    return (tileHash(xi * 7919 + noiseSeed, yi * 6271 + noiseSeed * 2) % 100000) / 100000;
  }
  function smoothNoise(x, y, scale) {
    const xi = Math.floor(x / scale), yi = Math.floor(y / scale);
    const fx = (x / scale) - xi,   fy = (y / scale) - yi;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    return noiseVal(xi, yi)   * (1-sx)*(1-sy)
         + noiseVal(xi+1, yi) * sx*(1-sy)
         + noiseVal(xi, yi+1) * (1-sx)*sy
         + noiseVal(xi+1,yi+1)* sx*sy;
  }
  function fractalNoise(x, y) {
    return smoothNoise(x, y, 32) * 0.55
         + smoothNoise(x, y, 14) * 0.30
         + smoothNoise(x, y,  6) * 0.15;
  }

  // 강 (50% 확률)
  function edgeBiased(minV, maxV, power) {
    const u = Math.random();
    const a = Math.pow(Math.abs(2 * u - 1), power);
    const s = u < 0.5 ? -a : a;
    return Math.floor(clamp(((s + 1) / 2) * (maxV - minV) + minV, minV, maxV));
  }
  function edgePoint(edge) {
    if (edge === 0) return [edgeBiased(Math.floor(MAP_WIDTH  * 0.1), Math.floor(MAP_WIDTH  * 0.9), 0.55), 0];
    if (edge === 1) return [edgeBiased(Math.floor(MAP_WIDTH  * 0.1), Math.floor(MAP_WIDTH  * 0.9), 0.55), MAP_HEIGHT - 1];
    if (edge === 2) return [0,            edgeBiased(Math.floor(MAP_HEIGHT * 0.1), Math.floor(MAP_HEIGHT * 0.9), 0.07)];
    return [MAP_WIDTH - 1, edgeBiased(Math.floor(MAP_HEIGHT * 0.1), Math.floor(MAP_HEIGHT * 0.9), 0.07)];
  }

  let riverGenerated = false;
  if (Math.random() < 0.50) {
    riverGenerated = true;
    const startEdge = Math.floor(Math.random() * 4);
    let endEdge;
    do { endEdge = Math.floor(Math.random() * 4); } while (endEdge === startEdge);
    let [x, y] = edgePoint(startEdge);
    const [tx, ty] = edgePoint(endEdge);
    const baseRadius  = 5 + Math.floor(Math.random() * 4);
    const maxSteps    = (MAP_WIDTH + MAP_HEIGHT) * 6;
    let currentDrift  = (Math.random() - 0.5) * 3.0;
    for (let step = 0; step < maxSteps; step++) {
      if (x < 0 || x >= MAP_WIDTH || y < 0 || y >= MAP_HEIGHT) break;
      if (Math.abs(x - tx) <= 2 && Math.abs(y - ty) <= 2) break;
      const r = Math.max(1, baseRadius + (Math.random() < 0.20 ? (Math.random() < 0.5 ? 1 : -1) : 0));
      paintDisc(x, y, r, "river");
      currentDrift += (Math.random() - 0.5) * 0.5;
      currentDrift = clamp(currentDrift, -2.2, 2.2);
      if (step > 20 && (x <= 1 || x >= MAP_WIDTH - 2 || y <= 1 || y >= MAP_HEIGHT - 2)) break;
      const dx = tx - x, dy = ty - y;
      const d = Math.sqrt(dx * dx + dy * dy);
      const ndx = dx / d, ndy = dy / d;
      const mx = ndx + (-ndy) * currentDrift;
      const my = ndy + ( ndx) * currentDrift;
      let sx, sy;
      if (Math.abs(mx) >= Math.abs(my)) {
        sx = Math.sign(mx);
        sy = Math.random() < Math.abs(my / (Math.abs(mx) + 0.001)) ? Math.sign(my) : 0;
      } else {
        sy = Math.sign(my);
        sx = Math.random() < Math.abs(mx / (Math.abs(my) + 0.001)) ? Math.sign(mx) : 0;
      }
      x = clamp(x + (sx || 0), 0, MAP_WIDTH  - 1);
      y = clamp(y + (sy || 0), 0, MAP_HEIGHT - 1);
    }
  }

  // 강 거리 맵 (BFS)
  const rDist = new Uint16Array(MAP_WIDTH * MAP_HEIGHT).fill(9999);
  if (riverGenerated) {
    const rQ = [];
    for (let ry = 0; ry < MAP_HEIGHT; ry++)
      for (let rx = 0; rx < MAP_WIDTH; rx++)
        if (tiles[ry][rx] === "river") { rDist[ry * MAP_WIDTH + rx] = 0; rQ.push(ry * MAP_WIDTH + rx); }
    for (let qi = 0; qi < rQ.length; qi++) {
      const k = rQ[qi];
      const cx = k % MAP_WIDTH, cy = Math.floor(k / MAP_WIDTH);
      const cd = rDist[k];
      if (cd >= 20) continue;
      for (const [ddx, ddy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nx = cx + ddx, ny = cy + ddy;
        if (nx < 0 || ny < 0 || nx >= MAP_WIDTH || ny >= MAP_HEIGHT) continue;
        const nk = ny * MAP_WIDTH + nx;
        if (rDist[nk] > cd + 1) { rDist[nk] = cd + 1; rQ.push(nk); }
      }
    }
  }

  // 산 (프랙탈 노이즈 + 강 회피)
  for (let y = 0; y < MAP_HEIGHT; y++) {
    for (let x = 0; x < MAP_WIDTH; x++) {
      if (tiles[y][x] === "river") continue;
      const noise    = fractalNoise(x, y);
      const xFactor  = 1 - Math.abs(x - MAP_WIDTH  / 2) / (MAP_WIDTH  / 2);
      const yFactor  = Math.abs(y - MAP_HEIGHT / 2) / (MAP_HEIGHT / 2);
      const density  = xFactor * yFactor;
      const edgePenalty  = (1 - xFactor) * (1 - yFactor) * 0.38;
      const riverPenalty = Math.max(0, 10 - rDist[y * MAP_WIDTH + x]) * 0.030;
      const base     = riverGenerated ? 0.62 : 0.58;
      if (noise > base - density * 0.30 + edgePenalty + riverPenalty) tiles[y][x] = "mountain";
    }
  }

  // 길 (산 거리 기반 평활 경로)
  {
    const mDist = new Uint16Array(MAP_WIDTH * MAP_HEIGHT).fill(9999);
    const bQ = [];
    for (let my = 0; my < MAP_HEIGHT; my++)
      for (let mx = 0; mx < MAP_WIDTH; mx++)
        if (tiles[my][mx] === "mountain") { mDist[my * MAP_WIDTH + mx] = 0; bQ.push(my * MAP_WIDTH + mx); }
    for (let qi = 0; qi < bQ.length; qi++) {
      const k = bQ[qi];
      const cx = k % MAP_WIDTH, cy = Math.floor(k / MAP_WIDTH);
      const cd = mDist[k];
      if (cd >= 18) continue;
      for (const [ddx, ddy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nx = cx + ddx, ny = cy + ddy;
        if (nx < 0 || ny < 0 || nx >= MAP_WIDTH || ny >= MAP_HEIGHT) continue;
        const nk = ny * MAP_WIDTH + nx;
        if (mDist[nk] > cd + 1) { mDist[nk] = cd + 1; bQ.push(nk); }
      }
    }
    let smoothY = MAP_HEIGHT / 2;
    for (let x = 0; x < MAP_WIDTH; x++) {
      let bestY = Math.round(smoothY), bestScore = -Infinity;
      for (let dy = -20; dy <= 20; dy++) {
        const cy = clamp(Math.round(smoothY) + dy, 2, MAP_HEIGHT - 3);
        const score = mDist[cy * MAP_WIDTH + x]
          - Math.abs(cy - MAP_HEIGHT / 2) * 0.25
          - Math.abs(cy - smoothY) * 0.6;
        if (score > bestScore) { bestScore = score; bestY = cy; }
      }
      smoothY = smoothY * 0.88 + bestY * 0.12;
      const ry = clamp(Math.round(smoothY), 2, MAP_HEIGHT - 3);
      const roadR = 3;
      for (let py = Math.max(0, ry - roadR); py <= Math.min(MAP_HEIGHT - 1, ry + roadR); py++) {
        for (let px = Math.max(0, x - roadR); px <= Math.min(MAP_WIDTH - 1, x + roadR); px++) {
          if ((px - x) ** 2 + (py - ry) ** 2 <= roadR * roadR && tiles[py][px] !== "river")
            tiles[py][px] = "road";
        }
      }
    }
  }

  return { tiles, playerStart, enemyStart };
}

// ── 시나리오 생성 ─────────────────────────────────────────────────────
export function chooseNames() {
  const pool = [...NAME_POOL], names = [];
  while (names.length < 10) {
    const i = Math.floor(Math.random() * pool.length);
    names.push(pool.splice(i, 1)[0]);
  }
  return names;
}

export function createGeneral(name) {
  return {
    name,
    power:      Math.floor(rand(45, 100)),
    leadership: Math.floor(rand(40, 100)),
    charm:      Math.floor(rand(35, 100)),
    troops: 10000, kills: 0, losses: 0, alive: true,
  };
}

export function createFormation(id, team, general, anchor, facing) {
  const units = [];
  for (let i = 0; i < general.troops / 100; i++) {
    units.push({
      id: `${team}-${id}-${i}`,
      x: anchor.x, y: anchor.y, vx: 0, vy: 0,
      damage: 0, slotIndex: i, slotLocal: vec(),
      chaosSeed: Math.random(),
      chaosPhaseOffset: Math.random() * Math.PI * 2,
      chaseEntry: null, chaseTimer: 0,
      rangedCooldown: Math.random(),
      isWalking: false,
    });
  }
  return {
    id, team, general,
    anchor: { ...anchor }, units,
    ratio: 1.0, density: "NORMAL", speed: "STOP",
    target: null, followTarget: null,
    retreated: false, retreating: false, retreatLastCheckpoint: 1.0,
    disorder: 0, facing: { ...facing }, selected: false,
    reorganizeTimer: 3.0 + Math.random() * 3.0,
  };
}

export function buildScenario() {
  const names    = chooseNames();
  const terrain  = buildTerrain();
  const playerGenerals = names.slice(0, 5).map(createGeneral);
  const enemyGenerals  = names.slice(5).map(createGeneral);
  const playerFormations = playerGenerals.map((g, i) => {
    const f = createFormation(i, "player", g, vec(terrain.playerStart.x, terrain.playerStart.y + (i - 2) * 10), vec(1, 0));
    initializeFormationSlots(f, false);
    return f;
  });
  const enemyFormations = enemyGenerals.map((g, i) => {
    const f = createFormation(i, "enemy", g, vec(terrain.enemyStart.x, terrain.enemyStart.y + (i - 2) * 10), vec(-1, 0));
    initializeFormationSlots(f, false);
    return f;
  });
  return { terrain, playerFormations, enemyFormations };
}

// ── 게임 상태 ─────────────────────────────────────────────────────────
export const game = {
  ...buildScenario(),
  tileW: DEFAULT_TILE_W,
  battlePhase: "planning", battleTime: 0,
  selectedId: 0,
  camera: vec(0, 0), dragState: null,
  speedMultiplier: 1,
  simulationAccumulator: 0,
  aiTimer: 0, enemyStrategy: null, strategyTick: 0,
  hudRefreshAccumulator: 0, hudDirty: true,
  terrainRender: null, spriteCache: null,
  projectiles: [],
};

// ── 진형 슬롯 관리 ───────────────────────────────────────────────────
export function computeLocalGridOffsets(count, ratio, spacing) {
  let cols = Math.max(1, Math.round(Math.sqrt(count * ratio)));
  let rows = Math.max(1, Math.ceil(count / cols));
  while (cols / Math.max(1, rows) > ratio * 1.4 && cols > 1) { cols--; rows = Math.max(1, Math.ceil(count / cols)); }
  while (cols / Math.max(1, rows) < ratio * 0.72)              { cols++; rows = Math.max(1, Math.ceil(count / cols)); }
  const offsets = [];
  for (let row = rows - 1; row >= 0; row--) {
    for (let col = 0; col < cols; col++) {
      if (offsets.length >= count) break;
      offsets.push(vec((col - (cols - 1) / 2) * spacing, (row - (rows - 1) / 2) * spacing));
    }
  }
  return offsets;
}

export function worldFromLocal(formation, local) {
  const forward = normalize(formation.facing);
  const lateral = { x: -forward.y, y: forward.x };
  return add(mul(lateral, local.x), mul(forward, local.y));
}

export function refreshFirstRowFlags(formation) {
  const alive = formation.units.filter(u => u.damage < 100);
  if (!alive.length) return;
  const maxY = Math.max(...alive.map(u => u.slotLocal.y));
  const tol  = densityInfo[formation.density].spacing * 0.5;
  alive.forEach(u => { u.isFirstRow = u.slotLocal.y >= maxY - tol; });
}

export function fillSlotFromBehind(formation, deadUnit) {
  const tol = densityInfo[formation.density].spacing * 0.5;
  let gapX = deadUnit.slotLocal.x, gapY = deadUnit.slotLocal.y, gapIdx = deadUnit.slotIndex;
  while (true) {
    let successor = null, bestY = -Infinity;
    for (const u of formation.units) {
      if (u.damage >= 100 || Math.abs(u.slotLocal.x - gapX) >= tol || u.slotLocal.y >= gapY) continue;
      if (u.slotLocal.y > bestY) { bestY = u.slotLocal.y; successor = u; }
    }
    if (!successor) break;
    const px = successor.slotLocal.x, py = successor.slotLocal.y, pi = successor.slotIndex;
    successor.slotLocal = { x: gapX, y: gapY };
    successor.slotIndex = gapIdx;
    gapX = px; gapY = py; gapIdx = pi;
  }
  refreshFirstRowFlags(formation);
}

export function applyTurnRule(formation, desiredFacing) {
  const cur  = normalize(formation.facing);
  const next = normalize(desiredFacing);
  if (len(next.x, next.y) <= 0.0001) return;
  const dot   = clamp(cur.x * next.x + cur.y * next.y, -1, 1);
  const cross = cur.x * next.y - cur.y * next.x;
  const angle = Math.acos(dot) * 180 / Math.PI;
  if (angle > 120) {
    formation.units.forEach(u => { const l = u.slotLocal || vec(); u.slotLocal = vec(-l.x, -l.y); });
    formation.facing = next;
    refreshFirstRowFlags(formation);
    return;
  }
  if (angle >= 60) {
    formation.units.forEach(u => {
      const l = u.slotLocal || vec();
      u.slotLocal = cross >= 0 ? vec(-l.y, l.x) : vec(l.y, -l.x);
    });
    formation.ratio = clamp(1 / Math.max(0.33, formation.ratio), 0.33, 3.0);
    formation.facing = next;
    initializeFormationSlots(formation, true);
    return;
  }
  formation.facing = next;
}

export function initializeFormationSlots(formation, preserveLayout) {
  const alive = formation.units.filter(u => u.damage < 100);
  if (!alive.length) return;
  const newLocals = computeLocalGridOffsets(alive.length, formation.ratio, densityInfo[formation.density].spacing);
  if (!preserveLayout) {
    alive.forEach((u, i) => {
      u.slotIndex = i; u.slotLocal = { ...newLocals[i] };
      const w = worldFromLocal(formation, u.slotLocal);
      u.x = formation.anchor.x + w.x; u.y = formation.anchor.y + w.y; u.vx = 0; u.vy = 0;
    });
  } else {
    const remaining = newLocals.map((local, i) => ({ i, local }));
    [...alive].sort((a, b) => {
      const da = len(a.slotLocal.x, a.slotLocal.y), db = len(b.slotLocal.x, b.slotLocal.y);
      return Math.abs(db - da) > 0.001 ? db - da : a.slotIndex - b.slotIndex;
    }).forEach(u => {
      let best = 0, bestCost = Infinity;
      remaining.forEach(({ local }, i) => {
        const c = len(local.x - u.slotLocal.x, local.y - u.slotLocal.y);
        if (c < bestCost) { bestCost = c; best = i; }
      });
      const chosen = remaining.splice(best, 1)[0];
      u.slotIndex = chosen.i; u.slotLocal = { ...chosen.local };
    });
  }
  const maxY = Math.max(...alive.map(u => u.slotLocal.y));
  const tol  = densityInfo[formation.density].spacing * 0.5;
  alive.forEach(u => { u.isFirstRow = u.slotLocal.y >= maxY - tol; });
}

export function formationCenter(formation) {
  const alive = formation.units.filter(u => u.damage < 100);
  if (!alive.length) return { ...formation.anchor };
  const sum = alive.reduce((acc, u) => ({ x: acc.x + u.x, y: acc.y + u.y }), vec());
  return vec(sum.x / alive.length, sum.y / alive.length);
}

export function currentSelection() {
  return game.playerFormations.filter(f => f.id === game.selectedId);
}

// ── 전투 공식 ─────────────────────────────────────────────────────────
export function unitDefense(formation, unit) {
  const tx = clamp(Math.floor(unit.x), 0, MAP_WIDTH  - 1);
  const ty = clamp(Math.floor(unit.y), 0, MAP_HEIGHT - 1);
  const tile = terrainInfo[game.terrain.tiles[ty][tx]];
  return Math.max(0,
    (2 + formation.general.charm / 100 * 8)
    + speedInfo[formation.speed].defense
    + densityInfo[formation.density].defense
    + tile.defense
    - formation.disorder * 2
  );
}

export function unitAttack(formation) {
  return Math.max(0,
    (15 + formation.general.power / 100 * 15)
    * (1 - formation.disorder * 0.25)
    * speedInfo[formation.speed].attack
  );
}

export function moveMultiplier(x, y) {
  const tx = clamp(Math.floor(x), 0, MAP_WIDTH  - 1);
  const ty = clamp(Math.floor(y), 0, MAP_HEIGHT - 1);
  return terrainInfo[game.terrain.tiles[ty][tx]].move;
}

export function anchorMoveSpeed(formation, x, y) {
  const penalty = Math.max(0.65, 1 - (formation.units.length * 100 / 50000) * 0.35);
  return speedInfo[formation.speed].move * moveMultiplier(x, y) * penalty;
}

export function unitMoveSpeed(formation, x, y) {
  const penalty = Math.max(0.65, 1 - (formation.units.length * 100 / 50000) * 0.35);
  return speedInfo["FAST"].move * moveMultiplier(x, y)
    * (1 + formation.general.leadership / 100 * 0.4) * penalty;
}

export function reactionRadius(formation) {
  let r = speedInfo[formation.speed].reaction;
  if (formation.disorder >= 0.6) r *= 0.6;
  return r;
}

// ── 공간 해시 ─────────────────────────────────────────────────────────
export function buildSpatialHash(formations) {
  const cells = new Map();
  formations.forEach(formation => {
    formation.units.forEach(unit => {
      if (unit.damage >= 100) return;
      const key = `${Math.floor(unit.x / SPATIAL_CELL_SIZE)}:${Math.floor(unit.y / SPATIAL_CELL_SIZE)}`;
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push({ formation, unit });
    });
  });
  return { cells, cellSize: SPATIAL_CELL_SIZE };
}

export function findNearbyUnits(hash, x, y, radius) {
  const minCX = Math.floor((x - radius) / hash.cellSize);
  const maxCX = Math.floor((x + radius) / hash.cellSize);
  const minCY = Math.floor((y - radius) / hash.cellSize);
  const maxCY = Math.floor((y + radius) / hash.cellSize);
  const result = [], rSq = radius * radius;
  for (let cy = minCY; cy <= maxCY; cy++)
    for (let cx = minCX; cx <= maxCX; cx++) {
      const entries = hash.cells.get(`${cx}:${cy}`);
      if (!entries) continue;
      for (const e of entries) {
        const dx = e.unit.x - x, dy = e.unit.y - y;
        if (dx * dx + dy * dy <= rSq) result.push(e);
      }
    }
  return result;
}

export function findNearestEnemy(hash, x, y, radius) {
  const minCX = Math.floor((x - radius) / hash.cellSize);
  const maxCX = Math.floor((x + radius) / hash.cellSize);
  const minCY = Math.floor((y - radius) / hash.cellSize);
  const maxCY = Math.floor((y + radius) / hash.cellSize);
  let best = null, bestSq = radius * radius;
  for (let cy = minCY; cy <= maxCY; cy++)
    for (let cx = minCX; cx <= maxCX; cx++) {
      const entries = hash.cells.get(`${cx}:${cy}`);
      if (!entries) continue;
      for (const e of entries) {
        const dx = e.unit.x - x, dy = e.unit.y - y;
        const dSq = dx * dx + dy * dy;
        if (dSq <= bestSq) { bestSq = dSq; best = e; }
      }
    }
  return best;
}

// ── 시뮬레이션 ───────────────────────────────────────────────────────
export function updateFormation(formation, enemyHash, allHash, dt) {
  const alive = formation.units.filter(u => u.damage < 100);
  if (!alive.length) return;

  let anchorActuallyMoved = false;
  if (formation.target && formation.speed !== "STOP") {
    const delta = sub(formation.target, formation.anchor);
    const d = len(delta.x, delta.y);
    if (d > 0.1) {
      formation.facing = normalize(delta);
      const avgSlot = alive.reduce((s, u) => {
        const slot = add(formation.anchor, worldFromLocal(formation, u.slotLocal));
        return s + len(slot.x - u.x, slot.y - u.y);
      }, 0) / alive.length;
      if (avgSlot < densityInfo[formation.density].spacing * 3.0) {
        const speed = anchorMoveSpeed(formation, formation.anchor.x, formation.anchor.y);
        formation.anchor = add(formation.anchor, mul(normalize(delta), Math.min(d, speed * dt)));
        anchorActuallyMoved = true;
      }
    }
  }
  // 앵커가 실제로 이동했을 때만 유닛에 걷기 플래그 설정
  alive.forEach(u => { u.isWalking = anchorActuallyMoved; });

  const survivalRate = alive.length / Math.max(1, formation.units.length);
  const rawDisorder  = Math.max(0, (0.6 - survivalRate) / 0.6);
  formation.disorder = rawDisorder * Math.max(0,
    1 - formation.general.leadership / 100 * 0.35
      - formation.general.charm      / 100 * 0.20);

  const firstRowCount = alive.filter(u => u.isFirstRow).length;
  formation._firstRowBonus = firstRowCount > 0
    ? 1 + alive.length / (firstRowCount * 100) : 1.1;

  alive.forEach(unit => {
    const targetSlot  = add(formation.anchor, worldFromLocal(formation, unit.slotLocal));
    const slotDelta   = sub(targetSlot, unit);
    const slotDist    = len(slotDelta.x, slotDelta.y);

    let enemyTarget = findNearestEnemy(enemyHash, unit.x, unit.y, reactionRadius(formation));
    if (enemyTarget) {
      unit.chaseEntry = enemyTarget; unit.chaseTimer = 2.5;
    } else {
      unit.chaseTimer -= dt;
      if (unit.chaseTimer > 0 && unit.chaseEntry && unit.chaseEntry.unit.damage < 100) {
        if (len(unit.chaseEntry.unit.x - unit.x, unit.chaseEntry.unit.y - unit.y) < 10.0)
          enemyTarget = unit.chaseEntry;
        else unit.chaseTimer = 0;
      }
      if (unit.chaseTimer <= 0) unit.chaseEntry = null;
    }

    unit.rangedCooldown -= dt;

    let desired = vec();
    if (enemyTarget) {
      const eDelta = sub(enemyTarget.unit, unit);
      const eDir   = normalize(eDelta);
      const eDist  = len(eDelta.x, eDelta.y);
      desired = slotDist > densityInfo[formation.density].spacing * 1.35
        ? add(mul(normalize(slotDelta), 0.8), mul(eDir, 0.2))
        : slotDist > 0.001 ? add(mul(normalize(slotDelta), 0.35), mul(eDir, 0.65)) : eDir;

      const attackerInPos  = slotDist < 0.8;
      const attackerBonus  = attackerInPos ? (unit.isFirstRow ? formation._firstRowBonus : 1.1) : 1.0;
      const defSlot        = add(enemyTarget.formation.anchor, worldFromLocal(enemyTarget.formation, enemyTarget.unit.slotLocal));
      const defSlotDist    = len(defSlot.x - enemyTarget.unit.x, defSlot.y - enemyTarget.unit.y);
      const defenderInPos  = defSlotDist < 0.8;
      const defenderBonus  = defenderInPos ? (enemyTarget.unit.isFirstRow ? (enemyTarget.formation._firstRowBonus ?? 1.1) : 1.1) : 1.0;

      if (eDist < 0.85) {
        const dmg = Math.max(0, unitAttack(formation) * attackerBonus - unitDefense(enemyTarget.formation, enemyTarget.unit) * defenderBonus);
        enemyTarget.unit.damage += dmg * dt;
        if (enemyTarget.unit.damage >= 100 && enemyTarget.unit.damage - dmg * dt < 100) {
          fillSlotFromBehind(enemyTarget.formation, enemyTarget.unit);
          formation.general.kills += 100;
          enemyTarget.formation.general.losses += 100;
        }
      } else if (unit.rangedCooldown <= 0) {
        const rdmg = (15 + formation.general.power / 100 * 15) * 0.2;
        const prev = enemyTarget.unit.damage;
        enemyTarget.unit.damage += rdmg;
        if (enemyTarget.unit.damage >= 100 && prev < 100) {
          fillSlotFromBehind(enemyTarget.formation, enemyTarget.unit);
          formation.general.kills += 100;
          enemyTarget.formation.general.losses += 100;
        }
        unit.rangedCooldown = 1.0;
        game.projectiles.push({ x: unit.x, y: unit.y, tx: enemyTarget.unit.x, ty: enemyTarget.unit.y, team: formation.team });
      }
    } else if (slotDist > 0.002) {
      desired = normalize(slotDelta);
    }

    if (slotDist > densityInfo[formation.density].spacing * 1.8)
      desired = add(desired, mul(normalize(slotDelta), 1.35));

    const CROSS_R = 1.8, HARD = UNIT_RADIUS * 2;
    for (const e of findNearbyUnits(allHash, unit.x, unit.y, CROSS_R)) {
      if (e.unit === unit) continue;
      if (e.formation.team === formation.team && e.formation.id === formation.id) continue;
      const dx = unit.x - e.unit.x, dy = unit.y - e.unit.y;
      const d = len(dx, dy);
      if (d < 0.001) continue;
      if (d < HARD) {
        const ov = (HARD - d) / HARD;
        desired = add(desired, mul({ x: dx / d, y: dy / d }, ov * ov * 4.0));
      } else if (d < CROSS_R) {
        desired = add(desired, mul({ x: dx / d, y: dy / d }, (CROSS_R - d) / CROSS_R * 0.75));
      }
    }

    if (len(desired.x, desired.y) > 0.001) desired = normalize(desired);

    let chaosSpeedMult = 1.0;
    if (formation.speed === "NORMAL" || formation.speed === "FAST") {
      const baseLevel = formation.speed === "FAST" ? 0.65 : 0.18;
      const lMult = 1.0 - (formation.general.leadership / 100) * 0.5;
      const tx = clamp(Math.floor(unit.x), 0, MAP_WIDTH  - 1);
      const ty = clamp(Math.floor(unit.y), 0, MAP_HEIGHT - 1);
      const tile = game.terrain.tiles[ty][tx];
      const tMult = tile === "mountain" ? 1.7 : tile === "river" ? 1.4 : 1.0;
      const chaosLevel = baseLevel * lMult * tMult;
      const drift = Math.sin(game.battleTime * 0.7 + unit.chaosPhaseOffset) * Math.PI * 0.1 * chaosLevel;
      if (len(desired.x, desired.y) > 0.001) {
        const c = Math.cos(drift), s = Math.sin(drift);
        desired = normalize({ x: desired.x * c - desired.y * s, y: desired.x * s + desired.y * c });
      }
      chaosSpeedMult = 1.0 - unit.chaosSeed * 0.22 * chaosLevel;
    }

    const inertia = len(unit.vx, unit.vy) > 0.001 ? normalize(vec(unit.vx, unit.vy)) : vec();
    const iw = Math.max(0.05, 0.2 - Math.min(0.15, slotDist * 0.18));
    let moveDir = add(mul(desired, 1 - iw), mul(inertia, iw));
    if (len(moveDir.x, moveDir.y) > 0.001) moveDir = normalize(moveDir);
    const spd = Math.max(0.35, unitMoveSpeed(formation, unit.x, unit.y));
    const boost = slotDist > densityInfo[formation.density].spacing * 1.8 ? 1.15 : 1.0;
    const tv = mul(moveDir, spd * boost * chaosSpeedMult);
    unit.vx = lerp(unit.vx, tv.x, Math.min(1, dt * 7.0));
    unit.vy = lerp(unit.vy, tv.y, Math.min(1, dt * 7.0));
    unit.x = clamp(unit.x + unit.vx * dt, 0, MAP_WIDTH  - 1);
    unit.y = clamp(unit.y + unit.vy * dt, 0, MAP_HEIGHT - 1);
  });

  if (!formation.retreating) {
    formation.reorganizeTimer -= dt;
    if (formation.reorganizeTimer <= 0) {
      const anyInCombat = alive.some(u => u.chaseTimer > 0 || u.chaseEntry !== null);
      if (!anyInCombat) initializeFormationSlots(formation, true);
      formation.reorganizeTimer = 4.0 + Math.random() * 3.0;
    }
  }
}

export function applyPositionCorrection() {
  const all  = [...game.playerFormations, ...game.enemyFormations];
  const hash = buildSpatialHash(all);
  const MIN  = UNIT_RADIUS * 2;
  all.forEach(formation => {
    formation.units.filter(u => u.damage < 100).forEach(unit => {
      for (const e of findNearbyUnits(hash, unit.x, unit.y, MIN)) {
        if (e.unit === unit) continue;
        const dx = unit.x - e.unit.x, dy = unit.y - e.unit.y;
        const d = len(dx, dy);
        if (d > 0.001 && d < MIN) {
          const c = (MIN - d) * 0.5;
          unit.x = clamp(unit.x + dx / d * c, 0, MAP_WIDTH  - 1);
          unit.y = clamp(unit.y + dy / d * c, 0, MAP_HEIGHT - 1);
        }
      }
    });
  });
}

export function update(dt) {
  if (game.battlePhase !== "live") return;
  game.battleTime += dt;

  const PR = 8, ER = MAP_WIDTH - 8;
  game.playerFormations.forEach(f => {
    if (!f.retreated && f.units.some(u => u.damage < 100) && f.anchor.x < PR) {
      f.retreated = true; f.units.forEach(u => { u.damage = 100; });
    }
    if (!f.followTarget) return;
    if (!f.followTarget.units.some(u => u.damage < 100)) { f.followTarget = null; return; }
    f.target = formationCenter(f.followTarget);
  });
  game.enemyFormations.forEach(f => {
    if (!f.retreated && f.units.some(u => u.damage < 100) && f.anchor.x > ER) {
      f.retreated = true; f.units.forEach(u => { u.damage = 100; });
    }
  });

  const checkRetreat = (f, retreatX) => {
    if (f.retreated || f.retreating || !f.units.some(u => u.damage < 100)) return;
    const sr = f.units.filter(u => u.damage < 100).length / f.units.length;
    const cp = Math.floor(sr / 0.04) * 0.04;
    if (cp >= f.retreatLastCheckpoint) return;
    f.retreatLastCheckpoint = cp;
    if (sr >= 0.25 - (f.general.charm / 100) * 0.10) return;
    if (Math.random() < 0.70 - (f.general.charm / 100) * 0.50) {
      f.retreating = true; f.speed = "FAST"; f.followTarget = null;
      f.target = vec(retreatX, f.anchor.y);
    }
  };
  game.playerFormations.forEach(f => checkRetreat(f, 0));
  game.enemyFormations.forEach(f => checkRetreat(f, MAP_WIDTH));

  const pHash = buildSpatialHash(game.playerFormations);
  const eHash = buildSpatialHash(game.enemyFormations);
  const aHash = buildSpatialHash([...game.playerFormations, ...game.enemyFormations]);
  game.playerFormations.forEach(f => updateFormation(f, eHash, aHash, dt));
  game.enemyFormations.forEach(f => updateFormation(f, pHash, aHash, dt));
  applyPositionCorrection();
  updateAI(dt);

  const PROJ_SPEED = 4.0;
  game.projectiles = game.projectiles.filter(p => {
    const dx = p.tx - p.x, dy = p.ty - p.y;
    const d = len(dx, dy);
    if (d < 0.15) return false;
    const step = Math.min(d, PROJ_SPEED * dt);
    p.x += dx / d * step; p.y += dy / d * step;
    return true;
  });
}

// ── AI ────────────────────────────────────────────────────────────────
export function terrainDefenseAt(x, y) {
  const tx = clamp(Math.floor(x), 0, MAP_WIDTH  - 1);
  const ty = clamp(Math.floor(y), 0, MAP_HEIGHT - 1);
  return ({ plain: 0, road: 0, river: -2, mountain: 3 })[game.terrain.tiles[ty][tx]] ?? 0;
}

export function assignEnemyRoles(enemies, players) {
  const weakest = players.reduce((a, b) =>
    a.units.filter(u => u.damage < 100).length <= b.units.filter(u => u.damage < 100).length ? a : b);
  const s = game.enemyStrategy, n = enemies.length;
  enemies.forEach((f, i) => {
    f.aiTarget = null;
    if (s === "BLITZ")       { f.aiRole = i < Math.ceil(n * 0.6) ? "VANGUARD" : "FLANKER"; }
    else if (s === "FLANK")  { f.aiRole = i < 2 ? "VANGUARD" : "FLANKER"; }
    else if (s === "FOCUS_WEAK") { f.aiRole = "FOCUS"; f.aiTarget = weakest; }
    else if (s === "DEFENSIVE") { f.aiRole = i === 0 ? "FOCUS" : "HOLD"; if (i === 0) f.aiTarget = weakest; }
    else { if (i % 3 === 0) { f.aiRole = "FOCUS"; f.aiTarget = weakest; } else f.aiRole = "VANGUARD"; }
  });
}

export function executeEnemyRole(formation, players, index) {
  if (formation.retreating || formation.retreated) return;
  const role = formation.aiRole || "VANGUARD";
  const center = formationCenter(formation);
  const onMountain = terrainDefenseAt(center.x, center.y) >= 3;
  const nearest = players.reduce((a, b) =>
    len(formationCenter(a).x - center.x, formationCenter(a).y - center.y) <=
    len(formationCenter(b).x - center.x, formationCenter(b).y - center.y) ? a : b);
  const nc = formationCenter(nearest);
  const dist = len(nc.x - center.x, nc.y - center.y);

  if (role === "VANGUARD") {
    formation.followTarget = nearest;
    formation.target = vec(nc.x, nc.y);
    if (onMountain && dist < 20) { formation.speed = "STOP"; formation.density = "TIGHT"; }
    else if (dist < 12) { formation.speed = "SLOW"; formation.density = "TIGHT"; }
    else { formation.speed = game.enemyStrategy === "BLITZ" ? "FAST" : "NORMAL"; formation.density = "NORMAL"; }
  } else if (role === "FLANKER") {
    const pc = players.reduce((a, f) => add(a, formationCenter(f)), vec());
    pc.x /= players.length; pc.y /= players.length;
    const flankY = clamp(pc.y + (index % 2 === 0 ? -1 : 1) * 28, 8, MAP_HEIGHT - 8);
    formation.followTarget = null; formation.speed = "FAST"; formation.density = "WIDE";
    if (Math.abs(center.y - flankY) < 10 && dist < 30) {
      formation.followTarget = nearest; formation.target = vec(nc.x, nc.y);
    } else { formation.target = vec(pc.x - 8, flankY); }
  } else if (role === "FOCUS") {
    const tgt = (formation.aiTarget && formation.aiTarget.units.some(u => u.damage < 100)) ? formation.aiTarget : nearest;
    formation.followTarget = tgt; formation.target = formationCenter(tgt);
    formation.speed = dist < 10 ? "SLOW" : "NORMAL"; formation.density = "TIGHT";
  } else {
    formation.followTarget = null;
    if (onMountain) { formation.speed = "STOP"; formation.density = "TIGHT"; formation.facing = normalize(sub(nc, center)); }
    else if (dist < 22) { formation.speed = "SLOW"; formation.density = "TIGHT"; formation.target = vec(nc.x, nc.y); }
    else { formation.speed = "SLOW"; formation.density = "NORMAL"; formation.target = vec(center.x - 3, center.y); }
  }
}

export function updateAI(dt) {
  game.aiTimer += dt;
  if (game.aiTimer < 3 || game.battlePhase !== "live") return;
  game.aiTimer = 0;
  const lp = game.playerFormations.filter(f => f.units.some(u => u.damage < 100) && !f.retreated && !f.retreating);
  const le = game.enemyFormations.filter(f => f.units.some(u => u.damage < 100) && !f.retreated && !f.retreating);
  if (!lp.length || !le.length) return;

  game.strategyTick++;
  if (game.strategyTick % 3 === 1 || !game.enemyStrategy) {
    const eT = le.reduce((s, f) => s + f.units.filter(u => u.damage < 100).length, 0);
    const pT = lp.reduce((s, f) => s + f.units.filter(u => u.damage < 100).length, 0);
    const ratio = eT / Math.max(1, pT), prev = game.enemyStrategy, r = Math.random();
    if (!prev) {
      if (ratio > 1.35)      game.enemyStrategy = r < 0.45 ? "BLITZ" : r < 0.75 ? "FLANK" : "ATTRITION";
      else if (ratio < 0.75) game.enemyStrategy = r < 0.45 ? "DEFENSIVE" : r < 0.8 ? "FOCUS_WEAK" : "ATTRITION";
      else                   game.enemyStrategy = r < 0.3 ? "BLITZ" : r < 0.55 ? "FLANK" : r < 0.8 ? "FOCUS_WEAK" : "DEFENSIVE";
    } else {
      if (ratio < 0.60 && prev !== "DEFENSIVE")    game.enemyStrategy = "DEFENSIVE";
      else if (ratio > 1.50 && prev === "DEFENSIVE") game.enemyStrategy = "BLITZ";
      else if (ratio < 0.80 && prev === "BLITZ")    game.enemyStrategy = "ATTRITION";
    }
    assignEnemyRoles(le, lp);
  }
  le.forEach((f, i) => executeEnemyRole(f, lp, i));
}
