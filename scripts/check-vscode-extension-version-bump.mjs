#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const packagePath = "packages/vscode-extension/package.json";
const baseRef = process.argv[2] ?? process.env.BASE_REF;

if (!baseRef) {
  console.error("Usage: bun scripts/check-vscode-extension-version-bump.mjs <base-ref>");
  process.exit(2);
}

const currentPackageJson = JSON.parse(readFileSync(resolve(packagePath), "utf8"));
const basePackageJson = readBasePackageJson(baseRef);
const currentVersion = currentPackageJson.version;
const baseVersion = basePackageJson.version;

const comparison = compareSemver(currentVersion, baseVersion);
if (comparison <= 0) {
  console.error(
    `VSCode extension version must be increased before merging to release: ` +
    `${baseVersion} -> ${currentVersion}`
  );
  process.exit(1);
}

console.log(`VSCode extension version bump accepted: ${baseVersion} -> ${currentVersion}`);

function readBasePackageJson(ref) {
  const result = spawnSync("git", ["show", `${ref}:${packagePath}`], {
    encoding: "utf8"
  });
  if (result.status !== 0) {
    console.error(result.stderr.trim() || `Unable to read ${packagePath} from ${ref}`);
    process.exit(result.status ?? 1);
  }
  return JSON.parse(result.stdout);
}

function compareSemver(current, base) {
  const parsedCurrent = parseSemver(current);
  const parsedBase = parseSemver(base);

  for (const key of ["major", "minor", "patch"]) {
    if (parsedCurrent[key] !== parsedBase[key]) {
      return parsedCurrent[key] - parsedBase[key];
    }
  }

  return comparePrerelease(parsedCurrent.prerelease, parsedBase.prerelease);
}

function parseSemver(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(version);
  if (!match) {
    console.error(`Invalid semantic version in ${packagePath}: ${version}`);
    process.exit(1);
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? ""
  };
}

function comparePrerelease(current, base) {
  if (current === base) {
    return 0;
  }
  if (!current) {
    return 1;
  }
  if (!base) {
    return -1;
  }

  const currentParts = current.split(".");
  const baseParts = base.split(".");
  const length = Math.max(currentParts.length, baseParts.length);
  for (let index = 0; index < length; index += 1) {
    const currentPart = currentParts[index];
    const basePart = baseParts[index];
    if (currentPart === undefined) {
      return -1;
    }
    if (basePart === undefined) {
      return 1;
    }
    if (currentPart === basePart) {
      continue;
    }

    const currentNumber = /^\d+$/.test(currentPart) ? Number(currentPart) : undefined;
    const baseNumber = /^\d+$/.test(basePart) ? Number(basePart) : undefined;
    if (currentNumber !== undefined && baseNumber !== undefined) {
      return currentNumber - baseNumber;
    }
    if (currentNumber !== undefined) {
      return -1;
    }
    if (baseNumber !== undefined) {
      return 1;
    }
    return currentPart.localeCompare(basePart);
  }
  return 0;
}
