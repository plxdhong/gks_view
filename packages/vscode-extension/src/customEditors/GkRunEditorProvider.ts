import * as vscode from "vscode";
import { GksFileLoader, type WorkbenchInitialData } from "../gks/GksFileLoader";
import { WebviewHtmlProvider } from "../webview/WebviewHtmlProvider";
import { trackWorkbenchPanel, wireWorkbenchPanelMessages } from "../webview/WorkbenchPanelRegistry";

export class GkRunEditorProvider implements vscode.CustomReadonlyEditorProvider {
  static readonly viewType = "gkWorkbench.gkrun";

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly loader = new GksFileLoader(),
    private readonly htmlProvider = new WebviewHtmlProvider(context.extensionUri)
  ) {}

  static register(context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(
      GkRunEditorProvider.viewType,
      new GkRunEditorProvider(context),
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
    const initialData = await this.loader.loadRun(document.uri);
    configureWorkbenchWebview(webviewPanel, this.htmlProvider, initialData);
    trackWorkbenchPanel(webviewPanel, { mode: "run", resourceUri: document.uri.toString() });
    wireWebviewMessages(webviewPanel, this.loader, document.uri);
  }
}

function configureWorkbenchWebview(
  webviewPanel: vscode.WebviewPanel,
  htmlProvider: WebviewHtmlProvider,
  initialData: WorkbenchInitialData
): void {
  webviewPanel.webview.options = {
    enableScripts: true,
    localResourceRoots: [
      htmlProvider.extensionWebviewRoot
    ]
  };
  webviewPanel.webview.html = htmlProvider.render(webviewPanel.webview, initialData);
}

function wireWebviewMessages(
  webviewPanel: vscode.WebviewPanel,
  loader: GksFileLoader,
  runUri: vscode.Uri
): void {
  wireWorkbenchPanelMessages(webviewPanel, async (message) => {
    if (message?.type !== "requestScene") {
      return undefined;
    }
    const result = await loader.loadRunCaseSnapshotScene(
      runUri,
      message.payload?.caseId,
      message.payload?.snapshotId
    );
    return {
      type: "runSceneLoaded",
      requestId: message.requestId,
      payload: result
    };
  });
}
