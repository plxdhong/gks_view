import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const mockRoot = path.join(root, "examples/mock");

const cubeVertices = {
  "vertex:001": [-1, -1, -1],
  "vertex:002": [1, -1, -1],
  "vertex:003": [1, 1, -1],
  "vertex:004": [-1, 1, -1],
  "vertex:005": [-1, -1, 1],
  "vertex:006": [1, -1, 1],
  "vertex:007": [1, 1, 1],
  "vertex:008": [-1, 1, 1]
};

const cubeFaceDefs = [
  ["face:front", "Front", ["vertex:001", "vertex:002", "vertex:006", "vertex:005"], "plane", [0, -1, 0]],
  ["face:right", "Right", ["vertex:002", "vertex:003", "vertex:007", "vertex:006"], "plane", [1, 0, 0]],
  ["face:back", "Back", ["vertex:003", "vertex:004", "vertex:008", "vertex:007"], "plane", [0, 1, 0]],
  ["face:left", "Left", ["vertex:004", "vertex:001", "vertex:005", "vertex:008"], "plane", [-1, 0, 0]],
  ["face:bottom", "Bottom", ["vertex:001", "vertex:004", "vertex:003", "vertex:002"], "plane", [0, 0, -1]],
  ["face:top", "Top", ["vertex:005", "vertex:006", "vertex:007", "vertex:008"], "plane", [0, 0, 1]]
];

const cubeEdgeDefs = [
  ["edge:001", ["vertex:001", "vertex:002"], ["face:front", "face:bottom"]],
  ["edge:002", ["vertex:002", "vertex:003"], ["face:right", "face:bottom"]],
  ["edge:003", ["vertex:003", "vertex:004"], ["face:back", "face:bottom"]],
  ["edge:004", ["vertex:004", "vertex:001"], ["face:left", "face:bottom"]],
  ["edge:005", ["vertex:005", "vertex:006"], ["face:front", "face:top"]],
  ["edge:006", ["vertex:006", "vertex:007"], ["face:right", "face:top"]],
  ["edge:007", ["vertex:007", "vertex:008"], ["face:back", "face:top"]],
  ["edge:008", ["vertex:008", "vertex:005"], ["face:left", "face:top"]],
  ["edge:009", ["vertex:001", "vertex:005"], ["face:left", "face:front"]],
  ["edge:010", ["vertex:002", "vertex:006"], ["face:front", "face:right"]],
  ["edge:011", ["vertex:003", "vertex:007"], ["face:right", "face:back"]],
  ["edge:012", ["vertex:004", "vertex:008"], ["face:back", "face:left"]]
];

function writeJson(relativePath, value) {
  const filePath = path.join(mockRoot, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function bbox(points) {
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  const zs = points.map((point) => point[2]);
  return {
    min: [Math.min(...xs), Math.min(...ys), Math.min(...zs)],
    max: [Math.max(...xs), Math.max(...ys), Math.max(...zs)]
  };
}

function centroid(points) {
  return points.reduce((sum, point) => [
    sum[0] + point[0] / points.length,
    sum[1] + point[1] / points.length,
    sum[2] + point[2] / points.length
  ], [0, 0, 0]);
}

function distance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function cubeTopology({ stepIndex, sourceKernel }) {
  const bodies = [{
    entityId: "body:001",
    kind: "body",
    kernelTag: 100,
    stableId: "body0",
    sourceKernel,
    debugName: "Mock block",
    bodyType: "solid",
    regions: ["region:001"],
    bbox: { min: [-1, -1, -1], max: [1, 1, 1] }
  }];
  const regions = [{
    entityId: "region:001",
    kind: "region",
    kernelTag: 200,
    stableId: "body0/region0",
    sourceKernel,
    body: "body:001",
    shells: ["shell:001"]
  }];
  const shells = [{
    entityId: "shell:001",
    kind: "shell",
    kernelTag: 300,
    stableId: "body0/region0/shell0",
    sourceKernel,
    region: "region:001",
    shellType: "closed",
    faces: cubeFaceDefs.map(([id]) => id)
  }];

  const loops = [];
  const coedges = [];
  const faces = cubeFaceDefs.map(([entityId, label, vertexIds, surfaceType, normal], index) => {
    const edgeIds = cubeEdgeDefs
      .filter(([, , adjacentFaces]) => adjacentFaces.includes(entityId))
      .map(([edgeId]) => edgeId);
    const loopId = `loop:${String(index + 1).padStart(3, "0")}`;
    loops.push({
      entityId: loopId,
      kind: "loop",
      kernelTag: 500 + index,
      stableId: `body0/region0/shell0/face${index}/loop0`,
      sourceKernel,
      face: entityId,
      loopType: "outer",
      coedges: edgeIds.map((_, coedgeIndex) => `coedge:${String(index + 1).padStart(3, "0")}:${coedgeIndex}`)
    });
    for (const [coedgeIndex, edgeId] of edgeIds.entries()) {
      coedges.push({
        entityId: `coedge:${String(index + 1).padStart(3, "0")}:${coedgeIndex}`,
        kind: "coedge",
        kernelTag: 600 + index * 10 + coedgeIndex,
        stableId: `body0/region0/shell0/face${index}/loop0/coedge${coedgeIndex}`,
        sourceKernel,
        loop: loopId,
        edge: edgeId,
        sense: "forward",
        next: `coedge:${String(index + 1).padStart(3, "0")}:${(coedgeIndex + 1) % edgeIds.length}`,
        previous: `coedge:${String(index + 1).padStart(3, "0")}:${(coedgeIndex + edgeIds.length - 1) % edgeIds.length}`
      });
    }
    const points = vertexIds.map((id) => cubeVertices[id]);
    return {
      entityId,
      kind: "face",
      kernelTag: 400 + index,
      stableId: `body0/region0/shell0/face${index}`,
      sourceKernel,
      debugName: stepIndex >= 1 && entityId === "face:top" ? "Seed face" : label,
      shell: "shell:001",
      surfaceType,
      orientation: "forward",
      loops: [loopId],
      edges: edgeIds,
      area: 4,
      bbox: bbox(points),
      surfaceInfo: { normal },
      geometricSignature: {
        surfaceType,
        area: 4,
        centroid: centroid(points),
        bboxDiagonal: Math.sqrt(8)
      }
    };
  });

  const edges = cubeEdgeDefs.map(([entityId, [a, b], adjacentFaces], index) => ({
    entityId,
    kind: "edge",
    kernelTag: 700 + index,
    stableId: `body0/region0/shell0/edge${index}`,
    sourceKernel,
    curveType: "line",
    vertices: [a, b],
    adjacentFaces,
    length: distance(cubeVertices[a], cubeVertices[b]),
    bbox: bbox([cubeVertices[a], cubeVertices[b]]),
    curveInfo: {
      start: cubeVertices[a],
      end: cubeVertices[b]
    },
    geometricSignature: {
      curveType: "line",
      length: distance(cubeVertices[a], cubeVertices[b])
    }
  }));

  const vertices = Object.entries(cubeVertices).map(([entityId, position], index) => ({
    entityId,
    kind: "vertex",
    kernelTag: 800 + index,
    stableId: `body0/region0/shell0/vertex${index}`,
    sourceKernel,
    position,
    edges: cubeEdgeDefs.filter(([, endpoints]) => endpoints.includes(entityId)).map(([edgeId]) => edgeId)
  }));

  return { bodies, regions, shells, faces, loops, coedges, edges, vertices };
}

function cubeFaceMesh([entityId, , vertexIds], { stepIndex, topInset = 0, color }) {
  const inset = entityId === "face:top" ? topInset : 0;
  const points = vertexIds.map((id) => [...cubeVertices[id]]);
  if (inset > 0) {
    for (const point of points) {
      point[0] *= 1 - inset;
      point[1] *= 1 - inset;
    }
  }
  return {
    entityId,
    meshId: `mesh:${entityId}`,
    positions: points.flat(),
    normals: [],
    indices: [0, 1, 2, 0, 2, 3],
    uvs: [],
    display: {
      visible: true,
      opacity: entityId === "face:top" && stepIndex >= 1 ? 0.82 : 1,
      color
    }
  };
}

function cubeProperties(topology, stepIndex) {
  const entries = {};
  for (const bucket of Object.values(topology)) {
    for (const entity of bucket) {
      entries[entity.entityId] = {
        basic: {
          entityId: entity.entityId,
          kind: entity.kind,
          tag: entity.kernelTag,
          stableId: entity.stableId,
          sourceKernel: entity.sourceKernel,
          debugName: entity.debugName
        }
      };
      if (entity.kind === "face") {
        entries[entity.entityId].surface = {
          surfaceType: entity.surfaceType,
          orientation: entity.orientation,
          area: entity.area,
          edges: entity.edges
        };
      }
      if (entity.kind === "edge") {
        entries[entity.entityId].curve = {
          curveType: entity.curveType,
          length: entity.length,
          adjacentFaces: entity.adjacentFaces
        };
      }
    }
  }
  if (stepIndex >= 2) {
    entries["face:top"].debug = {
      role: "hole grow result",
      stopReason: "meet_boundary",
      note: "Mock snapshot narrows the top face to represent an algorithm step."
    };
  }
  return entries;
}

function createCubeScene({
  caseId,
  snapshotId,
  title,
  stepIndex = 0,
  topInset = 0,
  sourceKernel = "mock",
  adapterId = "mock.gtest.dump",
  modelId = "mock-block-001",
  color
}) {
  const topology = cubeTopology({ stepIndex, sourceKernel });
  return {
    gksVersion: "0.1",
    sceneId: `${caseId}.${snapshotId}`,
    caseId,
    snapshotId,
    title,
    unit: "m",
    source: { kernel: sourceKernel, adapterId, modelId },
    bbox: { min: [-1, -1, -1], max: [1, 1, 1] },
    cameraHint: {
      target: [0, 0, 0],
      position: [4, -5, 3],
      up: [0, 0, 1]
    },
    topology,
    geometry: {
      faceMeshes: cubeFaceDefs.map((def) => cubeFaceMesh(def, { stepIndex, topInset, color })),
      edgePolylines: cubeEdgeDefs.map(([entityId, [a, b]]) => ({
        entityId,
        polylineId: `polyline:${entityId}`,
        points: [...cubeVertices[a], ...cubeVertices[b]],
        display: { visible: true, lineWidth: 1 }
      })),
      vertexPoints: Object.entries(cubeVertices).map(([entityId, position]) => ({
        entityId,
        position,
        display: { visible: true, size: 4 }
      })),
      transientObjects: stepIndex >= 2 ? [{
        id: "debug-axis:hole-grow",
        kind: "axis",
        points: [0, 0, -1.3, 0, 0, 1.3],
        color: "#e24b4b"
      }] : []
    },
    properties: cubeProperties(topology, stepIndex),
    debug: {
      algorithm: stepIndex === 0 ? "MockInput" : "HoleGrow",
      step: snapshotId,
      message: stepIndex === 0 ? "Input mock body" : stepIndex === 1 ? "Seed face selected" : "After hole grow",
      highlights: {
        faces: stepIndex === 0 ? [] : ["face:top"],
        edges: stepIndex >= 2 ? ["edge:005", "edge:006", "edge:007", "edge:008"] : [],
        vertices: []
      },
      annotations: stepIndex >= 2 ? [{
        id: "ann_001",
        type: "message",
        title: "Stop reason",
        text: "Search stopped at the mock top boundary.",
        relatedEntities: ["face:top"],
        position: [0, 0, 1.25]
      }] : []
    },
    capabilities: {
      readonly: true,
      interactive: false,
      commands: false
    }
  };
}

function circlePolyline(entityId, radius, z, segments = 64) {
  const points = [];
  for (let i = 0; i <= segments; i += 1) {
    const angle = (Math.PI * 2 * i) / segments;
    points.push(radius * Math.cos(angle), radius * Math.sin(angle), z);
  }
  return {
    entityId,
    polylineId: `polyline:${entityId}`,
    points,
    display: { visible: true, lineWidth: 1 }
  };
}

function cylinderWallMesh(entityId, radius, zMin, zMax, inward = false, segments = 48) {
  const positions = [];
  const indices = [];
  for (let i = 0; i <= segments; i += 1) {
    const angle = (Math.PI * 2 * i) / segments;
    const x = radius * Math.cos(angle);
    const y = radius * Math.sin(angle);
    positions.push(x, y, zMin, x, y, zMax);
  }
  for (let i = 0; i < segments; i += 1) {
    const a = i * 2;
    const b = a + 1;
    const c = a + 2;
    const d = a + 3;
    indices.push(...(inward ? [a, d, b, a, c, d] : [a, b, d, a, d, c]));
  }
  return {
    entityId,
    meshId: `mesh:${entityId}`,
    positions,
    normals: [],
    indices,
    uvs: [],
    display: { visible: true, opacity: inward ? 0.78 : 0.9 }
  };
}

function annulusMesh(entityId, outerRadius, innerRadius, z, top = true, segments = 48) {
  const positions = [];
  const indices = [];
  for (let i = 0; i <= segments; i += 1) {
    const angle = (Math.PI * 2 * i) / segments;
    positions.push(
      outerRadius * Math.cos(angle), outerRadius * Math.sin(angle), z,
      innerRadius * Math.cos(angle), innerRadius * Math.sin(angle), z
    );
  }
  for (let i = 0; i < segments; i += 1) {
    const outerA = i * 2;
    const innerA = outerA + 1;
    const outerB = outerA + 2;
    const innerB = outerA + 3;
    indices.push(...(top ? [outerA, innerA, innerB, outerA, innerB, outerB] : [outerA, innerB, innerA, outerA, outerB, innerB]));
  }
  return {
    entityId,
    meshId: `mesh:${entityId}`,
    positions,
    normals: [],
    indices,
    uvs: [],
    display: { visible: true, opacity: 0.96 }
  };
}

function createCylinderHoleScene() {
  const caseId = "CylinderHole.Case_001";
  const sourceKernel = "mock";
  const faces = [
    ["face:outer_wall", "Outer cylindrical wall", "cylinder", ["edge:outer_bottom", "edge:outer_top"]],
    ["face:inner_wall", "Hole cylindrical wall", "cylinder", ["edge:inner_bottom", "edge:inner_top"]],
    ["face:top_annulus", "Top annulus", "plane", ["edge:outer_top", "edge:inner_top"]],
    ["face:bottom_annulus", "Bottom annulus", "plane", ["edge:outer_bottom", "edge:inner_bottom"]]
  ];
  const loops = [];
  const coedges = [];
  const faceEntities = faces.map(([entityId, debugName, surfaceType, edgeIds], index) => {
    const loopId = `loop:cyl:${index}`;
    loops.push({
      entityId: loopId,
      kind: "loop",
      kernelTag: 550 + index,
      stableId: `body0/region0/shell0/face${index}/loop0`,
      sourceKernel,
      face: entityId,
      loopType: entityId.includes("annulus") ? "winding" : "outer",
      coedges: edgeIds.map((_, coedgeIndex) => `coedge:cyl:${index}:${coedgeIndex}`)
    });
    edgeIds.forEach((edgeId, coedgeIndex) => {
      coedges.push({
        entityId: `coedge:cyl:${index}:${coedgeIndex}`,
        kind: "coedge",
        kernelTag: 650 + index * 10 + coedgeIndex,
        stableId: `body0/region0/shell0/face${index}/loop0/coedge${coedgeIndex}`,
        sourceKernel,
        loop: loopId,
        edge: edgeId,
        sense: coedgeIndex % 2 === 0 ? "forward" : "reversed"
      });
    });
    return {
      entityId,
      kind: "face",
      kernelTag: 450 + index,
      stableId: `body0/region0/shell0/face${index}`,
      sourceKernel,
      debugName,
      shell: "shell:001",
      surfaceType,
      orientation: entityId === "face:inner_wall" ? "reversed" : "forward",
      loops: [loopId],
      edges: edgeIds,
      area: surfaceType === "cylinder" ? 2 * Math.PI * (entityId === "face:inner_wall" ? 0.38 : 1) * 2 : Math.PI * (1 - 0.38 ** 2),
      bbox: { min: [-1, -1, -1], max: [1, 1, 1] },
      surfaceInfo: surfaceType === "cylinder"
        ? { axisOrigin: [0, 0, 0], axisDirection: [0, 0, 1], radius: entityId === "face:inner_wall" ? 0.38 : 1 }
        : { normal: [0, 0, entityId === "face:top_annulus" ? 1 : -1] },
      geometricSignature: {
        surfaceType,
        centroid: [0, 0, entityId === "face:top_annulus" ? 1 : entityId === "face:bottom_annulus" ? -1 : 0],
        radius: surfaceType === "cylinder" ? entityId === "face:inner_wall" ? 0.38 : 1 : undefined
      }
    };
  });

  const edges = [
    ["edge:outer_bottom", "circle", 1, -1, ["face:outer_wall", "face:bottom_annulus"]],
    ["edge:outer_top", "circle", 1, 1, ["face:outer_wall", "face:top_annulus"]],
    ["edge:inner_bottom", "circle", 0.38, -1, ["face:inner_wall", "face:bottom_annulus"]],
    ["edge:inner_top", "circle", 0.38, 1, ["face:inner_wall", "face:top_annulus"]]
  ].map(([entityId, curveType, radius, z, adjacentFaces], index) => ({
    entityId,
    kind: "edge",
    kernelTag: 760 + index,
    stableId: `body0/region0/shell0/edge${index}`,
    sourceKernel,
    curveType,
    vertices: [],
    adjacentFaces,
    length: Math.PI * 2 * radius,
    bbox: { min: [-radius, -radius, z], max: [radius, radius, z] },
    curveInfo: { center: [0, 0, z], axis: [0, 0, 1], radius },
    geometricSignature: { curveType, length: Math.PI * 2 * radius, radius, center: [0, 0, z] }
  }));

  const vertexPoints = [
    ["vertex:outer_top_x", [1, 0, 1]],
    ["vertex:outer_top_y", [0, 1, 1]],
    ["vertex:inner_top_x", [0.38, 0, 1]],
    ["vertex:inner_top_y", [0, 0.38, 1]],
    ["vertex:outer_bottom_x", [1, 0, -1]],
    ["vertex:inner_bottom_x", [0.38, 0, -1]]
  ];
  const vertices = vertexPoints.map(([entityId, position], index) => ({
    entityId,
    kind: "vertex",
    kernelTag: 860 + index,
    stableId: `body0/region0/shell0/vertex${index}`,
    sourceKernel,
    position,
    edges: []
  }));

  const topology = {
    bodies: [{
      entityId: "body:001",
      kind: "body",
      kernelTag: 110,
      stableId: "body0",
      sourceKernel,
      debugName: "Cylinder with through hole",
      bodyType: "solid",
      regions: ["region:001"],
      bbox: { min: [-1, -1, -1], max: [1, 1, 1] }
    }],
    regions: [{
      entityId: "region:001",
      kind: "region",
      kernelTag: 210,
      stableId: "body0/region0",
      sourceKernel,
      body: "body:001",
      shells: ["shell:001"]
    }],
    shells: [{
      entityId: "shell:001",
      kind: "shell",
      kernelTag: 310,
      stableId: "body0/region0/shell0",
      sourceKernel,
      region: "region:001",
      shellType: "closed",
      faces: faceEntities.map((face) => face.entityId)
    }],
    faces: faceEntities,
    loops,
    coedges,
    edges,
    vertices
  };

  return {
    gksVersion: "0.1",
    sceneId: `${caseId}.00_cylinder_hole`,
    caseId,
    snapshotId: "00_cylinder_hole",
    title: "Cylinder hole",
    unit: "m",
    source: { kernel: sourceKernel, adapterId: "mock.gtest.dump", modelId: "mock-cylinder-hole-001" },
    bbox: { min: [-1, -1, -1], max: [1, 1, 1] },
    cameraHint: { target: [0, 0, 0], position: [3.5, -4.2, 2.7], up: [0, 0, 1] },
    topology,
    geometry: {
      faceMeshes: [
        cylinderWallMesh("face:outer_wall", 1, -1, 1),
        cylinderWallMesh("face:inner_wall", 0.38, -1, 1, true),
        annulusMesh("face:top_annulus", 1, 0.38, 1, true),
        annulusMesh("face:bottom_annulus", 1, 0.38, -1, false)
      ],
      edgePolylines: [
        circlePolyline("edge:outer_bottom", 1, -1),
        circlePolyline("edge:outer_top", 1, 1),
        circlePolyline("edge:inner_bottom", 0.38, -1),
        circlePolyline("edge:inner_top", 0.38, 1)
      ],
      vertexPoints: vertexPoints.map(([entityId, position]) => ({ entityId, position, display: { visible: true, size: 4 } })),
      transientObjects: [{
        id: "debug-axis:hole",
        kind: "axis",
        points: [0, 0, -1.25, 0, 0, 1.25],
        color: "#e24b4b"
      }]
    },
    properties: Object.fromEntries([...topology.faces, ...topology.edges, ...topology.vertices].map((entity) => [entity.entityId, {
      basic: {
        entityId: entity.entityId,
        kind: entity.kind,
        tag: entity.kernelTag,
        stableId: entity.stableId,
        sourceKernel: entity.sourceKernel,
        debugName: entity.debugName
      },
      geometry: entity.surfaceInfo ?? entity.curveInfo ?? {}
    }])),
    debug: {
      algorithm: "FeatureMock",
      step: "00_cylinder_hole",
      message: "Mock cylinder with a through hole",
      highlights: {
        faces: ["face:inner_wall"],
        edges: ["edge:inner_top", "edge:inner_bottom"],
        vertices: []
      },
      annotations: [{
        id: "ann_hole",
        type: "message",
        title: "Hole candidate",
        text: "Inner cylindrical wall is marked as the through-hole component.",
        relatedEntities: ["face:inner_wall"],
        position: [0, 0, 0]
      }]
    },
    capabilities: { readonly: true, interactive: false, commands: false }
  };
}

function writeCase(directory, caseId, title, snapshots, producerKernel = "mock") {
  writeJson(`${directory}/index.gkcase.json`, {
    gksVersion: "0.1",
    caseId,
    title,
    createdAt: "2026-06-04T12:00:00Z",
    producer: {
      name: "mock-gtest-dump",
      version: "0.1",
      kernel: producerKernel,
      buildType: "Debug",
      gitCommit: "unknown"
    },
    snapshots: snapshots.map(({ snapshotId, title: snapshotTitle, file }) => ({
      snapshotId,
      title: snapshotTitle,
      file
    }))
  });
}

function generateHoleGrowCase() {
  const caseId = "HoleGrow.Case_001";
  const snapshots = [
    { snapshotId: "00_input", title: "Input body", stepIndex: 0, topInset: 0 },
    { snapshotId: "01_seed_face", title: "Seed face selected", stepIndex: 1, topInset: 0 },
    { snapshotId: "02_after_grow", title: "After hole grow", stepIndex: 2, topInset: 0.22 }
  ];
  writeCase("HoleGrow.Case_001", caseId, "HoleGrow Case 001", snapshots.map((item) => ({
    snapshotId: item.snapshotId,
    title: item.title,
    file: `${item.snapshotId}.gkscene.json`
  })));
  for (const item of snapshots) {
    writeJson(`HoleGrow.Case_001/${item.snapshotId}.gkscene.json`, createCubeScene({
      caseId,
      snapshotId: item.snapshotId,
      title: item.title,
      stepIndex: item.stepIndex,
      topInset: item.topInset
    }));
  }
}

function generateCubeCase() {
  const caseId = "Cube.Case_001";
  const snapshotId = "00_cube";
  writeCase("Cube.Case_001", caseId, "Cube Case 001", [{
    snapshotId,
    title: "Cube",
    file: `${snapshotId}.gkscene.json`
  }]);
  writeJson(`Cube.Case_001/${snapshotId}.gkscene.json`, createCubeScene({
    caseId,
    snapshotId,
    title: "Cube",
    stepIndex: 0,
    adapterId: "mock.file.dump",
    modelId: "mock-cube-001"
  }));
}

function generateCylinderHoleCase() {
  const caseId = "CylinderHole.Case_001";
  const snapshotId = "00_cylinder_hole";
  writeCase("CylinderHole.Case_001", caseId, "Cylinder Hole Case 001", [{
    snapshotId,
    title: "Cylinder hole",
    file: `${snapshotId}.gkscene.json`
  }]);
  writeJson(`CylinderHole.Case_001/${snapshotId}.gkscene.json`, createCylinderHoleScene());
}

function generateSplitCompare() {
  const caseId = "SplitCompare.Case_001";
  const leftScene = createCubeScene({
    caseId,
    snapshotId: "left_after_grow",
    title: "MyKernel after grow",
    stepIndex: 2,
    topInset: 0.22,
    sourceKernel: "mock-pklike",
    adapterId: "mock.pklike",
    modelId: "compare-left",
    color: "#6aa6d8"
  });
  const rightScene = createCubeScene({
    caseId,
    snapshotId: "right_after_grow",
    title: "OCC candidate",
    stepIndex: 2,
    topInset: 0.08,
    sourceKernel: "mock-occ",
    adapterId: "mock.occ",
    modelId: "compare-right",
    color: "#7dbf97"
  });
  writeJson("SplitCompare.Case_001/left.gkscene.json", leftScene);
  writeJson("SplitCompare.Case_001/right.gkscene.json", rightScene);
  writeJson("SplitCompare.Case_001/split.gkcompare.json", {
    gksVersion: "0.1",
    compareId: caseId,
    title: "Split Compare Case 001",
    layout: "split",
    createdAt: "2026-06-04T12:00:00Z",
    scenes: [
      {
        viewId: "left",
        title: "MyKernel",
        kernel: "mock-pklike",
        adapterId: "mock.pklike",
        file: "left.gkscene.json"
      },
      {
        viewId: "right",
        title: "OCC candidate",
        kernel: "mock-occ",
        adapterId: "mock.occ",
        file: "right.gkscene.json"
      }
    ],
    mapping: {
      mode: "manual",
      pairs: [
        { leftEntityId: "face:top", rightEntityId: "face:top", confidence: 0.92, reason: "same stable path and surface signature" },
        { leftEntityId: "edge:005", rightEntityId: "edge:005", confidence: 0.88, reason: "same adjacent top/front faces" }
      ]
    }
  });
}

generateHoleGrowCase();
generateCubeCase();
generateCylinderHoleCase();
generateSplitCompare();

console.log(`Generated mock GKS artifacts in ${path.relative(root, mockRoot)}`);
