import type { EntityIdentity, GksScene } from "../schema/GksScene";
import { ancestorIdsForEntity, buildEntityParentIndex, childrenForEntity } from "../schema/GksScene";

type SelectHandler = (entityId: string) => void;
type VisibilityHandler = (entityId: string) => void;

export interface TopologyTreeRenderState {
  selectedEntityId?: string;
  hiddenEntityIds: ReadonlySet<string>;
  effectiveHiddenEntityIds: ReadonlySet<string>;
  revealEntityId?: string;
}

export class TopologyTreePanel {
  private readonly expandedEntityIds = new Set<string>();
  private readonly expandedGroupIds = new Set<string>();
  private readonly rowByEntityId = new Map<string, HTMLElement>();
  private sceneKey: string | undefined;

  constructor(
    private readonly host: HTMLElement,
    private readonly onSelect: SelectHandler,
    private readonly onToggleVisibility: VisibilityHandler
  ) {}

  render(scene: GksScene, state: TopologyTreeRenderState): void {
    this.lastScene = scene;
    this.lastState = { ...state, revealEntityId: undefined };
    this.ensureSceneExpansion(scene);
    if (state.revealEntityId) {
      for (const ancestorId of ancestorIdsForEntity(scene, state.revealEntityId)) {
        this.expandedEntityIds.add(ancestorId);
      }
    }

    this.rowByEntityId.clear();
    this.host.replaceChildren();
    const list = document.createElement("div");
    list.className = "topology-tree";

    for (const body of scene.topology.bodies) {
      list.append(this.renderNode(scene, body, state, 0));
    }

    const looseEntities = this.looseEntities(scene);
    if (looseEntities.length) {
      list.append(this.renderGroup("Loose Entities", "loose", looseEntities, state, 0));
    }
    this.host.append(list);

    if (state.revealEntityId) {
      this.scrollToEntity(state.revealEntityId);
    }
  }

  private renderNode(scene: GksScene, entity: EntityIdentity, state: TopologyTreeRenderState, depth: number): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "tree-node";

    const children = childrenForEntity(scene, entity);
    const isExpanded = children.length > 0 && this.expandedEntityIds.has(entity.entityId);
    wrapper.append(this.renderEntityRow(entity, state, depth, children.length > 0, isExpanded));

    if (children.length && isExpanded) {
      const childHost = document.createElement("div");
      childHost.className = "tree-children";
      for (const child of children) {
        childHost.append(this.renderNode(scene, child, state, depth + 1));
      }
      wrapper.append(childHost);
    }
    return wrapper;
  }

  private renderGroup(
    label: string,
    groupId: string,
    entities: EntityIdentity[],
    state: TopologyTreeRenderState,
    depth: number
  ): HTMLElement {
    const group = document.createElement("div");
    group.className = "tree-node";
    const isExpanded = this.expandedGroupIds.has(groupId);
    const header = document.createElement("div");
    header.className = "tree-group-row";
    header.style.setProperty("--depth", String(depth));

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = isExpanded ? "tree-toggle-button is-expanded" : "tree-toggle-button";
    toggle.title = isExpanded ? "Collapse group" : "Expand group";
    toggle.setAttribute("aria-label", toggle.title);
    toggle.setAttribute("aria-expanded", String(isExpanded));
    toggle.addEventListener("click", () => {
      this.toggleGroup(groupId);
      this.renderFromLastKnownState();
    });

    const text = document.createElement("div");
    text.className = "tree-group";
    text.textContent = label;
    header.append(toggle, text);
    group.append(header);

    if (isExpanded) {
      const childHost = document.createElement("div");
      childHost.className = "tree-children";
      for (const entity of entities) {
        childHost.append(this.renderEntityRow(entity, state, depth + 1, false, false));
      }
      group.append(childHost);
    }
    return group;
  }

  private renderEntityRow(
    entity: EntityIdentity,
    state: TopologyTreeRenderState,
    depth: number,
    hasChildren: boolean,
    isExpanded: boolean
  ): HTMLElement {
    const row = document.createElement("div");
    const isSelected = entity.entityId === state.selectedEntityId;
    const isExplicitlyHidden = state.hiddenEntityIds.has(entity.entityId);
    const isEffectivelyHidden = state.effectiveHiddenEntityIds.has(entity.entityId);
    row.className = [
      "tree-row",
      isSelected ? "is-selected" : "",
      isEffectivelyHidden ? "is-hidden" : "",
      isEffectivelyHidden && !isExplicitlyHidden ? "is-hidden-by-parent" : ""
    ].filter(Boolean).join(" ");
    row.style.setProperty("--depth", String(depth));
    row.dataset.entityId = entity.entityId;
    if (!this.rowByEntityId.has(entity.entityId)) {
      this.rowByEntityId.set(entity.entityId, row);
    }

    if (hasChildren) {
      row.append(this.renderExpandButton(entity, isExpanded));
    } else {
      const spacer = document.createElement("span");
      spacer.className = "tree-toggle-spacer";
      row.append(spacer);
    }

    row.append(this.renderSelectButton(entity));
    row.append(this.renderVisibilityButton(entity, isExplicitlyHidden, isEffectivelyHidden));
    return row;
  }

  private renderExpandButton(entity: EntityIdentity, isExpanded: boolean): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = isExpanded ? "tree-toggle-button is-expanded" : "tree-toggle-button";
    button.title = isExpanded ? "Collapse" : "Expand";
    button.setAttribute("aria-label", `${button.title} ${entity.debugName ?? entity.entityId}`);
    button.setAttribute("aria-expanded", String(isExpanded));
    button.addEventListener("click", () => {
      if (isExpanded) {
        this.expandedEntityIds.delete(entity.entityId);
      } else {
        this.expandedEntityIds.add(entity.entityId);
      }
      this.renderFromLastKnownState();
    });
    return button;
  }

  private renderSelectButton(entity: EntityIdentity): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tree-item";
    button.title = entity.entityId;
    button.addEventListener("click", () => this.onSelect(entity.entityId));

    const kind = document.createElement("span");
    kind.className = `kind-token kind-${entity.kind}`;
    kind.textContent = entity.kind;

    const label = document.createElement("span");
    label.className = "tree-label";
    label.textContent = entity.debugName ?? entity.entityId;

    const tag = document.createElement("span");
    tag.className = "tree-tag";
    tag.textContent = entity.kernelTag === undefined ? "" : `#${entity.kernelTag}`;

    button.append(kind, label, tag);
    return button;
  }

  private renderVisibilityButton(
    entity: EntityIdentity,
    isExplicitlyHidden: boolean,
    isEffectivelyHidden: boolean
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = isEffectivelyHidden ? "tree-visibility-button is-hidden" : "tree-visibility-button";
    button.title = isExplicitlyHidden ? "Show entity" : isEffectivelyHidden ? "Hidden by parent" : "Hide entity";
    button.setAttribute("aria-label", `${button.title}: ${entity.debugName ?? entity.entityId}`);
    button.setAttribute("aria-pressed", String(!isEffectivelyHidden));
    button.disabled = isEffectivelyHidden && !isExplicitlyHidden;
    button.addEventListener("click", () => this.onToggleVisibility(entity.entityId));
    return button;
  }

  private scrollToEntity(entityId: string): void {
    const row = this.rowByEntityId.get(entityId);
    if (!row) {
      return;
    }
    row.scrollIntoView({ block: "center" });
    row.classList.add("is-revealed");
    window.setTimeout(() => row.classList.remove("is-revealed"), 1100);
  }

  private ensureSceneExpansion(scene: GksScene): void {
    const nextSceneKey = scene.sceneId;
    if (this.sceneKey === nextSceneKey) {
      return;
    }
    this.sceneKey = nextSceneKey;
    this.expandedEntityIds.clear();
    this.expandedGroupIds.clear();
    this.expandedGroupIds.add("loose");
    for (const entity of this.expandableEntities(scene)) {
      this.expandedEntityIds.add(entity.entityId);
    }
  }

  private expandableEntities(scene: GksScene): EntityIdentity[] {
    const result: EntityIdentity[] = [];
    const pending = [...scene.topology.bodies];
    while (pending.length) {
      const entity = pending.shift();
      if (!entity) {
        continue;
      }
      const children = childrenForEntity(scene, entity);
      if (children.length) {
        result.push(entity);
        pending.push(...children);
      }
    }
    return result;
  }

  private looseEntities(scene: GksScene): EntityIdentity[] {
    const parents = buildEntityParentIndex(scene);
    const candidates = [
      ...scene.topology.regions,
      ...scene.topology.shells,
      ...scene.topology.faces,
      ...scene.topology.loops,
      ...scene.topology.coedges,
      ...scene.topology.edges,
      ...scene.topology.vertices
    ];
    return candidates.filter((entity) => !parents.has(entity.entityId));
  }

  private lastScene: GksScene | undefined;
  private lastState: TopologyTreeRenderState | undefined;

  private renderFromLastKnownState(): void {
    if (!this.lastScene || !this.lastState) {
      return;
    }
    this.render(this.lastScene, this.lastState);
  }

  private toggleGroup(groupId: string): void {
    if (this.expandedGroupIds.has(groupId)) {
      this.expandedGroupIds.delete(groupId);
    } else {
      this.expandedGroupIds.add(groupId);
    }
  }
}
