import * as vscode from "vscode";
import type { WorkbenchInitialData } from "../gks/GksFileLoader";

export class WebviewHtmlProvider {
  readonly extensionWebviewRoot: vscode.Uri;

  constructor(private readonly extensionUri: vscode.Uri) {
    this.extensionWebviewRoot = vscode.Uri.joinPath(extensionUri, "webview", "dist");
  }

  render(webview: vscode.Webview, initialData: WorkbenchInitialData): string {
    const nonce = makeNonce();
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "webview", "dist", "webview.js"));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "webview", "dist", "webview.css"));
    const initialJson = JSON.stringify(initialData).replace(/</g, "\\u003c");

    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
    <link rel="stylesheet" href="${styleUri}">
    <title>Geometry Workbench</title>
  </head>
  <body>
    <div id="app"></div>
    <script nonce="${nonce}">window.__GK_INITIAL_DATA__ = ${initialJson};</script>
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
  }
}

function makeNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let value = "";
  for (let index = 0; index < 32; index += 1) {
    value += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return value;
}

