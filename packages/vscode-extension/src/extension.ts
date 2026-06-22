import * as path from "node:path";
import * as vscode from "vscode";
import type { ModelGetSceneResult, ModelOpenResult } from "@gk-workbench/gks-schema";
import { AdapterProcessManager } from "./adapterBridge/AdapterProcessManager";
import { GkCaseEditorProvider } from "./customEditors/GkCaseEditorProvider";
import { GkCompareEditorProvider } from "./customEditors/GkCompareEditorProvider";
import { GkRunEditorProvider } from "./customEditors/GkRunEditorProvider";
import { GkSceneEditorProvider } from "./customEditors/GkSceneEditorProvider";
import { GksFileLoader, type WorkbenchInitialData } from "./gks/GksFileLoader";
import { openAdapterWorkbench } from "./webview/AdapterWorkbenchPanel";
import {
  countRunWorkbenchPanels,
  refreshRunWorkbenchPanels,
  revealEntityInWorkbenchPanels
} from "./webview/WorkbenchPanelRegistry";

export function activate(context: vscode.ExtensionContext): void {
  const adapterProcessManager = new AdapterProcessManager(context.extensionUri);
  const runLoader = new GksFileLoader();
  context.subscriptions.push(
    adapterProcessManager,
    GkCaseEditorProvider.register(context),
    GkCompareEditorProvider.register(context),
    GkRunEditorProvider.register(context),
    GkSceneEditorProvider.register(context),
    createRunIndexWatcher(runLoader),
    vscode.commands.registerCommand("gkWorkbench.openSnapshot", async (uri?: vscode.Uri) => {
      const target = uri ?? await pickGksFile("Open GKS Snapshot");
      if (target) {
        await vscode.commands.executeCommand("vscode.openWith", target, viewTypeForUri(target));
      }
    }),
    vscode.commands.registerCommand("gkWorkbench.openLatestRun", async () => {
      const target = await findLatestRunIndex();
      if (!target) {
        vscode.window.showWarningMessage("No .gk-workbench/runs/**/run.gkrun.json file found in this workspace.");
        return;
      }
      await openRunIndex(target, runLoader, false);
    }),
    vscode.commands.registerCommand("gkWorkbench.revealEntity", async () => {
      const entityId = await vscode.window.showInputBox({
        title: "Reveal GKS Entity",
        prompt: "Enter an entityId or kernel tag",
        placeHolder: "face:top"
      });
      if (!entityId) {
        return;
      }
      const delivered = await revealEntityInWorkbenchPanels(entityId);
      if (delivered === 0) {
        vscode.window.showWarningMessage("Open a GKS workbench before revealing an entity.");
      } else {
        vscode.window.showInformationMessage(`Reveal request sent for ${entityId}`);
      }
    }),
    vscode.commands.registerCommand("gkWorkbench.attachAdapter", async () => {
      const workspaceRoot = workspaceRootPath(context);
      const session = await adapterProcessManager.getMockAdapter(workspaceRoot);
      const target = await vscode.window.showQuickPick([
        {
          label: "Cube",
          description: "mock://cube",
          uri: "mock://cube"
        },
        {
          label: "Cylinder hole",
          description: "mock://cylinder-hole",
          uri: "mock://cylinder-hole"
        },
        {
          label: "HoleGrow after grow",
          description: "mock://hole-grow",
          uri: "mock://hole-grow"
        }
      ], {
        title: "Attach Mock Geometry Adapter",
        placeHolder: "Choose a mock model"
      });
      if (!target) {
        return;
      }

      const model = await session.client.request<ModelOpenResult>("model.open", {
        uri: target.uri,
        options: { readOnly: true }
      });
      const sceneResult = await session.client.request<ModelGetSceneResult>("model.getScene", {
        modelId: model.modelId,
        options: {
          includeTopology: true,
          includeGeometry: true,
          includeProperties: true
        }
      });
      openAdapterWorkbench({
        context,
        client: session.client,
        initializeResult: session.initializeResult,
        manifest: session.manifest,
        modelId: model.modelId,
        scene: sceneResult.scene
      });
      vscode.window.showInformationMessage(`${session.initializeResult.displayName} attached: ${target.label}`);
    })
  );
}

export function deactivate(): void {
  // VSCode disposes subscriptions registered during activation.
}

async function pickGksFile(title: string): Promise<vscode.Uri | undefined> {
  const result = await vscode.window.showOpenDialog({
    title,
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    filters: {
      "GKS Files": ["gkcase.json", "gkscene.json", "gkcompare.json", "gkrun.json"],
      "JSON": ["json"]
    }
  });
  return result?.[0];
}

function viewTypeForUri(uri: vscode.Uri): string {
  const path = uri.path.toLowerCase();
  if (path.endsWith(".gkcase.json")) {
    return GkCaseEditorProvider.viewType;
  }
  if (path.endsWith(".gkcompare.json")) {
    return GkCompareEditorProvider.viewType;
  }
  if (path.endsWith(".gkrun.json")) {
    return GkRunEditorProvider.viewType;
  }
  return GkSceneEditorProvider.viewType;
}

function createRunIndexWatcher(loader: GksFileLoader): vscode.Disposable {
  const watcher = vscode.workspace.createFileSystemWatcher("**/.gk-workbench/runs/**/run.gkrun.json");
  const timers = new Map<string, NodeJS.Timeout>();

  const scheduleOpen = (uri: vscode.Uri): void => {
    const key = uri.toString();
    const existing = timers.get(key);
    if (existing) {
      clearTimeout(existing);
    }
    timers.set(key, setTimeout(() => {
      timers.delete(key);
      openRunIndex(uri, loader, true).catch((error) => {
        console.warn(`Geometry Workbench failed to open ${uri.fsPath}:`, error);
      });
    }, 300));
  };

  const disposables = [
    watcher,
    watcher.onDidCreate(scheduleOpen),
    watcher.onDidChange(scheduleOpen)
  ];

  return new vscode.Disposable(() => {
    for (const timer of timers.values()) {
      clearTimeout(timer);
    }
    for (const disposable of disposables) {
      disposable.dispose();
    }
  });
}

async function findLatestRunIndex(): Promise<vscode.Uri | undefined> {
  const files = await vscode.workspace.findFiles("**/.gk-workbench/runs/**/run.gkrun.json", "**/node_modules/**", 200);
  const stats = await Promise.all(files.map(async (uri) => ({
    uri,
    stat: await vscode.workspace.fs.stat(uri)
  })));
  stats.sort((left, right) => right.stat.mtime - left.stat.mtime);
  return stats[0]?.uri;
}

async function openRunIndex(uri: vscode.Uri, loader: GksFileLoader, silent: boolean): Promise<void> {
  const data = await loadRunWithRetry(loader, uri);
  const existingPanels = countRunWorkbenchPanels(uri);
  if (!silent || existingPanels === 0) {
    await vscode.commands.executeCommand("vscode.openWith", uri, GkRunEditorProvider.viewType, { preview: false });
  }
  await refreshRunWorkbenchPanels(uri, data);
  if (!silent) {
    vscode.window.showInformationMessage(`Opened geometry run ${data.run?.title ?? data.run?.runId ?? uri.fsPath}`);
  }
}

async function loadRunWithRetry(loader: GksFileLoader, uri: vscode.Uri): Promise<WorkbenchInitialData> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await loader.loadRun(uri);
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

function workspaceRootPath(context: vscode.ExtensionContext): string {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    ?? path.resolve(context.extensionUri.fsPath, "..", "..");
}
