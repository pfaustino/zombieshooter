import { Vec3, Mat4 } from './math.js';

export class Camera {
  constructor(fov, aspect, near, far) {
    this.fov = fov;
    this.aspect = aspect;
    this.near = near;
    this.far = far;
    this.position = new Vec3(0, 1.7, 5);
    this.yaw = 0;
    this.pitch = 0;
    this.projection = Mat4.perspective(fov, aspect, near, far);
    this.view = Mat4.identity();
    this.updateView();
  }

  updateAspect(aspect) {
    this.aspect = aspect;
    this.projection = Mat4.perspective(this.fov, aspect, this.near, this.far);
  }

  updateView() {
    const cp = Math.cos(this.pitch);
    const fwd = new Vec3(
      cp * Math.sin(this.yaw),
      Math.sin(this.pitch),
      cp * Math.cos(this.yaw)
    );
    let up = new Vec3(0, 1, 0);
    if (Math.abs(fwd.dot(up)) > 0.999) {
      up = new Vec3(0, 0, 1);
    }
    const target = new Vec3(
      this.position.x + fwd.x,
      this.position.y + fwd.y,
      this.position.z + fwd.z
    );
    this.view = Mat4.lookAt(this.position, target, up);
  }

  setLookAt(eye, target, up = new Vec3(0, 1, 0)) {
    this.position.copy(eye);
    this.view = Mat4.lookAt(eye, target, up);
    const dx = target.x - eye.x;
    const dy = target.y - eye.y;
    const dz = target.z - eye.z;
    const horiz = Math.sqrt(dx * dx + dz * dz);
    this.yaw = Math.atan2(dx, dz);
    this.pitch = Math.atan2(dy, Math.max(horiz, 1e-6));
  }

  getForward() {
    return new Vec3(
      Math.cos(this.pitch) * Math.sin(this.yaw),
      Math.sin(this.pitch),
      Math.cos(this.pitch) * Math.cos(this.yaw)
    );
  }

  getRight() {
    return new Vec3(Math.sin(this.yaw - Math.PI / 2), 0, Math.cos(this.yaw - Math.PI / 2));
  }

  getForwardHorizontal() {
    return new Vec3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }
}
