import type { EntityIdentity, GksScene } from "../schema/GksScene";

export class PropertyPanel {
  constructor(private readonly host: HTMLElement) {}

  render(scene: GksScene, entity: EntityIdentity | undefined): void {
    this.host.replaceChildren();
    if (!entity) {
      this.host.append(emptyState("No entity selected"));
      return;
    }

    const title = document.createElement("div");
    title.className = "property-title";
    title.textContent = entity.debugName ?? entity.entityId;

    const subtitle = document.createElement("div");
    subtitle.className = "property-subtitle";
    subtitle.textContent = `${entity.kind} ${entity.kernelTag === undefined ? "" : `#${entity.kernelTag}`}`.trim();

    const table = document.createElement("div");
    table.className = "property-table";
    const propertyGroups = {
      identity: entity,
      ...(scene.properties?.[entity.entityId] ?? {})
    };
    for (const [groupName, groupValue] of Object.entries(propertyGroups)) {
      table.append(groupHeader(groupName));
      appendRows(table, groupValue as Record<string, unknown>);
    }

    this.host.append(title, subtitle, table);
  }
}

function groupHeader(label: string): HTMLElement {
  const element = document.createElement("div");
  element.className = "property-group";
  element.textContent = label;
  return element;
}

function appendRows(host: HTMLElement, value: Record<string, unknown>): void {
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined || typeof item === "function") {
      continue;
    }
    const keyElement = document.createElement("div");
    keyElement.className = "property-key";
    keyElement.textContent = key;

    const valueElement = document.createElement("div");
    valueElement.className = "property-value";
    valueElement.textContent = formatValue(item);

    host.append(keyElement, valueElement);
  }
}

function formatValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((item) => typeof item === "number" ? Number(item.toFixed(4)).toString() : String(item)).join(", ");
  }
  if (value && typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function emptyState(text: string): HTMLElement {
  const element = document.createElement("div");
  element.className = "empty-state";
  element.textContent = text;
  return element;
}

