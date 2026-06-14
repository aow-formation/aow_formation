import express from "express";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { installAuthRoutes } from "./online-auth.js";
import { createDb, ensureOnlineSchema } from "./online-db.js";
import { installMultiplayerServer } from "./online-multiplayer.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const distDir = join(projectRoot, "dist");
const scenarioDir = join(projectRoot, "web", "data", "scenarios");
const port = Number(process.env.PORT || 3000);

const app = express();
const server = createServer(app);
const db = createDb();

// Railway/Cloudflare 등 리버스 프록시 신뢰 (req.ip, req.secure 정상 동작)
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

// 보안 헤더
app.use((_req, res, next) => {
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});

// 인증 엔드포인트 rate limiting (브루트포스 방지)
const loginAttempts = new Map();
function authRateLimit(maxPerWindow, windowMs) {
  return (req, res, next) => {
    const key = req.ip || "unknown";
    const now = Date.now();
    const entry = loginAttempts.get(key) || { count: 0, resetAt: now + windowMs };
    if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + windowMs; }
    entry.count += 1;
    loginAttempts.set(key, entry);
    if (entry.count > maxPerWindow) {
      res.status(429).json({ ok: false, error: "너무 많은 요청입니다. 잠시 후 다시 시도하세요." });
      return;
    }
    next();
  };
}
// 15분에 로그인 20회, 1시간에 회원가입 5회 제한
app.use("/api/auth/login", authRateLimit(20, 15 * 60 * 1000));
app.use("/api/auth/register", authRateLimit(5, 60 * 60 * 1000));

if (db) {
  try {
    await ensureOnlineSchema(db);
    console.log(`[online] ${db.mode || "postgres"} online store ready`);
  } catch (error) {
    console.error("[online] store initialization failed:", error);
  }
} else {
  console.warn("[online] DATABASE_URL is not set. Multiplayer auth and records are disabled.");
}

installAuthRoutes(app, db);
installMultiplayerServer({ server, db });

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, onlineDb: Boolean(db), onlineDbMode: db?.mode || null });
});

app.get("/api/version", (_req, res) => {
  res.json({
    name: "age-of-war",
    version: "0.1.0",
    renderer: "canvas",
  });
});

app.post("/api/editor/save-scenario-file", (req, res) => {
  try {
    const filename = String(req.body?.filename || "");
    if (!/^[a-z0-9_-]+(?:_terrain)?\.json$/i.test(filename)) {
      throw new Error("Invalid filename");
    }
    mkdirSync(scenarioDir, { recursive: true });
    writeFileSync(join(scenarioDir, filename), `${JSON.stringify(req.body.data, null, 2)}\n`, "utf8");
    res.json({ ok: true, filename });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

if (existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get("*", (_req, res) => {
    res.sendFile(join(distDir, "index.html"));
  });
} else {
  app.get("*", (_req, res) => {
    res.status(503).json({
      ok: false,
      error: "Build output not found. Run npm run build first.",
    });
  });
}

// rate limit 맵 주기 정리 (메모리 누수 방지)
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of loginAttempts.entries()) {
    if (now > entry.resetAt) loginAttempts.delete(key);
  }
}, 5 * 60 * 1000);

server.listen(port, () => {
  console.log(`Age of War server listening on http://localhost:${port}`);
});
