import express from "express";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const distDir = join(projectRoot, "dist");
const scenarioDir = join(projectRoot, "web", "data", "scenarios");
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

app.listen(port, () => {
  console.log(`Age of War server listening on http://localhost:${port}`);
});
