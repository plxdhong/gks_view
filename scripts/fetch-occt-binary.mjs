import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defaultOcctTag, findOcctConfigDir, occtLayout } from "./occt-local.mjs";

const root = process.cwd();
const args = process.argv.slice(2);
const shouldForce = args.includes("--force");
const binarySource = process.env.OCCT_BINARY_ARCHIVE
  ?? process.env.OCCT_BINARY_URL
  ?? args.find((arg) => !arg.startsWith("--"));
const layout = occtLayout(root, defaultOcctTag);
const archiveDir = path.join(layout.baseDir, "archives");
const stagingDir = path.join(layout.baseDir, "prebuilt", layout.tag);

if (!binarySource) {
  console.error("Missing OCCT binary package URL.");
  console.error("Set OCCT_BINARY_URL, set OCCT_BINARY_ARCHIVE, or pass a URL/local archive as the first argument:");
  console.error("  OCCT_BINARY_URL=https://github.com/.../download/.../occt-prebuilt.tar.gz bun run occ:fetch-binary");
  console.error("  bun run occ:fetch-binary third_party/occt/archives/occt-macos-arm64-modeling-only.zip");
  process.exit(1);
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    stdio: "inherit",
    ...options
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function runOptional(command, commandArgs) {
  spawnSync(command, commandArgs, {
    cwd: root,
    stdio: "ignore"
  });
}

function parseSource(source) {
  try {
    const parsed = new URL(source);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return { type: "remote", url: source, archivePath: path.join(archiveDir, safeArchiveName(parsed.pathname)) };
    }
    if (parsed.protocol === "file:") {
      return { type: "local", archivePath: fileURLToPath(parsed) };
    }
  } catch {
    // Plain filesystem path.
  }

  return { type: "local", archivePath: path.resolve(root, source) };
}

function safeArchiveName(sourcePath) {
  const fileName = path.basename(sourcePath) || `OCCT-${layout.tag}-prebuilt.tar.gz`;
  return fileName.replace(/[^A-Za-z0-9._+-]/g, "_");
}

function isArchiveFile(archivePath) {
  return /\.(zip|tar|tar\.gz|tgz|tar\.xz|txz|tar\.bz2|tbz2)$/i.test(archivePath);
}

function extractArchive(archivePath, destination) {
  if (/\.zip$/i.test(archivePath)) {
    run("unzip", ["-q", archivePath, "-d", destination]);
    return;
  }

  if (/\.(tar|tar\.gz|tgz|tar\.xz|txz|tar\.bz2|tbz2)$/i.test(archivePath)) {
    run("tar", ["-xf", archivePath, "-C", destination]);
    return;
  }

  console.error(`Unsupported OCCT binary archive type: ${archivePath}`);
  console.error("Supported suffixes: .zip, .tar, .tar.gz, .tgz, .tar.xz, .txz, .tar.bz2, .tbz2");
  process.exit(1);
}

function findArchives(startDir, maxDepth = 4, depth = 0) {
  if (!existsSync(startDir) || depth > maxDepth) {
    return [];
  }

  let entries = [];
  try {
    entries = readdirSync(startDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const archives = [];
  for (const entry of entries) {
    const entryPath = path.join(startDir, entry.name);
    if (entry.isFile() && isArchiveFile(entryPath)) {
      archives.push(entryPath);
    }
    if (entry.isDirectory()) {
      archives.push(...findArchives(entryPath, maxDepth, depth + 1));
    }
  }
  return archives;
}

function extractNestedArchives(destination) {
  for (let pass = 0; pass < 3; pass += 1) {
    const nestedArchives = findArchives(destination);
    if (nestedArchives.length === 0) {
      return;
    }

    for (const nestedArchive of nestedArchives) {
      console.log(`Extracting nested archive ${nestedArchive}`);
      extractArchive(nestedArchive, path.dirname(nestedArchive));
      rmSync(nestedArchive, { force: true });
    }
  }
}


function listDirectories(startDir, maxDepth = 5, depth = 0) {
  if (!existsSync(startDir) || depth > maxDepth) {
    return [];
  }

  const dirs = [startDir];
  let entries = [];
  try {
    entries = readdirSync(startDir, { withFileTypes: true });
  } catch {
    return dirs;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    dirs.push(...listDirectories(path.join(startDir, entry.name), maxDepth, depth + 1));
  }

  return dirs;
}

function fileExists(rootDir, relativePath) {
  return existsSync(path.join(rootDir, relativePath));
}

function hasOcctHeaders(candidate) {
  return [
    "include/opencascade/TopoDS_Shape.hxx",
    "include/TopoDS_Shape.hxx",
    "inc/TopoDS_Shape.hxx"
  ].some((relativePath) => fileExists(candidate, relativePath));
}

function findFile(startDir, predicate, maxDepth = 6, depth = 0) {
  if (!existsSync(startDir) || depth > maxDepth) {
    return null;
  }

  let entries = [];
  try {
    entries = readdirSync(startDir, { withFileTypes: true });
  } catch {
    return null;
  }

  for (const entry of entries) {
    const entryPath = path.join(startDir, entry.name);
    if (entry.isFile() && predicate(entry.name, entryPath)) {
      return entryPath;
    }
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const entryPath = path.join(startDir, entry.name);
    try {
      if (!statSync(entryPath).isDirectory()) {
        continue;
      }
    } catch {
      continue;
    }

    const found = findFile(entryPath, predicate, maxDepth, depth + 1);
    if (found) {
      return found;
    }
  }

  return null;
}

function isOcctLibraryFile(fileName) {
  return /^(lib)?(TKernel|TKMath|TKG2d|TKG3d|TKGeomBase|TKGeomAlgo|TKBRep|TKTopAlgo|TKPrim|TKBool|TKMesh)(\.(dylib|so|a|lib|dll)|\.[0-9].*)$/i.test(fileName);
}

function hasOcctLibraries(candidate) {
  return Boolean(findFile(candidate, (fileName) => isOcctLibraryFile(fileName), 6));
}

function hasPlatformLibrary(candidate) {
  if (process.platform === "darwin") {
    return Boolean(findFile(candidate, (fileName) => /\.(dylib|a)$/i.test(fileName) && isOcctLibraryFile(fileName), 6));
  }
  if (process.platform === "win32") {
    return Boolean(findFile(candidate, (fileName) => /\.(lib|dll)$/i.test(fileName) && isOcctLibraryFile(fileName), 6));
  }
  return Boolean(findFile(candidate, (fileName) => /\.(so|a)$/i.test(fileName) && isOcctLibraryFile(fileName), 6));
}

function scoreInstallPrefix(candidate) {
  let score = 0;
  if (hasOcctHeaders(candidate)) {
    score += 5;
  }
  if (hasOcctLibraries(candidate)) {
    score += 5;
  }
  if (findOcctConfigDir(candidate)) {
    score += 4;
  }
  if (hasPlatformLibrary(candidate)) {
    score += 2;
  }
  return score;
}

function findInstallPrefix(extractRoot) {
  const candidates = listDirectories(extractRoot)
    .map((dir) => ({
      dir,
      hasHeaders: hasOcctHeaders(dir),
      hasLibraries: hasOcctLibraries(dir),
      score: scoreInstallPrefix(dir)
    }))
    .filter((candidate) => candidate.hasHeaders && candidate.hasLibraries)
    .sort((left, right) => right.score - left.score || left.dir.length - right.dir.length);

  return candidates[0]?.dir ?? null;
}

const source = parseSource(binarySource);
const archivePath = source.archivePath;

mkdirSync(archiveDir, { recursive: true });
mkdirSync(path.dirname(layout.installDir), { recursive: true });
mkdirSync(path.dirname(stagingDir), { recursive: true });

if (existsSync(layout.installDir) && !shouldForce) {
  console.log(`Local OCCT install prefix already exists: ${layout.installDir}`);
  console.log("Use `bun run occ:example`, or rerun with --force to replace it with this binary package.");
  process.exit(0);
}

if (source.type === "remote" && (!existsSync(archivePath) || shouldForce)) {
  console.log(`Downloading OCCT binary package for ${layout.tag}`);
  console.log(source.url);
  run("curl", ["-L", "--fail", "--retry", "3", "--output", archivePath, source.url]);
} else if (source.type === "local") {
  if (!existsSync(archivePath)) {
    console.error(`Local OCCT binary archive not found: ${archivePath}`);
    process.exit(1);
  }
  console.log(`Using local binary archive ${archivePath}`);
} else {
  console.log(`Using existing binary archive ${archivePath}`);
}

rmSync(stagingDir, { recursive: true, force: true });
mkdirSync(stagingDir, { recursive: true });
extractArchive(archivePath, stagingDir);
extractNestedArchives(stagingDir);

const installPrefix = findInstallPrefix(stagingDir);
if (!installPrefix) {
  console.error("Could not find an OCCT install prefix inside the extracted binary package.");
  console.error("Expected headers such as TopoDS_Shape.hxx and libraries such as TKernel/TKBRep.");
  process.exit(1);
}

rmSync(layout.installDir, { recursive: true, force: true });
cpSync(installPrefix, layout.installDir, { recursive: true, force: true });

if (process.platform === "darwin") {
  runOptional("xattr", ["-cr", layout.installDir]);
}

const configDir = findOcctConfigDir(layout.installDir);
console.log(`Installed OCCT binary package to ${layout.installDir}`);
if (configDir) {
  console.log(`Found CMake package config: ${configDir}`);
} else {
  console.log("No OpenCASCADEConfig.cmake or OCCTConfig.cmake found in the package.");
  console.log("If configure fails, set OpenCASCADE_DIR to the package's CMake config directory.");
}

if (!hasPlatformLibrary(layout.installDir)) {
  console.log("Warning: the package does not appear to contain libraries for this platform.");
  console.log(`Current platform is ${process.platform}/${process.arch}; use a matching OCCT binary package.`);
}

console.log("Run `bun run occ:example` to build and run the OCC wrapper example.");
