import {
  game, update, SIMULATION_STEP, MAX_SIMULATION_STEPS,
  centerCameraOn, formationCenter,
} from './game-logic.js';
import {
  buildTerrainRenderData, buildSpriteCache,
  render, refreshHud, refreshButtons,
} from './renderer.js';
import { setupInput } from './input.js';

// ── 초기화 ────────────────────────────────────────────────────────────
game.terrainRender = buildTerrainRenderData(game.terrain);
game.spriteCache   = buildSpriteCache();

setupInput();

// ── 게임 루프 ─────────────────────────────────────────────────────────
function tick(now) {
  if (!tick.last) tick.last = now;
  const dt = Math.min(0.05, (now - tick.last) / 1000);
  tick.last = now;

  game.simulationAccumulator = Math.min(
    game.simulationAccumulator + dt * game.speedMultiplier,
    SIMULATION_STEP * MAX_SIMULATION_STEPS
  );
  let steps = 0;
  while (game.simulationAccumulator >= SIMULATION_STEP && steps < MAX_SIMULATION_STEPS) {
    update(SIMULATION_STEP);
    game.simulationAccumulator -= SIMULATION_STEP;
    steps++;
  }

  game.hudRefreshAccumulator += dt;
  if (game.hudDirty || game.hudRefreshAccumulator >= 0.25) {
    refreshHud();
    game.hudRefreshAccumulator = 0;
  }

  render();
  requestAnimationFrame(tick);
}

// ── 시작 ─────────────────────────────────────────────────────────────
centerCameraOn(formationCenter(game.playerFormations[0]));
refreshHud();
refreshButtons();
requestAnimationFrame(tick);
