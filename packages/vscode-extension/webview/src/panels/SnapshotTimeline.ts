import type { WorkbenchSnapshotItem } from "../schema/GksScene";

export class SnapshotTimeline {
  constructor(
    private readonly host: HTMLElement,
    private readonly onActivate: (snapshotId: string) => void
  ) {}

  render(snapshots: WorkbenchSnapshotItem[], activeSnapshotId: string): void {
    this.host.replaceChildren();
    for (const snapshot of snapshots) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = snapshot.snapshotId === activeSnapshotId ? "timeline-item is-active" : "timeline-item";
      button.dataset.snapshotId = snapshot.snapshotId;
      button.textContent = snapshot.title ?? snapshot.snapshotId;
      button.addEventListener("click", () => this.onActivate(snapshot.snapshotId));
      this.host.append(button);
    }
  }
}
