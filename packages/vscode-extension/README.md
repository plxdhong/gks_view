# Geometry Kernel Workbench

Geometry Kernel Workbench opens GKS geometry snapshots directly in VS Code. It is built for geometry-kernel development, GTest debugging, topology inspection, and cross-kernel comparison.

## Highlights

- Open `.gkcase.json`, `.gkscene.json`, and `.gkcompare.json` files with a custom visual editor.
- Open `.gkrun.json` test-run indexes and switch between many generated cases in one workbench.
- Inspect B-Rep topology as a collapsible tree: body, region, shell, face, loop, coedge, edge, and vertex.
- Select entities from the model or tree and inspect identity, kernel tags, stable IDs, debug data, and properties.
- Hide or show topology-tree entities to isolate complex model regions.
- Jump from the Properties panel back to the matching topology-tree entity.
- Switch between perspective and orthographic cameras.
- View points, wireframe, bodies, all geometry, or translucent projection mode.
- Compare multiple snapshots or kernels in split views.
- Use debug highlight groups to color different faces, edges, or vertices independently.
- Use a mock JSON-RPC adapter flow for native-wrapper and command integration development.

## Supported Files

| File | Purpose |
| --- | --- |
| `.gkcase.json` | Snapshot timeline for a debug case or GTest session. |
| `.gkscene.json` | Single geometry snapshot with topology, tessellation, and properties. |
| `.gkcompare.json` | Multi-scene or multi-kernel comparison entry point. |
| `.gkrun.json` | Test-run index that references many `.gkcase.json` files. |

## Test Run Auto Open

For low-friction GTest workflows, write a run index at:

```text
.gk-workbench/runs/<run-id>/run.gkrun.json
```

The extension watches this path pattern, opens the run workbench automatically, and refreshes an already open run panel when the index changes.

Minimal run index:

```json
{
  "gksVersion": "0.1",
  "runId": "local-debug-001",
  "title": "Local Debug Run",
  "cases": [
    {
      "caseId": "HoleGrow.Case_001",
      "file": "HoleGrow.Case_001/index.gkcase.json",
      "status": "failed"
    }
  ]
}
```

## Intended Use

This extension is not a general CAD editor. It is a developer workbench for intermediate geometry artifacts, kernel-wrapper validation, algorithm debugging, and CI failure inspection.

Typical workflow:

1. Dump a GKS scene or case from a kernel wrapper or test.
2. Open the artifact in VS Code.
3. Inspect topology, discrete geometry, properties, debug annotations, and compare views.
4. Use entity IDs when reporting issues or connecting Adapter Protocol commands.

## Notes

- Geometry data is read-only in the viewer.
- Native kernel integration is routed through the VS Code extension host and Adapter Protocol.
- The webview does not directly access the local filesystem or start native processes.

## Status

The extension is in preview while the GKS format, mock adapter, OCC example wrapper, and future native-wrapper flows evolve together.
