import { Vec3, Mat4, AABB } from './math.js';

const WGSL_MESH = `
struct Uniforms {
  viewProj : mat4x4f,
  camPos : vec3f,
  time : f32,
  ambientColor : vec3f,
  ambientIntensity : f32,
  dirLightDir : vec3f,
  dirLightIntensity : f32,
  dirLightColor : vec3f,
  fogNear : f32,
  fogColor : vec3f,
  fogFar : f32,
  pointLightPos : vec3f,
  pointLightIntensity : f32,
  pointLightColor : vec3f,
  pointLightRange : f32,
};
@group(0) @binding(0) var<uniform> u : Uniforms;

struct ModelUniforms {
  model : mat4x4f,
  color : vec3f,
  emissive : vec3f,
  opacity : f32,
  flags : f32,
};
@group(1) @binding(0) var<uniform> mu : ModelUniforms;

struct VSIn {
  @location(0) pos : vec3f,
  @location(1) normal : vec3f,
  @location(2) color : vec3f,
};
struct VSOut {
  @builtin(position) clipPos : vec4f,
  @location(0) worldPos : vec3f,
  @location(1) worldNormal : vec3f,
  @location(2) color : vec3f,
};

@vertex
fn vs(input : VSIn) -> VSOut {
  var out : VSOut;
  let worldPos = mu.model * vec4f(input.pos, 1.0);
  out.clipPos = u.viewProj * worldPos;
  out.worldPos = worldPos.xyz;
  let normalMat = mat3x3f(
    mu.model[0].xyz, mu.model[1].xyz, mu.model[2].xyz
  );
  out.worldNormal = normalize(normalMat * input.normal);
  out.color = input.color;
  return out;
}

@fragment
fn fs(input : VSOut) -> @location(0) vec4f {
  let N = normalize(input.worldNormal);
  let L = normalize(-u.dirLightDir);
  let diffuse = max(dot(N, L), 0.0) * u.dirLightColor * u.dirLightIntensity;
  let ambient = u.ambientColor * u.ambientIntensity;
  
  var pointLight = vec3f(0.0);
  let toLight = u.pointLightPos - input.worldPos;
  let dist = length(toLight);
  if (dist < u.pointLightRange) {
    let PL = normalize(toLight);
    let atten = 1.0 - (dist / u.pointLightRange);
    pointLight = max(dot(N, PL), 0.0) * u.pointLightColor * u.pointLightIntensity * atten * atten;
  }
  
  let V = normalize(u.camPos - input.worldPos);
  let H = normalize(L + V);
  let specular = pow(max(dot(N, H), 0.0), 32.0) * u.dirLightColor * u.dirLightIntensity * 0.3;
  
  var color = (mu.color * input.color) * (ambient + diffuse + pointLight) + mu.emissive + specular;
  
  let distToCam = length(u.camPos - input.worldPos);
  let fogFactor = clamp((distToCam - u.fogNear) / (u.fogFar - u.fogNear), 0.0, 1.0);
  color = mix(color, u.fogColor, fogFactor);
  
  return vec4f(color, mu.opacity);
}
`;

const WGSL_SKINNED = `
struct Uniforms {
  viewProj : mat4x4f,
  camPos : vec3f,
  time : f32,
  ambientColor : vec3f,
  ambientIntensity : f32,
  dirLightDir : vec3f,
  dirLightIntensity : f32,
  dirLightColor : vec3f,
  fogNear : f32,
  fogColor : vec3f,
  fogFar : f32,
  pointLightPos : vec3f,
  pointLightIntensity : f32,
  pointLightColor : vec3f,
  pointLightRange : f32,
};
@group(0) @binding(0) var<uniform> u : Uniforms;

struct ModelUniforms {
  model : mat4x4f,
  color : vec3f,
  emissive : vec3f,
  opacity : f32,
  flags : f32,
};
@group(1) @binding(0) var<uniform> mu : ModelUniforms;

struct JointUniforms {
  joints : array<mat4x4f, 64>,
};
@group(1) @binding(1) var<uniform> ju : JointUniforms;

struct VSIn {
  @location(0) pos : vec3f,
  @location(1) normal : vec3f,
  @location(2) color : vec3f,
  @location(3) jointIds : vec4u,
  @location(4) weights : vec4f,
};
struct VSOut {
  @builtin(position) clipPos : vec4f,
  @location(0) worldPos : vec3f,
  @location(1) worldNormal : vec3f,
  @location(2) color : vec3f,
};

@vertex
fn vs(input : VSIn) -> VSOut {
  var out : VSOut;
  let skin =
    ju.joints[input.jointIds.x] * input.weights.x +
    ju.joints[input.jointIds.y] * input.weights.y +
    ju.joints[input.jointIds.z] * input.weights.z +
    ju.joints[input.jointIds.w] * input.weights.w;
  let localPos = skin * vec4f(input.pos, 1.0);
  let worldPos = mu.model * localPos;
  out.clipPos = u.viewProj * worldPos;
  out.worldPos = worldPos.xyz;
  let skinN = mat3x3f(skin[0].xyz, skin[1].xyz, skin[2].xyz);
  let modelN = mat3x3f(mu.model[0].xyz, mu.model[1].xyz, mu.model[2].xyz);
  out.worldNormal = normalize(modelN * skinN * input.normal);
  out.color = input.color;
  return out;
}

@fragment
fn fs(input : VSOut) -> @location(0) vec4f {
  let N = normalize(input.worldNormal);
  let L = normalize(-u.dirLightDir);
  let diffuse = max(dot(N, L), 0.0) * u.dirLightColor * u.dirLightIntensity;
  let ambient = u.ambientColor * u.ambientIntensity;
  
  var pointLight = vec3f(0.0);
  let toLight = u.pointLightPos - input.worldPos;
  let dist = length(toLight);
  if (dist < u.pointLightRange) {
    let PL = normalize(toLight);
    let atten = 1.0 - (dist / u.pointLightRange);
    pointLight = max(dot(N, PL), 0.0) * u.pointLightColor * u.pointLightIntensity * atten * atten;
  }
  
  let V = normalize(u.camPos - input.worldPos);
  let H = normalize(L + V);
  let specular = pow(max(dot(N, H), 0.0), 32.0) * u.dirLightColor * u.dirLightIntensity * 0.3;
  
  var color = (mu.color * input.color) * (ambient + diffuse + pointLight) + mu.emissive + specular;
  
  let distToCam = length(u.camPos - input.worldPos);
  let fogFactor = clamp((distToCam - u.fogNear) / (u.fogFar - u.fogNear), 0.0, 1.0);
  color = mix(color, u.fogColor, fogFactor);
  
  return vec4f(color, mu.opacity);
}
`;

const WGSL_BILLBOARD = `
struct Uniforms {
  viewProj : mat4x4f,
  camPos : vec3f,
  time : f32,
  ambientColor : vec3f,
  ambientIntensity : f32,
  dirLightDir : vec3f,
  dirLightIntensity : f32,
  dirLightColor : vec3f,
  fogNear : f32,
  fogColor : vec3f,
  fogFar : f32,
  pointLightPos : vec3f,
  pointLightIntensity : f32,
  pointLightColor : vec3f,
  pointLightRange : f32,
};
@group(0) @binding(0) var<uniform> u : Uniforms;

struct BillboardUniforms {
  center : vec3f,
  size : vec2f,
  color : vec3f,
  offset : f32,
};
@group(1) @binding(0) var<uniform> bu : BillboardUniforms;

struct VSOut {
  @builtin(position) clipPos : vec4f,
  @location(0) uv : vec2f,
};

@vertex
fn vs(@location(0) corner : vec2f) -> VSOut {
  var out : VSOut;
  let right = vec3f(u.viewProj[0][0], u.viewProj[1][0], u.viewProj[2][0]);
  let up = vec3f(u.viewProj[0][1], u.viewProj[1][1], u.viewProj[2][1]);
  let worldPos = bu.center + right * corner.x * bu.size.x + up * (corner.y * bu.size.y + bu.offset);
  out.clipPos = u.viewProj * vec4f(worldPos, 1.0);
  out.uv = corner * 0.5 + 0.5;
  return out;
}

@fragment
fn fs(input : VSOut) -> @location(0) vec4f {
  return vec4f(bu.color, 1.0);
}
`;

const WGSL_GRID = `
struct Uniforms {
  viewProj : mat4x4f,
  camPos : vec3f,
  time : f32,
  ambientColor : vec3f,
  ambientIntensity : f32,
  dirLightDir : vec3f,
  dirLightIntensity : f32,
  dirLightColor : vec3f,
  fogNear : f32,
  fogColor : vec3f,
  fogFar : f32,
  pointLightPos : vec3f,
  pointLightIntensity : f32,
  pointLightColor : vec3f,
  pointLightRange : f32,
};
@group(0) @binding(0) var<uniform> u : Uniforms;

struct VSOut {
  @builtin(position) clipPos : vec4f,
  @location(0) worldPos : vec3f,
};

@vertex
fn vs(@location(0) pos : vec3f) -> VSOut {
  var out : VSOut;
  out.clipPos = u.viewProj * vec4f(pos, 1.0);
  out.worldPos = pos;
  return out;
}

@fragment
fn fs(input : VSOut) -> @location(0) vec4f {
  let gridSize = 5.0;
  let gx = abs(fract(input.worldPos.x / gridSize) - 0.5);
  let gz = abs(fract(input.worldPos.z / gridSize) - 0.5);
  let lineW = 0.03;
  let gridLine = smoothstep(0.5 - lineW, 0.5, max(gx, gz));
  let baseColor = vec3f(0.13, 0.13, 0.2);
  let lineColor = vec3f(0.2, 0.2, 0.33);
  var color = mix(baseColor, lineColor, gridLine);
  
  let distToCam = length(u.camPos - input.worldPos);
  let fogFactor = clamp((distToCam - u.fogNear) / (u.fogFar - u.fogNear), 0.0, 1.0);
  color = mix(color, u.fogColor, fogFactor);
  return vec4f(color, 1.0);
}
`;

function createBoxGeometry(w, h, d) {
  const hw = w/2, hh = h/2, hd = d/2;
  const positions = [
    -hw,-hh,-hd, hw,-hh,-hd, hw,hh,-hd, -hw,hh,-hd,
    -hw,-hh, hd, hw,-hh, hd, hw,hh, hd, -hw,hh, hd,
    -hw,-hh,-hd, -hw,-hh, hd, -hw,hh, hd, -hw,hh,-hd,
    hw,-hh,-hd, hw,-hh, hd, hw,hh, hd, hw,hh,-hd,
    -hw,-hh,-hd, -hw,hh,-hd, -hw,hh, hd, -hw,-hh, hd,
    hw,-hh,-hd, hw,hh,-hd, hw,hh, hd, hw,-hh, hd,
  ];
  const normals = [
    0,0,-1, 0,0,-1, 0,0,-1, 0,0,-1,
    0,0,1, 0,0,1, 0,0,1, 0,0,1,
    -1,0,0, -1,0,0, -1,0,0, -1,0,0,
    1,0,0, 1,0,0, 1,0,0, 1,0,0,
    0,-1,0, 0,-1,0, 0,-1,0, 0,-1,0,
    0,1,0, 0,1,0, 0,1,0, 0,1,0,
  ];
  const indices = [
    0,1,2, 0,2,3, 4,6,5, 4,7,6,
    8,9,10, 8,10,11, 12,14,13, 12,15,14,
    16,17,18, 16,18,19, 20,22,21, 20,23,22,
  ];
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint16Array(indices) };
}

function createSphereGeometry(radius, widthSeg=16, heightSeg=12) {
  const positions = [], normals = [], indices = [];
  for (let y = 0; y <= heightSeg; y++) {
    const v = y / heightSeg;
    const phi = v * Math.PI;
    for (let x = 0; x <= widthSeg; x++) {
      const u = x / widthSeg;
      const theta = u * Math.PI * 2;
      const sx = -radius * Math.cos(theta) * Math.sin(phi);
      const sy = radius * Math.cos(phi);
      const sz = radius * Math.sin(theta) * Math.sin(phi);
      positions.push(sx, sy, sz);
      const nx = sx / radius, ny = sy / radius, nz = sz / radius;
      normals.push(nx, ny, nz);
    }
  }
  for (let y = 0; y < heightSeg; y++) {
    for (let x = 0; x < widthSeg; x++) {
      const a = y * (widthSeg + 1) + x;
      const b = a + widthSeg + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint16Array(indices) };
}

function createCylinderGeometry(radiusTop, radiusBottom, height, radialSeg=12) {
  const positions = [], normals = [], indices = [];
  const halfH = height / 2;
  for (let x = 0; x <= radialSeg; x++) {
    const u = x / radialSeg;
    const theta = u * Math.PI * 2;
    const cosT = Math.cos(theta), sinT = Math.sin(theta);
    positions.push(radiusTop * cosT, halfH, radiusTop * sinT);
    positions.push(radiusBottom * cosT, -halfH, radiusBottom * sinT);
    const nx = cosT, nz = sinT;
    normals.push(nx, 0, nz, nx, 0, nz);
  }
  for (let x = 0; x < radialSeg; x++) {
    const a = x * 2, b = a + 1, c = a + 2, d = a + 3;
    indices.push(a, c, b, b, c, d);
  }
  const topCenter = positions.length / 3;
  positions.push(0, halfH, 0); normals.push(0, 1, 0);
  const bottomCenter = positions.length / 3;
  positions.push(0, -halfH, 0); normals.push(0, -1, 0);
  for (let x = 0; x < radialSeg; x++) {
    const a = x * 2, b = a + 2;
    indices.push(topCenter, b, a);
    indices.push(bottomCenter, a + 1, b + 1);
  }
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint16Array(indices) };
}

function createConeGeometry(radius, height, radialSeg=12) {
  return createCylinderGeometry(0, radius, height, radialSeg);
}

function createPlaneGeometry(w, d) {
  const hw = w/2, hd = d/2;
  const positions = [-hw,0,-hd, hw,0,-hd, hw,0,hd, -hw,0,hd];
  const normals = [0,1,0, 0,1,0, 0,1,0, 0,1,0];
  const indices = [0,1,2, 0,2,3];
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint16Array(indices) };
}

const QUAD_CORNERS = new Float32Array([-1,-1, 1,-1, 1,1, -1,1]);
const QUAD_INDICES = new Uint16Array([0,1,2, 0,2,3]);

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.objects = [];
    this.skinnedObjects = [];
    this.billboards = [];
    this.pointLights = [];
    this.skinnedGeometries = {};
  }

  async init() {
    const adapter = await navigator.gpu.requestAdapter();
    this.device = await adapter.requestDevice();
    this.context = this.canvas.getContext('webgpu');
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({ device: this.device, format: this.format, alphaMode: 'opaque' });

    this.depthFormat = 'depth24plus';
    this.sampleCount = 4;

    this.uniformBuffer = this.device.createBuffer({
      size: 256,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.meshPipeline = this._createMeshPipeline();
    this.skinnedPipeline = this._createSkinnedPipeline();
    this.billboardPipeline = this._createBillboardPipeline();
    this.gridPipeline = this._createGridPipeline();

    this._initGeometry();
    this._initGrid();
    this._initBillboardQuad();

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  _createMeshPipeline() {
    const shader = this.device.createShaderModule({ code: WGSL_MESH });
    return this.device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: shader,
        entryPoint: 'vs',
        buffers: [
          { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] },
          { arrayStride: 12, attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x3' }] },
          { arrayStride: 12, attributes: [{ shaderLocation: 2, offset: 0, format: 'float32x3' }] },
        ],
      },
      fragment: { module: shader, entryPoint: 'fs', targets: [{ format: this.format, blend: {
        color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }
      }}] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: this.depthFormat, depthWriteEnabled: true, depthCompare: 'less' },
      multisample: { count: this.sampleCount },
    });
  }

  _createSkinnedPipeline() {
    const shader = this.device.createShaderModule({ code: WGSL_SKINNED });
    return this.device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: shader,
        entryPoint: 'vs',
        buffers: [
          { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] },
          { arrayStride: 12, attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x3' }] },
          { arrayStride: 12, attributes: [{ shaderLocation: 2, offset: 0, format: 'float32x3' }] },
          { arrayStride: 8, attributes: [{ shaderLocation: 3, offset: 0, format: 'uint16x4' }] },
          { arrayStride: 16, attributes: [{ shaderLocation: 4, offset: 0, format: 'float32x4' }] },
        ],
      },
      fragment: { module: shader, entryPoint: 'fs', targets: [{ format: this.format, blend: {
        color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }
      }}] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: this.depthFormat, depthWriteEnabled: true, depthCompare: 'less' },
      multisample: { count: this.sampleCount },
    });
  }

  _createBillboardPipeline() {
    const shader = this.device.createShaderModule({ code: WGSL_BILLBOARD });
    return this.device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: shader,
        entryPoint: 'vs',
        buffers: [{ arrayStride: 8, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }]}],
      },
      fragment: { module: shader, entryPoint: 'fs', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list' },
      depthStencil: { format: this.depthFormat, depthWriteEnabled: false, depthCompare: 'less' },
      multisample: { count: this.sampleCount },
    });
  }

  _createGridPipeline() {
    const shader = this.device.createShaderModule({ code: WGSL_GRID });
    return this.device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: shader,
        entryPoint: 'vs',
        buffers: [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }]}],
      },
      fragment: { module: shader, entryPoint: 'fs', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list' },
      depthStencil: { format: this.depthFormat, depthWriteEnabled: true, depthCompare: 'less' },
      multisample: { count: this.sampleCount },
    });
  }

  _initGeometry() {
    this.geometries = {};
    const defs = {
      box: () => createBoxGeometry(1, 1, 1),
      sphere: () => createSphereGeometry(0.5),
      cylinder: () => createCylinderGeometry(0.5, 0.5, 1),
      cone: () => createConeGeometry(0.5, 1),
      plane: () => createPlaneGeometry(1, 1),
    };
    for (const [name, gen] of Object.entries(defs)) {
      const geo = gen();
      this.geometries[name] = this._uploadGeometry(geo);
    }
  }

  _uploadGeometry(geo) {
    const posBuf = this.device.createBuffer({
      size: geo.positions.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(posBuf, 0, geo.positions);
    const normBuf = this.device.createBuffer({
      size: geo.normals.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(normBuf, 0, geo.normals);
    const colorData = geo.colors || this._makeDefaultColors(geo.positions.length / 3);
    const colorBuf = this.device.createBuffer({
      size: colorData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(colorBuf, 0, colorData);
    const idxBuf = this.device.createBuffer({
      size: geo.indices.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(idxBuf, 0, geo.indices);
    return { posBuf, normBuf, colorBuf, idxBuf, indexCount: geo.indices.length, indexFormat: geo.indices instanceof Uint32Array ? 'uint32' : 'uint16' };
  }

  registerGeometry(name, geo) {
    if (!this.geometries[name]) this.geometries[name] = this._uploadGeometry(geo);
    return this.geometries[name];
  }

  registerSkinnedGeometry(name, geo) {
    if (this.skinnedGeometries[name]) return this.skinnedGeometries[name];
    const base = this._uploadGeometry(geo);
    const jointBuf = this.device.createBuffer({
      size: geo.joints.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(jointBuf, 0, geo.joints);
    const weightBuf = this.device.createBuffer({
      size: geo.weights.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(weightBuf, 0, geo.weights);
    this.skinnedGeometries[name] = { ...base, jointBuf, weightBuf, skinned: true };
    return this.skinnedGeometries[name];
  }

  _makeDefaultColors(vertexCount) {
    const colors = new Float32Array(vertexCount * 3);
    for (let i = 0; i < colors.length; i += 3) {
      colors[i] = 1;
      colors[i + 1] = 1;
      colors[i + 2] = 1;
    }
    return colors;
  }

  _initGrid() {
    const size = 400;
    const positions = new Float32Array([-size,0.01,-size, size,0.01,-size, size,0.01,size, -size,0.01,size]);
    const indices = new Uint16Array([0,1,2, 0,2,3]);
    this.gridPosBuf = this.device.createBuffer({ size: positions.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(this.gridPosBuf, 0, positions);
    this.gridIdxBuf = this.device.createBuffer({ size: indices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(this.gridIdxBuf, 0, indices);
    this.gridIndexCount = indices.length;
  }

  _initBillboardQuad() {
    this.bbQuadBuf = this.device.createBuffer({ size: QUAD_CORNERS.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(this.bbQuadBuf, 0, QUAD_CORNERS);
    this.bbIdxBuf = this.device.createBuffer({ size: QUAD_INDICES.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(this.bbIdxBuf, 0, QUAD_INDICES);
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio, 2);
    const w = Math.floor(window.innerWidth * dpr);
    const h = Math.floor(window.innerHeight * dpr);
    this.canvas.width = w;
    this.canvas.height = h;
    this.aspect = w / h;

    if (this.msaaTex) this.msaaTex.destroy();
    this.msaaTex = this.device.createTexture({
      size: [w, h],
      format: this.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
      sampleCount: this.sampleCount,
    });
    if (this.depthTex) this.depthTex.destroy();
    this.depthTex = this.device.createTexture({
      size: [w, h],
      format: this.depthFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
      sampleCount: this.sampleCount,
    });
  }

  addObject(geoName, position, scale = new Vec3(1,1,1), rotationY = 0, color = [1,1,1], emissive = [0,0,0], opacity = 1) {
    const obj = {
      geoName, position: position.clone ? position.clone() : new Vec3(position.x, position.y, position.z),
      scale: scale.clone ? scale.clone() : new Vec3(scale.x || 1, scale.y || 1, scale.z || 1),
      rotationX: 0, rotationY, rotationZ: 0, color, emissive, opacity,
      visible: true, skinned: false,
      modelBuf: this.device.createBuffer({ size: 112, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
      bindGroup: null,
    };
    obj.bindGroup = this.device.createBindGroup({
      layout: this.meshPipeline.getBindGroupLayout(1),
      entries: [{ binding: 0, resource: { buffer: obj.modelBuf } }],
    });
    this._updateModelMatrix(obj);
    this.objects.push(obj);
    return obj;
  }

  addSkinnedObject(geoName, position, scale = new Vec3(1,1,1), rotationY = 0, color = [1,1,1], emissive = [0,0,0], opacity = 1) {
    const obj = {
      geoName, position: position.clone ? position.clone() : new Vec3(position.x, position.y, position.z),
      scale: scale.clone ? scale.clone() : new Vec3(scale.x || 1, scale.y || 1, scale.z || 1),
      rotationX: 0, rotationY, rotationZ: 0, color, emissive, opacity,
      visible: true, skinned: true,
      modelBuf: this.device.createBuffer({ size: 112, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
      jointBuf: this.device.createBuffer({ size: 64 * 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
      bindGroup: null,
    };
    obj.bindGroup = this.device.createBindGroup({
      layout: this.skinnedPipeline.getBindGroupLayout(1),
      entries: [
        { binding: 0, resource: { buffer: obj.modelBuf } },
        { binding: 1, resource: { buffer: obj.jointBuf } },
      ],
    });
    this._updateModelMatrix(obj);
    this.skinnedObjects.push(obj);
    return obj;
  }

  updateSkinnedJoints(obj, jointMatrices) {
    if (!obj.jointBuf || !jointMatrices) return;
    const padded = jointMatrices.length >= 64 * 16
      ? jointMatrices
      : (() => {
          const out = new Float32Array(64 * 16);
          out.set(jointMatrices);
          for (let i = Math.floor(jointMatrices.length / 16); i < 64; i++) {
            out[i * 16] = 1; out[i * 16 + 5] = 1; out[i * 16 + 10] = 1; out[i * 16 + 15] = 1;
          }
          return out;
        })();
    this.device.queue.writeBuffer(obj.jointBuf, 0, padded, 0, 64 * 16);
  }

  _updateModelMatrix(obj) {
    let model = obj.modelMatrix;
    if (!model) {
      const s = Mat4.scaling(obj.scale.x, obj.scale.y, obj.scale.z);
      const rx = Mat4.rotationX(obj.rotationX || 0);
      const ry = Mat4.rotationY(obj.rotationY || 0);
      const rz = Mat4.rotationZ(obj.rotationZ || 0);
      const r = Mat4.multiply(ry, Mat4.multiply(rx, rz));
      const t = Mat4.translation(obj.position.x, obj.position.y, obj.position.z);
      model = Mat4.multiply(t, Mat4.multiply(r, s));
    }
    const data = new Float32Array(28);
    data.set(model, 0);
    data.set(obj.color, 16);
    data.set(obj.emissive, 20);
    data[23] = obj.opacity;
    data[24] = 0;
    this.device.queue.writeBuffer(obj.modelBuf, 0, data);
  }

  updateObjectTransform(obj) {
    this._updateModelMatrix(obj);
  }

  removeObject(obj) {
    let idx = this.objects.indexOf(obj);
    if (idx >= 0) this.objects.splice(idx, 1);
    idx = this.skinnedObjects.indexOf(obj);
    if (idx >= 0) this.skinnedObjects.splice(idx, 1);
    if (obj.modelBuf) obj.modelBuf.destroy();
    if (obj.jointBuf) obj.jointBuf.destroy();
  }

  addBillboard(center, size, color, yOffset = 0) {
    const buf = this.device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const data = new Float32Array(12);
    data.set([center.x, center.y, center.z], 0);
    data.set([size.x, size.y], 4);
    data.set(color, 8);
    data[11] = yOffset;
    this.device.queue.writeBuffer(buf, 0, data);
    const bg = this.device.createBindGroup({
      layout: this.billboardPipeline.getBindGroupLayout(1),
      entries: [{ binding: 0, resource: { buffer: buf } }],
    });
    const bb = { buf, bindGroup: bg, center: center.clone(), size: size.clone ? size.clone() : new Vec3(size, size, 1), color: [...color], yOffset, visible: true };
    this.billboards.push(bb);
    return bb;
  }

  updateBillboard(bb, center, size, color, yOffset) {
    if (center) bb.center = center.clone();
    if (size) bb.size = size.clone ? size.clone() : new Vec3(size, size, 1);
    if (color) bb.color = [...color];
    if (yOffset !== undefined) bb.yOffset = yOffset;
    const data = new Float32Array(12);
    data.set([bb.center.x, bb.center.y, bb.center.z], 0);
    data.set([bb.size.x, bb.size.y], 4);
    data.set(bb.color, 8);
    data[11] = bb.yOffset;
    this.device.queue.writeBuffer(bb.buf, 0, data);
  }

  removeBillboard(bb) {
    const idx = this.billboards.indexOf(bb);
    if (idx >= 0) this.billboards.splice(idx, 1);
    if (bb.buf) bb.buf.destroy();
  }

  addPointLight(pos, color, intensity, range) {
    this.pointLights.push({ pos: pos.clone(), color, intensity, range });
  }

  clearPointLights() {
    this.pointLights = [];
  }

  render(camera) {
    const viewProj = Mat4.multiply(camera.projection, camera.view);
    const ubData = new Float32Array(64);
    ubData.set(viewProj, 0);
    ubData.set([camera.position.x, camera.position.y, camera.position.z], 16);
    ubData[19] = performance.now() * 0.001;
    ubData.set([0.25, 0.25, 0.38], 20);
    ubData[23] = 0.5;
    ubData.set([0.5, -1, 0.5], 24);
    ubData[27] = 1.0;
    ubData.set([1, 1, 1], 28);
    ubData[31] = 10;
    ubData.set([0.1, 0.1, 0.18], 32);
    ubData[35] = 100;
    if (this.pointLights.length > 0) {
      const pl = this.pointLights[0];
      ubData.set([pl.pos.x, pl.pos.y, pl.pos.z], 36);
      ubData[39] = pl.intensity;
      ubData.set(pl.color, 40);
      ubData[43] = pl.range;
    }
    this.device.queue.writeBuffer(this.uniformBuffer, 0, ubData);

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.msaaTex.createView(),
        resolveTarget: this.context.getCurrentTexture().createView(),
        clearValue: { r: 0.1, g: 0.1, b: 0.18, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: this.depthTex.createView(),
        depthClearValue: 1.0,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });

    const meshBindGroup = this.device.createBindGroup({
      layout: this.meshPipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
    });

    pass.setPipeline(this.gridPipeline);
    const gridBindGroup = this.device.createBindGroup({
      layout: this.gridPipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
    });
    pass.setBindGroup(0, gridBindGroup);
    pass.setVertexBuffer(0, this.gridPosBuf);
    pass.setIndexBuffer(this.gridIdxBuf, 'uint16');
    pass.drawIndexed(this.gridIndexCount);

    pass.setPipeline(this.meshPipeline);
    pass.setBindGroup(0, meshBindGroup);
    for (const obj of this.objects) {
      if (!obj.visible) continue;
      const geo = this.geometries[obj.geoName];
      if (!geo) continue;
      pass.setBindGroup(1, obj.bindGroup);
      pass.setVertexBuffer(0, geo.posBuf);
      pass.setVertexBuffer(1, geo.normBuf);
      pass.setVertexBuffer(2, geo.colorBuf);
      pass.setIndexBuffer(geo.idxBuf, geo.indexFormat || 'uint16');
      pass.drawIndexed(geo.indexCount);
    }

    if (this.skinnedObjects.length > 0) {
      const skinnedBindGroup = this.device.createBindGroup({
        layout: this.skinnedPipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
      });
      pass.setPipeline(this.skinnedPipeline);
      pass.setBindGroup(0, skinnedBindGroup);
      for (const obj of this.skinnedObjects) {
        if (!obj.visible) continue;
        const geo = this.skinnedGeometries[obj.geoName];
        if (!geo) continue;
        pass.setBindGroup(1, obj.bindGroup);
        pass.setVertexBuffer(0, geo.posBuf);
        pass.setVertexBuffer(1, geo.normBuf);
        pass.setVertexBuffer(2, geo.colorBuf);
        pass.setVertexBuffer(3, geo.jointBuf);
        pass.setVertexBuffer(4, geo.weightBuf);
        pass.setIndexBuffer(geo.idxBuf, geo.indexFormat || 'uint16');
        pass.drawIndexed(geo.indexCount);
      }
    }

    const bbBindGroup = this.device.createBindGroup({
      layout: this.billboardPipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
    });
    pass.setPipeline(this.billboardPipeline);
    pass.setBindGroup(0, bbBindGroup);
    pass.setVertexBuffer(0, this.bbQuadBuf);
    pass.setIndexBuffer(this.bbIdxBuf, 'uint16');
    for (const bb of this.billboards) {
      if (!bb.visible) continue;
      pass.setBindGroup(1, bb.bindGroup);
      pass.drawIndexed(6);
    }

    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  setRenderScale(scale) {
    this.renderScale = Math.max(0.25, Math.min(1.0, scale));
    this.resize();
  }

  setMSAA(enabled) {
    this.msaaEnabled = enabled;
    this.resize();
  }

  setGridVisible(visible) {
    if (this.gridObj) this.gridObj.visible = visible;
  }
}

export { createBoxGeometry, createSphereGeometry, createCylinderGeometry, createConeGeometry, createPlaneGeometry };
