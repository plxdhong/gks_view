import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { occtLayout, withLocalOcctEnv } from "./occt-local.mjs";

const root = process.cwd();
const layout = occtLayout(root);
const env = withLocalOcctEnv(process.env, root, layout.tag);

if (existsSync(layout.installDir)) {
  console.log(`Using local OCCT install prefix: ${layout.installDir}`);
} else {
  console.log(`Local OCCT install prefix not found yet: ${layout.installDir}`);
  console.log("Run `bun run occ:fetch-binary`, `bun run occ:build-release`, or set OpenCASCADE_DIR/CMAKE_PREFIX_PATH.");
}

const result = spawnSync("cmake", ["-S", "packages/occ-wrapper", "-B", "build/occ-wrapper"], {
  cwd: root,
  env,
  stdio: "inherit"
});

process.exit(result.status ?? 1);
