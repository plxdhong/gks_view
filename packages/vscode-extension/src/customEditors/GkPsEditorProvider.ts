import * as vscode from "vscode";
import { GksFileLoader } from "../gks/GksFileLoader";
import { WebviewHtmlProvider } from "../webview/WebviewHtmlProvider";
import { trackWorkbenchPanel } from "../webview/WorkbenchPanelRegistry";
import { watchWorkbenchJsonFiles } from "./watchWorkbenchJsonFiles";

export class GkPsEditorProvider implements vscode.CustomReadonlyEditorProvider {
  static readonly viewType = "gkWorkbench.ps";

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly loader = new GksFileLoader(),
    private readonly htmlProvider = new WebviewHtmlProvider(context.extensionUri)
  ) {}

  static register(context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(GkPsEditorProvider.viewType, new GkPsEditorProvider(context), {
      supportsMultipleEditorsPerDocument: true,
      webviewOptions: { retainContextWhenHidden: true }
    });
  }

  async openCustomDocument(uri: vscode.Uri): Promise<vscode.CustomDocument> {
    return { uri, dispose: () => undefined };
  }

  async resolveCustomEditor(document: vscode.CustomDocument, webviewPanel: vscode.WebviewPanel): Promise<void> {
    const initialData = await this.loader.loadPsPair(document.uri);
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.htmlProvider.extensionWebviewRoot]
    };
    webviewPanel.webview.html = this.htmlProvider.render(webviewPanel.webview, initialData);
    trackWorkbenchPanel(webviewPanel, { mode: "scene", resourceUri: document.uri.toString() });
    watchWorkbenchJsonFiles(webviewPanel, document.uri, "*.json", () => this.loader.loadPsPair(document.uri));
  }
}
