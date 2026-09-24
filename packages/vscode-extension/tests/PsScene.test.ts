import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { PsTreeNode } from "@gk-workbench/gks-schema";
import { createPsScene } from "../src/ps/PsScene";
import {
  ancestorIdsForEntity, buildEntityIndex, descendantIdsForEntity,
  effectiveHiddenIdsForPsScene, kindFromEntityId
} from "../webview/src/schema/GksScene";

const sampleDir = join(import.meta.dir, "../../../examples/ps");
const brep = JSON.parse(readFileSync(join(sampleDir, "Sample_brep.json"), "utf8"));
const facet = JSON.parse(readFileSync(join(sampleDir, "Sample_facet.json"), "utf8"));

function findNode(root: PsTreeNode, kind: string, tag: number): PsTreeNode {
  const pending = [root];
  while (pending.length) {
    const node = pending.pop()!;
    if (node.kind === kind && node.kernelTag === tag) {
      return node;
    }
    pending.push(...node.children);
  }
  throw new Error(`Missing ${kind} #${tag}`);
}

test("PS pair links facet triangles and curves to the matching BRep topology", () => {
  const scene = createPsScene(brep, facet, "Sample");
  const root = scene.psTree![0];
  const partition = findNode(root, "partition", 1);
  const face = findNode(root, "face", 400);
  const edge = findNode(root, "edge", 700);
  const coedge = findNode(root, "coedge", 600);
  const otherCoedge = findNode(root, "coedge", 601);
  const lump = findNode(root, "lump", 200);
  const wireEdge = findNode(root, "edge", 703);
  const vertex = findNode(root, "vertex", 701);
  const assembly = findNode(root, "assembly", 800);

  assert.equal(scene.geometry.faceMeshes[0].entityId, face.entityId);
  assert.equal(scene.geometry.faceMeshes[0].indices.length, 6);
  assert.equal(scene.geometry.edgePolylines[0].entityId, edge.entityId);
  assert.deepEqual(scene.geometry.vertexPoints.find((point) => point.entityId === vertex.entityId)?.position, [0, 0, 0]);
  assert.equal(scene.properties[partition.entityId].data.tolerance, 1e-6);
  assert.deepEqual((scene.properties[face.entityId].data.geometry as { normal: number[] }).normal, [0, 0, 1]);
  assert.equal((scene.properties[edge.entityId].data.geometry as { curve: string }).curve, "line");
  assert.equal((scene.properties[coedge.entityId].data.geometry as { length: number }).length, 1);
  assert.equal((scene.properties[wireEdge.entityId].data.geometry as { length: number }).length, 1.2);
  assert.deepEqual((scene.properties[vertex.entityId].data.geometry as { point: string[] }).point, ["0", "0", "0"]);
  assert.ok(edge.children.some((child) => child.kind === "vertex" && child.debugName === "startVertex"));
  assert.equal(coedge.children[0], edge);
  assert.equal(otherCoedge.children[0], edge);
  assert.equal(scene.properties[coedge.entityId].data.edge, 700);
  assert.ok(!lump.children.includes(edge));
  assert.ok(lump.children.includes(wireEdge));
  assert.equal(findNode(assembly, "instance", 801).kind, "instance");
  assert.deepEqual(root.children.map((child) => child.kind), ["partition"]);
  assert.ok(partition.children.some((child) => child.kind === "body"));
  assert.equal(buildEntityIndex(scene).get(face.entityId), face);
  assert.ok(ancestorIdsForEntity(scene, face.entityId).includes(partition.entityId));
  assert.ok(descendantIdsForEntity(scene, partition.entityId).includes(vertex.entityId));
  assert.equal(kindFromEntityId(face.entityId), "face");
  assert.ok(!effectiveHiddenIdsForPsScene(scene, new Set([coedge.entityId])).has(edge.entityId));
  assert.ok(effectiveHiddenIdsForPsScene(scene, new Set([coedge.entityId, otherCoedge.entityId])).has(edge.entityId));
});

test("BRep-only shows vertex geometry and recursive lists; facet-only stays selectable", () => {
  const treeOnly = createPsScene(brep, undefined, "Sample");
  assert.equal(treeOnly.geometry.faceMeshes.length, 0);
  assert.equal(treeOnly.geometry.vertexPoints.length, 3);
  assert.equal(findNode(treeOnly.psTree![0], "transform", 901).kind, "transform");

  const meshOnly = createPsScene(undefined, facet, "Sample");
  const syntheticFace = findNode(meshOnly.psTree![0], "face", 400);
  assert.equal(meshOnly.geometry.faceMeshes[0].entityId, syntheticFace.entityId);
  assert.equal(findNode(meshOnly.psTree![0], "body", 100).kind, "body");
  assert.equal(meshOnly.psTree![0].children[0].kind, "body");
});

test("unknown object lists are traversed, while objects and coordinate arrays remain properties", () => {
  const scene = createPsScene({
    partitions: [{
      tag: 1,
      attributes: [{ tag: 2, attrDefinition: { name: "color" }, fieldValues: [1, 2] }],
      bodies: [{
        tag: 3,
        isolatedVertices: [{ tag: 4, geometry: { point: ["1", "2", "3"] } }]
      }]
    }]
  }, undefined, "metadata");
  const partition = findNode(scene.psTree![0], "partition", 1);
  const attribute = findNode(partition, "object", 2);
  const vertex = findNode(partition, "vertex", 4);
  assert.deepEqual(scene.properties[attribute.entityId].data.attrDefinition, { name: "color" });
  assert.deepEqual(scene.properties[attribute.entityId].data.fieldValues, [1, 2]);
  assert.deepEqual(scene.properties[vertex.entityId].data.geometry, { point: ["1", "2", "3"] });
  assert.deepEqual(scene.geometry.vertexPoints[0].position, [1, 2, 3]);
});

test("invalid PS roots are rejected with a useful error", () => {
  assert.throws(() => createPsScene({}, undefined, "broken"), /partitions array/);
  assert.throws(() => createPsScene(brep, {}, "broken"), /bodies array/);
});

test("geometry references resolve within the owning body, even when tags repeat", () => {
  const scene = createPsScene({ partitions: [{ tag: 1, bodies: [
    { tag: 11, entGeometries: { points: [{ tag: 9, point: ["1", "2", "3"] }] },
      isolatedVertices: [{ tag: 101, geometry: 9 }] },
    { tag: 12, entGeometries: { points: [{ tag: 9, point: ["4", "5", "6"] }] },
      isolatedVertices: [{ tag: 102, geometry: { tag: 9 } }] }
  ] }] }, undefined, "two bodies");
  const first = findNode(scene.psTree![0], "vertex", 101);
  const second = findNode(scene.psTree![0], "vertex", 102);
  assert.deepEqual((scene.properties[first.entityId].data.geometry as { point: string[] }).point, ["1", "2", "3"]);
  assert.deepEqual((scene.properties[second.entityId].data.geometry as { point: string[] }).point, ["4", "5", "6"]);
  assert.deepEqual(scene.geometry.vertexPoints.map((point) => point.position).sort((a, b) => a[0] - b[0]), [[1, 2, 3], [4, 5, 6]]);
});
