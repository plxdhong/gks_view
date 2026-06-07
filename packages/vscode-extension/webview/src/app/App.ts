import type { EntityIdentity, GksScene, WorkbenchInitialData } from "../schema/GksScene";
import { buildEntityIndex } from "../schema/GksScene";
import { PropertyPanel } from "../panels/PropertyPanel";
import { SnapshotTimeline } from "../panels/SnapshotTimeline";
import { TopologyTreePanel } from "../panels/TopologyTreePanel";
import { SceneRenderer, type CameraMode, type DisplayMode } from "../viewer/SceneRenderer";

interface VsCodeApi {
  postMessage(message: unknown): void;
}

declare global {
  interface Window {
    __GK_INITIAL_DATA__?: WorkbenchInitialData;
    acquireVsCodeApi?: () => VsCodeApi;
  }
}

export class App {
  private readonly vscode = window.acquireVsCodeApi?.();
  private readonly renderers: SceneRenderer[] = [];
  private readonly timeline: SnapshotTimeline;
  private readonly topologyTree: TopologyTreePanel;
  private readonly propertyPanel: PropertyPanel;
  private scene: GksScene;
  private entityIndex = new Map<string, EntityIdentity>();
  private activeSceneIndex = 0;
  private selectedEntityId: string | undefined;
  private cameraMode: CameraMode = "perspective";
  private displayMode: DisplayMode = "all";

  constructor(
    private readonly host: HTMLElement,
    private data: WorkbenchInitialData
  ) {
    this.host.className = "workbench-shell";
    this.host.innerHTML = `
      <header class="toolbar">
        <div class="brand-block">
          <span class="brand-title">Geometry Workbench</span>
          <span class="brand-meta"></span>
        </div>
        <div class="toolbar-actions">
          <div class="toolbar-control camera-control" aria-label="View camera mode">
            <span class="toolbar-control-label">View</span>
            <div class="segmented-control" role="group" aria-label="Camera mode">
              <button class="mode-button camera-mode-button is-active" type="button" data-camera-mode="perspective" aria-pressed="true">Perspective</button>
              <button class="mode-button camera-mode-button" type="button" data-camera-mode="orthographic" aria-pressed="false">Orthographic</button>
            </div>
          </div>
          <label class="mode-select-label">
            <span>Display</span>
            <select class="display-mode-select" aria-label="Display mode">
              <option value="all">All</option>
              <option value="points">Points</option>
              <option value="wireframe">Wireframe</option>
              <option value="solid">Bodies</option>
              <option value="xray">Translucent</option>
            </select>
          </label>
          <button class="view-reset-button" type="button" title="Reset view" aria-label="Reset view">
            <span class="view-reset-icon" aria-hidden="true"></span>
            <span>Reset View</span>
          </button>
          <label class="search-box">
            <span>Find</span>
            <input class="entity-search" type="search" placeholder="face:top or 400" />
          </label>
        </div>
      </header>
      <aside class="left-panel">
        <section class="panel timeline-panel">
          <h2>Snapshots</h2>
          <div class="timeline-list"></div>
        </section>
        <section class="panel topology-panel">
          <h2>Topology</h2>
          <div class="topology-host"></div>
        </section>
      </aside>
      <main class="viewer-panel">
        <div class="viewer-layout"></div>
      </main>
      <aside class="right-panel">
        <section class="panel property-panel">
          <h2>Properties</h2>
          <div class="property-host"></div>
        </section>
        <section class="panel debug-panel">
          <h2>Debug</h2>
          <div class="debug-host"></div>
        </section>
      </aside>
    `;

    this.scene = data.scene;
    this.createViewers();
    this.timeline = new SnapshotTimeline(this.mustQuery(".timeline-list"), (snapshotId) => this.activateSnapshot(snapshotId));
    this.topologyTree = new TopologyTreePanel(this.mustQuery(".topology-host"), (entityId) => this.selectEntity(entityId, true));
    this.propertyPanel = new PropertyPanel(this.mustQuery(".property-host"));

    this.setupToolbarControls();
    this.mustQuery<HTMLInputElement>(".entity-search").addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        this.reveal((event.currentTarget as HTMLInputElement).value.trim());
      }
    });
    this.mustQuery<HTMLButtonElement>(".view-reset-button").addEventListener("click", () => this.resetView());
    window.addEventListener("message", (event) => this.handleMessage(event.data));
    this.renderAll();
  }

  private renderAll(): void {
    this.scene = this.activeScene();
    this.entityIndex = buildEntityIndex(this.scene);
    const selected = this.selectedEntityId ? this.entityIndex.get(this.selectedEntityId) : undefined;
    this.mustQuery(".brand-meta").textContent = this.titleText();
    this.timeline.render(this.data.snapshots, this.data.activeSnapshotId);
    this.topologyTree.render(this.scene, this.selectedEntityId);
    this.propertyPanel.render(this.scene, selected);
    this.renderDebug();
    this.loadRenderers();
  }

  private renderDebug(): void {
    const host = this.mustQuery(".debug-host");
    host.replaceChildren();
    const debug = this.scene.debug;
    if (!debug) {
      host.append(emptyState("No debug data"));
      return;
    }
    const rows = [
      ["algorithm", debug.algorithm],
      ["step", debug.step],
      ["message", debug.message],
      ["faces", debug.highlights?.faces?.join(", ")],
      ["edges", debug.highlights?.edges?.join(", ")]
    ].filter(([, value]) => value);

    const table = document.createElement("div");
    table.className = "property-table";
    for (const [key, value] of rows) {
      const keyElement = document.createElement("div");
      keyElement.className = "property-key";
      keyElement.textContent = key ?? "";
      const valueElement = document.createElement("div");
      valueElement.className = "property-value";
      valueElement.textContent = value ?? "";
      table.append(keyElement, valueElement);
    }
    host.append(table);

    for (const annotation of debug.annotations ?? []) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "annotation";
      item.textContent = annotation.title ?? annotation.id;
      item.title = annotation.text ?? "";
      item.addEventListener("click", () => this.selectEntity(annotation.relatedEntities?.[0], true));
      host.append(item);
    }
  }

  private selectEntity(entityId: string | undefined, focus: boolean): void {
    if (!entityId) {
      return;
    }
    this.selectedEntityId = entityId;
    this.selectAcrossRenderers(entityId);
    if (focus) {
      this.renderers[this.activeSceneIndex]?.focus(entityId);
    }
    this.topologyTree.render(this.scene, entityId);
    this.propertyPanel.render(this.scene, this.entityIndex.get(entityId));
    this.requestEntityProperties(entityId);
  }

  private reveal(query: string): void {
    if (!query) {
      return;
    }
    const direct = this.entityIndex.get(query);
    const byTag = [...this.entityIndex.values()].find((entity) => String(entity.kernelTag) === query);
    const entity = direct ?? byTag;
    if (entity) {
      this.selectEntity(entity.entityId, true);
    }
  }

  private activateSnapshot(snapshotId: string): void {
    if (snapshotId === this.data.activeSnapshotId) {
      return;
    }
    this.data.activeSnapshotId = snapshotId;
    this.selectedEntityId = undefined;

    if (this.data.mode === "compare") {
      const index = this.data.compareScenes?.findIndex((item) => item.viewId === snapshotId) ?? -1;
      if (index >= 0) {
        this.activeSceneIndex = index;
        this.scene = this.activeScene();
        this.renderAll();
      }
      return;
    }

    if (this.vscode) {
      const requestId = `request-${Date.now()}`;
      this.vscode.postMessage({
        type: "requestScene",
        requestId,
        payload: { snapshotId }
      });
      return;
    }

    const snapshot = this.data.snapshots.find((item) => item.snapshotId === snapshotId);
    if (!snapshot?.file) {
      return;
    }
    fetch(`/mock/HoleGrow.Case_001/${snapshot.file}`)
      .then((response) => response.json())
      .then((scene: GksScene) => {
        this.scene = scene;
        this.renderAll();
      })
      .catch((error) => this.showError(String(error)));
  }

  private handleMessage(message: unknown): void {
    if (!message || typeof message !== "object") {
      return;
    }
    const typed = message as { type?: string; payload?: { scene?: GksScene; message?: string; entityId?: string; properties?: Record<string, unknown> } };
    if (typed.type === "sceneLoaded" && typed.payload?.scene) {
      this.scene = typed.payload.scene;
      this.renderAll();
    }
    if (typed.type === "revealEntity") {
      const query = (typed.payload as { query?: string } | undefined)?.query;
      if (query) {
        this.mustQuery<HTMLInputElement>(".entity-search").value = query;
        this.reveal(query);
      }
    }
    if (typed.type === "error") {
      this.showError(typed.payload?.message ?? "Unknown webview error");
    }
    if (typed.type === "entityPropertiesLoaded" && typed.payload?.entityId && typed.payload.properties) {
      this.scene.properties = {
        ...(this.scene.properties ?? {}),
        [typed.payload.entityId]: typed.payload.properties
      };
      if (this.selectedEntityId === typed.payload.entityId) {
        this.propertyPanel.render(this.scene, this.entityIndex.get(typed.payload.entityId));
      }
    }
  }

  private createViewers(): void {
    const layout = this.mustQuery(".viewer-layout");
    layout.replaceChildren();
    const compareScenes = this.data.compareScenes ?? [];
    if (this.data.mode === "compare" && compareScenes.length > 1) {
      layout.className = compareScenes.length > 2 ? "viewer-layout compare-grid" : "viewer-layout compare-split";
      compareScenes.forEach((item, index) => {
        const frame = document.createElement("section");
        frame.className = "compare-frame";
        frame.dataset.viewId = item.viewId;
        const title = document.createElement("div");
        title.className = "compare-title";
        title.textContent = item.title;
        const host = document.createElement("div");
        host.className = "viewer-host";
        frame.append(title, host);
        layout.append(frame);
        const renderer = new SceneRenderer(host);
        renderer.onSelect((selection) => {
          this.activeSceneIndex = index;
          this.data.activeSnapshotId = item.viewId;
          this.scene = item.scene;
          this.entityIndex = buildEntityIndex(this.scene);
          this.selectEntity(selection.entityId, false);
          this.timeline.render(this.data.snapshots, this.data.activeSnapshotId);
          this.markActiveCompareFrame();
        });
        this.renderers.push(renderer);
      });
      this.markActiveCompareFrame();
      return;
    }

    layout.className = "viewer-layout single-viewer";
    const host = document.createElement("div");
    host.className = "viewer-host";
    layout.append(host);
    const renderer = new SceneRenderer(host);
    renderer.onSelect((selection) => this.selectEntity(selection.entityId, false));
    this.renderers.push(renderer);
  }

  private loadRenderers(): void {
    if (this.data.mode === "compare" && this.data.compareScenes?.length) {
      this.data.compareScenes.forEach((item, index) => {
        this.renderers[index]?.loadScene(item.scene, this.selectedEntityId);
      });
      this.markActiveCompareFrame();
      return;
    }
    this.renderers[0]?.loadScene(this.scene, this.selectedEntityId);
  }

  private setupToolbarControls(): void {
    for (const button of this.host.querySelectorAll<HTMLButtonElement>(".camera-mode-button")) {
      button.addEventListener("click", () => {
        const mode = button.dataset.cameraMode;
        if (isCameraMode(mode)) {
          this.setCameraMode(mode);
        }
      });
    }

    this.mustQuery<HTMLSelectElement>(".display-mode-select").addEventListener("change", (event) => {
      const mode = (event.currentTarget as HTMLSelectElement).value;
      if (isDisplayMode(mode)) {
        this.setDisplayMode(mode);
      }
    });
  }

  private setCameraMode(mode: CameraMode): void {
    this.cameraMode = mode;
    for (const renderer of this.renderers) {
      renderer.setCameraMode(mode);
    }
    this.updateCameraModeButtons();
  }

  private setDisplayMode(mode: DisplayMode): void {
    this.displayMode = mode;
    for (const renderer of this.renderers) {
      renderer.setDisplayMode(mode);
    }
  }

  private activeScene(): GksScene {
    return this.data.mode === "compare"
      ? this.data.compareScenes?.[this.activeSceneIndex]?.scene ?? this.scene
      : this.scene;
  }

  private titleText(): string {
    if (this.data.mode === "compare") {
      const compareTitle = this.data.compare?.title ?? this.data.compare?.compareId ?? "Compare";
      const active = this.data.compareScenes?.[this.activeSceneIndex]?.title;
      return active ? `${compareTitle} / ${active}` : compareTitle;
    }
    return this.scene.title ?? this.scene.sceneId;
  }

  private selectAcrossRenderers(entityId: string): void {
    for (const renderer of this.renderers) {
      renderer.select(entityId);
    }
  }

  private resetView(): void {
    for (const renderer of this.renderers) {
      renderer.resetView();
    }
  }

  private updateCameraModeButtons(): void {
    for (const button of this.host.querySelectorAll<HTMLButtonElement>(".camera-mode-button")) {
      const isActive = button.dataset.cameraMode === this.cameraMode;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    }
  }

  private markActiveCompareFrame(): void {
    const frames = [...this.host.querySelectorAll<HTMLElement>(".compare-frame")];
    frames.forEach((frame, index) => {
      frame.classList.toggle("is-active", index === this.activeSceneIndex);
    });
  }

  private requestEntityProperties(entityId: string): void {
    if (this.data.mode !== "adapter" || !this.vscode) {
      return;
    }
    this.vscode.postMessage({
      type: "requestEntityProperties",
      requestId: `entity-properties-${Date.now()}`,
      payload: { entityId }
    });
  }

  private showError(message: string): void {
    const host = this.mustQuery(".debug-host");
    const item = document.createElement("div");
    item.className = "error-state";
    item.textContent = message;
    host.prepend(item);
  }

  private mustQuery<T extends Element = HTMLElement>(selector: string): T {
    const element = this.host.querySelector<T>(selector);
    if (!element) {
      throw new Error(`Missing ${selector}`);
    }
    return element;
  }
}

function emptyState(text: string): HTMLElement {
  const element = document.createElement("div");
  element.className = "empty-state";
  element.textContent = text;
  return element;
}

function isCameraMode(value: string | undefined): value is CameraMode {
  return value === "perspective" || value === "orthographic";
}

function isDisplayMode(value: string | undefined): value is DisplayMode {
  return value === "points" || value === "wireframe" || value === "solid" || value === "all" || value === "xray";
}
