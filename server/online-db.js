import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { Pool } from "pg";

const BASE_COMMANDER_CATALOG = [
  { id: "hannibal", name: "한니발", source: "cannae", troop_type: "infantry", power: 90, leadership: 100, charm: 98, skill_type: "kihap", allowed_skills: ["kihap", "guard", "swift"], portrait: "assets/portraits/hannibal.png" },
  { id: "alexander", name: "알렉산더", source: "gaugamela", troop_type: "cavalry", power: 96, leadership: 98, charm: 94, skill_type: "kihap", allowed_skills: ["kihap"], portrait: "assets/portraits/alexander.png" },
  { id: "gang_gamchan", name: "강감찬", source: "gwiju", troop_type: "infantry", power: 80, leadership: 98, charm: 92, skill_type: "flood", allowed_skills: ["kihap", "guard", "flood"], portrait: "assets/portraits/gang_gamchan.png" },
  { id: "zhuge_liang", name: "제갈량", source: "bomangpa", troop_type: "infantry", power: 65, leadership: 96, charm: 95, skill_type: "fire", allowed_skills: ["kihap", "guard", "fire"], portrait: "assets/portraits/zhuge_liang.png" },
  { id: "taizong", name: "당태종", source: "jupil", troop_type: "infantry", power: 88, leadership: 97, charm: 90, skill_type: "swift", allowed_skills: ["kihap", "guard", "swift"], portrait: "assets/portraits/tang_taizong.png" },
  { id: "mago", name: "마고", source: "cannae", troop_type: "infantry", power: 85, leadership: 90, charm: 88, skill_type: "guard", allowed_skills: ["kihap", "guard", "swift"], portrait: "assets/portraits/mago.png" },
  { id: "hasdrubal", name: "하스드루발", source: "cannae", troop_type: "cavalry", power: 92, leadership: 88, charm: 75, skill_type: "kihap", allowed_skills: ["kihap"], portrait: "assets/portraits/hasdrubal.png" },
  { id: "parmenion", name: "파르메니온", source: "gaugamela", troop_type: "infantry", power: 84, leadership: 92, charm: 82, skill_type: "guard", allowed_skills: ["kihap", "guard", "swift"], portrait: "assets/portraits/philotas.png" },
  { id: "seol_ingu", name: "설인귀", source: "jupil", troop_type: "cavalry", power: 94, leadership: 88, charm: 78, skill_type: "kihap", allowed_skills: ["kihap"], portrait: "assets/portraits/xiang_yu.png" },
  { id: "zhao_yun", name: "조운", source: "bomangpa", troop_type: "cavalry", power: 95, leadership: 90, charm: 88, skill_type: "kihap", allowed_skills: ["kihap"], portrait: "assets/portraits/zhao_yun.png" },
  { id: "maharbal", name: "마하르발", source: "cannae", troop_type: "cavalry", power: 88, leadership: 85, charm: 80, skill_type: "kihap", allowed_skills: ["kihap"], portrait: "assets/portraits/maharbal.png" },
  { id: "li_shiji", name: "이세적", source: "jupil", troop_type: "infantry", power: 86, leadership: 94, charm: 84, skill_type: "guard", allowed_skills: ["kihap", "guard", "swift"], portrait: "assets/portraits/li_mu.png" },
];

const EXTRA_SKILLS = new Set(["fire", "flood", "archery"]);
const SCENARIO_UNIT_IDS = new Set([
  "cao_vanguard",
  "cao_rear",
  "royal_guard",
  "persian_host",
  "remnant_guard",
  "goryeo_archers",
  "khitan_vanguard",
  "khitan_center",
  "khitan_rear",
  "khitan_horse_archers",
  "malgal_vanguard",
  "rear_guard",
]);
const SCENARIO_UNIT_NAME_PATTERNS = [
  /군\b/,
  /대군/,
  /선봉/,
  /중군/,
  /후군/,
  /궁병/,
  /궁기병/,
  /근위대/,
  /수비대/,
  /잔병/,
  /후속대/,
];
const SCENARIO_REPRESENTATIVE_IDS = new Map([
  ["bomangpa", new Set(["zhuge_liang", "liu_bei", "zhao_yun", "xiahou_dun"])],
  ["cannae", new Set(["hannibal", "mago", "gisgo", "hasdrubal", "maharbal"])],
  ["gaugamela", new Set(["alexander", "parmenion", "darius_iii"])],
  ["gwiju", new Set(["gang_gamchan", "kim_jonghyeon", "so_bae_ap"])],
  ["jupil", new Set(["tang_taizong", "li_shiji", "zhangsun_wuji", "xue_rengui", "go_yeon_su"])],
]);

export const MAX_COMMANDER_LEVEL = 50;

export function commanderLevelMultiplier(level = 0) {
  const normalized = Math.max(0, Math.min(MAX_COMMANDER_LEVEL, Number(level) || 0));
  return 0.5 + normalized / MAX_COMMANDER_LEVEL * 1.5;
}

export function commanderExpRequired(level = 0) {
  const normalized = Math.max(0, Math.min(MAX_COMMANDER_LEVEL - 1, Number(level) || 0));
  return 100 + normalized * normalized * 20;
}

export function commanderExpGain({ kills = 0, won = false } = {}) {
  const base = Math.max(0, Number(kills) || 0) / 10;
  return Math.round(won
    ? Math.min(1500, base * 1.5 + 100)
    : base * 0.7 + 30);
}

function readJsonAsset(relativePath, fallback) {
  try {
    return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8"));
  } catch (_error) {
    return fallback;
  }
}

function portraitId(portrait, fallback) {
  const filename = String(portrait || "")
    .split("/")
    .pop()
    ?.replace(/\.[^.]+$/, "");
  return filename || fallback;
}

function uniqueId(baseId, usedIds) {
  let id = String(baseId || "commander").replace(/[^a-zA-Z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  if (!id) id = "commander";
  let candidate = id;
  let suffix = 2;
  while (usedIds.has(candidate)) {
    candidate = `${id}_${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function commanderSkills(skillType, troopType, optionalSkills = []) {
  if (troopType === "cavalry") return ["kihap"];
  const skills = new Set(["kihap", "guard", "swift"]);
  [...optionalSkills, skillType].forEach((skill) => {
    if (EXTRA_SKILLS.has(skill)) skills.add(skill);
  });
  return [...skills];
}

function normalizeCatalogCommander(raw, source, idHint, usedIds) {
  const troopType = raw.troopType === "cavalry" || raw.troop_type === "cavalry" ? "cavalry" : "infantry";
  const skillType = raw.skillType || raw.skill_type || "kihap";
  const allowedSkills = Array.isArray(raw.allowedSkills)
    ? raw.allowedSkills
    : Array.isArray(raw.allowed_skills)
      ? raw.allowed_skills
      : commanderSkills(skillType, troopType, raw.optionalSkills);
  return {
    id: uniqueId(idHint || raw.id || portraitId(raw.portrait, raw.name), usedIds),
    name: raw.name,
    source,
    troop_type: troopType,
    power: Number(raw.power ?? 75),
    leadership: Number(raw.leadership ?? 75),
    charm: Number(raw.charm ?? 70),
    skill_type: allowedSkills.includes(skillType) ? skillType : allowedSkills[0],
    allowed_skills: troopType === "cavalry" ? ["kihap"] : allowedSkills,
    portrait: raw.portrait || null,
  };
}

function isScenarioUnitFormation(formation) {
  const id = String(formation?.id || "");
  const name = String(formation?.name || "");
  return SCENARIO_UNIT_IDS.has(id) || SCENARIO_UNIT_NAME_PATTERNS.some(pattern => pattern.test(name));
}

function buildCommanderCatalog() {
  const catalog = [];
  const usedIds = new Set();
  const usedNames = new Set();

  const addCommander = (commander) => {
    if (!commander?.name) return;
    const nameKey = commander.name;
    if (usedNames.has(nameKey)) return;
    catalog.push(commander);
    usedIds.add(commander.id);
    usedNames.add(nameKey);
  };

  BASE_COMMANDER_CATALOG.forEach((commander) => {
    addCommander({ ...commander, id: uniqueId(commander.id, usedIds) });
  });

  let scenarioFiles = [];
  try {
    scenarioFiles = readdirSync(new URL("../web/data/scenarios/", import.meta.url))
      .filter(file => file.endsWith(".json") && !file.includes("_terrain"));
  } catch (_error) {
    scenarioFiles = [];
  }

  scenarioFiles.forEach((file) => {
    const scenario = readJsonAsset(`../web/data/scenarios/${file}`, null);
    if (!scenario) return;
    const source = scenario.id || file.replace(/\.json$/, "");
    const representativeIds = SCENARIO_REPRESENTATIVE_IDS.get(source) || new Set();
    ["player", "enemy"].forEach((side) => {
      (scenario[side]?.formations || []).forEach((formation) => {
        if (!representativeIds.has(formation.id)) return;
        if (isScenarioUnitFormation(formation)) return;
        addCommander(normalizeCatalogCommander(formation, source, formation.id || portraitId(formation.portrait, formation.name), usedIds));
      });
    });
  });

  readJsonAsset("../web/assets/portraits/generals.json", []).forEach((general, index) => {
    addCommander(normalizeCatalogCommander(general, "quick", portraitId(general.portrait, `quick_${index + 1}`), usedIds));
  });

  return catalog;
}

export const COMMANDER_CATALOG = buildCommanderCatalog();
const QUICK_COMMANDERS = COMMANDER_CATALOG.filter(commander => commander.source === "quick");
export const DEFAULT_COMMANDERS = (QUICK_COMMANDERS.length >= 5 ? QUICK_COMMANDERS : COMMANDER_CATALOG).slice(0, 5);

export function createDb() {
  if (!process.env.DATABASE_URL) return createMemoryDb();
  const db = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: false } : undefined,
  });
  db.mode = "postgres";
  return db;
}

function createMemoryDb() {
  const state = {
    players: new Map(),
    commanderTemplates: new Map(COMMANDER_CATALOG.map(template => [template.id, { ...template }])),
    playerCommanders: new Map(),
    playerCommanderProgress: new Map(),
    scenarioClears: new Map(),
    matchCommanderStats: new Map(),
    matches: new Map(),
    matchPlayers: new Map(),
    matchInputs: new Map(),
    ratingEvents: new Map(),
  };

  const rows = (items = []) => ({ rows: items, rowCount: items.length });
  const one = (item) => rows(item ? [item] : []);
  const sqlKey = (sql) => String(sql).replace(/\s+/g, " ").trim().toLowerCase();

  async function query(sql, params = []) {
    const key = sqlKey(sql);
    if (!key || key === "begin" || key === "commit" || key === "rollback") return rows();
    if (key.startsWith("create table")) return rows();

    if (key.startsWith("insert into commander_templates")) {
      const [id, name, troopType, power, leadership, charm, skillType, portrait, source = "quick", allowedSkillsRaw = ["kihap"]] = params;
      const allowedSkills = typeof allowedSkillsRaw === "string"
        ? JSON.parse(allowedSkillsRaw)
        : allowedSkillsRaw;
      state.commanderTemplates.set(id, {
        id,
        name,
        troop_type: troopType,
        power,
        leadership,
        charm,
        skill_type: skillType,
        source,
        allowed_skills: allowedSkills,
        portrait,
      });
      return rows();
    }

    if (key.startsWith("insert into player_commanders")) {
      const [id, playerId, templateId, slotIndex] = params;
      const slotKey = `${playerId}:${slotIndex}`;
      if (!state.playerCommanders.has(slotKey)) {
        state.playerCommanders.set(slotKey, {
          id,
          player_id: playerId,
          template_id: templateId,
          slot_index: slotIndex,
          custom_name: null,
          troop_type: null,
          troops: null,
          skill_type: null,
          level: 0,
          exp: 0,
          created_at: new Date(),
        });
      }
      return rows();
    }

    if (key.startsWith("select id from players where lower(username)")) {
      const username = String(params[0]).toLowerCase();
      return rows([...state.players.values()]
        .filter(player => player.username.toLowerCase() === username)
        .map(player => ({ id: player.id })));
    }

    if (key.startsWith("insert into players")) {
      const [id, username, passwordHash, displayName, emblem] = params;
      state.players.set(id, {
        id,
        username,
        password_hash: passwordHash,
        display_name: displayName,
        emblem,
        rating: 1200,
        wins: 0,
        losses: 0,
        draws: 0,
        disconnects: 0,
        created_at: new Date(),
      });
      return rows();
    }

    if (key.startsWith("select id, username, password_hash")) {
      const username = String(params[0]).toLowerCase();
      const player = [...state.players.values()].find(item => item.username.toLowerCase() === username);
      return one(player && {
        id: player.id,
        username: player.username,
        password_hash: player.password_hash,
        displayName: player.display_name,
      });
    }

    if (key.startsWith("select id, username, display_name")) {
      const player = state.players.get(params[0]);
      return one(player && {
        id: player.id,
        username: player.username,
        displayName: player.display_name,
        emblem: player.emblem,
        rating: player.rating,
        wins: player.wins,
        losses: player.losses,
        draws: player.draws,
        disconnects: player.disconnects,
        createdAt: player.created_at,
      });
    }

    if (key.startsWith("select pc.id")) {
      const playerId = params[0];
      const commanders = [...state.playerCommanders.values()]
        .filter(item => item.player_id === playerId)
        .sort((a, b) => a.slot_index - b.slot_index)
        .map((item) => {
          const template = state.commanderTemplates.get(item.template_id);
          return {
            id: item.id,
            slotIndex: item.slot_index,
            templateId: item.template_id,
            name: item.custom_name || template?.name || item.template_id,
            level: item.level,
            exp: item.exp,
            troopType: item.troop_type || template?.troop_type || "infantry",
            troops: item.troops || ((item.troop_type || template?.troop_type) === "cavalry" ? 2500 : 10000),
            power: template?.power || 70,
            leadership: template?.leadership || 70,
            charm: template?.charm || 70,
            skillType: item.skill_type || template?.skill_type || "kihap",
            allowedSkills: template?.allowed_skills || ["kihap"],
            source: template?.source || "quick",
            portrait: template?.portrait || null,
          };
        });
      return rows(commanders);
    }

    if (key.startsWith("select id, display_name") && key.includes("order by rating")) {
      return rows([...state.players.values()]
        .sort((a, b) => b.rating - a.rating || b.wins - a.wins || a.created_at - b.created_at)
        .slice(0, 50)
        .map(player => ({
          id: player.id,
          displayName: player.display_name,
          emblem: player.emblem,
          rating: player.rating,
          wins: player.wins,
          losses: player.losses,
          draws: player.draws,
        })));
    }

    if (key.startsWith("insert into matches")) {
      const [id, roomId, mode, seed] = params;
      if (![...state.matches.values()].some(match => match.room_id === roomId)) {
        state.matches.set(id, {
          id,
          room_id: roomId,
          mode,
          seed,
          status: "playing",
          winner_id: null,
          duration_tick: null,
          final_hash: null,
          created_at: new Date(),
          ended_at: null,
        });
      }
      return rows();
    }

    if (key.startsWith("insert into match_players")) {
      const [matchId, playerId, side, ratingBefore] = params;
      const matchPlayerKey = `${matchId}:${playerId}`;
      if (!state.matchPlayers.has(matchPlayerKey)) {
        state.matchPlayers.set(matchPlayerKey, {
          match_id: matchId,
          player_id: playerId,
          side,
          rating_before: ratingBefore,
          rating_after: null,
          troops_initial: null,
          troops_remaining: null,
          kills: 0,
          losses: 0,
        });
      }
      return rows();
    }

    if (key.startsWith("insert into match_inputs")) {
      const [matchId, seq, playerId, side, targetTick, payload] = params;
      state.matchInputs.set(`${matchId}:${seq}`, {
        match_id: matchId,
        seq,
        player_id: playerId,
        side,
        target_tick: targetTick,
        payload,
        created_at: new Date(),
      });
      return rows();
    }

    if (key.startsWith("update matches")) {
      const [status, winnerId, durationTick, finalHash, matchId] = params;
      const match = state.matches.get(matchId);
      if (match) {
        match.status = status;
        match.winner_id = winnerId;
        match.duration_tick = durationTick;
        match.final_hash = finalHash;
        match.ended_at = new Date();
      }
      return rows();
    }

    if (key.startsWith("update players set rating")) {
      const [ratingAfter, winsInc, lossesInc, playerId] = params;
      const player = state.players.get(playerId);
      if (player) {
        player.rating = ratingAfter;
        player.wins += winsInc;
        player.losses += lossesInc;
      }
      return rows();
    }

    if (key.startsWith("update match_players") && key.includes("troops_initial")) {
      const [troopsInitial, troopsRemaining, kills, losses, matchId, playerId] = params;
      const item = state.matchPlayers.get(`${matchId}:${playerId}`);
      if (item) {
        item.troops_initial = troopsInitial;
        item.troops_remaining = troopsRemaining;
        item.kills = kills;
        item.losses = losses;
      }
      return rows();
    }

    if (key.startsWith("update match_players")) {
      const [ratingAfter, matchId, playerId] = params;
      const item = state.matchPlayers.get(`${matchId}:${playerId}`);
      if (item) item.rating_after = ratingAfter;
      return rows();
    }

    if (key.startsWith("insert into rating_events")) {
      const [id, matchId, playerId, delta, ratingAfter] = params;
      state.ratingEvents.set(id, {
        id,
        match_id: matchId,
        player_id: playerId,
        delta,
        rating_after: ratingAfter,
        created_at: new Date(),
      });
      return rows();
    }

    if (key.startsWith("update players set disconnects")) {
      const player = state.players.get(params[0]);
      if (player) player.disconnects += 1;
      return rows();
    }

    throw new Error(`Unsupported memory DB query: ${String(sql).slice(0, 120)}`);
  }

  return {
    mode: "memory",
    state,
    query,
    async connect() {
      return {
        mode: "memory",
        state,
        query,
        release() {},
      };
    },
  };
}

export async function ensureOnlineSchema(db) {
  if (!db) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS players (
      id UUID PRIMARY KEY,
      username VARCHAR(32) UNIQUE NOT NULL,
      password_hash VARCHAR(128) NOT NULL,
      display_name VARCHAR(32) NOT NULL,
      emblem VARCHAR(32) DEFAULT 'default',
      rating INT DEFAULT 1200,
      wins INT DEFAULT 0,
      losses INT DEFAULT 0,
      draws INT DEFAULT 0,
      disconnects INT DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS commander_templates (
      id VARCHAR(32) PRIMARY KEY,
      name VARCHAR(32) NOT NULL,
      source VARCHAR(32) DEFAULT 'quick',
      troop_type VARCHAR(16) NOT NULL,
      power INT NOT NULL,
      leadership INT NOT NULL,
      charm INT NOT NULL,
      skill_type VARCHAR(16) NOT NULL,
      allowed_skills JSONB DEFAULT '["kihap"]'::jsonb,
      portrait VARCHAR(128)
    );

    CREATE TABLE IF NOT EXISTS player_commanders (
      id UUID PRIMARY KEY,
      player_id UUID REFERENCES players(id) ON DELETE CASCADE,
      template_id VARCHAR(32) REFERENCES commander_templates(id),
      slot_index SMALLINT NOT NULL,
      custom_name VARCHAR(32),
      troop_type VARCHAR(16),
      troops INT,
      skill_type VARCHAR(16),
      level INT DEFAULT 1,
      exp INT DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(player_id, slot_index)
    );

    CREATE TABLE IF NOT EXISTS player_scenario_clears (
      player_id UUID REFERENCES players(id) ON DELETE CASCADE,
      scenario_id VARCHAR(32) NOT NULL,
      clear_count INT DEFAULT 1,
      first_cleared_at TIMESTAMPTZ DEFAULT NOW(),
      last_cleared_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (player_id, scenario_id)
    );

    CREATE TABLE IF NOT EXISTS player_commander_progress (
      player_id UUID REFERENCES players(id) ON DELETE CASCADE,
      template_id VARCHAR(32) REFERENCES commander_templates(id),
      unlocked BOOLEAN DEFAULT false,
      level INT DEFAULT 0,
      exp INT DEFAULT 0,
      total_exp INT DEFAULT 0,
      unlocked_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (player_id, template_id)
    );

    CREATE TABLE IF NOT EXISTS matches (
      id UUID PRIMARY KEY,
      room_id VARCHAR(64) UNIQUE NOT NULL,
      mode VARCHAR(16) NOT NULL,
      seed INT NOT NULL,
      status VARCHAR(16) NOT NULL,
      winner_id UUID REFERENCES players(id),
      duration_tick INT,
      final_hash VARCHAR(64),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      ended_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS match_players (
      match_id UUID REFERENCES matches(id) ON DELETE CASCADE,
      player_id UUID REFERENCES players(id),
      side SMALLINT NOT NULL,
      rating_before INT NOT NULL,
      rating_after INT,
      troops_initial INT,
      troops_remaining INT,
      kills INT DEFAULT 0,
      losses INT DEFAULT 0,
      PRIMARY KEY (match_id, player_id)
    );

    CREATE TABLE IF NOT EXISTS match_inputs (
      match_id UUID REFERENCES matches(id) ON DELETE CASCADE,
      seq INT NOT NULL,
      player_id UUID REFERENCES players(id),
      side SMALLINT NOT NULL,
      target_tick INT NOT NULL,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (match_id, seq)
    );

    CREATE TABLE IF NOT EXISTS match_commander_stats (
      match_id UUID REFERENCES matches(id) ON DELETE CASCADE,
      player_id UUID REFERENCES players(id),
      template_id VARCHAR(32) REFERENCES commander_templates(id),
      slot_index SMALLINT,
      kills INT DEFAULT 0,
      losses INT DEFAULT 0,
      troops_initial INT DEFAULT 0,
      troops_remaining INT DEFAULT 0,
      exp_gained INT DEFAULT 0,
      level_before INT DEFAULT 0,
      level_after INT DEFAULT 0,
      leveled_up BOOLEAN DEFAULT false,
      PRIMARY KEY (match_id, player_id, template_id)
    );

    CREATE TABLE IF NOT EXISTS rating_events (
      id UUID PRIMARY KEY,
      match_id UUID REFERENCES matches(id) ON DELETE CASCADE,
      player_id UUID REFERENCES players(id),
      delta INT NOT NULL,
      rating_after INT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  if (db.mode !== "memory") {
    await db.query(`
      ALTER TABLE commander_templates ADD COLUMN IF NOT EXISTS source VARCHAR(32) DEFAULT 'quick';
      ALTER TABLE commander_templates ADD COLUMN IF NOT EXISTS allowed_skills JSONB DEFAULT '["kihap"]'::jsonb;
      ALTER TABLE player_commanders ADD COLUMN IF NOT EXISTS troop_type VARCHAR(16);
      ALTER TABLE player_commanders ADD COLUMN IF NOT EXISTS troops INT;
      ALTER TABLE player_commanders ADD COLUMN IF NOT EXISTS skill_type VARCHAR(16);
      ALTER TABLE player_commanders ALTER COLUMN level SET DEFAULT 0;
    `);
  }

  for (const commander of COMMANDER_CATALOG) {
    await db.query(
      `INSERT INTO commander_templates
        (id, name, troop_type, power, leadership, charm, skill_type, portrait, source, allowed_skills)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        troop_type = EXCLUDED.troop_type,
        power = EXCLUDED.power,
        leadership = EXCLUDED.leadership,
        charm = EXCLUDED.charm,
        skill_type = EXCLUDED.skill_type,
        source = EXCLUDED.source,
        allowed_skills = EXCLUDED.allowed_skills,
        portrait = EXCLUDED.portrait`,
      [
        commander.id,
        commander.name,
        commander.troop_type,
        commander.power,
        commander.leadership,
        commander.charm,
        commander.skill_type,
        commander.portrait,
        commander.source,
        JSON.stringify(commander.allowed_skills || ["kihap"]),
      ],
    );
  }
}

export async function grantStarterCommanders(db, playerId) {
  for (let index = 0; index < DEFAULT_COMMANDERS.length; index += 1) {
    await db.query(
      `INSERT INTO player_commanders (id, player_id, template_id, slot_index)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (player_id, slot_index) DO NOTHING`,
      [randomUUID(), playerId, DEFAULT_COMMANDERS[index].id, index],
    );
    if (db?.mode === "memory" && db.state) {
      memorySetProgress(db, playerId, DEFAULT_COMMANDERS[index].id, { unlocked: true });
    } else {
      await db.query(
        `INSERT INTO player_commander_progress
          (player_id, template_id, unlocked, level, exp, total_exp, unlocked_at, updated_at)
         VALUES ($1, $2, true, 0, 0, 0, NOW(), NOW())
         ON CONFLICT (player_id, template_id) DO UPDATE SET
          unlocked = true,
          unlocked_at = COALESCE(player_commander_progress.unlocked_at, NOW()),
          updated_at = NOW()`,
        [playerId, DEFAULT_COMMANDERS[index].id],
      );
    }
  }
}

export function getCommanderCatalog() {
  return COMMANDER_CATALOG.map(commander => ({
    id: commander.id,
    name: commander.name,
    source: commander.source,
    troopType: commander.troop_type,
    power: commander.power,
    leadership: commander.leadership,
    charm: commander.charm,
    skillType: commander.skill_type,
    allowedSkills: commander.allowed_skills || ["kihap"],
    portrait: commander.portrait,
  }));
}

function progressKey(playerId, templateId) {
  return `${playerId}:${templateId}`;
}

function isCommanderDefaultUnlocked(commander) {
  return commander?.source === "quick";
}

function scenarioIdForCommander(commander) {
  return isCommanderDefaultUnlocked(commander) ? null : commander?.source || null;
}

function defaultCommanderProgress(commander) {
  const unlocked = isCommanderDefaultUnlocked(commander);
  return {
    unlocked,
    level: 0,
    exp: 0,
    totalExp: 0,
    unlockedAt: unlocked ? new Date() : null,
  };
}

function coerceAllowedSkills(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch (_error) {
      return ["kihap"];
    }
  }
  return ["kihap"];
}

function decorateCommander(commander, progress = null) {
  const fallback = defaultCommanderProgress(commander);
  const level = Math.max(0, Math.min(MAX_COMMANDER_LEVEL, Number(progress?.level ?? fallback.level) || 0));
  const exp = Math.max(0, Number(progress?.exp ?? fallback.exp) || 0);
  const totalExp = Math.max(0, Number(progress?.total_exp ?? progress?.totalExp ?? fallback.totalExp) || 0);
  const unlocked = Boolean(progress?.unlocked ?? fallback.unlocked);
  const mult = commanderLevelMultiplier(level);
  return {
    id: commander.id,
    templateId: commander.id,
    name: commander.name,
    source: commander.source,
    unlockScenarioId: scenarioIdForCommander(commander),
    unlocked,
    level,
    exp,
    totalExp,
    expRequired: level >= MAX_COMMANDER_LEVEL ? 0 : commanderExpRequired(level),
    statMultiplier: mult,
    troopType: commander.troop_type,
    basePower: commander.power,
    baseLeadership: commander.leadership,
    baseCharm: commander.charm,
    power: Math.round(commander.power * mult),
    leadership: Math.round(commander.leadership * mult),
    charm: Math.round(commander.charm * mult),
    skillType: commander.skill_type,
    allowedSkills: coerceAllowedSkills(commander.allowed_skills),
    portrait: commander.portrait,
  };
}

function decoratePlayerCommander(row, progress = null) {
  const commander = commanderTemplateById(row.templateId || row.template_id) || {
    id: row.templateId || row.template_id,
    name: row.name,
    source: row.source || "quick",
    troop_type: row.troopType || row.troop_type || "infantry",
    power: row.power || 70,
    leadership: row.leadership || 70,
    charm: row.charm || 70,
    skill_type: row.skillType || row.skill_type || "kihap",
    allowed_skills: row.allowedSkills || row.allowed_skills || ["kihap"],
    portrait: row.portrait || null,
  };
  const decorated = decorateCommander(commander, progress);
  const troopType = row.troopType || row.troop_type || commander.troop_type || "infantry";
  return {
    ...decorated,
    id: row.id,
    templateId: commander.id,
    slotIndex: row.slotIndex ?? row.slot_index,
    name: row.name || decorated.name,
    troopType,
    troops: row.troops || (troopType === "cavalry" ? 2500 : 10000),
    skillType: row.skillType || row.skill_type || decorated.skillType,
  };
}

function memoryProgressFor(db, playerId, templateId) {
  const commander = commanderTemplateById(templateId);
  if (!commander) return null;
  return db.state.playerCommanderProgress.get(progressKey(playerId, templateId))
    || defaultCommanderProgress(commander);
}

function memorySetProgress(db, playerId, templateId, next) {
  const commander = commanderTemplateById(templateId);
  if (!commander) return null;
  const previous = memoryProgressFor(db, playerId, templateId);
  const progress = {
    unlocked: Boolean(next.unlocked ?? previous.unlocked),
    level: Math.max(0, Math.min(MAX_COMMANDER_LEVEL, Number(next.level ?? previous.level) || 0)),
    exp: Math.max(0, Number(next.exp ?? previous.exp) || 0),
    totalExp: Math.max(0, Number(next.totalExp ?? next.total_exp ?? previous.totalExp) || 0),
    unlockedAt: next.unlockedAt ?? next.unlocked_at ?? previous.unlockedAt ?? (next.unlocked ? new Date() : null),
    updatedAt: new Date(),
  };
  db.state.playerCommanderProgress.set(progressKey(playerId, templateId), progress);
  return progress;
}

async function progressMapForPlayer(db, playerId) {
  if (db?.mode === "memory" && db.state) {
    return new Map([...db.state.playerCommanderProgress.entries()]
      .filter(([key]) => key.startsWith(`${playerId}:`))
      .map(([key, value]) => [key.split(":").slice(1).join(":"), value]));
  }
  const result = await db.query(
    `SELECT template_id, unlocked, level, exp, total_exp AS "totalExp", unlocked_at AS "unlockedAt"
       FROM player_commander_progress
      WHERE player_id = $1`,
    [playerId],
  );
  return new Map(result.rows.map(row => [row.template_id || row.templateId, row]));
}

async function commanderUnlockedForPlayer(db, playerId, templateId) {
  const commander = commanderTemplateById(templateId);
  if (!commander) return false;
  if (isCommanderDefaultUnlocked(commander)) return true;
  if (db?.mode === "memory" && db.state) {
    const progress = memoryProgressFor(db, playerId, templateId);
    return Boolean(progress?.unlocked);
  }
  const result = await db.query(
    `SELECT unlocked
       FROM player_commander_progress
      WHERE player_id = $1 AND template_id = $2`,
    [playerId, templateId],
  );
  return Boolean(result.rows[0]?.unlocked);
}

export async function getPlayerCommanderCatalog(db, playerId) {
  const progressMap = await progressMapForPlayer(db, playerId);
  return COMMANDER_CATALOG.map(commander => decorateCommander(
    commander,
    progressMap.get(commander.id) || defaultCommanderProgress(commander),
  ));
}

function commanderTemplateById(templateId) {
  return COMMANDER_CATALOG.find(commander => commander.id === templateId) || null;
}

export async function recordScenarioClear(db, playerId, scenarioId) {
  const id = String(scenarioId || "").trim();
  if (!id) throw new Error("Scenario id is required.");
  const unlockedCommanders = COMMANDER_CATALOG.filter(commander => commander.source === id);

  if (db?.mode === "memory" && db.state) {
    const key = `${playerId}:${id}`;
    const existing = db.state.scenarioClears.get(key);
    db.state.scenarioClears.set(key, {
      player_id: playerId,
      scenario_id: id,
      clear_count: (existing?.clear_count || 0) + 1,
      first_cleared_at: existing?.first_cleared_at || new Date(),
      last_cleared_at: new Date(),
    });
    unlockedCommanders.forEach((commander) => {
      memorySetProgress(db, playerId, commander.id, { unlocked: true });
    });
    return {
      scenarioId: id,
      unlockedCommanders: unlockedCommanders.map(commander => decorateCommander(
        commander,
        memoryProgressFor(db, playerId, commander.id),
      )),
    };
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO player_scenario_clears
        (player_id, scenario_id, clear_count, first_cleared_at, last_cleared_at)
       VALUES ($1, $2, 1, NOW(), NOW())
       ON CONFLICT (player_id, scenario_id) DO UPDATE SET
        clear_count = player_scenario_clears.clear_count + 1,
        last_cleared_at = NOW()`,
      [playerId, id],
    );
    for (const commander of unlockedCommanders) {
      await client.query(
        `INSERT INTO player_commander_progress
          (player_id, template_id, unlocked, level, exp, total_exp, unlocked_at, updated_at)
         VALUES ($1, $2, true, 0, 0, 0, NOW(), NOW())
         ON CONFLICT (player_id, template_id) DO UPDATE SET
          unlocked = true,
          unlocked_at = COALESCE(player_commander_progress.unlocked_at, NOW()),
          updated_at = NOW()`,
        [playerId, commander.id],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const catalog = await getPlayerCommanderCatalog(db, playerId);
  return {
    scenarioId: id,
    unlockedCommanders: catalog.filter(commander => commander.source === id && commander.unlocked),
  };
}

export async function getPlayerScenarioClears(db, playerId) {
  if (db?.mode === "memory" && db.state) {
    return [...db.state.scenarioClears.values()]
      .filter(clear => clear.player_id === playerId)
      .map(clear => ({
        scenarioId: clear.scenario_id,
        clearCount: clear.clear_count,
        firstClearedAt: clear.first_cleared_at,
        lastClearedAt: clear.last_cleared_at,
      }));
  }
  const result = await db.query(
    `SELECT scenario_id AS "scenarioId",
            clear_count AS "clearCount",
            first_cleared_at AS "firstClearedAt",
            last_cleared_at AS "lastClearedAt"
       FROM player_scenario_clears
      WHERE player_id = $1
      ORDER BY last_cleared_at DESC`,
    [playerId],
  );
  return result.rows;
}

function buildCommanderProgressResult(commander, before, after, gainedExp, statBefore, statAfter) {
  return {
    templateId: commander.id,
    name: commander.name,
    portrait: commander.portrait,
    source: commander.source,
    levelBefore: before.level,
    levelAfter: after.level,
    expBefore: before.exp,
    expAfter: after.exp,
    totalExpAfter: after.totalExp ?? after.total_exp ?? 0,
    gainedExp,
    requiredExp: before.level >= MAX_COMMANDER_LEVEL ? 0 : commanderExpRequired(before.level),
    nextRequiredExp: after.level >= MAX_COMMANDER_LEVEL ? 0 : commanderExpRequired(after.level),
    leveledUp: after.level > before.level,
    statsBefore: statBefore,
    statsAfter: statAfter,
  };
}

export async function applyCommanderBattleProgress(db, playerId, matchId, commanderStats = [], won = false) {
  const normalizedStats = Array.isArray(commanderStats) ? commanderStats.slice(0, 5) : [];
  const results = [];

  for (const stat of normalizedStats) {
    const templateId = stat.templateId || stat.template_id;
    const commander = commanderTemplateById(templateId);
    if (!commander) continue;
    const kills = Math.max(0, Math.round(Number(stat.kills) || 0));
    const losses = Math.max(0, Math.round(Number(stat.losses) || 0));
    const troopsInitial = Math.max(0, Math.round(Number(stat.troopsInitial ?? stat.troops_initial) || 0));
    const troopsRemaining = Math.max(0, Math.round(Number(stat.troopsRemaining ?? stat.troops_remaining) || 0));
    const slotIndex = Number.isInteger(stat.slotIndex) ? stat.slotIndex : Number(stat.slot_index ?? 0);
    const gainedExp = commanderExpGain({ kills, won });

    let before;
    let after;
    if (db?.mode === "memory" && db.state) {
      before = {
        ...defaultCommanderProgress(commander),
        ...memoryProgressFor(db, playerId, templateId),
      };
      const required = before.level >= MAX_COMMANDER_LEVEL ? Infinity : commanderExpRequired(before.level);
      const willLevel = before.level < MAX_COMMANDER_LEVEL && before.exp + gainedExp >= required;
      after = {
        unlocked: true,
        level: willLevel ? before.level + 1 : before.level,
        exp: willLevel || before.level >= MAX_COMMANDER_LEVEL ? 0 : before.exp + gainedExp,
        totalExp: (before.totalExp || before.total_exp || 0) + gainedExp,
        unlockedAt: before.unlockedAt || before.unlocked_at || new Date(),
      };
      memorySetProgress(db, playerId, templateId, after);
      db.state.matchCommanderStats.set(`${matchId}:${playerId}:${templateId}`, {
        match_id: matchId,
        player_id: playerId,
        template_id: templateId,
        slot_index: slotIndex,
        kills,
        losses,
        troops_initial: troopsInitial,
        troops_remaining: troopsRemaining,
        exp_gained: gainedExp,
        level_before: before.level,
        level_after: after.level,
        leveled_up: after.level > before.level,
      });
    } else {
      const progressResult = await db.query(
        `SELECT unlocked, level, exp, total_exp AS "totalExp", unlocked_at AS "unlockedAt"
           FROM player_commander_progress
          WHERE player_id = $1 AND template_id = $2`,
        [playerId, templateId],
      );
      before = {
        ...defaultCommanderProgress(commander),
        ...(progressResult.rows[0] || {}),
      };
      before.level = Math.max(0, Math.min(MAX_COMMANDER_LEVEL, Number(before.level) || 0));
      before.exp = Math.max(0, Number(before.exp) || 0);
      before.totalExp = Math.max(0, Number(before.totalExp ?? before.total_exp) || 0);
      const required = before.level >= MAX_COMMANDER_LEVEL ? Infinity : commanderExpRequired(before.level);
      const willLevel = before.level < MAX_COMMANDER_LEVEL && before.exp + gainedExp >= required;
      after = {
        unlocked: true,
        level: willLevel ? before.level + 1 : before.level,
        exp: willLevel || before.level >= MAX_COMMANDER_LEVEL ? 0 : before.exp + gainedExp,
        totalExp: before.totalExp + gainedExp,
      };
      await db.query(
        `INSERT INTO player_commander_progress
          (player_id, template_id, unlocked, level, exp, total_exp, unlocked_at, updated_at)
         VALUES ($1, $2, true, $3, $4, $5, NOW(), NOW())
         ON CONFLICT (player_id, template_id) DO UPDATE SET
          unlocked = true,
          level = EXCLUDED.level,
          exp = EXCLUDED.exp,
          total_exp = EXCLUDED.total_exp,
          unlocked_at = COALESCE(player_commander_progress.unlocked_at, NOW()),
          updated_at = NOW()`,
        [playerId, templateId, after.level, after.exp, after.totalExp],
      );
      await db.query(
        `INSERT INTO match_commander_stats
          (match_id, player_id, template_id, slot_index, kills, losses, troops_initial, troops_remaining,
           exp_gained, level_before, level_after, leveled_up)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (match_id, player_id, template_id) DO UPDATE SET
          slot_index = EXCLUDED.slot_index,
          kills = EXCLUDED.kills,
          losses = EXCLUDED.losses,
          troops_initial = EXCLUDED.troops_initial,
          troops_remaining = EXCLUDED.troops_remaining,
          exp_gained = EXCLUDED.exp_gained,
          level_before = EXCLUDED.level_before,
          level_after = EXCLUDED.level_after,
          leveled_up = EXCLUDED.leveled_up`,
        [
          matchId,
          playerId,
          templateId,
          slotIndex,
          kills,
          losses,
          troopsInitial,
          troopsRemaining,
          gainedExp,
          before.level,
          after.level,
          after.level > before.level,
        ],
      );
    }

    const statBefore = {
      power: Math.round(commander.power * commanderLevelMultiplier(before.level)),
      leadership: Math.round(commander.leadership * commanderLevelMultiplier(before.level)),
      charm: Math.round(commander.charm * commanderLevelMultiplier(before.level)),
    };
    const statAfter = {
      power: Math.round(commander.power * commanderLevelMultiplier(after.level)),
      leadership: Math.round(commander.leadership * commanderLevelMultiplier(after.level)),
      charm: Math.round(commander.charm * commanderLevelMultiplier(after.level)),
    };
    results.push(buildCommanderProgressResult(commander, before, after, gainedExp, statBefore, statAfter));
  }

  return results;
}

export async function savePlayerLoadout(db, playerId, commanders) {
  const normalized = [];
  for (let index = 0; index < commanders.slice(0, 5).length; index += 1) {
    const item = commanders[index];
    const template = commanderTemplateById(item.templateId);
    if (!template) throw new Error(`Unknown commander template: ${item.templateId}`);
    if (!(await commanderUnlockedForPlayer(db, playerId, template.id))) {
      throw new Error(`Commander is locked: ${template.name}`);
    }
    const troopType = item.troopType === "cavalry" ? "cavalry" : "infantry";
    const allowedSkills = troopType === "cavalry" ? ["kihap"] : (template.allowed_skills || ["kihap", "guard", "swift"]);
    const skillType = allowedSkills.includes(item.skillType) ? item.skillType : allowedSkills[0];
    const minTroops = troopType === "cavalry" ? 250 : 1000;
    const maxTroops = troopType === "cavalry" ? 12500 : 50000;
    const troops = Math.max(minTroops, Math.min(maxTroops, Math.round(Number(item.troops) || (troopType === "cavalry" ? 2500 : 10000))));
    normalized.push({
      slotIndex: Number.isInteger(item.slotIndex) ? item.slotIndex : index,
      templateId: template.id,
      troopType,
      troops,
      skillType,
    });
  }

  if (normalized.length !== 5) throw new Error("Loadout requires exactly 5 commanders.");
  if (new Set(normalized.map(item => item.templateId)).size !== normalized.length) {
    throw new Error("Loadout cannot contain duplicate commanders.");
  }

  const population = normalized.reduce((sum, item) => sum + item.troops * (item.troopType === "cavalry" ? 4 : 1), 0);
  if (population > 50000) throw new Error("Loadout population exceeds 50,000.");

  if (db.mode === "memory" && db.state) {
    normalized.forEach((item) => {
      const key = `${playerId}:${item.slotIndex}`;
      const existing = db.state.playerCommanders.get(key);
      db.state.playerCommanders.set(key, {
        id: existing?.id || randomUUID(),
        player_id: playerId,
        template_id: item.templateId,
        slot_index: item.slotIndex,
        custom_name: null,
        troop_type: item.troopType,
        troops: item.troops,
        skill_type: item.skillType,
        level: existing?.level || 0,
        exp: existing?.exp || 0,
        created_at: existing?.created_at || new Date(),
      });
    });
    return normalized;
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    for (const item of normalized) {
      await client.query(
        `INSERT INTO player_commanders
          (id, player_id, template_id, slot_index, troop_type, troops, skill_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (player_id, slot_index) DO UPDATE SET
          template_id = EXCLUDED.template_id,
          troop_type = EXCLUDED.troop_type,
          troops = EXCLUDED.troops,
          skill_type = EXCLUDED.skill_type`,
        [randomUUID(), playerId, item.templateId, item.slotIndex, item.troopType, item.troops, item.skillType],
      );
    }
    await client.query("COMMIT");
    return normalized;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getPlayerProfile(db, playerId) {
  const playerResult = await db.query(
    `SELECT id, username, display_name AS "displayName", emblem, rating,
            wins, losses, draws, disconnects, created_at AS "createdAt"
       FROM players
      WHERE id = $1`,
    [playerId],
  );
  const player = playerResult.rows[0];
  if (!player) return null;
  const commanders = await getPlayerCommanders(db, playerId);
  const scenarioClears = await getPlayerScenarioClears(db, playerId);
  return { ...player, commanders, scenarioClears };
}

export async function getPlayerRecentMatches(db, playerId, limit = 10) {
  if (db?.mode === "memory" && db.state) {
    const matches = [...db.state.matchPlayers.values()]
      .filter(item => item.player_id === playerId)
      .map((item) => {
        const match = db.state.matches.get(item.match_id);
        if (!match) return null;
        const opponentEntry = [...db.state.matchPlayers.values()]
          .find(other => other.match_id === item.match_id && other.player_id !== playerId);
        const opponent = opponentEntry ? db.state.players.get(opponentEntry.player_id) : null;
        return {
          matchId: match.id,
          roomId: match.room_id,
          mode: match.mode,
          status: match.status,
          seed: match.seed,
          winnerId: match.winner_id,
          durationTick: match.duration_tick,
          createdAt: match.created_at,
          endedAt: match.ended_at,
          side: item.side,
          ratingBefore: item.rating_before,
          ratingAfter: item.rating_after,
          troopsInitial: item.troops_initial,
          troopsRemaining: item.troops_remaining,
          kills: item.kills,
          losses: item.losses,
          opponentId: opponent?.id || null,
          opponentName: opponent?.display_name || null,
          opponentRating: opponent?.rating || null,
        };
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.endedAt || b.createdAt) - new Date(a.endedAt || a.createdAt))
      .slice(0, limit);
    return matches;
  }

  const result = await db.query(
    `SELECT m.id AS "matchId",
            m.room_id AS "roomId",
            m.mode,
            m.status,
            m.seed,
            m.winner_id AS "winnerId",
            m.duration_tick AS "durationTick",
            m.created_at AS "createdAt",
            m.ended_at AS "endedAt",
            mp.side,
            mp.rating_before AS "ratingBefore",
            mp.rating_after AS "ratingAfter",
            mp.troops_initial AS "troopsInitial",
            mp.troops_remaining AS "troopsRemaining",
            mp.kills,
            mp.losses,
            op.player_id AS "opponentId",
            p.display_name AS "opponentName",
            p.rating AS "opponentRating"
       FROM match_players mp
       JOIN matches m ON m.id = mp.match_id
       LEFT JOIN match_players op ON op.match_id = m.id AND op.player_id <> mp.player_id
       LEFT JOIN players p ON p.id = op.player_id
      WHERE mp.player_id = $1
      ORDER BY COALESCE(m.ended_at, m.created_at) DESC
      LIMIT $2`,
    [playerId, limit],
  );
  return result.rows;
}

export async function getPlayerCommanders(db, playerId) {
  if (db?.mode === "memory" && db.state) {
    return [...db.state.playerCommanders.values()]
      .filter(item => item.player_id === playerId)
      .sort((a, b) => a.slot_index - b.slot_index)
      .map((item) => {
        const template = commanderTemplateById(item.template_id);
        return decoratePlayerCommander({
          id: item.id,
          slotIndex: item.slot_index,
          templateId: item.template_id,
          name: item.custom_name || template?.name || item.template_id,
          troopType: item.troop_type || template?.troop_type || "infantry",
          troops: item.troops || ((item.troop_type || template?.troop_type) === "cavalry" ? 2500 : 10000),
          skillType: item.skill_type || template?.skill_type || "kihap",
        }, memoryProgressFor(db, playerId, item.template_id));
      });
  }

  const result = await db.query(
    `SELECT pc.id, pc.slot_index AS "slotIndex", pc.template_id AS "templateId",
            COALESCE(pc.custom_name, ct.name) AS name,
            COALESCE(pc.troop_type, ct.troop_type) AS "troopType",
            COALESCE(pc.troops, CASE WHEN COALESCE(pc.troop_type, ct.troop_type) = 'cavalry' THEN 2500 ELSE 10000 END) AS troops,
            ct.power, ct.leadership, ct.charm,
            COALESCE(pc.skill_type, ct.skill_type) AS "skillType",
            ct.allowed_skills AS "allowedSkills",
            ct.source,
            ct.portrait
       FROM player_commanders pc
       JOIN commander_templates ct ON ct.id = pc.template_id
      WHERE pc.player_id = $1
      ORDER BY pc.slot_index ASC`,
    [playerId],
  );
  const progressMap = await progressMapForPlayer(db, playerId);
  return result.rows.map(row => decoratePlayerCommander(row, progressMap.get(row.templateId)));
}
