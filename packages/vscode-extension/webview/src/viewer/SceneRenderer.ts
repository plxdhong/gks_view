import * as THREE from "three";
import { TrackballControls } from "three/examples/jsm/controls/TrackballControls.js";
import type { EntityKind, GksScene } from "../schema/GksScene";
import { kindFromEntityId } from "../schema/GksScene";

export interface PickedEntity {
  entityId: string;
  kind: EntityKind;
}

export type CameraMode = "perspective" | "orthographic";
export type DisplayMode = "points" | "wireframe" | "solid" | "all" | "xray";

type SelectCallback = (selection: PickedEntity | undefined) => void;
type RenderKind = "solid" | "wireframe" | "point";
type WorkbenchCamera = THREE.PerspectiveCamera | THREE.OrthographicCamera;
type LoadSceneOptions = {
  resetCamera?: boolean;
};
type ColorMaterial = THREE.Material & {
  color?: THREE.Color;
  opacity: number;
  transparent: boolean;
  depthWrite: boolean;
};

const faceColor = new THREE.Color("#6aa6d8");
const highlightColor = new THREE.Color("#d9a441");
const selectionColor = new THREE.Color("#e5574f");
const edgeColor = new THREE.Color("#1f2937");
const vertexColor = new THREE.Color("#f7f7f4");
const xrayOpacity = 0.32;
const perspectivePanSpeed = 0.38;
const axisColors = {
  x: new THREE.Color("#d44f45"),
  y: new THREE.Color("#2f9b5f"),
  z: new THREE.Color("#3b72d9")
};

export class SceneRenderer {
  private readonly scene = new THREE.Scene();
  private readonly perspectiveCamera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
  private readonly orthographicCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 1000);
  private activeCamera: WorkbenchCamera = this.perspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly controls: TrackballControls;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly selectable: THREE.Object3D[] = [];
  private readonly entityObjects = new Map<string, THREE.Object3D[]>();
  private readonly vertexPointObjects: THREE.Mesh[] = [];
  private readonly root = new THREE.Group();
  private readonly scaleBar = document.createElement("div");
  private readonly scaleBarLine = document.createElement("div");
  private readonly scaleBarLabel = document.createElement("div");
  private readonly sceneBounds = new THREE.Box3();
  private readonly defaultViewDirection = new THREE.Vector3(1, -1, 0.75).normalize();
  private readonly defaultCameraUp = new THREE.Vector3(0, 0, 1);
  private currentUnit = "m";
  private cameraMode: CameraMode = "perspective";
  private displayMode: DisplayMode = "all";
  private hiddenEntityIds = new Set<string>();
  private orthographicViewHeight = 2;
  private originAxes: THREE.Group | undefined;
  private hasLoadedScene = false;
  private selectedEntityId: string | undefined;
  private onSelectCallback: SelectCallback | undefined;
  private resizeObserver: ResizeObserver | undefined;
  private pointerDown: { x: number; y: number; button: number } | undefined;

  constructor(private readonly host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor("#f3f3ef");
    this.renderer.domElement.className = "viewer-canvas";
    this.host.append(this.renderer.domElement);
    this.scaleBar.className = "scale-bar";
    this.scaleBarLine.className = "scale-bar-line";
    this.scaleBarLabel.className = "scale-bar-label";
    this.scaleBar.append(this.scaleBarLine, this.scaleBarLabel);
    this.host.append(this.scaleBar);

    this.controls = new TrackballControls(this.activeCamera, this.renderer.domElement);
    this.controls.rotateSpeed = 2.4;
    this.controls.zoomSpeed = 1.15;
    this.controls.panSpeed = perspectivePanSpeed;
    this.controls.staticMoving = true;
    this.controls.keys = ["KeyA", "KeyS", "ShiftLeft"];
    this.controls.addEventListener("change", this.handleControlsChange);

    this.scene.add(this.root);
    this.scene.add(new THREE.HemisphereLight("#ffffff", "#8c8c82", 1.1));
    const keyLight = new THREE.DirectionalLight("#ffffff", 1.8);
    keyLight.position.set(5, -6, 7);
    this.scene.add(keyLight);

    this.raycaster.params.Line = { threshold: 0.035 };
    this.raycaster.params.Points = { threshold: 0.08 };
    this.renderer.domElement.addEventListener("pointerdown", this.handlePointerDown);
    this.renderer.domElement.addEventListener("pointerup", this.handlePointerUp);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.host);
    this.resize();
    this.animate();
  }

  dispose(): void {
    this.resizeObserver?.disconnect();
    this.renderer.domElement.removeEventListener("pointerdown", this.handlePointerDown);
    this.renderer.domElement.removeEventListener("pointerup", this.handlePointerUp);
    this.controls.removeEventListener("change", this.handleControlsChange);
    this.controls.dispose();
    this.renderer.dispose();
  }

  onSelect(callback: SelectCallback): void {
    this.onSelectCallback = callback;
  }

  loadScene(
    scene: GksScene,
    selectedEntityId?: string,
    hiddenEntityIds: ReadonlySet<string> = new Set<string>(),
    options: LoadSceneOptions = {}
  ): void {
    const shouldResetCamera = options.resetCamera ?? !this.hasLoadedScene;
    this.clear();
    this.selectedEntityId = selectedEntityId;
    this.hiddenEntityIds = new Set(hiddenEntityIds);
    this.currentUnit = scene.unit ?? "m";
    const highlightColors = highlightColorByEntity(scene);

    for (const mesh of scene.geometry.faceMeshes) {
      if (mesh.display?.visible === false) {
        continue;
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(mesh.positions, 3));
      geometry.setIndex(mesh.indices);
      if (mesh.normals?.length) {
        geometry.setAttribute("normal", new THREE.Float32BufferAttribute(mesh.normals, 3));
      } else {
        geometry.computeVertexNormals();
      }
      geometry.computeBoundingSphere();
      const baseColor = new THREE.Color(mesh.display?.color ?? faceColor);
      const effectiveColor = highlightColors.get(mesh.entityId) ?? baseColor;
      const material = new THREE.MeshStandardMaterial({
        color: effectiveColor,
        metalness: 0,
        roughness: 0.72,
        transparent: (mesh.display?.opacity ?? 1) < 1,
        opacity: mesh.display?.opacity ?? 1,
        side: THREE.DoubleSide
      });
      const object = new THREE.Mesh(geometry, material);
      this.addEntityObject(mesh.entityId, object, "solid");
    }

    for (const polyline of scene.geometry.edgePolylines) {
      if (polyline.display?.visible === false) {
        continue;
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(polyline.points, 3));
      const material = new THREE.LineBasicMaterial({
        color: highlightColors.get(polyline.entityId) ?? (polyline.display?.color ?? edgeColor),
        linewidth: polyline.display?.lineWidth ?? 1
      });
      const line = new THREE.Line(geometry, material);
      this.addEntityObject(polyline.entityId, line, "wireframe");
    }

    const vertexGeometry = new THREE.SphereGeometry(1, 12, 8);
    for (const point of scene.geometry.vertexPoints) {
      if (point.display?.visible === false) {
        continue;
      }
      const material = new THREE.MeshStandardMaterial({
        color: highlightColors.get(point.entityId) ?? (point.display?.color ?? vertexColor),
        metalness: 0,
        roughness: 0.35
      });
      const sphere = new THREE.Mesh(vertexGeometry.clone(), material);
      sphere.position.set(point.position[0], point.position[1], point.position[2]);
      this.vertexPointObjects.push(sphere);
      this.addEntityObject(point.entityId, sphere, "point");
    }
    vertexGeometry.dispose();

    this.addTransientObjects(scene);
    this.addOriginAxes();
    this.sceneBounds.copy(boundsForDiscreteGeometry(scene));
    this.defaultViewDirection.copy(defaultViewDirectionForScene(scene));
    this.defaultCameraUp.copy(defaultCameraUpForScene(scene));
    this.applySelection(selectedEntityId);
    this.applyDisplayMode();
    if (shouldResetCamera) {
      this.resetView();
    } else {
      this.updateOrthographicFrame();
      this.updateClippingForCurrentView();
      this.controls.handleResize();
      this.controls.update();
    }
    this.hasLoadedScene = true;
    this.updateViewDependentDecorations();
    this.updateScaleBar();
  }

  resetView(): void {
    const bounds = this.sceneBounds.isEmpty() ? new THREE.Box3(
      new THREE.Vector3(-1, -1, -1),
      new THREE.Vector3(1, 1, 1)
    ) : this.sceneBounds;
    const center = bounds.getCenter(new THREE.Vector3());
    const radius = radiusForBounds(bounds, 1);
    const fitFraction = 0.75;
    const viewDirection = this.defaultViewDirection.clone().normalize();
    const distance = this.cameraMode === "perspective"
      ? this.resetPerspectiveView(center, radius, fitFraction)
      : this.resetOrthographicView(center, radius, fitFraction);

    this.controls.target.copy(center);
    this.activeCamera.up.copy(safeCameraUp(this.defaultCameraUp, viewDirection));
    this.activeCamera.position.copy(center).addScaledVector(viewDirection, distance);
    this.updateCameraClipping(this.activeCamera, distance, radius);
    this.controls.handleResize();
    this.controls.update();
    this.updateViewDependentDecorations();
    this.updateScaleBar();
  }

  setCameraMode(mode: CameraMode): void {
    if (this.cameraMode === mode) {
      return;
    }

    const previousCamera = this.activeCamera;
    const target = this.controls.target.clone();
    const currentVisibleHeight = this.visibleWorldHeight();
    const direction = previousCamera.position.clone().sub(target);
    if (direction.lengthSq() === 0) {
      direction.copy(this.defaultViewDirection);
    }
    direction.normalize();

    this.cameraMode = mode;
    this.activeCamera = mode === "perspective" ? this.perspectiveCamera : this.orthographicCamera;
    this.activeCamera.up.copy(safeCameraUp(previousCamera.up, direction));
    this.controls.object = this.activeCamera;

    const radius = this.sceneRadius();
    const distance = mode === "perspective"
      ? this.distanceForPerspectiveVisibleHeight(currentVisibleHeight)
      : Math.max(previousCamera.position.distanceTo(target), radius * 4, 1e-6);

    if (mode === "orthographic") {
      this.orthographicViewHeight = Math.max(currentVisibleHeight, radius * 2, 1e-9);
      this.orthographicCamera.zoom = 1;
      this.updateOrthographicFrame();
    }

    this.activeCamera.position.copy(target).addScaledVector(direction, distance);
    this.updateCameraClipping(this.activeCamera, distance, radius);
    this.controls.handleResize();
    this.controls.update();
    this.updateViewDependentDecorations();
    this.updateScaleBar();
  }

  setDisplayMode(mode: DisplayMode): void {
    if (this.displayMode === mode) {
      return;
    }
    this.displayMode = mode;
    this.applyDisplayMode();
  }

  setHiddenEntities(hiddenEntityIds: ReadonlySet<string>): void {
    this.hiddenEntityIds = new Set(hiddenEntityIds);
    this.applyDisplayMode();
  }

  select(entityId: string | undefined): void {
    this.selectedEntityId = entityId;
    this.applySelection(entityId);
  }

  focus(entityId: string): void {
    const objects = this.entityObjects.get(entityId);
    if (!objects?.length) {
      return;
    }
    const box = new THREE.Box3();
    for (const object of objects) {
      box.expandByObject(object);
    }
    const center = box.getCenter(new THREE.Vector3());
    this.controls.target.copy(center);
    this.controls.update();
  }

  private addEntityObject(entityId: string, object: THREE.Object3D, renderKind: RenderKind): void {
    object.userData.entityId = entityId;
    object.userData.renderKind = renderKind;
    const material = materialForObject(object);
    object.userData.baseColor = material?.color?.clone();
    object.userData.baseOpacity = material?.opacity;
    object.userData.baseTransparent = material?.transparent;
    object.userData.baseDepthWrite = material?.depthWrite;
    this.root.add(object);
    this.selectable.push(object);
    const list = this.entityObjects.get(entityId) ?? [];
    list.push(object);
    this.entityObjects.set(entityId, list);
  }

  private addTransientObjects(scene: GksScene): void {
    for (const object of scene.geometry.transientObjects ?? []) {
      if (object.kind === "axis" && Array.isArray(object.points)) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(object.points as number[], 3));
        const material = new THREE.LineBasicMaterial({ color: String(object.color ?? "#e5574f") });
        this.root.add(new THREE.Line(geometry, material));
      }
    }
  }

  private addOriginAxes(): void {
    const group = new THREE.Group();
    group.name = "origin-axes";

    group.add(this.createAxis("x", new THREE.Vector3(1, 0, 0)));
    group.add(this.createAxis("y", new THREE.Vector3(0, 1, 0)));
    group.add(this.createAxis("z", new THREE.Vector3(0, 0, 1)));
    group.add(this.createAxisLabel("X", axisColors.x, new THREE.Vector3(1.12, 0, 0)));
    group.add(this.createAxisLabel("Y", axisColors.y, new THREE.Vector3(0, 1.12, 0)));
    group.add(this.createAxisLabel("Z", axisColors.z, new THREE.Vector3(0, 0, 1.12)));

    this.originAxes = group;
    this.root.add(group);
  }

  private createAxis(
    axis: "x" | "y" | "z",
    direction: THREE.Vector3
  ): THREE.Group {
    const group = new THREE.Group();
    const color = axisColors[axis];
    const material = new THREE.MeshBasicMaterial({
      color,
      depthTest: false,
      depthWrite: false
    });
    const length = 1;
    const shaftRadius = 0.008;
    const arrowRadius = 0.035;
    const arrowLength = 0.14;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(shaftRadius, shaftRadius, length - arrowLength, 12), material);
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(arrowRadius, arrowLength, 18), material);

    shaft.position.y = (length - arrowLength) / 2;
    arrow.position.y = length - arrowLength / 2;
    group.add(shaft, arrow);
    shaft.renderOrder = 20;
    arrow.renderOrder = 20;
    group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
    return group;
  }

  private createAxisLabel(label: string, color: THREE.Color, position: THREE.Vector3): THREE.Sprite {
    const canvas = document.createElement("canvas");
    canvas.width = 96;
    canvas.height = 96;
    const context = canvas.getContext("2d");
    if (context) {
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = `#${color.getHexString()}`;
      context.font = "700 54px Inter, system-ui, sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(label, canvas.width / 2, canvas.height / 2);
    }
    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false
    });
    const sprite = new THREE.Sprite(material);
    sprite.position.copy(position);
    const size = 0.18;
    sprite.scale.set(size, size, size);
    return sprite;
  }

  private applySelection(entityId: string | undefined): void {
    for (const [id, objects] of this.entityObjects) {
      for (const object of objects) {
        const material = materialForObject(object);
        if (!material?.color) {
          continue;
        }
        const baseColor = object.userData.baseColor as THREE.Color | undefined;
        material.color.copy(id === entityId ? selectionColor : baseColor ?? faceColor);
        material.needsUpdate = true;
      }
    }
  }

  private applyDisplayMode(): void {
    for (const objects of this.entityObjects.values()) {
      for (const object of objects) {
        const renderKind = object.userData.renderKind as RenderKind | undefined;
        const material = materialForObject(object);
        const entityId = object.userData.entityId as string | undefined;
        object.visible = this.isRenderKindVisible(renderKind) && !this.hiddenEntityIds.has(entityId ?? "");

        if (!material) {
          continue;
        }

        material.opacity = object.userData.baseOpacity as number | undefined ?? 1;
        material.transparent = object.userData.baseTransparent as boolean | undefined ?? false;
        material.depthWrite = object.userData.baseDepthWrite as boolean | undefined ?? true;

        if (this.displayMode === "xray" && renderKind === "solid") {
          material.opacity = Math.min(material.opacity, xrayOpacity);
          material.transparent = true;
          material.depthWrite = false;
        }

        material.needsUpdate = true;
      }
    }
  }

  private isRenderKindVisible(renderKind: RenderKind | undefined): boolean {
    if (!renderKind) {
      return true;
    }
    if (this.displayMode === "all" || this.displayMode === "xray") {
      return true;
    }
    if (this.displayMode === "points") {
      return renderKind === "point";
    }
    if (this.displayMode === "wireframe") {
      return renderKind === "wireframe";
    }
    return renderKind === "solid";
  }

  private clear(): void {
    while (this.root.children.length) {
      const child = this.root.children.pop();
      if (!child) {
        continue;
      }
      child.traverse((object) => {
        const mesh = object as THREE.Mesh;
        mesh.geometry?.dispose?.();
        const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(material)) {
          for (const item of material) {
            item.dispose();
          }
        } else {
          material?.dispose?.();
        }
      });
    }
    this.selectable.length = 0;
    this.entityObjects.clear();
    this.vertexPointObjects.length = 0;
    this.originAxes = undefined;
  }

  private resize(): void {
    const rect = this.host.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    this.perspectiveCamera.aspect = width / height;
    this.perspectiveCamera.updateProjectionMatrix();
    this.updateOrthographicFrame(width, height);
    this.renderer.setSize(width, height, false);
    this.controls.handleResize();
    this.updateViewDependentDecorations();
    this.updateScaleBar();
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate);
    this.updateControlTuning();
    this.controls.update();
    this.updateViewDependentDecorations();
    this.updateScaleBar();
    this.renderer.render(this.scene, this.activeCamera);
  };

  private handleControlsChange = (): void => {
    this.updateClippingForCurrentView();
    this.updateViewDependentDecorations();
    this.updateScaleBar();
  };

  private updateControlTuning(): void {
    if (this.activeCamera instanceof THREE.OrthographicCamera) {
      const distance = this.activeCamera.position.distanceTo(this.controls.target);
      const width = Math.max(1, this.renderer.domElement.clientWidth);
      this.controls.panSpeed = width / Math.max(distance, 1e-9);
      return;
    }
    this.controls.panSpeed = perspectivePanSpeed;
  }

  private updateScaleBar(): void {
    const worldPerPixel = this.worldUnitsPerPixel();
    if (!worldPerPixel) {
      return;
    }
    const targetPixels = 120;
    const worldLength = niceScaleLength(worldPerPixel * targetPixels);
    const pixelLength = Math.max(42, Math.min(220, worldLength / worldPerPixel));

    this.scaleBarLine.style.width = `${pixelLength}px`;
    this.scaleBarLabel.textContent = `${formatScaleValue(worldLength)} ${this.currentUnit}`;
  }

  private updateViewDependentDecorations(): void {
    const worldPerPixel = this.worldUnitsPerPixel();
    const visibleHeight = this.visibleWorldHeight();
    if (!worldPerPixel || !Number.isFinite(visibleHeight) || visibleHeight <= 0) {
      return;
    }

    const pointRadius = worldPerPixel * 4.5;
    for (const point of this.vertexPointObjects) {
      point.scale.setScalar(pointRadius);
    }

    const axisLength = visibleHeight * 0.16;
    this.originAxes?.scale.setScalar(axisLength);
    this.raycaster.params.Line = { threshold: worldPerPixel * 6 };
    this.raycaster.params.Points = { threshold: worldPerPixel * 8 };
  }

  private handlePointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) {
      this.pointerDown = undefined;
      return;
    }
    this.pointerDown = { x: event.clientX, y: event.clientY, button: event.button };
  };

  private handlePointerUp = (event: PointerEvent): void => {
    const down = this.pointerDown;
    this.pointerDown = undefined;
    if (!down || down.button !== event.button) {
      return;
    }
    const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y);
    if (moved > 4) {
      return;
    }

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.activeCamera);
    const [hit] = this.raycaster.intersectObjects(this.selectable.filter((object) => object.visible), true);
    const entityId = entityIdForHitObject(hit?.object);
    const kind = entityId ? kindFromEntityId(entityId) : undefined;
    if (!entityId || !kind) {
      this.selectedEntityId = undefined;
      this.applySelection(undefined);
      this.onSelectCallback?.(undefined);
      return;
    }
    if (hit?.point) {
      this.controls.target.copy(hit.point);
      this.controls.update();
      this.updateViewDependentDecorations();
      this.updateScaleBar();
    }
    this.selectedEntityId = entityId;
    this.applySelection(entityId);
    this.onSelectCallback?.({ entityId, kind });
  };

  private resetPerspectiveView(center: THREE.Vector3, radius: number, fitFraction: number): number {
    const aspect = this.cameraAspect();
    const verticalFov = THREE.MathUtils.degToRad(this.perspectiveCamera.fov);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * aspect);
    const limitingFov = Math.min(verticalFov, horizontalFov);
    const distance = radius / Math.sin((limitingFov * fitFraction) / 2);
    this.perspectiveCamera.aspect = aspect;
    this.activeCamera = this.perspectiveCamera;
    this.controls.object = this.activeCamera;
    this.perspectiveCamera.position.copy(center).addScaledVector(this.defaultViewDirection, distance);
    this.perspectiveCamera.updateProjectionMatrix();
    return distance;
  }

  private resetOrthographicView(center: THREE.Vector3, radius: number, fitFraction: number): number {
    const aspect = this.cameraAspect();
    const diameter = radius * 2;
    this.orthographicViewHeight = diameter / fitFraction / Math.min(aspect, 1);
    this.orthographicCamera.zoom = 1;
    this.updateOrthographicFrame();
    const distance = Math.max(radius * 4, 1e-6);
    this.activeCamera = this.orthographicCamera;
    this.controls.object = this.activeCamera;
    this.orthographicCamera.position.copy(center).addScaledVector(this.defaultViewDirection, distance);
    this.orthographicCamera.updateProjectionMatrix();
    return distance;
  }

  private updateOrthographicFrame(width?: number, height?: number): void {
    const rect = this.host.getBoundingClientRect();
    const canvasWidth = Math.max(1, width ?? Math.floor(rect.width));
    const canvasHeight = Math.max(1, height ?? Math.floor(rect.height));
    const aspect = canvasWidth / canvasHeight;
    const halfHeight = this.orthographicViewHeight / 2;
    this.orthographicCamera.left = -halfHeight * aspect;
    this.orthographicCamera.right = halfHeight * aspect;
    this.orthographicCamera.top = halfHeight;
    this.orthographicCamera.bottom = -halfHeight;
    this.orthographicCamera.updateProjectionMatrix();
  }

  private updateCameraClipping(camera: WorkbenchCamera, distance: number, radius: number): void {
    const nearFarPadding = Math.max(radius * 8, distance * 2, 1e-9);
    const minimumNear = Math.max(radius * 1e-4, 1e-12);
    camera.near = Math.max(distance - nearFarPadding, minimumNear);
    camera.far = Math.max(distance + nearFarPadding, camera.near * 10);
    camera.updateProjectionMatrix();
  }

  private updateClippingForCurrentView(): void {
    const bounds = this.sceneBounds.isEmpty() ? new THREE.Box3(
      new THREE.Vector3(-1, -1, -1),
      new THREE.Vector3(1, 1, 1)
    ) : this.sceneBounds;
    const center = bounds.getCenter(new THREE.Vector3());
    const radius = radiusForBounds(bounds, 1);
    const distance = this.activeCamera.position.distanceTo(center);
    this.updateCameraClipping(this.activeCamera, distance, radius);
  }

  private visibleWorldHeight(): number {
    if (this.activeCamera instanceof THREE.OrthographicCamera) {
      return (this.activeCamera.top - this.activeCamera.bottom) / this.activeCamera.zoom;
    }
    const distance = this.activeCamera.position.distanceTo(this.controls.target);
    return 2 * distance * Math.tan(THREE.MathUtils.degToRad(this.activeCamera.fov / 2));
  }

  private distanceForPerspectiveVisibleHeight(visibleHeight: number): number {
    if (!Number.isFinite(visibleHeight) || visibleHeight <= 0) {
      return Math.max(this.sceneRadius() * 4, 1);
    }
    return visibleHeight / (2 * Math.tan(THREE.MathUtils.degToRad(this.perspectiveCamera.fov / 2)));
  }

  private sceneRadius(): number {
    const bounds = this.sceneBounds.isEmpty() ? new THREE.Box3(
      new THREE.Vector3(-1, -1, -1),
      new THREE.Vector3(1, 1, 1)
    ) : this.sceneBounds;
    return radiusForBounds(bounds, 1);
  }

  private cameraAspect(): number {
    const height = Math.max(1, this.renderer.domElement.clientHeight);
    const width = Math.max(1, this.renderer.domElement.clientWidth);
    return width / height;
  }

  private worldUnitsPerPixel(): number | undefined {
    const height = this.renderer.domElement.clientHeight;
    if (height <= 0) {
      return undefined;
    }
    const visibleHeight = this.visibleWorldHeight();
    if (!Number.isFinite(visibleHeight) || visibleHeight <= 0) {
      return undefined;
    }
    return visibleHeight / height;
  }
}

function materialForObject(object: THREE.Object3D): ColorMaterial | undefined {
  if (!(object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points)) {
    return undefined;
  }
  const material = object.material;
  return Array.isArray(material) ? material[0] as ColorMaterial | undefined : material as ColorMaterial | undefined;
}

function highlightColorByEntity(scene: GksScene): Map<string, THREE.Color> {
  const colors = new Map<string, THREE.Color>();
  addHighlightSet(colors, highlightColor, scene.debug?.highlights);
  for (const group of scene.debug?.highlightGroups ?? []) {
    const color = parseHighlightColor(group.color);
    addHighlightSet(colors, color, group);
    for (const entityId of group.entityIds ?? []) {
      colors.set(entityId, color);
    }
  }
  return colors;
}

function addHighlightSet(
  colors: Map<string, THREE.Color>,
  color: THREE.Color,
  highlights?: { faces?: string[]; edges?: string[]; vertices?: string[] }
): void {
  for (const entityId of [
    ...(highlights?.faces ?? []),
    ...(highlights?.edges ?? []),
    ...(highlights?.vertices ?? [])
  ]) {
    colors.set(entityId, color);
  }
}

function parseHighlightColor(value: string | undefined): THREE.Color {
  if (!value) {
    return highlightColor.clone();
  }
  try {
    return new THREE.Color(value);
  } catch {
    return highlightColor.clone();
  }
}

function entityIdForHitObject(object: THREE.Object3D | undefined): string | undefined {
  let current = object;
  while (current) {
    const entityId = current.userData.entityId as string | undefined;
    if (entityId) {
      return entityId;
    }
    current = current.parent ?? undefined;
  }
  return undefined;
}

function boundsForDiscreteGeometry(scene: GksScene): THREE.Box3 {
  const box = new THREE.Box3();
  for (const mesh of scene.geometry.faceMeshes) {
    if (mesh.display?.visible === false) {
      continue;
    }
    expandBoxByFlatPoints(box, mesh.positions);
  }
  for (const polyline of scene.geometry.edgePolylines) {
    if (polyline.display?.visible === false) {
      continue;
    }
    expandBoxByFlatPoints(box, polyline.points);
  }
  for (const point of scene.geometry.vertexPoints) {
    if (point.display?.visible === false) {
      continue;
    }
    box.expandByPoint(new THREE.Vector3(point.position[0], point.position[1], point.position[2]));
  }
  if (!box.isEmpty()) {
    return box;
  }
  if (scene.bbox) {
    box.min.set(scene.bbox.min[0], scene.bbox.min[1], scene.bbox.min[2]);
    box.max.set(scene.bbox.max[0], scene.bbox.max[1], scene.bbox.max[2]);
  }
  return box;
}

function radiusForBounds(bounds: THREE.Box3, fallback: number): number {
  if (bounds.isEmpty()) {
    return fallback;
  }
  const radius = bounds.getSize(new THREE.Vector3()).length() / 2;
  return Number.isFinite(radius) && radius > 0 ? radius : fallback;
}

function expandBoxByFlatPoints(box: THREE.Box3, values: number[]): void {
  for (let index = 0; index + 2 < values.length; index += 3) {
    box.expandByPoint(new THREE.Vector3(values[index], values[index + 1], values[index + 2]));
  }
}

function defaultViewDirectionForScene(scene: GksScene): THREE.Vector3 {
  if (scene.cameraHint) {
    const target = new THREE.Vector3(
      scene.cameraHint.target[0],
      scene.cameraHint.target[1],
      scene.cameraHint.target[2]
    );
    const position = new THREE.Vector3(
      scene.cameraHint.position[0],
      scene.cameraHint.position[1],
      scene.cameraHint.position[2]
    );
    const direction = position.sub(target);
    if (direction.lengthSq() > 0) {
      return direction.normalize();
    }
  }
  return new THREE.Vector3(1, -1, 0.75).normalize();
}

function defaultCameraUpForScene(scene: GksScene): THREE.Vector3 {
  if (scene.cameraHint?.up) {
    const up = new THREE.Vector3(scene.cameraHint.up[0], scene.cameraHint.up[1], scene.cameraHint.up[2]);
    if (up.lengthSq() > 0) {
      return up.normalize();
    }
  }
  return new THREE.Vector3(0, 0, 1);
}

function safeCameraUp(up: THREE.Vector3, viewDirection: THREE.Vector3): THREE.Vector3 {
  const direction = viewDirection.clone();
  if (direction.lengthSq() === 0) {
    direction.set(1, -1, 0.75);
  }
  direction.normalize();

  const projectedUp = up.lengthSq() > 0 ? up.clone().normalize() : new THREE.Vector3(0, 0, 1);
  projectedUp.addScaledVector(direction, -projectedUp.dot(direction));
  if (projectedUp.lengthSq() > 1e-8) {
    return projectedUp.normalize();
  }

  const candidates = [
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(1, 0, 0)
  ];
  candidates.sort((left, right) => Math.abs(left.dot(direction)) - Math.abs(right.dot(direction)));
  projectedUp.copy(candidates[0]);
  projectedUp.addScaledVector(direction, -projectedUp.dot(direction));
  return projectedUp.normalize();
}

function niceScaleLength(rawLength: number): number {
  if (!Number.isFinite(rawLength) || rawLength <= 0) {
    return 1;
  }
  const exponent = Math.floor(Math.log10(rawLength));
  const base = rawLength / 10 ** exponent;
  const niceBase = base <= 1 ? 1 : base <= 2 ? 2 : base <= 5 ? 5 : 10;
  return niceBase * 10 ** exponent;
}

function formatScaleValue(value: number): string {
  if (value >= 100) {
    return value.toFixed(0);
  }
  if (value >= 10) {
    return value.toFixed(1).replace(/\.0$/, "");
  }
  if (value >= 1) {
    return value.toFixed(2).replace(/\.?0+$/, "");
  }
  return value.toPrecision(2);
}
