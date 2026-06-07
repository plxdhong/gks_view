import type { EntityIdentity, GksScene } from "../schema/GksScene";

type SelectHandler = (entityId: string) => void;

export class TopologyTreePanel {
  constructor(
    private readonly host: HTMLElement,
    private readonly onSelect: SelectHandler
  ) {}

  render(scene: GksScene, selectedEntityId?: string): void {
    this.host.replaceChildren();
    const list = document.createElement("div");
    list.className = "topology-tree";

    for (const body of scene.topology.bodies) {
      list.append(this.renderNode(scene, body, selectedEntityId, 0));
    }

    const freeEdges = scene.topology.edges.filter((edge) => !edge.adjacentFaces?.length);
    const vertices = scene.topology.vertices;
    if (freeEdges.length || vertices.length) {
      list.append(this.renderGroup("Loose Entities", [...freeEdges, ...vertices], selectedEntityId, 0));
    }
    this.host.append(list);
  }

  private renderNode(scene: GksScene, entity: EntityIdentity, selectedEntityId: string | undefined, depth: number): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "tree-node";
    wrapper.append(this.renderButton(entity, selectedEntityId, depth));

    const children = this.childrenFor(scene, entity);
    for (const child of children) {
      wrapper.append(this.renderNode(scene, child, selectedEntityId, depth + 1));
    }
    return wrapper;
  }

  private renderGroup(label: string, entities: EntityIdentity[], selectedEntityId: string | undefined, depth: number): HTMLElement {
    const group = document.createElement("div");
    group.className = "tree-node";
    const header = document.createElement("div");
    header.className = "tree-group";
    header.style.setProperty("--depth", String(depth));
    header.textContent = label;
    group.append(header);
    for (const entity of entities) {
      group.append(this.renderButton(entity, selectedEntityId, depth + 1));
    }
    return group;
  }

  private renderButton(entity: EntityIdentity, selectedEntityId: string | undefined, depth: number): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = entity.entityId === selectedEntityId ? "tree-item is-selected" : "tree-item";
    button.style.setProperty("--depth", String(depth));
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

  private childrenFor(scene: GksScene, entity: EntityIdentity): EntityIdentity[] {
    if (entity.kind === "body") {
      return scene.topology.regions.filter((region) => entity.regions?.includes(region.entityId));
    }
    if (entity.kind === "region") {
      return scene.topology.shells.filter((shell) => entity.shells?.includes(shell.entityId));
    }
    if (entity.kind === "shell") {
      return scene.topology.faces.filter((face) => entity.faces?.includes(face.entityId));
    }
    if (entity.kind === "face") {
      return scene.topology.loops.filter((loop) => entity.loops?.includes(loop.entityId));
    }
    if (entity.kind === "loop") {
      return scene.topology.coedges.filter((coedge) => entity.coedges?.includes(coedge.entityId));
    }
    if (entity.kind === "coedge") {
      return scene.topology.edges.filter((edge) => edge.entityId === entity.edge);
    }
    if (entity.kind === "edge") {
      return scene.topology.vertices.filter((vertex) => entity.vertices?.includes(vertex.entityId));
    }
    return [];
  }
}

