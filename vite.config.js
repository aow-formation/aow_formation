import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
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
  const paths = ["assets", "data", "screenshot.png"];
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

export default defineConfig({
  root: rootDir,
  publicDir: false,
  plugins: [copyRuntimeAssets(), cleanLegacyModuleCopies()],
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
