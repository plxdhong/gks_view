import * as THREE from "three";

export function updateCameraClipping(
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera,
  center: THREE.Vector3,
  radius: number
): void {
  if (camera instanceof THREE.OrthographicCamera) {
    const direction = camera.getWorldDirection(new THREE.Vector3());
    let depth = center.clone().sub(camera.position).dot(direction);
    const padding = Math.max(radius * 2, 1e-9);

    // Moving along the view direction preserves orthographic framing. Keep the
    // geometry in front of the camera so clipping and picking agree.
    if (depth < padding) {
      camera.position.addScaledVector(direction, depth - padding);
      camera.updateMatrixWorld();
      depth = padding;
    }

    camera.near = Math.max(depth - padding, 0);
    camera.far = depth + padding;
  } else {
    const distance = camera.position.distanceTo(center);
    const padding = Math.max(radius * 8, distance * 2, 1e-9);
    const minimumNear = Math.max(radius * 1e-4, 1e-12);
    camera.near = Math.max(distance - padding, minimumNear);
    camera.far = Math.max(distance + padding, camera.near * 10);
  }
  camera.updateProjectionMatrix();
}
