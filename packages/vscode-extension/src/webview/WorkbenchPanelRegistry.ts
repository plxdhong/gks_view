import * as vscode from "vscode";

type MessageHandler = (message: any) => Promise<any | undefined>;

const panels = new Set<vscode.WebviewPanel>();

export function trackWorkbenchPanel(panel: vscode.WebviewPanel): void {
  panels.add(panel);
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
  for (const panel of panels) {
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

