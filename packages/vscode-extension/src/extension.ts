import * as path from "node:path";
import * as vscode from "vscode";
import type { ModelGetSceneResult, ModelOpenResult } from "@gk-workbench/gks-schema";
import { AdapterProcessManager } from "./adapterBridge/AdapterProcessManager";
import { GkCaseEditorProvider } from "./customEditors/GkCaseEditorProvider";
import { GkCompareEditorProvider } from "./customEditors/GkCompareEditorProvider";
import { GkSceneEditorProvider } from "./customEditors/GkSceneEditorProvider";
import { openAdapterWorkbench } from "./webview/AdapterWorkbenchPanel";
import { revealEntityInWorkbenchPanels } from "./webview/WorkbenchPanelRegistry";

export function activate(context: vscode.ExtensionContext): void {
  const adapterProcessManager = new AdapterProcessManager(context.extensionUri);
  context.subscriptions.push(
    adapterProcessManager,
    GkCaseEditorProvider.register(context),
    GkCompareEditorProvider.register(context),
    GkSceneEditorProvider.register(context),
    vscode.commands.registerCommand("gkWorkbench.openSnapshot", async (uri?: vscode.Uri) => {
      const target = uri ?? await pickGksFile("Open GKS Snapshot");
      if (target) {
        await vscode.commands.executeCommand("vscode.openWith", target, viewTypeForUri(target));
      }
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
      "GKS Files": ["gkcase.json", "gkscene.json", "gkcompare.json"],
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
  return GkSceneEditorProvider.viewType;
}

function workspaceRootPath(context: vscode.ExtensionContext): string {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    ?? path.resolve(context.extensionUri.fsPath, "..", "..");
}
