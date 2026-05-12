import express from "express";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const distDir = join(projectRoot, "dist");
const port = Number(process.env.PORT || 3000);

const app = express();

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/version", (_req, res) => {
  res.json({
    name: "age-of-war",
    version: "0.1.0",
    renderer: "canvas",
  });
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

app.listen(port, () => {
  console.log(`Age of War server listening on http://localhost:${port}`);
});
