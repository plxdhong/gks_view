import { existsSync, mkdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { occtLayout, defaultOcctTag } from "./occt-local.mjs";

const shouldBuild = process.argv.includes("--build");
const shouldForce = process.argv.includes("--force");
const root = process.cwd();
const layout = occtLayout(root, defaultOcctTag);
const archiveUrl = `https://github.com/Open-Cascade-SAS/OCCT/archive/refs/tags/${layout.tag}.tar.gz`;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    ...options
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

mkdirSync(layout.baseDir, { recursive: true });
mkdirSync(`${layout.baseDir}/archives`, { recursive: true });
mkdirSync(`${layout.baseDir}/src`, { recursive: true });

if (shouldForce && existsSync(layout.sourceDir)) {
  rmSync(layout.sourceDir, { recursive: true, force: true });
}

if (!existsSync(layout.archivePath) || shouldForce) {
  console.log(`Downloading OCCT ${layout.tag} from GitHub release source archive`);
  console.log(archiveUrl);
  run("curl", ["-L", "--fail", "--retry", "3", "--output", layout.archivePath, archiveUrl]);
} else {
  console.log(`Using existing archive ${layout.archivePath}`);
}

if (!existsSync(layout.sourceDir)) {
  mkdirSync(layout.sourceDir, { recursive: true });
  run("tar", ["-xzf", layout.archivePath, "--strip-components", "1", "-C", layout.sourceDir]);
  console.log(`Extracted OCCT ${layout.tag} to ${layout.sourceDir}`);
} else {
  console.log(`Using existing source ${layout.sourceDir}`);
}

if (!shouldBuild) {
  console.log("Fetch complete. Run `bun run occ:build-release` to build and install OCCT locally.");
  process.exit(0);
}

mkdirSync(layout.buildDir, { recursive: true });
run("cmake", [
  "-S", layout.sourceDir,
  "-B", layout.buildDir,
  `-DCMAKE_INSTALL_PREFIX=${layout.installDir}`,
  "-DCMAKE_BUILD_TYPE=Release",
  "-DBUILD_LIBRARY_TYPE=Shared",
  "-DBUILD_MODULE_ApplicationFramework=OFF",
  "-DBUILD_MODULE_DataExchange=OFF",
  "-DBUILD_MODULE_Draw=OFF",
  "-DBUILD_MODULE_Visualization=OFF",
  "-DUSE_FREETYPE=OFF",
  "-DUSE_FREEIMAGE=OFF",
  "-DUSE_TBB=OFF",
  "-DUSE_TCL=OFF",
  "-DUSE_TK=OFF",
  "-DBUILD_USE_PCH=OFF"
]);
run("cmake", ["--build", layout.buildDir, "--parallel"]);
run("cmake", ["--install", layout.buildDir]);
console.log(`Installed OCCT ${layout.tag} to ${layout.installDir}`);
