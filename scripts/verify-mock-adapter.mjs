import cp from "node:child_process";

const child = cp.spawn(process.execPath, [
  "packages/vscode-extension/dist/mockAdapter/mockAdapterProcess.js",
  "--stdio"
], {
  cwd: process.cwd(),
  stdio: ["pipe", "pipe", "pipe"]
});

let nextId = 1;
let buffer = Buffer.alloc(0);
const pending = new Map();

child.stdout.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd < 0) {
      return;
    }

    const header = buffer.subarray(0, headerEnd).toString("utf8");
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (!match) {
      throw new Error("Adapter response is missing Content-Length");
    }

    const contentLength = Number(match[1]);
    const bodyStart = headerEnd + 4;
    const frameEnd = bodyStart + contentLength;
    if (buffer.byteLength < frameEnd) {
      return;
    }

    const message = JSON.parse(buffer.subarray(bodyStart, frameEnd).toString("utf8"));
    buffer = buffer.subarray(frameEnd);
    pending.get(message.id)?.(message);
  }
});

child.stderr.on("data", (chunk) => {
  process.stderr.write(chunk);
});

function request(method, params) {
  const id = nextId++;
  const body = Buffer.from(JSON.stringify({
    jsonrpc: "2.0",
    id,
    method,
    params
  }), "utf8");
  child.stdin.write(Buffer.concat([
    Buffer.from(`Content-Length: ${body.byteLength}\r\n\r\n`, "utf8"),
    body
  ]));

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timed out waiting for ${method}`));
    }, 5000);
    pending.set(id, (message) => {
      clearTimeout(timer);
      pending.delete(id);
      if (message.error) {
        reject(new Error(message.error.message));
      } else {
        resolve(message.result);
      }
    });
  });
}

try {
  const initialize = await request("adapter.initialize", {
    client: { name: "verify-mock-adapter", version: "0.1" },
    protocolVersion: "0.1",
    workspaceRoot: process.cwd()
  });
  const manifest = await request("adapter.getManifest", {});
  const model = await request("model.open", {
    uri: "mock://cylinder-hole",
    options: { readOnly: true }
  });
  const sceneResult = await request("model.getScene", {
    modelId: model.modelId,
    options: {
      includeTopology: true,
      includeGeometry: true,
      includeProperties: true
    }
  });
  const properties = await request("entity.getProperties", {
    modelId: model.modelId,
    entityId: "face:inner_wall"
  });

  console.log(JSON.stringify({
    adapterId: initialize.adapterId,
    commandCount: manifest.commands.length,
    modelId: model.modelId,
    sceneId: sceneResult.scene.sceneId,
    propertyEntity: properties.entityId,
    propertyKind: properties.kind
  }, null, 2));
} finally {
  child.kill();
}

