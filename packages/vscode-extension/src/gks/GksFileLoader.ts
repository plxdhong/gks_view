import * as path from "node:path";
import * as vscode from "vscode";
import type { GksCase, GksCompare, GksScene } from "@gk-workbench/gks-schema";

export interface WorkbenchInitialData {
  mode: "case" | "scene" | "compare" | "adapter";
  case?: GksCase;
  compare?: GksCompare;
  snapshots: {
    snapshotId: string;
    title?: string;
    file?: string;
  }[];
  activeSnapshotId: string;
  scene: GksScene;
  compareScenes?: {
    viewId: string;
    title: string;
    scene: GksScene;
  }[];
  adapter?: {
    adapterId: string;
    displayName: string;
    modelId: string;
  };
}

export class GksFileLoader {
  async loadCase(uri: vscode.Uri): Promise<WorkbenchInitialData> {
    const gkcase = await this.readJson<GksCase>(uri);
    const firstSnapshot = gkcase.snapshots[0];
    if (!firstSnapshot) {
      throw new Error(`${uri.fsPath} does not contain any snapshots`);
    }

    const scene = await this.loadSnapshotScene(uri, firstSnapshot.snapshotId);
    return {
      mode: "case",
      case: gkcase,
      snapshots: gkcase.snapshots,
      activeSnapshotId: firstSnapshot.snapshotId,
      scene
    };
  }

  async loadSingleScene(uri: vscode.Uri): Promise<WorkbenchInitialData> {
    const scene = await this.readJson<GksScene>(uri);
    return {
      mode: "scene",
      snapshots: [{
        snapshotId: scene.snapshotId,
        title: scene.title,
        file: path.basename(uri.fsPath)
      }],
      activeSnapshotId: scene.snapshotId,
      scene
    };
  }

  async loadCompare(uri: vscode.Uri): Promise<WorkbenchInitialData> {
    const compare = await this.readJson<GksCompare>(uri);
    const compareScenes = await Promise.all(compare.scenes.map(async (sceneRef) => ({
      viewId: sceneRef.viewId,
      title: sceneRef.title ?? sceneRef.viewId,
      scene: await this.readJson<GksScene>(relativeFileUri(uri, sceneRef.file))
    })));
    const first = compareScenes[0];
    if (!first) {
      throw new Error(`${uri.fsPath} does not contain any compare scenes`);
    }

    return {
      mode: "compare",
      compare,
      snapshots: compareScenes.map((item) => ({
        snapshotId: item.viewId,
        title: item.title
      })),
      activeSnapshotId: first.viewId,
      scene: first.scene,
      compareScenes
    };
  }

  async loadSnapshotScene(caseUri: vscode.Uri, snapshotId?: string): Promise<GksScene> {
    const gkcase = await this.readJson<GksCase>(caseUri);
    const snapshot = gkcase.snapshots.find((item) => item.snapshotId === snapshotId) ?? gkcase.snapshots[0];
    if (!snapshot) {
      throw new Error(`${caseUri.fsPath} does not contain any snapshots`);
    }
    return this.readJson<GksScene>(relativeFileUri(caseUri, snapshot.file));
  }

  private async readJson<T>(uri: vscode.Uri): Promise<T> {
    const bytes = await vscode.workspace.fs.readFile(uri);
    return JSON.parse(Buffer.from(bytes).toString("utf8")) as T;
  }
}

function relativeFileUri(baseUri: vscode.Uri, relativePath: string): vscode.Uri {
  return vscode.Uri.file(path.resolve(path.dirname(baseUri.fsPath), relativePath));
}
