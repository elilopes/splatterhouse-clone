import * as THREE from "three";

export type ProceduralSurfaceKind = "skin" | "denim";

export type ProceduralSurfaceMapOptions = {
  /** Texture resolution. 512 is the balanced default for the in-game character. */
  size?: 256 | 512 | 1024;
  /** Strength of the wet blood response, from 0 (disabled) to 1. */
  bloodIntensity?: number;
  /** Stable seed so the same material is reproducible between runs. */
  seed?: number;
  /** Maximum anisotropy requested by the renderer when available. */
  anisotropy?: number;
};

export type ProceduralPBRMaps = {
  normalMap: THREE.DataTexture;
  heightMap: THREE.DataTexture;
  aoMap: THREE.DataTexture;
  roughnessMap: THREE.DataTexture;
  dispose: () => void;
};

const clamp01 = (value: number) => THREE.MathUtils.clamp(value, 0, 1);

/** Integer hash: deterministic and substantially cheaper than per-pixel sin hashes. */
function hash2D(x: number, y: number, seed: number): number {
  let h = Math.imul(x ^ seed, 0x45d9f3b);
  h = Math.imul(h ^ y, 0x45d9f3b);
  h ^= h >>> 16;
  h = Math.imul(h, 0x45d9f3b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

function smoothNoise(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Periodic value noise. Integer frequency makes opposite UV edges tile seamlessly. */
function periodicNoise(u: number, v: number, frequency: number, seed: number): number {
  const x = u * frequency;
  const y = v * frequency;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smoothNoise(x - x0);
  const ty = smoothNoise(y - y0);
  const wrap = (n: number) => ((n % frequency) + frequency) % frequency;
  const a = hash2D(wrap(x0), wrap(y0), seed);
  const b = hash2D(wrap(x0 + 1), wrap(y0), seed);
  const c = hash2D(wrap(x0), wrap(y0 + 1), seed);
  const d = hash2D(wrap(x0 + 1), wrap(y0 + 1), seed);
  const top = THREE.MathUtils.lerp(a, b, tx);
  const bottom = THREE.MathUtils.lerp(c, d, tx);
  return THREE.MathUtils.lerp(top, bottom, ty);
}

function fbm(u: number, v: number, seed: number, baseFrequency: number, octaves = 3): number {
  let sum = 0;
  let amplitude = 0.5;
  let normalization = 0;
  let frequency = baseFrequency;
  for (let octave = 0; octave < octaves; octave++) {
    sum += periodicNoise(u, v, frequency, seed + octave * 1013) * amplitude;
    normalization += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return sum / normalization;
}

function createDataTexture(
  data: Uint8Array,
  size: number,
  anisotropy: number
): THREE.DataTexture {
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = Math.max(1, Math.floor(anisotropy));
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
}

function buildNormalMap(height: Float32Array, size: number, strength: number, anisotropy: number) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    const y0 = ((y - 1 + size) % size) * size;
    const y1 = ((y + 1) % size) * size;
    const row = y * size;
    for (let x = 0; x < size; x++) {
      const left = row + ((x - 1 + size) % size);
      const right = row + ((x + 1) % size);
      const dx = (height[right] - height[left]) * strength;
      const dy = (height[y1 + x] - height[y0 + x]) * strength;
      const invLength = 1 / Math.hypot(dx, dy, 1);
      const offset = (row + x) * 4;
      data[offset] = Math.round((-dx * invLength * 0.5 + 0.5) * 255);
      data[offset + 1] = Math.round((-dy * invLength * 0.5 + 0.5) * 255);
      data[offset + 2] = Math.round((invLength * 0.5 + 0.5) * 255);
      data[offset + 3] = 255;
    }
  }
  return createDataTexture(data, size, anisotropy);
}

function resolveOptions(
  sizeOrOptions: number | ProceduralSurfaceMapOptions,
  legacyBloodIntensity: number
): Required<ProceduralSurfaceMapOptions> {
  const options = typeof sizeOrOptions === "number"
    ? { size: sizeOrOptions, bloodIntensity: legacyBloodIntensity }
    : sizeOrOptions;
  const requestedSize = options.size ?? 512;
  const size = requestedSize <= 256 ? 256 : requestedSize <= 512 ? 512 : 1024;
  return {
    size,
    bloodIntensity: clamp01(options.bloodIntensity ?? 0.82),
    seed: Math.floor(options.seed ?? 173),
    anisotropy: Math.max(1, Math.floor(options.anisotropy ?? 4)),
  };
}

/**
 * Builds tileable tangent-space normal, height, AO and roughness maps for skin or denim.
 * Blood affects height, occlusion and specular response only; existing albedo/vertex
 * colors remain authoritative for the visible red pigment and existing blood decals.
 */
export function createProceduralSurfaceMaps(
  kind: ProceduralSurfaceKind,
  sizeOrOptions: number | ProceduralSurfaceMapOptions = 512,
  legacyBloodIntensity = 0.82
): ProceduralPBRMaps {
  const { size, bloodIntensity, seed, anisotropy } = resolveOptions(sizeOrOptions, legacyBloodIntensity);
  const total = size * size;
  const heightField = new Float32Array(total);
  const heightData = new Uint8Array(total * 4);
  const aoData = new Uint8Array(total * 4);
  const roughnessData = new Uint8Array(total * 4);

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const index = y * size + x;
      const offset = index * 4;
      const bloodNoise = fbm(u, v, seed + 701, 8, 3);
      const bloodMask = clamp01((bloodNoise - 0.61) * 5.2) * bloodIntensity;

      let height: number;
      let ao: number;
      let roughness: number;

      if (kind === "skin") {
        const macro = fbm(u, v, seed + 11, 5, 4);
        const pores = periodicNoise(u, v, 96, seed + 97);
        const porePit = pores > 0.925 ? (pores - 0.925) * 5.5 : 0;
        const micro = fbm(u, v, seed + 29, 48, 3);
        const sweat = clamp01((fbm(u, v, seed + 53, 7, 3) - 0.60) * 5.0);
        const baseHeight = clamp01(0.50 + (macro - 0.5) * 0.28 + (micro - 0.5) * 0.20 - porePit * 0.12);
        height = THREE.MathUtils.lerp(baseHeight, 0.67 + fbm(u, v, seed + 163, 24, 2) * 0.10, bloodMask);
        ao = THREE.MathUtils.clamp(0.76 + (macro - 0.5) * 0.28 - porePit * 0.42 - bloodMask * 0.12, 0.35, 1);
        const dryRoughness = THREE.MathUtils.clamp(0.78 - micro * 0.16 + porePit * 0.10, 0.48, 0.94);
        const wetRoughness = THREE.MathUtils.lerp(dryRoughness, 0.36, sweat);
        roughness = THREE.MathUtils.lerp(wetRoughness, 0.19 + fbm(u, v, seed + 199, 20, 2) * 0.08, bloodMask);
      } else {
        const twill = Math.sin((u * size + v * size * 1.08) * (Math.PI / 3));
        const weave = fbm(u, v, seed + 41, 72, 2);
        const wear = fbm(u, v, seed + 71, 5, 4);
        const baseHeight = clamp01(0.47 + twill * 0.12 + (weave - 0.5) * 0.28 + (wear - 0.5) * 0.12);
        height = THREE.MathUtils.lerp(baseHeight, 0.58 + fbm(u, v, seed + 179, 24, 2) * 0.10, bloodMask * 0.82);
        ao = THREE.MathUtils.clamp(0.72 + (twill * 0.5) * 0.18 + (wear - 0.5) * 0.18 - bloodMask * 0.12, 0.3, 1);
        const dryRoughness = THREE.MathUtils.clamp(0.93 - wear * 0.12 - Math.max(0, twill) * 0.06, 0.70, 0.99);
        roughness = THREE.MathUtils.lerp(dryRoughness, 0.38 + fbm(u, v, seed + 211, 18, 2) * 0.10, bloodMask);
      }

      heightField[index] = height;
      const heightByte = Math.round(height * 255);
      const aoByte = Math.round(ao * 255);
      const roughByte = Math.round(THREE.MathUtils.clamp(roughness, 0.04, 1) * 255);
      heightData[offset] = heightData[offset + 1] = heightData[offset + 2] = heightByte;
      aoData[offset] = aoData[offset + 1] = aoData[offset + 2] = aoByte;
      roughnessData[offset] = roughnessData[offset + 1] = roughnessData[offset + 2] = roughByte;
      heightData[offset + 3] = aoData[offset + 3] = roughnessData[offset + 3] = 255;
    }
  }

  const normalMap = buildNormalMap(heightField, size, kind === "skin" ? 2.15 : 2.8, anisotropy);
  const heightMap = createDataTexture(heightData, size, anisotropy);
  const aoMap = createDataTexture(aoData, size, anisotropy);
  const roughnessMap = createDataTexture(roughnessData, size, anisotropy);

  return {
    normalMap,
    heightMap,
    aoMap,
    roughnessMap,
    dispose: () => {
      normalMap.dispose();
      heightMap.dispose();
      aoMap.dispose();
      roughnessMap.dispose();
    },
  };
}
