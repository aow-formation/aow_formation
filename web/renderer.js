import {
  game, MAP_WIDTH, MAP_HEIGHT, CHUNK_TILES,
  terrainInfo, densityInfo, clamp, len, vec, add, mul, normalize, sub,
  tileHash, getTileH, isoPoint, centerCameraOn,
  formationCenter, currentSelection, worldFromLocal,
  initializeFormationSlots, applyTurnRule,
} from './game-logic.js';

// ── DOM 참조 ──────────────────────────────────────────────────────────
export const canvas          = document.getElementById("battleCanvas");
export const ctx             = canvas.getContext("2d");
export const hudEl           = document.getElementById("hud");
export const phaseButton     = document.getElementById("phaseButton");
export const speedToggleButton = document.getElementById("speedToggleButton");
export const buttons = {
  speed:    document.querySelectorAll("[data-speed]"),
  density:  document.querySelectorAll("[data-density]"),
  ratioDown: document.getElementById("ratioDown"),
  ratioUp:   document.getElementById("ratioUp"),
};

// ── 좌표 변환 (canvas 의존) ───────────────────────────────────────────
export function viewportOrigin() {
  return vec(canvas.width / window.devicePixelRatio / 2, 150);
}

export function toScreen(x, y) {
  const iso = isoPoint(x, y), origin = viewportOrigin();
  return { x: iso.x - game.camera.x + origin.x, y: iso.y - game.camera.y + origin.y };
}

export function toTile(screenX, screenY) {
  const origin = viewportOrigin();
  const sx = screenX + game.camera.x - origin.x;
  const sy = screenY + game.camera.y - origin.y;
  const halfW = game.tileW / 2, halfH = getTileH() / 2;
  return vec(
    clamp((sx / halfW + sy / halfH) / 2, 0, MAP_WIDTH  - 1),
    clamp((sy / halfH - sx / halfW) / 2, 0, MAP_HEIGHT - 1)
  );
}

// ── 오프스크린 캔버스 유틸 ────────────────────────────────────────────
export function createSurface(width, height) {
  const s = document.createElement("canvas");
  s.width  = Math.max(1, Math.ceil(width));
  s.height = Math.max(1, Math.ceil(height));
  return s;
}

// ── 지형 렌더 데이터 ──────────────────────────────────────────────────
export function buildTerrainRenderData(terrain) {
  const minimapCanvas = createSurface(MAP_WIDTH, MAP_HEIGHT);
  const mCtx = minimapCanvas.getContext("2d");
  for (let y = 0; y < MAP_HEIGHT; y++)
    for (let x = 0; x < MAP_WIDTH; x++) {
      mCtx.fillStyle = terrainInfo[terrain.tiles[y][x]].color;
      mCtx.fillRect(x, y, 1, 1);
    }
  return { minimapCanvas, chunkCache: new Map(), chunkTileW: 0 };
}

// ── 지형 청크 렌더링 ──────────────────────────────────────────────────
export function invalidateTerrainChunkCache() {
  game.terrainRender.chunkCache.clear();
  game.terrainRender.chunkTileW = game.tileW;
}

function ensureTerrainChunkCache() {
  if (game.terrainRender.chunkTileW !== game.tileW) invalidateTerrainChunkCache();
}

function drawDiamond(drawCtx, x, y, color) {
  const halfW = game.tileW / 2 + 0.75, halfH = getTileH() / 2 + 0.55;
  drawCtx.beginPath();
  drawCtx.moveTo(x, y - 0.7);
  drawCtx.lineTo(x + halfW, y + halfH);
  drawCtx.lineTo(x, y + halfH * 2 + 0.7);
  drawCtx.lineTo(x - halfW, y + halfH);
  drawCtx.closePath();
  drawCtx.fillStyle = color;
  drawCtx.fill();
}

function drawFallbackMountainShadow(drawCtx, x, y) {
  const halfW = game.tileW / 2 + 0.75, halfH = getTileH() / 2 + 0.55;
  drawCtx.beginPath();
  drawCtx.moveTo(x, y - 0.5);
  drawCtx.lineTo(x + halfW, y + halfH);
  drawCtx.lineTo(x, y + halfH * 2 + 0.5);
  drawCtx.lineTo(x - halfW, y + halfH);
  drawCtx.closePath();
  drawCtx.fillStyle = "rgba(49,58,48,0.85)";
  drawCtx.fill();
}

function createTerrainChunk(chunkX, chunkY) {
  const startX = chunkX * CHUNK_TILES, startY = chunkY * CHUNK_TILES;
  const endX   = Math.min(MAP_WIDTH,  startX + CHUNK_TILES);
  const endY   = Math.min(MAP_HEIGHT, startY + CHUNK_TILES);
  const tileW   = game.tileW;
  const tileH   = getTileH();
  const shadowH = Math.round(tileH * 23 / 16);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let y = startY; y < endY; y++)
    for (let x = startX; x < endX; x++) {
      const iso = isoPoint(x, y);
      minX = Math.min(minX, iso.x - tileW / 2 - 2);
      maxX = Math.max(maxX, iso.x + tileW / 2 + 2);
      minY = Math.min(minY, iso.y - 2);
      maxY = Math.max(maxY, iso.y + tileH + 2);
      if (game.terrain.tiles[y][x] === "mountain") {
        minY = Math.min(minY, iso.y + tileH * 0.32 - 2);
        maxY = Math.max(maxY, iso.y + tileH * 0.32 + shadowH + 4);
      }
    }
  const chunkCanvas = createSurface(maxX - minX, maxY - minY);
  const cCtx = chunkCanvas.getContext("2d");
  const tiles = [];
  for (let y = startY; y < endY; y++)
    for (let x = startX; x < endX; x++)
      tiles.push([x + y, x, y]);
  tiles.sort((a, b) => a[0] - b[0]);
  tiles.forEach(([, x, y]) => {
    const iso = isoPoint(x, y);
    const dx = iso.x - minX, dy = iso.y - minY;
    const tile = game.terrain.tiles[y][x];
    if (tile === "mountain") drawFallbackMountainShadow(cCtx, dx, dy + tileH * 0.5);
    drawDiamond(cCtx, dx, dy, terrainInfo[tile].color);
  });
  return { canvas: chunkCanvas, worldX: minX, worldY: minY };
}

// ── 픽셀아트 스프라이트 시스템 ────────────────────────────────────────
const SPRITE_W = 10, SPRITE_H = 14;
const SPRITE_FRAMES = [
  [ // Frame 0: 서있기
    [0,0,1,2,2,2,1,0,0,0],[0,1,2,2,2,2,2,1,0,0],[0,1,3,5,5,3,2,1,0,0],[0,0,1,5,5,1,0,0,0,0],
    [0,1,2,2,2,2,2,1,0,0],[1,2,3,2,2,2,2,2,1,0],[1,2,2,2,2,2,2,2,1,0],[1,2,4,2,7,2,4,2,1,0],
    [0,1,2,2,1,2,2,1,0,0],[0,0,1,6,0,6,1,0,0,0],[0,0,6,6,0,6,6,0,0,0],[0,0,6,6,0,6,6,0,0,0],
    [0,1,6,6,1,6,6,1,0,0],[0,0,0,0,0,0,0,0,0,0],
  ],
  [ // Frame 1: 걷기
    [0,0,1,2,2,2,1,0,0,0],[0,1,2,2,2,2,2,1,0,0],[0,1,3,5,5,3,2,1,0,0],[0,0,1,5,5,1,0,0,0,0],
    [0,1,2,2,2,2,2,1,0,0],[1,2,3,2,2,2,2,2,1,0],[1,2,2,2,2,2,2,2,1,0],[1,2,4,2,7,2,4,2,1,0],
    [0,1,2,2,1,2,2,1,0,0],[0,1,6,0,0,0,6,1,0,0],[1,6,6,0,0,0,6,6,1,0],[0,1,6,1,0,1,6,1,0,0],
    [0,0,0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0,0],
  ],
];
const SPRITE_PALETTES = {
  player: ['','#0a0a14','#3a7fd4','#60a8f5','#1a4f8a','#e8c090','#1a1e32','#d4aa30'],
  enemy:  ['','#0a0a0a','#b83030','#e05555','#601818','#e8c090','#20180a','#c09820'],
};

export function buildSpriteCache() {
  const cache = { player: [], enemy: [] };
  ['player', 'enemy'].forEach(team => {
    const pal = SPRITE_PALETTES[team];
    SPRITE_FRAMES.forEach(frame => {
      const right = createSurface(SPRITE_W, SPRITE_H);
      const rc = right.getContext('2d');
      frame.forEach((row, y) => row.forEach((ci, x) => {
        if (!ci) return; rc.fillStyle = pal[ci]; rc.fillRect(x, y, 1, 1);
      }));
      const left = createSurface(SPRITE_W, SPRITE_H);
      const lc = left.getContext('2d');
      lc.translate(SPRITE_W, 0); lc.scale(-1, 1); lc.drawImage(right, 0, 0);
      cache[team].push({ right, left });
    });
  });
  return cache;
}

// ── 렌더 함수들 ───────────────────────────────────────────────────────
function renderMap() {
  ensureTerrainChunkCache();
  const origin = viewportOrigin();
  const samples = [toTile(0,0), toTile(canvas.clientWidth,0), toTile(0,canvas.clientHeight), toTile(canvas.clientWidth,canvas.clientHeight)];
  const margin = 10;
  const minX = clamp(Math.floor(Math.min(...samples.map(p => p.x))) - margin, 0, MAP_WIDTH  - 1);
  const maxX = clamp(Math.ceil (Math.max(...samples.map(p => p.x))) + margin, 0, MAP_WIDTH  - 1);
  const minY = clamp(Math.floor(Math.min(...samples.map(p => p.y))) - margin, 0, MAP_HEIGHT - 1);
  const maxY = clamp(Math.ceil (Math.max(...samples.map(p => p.y))) + margin, 0, MAP_HEIGHT - 1);
  const minCX = Math.floor(minX / CHUNK_TILES), maxCX = Math.floor(maxX / CHUNK_TILES);
  const minCY = Math.floor(minY / CHUNK_TILES), maxCY = Math.floor(maxY / CHUNK_TILES);
  const chunks = [];
  for (let cy = minCY; cy <= maxCY; cy++)
    for (let cx = minCX; cx <= maxCX; cx++)
      chunks.push({ sort: cx + cy, cx, cy });
  chunks.sort((a, b) => a.sort - b.sort);
  chunks.forEach(({ cx, cy }) => {
    const key = `${cx}:${cy}`;
    let chunk = game.terrainRender.chunkCache.get(key);
    if (!chunk) { chunk = createTerrainChunk(cx, cy); game.terrainRender.chunkCache.set(key, chunk); }
    ctx.drawImage(chunk.canvas, chunk.worldX - game.camera.x + origin.x, chunk.worldY - game.camera.y + origin.y);
  });
}

function renderUnits() {
  const all = [...game.playerFormations, ...game.enemyFormations];
  const units = [];
  all.forEach(formation => {
    formation.units.filter(u => u.damage < 100).forEach(unit =>
      units.push({ sort: unit.x + unit.y, formation, unit }));
  });
  units.sort((a, b) => a.sort - b.sort);
  const tileH = getTileH();
  const scale = game.tileW / 20;
  const dw = Math.round(SPRITE_W * scale), dh = Math.round(SPRITE_H * scale);
  ctx.imageSmoothingEnabled = false;
  units.forEach(({ formation, unit }) => {
    // 0.1타일 단위로 스냅 → 미세 진동이 화면 좌표로 증폭되는 것을 방지
    const snapX = Math.round(unit.x * 10) / 10;
    const snapY = Math.round(unit.y * 10) / 10;
    const screen = toScreen(snapX, snapY);
    const cx = Math.round(screen.x), cy = Math.round(screen.y + tileH / 2);
    const tSlot   = add(formation.anchor, worldFromLocal(formation, unit.slotLocal));
    const slotDist = len(tSlot.x - unit.x, tSlot.y - unit.y);
    const bonusActive = unit.isFirstRow && slotDist < 0.8;
    const isMoving = unit.isWalking === true;
    const frameIdx    = isMoving ? Math.floor(game.battleTime * 5 + unit.chaosPhaseOffset * 3) % 2 : 0;
    const spriteSet   = game.spriteCache[formation.team][frameIdx];
    const sprite      = unit.vx < -0.05 ? spriteSet.left : spriteSet.right;
    const drawX = Math.round(cx - dw / 2), drawY = Math.round(cy - dh);
    if (bonusActive) {
      ctx.save(); ctx.globalAlpha = 0.40;
      ctx.shadowBlur = dw * 0.8;
      ctx.shadowColor = formation.team === 'player' ? '#66bbff' : '#ffaa44';
      ctx.drawImage(sprite, drawX, drawY, dw, dh);
      ctx.restore();
    }
    ctx.drawImage(sprite, drawX, drawY, dw, dh);
    if (formation.id === game.selectedId && formation.team === 'player') {
      ctx.strokeStyle = '#f6dd8e'; ctx.lineWidth = 1;
      ctx.strokeRect(drawX - 1, drawY - 1, dw + 2, dh + 2);
    }
  });
  ctx.imageSmoothingEnabled = true;
}

function renderProjectiles() {
  const tileH = getTileH();
  ctx.strokeStyle = "rgba(255,248,210,0.75)"; ctx.lineWidth = 0.8;
  game.projectiles.forEach(p => {
    const dx = p.tx - p.x, dy = p.ty - p.y, d = len(dx, dy);
    if (d < 0.001) return;
    const nx = dx / d, ny = dy / d;
    const head = toScreen(p.x, p.y), tail = toScreen(p.x - nx * 0.5, p.y - ny * 0.5);
    const cy = tileH / 2;
    ctx.beginPath(); ctx.moveTo(tail.x, tail.y + cy); ctx.lineTo(head.x, head.y + cy); ctx.stroke();
  });
}

function renderPlayerTargets() {
  game.playerFormations.forEach(f => {
    if (!f.target) return;
    const point  = toScreen(f.target.x, f.target.y);
    const anchor = toScreen(f.anchor.x,  f.anchor.y);
    const cy = point.y + getTileH() / 2;
    ctx.strokeStyle = "#ffe992";
    ctx.beginPath(); ctx.arc(point.x, cy, 8, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(anchor.x, anchor.y + getTileH() / 2); ctx.lineTo(point.x, cy); ctx.stroke();
  });
}

function renderMinimap() {
  const W = 210, H = 140;
  const x = canvas.clientWidth - W - 16, y = canvas.clientHeight - H - 16;
  ctx.fillStyle = "rgba(17,21,24,0.9)"; ctx.fillRect(x-6, y-6, W+12, H+12);
  ctx.strokeStyle = "#7a8898"; ctx.strokeRect(x-6, y-6, W+12, H+12);
  ctx.drawImage(game.terrainRender.minimapCanvas, x, y, W, H);

  const prX = x + (8 / MAP_WIDTH) * W, erX = x + ((MAP_WIDTH - 8) / MAP_WIDTH) * W;
  ctx.lineWidth = 1; ctx.setLineDash([3, 2]);
  ctx.strokeStyle = "rgba(100,180,255,0.7)";
  ctx.beginPath(); ctx.moveTo(prX, y); ctx.lineTo(prX, y+H); ctx.stroke();
  ctx.strokeStyle = "rgba(255,100,100,0.7)";
  ctx.beginPath(); ctx.moveTo(erX, y); ctx.lineTo(erX, y+H); ctx.stroke();
  ctx.setLineDash([]); ctx.lineWidth = 1;

  game.playerFormations.forEach(f => {
    const c = formationCenter(f);
    ctx.fillStyle = "#5ea6ff"; ctx.beginPath();
    ctx.arc(x + c.x/MAP_WIDTH*W, y + c.y/MAP_HEIGHT*H, 3, 0, Math.PI*2); ctx.fill();
  });
  game.enemyFormations.forEach(f => {
    const c = formationCenter(f);
    ctx.fillStyle = "#e25b5b"; ctx.beginPath();
    ctx.arc(x + c.x/MAP_WIDTH*W, y + c.y/MAP_HEIGHT*H, 3, 0, Math.PI*2); ctx.fill();
  });
}

function renderOverlay() {
  ctx.fillStyle = "#f1e4c0"; ctx.font = "16px sans-serif";
  ctx.fillText(`상태: ${game.battlePhase === "planning" ? "준비 중" : "전투 중"} / 경과 ${game.battleTime.toFixed(1)}초`, 18, 28);
  if (game.battlePhase === "planning") {
    ctx.fillStyle = "#f1d18b";
    ctx.fillText("전투 시작 전입니다. 목표 위치와 진형을 먼저 지정하세요.", 18, 52);
  }
}

export function render() {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth, H = canvas.clientHeight;
  if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#12161a"; ctx.fillRect(0, 0, W, H);
  renderMap(); renderUnits(); renderProjectiles(); renderPlayerTargets(); renderMinimap(); renderOverlay();
}

// ── HUD ───────────────────────────────────────────────────────────────
export function refreshHud() {
  const formations = game.playerFormations;
  while (hudEl.children.length < formations.length) {
    const index = hudEl.children.length;
    const card = document.createElement("button");
    card.addEventListener("click", () => {
      const f = game.playerFormations[index];
      if (!f) return;
      game.selectedId = f.id;
      centerCameraOn(formationCenter(f));
      game.hudDirty = true;
      refreshButtons();
    });
    hudEl.appendChild(card);
  }
  while (hudEl.children.length > formations.length) hudEl.removeChild(hudEl.lastChild);

  formations.forEach((f, i) => {
    const troops = f.units.filter(u => u.damage < 100).length * 100;
    const card = hudEl.children[i];
    card.className = `hud-card${f.id === game.selectedId ? " active" : ""}${troops <= 0 ? " dead" : ""}`;
    card.innerHTML = f.retreated
      ? `<h3>${f.general.name}</h3><p class="retreated-label">퇴각</p><div class="disorder-bar"></div>`
      : f.retreating
      ? `<h3>${f.general.name}</h3><p class="retreating-label">후퇴 중</p><div class="disorder-bar"><div class="disorder-fill" style="width:${(troops/(f.units.length*100)*100).toFixed(1)}%"></div></div>`
      : `<h3>${f.general.name}</h3>
         <p>병력 ${troops.toLocaleString()} / 무력 ${f.general.power} 통솔 ${f.general.leadership}</p>
         <div class="disorder-bar"><div class="disorder-fill" style="width:${(troops/(f.units.length*100)*100).toFixed(1)}%"></div></div>`;
  });
  game.hudDirty = false;
}

export function refreshButtons() {
  const selected = currentSelection()[0];
  buttons.speed.forEach(b => b.classList.toggle("active", Boolean(selected && selected.speed === b.dataset.speed)));
  buttons.density.forEach(b => b.classList.toggle("active", Boolean(selected && selected.density === b.dataset.density)));
  phaseButton.textContent = game.battlePhase === "planning" ? "전투 개시" : "전투 진행 중";
  phaseButton.disabled    = game.battlePhase !== "planning";
  speedToggleButton.disabled = game.battlePhase !== "live";
  speedToggleButton.classList.toggle("active", game.speedMultiplier === 2);
  speedToggleButton.textContent = game.speedMultiplier === 2 ? "기본속도" : "2배속";
}
