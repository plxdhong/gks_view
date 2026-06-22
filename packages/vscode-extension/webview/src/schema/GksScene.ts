import type {
  EntityIdentity,
  EntityKind,
  GksCase,
  GksCompare,
  GksCompareSceneRef,
  GksRun,
  GksRunCaseRef,
  GksScene
} from "@gk-workbench/gks-schema";

export type { EntityIdentity, EntityKind, GksCase, GksCompare, GksCompareSceneRef, GksRun, GksRunCaseRef, GksScene };

export interface WorkbenchInitialData {
  mode: "case" | "scene" | "compare" | "run" | "adapter";
  case?: GksCase;
  caseBasePath?: string;
  compare?: GksCompare;
  run?: GksRun;
  runCases?: WorkbenchRunCase[];
  activeRunCaseId?: string;
  snapshots: WorkbenchSnapshotItem[];
  activeSnapshotId: string;
  scene: GksScene;
  compareScenes?: WorkbenchCompareScene[];
  adapter?: {
    adapterId: string;
    displayName: string;
    modelId: string;
  };
}

export interface WorkbenchRunCase extends GksRunCaseRef {
  case: GksCase;
  caseBasePath: string;
  snapshots: WorkbenchSnapshotItem[];
  activeSnapshotId: string;
  scene: GksScene;
}

export interface WorkbenchRunSceneResult {
  activeRunCaseId: string;
  case: GksCase;
  caseBasePath: string;
  snapshots: WorkbenchSnapshotItem[];
  activeSnapshotId: string;
  scene: GksScene;
}

export interface WorkbenchSnapshotItem {
  snapshotId: string;
  title?: string;
  file?: string;
}

export interface WorkbenchCompareScene {
  viewId: string;
  title: string;
  scene: GksScene;
}

type BodyEntity = GksScene["topology"]["bodies"][number];
type RegionEntity = GksScene["topology"]["regions"][number];
type ShellEntity = GksScene["topology"]["shells"][number];
type FaceEntity = GksScene["topology"]["faces"][number];
type LoopEntity = GksScene["topology"]["loops"][number];
type CoedgeEntity = GksScene["topology"]["coedges"][number];
type EdgeEntity = GksScene["topology"]["edges"][number];

export function buildEntityIndex(scene: GksScene): Map<string, EntityIdentity> {
  const index = new Map<string, EntityIdentity>();
  for (const bucket of [
    scene.topology.bodies,
    scene.topology.regions,
    scene.topology.shells,
    scene.topology.faces,
    scene.topology.loops,
    scene.topology.coedges,
    scene.topology.edges,
    scene.topology.vertices
  ]) {
    for (const entity of bucket) {
      index.set(entity.entityId, entity);
    }
  }
  return index;
}

export function childrenForEntity(scene: GksScene, entity: EntityIdentity): EntityIdentity[] {
  if (entity.kind === "body") {
    const body = entity as BodyEntity;
    return scene.topology.regions.filter((region) => body.regions?.includes(region.entityId));
  }
  if (entity.kind === "region") {
    const region = entity as RegionEntity;
    return scene.topology.shells.filter((shell) => region.shells?.includes(shell.entityId));
  }
  if (entity.kind === "shell") {
    const shell = entity as ShellEntity;
    return scene.topology.faces.filter((face) => shell.faces?.includes(face.entityId));
  }
  if (entity.kind === "face") {
    const face = entity as FaceEntity;
    if (face.loops?.length) {
      return scene.topology.loops.filter((loop) => face.loops?.includes(loop.entityId));
    }
    return scene.topology.edges.filter((edge) => face.edges?.includes(edge.entityId));
  }
  if (entity.kind === "loop") {
    const loop = entity as LoopEntity;
    return scene.topology.coedges.filter((coedge) => loop.coedges?.includes(coedge.entityId));
  }
  if (entity.kind === "coedge") {
    const coedge = entity as CoedgeEntity;
    return scene.topology.edges.filter((edge) => edge.entityId === coedge.edge);
  }
  if (entity.kind === "edge") {
    const edge = entity as EdgeEntity;
    return scene.topology.vertices.filter((vertex) => edge.vertices?.includes(vertex.entityId));
  }
  return [];
}

export function buildEntityParentIndex(scene: GksScene): Map<string, string> {
  const parents = new Map<string, string>();
  for (const entity of buildEntityIndex(scene).values()) {
    for (const child of childrenForEntity(scene, entity)) {
      if (!parents.has(child.entityId)) {
        parents.set(child.entityId, entity.entityId);
      }
    }
  }
  return parents;
}

export function ancestorIdsForEntity(scene: GksScene, entityId: string): string[] {
  const parents = buildEntityParentIndex(scene);
  const ancestors: string[] = [];
  const visited = new Set<string>();
  let current = parents.get(entityId);
  while (current && !visited.has(current)) {
    ancestors.unshift(current);
    visited.add(current);
    current = parents.get(current);
  }
  return ancestors;
}

export function descendantIdsForEntity(scene: GksScene, entityId: string): string[] {
  const entity = buildEntityIndex(scene).get(entityId);
  if (!entity) {
    return [];
  }

  const descendants: string[] = [];
  const visited = new Set<string>();
  const pending = [...childrenForEntity(scene, entity)];
  while (pending.length) {
    const child = pending.shift();
    if (!child || visited.has(child.entityId)) {
      continue;
    }
    descendants.push(child.entityId);
    visited.add(child.entityId);
    pending.push(...childrenForEntity(scene, child));
  }
  return descendants;
}

export function kindFromEntityId(entityId: string): EntityKind | undefined {
  const [kind] = entityId.split(":");
  if (
    kind === "body" ||
    kind === "region" ||
    kind === "shell" ||
    kind === "face" ||
    kind === "loop" ||
    kind === "coedge" ||
    kind === "edge" ||
    kind === "vertex"
  ) {
    return kind;
  }
  return undefined;
}
