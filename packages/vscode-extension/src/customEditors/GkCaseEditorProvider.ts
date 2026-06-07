import * as vscode from "vscode";
import { GksFileLoader, WorkbenchInitialData } from "../gks/GksFileLoader";
import { WebviewHtmlProvider } from "../webview/WebviewHtmlProvider";
import { trackWorkbenchPanel, wireWorkbenchPanelMessages } from "../webview/WorkbenchPanelRegistry";

export class GkCaseEditorProvider implements vscode.CustomReadonlyEditorProvider {
  static readonly viewType = "gkWorkbench.gkcase";

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly loader = new GksFileLoader(),
    private readonly htmlProvider = new WebviewHtmlProvider(context.extensionUri)
  ) {}

  static register(context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(
      GkCaseEditorProvider.viewType,
      new GkCaseEditorProvider(context),
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
    const initialData = await this.loader.loadCase(document.uri);
    configureWorkbenchWebview(webviewPanel, this.htmlProvider, initialData);
    trackWorkbenchPanel(webviewPanel);
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
  caseUri: vscode.Uri
): void {
  wireWorkbenchPanelMessages(webviewPanel, async (message) => {
    if (message?.type !== "requestScene") {
      return undefined;
    }
    const scene = await loader.loadSnapshotScene(caseUri, message.payload?.snapshotId);
    return {
      type: "sceneLoaded",
      requestId: message.requestId,
      payload: { scene }
    };
  });
}
