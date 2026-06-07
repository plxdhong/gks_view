import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AdapterInitializeParams,
  AdapterInitializeResult,
  AdapterManifest,
  CommandExecuteParams,
  CommandExecuteResult,
  CommandListResult,
  EntityGetPropertiesParams,
  EntityGetPropertiesResult,
  EntityIdentity,
  GksScene,
  JsonRpcRequest,
  ModelGetSceneParams,
  ModelGetSceneResult,
  ModelOpenParams,
  ModelOpenResult
} from "@gk-workbench/gks-schema";

const models = new Map<string, GksScene>();
let workspaceRoot = process.cwd();
let buffer = Buffer.alloc(0);
let nextModelId = 1;

process.stdin.on("data", (chunk: Buffer) => {
  buffer = Buffer.concat([buffer, chunk]);
  readFrames();
});

function readFrames(): void {
  while (true) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd < 0) {
      return;
    }

    const header = buffer.subarray(0, headerEnd).toString("utf8");
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (!match) {
      sendError(null, -32600, "missing Content-Length");
      buffer = Buffer.alloc(0);
      return;
    }

    const contentLength = Number(match[1]);
    const bodyStart = headerEnd + 4;
    const frameEnd = bodyStart + contentLength;
    if (buffer.byteLength < frameEnd) {
      return;
    }

    const body = buffer.subarray(bodyStart, frameEnd).toString("utf8");
    buffer = buffer.subarray(frameEnd);

    try {
      const request = JSON.parse(body) as JsonRpcRequest;
      handleRequest(request);
    } catch (error) {
      sendError(null, -32700, error instanceof Error ? error.message : String(error));
    }
  }
}

function handleRequest(request: JsonRpcRequest): void {
  try {
    if (request.method === "adapter.initialize") {
      const params = request.params as AdapterInitializeParams;
      workspaceRoot = params.workspaceRoot ?? workspaceRoot;
      sendResult<AdapterInitializeResult>(request.id, {
        adapterId: "mock.adapter",
        displayName: "Mock Geometry Adapter",
        protocolVersion: "0.1",
        kernel: {
          name: "mock",
          version: "0.1"
        },
        mode: "readonly",
        capabilities: {
          readonly: true,
          interactive: false,
          transactional: false,
          multiModel: true,
          getScene: true,
          getTopology: true,
          getEntityProperties: true,
          tessellation: true,
          commands: true
        }
      });
      return;
    }

    if (request.method === "adapter.getManifest") {
      sendResult<AdapterManifest>(request.id, {
        adapterId: "mock.adapter",
        displayName: "Mock Geometry Adapter",
        mode: "readonly",
        supportedFileTypes: [".gkscene.json", "mock://cube", "mock://cylinder-hole", "mock://hole-grow"],
        commands: [
          {
            commandId: "query.entityProperties",
            title: "Entity Properties",
            level: 1,
            selectionKinds: ["face", "edge", "vertex"]
          },
          {
            commandId: "feature.identifyHole",
            title: "Identify Hole",
            level: 2,
            selectionKinds: ["face"]
          }
        ]
      });
      return;
    }

    if (request.method === "model.open") {
      const result = openModel(request.params as ModelOpenParams);
      sendResult<ModelOpenResult>(request.id, result);
      return;
    }

    if (request.method === "model.close") {
      const modelId = (request.params as { modelId?: string }).modelId;
      if (modelId) {
        models.delete(modelId);
      }
      sendResult(request.id, { closed: true });
      return;
    }

    if (request.method === "model.getScene") {
      const result = getScene(request.params as ModelGetSceneParams);
      sendResult<ModelGetSceneResult>(request.id, result);
      return;
    }

    if (request.method === "entity.getProperties") {
      const result = getProperties(request.params as EntityGetPropertiesParams);
      sendResult<EntityGetPropertiesResult>(request.id, result);
      return;
    }

    if (request.method === "command.list") {
      sendResult<CommandListResult>(request.id, {
        commands: [
          {
            commandId: "feature.identifyHole",
            title: "Identify Hole",
            level: 2,
            selectionKinds: ["face"]
          }
        ]
      });
      return;
    }

    if (request.method === "command.execute") {
      sendResult<CommandExecuteResult>(request.id, executeCommand(request.params as CommandExecuteParams));
      return;
    }

    sendError(request.id, -32601, `method not found: ${request.method}`);
  } catch (error) {
    const code = error instanceof AdapterError ? error.code : -32603;
    sendError(request.id, code, error instanceof Error ? error.message : String(error));
  }
}

function openModel(params: ModelOpenParams): ModelOpenResult {
  const scenePath = resolveScenePath(params.uri);
  const scene = readJson<GksScene>(scenePath);
  const modelId = `mock-model-${nextModelId++}`;
  models.set(modelId, scene);
  return {
    modelId,
    displayName: scene.title ?? path.basename(scenePath),
    unit: scene.unit,
    bodyCount: scene.topology.bodies.length
  };
}

function getScene(params: ModelGetSceneParams): ModelGetSceneResult {
  const scene = modelScene(params.modelId);
  return { scene };
}

function getProperties(params: EntityGetPropertiesParams): EntityGetPropertiesResult {
  const scene = modelScene(params.modelId);
  const entity = findEntity(scene, params.entityId);
  if (!entity) {
    throw new AdapterError(-32002, `entity not found: ${params.entityId}`);
  }
  return {
    entityId: params.entityId,
    kind: entity.kind,
    properties: {
      identity: entity,
      ...(scene.properties?.[params.entityId] ?? {})
    }
  };
}

function executeCommand(params: CommandExecuteParams): CommandExecuteResult {
  const scene = modelScene(params.modelId);
  if (params.commandId !== "feature.identifyHole") {
    throw new AdapterError(-32003, `command not found: ${params.commandId}`);
  }

  const seed = params.selection?.[0]?.entityId;
  const holeFace = scene.topology.faces.find((face) => face.entityId.includes("inner_wall"))?.entityId
    ?? seed
    ?? scene.debug?.highlights?.faces?.[0]
    ?? scene.topology.faces[0]?.entityId;
  if (!holeFace) {
    return {
      status: "error",
      message: "No face candidate found"
    };
  }

  return {
    status: "ok",
    message: "Mock hole identified",
    highlights: {
      faces: [holeFace],
      edges: scene.debug?.highlights?.edges ?? []
    },
    data: {
      holeType: "mock",
      componentCount: 1,
      source: "mock.adapter"
    },
    transientObjects: []
  };
}

function modelScene(modelId: string): GksScene {
  const scene = models.get(modelId);
  if (!scene) {
    throw new AdapterError(-32001, `model not found: ${modelId}`);
  }
  return scene;
}

function findEntity(scene: GksScene, entityId: string): EntityIdentity | undefined {
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
    const entity = bucket.find((item) => item.entityId === entityId);
    if (entity) {
      return entity;
    }
  }
  return undefined;
}

function resolveScenePath(uri: string): string {
  if (uri === "mock://cube") {
    return path.join(workspaceRoot, "examples/mock/Cube.Case_001/00_cube.gkscene.json");
  }
  if (uri === "mock://cylinder-hole") {
    return path.join(workspaceRoot, "examples/mock/CylinderHole.Case_001/00_cylinder_hole.gkscene.json");
  }
  if (uri === "mock://hole-grow") {
    return path.join(workspaceRoot, "examples/mock/HoleGrow.Case_001/02_after_grow.gkscene.json");
  }
  if (uri.startsWith("file://")) {
    return fileURLToPath(uri);
  }
  return path.resolve(workspaceRoot, uri);
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function sendResult<TResult>(id: string | number, result: TResult): void {
  send({ jsonrpc: "2.0", id, result });
}

function sendError(id: string | number | null, code: number, message: string): void {
  send({
    jsonrpc: "2.0",
    id,
    error: { code, message }
  });
}

function send(payload: unknown): void {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  process.stdout.write(`Content-Length: ${body.byteLength}\r\n\r\n`);
  process.stdout.write(body);
}

class AdapterError extends Error {
  constructor(readonly code: number, message: string) {
    super(message);
  }
}

