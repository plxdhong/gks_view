import type { EntityIdentity, GksScene, WorkbenchInitialData } from "../schema/GksScene";
import { buildEntityIndex, descendantIdsForEntity } from "../schema/GksScene";
import { PropertyPanel } from "../panels/PropertyPanel";
import { SnapshotTimeline } from "../panels/SnapshotTimeline";
import { TopologyTreePanel } from "../panels/TopologyTreePanel";
import { SceneRenderer, type CameraMode, type DisplayMode } from "../viewer/SceneRenderer";

const minPanelWidth = 210;
const maxPanelWidth = 640;
const minViewerWidth = 360;
const resizerWidth = 1;

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
  private readonly hiddenEntityIds = new Set<string>();
  private leftPanelWidth = readStoredNumber("gkWorkbench.leftPanelWidth", 280);
  private rightPanelWidth = readStoredNumber("gkWorkbench.rightPanelWidth", 330);
  private leftPanelCollapsed = readStoredBoolean("gkWorkbench.leftPanelCollapsed", false);
  private rightPanelCollapsed = readStoredBoolean("gkWorkbench.rightPanelCollapsed", false);
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
          <div class="panel-toggle-group" role="group" aria-label="Workbench panels">
            <button class="toolbar-icon-button panel-toggle-button left-panel-toggle" type="button" title="Toggle left panel" aria-label="Toggle left panel" aria-pressed="true">
              <span class="panel-toggle-icon panel-toggle-icon-left" aria-hidden="true"></span>
            </button>
            <button class="toolbar-icon-button panel-toggle-button right-panel-toggle" type="button" title="Toggle right panel" aria-label="Toggle right panel" aria-pressed="true">
              <span class="panel-toggle-icon panel-toggle-icon-right" aria-hidden="true"></span>
            </button>
          </div>
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
      <div class="panel-resizer left-resizer" role="separator" aria-orientation="vertical" aria-label="Resize left panel" tabindex="0"></div>
      <main class="viewer-panel">
        <div class="viewer-layout"></div>
      </main>
      <div class="panel-resizer right-resizer" role="separator" aria-orientation="vertical" aria-label="Resize right panel" tabindex="0"></div>
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
    this.applyPanelLayout();
    this.createViewers();
    this.timeline = new SnapshotTimeline(this.mustQuery(".timeline-list"), (snapshotId) => this.activateSnapshot(snapshotId));
    this.topologyTree = new TopologyTreePanel(
      this.mustQuery(".topology-host"),
      (entityId) => this.selectEntity(entityId, true, { revealInTree: false }),
      (entityId) => this.toggleEntityVisibility(entityId)
    );
    this.propertyPanel = new PropertyPanel(
      this.mustQuery(".property-host"),
      (entityId) => this.revealInTopology(entityId)
    );

    this.setupToolbarControls();
    this.setupPanelControls();
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
    this.renderTopologyTree();
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

  private selectEntity(entityId: string | undefined, focus: boolean, options: { revealInTree?: boolean } = {}): void {
    if (!entityId) {
      return;
    }
    const revealInTree = options.revealInTree ?? true;
    this.selectedEntityId = entityId;
    this.selectAcrossRenderers(entityId);
    if (focus) {
      this.renderers[this.activeSceneIndex]?.focus(entityId);
    }
    this.renderTopologyTree(revealInTree ? entityId : undefined);
    this.propertyPanel.render(this.scene, this.entityIndex.get(entityId));
    this.requestEntityProperties(entityId);
  }

  private revealInTopology(entityId: string): void {
    if (!this.entityIndex.has(entityId)) {
      return;
    }
    this.selectedEntityId = entityId;
    this.selectAcrossRenderers(entityId);
    this.renderTopologyTree(entityId);
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
    const snapshotPath = this.data.caseBasePath === undefined || this.data.caseBasePath.length === 0
      ? snapshot.file
      : `${this.data.caseBasePath}/${snapshot.file}`;
    fetch(`/${snapshotPath}`)
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
        this.renderers[index]?.loadScene(item.scene, this.selectedEntityId, this.effectiveHiddenEntityIdsForScene(item.scene));
      });
      this.markActiveCompareFrame();
      return;
    }
    this.renderers[0]?.loadScene(this.scene, this.selectedEntityId, this.effectiveHiddenEntityIdsForScene(this.scene));
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

  private setupPanelControls(): void {
    this.mustQuery<HTMLButtonElement>(".left-panel-toggle").addEventListener("click", () => {
      this.leftPanelCollapsed = !this.leftPanelCollapsed;
      this.storePanelLayout();
      this.applyPanelLayout();
    });
    this.mustQuery<HTMLButtonElement>(".right-panel-toggle").addEventListener("click", () => {
      this.rightPanelCollapsed = !this.rightPanelCollapsed;
      this.storePanelLayout();
      this.applyPanelLayout();
    });

    this.setupPanelResizer(this.mustQuery(".left-resizer"), "left");
    this.setupPanelResizer(this.mustQuery(".right-resizer"), "right");
  }

  private setupPanelResizer(handle: HTMLElement, panel: "left" | "right"): void {
    handle.addEventListener("pointerdown", (event) => {
      if ((panel === "left" && this.leftPanelCollapsed) || (panel === "right" && this.rightPanelCollapsed)) {
        return;
      }
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = this.actualPanelWidth(panel);
      this.host.classList.add("is-resizing-panel");

      const onPointerMove = (moveEvent: PointerEvent): void => {
        const delta = moveEvent.clientX - startX;
        const nextWidth = panel === "left" ? startWidth + delta : startWidth - delta;
        this.setPanelWidth(panel, nextWidth);
      };
      const onPointerUp = (): void => {
        document.removeEventListener("pointermove", onPointerMove);
        document.removeEventListener("pointerup", onPointerUp);
        this.host.classList.remove("is-resizing-panel");
        this.storePanelLayout();
      };

      document.addEventListener("pointermove", onPointerMove);
      document.addEventListener("pointerup", onPointerUp);
    });

    handle.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
        return;
      }
      event.preventDefault();
      const step = event.shiftKey ? 40 : 16;
      const direction = event.key === "ArrowRight" ? 1 : -1;
      const widthDelta = panel === "left" ? direction * step : -direction * step;
      this.setPanelWidth(panel, (panel === "left" ? this.leftPanelWidth : this.rightPanelWidth) + widthDelta);
      this.storePanelLayout();
    });
  }

  private setPanelWidth(panel: "left" | "right", width: number): void {
    const clampedWidth = this.clampPanelWidth(panel, width);
    if (panel === "left") {
      this.leftPanelWidth = clampedWidth;
    } else {
      this.rightPanelWidth = clampedWidth;
    }
    this.applyPanelLayout();
  }

  private applyPanelLayout(): void {
    this.normalizePanelWidths();
    this.host.style.setProperty("--left-panel-width", this.leftPanelCollapsed ? "0px" : `${this.leftPanelWidth}px`);
    this.host.style.setProperty("--right-panel-width", this.rightPanelCollapsed ? "0px" : `${this.rightPanelWidth}px`);
    this.host.style.setProperty("--left-resizer-width", this.leftPanelCollapsed ? "0px" : `${resizerWidth}px`);
    this.host.style.setProperty("--right-resizer-width", this.rightPanelCollapsed ? "0px" : `${resizerWidth}px`);
    this.host.classList.toggle("is-left-collapsed", this.leftPanelCollapsed);
    this.host.classList.toggle("is-right-collapsed", this.rightPanelCollapsed);
    this.updatePanelToggleButton(".left-panel-toggle", !this.leftPanelCollapsed);
    this.updatePanelToggleButton(".right-panel-toggle", !this.rightPanelCollapsed);
  }

  private updatePanelToggleButton(selector: string, isExpanded: boolean): void {
    const button = this.host.querySelector<HTMLButtonElement>(selector);
    if (!button) {
      return;
    }
    button.classList.toggle("is-active", isExpanded);
    button.setAttribute("aria-pressed", String(isExpanded));
  }

  private storePanelLayout(): void {
    writeStoredNumber("gkWorkbench.leftPanelWidth", this.leftPanelWidth);
    writeStoredNumber("gkWorkbench.rightPanelWidth", this.rightPanelWidth);
    writeStoredBoolean("gkWorkbench.leftPanelCollapsed", this.leftPanelCollapsed);
    writeStoredBoolean("gkWorkbench.rightPanelCollapsed", this.rightPanelCollapsed);
  }

  private actualPanelWidth(panel: "left" | "right"): number {
    const selector = panel === "left" ? ".left-panel" : ".right-panel";
    const measuredWidth = this.host.querySelector<HTMLElement>(selector)?.getBoundingClientRect().width ?? 0;
    if (measuredWidth > 0) {
      return measuredWidth;
    }
    return panel === "left" ? this.leftPanelWidth : this.rightPanelWidth;
  }

  private clampPanelWidth(panel: "left" | "right", width: number): number {
    const otherPanelVisible = panel === "left" ? !this.rightPanelCollapsed : !this.leftPanelCollapsed;
    const otherWidth = otherPanelVisible ? (panel === "left" ? this.rightPanelWidth : this.leftPanelWidth) : 0;
    const available = this.availablePanelWidth() - otherWidth;
    const upperBound = Math.max(minPanelWidth, Math.min(maxPanelWidth, available));
    return Math.round(Math.min(Math.max(width, minPanelWidth), upperBound));
  }

  private normalizePanelWidths(): void {
    if (!this.leftPanelCollapsed) {
      this.leftPanelWidth = this.clampStandaloneWidth(this.leftPanelWidth);
    }
    if (!this.rightPanelCollapsed) {
      this.rightPanelWidth = this.clampStandaloneWidth(this.rightPanelWidth);
    }

    const available = this.availablePanelWidth();
    if (!this.leftPanelCollapsed && !this.rightPanelCollapsed && this.leftPanelWidth + this.rightPanelWidth > available) {
      this.rightPanelWidth = Math.max(minPanelWidth, available - this.leftPanelWidth);
      if (this.leftPanelWidth + this.rightPanelWidth > available) {
        this.leftPanelWidth = Math.max(minPanelWidth, available - this.rightPanelWidth);
      }
    }
  }

  private clampStandaloneWidth(width: number): number {
    return Math.round(Math.min(Math.max(width, minPanelWidth), maxPanelWidth));
  }

  private availablePanelWidth(): number {
    const visibleResizers =
      (this.leftPanelCollapsed ? 0 : resizerWidth) +
      (this.rightPanelCollapsed ? 0 : resizerWidth);
    const hostWidth = this.host.getBoundingClientRect().width || window.innerWidth;
    return Math.max(minPanelWidth, hostWidth - minViewerWidth - visibleResizers);
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

  private toggleEntityVisibility(entityId: string): void {
    if (this.hiddenEntityIds.has(entityId)) {
      this.hiddenEntityIds.delete(entityId);
    } else {
      this.hiddenEntityIds.add(entityId);
    }
    this.renderTopologyTree();
    this.applyHiddenEntitiesToRenderers();
  }

  private renderTopologyTree(revealEntityId?: string): void {
    this.topologyTree.render(this.scene, {
      selectedEntityId: this.selectedEntityId,
      hiddenEntityIds: this.hiddenEntityIds,
      effectiveHiddenEntityIds: this.effectiveHiddenEntityIdsForScene(this.scene),
      revealEntityId
    });
  }

  private applyHiddenEntitiesToRenderers(): void {
    if (this.data.mode === "compare" && this.data.compareScenes?.length) {
      this.data.compareScenes.forEach((item, index) => {
        this.renderers[index]?.setHiddenEntities(this.effectiveHiddenEntityIdsForScene(item.scene));
      });
      return;
    }
    this.renderers[0]?.setHiddenEntities(this.effectiveHiddenEntityIdsForScene(this.scene));
  }

  private effectiveHiddenEntityIdsForScene(scene: GksScene): Set<string> {
    const effectiveHidden = new Set<string>();
    for (const entityId of this.hiddenEntityIds) {
      effectiveHidden.add(entityId);
      for (const descendantId of descendantIdsForEntity(scene, entityId)) {
        effectiveHidden.add(descendantId);
      }
    }
    return effectiveHidden;
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

function readStoredNumber(key: string, fallback: number): number {
  try {
    const value = window.localStorage.getItem(key);
    const number = value === null ? Number.NaN : Number(value);
    return Number.isFinite(number) ? number : fallback;
  } catch {
    return fallback;
  }
}

function readStoredBoolean(key: string, fallback: boolean): boolean {
  try {
    const value = window.localStorage.getItem(key);
    return value === null ? fallback : value === "true";
  } catch {
    return fallback;
  }
}

function writeStoredNumber(key: string, value: number): void {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // Ignore storage failures in restricted webview contexts.
  }
}

function writeStoredBoolean(key: string, value: boolean): void {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // Ignore storage failures in restricted webview contexts.
  }
}
