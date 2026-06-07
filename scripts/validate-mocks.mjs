import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const roots = process.argv.slice(2).map((item) => path.resolve(root, item));
if (!roots.length) {
  roots.push(path.join(root, "examples/mock"));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertArray(value, label) {
  assert(Array.isArray(value), `${label} must be an array`);
}

function walkFiles(directory) {
  const results = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(filePath));
    } else {
      results.push(filePath);
    }
  }
  return results;
}

function validateScene(scene, filePath) {
  assert(scene.gksVersion === "0.1", `${filePath}: gksVersion must be 0.1`);
  assert(typeof scene.sceneId === "string", `${filePath}: sceneId is required`);
  assert(typeof scene.snapshotId === "string", `${filePath}: snapshotId is required`);
  assert(scene.source && typeof scene.source.kernel === "string", `${filePath}: source.kernel is required`);
  assert(scene.topology && typeof scene.topology === "object", `${filePath}: topology is required`);
  assert(scene.geometry && typeof scene.geometry === "object", `${filePath}: geometry is required`);

  for (const key of ["bodies", "regions", "shells", "faces", "loops", "coedges", "edges", "vertices"]) {
    assertArray(scene.topology[key], `${filePath}: topology.${key}`);
  }

  for (const key of ["faceMeshes", "edgePolylines", "vertexPoints"]) {
    assertArray(scene.geometry[key], `${filePath}: geometry.${key}`);
  }

  const entityIds = new Set();
  for (const key of Object.keys(scene.topology)) {
    for (const entity of scene.topology[key] ?? []) {
      assert(typeof entity.entityId === "string", `${filePath}: topology.${key} entityId is required`);
      assert(typeof entity.kind === "string", `${filePath}: topology.${key} kind is required`);
      assert(typeof entity.sourceKernel === "string", `${filePath}: topology.${key} sourceKernel is required`);
      entityIds.add(entity.entityId);
    }
  }

  for (const mesh of scene.geometry.faceMeshes) {
    assert(entityIds.has(mesh.entityId), `${filePath}: mesh references unknown ${mesh.entityId}`);
    assertArray(mesh.positions, `${filePath}: mesh.positions`);
    assertArray(mesh.indices, `${filePath}: mesh.indices`);
    assert(mesh.positions.length % 3 === 0, `${filePath}: mesh positions must be xyz triples`);
    assert(mesh.indices.length % 3 === 0, `${filePath}: mesh indices must be triangles`);
  }

  for (const edge of scene.geometry.edgePolylines) {
    assert(entityIds.has(edge.entityId), `${filePath}: edge polyline references unknown ${edge.entityId}`);
    assertArray(edge.points, `${filePath}: edge.points`);
    assert(edge.points.length % 3 === 0, `${filePath}: edge points must be xyz triples`);
  }

  for (const vertex of scene.geometry.vertexPoints) {
    assert(entityIds.has(vertex.entityId), `${filePath}: vertex point references unknown ${vertex.entityId}`);
    assertArray(vertex.position, `${filePath}: vertex.position`);
    assert(vertex.position.length === 3, `${filePath}: vertex position must be xyz`);
  }
}

function validateCase(casePath) {
  const gkcase = readJson(casePath);
  assert(gkcase.gksVersion === "0.1", `${casePath}: case gksVersion must be 0.1`);
  assert(typeof gkcase.caseId === "string", `${casePath}: caseId is required`);
  assertArray(gkcase.snapshots, `${casePath}: snapshots`);
  assert(gkcase.snapshots.length >= 1, `${casePath}: expected at least one snapshot`);

  for (const snapshot of gkcase.snapshots) {
    assert(typeof snapshot.snapshotId === "string", `${casePath}: snapshotId is required`);
    assert(typeof snapshot.file === "string", `${casePath}: snapshot file is required`);
    const scenePath = path.resolve(path.dirname(casePath), snapshot.file);
    assert(fs.existsSync(scenePath), `${casePath}: missing snapshot file ${snapshot.file}`);
    validateScene(readJson(scenePath), scenePath);
  }
}

function validateCompare(comparePath) {
  const compare = readJson(comparePath);
  assert(compare.gksVersion === "0.1", `${comparePath}: compare gksVersion must be 0.1`);
  assert(typeof compare.compareId === "string", `${comparePath}: compareId is required`);
  assertArray(compare.scenes, `${comparePath}: scenes`);
  assert(compare.scenes.length >= 2, `${comparePath}: expected at least two compare scenes`);

  const viewIds = new Set();
  for (const sceneRef of compare.scenes) {
    assert(typeof sceneRef.viewId === "string", `${comparePath}: scene viewId is required`);
    assert(!viewIds.has(sceneRef.viewId), `${comparePath}: duplicate viewId ${sceneRef.viewId}`);
    viewIds.add(sceneRef.viewId);
    assert(typeof sceneRef.file === "string", `${comparePath}: scene file is required`);
    const scenePath = path.resolve(path.dirname(comparePath), sceneRef.file);
    assert(fs.existsSync(scenePath), `${comparePath}: missing compare scene file ${sceneRef.file}`);
    validateScene(readJson(scenePath), scenePath);
  }
}

let totalCaseCount = 0;
let totalCompareCount = 0;

for (const currentRoot of roots) {
  assert(fs.existsSync(currentRoot), `${path.relative(root, currentRoot)} does not exist`);
  const files = walkFiles(currentRoot);
  const caseFiles = files.filter((filePath) => filePath.endsWith(".gkcase.json"));
  const compareFiles = files.filter((filePath) => filePath.endsWith(".gkcompare.json"));

  assert(
    caseFiles.length > 0 || compareFiles.length > 0,
    `expected at least one GKS case or compare under ${path.relative(root, currentRoot)}`
  );

  for (const casePath of caseFiles) {
    validateCase(casePath);
  }

  for (const comparePath of compareFiles) {
    validateCompare(comparePath);
  }

  totalCaseCount += caseFiles.length;
  totalCompareCount += compareFiles.length;
}

console.log(`Validated ${totalCaseCount} cases and ${totalCompareCount} compares under ${roots.map((item) => path.relative(root, item)).join(", ")}`);
