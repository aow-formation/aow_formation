import {
  Application as PixiApplication,
  Assets       as PixiAssets,
  Container    as PixiContainer,
  Graphics     as PixiGraphics,
  Sprite       as PixiSprite,
  RenderTexture,
  BlurFilter,
  Texture,
  Rectangle    as PixiRect,
} from 'pixi.js';

(function () {
  "use strict";

  // ── 말풍선 데이터 로드 ────────────────────────────────────────────────
  let speechData = null;
  fetch('./data/speech_bubbles.json')
    .then(r => r.json())
    .then(d => { speechData = d; })
    .catch(() => {});

  // ── 장수 데이터 로드 ──────────────────────────────────────────────────
  let generalsData = null;
  fetch('./assets/portraits/generals.json')
    .then(r => r.json())
    .then(d => { generalsData = d; })
    .catch(() => {});

  const MAP_WIDTH = 240;
  const MAP_HEIGHT = 160;
  const CHUNK_TILES = 16;
  const SIMULATION_STEP = 1 / 30;
  const MAX_SIMULATION_STEPS = 4;
  const SPATIAL_CELL_SIZE = 4;
  const UNIT_RADIUS = 0.27;
  const TILE_W_MIN = 16;
  const TILE_W_MAX = 24;
  const DEFAULT_TILE_W = 24;
  const ZOOM_LEVELS = [16, 20, 24];
  const PANEL_WIDTH = 300;
  const NAME_POOL = [
    "관우", "장비", "조조", "유비", "제갈량", "사마의", "손권", "주유", "여포", "조운",
    "황충", "마초", "강유", "육손", "장료", "허저", "전위", "문앙", "등애", "종회",
    "이순신", "강감찬", "을지문덕", "계백", "김유신", "연개소문", "최영", "이성계",
    "오다노부나가", "도요토미히데요시", "도쿠가와이에야스", "다케다신겐", "우에스기겐신",
    "한니발", "카이사르", "알렉산드로스", "나폴레옹", "살라딘", "아틸라"
  ];

  const terrainInfo = {
    plain:    { color: "#ae9360", move: 1.0,  defense:  0 },
    grassland:{ color: "#7a9a50", move: 1.0,  defense:  0 },
    road:     { color: "#cfb07c", move: 1.6,  defense:  0 },
    river:    { color: "#6baed2", move: 0.3,  defense: -2 },
    mountain: { color: "#61705a", move: 0.70, defense:  3 },
    wetland:  { color: "#5b9aad", move: 0.55, defense: -1 },
  };
  // ── 스킬 정의 ────────────────────────────────────────────────────────────
  const BASIC_SKILLS = ['kihap', 'swift', 'guard'];
  const EXTRA_SKILLS = ['fire', 'flood', 'archery'];
  const POSITION_DEFENSE_THRESHOLD = 0.8;
  const SKILL_DEF = {
    kihap: { label: '기합', icon: '氣', cooldown: f => 200 - f.general.charm / 100 * 60 },
    swift: { label: '신속', icon: '疾', cooldown: f =>  45 - f.general.charm / 100 * 13 },
    guard: { label: '사수', icon: '守', cooldown: f =>  90 - f.general.charm / 100 * 27 },
    fire:  { label: '화공', icon: '火', cooldown: f => 120 - f.general.charm / 100 * 36 },
    flood: { label: '수공', icon: '水', cooldown: f => 160 - f.general.charm / 100 * 48 },
    archery: { label: '신궁', icon: '弓', cooldown: f => 100 - f.general.charm / 100 * 30 },
  };

  const densityInfo = {
    // rangedDefenseMult: 원거리 피해 배율 (낮을수록 덜 맞음)
    TIGHT:  { spacing: 0.6,  defense:  0.75, rangedDefenseMult: 1.15 }, // 밀집 → 원거리 15% 취약
    NORMAL: { spacing: 0.82, defense:  0.0,  rangedDefenseMult: 1.00 },
    WIDE:   { spacing: 1.08, defense: -0.75, rangedDefenseMult: 0.85 }, // 분산 → 원거리 15% 강함
  };

  const speedInfo = {
    STOP:   { move: 0.0,  defense: 2.0,  attack: 0.95, reaction: 2.5 },
    SLOW:   { move: 0.30, defense: 1.0,  attack: 0.98, reaction: 3.2 },
    NORMAL: { move: 0.9,  defense: 0.0,  attack: 1.02, reaction: 4.0 },
    FAST:   { move: 1.35, defense: -1.0, attack: 1.05, reaction: 5.0 }
  };

  const TROOP_TYPES = {
    infantry: {
      label: "보병",
      populationCost: 1,
      meleeAttackMult: 1.0,
      rangedAttackMult: 1.0,
      moveMult: 1.0,
      meleeDefenseMult: 1.0,
      rangedDefenseMult: 1.0,
      canRangedAttack: true,
      allowedSkills: null,
      allowedDensities: ["TIGHT", "NORMAL", "WIDE"],
      walkFrames: 5,
      sourceHeight: 20,
      renderScale: tileW => tileW / 20 * 0.85,
      spacingMult: 1.0,
      collisionMult: 1.0,
    },
    cavalry: {
      label: "기병",
      populationCost: 4,
      meleeAttackMult: 3.0,
      rangedAttackMult: 0.0,
      moveMult: 2.0,
      meleeDefenseMult: 4.0,
      rangedDefenseMult: 3.0,
      canRangedAttack: false,
      allowedSkills: ["kihap"],
      allowedDensities: ["NORMAL", "WIDE"],
      walkFrames: 6,
      sourceHeight: 25,
      renderScale: tileW => tileW / 24,
      spacingMult: 1.55,
      collisionMult: 1.8,
    },
  };

  const canvas = document.getElementById("battleCanvas");
  const ctx = canvas.getContext("2d");
  const hudEl = document.getElementById("hud");
  const phaseButton = document.getElementById("phaseButton");
  const speedToggleButton = document.getElementById("speedToggleButton");
  const troopAdjustBtn = document.getElementById("troopAdjustBtn");
  const battleLoadingMask = document.getElementById("battleLoadingMask");
  const buttons = {
    speed: document.querySelectorAll("[data-speed]"),
    density: document.querySelectorAll("[data-density]"),
    ratioDown: document.getElementById("ratioDown"),
    ratioUp: document.getElementById("ratioUp")
  };
  const panelPortrait     = document.getElementById("panelPortrait");
  const panelGeneralName  = document.getElementById("panelGeneralName");
  const panelMeleeAtk     = document.getElementById("panelMeleeAtk");
  const panelMeleeDef     = document.getElementById("panelMeleeDef");
  const panelRangedAtk    = document.getElementById("panelRangedAtk");
  const panelRangedDef    = document.getElementById("panelRangedDef");
  const panelTroopCount   = document.getElementById("panelTroopCount");
  const panelTroopFill    = document.getElementById("panelTroopFill");
  const panelDisorderLabel= document.getElementById("panelDisorderLabel");
  const panelDisorderFill = document.getElementById("panelDisorderFill");
  const kihapBtn          = document.getElementById("kihapBtn");
  const kihapFill         = document.getElementById("kihapFill");

  // ── 화면 상태 관리 ────────────────────────────────────────────────────
  const homeScreen         = document.getElementById("homeScreen");
  const troopAdjustScreen  = document.getElementById("troopAdjustScreen");
  const battleResultScreen = document.getElementById("battleResultScreen");
  const appShell           = document.getElementById("appShell");
  const homeBg             = document.querySelector(".home-bg");

  // 현재 앱 상태: "home" | "battle" | "troopAdjust" | "battleResult"
  let appState = "home";

  // 재전투용 저장 데이터
  let savedPlayerGenerals = null;
  let savedEnemyGenerals  = null;
  let savedTerrain        = null;

  // 병력 조정 작업용 임시 배열 [{ name, troops }]
  let troopDraft = {
    player: { troops: [], skills: [], troopTypes: [] },
    enemy:  { troops: [], skills: [], troopTypes: [] },
  };
  const POPULATION_BUDGET = 50000;
  const TROOP_MIN_POPULATION = 1000;

  function setScreen(state) {
    appState = state;
    homeScreen.hidden         = (state !== "home");
    troopAdjustScreen.hidden  = (state !== "troopAdjust");
    battleResultScreen.hidden = (state !== "battleResult");
    appShell.hidden           = (state === "home");
    updateBattleLoadingMask();
  }

  function applyRandomHomeBackground() {
    if (!homeBg) return;
    const backgrounds = [
      "./assets/background/main.png",
      "./assets/background/main1.png",
    ];
    const selected = backgrounds[Math.floor(Math.random() * backgrounds.length)];
    homeBg.style.backgroundImage =
      `linear-gradient(90deg, rgba(0,0,0,0.45), rgba(0,0,0,0.08)), url('${selected}')`;
  }

  applyRandomHomeBackground();

  function showBattleLoadingMask() {
    if (!battleLoadingMask) return;
    battleLoadingMask.hidden = false;
    battleLoadingMask.classList.remove("is-hiding");
  }

  function hideBattleLoadingMask() {
    if (!battleLoadingMask || battleLoadingMask.hidden || battleLoadingMask.classList.contains("is-hiding")) return;
    battleLoadingMask.classList.add("is-hiding");
    window.setTimeout(() => {
      if (battleLoadingMask.classList.contains("is-hiding")) {
        battleLoadingMask.hidden = true;
      }
    }, 750);
  }

  function updateBattleLoadingMask() {
    if (appState === "battle" && !areGameAssetsReady()) {
      showBattleLoadingMask();
      return;
    }
    if (appState === "battle" && areGameAssetsReady()) {
      hideBattleLoadingMask();
    }
  }

  function preventPanelButtonFocus() {
    document.querySelectorAll(".panel button").forEach((button) => {
      button.tabIndex = -1;
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", () => button.blur());
    });
  }

  preventPanelButtonFocus();

  const rand = (min, max) => Math.random() * (max - min) + min;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const len = (x, y) => Math.hypot(x, y);

  function vec(x = 0, y = 0) {
    return { x, y };
  }

  function add(a, b) {
    return { x: a.x + b.x, y: a.y + b.y };
  }

  function sub(a, b) {
    return { x: a.x - b.x, y: a.y - b.y };
  }

  function mul(v, s) {
    return { x: v.x * s, y: v.y * s };
  }

  function normalize(v) {
    const l = len(v.x, v.y);
    return l > 0.0001 ? { x: v.x / l, y: v.y / l } : { x: 0, y: 0 };
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function createSurface(width, height) {
    const surface = document.createElement("canvas");
    surface.width = Math.max(1, Math.ceil(width));
    surface.height = Math.max(1, Math.ceil(height));
    return surface;
  }

  // ── 지형 레이어 우선순위 ──────────────────────────────────────────────
  const TERRAIN_PRIORITY = { river: 0, wetland: 1, plain: 2, grassland: 3, road: 4, mountain: 5 };
  const TERRAIN_ASSET    = { river:"river", wetland:"river_bank", plain:"dirt", grassland:"plain", road:"road", mountain:"forest_floor" };
  const V3 = "./assets/terrain_tiles_v3/";

  const terrainSprites = { tiles: {}, masks: {}, dirt: [], plainGrass: [], forestFloor: [], objects: [], tree: null, ruggedMtn: null, ready: false };

  // ── 화공 스프라이트시트 ───────────────────────────────────────────────
  const fireSprite = new Image();
  fireSprite.src = './assets/terrain_tiles_v3/objects/fire_spritesheet.png';
  const FIRE_COLS = 4, FIRE_ROWS = 4, FIRE_FRAMES = 16;

  // ── 유닛 스프라이트시트 ───────────────────────────────────────────────
  const unitWalkSprite = new Image();
  unitWalkSprite.src = './assets/units/ancient_infantry_helmet_walk.png';
  const unitWalkBlueSprite = new Image();
  unitWalkBlueSprite.src = './assets/units/ancient_infantry_helmet_walk_blue.png';
  const cavalryWalkSprite = new Image();
  cavalryWalkSprite.src = './assets/units/ancient_cavity_helmet_walk.png';
  const cavalryWalkBlueSprite = new Image();
  cavalryWalkBlueSprite.src = './assets/units/ancient_cavity_helmet_walk_blue.png';
  const unitIdleSprite = new Image();
  unitIdleSprite.src = './assets/units/ancient_infantry_helmet_idle_1.png';
  const unitIdleBlueSprite = new Image();
  unitIdleBlueSprite.src = './assets/units/ancient_infantry_helmet_idle_1_blue.png';
  const gameSpriteImages = [
    fireSprite,
    unitWalkSprite,
    unitWalkBlueSprite,
    cavalryWalkSprite,
    cavalryWalkBlueSprite,
    unitIdleSprite,
    unitIdleBlueSprite,
  ];
  const UNIT_WALK_FRAMES = 5;
  const UNIT_WALK_SCALE = 0.85;
  const FIRST_ROW_BONUS_DIVISOR = 50;

  // ── PixiJS 상태 ──────────────────────────────────────────────────────────
  let pixiApp        = null;
  let pixiShadowGfx  = null;
  let pixiGlowGfx    = null;
  let pixiUnitCtr    = null;
  let pixiFogSprite  = null;
  let pixiFogRT      = null;
  let pixiFogDark    = null; // 영구 재사용 Graphics (dark overlay)
  let pixiFogVision  = null; // 영구 재사용 Graphics (vision erase)
  let pixiFogScene   = null; // 영구 재사용 Container
  const pixiUnitSprites = new Map(); // unit.id → PixiSprite
  const pixiWalkTex  = {
    infantry: { player: [], enemy: [] },
    cavalry:  { player: [], enemy: [] },
  };
  const pixiIdleTex  = {
    infantry: { player: null, enemy: null },
    cavalry:  { player: null, enemy: null },
  };
  let pixiReady      = false;
  let pixiTerrainCtr = null;
  let pixiTreeCtr    = null;
  let pixiTreeTex    = null;
  const pixiChunkSprites = new Map(); // chunkKey → PixiSprite
  const pixiTreeSprites  = [];        // { sprite, worldBx, worldBy }

  async function initPixi() {
    try {
      pixiApp = new PixiApplication();
      await pixiApp.init({
        width:           canvas.clientWidth  || 1440,
        height:          canvas.clientHeight || 900,
        backgroundAlpha: 0,
        antialias:       false,
        resolution:      1,
        preference:      'webgl',
      });
      // canvas는 DOM에 붙이지 않음 — ctx.drawImage로 직접 합성

      pixiTerrainCtr = new PixiContainer();
      pixiTreeCtr    = new PixiContainer();
      pixiShadowGfx  = new PixiGraphics();
      pixiGlowGfx    = new PixiGraphics();
      pixiUnitCtr    = new PixiContainer();
      pixiUnitCtr.sortableChildren = true;

      // FOW 영구 씬 구성 (매 프레임 clear()만 호출)
      pixiFogScene  = new PixiContainer();
      pixiFogDark   = new PixiGraphics();
      pixiFogVision = new PixiGraphics();
      pixiFogVision.blendMode = 'erase';
      pixiFogScene.addChild(pixiFogDark);
      pixiFogScene.addChild(pixiFogVision);

      pixiFogSprite = new PixiSprite();
      pixiFogSprite.filters = [new BlurFilter({ strength: 14 })];
      pixiFogSprite.visible = false;

      pixiApp.stage.addChild(pixiTerrainCtr);
      pixiApp.stage.addChild(pixiTreeCtr);
      pixiApp.stage.addChild(pixiShadowGfx);
      pixiApp.stage.addChild(pixiGlowGfx);
      pixiApp.stage.addChild(pixiUnitCtr);
      pixiApp.stage.addChild(pixiFogSprite);

      // 유닛 텍스처 로드
      const load = url => PixiAssets.load(url).catch(() => null);
      const [wP, wE, cP, cE, iP, iE, treeT] = await Promise.all([
        load('./assets/units/ancient_infantry_helmet_walk.png'),
        load('./assets/units/ancient_infantry_helmet_walk_blue.png'),
        load('./assets/units/ancient_cavity_helmet_walk.png'),
        load('./assets/units/ancient_cavity_helmet_walk_blue.png'),
        load('./assets/units/ancient_infantry_helmet_idle_1.png'),
        load('./assets/units/ancient_infantry_helmet_idle_1_blue.png'),
        load('./assets/terrain_tiles_v3/objects/trees/tree.png'),
      ]);
      pixiTreeTex = treeT;
      // 픽셀아트: 모든 유닛 텍스처에 nearest-neighbor 보간 설정
      [wP, wE, cP, cE, iP, iE].forEach(tex => { if (tex) tex.source.scaleMode = 'nearest'; });

      const makeFrames = (tex, type) => {
        if (!tex) return [];
        const frames = troopWalkFrames(type);
        const fw = tex.width / frames;
        return Array.from({ length: frames }, (_, i) =>
          new Texture({ source: tex.source, frame: new PixiRect(i * fw, 0, fw, tex.height) })
        );
      };
      pixiWalkTex.infantry.player = makeFrames(wP, "infantry");
      pixiWalkTex.infantry.enemy  = makeFrames(wE, "infantry");
      pixiWalkTex.cavalry.player  = makeFrames(cP, "cavalry");
      pixiWalkTex.cavalry.enemy   = makeFrames(cE, "cavalry");
      if (iP) pixiIdleTex.infantry.player = iP;
      if (iE) pixiIdleTex.infantry.enemy  = iE;
      pixiIdleTex.cavalry.player = pixiWalkTex.cavalry.player[0] || null;
      pixiIdleTex.cavalry.enemy  = pixiWalkTex.cavalry.enemy[0] || null;

      pixiReady = true;
    } catch (e) {
      console.warn('[PixiJS] init failed, falling back to Canvas 2D:', e);
    }
  }
  const FIRST_ROW_DEFENSE_BONUS = 1.5;

  function preloadTerrainSprites() {
    const pending = [];
    const loadImg = src => { const i = new Image(); i.src = src; pending.push(i); return i; };

    // 3×3 베이스 텍스처
    for (let n = 0; n < 8;  n++) terrainSprites.dirt.push(loadImg(`${V3}base_3x3/dirt/dirt_${String(n).padStart(2,"0")}.png`));
    for (let n = 0; n < 12; n++) terrainSprites.plainGrass.push(loadImg(`${V3}base_3x3/plain/plain_${String(n).padStart(2,"0")}.png`));
    for (let n = 0; n < 12; n++) terrainSprites.forestFloor.push(loadImg(`${V3}base_3x3/forest_floor/forest_floor_${String(n).padStart(2,"0")}.png`));
    // 나무 오브젝트
    terrainSprites.tree    = loadImg(`${V3}objects/trees/tree.png`);
    terrainSprites.ruggedMtn = loadImg(`${V3}base_3x3/mountain/mountain_forest_16.png`);
    for (let n = 0; n < 16; n += 1)
      terrainSprites.objects.push(loadImg(`./assets/objects/object_sheet_tiles/object_${String(n).padStart(2, "0")}.png`));

    // 1×1 center 타일 — 지형별 다중 variant 배열
    // 파일: {asset}_center.png + {asset}_center_00.png ~ {asset}_center_05.png (총 7종)
    for (const [, asset] of Object.entries(TERRAIN_ASSET)) {
      const arr = [];
      arr.push(loadImg(`${V3}tile_1x1/${asset}/${asset}_center.png`));
      for (let n = 0; n < 6; n++)
        arr.push(loadImg(`${V3}tile_1x1/${asset}/${asset}_center_${String(n).padStart(2,"0")}.png`));
      terrainSprites.tiles[asset] = arr;
    }

    // 엣지 마스크 combined_edge_8 — 방향별 5종 변형 (raw: 휘도→알파 변환 전)
    const MASK_DIRS = ["N","NE","E","SE","S","SW","W","NW"];
    const MASK_VARS = 5;
    const rawMasks = {}; // key: "N_00" 등
    for (const d of MASK_DIRS)
      for (let n = 0; n < MASK_VARS; n++)
        rawMasks[`${d}_${String(n).padStart(2,"0")}`] =
          loadImg(`${V3}masks_1x1/combined_edge_8/edge_mask_${d}_${String(n).padStart(2,"0")}.png`);

    let loaded = 0;
    const done = () => {
      if (++loaded < pending.length) return;
      // 마스크: 휘도 → 알파 변환 후 방향별 배열로 저장
      for (const d of MASK_DIRS) {
        terrainSprites.masks[d] = [];
        for (let n = 0; n < MASK_VARS; n++) {
          const key = `${d}_${String(n).padStart(2,"0")}`;
          const m = rawMasks[key];
          if (!m?.naturalWidth) continue;
          const W = m.naturalWidth, H = m.naturalHeight;
          const cv = createSurface(W, H);
          const cx = cv.getContext("2d");
          cx.drawImage(m, 0, 0, W, H);
          const id = cx.getImageData(0, 0, W, H);
          const px = id.data;
          for (let i = 0; i < px.length; i += 4) {
            px[i+3] = Math.round((px[i] + px[i+1] + px[i+2]) / 3);
            px[i] = px[i+1] = px[i+2] = 255;
          }
          cx.putImageData(id, 0, 0);
          terrainSprites.masks[d].push(cv);
        }
      }
      terrainSprites.ready = true;
      invalidateTerrainChunkCache();
      updateBattleLoadingMask();
    };
    pending.forEach(i => {
      if (i.complete) done();
      else { i.addEventListener("load", done, {once:true}); i.addEventListener("error", done, {once:true}); }
    });
  }

  function isImageReady(image) {
    return image.complete;
  }

  function areGameAssetsReady() {
    return terrainSprites.ready && gameSpriteImages.every(isImageReady);
  }

  gameSpriteImages.forEach((image) => {
    image.addEventListener("load", updateBattleLoadingMask);
    image.addEventListener("error", updateBattleLoadingMask);
  });

  // [NW,NE,SE,SW] L/U 패턴 → 마스크 방향 (B 없음, 경계타일=U로 간주)
  const MASK_KEY = {
    "LLUU": "N",  "ULLU": "E",  "UULL": "S",  "LUUL": "W",
    "LUUU": "SE", "ULUU": "SW", "UULU": "NW", "UUUL": "NE",
  };

  function buildTerrainRenderData(terrain) {
    // 4면 방향: NW(-1,0) NE(0,-1) SE(+1,0) SW(0,+1)
    const FACES = [[-1,0], [0,-1], [1,0], [0,1]];

    // 1패스-A: 4면 이웃 중 더 높은 우선순위가 있을 때만 경계 표시
    const isBorder = Array.from({length: MAP_HEIGHT}, () => new Uint8Array(MAP_WIDTH));
    for (let y = 0; y < MAP_HEIGHT; y++)
      for (let x = 0; x < MAP_WIDTH; x++) {
        const p = TERRAIN_PRIORITY[terrain.tiles[y][x]] ?? 2;
        for (const [dx, dy] of FACES) {
          const nx = x+dx, ny = y+dy;
          if (nx < 0 || nx >= MAP_WIDTH || ny < 0 || ny >= MAP_HEIGHT) continue;
          const np = TERRAIN_PRIORITY[terrain.tiles[ny][nx]] ?? 2;
          if (np > p) { isBorder[y][x] = 1; break; }
        }
      }

    // 1패스-B: 대각 코너 갭 채우기
    // 대각 이웃이 상위 지형이고, 두 인접 경계 타일 사이에 낀 경우 경계로 표시
    // 예: 두 경계 타일이 "L자"로 만나는 안쪽 모서리
    const DIAG_FRAMES = [
      { d: [-1,-1], f: [[-1,0],[0,-1]] },  // N꼭짓점 방향
      { d: [1,-1],  f: [[1,0], [0,-1]] },  // E꼭짓점 방향
      { d: [1,1],   f: [[1,0], [0,1]]  },  // S꼭짓점 방향
      { d: [-1,1],  f: [[-1,0],[0,1]]  },  // W꼭짓점 방향
    ];
    for (let y = 0; y < MAP_HEIGHT; y++) {
      for (let x = 0; x < MAP_WIDTH; x++) {
        if (isBorder[y][x]) continue; // 이미 경계
        const p = TERRAIN_PRIORITY[terrain.tiles[y][x]] ?? 2;
        for (const { d: [ddx, ddy], f: frames } of DIAG_FRAMES) {
          const dx = x+ddx, dy = y+ddy;
          if (dx < 0 || dx >= MAP_WIDTH || dy < 0 || dy >= MAP_HEIGHT) continue;
          if ((TERRAIN_PRIORITY[terrain.tiles[dy][dx]] ?? 2) <= p) continue; // 대각이 상위 아님
          // 두 인접 프레임 면이 모두 경계 타일이어야 코너 갭
          let bothBorder = true;
          for (const [fx, fy] of frames) {
            const nx = x+fx, ny = y+fy;
            if (nx < 0 || nx >= MAP_WIDTH || ny < 0 || ny >= MAP_HEIGHT ||
                !isBorder[ny][nx]) { bothBorder = false; break; }
          }
          if (bothBorder) { isBorder[y][x] = 1; break; }
        }
      }
    }

    // 2패스: 경계 타일별 마스크 방향 결정
    // 경계 타일 이웃 = 무조건 U / 하위·동일 우선순위 = L
    // 코너 갭 포함, 단일 로직으로 처리
    const ALL8 = [...FACES, [-1,-1],[1,-1],[1,1],[-1,1]];
    const borderData = Array.from({length: MAP_HEIGHT}, () => new Array(MAP_WIDTH).fill(null));

    for (let y = 0; y < MAP_HEIGHT; y++) {
      for (let x = 0; x < MAP_WIDTH; x++) {
        if (!isBorder[y][x]) continue;
        const t = terrain.tiles[y][x];
        const p = TERRAIN_PRIORITY[t] ?? 2;

        // 8방향에서 최고 우선순위 지형 탐색 (코너 갭용 대각 포함)
        let upperT = t, upperP = p;
        for (const [dx, dy] of ALL8) {
          const nx = x+dx, ny = y+dy;
          if (nx < 0 || nx >= MAP_WIDTH || ny < 0 || ny >= MAP_HEIGHT) continue;
          const nt = terrain.tiles[ny][nx];
          const np = TERRAIN_PRIORITY[nt] ?? 2;
          if (np > upperP) { upperP = np; upperT = nt; }
        }
        if (upperT === t) continue; // 실제 상위 지형 없음

        // 4면 이웃 수집
        const nbrs = FACES.map(([dx, dy]) => {
          const nx = x+dx, ny = y+dy;
          if (nx < 0 || nx >= MAP_WIDTH || ny < 0 || ny >= MAP_HEIGHT) return { p, border: false };
          return { p: TERRAIN_PRIORITY[terrain.tiles[ny][nx]] ?? 2, border: isBorder[ny][nx] === 1 };
        }); // [NW, NE, SE, SW]

        // 면 상태 분류: 경계 타일 이웃 → U, 하위/동일 → L
        const states = nbrs.map(n => (n.border || n.p > p) ? "U" : "L");
        const key = states.join("");

        const maskDir = key === "UUUU" ? "center" : (MASK_KEY[key] || null);

        borderData[y][x] = { maskDir, lowerT: t, upperT, dbgKey: key };
      }
    }

    // 3×3 블록 감지 (경계 타일 제외 — 경계 타일은 별도 합성)
    const block   = Array.from({length: MAP_HEIGHT}, () => new Uint8Array(MAP_WIDTH));
    const variant = Array.from({length: MAP_HEIGHT}, () => new Uint8Array(MAP_WIDTH));
    for (let y = 0; y < MAP_HEIGHT; y++)
      for (let x = 0; x < MAP_WIDTH; x++)
        variant[y][x] = tileHash(x, y) % 12;

    for (let y = 0; y < MAP_HEIGHT - 2; y++) {
      for (let x = 0; x < MAP_WIDTH - 2; x++) {
        if (block[y][x] || isBorder[y][x]) continue;
        const t = terrain.tiles[y][x];
        let same = true;
        for (let dy = 0; dy < 3 && same; dy++)
          for (let dx = 0; dx < 3 && same; dx++)
            if (terrain.tiles[y+dy][x+dx] !== t || isBorder[y+dy][x+dx]) same = false;
        if (same) {
          block[y][x] = 1;
          for (let dy = 0; dy < 3; dy++)
            for (let dx = 0; dx < 3; dx++)
              if (dy || dx) block[y+dy][x+dx] = 2;
        }
      }
    }

    const minimapCanvas = createSurface(MAP_WIDTH, MAP_HEIGHT);
    const minimapCtx = minimapCanvas.getContext("2d");
    for (let y = 0; y < MAP_HEIGHT; y++)
      for (let x = 0; x < MAP_WIDTH; x++) {
        minimapCtx.fillStyle = isBorder[y][x] ? "#909090" : terrainInfo[terrain.tiles[y][x]].color;
        minimapCtx.fillRect(x, y, 1, 1);
      }
    // 험준산악 16×16 감지 — 청크 정렬 제한 (단일 청크 내에 완전히 들어오는 블록만)
    const ruggedMtn = Array.from({length: MAP_HEIGHT}, () => new Uint8Array(MAP_WIDTH));
    for (let y = 0; y < MAP_HEIGHT - 15; y++) {
      for (let x = 0; x < MAP_WIDTH - 15; x++) {
        if (ruggedMtn[y][x]) continue;
        if (Math.floor(x / CHUNK_TILES) !== Math.floor((x + 15) / CHUNK_TILES)) continue;
        if (Math.floor(y / CHUNK_TILES) !== Math.floor((y + 15) / CHUNK_TILES)) continue;
        let ok = true;
        for (let dy = 0; dy < 16 && ok; dy++)
          for (let dx = 0; dx < 16 && ok; dx++)
            if (terrain.tiles[y + dy][x + dx] !== "mountain") ok = false;
        if (ok && Math.random() < 0.5) {
          ruggedMtn[y][x] = 1;
          for (let dy = 0; dy < 16; dy++)
            for (let dx = 0; dx < 16; dx++)
              if (dy || dx) ruggedMtn[y + dy][x + dx] = 2;
        }
      }
    }

    const objectMap = Array.from({length: MAP_HEIGHT}, () => new Uint8Array(MAP_WIDTH));
    for (let y = 0; y < MAP_HEIGHT; y++) {
      for (let x = 0; x < MAP_WIDTH; x++) {
        if (terrain.tiles[y][x] !== "plain" || isBorder[y][x]) continue;
        const h = tileHash(x + 101, y + 307);
        if (h % 800 < 1) objectMap[y][x] = 1 + ((h >>> 8) % 16);
      }
    }

    return { isBorder, borderData, block, variant, ruggedMtn, objectMap, minimapCanvas, chunkCache: new Map(), chunkTileW: 0, chunkSpritesReady: false, chunkPixiReady: false };
  }

  function chooseNames() {
    const pool = [...NAME_POOL];
    const names = [];
    while (names.length < 10) {
      const index = Math.floor(Math.random() * pool.length);
      names.push(pool.splice(index, 1)[0]);
    }
    return names;
  }

  function createGeneral(name) {
    return {
      name,
      power: Math.floor(rand(45, 100)),
      leadership: Math.floor(rand(40, 100)),
      charm: Math.floor(rand(35, 100)),
      portrait: null,
      optionalSkills: [],
      troopType: "infantry",
      troops: 10000,
      kills: 0,
      losses: 0,
      alive: true
    };
  }

  function createGeneralFromData(data) {
    return {
      name:       data.name,
      power:      data.power,
      leadership: data.leadership,
      charm:      data.charm,
      portrait:   data.portrait,
      optionalSkills: Array.isArray(data.optionalSkills) ? [...data.optionalSkills] : [],
      troopType:  "infantry",
      troops:     10000,
      kills:      0,
      losses:     0,
      alive:      true
    };
  }

  function normalizeTroopType(type) {
    return TROOP_TYPES[type] ? type : "infantry";
  }

  function troopTypeInfo(type) {
    return TROOP_TYPES[normalizeTroopType(type)];
  }

  function troopPopulationCost(type) {
    return troopTypeInfo(type).populationCost;
  }

  function troopWalkFrames(type) {
    return troopTypeInfo(type).walkFrames;
  }

  function troopRenderScale(type) {
    return troopTypeInfo(type).renderScale(game.tileW);
  }

  function troopRenderHeight(type) {
    return troopTypeInfo(type).sourceHeight * troopRenderScale(type);
  }

  function formationSpacing(formation) {
    return densityInfo[formation.density].spacing * troopTypeInfo(formation.troopType).spacingMult;
  }

  function formationUnitRadius(formation) {
    return UNIT_RADIUS * troopTypeInfo(formation.troopType).collisionMult;
  }

  function troopPopulation(troops, type) {
    return Math.max(0, Math.round(troops)) * troopPopulationCost(type);
  }

  function isDensityAllowed(troopType, density) {
    return troopTypeInfo(troopType).allowedDensities.includes(density);
  }

  function normalizeDensityForTroopType(troopType, density) {
    return isDensityAllowed(troopType, density) ? density : troopTypeInfo(troopType).allowedDensities[0];
  }

  function minTroopsForType(type) {
    return Math.ceil(TROOP_MIN_POPULATION / troopPopulationCost(type));
  }

  function normalizeTroopsForType(troops, type) {
    return Math.max(minTroopsForType(type), Math.round(troops));
  }

  function selectableSkills(general, troopType = general.troopType) {
    const typeInfo = troopTypeInfo(troopType);
    if (Array.isArray(typeInfo.allowedSkills)) return [...typeInfo.allowedSkills];
    const optional = Array.isArray(general.optionalSkills)
      ? general.optionalSkills.filter(skill => EXTRA_SKILLS.includes(skill))
      : [];
    return [...BASIC_SKILLS, ...optional].filter((skill, index, arr) =>
      SKILL_DEF[skill] && arr.indexOf(skill) === index);
  }

  function allSkillButtons() {
    return [...BASIC_SKILLS, ...EXTRA_SKILLS].filter(skill => SKILL_DEF[skill]);
  }

  function normalizeSkillForGeneral(general, skillType, troopType = general.troopType) {
    const skills = selectableSkills(general, troopType);
    return skills.includes(skillType) ? skillType : skills[0];
  }

  function randomSkillForGeneral(general) {
    const skills = selectableSkills(general, general.troopType);
    const common = BASIC_SKILLS.filter(skill => skills.includes(skill));
    const optional = skills.filter(skill => EXTRA_SKILLS.includes(skill));
    if (optional.length && Math.random() < 0.35) {
      return optional[Math.floor(Math.random() * optional.length)];
    }
    return common[Math.floor(Math.random() * common.length)] || 'kihap';
  }

  function buildTerrain() {
    const tiles = Array.from({ length: MAP_HEIGHT }, () => Array.from({ length: MAP_WIDTH }, () => "plain"));

    function paintDisc(cx, cy, radius, type) {
      for (let y = Math.max(0, cy - radius); y <= Math.min(MAP_HEIGHT - 1, cy + radius); y += 1) {
        for (let x = Math.max(0, cx - radius); x <= Math.min(MAP_WIDTH - 1, cx + radius); x += 1) {
          if ((x - cx) ** 2 + (y - cy) ** 2 <= radius * radius) {
            tiles[y][x] = type;
          }
        }
      }
    }

    const playerStart = vec(MAP_WIDTH * 0.08, MAP_HEIGHT * 0.5);
    const enemyStart = vec(MAP_WIDTH * 0.92, MAP_HEIGHT * 0.5);

    // 프랙탈 노이즈 기반 산 생성
    const noiseSeed = Math.floor(Math.random() * 99991);
    function noiseVal(xi, yi) {
      return (tileHash(xi * 7919 + noiseSeed, yi * 6271 + noiseSeed * 2) % 100000) / 100000;
    }
    function smoothNoise(x, y, scale) {
      const xi = Math.floor(x / scale);
      const yi = Math.floor(y / scale);
      const fx = (x / scale) - xi;
      const fy = (y / scale) - yi;
      const sx = fx * fx * (3 - 2 * fx);
      const sy = fy * fy * (3 - 2 * fy);
      return noiseVal(xi, yi) * (1-sx)*(1-sy)
           + noiseVal(xi+1, yi) * sx*(1-sy)
           + noiseVal(xi, yi+1) * (1-sx)*sy
           + noiseVal(xi+1, yi+1) * sx*sy;
    }
    function fractalNoise(x, y) {
      return smoothNoise(x, y, 32) * 0.55
           + smoothNoise(x, y, 14) * 0.30
           + smoothNoise(x, y, 6)  * 0.15;
    }

    // ── 1. 강 생성 (가장 먼저) ──────────────────────────────────────
    function edgeBiased(minV, maxV, power) {
      const u = Math.random();
      const a = Math.pow(Math.abs(2 * u - 1), power);
      const s = u < 0.5 ? -a : a;
      return Math.floor(clamp(((s + 1) / 2) * (maxV - minV) + minV, minV, maxV));
    }
    function edgePoint(edge) {
      if (edge === 0) return [edgeBiased(Math.floor(MAP_WIDTH * 0.10), Math.floor(MAP_WIDTH * 0.90), 0.55), 0];
      if (edge === 1) return [edgeBiased(Math.floor(MAP_WIDTH * 0.10), Math.floor(MAP_WIDTH * 0.90), 0.55), MAP_HEIGHT - 1];
      if (edge === 2) return [0, edgeBiased(Math.floor(MAP_HEIGHT * 0.10), Math.floor(MAP_HEIGHT * 0.90), 0.07)];
      return [MAP_WIDTH - 1, edgeBiased(Math.floor(MAP_HEIGHT * 0.10), Math.floor(MAP_HEIGHT * 0.90), 0.07)];
    }

    let riverGenerated = false;
    if (Math.random() < 0.50) {
      riverGenerated = true;
      const startEdge = Math.floor(Math.random() * 4);
      let endEdge;
      do { endEdge = Math.floor(Math.random() * 4); } while (endEdge === startEdge);
      let [x, y] = edgePoint(startEdge);
      const [tx, ty] = edgePoint(endEdge);
      const baseRadius = 5 + Math.floor(Math.random() * 4);
      const maxSteps = (MAP_WIDTH + MAP_HEIGHT) * 6;
      let currentDrift = (Math.random() - 0.5) * 3.0;
      for (let step = 0; step < maxSteps; step += 1) {
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
        x = clamp(x + (sx || 0), 0, MAP_WIDTH - 1);
        y = clamp(y + (sy || 0), 0, MAP_HEIGHT - 1);
      }
    }

    // ── 2. 강 거리 맵 (BFS) ─────────────────────────────────────────
    const rDist = new Uint16Array(MAP_WIDTH * MAP_HEIGHT).fill(9999);
    if (riverGenerated) {
      const rBfsQ = [];
      for (let ry = 0; ry < MAP_HEIGHT; ry += 1) {
        for (let rx = 0; rx < MAP_WIDTH; rx += 1) {
          if (tiles[ry][rx] === "river") {
            rDist[ry * MAP_WIDTH + rx] = 0;
            rBfsQ.push(ry * MAP_WIDTH + rx);
          }
        }
      }
      for (let qi = 0; qi < rBfsQ.length; qi += 1) {
        const k = rBfsQ[qi];
        const cx = k % MAP_WIDTH, cy = Math.floor(k / MAP_WIDTH);
        const cd = rDist[k];
        if (cd >= 20) continue;
        for (const [ddx, ddy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const nx = cx + ddx, ny = cy + ddy;
          if (nx < 0 || ny < 0 || nx >= MAP_WIDTH || ny >= MAP_HEIGHT) continue;
          const nk = ny * MAP_WIDTH + nx;
          if (rDist[nk] > cd + 1) { rDist[nk] = cd + 1; rBfsQ.push(nk); }
        }
      }
    }

    // ── 3. 산 생성 (강 회피 + 강 있을 때 비율 감소) ─────────────────
    for (let y = 0; y < MAP_HEIGHT; y += 1) {
      for (let x = 0; x < MAP_WIDTH; x += 1) {
        if (tiles[y][x] === "river") continue; // 강 타일은 산으로 안 됨
        const noise = fractalNoise(x, y);
        const xFactor = 1 - Math.abs(x - MAP_WIDTH / 2) / (MAP_WIDTH / 2);
        const yFactor = Math.abs(y - MAP_HEIGHT / 2) / (MAP_HEIGHT / 2);
        const density = xFactor * yFactor;
        const edgeCenterPenalty = (1 - xFactor) * (1 - yFactor) * 0.38;
        // 강 인접: 거리에 반비례해 산 확률 감소
        const rd = rDist[y * MAP_WIDTH + x];
        const riverPenalty = Math.max(0, 10 - rd) * 0.030;
        // 강 있을 때 전체 비율도 낮춤 (base threshold 높임)
        const baseThreshold = riverGenerated ? 0.62 : 0.58;
        const threshold = baseThreshold - density * 0.30 + edgeCenterPenalty + riverPenalty;
        if (noise > threshold) tiles[y][x] = "mountain";
      }
    }

    // 길: A* — 산 거리 맵 기반으로 평지 중앙을 선호하며 좌우 횡단
    {
      // 1. BFS 산 거리 맵
      const mDist = new Uint16Array(MAP_WIDTH * MAP_HEIGHT).fill(9999);
      const bfsQ = [];
      for (let my = 0; my < MAP_HEIGHT; my += 1) {
        for (let mx = 0; mx < MAP_WIDTH; mx += 1) {
          if (tiles[my][mx] === "mountain") {
            mDist[my * MAP_WIDTH + mx] = 0;
            bfsQ.push(my * MAP_WIDTH + mx);
          }
        }
      }
      for (let qi = 0; qi < bfsQ.length; qi += 1) {
        const k = bfsQ[qi];
        const cx = k % MAP_WIDTH, cy = Math.floor(k / MAP_WIDTH);
        const cd = mDist[k];
        if (cd >= 18) continue;
        for (const [ddx, ddy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const nx = cx + ddx, ny = cy + ddy;
          if (nx < 0 || ny < 0 || nx >= MAP_WIDTH || ny >= MAP_HEIGHT) continue;
          const nk = ny * MAP_WIDTH + nx;
          if (mDist[nk] > cd + 1) { mDist[nk] = cd + 1; bfsQ.push(nk); }
        }
      }

      // 2. x 열마다 최선의 y를 찾고 지수 평활로 부드럽게 연결
      let smoothY = MAP_HEIGHT / 2;
      const crossingSeeds = new Set();

      for (let x = 0; x < MAP_WIDTH; x += 1) {
        let bestY = Math.round(smoothY), bestScore = -Infinity;
        for (let dy = -20; dy <= 20; dy += 1) {
          const cy = clamp(Math.round(smoothY) + dy, 2, MAP_HEIGHT - 3);
          const score = mDist[cy * MAP_WIDTH + x]
            - Math.abs(cy - MAP_HEIGHT / 2) * 0.25
            - Math.abs(cy - smoothY) * 0.6;
          if (score > bestScore) { bestScore = score; bestY = cy; }
        }
        smoothY = smoothY * 0.88 + bestY * 0.12;
        const ry = clamp(Math.round(smoothY), 2, MAP_HEIGHT - 3);
        const roadRadius = 3;
        for (let py = Math.max(0, ry - roadRadius); py <= Math.min(MAP_HEIGHT - 1, ry + roadRadius); py += 1) {
          for (let px = Math.max(0, x - roadRadius); px <= Math.min(MAP_WIDTH - 1, x + roadRadius); px += 1) {
            if ((px - x) ** 2 + (py - ry) ** 2 <= roadRadius * roadRadius) {
              if (tiles[py][px] === "river") {
                crossingSeeds.add(py * MAP_WIDTH + px); // 강 타일은 수집만
              } else {
                tiles[py][px] = "road";
              }
            }
          }
        }
      }

      // 강이 시작 구역을 가로지르는 경우도 습지 씨앗에 추가
      for (let sy = 45; sy <= 115; sy++) {
        for (let sx = 0; sx <= 35; sx++) {
          if (tiles[sy][sx] === "river") crossingSeeds.add(sy * MAP_WIDTH + sx);
        }
        for (let sx = MAP_WIDTH - 36; sx < MAP_WIDTH; sx++) {
          if (tiles[sy][sx] === "river") crossingSeeds.add(sy * MAP_WIDTH + sx);
        }
      }

      // 교차·시작구역 씨앗에서 BFS로 연결된 강 타일 전체 습지로 변환
      if (crossingSeeds.size > 0) {
        const wetlandVisited = new Map([...crossingSeeds].map(k => [k, 0]));
        const wetlandQueue = [...crossingSeeds].map(k => [k, 0]);
        for (let wqi = 0; wqi < wetlandQueue.length; wqi++) {
          const [k, dist] = wetlandQueue[wqi];
          const cx = k % MAP_WIDTH, cy = Math.floor(k / MAP_WIDTH);
          tiles[cy][cx] = "wetland";
          if (dist >= 8) continue;
          for (const [ddx, ddy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
            const nx = cx + ddx, ny = cy + ddy;
            if (nx < 0 || ny < 0 || nx >= MAP_WIDTH || ny >= MAP_HEIGHT) continue;
            const nk = ny * MAP_WIDTH + nx;
            if (!wetlandVisited.has(nk) && tiles[ny][nx] === "river") {
              wetlandVisited.set(nk, dist + 1);
              wetlandQueue.push([nk, dist + 1]);
            }
          }
        }
      }
    }

    // ── 풀밭(grassland) 생성 — plain 위에 군집형 패치 ────────────────
    {
      const gSeed = Math.floor(Math.random() * 99991);
      function gNoiseVal(xi, yi) {
        return (tileHash(xi * 6571 + gSeed, yi * 5419 + gSeed * 3) % 100000) / 100000;
      }
      function gSmooth(x, y, scale) {
        const xi = Math.floor(x / scale), yi = Math.floor(y / scale);
        const fx = (x / scale) - xi, fy = (y / scale) - yi;
        const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
        return gNoiseVal(xi, yi)    * (1-sx)*(1-sy)
             + gNoiseVal(xi+1, yi)  * sx*(1-sy)
             + gNoiseVal(xi, yi+1)  * (1-sx)*sy
             + gNoiseVal(xi+1,yi+1) * sx*sy;
      }
      function grassNoise(x, y) {
        return gSmooth(x, y, 22) * 0.55 + gSmooth(x, y, 9) * 0.30 + gSmooth(x, y, 4) * 0.15;
      }
      for (let y = 0; y < MAP_HEIGHT; y++) {
        for (let x = 0; x < MAP_WIDTH; x++) {
          if (tiles[y][x] !== "plain") continue;
          if (grassNoise(x, y) > 0.72) tiles[y][x] = "grassland";
        }
      }
    }

    return { tiles, playerStart, enemyStart };
  }

  function createFormationUnits(team, formationId, troops, anchor, facing) {
    const units = [];
    const count = Math.ceil(Math.max(0, troops) / 100);
    for (let i = 0; i < count; i += 1) {
      const remaining = troops - i * 100;
      const capacity = Math.min(100, Math.max(0, remaining));
      units.push({
        id: `${team}-${formationId}-${i}`,
        x: anchor.x,
        y: anchor.y,
        vx: 0,
        vy: 0,
        damage: 0,
        capacity,
        slotIndex: i,
        slotLocal: vec(),
        chaosSeed: Math.random(),
        chaosPhaseOffset: Math.random() * Math.PI * 2,
        chaseEntry: null,
        chaseTimer: 0,
        rangedCooldown: Math.random(),
        kihapTimer: 0,
        visualFacingLeft: facing.x < -0.05
      });
    }
    return units;
  }

  function createFormation(id, team, general, anchor, facing) {
    general.troopType = normalizeTroopType(general.troopType);
    general.troops = normalizeTroopsForType(general.troops, general.troopType);
    const initialSkill = normalizeSkillForGeneral(general, general.skillType || randomSkillForGeneral(general), general.troopType);
    general.skillType = initialSkill;
    const units = createFormationUnits(team, id, general.troops, anchor, facing);
    return {
      id,
      team,
      general,
      troopType: general.troopType,
      anchor: { ...anchor },
      units,
      ratio: 1.0,
      density: "NORMAL",
      speed: "STOP",
      target: null,
      followTarget: null,
      retreated: false,
      retreating: false,
      retreatLastCheckpoint: 0,
      disorder: 0,
      disorderAccum: 0,
      facing: { ...facing },
      selected: false,
      reorganizeTimer: 3.0 + Math.random() * 3.0,
      kihapCooldown: 0,
      skillCooldown: 0,
      skillType: initialSkill,
      swiftTimer: 0,
      archeryTimer: 0,
      guardTimer: 0,
      prevSpeed: "NORMAL",
      speechBubble: null,
      speechCooldown: 0,
      speechTerrainLast: "",
      speechDisorderTriggered: false,
    };
  }

  function buildScenario() {
    const terrain = buildTerrain();
    let playerGenerals, enemyGenerals;
    if (generalsData && generalsData.length >= 10) {
      const pool = [...generalsData];
      const chosen = [];
      while (chosen.length < 10) {
        const i = Math.floor(Math.random() * pool.length);
        chosen.push(pool.splice(i, 1)[0]);
      }
      playerGenerals = chosen.slice(0, 5).map(createGeneralFromData);
      enemyGenerals  = chosen.slice(5).map(createGeneralFromData);
    } else {
      const names = chooseNames();
      playerGenerals = names.slice(0, 5).map(createGeneral);
      enemyGenerals  = names.slice(5).map(createGeneral);
    }
    [0, 4].forEach((index) => {
      if (!playerGenerals[index]) return;
      playerGenerals[index].troopType = "cavalry";
      playerGenerals[index].troops = 2500;
      playerGenerals[index].skillType = "kihap";
    });
    const playerFormations = playerGenerals.map((general, index) => {
      const formation = createFormation(index, "player", general, vec(terrain.playerStart.x, terrain.playerStart.y + (index - 2) * 10), vec(1, 0));
      initializeFormationSlots(formation, false);
      return formation;
    });
    const enemyFormations = enemyGenerals.map((general, index) => {
      const formation = createFormation(index, "enemy", general, vec(terrain.enemyStart.x, terrain.enemyStart.y + (index - 2) * 10), vec(-1, 0));
      initializeFormationSlots(formation, false);
      return formation;
    });
    return { terrain, playerFormations, enemyFormations };
  }

  const game = {
    ...buildScenario(),
    tileW: DEFAULT_TILE_W,
    battlePhase: "planning",
    battleTime: 0,
    selectedId: 0,
    camera: vec(0, 0),
    dragState: null,
    phaseButton,
    speedMultiplier: 1,
    simulationAccumulator: 0,
    aiTimer: 0,
    enemyStrategy: null,
    strategyTick: 0,
    battleEndPending: false,
    battleEndTimer: 0,
    battleEndWon: null,
    hudRefreshAccumulator: 0,
    hudDirty: true,
    terrainRender: null,
    projectiles: [],
    traces: [],
    speechEnemySighted: new Set(),
    fires: [],     // 화공 화염 오브젝트 배열
    flood: null,   // 수공 상태 { timer, damageDealt, cleanupTimer }
  };
  // ── 픽셀아트 스프라이트 시스템 ──────────────────────────────────────
  const SPRITE_W = 10;
  const SPRITE_H = 14;
  const SPRITE_FRAMES = [
    // Frame 0: 서있기
    [
      [0,0,1,2,2,2,1,0,0,0],
      [0,1,2,2,2,2,2,1,0,0],
      [0,1,3,5,5,3,2,1,0,0],
      [0,0,1,5,5,1,0,0,0,0],
      [0,1,2,2,2,2,2,1,0,0],
      [1,2,3,2,2,2,2,2,1,0],
      [1,2,2,2,2,2,2,2,1,0],
      [1,2,4,2,7,2,4,2,1,0],
      [0,1,2,2,1,2,2,1,0,0],
      [0,0,1,6,0,6,1,0,0,0],
      [0,0,6,6,0,6,6,0,0,0],
      [0,0,6,6,0,6,6,0,0,0],
      [0,1,6,6,1,6,6,1,0,0],
      [0,0,0,0,0,0,0,0,0,0],
    ],
    // Frame 1: 걷기
    [
      [0,0,1,2,2,2,1,0,0,0],
      [0,1,2,2,2,2,2,1,0,0],
      [0,1,3,5,5,3,2,1,0,0],
      [0,0,1,5,5,1,0,0,0,0],
      [0,1,2,2,2,2,2,1,0,0],
      [1,2,3,2,2,2,2,2,1,0],
      [1,2,2,2,2,2,2,2,1,0],
      [1,2,4,2,7,2,4,2,1,0],
      [0,1,2,2,1,2,2,1,0,0],
      [0,1,6,0,0,0,6,1,0,0],
      [1,6,6,0,0,0,6,6,1,0],
      [0,1,6,1,0,1,6,1,0,0],
      [0,0,0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0,0,0],
    ],
  ];
  const SPRITE_PALETTES = {
    player: ['', '#0a0a14', '#3a99d4', '#60bcf5', '#1a5f8a', '#e8b190', '#1a2232', '#d48f30'],
    enemy:  ['', '#0a0a0a', '#b83047', '#e0556c', '#601824', '#e8b190', '#20140a', '#c07d20'],
  };
  const BONUS_PALETTES = {
    player: ['', '#0a0a14', '#3ab3d4', '#60d5f5', '#1a728a', '#e8a290', '#1a2632', '#d47430'],
    enemy:  ['', '#0a0a0a', '#b8305d', '#e05583', '#601830', '#e8a290', '#20100a', '#c06320'],
  };
  function buildSpriteCache() {
    function makeSpritePair(pal, frame) {
      const right = createSurface(SPRITE_W, SPRITE_H);
      const rc = right.getContext('2d');
      frame.forEach((row, y) => row.forEach((ci, x) => {
        if (!ci) return;
        rc.fillStyle = pal[ci];
        rc.fillRect(x, y, 1, 1);
      }));
      const left = createSurface(SPRITE_W, SPRITE_H);
      const lc = left.getContext('2d');
      lc.translate(SPRITE_W, 0); lc.scale(-1, 1);
      lc.drawImage(right, 0, 0);
      return { right, left };
    }
    const cache = { player: [], enemy: [] };
    ['player', 'enemy'].forEach((team) => {
      SPRITE_FRAMES.forEach((frame) => {
        const reg   = makeSpritePair(SPRITE_PALETTES[team], frame);
        const bonus = makeSpritePair(BONUS_PALETTES[team],  frame);
        cache[team].push({
          right: reg.right, left: reg.left,
          bonusRight: bonus.right, bonusLeft: bonus.left,
        });
      });
    });
    return cache;
  }

  game.terrainRender = buildTerrainRenderData(game.terrain);
  preloadTerrainSprites();
  game.spriteCache = buildSpriteCache();

  function getTileH() {
    return Math.floor(game.tileW / 2);
  }

  function isoPoint(x, y) {
    return { x: (x - y) * (game.tileW / 2), y: (x + y) * (getTileH() / 2) };
  }

  function viewportOrigin() {
    return vec(canvas.width / window.devicePixelRatio / 2, 150);
  }

  function toScreen(x, y) {
    const iso = isoPoint(x, y);
    const origin = viewportOrigin();
    return { x: iso.x - game.camera.x + origin.x, y: iso.y - game.camera.y + origin.y };
  }

  function toTile(screenX, screenY) {
    const origin = viewportOrigin();
    const sx = screenX + game.camera.x - origin.x;
    const sy = screenY + game.camera.y - origin.y;
    const halfW = game.tileW / 2;
    const halfH = getTileH() / 2;
    return vec(clamp((sx / halfW + sy / halfH) / 2, 0, MAP_WIDTH - 1), clamp((sy / halfH - sx / halfW) / 2, 0, MAP_HEIGHT - 1));
  }

  function centerCameraOn(pos) {
    const iso = isoPoint(pos.x, pos.y);
    game.camera.x = iso.x;
    game.camera.y = iso.y - 140;
  }

  function formationCenter(formation) {
    const alive = formation.units.filter(isUnitAlive);
    if (!alive.length) return { ...formation.anchor };
    const sum = alive.reduce((acc, unit) => ({ x: acc.x + unit.x, y: acc.y + unit.y }), vec(0, 0));
    return vec(sum.x / alive.length, sum.y / alive.length);
  }

  function currentSelection() {
    return game.playerFormations.filter((formation) => formation.id === game.selectedId);
  }

  function computeLocalGridOffsets(count, ratio, spacing) {
    const colsBase = Math.max(1, Math.round(Math.sqrt(count * ratio)));
    let cols = colsBase;
    let rows = Math.max(1, Math.ceil(count / cols));
    while (cols / Math.max(1, rows) > ratio * 1.4 && cols > 1) {
      cols -= 1;
      rows = Math.max(1, Math.ceil(count / cols));
    }
    while (cols / Math.max(1, rows) < ratio * 0.72) {
      cols += 1;
      rows = Math.max(1, Math.ceil(count / cols));
    }
    const offsets = [];
    for (let row = rows - 1; row >= 0; row -= 1) {
      for (let col = 0; col < cols; col += 1) {
        if (offsets.length >= count) break;
        const ox = (col - (cols - 1) / 2) * spacing;
        const oy = (row - (rows - 1) / 2) * spacing;
        offsets.push(vec(ox, oy));
      }
    }
    return offsets;
  }

  function worldFromLocal(formation, local) {
    const forward = normalize(formation.facing);
    const lateral = { x: -forward.y, y: forward.x };
    return add(mul(lateral, local.x), mul(forward, local.y));
  }

  function fillSlotFromBehind(formation, deadUnit) {
    const spacing = formationSpacing(formation);
    const colTolerance = spacing * 0.5;

    let gapX = deadUnit.slotLocal.x;
    let gapY = deadUnit.slotLocal.y;
    let gapIndex = deadUnit.slotIndex;

    while (true) {
      let successor = null;
      let bestY = -Infinity;
      for (const u of formation.units) {
        if (!isUnitAlive(u)) continue;
        if (Math.abs(u.slotLocal.x - gapX) >= colTolerance) continue;
        if (u.slotLocal.y >= gapY) continue;
        if (u.slotLocal.y > bestY) {
          bestY = u.slotLocal.y;
          successor = u;
        }
      }

      if (!successor) break;

      const prevX = successor.slotLocal.x;
      const prevY = successor.slotLocal.y;
      const prevIndex = successor.slotIndex;

      successor.slotLocal = { x: gapX, y: gapY };
      successor.slotIndex = gapIndex;

      gapX = prevX;
      gapY = prevY;
      gapIndex = prevIndex;
    }

    refreshFirstRowFlags(formation);
  }

  function refreshFirstRowFlags(formation) {
    const aliveUnits = formation.units.filter(isUnitAlive);
    if (!aliveUnits.length) return;
    const maxLocalY = Math.max(...aliveUnits.map((u) => u.slotLocal.y));
    const frontTolerance = formationSpacing(formation) * 0.5;
    aliveUnits.forEach((unit) => {
      unit.isFirstRow = unit.slotLocal.y >= maxLocalY - frontTolerance;
    });
  }

  function applyTurnRule(formation, desiredFacing) {
    const currentFacing = normalize(formation.facing);
    const nextFacing = normalize(desiredFacing);
    if (len(nextFacing.x, nextFacing.y) <= 0.0001) return;

    const dot = clamp(currentFacing.x * nextFacing.x + currentFacing.y * nextFacing.y, -1, 1);
    const cross = currentFacing.x * nextFacing.y - currentFacing.y * nextFacing.x;
    const angle = Math.acos(dot) * 180 / Math.PI;

    if (angle > 120) {
      formation.units.forEach((unit) => {
        const local = unit.slotLocal || vec();
        unit.slotLocal = vec(-local.x, -local.y);
      });
      formation.facing = nextFacing;
      refreshFirstRowFlags(formation);
      return;
    }

    if (angle >= 60 && angle <= 120) {
      formation.units.forEach((unit) => {
        const local = unit.slotLocal || vec();
        if (cross >= 0) {
          unit.slotLocal = vec(-local.y, local.x);
        } else {
          unit.slotLocal = vec(local.y, -local.x);
        }
      });
      formation.ratio = clamp(1 / Math.max(0.33, formation.ratio), 0.33, 3.0);
      formation.facing = nextFacing;
      initializeFormationSlots(formation, true);
      return;
    }

    formation.facing = nextFacing;
  }

  function initializeFormationSlots(formation, preserveLayout) {
    const aliveUnits = formation.units.filter(isUnitAlive);
    if (!aliveUnits.length) return;
    const newLocals = computeLocalGridOffsets(aliveUnits.length, formation.ratio, formationSpacing(formation));

    if (!preserveLayout) {
      aliveUnits.forEach((unit, index) => {
        unit.slotIndex = index;
        unit.slotLocal = { ...newLocals[index] };
        const world = worldFromLocal(formation, unit.slotLocal);
        unit.x = formation.anchor.x + world.x;
        unit.y = formation.anchor.y + world.y;
        unit.vx = 0;
        unit.vy = 0;
      });
    } else {
      const remainingSlots = newLocals.map((local, index) => ({ index, local }));
      const rankedUnits = [...aliveUnits].sort((a, b) => {
        const ar = len(a.slotLocal.x, a.slotLocal.y);
        const br = len(b.slotLocal.x, b.slotLocal.y);
        if (Math.abs(br - ar) > 0.001) return br - ar;
        return a.slotIndex - b.slotIndex;
      });

      rankedUnits.forEach((unit) => {
        let best = 0;
        let bestCost = Infinity;
        for (let i = 0; i < remainingSlots.length; i += 1) {
          const candidate = remainingSlots[i].local;
          const cost = len(candidate.x - unit.slotLocal.x, candidate.y - unit.slotLocal.y);
          if (cost < bestCost) {
            bestCost = cost;
            best = i;
          }
        }
        const chosen = remainingSlots.splice(best, 1)[0];
        unit.slotIndex = chosen.index;
        unit.slotLocal = { ...chosen.local };
      });
    }

    // 슬롯 배정 후 최전방 열 판별 (local.y 최대 = facing 방향 앞)
    const maxLocalY = Math.max(...aliveUnits.map((u) => u.slotLocal.y));
    const frontTolerance = formationSpacing(formation) * 0.5;
    aliveUnits.forEach((unit) => {
      unit.isFirstRow = unit.slotLocal.y >= maxLocalY - frontTolerance;
    });
  }

  function unitDefense(formation, unit) {
    const tx = clamp(Math.floor(unit.x), 0, MAP_WIDTH - 1);
    const ty = clamp(Math.floor(unit.y), 0, MAP_HEIGHT - 1);
    const tile = terrainInfo[game.terrain.tiles[ty][tx]];
    const base = Math.max(0, 2 + speedInfo[formation.speed].defense + densityInfo[formation.density].defense + tile.defense - formation.disorder * 2);
    const defense = base * troopTypeInfo(formation.troopType).meleeDefenseMult;
    return formation.troopType === 'cavalry' ? defense + 10 : defense;
  }

  function unitRemainingTroops(unit) {
    return Math.max(0, unitCapacity(unit) - unit.damage);
  }

  function unitCapacity(unit) {
    return unit.capacity || 100;
  }

  function isUnitAlive(unit) {
    return unit.damage < unitCapacity(unit);
  }

  function formationInitialTroops(formation) {
    return formation.units.reduce((sum, unit) => sum + (unit.capacity || 100), 0);
  }

  function formationRemainingTroops(formation) {
    return formation.units.reduce((sum, unit) => sum + unitRemainingTroops(unit), 0);
  }

  function formationRemainingPopulation(formation) {
    return formationRemainingTroops(formation) * troopPopulationCost(formation.troopType);
  }

  function formatTroops(value) {
    return Math.round(Math.max(0, value)).toLocaleString();
  }

  function applyUnitDamage(targetFormation, unit, amount, attackerFormation = null, options = {}) {
    if (!targetFormation || !unit || amount <= 0 || !isUnitAlive(unit)) return 0;
    const prevDamage = unit.damage;
    const capacity = unitCapacity(unit);
    if (prevDamage >= capacity) return 0;
    const appliedDamage = Math.min(amount, capacity - prevDamage);
    unit.damage = Math.min(capacity, prevDamage + appliedDamage);
    targetFormation.general.losses += appliedDamage;
    if (attackerFormation && attackerFormation !== targetFormation) {
      attackerFormation.general.kills += appliedDamage;
    }
    if (unit.damage >= capacity && prevDamage < capacity) {
      fillSlotFromBehind(targetFormation, unit);
      if (options.trace !== false && game.traces.length < 2000 && !isOnWater(unit)) {
        game.traces.push({ x: unit.x, y: unit.y, type: Math.floor(Math.random() * 3) });
      }
    }
    return appliedDamage;
  }

  function unitAttack(formation) {
    const rawSpeed  = anchorMoveSpeed(formation, formation.anchor.x, formation.anchor.y);
    const speedRatio = Math.min(1.0, rawSpeed / speedInfo["FAST"].move); // 0~1
    const attackMult = 0.95 + speedRatio * (1.05 - 0.95);
    return Math.max(0, (15 + formation.general.power / 100 * 15) * (1 - formation.disorder * 0.25) * attackMult)
      * troopTypeInfo(formation.troopType).meleeAttackMult;
  }

  function rangedDefenseDamageMult(formation) {
    return densityInfo[formation.density].rangedDefenseMult / troopTypeInfo(formation.troopType).rangedDefenseMult;
  }

  function canFormationRangedAttack(formation) {
    return troopTypeInfo(formation.troopType).canRangedAttack;
  }

  function rangedAttack(formation) {
    if (!canFormationRangedAttack(formation)) return 0;
    return (15 + formation.general.power / 100 * 15) * 0.2 * troopTypeInfo(formation.troopType).rangedAttackMult;
  }

  function moveMultiplier(x, y) {
    const tx = clamp(Math.floor(x), 0, MAP_WIDTH - 1);
    const ty = clamp(Math.floor(y), 0, MAP_HEIGHT - 1);
    return terrainInfo[game.terrain.tiles[ty][tx]].move;
  }

  function tileAt(x, y) {
    if (x < 0 || y < 0 || x >= MAP_WIDTH || y >= MAP_HEIGHT) return null;
    return game.terrain.tiles[y][x];
  }

  function tileHash(x, y) {
    const value = Math.imul(x + 11, 374761393) ^ Math.imul(y + 17, 668265263);
    return (value ^ value >>> 13) >>> 0;
  }

  function isUnitInPosition(formation, unit, threshold) {
    const targetSlot = add(formation.anchor, worldFromLocal(formation, unit.slotLocal));
    return len(targetSlot.x - unit.x, targetSlot.y - unit.y) < threshold;
  }

  function kihapMaxCooldown(formation) {
    return 200 - (formation.general.charm / 100) * 60;
  }

  function activateKihap(formation) {
    if (formation.kihapCooldown > 0) return;
    formation.units.forEach((u) => {
      if (isUnitAlive(u)) u.kihapTimer = 4 + Math.random() * 2;
    });
    formation.disorderAccum = Math.max(0, formation.disorderAccum - 0.1);
    formation.disorder = Math.max(0, formation.disorder - 0.1);
    formation.kihapCooldown = kihapMaxCooldown(formation);
    // 기합 말풍선 (높은 확률)
    if (speechData) tryShowSpeech(formation, randFrom(speechData.kihap), "high");
  }

  function skillMaxCooldown(formation) {
    return SKILL_DEF[formation.skillType]?.cooldown(formation) ?? 90;
  }

  function isOnWater(unit) {
    const tx = clamp(Math.floor(unit.x), 0, MAP_WIDTH - 1);
    const ty = clamp(Math.floor(unit.y), 0, MAP_HEIGHT - 1);
    const t = game.terrain.tiles[ty][tx];
    return t === "river" || t === "wetland";
  }

  function activateSkill(formation) {
    if (game.battlePhase !== "live") return;
    if (formation.skillCooldown > 0) return;
    // 공통: 혼란도 0.1 감소
    formation.disorderAccum = Math.max(0, formation.disorderAccum - 0.1);
    formation.disorder      = Math.max(0, formation.disorder - 0.1);
    formation.skillCooldown = skillMaxCooldown(formation);

    switch (formation.skillType) {
      case "kihap": {
        formation.units.forEach(u => { if (isUnitAlive(u)) u.kihapTimer = 4 + Math.random() * 2; });
        formation.kihapCooldown = kihapMaxCooldown(formation);
        if (speechData) tryShowSpeech(formation, randFrom(speechData.kihap), "high");
        break;
      }
      case "swift": {
        formation.swiftTimer = 12.0;
        if (speechData) tryShowSpeech(formation, "전속력으로 돌격한다!", "high");
        break;
      }
      case "guard": {
        formation.guardTimer = 7.0 + (formation.general.leadership / 100) * 3.0;
        if (speechData) tryShowSpeech(formation, "방패를 굳게 세워라!", "high");
        break;
      }
      case "archery": {
        formation.archeryTimer = 5.0;
        if (speechData) tryShowSpeech(formation, "화살이 하늘을 덮는다!", "high");
        break;
      }
      case "fire": {
        const fwd   = normalize(formation.facing);
        const alive = formation.units.filter(isUnitAlive);
        // 최전방 유닛 위치 탐색 (facing 방향 투영 최대값)
        let maxProj = -Infinity, frontX = formation.anchor.x, frontY = formation.anchor.y;
        alive.forEach(u => {
          const proj = u.x * fwd.x + u.y * fwd.y;
          if (proj > maxProj) { maxProj = proj; frontX = u.x; frontY = u.y; }
        });
        // 최전방 유닛에서 4타일 앞
        const baseCx = frontX + fwd.x * 4;
        const baseCy = frontY + fwd.y * 4;
        // 4×4 파티클 — 각각 개별 지속시간(10~20초)과 이동 타이머, 강/습지 제외
        const particles = [];
        for (let dy = 0; dy < 4; dy++)
          for (let dx = 0; dx < 4; dx++) {
            const px = clamp(baseCx + (dx - 1.5) * 1.0, 1, MAP_WIDTH  - 1);
            const py = clamp(baseCy + (dy - 1.5) * 1.0, 1, MAP_HEIGHT - 1);
            const ptile = game.terrain.tiles[clamp(Math.floor(py), 0, MAP_HEIGHT - 1)][clamp(Math.floor(px), 0, MAP_WIDTH - 1)];
            if (ptile === "river" || ptile === "wetland") continue;
            particles.push({
              x: px, y: py,
              duration:  10 + Math.random() * 10,   // 10~20초 개별 지속
              moveTimer: 1.0 + Math.random() * 0.4,
            });
          }
        game.fires.push({ particles, dmgTimer: 1.0 });
        // 화공 사용 후 진형 자동 정지
        if (formation.speed !== "STOP") formation.prevSpeed = formation.speed;
        formation.speed = "STOP";
        formation.target = null;
        if (speechData) tryShowSpeech(formation, "화공을 펼쳐라! 불태워라!", "high");
        break;
      }
      case "flood": {
        game.flood = { timer: 2.0, damageDealt: false, cleanupTimer: 1.0 };
        break;
      }
    }
  }

  // ── 스킬 상태 업데이트 ──────────────────────────────────────────────────
  function updateSkills(dt) {
    if (game.battlePhase !== "live") return;
    const allF = [...game.playerFormations, ...game.enemyFormations];

    // 스킬 쿨다운 · 지속형 스킬 타이머 감소
    allF.forEach(f => {
      if (f.skillCooldown > 0) f.skillCooldown -= dt;
      if (f.swiftTimer   > 0) f.swiftTimer    -= dt;
      if (f.archeryTimer > 0) f.archeryTimer  -= dt;
      if (f.guardTimer   > 0) f.guardTimer    -= dt;
    });

    // 화공 업데이트
    game.fires = game.fires.filter(fire => {
      // 파티클 개별 지속시간 감소 및 소멸
      fire.particles = fire.particles.filter(p => {
        p.duration -= dt;
        if (p.duration <= 0) return false;
        p.moveTimer -= dt;
        if (p.moveTimer <= 0) {
          p.moveTimer = 1.0;
          const angle = Math.random() * Math.PI * 2;
          const nx = clamp(p.x + Math.cos(angle) * 0.5, 1, MAP_WIDTH  - 1);
          const ny = clamp(p.y + Math.sin(angle) * 0.5, 1, MAP_HEIGHT - 1);
          const ntile = game.terrain.tiles[clamp(Math.floor(ny), 0, MAP_HEIGHT - 1)][clamp(Math.floor(nx), 0, MAP_WIDTH - 1)];
          if (ntile !== "river" && ntile !== "wetland") { p.x = nx; p.y = ny; }
        }
        return true;
      });
      if (fire.particles.length === 0) return false;

      // 초당 데미지
      fire.dmgTimer -= dt;
      if (fire.dmgTimer <= 0) {
        fire.dmgTimer = 1.0;
        allF.forEach(f => {
          f.units.forEach(u => {
            if (!isUnitAlive(u)) return;
            if (!fire.particles.some(p => len(u.x - p.x, u.y - p.y) < 0.55)) return;
            applyUnitDamage(f, u, 20);
          });
        });
      }
      return true;
    });

    // 수공 업데이트
    if (game.flood) {
      game.flood.timer -= dt;
      if (game.flood.timer <= 0 && !game.flood.damageDealt) {
        game.flood.damageDealt = true;
        allF.forEach(f => {
          let hit = false;
          f.units.forEach(u => {
            if (!isUnitAlive(u)) return;
            if (!isOnWater(u)) return;
            const dmg = applyUnitDamage(f, u, 20, null, { trace: false });
            if (dmg > 0) {
              hit = true;
              const angle = Math.random() * Math.PI * 2;
              const dist = 1.0 + Math.random() * 3.0;
              u.x = clamp(u.x + Math.cos(angle) * dist, 0, MAP_WIDTH - 1);
              u.y = clamp(u.y + Math.sin(angle) * dist, 0, MAP_HEIGHT - 1);
            }
          });
          if (hit) tryShowSpeech(f, "범람의 피해를 입었다!", "high");
        });
      }
      if (game.flood.damageDealt) {
        game.flood.cleanupTimer -= dt;
        if (game.flood.cleanupTimer <= 0) game.flood = null;
      }
    }
  }

  function buildSpatialHash(formations) {
    const cells = new Map();
    formations.forEach((formation) => {
      formation.units.forEach((unit) => {
        if (!isUnitAlive(unit)) return;
        const cellX = Math.floor(unit.x / SPATIAL_CELL_SIZE);
        const cellY = Math.floor(unit.y / SPATIAL_CELL_SIZE);
        const key = `${cellX}:${cellY}`;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push({ formation, unit });
      });
    });
    return { cells, cellSize: SPATIAL_CELL_SIZE };
  }

  function findNearbyUnits(spatialHash, x, y, radius) {
    const minCellX = Math.floor((x - radius) / spatialHash.cellSize);
    const maxCellX = Math.floor((x + radius) / spatialHash.cellSize);
    const minCellY = Math.floor((y - radius) / spatialHash.cellSize);
    const maxCellY = Math.floor((y + radius) / spatialHash.cellSize);
    const result = [];
    const radiusSq = radius * radius;
    for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
      for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
        const entries = spatialHash.cells.get(`${cellX}:${cellY}`);
        if (!entries) continue;
        for (const entry of entries) {
          const dx = entry.unit.x - x;
          const dy = entry.unit.y - y;
          if (dx * dx + dy * dy <= radiusSq) result.push(entry);
        }
      }
    }
    return result;
  }

  function findNearestEnemy(spatialHash, x, y, radius) {
    const minCellX = Math.floor((x - radius) / spatialHash.cellSize);
    const maxCellX = Math.floor((x + radius) / spatialHash.cellSize);
    const minCellY = Math.floor((y - radius) / spatialHash.cellSize);
    const maxCellY = Math.floor((y + radius) / spatialHash.cellSize);
    let best = null;
    let bestDistanceSq = radius * radius;

    for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
      for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
        const entries = spatialHash.cells.get(`${cellX}:${cellY}`);
        if (!entries) continue;
        for (let index = 0; index < entries.length; index += 1) {
          const entry = entries[index];
          const dx = entry.unit.x - x;
          const dy = entry.unit.y - y;
          const distanceSq = dx * dx + dy * dy;
          if (distanceSq <= bestDistanceSq) {
            bestDistanceSq = distanceSq;
            best = entry;
          }
        }
      }
    }

    return best;
  }

  function anchorMoveSpeed(formation, x, y) {
    const troopPenalty = Math.max(0.65, 1 - (formationRemainingPopulation(formation) / 50000) * 0.35);
    const swift = formation.swiftTimer > 0 ? 1.5 : 1.0;
    return speedInfo[formation.speed].move * moveMultiplier(x, y) * troopPenalty * swift * troopTypeInfo(formation.troopType).moveMult;
  }

  function unitMoveSpeed(formation, x, y) {
    const troopPenalty = Math.max(0.65, 1 - (formationRemainingPopulation(formation) / 50000) * 0.35);
    const swift = formation.swiftTimer > 0 ? 1.5 : 1.0;
    const disorderPenalty = Math.max(0.1, 1 - formation.disorder * 1.4 * (1 - speedInfo["NORMAL"].move / speedInfo["FAST"].move));
    return speedInfo["FAST"].move * moveMultiplier(x, y) * (1 + formation.general.leadership / 100 * 0.4) * troopPenalty * swift * troopTypeInfo(formation.troopType).moveMult * disorderPenalty;
  }

  function reactionRadius(formation) {
    let radius = speedInfo[formation.speed].reaction;
    if (formation.archeryTimer > 0) radius *= 2;
    if (formation.disorder >= 0.6) radius *= (1 - (formation.disorder - 0.6) * 0.5);
    return radius;
  }

  function canTurnWhileMoving(formation) {
    return formation.speed !== "SLOW";
  }

  function visualFacingLeftFromFormation(formation) {
    return formation.facing.x < -0.05;
  }

  function updateFormation(formation, enemySpatialHash, allSpatialHash, dt) {
    const alive = formation.units.filter(isUnitAlive);
    if (!alive.length) return;
    // 정지 상태에서 적 진형을 추적 중이면 방향만 지속 갱신
    if (formation.speed === "STOP" && formation.followTarget && formation.target) {
      const delta = sub(formation.target, formation.anchor);
      if (len(delta.x, delta.y) > 0.1) applyTurnRule(formation, normalize(delta));
    }

    if (formation.target && formation.speed !== "STOP") {
      const delta = sub(formation.target, formation.anchor);
      const d = len(delta.x, delta.y);
      if (d > 0.1) {
        if (canTurnWhileMoving(formation)) formation.facing = normalize(delta);
        const avgSlotDist = alive.reduce((sum, u) => {
          const slot = add(formation.anchor, worldFromLocal(formation, u.slotLocal));
          return sum + len(slot.x - u.x, slot.y - u.y);
        }, 0) / alive.length;
        const lagThreshold = formationSpacing(formation) * 3.0;
        if (avgSlotDist < lagThreshold) {
          const speed = anchorMoveSpeed(formation, formation.anchor.x, formation.anchor.y);
          formation.anchor = add(formation.anchor, mul(normalize(delta), Math.min(d, speed * dt)));
        }
      }
    }

    const survivalRate = formationRemainingTroops(formation) / Math.max(1, formationInitialTroops(formation));
    const rawDisorder = Math.max(0, (0.6 - survivalRate) / 0.6);
    const leadershipReduction = formation.general.leadership / 100 * 0.35;
    const charmReduction = formation.general.charm / 100 * 0.20;
    const survivalDisorder = rawDisorder * Math.max(0, 1 - leadershipReduction - charmReduction);

    if (game.battlePhase === "live") {
      const ax = clamp(Math.floor(formation.anchor.x), 0, MAP_WIDTH - 1);
      const ay = clamp(Math.floor(formation.anchor.y), 0, MAP_HEIGHT - 1);
      const anchorTile = game.terrain.tiles[ay][ax];
      const terrainMult = (anchorTile === "mountain" || anchorTile === "river") ? 1.5 : 1.0;
      const outOfPositionCount = alive.filter(u => {
        const slot = add(formation.anchor, worldFromLocal(formation, u.slotLocal));
        return len(slot.x - u.x, slot.y - u.y) >= POSITION_DEFENSE_THRESHOLD;
      }).length;
      const outRatio = outOfPositionCount / alive.length;
      const distMult = 1 + outRatio * 8.0;
      const accumRate = 0.001 * terrainMult * distMult * (1 - formation.general.charm / 100 * 0.5);
      formation.disorderAccum = Math.min(1, formation.disorderAccum + accumRate * dt);
    }
    formation.disorder = Math.min(1, survivalDisorder + formation.disorderAccum);

    const firstRowCount = alive.filter((u) => u.isFirstRow).length;
    formation._firstRowBonus = firstRowCount > 0
      ? 1 + alive.length / (firstRowCount * FIRST_ROW_BONUS_DIVISOR)
      : 1.1;
    alive.forEach((unit) => {
      const targetSlot = add(formation.anchor, worldFromLocal(formation, unit.slotLocal));
      const slotDelta = sub(targetSlot, unit);
      const slotDistance = len(slotDelta.x, slotDelta.y);
      let enemyTarget = findNearestEnemy(enemySpatialHash, unit.x, unit.y, reactionRadius(formation));
      if (enemyTarget) {
        unit.chaseEntry = enemyTarget;
        unit.chaseTimer = 2.5;
      } else {
        unit.chaseTimer -= dt;
        if (unit.chaseTimer > 0 && unit.chaseEntry && isUnitAlive(unit.chaseEntry.unit)) {
          const chaseDist = len(unit.chaseEntry.unit.x - unit.x, unit.chaseEntry.unit.y - unit.y);
          if (chaseDist < 10.0) {
            enemyTarget = unit.chaseEntry;
          } else {
            unit.chaseTimer = 0;
          }
        }
        if (unit.chaseTimer <= 0) unit.chaseEntry = null;
      }

      unit.rangedCooldown -= dt;
      if (unit.kihapTimer > 0) unit.kihapTimer -= dt;

      let desired = vec();
      if (enemyTarget) {
        const enemyDelta = sub(enemyTarget.unit, unit);
        const enemyDir = normalize(enemyDelta);
        const enemyDist = len(enemyDelta.x, enemyDelta.y);
        if (slotDistance > formationSpacing(formation) * 1.35) desired = add(mul(normalize(slotDelta), 0.8), mul(enemyDir, 0.2));
        else desired = slotDistance > 0.001 ? add(mul(normalize(slotDelta), 0.35), mul(enemyDir, 0.65)) : enemyDir;

        const FIRST_ROW_THRESHOLD = 1.5;
        const IN_POSITION_THRESHOLD = POSITION_DEFENSE_THRESHOLD;
        const hasKihap = unit.kihapTimer > 0;
        const attackerBonus = (unit.isFirstRow || hasKihap) && slotDistance < FIRST_ROW_THRESHOLD
          ? formation._firstRowBonus
          : slotDistance < IN_POSITION_THRESHOLD ? 1.1 : 1.0;

        // 진영 방향 vs 공격 방향 보너스
        // cos(45°)≈0.707: 정면±45° → ×1.25 / ±45~90° → ×1.0 / 후방 → ×0.75
        const COS45 = Math.SQRT2 / 2;
        const facingDot = formation.facing.x * enemyDir.x + formation.facing.y * enemyDir.y;
        const facingMult = facingDot >= COS45 ? 1.25 : facingDot >= 0 ? 1.0 : 0.75;
        const defTargetSlot = add(enemyTarget.formation.anchor, worldFromLocal(enemyTarget.formation, enemyTarget.unit.slotLocal));
        const defSlotDist = len(defTargetSlot.x - enemyTarget.unit.x, defTargetSlot.y - enemyTarget.unit.y);
        const defenderBonus = enemyTarget.unit.isFirstRow && defSlotDist < FIRST_ROW_THRESHOLD
          ? FIRST_ROW_DEFENSE_BONUS
          : defSlotDist < IN_POSITION_THRESHOLD ? 1.1 : 1.0;
        const guardDefenseMult = enemyTarget.formation.guardTimer > 0 && defSlotDist < IN_POSITION_THRESHOLD
          ? 2.0
          : 1.0;

        if (enemyDist < 0.85) {
          // 근접 공격 (매 프레임 × dt)
          const damage = Math.max(0, unitAttack(formation) * attackerBonus * facingMult - unitDefense(enemyTarget.formation, enemyTarget.unit) * defenderBonus * guardDefenseMult);
          applyUnitDamage(enemyTarget.formation, enemyTarget.unit, damage * dt, formation);
        } else if (canFormationRangedAttack(formation) && unit.rangedCooldown <= 0) {
          // 원거리 공격 (쿨타임 1초)
          const rangedDamage = rangedAttack(formation) * facingMult
            * rangedDefenseDamageMult(enemyTarget.formation);
          applyUnitDamage(enemyTarget.formation, enemyTarget.unit, rangedDamage, formation);
          unit.rangedCooldown = 1.0;
          game.projectiles.push({
            x: unit.x, y: unit.y,
            tx: enemyTarget.unit.x, ty: enemyTarget.unit.y,
            team: formation.team
          });
        }
      } else if (slotDistance > 0.002) {
        desired = normalize(slotDelta);
      }

      // 반응 반경 밖 원거리 전용 공격: 고정 5타일 이내 적에게 이동 없이 사격
      if (!enemyTarget && canFormationRangedAttack(formation) && unit.rangedCooldown <= 0) {
        const rangedOnlyRange = formation.archeryTimer > 0 ? 14.0 : 7.0;
        const rangedOnly = findNearestEnemy(enemySpatialHash, unit.x, unit.y, rangedOnlyRange);
        if (rangedOnly) {
          const rdist = len(rangedOnly.unit.x - unit.x, rangedOnly.unit.y - unit.y);
          if (rdist > 0.85) {
            const rDir = normalize({ x: rangedOnly.unit.x - unit.x, y: rangedOnly.unit.y - unit.y });
            const rDot = formation.facing.x * rDir.x + formation.facing.y * rDir.y;
            const rFacingMult = rDot >= Math.SQRT2 / 2 ? 1.25 : rDot >= 0 ? 1.0 : 0.75;
            const rdmg = rangedAttack(formation) * rFacingMult
              * rangedDefenseDamageMult(rangedOnly.formation);
            applyUnitDamage(rangedOnly.formation, rangedOnly.unit, rdmg, formation);
            unit.rangedCooldown = 1.0;
            game.projectiles.push({ x: unit.x, y: unit.y, tx: rangedOnly.unit.x, ty: rangedOnly.unit.y, team: formation.team });
          }
        }
      }

      if (slotDistance > formationSpacing(formation) * 1.8) desired = add(desired, mul(normalize(slotDelta), 1.35));

      const CROSS_SEP_RADIUS = 1.8;
      const unitRadius = formationUnitRadius(formation);
      const nearbyAll = findNearbyUnits(allSpatialHash, unit.x, unit.y, CROSS_SEP_RADIUS);
      for (const entry of nearbyAll) {
        if (entry.unit === unit) continue;
        const isSameFormation = entry.formation.team === formation.team && entry.formation.id === formation.id;
        if (isSameFormation) continue;
        const dx = unit.x - entry.unit.x;
        const dy = unit.y - entry.unit.y;
        const d = len(dx, dy);
        if (d < 0.001) continue;
        const hardZone = unitRadius + formationUnitRadius(entry.formation);
        const cavalryKnockMult = entry.formation.troopType === 'cavalry' ? 2.5 : 1.0;
        if (d < hardZone) {
          const overlap = (hardZone - d) / hardZone;
          desired = add(desired, mul({ x: dx / d, y: dy / d }, overlap * overlap * 4.0 * cavalryKnockMult));
        } else if (d < CROSS_SEP_RADIUS) {
          desired = add(desired, mul({ x: dx / d, y: dy / d }, (CROSS_SEP_RADIUS - d) / CROSS_SEP_RADIUS * 0.75 * cavalryKnockMult));
        }
      }

      // 화공 회피: desired 단계에서 방향 힌트 (정규화 전)
      for (const fire of game.fires) {
        for (const p of fire.particles) {
          const dfx = unit.x - p.x, dfy = unit.y - p.y;
          const df = len(dfx, dfy);
          if (df < 1.3 && df > 0.001)
            desired = add(desired, mul({ x: dfx/df, y: dfy/df }, 2.0));
        }
      }

      if (len(desired.x, desired.y) > 0.001) desired = normalize(desired);

      let chaosSpeedMult = 1.0;
      if (formation.speed === "NORMAL" || formation.speed === "FAST") {
        const baseLevel = formation.speed === "FAST" ? 0.65 : 0.18;
        // 통솔력이 높을수록 혼란 감소 (leadership 100 → 50%, leadership 0 → 100%)
        const leadershipMult = 1.0 - (formation.general.leadership / 100) * 0.5;
        // 험지(산·강)에서 혼란 증가
        const tx = clamp(Math.floor(unit.x), 0, MAP_WIDTH - 1);
        const ty = clamp(Math.floor(unit.y), 0, MAP_HEIGHT - 1);
        const tile = game.terrain.tiles[ty][tx];
        const terrainMult = tile === "mountain" ? 1.7 : tile === "river" ? 1.4 : tile === "wetland" ? 1.2 : 1.0;
        const chaosLevel = baseLevel * leadershipMult * terrainMult;
        // 방향 혼란
        const driftAngle = Math.sin(game.battleTime * 0.7 + unit.chaosPhaseOffset) * Math.PI * 0.1 * chaosLevel;
        if (len(desired.x, desired.y) > 0.001) {
          const c = Math.cos(driftAngle);
          const s = Math.sin(driftAngle);
          desired = normalize({ x: desired.x * c - desired.y * s, y: desired.x * s + desired.y * c });
        }
        // 속도 혼란
        chaosSpeedMult = 1.0 - unit.chaosSeed * 0.22 * chaosLevel;
      }

      const inertia = len(unit.vx, unit.vy) > 0.001 ? normalize(vec(unit.vx, unit.vy)) : vec();
      const inertiaWeight = Math.max(0.05, 0.2 - Math.min(0.15, slotDistance * 0.18));
      let moveDir = add(mul(desired, 1 - inertiaWeight), mul(inertia, inertiaWeight));
      if (len(moveDir.x, moveDir.y) > 0.001) moveDir = normalize(moveDir);
      const unitSpeed = Math.max(0.35, unitMoveSpeed(formation, unit.x, unit.y));
      const boost = slotDistance > formationSpacing(formation) * 1.8 ? 1.15 : 1.0;
      const targetV = mul(moveDir, unitSpeed * boost * chaosSpeedMult);
      const blend = Math.min(1, dt * 7.0);
      unit.vx = lerp(unit.vx, targetV.x, blend);
      unit.vy = lerp(unit.vy, targetV.y, blend);

      // 화공 차단: lerp 이후 속도에 직접 강한 반발력 (정규화·관성 우회)
      for (const fire of game.fires) {
        for (const p of fire.particles) {
          const dfx = unit.x - p.x, dfy = unit.y - p.y;
          const df = len(dfx, dfy);
          const FIRE_R = 1.2;
          if (df < FIRE_R && df > 0.001) {
            const t = (FIRE_R - df) / FIRE_R;
            const strength = t * t * 12.0; // 제곱으로 중심부 강화
            unit.vx += (dfx / df) * strength * dt;
            unit.vy += (dfy / df) * strength * dt;
          }
        }
      }

      // 오브젝트 타일 통과 차단: 타일 중심에서 강한 반발력
      {
        const objMap = game.terrainRender.objectMap;
        const OBJ_R = 1.0;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const tx = clamp(Math.floor(unit.x) + dx, 0, MAP_WIDTH - 1);
            const ty = clamp(Math.floor(unit.y) + dy, 0, MAP_HEIGHT - 1);
            if (!objMap[ty][tx]) continue;
            const ex = unit.x - (tx + 0.5), ey = unit.y - (ty + 0.5);
            const d = len(ex, ey);
            if (d < OBJ_R && d > 0.001) {
              const t = (OBJ_R - d) / OBJ_R;
              unit.vx += (ex / d) * t * t * 16.0 * dt;
              unit.vy += (ey / d) * t * t * 16.0 * dt;
            }
          }
        }
      }

      unit.x = clamp(unit.x + unit.vx * dt, 0, MAP_WIDTH - 1);
      unit.y = clamp(unit.y + unit.vy * dt, 0, MAP_HEIGHT - 1);
    });

    if (!formation.retreating) {
      formation.reorganizeTimer -= dt;
      if (formation.reorganizeTimer <= 0) {
        const anyInCombat = alive.some((u) => u.chaseTimer > 0 || u.chaseEntry !== null);
        if (!anyInCombat) initializeFormationSlots(formation, true);
        formation.reorganizeTimer = 4.0 + Math.random() * 3.0;
      }
    }
  }

  // 현재 위치의 지형 방어 점수 (산=3, 평지=0, 강=-2)
  function terrainDefenseAt(x, y) {
    const tx = clamp(Math.floor(x), 0, MAP_WIDTH - 1);
    const ty = clamp(Math.floor(y), 0, MAP_HEIGHT - 1);
    return { plain: 0, road: 0, river: -2, mountain: 3 }[game.terrain.tiles[ty][tx]] ?? 0;
  }

  // 역할 배정: 전략에 따라 각 진형의 aiRole 결정
  function assignEnemyRoles(enemies, players) {
    const weakest = players.reduce((a, b) =>
      formationRemainingPopulation(a) <= formationRemainingPopulation(b) ? a : b);
    const s = game.enemyStrategy;
    const n = enemies.length;

    enemies.forEach((f, i) => {
      f.aiTarget = null;
      if (s === "BLITZ") {
        f.aiRole = i < Math.ceil(n * 0.6) ? "VANGUARD" : "FLANKER";
      } else if (s === "FLANK") {
        f.aiRole = i < 2 ? "VANGUARD" : "FLANKER";
      } else if (s === "FOCUS_WEAK") {
        f.aiRole = "FOCUS";
        f.aiTarget = weakest;
      } else if (s === "DEFENSIVE") {
        f.aiRole = i === 0 ? "FOCUS" : "HOLD";
        if (i === 0) f.aiTarget = weakest;
      } else { // ATTRITION
        if (i % 3 === 0) { f.aiRole = "FOCUS"; f.aiTarget = weakest; }
        else f.aiRole = "VANGUARD";
      }
    });
  }

  // 역할별 전술 실행
  function executeEnemyRole(formation, players, index) {
    if (formation.retreating || formation.retreated) return;
    const role = formation.aiRole || "VANGUARD";
    const center = formationCenter(formation);
    const defScore = terrainDefenseAt(center.x, center.y);
    const onMountain = defScore >= 3;

    const nearestPlayer = players.reduce((a, b) =>
      len(formationCenter(a).x - center.x, formationCenter(a).y - center.y) <=
      len(formationCenter(b).x - center.x, formationCenter(b).y - center.y) ? a : b);
    const nearCenter = formationCenter(nearestPlayer);
    const dist = len(nearCenter.x - center.x, nearCenter.y - center.y);

    if (role === "VANGUARD") {
      formation.followTarget = nearestPlayer;
      formation.target = vec(nearCenter.x, nearCenter.y);
      if (onMountain && dist < 20) {
        formation.speed = "STOP"; formation.density = "TIGHT";
      } else if (dist < 12) {
        formation.speed = "SLOW"; formation.density = "TIGHT";
      } else {
        formation.speed = game.enemyStrategy === "BLITZ" ? "FAST" : "NORMAL";
        formation.density = "NORMAL";
      }

    } else if (role === "FLANKER") {
      const pCenter = players.reduce((acc, f) => add(acc, formationCenter(f)), vec());
      pCenter.x /= players.length; pCenter.y /= players.length;
      const flankDir = index % 2 === 0 ? -1 : 1;
      const flankY = clamp(pCenter.y + flankDir * 28, 8, MAP_HEIGHT - 8);
      formation.followTarget = null;
      formation.speed = "FAST";
      formation.density = "WIDE";
      // 측면 도달 후 적에게 전진
      if (Math.abs(center.y - flankY) < 10 && dist < 30) {
        formation.followTarget = nearestPlayer;
        formation.target = vec(nearCenter.x, nearCenter.y);
      } else {
        formation.target = vec(pCenter.x - 8, flankY);
      }

    } else if (role === "FOCUS") {
      const tgt = (formation.aiTarget && formation.aiTarget.units.some(isUnitAlive))
        ? formation.aiTarget : nearestPlayer;
      formation.followTarget = tgt;
      formation.target = formationCenter(tgt);
      formation.speed = dist < 10 ? "SLOW" : "NORMAL";
      formation.density = "TIGHT";

    } else { // HOLD
      formation.followTarget = null;
      if (onMountain) {
        formation.speed = "STOP"; formation.density = "TIGHT";
        formation.facing = normalize(sub(nearCenter, center));
      } else if (dist < 22) {
        formation.speed = "SLOW"; formation.density = "TIGHT";
        formation.target = vec(nearCenter.x, nearCenter.y);
      } else {
        // 산지 탐색: 현재보다 방어적 위치로
        formation.speed = "SLOW"; formation.density = "NORMAL";
        formation.target = vec(center.x - 3, center.y);
      }
    }
  }

  function updateAI(dt) {
    game.aiTimer += dt;
    if (game.aiTimer < 3 || game.battlePhase !== "live") return;
    game.aiTimer = 0;

    const livePlayers = game.playerFormations.filter(f =>
      f.units.some(isUnitAlive) && !f.retreated && !f.retreating);
    const liveEnemies = game.enemyFormations.filter(f =>
      f.units.some(isUnitAlive) && !f.retreated && !f.retreating);
    if (!livePlayers.length || !liveEnemies.length) return;

    // ── 전략 갱신 (9초마다, 초기엔 즉시) ────────────────────────────
    game.strategyTick += 1;
    if (game.strategyTick % 3 === 1 || !game.enemyStrategy) {
      const eTroops = liveEnemies.reduce((s, f) => s + formationRemainingPopulation(f), 0);
      const pTroops = livePlayers.reduce((s, f) => s + formationRemainingPopulation(f), 0);
      const ratio = eTroops / Math.max(1, pTroops);
      const prev = game.enemyStrategy;

      if (!prev) {
        // 초기 전략: 병력 비율 + 랜덤
        const r = Math.random();
        if (ratio > 1.35)      game.enemyStrategy = r < 0.45 ? "BLITZ" : r < 0.75 ? "FLANK" : "ATTRITION";
        else if (ratio < 0.75) game.enemyStrategy = r < 0.45 ? "DEFENSIVE" : r < 0.8 ? "FOCUS_WEAK" : "ATTRITION";
        else                   game.enemyStrategy = r < 0.3 ? "BLITZ" : r < 0.55 ? "FLANK" : r < 0.8 ? "FOCUS_WEAK" : "DEFENSIVE";
      } else {
        // 전황에 따른 전략 전환
        if (ratio < 0.60 && prev !== "DEFENSIVE")   game.enemyStrategy = "DEFENSIVE";
        else if (ratio > 1.50 && prev === "DEFENSIVE") game.enemyStrategy = "BLITZ";
        else if (ratio < 0.80 && prev === "BLITZ")   game.enemyStrategy = "ATTRITION";
      }

      assignEnemyRoles(liveEnemies, livePlayers);
    }

    // ── 전술 실행 ─────────────────────────────────────────────────────
    liveEnemies.forEach((formation, idx) => {
      executeEnemyRole(formation, livePlayers, idx);
    });
  }

  function applyPositionCorrection() {
    const allFormations = [...game.playerFormations, ...game.enemyFormations];
    const correctionHash = buildSpatialHash(allFormations);
    const maxRadius = allFormations.reduce((max, formation) => Math.max(max, formationUnitRadius(formation)), UNIT_RADIUS);
    const searchRadius = maxRadius * 2;
    allFormations.forEach((formation) => {
      formation.units.filter(isUnitAlive).forEach((unit) => {
        const nearby = findNearbyUnits(correctionHash, unit.x, unit.y, searchRadius);
        for (const entry of nearby) {
          if (entry.unit === unit) continue;
          const minDist = formationUnitRadius(formation) + formationUnitRadius(entry.formation);
          const dx = unit.x - entry.unit.x;
          const dy = unit.y - entry.unit.y;
          const d = len(dx, dy);
          if (d > 0.001 && d < minDist) {
            const correction = (minDist - d) * 0.5;
            unit.x = clamp(unit.x + dx / d * correction, 0, MAP_WIDTH - 1);
            unit.y = clamp(unit.y + dy / d * correction, 0, MAP_HEIGHT - 1);
          }
        }
      });
    });
  }

  function update(dt) {
    if (game.battlePhase === "live") {
      game.battleTime += dt;

      const PLAYER_RETREAT_X = 8;
      const ENEMY_RETREAT_X = MAP_WIDTH - 8;

      game.playerFormations.forEach((formation) => {
        if (!formation.retreated && formation.units.some(isUnitAlive) && formation.anchor.x < PLAYER_RETREAT_X) {
          formation.retreated = true;
          formation.units.forEach((u) => { u.damage = 100; });
        }
        if (!formation.followTarget) return;
        const alive = formation.followTarget.units.some(isUnitAlive);
        if (!alive) { formation.followTarget = null; return; }
        formation.target = formationCenter(formation.followTarget);
      });

      game.enemyFormations.forEach((formation) => {
        if (!formation.retreated && formation.units.some(isUnitAlive) && formation.anchor.x > ENEMY_RETREAT_X) {
          formation.retreated = true;
          formation.units.forEach((u) => { u.damage = 100; });
        }
      });

      const checkAutoRetreat = (formation, retreatX) => {
        if (formation.retreated || formation.retreating) return;
        if (!formation.units.some(isUnitAlive)) return;
        if (formation.disorder < 0.7) return;
        // 혼란도 0.1 증가마다 체크포인트 발동 (0.7, 0.8, 0.9, 1.0)
        const checkpoint = Math.floor(formation.disorder * 10) / 10;
        if (checkpoint <= formation.retreatLastCheckpoint) return;
        formation.retreatLastCheckpoint = checkpoint;
        // 혼란도가 높을수록, 매력이 낮을수록 후퇴 확률 상승
        const retreatChance = (checkpoint - 0.6) * 0.6 * (1 - formation.general.charm / 100 * 0.5);
        if (Math.random() < retreatChance) {
          formation.retreating = true;
          formation.speed = "FAST";
          formation.followTarget = null;
          formation.target = vec(retreatX, formation.anchor.y);
        }
      };
      game.playerFormations.forEach((f) => checkAutoRetreat(f, 0));
      game.enemyFormations.forEach((f) => checkAutoRetreat(f, MAP_WIDTH));

      const allFormations = [...game.playerFormations, ...game.enemyFormations];
      allFormations.forEach((f) => { if (f.kihapCooldown > 0) f.kihapCooldown -= dt; });

      const playerSpatialHash = buildSpatialHash(game.playerFormations);
      const enemySpatialHash = buildSpatialHash(game.enemyFormations);
      const allSpatialHash = buildSpatialHash(allFormations);
      game.playerFormations.forEach((formation) => updateFormation(formation, enemySpatialHash, allSpatialHash, dt));
      game.enemyFormations.forEach((formation) => updateFormation(formation, playerSpatialHash, allSpatialHash, dt));
      applyPositionCorrection();
      updateAI(dt);
      updateSkills(dt);
      updateSpeechTriggers();
      checkBattleEnd();
      updateBattleEndPending(dt);

      const PROJ_SPEED = 4.0;
      game.projectiles = game.projectiles.filter((p) => {
        const dx = p.tx - p.x;
        const dy = p.ty - p.y;
        const d = len(dx, dy);
        if (d < 0.15) return false;
        const step = Math.min(d, PROJ_SPEED * dt);
        p.x += dx / d * step;
        p.y += dy / d * step;
        return true;
      });
    }
  }

  function drawDiamond(drawCtx, x, y, color) {
    const halfW = game.tileW / 2 + 0.75;
    const halfH = getTileH() / 2 + 0.55;
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
    const halfW = game.tileW / 2 + 0.75;
    const halfH = getTileH() / 2 + 0.55;
    drawCtx.beginPath();
    drawCtx.moveTo(x, y - 0.5);
    drawCtx.lineTo(x + halfW, y + halfH);
    drawCtx.lineTo(x, y + halfH * 2 + 0.5);
    drawCtx.lineTo(x - halfW, y + halfH);
    drawCtx.closePath();
    drawCtx.fillStyle = "rgba(49,58,48,0.85)";
    drawCtx.fill();
  }

  function invalidateTerrainChunkCache() {
    game.terrainRender.chunkCache.clear();
    game.terrainRender.chunkTileW = game.tileW;
    game.terrainRender.chunkSpritesReady = terrainSprites.ready;
    game.terrainRender.chunkPixiReady = pixiReady;
    if (pixiUnitCtr) {
      for (const { sprite } of pixiTreeSprites) {
        pixiUnitCtr.removeChild(sprite);
        sprite.destroy(false);
      }
      pixiTreeSprites.length = 0;
    }
  }

  function ensureTerrainChunkCache() {
    if (game.terrainRender.chunkTileW !== game.tileW ||
        game.terrainRender.chunkSpritesReady !== terrainSprites.ready ||
        game.terrainRender.chunkPixiReady !== pixiReady)
      invalidateTerrainChunkCache();
  }

  function chunkKey(chunkX, chunkY) {
    return `${chunkX}:${chunkY}`;
  }

  function createTerrainChunk(chunkX, chunkY) {
    const startX = chunkX * CHUNK_TILES;
    const startY = chunkY * CHUNK_TILES;
    const endX = Math.min(MAP_WIDTH, startX + CHUNK_TILES);
    const endY = Math.min(MAP_HEIGHT, startY + CHUNK_TILES);
    const tileWidth = game.tileW;
    const tileH = getTileH();
    const shadowHeight = Math.round(tileH * 23 / 16);
    let minIsoX = Infinity;
    let minIsoY = Infinity;
    let maxIsoX = -Infinity;
    let maxIsoY = -Infinity;

    for (let y = startY; y < endY; y += 1) {
      for (let x = startX; x < endX; x += 1) {
        const iso = isoPoint(x, y);
        minIsoX = Math.min(minIsoX, iso.x - tileWidth / 2 - 2);
        maxIsoX = Math.max(maxIsoX, iso.x + tileWidth / 2 + 2);
        minIsoY = Math.min(minIsoY, iso.y - 2);
        maxIsoY = Math.max(maxIsoY, iso.y + tileH + 2);
        if (game.terrain.tiles[y][x] === "mountain") {
          minIsoY = Math.min(minIsoY, iso.y + tileH * 0.32 - 2);
          maxIsoY = Math.max(maxIsoY, iso.y + tileH * 0.32 + shadowHeight + 4);
        }
      }
    }

    const canvasChunk = createSurface(maxIsoX - minIsoX, maxIsoY - minIsoY);
    const chunkCtx = canvasChunk.getContext("2d");
    const tiles = [];
    for (let y = startY; y < endY; y += 1) {
      for (let x = startX; x < endX; x += 1) {
        tiles.push([x + y, x, y]);
      }
    }
    tiles.sort((a, b) => a[0] - b[0]);

    // Pass 1: 색상 다이아몬드 (스프라이트 로드 전 폴백)
    tiles.forEach(([, x, y]) => {
      const iso = isoPoint(x, y);
      const px = iso.x - minIsoX, py = iso.y - minIsoY;
      const tile = game.terrain.tiles[y][x];
      const isBorder = game.terrainRender.isBorder[y][x];
      if (tile === "mountain" && !isBorder) drawFallbackMountainShadow(chunkCtx, px, py + tileH * 0.5);
      drawDiamond(chunkCtx, px, py, isBorder ? "#909090" : terrainInfo[tile].color);
    });

    if (terrainSprites.ready) {
      chunkCtx.imageSmoothingEnabled = true;
      chunkCtx.imageSmoothingQuality = "high";

      // Pass 2A: 1×1 center 타일 — 전체 영역 베이스 (경계 타일 포함 모두)
      tiles.forEach(([, x, y]) => {
        const tile = game.terrain.tiles[y][x];
        const variants = terrainSprites.tiles[TERRAIN_ASSET[tile]];
        if (!variants?.length) return;
        const sp = variants[tileHash(x, y) % variants.length];
        if (!sp?.naturalWidth) return;
        const iso = isoPoint(x, y);
        const px = iso.x - minIsoX, py = iso.y - minIsoY;
        const w  = game.tileW;
        const h  = Math.round(w * sp.naturalHeight / sp.naturalWidth);
        chunkCtx.drawImage(sp, px - w / 2, py, w, h);
      });

      // Pass 2B: 3×3 베이스 텍스처 — 1×1 위에 덮어씌움 (경계 타일 제외)
      tiles.forEach(([, x, y]) => {
        if (game.terrainRender.block[y][x] !== 1) return;

        const tile = game.terrain.tiles[y][x];
        let sprites = null;
        if (tile === "plain")          sprites = terrainSprites.dirt;
        else if (tile === "grassland") sprites = terrainSprites.plainGrass;
        else if (tile === "mountain")  sprites = terrainSprites.forestFloor;
        if (!sprites) return;

        const v  = game.terrainRender.variant[y][x] % sprites.length;
        const sp = sprites[v];
        if (!sp?.naturalWidth) return;

        const iso = isoPoint(x, y);
        const px  = iso.x - minIsoX, py = iso.y - minIsoY;
        const w   = game.tileW * 3;
        const h   = Math.round(w * sp.naturalHeight / sp.naturalWidth);
        chunkCtx.drawImage(sp, px - w / 2, py, w, h);
      });
    }

    // Pass 2C: 경계 타일 3레이어 합성
    chunkCtx.imageSmoothingEnabled = true;
    chunkCtx.imageSmoothingQuality = "high";

    tiles.forEach(([, x, y]) => {
      const bd = game.terrainRender.borderData[y][x];
      if (!bd) return;

      const iso = isoPoint(x, y);
      const px = iso.x - minIsoX;
      const py = iso.y - minIsoY;
      const w  = game.tileW;

      // ── 3레이어 합성 (스프라이트 로드 완료 시) ─────────────────────────
      if (terrainSprites.ready) {
        const lowerVars = terrainSprites.tiles[TERRAIN_ASSET[bd.lowerT]];
        const upperVars = terrainSprites.tiles[TERRAIN_ASSET[bd.upperT]];
        const lowerImg = lowerVars?.[tileHash(x, y)     % (lowerVars?.length || 1)];
        const upperImg = upperVars?.[tileHash(x+1, y+1) % (upperVars?.length || 1)];
        if (lowerImg?.naturalWidth && upperImg?.naturalWidth) {
          const h = Math.round(w * lowerImg.naturalHeight / lowerImg.naturalWidth);

          // 레이어 1: 하위 지형 (전체 타일)
          chunkCtx.drawImage(lowerImg, px - w / 2, py, w, h);

          // 레이어 2+3: 상위 지형 + 알파마스크
          if (bd.maskDir === "center") {
            // center: 마스크 없이 상위 지형 전체
            chunkCtx.drawImage(upperImg, px - w / 2, py, w, h);
          } else if (bd.maskDir) {
            const maskArr = terrainSprites.masks[bd.maskDir];
            const maskCv = maskArr?.length
              ? maskArr[tileHash(x, y) % maskArr.length]
              : null;
            if (maskCv) {
              const mW = maskCv.width, mH = maskCv.height;
              const tmp = createSurface(mW, mH);
              const tc  = tmp.getContext("2d");
              tc.drawImage(upperImg, 0, 0, mW, mH);
              tc.globalCompositeOperation = "destination-in";
              tc.drawImage(maskCv, 0, 0, mW, mH);
              chunkCtx.drawImage(tmp, px - w / 2, py, w, h);
            }
          }
          // maskDir === null: 하위 지형만 (레이어1 이미 그림)
        }
      }

    });

    // Pass 3A: 험준산악 — 청크 정렬 보장, 단일 청크 내 안전 렌더링
    const ruggedImg = terrainSprites.ruggedMtn;
    if (ruggedImg?.naturalWidth) {
      chunkCtx.imageSmoothingEnabled = true;
      chunkCtx.imageSmoothingQuality = "high";
      tiles.forEach(([, x, y]) => {
        if (game.terrainRender.ruggedMtn[y][x] !== 1) return;
        const iso = isoPoint(x, y);
        const px  = iso.x - minIsoX;
        const py  = iso.y - minIsoY;
        const w   = game.tileW * 16;
        const h   = tileH * 16;
        chunkCtx.drawImage(ruggedImg, px - w / 2, py, w, h);
      });
    }

    const objectSprites = terrainSprites.objects;
    if (objectSprites?.length) {
      chunkCtx.imageSmoothingEnabled = true;
      chunkCtx.imageSmoothingQuality = "high";
      chunkCtx.globalAlpha = 0.8;
      tiles.forEach(([, x, y]) => {
        const objectIndex = game.terrainRender.objectMap[y][x] - 1;
        if (objectIndex < 0) return;
        const objectImg = objectSprites[objectIndex % objectSprites.length];
        if (!objectImg?.naturalWidth) return;
        const iso = isoPoint(x, y);
        const px = iso.x - minIsoX;
        const py = iso.y - minIsoY;
        const w = game.tileW * 2;
        const h = Math.round(w * objectImg.naturalHeight / objectImg.naturalWidth);
        chunkCtx.drawImage(objectImg, px - w / 2, py, w, h);
      });
      chunkCtx.globalAlpha = 1.0;
    }

    // Pass 3: 나무 — 캔버스 드로잉 + 월드 좌표 수집 (Y정렬 분리 시 활용)
    const trees = [];
    const treeImg = terrainSprites.tree;
    if (treeImg?.naturalWidth) {
      const tW = Math.round(game.tileW * 11 / 24);
      const tH = Math.round(game.tileW * 22 / 24);

      for (let ty = startY; ty < endY; ty++) {
        for (let tx = startX; tx < endX; tx++) {
          if (game.terrain.tiles[ty][tx] !== "mountain") continue;
          if (game.terrainRender.ruggedMtn[ty][tx]) continue;

          const iso = isoPoint(tx, ty);
          const cx  = iso.x - minIsoX;
          const cy  = iso.y - minIsoY + tileH / 2;

          let s = tileHash(tx, ty) >>> 0;
          const rng = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 0xFFFFFFFF; };

          const r = rng();
          const count = r < 0.1 ? 0 : r < 0.4 ? 2 : 1;
          for (let i = 0; i < count; i++) {
            let bx, by;
            for (let attempt = 0; attempt < 8; attempt++) {
              const rx = (rng() - 0.5) * game.tileW;
              const ry = (rng() - 0.5) * tileH;
              if (Math.abs(rx) / (game.tileW / 2) + Math.abs(ry) / (tileH / 2) <= 1) {
                bx = cx + rx;
                by = cy + ry;
                break;
              }
            }
            if (bx === undefined) { bx = cx; by = cy; }
            trees.push({ worldBx: bx + minIsoX, worldBy: by + minIsoY, tileX: tx, tileY: ty });
          }
        }
      }

      // PixiJS 미사용 시에만 캔버스에 드로잉 (PixiJS 사용 시 스프라이트로 처리)
      if (!(pixiReady && pixiTreeTex)) {
        trees.sort((a, b) => a.worldBy - b.worldBy);
        chunkCtx.imageSmoothingEnabled = true;
        chunkCtx.imageSmoothingQuality = "high";
        for (const { worldBx, worldBy } of trees)
          chunkCtx.drawImage(treeImg, worldBx - minIsoX - tW / 2, worldBy - minIsoY - tH, tW, tH);
      }
    }

    return { canvas: canvasChunk, worldX: minIsoX, worldY: minIsoY, trees };
  }

  // 관측자→대상 사이 타일을 따라 이동하며 유효거리 계산 (산악 타일 = 2배 비용)
  function effectiveDistance(fromX, fromY, toX, toY) {
    const dx = toX - fromX, dy = toY - fromY;
    const realDist = Math.hypot(dx, dy);
    if (realDist < 0.001) return 0;
    const STEP = 0.5;
    const steps = Math.ceil(realDist / STEP);
    let effDist = 0;
    for (let i = 0; i < steps; i++) {
      const t = (i + 0.5) / steps;
      const tx = clamp(Math.floor(fromX + dx * t), 0, MAP_WIDTH - 1);
      const ty = clamp(Math.floor(fromY + dy * t), 0, MAP_HEIGHT - 1);
      const cost = game.terrain.tiles[ty][tx] === "mountain" ? STEP * 3 : STEP;
      effDist += cost;
    }
    return effDist;
  }

  // 한 방향으로 광선을 쏘아 시야 한계(60 유효타일)까지의 실제 도달 거리 반환
  function castRay(fromX, fromY, dirX, dirY) {
    const VISION_LIMIT = 60;
    const STEP = 0.5;
    let effDist = 0;
    let realDist = 0;
    while (effDist < VISION_LIMIT) {
      realDist += STEP;
      const cx = fromX + dirX * realDist;
      const cy = fromY + dirY * realDist;
      if (cx < 0 || cy < 0 || cx >= MAP_WIDTH || cy >= MAP_HEIGHT) break;
      const tile = game.terrain.tiles[clamp(Math.floor(cy), 0, MAP_HEIGHT - 1)]
                                     [clamp(Math.floor(cx), 0, MAP_WIDTH  - 1)];
      effDist += tile === "mountain" ? STEP * 3 : STEP;
    }
    return realDist;
  }

  // ── PixiJS: FOW ───────────────────────────────────────────────────────────
  function renderFogPixi() {
    if (game.battlePhase !== "live") { pixiFogSprite.visible = false; return; }

    const W = Math.ceil(canvas.clientWidth);
    const H = Math.ceil(canvas.clientHeight);
    const tileH = getTileH();
    const NUM_RAYS = 120;

    if (!pixiFogRT || pixiFogRT.width !== W || pixiFogRT.height !== H) {
      if (pixiFogRT) pixiFogRT.destroy();
      pixiFogRT = RenderTexture.create({ width: W, height: H });
      pixiFogSprite.texture = pixiFogRT;
    }
    pixiFogSprite.visible = true;

    // 영구 Graphics를 clear()하고 재사용 — 매 프레임 객체 생성 없음
    pixiFogDark.clear().rect(0, 0, W, H).fill({ color: 0x000000, alpha: 0.62 });

    pixiFogVision.clear();
    game.playerFormations.forEach((f) => {
      if (!f.units.filter(isUnitAlive).length) return;
      const center = formationCenter(f);
      const pts = [];
      for (let i = 0; i < NUM_RAYS; i++) {
        const angle = (i / NUM_RAYS) * Math.PI * 2;
        const dirX = Math.cos(angle), dirY = Math.sin(angle);
        const dist = castRay(center.x, center.y, dirX, dirY);
        const ex = clamp(center.x + dirX * dist, 0, MAP_WIDTH);
        const ey = clamp(center.y + dirY * dist, 0, MAP_HEIGHT);
        const s = toScreen(ex, ey);
        pts.push(s.x, s.y + tileH / 2);
      }
      if (pts.length >= 6) pixiFogVision.poly(pts).fill({ color: 0xffffff, alpha: 1 });
    });

    pixiApp.renderer.render({ container: pixiFogScene, target: pixiFogRT, clear: true });
  }

  // ── PixiJS: 유닛 ─────────────────────────────────────────────────────────
  function renderUnitsPixi() {
    const formations = [...game.playerFormations, ...game.enemyFormations];
    const tileH  = getTileH();

    const hasPixiSprites = (troopType) => {
      const type = normalizeTroopType(troopType);
      return pixiWalkTex[type].player.length > 0 && pixiWalkTex[type].enemy.length > 0
        && pixiIdleTex[type].player && pixiIdleTex[type].enemy;
    };

    const pixiUnitMetrics = (troopType) => {
      const type = normalizeTroopType(troopType);
      const refTex = pixiWalkTex[type].player[0] || pixiIdleTex[type].player;
      const srcW = refTex ? refTex.width : SPRITE_W;
      const srcH = refTex ? refTex.height : SPRITE_H;
      const spScale = troopRenderScale(type);
      return {
        dw: Math.round(srcW * spScale),
        dh: Math.round(srcH * spScale),
        spScale,
      };
    };

    // 아이소 깊이 정렬
    const visible = [];
    formations.forEach((formation) => {
      formation.units.filter(isUnitAlive).forEach((unit) => {
        if (formation.team === "enemy" && !isEnemyVisible(unit)) return;
        visible.push({ formation, unit });
      });
    });
    visible.sort((a, b) => (a.unit.x + a.unit.y) - (b.unit.x + b.unit.y));

    // 스프라이트 크기 기준 (walk 텍스처 첫 프레임)
    pixiShadowGfx.clear();
    pixiGlowGfx.clear();

    const visibleIds = new Set();

    visible.forEach(({ formation, unit }, depth) => {
      visibleIds.add(unit.id);
      const s  = toScreen(unit.x, unit.y);
      const cx = s.x;
      const cy = s.y + tileH / 2;
      const troopType = normalizeTroopType(formation.troopType);
      const { dw, dh, spScale } = pixiUnitMetrics(troopType);

      // 그림자
      if (troopType !== "cavalry") {
        pixiShadowGfx
          .ellipse(cx + dw * 0.10, cy + dh * 0.06, dw * 0.52, dw * 0.14)
          .fill({ color: 0x000000, alpha: 0.28 });
      }

      // 보너스 글로우
      const tSlot   = add(formation.anchor, worldFromLocal(formation, unit.slotLocal));
      const slotD   = len(tSlot.x - unit.x, tSlot.y - unit.y);
      const frBonus = unit.isFirstRow && slotD < 1.5;
      const posBonus = !frBonus && slotD < POSITION_DEFENSE_THRESHOLD;
      const kBonus   = unit.kihapTimer > 0;
      const skBonus  = formation.swiftTimer > 0 || formation.archeryTimer > 0
                    || (formation.guardTimer > 0 && slotD < POSITION_DEFENSE_THRESHOLD);

      if (frBonus || posBonus || kBonus || skBonus) {
        const strong = frBonus || kBonus || skBonus;
        const alpha  = strong ? 0.24 : 0.14;
        const gx     = strong ? 0.60 : 0.50;
        const gy     = strong ? 0.50 : 0.40;
        const color  = formation.team === 'player' ? 0xff3c3c : 0xffaa46;
        pixiGlowGfx.ellipse(cx, cy - dh * 0.35, dw * gx, dh * gy).fill({ color, alpha });
      }

      // 스프라이트
      let sprite = pixiUnitSprites.get(unit.id);
      if (!sprite) {
        sprite = new PixiSprite();
        sprite.anchor.set(0.5, 1);
        pixiUnitCtr.addChild(sprite);
        pixiUnitSprites.set(unit.id, sprite);
      }

      // 방향
      if (typeof unit.visualFacingLeft !== "boolean")
        unit.visualFacingLeft = visualFacingLeftFromFormation(formation);
      if (formation.speed === "STOP")
        unit.visualFacingLeft = visualFacingLeftFromFormation(formation);
      else if (Math.abs(unit.vx) > 0.12)
        unit.visualFacingLeft = unit.vx < 0;

      // 텍스처
      const moving = len(unit.vx, unit.vy) > 0.08;
      if (hasPixiSprites(troopType)) {
        if (moving) {
          const fi = Math.floor(game.battleTime * 7 + unit.chaosPhaseOffset * 3) % troopWalkFrames(troopType);
          sprite.texture = pixiWalkTex[troopType][formation.team][fi];
        } else {
          sprite.texture = pixiIdleTex[troopType][formation.team];
        }
      }

      sprite.x = cx;
      sprite.y = cy;
      sprite.scale.x = unit.visualFacingLeft ? -spScale : spScale;
      sprite.scale.y = spScale;
      sprite.zIndex  = unit.x + unit.y;
      sprite.visible = true;
    });

    // 살아있지만 현재 비가시 유닛은 hide (destroy 안 함 — 다시 보일 수 있음)
    // 사망 유닛은 destroy하여 메모리 해제
    const aliveIds = new Set();
    [...game.playerFormations, ...game.enemyFormations].forEach(f => {
      f.units.filter(isUnitAlive).forEach(u => aliveIds.add(u.id));
    });

    for (const [id, sprite] of pixiUnitSprites) {
      if (!aliveIds.has(id)) {
        sprite.destroy();
        pixiUnitSprites.delete(id);
      } else if (!visibleIds.has(id)) {
        sprite.visible = false;
      }
    }
  }

  function renderFog() {
    if (game.battlePhase !== "live") return;

    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    const tileH = getTileH();
    const NUM_RAYS = 120; // 3° 간격

    if (!game._fogCanvas || game._fogCanvas.width !== Math.ceil(W) || game._fogCanvas.height !== Math.ceil(H)) {
      game._fogCanvas = createSurface(W, H);
    }
    const fog = game._fogCanvas;
    const fCtx = fog.getContext("2d");

    fCtx.clearRect(0, 0, W, H);
    fCtx.fillStyle = "rgba(0,0,0,0.62)";
    fCtx.fillRect(0, 0, W, H);

    fCtx.globalCompositeOperation = "destination-out";

    game.playerFormations.forEach((f) => {
      const alive = f.units.filter(isUnitAlive);
      if (!alive.length) return;

      const center = formationCenter(f);

      // 120 방향으로 광선을 쏘아 시야 폴리곤 꼭짓점 수집
      const pts = [];
      for (let i = 0; i < NUM_RAYS; i++) {
        const angle = (i / NUM_RAYS) * Math.PI * 2;
        const dirX = Math.cos(angle);
        const dirY = Math.sin(angle);
        const realDist = castRay(center.x, center.y, dirX, dirY);
        const ex = clamp(center.x + dirX * realDist, 0, MAP_WIDTH);
        const ey = clamp(center.y + dirY * realDist, 0, MAP_HEIGHT);
        const s = toScreen(ex, ey);
        pts.push({ x: s.x, y: s.y + tileH / 2 });
      }

      // 폴리곤을 destination-out으로 그려 안개 제거
      fCtx.fillStyle = "rgba(0,0,0,1)";
      fCtx.beginPath();
      fCtx.moveTo(pts[0].x, pts[0].y);
      for (let j = 1; j < pts.length; j++) fCtx.lineTo(pts[j].x, pts[j].y);
      fCtx.closePath();
      fCtx.fill();
    });

    fCtx.globalCompositeOperation = "source-over";
    ctx.filter = "blur(28px)";
    ctx.drawImage(fog, 0, 0);
    ctx.filter = "none";
  }

  function renderMap() {
    ensureTerrainChunkCache();
    const origin = viewportOrigin();
    const samples = [
      toTile(0, 0),
      toTile(canvas.clientWidth, 0),
      toTile(0, canvas.clientHeight),
      toTile(canvas.clientWidth, canvas.clientHeight)
    ];
    const margin = 10;
    const minX = clamp(Math.floor(Math.min(...samples.map((p) => p.x))) - margin, 0, MAP_WIDTH - 1);
    const maxX = clamp(Math.ceil(Math.max(...samples.map((p) => p.x))) + margin, 0, MAP_WIDTH - 1);
    const minY = clamp(Math.floor(Math.min(...samples.map((p) => p.y))) - margin, 0, MAP_HEIGHT - 1);
    const maxY = clamp(Math.ceil(Math.max(...samples.map((p) => p.y))) + margin, 0, MAP_HEIGHT - 1);
    const minChunkX = Math.floor(minX / CHUNK_TILES);
    const maxChunkX = Math.floor(maxX / CHUNK_TILES);
    const minChunkY = Math.floor(minY / CHUNK_TILES);
    const maxChunkY = Math.floor(maxY / CHUNK_TILES);
    const chunks = [];

    for (let chunkY = minChunkY; chunkY <= maxChunkY; chunkY += 1) {
      for (let chunkX = minChunkX; chunkX <= maxChunkX; chunkX += 1) {
        chunks.push({ sort: chunkX + chunkY, chunkX, chunkY });
      }
    }

    chunks.sort((a, b) => a.sort - b.sort);
    chunks.forEach(({ chunkX, chunkY }) => {
      const key = chunkKey(chunkX, chunkY);
      let chunk = game.terrainRender.chunkCache.get(key);
      if (!chunk) {
        chunk = createTerrainChunk(chunkX, chunkY);
        game.terrainRender.chunkCache.set(key, chunk);
        if (pixiReady && pixiTreeTex && chunk.trees.length > 0) {
          const tW = Math.round(game.tileW * 11 / 24);
          const tH = Math.round(game.tileW * 22 / 24);
          for (const { worldBx, worldBy, tileX, tileY } of chunk.trees) {
            const tspr = new PixiSprite(pixiTreeTex);
            tspr.width  = tW;
            tspr.height = tH;
            tspr.anchor.set(0.5, 1.0);
            tspr.zIndex = tileX + tileY;
            pixiUnitCtr.addChild(tspr);
            pixiTreeSprites.push({ sprite: tspr, worldBx, worldBy });
          }
        }
      }
      ctx.drawImage(chunk.canvas, chunk.worldX - game.camera.x + origin.x, chunk.worldY - game.camera.y + origin.y);
    });
  }

  function renderMapPixi() {
    ensureTerrainChunkCache();
    const origin = viewportOrigin();

    // 지형/나무 컨테이너에 카메라 오프셋 적용 (스프라이트는 월드 좌표 고정)
    const camX = Math.round(origin.x - game.camera.x);
    const camY = Math.round(origin.y - game.camera.y);
    pixiTerrainCtr.x = camX;
    pixiTerrainCtr.y = camY;
    pixiTreeCtr.x    = camX;
    pixiTreeCtr.y    = camY;

    // 가시 청크 범위 계산
    const samples = [
      toTile(0, 0), toTile(canvas.clientWidth, 0),
      toTile(0, canvas.clientHeight), toTile(canvas.clientWidth, canvas.clientHeight),
    ];
    const margin = 10;
    const minX = clamp(Math.floor(Math.min(...samples.map(p => p.x))) - margin, 0, MAP_WIDTH - 1);
    const maxX = clamp(Math.ceil( Math.max(...samples.map(p => p.x))) + margin, 0, MAP_WIDTH - 1);
    const minY = clamp(Math.floor(Math.min(...samples.map(p => p.y))) - margin, 0, MAP_HEIGHT - 1);
    const maxY = clamp(Math.ceil( Math.max(...samples.map(p => p.y))) + margin, 0, MAP_HEIGHT - 1);
    const minCX = Math.floor(minX / CHUNK_TILES), maxCX = Math.floor(maxX / CHUNK_TILES);
    const minCY = Math.floor(minY / CHUNK_TILES), maxCY = Math.floor(maxY / CHUNK_TILES);

    const visibleKeys = new Set();
    for (let cy = minCY; cy <= maxCY; cy++) {
      for (let cx = minCX; cx <= maxCX; cx++) {
        const key = chunkKey(cx, cy);
        visibleKeys.add(key);

        if (!pixiChunkSprites.has(key)) {
          const chunk = createTerrainChunk(cx, cy);

          // 캔버스 → PixiJS 텍스처 → 스프라이트 (정적 텍스처로 고정)
          const tex = Texture.from(chunk.canvas);
          if (tex.source) tex.source.autoUpdate = false;
          const spr = new PixiSprite(tex);
          spr.x = chunk.worldX;
          spr.y = chunk.worldY;
          pixiTerrainCtr.addChild(spr);
          pixiChunkSprites.set(key, spr);

          // 나무는 현재 청크 캔버스에 포함되어 있음
          // (PixiJS Y정렬 분리는 Texture.fromURL 이슈 해결 후 진행)
        }
      }
    }

    // 가시 여부에 따라 청크 스프라이트 표시/숨김
    for (const [key, spr] of pixiChunkSprites)
      spr.visible = visibleKeys.has(key);
  }

  function renderFormationSelection() {
    const selected = game.playerFormations.find((f) => f.id === game.selectedId);
    if (!selected) return;
    const alive = selected.units.filter(isUnitAlive);
    if (!alive.length) return;

    const tileH = getTileH();
    const PAD = 0.8;

    // slotLocal(로컬 격자 좌표)의 min/max로 개념적 진형 범위 계산
    const anchor = selected.anchor;
    let minF = Infinity, maxF = -Infinity, minR = Infinity, maxR = -Infinity;
    alive.forEach((u) => {
      minF = Math.min(minF, u.slotLocal.y); maxF = Math.max(maxF, u.slotLocal.y);
      minR = Math.min(minR, u.slotLocal.x); maxR = Math.max(maxR, u.slotLocal.x);
    });

    // worldFromLocal로 4 꼭짓점을 타일 좌표로 변환 (패딩 포함)
    const tilePts = [
      add(anchor, worldFromLocal(selected, vec(minR - PAD, minF - PAD))),
      add(anchor, worldFromLocal(selected, vec(maxR + PAD, minF - PAD))),
      add(anchor, worldFromLocal(selected, vec(maxR + PAD, maxF + PAD))),
      add(anchor, worldFromLocal(selected, vec(minR - PAD, maxF + PAD))),
    ];

    // 타일 좌표 → 화면 좌표 변환
    const pts = tilePts.map((p) => {
      const s = toScreen(p.x, p.y);
      return { x: s.x, y: s.y + tileH / 2 };
    });

    // pulse: 0 ~ 1, 약 2.5회/초
    // sin을 0~1로 정규화한 뒤 거듭제곱 → 어두운 구간 길게, 밝은 순간 짧고 강하게
    // 1에서 뒤집어 거듭제곱 → 밝은 구간 길게, 어두운 순간 짧고 강하게
    const raw   = (1 + Math.sin(game.battleTime * 2)) / 2; // 0 ~ 1
    const pulse = 1 - Math.pow(1 - raw, 2.5);              // ease-out 커브

    ctx.save();

    // 글로우 레이어 (그림자로 표현)
    ctx.shadowColor = `rgba(255, 210, 40, ${0.15 + pulse * 0.35})`;
    ctx.shadowBlur  = 3 + pulse * 8;
    ctx.strokeStyle = `rgba(255, 215, 50, ${0.20 + pulse * 0.75})`;
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.stroke();

    ctx.restore();
  }

  function isEnemyVisible(unit) {
    if (game.battlePhase !== "live") return true;
    return game.playerFormations.some((f) => {
      const alive = f.units.filter(isUnitAlive);
      if (!alive.length) return false;
      const center = formationCenter(f);
      return effectiveDistance(center.x, center.y, unit.x, unit.y) <= 60;
    });
  }

  // ── 말풍선 시스템 ────────────────────────────────────────────────────
  function randFrom(arr) {
    if (!arr || !arr.length) return null;
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function tryShowSpeech(formation, text, priority = "low") {
    if (!text || !speechData) return;
    if (game.battlePhase !== "live") return;
    if (game.battleTime < formation.speechCooldown) return;
    const chance = priority === "high" ? 0.72 : 0.20;
    if (Math.random() > chance) return;
    formation.speechBubble = { text, expiry: game.battleTime + 2.0 };
    formation.speechCooldown = game.battleTime + 5.0;
  }

  function tryShowSpeechCommand(formation, text) {
    // 명령 계기 (저확률, 전투 전에도 발동)
    if (!text || !speechData) return;
    if (game.battleTime < formation.speechCooldown) return;
    if (Math.random() > 0.30) return;
    formation.speechBubble = { text, expiry: game.battleTime + 2.0 };
    formation.speechCooldown = game.battleTime + 5.0;
  }

  function getClockHour(fromFormation, toFormation) {
    const fc = formationCenter(fromFormation);
    const tc = formationCenter(toFormation);
    const fs = toScreen(fc.x, fc.y);
    const ts = toScreen(tc.x, tc.y);
    const dx = ts.x - fs.x, dy = ts.y - fs.y;
    const angle = Math.atan2(dx, -dy); // 화면 기준 시계방향, 12시=위
    const hours = ((angle / (2 * Math.PI)) * 12 + 12) % 12;
    return Math.round(hours) || 12;
  }

  function renderSpeechBubbles() {
    const tileH = getTileH();
    const now = game.battleTime;

    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    game.playerFormations.forEach(formation => {
      const b = formation.speechBubble;
      if (!b) return;
      if (now > b.expiry) { formation.speechBubble = null; return; }

      // 페이드 인/아웃
      const age = 2.0 - (b.expiry - now);
      const alpha = Math.min(1, age * 6) * Math.min(1, (b.expiry - now) * 3.5);
      ctx.globalAlpha = alpha;

      const s = toScreen(formation.anchor.x, formation.anchor.y);
      const bx = s.x;
      const dh = Math.round(troopRenderHeight(formation.troopType));
      const by = s.y + tileH / 2 - dh - 18;

      // 텍스트 측정
      ctx.font = "bold 12px 'Noto Serif KR', serif";
      const tw = ctx.measureText(b.text).width;
      const pad = 12, bw = tw + pad * 2, bh = 28, br = 9;
      const lx = bx - bw / 2, ty = by - bh;

      // 그림자
      ctx.shadowColor = "rgba(0,0,0,0.30)";
      ctx.shadowBlur = 6;
      ctx.shadowOffsetY = 3;

      // 배경 + 꼬리 (테두리 없음)
      ctx.fillStyle = "rgba(255, 251, 225, 0.72)";
      ctx.beginPath();
      ctx.moveTo(lx + br, ty);
      ctx.lineTo(lx + bw - br, ty);
      ctx.quadraticCurveTo(lx + bw, ty, lx + bw, ty + br);
      ctx.lineTo(lx + bw, ty + bh - br);
      ctx.quadraticCurveTo(lx + bw, ty + bh, lx + bw - br, ty + bh);
      ctx.lineTo(bx + 7, ty + bh);
      ctx.lineTo(bx,     ty + bh + 10);  // 꼬리 끝
      ctx.lineTo(bx - 7, ty + bh);
      ctx.lineTo(lx + br, ty + bh);
      ctx.quadraticCurveTo(lx, ty + bh, lx, ty + bh - br);
      ctx.lineTo(lx, ty + br);
      ctx.quadraticCurveTo(lx, ty, lx + br, ty);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;

      // 텍스트
      ctx.fillStyle = "#3a2200";
      ctx.fillText(b.text, bx, ty + bh / 2);
    });

    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function updateSpeechTriggers() {
    if (!speechData || game.battlePhase !== "live") return;

    game.playerFormations.forEach(formation => {
      if (formation.retreated) return;
      if (!formation.units.some(isUnitAlive)) return;

      // 1. 지형 진입
      const ax = clamp(Math.floor(formation.anchor.x), 0, MAP_WIDTH - 1);
      const ay = clamp(Math.floor(formation.anchor.y), 0, MAP_HEIGHT - 1);
      const tile = game.terrain.tiles[ay][ax];
      if (tile !== formation.speechTerrainLast) {
        const prev = formation.speechTerrainLast;
        formation.speechTerrainLast = tile;
        if (prev !== "") {  // 첫 진입이 아닐 때만
          const key = tile === "mountain" ? "terrain_mountain"
                    : tile === "river"    ? "terrain_river"
                    : tile === "road"     ? "terrain_road"
                    : tile === "wetland"  ? "terrain_wetland" : null;
          if (key) tryShowSpeech(formation, randFrom(speechData[key]), "low");
        }
      }

      // 2. 혼란도 상승
      if (formation.disorder > 0.6 && !formation.speechDisorderTriggered) {
        formation.speechDisorderTriggered = true;
        tryShowSpeech(formation, randFrom(speechData.disorder), "high");
      } else if (formation.disorder < 0.3) {
        formation.speechDisorderTriggered = false;
      }

      // 3. 적군 최초 포착
      const pfCenter = formationCenter(formation);
      game.enemyFormations.forEach(enemy => {
        // 전역 Set: 이미 어딘가에서 발언했으면 모든 진영이 생략
        if (game.speechEnemySighted.has(enemy.id)) return;
        if (!enemy.units.some(isUnitAlive)) return;
        const ec = formationCenter(enemy);
        if (effectiveDistance(pfCenter.x, pfCenter.y, ec.x, ec.y) <= 60) {
          game.speechEnemySighted.add(enemy.id);
          const hour = getClockHour(formation, enemy);
          const text = `${enemy.general.name} 장수의 진영이 ${hour}시 방향에서 나타났습니다!`;
          if (game.battleTime >= formation.speechCooldown) {
            formation.speechBubble = { text, expiry: game.battleTime + 2.0 };
            formation.speechCooldown = game.battleTime + 5.0;
          }
        }
      });
    });
  }

  function renderUnits() {
    const formations = [...game.playerFormations, ...game.enemyFormations];
    const units = [];
    formations.forEach((formation) => {
      formation.units.filter(isUnitAlive).forEach((unit) => {
        if (formation.team === "enemy" && !isEnemyVisible(unit)) return;
        units.push({ sort: unit.x + unit.y, formation, unit });
      });
    });
    units.sort((a, b) => a.sort - b.sort);

    const tileH = getTileH();
    const externalUnitLoaded = unitWalkSprite.naturalWidth > 0 && unitWalkBlueSprite.naturalWidth > 0
      && cavalryWalkSprite.naturalWidth > 0 && cavalryWalkBlueSprite.naturalWidth > 0
      && unitIdleSprite.naturalWidth > 0 && unitIdleBlueSprite.naturalWidth > 0;
    const canvasUnitMetrics = (formation) => {
      const troopType = normalizeTroopType(formation.troopType);
      if (!externalUnitLoaded) {
        const fallbackScale = game.tileW / 20;
        return { troopType, frameW: SPRITE_W, frameH: SPRITE_H, drawW: Math.round(SPRITE_W * fallbackScale), drawH: Math.round(SPRITE_H * fallbackScale), spriteScale: fallbackScale };
      }
      const teamSprite = troopType === "cavalry"
        ? (formation.team === 'enemy' ? cavalryWalkBlueSprite : cavalryWalkSprite)
        : formation.team === 'enemy'
          ? unitWalkBlueSprite
          : unitWalkSprite;
      const frameW = teamSprite.naturalWidth / troopWalkFrames(troopType);
      const frameH = teamSprite.naturalHeight;
      const spriteScale = troopRenderScale(troopType);
      return {
        troopType,
        frameW,
        frameH,
        drawW: Math.round(frameW * spriteScale),
        drawH: Math.round(frameH * spriteScale),
        spriteScale,
      };
    };

    // ── Pass 1: 바닥 그림자 (모든 스프라이트보다 먼저) ──────────────────
    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = "#000";
    units.forEach(({ formation, unit }) => {
      if (normalizeTroopType(formation.troopType) === "cavalry") return;
      const { drawW, drawH } = canvasUnitMetrics(formation);
      const s = toScreen(unit.x, unit.y);
      const cx = s.x, cy = s.y + tileH / 2;
      ctx.beginPath();
      ctx.ellipse(
        cx + drawW * 0.10,   // 약간 오른쪽 (좌상단 광원)
        cy + drawH * 0.06,   // 약간 아래
        drawW * 0.52,        // x 반지름 (스프라이트 폭의 절반 정도)
        drawW * 0.14,        // y 반지름 (아이소메트릭 바닥에 납작하게)
        0, 0, Math.PI * 2
      );
      ctx.fill();
    });
    ctx.restore();

    // ── Pass 2: 스프라이트 ────────────────────────────────────────────────
    ctx.imageSmoothingEnabled = false;
    units.forEach(({ formation, unit }) => {
      const screen = toScreen(unit.x, unit.y);
      const cx = screen.x;
      const cy = screen.y + tileH / 2;
      const metrics = canvasUnitMetrics(formation);
      const { troopType, drawW, drawH } = metrics;

      const targetSlot = add(formation.anchor, worldFromLocal(formation, unit.slotLocal));
      const slotDist = len(targetSlot.x - unit.x, targetSlot.y - unit.y);
      const firstRowBonusActive = unit.isFirstRow && slotDist < 1.5;
      const positionBonusActive = !firstRowBonusActive && slotDist < POSITION_DEFENSE_THRESHOLD;
      const kihapActive = unit.kihapTimer > 0;
      const skillBuffActive = formation.swiftTimer > 0
        || formation.archeryTimer > 0
        || (formation.guardTimer > 0 && slotDist < POSITION_DEFENSE_THRESHOLD);

      // 유닛 이동 여부 + 위상 오프셋으로 발걸음 다양화
      const isMoving = len(unit.vx, unit.vy) > 0.08;
      const frameCount = externalUnitLoaded ? troopWalkFrames(troopType) : 2;
      const frameIdx = isMoving ? Math.floor(game.battleTime * 7 + unit.chaosPhaseOffset * 3) % frameCount : 0;
      if (typeof unit.visualFacingLeft !== "boolean") {
        unit.visualFacingLeft = visualFacingLeftFromFormation(formation);
      }
      if (formation.speed === "STOP") {
        unit.visualFacingLeft = visualFacingLeftFromFormation(formation);
      } else if (Math.abs(unit.vx) > 0.12) {
        unit.visualFacingLeft = unit.vx < 0;
      }
      const facingLeft = unit.visualFacingLeft;
      const spriteSet = externalUnitLoaded ? null : game.spriteCache[formation.team][frameIdx];
      const sprite = externalUnitLoaded ? null : (firstRowBonusActive || kihapActive || skillBuffActive
        ? (facingLeft ? spriteSet.bonusLeft : spriteSet.bonusRight)
        : (facingLeft ? spriteSet.left      : spriteSet.right));

      const drawX = cx - drawW / 2;
      const drawY = cy - drawH;

      // 보너스 이펙트: 선두행은 강하게, 일반 정위치는 은은하게 표시
      if (firstRowBonusActive || positionBonusActive || kihapActive || skillBuffActive) {
        const strongGlow = firstRowBonusActive || kihapActive || skillBuffActive;
        const glowAlpha = strongGlow ? 0.24 : 0.14;
        const glowSize = strongGlow
          ? { x: 0.60, y: 0.50 }
          : { x: 0.50, y: 0.40 };
        const glowColor = formation.team === 'player'
          ? `rgba(255,60,60,${glowAlpha})`
          : `rgba(255,170,70,${glowAlpha})`;
        ctx.save();
        ctx.fillStyle = glowColor;
        ctx.beginPath();
        ctx.ellipse(cx, cy - drawH * 0.35, drawW * glowSize.x, drawH * glowSize.y, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      if (externalUnitLoaded) {
        const teamSprite = troopType === "cavalry"
          ? (formation.team === 'enemy' ? cavalryWalkBlueSprite : cavalryWalkSprite)
          : formation.team === 'enemy'
            ? (isMoving && unitWalkBlueSprite.naturalWidth > 0 ? unitWalkBlueSprite : unitIdleBlueSprite)
            : (isMoving ? unitWalkSprite : unitIdleSprite);
        const usesWalkSheet = isMoving || troopType === "cavalry";
        const frameW = usesWalkSheet ? teamSprite.naturalWidth / troopWalkFrames(troopType) : teamSprite.naturalWidth;
        const frameH = teamSprite.naturalHeight;
        const sx = usesWalkSheet ? frameIdx * frameW : 0;
        const drawUnitX = cx - drawW / 2;
        const drawUnitY = cy - drawH;
        ctx.save();
        if (facingLeft) {
          ctx.translate(cx, 0);
          ctx.scale(-1, 1);
          ctx.drawImage(teamSprite, sx, 0, frameW, frameH, -drawW / 2, drawUnitY, drawW, drawH);
        } else {
          ctx.drawImage(teamSprite, sx, 0, frameW, frameH, drawUnitX, drawUnitY, drawW, drawH);
        }
        ctx.restore();
      } else {
        ctx.drawImage(sprite, drawX, drawY, drawW, drawH);
      }
    });
    ctx.imageSmoothingEnabled = true;
  }

  function renderFires() {
    if (!game.fires.length) return;
    const tileH  = getTileH();
    const now    = game.battleTime;
    const loaded = fireSprite.naturalWidth > 0;
    const fw     = loaded ? Math.floor(fireSprite.naturalWidth  / FIRE_COLS) : 0;
    const fh     = loaded ? Math.floor(fireSprite.naturalHeight / FIRE_ROWS) : 0;
    // 화면상 불꽃 크기: 타일 너비 기준 2.2배, 종횡비 유지
    const drawW  = game.tileW * 1.5;
    const drawH  = loaded ? drawW * (fh / fw) : drawW;

    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    for (const fire of game.fires) {
      for (const p of fire.particles) {
        const s  = toScreen(p.x, p.y);
        const cx = s.x;
        const cy = s.y + tileH / 2;

        if (loaded) {
          // 파티클마다 다른 위상으로 자연스러운 애니메이션
          const phase    = ((p.x * 7 + p.y * 11) & 0xF);
          const frameIdx = (Math.floor(now * 12) + phase) % FIRE_FRAMES;
          const col      = frameIdx % FIRE_COLS;
          const row      = Math.floor(frameIdx / FIRE_COLS);
          ctx.globalAlpha = 0.92;
          ctx.drawImage(
            fireSprite,
            col * fw, row * fh, fw, fh,
            Math.round(cx - drawW / 2),
            Math.round(cy - drawH),
            Math.round(drawW),
            Math.round(drawH)
          );
        } else {
          // 스프라이트 미로드 시 폴백
          const flicker = 0.65 + Math.sin(now * 9 + p.x * 3.7 + p.y * 2.3) * 0.35;
          const rad = game.tileW * 0.42 * (0.8 + flicker * 0.2);
          ctx.globalAlpha = 0.78;
          ctx.fillStyle = `rgb(${Math.round(255 * flicker)},${Math.round(80 * flicker)},0)`;
          ctx.beginPath();
          ctx.ellipse(cx, cy, rad, rad * 0.55, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function renderFloodWarning() {
    if (!game.flood || game.flood.damageDealt) return;
    const tileH = getTileH();
    const pulse = 0.35 + 0.35 * Math.sin(game.battleTime * 7);
    ctx.save();
    ctx.globalAlpha = pulse;
    ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
    for (let y = 0; y < MAP_HEIGHT; y++) {
      for (let x = 0; x < MAP_WIDTH; x++) {
        const t = game.terrain.tiles[y][x];
        if (t !== "river" && t !== "wetland") continue;
        const s = toScreen(x, y);
        const px = s.x, py = s.y + tileH / 2;
        const hw = game.tileW / 2 + 0.5, hh = tileH / 2 + 0.5;
        ctx.beginPath();
        ctx.moveTo(px,      py - hh);
        ctx.lineTo(px + hw, py);
        ctx.lineTo(px,      py + hh);
        ctx.lineTo(px - hw, py);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function renderTraces() {
    const tileH = getTileH();
    const sz = Math.max(1.5, game.tileW * 0.14);
    ctx.strokeStyle = "rgba(55, 25, 15, 0.65)";
    ctx.fillStyle   = "rgba(55, 25, 15, 0.60)";
    ctx.lineWidth = 1;
    game.traces.forEach(({ x, y, type }) => {
      const s = toScreen(x, y);
      const cx = s.x, cy = s.y + tileH / 2;
      if (type === 0) {
        // X 형태
        ctx.beginPath();
        ctx.moveTo(cx - sz, cy - sz); ctx.lineTo(cx + sz, cy + sz);
        ctx.moveTo(cx + sz, cy - sz); ctx.lineTo(cx - sz, cy + sz);
        ctx.stroke();
      } else if (type === 1) {
        // 점 3개 산포
        for (const [ox, oy] of [[-sz*0.8, -sz*0.3], [sz*0.4, sz*0.7], [sz*0.9, -sz*0.6]]) {
          ctx.beginPath();
          ctx.arc(cx + ox, cy + oy, sz * 0.35, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        // 짧은 곡선 (호)
        ctx.beginPath();
        ctx.arc(cx, cy, sz * 0.9, Math.PI * 0.2, Math.PI * 1.1);
        ctx.stroke();
      }
    });
    ctx.lineWidth = 1;
  }

  function renderProjectiles() {
    const tileH = getTileH();
    ctx.strokeStyle = "rgba(0, 0, 0, 0.85)";
    ctx.lineWidth = 0.8;
    game.projectiles.forEach((p) => {
      const dx = p.tx - p.x;
      const dy = p.ty - p.y;
      const d = len(dx, dy);
      if (d < 0.001) return;
      const nx = dx / d;
      const ny = dy / d;
      const tailX = p.x - nx * 0.5;
      const tailY = p.y - ny * 0.5;
      const head = toScreen(p.x, p.y);
      const tail = toScreen(tailX, tailY);
      const cy = tileH / 2;
      ctx.beginPath();
      ctx.moveTo(tail.x, tail.y + cy);
      ctx.lineTo(head.x, head.y + cy);
      ctx.stroke();
    });
  }

  function renderPlayerTargets() {
    game.playerFormations.forEach((formation) => {
      if (!formation.target) return;
      if (formation.retreated || !formation.units.some(isUnitAlive)) return;
      if (len(formation.anchor.x - formation.target.x, formation.anchor.y - formation.target.y) < 1.0) return;
      const point = toScreen(formation.target.x, formation.target.y);
      const anchor = toScreen(formation.anchor.x, formation.anchor.y);
      const cy = point.y + getTileH() / 2;
      ctx.strokeStyle = "#ffe992";
      ctx.beginPath();
      ctx.arc(point.x, cy, 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(anchor.x, anchor.y + getTileH() / 2);
      ctx.lineTo(point.x, cy);
      ctx.stroke();
    });
  }

  function renderMinimap() {
    const width = 210;
    const height = 140;
    const x = canvas.clientWidth - width - 16;
    const y = canvas.clientHeight - height - 16;
    ctx.fillStyle = "rgba(17,21,24,0.9)";
    ctx.fillRect(x - 6, y - 6, width + 12, height + 12);
    ctx.strokeStyle = "#7a8898";
    ctx.strokeRect(x - 6, y - 6, width + 12, height + 12);
    ctx.drawImage(game.terrainRender.minimapCanvas, x, y, width, height);

    // 후퇴 경계선
    const playerRetX = x + (8 / MAP_WIDTH) * width;
    const enemyRetX = x + ((MAP_WIDTH - 8) / MAP_WIDTH) * width;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 2]);
    ctx.strokeStyle = "rgba(100,180,255,0.7)";
    ctx.beginPath(); ctx.moveTo(playerRetX, y); ctx.lineTo(playerRetX, y + height); ctx.stroke();
    ctx.strokeStyle = "rgba(255,100,100,0.7)";
    ctx.beginPath(); ctx.moveTo(enemyRetX, y); ctx.lineTo(enemyRetX, y + height); ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = 1;

    game.playerFormations.forEach((formation) => {
      const center = formationCenter(formation);
      ctx.fillStyle = "#5ea6ff";
      ctx.beginPath();
      ctx.arc(x + center.x / MAP_WIDTH * width, y + center.y / MAP_HEIGHT * height, 3, 0, Math.PI * 2);
      ctx.fill();
    });

    game.enemyFormations.forEach((formation) => {
      const center = formationCenter(formation);
      ctx.fillStyle = "#e25b5b";
      ctx.beginPath();
      ctx.arc(x + center.x / MAP_WIDTH * width, y + center.y / MAP_HEIGHT * height, 3, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function renderOverlay() {
    ctx.fillStyle = "#f1e4c0";
    ctx.font = "16px sans-serif";
    ctx.fillText(`상태: ${game.battlePhase === "planning" ? "준비 중" : "전투 중"} / 경과 ${game.battleTime.toFixed(1)}초`, 18, 28);
    if (game.battlePhase === "planning") {
      ctx.fillStyle = "#f1d18b";
      ctx.fillText("전투 시작 전입니다. 목표 위치와 진형을 먼저 지정하세요.", 18, 52);
    }
  }

  function render() {
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#12161a";
    ctx.fillRect(0, 0, width, height);

    renderMap();

    if (pixiReady && pixiTreeSprites.length > 0) {
      const origin = viewportOrigin();
      const offX = game.camera.x - origin.x;
      const offY = game.camera.y - origin.y;
      for (const { sprite, worldBx, worldBy } of pixiTreeSprites) {
        sprite.x = worldBx - offX;
        sprite.y = worldBy - offY;
      }
    }

    if (!pixiReady) renderFog();

    renderTraces();
    renderFloodWarning();
    renderFormationSelection();

    if (pixiReady) {
      if (pixiApp.renderer.width !== Math.ceil(width) || pixiApp.renderer.height !== Math.ceil(height)) {
        pixiApp.renderer.resize(width, height);
      }
      renderUnitsPixi();
      renderFogPixi();
      pixiApp.renderer.render(pixiApp.stage);
      ctx.drawImage(pixiApp.canvas, 0, 0, width, height, 0, 0, width, height);
    } else {
      renderUnits();
    }

    renderProjectiles();
    renderFires();
    renderPlayerTargets();
    renderSpeechBubbles();
    if (game.battlePhase !== "live") renderMinimap();
    renderOverlay();
  }

  function refreshHud() {
    const formations = game.playerFormations;

    // 버튼 수 맞추기 — 최초 1회만 생성, 이후 재사용
    while (hudEl.children.length < formations.length) {
      const index = hudEl.children.length;
      const card = document.createElement("button");
      card.type = "button";
      card.tabIndex = -1;
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
    while (hudEl.children.length > formations.length) {
      hudEl.removeChild(hudEl.lastChild);
    }

    // 내용·클래스만 갱신 — DOM 엘리먼트는 유지
    formations.forEach((formation, index) => {
      const troops = formationRemainingTroops(formation);
      const troopPct = (troops / formationInitialTroops(formation) * 100).toFixed(1);
      const health = troopPct > 60 ? "healthy" : troopPct > 30 ? "wounded" : "critical";
      const card = hudEl.children[index];
      card.className = `hud-card${formation.id === game.selectedId ? " active" : ""}${troops <= 0 ? " dead" : ""}`;
      card.dataset.health = troops <= 0 ? "dead" : health;
      const bar = `<div class="troop-bar-wrap"><div class="troop-bar-fill" style="width:${troopPct}%"></div></div>`;
      if (formation.retreated) {
        card.innerHTML = `<h3>${formation.general.name}</h3><span class="retreated-label">퇴각</span>${bar}`;
      } else if (formation.retreating) {
        card.innerHTML = `<h3>${formation.general.name}</h3><span class="retreating-label">후퇴 중</span>${bar}`;
      } else {
        card.innerHTML = `<h3>${formation.general.name}</h3><div class="hud-troop">${formatTroops(troops)}</div>${bar}`;
      }
    });

    game.hudDirty = false;
  }

  function refreshButtons() {
    const selected = currentSelection()[0];
    if (selected) selected.density = normalizeDensityForTroopType(selected.troopType, selected.density);

    // 속도·밀도 버튼 활성 상태
    buttons.speed.forEach((button) => {
      button.classList.toggle("active", Boolean(selected && selected.speed === button.dataset.speed));
    });
    buttons.density.forEach((button) => {
      button.classList.toggle("active", Boolean(selected && selected.density === button.dataset.density));
      button.disabled = Boolean(selected && !isDensityAllowed(selected.troopType, button.dataset.density));
    });

    // 상단 버튼
    phaseButton.textContent = game.battlePhase === "planning" ? "전투 개시" : "전투 진행 중";
    phaseButton.disabled = game.battlePhase !== "planning";
    speedToggleButton.disabled = game.battlePhase !== "live";
    speedToggleButton.classList.toggle("active", game.speedMultiplier === 2);
    speedToggleButton.textContent = game.speedMultiplier === 2 ? "기본속도" : "2배속";
    troopAdjustBtn.disabled = game.battlePhase !== "planning";

    // 패널: 장수 정보 + 실시간 전투 능력치
    if (selected) {
      const g = selected.general;
      panelGeneralName.textContent = g.name;
      if (g.portrait) { panelPortrait.src = g.portrait; panelPortrait.hidden = false; }
      else              { panelPortrait.src = '';           panelPortrait.hidden = true; }

      // 근접 공격력
      const meleeAtk = unitAttack(selected);

      // 근접 방어력 (앵커 위치 지형 기준)
      const atx = clamp(Math.floor(selected.anchor.x), 0, MAP_WIDTH - 1);
      const aty = clamp(Math.floor(selected.anchor.y), 0, MAP_HEIGHT - 1);
      const aTile = terrainInfo[game.terrain.tiles[aty][atx]];
      const meleeDef = Math.max(0,
        2 + speedInfo[selected.speed].defense
          + densityInfo[selected.density].defense
          + aTile.defense
          - selected.disorder * 2) * troopTypeInfo(selected.troopType).meleeDefenseMult
        + (selected.troopType === 'cavalry' ? 10 : 0);

      // 원거리 공격력 (기본, 정면 기준)
      const rangedAtk = rangedAttack(selected);

      // 원거리 방어 (밀도 기반 피해 배율 → 양수=방어, 음수=취약)
      const rangedDefPct = Math.round((1 - rangedDefenseDamageMult(selected)) * 100);

      panelMeleeAtk.textContent  = meleeAtk.toFixed(1);
      panelMeleeDef.textContent  = meleeDef.toFixed(1);
      panelRangedAtk.textContent = rangedAtk.toFixed(1);
      panelRangedDef.textContent = (rangedDefPct >= 0 ? '+' : '') + rangedDefPct + '%';
      panelRangedDef.className   = 'stat-val' + (rangedDefPct > 0 ? ' ranged-def-good' : rangedDefPct < 0 ? ' ranged-def-bad' : '');

      const troops    = formationRemainingTroops(selected);
      const troopPct  = (troops / formationInitialTroops(selected) * 100).toFixed(1);
      panelTroopCount.textContent = `${troopTypeInfo(selected.troopType).label} ${formatTroops(troops)}`;
      panelTroopFill.style.width  = `${troopPct}%`;

      const dis = selected.disorder;
      panelDisorderLabel.textContent = dis > 0.01 ? `${(dis * 100).toFixed(0)}%` : "0%";
      panelDisorderFill.style.width  = `${(dis * 100).toFixed(1)}%`;

      // 스킬 버튼 (선택 진형의 스킬로 동적 업데이트)
      const sDef   = SKILL_DEF[selected.skillType] || SKILL_DEF.kihap;
      const maxCd  = skillMaxCooldown(selected);
      const cdLeft = Math.max(0, selected.skillCooldown);
      const ready  = cdLeft <= 0 && game.battlePhase === "live";
      kihapBtn.disabled = !ready || selected.retreated || selected.retreating;
      // 아이콘·레이블 업데이트
      const iconEl  = kihapBtn.querySelector(".kihap-icon");
      const labelEl = kihapBtn.querySelector(".kihap-label");
      if (iconEl)  iconEl.textContent  = sDef.icon;
      if (labelEl) labelEl.textContent = sDef.label;
      const fillRatio = game.battlePhase !== "live" ? 0 : (cdLeft <= 0 ? 1 : 1 - cdLeft / maxCd);
      kihapFill.style.width = `${(fillRatio * 100).toFixed(1)}%`;
      kihapBtn.title = ready ? `${sDef.label} 발동!` : (game.battlePhase !== "live" ? "전투 중에만 사용" : `${cdLeft.toFixed(0)}초 후 사용 가능`);
    } else {
      panelPortrait.src = ''; panelPortrait.hidden = true;
      panelGeneralName.textContent = "부대를 선택하세요";
      panelMeleeAtk.textContent = panelMeleeDef.textContent =
      panelRangedAtk.textContent = panelRangedDef.textContent = "-";
      panelTroopCount.textContent = "병력 -";
      panelTroopFill.style.width  = "0%";
      panelDisorderLabel.textContent = "0%";
      panelDisorderFill.style.width  = "0%";
      kihapBtn.disabled = true;
      kihapFill.style.width = "0%";
    }
  }

  buttons.speed.forEach((button) => {
    button.addEventListener("click", () => {
      const newSpeed = button.dataset.speed;
      currentSelection().forEach((formation) => {
        if (formation.retreating) return;
        if (newSpeed === "STOP") {
          if (formation.speed === "STOP") {
            // STOP 버튼 재클릭 → prevSpeed로 복귀 (토글)
            formation.speed = formation.prevSpeed || "NORMAL";
          } else {
            formation.prevSpeed = formation.speed;
            formation.speed = "STOP";
            formation.target = null;
            if (speechData) tryShowSpeechCommand(formation, randFrom(speechData.speed_stop));
          }
        } else {
          // 속도 버튼 직접 선택 — STOP 상태 여부와 관계없이 해당 속도 즉시 적용
          if (formation.speed === "STOP") {
            // STOP에서 나올 때 prevSpeed도 갱신해 이후 토글 기준을 맞춤
            formation.prevSpeed = newSpeed;
          }
          formation.speed = newSpeed;
          if (newSpeed === "SLOW" && speechData)
            tryShowSpeechCommand(formation, "현재 진형을 유지한채 이동하라.");
          if (newSpeed === "FAST" && speechData)
            tryShowSpeechCommand(formation, randFrom(speechData.speed_fast));
        }
      });
      game.hudDirty = true;
      refreshButtons();
    });
  });

  buttons.density.forEach((button) => {
    button.addEventListener("click", () => {
      const newDensity = button.dataset.density;
      currentSelection().forEach((formation) => {
        if (formation.retreating) return;
        if (!isDensityAllowed(formation.troopType, newDensity)) return;
        formation.density = newDensity;
        initializeFormationSlots(formation, true);
        if (speechData) {
          const key = newDensity === "TIGHT" ? "density_tight"
                    : newDensity === "WIDE"  ? "density_wide" : null;
          if (key) tryShowSpeechCommand(formation, randFrom(speechData[key]));
        }
      });
      game.hudDirty = true;
      refreshButtons();
    });
  });

  buttons.ratioDown.addEventListener("click", () => {
    currentSelection().forEach((formation) => {
      if (formation.retreating) return;
      formation.ratio = clamp(formation.ratio - 0.3, 0.33, 3.0);
      initializeFormationSlots(formation, true);
    });
    game.hudDirty = true;
  });

  buttons.ratioUp.addEventListener("click", () => {
    currentSelection().forEach((formation) => {
      if (formation.retreating) return;
      formation.ratio = clamp(formation.ratio + 0.3, 0.33, 3.0);
      initializeFormationSlots(formation, true);
    });
    game.hudDirty = true;
  });

  phaseButton.addEventListener("click", () => {
    if (game.battlePhase === "planning") {
      game.battlePhase = "live";
      const allF = [...game.playerFormations, ...game.enemyFormations];
      allF.forEach((f) => { f.kihapCooldown = kihapMaxCooldown(f); f.skillCooldown = skillMaxCooldown(f); });
      currentSelection().forEach((formation) => {
        if (formation.speed === "STOP" && formation.target) formation.speed = "NORMAL";
      });
      game.hudDirty = true;
      refreshButtons();
    }
  });

  speedToggleButton.addEventListener("click", () => {
    if (game.battlePhase !== "live") return;
    // 정지 상태에서 배속 토글 → 정지 전 속도로 복귀
    currentSelection().forEach((formation) => {
      if (formation.speed === "STOP") formation.speed = formation.prevSpeed || "NORMAL";
    });
    game.speedMultiplier = game.speedMultiplier === 2 ? 1 : 2;
    game.hudDirty = true;
    refreshButtons();
  });

  kihapBtn.addEventListener("click", () => {
    currentSelection().forEach((formation) => activateSkill(formation));
    refreshButtons();
  });

  function toggleStop() {
    currentSelection().forEach((formation) => {
      if (formation.retreating) return;
      if (formation.speed === "STOP") {
        formation.speed = formation.prevSpeed || "NORMAL";
      } else {
        formation.prevSpeed = formation.speed;
        formation.speed = "STOP";
        formation.target = null;
        if (speechData) tryShowSpeechCommand(formation, randFrom(speechData.speed_stop));
      }
    });
    game.hudDirty = true;
    refreshButtons();
  }

  function selectNextFormation() {
    const candidates = game.playerFormations.filter((f) =>
      !f.retreated && !f.retreating && f.units.some(isUnitAlive)
    );
    if (!candidates.length) return;
    const idx = candidates.findIndex((f) => f.id === game.selectedId);
    const next = candidates[(idx + 1) % candidates.length];
    game.selectedId = next.id;
    centerCameraOn(formationCenter(next));
    game.hudDirty = true;
    refreshButtons();
  }

  window.addEventListener("keydown", (e) => {
    const tag = e.target?.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
    if (e.code === "Space") { e.preventDefault(); toggleStop(); }
    if (e.code === "Tab")   { e.preventDefault(); selectNextFormation(); }
  });

  canvas.addEventListener("contextmenu", (event) => event.preventDefault());

  canvas.addEventListener("mousedown", (event) => {
    if (event.button === 0) {
      game.dragState = { x: event.clientX, y: event.clientY, camera: { ...game.camera } };
    }
  });

  window.addEventListener("mousemove", (event) => {
    if (!game.dragState) return;
    game.camera.x = game.dragState.camera.x - (event.clientX - game.dragState.x);
    game.camera.y = game.dragState.camera.y - (event.clientY - game.dragState.y);
  });

  window.addEventListener("mouseup", (event) => {
    if (game.dragState && event.button === 0) {
      const dx = event.clientX - game.dragState.x;
      const dy = event.clientY - game.dragState.y;
      const wasDrag = Math.hypot(dx, dy) > 5;
      if (!wasDrag) {
        const rect = canvas.getBoundingClientRect();
        const offsetX = event.clientX - rect.left;
        const offsetY = event.clientY - rect.top;
        const tile = toTile(offsetX, offsetY);
        let closest = null;
        let minDist = 5.0;
        for (const f of game.playerFormations) {
          if (!f.units.some(isUnitAlive)) continue;
          const center = formationCenter(f);
          const d = len(center.x - tile.x, center.y - tile.y);
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

  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    const old = game.tileW;
    const idx = ZOOM_LEVELS.indexOf(old);
    const curIdx = idx !== -1 ? idx : ZOOM_LEVELS.length - 1;
    const nextIdx = clamp(curIdx + (event.deltaY < 0 ? 1 : -1), 0, ZOOM_LEVELS.length - 1);
    game.tileW = ZOOM_LEVELS[nextIdx];
    if (game.tileW === old) return;
    const before = toTile(event.offsetX, event.offsetY);
    const afterIso = isoPoint(before.x, before.y);
    const oldIso = { x: (before.x - before.y) * (old / 2), y: (before.x + before.y) * ((old / 2) / 2) };
    game.camera.x += afterIso.x - oldIso.x;
    game.camera.y += afterIso.y - oldIso.y;
    invalidateTerrainChunkCache();
  }, { passive: false });

  canvas.addEventListener("mouseup", (event) => {
    if (event.button !== 2) return;
    const tile = toTile(event.offsetX, event.offsetY);

    // 클릭 위치에서 가장 가까운 적 진영 탐색 (반경 8타일)
    let clickedEnemy = null;
    let minDist = 8.0;
    for (const f of game.enemyFormations) {
      if (!f.units.some(isUnitAlive)) continue;
      const center = formationCenter(f);
      const d = len(center.x - tile.x, center.y - tile.y);
      if (d < minDist) { minDist = d; clickedEnemy = f; }
    }

    currentSelection().forEach((formation) => {
      if (formation.retreating) return;
      if (clickedEnemy) {
        formation.followTarget = clickedEnemy;
        formation.target = formationCenter(clickedEnemy);
        const desiredFacing = normalize(sub(formation.target, formation.anchor));
        if (canTurnWhileMoving(formation)) applyTurnRule(formation, desiredFacing);
      } else {
        formation.followTarget = null;
        const desiredFacing = normalize(sub(tile, formation.anchor));
        if (canTurnWhileMoving(formation)) applyTurnRule(formation, desiredFacing);
        if (formation.speed === "STOP") {
          if (game.battlePhase === "planning") formation.target = vec(tile.x, tile.y);
        } else {
          formation.target = vec(tile.x, tile.y);
        }
      }
    });
  });

  function tick(now) {
    if (!tick.last) tick.last = now;
    const dt = Math.min(0.05, (now - tick.last) / 1000);
    tick.last = now;
    game.simulationAccumulator = Math.min(game.simulationAccumulator + dt * game.speedMultiplier, SIMULATION_STEP * MAX_SIMULATION_STEPS);
    let stepCount = 0;
    while (game.simulationAccumulator >= SIMULATION_STEP && stepCount < MAX_SIMULATION_STEPS) {
      update(SIMULATION_STEP);
      game.simulationAccumulator -= SIMULATION_STEP;
      stepCount += 1;
    }
    game.hudRefreshAccumulator += dt;
    if (game.hudDirty || game.hudRefreshAccumulator >= 0.25) {
      refreshHud();
      refreshButtons();
      game.hudRefreshAccumulator = 0;
    }
    render();
    requestAnimationFrame(tick);
  }

  // ── 전투 종료 감지 ──────────────────────────────────────────────────
  function getBattleOutcome() {
    const playerAlive = game.playerFormations.some(f =>
      !f.retreated && f.units.some(isUnitAlive));
    const enemyAlive  = game.enemyFormations.some(f =>
      !f.retreated && f.units.some(isUnitAlive));
    if (playerAlive && enemyAlive) return null;
    return { won: !enemyAlive };
  }

  function checkBattleEnd() {
    if (game.battlePhase !== "live") return;
    if (game.battleEndPending) return;
    const outcome = getBattleOutcome();
    if (!outcome) return;
    game.battleEndPending = true;
    game.battleEndTimer = 3.0;
    game.battleEndWon = outcome.won;
  }

  function updateBattleEndPending(dt) {
    if (!game.battleEndPending || game.battlePhase !== "live") return;
    game.battleEndTimer -= dt;
    if (game.battleEndTimer > 0) return;
    const finalOutcome = getBattleOutcome();
    game.battleEndPending = false;
    game.battleEndTimer = 0;
    game.battlePhase = "ended";
    showBattleResult(finalOutcome ? finalOutcome.won : game.battleEndWon);
  }

  // ── 시나리오 초기화 공통 ────────────────────────────────────────────
  function resetGameState() {
    game.battlePhase         = "planning";
    game.battleTime          = 0;
    game.simulationAccumulator = 0;
    game.speedMultiplier     = 1;
    game.aiTimer             = 0;
    game.enemyStrategy       = null;
    game.strategyTick        = 0;
    game.battleEndPending    = false;
    game.battleEndTimer      = 0;
    game.battleEndWon        = null;
    game.selectedId          = 0;
    game.projectiles         = [];
    game.traces              = [];
    game.fires               = [];
    game.flood               = null;
    game.hudRefreshAccumulator = 0;
    game.hudDirty            = true;
    game.speechEnemySighted  = new Set();
    speedToggleButton.classList.remove("active");
  }

  function applyScenario(terrain, playerFormations, enemyFormations) {
    game.terrain          = terrain;
    game.playerFormations = playerFormations;
    game.enemyFormations  = enemyFormations;
    game.terrainRender    = buildTerrainRenderData(terrain);
    invalidateTerrainChunkCache();
    resetGameState();
    savedTerrain        = terrain;
    savedPlayerGenerals = playerFormations.map(f => ({ ...f.general }));
    savedEnemyGenerals  = enemyFormations.map(f => ({ ...f.general }));
  }

  function rebuildFormations(terrain, pGens, eGens) {
    const pF = pGens.map((g, i) => {
      const gen = { ...g, kills: 0, losses: 0, alive: true };
      const f = createFormation(i, "player", gen,
        vec(terrain.playerStart.x, terrain.playerStart.y + (i - 2) * 10), vec(1, 0));
      f.skillType = normalizeSkillForGeneral(gen, g.skillType || f.skillType, gen.troopType);
      f.general.skillType = f.skillType;
      initializeFormationSlots(f, false);
      return f;
    });
    const eF = eGens.map((g, i) => {
      const gen = { ...g, kills: 0, losses: 0, alive: true };
      const f = createFormation(i, "enemy", gen,
        vec(terrain.enemyStart.x, terrain.enemyStart.y + (i - 2) * 10), vec(-1, 0));
      f.skillType = normalizeSkillForGeneral(gen, g.skillType || f.skillType, gen.troopType);
      f.general.skillType = f.skillType;
      initializeFormationSlots(f, false);
      return f;
    });
    return { playerFormations: pF, enemyFormations: eF };
  }

  // ── 빠른 전투 진입 ──────────────────────────────────────────────────
  function enterQuickBattle(isNew) {
    let terrain, pGens, eGens;
    if (isNew || !savedTerrain) {
      const scenario = buildScenario();
      terrain = scenario.terrain;
      pGens = scenario.playerFormations.map(f => ({ ...f.general }));
      eGens = scenario.enemyFormations.map(f => ({ ...f.general }));
    } else {
      terrain = savedTerrain;
      pGens   = savedPlayerGenerals.map(g => ({ ...g }));
      eGens   = savedEnemyGenerals.map(g => ({ ...g }));
    }
    const { playerFormations, enemyFormations } = rebuildFormations(terrain, pGens, eGens);
    applyScenario(terrain, playerFormations, enemyFormations);
    centerCameraOn(formationCenter(game.playerFormations[0]));
    setScreen("battle");
    refreshHud();
    refreshButtons();
  }

  // ── 병력 조정 화면 ──────────────────────────────────────────────────
  const TOTAL_TROOPS = POPULATION_BUDGET;

  function draftTroopType(side, index) {
    return normalizeTroopType(troopDraft[side].troopTypes[index]);
  }

  function draftPopulationTotal(side) {
    return troopDraft[side].troops.reduce((sum, troops, index) =>
      sum + troopPopulation(troops, draftTroopType(side, index)), 0);
  }

  function normalizeTroopDraftSide(side, preferredIndex = -1) {
    const draft = troopDraft[side].troops;
    for (let i = 0; i < draft.length; i += 1) {
      draft[i] = normalizeTroopsForType(draft[i], draftTroopType(side, i));
      troopDraft[side].skills[i] = normalizeSkillForGeneral(
        (side === "player" ? game.playerFormations : game.enemyFormations)[i].general,
        troopDraft[side].skills[i],
        draftTroopType(side, i)
      );
    }

    let guard = 0;
    while (draftPopulationTotal(side) > TOTAL_TROOPS && guard < 100000) {
      guard += 1;
      const candidates = draft.map((troops, index) => ({ index, troops, pop: troopPopulation(troops, draftTroopType(side, index)) }))
        .sort((a, b) => (a.index === preferredIndex ? 1 : b.index === preferredIndex ? -1 : b.pop - a.pop));
      const target = candidates.find(({ index, troops }) => troops > minTroopsForType(draftTroopType(side, index)));
      if (!target) break;
      draft[target.index] -= 1;
    }

    guard = 0;
    while (draftPopulationTotal(side) < TOTAL_TROOPS && guard < 100000) {
      guard += 1;
      const diff = TOTAL_TROOPS - draftPopulationTotal(side);
      const preferred = preferredIndex >= 0 ? [preferredIndex] : [];
      const order = [...preferred, ...draft.map((_, index) => index).filter(index => index !== preferredIndex)];
      const target = order.find(index => troopPopulationCost(draftTroopType(side, index)) <= diff);
      if (target === undefined) break;
      draft[target] += 1;
    }
  }

  function openTroopAdjust() {
    troopDraft.player.troops = game.playerFormations.map(f => f.general.troops);
    troopDraft.player.skills = game.playerFormations.map(f => normalizeSkillForGeneral(f.general, f.skillType, f.troopType));
    troopDraft.player.troopTypes = game.playerFormations.map(f => normalizeTroopType(f.troopType));
    troopDraft.enemy.troops  = game.enemyFormations.map(f => f.general.troops);
    troopDraft.enemy.skills  = game.enemyFormations.map(f => normalizeSkillForGeneral(f.general, f.skillType, f.troopType));
    troopDraft.enemy.troopTypes = game.enemyFormations.map(f => normalizeTroopType(f.troopType));
    normalizeTroopDraftSide("player");
    normalizeTroopDraftSide("enemy");
    renderTroopAdjustRows("player");
    renderTroopAdjustRows("enemy");
    setScreen("troopAdjust");
  }

  function renderTroopAdjustRows(side) {
    const isPlayer   = side === "player";
    const formations = isPlayer ? game.playerFormations : game.enemyFormations;
    const draft      = troopDraft[side].troops;
    const skillDraft = troopDraft[side].skills;
    const troopTypeDraft = troopDraft[side].troopTypes;
    const container  = document.getElementById(isPlayer ? "adjustPlayerRows" : "adjustEnemyRows");
    const totalEl    = document.getElementById(isPlayer ? "adjustPlayerTotal" : "adjustEnemyTotal");
    totalEl.textContent = `${draftPopulationTotal(side).toLocaleString()} / ${TOTAL_TROOPS.toLocaleString()}`;
    container.innerHTML = "";

    if (isPlayer) {
      // ── 아군: 카드 가로 배열 ──────────────────────────────────────
      formations.forEach((f, i) => {
        const troopType = draftTroopType(side, i);
        const typeInfo = troopTypeInfo(troopType);
        const otherMinPop = formations.reduce((sum, _f, index) =>
          index === i ? sum : sum + TROOP_MIN_POPULATION, 0);
        const maxVal = Math.max(minTroopsForType(troopType), Math.floor((TOTAL_TROOPS - otherMinPop) / typeInfo.populationCost));
        const popUsed = troopPopulation(draft[i], troopType);
        const pct    = (popUsed / TOTAL_TROOPS * 100).toFixed(1);

        const card = document.createElement("div");
        card.className = "adjust-card player-side";
        card.innerHTML =
          `<div class="adjust-card-name">${f.general.name}</div>` +
          `<div class="adjust-card-stats">` +
            `<div class="adjust-card-stat"><span>무력</span><strong>${f.general.power}</strong></div>` +
            `<div class="adjust-card-stat"><span>통솔</span><strong>${f.general.leadership}</strong></div>` +
            `<div class="adjust-card-stat"><span>매력</span><strong>${f.general.charm}</strong></div>` +
          `</div>` +
          `<div class="adjust-bar-bg"><div class="adjust-bar-fill player-fill" style="width:${pct}%"></div></div>` +
          `<div class="adjust-card-val">${draft[i].toLocaleString()} <span>명</span></div>` +
          `<div class="adjust-card-pop">인구 ${popUsed.toLocaleString()}</div>`;

        const typeGroup = document.createElement("div");
        typeGroup.className = "adjust-type-buttons";
        Object.entries(TROOP_TYPES).forEach(([type, info]) => {
          const typeButton = document.createElement("button");
          typeButton.type = "button";
          typeButton.className = "adjust-type-btn";
          typeButton.textContent = info.label;
          typeButton.dataset.active = type === troopType ? "true" : "false";
          typeButton.addEventListener("click", (event) => {
            event.currentTarget.blur();
            if (type === troopType) return;
            const oldPop = troopPopulation(draft[i], troopType);
            troopTypeDraft[i] = type;
            draft[i] = normalizeTroopsForType(Math.floor(oldPop / troopPopulationCost(type)), type);
            skillDraft[i] = normalizeSkillForGeneral(f.general, skillDraft[i], type);
            normalizeTroopDraftSide("player", i);
            renderTroopAdjustRows("player");
          });
          typeGroup.appendChild(typeButton);
        });

        const skillGroup = document.createElement("div");
        skillGroup.className = "adjust-skill-buttons";
        const allowedSkills = selectableSkills(f.general, troopType);
        allSkillButtons().forEach((skillType) => {
          const def = SKILL_DEF[skillType] || SKILL_DEF.kihap;
          const skillButton = document.createElement("button");
          skillButton.type = "button";
          skillButton.className = "adjust-skill-btn";
          skillButton.textContent = def.label;
          skillButton.disabled = !allowedSkills.includes(skillType);
          skillButton.dataset.active = skillType === skillDraft[i] ? "true" : "false";
          skillButton.addEventListener("click", (event) => {
            if (skillButton.disabled) return;
            event.currentTarget.blur();
            skillDraft[i] = normalizeSkillForGeneral(f.general, skillType, troopTypeDraft[i]);
            renderTroopAdjustRows("player");
          });
          skillGroup.appendChild(skillButton);
        });

        // 슬라이더
        const slider = document.createElement("input");
        slider.type = "range";
        slider.className = "adjust-slider";
        slider.min   = minTroopsForType(troopType);
        slider.max   = maxVal;
        slider.step  = 1;
        slider.value = draft[i];

        slider.addEventListener("input", () => {
          draft[i] = normalizeTroopsForType(parseInt(slider.value, 10), troopType);
          normalizeTroopDraftSide("player", i);
          renderTroopAdjustRows("player");
        });

        card.insertBefore(typeGroup, card.querySelector(".adjust-bar-bg"));
        card.insertBefore(skillGroup, card.querySelector(".adjust-bar-bg"));
        card.appendChild(slider);
        container.appendChild(card);
      });

    } else {
      // ── 적군: 컴팩트 한 줄 리스트 ────────────────────────────────
      formations.forEach((f, i) => {
        const skill = SKILL_DEF[skillDraft[i]] || SKILL_DEF.kihap;
        const troopType = draftTroopType(side, i);
        const row   = document.createElement("div");
        row.className = "adjust-enemy-row";
        row.innerHTML =
          `<span class="adjust-enemy-name">${f.general.name}</span>` +
          `<span class="adj-stat">무력&nbsp;<b>${f.general.power}</b></span>` +
          `<span class="adj-stat">통솔&nbsp;<b>${f.general.leadership}</b></span>` +
          `<span class="adj-stat">매력&nbsp;<b>${f.general.charm}</b></span>` +
          `<span class="adj-skill">${troopTypeInfo(troopType).label}</span>` +
          `<span class="adj-skill">${skill.icon}&nbsp;${skill.label}</span>` +
          `<span class="adjust-enemy-troop">${draft[i].toLocaleString()}</span>`;
        container.appendChild(row);
      });
    }
  }

  function applyTroopAdjust() {
    ["player", "enemy"].forEach(side => {
      const formations = side === "player" ? game.playerFormations : game.enemyFormations;
      formations.forEach((f, i) => {
        const newTroopType = draftTroopType(side, i);
        const newTroops = normalizeTroopsForType(troopDraft[side].troops[i], newTroopType);
        f.troopType = newTroopType;
        f.general.troopType = newTroopType;
        f.general.troops = newTroops;
        f.skillType = normalizeSkillForGeneral(f.general, troopDraft[side].skills[i], f.troopType);
        f.general.skillType = f.skillType;
        f.density = normalizeDensityForTroopType(f.troopType, f.density);
        f.skillCooldown = 0;
        f.swiftTimer = 0;
        f.archeryTimer = 0;
        f.guardTimer = 0;
        f.units = createFormationUnits(side, f.id, newTroops, f.anchor, f.facing);
        f.units.forEach(unit => { unit.visualFacingLeft = visualFacingLeftFromFormation(f); });
        initializeFormationSlots(f, false);
      });
    });
    savedPlayerGenerals = game.playerFormations.map(f => ({ ...f.general }));
    savedEnemyGenerals  = game.enemyFormations.map(f => ({ ...f.general }));
    setScreen("battle");
    game.hudDirty = true;
    refreshHud();
    refreshButtons();
  }

  // ── 전투 결과 화면 ──────────────────────────────────────────────────
  function showBattleResult(won) {
    const verdict = document.getElementById("resultVerdict");
    verdict.textContent = won ? "승 리" : "패 배";
    verdict.className   = `result-verdict ${won ? "victory" : "defeat"}`;

    document.getElementById("resultTime").textContent =
      game.battleTime.toFixed(1);

    const fillTable = (tbodyEl, formations) => {
      tbodyEl.innerHTML = "";
      formations.forEach(f => {
        const alive = formationRemainingTroops(f);
        const tr = document.createElement("tr");
        tr.innerHTML =
          `<td>${f.general.name}</td>` +
          `<td>${formatTroops(f.general.kills)}</td>` +
          `<td>${formatTroops(f.general.losses)}</td>` +
          `<td>${formatTroops(alive)}</td>`;
        tbodyEl.appendChild(tr);
      });
    };

    fillTable(
      document.querySelector("#resultPlayerTable tbody"),
      game.playerFormations
    );
    fillTable(
      document.querySelector("#resultEnemyTable tbody"),
      game.enemyFormations
    );

    const pRemain = game.playerFormations.reduce(
      (s, f) => s + formationRemainingTroops(f), 0);
    const eRemain = game.enemyFormations.reduce(
      (s, f) => s + formationRemainingTroops(f), 0);
    document.getElementById("resultPlayerRemaining").textContent =
      formatTroops(pRemain);
    document.getElementById("resultEnemyRemaining").textContent =
      formatTroops(eRemain);

    setScreen("battleResult");
  }

  // ── 새 화면 이벤트 핸들러 ────────────────────────────────────────────
  // 홈: 빠른 전투
  document.getElementById("menuQuickBattle").addEventListener("click", () => {
    enterQuickBattle(true);
  });

  // 홈: 준비 중 메뉴
  let toastTimer = null;
  document.querySelectorAll(".wip-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const toast = document.getElementById("homeToast");
      toast.hidden = false;
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { toast.hidden = true; }, 2200);
    });
  });

  // 전투 화면: 병력 조정
  troopAdjustBtn.addEventListener("click", () => {
    if (game.battlePhase === "live") return;
    openTroopAdjust();
  });

  // 병력 조정: 적용
  document.getElementById("adjustApply").addEventListener("click", applyTroopAdjust);

  // 병력 조정: 취소
  document.getElementById("adjustCancel").addEventListener("click", () => {
    setScreen("battle");
  });

  // 결과 화면: 같은 조건 재전투
  document.getElementById("resultReplay").addEventListener("click", () => {
    const { playerFormations, enemyFormations } =
      rebuildFormations(savedTerrain, savedPlayerGenerals, savedEnemyGenerals);
    applyScenario(savedTerrain, playerFormations, enemyFormations);
    centerCameraOn(formationCenter(game.playerFormations[0]));
    setScreen("battle");
    refreshHud();
    refreshButtons();
  });

  // 결과 화면: 새로운 전투
  document.getElementById("resultNewBattle").addEventListener("click", () => {
    enterQuickBattle(true);
  });

  // 결과 화면: 홈 화면
  document.getElementById("resultHome").addEventListener("click", () => {
    setScreen("home");
  });

  function start() {
    const first = game.playerFormations[0];
    centerCameraOn(formationCenter(first));
    refreshHud();
    refreshButtons();
    // 초기 저장
    savedTerrain        = game.terrain;
    savedPlayerGenerals = game.playerFormations.map(f => ({ ...f.general }));
    savedEnemyGenerals  = game.enemyFormations.map(f => ({ ...f.general }));
    setScreen("home");
    requestAnimationFrame(tick);
  }

  initPixi(); // 비동기 — pixiReady가 true가 되면 WebGL 렌더러 활성화
  start();
})();
