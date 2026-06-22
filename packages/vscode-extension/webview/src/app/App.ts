import type { EntityIdentity, GksScene, WorkbenchInitialData, WorkbenchRunSceneResult } from "../schema/GksScene";
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
  private cameraMode: CameraMode = "orthographic";
  private displayMode: DisplayMode = "all";
  private updateNoticeTimer: number | undefined;

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
            <span class="toolbar-control-label">Cam</span>
            <div class="segmented-control" role="group" aria-label="Camera mode">
              <button class="mode-button camera-mode-button" type="button" data-camera-mode="perspective" title="Perspective view" aria-label="Perspective view" aria-pressed="false">Persp</button>
              <button class="mode-button camera-mode-button is-active" type="button" data-camera-mode="orthographic" title="Orthographic view" aria-label="Orthographic view" aria-pressed="true">Ortho</button>
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
          <button class="toolbar-icon-button control-help-button" type="button" title="Operation guide" aria-label="Operation guide" aria-expanded="false">
            <span class="help-icon" aria-hidden="true">?</span>
          </button>
          <button class="view-reset-button" type="button" title="Reset view" aria-label="Reset view">
            <span class="view-reset-icon" aria-hidden="true"></span>
            <span>Reset</span>
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
      <div class="help-popover" hidden>
        <div class="help-popover-title">操作图例</div>
        <div class="help-grid">
          <span>左键拖动</span><span>旋转视图</span>
          <span>右键拖动</span><span>平移视图</span>
          <span>Shift + 左键</span><span>平移视图</span>
          <span>滚轮</span><span>缩放视图</span>
          <span>点击实体</span><span>选择并设置旋转中心</span>
          <span>点击空白</span><span>取消选择</span>
        </div>
      </div>
      <aside class="left-panel">
        <section class="panel run-case-panel">
          <h2>Cases</h2>
          <div class="run-case-list"></div>
        </section>
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
      <div class="update-toast" aria-live="polite" hidden>已自动刷新</div>
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
    this.setupHelpControls();
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
    this.renderRunCases();
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
      ["edges", debug.highlights?.edges?.join(", ")],
      ["groups", debug.highlightGroups?.length ? String(debug.highlightGroups.length) : undefined]
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

    for (const group of debug.highlightGroups ?? []) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "highlight-group";
      item.style.setProperty("--highlight-group-color", group.color ?? "#d9a441");
      item.textContent = group.title ?? group.groupId ?? "Highlight group";
      item.title = [
        ...(group.faces ?? []),
        ...(group.edges ?? []),
        ...(group.vertices ?? []),
        ...(group.entityIds ?? [])
      ].join(", ");
      item.addEventListener("click", () => {
        const firstEntityId = group.entityIds?.[0] ?? group.faces?.[0] ?? group.edges?.[0] ?? group.vertices?.[0];
        this.selectEntity(firstEntityId, true);
      });
      host.append(item);
    }

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
      this.clearSelection();
      return;
    }
    if (!this.entityIndex.has(entityId)) {
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

  private clearSelection(): void {
    this.selectedEntityId = undefined;
    this.selectAcrossRenderers(undefined);
    this.renderTopologyTree();
    this.propertyPanel.render(this.scene, undefined);
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

    if (this.data.mode === "run") {
      const activeRunCase = this.activeRunCase();
      if (!activeRunCase) {
        return;
      }
      activeRunCase.activeSnapshotId = snapshotId;
      this.data.snapshots = activeRunCase.snapshots;
      if (this.requestSnapshotScene(snapshotId, activeRunCase.caseId)) {
        return;
      }
      const snapshot = activeRunCase.snapshots.find((item) => item.snapshotId === snapshotId);
      if (!snapshot?.file) {
        return;
      }
      fetch(`/${activeRunCase.caseBasePath}/${snapshot.file}`)
        .then((response) => response.json())
        .then((scene: GksScene) => {
          activeRunCase.scene = scene;
          this.scene = scene;
          this.renderAll();
        })
        .catch((error) => this.showError(String(error)));
      return;
    }

    if (this.data.mode === "compare") {
      const index = this.data.compareScenes?.findIndex((item) => item.viewId === snapshotId) ?? -1;
      if (index >= 0) {
        this.activeSceneIndex = index;
        this.scene = this.activeScene();
        this.renderAll();
      }
      return;
    }

    if (this.requestSnapshotScene(snapshotId)) {
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

  private renderRunCases(): void {
    const panel = this.mustQuery<HTMLElement>(".run-case-panel");
    const host = this.mustQuery(".run-case-list");
    host.replaceChildren();
    if (this.data.mode !== "run" || !this.data.runCases?.length) {
      panel.hidden = true;
      return;
    }
    panel.hidden = false;

    for (const runCase of this.data.runCases) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "run-case-item";
      item.classList.toggle("is-active", runCase.caseId === this.data.activeRunCaseId);
      item.dataset.status = runCase.status ?? "unknown";
      item.title = runCase.caseId;

      const title = document.createElement("span");
      title.className = "run-case-title";
      title.textContent = runCase.title ?? runCase.case.title ?? runCase.caseId;
      const meta = document.createElement("span");
      meta.className = "run-case-meta";
      meta.textContent = [runCase.suite, runCase.test, runCase.status].filter(Boolean).join(" / ");
      item.append(title, meta);
      item.addEventListener("click", () => this.activateRunCase(runCase.caseId));
      host.append(item);
    }
  }

  private activateRunCase(caseId: string, requestScene = true): void {
    if (this.data.mode !== "run") {
      return;
    }
    const runCase = this.data.runCases?.find((item) => item.caseId === caseId);
    if (!runCase) {
      return;
    }

    this.data.activeRunCaseId = runCase.caseId;
    this.data.case = runCase.case;
    this.data.caseBasePath = runCase.caseBasePath;
    this.data.snapshots = runCase.snapshots;
    this.data.activeSnapshotId = runCase.activeSnapshotId;
    this.scene = runCase.scene;
    this.selectedEntityId = undefined;
    this.renderAll();

    if (requestScene && this.vscode) {
      this.vscode.postMessage({
        type: "requestScene",
        requestId: `request-${Date.now()}`,
        payload: {
          caseId: runCase.caseId,
          snapshotId: runCase.activeSnapshotId
        }
      });
    }
  }

  private applyRunSceneResult(result: WorkbenchRunSceneResult): void {
    if (this.data.mode !== "run") {
      return;
    }
    const runCase = this.data.runCases?.find((item) => item.caseId === result.activeRunCaseId);
    if (runCase) {
      runCase.case = result.case;
      runCase.caseBasePath = result.caseBasePath;
      runCase.snapshots = result.snapshots;
      runCase.activeSnapshotId = result.activeSnapshotId;
      runCase.scene = result.scene;
    }
    this.data.activeRunCaseId = result.activeRunCaseId;
    this.data.case = result.case;
    this.data.caseBasePath = result.caseBasePath;
    this.data.snapshots = result.snapshots;
    this.data.activeSnapshotId = result.activeSnapshotId;
    this.scene = result.scene;
    this.renderAll();
  }

  private applyWorkbenchUpdate(data: WorkbenchInitialData): void {
    const previousRunCaseId = this.data.activeRunCaseId;
    const previousSnapshotId = this.data.activeSnapshotId;
    const previousCompareViewId = this.data.mode === "compare"
      ? this.data.compareScenes?.[this.activeSceneIndex]?.viewId
      : undefined;

    this.data = data;
    this.selectedEntityId = undefined;

    if (data.mode === "run") {
      this.applyRunUpdate(previousRunCaseId, previousSnapshotId);
      return;
    }

    if (data.mode === "case") {
      this.applyCaseUpdate(previousSnapshotId);
      return;
    }

    if (data.mode === "compare") {
      this.applyCompareUpdate(previousCompareViewId ?? previousSnapshotId);
      return;
    }

    this.scene = data.scene;
    this.renderAll();
  }

  private applyRunUpdate(previousRunCaseId: string | undefined, previousSnapshotId: string | undefined): void {
    const data = this.data;
    if (data.mode !== "run") {
      return;
    }
    const targetCase = previousRunCaseId
      ? data.runCases?.find((item) => item.caseId === previousRunCaseId)
      : undefined;
    const nextCase = targetCase
      ?? data.runCases?.find((item) => item.caseId === data.activeRunCaseId)
      ?? data.runCases?.[0];
    if (!nextCase) {
      this.scene = data.scene;
      this.renderAll();
      return;
    }
    const targetSnapshotId = previousSnapshotId && nextCase.snapshots.some((item) => item.snapshotId === previousSnapshotId)
      ? previousSnapshotId
      : nextCase.activeSnapshotId;

    nextCase.activeSnapshotId = targetSnapshotId;
    data.activeRunCaseId = nextCase.caseId;
    data.case = nextCase.case;
    data.caseBasePath = nextCase.caseBasePath;
    data.snapshots = nextCase.snapshots;
    data.activeSnapshotId = targetSnapshotId;
    this.scene = nextCase.scene;
    this.renderAll();

    if (targetSnapshotId !== nextCase.scene.snapshotId) {
      this.requestSnapshotScene(targetSnapshotId, nextCase.caseId);
    }
  }

  private applyCaseUpdate(previousSnapshotId: string | undefined): void {
    const targetSnapshotId = previousSnapshotId && this.data.snapshots.some((item) => item.snapshotId === previousSnapshotId)
      ? previousSnapshotId
      : this.data.activeSnapshotId;

    this.data.activeSnapshotId = targetSnapshotId;
    this.scene = this.data.scene;
    this.renderAll();

    if (targetSnapshotId !== this.data.scene.snapshotId) {
      this.requestSnapshotScene(targetSnapshotId);
    }
  }

  private applyCompareUpdate(previousViewId: string | undefined): void {
    const compareScenes = this.data.compareScenes ?? [];
    const targetIndex = previousViewId
      ? compareScenes.findIndex((item) => item.viewId === previousViewId)
      : -1;
    this.activeSceneIndex = targetIndex >= 0 ? targetIndex : 0;
    this.data.activeSnapshotId = compareScenes[this.activeSceneIndex]?.viewId ?? this.data.activeSnapshotId;
    this.scene = this.activeScene();
    this.renderAll();
  }

  private requestSnapshotScene(snapshotId: string, caseId?: string): boolean {
    if (!this.vscode) {
      return false;
    }
    this.vscode.postMessage({
      type: "requestScene",
      requestId: `request-${Date.now()}`,
      payload: { caseId, snapshotId }
    });
    return true;
  }

  private handleMessage(message: unknown): void {
    if (!message || typeof message !== "object") {
      return;
    }
    const typed = message as {
      type?: string;
      payload?: {
        data?: WorkbenchInitialData;
        scene?: GksScene;
        message?: string;
        entityId?: string;
        properties?: Record<string, unknown>;
      } & Partial<WorkbenchRunSceneResult>;
    };
    if (typed.type === "sceneLoaded" && typed.payload?.scene) {
      this.scene = typed.payload.scene;
      this.renderAll();
    }
    if (typed.type === "runSceneLoaded" && typed.payload?.scene) {
      this.applyRunSceneResult(typed.payload as WorkbenchRunSceneResult);
    }
    if ((typed.type === "workbenchUpdated" || typed.type === "runUpdated") && typed.payload?.data) {
      this.applyWorkbenchUpdate(typed.payload.data);
      this.showUpdateNotice();
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
          this.selectEntity(selection?.entityId, false);
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
    renderer.onSelect((selection) => this.selectEntity(selection?.entityId, false));
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

  private setupHelpControls(): void {
    const button = this.mustQuery<HTMLButtonElement>(".control-help-button");
    const popover = this.mustQuery<HTMLElement>(".help-popover");
    button.addEventListener("click", () => {
      const isOpen = !popover.hidden;
      popover.hidden = isOpen;
      button.setAttribute("aria-expanded", String(!isOpen));
    });
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !popover.hidden) {
        popover.hidden = true;
        button.setAttribute("aria-expanded", "false");
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
    if (this.data.mode === "compare") {
      return this.data.compareScenes?.[this.activeSceneIndex]?.scene ?? this.scene;
    }
    if (this.data.mode === "run") {
      return this.activeRunCase()?.scene ?? this.scene;
    }
    return this.scene;
  }

  private titleText(): string {
    if (this.data.mode === "run") {
      const runTitle = this.data.run?.title ?? this.data.run?.runId ?? "Run";
      const activeCase = this.activeRunCase();
      const caseTitle = activeCase?.title ?? activeCase?.case.title ?? activeCase?.caseId;
      return caseTitle ? `${runTitle} / ${caseTitle} / ${this.scene.title ?? this.scene.sceneId}` : runTitle;
    }
    if (this.data.mode === "compare") {
      const compareTitle = this.data.compare?.title ?? this.data.compare?.compareId ?? "Compare";
      const active = this.data.compareScenes?.[this.activeSceneIndex]?.title;
      return active ? `${compareTitle} / ${active}` : compareTitle;
    }
    return this.scene.title ?? this.scene.sceneId;
  }

  private activeRunCase() {
    if (this.data.mode !== "run") {
      return undefined;
    }
    return this.data.runCases?.find((item) => item.caseId === this.data.activeRunCaseId) ?? this.data.runCases?.[0];
  }

  private selectAcrossRenderers(entityId: string | undefined): void {
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

  private showUpdateNotice(): void {
    const toast = this.mustQuery<HTMLElement>(".update-toast");
    toast.hidden = false;
    toast.textContent = "已自动刷新";
    window.requestAnimationFrame(() => toast.classList.add("is-visible"));
    if (this.updateNoticeTimer) {
      window.clearTimeout(this.updateNoticeTimer);
    }
    this.updateNoticeTimer = window.setTimeout(() => {
      toast.classList.remove("is-visible");
      this.updateNoticeTimer = window.setTimeout(() => {
        toast.hidden = true;
        this.updateNoticeTimer = undefined;
      }, 220);
    }, 2200);
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
