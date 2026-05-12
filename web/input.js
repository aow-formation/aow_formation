import {
  game, clamp, len, vec, normalize, sub,
  ZOOM_LEVELS, MAP_WIDTH, MAP_HEIGHT, isoPoint,
  formationCenter, currentSelection, applyTurnRule,
  initializeFormationSlots, centerCameraOn,
} from './game-logic.js';

import {
  canvas, buttons, phaseButton, speedToggleButton,
  toTile, invalidateTerrainChunkCache,
  refreshHud, refreshButtons,
} from './renderer.js';

export function setupInput() {
  // ── 패널 버튼 ─────────────────────────────────────────────────────
  buttons.speed.forEach(btn => {
    btn.addEventListener("click", () => {
      currentSelection().forEach(f => {
        if (f.retreating) return;
        f.speed = btn.dataset.speed;
        if (f.speed === "STOP") f.target = null;
      });
      game.hudDirty = true;
      refreshButtons();
    });
  });

  buttons.density.forEach(btn => {
    btn.addEventListener("click", () => {
      currentSelection().forEach(f => {
        if (f.retreating) return;
        f.density = btn.dataset.density;
        initializeFormationSlots(f, true);
      });
      game.hudDirty = true;
      refreshButtons();
    });
  });

  buttons.ratioDown.addEventListener("click", () => {
    currentSelection().forEach(f => {
      if (f.retreating) return;
      f.ratio = clamp(f.ratio - 0.3, 0.33, 3.0);
      initializeFormationSlots(f, true);
    });
    game.hudDirty = true;
  });

  buttons.ratioUp.addEventListener("click", () => {
    currentSelection().forEach(f => {
      if (f.retreating) return;
      f.ratio = clamp(f.ratio + 0.3, 0.33, 3.0);
      initializeFormationSlots(f, true);
    });
    game.hudDirty = true;
  });

  phaseButton.addEventListener("click", () => {
    if (game.battlePhase === "planning") {
      game.battlePhase = "live";
      currentSelection().forEach(f => {
        if (f.speed === "STOP" && f.target) f.speed = "NORMAL";
      });
      game.hudDirty = true;
      refreshButtons();
    }
  });

  speedToggleButton.addEventListener("click", () => {
    if (game.battlePhase !== "live") return;
    game.speedMultiplier = game.speedMultiplier === 2 ? 1 : 2;
    refreshButtons();
  });

  // ── 캔버스 마우스 ─────────────────────────────────────────────────
  canvas.addEventListener("contextmenu", e => e.preventDefault());

  canvas.addEventListener("mousedown", e => {
    if (e.button === 0)
      game.dragState = { x: e.clientX, y: e.clientY, camera: { ...game.camera } };
  });

  window.addEventListener("mousemove", e => {
    if (!game.dragState) return;
    game.camera.x = game.dragState.camera.x - (e.clientX - game.dragState.x);
    game.camera.y = game.dragState.camera.y - (e.clientY - game.dragState.y);
  });

  window.addEventListener("mouseup", e => {
    if (game.dragState && e.button === 0) {
      const dx = e.clientX - game.dragState.x;
      const dy = e.clientY - game.dragState.y;
      if (Math.hypot(dx, dy) <= 5) {
        const rect = canvas.getBoundingClientRect();
        const tile = toTile(e.clientX - rect.left, e.clientY - rect.top);
        let closest = null, minDist = 5.0;
        for (const f of game.playerFormations) {
          if (!f.units.some(u => u.damage < 100)) continue;
          const c = formationCenter(f);
          const d = len(c.x - tile.x, c.y - tile.y);
          if (d < minDist) { minDist = d; closest = f; }
        }
        if (closest) {
          game.selectedId = closest.id;
          game.hudDirty = true;
          refreshButtons();
        }
      }
    }
    game.dragState = null;
  });

  canvas.addEventListener("wheel", e => {
    e.preventDefault();
    const old = game.tileW;
    const idx    = ZOOM_LEVELS.indexOf(old);
    const curIdx = idx !== -1 ? idx : ZOOM_LEVELS.length - 1;
    const nextIdx = clamp(curIdx + (e.deltaY < 0 ? 1 : -1), 0, ZOOM_LEVELS.length - 1);
    game.tileW = ZOOM_LEVELS[nextIdx];
    if (game.tileW === old) return;
    const before  = toTile(e.offsetX, e.offsetY);
    const afterIso = isoPoint(before.x, before.y);
    const oldIso   = { x: (before.x - before.y) * (old / 2), y: (before.x + before.y) * ((old / 2) / 2) };
    game.camera.x += afterIso.x - oldIso.x;
    game.camera.y += afterIso.y - oldIso.y;
    invalidateTerrainChunkCache();
  }, { passive: false });

  // 우클릭: 이동 명령 또는 적 추적
  canvas.addEventListener("mouseup", e => {
    if (e.button !== 2) return;
    const tile = toTile(e.offsetX, e.offsetY);
    let clickedEnemy = null, minDist = 8.0;
    for (const f of game.enemyFormations) {
      if (!f.units.some(u => u.damage < 100)) continue;
      const c = formationCenter(f);
      const d = len(c.x - tile.x, c.y - tile.y);
      if (d < minDist) { minDist = d; clickedEnemy = f; }
    }
    currentSelection().forEach(f => {
      if (f.retreating) return;
      if (clickedEnemy) {
        f.followTarget = clickedEnemy;
        f.target = formationCenter(clickedEnemy);
        applyTurnRule(f, normalize(sub(f.target, f.anchor)));
      } else {
        f.followTarget = null;
        applyTurnRule(f, normalize(sub(tile, f.anchor)));
        if (f.speed === "STOP") {
          if (game.battlePhase === "planning") f.target = vec(tile.x, tile.y);
        } else {
          f.target = vec(tile.x, tile.y);
        }
      }
    });
  });
}
