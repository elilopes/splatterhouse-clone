import * as THREE from "three";
import { MeshStandardNodeMaterial } from "three/webgpu";
import { attribute, float, normalMap as normalMapNode, texture, uv, vec2 } from "three/tsl";

export type ProceduralPBRMaps = {
  normalMap: THREE.DataTexture;
  aoMap: THREE.DataTexture;
  roughnessMap: THREE.DataTexture;
  dispose: () => void;
};

export type WebGPUSurfaceMaterialOptions = {
  baseColorHex: string;
  maps: ProceduralPBRMaps;
  albedoMap?: THREE.Texture;
  normalScale?: number;
  aoIntensity?: number;
  roughnessMultiplier?: number;
  metalness?: number;
  useSecondaryUVForAO?: boolean;
};

function hash2D(x: number, y: number, seed: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453123;
  return h - Math.floor(h);
}

function valueNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);

  const n00 = hash2D(xi, yi, seed);
  const n10 = hash2D(xi + 1, yi, seed);
  const n01 = hash2D(xi, yi + 1, seed);
  const n11 = hash2D(xi + 1, yi + 1, seed);

  const nx0 = n00 + (n10 - n00) * u;
  const nx1 = n01 + (n11 - n01) * u;
  return nx0 + (nx1 - nx0) * v;
}

function fbm(x: number, y: number, seed: number, octaves = 4): number {
  let value = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;

  for (let i = 0; i < octaves; i++) {
    value += amp * valueNoise(x * freq, y * freq, seed + i * 19);
    norm += amp;
    amp *= 0.5;
    freq *= 2.02;
  }
  return value / norm;
}

/**
 * Converte um mapa escalar de altura [0..1] em um normalMap tangente (RGB em [0..255]).
 */
function buildNormalDataTexture(
  heightField: Float32Array,
  size: number,
  strength: number
): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y++) {
    const yPrev = (y - 1 + size) % size;
    const yNext = (y + 1) % size;

    for (let x = 0; x < size; x++) {
      const xPrev = (x - 1 + size) % size;
      const xNext = (x + 1) % size;

      const hL = heightField[y * size + xPrev];
      const hR = heightField[y * size + xNext];
      const hD = heightField[yPrev * size + x];
      const hU = heightField[yNext * size + x];

      const dx = (hR - hL) * strength;
      const dy = (hU - hD) * strength;

      const nx = -dx;
      const ny = -dy;
      const nz = 1.0;
      const invLen = 1.0 / Math.hypot(nx, ny, nz);

      const idx = (y * size + x) * 4;
      data[idx] = Math.round(((nx * invLen) * 0.5 + 0.5) * 255);
      data[idx + 1] = Math.round(((ny * invLen) * 0.5 + 0.5) * 255);
      data[idx + 2] = Math.round(((nz * invLen) * 0.5 + 0.5) * 255);
      data[idx + 3] = 255;
    }
  }

  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Calcula uma máscara orgânica de sangue [0..1] em coordenadas UV.
 */
function computeBloodMask(u: number, v: number): number {
  const n1 = fbm(u * 5.5 + 1.3, v * 5.5 + 2.7, 101, 4);
  const drip = fbm(u * 14.0, v * 3.2, 137, 3);
  const splatter = THREE.MathUtils.smoothstep(n1 * 0.72 + drip * 0.28, 0.62, 0.82);
  return THREE.MathUtils.clamp(splatter, 0, 1);
}

/**
 * Gera normalMap, aoMap e roughnessMap procedurais para pele ou jeans,
 * com resposta úmida e brilhante nas áreas de sangue.
 */
export function createProceduralSurfaceMaps(
  kind: "skin" | "denim",
  size = 512,
  bloodIntensity = 0.85
): ProceduralPBRMaps {
  const total = size * size;
  const heightField = new Float32Array(total);
  const aoData = new Uint8Array(total * 4);
  const roughData = new Uint8Array(total * 4);

  const clampedBlood = THREE.MathUtils.clamp(bloodIntensity, 0, 1);

  for (let y = 0; y < size; y++) {
    const v = y / size;

    for (let x = 0; x < size; x++) {
      const u = x / size;
      const idx = y * size + x;
      const p4 = idx * 4;

      let height = 0.5;
      let ao = 1.0;
      let roughness = 0.75;

      const bloodMask = computeBloodMask(u, v) * clampedBlood;

      if (kind === "skin") {
        const macro = fbm(u * 10, v * 10, 11, 4);
        const micro = fbm(u * 64, v * 64, 29, 3);
        const pores = hash2D(x, y, 97);
        const porePit = pores < 0.08 ? (0.08 - pores) * 3.5 : 0;

        const sweatMask = THREE.MathUtils.smoothstep(
          fbm(u * 6 + 3.1, v * 6 + 1.7, 53, 3),
          0.58,
          0.82
        );

        const baseHeight = THREE.MathUtils.clamp(
          0.5 + (macro - 0.5) * 0.35 + (micro - 0.5) * 0.28 - porePit * 0.22,
          0,
          1
        );

        const bloodHeight = THREE.MathUtils.clamp(
          0.62 + fbm(u * 22, v * 22, 163, 2) * 0.14,
          0,
          1
        );
        height = THREE.MathUtils.lerp(baseHeight, bloodHeight, bloodMask);

        const baseAO = THREE.MathUtils.clamp(
          0.62 + macro * 0.32 + micro * 0.14 - porePit * 0.45,
          0.25,
          1.0
        );
        ao = THREE.MathUtils.clamp(baseAO * (1 - bloodMask * 0.22), 0.2, 1.0);

        const drySkinRough = THREE.MathUtils.clamp(
          0.76 - micro * 0.14 + porePit * 0.12,
          0.45,
          0.92
        );
        const wetSkinRough = THREE.MathUtils.lerp(drySkinRough, 0.32, sweatMask);
        const bloodRough = 0.16 + fbm(u * 18, v * 18, 199, 2) * 0.08;
        roughness = THREE.MathUtils.lerp(wetSkinRough, bloodRough, bloodMask);
      } else {
        const twillPhase = ((x + y) % 6) / 6;
        const twillRidge = Math.sin(twillPhase * Math.PI * 2) * 0.5 + 0.5;
        const warpWeave = fbm(u * 90, v * 90, 41, 2);
        const wornPatch = fbm(u * 5, v * 5, 71, 4);

        const baseHeight = THREE.MathUtils.clamp(
          0.35 + twillRidge * 0.42 + (warpWeave - 0.5) * 0.25 + (wornPatch - 0.5) * 0.15,
          0,
          1
        );
        const bloodHeight = THREE.MathUtils.clamp(
          0.55 + fbm(u * 24, v * 24, 179, 2) * 0.12,
          0,
          1
        );
        height = THREE.MathUtils.lerp(baseHeight, bloodHeight, bloodMask * 0.85);

        const baseAO = THREE.MathUtils.clamp(
          0.52 + twillRidge * 0.28 + wornPatch * 0.25,
          0.2,
          1.0
        );
        ao = THREE.MathUtils.clamp(baseAO * (1 - bloodMask * 0.25), 0.18, 1.0);

        const baseRough = THREE.MathUtils.clamp(
          0.92 - wornPatch * 0.12 - twillRidge * 0.05,
          0.72,
          0.98
        );
        const bloodDenimRough = 0.34 + fbm(u * 16, v * 16, 211, 2) * 0.1;
        roughness = THREE.MathUtils.lerp(baseRough, bloodDenimRough, bloodMask);
      }

      heightField[idx] = height;

      const aoByte = Math.round(ao * 255);
      aoData[p4] = aoByte;
      aoData[p4 + 1] = aoByte;
      aoData[p4 + 2] = aoByte;
      aoData[p4 + 3] = 255;

      const roughByte = Math.round(THREE.MathUtils.clamp(roughness, 0.04, 1.0) * 255);
      roughData[p4] = roughByte;
      roughData[p4 + 1] = roughByte;
      roughData[p4 + 2] = roughByte;
      roughData[p4 + 3] = 255;
    }
  }

  const normalStrength = kind === "skin" ? 2.4 : 3.2;
  const normalMap = buildNormalDataTexture(heightField, size, normalStrength);

  const aoMap = new THREE.DataTexture(aoData, size, size, THREE.RGBAFormat);
  aoMap.colorSpace = THREE.NoColorSpace;
  aoMap.wrapS = THREE.RepeatWrapping;
  aoMap.wrapT = THREE.RepeatWrapping;
  aoMap.needsUpdate = true;

  const roughnessMap = new THREE.DataTexture(roughData, size, size, THREE.RGBAFormat);
  roughnessMap.colorSpace = THREE.NoColorSpace;
  roughnessMap.wrapS = THREE.RepeatWrapping;
  roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.needsUpdate = true;

  return {
    normalMap,
    aoMap,
    roughnessMap,
    dispose: () => {
      normalMap.dispose();
      aoMap.dispose();
      roughnessMap.dispose();
    },
  };
}

/**
 * Cria um MeshStandardNodeMaterial configurado em TSL para WebGPURenderer,
 * conectando normalMap, aoMap e roughnessMap sem usar bumpMap.
 */
export function createWebGPUSurfaceNodeMaterial(
  options: WebGPUSurfaceMaterialOptions
): MeshStandardNodeMaterial {
  const {
    baseColorHex,
    maps,
    albedoMap,
    normalScale = 0.9,
    aoIntensity = 1.15,
    roughnessMultiplier = 1.0,
    metalness = 0.0,
    useSecondaryUVForAO = true,
  } = options;

  const material = new MeshStandardNodeMaterial();
  const baseColor = new THREE.Color(baseColorHex);
  const primaryUV = uv();
  const aoUV = useSecondaryUVForAO ? uv(attribute("uv2")) : primaryUV;

  material.colorNode = albedoMap
    ? texture(albedoMap, primaryUV).mul(baseColor)
    : float(1.0).mul(baseColor);

  material.normalNode = normalMapNode(
    texture(maps.normalMap, primaryUV),
    vec2(normalScale, normalScale)
  );

  material.aoNode = texture(maps.aoMap, aoUV).r.mul(float(aoIntensity));
  material.roughnessNode = texture(maps.roughnessMap, primaryUV).r.mul(
    float(roughnessMultiplier)
  );

  material.metalness = metalness;
  material.vertexColors = true;
  material.needsUpdate = true;

  return material;
}
