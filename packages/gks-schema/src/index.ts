export type EntityKind =
  | "body"
  | "region"
  | "shell"
  | "face"
  | "loop"
  | "coedge"
  | "edge"
  | "vertex";

export interface Vec3 extends Array<number> {
  0: number;
  1: number;
  2: number;
}

export interface BBox {
  min: Vec3;
  max: Vec3;
}

export interface EntityIdentity {
  entityId: string;
  kind: EntityKind;
  kernelTag?: number | string;
  stableId?: string;
  sourceKernel: string;
  debugName?: string;
}

export interface GksCase {
  gksVersion: "0.1";
  caseId: string;
  title?: string;
  createdAt?: string;
  producer?: {
    name: string;
    version?: string;
    kernel?: string;
    buildType?: string;
    gitCommit?: string;
  };
  snapshots: GksSnapshotRef[];
}

export interface GksRun {
  gksVersion: "0.1";
  runId: string;
  title?: string;
  createdAt?: string;
  rootDir?: string;
  cases: GksRunCaseRef[];
}

export interface GksRunCaseRef {
  caseId: string;
  title?: string;
  file: string;
  suite?: string;
  test?: string;
  status?: "running" | "passed" | "failed" | "skipped" | "unknown";
  startedAt?: string;
  finishedAt?: string;
}

export interface GksSnapshotRef {
  snapshotId: string;
  title?: string;
  file: string;
}

export interface GksCompare {
  gksVersion: "0.1";
  compareId: string;
  title?: string;
  layout?: "split" | "grid";
  createdAt?: string;
  scenes: GksCompareSceneRef[];
  mapping?: {
    mode?: "manual" | "geometricSignature" | "mixed";
    pairs?: GksCompareMappingPair[];
  };
}

export interface GksCompareSceneRef {
  viewId: string;
  title?: string;
  kernel?: string;
  adapterId?: string;
  file: string;
}

export interface GksCompareMappingPair {
  leftEntityId: string;
  rightEntityId: string;
  confidence?: number;
  reason?: string;
}

export interface GksScene {
  gksVersion: "0.1";
  sceneId: string;
  caseId?: string;
  snapshotId: string;
  title?: string;
  unit?: string;
  source: GksSceneSource;
  bbox?: BBox;
  cameraHint?: CameraHint;
  topology: GksTopology;
  geometry: GksGeometry;
  properties?: EntityPropertiesMap;
  debug?: GksDebug;
  capabilities?: Record<string, unknown>;
}

export interface GksSceneSource {
  kernel: string;
  adapterId?: string;
  modelId?: string;
}

export interface CameraHint {
  target: Vec3;
  position: Vec3;
  up?: Vec3;
}

export interface GksTopology {
  bodies: BodyEntity[];
  regions: RegionEntity[];
  shells: ShellEntity[];
  faces: FaceEntity[];
  loops: LoopEntity[];
  coedges: CoedgeEntity[];
  edges: EdgeEntity[];
  vertices: VertexEntity[];
}

export interface BodyEntity extends EntityIdentity {
  kind: "body";
  bodyType?: "solid" | "sheet" | "wire" | "mixed" | "unknown";
  regions?: string[];
  bbox?: BBox;
}

export interface RegionEntity extends EntityIdentity {
  kind: "region";
  body?: string;
  shells?: string[];
  synthetic?: boolean;
}

export interface ShellEntity extends EntityIdentity {
  kind: "shell";
  region?: string;
  shellType?: "closed" | "open" | "non_manifold" | "unknown";
  faces?: string[];
}

export interface FaceEntity extends EntityIdentity {
  kind: "face";
  shell?: string;
  surfaceType?: SurfaceType;
  orientation?: "forward" | "reversed" | "unknown";
  loops?: string[];
  edges?: string[];
  area?: number;
  bbox?: BBox;
  surfaceInfo?: Record<string, unknown>;
  geometricSignature?: Record<string, unknown>;
}

export type SurfaceType =
  | "plane"
  | "cylinder"
  | "cone"
  | "sphere"
  | "torus"
  | "bspline"
  | "offset"
  | "swept"
  | "spun"
  | "foreign"
  | "unknown";

export interface LoopEntity extends EntityIdentity {
  kind: "loop";
  face?: string;
  loopType?: "outer" | "inner" | "winding" | "inner_sing" | "outer_sing" | "unknown";
  coedges?: string[];
}

export interface CoedgeEntity extends EntityIdentity {
  kind: "coedge";
  loop?: string;
  edge?: string;
  sense?: "forward" | "reversed" | "unknown";
  next?: string;
  previous?: string;
}

export interface EdgeEntity extends EntityIdentity {
  kind: "edge";
  curveType?: CurveType;
  vertices?: string[];
  adjacentFaces?: string[];
  length?: number;
  bbox?: BBox;
  curveInfo?: Record<string, unknown>;
  geometricSignature?: Record<string, unknown>;
}

export type CurveType =
  | "line"
  | "circle"
  | "ellipse"
  | "bspline"
  | "intersection"
  | "spcurve"
  | "foreign"
  | "unknown";

export interface VertexEntity extends EntityIdentity {
  kind: "vertex";
  position?: Vec3;
  edges?: string[];
}

export interface GksGeometry {
  faceMeshes: FaceMesh[];
  edgePolylines: EdgePolyline[];
  vertexPoints: VertexPoint[];
  transientObjects?: TransientObject[];
}

export interface FaceMesh {
  entityId: string;
  meshId?: string;
  positions: number[];
  normals?: number[];
  indices: number[];
  uvs?: number[];
  display?: {
    visible?: boolean;
    opacity?: number;
    color?: string;
  };
}

export interface EdgePolyline {
  entityId: string;
  polylineId?: string;
  points: number[];
  display?: {
    visible?: boolean;
    lineWidth?: number;
    color?: string;
  };
}

export interface VertexPoint {
  entityId: string;
  position: Vec3;
  display?: {
    visible?: boolean;
    size?: number;
    color?: string;
  };
}

export interface TransientObject {
  id: string;
  kind: string;
  [key: string]: unknown;
}

export type EntityPropertiesMap = Record<string, Record<string, unknown>>;

export interface GksDebug {
  algorithm?: string;
  step?: string;
  message?: string;
  highlights?: {
    faces?: string[];
    edges?: string[];
    vertices?: string[];
  };
  highlightGroups?: GksHighlightGroup[];
  annotations?: GksAnnotation[];
  algorithmData?: Record<string, unknown>;
}

export interface GksHighlightGroup {
  groupId?: string;
  title?: string;
  color?: string;
  faces?: string[];
  edges?: string[];
  vertices?: string[];
  entityIds?: string[];
}

export interface GksAnnotation {
  id: string;
  type: string;
  title?: string;
  text?: string;
  relatedEntities?: string[];
  position?: Vec3;
}

export interface CommandDescriptor {
  commandId: string;
  title: string;
  level?: number;
  description?: string;
  selectionKinds?: EntityKind[];
  argsSchema?: Record<string, unknown>;
}

export type JsonRpcId = number | string;

export interface JsonRpcRequest<TParams = unknown> {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params?: TParams;
}

export interface JsonRpcNotification<TParams = unknown> {
  jsonrpc: "2.0";
  method: string;
  params?: TParams;
}

export type JsonRpcResponse<TResult = unknown> =
  | {
      jsonrpc: "2.0";
      id: JsonRpcId;
      result: TResult;
    }
  | {
      jsonrpc: "2.0";
      id: JsonRpcId;
      error: JsonRpcError;
    };

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface AdapterInitializeParams {
  client: {
    name: string;
    version?: string;
  };
  protocolVersion: "0.1";
  workspaceRoot?: string;
}

export interface AdapterInitializeResult {
  adapterId: string;
  displayName: string;
  protocolVersion: "0.1";
  kernel: {
    name: string;
    version?: string;
  };
  mode: "readonly" | "interactive";
  capabilities: AdapterCapabilities;
}

export interface AdapterCapabilities {
  readonly: boolean;
  interactive: boolean;
  transactional?: boolean;
  multiModel?: boolean;
  getScene?: boolean;
  getTopology?: boolean;
  getEntityProperties?: boolean;
  tessellation?: boolean;
  commands?: boolean;
}

export interface AdapterManifest {
  adapterId: string;
  displayName: string;
  mode: "readonly" | "interactive";
  supportedFileTypes: string[];
  commands?: CommandDescriptor[];
}

export interface ModelOpenParams {
  uri: string;
  options?: {
    readOnly?: boolean;
    [key: string]: unknown;
  };
}

export interface ModelOpenResult {
  modelId: string;
  displayName?: string;
  unit?: string;
  bodyCount?: number;
}

export interface ModelGetSceneParams {
  modelId: string;
  snapshotId?: string;
  options?: Record<string, unknown>;
}

export interface ModelGetSceneResult {
  scene: GksScene;
}

export interface EntityGetPropertiesParams {
  modelId: string;
  entityId: string;
}

export interface EntityGetPropertiesResult {
  entityId: string;
  kind: EntityKind;
  properties: Record<string, unknown>;
}

export interface CommandListParams {
  modelId: string;
}

export interface CommandListResult {
  commands: CommandDescriptor[];
}

export interface CommandExecuteParams {
  modelId: string;
  commandId: string;
  selection?: SelectionInfo[];
  args?: Record<string, unknown>;
}

export interface CommandExecuteResult {
  status: "ok" | "error";
  message?: string;
  highlights?: {
    faces?: string[];
    edges?: string[];
    vertices?: string[];
  };
  highlightGroups?: GksHighlightGroup[];
  data?: Record<string, unknown>;
  transientObjects?: TransientObject[];
}

export interface SelectionInfo {
  viewId: string;
  entityId: string;
  kind: EntityKind;
  kernelTag?: number | string;
  sourceKernel?: string;
}

export function topologyBuckets(topology: GksTopology): EntityIdentity[][] {
  return [
    topology.bodies,
    topology.regions,
    topology.shells,
    topology.faces,
    topology.loops,
    topology.coedges,
    topology.edges,
    topology.vertices
  ];
}

export function buildEntityIndex(scene: GksScene): Map<string, EntityIdentity> {
  const index = new Map<string, EntityIdentity>();
  for (const bucket of topologyBuckets(scene.topology)) {
    for (const entity of bucket) {
      index.set(entity.entityId, entity);
    }
  }
  return index;
}

export function entityKindFromId(entityId: string): EntityKind | undefined {
  const [prefix] = entityId.split(":");
  if (
    prefix === "body" ||
    prefix === "region" ||
    prefix === "shell" ||
    prefix === "face" ||
    prefix === "loop" ||
    prefix === "coedge" ||
    prefix === "edge" ||
    prefix === "vertex"
  ) {
    return prefix;
  }
  return undefined;
}
