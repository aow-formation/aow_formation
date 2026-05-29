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
    if (usedNames.has(commander.name)) return;
    catalog.push(commander);
    usedIds.add(commander.id);
    usedNames.add(commander.name);
  };

  BASE_COMMANDER_CATALOG.forEach((commander) => {
    addCommander({ ...commander, id: uniqueId(commander.id, usedIds) });
  });

  readJsonAsset("../web/assets/portraits/generals.json", []).forEach((general, index) => {
    addCommander(normalizeCatalogCommander(general, "quick", portraitId(general.portrait, `quick_${index + 1}`), usedIds));
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
    ["player", "enemy"].forEach((side) => {
      (scenario[side]?.formations || []).forEach((formation) => {
        if (isScenarioUnitFormation(formation)) return;
        addCommander(normalizeCatalogCommander(formation, source, formation.id || portraitId(formation.portrait, formation.name), usedIds));
      });
    });
  });

  return catalog;
}

export const COMMANDER_CATALOG = buildCommanderCatalog();
export const DEFAULT_COMMANDERS = COMMANDER_CATALOG.slice(0, 5);

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
          level: 1,
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

function commanderTemplateById(templateId) {
  return COMMANDER_CATALOG.find(commander => commander.id === templateId) || null;
}

export async function savePlayerLoadout(db, playerId, commanders) {
  const normalized = commanders.slice(0, 5).map((item, index) => {
    const template = commanderTemplateById(item.templateId);
    if (!template) throw new Error(`Unknown commander template: ${item.templateId}`);
    const troopType = item.troopType === "cavalry" ? "cavalry" : "infantry";
    const allowedSkills = troopType === "cavalry" ? ["kihap"] : (template.allowed_skills || ["kihap", "guard", "swift"]);
    const skillType = allowedSkills.includes(item.skillType) ? item.skillType : allowedSkills[0];
    const minTroops = troopType === "cavalry" ? 250 : 1000;
    const maxTroops = troopType === "cavalry" ? 12500 : 50000;
    const troops = Math.max(minTroops, Math.min(maxTroops, Math.round(Number(item.troops) || (troopType === "cavalry" ? 2500 : 10000))));
    return {
      slotIndex: Number.isInteger(item.slotIndex) ? item.slotIndex : index,
      templateId: template.id,
      troopType,
      troops,
      skillType,
    };
  });

  if (normalized.length !== 5) throw new Error("Loadout requires exactly 5 commanders.");

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
        level: existing?.level || 1,
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
  return { ...player, commanders };
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
  const result = await db.query(
    `SELECT pc.id, pc.slot_index AS "slotIndex", pc.template_id AS "templateId",
            COALESCE(pc.custom_name, ct.name) AS name,
            pc.level, pc.exp,
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
  return result.rows;
}
