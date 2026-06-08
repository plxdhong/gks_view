# Geometry Kernel Workbench

VSCode Geometry Kernel Workbench is a viewer and debug workbench for geometry
kernel snapshots. The implementation starts with GKS files, read-only
rendering, topology inspection, properties, snapshot timelines, compare views,
and native-wrapper examples.

## Current Shape

- `packages/gks-schema`: shared TypeScript types and JSON Schema documents.
- `packages/vscode-extension`: VSCode custom editor and Three.js webview.
- `packages/vscode-extension/src/mockAdapter`: stdio JSON-RPC mock adapter.
- `packages/native-common`: empty C++ common library scaffold for later wrapper
  work.
- `packages/occ-wrapper`: V0.4.1 OCC/OpenCascade native example wrapper
  scaffold. It can use a platform-matching prebuilt OCCT release asset or
  build OCCT from the official GitHub release source archive, build an OCC
  model, and dump GKS files.
- `examples/mock`: generated mock `.gkcase.json`, `.gkscene.json`, and
  `.gkcompare.json` files.

## Quick Start

```sh
bun install
bun run generate:mocks
bun run validate:mocks
bun run build
bun run verify:adapter
```

For webview UI development:

```sh
bun run dev:webview
```

Then open the printed local URL in a browser.

Useful development URLs:

- `http://127.0.0.1:5173/` opens the HoleGrow timeline mock.
- `http://127.0.0.1:5173/?compare=1` opens the split compare mock.
- `http://127.0.0.1:5173/?case=occ/OCCBox.Case_001/index.gkcase.json`
  opens the generated OCC example after `bun run occ:example`.

Useful mock artifacts:

- `examples/mock/Cube.Case_001/index.gkcase.json`
- `examples/mock/CylinderHole.Case_001/index.gkcase.json`
- `examples/mock/HoleGrow.Case_001/index.gkcase.json`
- `examples/mock/SplitCompare.Case_001/split.gkcompare.json`

## VSCode Extension CI and Release Branch

GitHub Actions build the extension on pushes to `main` and pull requests to
`main` or `release`.

The `release` branch is the packaging branch. Pull requests targeting
`release` must increase `packages/vscode-extension/package.json`'s `version`
field. After a change lands on `release`, GitHub Actions packages a VSIX and
uploads it as a workflow artifact.

Local packaging uses the same command:

```sh
bun run package:vscode
```

The VSIX is written under `build/vsix/`.

## Adapter Flow

The VSCode command `Geometry: Attach Kernel Adapter` starts the built-in mock
adapter over stdio, calls:

```txt
adapter.initialize -> adapter.getManifest -> model.open -> model.getScene
```

The webview then requests `entity.getProperties` when an entity is selected.

## OCC V0.4.1 Example

If the GitHub release provides a prebuilt OCCT package matching your local OS,
CPU architecture, and compiler ABI, install it directly:

```sh
OCCT_BINARY_URL="https://github.com/.../download/.../occt-prebuilt.tar.gz" bun run occ:fetch-binary
```

Or install from a local archive already placed under `third_party/occt/archives`:

```sh
bun run occ:fetch-binary third_party/occt/archives/occt-macos-arm64-modeling-only.zip
```

Then run the example:

```sh
bun run occ:example
```

Do not mix platform binaries. For example, a Windows Visual Studio OCCT package
cannot be linked by the macOS wrapper.

Download OCCT from the official GitHub release archive:

```sh
bun run occ:fetch
```

Build and install that local OCCT copy under `third_party/occt/install`:

```sh
bun run occ:build-release
```

Build the wrapper example, run OCC modeling, and validate the generated GKS:

```sh
bun run occ:example
```

By default the scripts use tag `V8_0_0`. Override it with `OCCT_TAG=...`.
If you already have OCC installed elsewhere, set `OpenCASCADE_DIR` or
`CMAKE_PREFIX_PATH` instead.
