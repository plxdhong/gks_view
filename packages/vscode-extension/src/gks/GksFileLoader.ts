import * as path from "node:path";
import * as vscode from "vscode";
import type { GksCase, GksCompare, GksRun, GksRunCaseRef, GksScene } from "@gk-workbench/gks-schema";

export interface WorkbenchInitialData {
  mode: "case" | "scene" | "compare" | "run" | "adapter";
  case?: GksCase;
  caseBasePath?: string;
  compare?: GksCompare;
  run?: GksRun;
  runCases?: WorkbenchRunCase[];
  activeRunCaseId?: string;
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

export interface WorkbenchRunCase extends GksRunCaseRef {
  case: GksCase;
  caseBasePath: string;
  snapshots: {
    snapshotId: string;
    title?: string;
    file?: string;
  }[];
  activeSnapshotId: string;
  scene: GksScene;
}

export interface WorkbenchRunSceneResult {
  activeRunCaseId: string;
  case: GksCase;
  caseBasePath: string;
  snapshots: {
    snapshotId: string;
    title?: string;
    file?: string;
  }[];
  activeSnapshotId: string;
  scene: GksScene;
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
      caseBasePath: path.dirname(uri.fsPath),
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

  async loadRun(uri: vscode.Uri): Promise<WorkbenchInitialData> {
    const run = await this.readJson<GksRun>(uri);
    if (!run.cases.length) {
      throw new Error(`${uri.fsPath} does not contain any cases`);
    }

    const runCases = await Promise.all(run.cases.map((caseRef) => this.loadRunCase(uri, caseRef)));
    const activeRunCase = runCases[0];
    if (!activeRunCase) {
      throw new Error(`${uri.fsPath} does not contain any loadable cases`);
    }

    return {
      mode: "run",
      run,
      runCases,
      activeRunCaseId: activeRunCase.caseId,
      case: activeRunCase.case,
      caseBasePath: activeRunCase.caseBasePath,
      snapshots: activeRunCase.snapshots,
      activeSnapshotId: activeRunCase.activeSnapshotId,
      scene: activeRunCase.scene
    };
  }

  async loadRunCaseSnapshotScene(
    runUri: vscode.Uri,
    caseId?: string,
    snapshotId?: string
  ): Promise<WorkbenchRunSceneResult> {
    const run = await this.readJson<GksRun>(runUri);
    const caseRef = run.cases.find((item) => item.caseId === caseId) ?? run.cases[0];
    if (!caseRef) {
      throw new Error(`${runUri.fsPath} does not contain any cases`);
    }

    const caseUri = relativeFileUri(runUri, caseRef.file);
    const gkcase = await this.readJson<GksCase>(caseUri);
    const snapshot = gkcase.snapshots.find((item) => item.snapshotId === snapshotId) ?? gkcase.snapshots[0];
    if (!snapshot) {
      throw new Error(`${caseUri.fsPath} does not contain any snapshots`);
    }

    return {
      activeRunCaseId: caseRef.caseId,
      case: gkcase,
      caseBasePath: path.dirname(caseUri.fsPath),
      snapshots: gkcase.snapshots,
      activeSnapshotId: snapshot.snapshotId,
      scene: await this.readJson<GksScene>(relativeFileUri(caseUri, snapshot.file))
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

  private async loadRunCase(runUri: vscode.Uri, caseRef: GksRunCaseRef): Promise<WorkbenchRunCase> {
    const caseUri = relativeFileUri(runUri, caseRef.file);
    const gkcase = await this.readJson<GksCase>(caseUri);
    const firstSnapshot = gkcase.snapshots[0];
    if (!firstSnapshot) {
      throw new Error(`${caseUri.fsPath} does not contain any snapshots`);
    }

    return {
      ...caseRef,
      title: caseRef.title ?? gkcase.title,
      case: gkcase,
      caseBasePath: path.dirname(caseUri.fsPath),
      snapshots: gkcase.snapshots,
      activeSnapshotId: firstSnapshot.snapshotId,
      scene: await this.readJson<GksScene>(relativeFileUri(caseUri, firstSnapshot.file))
    };
  }
}

function relativeFileUri(baseUri: vscode.Uri, relativePath: string): vscode.Uri {
  return vscode.Uri.file(path.resolve(path.dirname(baseUri.fsPath), relativePath));
}
