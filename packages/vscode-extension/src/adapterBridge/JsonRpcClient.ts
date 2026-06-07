import { ChildProcessWithoutNullStreams } from "node:child_process";
import type { JsonRpcResponse } from "@gk-workbench/gks-schema";

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export class JsonRpcClient {
  private nextId = 1;
  private buffer = Buffer.alloc(0);
  private readonly pending = new Map<number, PendingRequest>();

  constructor(private readonly process: ChildProcessWithoutNullStreams) {
    process.stdout.on("data", (chunk: Buffer) => this.handleData(chunk));
    process.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8").trim();
      if (text) {
        console.warn(`[gk adapter] ${text}`);
      }
    });
    process.on("exit", (code, signal) => {
      const error = new Error(`Adapter process exited (${signal ?? code ?? "unknown"})`);
      for (const request of this.pending.values()) {
        request.reject(error);
      }
      this.pending.clear();
    });
  }

  request<TResult = unknown>(method: string, params?: unknown): Promise<TResult> {
    const id = this.nextId++;
    const payload = {
      jsonrpc: "2.0",
      id,
      method,
      params
    };
    const body = Buffer.from(JSON.stringify(payload), "utf8");
    const header = Buffer.from(`Content-Length: ${body.byteLength}\r\n\r\n`, "utf8");
    this.process.stdin.write(Buffer.concat([header, body]));

    return new Promise<TResult>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as TResult),
        reject
      });
    });
  }

  dispose(): void {
    this.process.kill();
  }

  private handleData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) {
        return;
      }

      const header = this.buffer.subarray(0, headerEnd).toString("utf8");
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) {
        this.buffer = Buffer.alloc(0);
        throw new Error("Adapter returned a JSON-RPC frame without Content-Length");
      }

      const contentLength = Number(match[1]);
      const bodyStart = headerEnd + 4;
      const frameEnd = bodyStart + contentLength;
      if (this.buffer.byteLength < frameEnd) {
        return;
      }

      const body = this.buffer.subarray(bodyStart, frameEnd).toString("utf8");
      this.buffer = this.buffer.subarray(frameEnd);
      this.handleMessage(JSON.parse(body) as JsonRpcResponse);
    }
  }

  private handleMessage(message: JsonRpcResponse): void {
    const request = this.pending.get(Number(message.id));
    if (!request) {
      return;
    }
    this.pending.delete(Number(message.id));

    if ("error" in message) {
      request.reject(new Error(message.error.message));
      return;
    }
    request.resolve(message.result);
  }
}

