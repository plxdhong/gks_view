import * as vscode from "vscode";
import type {
  AdapterInitializeResult,
  AdapterManifest,
  EntityGetPropertiesResult,
  GksScene,
  ModelGetSceneResult
} from "@gk-workbench/gks-schema";
import type { JsonRpcClient } from "../adapterBridge/JsonRpcClient";
import { WorkbenchInitialData } from "../gks/GksFileLoader";
import { WebviewHtmlProvider } from "./WebviewHtmlProvider";
import { trackWorkbenchPanel, wireWorkbenchPanelMessages } from "./WorkbenchPanelRegistry";

export interface OpenAdapterWorkbenchOptions {
  context: vscode.ExtensionContext;
  client: JsonRpcClient;
  initializeResult: AdapterInitializeResult;
  manifest: AdapterManifest;
  modelId: string;
  scene: GksScene;
}

export function openAdapterWorkbench(options: OpenAdapterWorkbenchOptions): vscode.WebviewPanel {
  const htmlProvider = new WebviewHtmlProvider(options.context.extensionUri);
  const title = `Geometry: ${options.scene.title ?? options.modelId}`;
  const panel = vscode.window.createWebviewPanel(
    "gkWorkbench.adapter",
    title,
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [htmlProvider.extensionWebviewRoot]
    }
  );

  const initialData: WorkbenchInitialData = {
    mode: "adapter",
    snapshots: [{
      snapshotId: options.scene.snapshotId,
      title: options.scene.title ?? options.scene.snapshotId
    }],
    activeSnapshotId: options.scene.snapshotId,
    scene: options.scene,
    adapter: {
      adapterId: options.initializeResult.adapterId,
      displayName: options.initializeResult.displayName,
      modelId: options.modelId
    }
  };
  panel.webview.html = htmlProvider.render(panel.webview, initialData);
  trackWorkbenchPanel(panel);

  wireWorkbenchPanelMessages(panel, async (message) => {
    if (message?.type === "requestScene") {
      const result = await options.client.request<ModelGetSceneResult>("model.getScene", {
        modelId: options.modelId,
        options: {
          includeTopology: true,
          includeGeometry: true,
          includeProperties: true
        }
      });
      return {
        type: "sceneLoaded",
        requestId: message.requestId,
        payload: { scene: result.scene }
      };
    }

    if (message?.type === "requestEntityProperties") {
      const result = await options.client.request<EntityGetPropertiesResult>("entity.getProperties", {
        modelId: options.modelId,
        entityId: message.payload?.entityId
      });
      return {
        type: "entityPropertiesLoaded",
        requestId: message.requestId,
        payload: result
      };
    }

    return undefined;
  });

  panel.onDidDispose(() => {
    options.client.request("model.close", { modelId: options.modelId }).catch(() => undefined);
  });

  return panel;
}

