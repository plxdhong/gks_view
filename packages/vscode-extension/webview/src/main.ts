import "./style.css";
import { App } from "./app/App";
import type { GksCase, GksCompare, GksScene, WorkbenchInitialData } from "./schema/GksScene";

async function loadDevData(): Promise<WorkbenchInitialData> {
  const params = new URLSearchParams(window.location.search);
  const casePath = params.get("case");
  const scenePath = params.get("scene");
  const comparePath = params.get("compare");

  if (casePath) {
    return loadCaseFromExamples(casePath);
  }

  if (scenePath) {
    return loadSceneFromExamples(scenePath);
  }

  if (comparePath && comparePath !== "1") {
    return loadCompareFromExamples(comparePath);
  }

  if (params.has("compare")) {
    return loadCompareFromExamples("mock/SplitCompare.Case_001/split.gkcompare.json");
  }

  return loadCaseFromExamples("mock/HoleGrow.Case_001/index.gkcase.json");
}

async function loadCaseFromExamples(casePath: string): Promise<WorkbenchInitialData> {
  const safeCasePath = safeExamplesPath(casePath);
  const gkcase = await fetchJson<GksCase>(`/${safeCasePath}`);
  const firstSnapshot = gkcase.snapshots[0];
  if (!firstSnapshot) {
    throw new Error("GKS case has no snapshots");
  }
  const scene = await fetchJson<GksScene>(`/${joinExamplesPath(dirname(safeCasePath), firstSnapshot.file)}`);
  return {
    mode: "case",
    case: gkcase,
    caseBasePath: dirname(safeCasePath),
    snapshots: gkcase.snapshots,
    activeSnapshotId: firstSnapshot.snapshotId,
    scene
  };
}

async function loadSceneFromExamples(scenePath: string): Promise<WorkbenchInitialData> {
  const safeScenePath = safeExamplesPath(scenePath);
  const scene = await fetchJson<GksScene>(`/${safeScenePath}`);
  return {
    mode: "scene",
    snapshots: [{
      snapshotId: scene.snapshotId,
      title: scene.title,
      file: basename(safeScenePath)
    }],
    activeSnapshotId: scene.snapshotId,
    scene
  };
}

async function loadCompareFromExamples(comparePath: string): Promise<WorkbenchInitialData> {
  const safeComparePath = safeExamplesPath(comparePath);
  const compare = await fetchJson<GksCompare>(`/${safeComparePath}`);
  const compareScenes = await Promise.all(compare.scenes.map(async (sceneRef) => ({
    viewId: sceneRef.viewId,
    title: sceneRef.title ?? sceneRef.viewId,
    scene: await fetchJson<GksScene>(`/${joinExamplesPath(dirname(safeComparePath), sceneRef.file)}`)
  })));
  const first = compareScenes[0];
  if (!first) {
    throw new Error("GKS compare has no scenes");
  }
  return {
    mode: "compare",
    compare,
    snapshots: compareScenes.map((item) => ({
      snapshotId: item.viewId,
      title: item.title,
      file: undefined
    })),
    activeSnapshotId: first.viewId,
    scene: first.scene,
    compareScenes
  };
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load ${url}: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

function safeExamplesPath(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/^\/+/, "");
  const parts = normalized.split("/").filter((part) => part.length > 0);
  if (!parts.length || parts.some((part) => part === "." || part === "..")) {
    throw new Error(`Unsafe examples path: ${value}`);
  }
  return parts.join("/");
}

function joinExamplesPath(base: string, relativePath: string): string {
  return safeExamplesPath(`${base}/${relativePath}`);
}

function dirname(filePath: string): string {
  const index = filePath.lastIndexOf("/");
  return index >= 0 ? filePath.slice(0, index) : "";
}

function basename(filePath: string): string {
  const index = filePath.lastIndexOf("/");
  return index >= 0 ? filePath.slice(index + 1) : filePath;
}

async function boot(): Promise<void> {
  const host = document.querySelector<HTMLElement>("#app");
  if (!host) {
    throw new Error("Missing #app");
  }
  const initialData = window.__GK_INITIAL_DATA__ ?? await loadDevData();
  new App(host, initialData);
}

boot().catch((error) => {
  const host = document.querySelector<HTMLElement>("#app") ?? document.body;
  const message = document.createElement("pre");
  message.className = "fatal-error";
  message.textContent = error instanceof Error ? error.stack ?? error.message : String(error);
  host.append(message);
});
