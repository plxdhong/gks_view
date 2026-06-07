import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

export const defaultOcctTag = process.env.OCCT_TAG ?? "V8_0_0";

export function occtLayout(root = process.cwd(), tag = defaultOcctTag) {
  const baseDir = path.join(root, "third_party/occt");
  return {
    tag,
    baseDir,
    archivePath: path.join(baseDir, "archives", `OCCT-${tag}.tar.gz`),
    sourceDir: path.join(baseDir, "src", tag),
    buildDir: path.join(root, "build/occt", tag),
    installDir: path.join(baseDir, "install", tag)
  };
}

export function withLocalOcctEnv(env = process.env, root = process.cwd(), tag = defaultOcctTag) {
  const { installDir } = occtLayout(root, tag);
  const configDir = findOcctConfigDir(installDir);
  const existingPrefix = env.CMAKE_PREFIX_PATH;
  const nextEnv = {
    ...env,
    CMAKE_PREFIX_PATH: existingPrefix ? `${installDir}${path.delimiter}${existingPrefix}` : installDir
  };

  if (configDir && !nextEnv.OpenCASCADE_DIR) {
    nextEnv.OpenCASCADE_DIR = configDir;
  }
  if (configDir && !nextEnv.OCCT_DIR) {
    nextEnv.OCCT_DIR = configDir;
  }

  return nextEnv;
}

export function findOcctConfigDir(prefix, maxDepth = 6) {
  const configFile = findFirstFile(
    prefix,
    (fileName) => fileName === "OpenCASCADEConfig.cmake" || fileName === "OCCTConfig.cmake",
    maxDepth
  );
  return configFile ? path.dirname(configFile) : null;
}

function findFirstFile(root, predicate, maxDepth, depth = 0) {
  if (!existsSync(root) || depth > maxDepth) {
    return null;
  }

  let entries = [];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return null;
  }

  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isFile() && predicate(entry.name, entryPath)) {
      return entryPath;
    }
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const entryPath = path.join(root, entry.name);
    try {
      const stats = statSync(entryPath);
      if (!stats.isDirectory()) {
        continue;
      }
    } catch {
      continue;
    }

    const found = findFirstFile(entryPath, predicate, maxDepth, depth + 1);
    if (found) {
      return found;
    }
  }

  return null;
}
