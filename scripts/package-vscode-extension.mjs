#!/usr/bin/env node
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extensionDir = resolve(repoRoot, "packages/vscode-extension");
const packageJsonPath = resolve(extensionDir, "package.json");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
const outputDir = resolve(repoRoot, "build/vsix");
const outputPath = resolve(outputDir, `${packageJson.publisher}.${packageJson.name}-${packageJson.version}.vsix`);
const vsceBin = resolve(extensionDir, "node_modules/@vscode/vsce/vsce");
const nodeBin = process.env.VSCE_NODE ?? "node";

mkdirSync(outputDir, { recursive: true });

const result = spawnSync(nodeBin, [
  vsceBin,
  "package",
  "--no-dependencies",
  "--out",
  outputPath
], {
  cwd: extensionDir,
  stdio: "inherit",
  env: process.env
});

if (result.error) {
  throw result.error;
}

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log(`VSIX written to ${outputPath}`);
