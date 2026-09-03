import { Mat4 } from './math.js';

const GLB_MAGIC = 0x46546c67;
const GLB_JSON = 0x4e4f534a;
const GLB_BIN = 0x004e4942;
const COMPONENT_BYTES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_COUNTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

export async function loadGLBGeometry(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  const buffer = await res.arrayBuffer();
  const { json, bin } = parseGLB(buffer);
  const images = await loadEmbeddedImages(json, bin);
  const meshes = [];
  const scene = json.scenes?.[json.scene || 0];
  const roots = scene?.nodes || json.nodes?.map((_, i) => i) || [];
  for (const nodeIndex of roots) collectNodeMeshes(json, bin, nodeIndex, Mat4.identity(), meshes, images);
  if (meshes.length === 0) throw new Error(`No renderable meshes in ${url}`);
  return mergeMeshes(meshes);
}

export async function loadGLBWithNodes(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  const buffer = await res.arrayBuffer();
  const { json, bin } = parseGLB(buffer);
  const images = await loadEmbeddedImages(json, bin);
  const nodes = [];
  const scene = json.scenes?.[json.scene || 0];
  const roots = scene?.nodes || json.nodes?.map((_, i) => i) || [];
  for (const nodeIndex of roots) collectNodes(json, bin, nodeIndex, Mat4.identity(), nodes, null, images);
  return { nodes, json };
}

function collectNodes(json, bin, nodeIndex, parentMatrix, nodes, parentName, images) {
  const node = json.nodes[nodeIndex];
  const local = nodeMatrix(node);
  const world = Mat4.multiply(parentMatrix, local);
  const name = node.name || null;
  const entry = { name, parentName, localMatrix: local, worldMatrix: world, children: [] };
  if (node.mesh !== undefined) {
    const mesh = json.meshes[node.mesh];
    const subMeshes = [];
    for (const primitive of mesh.primitives || []) {
      if (primitive.mode !== undefined && primitive.mode !== 4) continue;
      const posAccessor = primitive.attributes?.POSITION;
      if (posAccessor === undefined) continue;
      const positions = readAccessor(json, bin, posAccessor);
      const normals = primitive.attributes.NORMAL !== undefined ? readAccessor(json, bin, primitive.attributes.NORMAL) : makeDefaultNormals(positions.length / 3);
      const indices = primitive.indices !== undefined ? readAccessor(json, bin, primitive.indices) : makeSequentialIndices(positions.length / 3);
      const colors = resolvePrimitiveColors(json, bin, primitive, positions.length / 3, images);
      const worldPos = transformPositions(positions, world);
      let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      for (let i = 0; i < worldPos.length; i += 3) {
        minX = Math.min(minX, worldPos[i]); maxX = Math.max(maxX, worldPos[i]);
        minY = Math.min(minY, worldPos[i + 1]); maxY = Math.max(maxY, worldPos[i + 1]);
        minZ = Math.min(minZ, worldPos[i + 2]); maxZ = Math.max(maxZ, worldPos[i + 2]);
      }
      subMeshes.push({ positions: worldPos, normals: transformNormals(normals, world), colors, indices, bounds: { minX, minY, minZ, maxX, maxY, maxZ } });
    }
    entry.meshes = subMeshes;
  }
  nodes.push(entry);
  if (node.children) {
    for (const child of node.children) {
      const childEntry = collectNodes(json, bin, child, world, nodes, name, images);
      entry.children.push(nodes.indexOf(childEntry));
    }
  }
  return entry;
}

function parseGLB(buffer) {
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== GLB_MAGIC) throw new Error('Invalid GLB magic');
  if (view.getUint32(4, true) !== 2) throw new Error('Only GLB v2 is supported');
  let offset = 12;
  let json = null;
  let bin = null;
  while (offset < buffer.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    offset += 8;
    const chunk = buffer.slice(offset, offset + length);
    if (type === GLB_JSON) json = JSON.parse(new TextDecoder().decode(chunk));
    if (type === GLB_BIN) bin = chunk;
    offset += length;
  }
  if (!json || !bin) throw new Error('GLB missing JSON or BIN chunk');
  return { json, bin };
}

function collectNodeMeshes(json, bin, nodeIndex, parentMatrix, meshes, images) {
  const node = json.nodes[nodeIndex];
  const local = nodeMatrix(node);
  const world = Mat4.multiply(parentMatrix, local);
  if (node.mesh !== undefined) appendMesh(json, bin, node.mesh, world, meshes, images);
  if (node.children) {
    for (const child of node.children) collectNodeMeshes(json, bin, child, world, meshes, images);
  }
}

function nodeMatrix(node) {
  if (node.matrix) return new Float32Array(node.matrix);
  const t = node.translation || [0, 0, 0];
  const r = node.rotation || [0, 0, 0, 1];
  const s = node.scale || [1, 1, 1];
  return Mat4.multiply(Mat4.translation(t[0], t[1], t[2]), Mat4.multiply(quatToMat4(r), Mat4.scaling(s[0], s[1], s[2])));
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

function appendMesh(json, bin, meshIndex, matrix, meshes, images) {
  const mesh = json.meshes[meshIndex];
  for (const primitive of mesh.primitives || []) {
    if (primitive.mode !== undefined && primitive.mode !== 4) continue;
    const posAccessor = primitive.attributes?.POSITION;
    if (posAccessor === undefined) continue;
    const positions = readAccessor(json, bin, posAccessor);
    const normals = primitive.attributes.NORMAL !== undefined ? readAccessor(json, bin, primitive.attributes.NORMAL) : makeDefaultNormals(positions.length / 3);
    const indices = primitive.indices !== undefined ? readAccessor(json, bin, primitive.indices) : makeSequentialIndices(positions.length / 3);
    const colors = resolvePrimitiveColors(json, bin, primitive, positions.length / 3, images);
    meshes.push({ positions: transformPositions(positions, matrix), normals: transformNormals(normals, matrix), colors, indices });
  }
}

function readAccessor(json, bin, accessorIndex) {
  const accessor = json.accessors[accessorIndex];
  const view = json.bufferViews[accessor.bufferView];
  const componentBytes = COMPONENT_BYTES[accessor.componentType];
  const components = TYPE_COUNTS[accessor.type];
  const stride = view.byteStride || componentBytes * components;
  const byteOffset = (view.byteOffset || 0) + (accessor.byteOffset || 0);
  const out = accessor.componentType === 5126 ? new Float32Array(accessor.count * components) : new Uint32Array(accessor.count * components);
  const data = new DataView(bin);
  for (let i = 0; i < accessor.count; i++) {
    for (let c = 0; c < components; c++) {
      const off = byteOffset + i * stride + c * componentBytes;
      out[i * components + c] = readComponent(data, off, accessor.componentType, accessor.normalized);
    }
  }
  return out;
}

function readComponent(data, offset, type, normalized = false) {
  if (type === 5126) return data.getFloat32(offset, true);
  if (type === 5125) return data.getUint32(offset, true);
  if (type === 5123) return data.getUint16(offset, true);
  if (type === 5121) {
    const v = data.getUint8(offset);
    return normalized ? v / 255 : v;
  }
  if (type === 5122) {
    const v = data.getInt16(offset, true);
    return normalized ? Math.max(v / 32767, -1) : v;
  }
  if (type === 5120) {
    const v = data.getInt8(offset);
    return normalized ? Math.max(v / 127, -1) : v;
  }
  throw new Error(`Unsupported component type ${type}`);
}

function transformPositions(src, m) {
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 3) {
    const x = src[i], y = src[i + 1], z = src[i + 2];
    out[i] = m[0] * x + m[4] * y + m[8] * z + m[12];
    out[i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    out[i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  }
  return out;
}

function transformNormals(src, m) {
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 3) {
    const x = src[i], y = src[i + 1], z = src[i + 2];
    let nx = m[0] * x + m[4] * y + m[8] * z;
    let ny = m[1] * x + m[5] * y + m[9] * z;
    let nz = m[2] * x + m[6] * y + m[10] * z;
    const len = Math.hypot(nx, ny, nz) || 1;
    out[i] = nx / len; out[i + 1] = ny / len; out[i + 2] = nz / len;
  }
  return out;
}

function makeDefaultNormals(count) {
  const normals = new Float32Array(count * 3);
  for (let i = 0; i < normals.length; i += 3) normals[i + 1] = 1;
  return normals;
}

function materialColor(json, materialIndex) {
  const material = materialIndex !== undefined ? json.materials?.[materialIndex] : null;
  const factor = material?.pbrMetallicRoughness?.baseColorFactor || [1, 1, 1, 1];
  return [factor[0] ?? 1, factor[1] ?? 1, factor[2] ?? 1];
}

function resolvePrimitiveColors(json, bin, primitive, vertexCount, images) {
  if (primitive.attributes?.COLOR_0 !== undefined) {
    const raw = readAccessor(json, bin, primitive.attributes.COLOR_0);
    const comps = raw.length / vertexCount;
    const colors = new Float32Array(vertexCount * 3);
    for (let i = 0; i < vertexCount; i++) {
      colors[i * 3] = raw[i * comps];
      colors[i * 3 + 1] = raw[i * comps + 1];
      colors[i * 3 + 2] = raw[i * comps + 2];
    }
    return colors;
  }

  const factor = materialColor(json, primitive.material);
  const material = primitive.material !== undefined ? json.materials?.[primitive.material] : null;
  const texInfo = material?.pbrMetallicRoughness?.baseColorTexture;
  const uvAttr = primitive.attributes?.TEXCOORD_0;
  if (texInfo && uvAttr !== undefined && images) {
    const texture = json.textures?.[texInfo.index];
    const imageIndex = texture?.source;
    const image = imageIndex !== undefined ? images.get(imageIndex) : null;
    if (image) {
      const uvs = readAccessor(json, bin, uvAttr);
      const colors = new Float32Array(vertexCount * 3);
      for (let i = 0; i < vertexCount; i++) {
        const sampled = sampleImage(image, uvs[i * 2], uvs[i * 2 + 1]);
        colors[i * 3] = sampled[0] * factor[0];
        colors[i * 3 + 1] = sampled[1] * factor[1];
        colors[i * 3 + 2] = sampled[2] * factor[2];
      }
      return colors;
    }
  }

  return makeVertexColors(vertexCount, factor);
}

async function loadEmbeddedImages(json, bin) {
  const images = new Map();
  const list = json.images || [];
  for (let i = 0; i < list.length; i++) {
    try {
      const image = list[i];
      let bytes = null;
      let mime = image.mimeType || 'image/png';
      if (image.bufferView !== undefined) {
        const view = json.bufferViews[image.bufferView];
        const start = view.byteOffset || 0;
        bytes = bin.slice(start, start + view.byteLength);
      } else if (typeof image.uri === 'string' && image.uri.startsWith('data:')) {
        const comma = image.uri.indexOf(',');
        const header = image.uri.slice(0, comma);
        const payload = image.uri.slice(comma + 1);
        mime = header.match(/data:([^;]+)/)?.[1] || mime;
        const binStr = atob(payload);
        bytes = new Uint8Array(binStr.length);
        for (let j = 0; j < binStr.length; j++) bytes[j] = binStr.charCodeAt(j);
      }
      if (!bytes) continue;
      const bitmap = await createImageBitmap(new Blob([bytes], { type: mime }));
      const canvas = typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(bitmap.width, bitmap.height)
        : Object.assign(document.createElement('canvas'), { width: bitmap.width, height: bitmap.height });
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bitmap, 0, 0);
      const { data, width, height } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
      bitmap.close?.();
      images.set(i, { data, width, height });
    } catch (err) {
      console.warn(`Failed to decode GLB image ${i}:`, err);
    }
  }
  return images;
}

function sampleImage(image, u, v) {
  let uu = u - Math.floor(u);
  let vv = v - Math.floor(v);
  if (uu < 0) uu += 1;
  if (vv < 0) vv += 1;
  // glTF UVs origin bottom-left; ImageData origin top-left
  const x = Math.min(image.width - 1, Math.max(0, Math.floor(uu * image.width)));
  const y = Math.min(image.height - 1, Math.max(0, Math.floor((1 - vv) * image.height)));
  const i = (y * image.width + x) * 4;
  return [image.data[i] / 255, image.data[i + 1] / 255, image.data[i + 2] / 255];
}

function makeVertexColors(count, color) {
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < colors.length; i += 3) {
    colors[i] = color[0];
    colors[i + 1] = color[1];
    colors[i + 2] = color[2];
  }
  return colors;
}

function makeSequentialIndices(count) {
  const indices = new Uint32Array(count);
  for (let i = 0; i < count; i++) indices[i] = i;
  return indices;
}

function mergeMeshes(meshes) {
  let vertexCount = 0;
  let indexCount = 0;
  for (const mesh of meshes) {
    vertexCount += mesh.positions.length / 3;
    indexCount += mesh.indices.length;
  }
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const useUint32 = vertexCount > 65535;
  const indices = useUint32 ? new Uint32Array(indexCount) : new Uint16Array(indexCount);
  let vo = 0;
  let io = 0;
  for (const mesh of meshes) {
    const base = vo / 3;
    positions.set(mesh.positions, vo);
    normals.set(mesh.normals, vo);
    colors.set(mesh.colors, vo);
    for (let i = 0; i < mesh.indices.length; i++) indices[io + i] = mesh.indices[i] + base;
    vo += mesh.positions.length;
    io += mesh.indices.length;
  }
  return { positions, normals, colors, indices };
}

/** Prefer baseColor texture over solid COLOR_0 (PixelLab often embeds white COLOR_0). */
function resolveSkinnedColors(json, bin, primitive, vertexCount, images) {
  const factor = materialColor(json, primitive.material);
  const material = primitive.material !== undefined ? json.materials?.[primitive.material] : null;
  const texInfo = material?.pbrMetallicRoughness?.baseColorTexture;
  const uvAttr = primitive.attributes?.TEXCOORD_0;
  if (texInfo && uvAttr !== undefined && images) {
    const texture = json.textures?.[texInfo.index];
    const image = texture?.source !== undefined ? images.get(texture.source) : null;
    if (image) {
      const uvs = readAccessor(json, bin, uvAttr);
      const colors = new Float32Array(vertexCount * 3);
      for (let i = 0; i < vertexCount; i++) {
        const sampled = sampleImage(image, uvs[i * 2], uvs[i * 2 + 1]);
        colors[i * 3] = sampled[0] * factor[0];
        colors[i * 3 + 1] = sampled[1] * factor[1];
        colors[i * 3 + 2] = sampled[2] * factor[2];
      }
      return colors;
    }
  }
  return resolvePrimitiveColors(json, bin, primitive, vertexCount, images);
}

function readJointsAccessor(json, bin, accessorIndex) {
  const accessor = json.accessors[accessorIndex];
  const view = json.bufferViews[accessor.bufferView];
  const componentBytes = COMPONENT_BYTES[accessor.componentType];
  const components = TYPE_COUNTS[accessor.type];
  const stride = view.byteStride || componentBytes * components;
  const byteOffset = (view.byteOffset || 0) + (accessor.byteOffset || 0);
  const out = new Uint16Array(accessor.count * components);
  const data = new DataView(bin);
  for (let i = 0; i < accessor.count; i++) {
    for (let c = 0; c < components; c++) {
      const off = byteOffset + i * stride + c * componentBytes;
      out[i * components + c] = readComponent(data, off, accessor.componentType, accessor.normalized);
    }
  }
  return out;
}

/**
 * Load a skinned GLB with skeleton + animation clips.
 * Mesh positions stay in bind/local space (not baked by node transforms).
 */
export async function loadGLBSkinned(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  const buffer = await res.arrayBuffer();
  const { json, bin } = parseGLB(buffer);
  if (!json.skins?.length) throw new Error(`No skins in ${url}`);

  const images = await loadEmbeddedImages(json, bin);
  const skin = json.skins[0];
  const jointNodeIndices = skin.joints;
  const inverseBindMatrices = readAccessor(json, bin, skin.inverseBindMatrices);

  const nodes = (json.nodes || []).map((node) => ({
    name: node.name || null,
    translation: node.translation ? [...node.translation] : [0, 0, 0],
    rotation: node.rotation ? [...node.rotation] : [0, 0, 0, 1],
    scale: node.scale ? [...node.scale] : [1, 1, 1],
    children: node.children ? [...node.children] : [],
    matrix: node.matrix ? new Float32Array(node.matrix) : null,
  }));

  let meshNodeIndex = -1;
  let primitive = null;
  for (let i = 0; i < (json.nodes || []).length; i++) {
    const node = json.nodes[i];
    if (node.skin === undefined || node.mesh === undefined) continue;
    const mesh = json.meshes[node.mesh];
    for (const prim of mesh.primitives || []) {
      if (prim.mode !== undefined && prim.mode !== 4) continue;
      if (prim.attributes?.POSITION === undefined) continue;
      if (prim.attributes?.JOINTS_0 === undefined || prim.attributes?.WEIGHTS_0 === undefined) continue;
      meshNodeIndex = i;
      primitive = prim;
      break;
    }
    if (primitive) break;
  }
  if (!primitive) throw new Error(`No skinned mesh primitive in ${url}`);

  const positions = readAccessor(json, bin, primitive.attributes.POSITION);
  const normals = primitive.attributes.NORMAL !== undefined
    ? readAccessor(json, bin, primitive.attributes.NORMAL)
    : makeDefaultNormals(positions.length / 3);
  const joints = readJointsAccessor(json, bin, primitive.attributes.JOINTS_0);
  const weights = readAccessor(json, bin, primitive.attributes.WEIGHTS_0);
  const indices = primitive.indices !== undefined
    ? readAccessor(json, bin, primitive.indices)
    : makeSequentialIndices(positions.length / 3);
  const colors = resolveSkinnedColors(json, bin, primitive, positions.length / 3, images);

  const indexArray = indices instanceof Float32Array
    ? Uint32Array.from(indices)
    : (positions.length / 3 > 65535
      ? (indices instanceof Uint32Array ? indices : Uint32Array.from(indices))
      : (indices instanceof Uint16Array ? indices : Uint16Array.from(indices)));

  const animations = {};
  for (const anim of json.animations || []) {
    const name = anim.name || `anim_${Object.keys(animations).length}`;
    let duration = 0;
    const channels = [];
    for (const ch of anim.channels || []) {
      const sampler = anim.samplers[ch.sampler];
      if (!sampler || ch.target?.node === undefined || !ch.target.path) continue;
      const times = readAccessor(json, bin, sampler.input);
      const values = readAccessor(json, bin, sampler.output);
      duration = Math.max(duration, times[times.length - 1] || 0);
      channels.push({
        node: ch.target.node,
        path: ch.target.path,
        interpolation: sampler.interpolation || 'LINEAR',
        times,
        values,
      });
    }
    animations[name] = { name, duration, channels };
  }

  let minY = Infinity, maxY = -Infinity;
  for (let i = 1; i < positions.length; i += 3) {
    minY = Math.min(minY, positions[i]);
    maxY = Math.max(maxY, positions[i]);
  }

  return {
    positions,
    normals,
    colors,
    joints,
    weights,
    indices: indexArray,
    inverseBindMatrices,
    jointNodeIndices,
    nodes,
    meshNodeIndex,
    animations,
    bounds: { minY, maxY, height: Math.max(maxY - minY, 0.01) },
  };
}
