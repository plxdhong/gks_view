import type { EntityKind, EntityPropertiesMap, GksScene, PsTreeNode, Vec3 } from "@gk-workbench/gks-schema";

type JsonObject = Record<string, unknown>;
type GeometryGroup = "points" | "curves" | "surfaces";
type GeometryIndex = Record<GeometryGroup, Map<string, JsonObject>>;

const listKinds: Record<string, EntityKind> = {
  partitions: "partition",
  bodies: "body",
  assemblies: "assembly",
  orphanGeometies: "orphanGeometry",
  orphanGeometries: "orphanGeometry",
  transforms: "transform",
  groups: "group",
  referenceInstances: "referenceInstance",
  constructionSurfaces: "constructionSurface",
  constructionCurves: "constructionCurve",
  constructionPoints: "constructionPoint",
  isolatedVertices: "vertex",
  lumps: "lump",
  shells: "shell",
  faces: "face",
  loops: "loop",
  coedges: "coedge",
  edges: "edge",
  wireEdges: "edge",
  vertices: "vertex",
  instances: "instance"
};

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function tagKey(value: unknown): string | undefined {
  return typeof value === "number" || typeof value === "string" ? String(value) : undefined;
}

function pointCoordinates(value: unknown): Vec3 | undefined {
  if (!Array.isArray(value) || value.length !== 3) {
    return undefined;
  }
  const coordinates = value.map((item) => typeof item === "number" || typeof item === "string" ? Number(item) : NaN);
  return coordinates.every(Number.isFinite) ? coordinates as Vec3 : undefined;
}

function flatCoordinates(value: unknown, minimum: number, multiple: number): number[] | undefined {
  if (!Array.isArray(value) || value.length < minimum || value.length % multiple !== 0) {
    return undefined;
  }
  const coordinates = value.map((item) => typeof item === "number" || typeof item === "string" ? Number(item) : NaN);
  return coordinates.every(Number.isFinite) ? coordinates : undefined;
}

/** Adapt a PS BRep/facet pair to the workbench's topology and discrete geometry. */
export function createPsScene(brep: unknown, facet: unknown, title: string): GksScene {
  if (brep !== undefined && (!isObject(brep) || !Array.isArray(brep.partitions))) {
    throw new Error("PS BRep must be an object with a partitions array");
  }
  if (facet !== undefined && (!isObject(facet) || !Array.isArray(facet.bodies))) {
    throw new Error("PS facet must be an object with a bodies array");
  }
  if (brep === undefined && facet === undefined) {
    throw new Error("No PS BRep or facet data was found");
  }

  const properties: EntityPropertiesMap = {};
  const faceMeshes: GksScene["geometry"]["faceMeshes"] = [];
  const edgePolylines: GksScene["geometry"]["edgePolylines"] = [];
  const vertexPoints: GksScene["geometry"]["vertexPoints"] = [];
  const bodiesByTag = new Map<string, PsTreeNode[]>();
  const facesByBody = new WeakMap<PsTreeNode, Map<string, PsTreeNode>>();
  const edgesByBody = new WeakMap<PsTreeNode, Map<string, PsTreeNode>>();
  const geometriesByBody = new WeakMap<PsTreeNode, GeometryIndex>();

  const makeNode = (kind: EntityKind, path: string, label: string, data: JsonObject): PsTreeNode => {
    const tag = data.tag;
    const node: PsTreeNode = {
      entityId: `${kind}:ps/${path}`,
      kind,
      sourceKernel: "PS",
      debugName: label,
      ...(tagKey(tag) === undefined ? {} : { kernelTag: tag as string | number }),
      children: []
    };
    properties[node.entityId] = { data };
    return node;
  };

  const parseNode = (
    data: JsonObject,
    kind: EntityKind,
    path: string,
    label: string,
    ownerBody?: PsTreeNode
  ): PsTreeNode => {
    const fields: JsonObject = tagKey(data.tag) === undefined ? {} : { tag: data.tag };
    const node = makeNode(kind, path, label, fields);
    const body = kind === "body" ? node : ownerBody;
    const tag = tagKey(data.tag);

    if (kind === "body" && tag !== undefined) {
      const matching = bodiesByTag.get(tag) ?? [];
      matching.push(node);
      bodiesByTag.set(tag, matching);
    }
    if (kind === "body") {
      const geometryIndex: GeometryIndex = {
        points: new Map(), curves: new Map(), surfaces: new Map()
      };
      const entGeometries = isObject(data.entGeometries) ? data.entGeometries : undefined;
      for (const group of ["points", "curves", "surfaces"] as const) {
        const entries = entGeometries?.[group];
        if (Array.isArray(entries)) {
          for (const entry of entries) {
            if (!isObject(entry)) {
              continue;
            }
            const key = tagKey(entry.tag ?? (isObject(entry.geometry) ? entry.geometry.tag : undefined));
            if (key !== undefined) {
              geometryIndex[group].set(key, entry);
            }
          }
        }
      }
      geometriesByBody.set(node, geometryIndex);
    }
    if (body && tag !== undefined && (kind === "face" || kind === "edge")) {
      const index = kind === "face" ? facesByBody : edgesByBody;
      const byTag = index.get(body) ?? new Map<string, PsTreeNode>();
      if (!byTag.has(tag) || (kind === "edge" && (isObject(data.startVertex) || isObject(data.endVertex)))) {
        byTag.set(tag, node);
      }
      index.set(body, byTag);
    }
    const resolvedGeometry = resolveGeometry(data.geometry, kind, body);

    for (const [key, value] of Object.entries(data)) {
      if (Array.isArray(value) && value.length > 0 && value.every(isObject)) {
        node.children.push(...value.map((item, index) => {
          const childKind = listKinds[key] ?? "object";
          const childLabel = childKind === "object" ? `${key} [${index}]` : childKind;
          return parseNode(item, childKind, `${path}/${key}/${index}`, childLabel, body);
        }));
      } else if (isObject(value) && kind === "edge" && (key === "startVertex" || key === "endVertex")) {
        node.children.push(parseNode(value, "vertex", `${path}/${key}`, key, body));
      } else if (key === "geometry" && resolvedGeometry !== undefined) {
        fields.geometry = resolvedGeometry;
      } else {
        fields[key] = value;
      }
    }
    if (kind === "lump") {
      linkLumpEdges(node, body);
    }
    return node;
  };

  function resolveGeometry(reference: unknown, kind: EntityKind, body?: PsTreeNode): unknown {
    const group: GeometryGroup | undefined = kind === "vertex" ? "points"
      : kind === "face" ? "surfaces"
      : kind === "edge" || kind === "coedge" ? "curves"
      : undefined;
    if (!group || !body) {
      return reference;
    }
    const details = isObject(reference) ? reference : undefined;
    if (group === "points" && pointCoordinates(details?.point)) {
      return reference;
    }
    const geometryTag = tagKey(details
      ? details.tag ?? details.geometryTag ?? details.pointTag ?? details.curveTag ?? details.surfaceTag ?? details.point
      : reference);
    const record = geometryTag === undefined ? undefined : geometriesByBody.get(body)?.[group].get(geometryTag);
    if (!record) {
      return reference;
    }
    return { ...(details ?? {}), ...record, ...(isObject(record.geometry) ? record.geometry : {}) };
  }

  function linkLumpEdges(lump: PsTreeNode, body?: PsTreeNode): void {
    const edges = lump.children.filter((child) => child.kind === "edge");
    const canonical = new Map<string, PsTreeNode>();
    // Prefer the full edge record in edges when wireEdges repeats the same tag.
    for (const edge of [...edges].sort((left, right) =>
      Number(right.entityId.includes("/edges/")) - Number(left.entityId.includes("/edges/")))) {
      const key = tagKey(edge.kernelTag);
      if (key !== undefined && !canonical.has(key)) {
        canonical.set(key, edge);
      }
    }
    lump.children = lump.children.filter((child) => {
      const key = tagKey(child.kernelTag);
      return child.kind !== "edge" || key === undefined || canonical.get(key) === child;
    });
    if (body) {
      const byTag = edgesByBody.get(body) ?? new Map<string, PsTreeNode>();
      for (const [key, edge] of canonical) {
        byTag.set(key, edge);
      }
      edgesByBody.set(body, byTag);
    }

    const coedges: PsTreeNode[] = [];
    const pending = [...lump.children];
    while (pending.length) {
      const child = pending.pop()!;
      if (child.kind === "coedge") {
        coedges.push(child);
      }
      pending.push(...child.children);
    }
    const referenced = new Set<PsTreeNode>();
    for (const coedge of coedges) {
      const fields = properties[coedge.entityId]?.data;
      const reference = isObject(fields) ? fields.edge : undefined;
      const key = tagKey(isObject(reference) ? reference.tag : reference);
      let edge = key === undefined ? undefined : canonical.get(key);
      if (!edge && isObject(reference)) {
        const coedgePath = coedge.entityId.split(":ps/")[1];
        edge = parseNode(reference, "edge", `${coedgePath}/edge`, "edge", body);
        if (key !== undefined) {
          canonical.set(key, edge);
          if (body) {
            edgesByBody.get(body)?.set(key, edge);
          }
        }
      }
      if (edge) {
        coedge.children.push(edge);
        referenced.add(edge);
      }
    }
    lump.children = lump.children.filter((child) => !referenced.has(child));
  }

  const root = parseNode(isObject(brep) ? brep : {}, "model", "root", title);

  if (isObject(facet) && Array.isArray(facet.bodies)) {
    const unpairedBodies: PsTreeNode[] = [];
    for (const [bodyIndex, rawBody] of facet.bodies.entries()) {
      if (!isObject(rawBody)) {
        continue;
      }
      const bodyTag = tagKey(rawBody.bodyTag);
      const candidates = bodyTag === undefined ? [] : bodiesByTag.get(bodyTag) ?? [];
      const firstFaceTag = Array.isArray(rawBody.faces)
        ? rawBody.faces.find((face) => isObject(face) && tagKey(face.faceTag) !== undefined)
        : undefined;
      const body = candidates.find((candidate) => isObject(firstFaceTag)
        && facesByBody.get(candidate)?.has(String(firstFaceTag.faceTag))) ?? candidates[0]
        ?? parseNode({ tag: rawBody.bodyTag }, "body", `facetBodies/${bodyIndex}`, "body");
      if (!candidates.length) {
        unpairedBodies.push(body);
      }

      const addFacetNodes = (key: "faces" | "curves", kind: "face" | "edge"): void => {
        const entries = rawBody[key];
        if (!Array.isArray(entries)) {
          return;
        }
        let missing: PsTreeNode[] | undefined;
        for (const [index, item] of entries.entries()) {
          if (!isObject(item)) {
            continue;
          }
          const tag = tagKey(kind === "face" ? item.faceTag : item.curveTag);
          const existing = tag === undefined ? undefined
            : (kind === "face" ? facesByBody : edgesByBody).get(body)?.get(tag);
          let node = existing;
          if (!node) {
            node = makeNode(kind, `facetBodies/${bodyIndex}/${key}/${index}`, kind, {
              ...(kind === "face" ? { faceTag: item.faceTag } : { curveTag: item.curveTag }),
              pointCount: Array.isArray(item.points) ? item.points.length / 3 : 0
            });
            if (tag !== undefined) {
              node.kernelTag = kind === "face" ? item.faceTag as number | string : item.curveTag as number | string;
            }
            (missing ??= []).push(node);
          }
          const points = flatCoordinates(item.points, kind === "face" ? 9 : 6, kind === "face" ? 9 : 3);
          if (!points) {
            continue;
          }
          if (kind === "face") {
            faceMeshes.push({ entityId: node.entityId, positions: points, indices: Array.from({ length: points.length / 3 }, (_, n) => n) });
          } else {
            edgePolylines.push({ entityId: node.entityId, points });
          }
        }
        if (missing?.length) {
          body.children.push(...missing);
        }
      };

      addFacetNodes("faces", "face");
      addFacetNodes("curves", "edge");
    }
    if (unpairedBodies.length) {
      root.children.push(...unpairedBodies);
    }
  }

  const reachable = new Set<string>();
  const pending = [root];
  while (pending.length) {
    const node = pending.pop()!;
    if (reachable.has(node.entityId)) {
      continue;
    }
    reachable.add(node.entityId);
    if (node.kind === "vertex") {
      const fields = properties[node.entityId]?.data;
      const geometry = isObject(fields) && isObject(fields.geometry) ? fields.geometry : undefined;
      const nested = isObject(geometry?.geometry) ? geometry.geometry : undefined;
      const position = pointCoordinates(geometry?.point ?? nested?.point);
      if (position) {
        vertexPoints.push({ entityId: node.entityId, position });
      }
    }
    pending.push(...node.children);
  }
  for (const id of Object.keys(properties)) {
    if (!reachable.has(id)) {
      delete properties[id];
    }
  }

  return {
    gksVersion: "0.1",
    sceneId: `ps:${title}`,
    snapshotId: `ps:${title}`,
    title,
    source: { kernel: "PS" },
    topology: { bodies: [], regions: [], shells: [], faces: [], loops: [], coedges: [], edges: [], vertices: [] },
    psTree: [root],
    geometry: { faceMeshes, edgePolylines, vertexPoints },
    properties
  };
}
