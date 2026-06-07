import * as vscode from "vscode";
import { GksFileLoader } from "../gks/GksFileLoader";
import { WebviewHtmlProvider } from "../webview/WebviewHtmlProvider";
import { trackWorkbenchPanel, wireWorkbenchPanelMessages } from "../webview/WorkbenchPanelRegistry";

export class GkCompareEditorProvider implements vscode.CustomReadonlyEditorProvider {
  static readonly viewType = "gkWorkbench.gkcompare";

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly loader = new GksFileLoader(),
    private readonly htmlProvider = new WebviewHtmlProvider(context.extensionUri)
  ) {}

  static register(context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(
      GkCompareEditorProvider.viewType,
      new GkCompareEditorProvider(context),
      {
        supportsMultipleEditorsPerDocument: true,
        webviewOptions: {
          retainContextWhenHidden: true
        }
      }
    );
  }

  async openCustomDocument(uri: vscode.Uri): Promise<vscode.CustomDocument> {
    return { uri, dispose: () => undefined };
  }

  async resolveCustomEditor(
    document: vscode.CustomDocument,
    webviewPanel: vscode.WebviewPanel
  ): Promise<void> {
    const initialData = await this.loader.loadCompare(document.uri);
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        this.htmlProvider.extensionWebviewRoot
      ]
    };
    webviewPanel.webview.html = this.htmlProvider.render(webviewPanel.webview, initialData);
    trackWorkbenchPanel(webviewPanel);
    wireWorkbenchPanelMessages(webviewPanel, async (message) => {
      if (message?.type !== "requestScene") {
        return undefined;
      }
      const viewId = message.payload?.snapshotId;
      const scene = initialData.compareScenes?.find((item) => item.viewId === viewId)?.scene ?? initialData.scene;
      return {
        type: "sceneLoaded",
        requestId: message.requestId,
        payload: { scene }
      };
    });
  }
}

