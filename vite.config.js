import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { defineConfig } from "vite";

const rootDir = resolve("web");
const outDir = resolve("dist");

function copyPath(from, to) {
  if (!existsSync(from)) return;
  const stat = statSync(from);
  if (stat.isDirectory()) {
    cpSync(from, to, { recursive: true });
    return;
  }
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
}

function copyRuntimeAssets() {
  const paths = ["assets", "data", "screenshot.png", "terrain-json-viewer.html"];
  return {
    name: "copy-runtime-assets",
    closeBundle() {
      for (const item of paths) {
        copyPath(join(rootDir, item), join(outDir, item));
      }
    },
  };
}

function cleanLegacyModuleCopies() {
  const legacyModules = ["game-logic.js", "renderer.js", "input.js", "main.js"];
  return {
    name: "clean-legacy-module-copies",
    closeBundle() {
      for (const file of legacyModules) {
        const target = join(outDir, file);
        if (existsSync(target)) rmSync(target, { force: true });
      }
    },
  };
}

function editorSaveApi() {
  const scenarioDir = join(rootDir, "data", "scenarios");
  return {
    name: "editor-save-api",
    configureServer(server) {
      server.middlewares.use("/api/editor/save-scenario-file", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end(JSON.stringify({ ok: false, error: "Method not allowed" }));
          return;
        }

        let body = "";
        req.on("data", (chunk) => {
          body += chunk;
          if (body.length > 8 * 1024 * 1024) req.destroy();
        });
        req.on("end", () => {
          try {
            const payload = JSON.parse(body || "{}");
            const filename = String(payload.filename || "");
            if (!/^[a-z0-9_-]+(?:_terrain)?\.json$/i.test(filename)) {
              throw new Error("Invalid filename");
            }
            mkdirSync(scenarioDir, { recursive: true });
            writeFileSync(join(scenarioDir, filename), `${JSON.stringify(payload.data, null, 2)}\n`, "utf8");
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ ok: true, filename }));
          } catch (error) {
            res.statusCode = 400;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ ok: false, error: error.message }));
          }
        });
      });
    },
  };
}

export default defineConfig({
  root: rootDir,
  publicDir: false,
  plugins: [editorSaveApi(), copyRuntimeAssets(), cleanLegacyModuleCopies()],
  build: {
    outDir,
    emptyOutDir: true,
  },
  server: {
    host: "0.0.0.0",
    port: 3000,
  },
  preview: {
    host: "0.0.0.0",
  },
});
