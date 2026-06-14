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
import { OnlineClient } from './src/netcode.js';
import { initRng, random as seededRandom, resetRng } from './src/prng.js';

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
  const PIXI_TREE_SPRITES = false; // true: 나무를 PixiJS Y정렬 스프라이트로 처리, false: 캔버스에 직접 렌더링
  const SIMULATION_STEP = 1 / 30;
  const MAX_SIMULATION_STEPS = 4;
  const ONLINE_CATCHUP_CHUNK_STEPS = 180;
  const ONLINE_MAX_INLINE_CATCHUP_STEPS = 12;
  const ONLINE_CHECKSUM_INTERVAL_TICKS = 300;
  const SPATIAL_CELL_SIZE = 4;
  const UNIT_RADIUS = 0.27;
  const TILE_W_MIN = 16;
  const TILE_W_MAX = 24;
  const DEFAULT_TILE_W = 24;
  const ZOOM_LEVELS       = [16, 20, 24];
  const TOUCH_ZOOM_LEVELS = [12, 14, 16];
  const PANEL_WIDTH = 300;
  const NAME_POOL = [
    "관우", "장비", "조조", "유비", "제갈량", "사마의", "손권", "주유", "여포", "조운",
    "마초", "장료", "허저",
    "이순신", "강감찬", "을지문덕", "계백", "김유신", "연개소문", "최영", "이성계",
    "오다노부나가", "도요토미히데요시", "도쿠가와이에야스", "다케다신겐", "우에스기겐신",
    "한니발", "카이사르", "나폴레옹", "살라딘", "아틸라", "샤를마뉴", "잔다르크", "티무르"
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
      meleeDefenseMult: 2.0,
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
  const endBattleBtn = document.getElementById("endBattleBtn");
  const speedToggleButton = document.getElementById("speedToggleButton");
  const troopAdjustBtn = document.getElementById("troopAdjustBtn");
  const battleLoadingMask = document.getElementById("battleLoadingMask");
  const topbarEl = document.querySelector(".topbar");
  const topbarToggleBtn = document.getElementById("topbarToggleBtn");
  const pauseOverlay    = document.getElementById("pauseOverlay");
  const mobileKihapBtn   = document.getElementById("mobileKihapBtn");
  const mobileKihapFill  = document.getElementById("mobileKihapFill");
  const mobileKihapIcon  = document.getElementById("mobileKihapIcon");
  const mobileKihapLabel = document.getElementById("mobileKihapLabel");
  const msMeleeAtk  = document.getElementById("msMeleeAtk");
  const msMeleeDef  = document.getElementById("msMeleeDef");
  const msRangedAtk = document.getElementById("msRangedAtk");
  const msRangedDef = document.getElementById("msRangedDef");

  const isMobile = () => window.innerWidth < 950;

  function setTopbarCollapsed(collapsed) {
    topbarEl.classList.toggle("topbar--collapsed", collapsed);
    topbarToggleBtn.textContent = collapsed ? "☰" : "✕";
  }

  topbarToggleBtn.addEventListener("click", () => {
    if (isMobile()) {
      setPaused(!game.paused);
    } else {
      setTopbarCollapsed(!topbarEl.classList.contains("topbar--collapsed"));
    }
  });

  function setPaused(paused) {
    if (isOnlineMode()) paused = false;
    game.paused = paused;
    pauseOverlay.hidden = !paused;
    if (paused) { syncPauseSpeedBtns(); syncPauseCtrlBtns(); }
  }

  function syncPauseSpeedBtns() {
    const speed1x = document.getElementById("pauseSpeed1x");
    const speed2x = document.getElementById("pauseSpeed2x");
    if (isOnlineMode()) game.speedMultiplier = 1;
    speed1x.classList.toggle("active", game.speedMultiplier === 1);
    speed2x.classList.toggle("active", game.speedMultiplier === 2);
    speed2x.hidden = isOnlineMode();
  }

  function setControlType(type) {
    game.controlType = type;
    // 터치 → 마우스 전환 시 줌 레벨 보정
    if (type === 'mouse' && !ZOOM_LEVELS.includes(game.tileW)) {
      game.tileW = ZOOM_LEVELS[0];
      invalidateTerrainChunkCache();
    }
    syncPauseCtrlBtns();
  }

  function syncPauseCtrlBtns() {
    document.getElementById("pauseCtrlMouse").classList.toggle("active", game.controlType === 'mouse');
    document.getElementById("pauseCtrlTouch").classList.toggle("active", game.controlType === 'touch');
  }

  document.getElementById("pauseCtrlMouse").addEventListener("click", () => setControlType('mouse'));
  document.getElementById("pauseCtrlTouch").addEventListener("click", () => setControlType('touch'));

  document.getElementById("pauseResumeBtn").addEventListener("click", () => setPaused(false));

  document.getElementById("pauseRestartBtn").addEventListener("click", () => {
    setPaused(false);
    enterQuickBattle(true);
  });

  document.getElementById("pauseEndBtn").addEventListener("click", () => {
    setPaused(false);
    setScreen("home");
  });

  document.getElementById("pauseSpeed1x").addEventListener("click", () => {
    game.speedMultiplier = 1;
    syncPauseSpeedBtns();
  });

  document.getElementById("pauseSpeed2x").addEventListener("click", () => {
    if (isOnlineMode()) return;
    game.speedMultiplier = 2;
    syncPauseSpeedBtns();
  });

  // 하이브리드 기기: 첫 터치 시 자동으로 터치 모드 전환
  window.addEventListener("touchstart", () => {
    if (game.controlType !== 'touch') setControlType('touch');
  }, { passive: true, once: false });

  function isEscapeKey(event) {
    return event.key === "Escape" || event.key === "Esc" || event.code === "Escape" ||
      event.keyCode === 27 || event.which === 27;
  }

  document.addEventListener("keydown", (e) => {
    if (!isEscapeKey(e)) return;
    if (appShell.hidden) return;
    if (game.battlePhase !== "live") return;
    const tag = e.target?.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
    e.preventDefault();
    e.stopPropagation();
    setPaused(!game.paused);
  }, true);
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
  const scenarioSelectScreen = document.getElementById("scenarioSelectScreen");
  const scenarioSelectGrid = document.getElementById("scenarioSelectGrid");
  const scenarioSelectBackBtn = document.getElementById("scenarioSelectBackBtn");
  const onlineScreen = document.getElementById("onlineScreen");
  const onlineBackBtn = document.getElementById("onlineBackBtn");
  const onlineProfile = document.getElementById("onlineProfile");
  const onlineAuthForm = document.getElementById("onlineAuthForm");
  const onlineUsername = document.getElementById("onlineUsername");
  const onlinePassword = document.getElementById("onlinePassword");
  const onlineDisplayName = document.getElementById("onlineDisplayName");
  const onlineLoginBtn = document.getElementById("onlineLoginBtn");
  const onlineRegisterBtn = document.getElementById("onlineRegisterBtn");
  let onlineLogoutBtn = document.getElementById("onlineLogoutBtn");
  const onlineCommanders = document.getElementById("onlineCommanders");
  const onlineMatchStatus = document.getElementById("onlineMatchStatus");
  const onlineResultSummary = document.getElementById("onlineResultSummary");
  const onlineRecentMatches = document.getElementById("onlineRecentMatches");
  const onlineLeaderboard = document.getElementById("onlineLeaderboard");
  const onlineQueueBtn = document.getElementById("onlineQueueBtn");
  const onlineLeaveQueueBtn = document.getElementById("onlineLeaveQueueBtn");
  const onlineProfileEditOverlay = document.getElementById("onlineProfileEditOverlay");
  const onlineProfileEditName = document.getElementById("onlineProfileEditName");
  const onlineProfileEditEmblemGrid = document.getElementById("onlineProfileEditEmblemGrid");
  const onlineProfileEditStatus = document.getElementById("onlineProfileEditStatus");
  const onlineProfileEditSaveBtn = document.getElementById("onlineProfileEditSaveBtn");
  const onlineProfileEditCancelBtn = document.getElementById("onlineProfileEditCancelBtn");
  let onlineProfileEditSelectedEmblem = null;
  let onlineSaveLoadoutBtn = null;
  let onlineGoMatchBtn = null;
  let onlineRecordsBtn = null;
  let onlineProfileEditBtn = null;
  let onlineRecordsBackBtn = null;
  let onlineMatchLogoutBtn = null;
  let onlineBackToCommandersBtn = null;
  let onlineReadyBtn = null;
  let onlineMatchRoster = null;
  let onlineMatchPlayerInfo = null;
  let onlineOpponentPreview = null;
  let onlineAuthStatus = null;
  let onlineCommanderPool = null;
  const onlineSyncNotice = document.getElementById("onlineSyncNotice");
  const enemyTargetTooltip = document.getElementById("enemyTargetTooltip");
  const enemyTargetNameEl = document.getElementById("enemyTargetName");
  const enemyTargetBarTrack = document.getElementById("enemyTargetBarTrack");
  const enemyTargetBarFill = document.getElementById("enemyTargetBarFill");
  const troopAdjustScreen  = document.getElementById("troopAdjustScreen");
  const battleResultScreen = document.getElementById("battleResultScreen");
  const appShell           = document.getElementById("appShell");
  const homeBg             = document.querySelector(".home-bg");
  const gameLoadingScreen  = document.getElementById("gameLoadingScreen");
  const gameLoadingBg      = document.getElementById("gameLoadingBg");
  const gameLoadingProgressBar = document.getElementById("gameLoadingProgressBar");
  const gameLoadingScenarioProgressBar = document.getElementById("gameLoadingScenarioProgressBar");
  const gameLoadingScenarioPanel   = document.getElementById("gameLoadingScenarioPanel");
  const gameLoadingPanelTitle      = document.getElementById("gameLoadingPanelTitle");
  const gameLoadingPanelEra        = document.getElementById("gameLoadingPanelEra");
  const gameLoadingPlayerFactionIcon = document.getElementById("gameLoadingPlayerFactionIcon");
  const gameLoadingPlayerForceName = document.getElementById("gameLoadingPlayerForceName");
  const gameLoadingPlayerForcePeriod = document.getElementById("gameLoadingPlayerForcePeriod");
  const gameLoadingEnemyFactionIcon  = document.getElementById("gameLoadingEnemyFactionIcon");
  const gameLoadingEnemyForceName  = document.getElementById("gameLoadingEnemyForceName");
  const gameLoadingEnemyForcePeriod = document.getElementById("gameLoadingEnemyForcePeriod");
  const gameLoadingPlayerRoster    = document.getElementById("gameLoadingPlayerRoster");
  const gameLoadingEnemyRoster     = document.getElementById("gameLoadingEnemyRoster");
  const menuOnlineBattle = document.getElementById("menuOnlineBattle");
  const menuHistoricalScenario = document.getElementById("menuHistoricalScenario");
  const scenarioHud = document.getElementById("scenarioHud");
  const scenarioTitle = document.getElementById("scenarioTitle");
  const scenarioObjectives = document.getElementById("scenarioObjectives");
  const scenarioDialogue = document.getElementById("scenarioDialogue");
  const scenarioDialoguePortrait = document.getElementById("scenarioDialoguePortrait");
  const scenarioDialogueSpeaker = document.getElementById("scenarioDialogueSpeaker");
  const scenarioDialogueText = document.getElementById("scenarioDialogueText");
  const scenarioNextBtn = document.getElementById("scenarioNextBtn");
  const scenarioBriefing = document.getElementById("scenarioBriefing");
  const scenarioBriefingTitle = document.getElementById("scenarioBriefingTitle");
  const scenarioBriefingText = document.getElementById("scenarioBriefingText");
  const scenarioStartPhaseBtn = document.getElementById("scenarioStartPhaseBtn");

  // 현재 앱 상태: "home" | "battle" | "troopAdjust" | "battleResult"
  let appState = "home";
  const onlineClient = new OnlineClient();
  let onlineSyncNoticeTimer = null;
  let onlineCatchupScheduled = false;
  let onlineLastResult = null;
  let onlinePage = "auth";
  let onlinePreviousPage = "commanders";
  let onlineLoadoutDraft = [];
  let onlinePendingMatch = null;
  let onlineReadySides = [];
  let onlineRematchAfterCancel = false;
  let onlineReturnToCommandersAfterCancel = false;
  const pendingInviteCode = new URLSearchParams(location.search).get("invite") || null;
  let onlineInvitePanel = null;

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
    if (scenarioSelectScreen) scenarioSelectScreen.hidden = (state !== "scenarioSelect");
    if (onlineScreen) onlineScreen.hidden = (state !== "online");
    troopAdjustScreen.hidden  = (state !== "troopAdjust");
    battleResultScreen.hidden = (state !== "battleResult");
    appShell.hidden           = (state === "home" || state === "scenarioSelect" || state === "online");
    if (state !== "battle") hideOnlineSyncNotice();
    if (state === "battle") cameraYOffset = 150 - canvas.clientHeight / 2;
    updateBattleLoadingMask();
  }

  // LQIP: 20px 너비 썸네일 base64 (홈 배경)
  const LQIP_BG = {
    'main.jpg':  'data:image/jpeg;base64,/9j/2wBDABsSFBcUERsXFhceHBsgKEIrKCUlKFE6PTBCYFVlZF9VXVtqeJmBanGQc1tdhbWGkJ6jq62rZ4C8ybqmx5moq6T/2wBDARweHigjKE4rK06kbl1upKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKT/wAARCAALABQDASIAAhEBAxEB/8QAGAAAAwEBAAAAAAAAAAAAAAAAAAIDBAX/xAAdEAACAgIDAQAAAAAAAAAAAAABAgARIUEDEjFR/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAL/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwDhAr2ycVqVReMmyxA+1M2xH8Vq1JUozKrULIhEUWATkwgf/9k=',
    'main1.jpg': 'data:image/jpeg;base64,/9j/2wBDABsSFBcUERsXFhceHBsgKEIrKCUlKFE6PTBCYFVlZF9VXVtqeJmBanGQc1tdhbWGkJ6jq62rZ4C8ybqmx5moq6T/2wBDARweHigjKE4rK06kbl1upKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKT/wAARCAALABQDASIAAhEBAxEB/8QAGAAAAwEBAAAAAAAAAAAAAAAAAAIDBAX/xAAcEAEAAwACAwAAAAAAAAAAAAABAAIRAyESMUH/xAAVAQEBAAAAAAAAAAAAAAAAAAACAf/EABYRAQEBAAAAAAAAAAAAAAAAAAABEf/aAAwDAQACEQMRAD8A4fHaq4uy6cJRe9mKr3GvZ9b1DYUpldfEE+QkthLg6//Z',
  };

  function applyRandomHomeBackground() {
    if (!homeBg) return;
    const backgrounds = [
      "./assets/background/main.jpg",
      "./assets/background/main1.jpg",
    ];
    const selected = backgrounds[Math.floor(Math.random() * backgrounds.length)];
    const key = selected.split('/').pop();
    const grad = 'linear-gradient(90deg, rgba(0,0,0,0.45), rgba(0,0,0,0.08))';
    const lqip = LQIP_BG[key];

    if (lqip) {
      // 즉시 LQIP 표시 (transition 없이 블러 적용)
      homeBg.style.transition = 'none';
      homeBg.style.backgroundImage = `${grad}, url('${lqip}')`;
      homeBg.style.filter = 'blur(8px)';
      homeBg.style.transform = 'scale(1.05)';
    }

    const img = new Image();
    img.onload = () => {
      homeBg.style.backgroundImage = `${grad}, url('${selected}')`;
      // 다음 페인트 사이클부터 부드럽게 블러 해제
      requestAnimationFrame(() => {
        homeBg.style.transition = 'filter 0.8s ease, transform 0.8s ease';
        homeBg.style.filter = '';
        homeBg.style.transform = '';
      });
    };
    img.src = selected;
  }

  applyRandomHomeBackground();

  const HISTORICAL_SCENARIOS = [
    {
      id: "gaugamela",
      no: "01",
      title: "망치와 모루 - 가우가멜라 전투",
      year: "BC 331",
      icon: 1,
      enabled: true
    },
    {
      id: "cannae",
      no: "02",
      title: "포위 - 칸나에 전투",
      year: "BC 216",
      icon: 0,
      enabled: true
    },
    {
      id: "bomangpa",
      no: "03",
      title: "매복 - 박망파 전투",
      year: "AD 202",
      icon: 2,
      enabled: true
    },
    {
      id: "kalka",
      no: "04",
      title: "거짓 후퇴 - 칼카강 전투",
      year: "AD 1223",
      icon: 3,
      enabled: false
    },
    {
      id: "gwiju",
      no: "05",
      title: "수공 - 귀주 대첩",
      year: "AD 1018",
      icon: 4,
      enabled: true
    },
    {
      id: "jupil",
      no: "06",
      title: "우회 - 주필산 전투",
      year: "AD 645",
      icon: 5,
      enabled: true
    },
    {
      id: "yiling",
      no: "07",
      title: "화공 - 이릉 대첩",
      year: "AD 222",
      icon: 6,
      enabled: false
    },
    {
      id: "tours",
      no: "08",
      title: "방진 - 투르 푸아티에 전투",
      year: "AD 732",
      icon: 1,
      enabled: false
    }
  ];

  function historicalScenarioIconSrc(id) {
    const scenario = HISTORICAL_SCENARIOS.find(item => item.id === id);
    const iconIndex = Number.isInteger(scenario?.icon) ? scenario.icon : 0;
    return `./assets/ui/${String(iconIndex + 1).padStart(2, '0')}.jpg`;
  }

  const SCENARIO_LOADING_META = {
    gaugamela: {
      title: "가우가멜라 전투",
      era: "BC 331",
      player: "마케도니아",
      playerPeriod: "BC 808 – BC 168",
      enemy: "페르시아",
      enemyPeriod: "BC 550 – BC 330",
      background: "./assets/background/scenario_maps/gaugamela_map.png",
      playerFactionIcon: "./assets/factions/macedon.png",
      enemyFactionIcon: "./assets/factions/persia.png"
    },
    cannae: {
      title: "칸나에 전투",
      era: "BC 216",
      player: "카르타고",
      playerPeriod: "BC 814 – BC 146",
      enemy: "로마",
      enemyPeriod: "BC 753 – AD 476",
      background: "./assets/background/scenario_maps/cannae_map.png",
      playerFactionIcon: "./assets/factions/carthage.png",
      enemyFactionIcon: "./assets/factions/rome.png"
    },
    bomangpa: {
      title: "박망파 전투",
      era: "AD 202",
      player: "촉",
      playerPeriod: "AD 221 – AD 263",
      enemy: "위",
      enemyPeriod: "AD 220 – AD 265",
      background: "./assets/background/scenario_maps/bomangpa_map.png",
      playerFactionIcon: "./assets/factions/shu_han.png",
      enemyFactionIcon: "./assets/factions/cao_wei.png"
    },
    gwiju: {
      title: "귀주대첩",
      era: "AD 1019",
      player: "고려",
      playerPeriod: "AD 918 – AD 1392",
      enemy: "거란",
      enemyPeriod: "AD 916 – AD 1125",
      background: "./assets/background/scenario_maps/gwiju_map.png",
      playerFactionIcon: "./assets/factions/goryeo.png",
      enemyFactionIcon: "./assets/factions/khitan.png"
    },
    jupil: {
      title: "주필산 전투",
      era: "AD 645",
      player: "당",
      playerPeriod: "AD 618 – AD 907",
      enemy: "고구려",
      enemyPeriod: "BC 37 – AD 668",
      background: "./assets/background/scenario_maps/jupil_map.png",
      playerFactionIcon: "./assets/factions/tang.png",
      enemyFactionIcon: "./assets/factions/goguryeo.png"
    }
  };

  const FACTION_EMBLEM_OPTIONS = [
    { id: "macedon", label: "마케도니아", icon: "./assets/factions/macedon.png" },
    { id: "persia", label: "페르시아", icon: "./assets/factions/persia.png" },
    { id: "carthage", label: "카르타고", icon: "./assets/factions/carthage.png" },
    { id: "rome", label: "로마", icon: "./assets/factions/rome.png" },
    { id: "shu_han", label: "촉", icon: "./assets/factions/shu_han.png" },
    { id: "cao_wei", label: "위", icon: "./assets/factions/cao_wei.png" },
    { id: "goryeo", label: "고려", icon: "./assets/factions/goryeo.png" },
    { id: "khitan", label: "거란", icon: "./assets/factions/khitan.png" },
    { id: "tang", label: "당", icon: "./assets/factions/tang.png" },
    { id: "goguryeo", label: "고구려", icon: "./assets/factions/goguryeo.png" },
  ];

  function factionEmblemOption(emblemId) {
    return FACTION_EMBLEM_OPTIONS.find((option) => option.id === emblemId) || FACTION_EMBLEM_OPTIONS[0];
  }

  function randomFactionEmblemId() {
    const index = Math.floor(Math.random() * FACTION_EMBLEM_OPTIONS.length);
    return FACTION_EMBLEM_OPTIONS[index].id;
  }

  function factionEmblemMarkup(emblemId, className = "online-profile-emblem") {
    const option = factionEmblemOption(emblemId);
    return `<img class="${className}" src="${option.icon}" alt="${escapeHtml(option.label)}" />`;
  }

  function historicalScenarioClearIds() {
    if (!onlineClient.token || !Array.isArray(onlineClient.player?.scenarioClears)) return new Set();
    return new Set(onlineClient.player.scenarioClears.map((clear) =>
      typeof clear === "string" ? clear : (clear.scenarioId || clear.scenario_id || clear.id)
    ).filter(Boolean));
  }

  async function refreshHistoricalScenarioClears() {
    if (!onlineClient.token) return;
    try {
      await onlineClient.loadMe();
    } catch (error) {
      console.warn("[online] scenario clear list refresh failed", error);
    }
  }

  function renderScenarioSelect() {
    if (!scenarioSelectGrid) return;
    scenarioSelectGrid.innerHTML = "";
    const clearIds = historicalScenarioClearIds();
    HISTORICAL_SCENARIOS.forEach((scenario) => {
      const cleared = clearIds.has(scenario.id);
      const card = document.createElement("article");
      card.className = "scenario-card";
      card.dataset.enabled = scenario.enabled ? "true" : "false";
      card.dataset.cleared = cleared ? "true" : "false";
      card.dataset.icon = String(scenario.icon);
      if (scenario.enabled) {
        card.tabIndex = 0;
        card.setAttribute("role", "button");
        card.addEventListener("click", () => enterHistoricalScenario(scenario.id));
        card.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            enterHistoricalScenario(scenario.id);
          }
        });
      }

      const top = document.createElement("div");
      top.className = "scenario-card-top";
      const index = document.createElement("div");
      index.className = "scenario-card-index";
      index.textContent = `MISSION ${scenario.no}`;
      const status = document.createElement("div");
      status.className = "scenario-card-status";
      status.textContent = scenario.year;
      top.append(index, status);

      const icon = document.createElement("div");
      icon.className = "scenario-card-icon scenario-icon-loading";
      const fullSrc = `./assets/ui/${String(scenario.icon + 1).padStart(2, '0')}.jpg`;
      const imgLoader = new Image();
      imgLoader.onload = () => {
        icon.classList.remove("scenario-icon-loading");
        icon.style.transition = 'opacity 0.4s ease';
        icon.style.opacity = '0';
        icon.style.backgroundImage = `url('${fullSrc}')`;
        requestAnimationFrame(() => requestAnimationFrame(() => {
          icon.style.opacity = '';
        }));
      };
      imgLoader.src = fullSrc;
      if (cleared) {
        const clearedIcon = document.createElement("img");
        clearedIcon.className = "scenario-card-cleared-icon";
        clearedIcon.src = "./assets/ui/scenario_cleared_icon.png";
        clearedIcon.alt = "";
        clearedIcon.setAttribute("aria-hidden", "true");
        clearedIcon.draggable = false;
        icon.appendChild(clearedIcon);
      }

      const title = document.createElement("h3");
      title.className = "scenario-card-title";
      title.textContent = scenario.title;

      card.append(top, icon, title);
      scenarioSelectGrid.appendChild(card);
    });
  }

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
    } else if (appState === "battle" && areGameAssetsReady()) {
      hideBattleLoadingMask();
    }
    tryHideGameLoadingScreen();
  }

  let _gameLoadingHideTimer = null;
  let _gameLoadingMinElapsed = false;

  function applyGameLoadingScenarioMeta(meta = null) {
    if (!gameLoadingScreen || !gameLoadingBg || !gameLoadingScenarioPanel) return;
    const setFactionIcon = (iconEl, src, label) => {
      if (!iconEl) return;
      if (!src) {
        iconEl.hidden = true;
        iconEl.removeAttribute("src");
        iconEl.alt = "";
        return;
      }
      iconEl.hidden = false;
      iconEl.src = src;
      iconEl.alt = label || "";
    };
    if (!meta) {
      gameLoadingScreen.classList.remove("is-scenario");
      gameLoadingScenarioPanel.hidden = true;
      setFactionIcon(gameLoadingPlayerFactionIcon, null, "");
      setFactionIcon(gameLoadingEnemyFactionIcon, null, "");
      return;
    }
    gameLoadingScreen.classList.add("is-scenario");
    gameLoadingScenarioPanel.hidden = false;
    gameLoadingBg.style.backgroundImage = "none";
    if (gameLoadingPanelTitle) gameLoadingPanelTitle.textContent = meta.title;
    if (gameLoadingPanelEra) gameLoadingPanelEra.textContent = meta.era;
    setFactionIcon(gameLoadingPlayerFactionIcon, meta.playerFactionIcon, meta.player);
    if (gameLoadingPlayerForceName) gameLoadingPlayerForceName.textContent = meta.player;
    if (gameLoadingPlayerForcePeriod) gameLoadingPlayerForcePeriod.textContent = meta.playerPeriod || "";
    setFactionIcon(gameLoadingEnemyFactionIcon, meta.enemyFactionIcon, meta.enemy);
    if (gameLoadingEnemyForceName) gameLoadingEnemyForceName.textContent = meta.enemy;
    if (gameLoadingEnemyForcePeriod) gameLoadingEnemyForcePeriod.textContent = meta.enemyPeriod || "";
    if (gameLoadingPlayerRoster) gameLoadingPlayerRoster.innerHTML = "";
    if (gameLoadingEnemyRoster) gameLoadingEnemyRoster.innerHTML = "";
  }

  function gameLoadingPortraitMarkup(commander) {
    if (commander?.portrait) {
      return `<div class="gl-roster-portrait"><img src="${escapeHtml(commander.portrait)}" alt="${escapeHtml(commander.name || "")}" loading="eager" decoding="async" /></div>`;
    }
    return `<div class="gl-roster-portrait">${escapeHtml((commander?.name || "?").slice(0, 1))}</div>`;
  }

  function updateGameLoadingScenarioRoster(playerFormations, enemyFormations) {
    if (!gameLoadingScenarioPanel || gameLoadingScenarioPanel.hidden) return;
    const cardMarkup = (formations = []) => formations.map(f => {
      const gen = f.general || f || {};
      const troopLabel = troopTypeInfo(gen.troopType)?.label || gen.troopType || "";
      const troops = formatTroops(gen.troops || 0);
      return `
        <div class="gl-roster-card">
          ${gameLoadingPortraitMarkup(gen)}
          <div class="gl-roster-name">${escapeHtml(gen.name || "")}</div>
          <div class="gl-roster-troop">${escapeHtml(troopLabel)} ${troops}</div>
        </div>
      `;
    }).join("");
    if (gameLoadingPlayerRoster) {
      gameLoadingPlayerRoster.innerHTML = cardMarkup(playerFormations);
    }
    if (gameLoadingEnemyRoster) {
      gameLoadingEnemyRoster.innerHTML = cardMarkup(enemyFormations);
    }
  }

  function showGameLoadingScreen(meta = null) {
    _gameLoadingMinElapsed = false;
    if (_gameLoadingHideTimer) { clearTimeout(_gameLoadingHideTimer); _gameLoadingHideTimer = null; }
    if (meta) {
      applyGameLoadingScenarioMeta(meta);
    } else {
      applyGameLoadingScenarioMeta(null);
      const bgKeys = Object.keys(LQIP_BG);
      const bgKey = bgKeys[Math.floor(Math.random() * bgKeys.length)];
      gameLoadingBg.style.backgroundImage = `url('./assets/background/${bgKey}')`;
    }
    gameLoadingScreen.style.display = "flex";
    const minLoadingMs = meta ? 5000 : 2000;
    [gameLoadingProgressBar, gameLoadingScenarioProgressBar].forEach((bar) => {
      if (!bar) return;
      bar.style.setProperty("--game-loading-duration", `${minLoadingMs}ms`);
      bar.classList.remove("is-running");
      void bar.offsetWidth;
      bar.classList.add("is-running");
    });
    _gameLoadingHideTimer = setTimeout(() => {
      _gameLoadingHideTimer = null;
      _gameLoadingMinElapsed = true;
      tryHideGameLoadingScreen();
    }, minLoadingMs);
  }

  function tryHideGameLoadingScreen() {
    if (gameLoadingScreen.style.display === "none") return;
    if (!_gameLoadingMinElapsed) return;
    if (!areGameAssetsReady()) return;
    gameLoadingScreen.style.display = "none";
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
  const WORLD_TEX = "./assets/terrain_world_textures/";
  const CLUSTER_TEX = "./assets/terrain_cluster_overlays/";
  const TERRAIN_WORLD_TEXTURE_SCALE = 0.78375; // 512px 소스 기준 (구 1254px × 0.32 = 401px 동일 반복)
  const TERRAIN_WORLD_TONE_FILTERS = {
    plain: "saturate(92%)",
    road: "saturate(110%)",
  };
  const TERRAIN_1X1_MASK_ENABLED = true;
  const TERRAIN_CLUSTER_ENABLED = false;
  const TERRAIN_DETAIL_PATCH_ENABLED = true;
  const TERRAIN_DETAIL_PATCH_OPACITY = 0.44;
  const TERRAIN_DETAIL_PATCH_BASE_DRAW_TILES = 3.35;
  const TERRAIN_CLUSTER_BASE_DRAW_TILES = 4.4;
  const TERRAIN_CLUSTER_BASE_ASSET_WIDTH = 360;
  const RUGGED_MTN_SIZE = 8;

  const terrainSprites = { tiles: {}, masks: {}, dirt: [], plainGrass: [], forestFloor: [], world: {}, clusters: [], objects: [], buildings: [], tree: null, trees: [], ruggedMtn: [], ready: false };
  const TERRAIN_CLUSTER_DEFS = [
    { file: "meadow_patch_00.png",      terrain: ["grassland"],          alpha: 0.48, scale: 1.00 },
    { file: "dark_grass_patch_00.png",  terrain: [],                     alpha: 0.42, scale: 1.03 },
    { file: "dry_grass_patch_00.png",   terrain: ["plain"],              alpha: 0.46, scale: 0.95 },
    { file: "bare_soil_patch_00.png",   terrain: ["plain"],              alpha: 0.40, scale: 0.90 },
    { file: "farm_rows_patch_00.png",   terrain: [],                     alpha: 0.34, scale: 1.08 },
    { file: "mixed_scrub_patch_00.png", terrain: ["grassland"],          alpha: 0.43, scale: 0.98 },
  ];
  const TERRAIN_DETAIL_PATCH_INDICES = {
    plain: [2, 3, 2, 3, 0],
    grassland: [0, 5],
    mountain: [0, 5],
  };
  const TREE_VARIANT_FILES = [
    "conifer_dark_00.png",
    "conifer_blue_00.png",
    "evergreen_tall_00.png",
    "pine_sparse_00.png",
    "broadleaf_light_00.png",
    "broadleaf_dark_00.png",
    "broadleaf_yellow_00.png",
    "shrub_tree_00.png",
  ];
  const TREE_VARIANT_DIR = "objects/trees/variants_50px";
  const TREE_VARIANT_HEIGHT_SCALE = [1.08, 1.05, 1.12, 1.00, 1.06, 1.08, 1.03, 0.78];
  const TREE_TONE_BRIGHTNESS = 0.86;
  const TREE_TONE_SATURATION = 0.78;
  const TREE_TONE_ALPHA = 0.92;
  const TREE_PIXI_TINT = 0xd0d4c0;
  const TERRAIN_TREE_RENDER_ENABLED = true;

  // ── 화공 스프라이트시트 ───────────────────────────────────────────────
  const fireSprite = new Image();
  fireSprite.src = './assets/terrain_tiles_v3/objects/fire_spritesheet.png';
  const FIRE_COLS = 4, FIRE_ROWS = 4, FIRE_FRAMES = 16;
  const remainsSprites = Array.from({ length: 6 }, (_unused, index) => {
    const image = new Image();
    image.src = `./assets/terrain_tiles_v3/objects/remains_layer_${String(index + 2).padStart(2, "0")}.png`;
    return image;
  });

  // ── 유닛 스프라이트시트 ───────────────────────────────────────────────
  const unitWalkSprite = new Image();
  unitWalkSprite.src = './assets/units/ancient_infantry_helmet_walk.png';
  const unitWalkBlueSprite = new Image();
  unitWalkBlueSprite.src = './assets/units/ancient_infantry_helmet_walk_blue.png';
  const CAVALRY_PLAYER_DIRECTION_SOURCE_CANDIDATES = {
    E:  ['./assets/units/ancient_cavity_helmet_walk_E.png'],
    NE: ['./assets/units/ancient_cavity_helmet_walk_NE.png'],
    N:  ['./assets/units/ancient_cavity_helmet_walk_N.png'],
    S:  ['./assets/units/ancient_cavity_helmet_walk_S.png'],
    SE: ['./assets/units/ancient_cavity_helmet_walk_SE.png'],
  };
  const CAVALRY_ENEMY_DIRECTION_SOURCE_CANDIDATES = {
    E:  ['./assets/units/ancient_cavity_helmet_walk_blue_E.png'],
    NE: ['./assets/units/ancient_cavity_helmet_walk_blue_NE.png'],
    N:  ['./assets/units/ancient_cavity_helmet_walk_blue_N.png'],
    S:  ['./assets/units/ancient_cavity_helmet_walk_blue_S.png'],
    SE: ['./assets/units/ancient_cavity_helmet_walk_blue_SE.png'],
  };
  const CAVALRY_DIRECTION_SOURCE_KEY = {
    E: 'E',
    NE: 'NE',
    N: 'N',
    NW: 'NE',
    W: 'E',
    SW: 'SE',
    S: 'S',
    SE: 'SE',
  };
  const CAVALRY_DIRECTION_FLIP = {
    E: false,
    NE: false,
    N: false,
    NW: true,
    W: true,
    SW: true,
    S: false,
    SE: false,
  };
  function createImageWithFallbacks(sources) {
    const image = new Image();
    const list = Array.isArray(sources) ? sources : [sources];
    let index = 0;
    image.onerror = () => {
      index += 1;
      if (index < list.length) image.src = list[index];
    };
    image.src = list[0];
    return image;
  }
  const cavalryPlayerDirectionSprites = Object.fromEntries(
    Object.entries(CAVALRY_PLAYER_DIRECTION_SOURCE_CANDIDATES)
      .map(([direction, sources]) => [direction, createImageWithFallbacks(sources)])
  );
  const cavalryEnemyDirectionSprites = Object.fromEntries(
    Object.entries(CAVALRY_ENEMY_DIRECTION_SOURCE_CANDIDATES)
      .map(([direction, sources]) => [direction, createImageWithFallbacks(sources)])
  );
  const cavalryWalkSprite = new Image();
  cavalryWalkSprite.src = './assets/units/ancient_cavity_helmet_walk_E.png';
  const cavalryWalkBlueSprite = createImageWithFallbacks(CAVALRY_ENEMY_DIRECTION_SOURCE_CANDIDATES.E);
  const cavalryWalkBackSprite = createImageWithFallbacks(CAVALRY_PLAYER_DIRECTION_SOURCE_CANDIDATES.N);
  const cavalryWalkBackBlueSprite = createImageWithFallbacks(CAVALRY_ENEMY_DIRECTION_SOURCE_CANDIDATES.N);
  const unitIdleSprite = new Image();
  unitIdleSprite.src = './assets/units/ancient_infantry_helmet_idle_1.png';
  const unitIdleBlueSprite = new Image();
  unitIdleBlueSprite.src = './assets/units/ancient_infantry_helmet_idle_1_blue.png';
  const unitDamageEffectSprite = new Image();
  unitDamageEffectSprite.src = './assets/units/demage.png';
  const gameSpriteImages = [
    fireSprite,
    ...remainsSprites,
    ...Object.values(cavalryPlayerDirectionSprites),
    ...Object.values(cavalryEnemyDirectionSprites),
    unitWalkSprite,
    unitWalkBlueSprite,
    cavalryWalkSprite,
    cavalryWalkBlueSprite,
    cavalryWalkBackSprite,
    cavalryWalkBackBlueSprite,
    unitIdleSprite,
    unitIdleBlueSprite,
    unitDamageEffectSprite,
  ];
  const UNIT_WALK_FRAMES = 5;
  const UNIT_DAMAGE_EFFECT_FRAMES = 5;
  const UNIT_DAMAGE_EFFECT_DURATION = 0.38;
  const UNIT_WALK_SCALE = 0.85;
  const FIRST_ROW_BONUS_DIVISOR = 50;
  const FOG_BLUR_STRENGTH = 14;
  const FOG_BLUR_PADDING = 56;
  const FOG_BUFFER_PADDING = 96;

  // ── PixiJS 상태 ──────────────────────────────────────────────────────────
  let pixiApp        = null;
  let pixiShadowGfx  = null;
  let pixiGlowGfx    = null;
  let pixiUnitCtr    = null;
  let pixiFogSprite  = null;
  let pixiFogBlur    = null;
  let pixiFogRT      = null;
  let pixiFogDark    = null; // 영구 재사용 Graphics (dark overlay)
  let pixiFogVision  = null; // 영구 재사용 Graphics (vision erase)
  let pixiFogScene   = null; // 영구 재사용 Container
  const pixiUnitSprites = new Map(); // unit.id → PixiSprite
  const pixiDamageEffectSprites = new Map();
  const pixiWalkTex  = {
    infantry: { player: [], enemy: [] },
    cavalry:  { player: [], enemy: [] },
  };
  const pixiWalkBackTex = { cavalry: { player: [], enemy: [] } }; // 기병 후방(우상향) 스프라이트
  const pixiCavalryDirectionTex = { player: {}, enemy: {} };
  const pixiIdleTex  = {
    infantry: { player: null, enemy: null },
    cavalry:  { player: null, enemy: null },
  };
  const pixiDamageEffectTex = [];
  let pixiReady      = false;
  let _pixiRendererW = 0, _pixiRendererH = 0;
  let pixiTerrainCtr = null;
  let pixiTreeCtr    = null;
  let pixiTreeTex    = [];
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

      pixiFogBlur = new BlurFilter({ strength: FOG_BLUR_STRENGTH });
      pixiFogBlur.repeatEdgePixels = true;
      pixiFogBlur.padding = FOG_BLUR_PADDING;
      pixiFogSprite = new PixiSprite();
      pixiFogSprite.filters = [pixiFogBlur];
      pixiFogSprite.visible = false;

      pixiApp.stage.addChild(pixiTerrainCtr);
      pixiApp.stage.addChild(pixiTreeCtr);
      pixiApp.stage.addChild(pixiShadowGfx);
      pixiApp.stage.addChild(pixiGlowGfx);
      pixiApp.stage.addChild(pixiUnitCtr);
      pixiApp.stage.addChild(pixiFogSprite);

      // 유닛 텍스처 로드
      const load = url => PixiAssets.load(url).catch(() => null);
      const loadFirst = async sources => {
        const list = Array.isArray(sources) ? sources : [sources];
        for (const url of list) {
          const texture = await load(url);
          if (texture) return texture;
        }
        return null;
      };
      const [wP, wE, cP, cE, cBack, cBackBlue, iP, iE, treeTs, fallbackTreeT, dmgT] = await Promise.all([
        load('./assets/units/ancient_infantry_helmet_walk.png'),
        load('./assets/units/ancient_infantry_helmet_walk_blue.png'),
        loadFirst(CAVALRY_PLAYER_DIRECTION_SOURCE_CANDIDATES.E),
        loadFirst(CAVALRY_ENEMY_DIRECTION_SOURCE_CANDIDATES.E),
        loadFirst(CAVALRY_PLAYER_DIRECTION_SOURCE_CANDIDATES.N),
        loadFirst(CAVALRY_ENEMY_DIRECTION_SOURCE_CANDIDATES.N),
        load('./assets/units/ancient_infantry_helmet_idle_1.png'),
        load('./assets/units/ancient_infantry_helmet_idle_1_blue.png'),
        Promise.all(TREE_VARIANT_FILES.map(file => load(`./assets/terrain_tiles_v3/${TREE_VARIANT_DIR}/${file}`))),
        load('./assets/terrain_tiles_v3/objects/trees/tree.png'),
        load('./assets/units/demage.png'),
      ]);
      pixiTreeTex = (treeTs || []).filter(Boolean);
      if (!pixiTreeTex.length && fallbackTreeT) pixiTreeTex = [fallbackTreeT];
      // 픽셀아트: 모든 유닛 텍스처에 nearest-neighbor 보간 설정
      [wP, wE, cP, cE, cBack, cBackBlue, iP, iE].forEach(tex => { if (tex) tex.source.scaleMode = 'nearest'; });

      const makeFrames = (tex, type) => {
        if (!tex) return [];
        const frames = troopWalkFrames(type);
        const fw = tex.width / frames;
        return Array.from({ length: frames }, (_, i) =>
          new Texture({ source: tex.source, frame: new PixiRect(i * fw, 0, fw, tex.height) })
        );
      };
      pixiWalkTex.infantry.player  = makeFrames(wP, "infantry");
      pixiWalkTex.infantry.enemy   = makeFrames(wE, "infantry");
      pixiWalkTex.cavalry.player   = makeFrames(cP, "cavalry");
      pixiWalkTex.cavalry.enemy    = makeFrames(cE, "cavalry");
      pixiWalkBackTex.cavalry.player = makeFrames(cBack, "cavalry");
      pixiWalkBackTex.cavalry.enemy  = makeFrames(cBackBlue, "cavalry");
      const cavalryDirectionEntries = await Promise.all(
        Object.entries(CAVALRY_PLAYER_DIRECTION_SOURCE_CANDIDATES)
          .map(async ([direction, sources]) => [direction, await loadFirst(sources)])
      );
      cavalryDirectionEntries.forEach(([direction, tex]) => {
        if (tex) tex.source.scaleMode = 'nearest';
        pixiCavalryDirectionTex.player[direction] = makeFrames(tex, "cavalry");
      });
      const enemyCavalryDirectionEntries = await Promise.all(
        Object.entries(CAVALRY_ENEMY_DIRECTION_SOURCE_CANDIDATES)
          .map(async ([direction, sources]) => [direction, await loadFirst(sources)])
      );
      enemyCavalryDirectionEntries.forEach(([direction, tex]) => {
        if (tex) tex.source.scaleMode = 'nearest';
        pixiCavalryDirectionTex.enemy[direction] = makeFrames(tex, "cavalry");
      });
      if (pixiCavalryDirectionTex.player.E?.length) {
        pixiWalkTex.cavalry.player = pixiCavalryDirectionTex.player.E;
      }
      if (pixiCavalryDirectionTex.enemy.E?.length) {
        pixiWalkTex.cavalry.enemy = pixiCavalryDirectionTex.enemy.E;
      }
      if (iP) pixiIdleTex.infantry.player = iP;
      if (iE) pixiIdleTex.infantry.enemy  = iE;
      pixiIdleTex.cavalry.player = pixiWalkTex.cavalry.player[0] || null;
      pixiIdleTex.cavalry.enemy  = pixiWalkTex.cavalry.enemy[0] || null;
      if (dmgT) {
        dmgT.source.scaleMode = 'nearest';
        const fw = dmgT.width / UNIT_DAMAGE_EFFECT_FRAMES;
        pixiDamageEffectTex.splice(0, pixiDamageEffectTex.length, ...Array.from({ length: UNIT_DAMAGE_EFFECT_FRAMES }, (_, i) =>
          new Texture({ source: dmgT.source, frame: new PixiRect(i * fw, 0, fw, dmgT.height) })
        ));
      }

      pixiReady = true;
    } catch (e) {
      console.warn('[PixiJS] init failed, falling back to Canvas 2D:', e);
    }
  }
  const FIRST_ROW_DEFENSE_BONUS = 1.5;
  const RANGED_MIN_DAMAGE = 0.25;
  const TRACE_MIN_TILE_DISTANCE = 1.0;

  function preloadTerrainSprites() {
    const pending = [];
    const loadImg = src => { const i = new Image(); i.src = src; pending.push(i); return i; };

    // 3×3 베이스 텍스처
    for (let n = 0; n < 8;  n++) terrainSprites.dirt.push(loadImg(`${V3}base_3x3/dirt/dirt_${String(n).padStart(2,"0")}.png`));
    for (let n = 0; n < 12; n++) terrainSprites.plainGrass.push(loadImg(`${V3}base_3x3/plain/plain_${String(n).padStart(2,"0")}.png`));
    for (let n = 0; n < 12; n++) terrainSprites.forestFloor.push(loadImg(`${V3}base_3x3/forest_floor/forest_floor_${String(n).padStart(2,"0")}.png`));

    // 월드 좌표 기반 베이스 텍스처 — 1×1 경계와 무관하게 같은 지형을 연속 샘플링
    terrainSprites.world.dirt        = loadImg(`${WORLD_TEX}dirt_world.webp`);
    terrainSprites.world.grass       = loadImg(`${WORLD_TEX}bright_grass_world.webp`);
    terrainSprites.world.forestFloor = loadImg(`${WORLD_TEX}mountain_grass_world.webp`);
    terrainSprites.world.road        = loadImg(`${WORLD_TEX}road_world.webp`);
    terrainSprites.world.river       = loadImg(`${WORLD_TEX}river_world.webp`);
    terrainSprites.world.riverBank   = loadImg(`${WORLD_TEX}river_bank_world.webp`);
    terrainSprites.world.wetland     = loadImg(`${WORLD_TEX}wetland_grass_world.webp`);
    terrainSprites.clusters = TERRAIN_CLUSTER_DEFS.map(def => loadImg(`${CLUSTER_TEX}${def.file}`));

    // 나무 오브젝트
    terrainSprites.tree    = loadImg(`${V3}objects/trees/tree.png`);
    terrainSprites.trees   = TREE_VARIANT_FILES.map(file => loadImg(`${V3}${TREE_VARIANT_DIR}/${file}`));
    terrainSprites.ruggedMtn = [
      loadImg(`${V3}base_3x3/mountain/mountain_0006_레이어-1.png`),
      loadImg(`${V3}base_3x3/mountain/mountain_0005_레이어-2.png`),
      loadImg(`${V3}base_3x3/mountain/mountain_0004_레이어-3.png`),
      loadImg(`${V3}base_3x3/mountain/mountain_0003_레이어-4.png`),
      loadImg(`${V3}base_3x3/mountain/mountain_0002_레이어-5.png`),
      loadImg(`${V3}base_3x3/mountain/mountain_0001_레이어-6.png`),
      loadImg(`${V3}base_3x3/mountain/mountain_0000_레이어-7.png`),
    ];
    for (let n = 0; n < 16; n += 1)
      terrainSprites.objects.push(loadImg(`./assets/objects/object_sheet_tiles/object_${String(n).padStart(2, "0")}.png`));
    for (let n = 0; n < 9; n += 1)
      terrainSprites.buildings.push(loadImg(`./assets/objects/building_tiles/building_${String(n).padStart(2, "0")}.png`));

    // 1×1 center 타일 — 지형별 다중 variant 배열
    // 파일: {asset}_center.png + {asset}_center_00.png ~ {asset}_center_05.png (총 7종)
    for (const [, asset] of Object.entries(TERRAIN_ASSET)) {
      const arr = [];
      arr.push(loadImg(`${V3}tile_1x1/${asset}/${asset}_center.png`));
      for (let n = 0; n < 6; n++)
        arr.push(loadImg(`${V3}tile_1x1/${asset}/${asset}_center_${String(n).padStart(2,"0")}.png`));
      terrainSprites.tiles[asset] = arr;
    }

    // 엣지 마스크 EDGE_NEW — 방향별 5종 변형 (raw: 휘도→알파 변환 전)
    const MASK_DIRS = ["N","NE","E","SE","S","SW","W","NW"];
    const EDGE_NEW_SOURCE_DIR = { N:"S", NE:"SW", E:"W", SE:"NW", S:"N", SW:"NE", W:"E", NW:"SE" };
    const MASK_VARS = 5;
    const rawMasks = {}; // key: "N_00" 등
    for (const d of MASK_DIRS)
      for (let n = 0; n < MASK_VARS; n++)
        rawMasks[`${d}_${String(n).padStart(2,"0")}`] =
          loadImg(`${V3}masks_1x1/EDGE_NEW/edge_mask_${EDGE_NEW_SOURCE_DIR[d]}_${String(n + 1).padStart(2,"0")}.png`);

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

  function terrainWorldTexture(tile) {
    if (tile === "river") return terrainSprites.world.river;
    if (tile === "wetland") return terrainSprites.world.wetland;
    if (tile === "road") return terrainSprites.world.road;
    if (tile === "mountain") return terrainSprites.world.grass;
    if (tile === "grassland") return terrainSprites.world.grass;
    return terrainSprites.world.dirt;
  }

  function terrainWorldToneFilter(tile) {
    return TERRAIN_WORLD_TONE_FILTERS[tile] || "none";
  }

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

    // 2패스: 경계 타일별 레이어 목록 결정 (Method B: 다중 레이어)
    // 각 레이어마다 상위 지형 하나씩 처리 → 3개 이상 지형 접합부 정상 처리
    const ALL8 = [...FACES, [-1,-1],[1,-1],[1,1],[-1,1]];
    const borderData = Array.from({length: MAP_HEIGHT}, () => new Array(MAP_WIDTH).fill(null));
    const SINGLE_FACE_KEYS = new Set(["ULLL","LULL","LLUL","LLLU"]);

    for (let y = 0; y < MAP_HEIGHT; y++) {
      for (let x = 0; x < MAP_WIDTH; x++) {
        if (!isBorder[y][x]) continue;
        const t = terrain.tiles[y][x];
        const p = TERRAIN_PRIORITY[t] ?? 2;

        // 4면 이웃 수집
        const nbrs = FACES.map(([dx, dy]) => {
          const nx = x+dx, ny = y+dy;
          if (nx < 0 || nx >= MAP_WIDTH || ny < 0 || ny >= MAP_HEIGHT) return { p, border: false };
          return { p: TERRAIN_PRIORITY[terrain.tiles[ny][nx]] ?? 2, border: isBorder[ny][nx] === 1 };
        }); // [NW, NE, SE, SW]

        // ALL8에서 상위 지형 종류 수집 (우선순위 오름차순)
        const upperTSet = new Set();
        for (const [dx, dy] of ALL8) {
          const nx = x+dx, ny = y+dy;
          if (nx < 0 || nx >= MAP_WIDTH || ny < 0 || ny >= MAP_HEIGHT) continue;
          const nt = terrain.tiles[ny][nx];
          if ((TERRAIN_PRIORITY[nt] ?? 2) > p) upperTSet.add(nt);
        }
        if (upperTSet.size === 0) continue;

        const layers = [];
        for (const T of [...upperTSet].sort((a, b) =>
            (TERRAIN_PRIORITY[a] ?? 2) - (TERRAIN_PRIORITY[b] ?? 2))) {
          const tP = TERRAIN_PRIORITY[T] ?? 2;
          // 면 상태: 이웃 우선순위 >= T 우선순위이면 U
          // 코너갭(같은 지형 경계 타일, n.p === p)도 U로 처리 — 다른 지형 border는 제외
          const states = nbrs.map(n => (n.p >= tP || (n.border && n.p === p)) ? "U" : "L");
          const key = states.join("");
          let maskDir;
          if (key === "UUUU") {
            maskDir = "center";
          } else if (MASK_KEY[key]) {
            maskDir = MASK_KEY[key];
          } else if (SINGLE_FACE_KEYS.has(key)) {
            maskDir = key; // 단일 면: 사분면 클립으로 처리
          } else {
            continue; // 인식 불가 패턴 스킵
          }
          layers.push({ upperT: T, maskDir });
        }

        if (layers.length === 0) continue;
        borderData[y][x] = { layers, lowerT: t };
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
    // 험준산악 8×8 감지 — 청크 정렬 제한 (단일 청크 내에 완전히 들어오는 블록만)
    const ruggedMtn = Array.from({length: MAP_HEIGHT}, () => new Uint8Array(MAP_WIDTH));
    const ruggedMtnVariant = Array.from({length: MAP_HEIGHT}, () => new Uint8Array(MAP_WIDTH));
    const ruggedMtnEdge = Array.from({length: MAP_HEIGHT}, () => new Uint8Array(MAP_WIDTH));
    const ruggedNoiseSeed = 6721;
    const ruggedNoiseValue = (xi, yi, seed) => {
      return (tileHash(xi * 1777 + ruggedNoiseSeed + seed * 2113, yi * 1999 + ruggedNoiseSeed * 2 + seed * 2381) % 10000) / 10000;
    };
    const smoothRuggedNoise = (x, y, scale, seed) => {
      const nx = x / scale;
      const ny = y / scale;
      const xi = Math.floor(nx);
      const yi = Math.floor(ny);
      const fx = nx - xi;
      const fy = ny - yi;
      const sx = fx * fx * (3 - 2 * fx);
      const sy = fy * fy * (3 - 2 * fy);
      return ruggedNoiseValue(xi, yi, seed)           * (1 - sx) * (1 - sy)
           + ruggedNoiseValue(xi + 1, yi, seed)       * sx       * (1 - sy)
           + ruggedNoiseValue(xi, yi + 1, seed)       * (1 - sx) * sy
           + ruggedNoiseValue(xi + 1, yi + 1, seed)   * sx       * sy;
    };
    const ruggedCoverageNoise = (x, y) => {
      return smoothRuggedNoise(x, y, 26, 1) * 0.54
           + smoothRuggedNoise(x + 31, y - 23, 12, 2) * 0.31
           + smoothRuggedNoise(x - 47, y + 37, 5, 3) * 0.15;
    };
    const ruggedCandidateScore = (x, y) => {
      const cx = x + RUGGED_MTN_SIZE * 0.5;
      const cy = y + RUGGED_MTN_SIZE * 0.5;
      const coverage = ruggedCoverageNoise(cx, cy);
      const localAvg = (
        ruggedCoverageNoise(cx - 4, cy) +
        ruggedCoverageNoise(cx + 4, cy) +
        ruggedCoverageNoise(cx, cy - 4) +
        ruggedCoverageNoise(cx, cy + 4)
      ) * 0.25;
      const lift = Math.max(0, coverage - localAvg);
      const fine = smoothRuggedNoise(cx + 17, cy - 13, 4, 4);
      return coverage * 0.82 + fine * 0.12 + lift * 1.55;
    };
    const canUseRuggedFootprint = (x, y) => {
      if (x < 0 || y < 0 || x + RUGGED_MTN_SIZE > MAP_WIDTH || y + RUGGED_MTN_SIZE > MAP_HEIGHT) return false;
      for (let dy = 0; dy < RUGGED_MTN_SIZE; dy++)
        for (let dx = 0; dx < RUGGED_MTN_SIZE; dx++)
          if (terrain.tiles[y + dy][x + dx] !== "mountain") return false;
      return true;
    };
    const hasRuggedNearby = (x, y, padding = 0) => {
      const x0 = Math.max(0, x - padding);
      const y0 = Math.max(0, y - padding);
      const x1 = Math.min(MAP_WIDTH - 1, x + RUGGED_MTN_SIZE - 1 + padding);
      const y1 = Math.min(MAP_HEIGHT - 1, y + RUGGED_MTN_SIZE - 1 + padding);
      for (let ty = y0; ty <= y1; ty++)
        for (let tx = x0; tx <= x1; tx++)
          if (ruggedMtn[ty][tx]) return true;
      return false;
    };

    const canPlaceRugged = (x, y) => {
      return canUseRuggedFootprint(x, y) && !hasRuggedNearby(x, y, 0);
    };

    const RUGGED_CLUSTER_MIN_ANCHOR_GAP = 4;
    const hasReservedAnchorTooClose = (x, y, reserved) => {
      return reserved.some((block) =>
        Math.max(Math.abs(x - block.x), Math.abs(y - block.y)) < RUGGED_CLUSTER_MIN_ANCHOR_GAP
      );
    };

    const canReserveRugged = (x, y, reserved) => {
      return canPlaceRugged(x, y) && !hasReservedAnchorTooClose(x, y, reserved);
    };

    const placeRugged = (x, y) => {
      const ruggedVariant = tileHash(x * 211 + 19, y * 331 + 43) % 7;
      ruggedMtn[y][x] = 1;
      ruggedMtnVariant[y][x] = ruggedVariant;
      for (let dy = 0; dy < RUGGED_MTN_SIZE; dy++)
        for (let dx = 0; dx < RUGGED_MTN_SIZE; dx++) {
          const ty = y + dy;
          const tx = x + dx;
          const edgeWeight = (dy === RUGGED_MTN_SIZE - 1 || dx === RUGGED_MTN_SIZE - 1)
            ? 2
            : (dy === RUGGED_MTN_SIZE - 2 || dx === RUGGED_MTN_SIZE - 2 || dy === 0 || dx === 0) ? 1 : 0;
          if (dy || dx) {
            if (ruggedMtn[ty][tx] !== 1) ruggedMtn[ty][tx] = 2;
            if (ruggedMtn[ty][tx] !== 1) ruggedMtnEdge[ty][tx] = Math.max(ruggedMtnEdge[ty][tx], edgeWeight);
          } else {
            ruggedMtnEdge[ty][tx] = Math.max(ruggedMtnEdge[ty][tx], edgeWeight);
          }
        }
    };

    const ruggedCandidates = [];
    for (let y = 0; y <= MAP_HEIGHT - RUGGED_MTN_SIZE; y += 1) {
      for (let x = 0; x <= MAP_WIDTH - RUGGED_MTN_SIZE; x += 1) {
        if (!canUseRuggedFootprint(x, y)) continue;
        const score = ruggedCandidateScore(x, y);
        if (score < 0.40) continue;
        const scatter = (tileHash(x * 1523 + 83, y * 1777 + 109) % 1000) / 1000;
        ruggedCandidates.push({ x, y, score: score + scatter * 0.025 });
      }
    }
    ruggedCandidates.sort((a, b) => b.score - a.score);

    const ruggedNeighborDirections = [
      [ 1, 0], [-1, 0],
      [0,  1], [0, -1],
      [ 1,  1], [-1, -1],
      [ 1, -1], [-1,  1],
    ];
    const ruggedNeighborOffsetsFor = (base, seed, guard) => {
      return ruggedNeighborDirections.map(([dirX, dirY], index) => {
        const hash = tileHash(
          base.x * 1291 + seed.x * 17 + index * 97 + guard * 31,
          base.y * 1451 + seed.y * 19 + index * 89 + guard * 37
        );
        if (dirX && dirY) {
          const stepX = 4 + (hash % 4);
          const stepY = 4 + ((hash >>> 5) % 4);
          return [dirX * stepX, dirY * stepY];
        }
        const step = 4 + (hash % 4);
        const skew = ((hash >>> 4) % 5) - 2;
        return dirX ? [dirX * step, skew] : [skew, dirY * step];
      });
    };
    const buildRuggedCluster = (seed, targetBlocks) => {
      if (!canReserveRugged(seed.x, seed.y, [])) return [];
      const reserved = [{ x: seed.x, y: seed.y, score: seed.score }];
      const seen = new Set([`${seed.x}:${seed.y}`]);
      let guard = 0;
      while (reserved.length < targetBlocks && guard < targetBlocks * 16) {
        guard += 1;
        const options = [];
        for (const base of reserved) {
          for (const [dx, dy] of ruggedNeighborOffsetsFor(base, seed, guard)) {
            const nx = base.x + dx;
            const ny = base.y + dy;
            const key = `${nx}:${ny}`;
            if (seen.has(key)) continue;
            seen.add(key);
            if (!canReserveRugged(nx, ny, reserved)) continue;
            const scatter = (tileHash(nx * 1871 + seed.x * 13, ny * 2081 + seed.y * 17) % 1000) / 1000;
            options.push({ x: nx, y: ny, score: ruggedCandidateScore(nx, ny) + scatter * 0.04 });
          }
        }
        if (!options.length) break;
        options.sort((a, b) => b.score - a.score);
        const pickWindow = Math.min(options.length, 1 + (tileHash(seed.x + guard * 37, seed.y + guard * 53) % 3));
        reserved.push(options[pickWindow - 1]);
      }
      return reserved.length >= 3 ? reserved : [];
    };

    const maxRuggedClusters = Math.max(1, Math.floor(ruggedCandidates.length / 260));
    let ruggedClusterCount = 0;
    for (const seed of ruggedCandidates) {
      if (ruggedClusterCount >= maxRuggedClusters) break;
      if (seed.score < 0.45) continue;
      if (hasRuggedNearby(seed.x, seed.y, RUGGED_MTN_SIZE * 2)) continue;
      const targetBlocks = 3 + (tileHash(seed.x * 43 + 5, seed.y * 59 + 11) % 5);
      const clusterBlocks = buildRuggedCluster(seed, targetBlocks);
      if (clusterBlocks.length < 3) continue;
      clusterBlocks.forEach((block) => placeRugged(block.x, block.y));
      ruggedClusterCount += 1;
    }

    if (!ruggedClusterCount) {
      for (const seed of ruggedCandidates) {
        const clusterBlocks = buildRuggedCluster(seed, 3);
        if (clusterBlocks.length >= 3) {
          clusterBlocks.forEach((block) => placeRugged(block.x, block.y));
          break;
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

    const clusterMap = null;

    const buildingMap = Array.from({length: MAP_HEIGHT}, () => new Uint8Array(MAP_WIDTH));
    /*
    const BUILDING_EDGE_MARGIN = 10;
    const canUseBuildingFootprint = (x, y) => {
      if (x + 1 >= MAP_WIDTH || y + 1 >= MAP_HEIGHT) return false;
      if (x < BUILDING_EDGE_MARGIN || y < BUILDING_EDGE_MARGIN) return false;
      if (x + 1 >= MAP_WIDTH - BUILDING_EDGE_MARGIN || y + 1 >= MAP_HEIGHT - BUILDING_EDGE_MARGIN) return false;
      for (let dy = 0; dy < 2; dy += 1) {
        for (let dx = 0; dx < 2; dx += 1) {
          const tx = x + dx;
          const ty = y + dy;
          if (terrain.tiles[ty][tx] !== "plain" || isBorder[ty][tx] || objectMap[ty][tx]) return false;
        }
      }
      return true;
    };
    const canPlaceBuilding = (x, y) => {
      if (!canUseBuildingFootprint(x, y)) return false;
      for (let ay = Math.max(0, y - 1); ay <= y + 1 && ay < MAP_HEIGHT; ay += 1) {
        for (let ax = Math.max(0, x - 1); ax <= x + 1 && ax < MAP_WIDTH; ax += 1) {
          if (buildingMap[ay][ax]) return false;
        }
      }
      return true;
    };
    const buildingCandidates = [];
    for (let y = 0; y < MAP_HEIGHT - 1; y++) {
      for (let x = 0; x < MAP_WIDTH - 1; x++) {
        if (!canUseBuildingFootprint(x, y)) continue;
        buildingCandidates.push({ x, y, h: tileHash(x + 719, y + 1543) });
      }
    }
    buildingCandidates.sort((a, b) => (b.h - a.h) || (a.y - b.y) || (a.x - b.x));
    const buildingClusterCount = buildingCandidates.length >= 2 ? 2 : buildingCandidates.length;
    const buildingSeeds = [];
    for (const candidate of buildingCandidates) {
      if (buildingSeeds.length >= buildingClusterCount) break;
      if (buildingSeeds.some(seed => Math.hypot(seed.x - candidate.x, seed.y - candidate.y) < 24)) continue;
      buildingSeeds.push(candidate);
    }
    const placeBuildingCluster = (seed) => {
      const targetCount = 6 + (tileHash(seed.x + 811, seed.y + 1619) % 10);
      const clusterCandidates = buildingCandidates
        .map(candidate => {
          const dist = Math.hypot(candidate.x - seed.x, candidate.y - seed.y);
          const scatter = (tileHash(candidate.x + seed.x * 3, candidate.y + seed.y * 5) % 1000) / 1000;
          return { ...candidate, dist, score: dist + scatter * 2.5 };
        })
        .filter(candidate => candidate.dist <= 24)
        .sort((a, b) => a.score - b.score);
      let placed = 0;
      for (const candidate of clusterCandidates) {
        if (placed >= targetCount) break;
        if (!canPlaceBuilding(candidate.x, candidate.y)) continue;
        const variantRoll = (candidate.h >>> 8) % 100;
        const buildingVariant = variantRoll < 35
          ? 0
          : 1 + ((candidate.h >>> 16) % 8);
        buildingMap[candidate.y][candidate.x] = 1 + buildingVariant;
        placed += 1;
      }
    };
    buildingSeeds.forEach(placeBuildingCluster);
    */

    return { isBorder, borderData, block, variant, ruggedMtn, ruggedMtnVariant, ruggedMtnEdge, clusterMap, objectMap, buildingMap, minimapCanvas, chunkCache: new Map(), chunkTileW: 0, chunkSpritesReady: false, chunkPixiReady: false, prefetchQueue: [], prefetchGen: 0, _prefetchScheduled: false };
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

  function getUnitRadius(formation) {
    if (formation._unitRadius == null)
      formation._unitRadius = UNIT_RADIUS * troopTypeInfo(formation.troopType).collisionMult;
    return formation._unitRadius;
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
    if (Array.isArray(general.allowedSkills)) {
      return general.allowedSkills.filter(skill => SKILL_DEF[skill]);
    }
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
      const baseRadius = 6 + Math.floor(Math.random() * 5);
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

    // ── 강 주변부 습지: 강에서 3타일 이내 plain/grassland → wetland ────
    if (riverGenerated) {
      for (let y = 0; y < MAP_HEIGHT; y++) {
        for (let x = 0; x < MAP_WIDTH; x++) {
          const d = rDist[y * MAP_WIDTH + x];
          if (d < 1 || d > 3) continue;
          const t = tiles[y][x];
          if (t === "plain" || t === "grassland") tiles[y][x] = "wetland";
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
          if (grassNoise(x, y) > 0.58) tiles[y][x] = "grassland";
        }
      }
      const spread = [];
      for (let y = 1; y < MAP_HEIGHT - 1; y++) {
        for (let x = 1; x < MAP_WIDTH - 1; x++) {
          if (tiles[y][x] !== "plain") continue;
          const nearGrass =
            tiles[y - 1][x] === "grassland" ||
            tiles[y + 1][x] === "grassland" ||
            tiles[y][x - 1] === "grassland" ||
            tiles[y][x + 1] === "grassland";
          if (nearGrass && grassNoise(x + 11, y + 7) > 0.49) spread.push([x, y]);
        }
      }
      spread.forEach(([x, y]) => { tiles[y][x] = "grassland"; });
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
        damageEffectTimer: 0,
        damageEffectFlip: false,
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
      targetSetTime: -999,
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
    tileW: window.innerWidth < 950 ? 16 : DEFAULT_TILE_W,
    battlePhase: "planning",
    battleTime: 0,
    phaseStartTime: 0,
    scenarioAggroTime: 0,
    selectedId: 0,
    camera: vec(0, 0),
    dragState: null,
    phaseButton,
    speedMultiplier: 1,
    paused: false,
    controlType: 'mouse',
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
    mode: "quick",
    online: null,
    scenarioData: null,
    scenarioPhaseIndex: -1,
    scenarioStep: "none",
    scenarioDialogueIndex: 0,
    scenarioMarkers: [],
    scenarioObjectiveState: {},
    scenarioSkillUseCounts: {},
    scenarioSceneLocked: false,
    scenarioAggro: false,
    scenarioMarkerRevealUntil: 0,
  };

  function isHistoricalMode() {
    return game.mode === "historical" && game.scenarioData;
  }

  function isScenarioSceneActive() {
    return isHistoricalMode() && game.scenarioSceneLocked;
  }

  function createScenarioGeneral(spec) {
    return {
      id: spec.id,
      name: spec.name,
      power: spec.power,
      leadership: spec.leadership,
      charm: spec.charm,
      portrait: spec.portrait || null,
      optionalSkills: [],
      allowedSkills: spec.allowedSkills || (spec.skillType ? [spec.skillType] : null),
      troopType: spec.troopType || "infantry",
      troops: spec.troops || 10000,
      skillType: spec.skillType || "kihap",
      kills: 0,
      losses: 0,
      alive: true,
    };
  }

  function createFormationFromScenarioSpec(spec, team, index) {
    const general = createScenarioGeneral(spec);
    const formation = createFormation(spec.id || index, team, general,
      vec(spec.position?.x ?? 0, spec.position?.y ?? 0),
      normalize(vec(spec.facing?.x ?? (team === "player" ? 1 : -1), spec.facing?.y ?? 0)));
    formation.scenarioId = spec.id || String(index);
    formation.density = normalizeDensityForTroopType(formation.troopType, spec.density || "NORMAL");
    formation.speed = spec.speed || "STOP";
    formation.prevSpeed = spec.prevSpeed || "NORMAL";
    formation.combatOverrides = spec.combatOverrides || null;
    formation.skillType = normalizeSkillForGeneral(general, spec.skillType || general.skillType, formation.troopType);
    formation.general.skillType = formation.skillType;
    initializeFormationSlots(formation, false);
    return formation;
  }

  function normalizeScenarioTerrain(rawTerrain) {
    const tiles = Array.from({ length: MAP_HEIGHT }, (_, y) =>
      Array.from({ length: MAP_WIDTH }, (_, x) => rawTerrain.tiles?.[y]?.[x] || "plain"));
    return {
      tiles,
      playerStart: vec(rawTerrain.playerStart?.x ?? MAP_WIDTH * 0.08, rawTerrain.playerStart?.y ?? MAP_HEIGHT * 0.5),
      enemyStart: vec(rawTerrain.enemyStart?.x ?? MAP_WIDTH * 0.92, rawTerrain.enemyStart?.y ?? MAP_HEIGHT * 0.5),
      markers: rawTerrain.markers || {},
      source: rawTerrain,
    };
  }

  async function loadScenarioDefinition(id) {
    const scenarioRes = await fetch(`./data/scenarios/${id}.json`);
    if (!scenarioRes.ok) throw new Error(`Scenario not found: ${id}`);
    return scenarioRes.json();
  }

  async function loadScenarioTerrain(scenario) {
    const terrainRes = await fetch(scenario.terrain);
    if (!terrainRes.ok) throw new Error(`Scenario terrain not found: ${scenario.terrain}`);
    return normalizeScenarioTerrain(await terrainRes.json());
  }

  async function loadScenarioBundle(id) {
    const scenario = await loadScenarioDefinition(id);
    const terrain = await loadScenarioTerrain(scenario);
    return { scenario, terrain };
  }

  function formationByScenarioId(id, team = null) {
    const formations = team === "player" ? game.playerFormations
      : team === "enemy" ? game.enemyFormations
      : [...game.playerFormations, ...game.enemyFormations];
    return formations.find(f => f.scenarioId === id || f.id === id);
  }

  function scenarioCurrentPhase() {
    return game.scenarioData?.phases?.[game.scenarioPhaseIndex] || null;
  }

  function resetScenarioRuntime() {
    game.scenarioDialogueIndex = 0;
    game.scenarioMarkers = [];
    game.scenarioObjectiveState = {};
    game.scenarioSkillUseCounts = {};
    game.scenarioSceneLocked = false;
    game.scenarioAggro = false;
    game.scenarioMarkerRevealUntil = 0;
    hideScenarioOverlays();
  }
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

  let _battleTileH = null;
  function getTileH() {
    return _battleTileH ?? Math.floor(game.tileW / 2);
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

  let cameraYOffset = -140; // setScreen("battle") 시점에 canvas 높이 기준으로 갱신
  let autoSelectDeadline = -1; // 선택 진형 사망 후 자동 선택 타이머 (battleTime 기준)

  function centerCameraOn(pos) {
    const iso = isoPoint(pos.x, pos.y);
    game.camera.x = iso.x;
    game.camera.y = iso.y + cameraYOffset;
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

  function isOnlineMode() {
    return game.mode === "online" && Boolean(game.online);
  }

  function withSeededRandom(seed, callback) {
    const originalRandom = Math.random;
    initRng(seed);
    Math.random = seededRandom;
    try {
      return callback();
    } finally {
      Math.random = originalRandom;
      resetRng();
    }
  }

  let onlineOriginalRandom = null;

  function enableOnlineRandom(seed) {
    if (!onlineOriginalRandom) onlineOriginalRandom = Math.random;
    initRng(seed);
    Math.random = seededRandom;
  }

  function disableOnlineRandom() {
    if (onlineOriginalRandom) {
      Math.random = onlineOriginalRandom;
      onlineOriginalRandom = null;
    }
    resetRng();
  }

  function createGeneralFromOnlineCommander(commander, fallbackName) {
    const skillType = commander?.skillType || "kihap";
    const troopType = normalizeTroopType(commander?.troopType || "infantry");
    return {
      templateId: commander?.templateId || commander?.id || null,
      name: commander?.name || fallbackName,
      power: Number(commander?.power ?? 75),
      leadership: Number(commander?.leadership ?? 75),
      charm: Number(commander?.charm ?? 70),
      level: Number(commander?.level || 0),
      exp: Number(commander?.exp || 0),
      expRequired: Number(commander?.expRequired || 0),
      portrait: commander?.portrait || null,
      optionalSkills: Array.isArray(commander?.allowedSkills) ? commander.allowedSkills.filter(skill => skill !== skillType) : [],
      allowedSkills: Array.isArray(commander?.allowedSkills) ? commander.allowedSkills : [skillType],
      troopType,
      troops: Number(commander?.troops || (troopType === "cavalry" ? 2500 : 10000)),
      skillType,
      kills: 0,
      losses: 0,
      alive: true,
    };
  }

  function onlinePlayerBySide(match, side) {
    return (match.players || []).find(player => Number(player.side) === side) || null;
  }

  function buildOnlineFormations(terrain, match, worldSide, team) {
    const player = onlinePlayerBySide(match, worldSide);
    const commanders = player?.commanders || [];
    const start = worldSide === 0 ? terrain.playerStart : terrain.enemyStart;
    const facing = worldSide === 0 ? vec(1, 0) : vec(-1, 0);
    return Array.from({ length: 5 }, (_unused, index) => {
      const general = createGeneralFromOnlineCommander(
        commanders[index],
        `${worldSide === 0 ? "Blue" : "Red"} ${index + 1}`,
      );
      const formation = createFormation(index, team, general, vec(start.x, start.y + (index - 2) * 10), facing);
      formation.speed = "NORMAL";
      formation.worldSide = worldSide;
      formation.skillType = normalizeSkillForGeneral(general, general.skillType, general.troopType);
      formation.general.skillType = formation.skillType;
      initializeFormationSlots(formation, false);
      return formation;
    });
  }

  function buildOnlineScenario(match) {
    const terrain = buildTerrain();
    const localSide = Number(match.side || 0);
    const remoteSide = localSide === 0 ? 1 : 0;
    const sideFormations = new Map([
      [0, buildOnlineFormations(terrain, match, 0, localSide === 0 ? "player" : "enemy")],
      [1, buildOnlineFormations(terrain, match, 1, localSide === 1 ? "player" : "enemy")],
    ]);
    return {
      terrain,
      playerFormations: sideFormations.get(localSide),
      enemyFormations: sideFormations.get(remoteSide),
    };
  }

  function onlineNetTick() {
    if (!isOnlineMode()) return 0;
    if (!game.online.simStarted || !Number.isFinite(game.online.startedAtClient)) return game.online.simTick || 0;
    const tickRate = game.online.tickRate || 30;
    return Math.max(0, Math.floor((performance.now() - game.online.startedAtClient) / 1000 * tickRate));
  }

  function onlineFormationsForSide(side) {
    if (!isOnlineMode()) return game.playerFormations;
    return Number(side) === game.online.side ? game.playerFormations : game.enemyFormations;
  }

  function onlineOpponentsForSide(side) {
    if (!isOnlineMode()) return game.enemyFormations;
    return Number(side) === game.online.side ? game.enemyFormations : game.playerFormations;
  }

  function orderedAllFormations() {
    return [...game.playerFormations, ...game.enemyFormations];
  }

  function queueOnlineInput(message) {
    if (!isOnlineMode()) return;
    if (message.roomId && message.roomId !== game.online.roomId) return;
    const side = Number(message.side);
    (message.commands || []).forEach((command) => {
      const targetTick = Number.isFinite(message.targetTick)
        ? message.targetTick
        : onlineNetTick();
      const list = game.online.commandQueue.get(targetTick) || [];
      list.push({ side, seq: Number(message.seq || 0), command });
      game.online.commandQueue.set(targetTick, list);
    });
  }

  function drainOnlineCommands(nowTick = onlineNetTick()) {
    if (!isOnlineMode()) return;
    game.online.netTick = nowTick;
    const dueTicks = [];
    for (const tick of game.online.commandQueue.keys()) {
      if (tick <= nowTick) dueTicks.push(tick);
    }
    dueTicks.sort((a, b) => a - b);
    for (const tick of dueTicks) {
      const entries = game.online.commandQueue.get(tick) || [];
      game.online.commandQueue.delete(tick);
      entries
        .sort((a, b) => a.seq - b.seq)
        .forEach(entry => applyOnlineCommand(entry.side, entry.command));
    }
  }

  function sendOnlineCommands(commands) {
    if (!isOnlineMode() || !commands.length) return false;
    if (!game.online.simStarted) {
      showOnlineSyncNotice("상대 전장 확인을 기다리는 중입니다.", "info", 1800);
      return false;
    }
    onlineClient.sendInput(commands);
    return true;
  }

  function onlineHashNumber(text) {
    let hash = 2166136261;
    String(text).split("").forEach((char) => {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    });
    return hash >>> 0;
  }

  function onlineHashString(text) {
    return onlineHashNumber(text).toString(16);
  }

  function onlineDeterministicRoll(...parts) {
    return onlineHashNumber(parts.join("|")) / 4294967296;
  }

  function onlineSortedFormations() {
    return [...game.playerFormations, ...game.enemyFormations]
      .sort((a, b) => (a.worldSide ?? 0) - (b.worldSide ?? 0) || a.id - b.id);
  }

  function computeOnlineInitialHash() {
    if (!isOnlineMode()) return "";
    const terrainRows = game.terrain.tiles.map(row => row.join("")).join("|");
    const objectRows = (game.terrain.objects || [])
      .map(object => `${object.x},${object.y},${object.kind || object.type || ""}`)
      .join("|");
    const values = [
      "online-init-v2",
      game.online.roomId,
      game.online.seed,
      game.online.tickRate,
      game.online.inputDelayTicks,
      onlineHashString(terrainRows),
      onlineHashString(objectRows),
    ];
    onlineSortedFormations().forEach((formation) => {
      values.push(
        formation.worldSide ?? -1,
        formation.id,
        formation.troopType,
        formation.skillType,
        formation.density,
        formation.speed,
        Math.round(formation.anchor.x * 10),
        Math.round(formation.anchor.y * 10),
        Math.round(formation.facing.x * 100),
        Math.round(formation.facing.y * 100),
        formation.general.templateId || formation.general.id || formation.general.name,
        Math.round(formation.general.power * 10),
        Math.round(formation.general.leadership * 10),
        Math.round(formation.general.charm * 10),
        Math.round(formationInitialTroops(formation)),
        formation.units.length,
      );
      formation.units.forEach((unit) => {
        values.push(Math.round(unit.x * 10), Math.round(unit.y * 10), Math.round(unit.maxDamage || 100));
      });
    });
    return onlineHashString(values.join(","));
  }

  function computeOnlineStateHash() {
    const values = [];
    const formations = onlineSortedFormations();
    formations.forEach((formation) => {
      const target = formation.target || null;
      values.push(
        formation.worldSide ?? -1,
        formation.id,
        Math.round(formation.anchor.x * 10),
        Math.round(formation.anchor.y * 10),
        formation.speed,
        formation.density,
        Math.round((target?.x ?? -1) * 10),
        Math.round((target?.y ?? -1) * 10),
        formation.followTarget?.worldSide ?? -1,
        formation.followTarget?.id ?? -1,
        formation.retreating ? 1 : 0,
        formation.retreated ? 1 : 0,
        Math.round((formation.retreatLastCheckpoint || 0) * 10),
        Math.round(formationRemainingTroops(formation)),
        Math.round(formation.disorder * 100),
        Math.round((formation.kihapCooldown || 0) * 10),
        Math.round((formation.skillCooldown || 0) * 10),
        Math.round((formation.swiftTimer || 0) * 10),
        Math.round((formation.guardTimer || 0) * 10),
        Math.round((formation.archeryTimer || 0) * 10),
      );
      const stride = Math.max(1, Math.floor(formation.units.length / 8));
      for (let i = 0, samples = 0; i < formation.units.length && samples < 8; i += stride, samples += 1) {
        const unit = formation.units[i];
        values.push(
          Math.round(unit.x * 10),
          Math.round(unit.y * 10),
          Math.round((unit.damage || 0) * 10),
        );
      }
    });
    return onlineHashString(values.join(","));
  }

  function maybeSendOnlineChecksum() {
    if (!isOnlineMode() || game.battlePhase !== "live") return;
    const tick = game.online.simTick;
    if (tick - game.online.lastChecksumTick < ONLINE_CHECKSUM_INTERVAL_TICKS) return;
    game.online.lastChecksumTick = tick;
    onlineClient.sendChecksum(tick, computeOnlineStateHash());
  }

  function onlineTargetSimulationTick() {
    if (!isOnlineMode() || !game.online.simStarted) return game.online?.simTick || 0;
    return Math.max(0, onlineNetTick() - (game.online.inputDelayTicks || 3));
  }

  function advanceOnlineSimulationTo(targetTick, maxSteps) {
    if (!isOnlineMode() || !game.online.simStarted || game.battlePhase !== "live") return 0;
    game.speedMultiplier = 1;
    const goalTick = Math.max(0, Math.floor(targetTick));
    let stepCount = 0;
    while (game.online.simTick < goalTick && stepCount < maxSteps && game.battlePhase === "live") {
      game.online.simTick += 1;
      drainOnlineCommands(game.online.simTick);
      update(SIMULATION_STEP);
      stepCount += 1;
    }
    return Math.max(0, goalTick - game.online.simTick);
  }

  function requestOnlineCatchup(reason = "resume") {
    if (!isOnlineMode() || !game.online.simStarted || game.battlePhase !== "live") return;
    if (onlineCatchupScheduled) return;
    onlineCatchupScheduled = true;
    showOnlineSyncNotice("동기화 따라잡는 중...", "info", 0);
    const runChunk = () => {
      onlineCatchupScheduled = false;
      if (!isOnlineMode() || !game.online.simStarted || game.battlePhase !== "live") {
        hideOnlineSyncNotice();
        return;
      }
      const remaining = advanceOnlineSimulationTo(onlineTargetSimulationTick(), ONLINE_CATCHUP_CHUNK_STEPS);
      maybeSendOnlineChecksum();
      game.hudDirty = true;
      refreshHud();
      refreshButtons();
      render();
      if (remaining > 0) {
        onlineCatchupScheduled = true;
        window.setTimeout(runChunk, 0);
      } else {
        showOnlineSyncNotice(reason === "background" ? "백그라운드 동기화 유지 중" : "동기화 완료", "ok", 1200);
      }
    };
    window.setTimeout(runChunk, 0);
  }

  function collectOnlineResultStats() {
    const ownInitial = game.playerFormations.reduce((sum, formation) => sum + formationInitialTroops(formation), 0);
    const ownRemaining = game.playerFormations.reduce((sum, formation) => sum + formationRemainingTroops(formation), 0);
    const enemyInitial = game.enemyFormations.reduce((sum, formation) => sum + formationInitialTroops(formation), 0);
    const enemyRemaining = game.enemyFormations.reduce((sum, formation) => sum + formationRemainingTroops(formation), 0);
    const commanderStats = game.playerFormations.map((formation, index) => ({
      templateId: formation.general.templateId || formation.general.id || formation.general.name,
      slotIndex: index,
      kills: Math.round(Math.max(0, formation.general.kills || 0)),
      losses: Math.round(Math.max(0, formation.general.losses || 0)),
      troopsInitial: Math.round(formationInitialTroops(formation)),
      troopsRemaining: Math.round(formationRemainingTroops(formation)),
    })).filter(stat => stat.templateId);
    return {
      troopsInitial: Math.round(ownInitial),
      troopsRemaining: Math.round(ownRemaining),
      kills: Math.round(Math.max(0, enemyInitial - enemyRemaining)),
      losses: Math.round(Math.max(0, ownInitial - ownRemaining)),
      commanderStats,
    };
  }

  function submitOnlineResult(won) {
    if (!isOnlineMode() || game.online.resultSubmitted) return;
    game.online.resultSubmitted = true;
    const winnerSide = won ? game.online.side : (game.online.side === 0 ? 1 : 0);
    onlineClient.send({
      type: "RESULT",
      winnerSide,
      durationTick: game.online.simTick,
      finalHash: computeOnlineStateHash(),
      stats: collectOnlineResultStats(),
    });
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
    const tileKey = game.terrain.tiles[ty][tx];
    const tileDefense = (formation.troopType === 'cavalry' && tileKey === 'mountain') ? -2 : terrainInfo[tileKey].defense;
    const base = Math.max(0, 2 + speedInfo[formation.speed].defense + densityInfo[formation.density].defense + tileDefense - formation.disorder * 2);
    const defense = base * troopTypeInfo(formation.troopType).meleeDefenseMult;
    const scenarioMult = formation.combatOverrides?.meleeDefenseMult ?? 1;
    const scenarioBonus = formation.combatOverrides?.meleeDefenseBonus ?? 0;
    return (formation.troopType === 'cavalry' ? defense + 10 : defense) * scenarioMult + scenarioBonus;
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

  function deathTraceType(formation, unit) {
    const count = remainsSprites.length || 1;
    if (isOnlineMode()) {
      return onlineHashNumber([
        game.online.seed,
        "remains",
        formation.worldSide ?? formation.team,
        formation.id,
        unit.id,
        unit.slotIndex,
      ].join("|")) % count;
    }
    return Math.floor(Math.random() * count);
  }

  function unitDamageEffectFlip(formation, unit) {
    const hitIndex = unit.damageEffectHitCount = (unit.damageEffectHitCount || 0) + 1;
    if (isOnlineMode()) {
      return onlineHashNumber([
        game.online.seed,
        "damageEffectFlip",
        formation.worldSide ?? formation.team,
        formation.id,
        unit.id,
        unit.slotIndex,
        hitIndex,
      ].join("|")) % 2 === 0;
    }
    return Math.random() < 0.5;
  }

  function deathTraceFlip(formation, unit) {
    if (isOnlineMode()) {
      return onlineHashNumber([
        game.online.seed,
        "remainsFlip",
        formation.worldSide ?? formation.team,
        formation.id,
        unit.id,
        unit.slotIndex,
      ].join("|")) % 2 === 0;
    }
    return Math.random() < 0.5;
  }

  function canPlaceDeathTrace(x, y) {
    const minDistSq = TRACE_MIN_TILE_DISTANCE * TRACE_MIN_TILE_DISTANCE;
    return !game.traces.some((trace) => {
      const dx = trace.x - x;
      const dy = trace.y - y;
      return dx * dx + dy * dy <= minDistSq;
    });
  }

  function applyUnitDamage(targetFormation, unit, amount, attackerFormation = null, options = {}) {
    if (!targetFormation || !unit || amount <= 0 || !isUnitAlive(unit)) return 0;
    const prevDamage = unit.damage;
    const capacity = unitCapacity(unit);
    if (prevDamage >= capacity) return 0;
    const appliedDamage = Math.min(amount, capacity - prevDamage);
    unit.damage = Math.min(capacity, prevDamage + appliedDamage);
    if (options.meleeEffect === true && appliedDamage > 0 && (unit.damageEffectTimer || 0) <= 0) {
      unit.damageEffectTimer = UNIT_DAMAGE_EFFECT_DURATION;
      unit.damageEffectFlip = unitDamageEffectFlip(targetFormation, unit);
    }
    targetFormation.general.losses += appliedDamage;
    if (attackerFormation && attackerFormation !== targetFormation) {
      attackerFormation.general.kills += appliedDamage;
    }
    if (unit.damage >= capacity && prevDamage < capacity) {
      fillSlotFromBehind(targetFormation, unit);
      if (options.trace !== false && game.traces.length < 2000 && !isOnWater(unit) && canPlaceDeathTrace(unit.x, unit.y)) {
        game.traces.push({ x: unit.x, y: unit.y, type: deathTraceType(targetFormation, unit), flip: deathTraceFlip(targetFormation, unit) });
      }
    }
    return appliedDamage;
  }

  function unitAttack(formation) {
    const rawSpeed = anchorMoveSpeed(formation, formation.anchor.x, formation.anchor.y);
    let attackMult;
    if (formation.troopType === 'cavalry') {
      // 기병: 자신의 최대속도 기준 정규화, 속도 감소 시 공격력 급감 (0.55~1.05)
      const cavalryMaxSpeed = speedInfo["FAST"].move * troopTypeInfo("cavalry").moveMult;
      const speedRatio = Math.min(1.0, rawSpeed / cavalryMaxSpeed);
      attackMult = 0.55 + speedRatio * 0.50;
    } else {
      const speedRatio = Math.min(1.0, rawSpeed / speedInfo["FAST"].move);
      attackMult = 0.95 + speedRatio * 0.10;
    }
    return Math.max(0, (15 + formation.general.power / 100 * 15) * (1 - formation.disorder * 0.25) * attackMult)
      * troopTypeInfo(formation.troopType).meleeAttackMult
      * (formation.combatOverrides?.meleeAttackMult ?? 1);
  }

  function rangedDefenseDamageMult(formation) {
    return densityInfo[formation.density].rangedDefenseMult /
      (troopTypeInfo(formation.troopType).rangedDefenseMult * (formation.combatOverrides?.rangedDefenseMult ?? 1));
  }

  function canFormationRangedAttack(formation) {
    return formation.combatOverrides?.canRangedAttack ?? troopTypeInfo(formation.troopType).canRangedAttack;
  }

  function rangedAttack(formation) {
    if (!canFormationRangedAttack(formation)) return 0;
    const rangedMult = formation.combatOverrides?.rangedAttackMult ?? troopTypeInfo(formation.troopType).rangedAttackMult;
    return (15 + formation.general.power / 100 * 15) * 0.2 * rangedMult;
  }

  // 기병은 험지(강·산·습지)에서 추가 이동 패널티 적용
  const CAVALRY_TERRAIN_MOVE_PENALTY = { river: 0.45, mountain: 0.55, wetland: 0.5 };

  function moveMultiplier(x, y, troopType) {
    const tx = clamp(Math.floor(x), 0, MAP_WIDTH - 1);
    const ty = clamp(Math.floor(y), 0, MAP_HEIGHT - 1);
    const tile = game.terrain.tiles[ty][tx];
    const base = terrainInfo[tile].move;
    return troopType === 'cavalry'
      ? base * (CAVALRY_TERRAIN_MOVE_PENALTY[tile] ?? 1.0)
      : base;
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
    const durMult = formation.combatOverrides?.skillDurationMult ?? 1;
    formation.units.forEach((u) => {
      if (isUnitAlive(u)) u.kihapTimer = (4 + Math.random() * 2) * durMult;
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

    const durMult = formation.combatOverrides?.skillDurationMult ?? 1;
    switch (formation.skillType) {
      case "kihap": {
        formation.units.forEach(u => { if (isUnitAlive(u)) u.kihapTimer = (4 + Math.random() * 2) * durMult; });
        formation.kihapCooldown = kihapMaxCooldown(formation);
        if (speechData) tryShowSpeech(formation, randFrom(speechData.kihap), "high");
        break;
      }
      case "swift": {
        formation.swiftTimer = 12.0 * durMult;
        if (speechData) tryShowSpeech(formation, "전속력으로 돌격한다!", "high");
        break;
      }
      case "guard": {
        formation.guardTimer = (7.0 + (formation.general.leadership / 100) * 3.0) * durMult;
        if (speechData) tryShowSpeech(formation, "방패를 굳게 세워라!", "high");
        break;
      }
      case "archery": {
        formation.archeryTimer = 10.0 * durMult;
        if (speechData) tryShowSpeech(formation, "화살이 하늘을 덮는다!", "high");
        break;
      }
      case "fire": {
        const fwd   = normalize(formation.facing);
        const alive = formation.units.filter(isUnitAlive);
        const fireDmgMult = formation.combatOverrides?.fireDamageMult ?? 1;
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
              duration:  (10 + Math.random() * 10) * durMult,
              moveTimer: 1.0 + Math.random() * 0.4,
            });
          }
        game.fires.push({ particles, dmgTimer: 1.0, dmgMult: fireDmgMult });
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
    recordScenarioSkillUse(formation, formation.skillType);
  }

  // ── 스킬 상태 업데이트 ──────────────────────────────────────────────────
  function updateSkills(dt) {
    if (game.battlePhase !== "live") return;
    const allF = orderedAllFormations();

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
            applyUnitDamage(f, u, 20 * (fire.dmgMult ?? 1));
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
        game.floodDamageDealt = true;
        allF.forEach(f => {
          let hit = false;
          f.units.forEach(u => {
            if (!isUnitAlive(u)) return;
            if (!isOnWater(u)) return;
            const dmg = applyUnitDamage(f, u, 40, null, { trace: false });
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

  function buildFireParticleHash(fires) {
    const cells = new Map();
    fires.forEach((fire) => {
      fire.particles.forEach((p) => {
        const cellX = Math.floor(p.x / SPATIAL_CELL_SIZE);
        const cellY = Math.floor(p.y / SPATIAL_CELL_SIZE);
        const key = `${cellX}:${cellY}`;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(p);
      });
    });
    return { cells, cellSize: SPATIAL_CELL_SIZE };
  }

  function findNearbyFireParticles(fireHash, x, y, radius) {
    const { cells, cellSize } = fireHash;
    const minCX = Math.floor((x - radius) / cellSize);
    const maxCX = Math.floor((x + radius) / cellSize);
    const minCY = Math.floor((y - radius) / cellSize);
    const maxCY = Math.floor((y + radius) / cellSize);
    const result = [];
    const rSq = radius * radius;
    for (let cy = minCY; cy <= maxCY; cy++) {
      for (let cx = minCX; cx <= maxCX; cx++) {
        const entries = cells.get(`${cx}:${cy}`);
        if (!entries) continue;
        for (const p of entries) {
          const dx = p.x - x, dy = p.y - y;
          if (dx * dx + dy * dy <= rSq) result.push(p);
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
    return speedInfo[formation.speed].move * moveMultiplier(x, y, formation.troopType) * troopPenalty * swift * troopTypeInfo(formation.troopType).moveMult;
  }

  function unitMoveSpeed(formation, x, y) {
    const troopPenalty = Math.max(0.65, 1 - (formationRemainingPopulation(formation) / 50000) * 0.35);
    const swift = formation.swiftTimer > 0 ? 1.5 : 1.0;
    const disorderPenalty = Math.max(0.1, 1 - formation.disorder * 1.4 * (1 - speedInfo["NORMAL"].move / speedInfo["FAST"].move));
    return speedInfo["FAST"].move * moveMultiplier(x, y, formation.troopType) * (1 + formation.general.leadership / 100 * 0.4) * troopPenalty * swift * troopTypeInfo(formation.troopType).moveMult * disorderPenalty;
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

  const CAVALRY_VISUAL_DIRECTIONS = ["E", "SE", "S", "SW", "W", "NW", "N", "NE"];

  function visualDirectionFromVector(vector) {
    if (!vector) return null;
    const screenX = vector.x - vector.y;
    const screenY = vector.x + vector.y;
    if (len(screenX, screenY) < 0.001) return null;
    const angle = Math.atan2(screenY, screenX);
    const step = Math.PI / 4;
    const index = ((Math.round(angle / step) % 8) + 8) % 8;
    return CAVALRY_VISUAL_DIRECTIONS[index];
  }

  function cavalryDirectionInfo(direction) {
    const resolvedDirection = CAVALRY_VISUAL_DIRECTIONS.includes(direction) ? direction : "E";
    const sourceKey = CAVALRY_DIRECTION_SOURCE_KEY[resolvedDirection] || "E";
    return {
      direction: resolvedDirection,
      sourceKey,
      flip: !!CAVALRY_DIRECTION_FLIP[resolvedDirection],
    };
  }

  function cavalryDirectionSprite(team, direction) {
    const { sourceKey } = cavalryDirectionInfo(direction);
    const spriteSet = team === "enemy" ? cavalryEnemyDirectionSprites : cavalryPlayerDirectionSprites;
    const fallback = team === "enemy" ? cavalryWalkBlueSprite : cavalryWalkSprite;
    const sprite = spriteSet[sourceKey];
    return sprite?.naturalWidth > 0 ? sprite : fallback;
  }

  function cavalryPixiFrames(team, direction) {
    const { sourceKey } = cavalryDirectionInfo(direction);
    const frames = pixiCavalryDirectionTex[team]?.[sourceKey];
    return frames?.length ? frames : pixiWalkTex.cavalry[team];
  }

  function visualFacingLeftFromFormation(formation) {
    return formation.facing.x < -0.05;
  }

  function updateUnitVisualFacing(formation, unit) {
    const now = game.battleTime || 0;
    const speed = len(unit.vx, unit.vy);
    const MOVE_ENTER = 0.16;
    const MOVE_EXIT = 0.05;
    const FORMATION_LR_ENTER = 0.16;
    const VELOCITY_LR_ENTER = 0.24;
    const FORMATION_BACK_ENTER = -0.20;
    const FORMATION_BACK_EXIT = 0.12;
    const VELOCITY_BACK_ENTER = -0.42;
    const VELOCITY_BACK_EXIT = 0.16;
    const CHANGE_COOLDOWN = 0.45;
    const facing = normalize(formation.facing || vec());
    const hasFormationFacing = len(facing.x, facing.y) > 0.001;
    const velocityAligned = !hasFormationFacing || (unit.vx * facing.x + unit.vy * facing.y) > 0.02;
    const velocityFacing = speed > 0.001 ? normalize(vec(unit.vx, unit.vy)) : null;

    if (typeof unit.visualFacingLeft !== "boolean") {
      unit.visualFacingLeft = visualFacingLeftFromFormation(formation);
      unit.visualFacingChangedAt = -999;
    }
    if (typeof unit.visualFacingBack !== "boolean") {
      unit.visualFacingBack = false;
      unit.visualFacingBackChangedAt = -999;
    }
    if (typeof unit.visualMoving !== "boolean") {
      unit.visualMoving = speed > MOVE_ENTER;
    } else if (unit.visualMoving) {
      if (speed < MOVE_EXIT) unit.visualMoving = false;
    } else if (speed > MOVE_ENTER) {
      unit.visualMoving = true;
    }

    if (typeof unit.visualDirection !== "string") {
      unit.visualDirection = visualDirectionFromVector(hasFormationFacing ? facing : velocityFacing) || "E";
      unit.visualDirectionChangedAt = -999;
    }

    const directionVector = hasFormationFacing
      ? facing
      : (unit.visualMoving && velocityFacing ? velocityFacing : null);
    const nextDirection = visualDirectionFromVector(directionVector);
    if (nextDirection && nextDirection !== unit.visualDirection &&
        now - (unit.visualDirectionChangedAt ?? -999) >= CHANGE_COOLDOWN) {
      unit.visualDirection = nextDirection;
      unit.visualDirectionChangedAt = now;
    }

    let nextLeft = unit.visualFacingLeft;
    if (hasFormationFacing && facing.x < -FORMATION_LR_ENTER) {
      nextLeft = true;
    } else if (hasFormationFacing && facing.x > FORMATION_LR_ENTER) {
      nextLeft = false;
    } else if (unit.visualMoving && velocityAligned) {
      if (unit.vx < -VELOCITY_LR_ENTER) nextLeft = true;
      else if (unit.vx > VELOCITY_LR_ENTER) nextLeft = false;
    }
    if (nextLeft !== unit.visualFacingLeft &&
        now - (unit.visualFacingChangedAt ?? -999) >= CHANGE_COOLDOWN) {
      unit.visualFacingLeft = nextLeft;
      unit.visualFacingChangedAt = now;
    }

    let nextBack = unit.visualFacingBack;
    if (hasFormationFacing) {
      const diag = facing.x + facing.y;
      if (diag < FORMATION_BACK_ENTER) nextBack = true;
      else if (diag > FORMATION_BACK_EXIT) nextBack = false;
    } else if (unit.visualMoving && velocityAligned) {
      const diag = unit.vx + unit.vy;
      if (diag < VELOCITY_BACK_ENTER) nextBack = true;
      else if (diag > VELOCITY_BACK_EXIT) nextBack = false;
    }
    if (nextBack !== unit.visualFacingBack &&
        now - (unit.visualFacingBackChangedAt ?? -999) >= CHANGE_COOLDOWN) {
      unit.visualFacingBack = nextBack;
      unit.visualFacingBackChangedAt = now;
    }

    return {
      moving: unit.visualMoving,
      facingLeft: unit.visualFacingLeft,
      facingBack: unit.visualMoving && unit.visualFacingBack,
      direction: unit.visualDirection,
    };
  }

  function updateFormation(formation, enemySpatialHash, allSpatialHash, dt, fireHash) {
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
      const baseTerrainMult = (anchorTile === "mountain" || anchorTile === "river") ? 1.5 : 1.0;
      const cavalryTerrainExtra = formation.troopType === 'cavalry'
        ? ({ mountain: 1.8, river: 1.8, wetland: 1.5 }[anchorTile] ?? 1.0)
        : 1.0;
      const terrainMult = baseTerrainMult * cavalryTerrainExtra;
      const outOfPositionCount = alive.filter(u => {
        const slot = add(formation.anchor, worldFromLocal(formation, u.slotLocal));
        return len(slot.x - u.x, slot.y - u.y) >= POSITION_DEFENSE_THRESHOLD;
      }).length;
      const outRatio = outOfPositionCount / alive.length;
      if (outRatio > 0.02) {
        const distMult = 1 + outRatio * 8.0;
        const accumRate = 0.001 * terrainMult * distMult * (1 - formation.general.charm / 100 * 0.5);
        formation.disorderAccum = Math.min(1, formation.disorderAccum + accumRate * dt);
      } else {
        const charmRecovery = Math.max(0, (formation.general.charm - 50) / 50);
        const recoveryRate = 0.0005 * charmRecovery;
        formation.disorderAccum = Math.max(0, formation.disorderAccum - recoveryRate * dt);
      }
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
        let attackerBonus = (unit.isFirstRow || hasKihap) && slotDistance < FIRST_ROW_THRESHOLD
          ? formation._firstRowBonus
          : slotDistance < IN_POSITION_THRESHOLD ? 1.1 : 1.0;
        if (hasKihap && slotDistance < FIRST_ROW_THRESHOLD) {
          const kihapMult = formation.combatOverrides?.kihapAttackBonusMult ?? 1;
          attackerBonus = 1 + (formation._firstRowBonus - 1) * kihapMult;
        }

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
          ? 3.0
          : 1.0;

        if (enemyDist < 0.85) {
          // 근접 공격 (매 프레임 × dt) — 방어력 초과 시에도 최소 5% 피해 보장
          const rawAttack = unitAttack(formation) * attackerBonus * facingMult;
          const damage = Math.max(1, rawAttack - unitDefense(enemyTarget.formation, enemyTarget.unit) * defenderBonus * guardDefenseMult);
          applyUnitDamage(enemyTarget.formation, enemyTarget.unit, damage * dt, formation, { meleeEffect: true });
        } else if (canFormationRangedAttack(formation) && unit.rangedCooldown <= 0) {
          // 원거리 공격 (쿨타임 1초)
          const rangedDamage = Math.max(RANGED_MIN_DAMAGE, rangedAttack(formation) * facingMult
            * rangedDefenseDamageMult(enemyTarget.formation)
            - (enemyTarget.formation.troopType === 'cavalry' ? 2 : 0)
            - (enemyTarget.formation.combatOverrides?.rangedDefenseBonus ?? 0));
          applyUnitDamage(enemyTarget.formation, enemyTarget.unit, rangedDamage, formation);
          unit.rangedCooldown = 1.0;
          game.projectiles.push({
            ox: unit.x, oy: unit.y,
            x:  unit.x, y:  unit.y,
            tx: enemyTarget.unit.x, ty: enemyTarget.unit.y,
            t: 0, totalDist: len(enemyTarget.unit.x - unit.x, enemyTarget.unit.y - unit.y),
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
            const rdmg = Math.max(RANGED_MIN_DAMAGE, rangedAttack(formation) * rFacingMult
              * rangedDefenseDamageMult(rangedOnly.formation)
              - (rangedOnly.formation.troopType === 'cavalry' ? 2 : 0)
              - (rangedOnly.formation.combatOverrides?.rangedDefenseBonus ?? 0));
            applyUnitDamage(rangedOnly.formation, rangedOnly.unit, rdmg, formation);
            unit.rangedCooldown = 1.0;
            game.projectiles.push({
              ox: unit.x, oy: unit.y,
              x:  unit.x, y:  unit.y,
              tx: rangedOnly.unit.x, ty: rangedOnly.unit.y,
              t: 0, totalDist: len(rangedOnly.unit.x - unit.x, rangedOnly.unit.y - unit.y),
              team: formation.team
            });
          }
        }
      }

      if (slotDistance > formationSpacing(formation) * 1.8) desired = add(desired, mul(normalize(slotDelta), 1.35));

      const CROSS_SEP_RADIUS = 1.8;
      const unitRadius = getUnitRadius(formation);
      const nearbyAll = findNearbyUnits(allSpatialHash, unit.x, unit.y, CROSS_SEP_RADIUS);
      for (const entry of nearbyAll) {
        if (entry.unit === unit) continue;
        const isSameFormation = entry.formation.team === formation.team && entry.formation.id === formation.id;
        if (isSameFormation) continue;
        const dx = unit.x - entry.unit.x;
        const dy = unit.y - entry.unit.y;
        const d = len(dx, dy);
        if (d < 0.001) continue;
        const hardZone = unitRadius + getUnitRadius(entry.formation);
        const cavalryKnockMult = entry.formation.troopType === 'cavalry' ? 2.5 : 1.0;
        if (d < hardZone) {
          const overlap = (hardZone - d) / hardZone;
          desired = add(desired, mul({ x: dx / d, y: dy / d }, overlap * overlap * 4.0 * cavalryKnockMult));
        } else if (d < CROSS_SEP_RADIUS) {
          desired = add(desired, mul({ x: dx / d, y: dy / d }, (CROSS_SEP_RADIUS - d) / CROSS_SEP_RADIUS * 0.75 * cavalryKnockMult));
        }
      }

      // 화공 회피: desired 단계에서 방향 힌트 (정규화 전)
      if (fireHash) {
        for (const p of findNearbyFireParticles(fireHash, unit.x, unit.y, 1.3)) {
          const dfx = unit.x - p.x, dfy = unit.y - p.y;
          const df = len(dfx, dfy);
          if (df > 0.001)
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
      if (fireHash) {
        const FIRE_R = 1.2;
        for (const p of findNearbyFireParticles(fireHash, unit.x, unit.y, FIRE_R)) {
          const dfx = unit.x - p.x, dfy = unit.y - p.y;
          const df = len(dfx, dfy);
          if (df > 0.001) {
            const t = (FIRE_R - df) / FIRE_R;
            const strength = t * t * 12.0;
            unit.vx += (dfx / df) * strength * dt;
            unit.vy += (dfy / df) * strength * dt;
          }
        }
      }

      // 오브젝트 타일 통과 차단: 타일 중심에서 강한 반발력
      {
        const objMap = game.terrainRender.objectMap;
        const buildingMap = game.terrainRender.buildingMap;
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
        if (buildingMap) {
          const BUILDING_R = 2.35;
          for (let dy = -4; dy <= 4; dy++) {
            for (let dx = -4; dx <= 4; dx++) {
              const tx = clamp(Math.floor(unit.x) + dx, 0, MAP_WIDTH - 1);
              const ty = clamp(Math.floor(unit.y) + dy, 0, MAP_HEIGHT - 1);
              if (!buildingMap[ty][tx]) continue;
              const ex = unit.x - (tx + 1.0), ey = unit.y - (ty + 1.0);
              const d = len(ex, ey);
              if (d < BUILDING_R && d > 0.001) {
                const t = (BUILDING_R - d) / BUILDING_R;
                unit.vx += (ex / d) * t * t * 42.0 * dt;
                unit.vy += (ey / d) * t * t * 42.0 * dt;
              }
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

    // ── 적군 스킬 자동 발동 ───────────────────────────────────────────
    liveEnemies.forEach(formation => {
      if (formation.skillCooldown <= 0 && Math.random() < 0.40) {
        activateSkill(formation);
      }
    });
  }

  function applyPositionCorrection(allSpatialHash) {
    const allFormations = orderedAllFormations();
    const maxRadius = allFormations.reduce((max, f) => Math.max(max, getUnitRadius(f)), UNIT_RADIUS);
    const searchRadius = maxRadius * 2;
    allFormations.forEach((formation) => {
      formation.units.filter(isUnitAlive).forEach((unit) => {
        const nearby = findNearbyUnits(allSpatialHash, unit.x, unit.y, searchRadius);
        for (const entry of nearby) {
          if (entry.unit === unit) continue;
          const minDist = getUnitRadius(formation) + getUnitRadius(entry.formation);
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
    if (isHistoricalMode() && game.battlePhase === "live" && game.scenarioSceneLocked) return;
    if (game.battlePhase === "live") {
      game.battleTime += dt;

      const PLAYER_RETREAT_X = 8;
      const ENEMY_RETREAT_X = MAP_WIDTH - 8;
      const retreatXForFormation = (formation, fallbackX) => {
        if (isOnlineMode() && formation.worldSide != null) {
          return formation.worldSide === 0 ? 0 : MAP_WIDTH;
        }
        return fallbackX;
      };
      const reachedRetreatEdge = (formation, fallbackTeam) => {
        if (isOnlineMode() && formation.worldSide != null) {
          return formation.worldSide === 0
            ? formation.anchor.x < PLAYER_RETREAT_X
            : formation.anchor.x > ENEMY_RETREAT_X;
        }
        return fallbackTeam === "player"
          ? formation.anchor.x < PLAYER_RETREAT_X
          : formation.anchor.x > ENEMY_RETREAT_X;
      };

      const allFormations = orderedAllFormations();
      allFormations.forEach((formation) => {
        formation.units.forEach((unit) => {
          if ((unit.damageEffectTimer || 0) > 0) {
            unit.damageEffectTimer = Math.max(0, unit.damageEffectTimer - dt);
          }
        });
      });
      allFormations.forEach((formation) => {
        if (!formation.retreated && formation.units.some(isUnitAlive) && reachedRetreatEdge(formation, formation.team)) {
          formation.retreated = true;
          formation.units.forEach((u) => { u.damage = 100; });
        }
        if (!formation.followTarget) return;
        const alive = formation.followTarget.units.some(isUnitAlive);
        if (!alive) {
          if (enemyTargetTooltipEnemy === formation.followTarget) {
            enemyTargetTooltip.hidden = true;
            enemyTargetTooltipEnemy = null;
            clearTimeout(enemyTargetTooltipTimer);
          }
          formation.followTarget = null;
          formation.target = null;
          formation.targetSetTime = -999;
          return;
        }
        formation.target = formationCenter(formation.followTarget);
      });

      const checkAutoRetreat = (formation, retreatX) => {
        if (formation.retreated || formation.retreating) return;
        if (!formation.units.some(isUnitAlive)) return;
        if (formation.disorder < 0.7) return;
        // 혼란도 0.1 증가마다 체크포인트 발동 (0.7, 0.8, 0.9, 1.0)
        const checkpoint = Math.floor(formation.disorder * 10) / 10;
        if (checkpoint <= Number(formation.retreatLastCheckpoint || 0)) return;
        formation.retreatLastCheckpoint = checkpoint;
        // 혼란도가 높을수록, 매력이 낮을수록 후퇴 확률 상승
        const retreatChance = (checkpoint - 0.6) * 0.6 * (1 - formation.general.charm / 100 * 0.5);
        const retreatRoll = isOnlineMode()
          ? onlineDeterministicRoll(game.online.seed, "retreat", formation.worldSide ?? formation.team, formation.id, checkpoint)
          : Math.random();
        if (retreatRoll < retreatChance) {
          formation.retreating = true;
          showRetreatSpeech(formation);
          formation.speed = "FAST";
          formation.followTarget = null;
          formation.target = vec(retreatX, formation.anchor.y);
        }
      };
      allFormations.forEach((f) => checkAutoRetreat(f, retreatXForFormation(f, f.team === "player" ? 0 : MAP_WIDTH)));
      allFormations.forEach((f) => { if (f.kihapCooldown > 0) f.kihapCooldown -= dt; });

      const allSpatialHash = buildSpatialHash(allFormations);
      const fireHash = game.fires.length ? buildFireParticleHash(game.fires) : null;
      const playerSpatialHash = buildSpatialHash(game.playerFormations);
      const enemySpatialHash = buildSpatialHash(game.enemyFormations);
      game.playerFormations.forEach((formation) => updateFormation(formation, enemySpatialHash, allSpatialHash, dt, fireHash));
      game.enemyFormations.forEach((formation) => updateFormation(formation, playerSpatialHash, allSpatialHash, dt, fireHash));
      applyPositionCorrection(allSpatialHash);
      if (isHistoricalMode()) updateHistoricalAI(dt);
      else if (!isOnlineMode()) updateAI(dt);
      updateSkills(dt);
      updateSpeechTriggers();
      checkBattleEnd();
      updateBattleEndPending(dt);
      updateHistoricalScenario(dt);

      const PROJ_SPEED = 4.5;
      game.projectiles = game.projectiles.filter((p) => {
        if (!p.totalDist || p.totalDist < 0.01) return false;
        p.t += (PROJ_SPEED * dt) / p.totalDist;
        if (p.t >= 1.0) return false;
        p.x = p.ox + (p.tx - p.ox) * p.t;
        p.y = p.oy + (p.ty - p.oy) * p.t;
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
    game.terrainRender.prefetchQueue.length = 0;
    game.terrainRender.prefetchGen++;
    game.terrainRender._prefetchScheduled = false;
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

    const clusterPadX = game.tileW * 4.5;
    const clusterPadY = tileH * 4.5;
    minIsoX -= clusterPadX;
    maxIsoX += clusterPadX;
    minIsoY -= clusterPadY;
    maxIsoY += clusterPadY;

    const canvasChunk = createSurface(maxIsoX - minIsoX, maxIsoY - minIsoY);
    const chunkCtx = canvasChunk.getContext("2d");

    // 청크 bake 전반에서 공유하는 임시 캔버스 — createSurface를 타일마다 호출하지 않고 재사용
    const tileW1 = game.tileW + 4;
    const tileH1 = Math.ceil(getTileH()) + 4;
    const sharedTmp = createSurface(tileW1, tileH1);
    const sharedTmpCtx = sharedTmp.getContext("2d");

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

    function punchWetlandDots(ctx, canvasW, canvasH, tileX, tileY) {
      const previousComposite = ctx.globalCompositeOperation;
      ctx.globalCompositeOperation = "destination-out";
      const numDots = 2 + tileHash(tileX * 7, tileY * 11) % 4;
      for (let i = 0; i < numDots; i++) {
        const rx = (tileHash(tileX * 1031 + i * 997,  tileY * 1013 + i * 983) % 10000) / 10000;
        const ry = (tileHash(tileX * 1013 + i * 991,  tileY * 1031 + i * 977) % 10000) / 10000;
        const rr = (tileHash(tileX * 1049 + i * 971,  tileY * 1021 + i * 967) % 10000) / 10000;
        const dcx = (0.15 + rx * 0.70) * canvasW;
        const dcy = (0.15 + ry * 0.70) * canvasH;
        const dr  = (0.08 + rr * 0.18) * game.tileW;
        const grad = ctx.createRadialGradient(dcx, dcy, 0, dcx, dcy, dr);
        grad.addColorStop(0,    "rgba(0,0,0,1)");
        grad.addColorStop(0.70, "rgba(0,0,0,1)");
        grad.addColorStop(1,    "rgba(0,0,0,0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(dcx, dcy, dr, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = previousComposite;
    }

    function traceTileDiamond(ctx, px, py, overlap = 0.85) {
      const halfW = tileWidth / 2 + overlap;
      const halfH = tileH / 2 + overlap * 0.45;
      ctx.moveTo(px, py - overlap * 0.2);
      ctx.lineTo(px + halfW, py + halfH);
      ctx.lineTo(px, py + tileH + overlap * 0.2);
      ctx.lineTo(px - halfW, py + halfH);
      ctx.closePath();
    }

    function worldPatternFor(ctx, tile, offsetX = 0, offsetY = 0) {
      const texture = terrainWorldTexture(tile);
      if (!texture?.naturalWidth) return null;
      const pattern = ctx.createPattern(texture, "repeat");
      if (!pattern) return null;
      if (typeof DOMMatrix !== "undefined" && typeof pattern.setTransform === "function") {
        const transform = new DOMMatrix();
        transform.a = TERRAIN_WORLD_TEXTURE_SCALE;
        transform.d = TERRAIN_WORLD_TEXTURE_SCALE;
        transform.e = -minIsoX - offsetX;
        transform.f = -minIsoY - offsetY;
        pattern.setTransform(transform);
      }
      return pattern;
    }

    function fillWorldDiamond(ctx, tile, x, y, px, py, options = {}) {
      const w = options.width ?? (tileWidth + 1);
      const h = options.height ?? (tileH + 1);
      const drawX = px - w / 2;
      const drawY = py - 0.25;
      // sharedTmp 재사용: 크기가 충분하면 clearRect로 초기화, 아니면 새로 할당
      let tmp, tc;
      if (sharedTmp.width >= w + 2 && sharedTmp.height >= h + 2) {
        tmp = sharedTmp; tc = sharedTmpCtx;
        tc.clearRect(0, 0, tmp.width, tmp.height);
        tc.globalCompositeOperation = "source-over";
        tc.globalAlpha = 1;
      } else {
        tmp = createSurface(w + 2, h + 2); tc = tmp.getContext("2d");
      }
      const pattern = worldPatternFor(tc, tile, drawX, drawY);
      if (!pattern) return false;

      tc.imageSmoothingEnabled = true;
      tc.imageSmoothingQuality = "high";
      tc.filter = terrainWorldToneFilter(tile);
      tc.fillStyle = pattern;
      tc.fillRect(0, 0, w + 2, h + 2);
      tc.filter = "none";
      if (options.punchWetland) punchWetlandDots(tc, w, h, x, y);

      tc.globalCompositeOperation = "destination-in";
      tc.beginPath();
      traceTileDiamond(tc, w / 2, 0.25, 0.8);
      tc.fillStyle = "#fff";
      tc.fill();
      tc.globalCompositeOperation = "source-over";

      ctx.drawImage(tmp, 0, 0, w + 2, h + 2, drawX, drawY, w + 2, h + 2);
      return true;
    }

    if (terrainSprites.ready) {
      chunkCtx.imageSmoothingEnabled = true;
      chunkCtx.imageSmoothingQuality = "high";

      // Pass 2A: 월드 좌표 기반 1×1 베이스 — 지형별 경로를 묶어 연속 샘플링
      ["river", "plain", "grassland", "road", "mountain"].forEach((terrainType) => {
        const pattern = worldPatternFor(chunkCtx, terrainType);
        if (!pattern) return;

        chunkCtx.save();
        chunkCtx.beginPath();
        let hasTiles = false;
        tiles.forEach(([, x, y]) => {
          if (game.terrain.tiles[y][x] !== terrainType) return;
          const iso = isoPoint(x, y);
          traceTileDiamond(chunkCtx, iso.x - minIsoX, iso.y - minIsoY);
          hasTiles = true;
        });
        if (hasTiles) {
          chunkCtx.clip();
          chunkCtx.filter = terrainWorldToneFilter(terrainType);
          chunkCtx.fillStyle = pattern;
          chunkCtx.fillRect(0, 0, canvasChunk.width, canvasChunk.height);
          chunkCtx.filter = "none";
        }
        chunkCtx.restore();
      });

      // 습지는 물 텍스처 위에 습지 텍스처를 얹고 작은 구멍으로 물을 노출시킨다.
      tiles.forEach(([, x, y]) => {
        if (game.terrain.tiles[y][x] !== "wetland") return;
        const iso = isoPoint(x, y);
        const px = iso.x - minIsoX;
        const py = iso.y - minIsoY;
        fillWorldDiamond(chunkCtx, "river", x, y, px, py);
        fillWorldDiamond(chunkCtx, "wetland", x, y, px, py, { punchWetland: true });
      });
    }

    const detailPatchSettingsFor = (terrainType) => {
      if (!TERRAIN_DETAIL_PATCH_INDICES[terrainType]?.length) return null;
      return {
        baseAlpha: terrainType === "grassland" ? 0.58 : 0.38,
        drawChance: terrainType === "grassland" ? 0.40 : 0.36,
      };
    };

    const drawDetailPatchAt = (ctx, terrainType, x, y, originX, originY, alphaScale = 1) => {
      const patchIndices = TERRAIN_DETAIL_PATCH_INDICES[terrainType];
      const settings = detailPatchSettingsFor(terrainType);
      if (!patchIndices?.length || !settings) return false;
      if (x < 0 || y < 0 || x >= MAP_WIDTH || y >= MAP_HEIGHT) return false;

      const hash = tileHash(x * 3187 + (terrainType === "grassland" ? 113 : 197), y * 3761 + (terrainType === "grassland" ? 191 : 263));
      if ((hash % 1000) / 1000 > settings.drawChance) return false;

      const patchGroupHash = tileHash(Math.floor(x / 5) * 1553 + 31, Math.floor(y / 5) * 1877 + 47);
      const patchIndex = patchIndices[(patchGroupHash + (hash >>> 8)) % patchIndices.length];
      const patchImg = terrainSprites.clusters[patchIndex];
      const def = TERRAIN_CLUSTER_DEFS[patchIndex];
      if (!patchImg?.naturalWidth || !def) return false;

      const iso = isoPoint(x, y);
      const px = iso.x - originX + (((hash >>> 12) % 1000) / 1000 - 0.5) * game.tileW * 1.5;
      const py = iso.y - originY + (((hash >>> 22) % 1000) / 1000 - 0.5) * tileH * 1.4;
      const jitterScale = 0.76 + ((hash >>> 4) % 1000) / 1000 * 0.34;
      const assetSizeScale = patchImg.naturalWidth / TERRAIN_CLUSTER_BASE_ASSET_WIDTH;
      const drawW = game.tileW * TERRAIN_DETAIL_PATCH_BASE_DRAW_TILES * assetSizeScale * (def.scale ?? 1) * jitterScale;
      const drawH = Math.round(drawW * patchImg.naturalHeight / patchImg.naturalWidth);
      const flip = ((hash >>> 10) & 1);
      ctx.globalAlpha = TERRAIN_DETAIL_PATCH_OPACITY * settings.baseAlpha * alphaScale * (0.82 + ((hash >>> 2) % 1000) / 1000 * 0.24);
      ctx.save();
      if (flip) {
        ctx.translate(px, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(patchImg, -drawW / 2, py - drawH * 0.44, drawW, drawH);
      } else {
        ctx.drawImage(patchImg, px - drawW / 2, py - drawH * 0.44, drawW, drawH);
      }
      ctx.restore();
      return true;
    };

    const drawMaskedDetailPatchTile = (ctx, terrainType, tileX, tileY, drawX, drawY, w, h, maskCv = null) => {
      if (!TERRAIN_DETAIL_PATCH_ENABLED || !terrainSprites.ready || !terrainSprites.clusters?.length) return false;
      if (!TERRAIN_DETAIL_PATCH_INDICES[terrainType]?.length) return false;

      // sharedTmp 재사용
      let tmp, tc;
      if (sharedTmp.width >= w + 2 && sharedTmp.height >= h + 2) {
        tmp = sharedTmp; tc = sharedTmpCtx;
        tc.clearRect(0, 0, tmp.width, tmp.height);
        tc.globalCompositeOperation = "source-over";
        tc.globalAlpha = 1;
      } else {
        tmp = createSurface(w + 2, h + 2); tc = tmp.getContext("2d");
      }
      tc.imageSmoothingEnabled = true;
      tc.imageSmoothingQuality = "high";
      const prevAlpha = tc.globalAlpha;
      const localPad = 3;
      for (let ay = tileY - localPad; ay <= tileY + localPad; ay += 1) {
        for (let ax = tileX - localPad; ax <= tileX + localPad; ax += 1) {
          drawDetailPatchAt(tc, terrainType, ax, ay, minIsoX + drawX, minIsoY + drawY, 0.88);
        }
      }
      tc.globalAlpha = prevAlpha;
      tc.globalCompositeOperation = "destination-in";
      if (maskCv) {
        tc.drawImage(maskCv, 0, 0, w, h);
      } else {
        tc.beginPath();
        traceTileDiamond(tc, w / 2, 0.25, 0.8);
        tc.fillStyle = "#fff";
        tc.fill();
      }
      tc.globalCompositeOperation = "source-over";
      ctx.drawImage(tmp, 0, 0, w + 2, h + 2, drawX, drawY, w + 2, h + 2);
      return true;
    };

    // 경계 타일에서 월드 텍스처 + 디테일 패치를 단일 temp 캔버스에 합성 후 마스크 1회 적용
    const drawBorderTile = (ctx, terrainType, tileX, tileY, px, py, options = {}, maskCv = null, quarterDir = null) => {
      const w = options.width ?? (tileWidth + 1);
      const h = options.height ?? (tileH + 1);
      const drawX = px - w / 2;
      const drawY = py - 0.25;

      let tmp, tc;
      if (sharedTmp.width >= w + 2 && sharedTmp.height >= h + 2) {
        tmp = sharedTmp; tc = sharedTmpCtx;
        tc.clearRect(0, 0, tmp.width, tmp.height);
        tc.globalCompositeOperation = "source-over";
        tc.globalAlpha = 1;
      } else {
        tmp = createSurface(w + 2, h + 2); tc = tmp.getContext("2d");
      }

      const pattern = worldPatternFor(tc, terrainType, drawX, drawY);
      if (!pattern) return false;
      tc.imageSmoothingEnabled = true;
      tc.imageSmoothingQuality = "high";
      tc.filter = terrainWorldToneFilter(terrainType);
      tc.fillStyle = pattern;
      tc.fillRect(0, 0, w + 2, h + 2);
      tc.filter = "none";
      if (options.punchWetland) punchWetlandDots(tc, w, h, tileX, tileY);

      if (TERRAIN_DETAIL_PATCH_ENABLED && terrainSprites.clusters?.length && TERRAIN_DETAIL_PATCH_INDICES[terrainType]?.length) {
        const localPad = 3;
        for (let ay = tileY - localPad; ay <= tileY + localPad; ay++) {
          for (let ax = tileX - localPad; ax <= tileX + localPad; ax++) {
            drawDetailPatchAt(tc, terrainType, ax, ay, minIsoX + drawX, minIsoY + drawY, 0.88);
          }
        }
      }

      tc.globalAlpha = 1;
      tc.globalCompositeOperation = "destination-in";
      if (maskCv) {
        tc.drawImage(maskCv, 0, 0, w, h);
      } else if (quarterDir) {
        // 단일 면 사분면 클립: 다이아몬드 꼭짓점 좌표 (traceTileDiamond와 동일)
        const overlap = 0.8;
        const qpx = w / 2, qpy = 0.25;
        const halfW = tileWidth / 2 + overlap;
        const halfH = tileH / 2 + overlap * 0.45;
        const topX = qpx,          topY = qpy - overlap * 0.2;
        const rightX = qpx + halfW, rightY = qpy + halfH;
        const botX = qpx,          botY = qpy + tileH + overlap * 0.2;
        const leftX = qpx - halfW,  leftY = qpy + halfH;
        const cqx = qpx, cqy = (topY + botY) / 2;
        let v0x, v0y, v1x, v1y;
        if      (quarterDir === "ULLL") { v0x = topX;   v0y = topY;   v1x = leftX;  v1y = leftY;  }
        else if (quarterDir === "LULL") { v0x = topX;   v0y = topY;   v1x = rightX; v1y = rightY; }
        else if (quarterDir === "LLUL") { v0x = rightX; v0y = rightY; v1x = botX;   v1y = botY;   }
        else                            { v0x = botX;   v0y = botY;   v1x = leftX;  v1y = leftY;  }
        tc.beginPath();
        tc.moveTo(cqx, cqy); tc.lineTo(v0x, v0y); tc.lineTo(v1x, v1y);
        tc.closePath();
        // 외부 모서리 → 중심 방향으로 페이드아웃
        const midEdgeX = (v0x + v1x) / 2, midEdgeY = (v0y + v1y) / 2;
        const grad = tc.createLinearGradient(midEdgeX, midEdgeY, cqx, cqy);
        grad.addColorStop(0, "rgba(255,255,255,1)");
        grad.addColorStop(1, "rgba(255,255,255,0)");
        tc.fillStyle = grad;
        tc.fill();
      } else {
        tc.beginPath();
        traceTileDiamond(tc, w / 2, 0.25, 0.8);
        tc.fillStyle = "#fff";
        tc.fill();
      }
      tc.globalCompositeOperation = "source-over";
      ctx.drawImage(tmp, 0, 0, w + 2, h + 2, drawX, drawY, w + 2, h + 2);
      return true;
    };

    if (TERRAIN_DETAIL_PATCH_ENABLED && terrainSprites.ready && terrainSprites.clusters?.length) {
      chunkCtx.imageSmoothingEnabled = true;
      chunkCtx.imageSmoothingQuality = "high";
      const prevAlpha = chunkCtx.globalAlpha;

      const drawDetailPatchTerrain = (terrainType) => {
        const patchIndices = TERRAIN_DETAIL_PATCH_INDICES[terrainType];
        if (!patchIndices?.length) return;

        chunkCtx.save();
        chunkCtx.beginPath();
        let hasTerrainTiles = false;
        tiles.forEach(([, x, y]) => {
          if (game.terrain.tiles[y][x] !== terrainType) return;
          const iso = isoPoint(x, y);
          traceTileDiamond(chunkCtx, iso.x - minIsoX, iso.y - minIsoY);
          hasTerrainTiles = true;
        });
        if (!hasTerrainTiles) {
          chunkCtx.restore();
          return;
        }
        chunkCtx.clip();

        const anchorPad = 7;
        const anchorStartX = Math.max(0, startX - anchorPad);
        const anchorStartY = Math.max(0, startY - anchorPad);
        const anchorEndX = Math.min(MAP_WIDTH, endX + anchorPad);
        const anchorEndY = Math.min(MAP_HEIGHT, endY + anchorPad);

        for (let y = anchorStartY; y < anchorEndY; y += 1) {
          for (let x = anchorStartX; x < anchorEndX; x += 1) {
            if (game.terrain.tiles[y][x] !== terrainType) continue;
            drawDetailPatchAt(chunkCtx, terrainType, x, y, minIsoX, minIsoY);
          }
        }
        chunkCtx.restore();
      };

      drawDetailPatchTerrain("plain");
      drawDetailPatchTerrain("grassland");
      drawDetailPatchTerrain("mountain");
      chunkCtx.globalAlpha = prevAlpha;
    }

    // Pass 2C: 경계 타일 — 상위 지형 월드 텍스처에 1×1 알파 마스크 적용
    chunkCtx.imageSmoothingEnabled = true;
    chunkCtx.imageSmoothingQuality = "high";

    tiles.forEach(([, x, y]) => {
      const bd = game.terrainRender.borderData[y][x];
      if (!bd) return;
      if (!terrainSprites.ready || !TERRAIN_1X1_MASK_ENABLED) return;

      const iso = isoPoint(x, y);
      const px = iso.x - minIsoX;
      const py = iso.y - minIsoY;

      for (const { upperT, maskDir } of bd.layers) {
        const punchWetland = upperT === "wetland";
        if (maskDir === "center") {
          drawBorderTile(chunkCtx, upperT, x, y, px, py, { punchWetland });
        } else if (maskDir === "ULLL" || maskDir === "LULL" || maskDir === "LLUL" || maskDir === "LLLU") {
          drawBorderTile(chunkCtx, upperT, x, y, px, py, { width: tileWidth, punchWetland }, null, maskDir);
        } else if (maskDir) {
          const maskArr = terrainSprites.masks[maskDir];
          const maskCv = maskArr?.length ? maskArr[tileHash(x, y) % maskArr.length] : null;
          if (!maskCv) continue;
          drawBorderTile(chunkCtx, upperT, x, y, px, py, { width: tileWidth, punchWetland }, maskCv);
        }
      }
    });

    // Pass 3A: 험준산악 — 청크 정렬 보장, 단일 청크 내 안전 렌더링
    const ruggedSprites = terrainSprites.ruggedMtn;
    if (ruggedSprites?.length) {
      chunkCtx.imageSmoothingEnabled = true;
      chunkCtx.imageSmoothingQuality = "high";
      const ruggedAnchors = [];
      const ruggedStartX = Math.max(0, startX - RUGGED_MTN_SIZE);
      const ruggedStartY = Math.max(0, startY - RUGGED_MTN_SIZE);
      const ruggedEndX = Math.min(MAP_WIDTH, endX + RUGGED_MTN_SIZE);
      const ruggedEndY = Math.min(MAP_HEIGHT, endY + RUGGED_MTN_SIZE);
      for (let y = ruggedStartY; y < ruggedEndY; y += 1) {
        for (let x = ruggedStartX; x < ruggedEndX; x += 1) {
          if (game.terrainRender.ruggedMtn[y][x] === 1) ruggedAnchors.push([x + y, x, y]);
        }
      }
      ruggedAnchors.sort((a, b) => a[0] - b[0]);
      ruggedAnchors.forEach(([, x, y]) => {
        if (game.terrainRender.ruggedMtn[y][x] !== 1) return;
        const ruggedImg = ruggedSprites[game.terrainRender.ruggedMtnVariant?.[y]?.[x] % ruggedSprites.length];
        if (!ruggedImg?.naturalWidth) return;
        const iso = isoPoint(x, y);
        const px  = iso.x - minIsoX;
        const py  = iso.y - minIsoY;
        const w   = game.tileW * 8;
        const h   = tileH * 8;
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
    const buildingSprites = terrainSprites.buildings;
    if (buildingSprites?.length && game.terrainRender.buildingMap) {
      chunkCtx.imageSmoothingEnabled = true;
      chunkCtx.imageSmoothingQuality = "high";
      const prevAlpha = chunkCtx.globalAlpha;
      chunkCtx.globalAlpha = 0.8;
      tiles.forEach(([, x, y]) => {
        const buildingIndex = game.terrainRender.buildingMap[y][x] - 1;
        if (buildingIndex < 0) return;
        const buildingImg = buildingSprites[buildingIndex % buildingSprites.length];
        if (!buildingImg?.naturalWidth) return;
        const iso = isoPoint(x + 1, y + 1);
        const px = iso.x - minIsoX;
        const py = iso.y - minIsoY;
        const w = game.tileW * 2;
        const h = Math.round(w * buildingImg.naturalHeight / buildingImg.naturalWidth);
        chunkCtx.drawImage(buildingImg, px - w / 2, py + tileH * 0.5 - h, w, h);
      });
      chunkCtx.globalAlpha = prevAlpha;
    }

    const trees = [];
    const treeImages = (terrainSprites.trees || []).filter(img => img?.naturalWidth);
    if (!treeImages.length && terrainSprites.tree?.naturalWidth) treeImages.push(terrainSprites.tree);
    if (TERRAIN_TREE_RENDER_ENABLED && treeImages.length) {
      const treeBaseH = game.tileW * 22 / 24;
      const treeVariantScale = (variantIndex) => TREE_VARIANT_HEIGHT_SCALE[variantIndex % TREE_VARIANT_HEIGHT_SCALE.length] ?? 1;
      const treeDrawSize = (img, variantIndex, scale = 1) => {
        const stH = Math.round(treeBaseH * scale * treeVariantScale(variantIndex));
        const stW = Math.max(1, Math.round(stH * img.naturalWidth / img.naturalHeight));
        return { stW, stH };
      };
      const chooseTreeVariant = (tx, ty, ruggedVal, edgeWeight, slotIndex) => {
        const variantCount = treeImages.length;
        if (variantCount <= 1) return 0;
        const h = tileHash(tx * 2671 + slotIndex * 97, ty * 3253 + slotIndex * 131);
        const pool = ruggedVal === 2
          ? [0, 0, 1, 1, 2, 3, 7]
          : edgeWeight > 0
            ? [0, 1, 3, 4, 5, 6, 7]
            : [0, 0, 1, 1, 2, 3, 4, 5, 6, 7];
        return pool[h % pool.length] % variantCount;
      };
      const drawTreeShadow = ({ worldBx, worldBy, scale, variantIndex }) => {
        const treeImg = treeImages[variantIndex % treeImages.length] || treeImages[0];
        const { stW, stH } = treeDrawSize(treeImg, variantIndex, scale ?? 1);
        const localX = worldBx - minIsoX;
        const localY = worldBy - minIsoY;
        const shadowW = clamp(stW * 0.98, game.tileW * 0.78, game.tileW * 2.20);
        const shadowH = clamp(tileH * (0.34 + stW / Math.max(stH, 1) * 0.18), tileH * 0.32, tileH * 0.78);
        const shadowAlpha = clamp(0.24 + stW / Math.max(game.tileW * 3.5, 1) * 0.13, 0.24, 0.42);

        chunkCtx.save();
        chunkCtx.globalCompositeOperation = "multiply";
        chunkCtx.translate(localX + game.tileW * 0.12, localY + tileH * 0.18);
        chunkCtx.scale(shadowW / 2, shadowH / 2);
        const grad = chunkCtx.createRadialGradient(0, 0, 0, 0, 0, 1);
        grad.addColorStop(0, `rgba(24,30,18,${shadowAlpha})`);
        grad.addColorStop(0.68, `rgba(24,30,18,${shadowAlpha * 0.58})`);
        grad.addColorStop(1, "rgba(24,30,18,0)");
        chunkCtx.fillStyle = grad;
        chunkCtx.beginPath();
        chunkCtx.arc(0, 0, 1, 0, Math.PI * 2);
        chunkCtx.fill();
        chunkCtx.restore();
      };
      const canUseSparseTreeTile = (x, y, terrainType) => {
        if (x < 0 || y < 0 || x >= MAP_WIDTH || y >= MAP_HEIGHT) return false;
        if (game.terrain.tiles[y][x] !== terrainType) return false;
        if (game.terrainRender.isBorder?.[y]?.[x]) return false;
        if (game.terrainRender.objectMap?.[y]?.[x] || game.terrainRender.buildingMap?.[y]?.[x]) return false;
        return true;
      };
      const sparseTreeClusterSlots = (x, y, terrainType) => {
        const targetCount = 2 + (tileHash(x * 1699 + 41, y * 2069 + 73) % 3);
        const offsets = [
          [1, 0], [-1, 0], [0, 1], [0, -1],
          [1, 1], [-1, -1], [1, -1], [-1, 1],
          [2, 0], [-2, 0], [0, 2], [0, -2],
        ].sort((a, b) => {
          const ah = tileHash((x + a[0]) * 2221 + 11, (y + a[1]) * 2551 + 17);
          const bh = tileHash((x + b[0]) * 2221 + 11, (y + b[1]) * 2551 + 17);
          return ah - bh;
        });
        const slots = canUseSparseTreeTile(x, y, terrainType) ? [{ tx: x, ty: y }] : [];
        for (const [dx, dy] of offsets) {
          if (slots.length >= targetCount) break;
          const sx = x + dx;
          const sy = y + dy;
          if (canUseSparseTreeTile(sx, sy, terrainType)) slots.push({ tx: sx, ty: sy });
        }
        return slots.length ? slots : [{ tx: x, ty: y }];
      };

      for (let ty = startY; ty < endY; ty++) {
        for (let tx = startX; tx < endX; tx++) {
          const tile = game.terrain.tiles[ty][tx];
          const isMountainTree = tile === "mountain";
          if (!isMountainTree && tile !== "grassland") continue;
          if (!isMountainTree) {
            if (!canUseSparseTreeTile(tx, ty, tile)) continue;
            const sparseRoll = (tileHash(tx * 4337 + 17, ty * 4933 + 29) % 100000) / 100000;
            const sparseChance = tile === "grassland" ? 0.0045 : 0.0012;
            if (sparseRoll > sparseChance) continue;
          }
          const ruggedVal = isMountainTree ? game.terrainRender.ruggedMtn[ty][tx] : 0;

          // 험준산악 경계 판별 — 인접 블록 여부와 무관하게 블록 내 상대 위치로 결정
          let edgeWeight = 0; // 0: 내부(스킵), 1: 북서/북동 변, 2: 남서/남동 외곽 변, 1(2nd): 남서/남동 2번째 행/열
          if (isMountainTree && ruggedVal === 2) {
            const ax = Math.floor(tx / CHUNK_TILES) * CHUNK_TILES;
            const ay = Math.floor(ty / CHUNK_TILES) * CHUNK_TILES;
            const relX = tx - ax; // 0..15
            const relY = ty - ay; // 0..15
            const C = CHUNK_TILES - 1; // 15

            // 남서(relY 최대)/남동(relX 최대) 방향이 가장 잘 보이는 변 → 2타일 두께
            const onSW  = relY === C;       // 남서쪽 외곽 변
            const onSE  = relX === C;       // 남동쪽 외곽 변
            const onSW2 = relY === C - 1;   // 남서쪽 2번째 행
            const onSE2 = relX === C - 1;   // 남동쪽 2번째 열
            const onNW  = relX === 0;       // 북서쪽 변
            const onNE  = relY === 0;       // 북동쪽 변

            if      (onSW || onSE)          edgeWeight = 2;
            else if (onSW2 || onSE2)        edgeWeight = 1;
            else if (onNW  || onNE)         edgeWeight = 1;
            edgeWeight = game.terrainRender.ruggedMtnEdge?.[ty]?.[tx] ?? edgeWeight;
            if (edgeWeight === 0) continue; // 내부 타일: 나무 없음
          } else if (isMountainTree && ruggedVal !== 0) {
            continue; // 앵커 타일(=1): 건너뜀
          }

          const iso = isoPoint(tx, ty);
          const cx  = iso.x - minIsoX;
          const cy  = iso.y - minIsoY + tileH / 2;

          let s = tileHash(tx, ty) >>> 0;
          const rng = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 0xFFFFFFFF; };

          const r = rng();
          // 험준산악 가장자리: 모든 변 동일하게 0~2그루
          const sparseSlots = isMountainTree ? null : sparseTreeClusterSlots(tx, ty, tile);
          const count = isMountainTree
            ? (ruggedVal === 0
              ? (r < 0.1 ? 0 : r < 0.4 ? 2 : 1)
              : (r < 0.25 ? 0 : r < 0.65 ? 1 : 2))
            : sparseSlots.length;
          for (let i = 0; i < count; i++) {
            const treeTx = isMountainTree ? tx : sparseSlots[i].tx;
            const treeTy = isMountainTree ? ty : sparseSlots[i].ty;
            const treeIso = isMountainTree ? iso : isoPoint(treeTx, treeTy);
            const treeCx = treeIso.x - minIsoX;
            const treeCy = treeIso.y - minIsoY + tileH / 2;
            let bx, by;
            for (let attempt = 0; attempt < 8; attempt++) {
              const rx = (rng() - 0.5) * game.tileW;
              const ry = (rng() - 0.5) * tileH;
              if (Math.abs(rx) / (game.tileW / 2) + Math.abs(ry) / (tileH / 2) <= 1) {
                bx = treeCx + rx;
                by = treeCy + ry;
                break;
              }
            }
            if (bx === undefined) { bx = treeCx; by = treeCy; }
            const scale = 0.85 + rng() * 0.30;
            const variantIndex = chooseTreeVariant(treeTx, treeTy, ruggedVal, isMountainTree ? edgeWeight : 1, i);
            trees.push({ worldBx: bx + minIsoX, worldBy: by + minIsoY, tileX: treeTx, tileY: treeTy, scale, variantIndex });
          }
        }
      }

      // PIXI_TREE_SPRITES 비활성 시 캔버스에 직접 드로잉
      trees.forEach(drawTreeShadow);

      if (!(PIXI_TREE_SPRITES && pixiReady && pixiTreeTex?.length)) {
        trees.sort((a, b) => a.worldBy - b.worldBy);
        chunkCtx.imageSmoothingEnabled = true;
        chunkCtx.imageSmoothingQuality = "high";
        const prevTreeAlpha = chunkCtx.globalAlpha;
        chunkCtx.globalAlpha = prevTreeAlpha * TREE_TONE_ALPHA;
        // variantIndex별로 그룹화하여 filter 변경 횟수를 최소화 (N_trees → N_variants)
        const treeBrightness = Math.round(TREE_TONE_BRIGHTNESS * 100);
        const treeSaturation = Math.round(TREE_TONE_SATURATION * 94);
        const fixedFilter = `brightness(${treeBrightness}%) saturate(${treeSaturation}%)`;
        const byVariant = new Map();
        for (const tree of trees) {
          const vi = tree.variantIndex;
          if (!byVariant.has(vi)) byVariant.set(vi, []);
          byVariant.get(vi).push(tree);
        }
        chunkCtx.filter = fixedFilter;
        // 각 변종을 Y정렬 후 그리되 filter는 변종이 바뀔 때만 1회 변경
        for (const [, group] of byVariant) {
          group.sort((a, b) => a.worldBy - b.worldBy);
          for (const { worldBx, worldBy, scale, variantIndex } of group) {
            const treeImg = treeImages[variantIndex % treeImages.length] || treeImages[0];
            const { stW, stH } = treeDrawSize(treeImg, variantIndex, scale ?? 1);
            chunkCtx.drawImage(treeImg, worldBx - minIsoX - stW / 2, worldBy - minIsoY - stH, stW, stH);
          }
        }
        chunkCtx.filter = "none";
        chunkCtx.globalAlpha = prevTreeAlpha;
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

  // 한 방향으로 광선을 쏘아 시야 한계(50 유효타일)까지의 실제 도달 거리 반환
  function castRay(fromX, fromY, dirX, dirY) {
    const VISION_LIMIT = 50;
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
    const pad = FOG_BUFFER_PADDING;
    const rtW = W + pad * 2;
    const rtH = H + pad * 2;

    if (!pixiFogRT || pixiFogRT.width !== rtW || pixiFogRT.height !== rtH) {
      if (pixiFogRT) pixiFogRT.destroy();
      pixiFogRT = RenderTexture.create({ width: rtW, height: rtH });
      pixiFogSprite.texture = pixiFogRT;
    }
    pixiFogSprite.visible = true;
    pixiFogSprite.x = -pad;
    pixiFogSprite.y = -pad;

    // 영구 Graphics를 clear()하고 재사용 — 매 프레임 객체 생성 없음
    pixiFogDark.clear().rect(0, 0, rtW, rtH).fill({ color: 0x000000, alpha: 0.62 });

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
        pts.push(s.x + pad, s.y + tileH / 2 + pad);
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
    const visibleDamageEffectIds = new Set();

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
        const strong       = frBonus || kBonus || skBonus;
        const cavalryScale = troopType === 'cavalry' ? 0.80 : 1.0; // 기병 글로우 크기 축소
        const alpha  = strong ? 0.24 : 0.14;
        const gx     = (strong ? 0.60 : 0.50) * cavalryScale;
        const gy     = (strong ? 0.50 : 0.40) * cavalryScale;
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

      const visualFacing = updateUnitVisualFacing(formation, unit);
      const moving = visualFacing.moving;
      const facingBack = visualFacing.facingBack;
      const cavalryDirection = troopType === 'cavalry'
        ? cavalryDirectionInfo(visualFacing.direction)
        : null;
      if (hasPixiSprites(troopType)) {
        const fi = moving
          ? Math.floor(game.battleTime * 7 + unit.chaosPhaseOffset * 3) % troopWalkFrames(troopType)
          : 0;
        if (cavalryDirection) {
          const frames = cavalryPixiFrames(formation.team, cavalryDirection.direction);
          sprite.texture = frames[fi] || pixiIdleTex.cavalry[formation.team];
        } else if (moving) {
          if (facingBack && troopType === 'cavalry' && pixiWalkBackTex.cavalry[formation.team]?.length > 0) {
            sprite.texture = pixiWalkBackTex.cavalry[formation.team][fi];
          } else {
            sprite.texture = pixiWalkTex[troopType][formation.team][fi];
          }
        } else {
          sprite.texture = pixiIdleTex[troopType][formation.team];
        }
      }

      sprite.x = cx;
      sprite.y = cy;
      sprite.scale.x = (cavalryDirection ? cavalryDirection.flip : visualFacing.facingLeft) ? -spScale : spScale;
      sprite.scale.y = spScale;
      sprite.zIndex  = unit.x + unit.y;
      sprite.visible = true;

      const effectTimer = unit.damageEffectTimer || 0;
      const effectFrame = effectTimer > 0 && pixiDamageEffectTex.length
        ? Math.min(UNIT_DAMAGE_EFFECT_FRAMES - 1, Math.floor((1 - effectTimer / UNIT_DAMAGE_EFFECT_DURATION) * UNIT_DAMAGE_EFFECT_FRAMES))
        : -1;
      let effectSprite = pixiDamageEffectSprites.get(unit.id);
      if (effectFrame >= 0) {
        if (!effectSprite) {
          effectSprite = new PixiSprite();
          effectSprite.anchor.set(0.5, 1);
          pixiUnitCtr.addChild(effectSprite);
          pixiDamageEffectSprites.set(unit.id, effectSprite);
        }
        const effectTex = pixiDamageEffectTex[effectFrame];
        const effectScale = effectTex ? (dh * 1.08) / effectTex.height : spScale;
        effectSprite.texture = effectTex;
        effectSprite.x = cx;
        effectSprite.y = cy;
        effectSprite.scale.x = unit.damageEffectFlip ? -effectScale : effectScale;
        effectSprite.scale.y = effectScale;
        effectSprite.zIndex = unit.x + unit.y + 0.02;
        effectSprite.alpha = 0.5;
        effectSprite.visible = true;
        visibleDamageEffectIds.add(unit.id);
      } else if (effectSprite) {
        effectSprite.visible = false;
      }
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
    for (const [id, sprite] of pixiDamageEffectSprites) {
      if (!aliveIds.has(id)) {
        sprite.destroy();
        pixiDamageEffectSprites.delete(id);
      } else if (!visibleDamageEffectIds.has(id)) {
        sprite.visible = false;
      }
    }
  }

  function renderFog() {
    if (game.battlePhase !== "live") return;

    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    const tileH = getTileH();
    const NUM_RAYS = 60; // 6° 간격

    // 4프레임마다 재계산 — 부대가 이동 중이면 2프레임마다
    game._fogFrame = (game._fogFrame || 0) + 1;
    const anyMoving = game.playerFormations.some(f => f.speed !== "STOP" && f.units.some(isUnitAlive));
    const fogInterval = anyMoving ? 2 : 4;
    const sizeChanged = !game._fogBlurCanvas ||
      game._fogBlurCanvas.width !== Math.ceil(W) ||
      game._fogBlurCanvas.height !== Math.ceil(H);

    if (!sizeChanged && game._fogFrame % fogInterval !== 0) {
      if (game._fogBlurCanvas) ctx.drawImage(game._fogBlurCanvas, 0, 0);
      return;
    }

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

      // NUM_RAYS 방향으로 광선을 쏘아 시야 폴리곤 꼭짓점 수집
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
    if (sizeChanged) {
      game._fogBlurCanvas = createSurface(W, H);
    }
    const fogBlur = game._fogBlurCanvas;
    const bCtx = fogBlur.getContext("2d");
    bCtx.clearRect(0, 0, W, H);
    bCtx.filter = "blur(18px)";
    bCtx.drawImage(fog, 0, 0);
    bCtx.filter = "none";
    ctx.drawImage(fogBlur, 0, 0);
  }

  function scheduleTerrainPrefetch(minCX, maxCX, minCY, maxCY) {
    const tr = game.terrainRender;
    const cache = tr.chunkCache;
    const queue = tr.prefetchQueue;
    const inQueue = new Set(queue.map(([cx, cy]) => chunkKey(cx, cy)));
    const pad = 2;
    for (let cy = minCY - pad; cy <= maxCY + pad; cy++) {
      for (let cx = minCX - pad; cx <= maxCX + pad; cx++) {
        if (cx >= minCX && cx <= maxCX && cy >= minCY && cy <= maxCY) continue;
        if (cx < 0 || cy < 0 || cx > Math.ceil(MAP_WIDTH / CHUNK_TILES) || cy > Math.ceil(MAP_HEIGHT / CHUNK_TILES)) continue;
        const key = chunkKey(cx, cy);
        if (cache.has(key) || inQueue.has(key)) continue;
        inQueue.add(key);
        queue.push([cx, cy]);
      }
    }
    if (queue.length === 0 || tr._prefetchScheduled) return;
    tr._prefetchScheduled = true;
    const gen = tr.prefetchGen;
    const bake = (deadline) => {
      if (tr.prefetchGen !== gen) { tr._prefetchScheduled = false; return; }
      while (queue.length > 0) {
        if (deadline && deadline.timeRemaining() < 2) break;
        const [cx, cy] = queue.shift();
        const key = chunkKey(cx, cy);
        if (!cache.has(key)) cache.set(key, createTerrainChunk(cx, cy));
      }
      if (queue.length > 0) {
        if (window.requestIdleCallback) requestIdleCallback(bake, { timeout: 1000 });
        else setTimeout(() => bake(null), 0);
      } else {
        tr._prefetchScheduled = false;
      }
    };
    if (window.requestIdleCallback) requestIdleCallback(bake, { timeout: 1000 });
    else setTimeout(() => bake(null), 0);
  }

  function renderMap() {
    if (game.battlePhase !== "live") ensureTerrainChunkCache();
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
        if (TERRAIN_TREE_RENDER_ENABLED && PIXI_TREE_SPRITES && pixiReady && pixiTreeTex?.length && chunk.trees.length > 0) {
          const treeBaseH = game.tileW * 22 / 24;
          for (const { worldBx, worldBy, tileX, tileY, scale, variantIndex } of chunk.trees) {
            const tex = pixiTreeTex[variantIndex % pixiTreeTex.length] || pixiTreeTex[0];
            const variantScale = TREE_VARIANT_HEIGHT_SCALE[variantIndex % TREE_VARIANT_HEIGHT_SCALE.length] ?? 1;
            const targetH = Math.round(treeBaseH * (scale ?? 1) * variantScale);
            const targetW = Math.max(1, Math.round(targetH * tex.width / tex.height));
            const tspr = new PixiSprite(tex);
            tspr.width  = targetW;
            tspr.height = targetH;
            tspr.anchor.set(0.5, 1.0);
            tspr.alpha = TREE_TONE_ALPHA;
            tspr.tint = TREE_PIXI_TINT;
            tspr.zIndex = tileX + tileY;
            pixiUnitCtr.addChild(tspr);
            pixiTreeSprites.push({ sprite: tspr, worldBx, worldBy });
          }
        }
      }
      ctx.drawImage(chunk.canvas, chunk.worldX - game.camera.x + origin.x, chunk.worldY - game.camera.y + origin.y);
    });
    scheduleTerrainPrefetch(minChunkX, maxChunkX, minChunkY, maxChunkY);
  }

  function renderMapPixi() {
    if (game.battlePhase !== "live") ensureTerrainChunkCache();
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
      return effectiveDistance(center.x, center.y, unit.x, unit.y) <= 50;
    });
  }

  function isEnemyFormationVisible(formation) {
    if (!formation || formation.team !== "enemy") return false;
    if (game.battlePhase !== "live") return true;
    return formation.units.some((unit) => isUnitAlive(unit) && isEnemyVisible(unit));
  }

  // ── 말풍선 시스템 ────────────────────────────────────────────────────
  function randFrom(arr) {
    if (!arr || !arr.length) return null;
    if (isOnlineMode()) return arr[0];
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function tryShowSpeech(formation, text, priority = "low") {
    if (isOnlineMode()) return;
    if (!text || !speechData) return;
    if (game.battlePhase !== "live") return;
    if (game.battleTime < formation.speechCooldown) return;
    const chance = priority === "high" ? 0.72 : 0.20;
    if (Math.random() > chance) return;
    formation.speechBubble = { text, expiry: game.battleTime + 2.0 };
    formation.speechCooldown = game.battleTime + 5.0;
  }

  function tryShowSpeechCommand(formation, text) {
    if (isOnlineMode()) return;
    // 명령 계기 (저확률, 전투 전에도 발동)
    if (!text || !speechData) return;
    if (game.battleTime < formation.speechCooldown) return;
    if (Math.random() > 0.30) return;
    formation.speechBubble = { text, expiry: game.battleTime + 2.0 };
    formation.speechCooldown = game.battleTime + 5.0;
  }

  function showRetreatSpeech(formation) {
    if (isOnlineMode() || !speechData?.retreat) return;
    const text = randFrom(speechData.retreat);
    if (!text) return;
    formation.speechBubble = { text, expiry: game.battleTime + 2.5 };
    formation.speechCooldown = game.battleTime + 10.0;
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

    const drawBubble = (formation, bgColor, fgColor) => {
      const b = formation.speechBubble;
      if (!b) return;
      if (now > b.expiry) { formation.speechBubble = null; return; }

      const age = 2.0 - (b.expiry - now);
      const alpha = Math.min(1, age * 6) * Math.min(1, (b.expiry - now) * 3.5);
      ctx.globalAlpha = alpha;

      const s = toScreen(formation.anchor.x, formation.anchor.y);
      const bx = s.x;
      const dh = Math.round(troopRenderHeight(formation.troopType));
      const by = s.y + tileH / 2 - dh - 18;

      ctx.font = "bold 12px 'Noto Serif KR', serif";
      const tw = ctx.measureText(b.text).width;
      const pad = 12, bw = tw + pad * 2, bh = 28, br = 9;
      const lx = bx - bw / 2, ty = by - bh;

      ctx.shadowColor = "rgba(0,0,0,0.30)";
      ctx.shadowBlur = 6;
      ctx.shadowOffsetY = 3;

      ctx.fillStyle = bgColor;
      ctx.beginPath();
      ctx.moveTo(lx + br, ty);
      ctx.lineTo(lx + bw - br, ty);
      ctx.quadraticCurveTo(lx + bw, ty, lx + bw, ty + br);
      ctx.lineTo(lx + bw, ty + bh - br);
      ctx.quadraticCurveTo(lx + bw, ty + bh, lx + bw - br, ty + bh);
      ctx.lineTo(bx + 7, ty + bh);
      ctx.lineTo(bx,     ty + bh + 10);
      ctx.lineTo(bx - 7, ty + bh);
      ctx.lineTo(lx + br, ty + bh);
      ctx.quadraticCurveTo(lx, ty + bh, lx, ty + bh - br);
      ctx.lineTo(lx, ty + br);
      ctx.quadraticCurveTo(lx, ty, lx + br, ty);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;

      ctx.fillStyle = fgColor;
      ctx.fillText(b.text, bx, ty + bh / 2);
    };

    game.playerFormations.forEach(f => drawBubble(f, "rgba(255, 251, 225, 0.72)", "#3a2200"));
    game.enemyFormations.forEach(f => drawBubble(f, "rgba(255, 228, 220, 0.72)", "#4a1200"));

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

    // 적군 혼란도 상승 말풍선
    game.enemyFormations.forEach(formation => {
      if (formation.retreated || formation.retreating) return;
      if (!formation.units.some(isUnitAlive)) return;
      if (formation.disorder > 0.6 && !formation.speechDisorderTriggered) {
        formation.speechDisorderTriggered = true;
        tryShowSpeech(formation, randFrom(speechData.disorder), "high");
      } else if (formation.disorder < 0.3) {
        formation.speechDisorderTriggered = false;
      }
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
        const fallbackScale = formation._cachedRenderScale ?? (game.tileW / 20);
        return { troopType, frameW: SPRITE_W, frameH: SPRITE_H, drawW: Math.round(SPRITE_W * fallbackScale), drawH: Math.round(SPRITE_H * fallbackScale), spriteScale: fallbackScale };
      }
      const teamSprite = troopType === "cavalry"
        ? (formation.team === 'enemy' ? cavalryWalkBlueSprite : cavalryWalkSprite)
        : formation.team === 'enemy'
          ? unitWalkBlueSprite
          : unitWalkSprite;
      const frameW = teamSprite.naturalWidth / troopWalkFrames(troopType);
      const frameH = teamSprite.naturalHeight;
      const spriteScale = formation._cachedRenderScale ?? troopRenderScale(troopType);
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

    // ── Pass 1.5: 글로우 패스 (스프라이트보다 먼저, 배치 처리) ──────────────
    units.forEach(({ formation, unit }) => {
      const screen = toScreen(unit.x, unit.y);
      const cx = screen.x;
      const cy = screen.y + tileH / 2;
      const { troopType, drawW, drawH } = canvasUnitMetrics(formation);
      const targetSlot = add(formation.anchor, worldFromLocal(formation, unit.slotLocal));
      const slotDist = len(targetSlot.x - unit.x, targetSlot.y - unit.y);
      const firstRowBonusActive = unit.isFirstRow && slotDist < 1.5;
      const positionBonusActive = !firstRowBonusActive && slotDist < POSITION_DEFENSE_THRESHOLD;
      const kihapActive = unit.kihapTimer > 0;
      const skillBuffActive = formation.swiftTimer > 0
        || formation.archeryTimer > 0
        || (formation.guardTimer > 0 && slotDist < POSITION_DEFENSE_THRESHOLD);
      if (firstRowBonusActive || positionBonusActive || kihapActive || skillBuffActive) {
        const strongGlow  = firstRowBonusActive || kihapActive || skillBuffActive;
        const cavalryScale = troopType === 'cavalry' ? 0.80 : 1.0;
        const glowAlpha   = strongGlow ? 0.24 : 0.14;
        const glowSize    = strongGlow
          ? { x: 0.60 * cavalryScale, y: 0.50 * cavalryScale }
          : { x: 0.50 * cavalryScale, y: 0.40 * cavalryScale };
        ctx.fillStyle = formation.team === 'player'
          ? `rgba(255,60,60,${glowAlpha})`
          : `rgba(255,170,70,${glowAlpha})`;
        ctx.beginPath();
        ctx.ellipse(cx, cy - drawH * 0.35, drawW * glowSize.x, drawH * glowSize.y, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    // ── Pass 2: 스프라이트 ────────────────────────────────────────────────
    ctx.imageSmoothingEnabled = false;
    units.forEach(({ formation, unit }) => {
      const screen = toScreen(unit.x, unit.y);
      const cx = screen.x;
      const cy = screen.y + tileH / 2;
      const metrics = canvasUnitMetrics(formation);
      const { troopType, drawW, drawH } = metrics;

      const visualFacing = updateUnitVisualFacing(formation, unit);
      const isMoving = visualFacing.moving;
      const isFacingBack = visualFacing.facingBack;
      const frameCount = externalUnitLoaded ? troopWalkFrames(troopType) : 2;
      const frameIdx = isMoving ? Math.floor(game.battleTime * 7 + unit.chaosPhaseOffset * 3) % frameCount : 0;
      const facingLeft = visualFacing.facingLeft;
      const spriteSet = externalUnitLoaded ? null : game.spriteCache[formation.team][frameIdx];
      const sprite = externalUnitLoaded ? null : ((() => {
        const targetSlot2 = add(formation.anchor, worldFromLocal(formation, unit.slotLocal));
        const slotDist2 = len(targetSlot2.x - unit.x, targetSlot2.y - unit.y);
        const frb = unit.isFirstRow && slotDist2 < 1.5;
        const kihap = unit.kihapTimer > 0;
        const skillBuff = formation.swiftTimer > 0 || formation.archeryTimer > 0 || (formation.guardTimer > 0 && slotDist2 < POSITION_DEFENSE_THRESHOLD);
        return (frb || kihap || skillBuff)
          ? (facingLeft ? spriteSet.bonusLeft : spriteSet.bonusRight)
          : (facingLeft ? spriteSet.left : spriteSet.right);
      })());

      const drawX = cx - drawW / 2;
      const drawY = cy - drawH;

      if (externalUnitLoaded) {
        const cavalryDirection = troopType === "cavalry"
          ? cavalryDirectionInfo(visualFacing.direction)
          : null;
        const teamSprite = cavalryDirection
          ? cavalryDirectionSprite(formation.team, cavalryDirection.direction)
          : troopType === "cavalry"
            ? (isFacingBack
                ? (formation.team === 'enemy'
                    ? (cavalryWalkBackBlueSprite.naturalWidth > 0 ? cavalryWalkBackBlueSprite : cavalryWalkBlueSprite)
                    : (cavalryWalkBackSprite.naturalWidth > 0 ? cavalryWalkBackSprite : cavalryWalkSprite))
                : (formation.team === 'enemy' ? cavalryWalkBlueSprite : cavalryWalkSprite))
            : formation.team === 'enemy'
              ? (isMoving && unitWalkBlueSprite.naturalWidth > 0 ? unitWalkBlueSprite : unitIdleBlueSprite)
              : (isMoving ? unitWalkSprite : unitIdleSprite);
        const usesWalkSheet = isMoving || troopType === "cavalry";
        const frameW = usesWalkSheet ? teamSprite.naturalWidth / troopWalkFrames(troopType) : teamSprite.naturalWidth;
        const frameH = teamSprite.naturalHeight;
        const sx = usesWalkSheet ? frameIdx * frameW : 0;
        const drawUnitX = cx - drawW / 2;
        const drawUnitY = cy - drawH;
        const shouldFlip = cavalryDirection ? cavalryDirection.flip : facingLeft;
        if (shouldFlip) {
          ctx.save();
          ctx.translate(cx, 0);
          ctx.scale(-1, 1);
          ctx.drawImage(teamSprite, sx, 0, frameW, frameH, -drawW / 2, drawUnitY, drawW, drawH);
          ctx.restore();
        } else {
          ctx.drawImage(teamSprite, sx, 0, frameW, frameH, drawUnitX, drawUnitY, drawW, drawH);
        }
      } else {
        ctx.drawImage(sprite, drawX, drawY, drawW, drawH);
      }
      if ((unit.damageEffectTimer || 0) > 0 && unitDamageEffectSprite.naturalWidth > 0) {
        const effectFrameW = unitDamageEffectSprite.naturalWidth / UNIT_DAMAGE_EFFECT_FRAMES;
        const effectFrameH = unitDamageEffectSprite.naturalHeight;
        const effectFrame = Math.min(
          UNIT_DAMAGE_EFFECT_FRAMES - 1,
          Math.floor((1 - unit.damageEffectTimer / UNIT_DAMAGE_EFFECT_DURATION) * UNIT_DAMAGE_EFFECT_FRAMES)
        );
        const effectDrawH = drawH * 1.08;
        const effectDrawW = effectDrawH * (effectFrameW / effectFrameH);
        if (unit.damageEffectFlip) {
          ctx.save();
          ctx.translate(cx, 0);
          ctx.scale(-1, 1);
          ctx.drawImage(
            unitDamageEffectSprite,
            effectFrame * effectFrameW, 0, effectFrameW, effectFrameH,
            Math.round(-effectDrawW / 2),
            Math.round(cy - effectDrawH),
            Math.round(effectDrawW),
            Math.round(effectDrawH)
          );
          ctx.restore();
        } else {
          ctx.drawImage(
            unitDamageEffectSprite,
            effectFrame * effectFrameW, 0, effectFrameW, effectFrameH,
            Math.round(cx - effectDrawW / 2),
            Math.round(cy - effectDrawH),
            Math.round(effectDrawW),
            Math.round(effectDrawH)
          );
        }
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
    game.traces.forEach(({ x, y, type, flip }) => {
      const s = toScreen(x, y);
      const cx = s.x, cy = s.y + tileH / 2;
      const remains = remainsSprites[type % remainsSprites.length];
      if (remains?.complete && remains.naturalWidth > 0) {
        const drawW = game.tileW * 1.3;
        const drawH = drawW * (remains.naturalHeight / remains.naturalWidth);
        ctx.save();
        ctx.globalAlpha = 0.7;
        if (flip) {
          ctx.translate(cx, 0);
          ctx.scale(-1, 1);
          ctx.drawImage(
            remains,
            Math.round(-drawW / 2),
            Math.round(cy - drawH * 0.58),
            Math.round(drawW),
            Math.round(drawH),
          );
        } else {
          ctx.drawImage(
            remains,
            Math.round(cx - drawW / 2),
            Math.round(cy - drawH * 0.58),
            Math.round(drawW),
            Math.round(drawH),
          );
        }
        ctx.restore();
        return;
      }
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
    ctx.strokeStyle = "rgba(60, 35, 10, 0.9)";
    ctx.lineWidth = 1.2;
    game.projectiles.forEach((p) => {
      if (!p.totalDist || p.totalDist < 0.01) return;

      // 포물선 높이: 비행 거리에 비례, 최대 제한
      const arcHeight = Math.min(p.totalDist * game.tileW * 0.10, game.tileW * 1.8);

      // 머리 위치 (현재 t)
      const headArcY = -Math.sin(p.t * Math.PI) * arcHeight;
      const head = toScreen(p.x, p.y);
      const headSY = head.y + tileH / 2 + headArcY;

      // 꼬리 위치 (약 0.5타일 뒤 궤적 위)
      const tailFrac = Math.min(0.15, 0.55 / p.totalDist);
      const t_tail   = Math.max(0, p.t - tailFrac);
      const tail_px  = p.ox + (p.tx - p.ox) * t_tail;
      const tail_py  = p.oy + (p.ty - p.oy) * t_tail;
      const tailArcY = -Math.sin(t_tail * Math.PI) * arcHeight;
      const tail = toScreen(tail_px, tail_py);
      const tailSY = tail.y + tileH / 2 + tailArcY;

      ctx.beginPath();
      ctx.moveTo(tail.x, tailSY);
      ctx.lineTo(head.x, headSY);
      ctx.stroke();
    });
  }

  function renderPlayerTargets() {
    const now    = game.battleTime;
    const tileH  = getTileH();
    const baseRx = game.tileW * 0.48;
    const baseRy = baseRx * 0.42; // 이소메트릭 지면 비율

    game.playerFormations.forEach((formation) => {
      if (!formation.target) return;
      if (formation.retreated || !formation.units.some(isUnitAlive)) return;
      if (len(formation.anchor.x - formation.target.x, formation.anchor.y - formation.target.y) < 1.0) return;

      const point  = toScreen(formation.target.x, formation.target.y);
      const anchor = toScreen(formation.anchor.x, formation.anchor.y);
      const cx = point.x;
      const cy = point.y + tileH / 2;

      // 적 진형 타겟 여부에 따른 색상
      const isEnemyTarget = !!formation.followTarget;
      const mainColor  = isEnemyTarget ? "#ff8844" : "#ffe992";
      const glowColor  = isEnemyTarget ? "rgba(255,120,50,0.55)" : "rgba(255,220,80,0.55)";
      const burstColor = isEnemyTarget ? "rgba(255,130,60,1)"    : "rgba(255,233,146,1)";

      // 왕왕 진동: 두 주파수 합성
      const wobble = 1 + 0.11 * Math.sin(now * 3.8) + 0.05 * Math.sin(now * 6.1);
      const rx = baseRx * wobble;
      const ry = baseRy * wobble;

      // 명도 펄스
      const pulse = 0.5 + 0.5 * ((1 + Math.sin(now * 2.5)) / 2);

      ctx.save();

      // ── 버스트 이펙트 (최초 설정 후 0.8초) ──────────────────────────
      const age = now - formation.targetSetTime;
      if (age < 0.8) {
        const t = age / 0.8;
        ctx.strokeStyle = burstColor;
        ctx.lineWidth   = 2.5 * (1 - t);
        ctx.globalAlpha = (1 - t) * 0.85;
        ctx.beginPath();
        ctx.ellipse(cx, cy, baseRx * (1 + t * 2.8), baseRy * (1 + t * 2.8), 0, 0, Math.PI * 2);
        ctx.stroke();
        if (age > 0.1) {
          const t2 = (age - 0.1) / 0.8;
          if (t2 < 1) {
            ctx.lineWidth   = 1.5 * (1 - t2);
            ctx.globalAlpha = (1 - t2) * 0.5;
            ctx.beginPath();
            ctx.ellipse(cx, cy, baseRx * (1 + t2 * 2.0), baseRy * (1 + t2 * 2.0), 0, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
      }

      // ── 메인 이소메트릭 타원 ──────────────────────────────────────────
      ctx.globalAlpha = 0.45 + pulse * 0.45;
      ctx.strokeStyle = mainColor;
      ctx.lineWidth   = 1.8;
      ctx.shadowColor = glowColor;
      ctx.shadowBlur  = 5;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();

      ctx.shadowBlur = 0;

      ctx.restore();

      // ── 안내선: 선택 진형 + 전투 진행 중에만 표시 ───────────────────
      if (game.battlePhase !== 'live' || game.paused) return;
      if (formation.id !== game.selectedId) return;
      const ax = anchor.x, ay = anchor.y + tileH / 2;
      const lineDx = cx - ax, lineDy = cy - ay;
      const lineLen = Math.hypot(lineDx, lineDy);
      if (lineLen > 4) {
        const nx = lineDx / lineLen, ny = lineDy / lineLen;
        const segLen = Math.min(lineLen * 0.85, 180); // 세그먼트 길이
        const cycle  = segLen * 2;                    // 세그먼트 + 동일 길이 공백
        const CYCLE_DURATION = 5.5;                   // 항상 이 시간(초)에 한 사이클 완료
        const offset = ((now % CYCLE_DURATION) / CYCLE_DURATION) * cycle;

        ctx.save();
        ctx.lineWidth = 1.5;

        // 세그먼트 시작 위치를 순회 (한 주기 앞에서 시작해 누락 방지)
        for (let segStart = offset - cycle; segStart < lineLen; segStart += cycle) {
          const segEnd   = segStart + segLen;
          const drawStart = Math.max(0, segStart);
          const drawEnd   = Math.min(lineLen, segEnd);
          if (drawEnd <= drawStart) continue;

          const tx = ax + nx * drawStart, ty = ay + ny * drawStart;
          const hx = ax + nx * drawEnd,   hy = ay + ny * drawEnd;

          // 꼬리(앵커 방향) → 투명, 머리(목표 방향) → 불투명
          const grad = ctx.createLinearGradient(tx, ty, hx, hy);
          grad.addColorStop(0, 'rgba(255,233,146,0.0)');
          grad.addColorStop(1, 'rgba(255,233,146,0.6)');

          ctx.strokeStyle = grad;
          ctx.beginPath();
          ctx.moveTo(tx, ty);
          ctx.lineTo(hx, hy);
          ctx.stroke();
        }
        ctx.restore();
      }
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
    ctx.strokeStyle = "rgba(255,100,100,0.7)";
    ctx.beginPath(); ctx.moveTo(playerRetX, y); ctx.lineTo(playerRetX, y + height); ctx.stroke();
    ctx.strokeStyle = "rgba(100,180,255,0.7)";
    ctx.beginPath(); ctx.moveTo(enemyRetX, y); ctx.lineTo(enemyRetX, y + height); ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = 1;

    game.playerFormations.forEach((formation) => {
      const center = formationCenter(formation);
      ctx.fillStyle = "#e25b5b";
      ctx.beginPath();
      ctx.arc(x + center.x / MAP_WIDTH * width, y + center.y / MAP_HEIGHT * height, 3, 0, Math.PI * 2);
      ctx.fill();
    });

    game.enemyFormations.forEach((formation) => {
      const center = formationCenter(formation);
      ctx.fillStyle = "#5ea6ff";
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

  function renderScenarioMarkers() {
    if (!isHistoricalMode() || !game.scenarioMarkers?.length) return;
    const tileH = getTileH();
    ctx.save();
    game.scenarioMarkers.forEach((marker) => {
      if (marker.type === "rect") {
        const corners = [
          toScreen(marker.x, marker.y),
          toScreen(marker.x + marker.w, marker.y),
          toScreen(marker.x + marker.w, marker.y + marker.h),
          toScreen(marker.x, marker.y + marker.h),
        ].map((p) => ({ x: p.x, y: p.y + tileH / 2 }));
        const pulse = (1 + Math.sin(performance.now() / 260)) / 2;
        ctx.beginPath();
        ctx.moveTo(corners[0].x, corners[0].y);
        for (let i = 1; i < corners.length; i += 1) ctx.lineTo(corners[i].x, corners[i].y);
        ctx.closePath();
        ctx.fillStyle = `rgba(255, 215, 80, ${0.08 + pulse * 0.07})`;
        ctx.strokeStyle = `rgba(255, 220, 90, ${0.58 + pulse * 0.30})`;
        ctx.lineWidth = 2;
        ctx.fill();
        ctx.stroke();
        if (marker.label) {
          const labelPoint = toScreen(marker.x + marker.w / 2, marker.y);
          ctx.font = "700 12px 'Noto Serif KR', serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "bottom";
          ctx.fillStyle = "rgba(18,12,4,0.86)";
          const textWidth = ctx.measureText(marker.label).width;
          ctx.fillRect(labelPoint.x - textWidth / 2 - 6, labelPoint.y - 14, textWidth + 12, 18);
          ctx.fillStyle = "#f2d37a";
          ctx.fillText(marker.label, labelPoint.x, labelPoint.y);
        }
        return;
      }
      const screen = toScreen(marker.x, marker.y);
      const radius = Math.max(10, (marker.radius || 6) * game.tileW * 0.35);
      const pulse = (1 + Math.sin(performance.now() / 260)) / 2;
      ctx.beginPath();
      ctx.ellipse(screen.x, screen.y + tileH / 2, radius * 1.25, radius * 0.58, 0, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 215, 80, ${0.10 + pulse * 0.10})`;
      ctx.strokeStyle = `rgba(255, 220, 90, ${0.52 + pulse * 0.36})`;
      ctx.lineWidth = 2;
      ctx.fill();
      ctx.stroke();
      if (marker.label) {
        ctx.font = "700 12px 'Noto Serif KR', serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillStyle = "rgba(18,12,4,0.86)";
        const textWidth = ctx.measureText(marker.label).width;
        ctx.fillRect(screen.x - textWidth / 2 - 6, screen.y - 14, textWidth + 12, 18);
        ctx.fillStyle = "#f2d37a";
        ctx.fillText(marker.label, screen.x, screen.y);
      }
    });
    ctx.restore();
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
      if (width !== _pixiRendererW || height !== _pixiRendererH) {
        _pixiRendererW = width; _pixiRendererH = height;
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
    renderScenarioMarkers();
    renderSpeechBubbles();
    updateEnemyTargetTooltipPosition();
    if (game.battlePhase !== "live") renderMinimap();
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
        autoSelectDeadline = -1;
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
    if (isOnlineMode()) game.speedMultiplier = 1;
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
    speedToggleButton.disabled = game.battlePhase !== "live" || isOnlineMode();
    speedToggleButton.classList.toggle("active", game.speedMultiplier === 2);
    speedToggleButton.textContent = game.speedMultiplier === 2 ? "기본속도" : "2배속";
    phaseButton.hidden = isOnlineMode();
    speedToggleButton.hidden = isOnlineMode();
    troopAdjustBtn.hidden = isHistoricalMode() || isOnlineMode();
    troopAdjustBtn.disabled = game.battlePhase !== "planning" || isHistoricalMode();
    endBattleBtn.hidden = isHistoricalMode();
    if (isScenarioSceneActive()) {
      phaseButton.disabled = true;
      speedToggleButton.disabled = true;
      troopAdjustBtn.disabled = true;
    }

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
      const aTileKey = game.terrain.tiles[aty][atx];
      const aTileDefense = (selected.troopType === 'cavalry' && aTileKey === 'mountain') ? -2 : terrainInfo[aTileKey].defense;
      const meleeDef = Math.max(0,
        2 + speedInfo[selected.speed].defense
          + densityInfo[selected.density].defense
          + aTileDefense
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
      if (msMeleeAtk)  msMeleeAtk.textContent  = meleeAtk.toFixed(1);
      if (msMeleeDef)  msMeleeDef.textContent  = meleeDef.toFixed(1);
      if (msRangedAtk) msRangedAtk.textContent = rangedAtk.toFixed(1);
      if (msRangedDef) msRangedDef.textContent = (rangedDefPct >= 0 ? '+' : '') + rangedDefPct + '%';

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
      if (mobileKihapBtn) {
        mobileKihapBtn.disabled = kihapBtn.disabled;
        if (mobileKihapFill) mobileKihapFill.style.width = kihapFill.style.width;
        if (mobileKihapIcon)  mobileKihapIcon.textContent  = sDef.icon;
        if (mobileKihapLabel) mobileKihapLabel.textContent = sDef.label;
      }
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
      if (mobileKihapBtn)   { mobileKihapBtn.disabled = true; }
      if (mobileKihapFill)  mobileKihapFill.style.width = "0%";
      if (msMeleeAtk)  msMeleeAtk.textContent  = '-';
      if (msMeleeDef)  msMeleeDef.textContent  = '-';
      if (msRangedAtk) msRangedAtk.textContent = '-';
      if (msRangedDef) msRangedDef.textContent = '-';
    }
  }

  function setFormationSpeed(formation, newSpeed, showSpeech = true) {
    if (!formation || formation.retreating) return;
    if (newSpeed === "STOP") {
      if (formation.speed === "STOP") {
        formation.speed = formation.prevSpeed || "NORMAL";
      } else {
        formation.prevSpeed = formation.speed;
        formation.speed = "STOP";
        formation.target = null;
        if (showSpeech && speechData) tryShowSpeechCommand(formation, randFrom(speechData.speed_stop));
      }
      return;
    }
    if (formation.speed === "STOP") formation.prevSpeed = newSpeed;
    formation.speed = newSpeed;
    if (showSpeech && newSpeed === "SLOW" && speechData)
      tryShowSpeechCommand(formation, "현재 진형을 유지한채 이동하라.");
    if (showSpeech && newSpeed === "FAST" && speechData)
      tryShowSpeechCommand(formation, randFrom(speechData.speed_fast));
  }

  function setFormationDensity(formation, newDensity, showSpeech = true) {
    if (!formation || formation.retreating) return;
    if (!isDensityAllowed(formation.troopType, newDensity)) return;
    formation.density = newDensity;
    initializeFormationSlots(formation, true);
    if (showSpeech && speechData) {
      const key = newDensity === "TIGHT" ? "density_tight"
                : newDensity === "WIDE"  ? "density_wide" : null;
      if (key) tryShowSpeechCommand(formation, randFrom(speechData[key]));
    }
  }

  function adjustFormationRatio(formation, delta) {
    if (!formation || formation.retreating) return;
    formation.ratio = clamp(formation.ratio + delta, 0.33, 3.0);
    initializeFormationSlots(formation, true);
  }

  function moveFormation(formation, tile, clickedEnemy = null) {
    if (!formation || formation.retreating) return;
    if (clickedEnemy) {
      formation.followTarget = clickedEnemy;
      formation.target = formationCenter(clickedEnemy);
      formation.targetSetTime = game.battleTime;
      const desiredFacing = normalize(sub(formation.target, formation.anchor));
      if (canTurnWhileMoving(formation)) applyTurnRule(formation, desiredFacing);
      return;
    }
    formation.followTarget = null;
    const desiredFacing = normalize(sub(tile, formation.anchor));
    if (canTurnWhileMoving(formation)) applyTurnRule(formation, desiredFacing);
    if (formation.speed === "STOP") {
      if (game.battlePhase === "planning") {
        formation.target = vec(tile.x, tile.y);
        formation.targetSetTime = game.battleTime;
      }
    } else {
      formation.target = vec(tile.x, tile.y);
      formation.targetSetTime = game.battleTime;
    }
  }

  function toggleFormationStop(formation, showSpeech = true) {
    if (!formation || formation.retreating) return;
    if (formation.speed === "STOP") {
      formation.speed = formation.prevSpeed || "NORMAL";
    } else {
      formation.prevSpeed = formation.speed;
      formation.speed = "STOP";
      formation.target = null;
      if (showSpeech && speechData) tryShowSpeechCommand(formation, randFrom(speechData.speed_stop));
    }
  }

  function applyOnlineCommand(side, command) {
    if (!command) return;
    if (command.type === "START_BATTLE") {
      startLiveBattle();
      return;
    }
    const formation = onlineFormationsForSide(side).find(f => f.id === command.formationId);
    if (!formation) return;
    switch (command.type) {
      case "MOVE": {
        const targetEnemy = command.targetEnemyId == null ? null
          : onlineOpponentsForSide(side).find(f => f.id === command.targetEnemyId);
        moveFormation(formation, vec(command.tx, command.ty), targetEnemy);
        if (targetEnemy && side === game.online.side) showEnemyTargetTooltip(targetEnemy);
        break;
      }
      case "SET_SPEED":
        setFormationSpeed(formation, command.speed, side === game.online.side);
        break;
      case "SET_DENSITY":
        setFormationDensity(formation, command.density, side === game.online.side);
        break;
      case "ADJUST_RATIO":
        adjustFormationRatio(formation, Number(command.delta || 0));
        break;
      case "USE_SKILL":
        activateSkill(formation);
        break;
      case "TOGGLE_STOP":
        toggleFormationStop(formation, side === game.online.side);
        break;
    }
    game.hudDirty = true;
  }

  buttons.speed.forEach((button) => {
    button.addEventListener("click", () => {
      if (isScenarioSceneActive()) return;
      const newSpeed = button.dataset.speed;
      if (isOnlineMode()) {
        sendOnlineCommands(currentSelection().map(formation => ({
          type: "SET_SPEED",
          formationId: formation.id,
          speed: newSpeed,
        })));
        return;
      }
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
      if (isScenarioSceneActive()) return;
      const newDensity = button.dataset.density;
      if (isOnlineMode()) {
        sendOnlineCommands(currentSelection().map(formation => ({
          type: "SET_DENSITY",
          formationId: formation.id,
          density: newDensity,
        })));
        return;
      }
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
    if (isScenarioSceneActive()) return;
    if (isOnlineMode()) {
      sendOnlineCommands(currentSelection().map(formation => ({
        type: "ADJUST_RATIO",
        formationId: formation.id,
        delta: -0.3,
      })));
      return;
    }
    currentSelection().forEach((formation) => {
      if (formation.retreating) return;
      formation.ratio = clamp(formation.ratio - 0.3, 0.33, 3.0);
      initializeFormationSlots(formation, true);
    });
    game.hudDirty = true;
  });

  buttons.ratioUp.addEventListener("click", () => {
    if (isScenarioSceneActive()) return;
    if (isOnlineMode()) {
      sendOnlineCommands(currentSelection().map(formation => ({
        type: "ADJUST_RATIO",
        formationId: formation.id,
        delta: 0.3,
      })));
      return;
    }
    currentSelection().forEach((formation) => {
      if (formation.retreating) return;
      formation.ratio = clamp(formation.ratio + 0.3, 0.33, 3.0);
      initializeFormationSlots(formation, true);
    });
    game.hudDirty = true;
  });

  document.getElementById("mobileRatioDown")?.addEventListener("click", () => buttons.ratioDown.click());
  document.getElementById("mobileRatioUp")?.addEventListener("click",   () => buttons.ratioUp.click());
  mobileKihapBtn?.addEventListener("click", () => kihapBtn.click());

  function startLiveBattle() {
    if (game.battlePhase !== "planning") return;
    game.battlePhase = "live";
    _battleTileH = Math.floor(game.tileW / 2);
    ensureTerrainChunkCache();
    const allF2 = [...game.playerFormations, ...game.enemyFormations];
    allF2.forEach((f) => {
      f._cachedRenderScale = troopRenderScale(normalizeTroopType(f.troopType));
    });
    if (isMobile()) setTopbarCollapsed(true);
    const allF = [...game.playerFormations, ...game.enemyFormations];
    allF.forEach((f) => { f.kihapCooldown = kihapMaxCooldown(f); f.skillCooldown = skillMaxCooldown(f); });
    currentSelection().forEach((formation) => {
      if (formation.speed === "STOP" && formation.target) formation.speed = "NORMAL";
    });
    game.hudDirty = true;
    refreshButtons();
  }

  phaseButton.addEventListener("click", () => {
    if (isScenarioSceneActive()) return;
    if (isOnlineMode()) {
      sendOnlineCommands([{ type: "START_BATTLE" }]);
      return;
    }
    startLiveBattle();
  });

  endBattleBtn.addEventListener("click", () => {
    if (isOnlineMode()) {
      if (game.battlePhase === "live" && !game.online?.resultSubmitted) {
        submitOnlineResult(false);
      }
      game.battlePhase = "ended";
      showBattleResult(false);
      onlineClient.disconnect();
      if (game.online?.isGuest) {
        onlineClient.isGuest = false;
        onlineClient.player = null;
      }
      return;
    }
    setScreen("home");
  });

  speedToggleButton.addEventListener("click", () => {
    if (isScenarioSceneActive()) return;
    if (isOnlineMode()) return;
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
    if (isScenarioSceneActive()) return;
    if (isOnlineMode()) {
      sendOnlineCommands(currentSelection().map(formation => ({
        type: "USE_SKILL",
        formationId: formation.id,
      })));
      return;
    }
    currentSelection().forEach((formation) => activateSkill(formation));
    refreshButtons();
  });

  function toggleStop() {
    if (isScenarioSceneActive()) return;
    if (isOnlineMode()) {
      sendOnlineCommands(currentSelection().map(formation => ({
        type: "TOGGLE_STOP",
        formationId: formation.id,
      })));
      return;
    }
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
    autoSelectDeadline = -1;
    game.selectedId = next.id;
    centerCameraOn(formationCenter(next));
    game.hudDirty = true;
    refreshButtons();
  }

  window.addEventListener("keydown", (e) => {
    if (isScenarioSceneActive()) return;
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
      // 터치 모드에서는 캔버스 클릭 진형 선택 불가
      if (game.controlType === 'touch') { game.dragState = null; return; }
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
          autoSelectDeadline = -1;
          game.selectedId = closest.id;
          game.hudDirty = true;
          refreshButtons();
        }
      }
    }
    game.dragState = null;
  });

  // ── 적 진형 이동목표 툴팁 ───────────────────────────────────────────
  let enemyTargetTooltipTimer = null;
  let enemyTargetTooltipEnemy = null;

  function updateEnemyTargetTooltipPosition() {
    if (!enemyTargetTooltipEnemy || enemyTargetTooltip.hidden) return;
    const center = formationCenter(enemyTargetTooltipEnemy);
    const sc = toScreen(center.x, center.y);
    enemyTargetTooltip.style.left = `${sc.x + 3}px`;
    enemyTargetTooltip.style.top = `${sc.y + 3}px`;
    const initial = formationInitialTroops(enemyTargetTooltipEnemy);
    const remaining = formationRemainingTroops(enemyTargetTooltipEnemy);
    enemyTargetBarFill.style.width = `${(remaining / Math.max(1, initial)) * 100}%`;
  }

  function showEnemyTargetTooltip(enemy) {
    if (!enemy || !enemyTargetTooltip) return;
    const maxTroops = game.enemyFormations.reduce(
      (m, f) => Math.max(m, formationInitialTroops(f)), 1);
    const initial = formationInitialTroops(enemy);
    const remaining = formationRemainingTroops(enemy);
    enemyTargetTooltipEnemy = enemy;
    enemyTargetNameEl.textContent = enemy.general.name;
    enemyTargetBarTrack.style.width = `${(initial / maxTroops) * 70}px`;
    enemyTargetBarFill.style.width = `${(remaining / Math.max(1, initial)) * 100}%`;
    enemyTargetTooltip.style.transform = "translate(-50%, calc(-100% - 16px))";
    updateEnemyTargetTooltipPosition();
    enemyTargetTooltip.hidden = false;
    clearTimeout(enemyTargetTooltipTimer);
    enemyTargetTooltipTimer = setTimeout(() => {
      enemyTargetTooltip.hidden = true;
      enemyTargetTooltipEnemy = null;
    }, 5000);
  }

  // ── 이동 명령 헬퍼 (우클릭 / 터치 공용) ─────────────────────────────
  function issueMoveCommand(offsetX, offsetY) {
    if (isScenarioSceneActive()) return;
    const tile = toTile(offsetX, offsetY);
    let clickedEnemy = null;
    let minDist = 8.0;
    for (const f of game.enemyFormations) {
      if (!f.units.some(isUnitAlive)) continue;
      if (!isEnemyFormationVisible(f)) continue;
      const center = formationCenter(f);
      const d = len(center.x - tile.x, center.y - tile.y);
      if (d < minDist) { minDist = d; clickedEnemy = f; }
    }
    if (isOnlineMode()) {
      sendOnlineCommands(currentSelection().map(formation => ({
        type: "MOVE",
        formationId: formation.id,
        tx: tile.x,
        ty: tile.y,
        targetEnemyId: clickedEnemy?.id ?? null,
      })));
      return;
    }
    currentSelection().forEach((formation) => {
      if (formation.retreating) return;
      if (clickedEnemy) {
        formation.followTarget = clickedEnemy;
        formation.target = formationCenter(clickedEnemy);
        formation.targetSetTime = game.battleTime;
        const desiredFacing = normalize(sub(formation.target, formation.anchor));
        if (canTurnWhileMoving(formation)) applyTurnRule(formation, desiredFacing);
      } else {
        formation.followTarget = null;
        const desiredFacing = normalize(sub(tile, formation.anchor));
        if (canTurnWhileMoving(formation)) applyTurnRule(formation, desiredFacing);
        if (formation.speed === "STOP") {
          if (game.battlePhase === "planning") {
            formation.target = vec(tile.x, tile.y);
            formation.targetSetTime = game.battleTime;
          }
        } else {
          formation.target = vec(tile.x, tile.y);
          formation.targetSetTime = game.battleTime;
        }
      }
    });
    if (clickedEnemy) showEnemyTargetTooltip(clickedEnemy);
  }

  // ── 터치 컨트롤 ───────────────────────────────────────────────────────
  let touchState = null;

  canvas.addEventListener("touchstart", (e) => {
    if (game.controlType !== 'touch') return;
    e.preventDefault();
    if (e.touches.length === 1) {
      touchState = {
        type: 'single',
        startX: e.touches[0].clientX, startY: e.touches[0].clientY,
        lastX:  e.touches[0].clientX, lastY:  e.touches[0].clientY,
        moved: false,
      };
    } else if (e.touches.length >= 2) {
      const t0 = e.touches[0], t1 = e.touches[1];
      const dist = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
      const midX = (t0.clientX + t1.clientX) / 2;
      const midY = (t0.clientY + t1.clientY) / 2;
      touchState = {
        type: 'multi',
        lastDist: dist, lastMidX: midX, lastMidY: midY,
      };
    }
  }, { passive: false });

  canvas.addEventListener("touchmove", (e) => {
    if (game.controlType !== 'touch') return;
    e.preventDefault();
    if (!touchState) return;

    if (e.touches.length === 1 && touchState.type === 'single') {
      const dx = e.touches[0].clientX - touchState.lastX;
      const dy = e.touches[0].clientY - touchState.lastY;
      game.camera.x -= dx;
      game.camera.y -= dy;
      touchState.lastX = e.touches[0].clientX;
      touchState.lastY = e.touches[0].clientY;
      const totalMoved = Math.hypot(e.touches[0].clientX - touchState.startX, e.touches[0].clientY - touchState.startY);
      if (totalMoved > 6) touchState.moved = true;

    } else if (e.touches.length >= 2) {
      if (touchState.type !== 'multi') return;
      const t0 = e.touches[0], t1 = e.touches[1];
      const dist = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
      const midX = (t0.clientX + t1.clientX) / 2;
      const midY = (t0.clientY + t1.clientY) / 2;

      // 패닝
      game.camera.x -= midX - touchState.lastMidX;
      game.camera.y -= midY - touchState.lastMidY;

      // 핀치 줌
      const ratio = dist / touchState.lastDist;
      if (game.battlePhase === "live") { touchState.lastDist = dist; return; }
      const levels = TOUCH_ZOOM_LEVELS;
      const idx = levels.indexOf(game.tileW);
      const curIdx = idx !== -1 ? idx : levels.length - 1;
      if (ratio > 1.20 && curIdx < levels.length - 1) {
        const rect = canvas.getBoundingClientRect();
        const before = toTile(midX - rect.left, midY - rect.top);
        game.tileW = levels[curIdx + 1];
        const afterIso = isoPoint(before.x, before.y);
        const oldIso   = isoPoint(before.x, before.y);
        invalidateTerrainChunkCache();
        touchState.lastDist = dist;
      } else if (ratio < 0.80 && curIdx > 0) {
        game.tileW = levels[curIdx - 1];
        invalidateTerrainChunkCache();
        touchState.lastDist = dist;
      }

      touchState.lastMidX = midX;
      touchState.lastMidY = midY;
    }
  }, { passive: false });

  canvas.addEventListener("touchend", (e) => {
    if (game.controlType !== 'touch') return;
    e.preventDefault();
    if (touchState?.type === 'single' && !touchState.moved && e.changedTouches.length === 1) {
      const rect = canvas.getBoundingClientRect();
      const t = e.changedTouches[0];
      const offsetX = t.clientX - rect.left;
      const offsetY = t.clientY - rect.top;
      // 마우스(5.0타일)보다 보수적인 반경(2.5타일)으로 아군 진형 선택 우선 판정
      const tile = toTile(offsetX, offsetY);
      let touchClosest = null;
      let touchMinDist = 2.5;
      for (const f of game.playerFormations) {
        if (!f.units.some(isUnitAlive)) continue;
        const center = formationCenter(f);
        const d = len(center.x - tile.x, center.y - tile.y);
        if (d < touchMinDist) { touchMinDist = d; touchClosest = f; }
      }
      if (touchClosest) {
        autoSelectDeadline = -1;
        game.selectedId = touchClosest.id;
        game.hudDirty = true;
        refreshButtons();
      } else {
        issueMoveCommand(offsetX, offsetY);
      }
    }
    if (e.touches.length === 0) touchState = null;
    else if (e.touches.length === 1) {
      touchState = {
        type: 'single',
        startX: e.touches[0].clientX, startY: e.touches[0].clientY,
        lastX:  e.touches[0].clientX, lastY:  e.touches[0].clientY,
        moved: false,
      };
    }
  }, { passive: false });

  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    if (game.battlePhase === "live") return;
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
    issueMoveCommand(event.offsetX, event.offsetY);
  });

  function tick(now) {
    if (!tick.last) tick.last = now;
    const dt = Math.min(0.05, (now - tick.last) / 1000);
    tick.last = now;
    if (game.paused) { requestAnimationFrame(tick); return; }
    if (isOnlineMode()) {
      const remaining = advanceOnlineSimulationTo(
        onlineTargetSimulationTick(),
        document.hidden ? ONLINE_MAX_INLINE_CATCHUP_STEPS : MAX_SIMULATION_STEPS,
      );
      if (remaining > ONLINE_CATCHUP_CHUNK_STEPS && !onlineCatchupScheduled) {
        requestOnlineCatchup("resume");
      }
    } else {
      game.simulationAccumulator = Math.min(game.simulationAccumulator + dt * game.speedMultiplier, SIMULATION_STEP * MAX_SIMULATION_STEPS);
      let stepCount = 0;
      while (game.simulationAccumulator >= SIMULATION_STEP && stepCount < MAX_SIMULATION_STEPS) {
        update(SIMULATION_STEP);
        game.simulationAccumulator -= SIMULATION_STEP;
        stepCount += 1;
      }
    }
    maybeSendOnlineChecksum();
    // ── 선택 진형 사망 시 자동 선택 (2초 대기) ────────────────────────
    if (game.battlePhase === 'live') {
      const sel = game.playerFormations.find(f => f.id === game.selectedId);
      const selDead = !sel || !sel.units.some(isUnitAlive);
      if (selDead && autoSelectDeadline < 0) {
        autoSelectDeadline = game.battleTime + 2;
      } else if (!selDead) {
        autoSelectDeadline = -1;
      }
      if (autoSelectDeadline > 0 && game.battleTime >= autoSelectDeadline) {
        const next = game.playerFormations.find(f => f.units.some(isUnitAlive));
        if (next) {
          game.selectedId = next.id;
          centerCameraOn(formationCenter(next));
          game.hudDirty = true;
        }
        autoSelectDeadline = -1;
      }
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
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) requestOnlineCatchup("resume");
  });
  window.addEventListener("focus", () => requestOnlineCatchup("resume"));
  window.addEventListener("pageshow", () => requestOnlineCatchup("resume"));
  window.setInterval(() => {
    if (document.hidden) requestOnlineCatchup("background");
  }, 1000);

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
    if (isHistoricalMode() && !outcome.won) {
      game.battleEndPending = true;
      game.battleEndTimer = 3.0;
      game.battleEndWon = false;
      return;
    }
    if (isHistoricalMode() && outcome.won && scenarioCurrentPhase()?.id !== "encirclement") return;
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
    const won = finalOutcome ? finalOutcome.won : game.battleEndWon;
    submitOnlineResult(won);
    if (isOnlineMode()) disableOnlineRandom();
    showBattleResult(won);
  }

  // ── 시나리오 초기화 공통 ────────────────────────────────────────────
  function resetGameState() {
    game.battlePhase         = "planning";
    _battleTileH = null;
    game.battleTime          = 0;
    game.simulationAccumulator = 0;
    game.speedMultiplier     = 1;
    game.paused              = false;
    pauseOverlay.hidden      = true;
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
    game.floodDamageDealt    = false;
    game.hudRefreshAccumulator = 0;
    game.hudDirty            = true;
    game.speechEnemySighted  = new Set();
    game.scenarioSceneLocked = false;
    game.scenarioMarkers     = [];
    game.scenarioObjectiveState = {};
    game.scenarioSkillUseCounts = {};
    game.scenarioStep        = "none";
    game.scenarioAggro       = false;
    game.scenarioMarkerRevealUntil = 0;
    game.scenarioClearRecorded = false;
    speedToggleButton.classList.remove("active");
  }

  function applyScenario(terrain, playerFormations, enemyFormations) {
    game.terrain          = terrain;
    game.playerFormations = playerFormations;
    game.enemyFormations  = enemyFormations;
    game.terrainRender    = buildTerrainRenderData(terrain);
    invalidateTerrainChunkCache();
    resetGameState();
    game.selectedId = playerFormations[0]?.id ?? 0;
    savedTerrain        = terrain;
    savedPlayerGenerals = playerFormations.map(f => ({ ...f.general }));
    savedEnemyGenerals  = enemyFormations.map(f => ({ ...f.general }));
  }

  function rebuildFormations(terrain, pGens, eGens) {
    const pF = pGens.map((g, i) => {
      const gen = { ...g, kills: 0, losses: 0, alive: true };
      const f = createFormation(i, "player", gen,
        vec(terrain.playerStart.x, terrain.playerStart.y + (i - 2) * 10), vec(1, 0));
      f.speed = "NORMAL";
      f.skillType = normalizeSkillForGeneral(gen, g.skillType || f.skillType, gen.troopType);
      f.general.skillType = f.skillType;
      initializeFormationSlots(f, false);
      return f;
    });
    const eF = eGens.map((g, i) => {
      const gen = { ...g, kills: 0, losses: 0, alive: true };
      const f = createFormation(i, "enemy", gen,
        vec(terrain.enemyStart.x, terrain.enemyStart.y + (i - 2) * 10), vec(-1, 0));
      f.speed = "NORMAL";
      f.skillType = normalizeSkillForGeneral(gen, g.skillType || f.skillType, gen.troopType);
      f.general.skillType = f.skillType;
      initializeFormationSlots(f, false);
      return f;
    });
    return { playerFormations: pF, enemyFormations: eF };
  }

  // ── 빠른 전투 진입 ──────────────────────────────────────────────────
  function enterQuickBattle(isNew) {
    disableOnlineRandom();
    game.mode = "quick";
    game.online = null;
    game.scenarioData = null;
    resetScenarioRuntime();
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
    setScreen("battle");
    centerCameraOn(formationCenter(game.playerFormations[0]));
    refreshHud();
    refreshButtons();
  }

  function enterOnlineBattle(match) {
    enableOnlineRandom(match.seed);
    const { terrain, playerFormations, enemyFormations } = buildOnlineScenario(match);
    applyScenario(terrain, playerFormations, enemyFormations);
    game.mode = "online";
    game.online = {
      roomId: match.roomId,
      side: Number(match.side || 0),
      seed: match.seed,
      tickRate: Number(match.tickRate || 30),
      inputDelayTicks: Number(match.inputDelayTicks || 3),
      receivedAt: performance.now(),
      startedAt: null,
      serverNow: Number(match.serverNow || Date.now()),
      startedAtClient: null,
      netTick: 0,
      simTick: 0,
      lastChecksumTick: 0,
      commandQueue: new Map(),
      resultSubmitted: false,
      simStarted: false,
      waitingForSimStart: true,
      initialHash: null,
      players: match.players || [],
      isGuest: Boolean(onlineClient.isGuest),
    };
    game.speedMultiplier = 1;
    game.paused = false;
    pauseOverlay.hidden = true;
    game.selectedId = playerFormations[0]?.id ?? 0;
    setScreen("battle");
    centerCameraOn(formationCenter(game.playerFormations[0]));
    refreshHud();
    refreshButtons();
    const initialHash = computeOnlineInitialHash();
    game.online.initialHash = initialHash;
    onlineClient.sendClientLoaded(initialHash, match.protocol || "thin-relay-scheduled-lockstep");
    showOnlineSyncNotice("전장 구성 완료. 상대 확인을 기다리는 중...", "info", 0);
  }

  function startOnlineSimulation(message) {
    if (!isOnlineMode() || message.roomId !== game.online.roomId) return;
    const startedAt = Number(message.startedAt || Date.now());
    const serverNow = Number(message.serverNow || startedAt);
    game.online.startedAt = startedAt;
    game.online.serverNow = serverNow;
    game.online.startedAtClient = performance.now() + (startedAt - serverNow);
    game.online.tickRate = Number(message.tickRate || game.online.tickRate || 30);
    game.online.inputDelayTicks = Number(message.inputDelayTicks || game.online.inputDelayTicks || 3);
    game.online.simTick = 0;
    game.online.netTick = 0;
    game.online.lastChecksumTick = 0;
    game.online.commandQueue.clear();
    game.online.simStarted = true;
    game.online.waitingForSimStart = false;
    game.speedMultiplier = 1;
    game.paused = false;
    pauseOverlay.hidden = true;
    startLiveBattle();
    refreshHud();
    refreshButtons();
    showOnlineSyncNotice("양쪽 전장 확인 완료. 전투를 시작합니다.", "ok", 2200);
  }

  function hideScenarioOverlays() {
    if (scenarioHud) scenarioHud.hidden = true;
    if (scenarioDialogue) scenarioDialogue.hidden = true;
    if (scenarioBriefing) scenarioBriefing.hidden = true;
  }

  function applyHistoricalScenario(scenario, terrain) {
    disableOnlineRandom();
    const playerFormations = scenario.player.formations.map((spec, index) =>
      createFormationFromScenarioSpec(spec, "player", index));
    const enemyFormations = scenario.enemy.formations.map((spec, index) =>
      createFormationFromScenarioSpec(spec, "enemy", index));
    applyScenario(terrain, playerFormations, enemyFormations);
    game.mode = "historical";
    game.online = null;
    game.scenarioData = scenario;
    game.scenarioPhaseIndex = -1;
    game.selectedId = playerFormations[0]?.id ?? 0;
    resetScenarioRuntime();
  }

  async function enterHistoricalScenario(id = "cannae") {
    try {
      showGameLoadingScreen(SCENARIO_LOADING_META[id] || null);
      showBattleLoadingMask();
      const scenario = await loadScenarioDefinition(id);
      updateGameLoadingScenarioRoster(scenario.player?.formations || [], scenario.enemy?.formations || []);
      const terrain = await loadScenarioTerrain(scenario);
      applyHistoricalScenario(scenario, terrain);
      setScreen("battle");
      centerCameraOn(formationCenter(game.playerFormations[0]));
      refreshHud();
      refreshButtons();
      beginScenarioPhase(0);
    } catch (error) {
      console.error(error);
      gameLoadingScreen.style.display = "none";
      setScreen("home");
      const toast = document.getElementById("homeToast");
      toast.textContent = "역사 시나리오를 불러오지 못했습니다.";
      toast.hidden = false;
      window.setTimeout(() => { toast.hidden = true; toast.textContent = "준비 중인 기능입니다"; }, 2600);
    }
  }

  function recordHistoricalScenarioClear() {
    const scenarioId = game.scenarioData?.id;
    if (!scenarioId || !onlineClient.token || game.scenarioClearRecorded) return;
    game.scenarioClearRecorded = true;
    onlineClient.recordScenarioClear(scenarioId)
      .then(() => {
        if (onlineClient.player) {
          onlineLoadoutDraft = normalizeOnlineLoadout(onlineClient.player.commanders || []);
        }
      })
      .catch(error => console.warn("[online] scenario clear save failed", error));
  }

  function showVictoryDialogue() {
    const lines = game.scenarioData?.victoryDialogue || [];
    const line = lines[game.scenarioDialogueIndex];
    if (!line) {
      game.scenarioStep = "complete";
      game.scenarioSceneLocked = false;
      hideScenarioOverlays();
      recordHistoricalScenarioClear();
      showBattleResult(true);
      return;
    }
    if (line.camera) centerCameraOn(vec(line.camera.x, line.camera.y));
    scenarioDialogue.hidden = false;
    scenarioBriefing.hidden = true;
    scenarioHud.hidden = false;
    scenarioDialogueSpeaker.textContent = line.speaker || "";
    scenarioDialogueText.textContent = line.text || "";
    scenarioDialoguePortrait.src = line.portrait || "";
    scenarioDialoguePortrait.hidden = !line.portrait;
    scenarioTitle.textContent = game.scenarioData.name + " - 전투 종료";
  }

  function beginScenarioPhase(index) {
    const phases = game.scenarioData?.phases || [];
    if (index >= phases.length) {
      game.battlePhase = "ended";
      game.scenarioSceneLocked = true;
      const vd = game.scenarioData?.victoryDialogue;
      if (vd?.length) {
        game.scenarioStep = "victoryDialogue";
        game.scenarioDialogueIndex = 0;
        showVictoryDialogue();
        updateScenarioHud();
      } else {
        game.scenarioStep = "complete";
        game.scenarioSceneLocked = false;
        hideScenarioOverlays();
        recordHistoricalScenarioClear();
        showBattleResult(true);
      }
      return;
    }
    game.scenarioPhaseIndex = index;
    game.scenarioDialogueIndex = 0;
    game.scenarioObjectiveState = {};
    game.scenarioSkillUseCounts = {};
    game.phaseStartTime = game.battleTime;
    game.scenarioStep = "dialogue";
    game.scenarioSceneLocked = true;
    game.scenarioMarkers = [];
    showScenarioDialogue();
    updateScenarioHud();
    refreshButtons();
  }

  function showScenarioDialogue() {
    const phase = scenarioCurrentPhase();
    const line = phase?.dialogue?.[game.scenarioDialogueIndex];
    if (!line) {
      showScenarioBriefing();
      return;
    }
    if (line.camera) centerCameraOn(vec(line.camera.x, line.camera.y));
    scenarioDialogue.hidden = false;
    scenarioBriefing.hidden = true;
    scenarioHud.hidden = false;
    scenarioDialogueSpeaker.textContent = line.speaker || "";
    scenarioDialogueText.textContent = line.text || "";
    scenarioDialoguePortrait.src = line.portrait || "";
    scenarioDialoguePortrait.hidden = !line.portrait;
    scenarioTitle.textContent = `${game.scenarioData.name} - ${phase.title}`;
  }

  function showScenarioBriefing() {
    const phase = scenarioCurrentPhase();
    const briefing = phase?.briefing || {};
    game.scenarioStep = "briefing";
    game.scenarioSceneLocked = true;
    game.scenarioMarkers = briefing.markers || [];
    if (briefing.camera) centerCameraOn(vec(briefing.camera.x, briefing.camera.y));
    scenarioDialogue.hidden = true;
    scenarioBriefing.hidden = false;
    scenarioHud.hidden = false;
    scenarioBriefingTitle.textContent = phase?.title || "목표";
    scenarioBriefingText.textContent = briefing.text || "";
    updateScenarioHud();
    refreshButtons();
  }

  function startScenarioPhasePlay() {
    const phase = scenarioCurrentPhase();
    game.scenarioStep = "play";
    game.scenarioSceneLocked = false;
    game.scenarioMarkers = [];
    game.scenarioMarkerRevealUntil = 0;
    scenarioDialogue.hidden = true;
    scenarioBriefing.hidden = true;
    scenarioHud.hidden = false;
    applyScenarioPhaseStartEffects(phase);
    if (game.battlePhase === "planning") startLiveBattle();
    updateScenarioHud();
    refreshButtons();
  }

  function applyScenarioPhaseStartEffects(phase) {
    const start = phase?.onStart;
    if (!start) return;
    applyScenarioEffects(start.effects);
    if (typeof start.setEnemyDisorder === "number") {
      game.enemyFormations.forEach((formation) => {
        formation.disorderAccum = Math.max(formation.disorderAccum, start.setEnemyDisorder);
        formation.disorder = Math.max(formation.disorder, start.setEnemyDisorder);
        if (formation.troopType === "infantry") {
          formation.combatOverrides = {
            ...(formation.combatOverrides || {}),
            meleeAttackMult: 0.35,
            meleeDefenseMult: 0.45,
            rangedAttackMult: 0.35,
            rangedDefenseMult: 0.6,
          };
        }
      });
    }
  }

  function scenarioFormationsForEffect(effect) {
    const team = effect.team || "enemy";
    const formations = team === "player" ? game.playerFormations : game.enemyFormations;
    if (effect.formationIds?.length) {
      return effect.formationIds.map(id => scenarioFormation(id, team)).filter(Boolean);
    }
    return formations;
  }

  function applyScenarioEffects(effects) {
    const list = Array.isArray(effects) ? effects : effects ? [effects] : [];
    list.forEach((effect) => {
      const formations = scenarioFormationsForEffect(effect);
      if (effect.type === "setDisorder") {
        formations.forEach((formation) => {
          formation.disorderAccum = Math.max(formation.disorderAccum, effect.value ?? 0);
          formation.disorder = Math.max(formation.disorder, effect.value ?? 0);
        });
      } else if (effect.type === "addDisorder") {
        formations.forEach((formation) => {
          const newVal = Math.min(1.0, formation.disorder + (effect.value ?? 0));
          formation.disorderAccum = newVal;
          formation.disorder = newVal;
        });
      } else if (effect.type === "combatOverrides") {
        formations.forEach((formation) => {
          formation.combatOverrides = {
            ...(formation.combatOverrides || {}),
            ...(effect.values || {}),
          };
        });
      } else if (effect.type === "route") {
        formations.forEach((formation) => {
          const target = scenarioTargetPoint(effect.target, {
            x: formation.team === "enemy" ? MAP_WIDTH : 0,
            y: formation.anchor.y
          });
          formation.retreating = true;
          showRetreatSpeech(formation);
          formation.followTarget = null;
          formation.target = vec(target.x, target.y);
          formation.speed = effect.speed || "FAST";
        });
      } else if (effect.type === "areaDamage") {
        const rect = effect.rect || effect;
        formations.forEach((formation) => {
          formation.units.forEach((unit) => {
            if (!isUnitAlive(unit) || !pointInRect(unit, rect)) return;
            applyUnitDamage(formation, unit, effect.damage || 0, null, { trace: false });
          });
        });
      }
    });
  }

  function recordScenarioSkillUse(formation, skillType) {
    if (!isHistoricalMode() || game.scenarioStep !== "play") return;
    const key = `${formation.scenarioId || formation.id}:${skillType}`;
    game.scenarioSkillUseCounts[key] = (game.scenarioSkillUseCounts[key] || 0) + 1;
  }

  function pointInRect(point, rect) {
    return point.x >= rect.x && point.x <= rect.x + rect.w &&
      point.y >= rect.y && point.y <= rect.y + rect.h;
  }

  function isFormationStoppedInRect(formation, rect) {
    if (!formation || !formation.units.some(isUnitAlive)) return false;
    if (formation.speed !== "STOP") return false;
    return pointInRect(formationCenter(formation), rect);
  }

  function formationRatio(formation) {
    if (!formation) return 0;
    return formationRemainingTroops(formation) / Math.max(1, formationInitialTroops(formation));
  }

  function scenarioFormation(id, side = "player") {
    return formationByScenarioId(id, side);
  }

  function scenarioTargetPoint(target, fallback = null) {
    if (!target) return fallback;
    if (target.marker && game.terrain.markers?.[target.marker]) return game.terrain.markers[target.marker];
    if (typeof target.x === "number" && typeof target.y === "number") return target;
    return fallback;
  }

  function objectivePoint(objective) {
    return scenarioTargetPoint(objective, objective);
  }

  function objectiveProgress(objective, dt) {
    const state = game.scenarioObjectiveState[objective.id] || { elapsed: 0, complete: false };
    if (state.complete) return state;

    if (objective.type === "timer") {
      state.elapsed += dt;
      state.complete = state.elapsed >= (objective.seconds || 0);
    } else if (objective.type === "any") {
      state.complete = (objective.objectives || []).some((child, index) =>
        objectiveProgress({ ...child, id: `${objective.id}:${child.id || index}` }, dt).complete);
    } else if (objective.type === "formationsAtArea") {
      const radius = objective.radius || 8;
      const point = objectivePoint(objective);
      state.complete = objective.formationIds.every((id) => {
        const formation = formationByScenarioId(id, "player");
        if (!formation || !formation.units.some(isUnitAlive)) return false;
        const center = formationCenter(formation);
        return len(center.x - point.x, center.y - point.y) <= radius;
      });
    } else if (objective.type === "formationsAtAreaSequence") {
      const points = objective.points || [];
      const index = Math.min(state.index || 0, points.length);
      if (index >= points.length) {
        state.complete = true;
      } else {
        const point = points[index];
        const radius = point.radius || objective.radius || 8;
        const reached = (objective.formationIds || []).every((id) => {
          const formation = formationByScenarioId(id, objective.team || "player");
          if (!formation || !formation.units.some(isUnitAlive)) return false;
          const center = formationCenter(formation);
          return len(center.x - point.x, center.y - point.y) <= radius;
        });
        if (reached) state.index = index + 1;
        state.complete = (state.index || 0) >= points.length;
      }
    } else if (objective.type === "formationAtArea") {
      const radius = objective.radius || 8;
      const point = objectivePoint(objective);
      const formation = scenarioFormation(objective.formationId, objective.team || "player");
      if (!formation || !formation.units.some(isUnitAlive)) state.complete = false;
      else {
        const center = formationCenter(formation);
        state.complete = len(center.x - point.x, center.y - point.y) <= radius;
      }
    } else if (objective.type === "formationsInRect") {
      state.complete = objective.formationIds.every((id) => {
        const formation = formationByScenarioId(id, "player");
        if (!formation || !formation.units.some(isUnitAlive)) return false;
        return pointInRect(formationCenter(formation), objective);
      });
    } else if (objective.type === "formationsInRectStopped") {
      const allStopped = objective.formationIds.every((id) =>
        isFormationStoppedInRect(formationByScenarioId(id, objective.team || "player"), objective));
      state.elapsed = allStopped ? state.elapsed + dt : 0;
      state.complete = state.elapsed >= (objective.holdSeconds || 0);
    } else if (objective.type === "captureArea") {
      const team = objective.team || "player";
      const rect = objective.rect || objective;
      const formations = (objective.formationIds || []).map(id => scenarioFormation(id, team)).filter(Boolean);
      const occupied = formations.some((formation) =>
        formation.units.some(isUnitAlive) && pointInRect(formationCenter(formation), rect));
      const enemyTeam = team === "player" ? "enemy" : "player";
      const enemies = enemyTeam === "player" ? game.playerFormations : game.enemyFormations;
      const contested = enemies.some((formation) =>
        formation.units.some(isUnitAlive) && !formation.retreated && pointInRect(formationCenter(formation), rect));
      state.elapsed = occupied && (!contested || objective.allowContested) ? state.elapsed + dt : 0;
      state.complete = state.elapsed >= (objective.holdSeconds || 0);
    } else if (objective.type === "enemyInAreaRatio") {
      const rect = objective.rect || objective;
      const formations = objective.formationIds?.length
        ? objective.formationIds.map(id => scenarioFormation(id, "enemy")).filter(Boolean)
        : game.enemyFormations;
      const initial = formations.reduce((sum, formation) => sum + formationInitialTroops(formation), 0);
      const inside = formations.reduce((sum, formation) => sum + formation.units.reduce((unitSum, unit) =>
        unitSum + (isUnitAlive(unit) && pointInRect(unit, rect) ? unitRemainingTroops(unit) : 0), 0), 0);
      state.complete = inside / Math.max(1, initial) >= objective.ratio;
    } else if (objective.type === "allPlayerFormationsInRectStopped") {
      const allStopped = game.playerFormations.every((formation) =>
        isFormationStoppedInRect(formation, objective));
      state.elapsed = allStopped ? state.elapsed + dt : 0;
      state.complete = state.elapsed >= (objective.holdSeconds || 0);
    } else if (objective.type === "skillUsed") {
      const total = objective.formationIds.reduce((sum, id) =>
        sum + (game.scenarioSkillUseCounts[`${id}:${objective.skillType}`] || 0), 0);
      state.complete = total >= (objective.count || 1);
    } else if (objective.type === "floodDamageDealt") {
      state.complete = !!game.floodDamageDealt;
    } else if (objective.type === "surviveSeconds") {
      const formations = (objective.formationIds || []).map(id => scenarioFormation(id, objective.team || "player")).filter(Boolean);
      const ratiosOk = formations.every(formation => formationRatio(formation) >= (objective.minRatio ?? 0));
      state.elapsed = ratiosOk ? state.elapsed + dt : 0;
      state.complete = state.elapsed >= (objective.seconds || 0);
    } else if (objective.type === "formationsTroopsAbove") {
      const team = objective.team || "player";
      const required = objective.requiredCount || (objective.formationIds?.length ?? 0);
      const count = (objective.formationIds || []).reduce((sum, id) => {
        const formation = scenarioFormation(id, team);
        return sum + (formation && formationRatio(formation) >= objective.ratio ? 1 : 0);
      }, 0);
      state.complete = count >= required;
    } else if (objective.type === "formationNotInArea") {
      const radius = objective.radius || 8;
      const point = objectivePoint(objective);
      const formation = scenarioFormation(objective.formationId, objective.team || "player");
      if (!formation || !formation.units.some(isUnitAlive)) state.complete = false;
      else {
        const center = formationCenter(formation);
        state.complete = len(center.x - point.x, center.y - point.y) > radius;
      }
    } else if (objective.type === "formationNearFormation") {
      const a = scenarioFormation(objective.formationId, objective.team || "player");
      const b = scenarioFormation(objective.targetFormationId, objective.targetTeam || objective.team || "player");
      if (!a || !b || !a.units.some(isUnitAlive) || !b.units.some(isUnitAlive)) state.complete = false;
      else {
        const ac = formationCenter(a);
        const bc = formationCenter(b);
        state.complete = len(ac.x - bc.x, ac.y - bc.y) <= (objective.radius || 12);
      }
    } else if (objective.type === "formationNearEnemy") {
      const formation = scenarioFormation(objective.formationId, objective.team || "player");
      const enemy = scenarioFormation(objective.enemyFormationId, objective.enemyTeam || "enemy");
      if (!formation || !enemy || !formation.units.some(isUnitAlive) || !enemy.units.some(isUnitAlive)) state.complete = false;
      else {
        const center = formationCenter(formation);
        const enemyCenter = formationCenter(enemy);
        state.complete = len(center.x - enemyCenter.x, center.y - enemyCenter.y) <= (objective.radius || 8);
      }
    } else if (objective.type === "enemyCommanderBelow") {
      const formation = scenarioFormation(objective.formationId, objective.team || "enemy");
      state.complete = !formation || formationRatio(formation) <= objective.ratio || formation.retreating || formation.retreated;
    } else if (objective.type === "formationRetreated") {
      const formation = scenarioFormation(objective.formationId, objective.team || "enemy");
      state.complete = !formation || formation.retreating || formation.retreated;
    } else if (objective.type === "enemyTroopsBelow") {
      state.complete = objective.formationIds.every((id) => {
        const formation = formationByScenarioId(id, "enemy");
        if (!formation) return true;
        const ratio = formationRatio(formation);
        return ratio <= objective.ratio || formation.retreating || formation.retreated;
      });
    } else if (objective.type === "enemyTotalBelow") {
      const initial = game.enemyFormations.reduce((sum, f) => sum + formationInitialTroops(f), 0);
      const remain = game.enemyFormations.reduce((sum, f) => sum + formationRemainingTroops(f), 0);
      state.complete = remain / Math.max(1, initial) <= objective.ratio;
    }

    game.scenarioObjectiveState[objective.id] = state;
    return state;
  }

  function updateScenarioHud() {
    if (!isHistoricalMode() || !scenarioHud) {
      if (scenarioHud) scenarioHud.hidden = true;
      return;
    }
    const phase = scenarioCurrentPhase();
    scenarioHud.hidden = false;
    scenarioTitle.textContent = `${game.scenarioData.name} - ${phase?.title || ""}`;
    scenarioObjectives.innerHTML = "";
    (phase?.objectives || []).forEach((objective) => {
      const state = game.scenarioObjectiveState[objective.id] || { complete: false };
      const item = document.createElement("div");
      item.className = "scenario-objective";
      item.dataset.complete = state.complete ? "true" : "false";
      item.textContent = `${state.complete ? "완료" : "진행"} · ${objective.label}`;
      scenarioObjectives.appendChild(item);
    });
  }

  function updateHistoricalScenario(dt) {
    if (!isHistoricalMode() || game.scenarioStep !== "play") return;
    const phase = scenarioCurrentPhase();
    if (!phase) return;
    if (game.scenarioMarkerRevealUntil > 0 && game.battleTime >= game.scenarioMarkerRevealUntil) {
      game.scenarioMarkers = [];
      game.scenarioMarkerRevealUntil = 0;
    }
    const objectives = phase.objectives || [];
    const complete = objectives.every((objective) => objectiveProgress(objective, dt).complete);
    updateScenarioHud();
    if (checkHistoricalFailure()) {
      game.battlePhase = "ended";
      game.scenarioStep = "complete";
      showBattleResult(false);
      return;
    }
    if (complete) {
      applyScenarioEffects(phase.onComplete?.effects);
      beginScenarioPhase(game.scenarioPhaseIndex + 1);
    }
  }

  function revealScenarioMarkers() {
    if (!isHistoricalMode() || game.scenarioStep !== "play") return;
    const phase = scenarioCurrentPhase();
    const markers = phase?.briefing?.markers || [];
    if (!markers.length) return;
    game.scenarioMarkers = markers;
    game.scenarioMarkerRevealUntil = game.battleTime + 5;
  }

  function checkHistoricalFailure() {
    const failure = game.scenarioData?.failure;
    const failures = Array.isArray(failure) ? failure : failure ? [failure] : [];
    return failures.some((rule) => {
      if (rule.type === "playerTotalBelow") {
        const initial = game.playerFormations.reduce((sum, f) => sum + formationInitialTroops(f), 0);
        const remain = game.playerFormations.reduce((sum, f) => sum + formationRemainingTroops(f), 0);
        return remain / Math.max(1, initial) <= rule.ratio;
      }
      if (rule.type === "formationBelow") {
        const formation = scenarioFormation(rule.formationId, rule.team || "player");
        return !!formation && formationRatio(formation) <= rule.ratio;
      }
      if (rule.type === "formationsBelowCount") {
        const count = (rule.formationIds || []).reduce((sum, id) => {
          const formation = scenarioFormation(id, rule.team || "player");
          return sum + (formation && formationRatio(formation) <= rule.ratio ? 1 : 0);
        }, 0);
        return count >= (rule.count || 1);
      }
      return false;
    });
  }

  function updateHistoricalAI(dt) {
    if (!isHistoricalMode() || game.battlePhase !== "live" || game.scenarioStep !== "play") return;
    game.aiTimer += dt;
    if (game.aiTimer < 1.0) return;
    game.aiTimer = 0;
    const phaseId = scenarioCurrentPhase()?.id;
    const trap = game.terrain.markers?.romanCenterTrap || { x: 108, y: 82 };

    const setMove = (formation, target, speed = "NORMAL", density = null) => {
      if (!formation || formation.retreated || !formation.units.some(isUnitAlive)) return;
      formation.followTarget = null;
      formation.target = vec(target.x, target.y);
      formation.speed = speed;
      if (density) formation.density = normalizeDensityForTroopType(formation.troopType, density);
    };

    const holdAt = (formation, target, density = null) => {
      if (!formation || formation.retreated || !formation.units.some(isUnitAlive)) return;
      formation.followTarget = null;
      formation.target = null;
      formation.speed = "STOP";
      formation.facing = normalize(vec(-1, 0));
      if (density) formation.density = normalizeDensityForTroopType(formation.troopType, density);
      if (target) {
        const center = formationCenter(formation);
        if (len(center.x - target.x, center.y - target.y) > 2.0) {
          formation.target = vec(target.x, target.y);
          formation.speed = "NORMAL";
        }
      }
    };

    const nearestPlayerTo = (formation) => {
      const livePlayers = game.playerFormations.filter(f => f.units.some(isUnitAlive) && !f.retreated);
      if (!livePlayers.length || !formation) return null;
      const center = formationCenter(formation);
      return livePlayers.reduce((best, candidate) => {
        const bc = formationCenter(best);
        const cc = formationCenter(candidate);
        return len(cc.x - center.x, cc.y - center.y) < len(bc.x - center.x, bc.y - center.y)
          ? candidate
          : best;
      });
    };

    const forwardPlayerTo = (formation) => {
      const livePlayers = game.playerFormations.filter(f => f.units.some(isUnitAlive) && !f.retreated);
      if (!livePlayers.length || !formation) return null;
      const center = formationCenter(formation);
      const moveDir = formation.target ? normalize(sub(formation.target, center)) : vec();
      const forward = len(moveDir.x, moveDir.y) > 0.001 ? moveDir : normalize(formation.facing || vec(-1, 0));
      const scored = livePlayers.map((candidate) => {
        const candidateCenter = formationCenter(candidate);
        const toCandidate = sub(candidateCenter, center);
        const distance = Math.max(0.001, len(toCandidate.x, toCandidate.y));
        const direction = normalize(toCandidate);
        return {
          candidate,
          distance,
          dot: forward.x * direction.x + forward.y * direction.y
        };
      });
      const frontScored = scored.filter(item => item.dot > -0.15);
      return (frontScored.length ? frontScored : scored)
        .sort((a, b) => (b.dot - a.dot) || (a.distance - b.distance))[0]?.candidate || null;
    };

    const pursue = (formation, targetFormation, speed = "NORMAL", density = null) => {
      if (!formation || !targetFormation || formation.retreated || formation.retreating) return;
      formation.followTarget = targetFormation;
      formation.target = formationCenter(targetFormation);
      formation.speed = speed;
      if (density) formation.density = normalizeDensityForTroopType(formation.troopType, density);
    };

    const routeAtHalf = (id) => {
      const formation = formationByScenarioId(id, "enemy");
      if (!formation || formation.retreating || formation.retreated) return;
      const ratio = formationRatio(formation);
      if (ratio <= 0.5) {
        formation.retreating = true;
        showRetreatSpeech(formation);
        formation.followTarget = null;
        formation.target = vec(MAP_WIDTH, formation.anchor.y);
        formation.speed = "FAST";
      }
    };

    const phase = scenarioCurrentPhase();
    const phaseAi = phase?.ai;

    const actionFormation = (action) =>
      formationByScenarioId(action.formationId, action.team || "enemy");

    const actionTarget = (action, formation = null) =>
      action.targetMode === "frontmostEnemyInfantry" ? formationCenter(
        game.enemyFormations
          .filter((candidate) => candidate.troopType === "infantry" && candidate.units.some(isUnitAlive) && !candidate.retreated)
          .sort((a, b) => formationCenter(a).x - formationCenter(b).x)[0] || formation
      ) :
      scenarioTargetPoint(action.target, action.marker ? game.terrain.markers?.[action.marker] : null) ||
      (typeof action.x === "number" && typeof action.y === "number" ? action : null) ||
      (formation ? formationCenter(formation) : null);

    const targetFormationForAction = (action, formation = null) => {
      if (action.targetFormationId) {
        return formationByScenarioId(action.targetFormationId, action.targetTeam || "player");
      }
      if (action.targetMode === "nearestPlayer") return nearestPlayerTo(formation);
      if (action.targetMode === "forwardPlayer") return forwardPlayerTo(formation);
      return null;
    };

    const runScenarioAiAction = (action) => {
      if (action.afterObjective && !game.scenarioObjectiveState[action.afterObjective]?.complete) return;
      if (action.untilObjective && game.scenarioObjectiveState[action.untilObjective]?.complete) return;
      if (action.startAfterSeconds && (game.battleTime - game.phaseStartTime) < action.startAfterSeconds) return;
      if (action.delayAfterAggro != null && (!game.scenarioAggro || (game.battleTime - game.scenarioAggroTime) < action.delayAfterAggro)) return;
      if (action.type === "routeAtRatio") {
        const formation = actionFormation(action);
        if (!formation || formation.retreating || formation.retreated) return;
        if (formationRatio(formation) <= (action.ratio ?? 0.5)) {
          formation.retreating = true;
          showRetreatSpeech(formation);
          formation.followTarget = null;
          const target = actionTarget(action, formation) || { x: MAP_WIDTH, y: formation.anchor.y };
          formation.target = vec(target.x, target.y);
          formation.speed = action.speed || "FAST";
        }
        return;
      }

      const formation = actionFormation(action);
      if (!formation || formation.retreating || formation.retreated) return;
      if (action.type === "moveTo" || action.type === "moveToDynamic") {
        const target = actionTarget(action, formation);
        if (!target) return;
        const center = formationCenter(formation);
        const reached = len(center.x - target.x, center.y - target.y) <= (action.holdRadius || 2.5);
        if (reached && action.holdOnReach !== false) {
          holdAt(formation, null, action.density || null);
        } else {
          setMove(formation, target, action.speed || "NORMAL", action.density || null);
        }
      } else if (action.type === "hold") {
        holdAt(formation, actionTarget(action, formation), action.density || null);
      } else if (action.type === "pursue") {
        pursue(formation, targetFormationForAction(action, formation), action.speed || "NORMAL", action.density || null);
      } else if (action.type === "setDisorder") {
        formation.disorderAccum = Math.max(formation.disorderAccum, action.value ?? 0);
        formation.disorder = Math.max(formation.disorder, action.value ?? 0);
      }
    };

    if (phaseAi?.actions?.length) {
      if (phaseAi.aggroOnEnemyLoss && !game.scenarioAggro && game.enemyFormations.some(f => (f.general.losses || 0) > 0)) {
        game.scenarioAggro = true;
        game.scenarioAggroTime = game.battleTime;
      }
      if (game.scenarioAggro && phaseAi.aggroActions?.length) {
        phaseAi.aggroActions.forEach(runScenarioAiAction);
      } else {
        phaseAi.actions.forEach(runScenarioAiAction);
      }
      return;
    }

    if (phaseId === "deployment") {
      if (!game.scenarioAggro && game.enemyFormations.some(f => (f.general.losses || 0) > 0)) {
        game.scenarioAggro = true;
      }
      if (game.scenarioAggro) {
        game.enemyFormations.forEach((formation) => {
          pursue(formation, nearestPlayerTo(formation), "NORMAL", formation.troopType === "infantry" ? "TIGHT" : "NORMAL");
        });
        return;
      }
      const targets = {
        scipio: { x: 128, y: 60 },
        paullus: { x: 128, y: 70 },
        servilius: { x: 128, y: 80 },
        minucius: { x: 128, y: 90 },
        varro: { x: 128, y: 100 },
      };
      Object.entries(targets).forEach(([id, target]) => {
        const formation = formationByScenarioId(id, "enemy");
        if (!formation) return;
        const center = formationCenter(formation);
        const reached = len(center.x - target.x, center.y - target.y) <= 2.5;
        if (reached) holdAt(formation, null, formation.troopType === "infantry" ? "TIGHT" : "NORMAL");
        else setMove(formation, target, "FAST", formation.troopType === "infantry" ? "TIGHT" : "NORMAL");
      });
    } else if (phaseId === "lure") {
      const mago = formationByScenarioId("mago", "player");
      const gisgo = formationByScenarioId("gisgo", "player");
      const hannibal = formationByScenarioId("hannibal", "player");
      const paullus = formationByScenarioId("paullus", "enemy");
      const servilius = formationByScenarioId("servilius", "enemy");
      const minucius = formationByScenarioId("minucius", "enemy");
      pursue(paullus, forwardPlayerTo(paullus) || mago, "NORMAL", "TIGHT");
      pursue(servilius, forwardPlayerTo(servilius) || gisgo, "NORMAL", "TIGHT");
      pursue(minucius, forwardPlayerTo(minucius) || hannibal || gisgo || mago, "NORMAL", "TIGHT");
      holdAt(formationByScenarioId("scipio", "enemy"), null, "NORMAL");
      holdAt(formationByScenarioId("varro", "enemy"), null, "NORMAL");
      routeAtHalf("scipio");
      routeAtHalf("varro");
    } else if (phaseId === "encirclement") {
      const frontEnemy = game.enemyFormations
        .filter((formation) => formation.troopType === "infantry" && formation.units.some(isUnitAlive) && !formation.retreated)
        .sort((a, b) => formationCenter(a).x - formationCenter(b).x)[0];
      const gatherPoint = frontEnemy ? formationCenter(frontEnemy) : trap;
      game.enemyFormations.forEach((formation) => {
        if (formation.troopType !== "infantry") return;
        formation.disorderAccum = Math.max(formation.disorderAccum, 0.7);
        formation.disorder = Math.max(formation.disorder, 0.7);
        if (formation === frontEnemy) {
          holdAt(formation, null, "TIGHT");
        } else {
          setMove(formation, gatherPoint, "FAST", "TIGHT");
        }
      });
    }
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
    showGameLoadingScreen();
    setScreen("battle");
    game.hudDirty = true;
    refreshHud();
    refreshButtons();
  }

  // ── 전투 결과 화면 ──────────────────────────────────────────────────
  function showBattleResult(won) {
    setTopbarCollapsed(false);
    const isGuest = isOnlineMode() && Boolean(game.online?.isGuest);
    const onlineResult = isOnlineMode() && !isGuest;
    const isScenarioVictory = isHistoricalMode() && won;
    const isScenarioDefeat  = isHistoricalMode() && !won;
    const replayBtn = document.getElementById("resultReplay");
    const newBattleBtn = document.getElementById("resultNewBattle");
    const homeBtn = document.getElementById("resultHome");
    if (battleResultScreen) battleResultScreen.dataset.online = isOnlineMode() ? "true" : "false";
    const confirmBtn = document.getElementById("resultConfirm");
    const retryBtn = document.getElementById("resultScenarioRetry");
    const scenarioHeader = document.getElementById("resultScenarioHeader");
    const scenarioIcon = document.getElementById("resultScenarioIcon");
    const scenarioResultBadge = scenarioHeader?.querySelector(".result-scenario-success-badge");

    const localBattleResult = !isOnlineMode();
    if (battleResultScreen) battleResultScreen.dataset.cardResult = (isOnlineMode() || localBattleResult) ? "true" : "false";

    if (isScenarioVictory) {
      if (replayBtn) replayBtn.hidden = true;
      if (newBattleBtn) newBattleBtn.hidden = true;
      if (homeBtn) homeBtn.hidden = true;
      if (confirmBtn) confirmBtn.hidden = false;
      if (retryBtn) retryBtn.hidden = true;
      if (scenarioHeader) scenarioHeader.hidden = true;
    } else if (isScenarioDefeat) {
      if (replayBtn) replayBtn.hidden = true;
      if (newBattleBtn) newBattleBtn.hidden = true;
      if (homeBtn) {
        homeBtn.hidden = false;
        homeBtn.textContent = "시나리오 선택";
      }
      if (confirmBtn) confirmBtn.hidden = true;
      if (retryBtn) retryBtn.hidden = false;
      if (scenarioHeader) scenarioHeader.hidden = true;
    } else {
      if (replayBtn) replayBtn.hidden = isOnlineMode();
      if (newBattleBtn) newBattleBtn.hidden = isOnlineMode();
      if (homeBtn) {
        homeBtn.hidden = false;
        homeBtn.textContent = onlineResult ? "온라인 로비로" : "홈 화면";
      }
      if (confirmBtn) confirmBtn.hidden = true;
      if (retryBtn) retryBtn.hidden = true;
      if (scenarioHeader) scenarioHeader.hidden = true;
    }

    const verdict = document.getElementById("resultVerdict");
    verdict.textContent = isScenarioVictory
      ? `${game.scenarioData.name} 승리`
      : won ? "승 리" : "패 배";
    verdict.className   = `result-verdict ${won ? "victory" : "defeat"}`;
    if (isHistoricalMode()) {
      verdict.textContent = `${game.scenarioData?.name || ""} ${won ? "승리" : "패배"}`.trim();
      if (scenarioIcon) {
        scenarioIcon.src = historicalScenarioIconSrc(game.scenarioData?.id);
        scenarioIcon.alt = game.scenarioData?.name || "";
      }
      if (scenarioResultBadge) {
        scenarioResultBadge.textContent = won ? "성공" : "실패";
        scenarioResultBadge.classList.toggle("is-failed", !won);
      }
    }

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

    renderBattleResultCommanderCards();
    setScreen("battleResult");
  }

  function battleResultProgressContainer() {
    const panel = document.querySelector("#battleResultScreen .result-panel");
    if (!panel) return null;
    let container = document.getElementById("resultCommanderProgress");
    if (!container) {
      container = document.createElement("div");
      container.id = "resultCommanderProgress";
      container.className = "result-commander-progress";
      const totals = panel.querySelector(".result-totals");
      panel.insertBefore(container, totals?.nextSibling || panel.querySelector(".result-actions"));
    }
    return container;
  }

  function renderBattleResultOnlineCommanderCards() {
    const container = battleResultProgressContainer();
    if (!container) return;
    if (!isOnlineMode()) {
      container.hidden = true;
      container.innerHTML = "";
      return;
    }
    container.hidden = false;
    const progress = onlineLastResult?.my?.commanderProgress || [];
    const progressBySlot = new Map();
    const progressByTemplate = new Map();
    progress.forEach((item, index) => {
      if (Number.isInteger(item.slotIndex)) progressBySlot.set(item.slotIndex, item);
      if (item.templateId) progressByTemplate.set(item.templateId, item);
      progressBySlot.set(index, item);
    });
    const pending = !onlineLastResult;
    const guest = Boolean(game.online?.isGuest);
    const cards = game.playerFormations.map((formation, index) => {
      const templateId = formation.general.templateId || formation.general.id || formation.general.name;
      const progressItem = progressBySlot.get(index) || progressByTemplate.get(templateId) || null;
      return {
        ...formation.general,
        ...progressItem,
        templateId,
        name: progressItem?.name || formation.general.name,
        portrait: progressItem?.portrait || formation.general.portrait,
        slotIndex: index,
        battleKills: Math.round(Math.max(0, formation.general.kills || 0)),
        battleLosses: Math.round(Math.max(0, formation.general.losses || 0)),
        battleRemaining: Math.round(formationRemainingTroops(formation)),
        levelAfter: progressItem?.levelAfter ?? formation.general.level ?? 0,
        expAfter: progressItem?.expAfter ?? formation.general.exp ?? 0,
        gainedExp: progressItem?.gainedExp ?? 0,
        nextRequiredExp: progressItem?.nextRequiredExp ?? progressItem?.requiredExp ?? 0,
        leveledUp: Boolean(progressItem?.leveledUp),
        hasProgress: Boolean(progressItem),
      };
    });
    if (!cards.length) {
      container.innerHTML = `<div class="result-growth-title">장수 결과</div><div class="result-growth-empty">표시할 아군 장수 정보가 없습니다.</div>`;
      return;
    }
    container.innerHTML = `
      <div class="result-growth-title">장수 결과</div>
      <div class="result-growth-grid">
        ${cards.map(item => {
          const levelAfter = item.levelAfter ?? item.levelBefore ?? 0;
          const isMax = levelAfter >= 50;
          const expAfter = item.expAfter || 0;
          const nextReq = item.nextRequiredExp ?? item.requiredExp ?? 0;
          const expPct = isMax ? 100 : (nextReq > 0 ? Math.min(100, expAfter / nextReq * 100) : 0);
          const gainedExp = item.gainedExp || 0;
          const expLabel = isMax ? "MAX" : `${formatTroops(expAfter)} / ${formatTroops(nextReq)}`;
          const note = guest
            ? "게스트 경기는 장수 경험치가 저장되지 않습니다."
            : pending
              ? "장수 성장 집계 중입니다."
              : item.hasProgress
                ? (gainedExp > 0 ? "이번 경기 경험치가 반영되었습니다." : "이번 경기에서 반영되는 경험치가 없습니다.")
                : "이번 경기에서 반영되는 경험치가 없습니다.";
          const levelUpIcon = item.leveledUp
            ? `<img class="result-growth-levelup-icon" src="./assets/ui/levelup_icon.png" alt="" aria-hidden="true" draggable="false" />`
            : "";
          return `
            <div class="result-growth-card ${item.leveledUp ? "is-level-up" : ""}">
              ${onlinePortraitMarkup(item, "result-growth-portrait", { overlayHtml: levelUpIcon })}
              <div class="result-growth-main">
                ${item.leveledUp ? `<div class="result-growth-levelup-row"><span class="result-growth-levelup">LEVEL UP</span></div>` : ""}
                <div class="result-growth-header">
                  <span class="result-growth-name">${escapeHtml(item.name || item.templateId)}</span>
                  <div class="result-growth-lv-badge">
                    <span class="result-growth-lv">Lv ${levelAfter}</span>
                  </div>
                </div>
                <div class="result-growth-exp-row">
                  <div class="result-growth-expbar">
                    <div class="result-growth-expbar-fill" style="width:${expPct.toFixed(1)}%"></div>
                  </div>
                  <span class="result-growth-exp-text">${gainedExp > 0 ? `+${formatTroops(gainedExp)} EXP · ` : ""}${expLabel}</span>
                </div>
                <div class="result-growth-battle-stats">
                  <div class="result-growth-battle-stat"><span>격파</span><strong>${formatTroops(item.battleKills)}</strong></div>
                  <div class="result-growth-battle-stat"><span>손실</span><strong>${formatTroops(item.battleLosses)}</strong></div>
                  <div class="result-growth-battle-stat"><span>잔여</span><strong>${formatTroops(item.battleRemaining)}</strong></div>
                </div>
                <div class="result-growth-note">${escapeHtml(note)}</div>
              </div>
            </div>`;
        }).join("")}
      </div>
    `;
    settleOnlinePortraitLoading(container);
  }

  function renderBattleResultQuickCommanderCards() {
    const container = battleResultProgressContainer();
    if (!container) return;
    if (isOnlineMode()) {
      container.hidden = true;
      container.innerHTML = "";
      return;
    }
    container.hidden = false;
    const cards = game.playerFormations.map((formation, index) => ({
      ...formation.general,
      slotIndex: index,
      battleKills: Math.round(Math.max(0, formation.general.kills || 0)),
      battleLosses: Math.round(Math.max(0, formation.general.losses || 0)),
      battleRemaining: Math.round(formationRemainingTroops(formation)),
    }));
    if (!cards.length) {
      container.innerHTML = `<div class="result-growth-title">장수별 전투 결과</div><div class="result-growth-empty">표시할 장수 결과가 없습니다.</div>`;
      return;
    }
    container.innerHTML = `
      <div class="result-growth-title">장수별 전투 결과</div>
      <div class="result-growth-grid">
        ${cards.map(item => `
          <div class="result-growth-card is-battle-only">
            ${onlinePortraitMarkup(item, "result-growth-portrait")}
            <div class="result-growth-main">
              <div class="result-growth-header">
                <span class="result-growth-name">${escapeHtml(item.name || `Commander ${item.slotIndex + 1}`)}</span>
              </div>
              <div class="result-growth-battle-stats">
                <div class="result-growth-battle-stat"><span>격파</span><strong>${formatTroops(item.battleKills)}</strong></div>
                <div class="result-growth-battle-stat"><span>손실</span><strong>${formatTroops(item.battleLosses)}</strong></div>
                <div class="result-growth-battle-stat"><span>잔여</span><strong>${formatTroops(item.battleRemaining)}</strong></div>
              </div>
            </div>
          </div>
        `).join("")}
      </div>
    `;
    settleOnlinePortraitLoading(container);
  }

  function renderBattleResultCommanderCards() {
    if (isOnlineMode()) {
      renderBattleResultOnlineCommanderCards();
      return;
    }
    renderBattleResultQuickCommanderCards();
  }

  function renderBattleResultOnlineProgress() {
    return renderBattleResultOnlineCommanderCards();
    const container = battleResultProgressContainer();
    if (!container) return;
    if (!isOnlineMode()) {
      container.hidden = true;
      container.innerHTML = "";
      return;
    }
    if (game.online?.isGuest) {
      container.hidden = false;
      container.innerHTML = `<div class="result-guest-notice">로그인 이후에 게임결과를 저장할 수 있습니다.</div>`;
      return;
    }
    const progress = onlineLastResult?.my?.commanderProgress || [];
    if (!onlineLastResult) {
      container.hidden = false;
      container.innerHTML = `<div class="result-growth-title">장수 성장 집계 중...</div>`;
      return;
    }
    if (!progress.length) {
      container.hidden = false;
      container.innerHTML = `<div class="result-growth-title">장수 성장</div><div class="result-growth-empty">이번 경기에서 반영된 장수 경험치가 없습니다.</div>`;
      return;
    }
    container.hidden = false;
    const growthStatRow = (label, bVal, aVal) => {
      if (bVal == null && aVal == null) return "";
      const b = bVal ?? aVal;
      const a = aVal ?? bVal;
      const diff = (a != null && b != null) ? a - b : 0;
      const cls = diff > 0 ? "rg-up" : diff < 0 ? "rg-dn" : "";
      const diffBadge = diff > 0
        ? `<span class="rg-stat-diff">+${diff}</span>`
        : diff < 0 ? `<span class="rg-stat-diff rg-dn">${diff}</span>` : "";
      return `
        <div class="rg-stat-row">
          <span class="rg-stat-name">${label}</span>
          <span class="rg-stat-before">${b ?? "-"}</span>
          <span class="rg-stat-arrow">→</span>
          <span class="rg-stat-after ${cls}">${a ?? "-"}</span>
          ${diffBadge}
        </div>`;
    };
    container.innerHTML = `
      <div class="result-growth-title">장수 성장</div>
      <div class="result-growth-grid">
        ${progress.map(item => {
          const before = item.statsBefore || {};
          const after = item.statsAfter || {};
          const levelAfter = item.levelAfter ?? item.levelBefore ?? 0;
          const isMax = levelAfter >= 50;
          const expAfter = item.expAfter || 0;
          const nextReq = item.nextRequiredExp ?? item.requiredExp ?? 0;
          const expPct = isMax ? 100 : (nextReq > 0 ? Math.min(100, expAfter / nextReq * 100) : 0);
          const gainedExp = item.gainedExp || 0;
          const expLabel = isMax
            ? "MAX"
            : `${formatTroops(expAfter)} / ${formatTroops(nextReq)}`;
          const levelUpIcon = item.leveledUp
            ? `<img class="result-growth-levelup-icon" src="./assets/ui/levelup_icon.png" alt="" aria-hidden="true" draggable="false" />`
            : "";
          return `
            <div class="result-growth-card ${item.leveledUp ? "is-level-up" : ""}">
              ${onlinePortraitMarkup(item, "result-growth-portrait", { overlayHtml: levelUpIcon })}
              <div class="result-growth-main">
                ${item.leveledUp ? `<div class="result-growth-levelup-row"><span class="result-growth-levelup">LEVEL UP</span></div>` : ""}
                <div class="result-growth-header">
                  <span class="result-growth-name">${escapeHtml(item.name || item.templateId)}</span>
                  <div class="result-growth-lv-badge">
                    <span class="result-growth-lv">Lv ${levelAfter}</span>
                  </div>
                </div>
                <div class="result-growth-exp-row">
                  <div class="result-growth-expbar">
                    <div class="result-growth-expbar-fill" style="width:${expPct.toFixed(1)}%"></div>
                  </div>
                  <span class="result-growth-exp-text">${gainedExp > 0 ? `+${formatTroops(gainedExp)} EXP · ` : ""}${expLabel}</span>
                </div>
              </div>
            </div>`;
        }).join("")}
      </div>
    `;
    settleOnlinePortraitLoading(container);
  }

  // ── 새 화면 이벤트 핸들러 ────────────────────────────────────────────
  // 홈: 빠른 전투
  function setOnlineStatus(text) {
    if (onlineMatchStatus) onlineMatchStatus.textContent = text;
    if (onlineAuthStatus) onlineAuthStatus.textContent = text;
  }

  function showOnlineSyncNotice(text, tone = "info", durationMs = 5000) {
    if (!onlineSyncNotice) return;
    window.clearTimeout(onlineSyncNoticeTimer);
    onlineSyncNotice.textContent = text;
    onlineSyncNotice.dataset.tone = tone;
    onlineSyncNotice.hidden = false;
    if (durationMs > 0) {
      onlineSyncNoticeTimer = window.setTimeout(hideOnlineSyncNotice, durationMs);
    }
  }

  function hideOnlineSyncNotice() {
    if (!onlineSyncNotice) return;
    window.clearTimeout(onlineSyncNoticeTimer);
    onlineSyncNoticeTimer = null;
    onlineSyncNotice.hidden = true;
    onlineSyncNotice.textContent = "";
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;",
    })[char]);
  }

  function onlineCardFor(element) {
    return element?.closest?.(".online-card") || null;
  }

  function makeOnlineButton(id, label, className = "btn-stone") {
    let button = document.getElementById(id);
    if (!button) {
      button = document.createElement("button");
      button.id = id;
      button.type = "button";
      button.className = className;
      button.textContent = label;
    }
    return button;
  }

  function syncOnlineHeaderActions() {
    const header = onlineScreen?.querySelector(".online-header");
    if (!header || !onlineBackBtn) return;
    let headerActions = header.querySelector(".online-header-actions");
    if (!headerActions) {
      headerActions = document.createElement("div");
      headerActions.className = "online-header-actions";
      header.appendChild(headerActions);
    }
    if (!headerActions.contains(onlineBackBtn)) headerActions.appendChild(onlineBackBtn);
    if (!onlineLogoutBtn) onlineLogoutBtn = makeOnlineButton("onlineLogoutBtn", "로그아웃");
    onlineLogoutBtn.textContent = "로그아웃";
    if (!headerActions.contains(onlineLogoutBtn)) headerActions.appendChild(onlineLogoutBtn);
    onlineLogoutBtn.hidden = !onlineClient.player || !["commanders", "match"].includes(onlinePage);
  }

  function ensureOnlineUiScaffold() {
    const authCard = onlineCardFor(onlineAuthForm);
    const commanderCard = onlineCardFor(onlineCommanders);
    const matchCard = onlineCardFor(onlineMatchStatus);
    const recentCard = onlineCardFor(onlineRecentMatches);
    const leaderboardCard = onlineCardFor(onlineLeaderboard);
    const header = onlineScreen?.querySelector(".online-header");
    let commanderPoolCard = document.getElementById("onlineCommanderPoolCard");
    if (!commanderPoolCard && commanderCard?.parentElement) {
      commanderPoolCard = document.createElement("section");
      commanderPoolCard.id = "onlineCommanderPoolCard";
      commanderPoolCard.className = "online-card";
      commanderPoolCard.innerHTML = `<h3>전체 장수</h3><div id="onlineCommanderPool" class="online-commander-pool" data-online-commander-pool></div>`;
      commanderCard.parentElement.insertBefore(commanderPoolCard, commanderCard.nextSibling);
    }
    onlineCommanderPool = document.getElementById("onlineCommanderPool");

    authCard?.classList.add("online-page-card", "online-auth-card");
    commanderCard?.classList.add("online-page-card", "online-commanders-card");
    commanderCard?.classList.remove("online-card--wide");
    commanderPoolCard?.classList.add("online-page-card", "online-pool-card-page");
    matchCard?.classList.add("online-page-card", "online-match-card");
    recentCard?.classList.add("online-page-card", "online-records-card", "online-card--wide");
    leaderboardCard?.classList.add("online-page-card", "online-records-card");

    const commanderTitle = commanderCard?.querySelector("h3");
    if (commanderTitle) commanderTitle.textContent = "출전장수";

    if (authCard && !onlineAuthStatus) {
      onlineAuthStatus = document.createElement("div");
      onlineAuthStatus.id = "onlineAuthStatus";
      onlineAuthStatus.className = "online-status";
      onlineAuthStatus.textContent = "로그인 후 온라인 대전을 시작할 수 있습니다.";
      authCard.appendChild(onlineAuthStatus);
    }

    syncOnlineHeaderActions();

    if (commanderCard) {
      if (onlineProfile && onlineProfile.parentElement !== commanderCard) {
        commanderCard.insertBefore(onlineProfile, onlineCommanders);
      }
      let actions = commanderCard.querySelector(".online-loadout-actions");
      if (!actions) {
        actions = document.createElement("div");
        actions.className = "online-actions online-loadout-actions";
        commanderCard.appendChild(actions);
      }
      let loadoutHint = commanderCard.querySelector(".online-loadout-action-hint");
      if (!loadoutHint) {
        loadoutHint = document.createElement("div");
        loadoutHint.className = "online-loadout-action-hint";
        loadoutHint.textContent = "전투에 출전할 장수 5명을 설정해주세요.";
        commanderCard.insertBefore(loadoutHint, actions);
      }
      onlineRecordsBtn = makeOnlineButton("onlineRecordsBtn", "전적/랭킹");
      onlineProfileEditBtn = makeOnlineButton("onlineProfileEditBtn", "프로필 수정");
      onlineSaveLoadoutBtn = makeOnlineButton("onlineSaveLoadoutBtn", "편성 저장");
      onlineGoMatchBtn = makeOnlineButton("onlineGoMatchBtn", "매칭 화면으로", "btn-primary");
      onlineLogoutBtn = onlineLogoutBtn || makeOnlineButton("onlineLogoutBtn", "로그아웃");
      onlineLogoutBtn.hidden = false;
      [onlineProfileEditBtn, onlineSaveLoadoutBtn, onlineGoMatchBtn].forEach((button) => {
        if (!actions.contains(button)) actions.appendChild(button);
      });
      if (onlineRecordsBtn) {
        onlineRecordsBtn.hidden = true;
        if (actions.contains(onlineRecordsBtn)) actions.removeChild(onlineRecordsBtn);
      }
      if (onlineSaveLoadoutBtn) {
        onlineSaveLoadoutBtn.hidden = true;
        if (actions.contains(onlineSaveLoadoutBtn)) actions.removeChild(onlineSaveLoadoutBtn);
      }
    }

    if (matchCard) {
      if (!onlineMatchPlayerInfo) {
        onlineMatchPlayerInfo = document.createElement("div");
        onlineMatchPlayerInfo.id = "onlineMatchPlayerInfo";
        onlineMatchPlayerInfo.className = "online-profile";
        matchCard.insertBefore(onlineMatchPlayerInfo, onlineMatchStatus);
      }
      if (!onlineMatchRoster) {
        onlineMatchRoster = document.createElement("div");
        onlineMatchRoster.id = "onlineMatchRoster";
        onlineMatchRoster.className = "online-match-roster";
        matchCard.insertBefore(onlineMatchRoster, onlineMatchStatus);
      }
      if (!matchCard.querySelector(".online-search-anim")) {
        const anim = document.createElement("div");
        anim.className = "online-search-anim";
        anim.setAttribute("aria-hidden", "true");
        matchCard.insertBefore(anim, onlineMatchStatus);
      }
      if (!onlineOpponentPreview) {
        onlineOpponentPreview = document.createElement("div");
        onlineOpponentPreview.id = "onlineOpponentPreview";
        onlineOpponentPreview.className = "online-opponent-preview";
        onlineOpponentPreview.hidden = true;
        matchCard.insertBefore(onlineOpponentPreview, onlineResultSummary || onlineMatchStatus.nextSibling);
      }
      let actions = matchCard.querySelector(".online-actions");
      if (!actions) {
        actions = document.createElement("div");
        actions.className = "online-actions online-match-actions";
        matchCard.appendChild(actions);
      }
      actions.classList.add("online-match-actions");
      onlineReadyBtn = makeOnlineButton("onlineReadyBtn", "게임 시작", "btn-primary");
      onlineReadyBtn.disabled = true;
      onlineBackToCommandersBtn = makeOnlineButton("onlineBackToCommandersBtn", "편성으로");
      onlineMatchLogoutBtn = makeOnlineButton("onlineMatchLogoutBtn", "로그아웃");
      [onlineQueueBtn, onlineLeaveQueueBtn, onlineReadyBtn, onlineBackToCommandersBtn, onlineMatchLogoutBtn]
        .filter(Boolean)
        .forEach((button) => {
          if (!actions.contains(button)) actions.appendChild(button);
        });
      if (onlineMatchLogoutBtn) onlineMatchLogoutBtn.hidden = true;
      let columns = matchCard.querySelector(".online-match-columns");
      if (!columns) {
        columns = document.createElement("div");
        columns.className = "online-match-columns";
        columns.innerHTML = `<div class="online-match-left"></div><div class="online-match-right"></div>`;
        matchCard.querySelector("h3")?.after(columns);
      }
      const left = columns.querySelector(".online-match-left");
      const right = columns.querySelector(".online-match-right");
      const anim = matchCard.querySelector(".online-search-anim");
      if (left) {
        left.appendChild(onlineMatchPlayerInfo);
        left.appendChild(onlineMatchRoster);
      }
      if (right) {
        if (anim) right.appendChild(anim);
        right.appendChild(onlineOpponentPreview);
        if (onlineResultSummary) right.appendChild(onlineResultSummary);
      }
      matchCard.appendChild(onlineMatchStatus);
      matchCard.appendChild(actions);
      if (!onlineInvitePanel) {
        onlineInvitePanel = document.createElement("div");
        onlineInvitePanel.id = "onlineInvitePanel";
        onlineInvitePanel.className = "online-invite-panel";
        onlineInvitePanel.innerHTML = `
          <div id="onlineInviteLinkArea" class="online-invite-link-area" hidden>
            <input id="onlineInviteLinkInput" class="online-invite-link-input" readonly />
            <button id="onlineInviteCopyBtn" class="btn-stone" type="button">복사</button>
          </div>
          <div id="onlineInviteStatus" class="online-invite-status"></div>
        `;
      }
      // 매번 마지막에 append해서 다른 요소들이 앞으로 재배치돼도 항상 맨 아래에 위치
      matchCard.appendChild(onlineInvitePanel);
      // 매칭 화면 진입 시마다 초대 패널 초기화 (이전 코드 잔존 방지)
      const createInviteBtn = makeOnlineButton("onlineCreateInviteBtn", "친구초대 링크 만들기");
      if (createInviteBtn && !actions.contains(createInviteBtn)) {
        actions.insertBefore(createInviteBtn, onlineMatchLogoutBtn || null);
      }
      const inviteLinkArea  = document.getElementById("onlineInviteLinkArea");
      const inviteStatusEl  = document.getElementById("onlineInviteStatus");
      if (createInviteBtn) {
        createInviteBtn.textContent = "친구초대 링크 만들기";
        createInviteBtn.disabled = false;
      }
      if (inviteLinkArea)  inviteLinkArea.hidden = true;
      if (inviteStatusEl)  inviteStatusEl.textContent = "";
      if (inviteLinkArea) {
        const inp = document.getElementById("onlineInviteLinkInput");
        if (inp) inp.value = "";
      }
      if (pendingInviteCode && !onlineClient.token) {
        let guestPanel = document.getElementById("onlineGuestInvitePanel");
        if (!guestPanel) {
          guestPanel = document.createElement("div");
          guestPanel.id = "onlineGuestInvitePanel";
          guestPanel.className = "online-guest-invite-panel";
          guestPanel.innerHTML = `
            <div class="online-invite-notice">초대 링크로 접속했습니다.</div>
            <div class="online-actions">
              <button id="onlineGuestJoinBtn" class="btn-primary" type="button">게스트로 참가</button>
            </div>
            <div class="online-invite-hint">로그인하면 전적이 저장됩니다.</div>
          `;
          const authCard2 = onlineCardFor(onlineAuthForm);
          authCard2?.appendChild(guestPanel);
        }
      }
    }

    const recordCards = [recentCard, leaderboardCard].filter(Boolean);
    if (recordCards.length && !onlineRecordsBackBtn) {
      onlineRecordsBackBtn = makeOnlineButton("onlineRecordsBackBtn", "돌아가기");
      const actions = document.createElement("div");
      actions.className = "online-actions online-records-actions";
      actions.appendChild(onlineRecordsBackBtn);
      recordCards[0].parentElement?.insertBefore(actions, recordCards[0]);
    }
    syncOnlineHeaderActions();
  }

  function setOnlinePage(page) {
    ensureOnlineUiScaffold();
    if (page === "records" && onlinePage !== "records") onlinePreviousPage = onlinePage;
    onlinePage = page;
    const onlinePanel = onlineScreen?.querySelector(".online-panel");
    if (onlinePanel) onlinePanel.dataset.onlinePage = page;
    const authCard = onlineCardFor(onlineAuthForm);
    const commanderCard = onlineCardFor(onlineCommanders);
    const commanderPoolCard = document.getElementById("onlineCommanderPoolCard");
    const matchCard = onlineCardFor(onlineMatchStatus);
    const recentCard = onlineCardFor(onlineRecentMatches);
    const leaderboardCard = onlineCardFor(onlineLeaderboard);
    const recordsActions = document.querySelector(".online-records-actions");
    if (authCard) authCard.hidden = page !== "auth";
    if (commanderCard) commanderCard.hidden = page !== "commanders";
    if (commanderPoolCard) commanderPoolCard.hidden = page !== "commanders";
    if (matchCard) matchCard.hidden = page !== "match";
    if (recentCard) recentCard.hidden = page !== "records";
    if (leaderboardCard) leaderboardCard.hidden = page !== "records";
    if (recordsActions) recordsActions.hidden = page !== "records";
    syncOnlineHeaderActions();
    if (page === "commanders" && onlineClient.player) {
      renderOnlineLoadoutEditor();
    }
  }

  function onlineSkillLabel(skill) {
    return ({
      kihap: "기합",
      swift: "신속",
      guard: "사수",
      fire: "화공",
      flood: "수공",
      archery: "신궁",
    })[skill] || skill;
  }

  function onlineCatalogItem(templateId) {
    return (onlineClient.catalog || []).find(item => item.id === templateId)
      || null;
  }

  function onlineCommanderUnlocked(commander) {
    if (!commander) return false;
    if (commander.unlocked === true) return true;
    if (commander.unlocked === false) return false;
    return commander.source === "quick";
  }

  function onlineScenarioName(scenarioId) {
    return ({
      gaugamela: "가우가멜라 전투",
      cannae: "칸나에 전투",
      bomangpa: "박망파 전투",
      gwiju: "귀주대첩",
      jupil: "주필산 전투",
      kalka: "칼카강 전투",
      yiling: "이릉 대첩",
      tours: "투르 푸아티에 전투",
    })[scenarioId] || scenarioId || "해당 시나리오";
  }

  function onlineCommanderLockMessage(commander) {
    if (onlineCommanderUnlocked(commander)) return "";
    return `역사 시나리오에서 ${onlineScenarioName(commander?.unlockScenarioId || commander?.source)}을 먼저 클리어 해야 합니다.`;
  }

  function onlineCommanderLevelLabel(commander) {
    const level = Number(commander?.level || 0);
    return level >= 50 ? `Lv ${level} MAX` : `Lv ${level}`;
  }

  function onlineCommanderStatsText(commander) {
    if (!commander) return "";
    const base = commander.basePower != null
      ? ` · base ${commander.basePower}/${commander.baseLeadership}/${commander.baseCharm}`
      : "";
    return `${commander.power}/${commander.leadership}/${commander.charm}${base}`;
  }

  function normalizeOnlineLoadout(commanders = onlineClient.player?.commanders || []) {
    const catalog = onlineClient.catalog || [];
    const unlockedCatalog = catalog.filter(onlineCommanderUnlocked);
    return Array.from({ length: 5 }, (_unused, index) => {
      const current = commanders[index] || {};
      const template = onlineCatalogItem(current.templateId) || unlockedCatalog[index] || unlockedCatalog[0] || current;
      const troopType = current.troopType || template?.troopType || "infantry";
      const allowedSkills = troopType === "cavalry" ? ["kihap"] : (template?.allowedSkills || [template?.skillType || "kihap"]);
      const skillType = allowedSkills.includes(current.skillType) ? current.skillType : allowedSkills[0];
      return {
        slotIndex: index,
        templateId: template?.id || current.templateId,
        troopType,
        troops: Number(current.troops || (troopType === "cavalry" ? 2500 : 10000)),
        skillType,
      };
    });
  }

  function readOnlineLoadoutDraft() {
    const rows = [...document.querySelectorAll("[data-online-loadout-slot]")];
    if (!rows.length) return onlineLoadoutDraft;
    return rows.map((row, index) => {
      const templateId = row.dataset.templateId || row.querySelector("[data-field='templateId']")?.value || onlineLoadoutDraft[index]?.templateId || null;
      const troopType = normalizeTroopType(row.dataset.troopType || row.querySelector("[data-field='troopType']")?.value || "infantry");
      const template = onlineCatalogItem(templateId);
      if (!template) {
        return {
          slotIndex: index,
          templateId: null,
          troopType,
          troops: 0,
          skillType: "kihap",
        };
      }
      const allowedSkills = onlineAllowedSkills(template, troopType);
      const rawSkill = row.dataset.skillType || row.querySelector("[data-field='skillType']")?.value || onlineLoadoutDraft[index]?.skillType || "kihap";
      return {
        slotIndex: index,
        templateId,
        troopType,
        troops: normalizeTroopsForType(Number(row.querySelector("[data-field='troops']")?.value || onlineLoadoutDraft[index]?.troops || 0), troopType),
        skillType: allowedSkills.includes(rawSkill) ? rawSkill : allowedSkills[0],
      };
    });
  }

  function onlinePortraitMarkup(commander, className = "online-loadout-portrait", options = {}) {
    const overlayHtml = options.overlayHtml || "";
    if (commander?.portrait) {
      return `<div class="${className} online-portrait-loading" data-online-portrait><img src="${escapeHtml(commander.portrait)}" alt="${escapeHtml(commander.name || "")}" loading="eager" decoding="async" />${overlayHtml}</div>`;
    }
    return `<div class="${className}">${escapeHtml((commander?.name || "?").slice(0, 1))}${overlayHtml}</div>`;
  }

  function settleOnlinePortraitLoading(root = onlineScreen) {
    root?.querySelectorAll?.("[data-online-portrait]").forEach((portrait) => {
      const img = portrait.querySelector("img");
      if (!img) {
        portrait.classList.remove("online-portrait-loading");
        return;
      }
      const markReady = () => {
        portrait.classList.remove("online-portrait-loading");
        portrait.classList.add("online-portrait-ready");
      };
      const markFailed = () => {
        portrait.classList.remove("online-portrait-loading");
        portrait.classList.add("online-portrait-failed");
      };
      if (img.complete) {
        if (img.naturalWidth > 0) markReady();
        else markFailed();
        return;
      }
      img.addEventListener("load", markReady, { once: true });
      img.addEventListener("error", markFailed, { once: true });
    });
  }

  function onlineAllowedSkills(template, troopType) {
    if (troopType === "cavalry") return ["kihap"];
    const skills = Array.isArray(template?.allowedSkills)
      ? template.allowedSkills
      : [template?.skillType || "kihap"];
    return skills.filter(skill => SKILL_DEF[skill]);
  }

  function onlineLoadoutPopulation(item) {
    return troopPopulation(item?.troops || 0, item?.troopType || "infantry");
  }

  const ONLINE_TROOP_STEP = 250;

  function onlineRoundTroops(troops) {
    return Math.max(0, Math.round(Number(troops || 0) / ONLINE_TROOP_STEP) * ONLINE_TROOP_STEP);
  }

  function onlineMinPopulationForType(type) {
    return troopPopulation(minTroopsForType(type), type);
  }

  function onlineLoadoutTotalPopulation() {
    return onlineLoadoutDraft.reduce((sum, item) => sum + onlineLoadoutPopulation(item), 0);
  }

  function onlineLoadoutMaxTroops(slotIndex, troopType) {
    const otherMinPopulation = onlineLoadoutDraft.reduce((sum, item, index) =>
      index === slotIndex || !item?.templateId ? sum : sum + onlineMinPopulationForType(item?.troopType || "infantry"), 0);
    const availablePopulation = Math.max(
      onlineMinPopulationForType(troopType),
      POPULATION_BUDGET - otherMinPopulation,
    );
    return Math.max(
      minTroopsForType(troopType),
      Math.floor(availablePopulation / troopPopulationCost(troopType) / ONLINE_TROOP_STEP) * ONLINE_TROOP_STEP,
    );
  }

  function onlineClampTroops(slotIndex, troopType, troops) {
    return Math.min(
      onlineLoadoutMaxTroops(slotIndex, troopType),
      Math.max(minTroopsForType(troopType), onlineRoundTroops(troops))
    );
  }

  function normalizeOnlineLoadoutBudget(lockedIndex = -1) {
    onlineLoadoutDraft = onlineLoadoutDraft.map((item, index) => {
      if (!onlineCatalogItem(item?.templateId)) {
        return {
          slotIndex: index,
          templateId: null,
          troopType: normalizeTroopType(item?.troopType || "infantry"),
          troops: 0,
          skillType: "kihap",
        };
      }
      const troopType = normalizeTroopType(item?.troopType || "infantry");
      return {
        ...item,
        slotIndex: index,
        troopType,
        troops: onlineClampTroops(index, troopType, item?.troops || minTroopsForType(troopType)),
      };
    });
    if (onlineLoadoutDraft.some(item => !item.templateId)) return;

    const adjustOneStep = (direction, allowLocked = false) => {
      const indices = onlineLoadoutDraft
        .map((_item, index) => index)
        .filter(index => onlineLoadoutDraft[index]?.templateId && (allowLocked || index !== lockedIndex))
        .sort((a, b) => {
          const pa = onlineLoadoutPopulation(onlineLoadoutDraft[a]);
          const pb = onlineLoadoutPopulation(onlineLoadoutDraft[b]);
          return direction > 0 ? pa - pb : pb - pa;
        });
      const total = onlineLoadoutTotalPopulation();
      for (const index of indices) {
        const item = onlineLoadoutDraft[index];
        const stepPopulation = troopPopulation(ONLINE_TROOP_STEP, item.troopType);
        if (direction > 0) {
          if (total + stepPopulation > POPULATION_BUDGET) continue;
          if (item.troops + ONLINE_TROOP_STEP > onlineLoadoutMaxTroops(index, item.troopType)) continue;
          onlineLoadoutDraft[index] = { ...item, troops: item.troops + ONLINE_TROOP_STEP };
          return true;
        }
        if (total - stepPopulation < POPULATION_BUDGET) continue;
        if (item.troops - ONLINE_TROOP_STEP < minTroopsForType(item.troopType)) continue;
        onlineLoadoutDraft[index] = { ...item, troops: item.troops - ONLINE_TROOP_STEP };
        return true;
      }
      return false;
    };

    let guard = 0;
    while (onlineLoadoutTotalPopulation() < POPULATION_BUDGET && guard < 1000) {
      if (!adjustOneStep(1) && !adjustOneStep(1, true)) break;
      guard++;
    }
    guard = 0;
    while (onlineLoadoutTotalPopulation() > POPULATION_BUDGET && guard < 1000) {
      if (!adjustOneStep(-1) && !adjustOneStep(-1, true)) break;
      guard++;
    }
  }

  function setOnlineLoadoutTroops(slotIndex, troops) {
    const item = onlineLoadoutDraft[slotIndex];
    if (!item?.templateId) return;
    onlineLoadoutDraft[slotIndex] = {
      ...item,
      troops: onlineClampTroops(slotIndex, item.troopType, troops),
    };
    normalizeOnlineLoadoutBudget(slotIndex);
  }

  function emptyOnlineLoadoutSlot(slotIndex) {
    onlineLoadoutDraft[slotIndex] = {
      slotIndex,
      templateId: null,
      troopType: "infantry",
      troops: 0,
      skillType: "kihap",
    };
  }

  function setOnlineLoadoutTemplate(slotIndex, templateId) {
    const template = onlineCatalogItem(templateId);
    if (!template) return;
    if (!onlineCommanderUnlocked(template)) return;
    const duplicateSlot = onlineLoadoutDraft.findIndex((item, index) =>
      index !== slotIndex && item?.templateId === template.id);
    if (duplicateSlot >= 0) emptyOnlineLoadoutSlot(duplicateSlot);

    const previous = onlineLoadoutDraft[slotIndex] || {};
    const troopType = normalizeTroopType(previous.troopType || template.troopType || "infantry");
    const allowedSkills = onlineAllowedSkills(template, troopType);
    const previousPopulation = previous.templateId ? onlineLoadoutPopulation(previous) : 0;
    const defaultTroops = troopType === "cavalry" ? 2500 : 10000;
    const troops = previousPopulation > 0
      ? Math.floor(previousPopulation / troopPopulationCost(troopType))
      : defaultTroops;
    onlineLoadoutDraft[slotIndex] = {
      slotIndex,
      templateId: template.id,
      troopType,
      troops: onlineClampTroops(slotIndex, troopType, troops),
      skillType: allowedSkills.includes(previous.skillType) ? previous.skillType : allowedSkills[0],
    };
    normalizeOnlineLoadoutBudget(slotIndex);
  }

  function moveOnlineLoadoutSlot(sourceSlot, targetSlot) {
    if (sourceSlot === targetSlot) return;
    const source = onlineLoadoutDraft[sourceSlot];
    if (!source?.templateId) return;
    const target = onlineLoadoutDraft[targetSlot];
    onlineLoadoutDraft[targetSlot] = { ...source, slotIndex: targetSlot };
    if (target?.templateId) {
      onlineLoadoutDraft[sourceSlot] = { ...target, slotIndex: sourceSlot };
    } else {
      emptyOnlineLoadoutSlot(sourceSlot);
    }
    normalizeOnlineLoadoutBudget();
  }

  function onlineDragPayload(event) {
    const raw = event.dataTransfer?.getData("application/x-ageofwar-commander")
      || event.dataTransfer?.getData("text/plain")
      || "";
    try {
      return JSON.parse(raw);
    } catch (_error) {
      return null;
    }
  }

  function setOnlineDragPayload(event, payload) {
    const raw = JSON.stringify(payload);
    event.dataTransfer?.setData("application/x-ageofwar-commander", raw);
    event.dataTransfer?.setData("text/plain", raw);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  }

  function onlineLoadoutSlotMarkup(item, index) {
    const template = onlineCatalogItem(item?.templateId);
    if (!template) {
      return `
        <div class="adjust-card online-loadout-card online-loadout-card--empty player-side"
          data-online-loadout-slot="${index}" data-template-id="" data-troop-type="infantry" data-skill-type="kihap">
          <div class="online-loadout-empty-mark">${index + 1}</div>
          <div class="online-loadout-empty-title">빈 슬롯</div>
          <div class="online-loadout-empty-note">오른쪽 장수를 끌어다 놓으세요</div>
        </div>
      `;
    }
    const troopType = normalizeTroopType(item.troopType || template.troopType || "infantry");
    const allowedSkills = onlineAllowedSkills(template, troopType);
    const skillType = allowedSkills.includes(item.skillType) ? item.skillType : allowedSkills[0];
    const maxTroops = onlineLoadoutMaxTroops(index, troopType);
    const locked = !onlineCommanderUnlocked(template);
    const lockMessage = onlineCommanderLockMessage(template);
    return `
      <div class="adjust-card online-loadout-card player-side ${locked ? "is-locked" : ""}" draggable="${locked ? "false" : "true"}"
        data-online-loadout-slot="${index}" data-template-id="${escapeHtml(template.id)}"
        data-troop-type="${escapeHtml(troopType)}" data-skill-type="${escapeHtml(skillType)}"
        ${lockMessage ? `title="${escapeHtml(lockMessage)}"` : ""}>
        ${onlinePortraitMarkup(template)}
        <div class="online-loadout-name">${escapeHtml(template.name)}</div>
        <div class="online-loadout-source">${escapeHtml(locked ? "Locked" : onlineCommanderLevelLabel(template))}</div>
        <div class="adjust-card-stats">
          <div class="adjust-card-stat"><span>무력</span><strong>${template.power}</strong></div>
          <div class="adjust-card-stat"><span>통솔</span><strong>${template.leadership}</strong></div>
          <div class="adjust-card-stat"><span>매력</span><strong>${template.charm}</strong></div>
        </div>
        <div class="adjust-type-buttons">
          ${["infantry", "cavalry"].map(type => `<button type="button" class="adjust-type-btn" data-field="troopType" data-value="${type}" data-active="${type === troopType ? "true" : "false"}">${type === "cavalry" ? "기병" : "보병"}</button>`).join("")}
        </div>
        <div class="adjust-skill-buttons">
          ${allSkillButtons().map(skill => `<button type="button" class="adjust-skill-btn" data-field="skillType" data-value="${escapeHtml(skill)}" data-active="${skill === skillType ? "true" : "false"}" ${allowedSkills.includes(skill) ? "" : "disabled"}>${onlineSkillLabel(skill)}</button>`).join("")}
        </div>
        <div class="adjust-slider-wrap">
          <input data-field="troops" type="range" class="adjust-slider" min="${minTroopsForType(troopType)}" max="${maxTroops}" step="250" value="${Math.round(item.troops)}" />
        </div>
      </div>
    `;
  }

  function onlineCommanderPoolCardMarkup(commander, selectedSlot) {
    const selected = selectedSlot >= 0;
    const locked = !onlineCommanderUnlocked(commander);
    const lockMessage = onlineCommanderLockMessage(commander);
    const lockIcon = locked
      ? `<img class="online-pool-lock-icon" src="./assets/ui/commander_locked_icon.png" alt="" aria-hidden="true" draggable="false" />`
      : "";
    return `
      <div class="online-pool-card ${selected ? "is-selected" : ""} ${locked ? "is-locked" : ""}"
        data-online-pool-card="${escapeHtml(commander.id)}" draggable="${selected || locked ? "false" : "true"}"
        ${lockMessage ? `title="${escapeHtml(lockMessage)}"` : ""}>
        ${onlinePortraitMarkup(commander, "online-pool-portrait", { overlayHtml: lockIcon })}
        <div class="online-pool-name">${escapeHtml(commander.name)}</div>
        <div class="online-pool-level">${escapeHtml(locked ? "Locked" : `Lv ${commander.level || 0}`)}</div>
      </div>
    `;
  }

  function bindOnlineLoadoutDragEvents() {
    const pool = onlineCommanderPool || document.getElementById("onlineCommanderPool");
    const poolDropTarget = pool?.closest?.(".online-pool-card-page") || pool;
    onlineCommanders.querySelectorAll("[data-online-pool-card]").forEach((card) => {
      if (card.classList.contains("is-selected")) return;
      if (card.classList.contains("is-locked")) return;
      card.addEventListener("dragstart", (event) => {
        setOnlineDragPayload(event, {
          from: "pool",
          templateId: card.dataset.onlinePoolCard,
        });
        card.classList.add("is-dragging");
      });
      card.addEventListener("dragend", () => card.classList.remove("is-dragging"));
    });

    onlineCommanders.querySelectorAll("[data-online-loadout-slot]").forEach((slotEl) => {
      const slot = Number(slotEl.dataset.onlineLoadoutSlot || 0);
      slotEl.addEventListener("dragstart", (event) => {
        if (event.target?.closest?.("button,input")) {
          event.preventDefault();
          return;
        }
        const templateId = slotEl.dataset.templateId;
        if (!templateId) {
          event.preventDefault();
          return;
        }
        setOnlineDragPayload(event, { from: "slot", slot, templateId });
        slotEl.classList.add("is-dragging");
      });
      slotEl.addEventListener("dragend", () => slotEl.classList.remove("is-dragging"));
      slotEl.addEventListener("dragover", (event) => {
        event.preventDefault();
        slotEl.classList.add("is-drop-target");
        if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      });
      slotEl.addEventListener("dragleave", () => slotEl.classList.remove("is-drop-target"));
      slotEl.addEventListener("drop", (event) => {
        event.preventDefault();
        slotEl.classList.remove("is-drop-target");
        const payload = onlineDragPayload(event);
        if (!payload) return;
        if (payload.from === "slot") {
          moveOnlineLoadoutSlot(Number(payload.slot), slot);
        } else if (payload.templateId) {
          setOnlineLoadoutTemplate(slot, payload.templateId);
        }
        renderOnlineLoadoutEditor();
      });
    });
    pool?.querySelectorAll("[data-online-pool-card]").forEach((card) => {
      if (card.classList.contains("is-selected")) return;
      if (card.classList.contains("is-locked")) return;
      card.addEventListener("dragstart", (event) => {
        setOnlineDragPayload(event, {
          from: "pool",
          templateId: card.dataset.onlinePoolCard,
        });
        card.classList.add("is-dragging");
      });
      card.addEventListener("dragend", () => card.classList.remove("is-dragging"));
    });

    if (poolDropTarget) {
      poolDropTarget.addEventListener("dragover", (event) => {
        event.preventDefault();
        poolDropTarget.classList.add("is-drop-target");
        if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      });
      poolDropTarget.addEventListener("dragleave", () => poolDropTarget.classList.remove("is-drop-target"));
      poolDropTarget.addEventListener("drop", (event) => {
        event.preventDefault();
        poolDropTarget.classList.remove("is-drop-target");
        const payload = onlineDragPayload(event);
        if (payload?.from !== "slot") return;
        emptyOnlineLoadoutSlot(Number(payload.slot));
        renderOnlineLoadoutEditor();
      });
    }
  }

  function renderOnlineCommanderPool() {
    if (!onlineCommanderPool) return;
    const catalog = onlineClient.catalog || [];
    if (!catalog.length) {
      onlineCommanderPool.innerHTML = `<div class="online-status">장수 카탈로그를 불러오는 중입니다.</div>`;
      return;
    }
    const selectedSlotById = new Map(onlineLoadoutDraft
      .map((item, index) => [item.templateId, index])
      .filter(([templateId]) => templateId));
    onlineCommanderPool.innerHTML = [...catalog]
      .sort((a, b) => Number(onlineCommanderUnlocked(b)) - Number(onlineCommanderUnlocked(a))
        || String(a.source || "").localeCompare(String(b.source || ""))
        || String(a.name || "").localeCompare(String(b.name || "")))
      .map(commander => onlineCommanderPoolCardMarkup(commander, selectedSlotById.get(commander.id) ?? -1))
      .join("");
    settleOnlinePortraitLoading(onlineCommanderPool);
  }

  function renderOnlineLoadoutEditorDnD() {
    if (!onlineCommanders) return;
    const catalog = onlineClient.catalog || [];
    if (!catalog.length) {
      onlineCommanders.innerHTML = `<div class="online-status">장수 카탈로그를 불러오는 중입니다.</div>`;
      renderOnlineCommanderPool();
      return;
    }
    if (!onlineLoadoutDraft.length) onlineLoadoutDraft = normalizeOnlineLoadout();
    onlineCommanders.classList.add("online-loadout-editor", "online-loadout-dnd");
    onlineCommanders.classList.remove("adjust-cards");

    onlineLoadoutDraft = Array.from({ length: 5 }, (_unused, index) => {
      const item = onlineLoadoutDraft[index] || {};
      const template = onlineCatalogItem(item.templateId);
      if (!template) {
        return {
          slotIndex: index,
          templateId: null,
          troopType: normalizeTroopType(item.troopType || "infantry"),
          troops: 0,
          skillType: "kihap",
        };
      }
      const troopType = normalizeTroopType(item.troopType || template.troopType || "infantry");
      const allowedSkills = onlineAllowedSkills(template, troopType);
      return {
        slotIndex: index,
        templateId: template.id,
        troopType,
        troops: onlineClampTroops(index, troopType, Number(item.troops || (troopType === "cavalry" ? 2500 : 10000))),
        skillType: allowedSkills.includes(item.skillType) ? item.skillType : allowedSkills[0],
      };
    });
    normalizeOnlineLoadoutBudget();

    const draftTotalPopulation = onlineLoadoutTotalPopulation();
    const loadoutComplete = onlineLoadoutDraft.every((item) => {
      const template = onlineCatalogItem(item.templateId);
      return template && onlineCommanderUnlocked(template);
    });
    const budgetOk = draftTotalPopulation === POPULATION_BUDGET;

    onlineCommanders.innerHTML = `
      <div class="online-loadout-total ${!budgetOk || !loadoutComplete ? "is-over" : ""}">
        총 인구 ${formatTroops(draftTotalPopulation)} / ${formatTroops(POPULATION_BUDGET)}
      </div>
      <div class="online-loadout-slots">
        ${onlineLoadoutDraft.map((item, index) => onlineLoadoutSlotMarkup(item, index)).join("")}
      </div>
    `;
    settleOnlinePortraitLoading(onlineCommanders);
    renderOnlineCommanderPool();

    if (onlineGoMatchBtn) onlineGoMatchBtn.disabled = !loadoutComplete || !budgetOk;

    onlineCommanders.querySelectorAll("button[data-field='troopType']").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.currentTarget.blur();
        const slot = Number(button.closest("[data-online-loadout-slot]")?.dataset.onlineLoadoutSlot || 0);
        const item = onlineLoadoutDraft[slot];
        if (!item?.templateId) return;
        const template = onlineCatalogItem(item.templateId);
        const troopType = normalizeTroopType(button.dataset.value);
        if (item.troopType === troopType) return;
        const preservedPopulation = troopPopulation(item.troops, item.troopType);
        const allowedSkills = onlineAllowedSkills(template, troopType);
        onlineLoadoutDraft[slot] = {
          ...item,
          troopType,
          troops: onlineClampTroops(slot, troopType, Math.floor(preservedPopulation / troopPopulationCost(troopType))),
          skillType: allowedSkills.includes(item.skillType) ? item.skillType : allowedSkills[0],
        };
        normalizeOnlineLoadoutBudget(slot);
        renderOnlineLoadoutEditor();
      });
    });

    onlineCommanders.querySelectorAll("button[data-field='skillType']").forEach((button) => {
      button.addEventListener("click", (event) => {
        if (button.disabled) return;
        event.currentTarget.blur();
        const slot = Number(button.closest("[data-online-loadout-slot]")?.dataset.onlineLoadoutSlot || 0);
        if (!onlineLoadoutDraft[slot]?.templateId) return;
        onlineLoadoutDraft[slot] = {
          ...onlineLoadoutDraft[slot],
          skillType: button.dataset.value,
        };
        renderOnlineLoadoutEditor();
      });
    });

    onlineCommanders.querySelectorAll("input[data-field='troops']").forEach((input) => {
      input.addEventListener("input", () => {
        const slot = Number(input.closest("[data-online-loadout-slot]")?.dataset.onlineLoadoutSlot || 0);
        const item = onlineLoadoutDraft[slot];
        setOnlineLoadoutTroops(slot, Number(input.value || item?.troops || 0));
        renderOnlineLoadoutEditor();
      });
    });

    bindOnlineLoadoutDragEvents();
  }

  function renderOnlineLoadoutEditor() {
    renderOnlineLoadoutEditorDnD();
    return;
    if (!onlineCommanders) return;
    const catalog = onlineClient.catalog || [];
    if (!catalog.length) {
      onlineCommanders.innerHTML = `<div class="online-status">장수 카탈로그를 불러오는 중입니다.</div>`;
      return;
    }
    if (!onlineLoadoutDraft.length) onlineLoadoutDraft = normalizeOnlineLoadout();
    {
      onlineCommanders.classList.add("online-loadout-editor", "adjust-cards");
      onlineLoadoutDraft = onlineLoadoutDraft.map((item, index) => {
        const template = onlineCatalogItem(item.templateId) || catalog[index] || catalog[0];
        const troopType = normalizeTroopType(item.troopType || template?.troopType || "infantry");
        const allowedSkills = onlineAllowedSkills(template, troopType);
        const troops = onlineClampTroops(index, troopType, Number(item.troops || (troopType === "cavalry" ? 2500 : 10000)));
        return {
          slotIndex: index,
          templateId: template?.id || item.templateId,
          troopType,
          troops,
          skillType: allowedSkills.includes(item.skillType) ? item.skillType : allowedSkills[0],
        };
      });
      normalizeOnlineLoadoutBudget();

      const draftTotalPopulation = onlineLoadoutDraft.reduce((sum, item) => sum + onlineLoadoutPopulation(item), 0);
      onlineCommanders.innerHTML = `
        <div class="online-loadout-total ${draftTotalPopulation > POPULATION_BUDGET ? "is-over" : ""}">
          총 인구 ${formatTroops(draftTotalPopulation)} / ${formatTroops(POPULATION_BUDGET)}
        </div>
        ${onlineLoadoutDraft.map((item, index) => {
          const template = onlineCatalogItem(item.templateId) || catalog[index] || catalog[0];
          const troopType = normalizeTroopType(item.troopType || template?.troopType || "infantry");
          const allowedSkills = onlineAllowedSkills(template, troopType);
          const skillType = allowedSkills.includes(item.skillType) ? item.skillType : allowedSkills[0];
          const maxTroops = onlineLoadoutMaxTroops(index, troopType);
          const popUsed = onlineLoadoutPopulation(item);
          const pct = Math.min(100, popUsed / POPULATION_BUDGET * 100).toFixed(1);
          const takenIds = new Set(onlineLoadoutDraft
            .map((draftItem, draftIndex) => draftIndex === index ? null : draftItem.templateId)
            .filter(Boolean));
          return `
            <div class="adjust-card online-loadout-card player-side" data-online-loadout-slot="${index}" data-troop-type="${escapeHtml(troopType)}" data-skill-type="${escapeHtml(skillType)}">
              ${onlinePortraitMarkup(template)}
              <select class="online-loadout-select" data-field="templateId" aria-label="장수 선택">
                ${catalog.map(option => {
                  const disabled = takenIds.has(option.id) && option.id !== template.id;
                  return `<option value="${escapeHtml(option.id)}" ${option.id === template.id ? "selected" : ""} ${disabled ? "disabled" : ""}>${escapeHtml(option.name)} · ${escapeHtml(option.source || "quick")}</option>`;
                }).join("")}
              </select>
              <div class="adjust-card-stats">
                <div class="adjust-card-stat"><span>무력</span><strong>${template.power}</strong></div>
                <div class="adjust-card-stat"><span>통솔</span><strong>${template.leadership}</strong></div>
                <div class="adjust-card-stat"><span>매력</span><strong>${template.charm}</strong></div>
              </div>
              <div class="adjust-type-buttons">
                ${["infantry", "cavalry"].map(type => `<button type="button" class="adjust-type-btn" data-field="troopType" data-value="${type}" data-active="${type === troopType ? "true" : "false"}">${type === "cavalry" ? "기병" : "보병"}</button>`).join("")}
              </div>
              <div class="adjust-skill-buttons">
                ${allSkillButtons().map(skill => `<button type="button" class="adjust-skill-btn" data-field="skillType" data-value="${escapeHtml(skill)}" data-active="${skill === skillType ? "true" : "false"}" ${allowedSkills.includes(skill) ? "" : "disabled"}>${onlineSkillLabel(skill)}</button>`).join("")}
              </div>
              <div class="adjust-bar-bg"><div class="adjust-bar-fill player-fill" style="width:${pct}%"></div></div>
              <div class="adjust-card-val">${Math.round(item.troops).toLocaleString()} <span>명</span></div>
              <div class="adjust-card-pop">인구 ${formatTroops(popUsed)}</div>
              <div class="adjust-slider-wrap">
                <input data-field="troops" type="range" class="adjust-slider" min="${minTroopsForType(troopType)}" max="${maxTroops}" step="250" value="${Math.round(item.troops)}" />
              </div>
            </div>
          `;
        }).join("")}
      `;

      if (onlineGoMatchBtn) onlineGoMatchBtn.disabled = draftTotalPopulation > POPULATION_BUDGET;

      onlineCommanders.querySelectorAll("[data-field='templateId']").forEach((select) => {
        select.addEventListener("change", () => {
          const slot = Number(select.closest("[data-online-loadout-slot]")?.dataset.onlineLoadoutSlot || 0);
          const prev = onlineLoadoutDraft[slot] || {};
          const template = onlineCatalogItem(select.value) || catalog[0];
          const troopType = normalizeTroopType(prev.troopType || template?.troopType || "infantry");
          const allowedSkills = onlineAllowedSkills(template, troopType);
          onlineLoadoutDraft[slot] = {
            slotIndex: slot,
            templateId: template?.id,
            troopType,
            troops: onlineClampTroops(slot, troopType, prev.troops || (troopType === "cavalry" ? 2500 : 10000)),
            skillType: allowedSkills.includes(prev.skillType) ? prev.skillType : allowedSkills[0],
          };
          normalizeOnlineLoadoutBudget(slot);
          renderOnlineLoadoutEditor();
        });
      });

      onlineCommanders.querySelectorAll("button[data-field='troopType']").forEach((button) => {
        button.addEventListener("click", (event) => {
          event.currentTarget.blur();
          const slot = Number(button.closest("[data-online-loadout-slot]")?.dataset.onlineLoadoutSlot || 0);
          const item = onlineLoadoutDraft[slot];
          const template = onlineCatalogItem(item.templateId);
          const troopType = normalizeTroopType(button.dataset.value);
          if (item.troopType === troopType) return;
          const preservedPopulation = troopPopulation(item.troops, item.troopType);
          const allowedSkills = onlineAllowedSkills(template, troopType);
          onlineLoadoutDraft[slot] = {
            ...item,
            troopType,
            troops: onlineClampTroops(slot, troopType, Math.floor(preservedPopulation / troopPopulationCost(troopType))),
            skillType: allowedSkills.includes(item.skillType) ? item.skillType : allowedSkills[0],
          };
          normalizeOnlineLoadoutBudget(slot);
          renderOnlineLoadoutEditor();
        });
      });

      onlineCommanders.querySelectorAll("button[data-field='skillType']").forEach((button) => {
        button.addEventListener("click", (event) => {
          if (button.disabled) return;
          event.currentTarget.blur();
          const slot = Number(button.closest("[data-online-loadout-slot]")?.dataset.onlineLoadoutSlot || 0);
          onlineLoadoutDraft[slot] = {
            ...onlineLoadoutDraft[slot],
            skillType: button.dataset.value,
          };
          renderOnlineLoadoutEditor();
        });
      });

      onlineCommanders.querySelectorAll("input[data-field='troops']").forEach((input) => {
        input.addEventListener("input", () => {
          const slot = Number(input.closest("[data-online-loadout-slot]")?.dataset.onlineLoadoutSlot || 0);
          const item = onlineLoadoutDraft[slot];
          setOnlineLoadoutTroops(slot, Number(input.value || item.troops));
          renderOnlineLoadoutEditor();
        });
      });
      return;
    }
    const totalPopulation = onlineLoadoutDraft.reduce((sum, item) =>
      sum + item.troops * (item.troopType === "cavalry" ? 4 : 1), 0);
    onlineCommanders.innerHTML = `
      <div class="online-loadout-total ${totalPopulation > 50000 ? "is-over" : ""}">
        총 인구 ${formatTroops(totalPopulation)} / 50,000
      </div>
      ${onlineLoadoutDraft.map((item, index) => {
        const template = onlineCatalogItem(item.templateId) || catalog[index] || catalog[0];
        const troopType = item.troopType || template.troopType || "infantry";
        const allowedSkills = troopType === "cavalry" ? ["kihap"] : (template.allowedSkills || [template.skillType || "kihap"]);
        const skillType = allowedSkills.includes(item.skillType) ? item.skillType : allowedSkills[0];
        return `
          <div class="online-loadout-row" data-online-loadout-slot="${index}">
            ${onlinePortraitMarkup(template)}
            <div class="online-loadout-main">
              <select data-field="templateId">
                ${catalog.map(option => `<option value="${escapeHtml(option.id)}" ${option.id === template.id ? "selected" : ""}>${escapeHtml(option.name)} · ${escapeHtml(option.source || "quick")}</option>`).join("")}
              </select>
              <div class="online-loadout-stats">
                무력 ${template.power} · 통솔 ${template.leadership} · 매력 ${template.charm}
              </div>
              <div class="online-loadout-controls">
                <select data-field="troopType">
                  <option value="infantry" ${troopType === "infantry" ? "selected" : ""}>보병</option>
                  <option value="cavalry" ${troopType === "cavalry" ? "selected" : ""}>기병</option>
                </select>
                <input data-field="troops" type="number" min="${troopType === "cavalry" ? 250 : 1000}" max="${troopType === "cavalry" ? 12500 : 50000}" step="250" value="${Math.round(item.troops)}" />
                <select data-field="skillType">
                  ${allowedSkills.map(skill => `<option value="${escapeHtml(skill)}" ${skill === skillType ? "selected" : ""}>${onlineSkillLabel(skill)}</option>`).join("")}
                </select>
              </div>
            </div>
          </div>
        `;
      }).join("")}
    `;
    onlineCommanders.querySelectorAll("select,input").forEach((input) => {
      input.addEventListener("change", () => {
        onlineLoadoutDraft = readOnlineLoadoutDraft();
        renderOnlineLoadoutEditor();
      });
    });
  }

  function onlineMatchProfileMarkup(player) {
    if (!player) return "";
    return `
      <div class="online-profile-summary">
        ${factionEmblemMarkup(player.emblem)}
        <div class="online-profile-text">
          <div class="online-profile-name">${escapeHtml(player.displayName || "Guest")}</div>
          <div class="online-profile-record">Rating ${player.rating ?? 0} · ${Number(player.wins || 0)}승 ${Number(player.losses || 0)}패 ${Number(player.draws || 0)}무</div>
        </div>
      </div>
    `;
  }

  function onlineMatchRosterMarkup(commanders = []) {
    if (!commanders.length) {
      return `<div class="online-status online-match-empty-roster">표시할 장수 편성이 없습니다.</div>`;
    }
    return commanders.map((commander) => `
      <div class="online-match-card">
        ${onlinePortraitMarkup(commander, "online-match-card-portrait")}
        <div class="online-match-card-name">${escapeHtml(commander.name)}</div>
        <div class="online-match-card-level">${onlineCommanderLevelLabel(commander)}</div>
        <div class="online-match-card-troop">${escapeHtml(troopTypeInfo(commander.troopType)?.label || commander.troopType)} ${formatTroops(commander.troops || 0)}</div>
      </div>
    `).join("");
  }

  function renderOnlineMatchPanelLegacy() {
    ensureOnlineUiScaffold();
    const player = onlineClient.player;
    if (onlineMatchPlayerInfo) {
      onlineMatchPlayerInfo.innerHTML = player ? `
        <div class="online-profile-summary">
          <div class="online-profile-name">${escapeHtml(player.displayName)}</div>
          <div class="online-profile-record">Rating ${player.rating} · ${player.wins}승 ${player.losses}패 ${player.draws}무</div>
        </div>
      ` : "";
    }
    if (onlineMatchRoster) {
      const commanders = player?.commanders || [];
      onlineMatchRoster.innerHTML = commanders.map((commander) => `
        <div class="online-match-card">
          ${onlinePortraitMarkup(commander, "online-match-card-portrait")}
          <div class="online-match-card-name">${escapeHtml(commander.name)}</div>
          <div class="online-match-card-level">${onlineCommanderLevelLabel(commander)}</div>
          <div class="online-match-card-troop">${escapeHtml(troopTypeInfo(commander.troopType)?.label || commander.troopType)} ${formatTroops(commander.troops || 0)}</div>
        </div>
      `).join("");
      settleOnlinePortraitLoading(onlineMatchRoster);
    }
    if (onlineOpponentPreview) {
      const opponent = onlinePendingMatch?.players?.find(playerInfo => playerInfo.side !== onlinePendingMatch.side);
      onlineOpponentPreview.hidden = !opponent;
      onlineOpponentPreview.innerHTML = opponent ? `
        <div class="online-record-title">상대: ${escapeHtml(opponent.displayName)}</div>
        <div class="online-record-meta">Rating ${opponent.rating} · 준비 상태를 기다리는 중</div>
      ` : "";
    }
  }

  function renderOnlineMatchPanel() {
    ensureOnlineUiScaffold();
    const player = onlineClient.player;
    if (onlineMatchPlayerInfo) {
      onlineMatchPlayerInfo.innerHTML = onlineMatchProfileMarkup(player);
    }
    if (onlineMatchRoster) {
      onlineMatchRoster.innerHTML = onlineMatchRosterMarkup(player?.commanders || []);
      settleOnlinePortraitLoading(onlineMatchRoster);
    }
    if (onlineOpponentPreview) {
      const opponent = onlinePendingMatch?.players?.find(playerInfo => playerInfo.side !== onlinePendingMatch.side);
      onlineOpponentPreview.hidden = !opponent;
      onlineOpponentPreview.innerHTML = opponent ? `
        <div class="online-profile">
          ${onlineMatchProfileMarkup(opponent)}
        </div>
        <div class="online-match-roster online-match-roster--opponent">
          ${onlineMatchRosterMarkup(opponent.commanders || [])}
        </div>
      ` : "";
      if (opponent) settleOnlinePortraitLoading(onlineOpponentPreview);
    }
  }

  function setOnlineMatchActionState(state) {
    const matchCard = onlineCardFor(onlineMatchStatus);
    if (matchCard) matchCard.dataset.matchState = state;
    if (onlineQueueBtn) {
      onlineQueueBtn.hidden = state !== "matched";
      onlineQueueBtn.textContent = "재매칭";
    }
    if (onlineLeaveQueueBtn) onlineLeaveQueueBtn.hidden = state !== "searching";
    if (onlineReadyBtn) {
      onlineReadyBtn.hidden = state !== "matched";
      onlineReadyBtn.disabled = state !== "matched";
      onlineReadyBtn.textContent = "게임 시작";
    }
    const anim = onlineScreen?.querySelector(".online-search-anim");
    if (anim) anim.hidden = state !== "searching";
    const inviteLinkArea = document.getElementById("onlineInviteLinkArea");
    const inviteStatusEl = document.getElementById("onlineInviteStatus");
    const hasInviteContent = (inviteLinkArea && !inviteLinkArea.hidden) || Boolean(inviteStatusEl?.textContent?.trim());
    if (onlineInvitePanel) onlineInvitePanel.hidden = state !== "searching" || !hasInviteContent;
    const createInviteBtn = document.getElementById("onlineCreateInviteBtn");
    if (createInviteBtn) createInviteBtn.hidden = state !== "searching";
  }

  async function beginOnlineMatchmaking() {
    onlinePendingMatch = null;
    onlineReadySides = [];
    onlineRematchAfterCancel = false;
    onlineReturnToCommandersAfterCancel = false;
    onlineLastResult = null;
    renderOnlineResultSummary();
    setOnlinePage("match");
    renderOnlineMatchPanel();
    setOnlineMatchActionState("searching");
    setOnlineStatus("상대를 찾는 중입니다...");
    await onlineClient.joinQueue("quick");
  }

  function renderOnlineProfile() {
    const player = onlineClient.player;
    if (onlineProfile) {
      onlineProfile.hidden = !player;
      onlineProfile.innerHTML = player ? `
        <div class="online-profile-summary">
          ${factionEmblemMarkup(player.emblem)}
          <div class="online-profile-text">
            <div class="online-profile-name">${escapeHtml(player.displayName)}</div>
            <div class="online-profile-record">
              Rating ${player.rating} · ${player.wins}승 ${player.losses}패 ${player.draws}무
            </div>
          </div>
        </div>
      ` : "";
    }
    if (onlineAuthForm) onlineAuthForm.hidden = Boolean(player);
    if (onlineLogoutBtn) onlineLogoutBtn.hidden = !player;
    if (onlineQueueBtn) onlineQueueBtn.disabled = !player;
    if (onlineCommanders) {
      onlineLoadoutDraft = player ? normalizeOnlineLoadout(player.commanders || []) : [];
      renderOnlineLoadoutEditor();
      return;
      const commanders = player?.commanders || [];
      onlineCommanders.innerHTML = commanders.length ? commanders.map((commander, index) => `
        <div class="online-commander">
          <div class="online-commander-slot">${index + 1}</div>
          <div>
            <div class="online-commander-name">${escapeHtml(commander.name)}</div>
            <div class="online-commander-meta">${escapeHtml(commander.troopType)} · ${escapeHtml(commander.skillType)}</div>
          </div>
          <div class="online-commander-meta">${commander.power}/${commander.leadership}/${commander.charm}</div>
        </div>
      `).join("") : `<div class="online-status">로그인하면 계정에 귀속된 장수 5명이 표시됩니다.</div>`;
    }
  }

  function renderOnlineProfileEditEmblemGrid() {
    if (!onlineProfileEditEmblemGrid) return;
    onlineProfileEditEmblemGrid.innerHTML = FACTION_EMBLEM_OPTIONS.map((option) => `
      <div class="online-profile-edit-emblem-option${option.id === onlineProfileEditSelectedEmblem ? " is-selected" : ""}" data-emblem-id="${escapeHtml(option.id)}" title="${escapeHtml(option.label)}">
        <img src="${option.icon}" alt="${escapeHtml(option.label)}" />
      </div>
    `).join("");
    onlineProfileEditEmblemGrid.querySelectorAll(".online-profile-edit-emblem-option").forEach((node) => {
      node.addEventListener("click", () => {
        onlineProfileEditSelectedEmblem = node.dataset.emblemId;
        renderOnlineProfileEditEmblemGrid();
      });
    });
  }

  function openOnlineProfileEditPanel() {
    const player = onlineClient.player;
    if (!player || !onlineProfileEditOverlay) return;
    onlineProfileEditSelectedEmblem = factionEmblemOption(player.emblem).id;
    if (onlineProfileEditName) onlineProfileEditName.value = player.displayName || "";
    if (onlineProfileEditStatus) onlineProfileEditStatus.textContent = "";
    renderOnlineProfileEditEmblemGrid();
    onlineProfileEditOverlay.hidden = false;
  }

  function closeOnlineProfileEditPanel() {
    if (onlineProfileEditOverlay) onlineProfileEditOverlay.hidden = true;
  }

  async function saveOnlineProfileEdit() {
    const displayName = onlineProfileEditName?.value.trim() || "";
    if (displayName.length < 2) {
      if (onlineProfileEditStatus) onlineProfileEditStatus.textContent = "표시명은 2자 이상이어야 합니다.";
      return;
    }
    try {
      if (onlineProfileEditStatus) onlineProfileEditStatus.textContent = "저장 중...";
      await onlineClient.updateProfile({ displayName, emblem: onlineProfileEditSelectedEmblem });
      renderOnlineProfile();
      closeOnlineProfileEditPanel();
      setOnlineStatus("프로필이 수정되었습니다.");
    } catch (error) {
      if (onlineProfileEditStatus) onlineProfileEditStatus.textContent = error.message || "프로필 수정에 실패했습니다.";
    }
  }

  function onlineMatchLabel(match) {
    const playerId = onlineClient.player?.id;
    if (match.status === "desync") return { text: "무효", className: "is-invalid" };
    if (match.status === "playing") return { text: "진행", className: "" };
    if (!match.winnerId || match.winnerId === "-1") return { text: "무승부", className: "is-invalid" };
    return match.winnerId === playerId
      ? { text: "승리", className: "is-win" }
      : { text: "패배", className: "is-loss" };
  }

  function renderOnlineResultSummary() {
    if (!onlineResultSummary) return;
    const result = onlineLastResult;
    if (!result) {
      onlineResultSummary.hidden = true;
      onlineResultSummary.textContent = "";
      return;
    }
    const mine = result.my || {};
    const ratingChange = mine.ratingChange;
    const stats = mine.stats;
    const won = result.winnerSide === game.online?.side;
    const resultText = result.status === "desync"
      ? "무효 경기"
      : won ? "승리" : "패배";
    const ratingText = ratingChange
      ? `${ratingChange.ratingBefore} → ${ratingChange.ratingAfter} (${ratingChange.ratingDelta >= 0 ? "+" : ""}${ratingChange.ratingDelta})`
      : "변동 없음";
    const commanderProgress = mine.commanderProgress || [];
    const levelUps = commanderProgress.filter(item => item.leveledUp);
    onlineResultSummary.innerHTML = `
      <strong>${escapeHtml(resultText)}</strong><br>
      Rating ${escapeHtml(ratingText)}<br>
      ${stats ? `격파 ${formatTroops(stats.kills)} · 손실 ${formatTroops(stats.losses)} · 잔여 ${formatTroops(stats.troopsRemaining)}` : "전투 통계 없음"}
    `;
    onlineResultSummary.hidden = false;
  }

  function renderOnlineRecords() {
    const recentMatches = onlineClient.recentMatches || [];
    if (onlineRecentMatches) {
      onlineRecentMatches.innerHTML = recentMatches.length ? recentMatches.map((match) => {
        const label = onlineMatchLabel(match);
        const delta = Number(match.ratingAfter ?? match.ratingBefore) - Number(match.ratingBefore ?? 0);
        const deltaText = match.ratingAfter == null ? "" : ` · Rating ${delta >= 0 ? "+" : ""}${delta}`;
        const opponent = match.opponentName || "상대";
        return `
          <div class="online-record-row">
            <div class="online-record-main">
              <div class="online-record-title">${escapeHtml(opponent)}</div>
              <div class="online-record-meta">${escapeHtml(match.status)}${deltaText} · 격파 ${formatTroops(match.kills || 0)} · 손실 ${formatTroops(match.losses || 0)}</div>
            </div>
            <div class="online-record-badge ${label.className}">${label.text}</div>
          </div>
        `;
      }).join("") : `<div class="online-status">아직 기록된 경기가 없습니다.</div>`;
    }

    const leaderboard = onlineClient.leaderboard || [];
    if (onlineLeaderboard) {
      onlineLeaderboard.innerHTML = leaderboard.length ? leaderboard.slice(0, 10).map((player, index) => `
        <div class="online-record-row">
          <div class="online-record-main">
            <div class="online-record-title">${index + 1}. ${escapeHtml(player.displayName)}</div>
            <div class="online-record-meta">${player.wins}승 ${player.losses}패 ${player.draws}무</div>
          </div>
          <div class="online-record-badge">${player.rating}</div>
        </div>
      `).join("") : `<div class="online-status">랭킹 기록이 없습니다.</div>`;
    }
    renderOnlineResultSummary();
  }

  async function refreshOnlineRecords() {
    if (!onlineClient.token) {
      renderOnlineProfile();
      renderOnlineRecords();
      return;
    }
    await Promise.all([
      onlineClient.loadCommanderCatalog(),
      onlineClient.loadMe(),
      onlineClient.loadLeaderboard(),
    ]);
    renderOnlineProfile();
    renderOnlineRecords();
  }

  async function saveOnlineLoadout() {
    onlineLoadoutDraft = readOnlineLoadoutDraft();
    const emptySlot = onlineLoadoutDraft.findIndex(item => !onlineCatalogItem(item?.templateId));
    const lockedSlot = onlineLoadoutDraft.findIndex((item) => {
      const template = onlineCatalogItem(item?.templateId);
      return !onlineCommanderUnlocked(template);
    });
    if (emptySlot >= 0) {
      throw new Error(`${emptySlot + 1}번 슬롯에 장수를 배치해 주세요.`);
    }
    if (lockedSlot >= 0) {
      throw new Error(`${lockedSlot + 1}번 슬롯의 장수는 아직 해금되지 않았습니다.`);
    }
    normalizeOnlineLoadoutBudget();
    const totalPopulation = onlineLoadoutTotalPopulation();
    if (totalPopulation !== POPULATION_BUDGET) {
      throw new Error("총 인구가 50,000이 되도록 편성을 조정해 주세요.");
    }
    setOnlineStatus("편성을 저장하는 중...");
    await onlineClient.saveLoadout(onlineLoadoutDraft);
    await refreshOnlineRecords();
    setOnlineStatus("편성이 저장되었습니다.");
    renderOnlineMatchPanel();
  }

  async function loadOnlineSession() {
    try {
      await refreshOnlineRecords();
      if (pendingInviteCode && onlineClient.player) {
        setOnlinePage("match");
        setOnlineMatchActionState("searching");
        setOnlineStatus("초대 링크로 입장 중...");
        await onlineClient.whenAuthenticated();
        onlineClient.joinPrivateRoom(pendingInviteCode);
        return;
      }
      setOnlinePage(onlineClient.player ? "commanders" : "auth");
      if (onlineClient.player) {
        setOnlineStatus(
          pendingInviteCode ? "로그인 후 초대 링크로 입장할 수 있습니다." : "빠른 매칭을 시작할 수 있습니다.",
        );
      }
    } catch (error) {
      onlineClient.logout();
      renderOnlineProfile();
      renderOnlineRecords();
      setOnlinePage("auth");
      setOnlineStatus(error.message || "온라인 프로필을 불러오지 못했습니다.");
    }
  }

  async function enterWithInviteAsGuest() {
    try {
      setOnlineStatus("게스트로 연결 중...");
      onlineClient.connectAsGuest("게스트");
      await onlineClient.whenAuthenticated();
      if (!pendingInviteCode) {
        setOnlineStatus("초대 코드가 없습니다.");
        return;
      }
      setOnlineStatus("방 입장 중...");
      onlineClient.joinPrivateRoom(pendingInviteCode);
      setOnlinePage("match");
      setOnlineMatchActionState("searching");
    } catch (error) {
      setOnlineStatus(error.message || "게스트 입장에 실패했습니다.");
    }
  }

  function onlineCredentials() {
    return {
      username: onlineUsername?.value.trim() || "",
      password: onlinePassword?.value || "",
      displayName: onlineDisplayName?.value.trim() || "",
    };
  }

  async function loginOnline() {
    try {
      setOnlineStatus("로그인 중...");
      const { username, password } = onlineCredentials();
      await onlineClient.login({ username, password });
      await refreshOnlineRecords();
      if (pendingInviteCode) {
        setOnlinePage("match");
        setOnlineMatchActionState("searching");
        setOnlineStatus("초대 링크로 입장 중...");
        await onlineClient.whenAuthenticated();
        onlineClient.joinPrivateRoom(pendingInviteCode);
        return;
      }
      setOnlinePage("commanders");
      setOnlineStatus("로그인되었습니다. 빠른 매칭을 시작할 수 있습니다.");
    } catch (error) {
      setOnlineStatus(error.message || "로그인에 실패했습니다.");
    }
  }

  async function registerOnline() {
    try {
      setOnlineStatus("계정 생성 중...");
      const { username, password, displayName } = onlineCredentials();
      await onlineClient.register({ username, password, displayName, emblem: randomFactionEmblemId() });
      await refreshOnlineRecords();
      setOnlinePage("commanders");
      setOnlineStatus("계정이 생성되었습니다. 기본 장수 5명이 지급되었습니다.");
    } catch (error) {
      setOnlineStatus(error.message || "회원가입에 실패했습니다.");
    }
  }

  onlineClient.on("AUTH_OK", (message) => {
    onlineClient.player = message.player || onlineClient.player;
    renderOnlineProfile();
    renderOnlineRecords();
    setOnlineStatus("서버에 연결되었습니다. 매칭 대기열에 참가합니다...");
  });
  onlineClient.on("QUEUE_JOINED", () => setOnlineStatus("상대를 찾는 중입니다..."));
  onlineClient.on("QUEUE_LEFT", () => setOnlineStatus("매칭 대기를 취소했습니다."));
  onlineClient.on("QUEUE_JOINED", () => {
    setOnlineMatchActionState("searching");
    setOnlineStatus("상대를 찾는 중입니다...");
  });
  onlineClient.on("QUEUE_LEFT", () => {
    setOnlineMatchActionState("idle");
    setOnlineStatus("매칭 대기를 취소했습니다.");
  });
  onlineClient.on("MATCH_FOUND", (message) => {
    const opponent = (message.players || []).find(player => player.side !== message.side);
    onlinePendingMatch = message;
    onlineReadySides = [];
    renderOnlineMatchPanel();
    setOnlinePage("match");
    setOnlineMatchActionState("matched");
    if (onlineReadyBtn) {
      onlineReadyBtn.disabled = false;
      onlineReadyBtn.textContent = "게임 시작";
    }
    setOnlineStatus("매칭 완료. 양쪽 모두 게임 시작을 눌러야 전투가 시작됩니다.");
    return;
  });
  onlineClient.on("READY_STATE", (message) => {
    onlineReadySides = message.readySides || [];
    const myReady = onlineReadySides.includes(onlinePendingMatch?.side);
    if (onlineReadyBtn) {
      onlineReadyBtn.disabled = myReady;
      onlineReadyBtn.textContent = myReady ? "상대 준비 대기" : "게임 시작";
    }
    setOnlineStatus(message.allReady ? "양쪽 준비 완료. 전장을 여는 중..." : `준비 상태: ${onlineReadySides.length}/2`);
  });
  onlineClient.on("MATCH_START", (message) => {
    setOnlineStatus("전장을 구성하고 상대와 동기화합니다.");
    enterOnlineBattle(message);
  });
  onlineClient.on("LOAD_STATE", (message) => {
    const count = message.loadedSides?.length || 0;
    setOnlineStatus(`전장 확인 중: ${count}/2`);
    if (isOnlineMode() && message.roomId === game.online.roomId) {
      showOnlineSyncNotice(`전장 확인 중: ${count}/2`, "info", 0);
    }
  });
  onlineClient.on("SIM_START", (message) => {
    setOnlineStatus("양쪽 전장 확인 완료. 전투를 시작합니다.");
    startOnlineSimulation(message);
  });
  onlineClient.on("LOAD_MISMATCH", (message) => {
    console.warn("[online] initial load mismatch", message);
    setOnlineStatus("전장 동기화에 실패했습니다. 경기를 무효 처리합니다.");
    showOnlineSyncNotice("전장 동기화 실패 — 잠시 후 로비로 이동합니다.", "danger", 0);
    window.setTimeout(() => {
      disableOnlineRandom();
      game.online = null;
      game.mode = "quick";
      setScreen("online");
      setOnlinePage(onlineClient.player ? "commanders" : "auth");
      hideOnlineSyncNotice();
    }, 3000);
  });
  onlineClient.on("MATCH_CANCELLED", (message = {}) => {
    const previousMatch = onlinePendingMatch;
    const mySide = previousMatch?.side;
    const cancelledByMe = message?.bySide === mySide;
    onlinePendingMatch = null;
    onlineReadySides = [];
    setOnlineMatchActionState("idle");
    renderOnlineMatchPanel();
    if (onlineReturnToCommandersAfterCancel || cancelledByMe) {
      onlineReturnToCommandersAfterCancel = false;
      onlineRematchAfterCancel = false;
      setOnlinePage("commanders");
      setOnlineStatus("편성 화면으로 돌아왔습니다.");
      return;
    }
    if (onlineRematchAfterCancel || previousMatch) {
      onlineRematchAfterCancel = false;
      setOnlineStatus("상대가 떠났습니다. 다시 매칭을 시작합니다...");
      beginOnlineMatchmaking().catch(error => setOnlineStatus(error.message || "재매칭을 시작하지 못했습니다."));
      return;
    }
    setOnlineStatus("매칭이 취소되었습니다.");
    return;
    if (onlineRematchAfterCancel) {
      onlineRematchAfterCancel = false;
      beginOnlineMatchmaking().catch(error => setOnlineStatus(error.message || "재매칭을 시작하지 못했습니다."));
    } else {
      setOnlineStatus("매칭이 취소되었습니다.");
    }
  });
  onlineClient.on("INPUT", queueOnlineInput);
  onlineClient.on("DESYNC_DETECTED", (message) => {
    console.warn("[online] desync detected", message);
    const sides = (message.checksums || [])
      .map(entry => `${entry.side}:${entry.hash}`)
      .join(" / ");
    showOnlineSyncNotice(`동기화 경고: tick ${message.tick} (${sides})`, "danger", 0);
    setOnlineStatus(`동기화 경고가 감지되었습니다. tick ${message.tick}`);
  });
  onlineClient.on("CHECKSUM_OK", (message) => {
    console.info("[online] checksum ok", message);
  });
  onlineClient.on("PRIVATE_ROOM_CREATED", (message) => {
    const code = message.code || "";
    const url = `${location.origin}${location.pathname}?invite=${code}`;
    const input = document.getElementById("onlineInviteLinkInput");
    const area = document.getElementById("onlineInviteLinkArea");
    const status = document.getElementById("onlineInviteStatus");
    if (input) input.value = url;
    if (area) area.hidden = false;
    if (onlineInvitePanel) onlineInvitePanel.hidden = false;
    if (status) status.textContent = "링크를 복사해서 친구에게 공유하세요. (15분 유효)";
    setOnlineMatchActionState("searching");
    setOnlineStatus("친구가 링크를 통해 입장하기를 기다리는 중...");
  });
  onlineClient.on("MATCH_ENDED", (message) => {
    setOnlineStatus(`경기가 종료되었습니다. 결과: ${message.status}`);
    onlineLastResult = message;
    renderOnlineResultSummary();
    renderBattleResultOnlineProgress();
    refreshOnlineRecords().catch(error => console.warn("[online] record refresh failed", error));
  });
  onlineClient.on("MATCH_ENDED", () => {
    hideOnlineSyncNotice();
  });
  onlineClient.on("OPPONENT_DISCONNECTED", () => {
    setOnlineStatus("상대 연결이 끊어졌습니다.");
    if (isOnlineMode() && appState === "battle") {
      game.battlePhase = "ended";
      game.online.resultSubmitted = true;
      disableOnlineRandom();
      showBattleResult(true);
    }
  });
  onlineClient.on("ERROR", (message) => {
    setOnlineStatus(message.error || "온라인 연결 오류가 발생했습니다.");
  });
  onlineClient.on("DISCONNECTED", () => {
    setOnlineStatus("서버 연결이 종료되었습니다.");
  });

  document.getElementById("menuQuickBattle").addEventListener("click", () => {
    enterQuickBattle(true);
  });

  menuOnlineBattle?.addEventListener("click", () => {
    renderOnlineProfile();
    renderOnlineRecords();
    setScreen("online");
    loadOnlineSession();
  });

  menuHistoricalScenario?.addEventListener("click", () => {
    renderScenarioSelect();
    setScreen("scenarioSelect");
    refreshHistoricalScenarioClears().then(renderScenarioSelect);
  });

  onlineBackBtn?.addEventListener("click", () => {
    onlineClient.leaveQueue();
    setScreen("home");
  });

  onlineLoginBtn?.addEventListener("click", loginOnline);
  onlineRegisterBtn?.addEventListener("click", registerOnline);
  onlineAuthForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    loginOnline();
  });
  onlineLogoutBtn?.addEventListener("click", () => {
    onlineClient.logout();
    onlineLastResult = null;
    renderOnlineProfile();
    renderOnlineRecords();
    setOnlineStatus("로그아웃되었습니다.");
  });
  onlineLogoutBtn?.addEventListener("click", () => setOnlinePage("auth"));
  onlineQueueBtn?.addEventListener("click", async () => {
    try {
      onlineLastResult = null;
      renderOnlineResultSummary();
      setOnlineStatus("서버에 연결 중...");
      if (onlinePendingMatch) {
        onlineRematchAfterCancel = true;
        onlineReturnToCommandersAfterCancel = false;
        setOnlineStatus("재매칭을 준비합니다...");
        onlineClient.leaveMatch();
        return;
      }
      await saveOnlineLoadout();
      setOnlinePage("match");
      renderOnlineMatchPanel();
      await onlineClient.joinQueue("quick");
    } catch (error) {
      setOnlineStatus(error.message || "매칭을 시작하지 못했습니다.");
    }
  });
  onlineLeaveQueueBtn?.addEventListener("click", () => {
    onlineClient.leaveQueue();
  });

  onlineProfileEditSaveBtn?.addEventListener("click", () => {
    saveOnlineProfileEdit();
  });
  onlineProfileEditCancelBtn?.addEventListener("click", () => {
    closeOnlineProfileEditPanel();
  });
  onlineProfileEditOverlay?.addEventListener("click", (event) => {
    if (event.target === onlineProfileEditOverlay) closeOnlineProfileEditPanel();
  });

  onlineScreen?.addEventListener("click", async (event) => {
    const id = event.target?.id;
    try {
      if (id === "onlineGuestJoinBtn") {
        await enterWithInviteAsGuest();
      } else if (id === "onlineCreateInviteBtn") {
        await onlineClient.whenAuthenticated();
        onlineClient.createPrivateRoom();
        const btn = document.getElementById("onlineCreateInviteBtn");
        if (btn) btn.disabled = true;
        setOnlineStatus("초대 링크 생성 중...");
      } else if (id === "onlineInviteCopyBtn") {
        const input = document.getElementById("onlineInviteLinkInput");
        const url = input?.value || "";
        if (navigator.share) {
          await navigator.share({ title: "전략 대전 초대", url });
        } else {
          await navigator.clipboard.writeText(url);
          const btn = document.getElementById("onlineInviteCopyBtn");
          if (btn) { btn.textContent = "복사됨!"; setTimeout(() => { btn.textContent = "복사"; }, 1800); }
        }
      } else if (id === "onlineSaveLoadoutBtn") {
        await saveOnlineLoadout();
      } else if (id === "onlineGoMatchBtn") {
        await saveOnlineLoadout();
        await beginOnlineMatchmaking();
      } else if (id === "onlineRecordsBtn") {
        await refreshOnlineRecords();
        setOnlinePage("records");
      } else if (id === "onlineProfileEditBtn") {
        openOnlineProfileEditPanel();
      } else if (id === "onlineRecordsBackBtn") {
        setOnlinePage(onlinePreviousPage === "match" ? "match" : "commanders");
      } else if (id === "onlineBackToCommandersBtn") {
        onlineReturnToCommandersAfterCancel = true;
        onlineRematchAfterCancel = false;
        onlineClient.leaveQueue();
        if (onlinePendingMatch) onlineClient.leaveMatch();
        onlinePendingMatch = null;
        setOnlinePage("commanders");
      } else if (id === "onlineReadyBtn") {
        onlineClient.setReady(true);
        event.target.disabled = true;
        event.target.textContent = "상대 준비 대기";
        setOnlineStatus("내 준비 완료. 상대를 기다립니다...");
      } else if (id === "onlineMatchLogoutBtn") {
        onlineClient.logout();
        onlineLastResult = null;
        onlinePendingMatch = null;
        renderOnlineProfile();
        renderOnlineRecords();
        setOnlinePage("auth");
        setOnlineStatus("로그아웃되었습니다.");
      }
    } catch (error) {
      setOnlineStatus(error.message || "온라인 작업을 완료하지 못했습니다.");
    }
  });

  scenarioSelectBackBtn?.addEventListener("click", () => {
    setScreen("home");
  });

  scenarioNextBtn?.addEventListener("click", () => {
    game.scenarioDialogueIndex += 1;
    if (game.scenarioStep === "victoryDialogue") {
      showVictoryDialogue();
    } else {
      showScenarioDialogue();
    }
  });

  scenarioStartPhaseBtn?.addEventListener("click", () => {
    startScenarioPhasePlay();
  });

  scenarioHud?.addEventListener("click", () => {
    revealScenarioMarkers();
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
    if (isOnlineMode()) return;
    if (isHistoricalMode()) return;
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
    if (isOnlineMode()) return;
    if (isHistoricalMode()) {
      enterHistoricalScenario(game.scenarioData?.id || "cannae");
      return;
    }
    const { playerFormations, enemyFormations } =
      rebuildFormations(savedTerrain, savedPlayerGenerals, savedEnemyGenerals);
    applyScenario(savedTerrain, playerFormations, enemyFormations);
    setScreen("battle");
    centerCameraOn(formationCenter(game.playerFormations[0]));
    refreshHud();
    refreshButtons();
  });

  // 결과 화면: 새로운 전투
  document.getElementById("resultNewBattle").addEventListener("click", () => {
    if (isOnlineMode()) return;
    enterQuickBattle(true);
  });

  // 결과 화면: 홈 화면
    document.getElementById("resultHome").addEventListener("click", () => {
      if (isOnlineMode()) {
        const wasGuest = Boolean(game.online?.isGuest);
      disableOnlineRandom();
      game.online = null;
      game.mode = "quick";
      if (wasGuest) {
        onlineClient.disconnect();
        onlineClient.isGuest = false;
        onlineClient.player = null;
        setScreen("home");
        return;
      }
      setScreen("online");
      setOnlinePage(onlineClient.player ? "commanders" : "auth");
      return;
    }
    if (isHistoricalMode()) {
      game.scenarioData = null;
      game.mode = "quick";
      renderScenarioSelect();
      setScreen("scenarioSelect");
      refreshHistoricalScenarioClears().then(renderScenarioSelect);
      return;
    }
    setScreen("home");
  });

  // 결과 화면: 시나리오 승리 확인 → 시나리오 선택화면으로
  document.getElementById("resultConfirm").addEventListener("click", () => {
    game.scenarioData = null;
    game.mode = "quick";
    renderScenarioSelect();
    setScreen("scenarioSelect");
    refreshHistoricalScenarioClears().then(renderScenarioSelect);
  });

  // 결과 화면: 시나리오 패배 재전투 → 해당 시나리오 처음부터
  document.getElementById("resultScenarioRetry").addEventListener("click", () => {
    enterHistoricalScenario(game.scenarioData?.id);
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
    if (pendingInviteCode) {
      renderOnlineProfile();
      renderOnlineRecords();
      setScreen("online");
      loadOnlineSession();
    } else {
      setScreen("home");
    }
    requestAnimationFrame(tick);
  }

  initPixi(); // 비동기 — pixiReady가 true가 되면 WebGL 렌더러 활성화
  start();
})();
