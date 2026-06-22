import * as path from "node:path";
import * as vscode from "vscode";
import type { WorkbenchInitialData } from "../gks/GksFileLoader";
import { postWorkbenchUpdated } from "../webview/WorkbenchPanelRegistry";

type WorkbenchLoader = () => Promise<WorkbenchInitialData>;

export function watchWorkbenchJsonFiles(
  webviewPanel: vscode.WebviewPanel,
  documentUri: vscode.Uri,
  pattern: string,
  loadWorkbench: WorkbenchLoader
): void {
  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(path.dirname(documentUri.fsPath), pattern)
  );
  let refreshTimer: NodeJS.Timeout | undefined;
  let disposed = false;

  const scheduleRefresh = (): void => {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
    }
    refreshTimer = setTimeout(() => {
      refreshTimer = undefined;
      refreshWorkbench().catch((error) => {
        console.warn(`Geometry Workbench failed to refresh ${documentUri.fsPath}:`, error);
      });
    }, 180);
  };

  const refreshWorkbench = async (): Promise<void> => {
    if (disposed) {
      return;
    }
    try {
      const data = await loadWithRetry(loadWorkbench);
      await postWorkbenchUpdated(webviewPanel, data);
    } catch (error) {
      await webviewPanel.webview.postMessage({
        type: "error",
        payload: { message: error instanceof Error ? error.message : String(error) }
      });
    }
  };

  const disposables = [
    watcher,
    watcher.onDidCreate(scheduleRefresh),
    watcher.onDidChange(scheduleRefresh),
    watcher.onDidDelete(scheduleRefresh)
  ];

  webviewPanel.onDidDispose(() => {
    disposed = true;
    if (refreshTimer) {
      clearTimeout(refreshTimer);
    }
    for (const disposable of disposables) {
      disposable.dispose();
    }
  });
}

async function loadWithRetry(loadWorkbench: WorkbenchLoader): Promise<WorkbenchInitialData> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await loadWorkbench();
    } catch (error) {
      lastError = error;
      await delay(120);
    }
  }
  throw lastError;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
