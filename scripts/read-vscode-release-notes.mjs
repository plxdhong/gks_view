#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const version = process.argv[2];
if (!version) {
  console.error("Usage: bun scripts/read-vscode-release-notes.mjs <version>");
  process.exit(2);
}

const changelog = readFileSync(resolve("packages/vscode-extension/CHANGELOG.md"), "utf8");
const notes = releaseNotesForVersion(changelog, version);
if (!notes) {
  console.error(`Missing release notes section in packages/vscode-extension/CHANGELOG.md for ${version}`);
  process.exit(1);
}

process.stdout.write(notes);

function releaseNotesForVersion(changelogText, targetVersion) {
  const lines = changelogText.split(/\r?\n/);
  let collecting = false;
  const section = [];

  for (const line of lines) {
    if (/^##\s+/.test(line)) {
      if (collecting) {
        break;
      }
      collecting = line.replace(/^##\s+/, "").trim() === targetVersion;
      continue;
    }
    if (collecting) {
      section.push(line);
    }
  }

  const notes = section.join("\n").trim();
  return notes.includes("- ") ? notes : "";
}
