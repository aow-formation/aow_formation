import { randomInt, randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import { z } from "zod";
import { applyCommanderBattleProgress, getPlayerProfile } from "./online-db.js";
import { verifyPlayerToken } from "./online-auth.js";

const TICK_RATE = 30;
const INPUT_DELAY_TICKS = 18;
const MATCH_START_DELAY_MS = 1500;

const authSchema = z.object({
  type: z.literal("AUTH"),
  token: z.string().min(10),
});

const joinQueueSchema = z.object({
  type: z.literal("JOIN_QUEUE"),
  mode: z.enum(["quick", "ranked"]).default("quick"),
});

const readySchema = z.object({
  type: z.literal("PLAYER_READY"),
  ready: z.boolean().default(true),
});

const inputSchema = z.object({
  type: z.literal("INPUT"),
  clientSeq: z.number().int().nonnegative().optional(),
  commands: z.array(z.object({}).passthrough()).max(16),
});

const checksumSchema = z.object({
  type: z.literal("CHECKSUM"),
  tick: z.number().int().nonnegative(),
  hash: z.string().min(1).max(128),
});

const resultSchema = z.object({
  type: z.literal("RESULT"),
  winnerSide: z.number().int().min(-1).max(1),
  durationTick: z.number().int().nonnegative().optional(),
  finalHash: z.string().max(128).optional(),
  stats: z.object({
    troopsInitial: z.number().int().nonnegative().optional(),
    troopsRemaining: z.number().int().nonnegative().optional(),
    kills: z.number().int().nonnegative().optional(),
    losses: z.number().int().nonnegative().optional(),
    commanderStats: z.array(z.object({
      templateId: z.string().min(1).max(32),
      slotIndex: z.number().int().min(0).max(4).optional(),
      kills: z.number().int().nonnegative().optional(),
      losses: z.number().int().nonnegative().optional(),
      troopsInitial: z.number().int().nonnegative().optional(),
      troopsRemaining: z.number().int().nonnegative().optional(),
    }).passthrough()).max(5).optional(),
  }).passthrough().optional(),
});

function send(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}

function publicPlayer(player, side) {
  return {
    id: player.id,
    displayName: player.displayName,
    emblem: player.emblem,
    rating: player.rating,
    side,
    commanders: player.commanders,
  };
}

function calcElo(ratingA, ratingB, resultA) {
  const k = 32;
  const expected = 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
  const delta = Math.round(k * (resultA - expected));
  return delta;
}

function statInt(value) {
  return Math.max(0, Math.round(Number(value) || 0));
}

export function installMultiplayerServer({ server, db }) {
  const wss = new WebSocketServer({ server, path: "/ws" });
  const queue = [];
  const rooms = new Map();

  async function createRoom(a, b, mode = "quick") {
    const roomId = randomUUID();
    const seed = randomInt(1, 2_000_000_000);
    const now = Date.now();
    const room = {
      id: roomId,
      dbMatchId: randomUUID(),
      mode,
      seed,
      startedAt: now + MATCH_START_DELAY_MS,
      seq: 0,
      ended: false,
      matchStarted: false,
      sockets: [a, b],
      results: new Map(),
      checksums: new Map(),
      desyncTicks: new Set(),
      recentInputs: [],
      readySides: new Set(),
    };
    rooms.set(roomId, room);

    a.roomId = roomId;
    b.roomId = roomId;
    a.side = 0;
    b.side = 1;

    if (db) {
      await db.query(
        `INSERT INTO matches (id, room_id, mode, seed, status)
         VALUES ($1, $2, $3, $4, 'playing')
         ON CONFLICT (room_id) DO NOTHING`,
        [room.dbMatchId, room.id, room.mode, room.seed],
      );
      for (const ws of room.sockets) {
        await db.query(
          `INSERT INTO match_players (match_id, player_id, side, rating_before)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (match_id, player_id) DO NOTHING`,
          [room.dbMatchId, ws.player.id, ws.side, ws.player.rating],
        );
      }
    }

    const players = room.sockets.map(ws => publicPlayer(ws.player, ws.side));
    const serverNow = Date.now();
    room.sockets.forEach((ws) => {
      send(ws, {
        type: "MATCH_FOUND",
        roomId: room.id,
        side: ws.side,
        seed: room.seed,
        tickRate: TICK_RATE,
        inputDelayTicks: INPUT_DELAY_TICKS,
        protocol: "thin-relay-scheduled-lockstep",
        players,
      });
    });
  }

  function broadcastReadyState(room) {
    const readySides = [...room.readySides].sort((a, b) => a - b);
    room.sockets.forEach(peer => send(peer, {
      type: "READY_STATE",
      roomId: room.id,
      readySides,
      allReady: readySides.length >= room.sockets.length,
    }));
  }

  async function startMatchedRoom(room) {
    if (room.matchStarted || room.ended) return;
    room.matchStarted = true;
    room.startedAt = Date.now() + MATCH_START_DELAY_MS;
    const serverNow = Date.now();
    const players = room.sockets.map(ws => publicPlayer(ws.player, ws.side));
    room.sockets.forEach((ws) => {
      send(ws, {
        type: "MATCH_START",
        roomId: room.id,
        side: ws.side,
        seed: room.seed,
        startedAt: room.startedAt,
        serverNow,
        tickRate: TICK_RATE,
        inputDelayTicks: INPUT_DELAY_TICKS,
        protocol: "thin-relay-scheduled-lockstep",
        players,
      });
    });
  }

  function removeFromQueue(ws) {
    const index = queue.indexOf(ws);
    if (index >= 0) queue.splice(index, 1);
  }

  async function joinQueue(ws, mode) {
    if (!ws.player) {
      send(ws, { type: "ERROR", error: "Authenticate first" });
      return;
    }
    ws.player = await getPlayerProfile(db, ws.player.id);
    removeFromQueue(ws);
    const opponentIndex = queue.findIndex(candidate => (
      candidate !== ws &&
      candidate.readyState === WebSocket.OPEN &&
      candidate.mode === mode &&
      !candidate.roomId
    ));
    if (opponentIndex < 0) {
      ws.mode = mode;
      queue.push(ws);
      send(ws, { type: "QUEUE_JOINED", mode });
      return;
    }
    const [opponent] = queue.splice(opponentIndex, 1);
    await createRoom(opponent, ws, mode);
  }

  async function handleReady(ws, msg) {
    const room = rooms.get(ws.roomId);
    if (!room || room.ended) return;
    if (msg.ready) room.readySides.add(ws.side);
    else room.readySides.delete(ws.side);
    broadcastReadyState(room);
    if (room.readySides.size >= room.sockets.length) {
      await startMatchedRoom(room);
    }
  }

  function handleLeaveMatch(ws) {
    const room = rooms.get(ws.roomId);
    if (!room || room.ended || room.matchStarted) return false;
    room.ended = true;
    room.sockets.forEach((peer) => {
      send(peer, {
        type: "MATCH_CANCELLED",
        roomId: room.id,
        bySide: ws.side,
      });
      peer.roomId = null;
      peer.side = null;
    });
    rooms.delete(room.id);
    return true;
  }

  async function handleInput(ws, msg) {
    const room = rooms.get(ws.roomId);
    if (!room || room.ended || !room.matchStarted) return;
    room.seq += 1;
    const elapsedMs = Math.max(0, Date.now() - room.startedAt);
    const matchTick = Math.floor(elapsedMs / 1000 * TICK_RATE);
    const payload = {
      type: "INPUT",
      roomId: room.id,
      seq: room.seq,
      playerId: ws.player.id,
      side: ws.side,
      targetTick: matchTick + INPUT_DELAY_TICKS,
      serverNow: Date.now(),
      commands: msg.commands,
    };
    room.recentInputs.push({
      seq: payload.seq,
      side: payload.side,
      targetTick: payload.targetTick,
      types: payload.commands.map(command => command.type || command.action || "UNKNOWN"),
      at: payload.serverNow,
    });
    if (room.recentInputs.length > 60) room.recentInputs.splice(0, room.recentInputs.length - 60);
    if (db) {
      db.query(
        `INSERT INTO match_inputs (match_id, seq, player_id, side, target_tick, payload)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (match_id, seq) DO NOTHING`,
        [room.dbMatchId, payload.seq, ws.player.id, ws.side, payload.targetTick, payload],
      ).catch(error => console.error("[match_inputs]", error));
    }
    room.sockets.forEach(peer => send(peer, payload));
  }

  function handleChecksum(ws, msg) {
    const room = rooms.get(ws.roomId);
    if (!room || room.ended) return;
    const key = Number(msg.tick);
    const checksumsForTick = room.checksums.get(key) || new Map();
    checksumsForTick.set(ws.side, msg.hash);
    room.checksums.set(key, checksumsForTick);
    room.sockets.forEach(peer => {
      if (peer !== ws) send(peer, { ...msg, side: ws.side });
    });
    for (const tick of room.checksums.keys()) {
      if (tick < key - TICK_RATE * 60) room.checksums.delete(tick);
    }
    if (checksumsForTick.size < 2) return;

    const checksums = [...checksumsForTick.entries()]
      .map(([side, hash]) => ({ side, hash }))
      .sort((a, b) => a.side - b.side);
    const hashes = new Set(checksums.map(entry => entry.hash));
    if (hashes.size <= 1) {
      room.sockets.forEach(peer => send(peer, {
        type: "CHECKSUM_OK",
        tick: key,
        hash: checksums[0].hash,
      }));
      return;
    }
    if (!room.desyncTicks.has(key)) {
      room.desyncTicks.add(key);
      const payload = {
        type: "DESYNC_DETECTED",
        roomId: room.id,
        tick: key,
        checksums,
        recentInputs: room.recentInputs.slice(-12),
      };
      console.warn("[online/desync]", JSON.stringify({
        roomId: room.id,
        tick: key,
        checksums,
        recentInputs: payload.recentInputs,
      }));
      room.sockets.forEach(peer => send(peer, payload));
    }
  }

  async function finishRoom(room, winnerSide, status, finalHash = null) {
    if (room.ended) return;
    room.ended = true;
    const winner = room.sockets.find(ws => ws.side === winnerSide)?.player || null;
    const resultStats = new Map();
    const ratingChanges = new Map();
    const commanderProgressByPlayer = new Map();
    if (db) {
      const durationTick = Math.max(0, Math.floor((Date.now() - room.startedAt) / 1000 * TICK_RATE));
      await db.query(
        `UPDATE matches
            SET status = $1, winner_id = $2, duration_tick = $3, final_hash = $4, ended_at = NOW()
          WHERE id = $5`,
        [status, winner?.id || null, durationTick, finalHash, room.dbMatchId],
      );
      for (const peer of room.sockets) {
        const result = room.results.get(peer.side);
        const stats = result?.stats || {};
        const shouldApplyProgress = status === "normal" || status === "disconnect";
        const normalizedStats = {
          troopsInitial: statInt(stats.troopsInitial),
          troopsRemaining: statInt(stats.troopsRemaining),
          kills: statInt(stats.kills),
          losses: statInt(stats.losses),
        };
        resultStats.set(peer.player.id, normalizedStats);
        await db.query(
          `UPDATE match_players
              SET troops_initial = $1,
                  troops_remaining = $2,
                  kills = $3,
                  losses = $4
            WHERE match_id = $5 AND player_id = $6`,
          [
            normalizedStats.troopsInitial,
            normalizedStats.troopsRemaining,
            normalizedStats.kills,
            normalizedStats.losses,
            room.dbMatchId,
            peer.player.id,
          ],
        );
        const commanderProgress = shouldApplyProgress
          ? await applyCommanderBattleProgress(
            db,
            peer.player.id,
            room.dbMatchId,
            stats.commanderStats || [],
            peer.side === winnerSide,
          )
          : [];
        commanderProgressByPlayer.set(peer.player.id, commanderProgress);
      }
      if (winner && (status === "normal" || status === "disconnect")) {
        const [p0, p1] = room.sockets.map(ws => ws.player);
        const result0 = winnerSide === 0 ? 1 : 0;
        const delta0 = calcElo(p0.rating, p1.rating, result0);
        const delta1 = -delta0;
        const updates = [
          { player: p0, delta: delta0, won: winnerSide === 0 },
          { player: p1, delta: delta1, won: winnerSide === 1 },
        ];
        for (const update of updates) {
          const ratingBefore = update.player.rating;
          const ratingAfter = update.player.rating + update.delta;
          ratingChanges.set(update.player.id, {
            ratingBefore,
            ratingAfter,
            ratingDelta: update.delta,
            result: update.won ? "win" : "loss",
          });
          await db.query(
            `UPDATE players
                SET rating = $1,
                    wins = wins + $2,
                    losses = losses + $3
              WHERE id = $4`,
            [ratingAfter, update.won ? 1 : 0, update.won ? 0 : 1, update.player.id],
          );
          await db.query(
            `UPDATE match_players
                SET rating_after = $1
              WHERE match_id = $2 AND player_id = $3`,
            [ratingAfter, room.dbMatchId, update.player.id],
          );
          await db.query(
            `INSERT INTO rating_events (id, match_id, player_id, delta, rating_after)
             VALUES ($1, $2, $3, $4, $5)`,
            [randomUUID(), room.dbMatchId, update.player.id, update.delta, ratingAfter],
          );
          update.player.rating = ratingAfter;
          if (update.won) update.player.wins += 1;
          else update.player.losses += 1;
        }
      }
    }
    const players = room.sockets.map((peer) => ({
      id: peer.player.id,
      side: peer.side,
      displayName: peer.player.displayName,
      rating: peer.player.rating,
      stats: resultStats.get(peer.player.id) || null,
      ratingChange: ratingChanges.get(peer.player.id) || null,
      commanderProgress: commanderProgressByPlayer.get(peer.player.id) || [],
    }));
    room.sockets.forEach((peer) => {
      if (status === "disconnect" && peer.side === winnerSide) {
        send(peer, { type: "OPPONENT_DISCONNECTED", verdict: "win" });
      }
      send(peer, {
        type: "MATCH_ENDED",
        status,
        winnerSide,
        winnerPlayerId: winner?.id || null,
        players,
        my: {
          stats: resultStats.get(peer.player.id) || null,
          ratingChange: ratingChanges.get(peer.player.id) || null,
          commanderProgress: commanderProgressByPlayer.get(peer.player.id) || [],
        },
      });
      peer.roomId = null;
      peer.side = null;
    });
    rooms.delete(room.id);
  }

  async function handleResult(ws, msg) {
    const room = rooms.get(ws.roomId);
    if (!room || room.ended) return;
    room.results.set(ws.side, msg);
    if (room.results.size < 2) {
      send(ws, { type: "RESULT_RECEIVED" });
      return;
    }
    const [r0, r1] = [room.results.get(0), room.results.get(1)];
    const winnersMatch = r0.winnerSide === r1.winnerSide;
    const hash0 = r0.finalHash || "";
    const hash1 = r1.finalHash || "";
    const checksumsMatch = !hash0 || !hash1 || hash0 === hash1;
    if (!winnersMatch || !checksumsMatch) {
      await finishRoom(room, -1, "desync", hash0 || hash1 || null);
      return;
    }
    await finishRoom(room, r0.winnerSide, "normal", hash0 || hash1 || null);
  }

  async function handleDisconnect(ws) {
    removeFromQueue(ws);
    const room = rooms.get(ws.roomId);
    if (!room || room.ended) return;
    const survivor = room.sockets.find(peer => peer !== ws);
    if (db && ws.player) {
      db.query("UPDATE players SET disconnects = disconnects + 1 WHERE id = $1", [ws.player.id])
        .catch(error => console.error("[disconnect]", error));
    }
    await finishRoom(room, survivor?.side ?? -1, "disconnect");
  }

  wss.on("connection", (ws) => {
    ws.on("message", async (data) => {
      let msg;
      try {
        msg = JSON.parse(String(data));
      } catch {
        send(ws, { type: "ERROR", error: "Invalid JSON" });
        return;
      }

      try {
        if (msg.type === "AUTH") {
          if (!db) {
            send(ws, { type: "ERROR", error: "Online database is not configured" });
            ws.close();
            return;
          }
          const parsed = authSchema.parse(msg);
          const payload = verifyPlayerToken(parsed.token);
          const player = await getPlayerProfile(db, payload.sub);
          if (!player) throw new Error("Player not found");
          ws.player = player;
          send(ws, { type: "AUTH_OK", player });
          return;
        }
        if (msg.type === "JOIN_QUEUE") {
          const parsed = joinQueueSchema.parse(msg);
          await joinQueue(ws, parsed.mode);
          return;
        }
        if (msg.type === "LEAVE_QUEUE") {
          removeFromQueue(ws);
          send(ws, { type: "QUEUE_LEFT" });
          return;
        }
        if (msg.type === "LEAVE_MATCH") {
          if (!handleLeaveMatch(ws)) send(ws, { type: "ERROR", error: "Cannot leave current match" });
          return;
        }
        if (msg.type === "PLAYER_READY") {
          await handleReady(ws, readySchema.parse(msg));
          return;
        }
        if (msg.type === "INPUT") {
          await handleInput(ws, inputSchema.parse(msg));
          return;
        }
        if (msg.type === "CHECKSUM") {
          handleChecksum(ws, checksumSchema.parse(msg));
          return;
        }
        if (msg.type === "RESULT") {
          await handleResult(ws, resultSchema.parse(msg));
          return;
        }
        send(ws, { type: "ERROR", error: "Unknown message type" });
      } catch (error) {
        send(ws, { type: "ERROR", error: error.message || "Message rejected" });
      }
    });

    ws.on("close", () => {
      handleDisconnect(ws).catch(error => console.error("[ws/close]", error));
    });
  });

  return wss;
}
