import { Mat4 } from './math.js';

const MAX_JOINTS = 32;

function quatSlerp(a, b, t) {
  let ax = a[0], ay = a[1], az = a[2], aw = a[3];
  let bx = b[0], by = b[1], bz = b[2], bw = b[3];
  let dot = ax * bx + ay * by + az * bz + aw * bw;
  if (dot < 0) {
    bx = -bx; by = -by; bz = -bz; bw = -bw;
    dot = -dot;
  }
  if (dot > 0.9995) {
    const x = ax + t * (bx - ax);
    const y = ay + t * (by - ay);
    const z = az + t * (bz - az);
    const w = aw + t * (bw - aw);
    const len = Math.hypot(x, y, z, w) || 1;
    return [x / len, y / len, z / len, w / len];
  }
  const theta0 = Math.acos(Math.min(1, dot));
  const theta = theta0 * t;
  const s0 = Math.sin(theta0 - theta) / Math.sin(theta0);
  const s1 = Math.sin(theta) / Math.sin(theta0);
  return [s0 * ax + s1 * bx, s0 * ay + s1 * by, s0 * az + s1 * bz, s0 * aw + s1 * bw];
}

function quatToMat4(q) {
  const x = q[0], y = q[1], z = q[2], w = q[3];
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  const m = Mat4.identity();
  m[0] = 1 - (yy + zz); m[1] = xy + wz; m[2] = xz - wy;
  m[4] = xy - wz; m[5] = 1 - (xx + zz); m[6] = yz + wx;
  m[8] = xz + wy; m[9] = yz - wx; m[10] = 1 - (xx + yy);
  return m;
}

function nodeLocalMatrix(node) {
  if (node.matrix) return new Float32Array(node.matrix);
  return Mat4.multiply(
    Mat4.translation(node.translation[0], node.translation[1], node.translation[2]),
    Mat4.multiply(quatToMat4(node.rotation), Mat4.scaling(node.scale[0], node.scale[1], node.scale[2]))
  );
}

function sampleChannel(channel, time) {
  const { times, values, path } = channel;
  const stride = path === 'rotation' ? 4 : path === 'translation' || path === 'scale' ? 3 : 0;
  if (!stride || times.length === 0) return null;
  if (time <= times[0]) return Array.from(values.subarray(0, stride));
  const last = times.length - 1;
  if (time >= times[last]) return Array.from(values.subarray(last * stride, last * stride + stride));

  let i = 0;
  while (i < last && times[i + 1] < time) i++;
  const t0 = times[i], t1 = times[i + 1];
  const u = (time - t0) / Math.max(t1 - t0, 1e-8);
  const a = values.subarray(i * stride, i * stride + stride);
  const b = values.subarray((i + 1) * stride, (i + 1) * stride + stride);
  if (path === 'rotation') return quatSlerp(a, b, u);
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
}

/**
 * Samples glTF skeletal clips and builds joint matrices for GPU skinning.
 */
export class AnimPlayer {
  constructor(skinned) {
    this.skinned = skinned;
    this.clipName = null;
    this.time = 0;
    this.speed = 1;
    this.loop = true;
    this.finished = false;
    this.jointMatrices = new Float32Array(MAX_JOINTS * 16);
    for (let i = 0; i < MAX_JOINTS; i++) {
      this.jointMatrices[i * 16] = 1;
      this.jointMatrices[i * 16 + 5] = 1;
      this.jointMatrices[i * 16 + 10] = 1;
      this.jointMatrices[i * 16 + 15] = 1;
    }
    this._locals = skinned.nodes.map((n) => ({
      translation: [...n.translation],
      rotation: [...n.rotation],
      scale: [...n.scale],
      matrix: n.matrix ? new Float32Array(n.matrix) : null,
      children: n.children,
    }));
    this._globals = skinned.nodes.map(() => Mat4.identity());
    this.play('idle');
  }

  play(name, { loop = true, reset = true } = {}) {
    if (!this.skinned.animations[name]) return false;
    if (this.clipName === name && !reset) return true;
    this.clipName = name;
    this.loop = loop;
    this.finished = false;
    if (reset) this.time = 0;
    return true;
  }

  update(delta) {
    const clip = this.skinned.animations[this.clipName];
    if (!clip) {
      this._computeJoints();
      return;
    }
    this.time += delta * this.speed;
    if (clip.duration > 0) {
      if (this.loop) {
        this.time %= clip.duration;
      } else if (this.time >= clip.duration) {
        this.time = clip.duration;
        this.finished = true;
      }
    }
    this._applyClip(clip);
    this._computeJoints();
  }

  _resetLocals() {
    const src = this.skinned.nodes;
    for (let i = 0; i < src.length; i++) {
      const d = this._locals[i];
      d.translation[0] = src[i].translation[0];
      d.translation[1] = src[i].translation[1];
      d.translation[2] = src[i].translation[2];
      d.rotation[0] = src[i].rotation[0];
      d.rotation[1] = src[i].rotation[1];
      d.rotation[2] = src[i].rotation[2];
      d.rotation[3] = src[i].rotation[3];
      d.scale[0] = src[i].scale[0];
      d.scale[1] = src[i].scale[1];
      d.scale[2] = src[i].scale[2];
    }
  }

  _applyClip(clip) {
    this._resetLocals();
    for (const ch of clip.channels) {
      const sample = sampleChannel(ch, this.time);
      if (!sample) continue;
      const node = this._locals[ch.node];
      if (!node) continue;
      if (ch.path === 'translation') {
        node.translation[0] = sample[0];
        node.translation[1] = sample[1];
        node.translation[2] = sample[2];
      } else if (ch.path === 'rotation') {
        node.rotation[0] = sample[0];
        node.rotation[1] = sample[1];
        node.rotation[2] = sample[2];
        node.rotation[3] = sample[3];
      } else if (ch.path === 'scale') {
        node.scale[0] = sample[0];
        node.scale[1] = sample[1];
        node.scale[2] = sample[2];
      }
    }
  }

  _computeGlobals(nodeIndex, parent) {
    const local = nodeLocalMatrix(this._locals[nodeIndex]);
    const world = Mat4.multiply(parent, local);
    this._globals[nodeIndex] = world;
    const children = this._locals[nodeIndex].children;
    for (const child of children) this._computeGlobals(child, world);
  }

  _computeJoints() {
    const roots = [];
    const childSet = new Set();
    for (const n of this._locals) for (const c of n.children) childSet.add(c);
    for (let i = 0; i < this._locals.length; i++) if (!childSet.has(i)) roots.push(i);
    const identity = Mat4.identity();
    for (const r of roots) this._computeGlobals(r, identity);

    const { jointNodeIndices, inverseBindMatrices } = this.skinned;
    const count = Math.min(jointNodeIndices.length, MAX_JOINTS);
    for (let j = 0; j < count; j++) {
      const nodeIndex = jointNodeIndices[j];
      const ibm = inverseBindMatrices.subarray(j * 16, j * 16 + 16);
      const jointMat = Mat4.multiply(this._globals[nodeIndex], ibm);
      this.jointMatrices.set(jointMat, j * 16);
    }
  }
}

export { MAX_JOINTS };
