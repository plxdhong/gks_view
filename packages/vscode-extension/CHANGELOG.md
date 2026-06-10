# Changelog

## 0.1.4

### Fixed

- Kept the camera position, target, and orientation stable when switching snapshots in a multi-step GKS case.
- Scaled vertex markers and the origin coordinate axes from the current visible world range, so tiny models around 0.01 mm are no longer hidden by oversized helper graphics.
- Removed fixed lower bounds from scene fit and camera clipping calculations that made very small models behave as if they were much larger.
- Fixed development-mode snapshot loading for non-default case URLs by resolving snapshot files relative to the opened case index.
- Fixed the topology tree's Loose Entities section so parented vertices are not duplicated there.

### Verification

- Built the extension and webview with Bun.
- Validated mock GKS artifacts.
- Verified tiny-model rendering and snapshot switching in the in-app browser.
- Verified the default HoleGrow case still switches snapshots without browser console errors.

## 0.1.3

- Fixed the release packaging workflow so release-branch version checks can read the previous release commit.

## 0.1.2

- Added collapsible and resizable left/right workbench panels.
- Added topology-tree collapse, reveal, and visibility controls.
- Added marketplace metadata, icon, README, and packaging information.

## 0.1.1

- Added VSCode extension packaging workflow and release branch checks.
- Fixed workspace dependency resolution for CI builds.

## 0.1.0

- Initial preview of the Geometry Kernel Workbench VS Code extension.
- Added GKS custom editors, Three.js rendering, topology and properties panels, compare view, and mock adapter flow.
