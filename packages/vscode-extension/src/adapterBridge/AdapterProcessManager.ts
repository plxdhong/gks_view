import * as cp from "node:child_process";
import * as path from "node:path";
import * as vscode from "vscode";
import type {
  AdapterInitializeResult,
  AdapterManifest
} from "@gk-workbench/gks-schema";
import { JsonRpcClient } from "./JsonRpcClient";

export interface AdapterSession {
  client: JsonRpcClient;
  initializeResult: AdapterInitializeResult;
  manifest: AdapterManifest;
}

export class AdapterProcessManager implements vscode.Disposable {
  private mockSession: AdapterSession | undefined;

  constructor(private readonly extensionUri: vscode.Uri) {}

  async getMockAdapter(workspaceRoot: string): Promise<AdapterSession> {
    if (this.mockSession) {
      return this.mockSession;
    }

    const scriptPath = path.join(this.extensionUri.fsPath, "dist", "mockAdapter", "mockAdapterProcess.js");
    const child = cp.spawn(process.execPath, [scriptPath, "--stdio"], {
      cwd: workspaceRoot,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1"
      },
      stdio: ["pipe", "pipe", "pipe"]
    });
    const client = new JsonRpcClient(child);
    const initializeResult = await client.request<AdapterInitializeResult>("adapter.initialize", {
      client: {
        name: "vscode-geometry-workbench",
        version: "0.1"
      },
      protocolVersion: "0.1",
      workspaceRoot
    });
    const manifest = await client.request<AdapterManifest>("adapter.getManifest", {});
    this.mockSession = { client, initializeResult, manifest };
    return this.mockSession;
  }

  dispose(): void {
    this.mockSession?.client.dispose();
    this.mockSession = undefined;
  }
}

