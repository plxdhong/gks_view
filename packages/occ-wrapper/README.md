# OCC Native Wrapper V0.4.1

This package is the first OCC/OpenCascade native wrapper slice for Geometry
Kernel Workbench.

V0.4.1 intentionally starts with a file snapshot example instead of a live
adapter process:

1. Use a platform-matching prebuilt OCCT release asset, or download OCCT from
   the official GitHub release source archive.
2. Build an OCC model in C++.
3. Traverse OCC topology into GKS identity buckets.
4. Tessellate faces and sample edges.
5. Write `.gkcase.json` and `.gkscene.json` files for the Viewer.

## Build

If a GitHub release contains a prebuilt OCCT package for your local OS, CPU
architecture, and compiler ABI, install it directly:

```sh
OCCT_BINARY_URL="https://github.com/.../download/.../occt-prebuilt.tar.gz" bun run occ:fetch-binary
```

Or install from a local archive already placed under `third_party/occt/archives`:

```sh
bun run occ:fetch-binary third_party/occt/archives/occt-macos-arm64-modeling-only.zip
```

Do not mix platform binaries. For example, a Windows Visual Studio OCCT package
cannot be linked by the macOS wrapper.

Fetch the default OCCT release tag:

```sh
bun run occ:fetch
```

Build and install that local OCCT copy:

```sh
bun run occ:build-release
```

By default the scripts use tag `V8_0_0`. Override it with `OCCT_TAG=...`.
If you already have OCC installed elsewhere, set `OpenCASCADE_DIR` or
`CMAKE_PREFIX_PATH`.

## Run Example

```sh
bun run occ:example
```

Then view it in dev webview:

```txt
http://127.0.0.1:5173/?case=occ/OCCBox.Case_001/index.gkcase.json
```

## Scope

- This package does not put OCC into the webview.
- Entity IDs are stable only within the generated session.
- The region is synthetic because OCC topology does not expose a PK-like region
  layer.
- Live JSON-RPC adapter support is intentionally left for a later V0.4 step.
