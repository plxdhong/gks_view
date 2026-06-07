import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { occtLayout, withLocalOcctEnv } from "./occt-local.mjs";

const root = process.cwd();
const executable = path.join(root, "build/occ-wrapper/gk_occ_example");
const outputDir = path.join(root, "examples/occ/OCCBox.Case_001");
const layout = occtLayout(root);
const env = withLocalOcctEnv(process.env, root, layout.tag);

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    stdio: "inherit"
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (existsSync(layout.installDir)) {
  console.log(`Using local OCCT install prefix: ${layout.installDir}`);
} else {
  console.log(`Local OCCT install prefix not found yet: ${layout.installDir}`);
}

run("cmake", ["-S", "packages/occ-wrapper", "-B", "build/occ-wrapper"]);
run("cmake", ["--build", "build/occ-wrapper"]);

if (!existsSync(executable)) {
  console.error("gk_occ_example was not built because CMake could not find OpenCASCADE/OCCT.");
  console.error("Run `bun run occ:fetch-binary`, `bun run occ:build-release`, or set OpenCASCADE_DIR/CMAKE_PREFIX_PATH, then run this command again.");
  process.exit(1);
}

run(executable, ["--out", outputDir]);
run("bun", ["scripts/validate-mocks.mjs", "examples/occ"]);
