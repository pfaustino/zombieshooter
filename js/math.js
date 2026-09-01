export class Vec3 {
  constructor(x = 0, y = 0, z = 0) {
    this.x = x; this.y = y; this.z = z;
  }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  clone() { return new Vec3(this.x, this.y, this.z); }
  add(v) { return new Vec3(this.x + v.x, this.y + v.y, this.z + v.z); }
  sub(v) { return new Vec3(this.x - v.x, this.y - v.y, this.z - v.z); }
  mul(s) { return new Vec3(this.x * s, this.y * s, this.z * s); }
  addScaled(v, s) { return new Vec3(this.x + v.x * s, this.y + v.y * s, this.z + v.z * s); }
  dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
  cross(v) { return new Vec3(this.y * v.z - this.z * v.y, this.z * v.x - this.x * v.z, this.x * v.y - this.y * v.x); }
  length() { return Math.hypot(this.x, this.y, this.z); }
  lengthSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
  distanceTo(v) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); }
  normalize() { const l = this.length(); return l > 0 ? this.mul(1 / l) : new Vec3(); }
  applyMat4(m) {
    const x = this.x, y = this.y, z = this.z;
    const w = 1 / (m[3] * x + m[7] * y + m[11] * z + m[15]);
    return new Vec3(
      (m[0] * x + m[4] * y + m[8] * z + m[12]) * w,
      (m[1] * x + m[5] * y + m[9] * z + m[13]) * w,
      (m[2] * x + m[6] * y + m[10] * z + m[14]) * w
    );
  }
  applyQuat(q) {
    const ix = q.w * this.x + q.y * this.z - q.z * this.y;
    const iy = q.w * this.y + q.z * this.x - q.x * this.z;
    const iz = q.w * this.z + q.x * this.y - q.y * this.x;
    const iw = -q.x * this.x - q.y * this.y - q.z * this.z;
    return new Vec3(
      ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
      iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
      iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x
    );
  }
  static sub(a, b) { return new Vec3(a.x - b.x, a.y - b.y, a.z - b.z); }
}

export class Mat4 {
  static identity() {
    const m = new Float32Array(16);
    m[0] = m[5] = m[10] = m[15] = 1;
    return m;
  }
  static perspective(fov, aspect, near, far) {
    const t = 1 / Math.tan(fov * 0.5);
    const nf = 1 / (near - far);
    const m = new Float32Array(16);
    m[0] = t / aspect;
    m[5] = t;
    m[10] = far * nf;
    m[11] = -1;
    m[14] = far * near * nf;
    return m;
  }
  static lookAt(eye, target, up) {
    const f = Vec3.sub(target, eye).normalize();
    const s = f.cross(up).normalize();
    const u = s.cross(f);
    const m = new Float32Array(16);
    m[0] = s.x; m[4] = s.y; m[8] = s.z;
    m[1] = u.x; m[5] = u.y; m[9] = u.z;
    m[2] = -f.x; m[6] = -f.y; m[10] = -f.z;
    m[12] = -s.dot(eye);
    m[13] = -u.dot(eye);
    m[14] = f.dot(eye);
    m[15] = 1;
    return m;
  }
  static multiply(a, b) {
    const r = new Float32Array(16);
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        let s = 0;
        for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k];
        r[i * 4 + j] = s;
      }
    }
    return r;
  }
  static translation(x, y, z) {
    const m = Mat4.identity();
    m[12] = x; m[13] = y; m[14] = z;
    return m;
  }
  static scaling(x, y, z) {
    const m = Mat4.identity();
    m[0] = x; m[5] = y; m[10] = z;
    return m;
  }
  static rotationY(angle) {
    const c = Math.cos(angle), s = Math.sin(angle);
    const m = Mat4.identity();
    m[0] = c; m[2] = s; m[8] = -s; m[10] = c;
    return m;
  }
  static rotationX(angle) {
    const c = Math.cos(angle), s = Math.sin(angle);
    const m = Mat4.identity();
    m[5] = c; m[6] = -s; m[9] = s; m[10] = c;
    return m;
  }
  static rotationZ(angle) {
    const c = Math.cos(angle), s = Math.sin(angle);
    const m = Mat4.identity();
    m[0] = c; m[1] = s; m[4] = -s; m[5] = c;
    return m;
  }
  static compose(pos, rotY, scale) {
    let m = Mat4.translation(pos.x, pos.y, pos.z);
    if (rotY) m = Mat4.multiply(Mat4.rotationY(rotY), m);
    if (scale !== 1) m = Mat4.multiply(Mat4.scaling(scale, scale, scale), m);
    return m;
  }
}

export class AABB {
  constructor(min, max) {
    this.min = min || new Vec3(Infinity, Infinity, Infinity);
    this.max = max || new Vec3(-Infinity, -Infinity, -Infinity);
  }
  setFromCenterSize(center, size) {
    const half = size.mul(0.5);
    this.min = center.sub(half);
    this.max = center.add(half);
    return this;
  }
  containsPoint(p) {
    return p.x >= this.min.x && p.x <= this.max.x &&
           p.y >= this.min.y && p.y <= this.max.y &&
           p.z >= this.min.z && p.z <= this.max.z;
  }
  expandedByRadius(r) {
    return new AABB(
      new Vec3(this.min.x - r, this.min.y - r, this.min.z - r),
      new Vec3(this.max.x + r, this.max.y + r, this.max.z + r)
    );
  }
  intersectsCircleXZ(x, z, r) {
    const cx = Math.max(this.min.x, Math.min(x, this.max.x));
    const cz = Math.max(this.min.z, Math.min(z, this.max.z));
    const dx = x - cx, dz = z - cz;
    return dx * dx + dz * dz < r * r;
  }
  intersectsAABB(other) {
    return this.min.x <= other.max.x && this.max.x >= other.min.x &&
           this.min.y <= other.max.y && this.max.y >= other.min.y &&
           this.min.z <= other.max.z && this.max.z >= other.min.z;
  }
  intersectsCircleXZ3D(x, y, z, r) {
    if (y + r < this.min.y || y - r > this.max.y) return false;
    const cx = Math.max(this.min.x, Math.min(x, this.max.x));
    const cz = Math.max(this.min.z, Math.min(z, this.max.z));
    const dx = x - cx, dz = z - cz;
    return dx * dx + dz * dz < r * r;
  }
}

export function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
export function lerp(a, b, t) { return a + (b - a) * t; }
export function degToRad(d) { return d * Math.PI / 180; }
