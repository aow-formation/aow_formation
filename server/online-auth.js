import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import {
  getCommanderCatalog,
  getPlayerProfile,
  getPlayerRecentMatches,
  grantStarterCommanders,
  savePlayerLoadout,
} from "./online-db.js";

const usernameSchema = z.string()
  .trim()
  .min(3, "아이디는 3자 이상이어야 합니다.")
  .max(32, "아이디는 32자 이하여야 합니다.")
  .regex(/^[\p{L}\p{N}_-]+$/u, "아이디는 문자, 숫자, 밑줄, 하이픈만 사용할 수 있습니다.");

const displayNameSchema = z.preprocess(
  value => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string()
    .trim()
    .min(2, "표시명은 2자 이상이어야 합니다.")
    .max(32, "표시명은 32자 이하여야 합니다.")
    .optional(),
);

const registerSchema = z.object({
  username: usernameSchema,
  password: z.string()
    .min(6, "비밀번호는 6자 이상이어야 합니다.")
    .max(72, "비밀번호는 72자 이하여야 합니다."),
  displayName: displayNameSchema,
  emblem: z.string().trim().max(32).optional(),
});

const loginSchema = z.object({
  username: usernameSchema,
  password: z.string().min(1).max(72),
});

const loadoutSchema = z.object({
  commanders: z.array(z.object({
    slotIndex: z.number().int().min(0).max(4).optional(),
    templateId: z.string().min(1).max(32),
    troopType: z.enum(["infantry", "cavalry"]),
    troops: z.number().int().positive(),
    skillType: z.string().min(1).max(16),
  })).length(5),
});

export function jwtSecret() {
  return process.env.JWT_SECRET || "dev-only-change-me";
}

export function signPlayerToken(player) {
  return jwt.sign(
    { sub: player.id, username: player.username, displayName: player.displayName },
    jwtSecret(),
    { expiresIn: "7d" },
  );
}

export function verifyPlayerToken(token) {
  return jwt.verify(token, jwtSecret());
}

function requireDb(db, res) {
  if (db) return true;
  res.status(503).json({
    ok: false,
    error: "Online database is not configured. Set DATABASE_URL to enable multiplayer.",
  });
  return false;
}

export function authMiddleware(db) {
  return async (req, res, next) => {
    if (!requireDb(db, res)) return;
    const header = String(req.headers.authorization || "");
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) {
      res.status(401).json({ ok: false, error: "Missing token" });
      return;
    }
    try {
      const payload = verifyPlayerToken(token);
      const profile = await getPlayerProfile(db, payload.sub);
      if (!profile) {
        res.status(401).json({ ok: false, error: "Invalid token" });
        return;
      }
      req.player = profile;
      next();
    } catch {
      res.status(401).json({ ok: false, error: "Invalid token" });
    }
  };
}

export function installAuthRoutes(app, db) {
  app.post("/api/auth/register", async (req, res) => {
    if (!requireDb(db, res)) return;
    const parsed = registerSchema.safeParse(req.body || {});
    if (!parsed.success) {
      res.status(400).json({
        ok: false,
        error: parsed.error.issues[0]?.message || "Invalid registration data",
        issues: parsed.error.issues,
      });
      return;
    }
    const { username, password, emblem = "default" } = parsed.data;
    const displayName = parsed.data.displayName || username;
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const exists = await client.query("SELECT id FROM players WHERE lower(username) = lower($1)", [username]);
      if (exists.rowCount > 0) {
        await client.query("ROLLBACK");
        res.status(409).json({ ok: false, error: "Username already exists" });
        return;
      }
      const id = randomUUID();
      const passwordHash = await bcrypt.hash(password, 12);
      await client.query(
        `INSERT INTO players (id, username, password_hash, display_name, emblem)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, username, passwordHash, displayName, emblem],
      );
      await grantStarterCommanders(client, id);
      await client.query("COMMIT");
      const player = await getPlayerProfile(db, id);
      res.status(201).json({ ok: true, token: signPlayerToken(player), player });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("[auth/register]", error);
      res.status(500).json({ ok: false, error: "Registration failed" });
    } finally {
      client.release();
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    if (!requireDb(db, res)) return;
    const parsed = loginSchema.safeParse(req.body || {});
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: "Invalid login data" });
      return;
    }
    const { username, password } = parsed.data;
    try {
      const result = await db.query(
        `SELECT id, username, password_hash, display_name AS "displayName"
           FROM players
          WHERE lower(username) = lower($1)`,
        [username],
      );
      const row = result.rows[0];
      if (!row || !(await bcrypt.compare(password, row.password_hash))) {
        res.status(401).json({ ok: false, error: "Invalid username or password" });
        return;
      }
      const player = await getPlayerProfile(db, row.id);
      res.json({ ok: true, token: signPlayerToken(player), player });
    } catch (error) {
      console.error("[auth/login]", error);
      res.status(500).json({ ok: false, error: "Login failed" });
    }
  });

  app.get("/api/profile/me", authMiddleware(db), async (req, res) => {
    const recentMatches = await getPlayerRecentMatches(db, req.player.id, 10);
    res.json({ ok: true, player: req.player, recentMatches });
  });

  app.get("/api/profile/:id", async (req, res) => {
    if (!requireDb(db, res)) return;
    const player = await getPlayerProfile(db, req.params.id);
    if (!player) {
      res.status(404).json({ ok: false, error: "Player not found" });
      return;
    }
    const recentMatches = await getPlayerRecentMatches(db, req.params.id, 10);
    res.json({ ok: true, player, recentMatches });
  });

  app.get("/api/leaderboard", async (_req, res) => {
    if (!requireDb(db, res)) return;
    const result = await db.query(
      `SELECT id, display_name AS "displayName", emblem, rating, wins, losses, draws
         FROM players
        ORDER BY rating DESC, wins DESC, created_at ASC
        LIMIT 50`,
    );
    res.json({ ok: true, players: result.rows });
  });

  app.get("/api/commanders/catalog", authMiddleware(db), (_req, res) => {
    res.json({ ok: true, commanders: getCommanderCatalog() });
  });

  app.get("/api/loadout/me", authMiddleware(db), (req, res) => {
    res.json({ ok: true, commanders: req.player.commanders });
  });

  app.put("/api/loadout/me", authMiddleware(db), async (req, res) => {
    const parsed = loadoutSchema.safeParse(req.body || {});
    if (!parsed.success) {
      res.status(400).json({
        ok: false,
        error: parsed.error.issues[0]?.message || "Invalid loadout",
        issues: parsed.error.issues,
      });
      return;
    }
    try {
      await savePlayerLoadout(db, req.player.id, parsed.data.commanders);
      const player = await getPlayerProfile(db, req.player.id);
      res.json({ ok: true, player, commanders: player.commanders });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message || "Loadout save failed" });
    }
  });
}
