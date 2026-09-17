import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { updateCameraClipping } from "../src/viewer/CameraClipping";

function corners(center: THREE.Vector3, halfSize: number): THREE.Vector3[] {
  return [-1, 1].flatMap((x) => [-1, 1].flatMap((y) => [-1, 1].map((z) => (
    new THREE.Vector3(x, y, z).multiplyScalar(halfSize).add(center)
  ))));
}

function assertDepthVisible(camera: THREE.Camera, points: THREE.Vector3[]): void {
  camera.updateMatrixWorld();
  for (const point of points) {
    const projected = point.clone().project(camera);
    assert.ok(projected.z > -1 && projected.z < 1, `Clipped depth: ${projected.z}`);
  }
}

test("nearby orthographic views retain all model depths at different scales and angles", () => {
  for (const scale of [1e-8, 1e-5, 1, 1e6]) {
    const center = new THREE.Vector3(12, -4, 3).multiplyScalar(scale);
    const points = corners(center, scale);
    for (const offset of [
      new THREE.Vector3(0, 0, 0.25),
      new THREE.Vector3(0.1, -0.2, 0.3),
      new THREE.Vector3(-0.4, 0.2, -0.1)
    ]) {
      const camera = new THREE.OrthographicCamera(-2 * scale, 2 * scale, 2 * scale, -2 * scale);
      camera.position.copy(center).addScaledVector(offset, scale);
      camera.lookAt(center);
      camera.zoom = 100;
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      const projectedBefore = points.map((point) => point.clone().project(camera));
      const orientation = camera.quaternion.clone();
      const up = camera.up.clone();

      updateCameraClipping(camera, center, Math.sqrt(3) * scale);

      assertDepthVisible(camera, points);
      assert.ok(camera.near >= 0 && camera.far > camera.near);
      assert.equal(camera.zoom, 100);
      assert.ok(camera.quaternion.equals(orientation));
      assert.ok(camera.up.equals(up));
      points.forEach((point, index) => {
        const after = point.clone().project(camera);
        assert.ok(Math.abs(after.x - projectedBefore[index].x) < 1e-9);
        assert.ok(Math.abs(after.y - projectedBefore[index].y) < 1e-9);
      });
    }
  }
});

test("panned views use signed view depth even when the model is behind the camera", () => {
  const center = new THREE.Vector3(0, 0, 5);
  const camera = new THREE.OrthographicCamera(-200, 200, 200, -200);
  camera.position.set(100, 0, 0);
  camera.lookAt(100, 0, -1);

  updateCameraClipping(camera, center, Math.sqrt(3));

  assertDepthVisible(camera, corners(center, 1));
  assert.equal(camera.position.x, 100);
  assert.equal(camera.position.y, 0);
  assert.ok(camera.position.z > center.z + 1);
});

test("orthographic picking hits the front surface after correcting camera depth", () => {
  const camera = new THREE.OrthographicCamera(-2, 2, 2, -2);
  camera.position.set(0, 0, 0.25);
  camera.lookAt(0, 0, 0);
  updateCameraClipping(camera, new THREE.Vector3(), Math.sqrt(3));

  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(2, 2, 2),
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
  );
  mesh.updateMatrixWorld();
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(), camera);
  const [hit] = raycaster.intersectObject(mesh);
  assert.ok(hit);
  assert.equal(hit.point.z, 1);
  mesh.geometry.dispose();
  mesh.material.dispose();
});

test("snapshot growth and off-center rotation keep geometry within the depth range", () => {
  const camera = new THREE.OrthographicCamera(-5, 5, 5, -5);
  const center = new THREE.Vector3();
  const target = new THREE.Vector3(1, 0.5, 0.5);
  const targetBefore = target.clone();
  camera.position.set(0, 0, 4);
  camera.lookAt(target);
  updateCameraClipping(camera, center, Math.sqrt(3));

  for (const halfSize of [10, 1, 100]) {
    for (let angle = 0; angle < 2 * Math.PI; angle += Math.PI / 8) {
      const offset = camera.position.clone().sub(target);
      offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 8);
      camera.position.copy(target).add(offset);
      camera.lookAt(target);
      updateCameraClipping(camera, center, Math.sqrt(3) * halfSize);
      assertDepthVisible(camera, corners(center, halfSize));
    }
  }
  assert.ok(target.equals(targetBefore));
});

test("a safe orthographic camera remains stationary and repeated updates are stable", () => {
  const camera = new THREE.OrthographicCamera(-2, 2, 2, -2);
  camera.position.set(0, 0, 100);
  camera.lookAt(0, 0, 0);
  const position = camera.position.clone();

  for (let index = 0; index < 10; index += 1) {
    updateCameraClipping(camera, new THREE.Vector3(), Math.sqrt(3));
  }

  assert.ok(camera.position.equals(position));
  assertDepthVisible(camera, corners(new THREE.Vector3(), 1));
});

test("perspective views retain their positive near plane without moving the camera", () => {
  for (const scale of [1e-8, 1, 1e6]) {
    const camera = new THREE.PerspectiveCamera(45, 1);
    const center = new THREE.Vector3();
    const radius = Math.sqrt(3) * scale;
    camera.position.set(0, 0, 0.25 * scale);
    camera.lookAt(center);
    const position = camera.position.clone();
    const padding = Math.max(radius * 8, position.length() * 2, 1e-9);

    updateCameraClipping(camera, center, radius);

    assert.ok(camera.position.equals(position));
    assert.equal(camera.near, Math.max(radius * 1e-4, 1e-12));
    assert.equal(camera.far, Math.max(position.length() + padding, camera.near * 10));
  }
});
