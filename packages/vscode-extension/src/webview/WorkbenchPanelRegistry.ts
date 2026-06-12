import * as vscode from "vscode";
import type { WorkbenchInitialData } from "../gks/GksFileLoader";

type MessageHandler = (message: any) => Promise<any | undefined>;
type WorkbenchPanelMetadata = {
  mode?: string;
  resourceUri?: string;
};

const panels = new Map<vscode.WebviewPanel, WorkbenchPanelMetadata | undefined>();

export function trackWorkbenchPanel(panel: vscode.WebviewPanel, metadata?: WorkbenchPanelMetadata): void {
  panels.set(panel, metadata);
  panel.onDidDispose(() => panels.delete(panel));
}

export function wireWorkbenchPanelMessages(panel: vscode.WebviewPanel, handler: MessageHandler): void {
  panel.webview.onDidReceiveMessage(async (message) => {
    try {
      const response = await handler(message);
      if (response) {
        await panel.webview.postMessage(response);
      }
    } catch (error) {
      await panel.webview.postMessage({
        type: "error",
        requestId: message?.requestId,
        payload: { message: error instanceof Error ? error.message : String(error) }
      });
    }
  });
}

export async function revealEntityInWorkbenchPanels(query: string): Promise<number> {
  let delivered = 0;
  for (const panel of panels.keys()) {
    const accepted = await panel.webview.postMessage({
      type: "revealEntity",
      payload: { query }
    });
    if (accepted) {
      delivered += 1;
    }
  }
  return delivered;
}

export async function refreshRunWorkbenchPanels(uri: vscode.Uri, data: WorkbenchInitialData): Promise<number> {
  const resourceUri = uri.toString();
  let delivered = 0;
  for (const [panel, metadata] of panels) {
    if (metadata?.mode !== "run" || metadata.resourceUri !== resourceUri) {
      continue;
    }
    const accepted = await panel.webview.postMessage({
      type: "runUpdated",
      payload: { data }
    });
    if (accepted) {
      delivered += 1;
    }
  }
  return delivered;
}

export function countRunWorkbenchPanels(uri: vscode.Uri): number {
  const resourceUri = uri.toString();
  let count = 0;
  for (const metadata of panels.values()) {
    if (metadata?.mode === "run" && metadata.resourceUri === resourceUri) {
      count += 1;
    }
  }
  return count;
}
