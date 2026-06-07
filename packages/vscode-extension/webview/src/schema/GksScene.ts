import type {
  EntityIdentity,
  EntityKind,
  GksCase,
  GksCompare,
  GksCompareSceneRef,
  GksScene
} from "@gk-workbench/gks-schema";

export type { EntityIdentity, EntityKind, GksCase, GksCompare, GksCompareSceneRef, GksScene };

export interface WorkbenchInitialData {
  mode: "case" | "scene" | "compare" | "adapter";
  case?: GksCase;
  compare?: GksCompare;
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
