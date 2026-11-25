import React, { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, Environment, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import {
  createProceduralSurfaceMaps,
  createWebGPUSurfaceNodeMaterial,
} from "./proceduralSurfaceMaps";
import { WebGPURenderer } from "three/webgpu";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import {
  computeHeadAnthropometry,
  createParametricHumanHeadGeometry,
  DEFAULT_FACIAL_BLENDSHAPES,
  DEFAULT_HEAD_FINE_TUNING,
  FACIAL_BLENDSHAPE_NAMES,
  HEAD_3DMM_PRESETS,
  type FacialBlendshapeName,
  type FacialBlendshapeWeights,
  type Head3DMMPresetId,
  type HeadFineTuningParams,
} from "./parametricHead3DMM";


export type RickWeaponId = "sickle" | "pipe" | "machete" | "shotgun";

/**
 * Parâmetros morfológicos corporais inspirados em 3DMM.
 * Os coeficientes são aplicados continuamente à superfície, preservando
 * os detalhes anatômicos e os atributos de skinning da malha original.
 */
export type RickBody3DMMParams = {
  shoulderWidth: number;
  chestVolume: number;
  waistTaper: number;
  armMass: number;
  pelvisWidth: number;
  thighMass: number;
  torsoDepth: number;
};

export const DEFAULT_RICK_BODY_3DMM: RickBody3DMMParams = {
  shoulderWidth: 0.16,
  chestVolume: 0.13,
  waistTaper: 0.10,
  armMass: 0.12,
  pelvisWidth: 0.045,
  thighMass: 0.10,
  torsoDepth: 0.075,
};

function applyRickBody3DMM(
  geometry: THREE.BufferGeometry,
  params: RickBody3DMMParams,
  region: "upper" | "lower"
) {
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  const skinIndex = geometry.getAttribute("skinIndex") as THREE.BufferAttribute | undefined;
  const skinWeight = geometry.getAttribute("skinWeight") as THREE.BufferAttribute | undefined;
  if (!position) return;

  const smoothBand = (value: number, center: number, width: number) =>
    Math.exp(-Math.pow((value - center) / width, 2));
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const ax = Math.abs(x);
    if (region === "upper") {
      const shoulder = smoothBand(y, 1.61, 0.19) * smoothstep(0.20, 0.43, ax);
      const chest = smoothBand(y, 1.58, 0.22) * smoothstep(0.05, 0.32, ax);
      const waist = smoothBand(y, 1.25, 0.22);
      const arm = smoothBand(y, 1.39, 0.28) * smoothstep(0.34, 0.48, ax);
      const widthScale = 1 + params.shoulderWidth * shoulder + params.chestVolume * chest
        - params.waistTaper * waist + params.armMass * arm;
      const depthScale = 1 + params.torsoDepth * chest - params.waistTaper * waist * 0.28;
      position.setXYZ(i, x * widthScale, y, z * depthScale);
    } else {
      const pelvis = smoothBand(y, 0.91, 0.15);
      const thigh = smoothBand(y, 0.67, 0.24);
      const widthScale = 1 + params.pelvisWidth * pelvis + params.thighMass * thigh;
      position.setXYZ(i, x * widthScale, y, z * (1 + params.thighMass * thigh * 0.42));
    }

    // Garante pesos finitos, não negativos e normalizados após a deformação.
    if (skinIndex && skinWeight) {
      let total = 0;
      for (let c = 0; c < 4; c++) {
        const w = Math.max(0, skinWeight.getComponent(i, c));
        skinWeight.setComponent(i, c, w);
        total += w;
      }
      if (total > 1e-8) {
        for (let c = 0; c < 4; c++) skinWeight.setComponent(i, c, skinWeight.getComponent(i, c) / total);
      }
    }
  }
  position.needsUpdate = true;
  if (skinWeight) skinWeight.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
}

export type RickPipeAttackStyle = "bat" | "overhead" | "macheteHead" | "macheteArm" | "sweep";

export type RickPoseMode = "idle" | "walk" | "attack" | "grab" | "jump";

export type RickMotion = {
  moving: boolean;
  attackTime: number;
  attackStyle: RickPipeAttackStyle | null;
  attackProgress: number;
  grabTime: number;
  jumpHeight: number;
  weapon: RickWeaponId | null;
  slideTime?: number;
  specialMove?: "slide" | "sweep" | "escorrao" | "superJump" | "impact" | null;
  shotgunAimPitch?: number;
  shotgunAimYaw?: number;
  leftFlex?: number;
  rightFlex?: number;
  legFlex?: number;
};

export type RickTaylorCharacterProps = {
  motion: RickMotion;
  equippedWeapon?: RickWeaponId | null;
  bloodIntensity?: number;
  headTuning?: Partial<HeadFineTuningParams>;
  blendshapes?: Partial<FacialBlendshapeWeights>;
  hideMask?: boolean;
  showFaceMeshOverlay?: boolean;
  showLandmarks?: boolean;
};

const _matHips = new THREE.Matrix4();
const _matSpine = new THREE.Matrix4();
const _matChest = new THREE.Matrix4();
const _matNeck = new THREE.Matrix4();
const _matHead = new THREE.Matrix4();
const _matLShoulder = new THREE.Matrix4();
const _matLElbow = new THREE.Matrix4();
const _matRShoulder = new THREE.Matrix4();
const _matRElbow = new THREE.Matrix4();
const _matLThigh = new THREE.Matrix4();
const _matLKnee = new THREE.Matrix4();
const _matRThigh = new THREE.Matrix4();
const _matRKnee = new THREE.Matrix4();

const BONE_HIPS = 0;
const BONE_SPINE = 1;
const BONE_CHEST = 2;
const BONE_NECK = 3;
const BONE_HEAD = 4;
const BONE_L_SHOULDER = 5;
const BONE_L_ELBOW = 6;
const BONE_R_SHOULDER = 7;
const BONE_R_ELBOW = 8;
const BONE_L_THIGH = 9;
const BONE_L_KNEE = 10;
const BONE_R_THIGH = 11;
const BONE_R_KNEE = 12;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0 || 1e-5), 0, 1);
  return t * t * (3 - 2 * t);
}

function deterministicNoise(seed: number): number {
  const x = Math.sin(seed * 78.233 + 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function appendGridIndices(
  indices: number[],
  baseVertex: number,
  rings: number,
  segments: number,
  topToBottom: boolean
) {
  for (let iy = 0; iy < rings; iy++) {
    for (let ix = 0; ix < segments; ix++) {
      const a = baseVertex + iy * (segments + 1) + ix;
      const b = a + 1;
      const c = a + segments + 1;
      const d = c + 1;
      if (topToBottom) {
        indices.push(a, b, c, b, d, c);
      } else {
        indices.push(a, c, b, b, c, d);
      }
    }
  }
}

function pushSkinWeights(
  skinIndices: number[],
  skinWeights: number[],
  b0: number,
  w0: number,
  b1 = 0,
  w1 = 0,
  b2 = 0,
  w2 = 0,
  b3 = 0,
  w3 = 0
) {
  const sum = w0 + w1 + w2 + w3 || 1;
  skinIndices.push(b0, b1, b2, b3);
  skinWeights.push(w0 / sum, w1 / sum, w2 / sum, w3 / sum);
}

function finalizeGeometry(
  positions: number[],
  uvs: number[],
  indices: number[],
  colors?: number[],
  skinIndices?: number[],
  skinWeights?: number[]
) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("uv2", new THREE.Float32BufferAttribute(uvs, 2));
  if (colors) {
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  }
  if (skinIndices && skinWeights) {
    geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(skinIndices, 4));
    geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(skinWeights, 4));
  }
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  try {
    geometry.computeTangents();
  } catch {
    // Fallback se tangentes não forem aplicáveis
  }
  geometry.computeBoundingSphere();
  return geometry;
}

function createProceduralPBRMaps() {
  const size = 1024;

  const skinAlbedoCanvas = document.createElement("canvas");
  skinAlbedoCanvas.width = skinAlbedoCanvas.height = size;
  const sCtx = skinAlbedoCanvas.getContext("2d")!;

  const skinRoughCanvas = document.createElement("canvas");
  skinRoughCanvas.width = skinRoughCanvas.height = size;
  const srCtx = skinRoughCanvas.getContext("2d")!;

  const skinBumpCanvas = document.createElement("canvas");
  skinBumpCanvas.width = skinBumpCanvas.height = size;
  const sbCtx = skinBumpCanvas.getContext("2d")!;

  sCtx.fillStyle = "#d99e82";
  sCtx.fillRect(0, 0, size, size);
  srCtx.fillStyle = "rgb(142, 142, 142)";
  srCtx.fillRect(0, 0, size, size);
  sbCtx.fillStyle = "rgb(128, 128, 128)";
  sbCtx.fillRect(0, 0, size, size);

  for (let i = 0; i < 420; i++) {
    const nx = deterministicNoise(i * 1.13) * size;
    const ny = deterministicNoise(i * 2.37) * size;
    const rad = 18 + deterministicNoise(i * 3.91) * 68;
    const warm = deterministicNoise(i * 5.17) > 0.45;
    const grad = sCtx.createRadialGradient(nx, ny, 2, nx, ny, rad);
    if (warm) {
      grad.addColorStop(0, "rgba(248, 194, 166, 0.09)");
      grad.addColorStop(1, "rgba(248, 194, 166, 0)");
    } else {
      grad.addColorStop(0, "rgba(155, 92, 72, 0.08)");
      grad.addColorStop(1, "rgba(155, 92, 72, 0)");
    }
    sCtx.fillStyle = grad;
    sCtx.fillRect(nx - rad, ny - rad, rad * 2, rad * 2);
  }

  sCtx.lineCap = "round";
  srCtx.lineCap = "round";
  sbCtx.lineCap = "round";
  for (let v = 0; v < 56; v++) {
    let vx = deterministicNoise(v * 11.7) * size;
    let vy = deterministicNoise(v * 17.3) * size;
    const isBlueVein = v % 2 === 0;
    sCtx.strokeStyle = isBlueVein ? "rgba(66, 86, 112, 0.16)" : "rgba(132, 48, 46, 0.14)";
    sCtx.lineWidth = 1.1 + deterministicNoise(v * 23.1) * 1.8;
    sbCtx.strokeStyle = "rgba(168, 168, 168, 0.25)";
    sbCtx.lineWidth = sCtx.lineWidth;

    sCtx.beginPath();
    sbCtx.beginPath();
    sCtx.moveTo(vx, vy);
    sbCtx.moveTo(vx, vy);
    for (let step = 0; step < 12; step++) {
      const ang = deterministicNoise(v * 31 + step * 7.1) * Math.PI * 2;
      vx += Math.cos(ang) * 22;
      vy += Math.sin(ang) * 22;
      sCtx.lineTo(vx, vy);
      sbCtx.lineTo(vx, vy);
    }
    sCtx.stroke();
    sbCtx.stroke();
  }

  for (let p = 0; p < 3600; p++) {
    const px = deterministicNoise(p * 41.3) * size;
    const py = deterministicNoise(p * 47.9) * size;
    const r = 0.7 + deterministicNoise(p * 53.2) * 1.3;
    sbCtx.fillStyle = p % 5 === 0 ? "rgba(185,185,185,0.22)" : "rgba(85,85,85,0.25)";
    sbCtx.beginPath();
    sbCtx.arc(px, py, r, 0, Math.PI * 2);
    sbCtx.fill();

    srCtx.fillStyle = p % 4 === 0 ? "rgba(95,95,95,0.18)" : "rgba(175,175,175,0.16)";
    srCtx.fillRect(px, py, r * 1.4, r * 1.4);
  }

  const skinMap = new THREE.CanvasTexture(skinAlbedoCanvas);
  skinMap.colorSpace = THREE.SRGBColorSpace;
  skinMap.wrapS = skinMap.wrapT = THREE.RepeatWrapping;

  const skinRoughnessMap = new THREE.CanvasTexture(skinRoughCanvas);
  skinRoughnessMap.wrapS = skinRoughnessMap.wrapT = THREE.RepeatWrapping;

  const skinBumpMap = new THREE.CanvasTexture(skinBumpCanvas);
  skinBumpMap.wrapS = skinBumpMap.wrapT = THREE.RepeatWrapping;

  const jeansCanvas = document.createElement("canvas");
  jeansCanvas.width = jeansCanvas.height = size;
  const jCtx = jeansCanvas.getContext("2d")!;

  const jeansBumpCanvas = document.createElement("canvas");
  jeansBumpCanvas.width = jeansBumpCanvas.height = size;
  const jbCtx = jeansBumpCanvas.getContext("2d")!;

  jCtx.fillStyle = "#2b4f96";
  jCtx.fillRect(0, 0, size, size);
  jbCtx.fillStyle = "rgb(128,128,128)";
  jbCtx.fillRect(0, 0, size, size);

  jCtx.lineWidth = 2;
  jbCtx.lineWidth = 2;
  for (let i = -size; i < size * 2; i += 6) {
    jCtx.strokeStyle = "rgba(18, 32, 66, 0.34)";
    jCtx.beginPath();
    jCtx.moveTo(i, 0);
    jCtx.lineTo(i + size, size);
    jCtx.stroke();

    jCtx.strokeStyle = "rgba(120, 155, 220, 0.14)";
    jCtx.beginPath();
    jCtx.moveTo(i + 3, 0);
    jCtx.lineTo(i + 3 + size, size);
    jCtx.stroke();

    jbCtx.strokeStyle = "rgba(175,175,175,0.35)";
    jbCtx.beginPath();
    jbCtx.moveTo(i, 0);
    jbCtx.lineTo(i + size, size);
    jbCtx.stroke();
  }

  for (let w = 0; w < 24; w++) {
    const wx = deterministicNoise(w * 19.3) * size;
    const wy = deterministicNoise(w * 29.7) * size;
    const wr = 55 + deterministicNoise(w * 37.1) * 110;
    const g = jCtx.createRadialGradient(wx, wy, 10, wx, wy, wr);
    g.addColorStop(0, "rgba(145, 180, 235, 0.16)");
    g.addColorStop(1, "rgba(43, 79, 150, 0)");
    jCtx.fillStyle = g;
    jCtx.fillRect(wx - wr, wy - wr, wr * 2, wr * 2);
  }

  const jeansMap = new THREE.CanvasTexture(jeansCanvas);
  jeansMap.colorSpace = THREE.SRGBColorSpace;
  jeansMap.wrapS = jeansMap.wrapT = THREE.RepeatWrapping;

  const jeansBumpMap = new THREE.CanvasTexture(jeansBumpCanvas);
  jeansBumpMap.wrapS = jeansBumpMap.wrapT = THREE.RepeatWrapping;

  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = maskCanvas.height = size;
  const mCtx = maskCanvas.getContext("2d")!;

  const maskBumpCanvas = document.createElement("canvas");
  maskBumpCanvas.width = maskBumpCanvas.height = size;
  const mbCtx = maskBumpCanvas.getContext("2d")!;
  const maskRoughCanvas = document.createElement("canvas");
  maskRoughCanvas.width = maskRoughCanvas.height = size;
  const mrCtx = maskRoughCanvas.getContext("2d")!;

  const maskMetalCanvas = document.createElement("canvas");
  maskMetalCanvas.width = maskMetalCanvas.height = size;
  const mmCtx = maskMetalCanvas.getContext("2d")!;

  // Aço forjado / cromo escovado escuro com reflexos metálicos nítidos
  const steelGradient = mCtx.createLinearGradient(0, 0, size, size);
  steelGradient.addColorStop(0, "#9ea8b4");
  steelGradient.addColorStop(0.28, "#e6edf4");
  steelGradient.addColorStop(0.55, "#8792a0");
  steelGradient.addColorStop(0.82, "#d8e2ec");
  steelGradient.addColorStop(1, "#a6b1be");
  mCtx.fillStyle = steelGradient;
  mCtx.fillRect(0, 0, size, size);
  mbCtx.fillStyle = "rgb(128,128,128)";
  mbCtx.fillRect(0, 0, size, size);
  mrCtx.fillStyle = "rgb(48,48,48)";
  mrCtx.fillRect(0, 0, size, size);
  mmCtx.fillStyle = "rgb(246,246,246)";
  mmCtx.fillRect(0, 0, size, size);

  // Escovado metálico fino horizontal/diagonal
  for (let s = 0; s < 900; s++) {
    const sy = deterministicNoise(s * 13.7) * size;
    const sx = deterministicNoise(s * 29.3) * size * 0.6;
    const len = 60 + deterministicNoise(s * 43.1) * 260;
    const bright = s % 2 === 0;
    mCtx.strokeStyle = bright ? "rgba(240,247,255,0.16)" : "rgba(42,50,62,0.18)";
    mCtx.lineWidth = 0.8 + deterministicNoise(s * 59.9) * 1.4;
    mCtx.beginPath();
    mCtx.moveTo(sx, sy);
    mCtx.lineTo(sx + len, sy + (deterministicNoise(s * 7.3) - 0.5) * 10);
    mCtx.stroke();

    mbCtx.strokeStyle = bright ? "rgba(168,168,168,0.28)" : "rgba(92,92,92,0.28)";
    mbCtx.lineWidth = mCtx.lineWidth;
    mbCtx.beginPath();
    mbCtx.moveTo(sx, sy);
    mbCtx.lineTo(sx + len, sy + (deterministicNoise(s * 7.3) - 0.5) * 10);
    mbCtx.stroke();

    mrCtx.strokeStyle = bright ? "rgba(32,32,32,0.34)" : "rgba(96,96,96,0.28)";
    mrCtx.lineWidth = 1.4;
    mrCtx.beginPath();
    mrCtx.moveTo(sx, sy);
    mrCtx.lineTo(sx + len, sy + (deterministicNoise(s * 7.3) - 0.5) * 10);
    mrCtx.stroke();
  }

  // Micro-oxidação e pequenas marcas metálicas
  for (let b = 0; b < 700; b++) {
    const bx = deterministicNoise(b * 61.1) * size;
    const by = deterministicNoise(b * 67.7) * size;
    const br = 1.5 + deterministicNoise(b * 71.9) * 14;
    const tarnish = b % 3 === 0;
    mCtx.fillStyle = tarnish ? "rgba(45,52,64,0.14)" : "rgba(232,240,250,0.14)";
    mCtx.beginPath();
    mCtx.arc(bx, by, br, 0, Math.PI * 2);
    mCtx.fill();

    mrCtx.fillStyle = tarnish ? "rgba(105,105,105,0.28)" : "rgba(36,36,36,0.24)";
    mrCtx.beginPath();
    mrCtx.arc(bx, by, br * 0.72, 0, Math.PI * 2);
    mrCtx.fill();

    if (tarnish) {
      mmCtx.fillStyle = "rgba(195,195,195,0.25)";
      mmCtx.beginPath();
      mmCtx.arc(bx, by, br * 0.65, 0, Math.PI * 2);
      mmCtx.fill();
    }
  }

  // Riscos metálicos profundos com borda especular
  for (let crack = 0; crack < 38; crack++) {
    let x = deterministicNoise(crack * 83.1) * size;
    let y = deterministicNoise(crack * 89.7) * size;
    mCtx.strokeStyle = "rgba(54,62,74,0.38)";
    mCtx.lineWidth = 0.9 + deterministicNoise(crack * 97.3) * 1.8;
    mbCtx.strokeStyle = "rgba(56,56,56,0.62)";
    mbCtx.lineWidth = mCtx.lineWidth * 1.6;
    mrCtx.strokeStyle = "rgba(128,128,128,0.4)";
    mrCtx.lineWidth = 1.6;
    mCtx.beginPath(); mbCtx.beginPath(); mrCtx.beginPath();
    mCtx.moveTo(x,y); mbCtx.moveTo(x,y); mrCtx.moveTo(x,y);
    for(let step=0;step<6;step++){
      x += (deterministicNoise(crack*101+step*3)-0.5)*size*0.032;
      y += (deterministicNoise(crack*107+step*5)-0.5)*size*0.032;
      mCtx.lineTo(x,y); mbCtx.lineTo(x,y); mrCtx.lineTo(x,y);
    }
    mCtx.stroke(); mbCtx.stroke(); mrCtx.stroke();
  }

  const maskMap = new THREE.CanvasTexture(maskCanvas);
  maskMap.colorSpace = THREE.SRGBColorSpace;
  maskMap.wrapS = maskMap.wrapT = THREE.RepeatWrapping;

  const maskBumpMap = new THREE.CanvasTexture(maskBumpCanvas);
  maskBumpMap.wrapS = maskBumpMap.wrapT = THREE.RepeatWrapping;
  const maskRoughnessMap = new THREE.CanvasTexture(maskRoughCanvas);
  maskRoughnessMap.wrapS = maskRoughnessMap.wrapT = THREE.RepeatWrapping;
  const maskMetalnessMap = new THREE.CanvasTexture(maskMetalCanvas);
  maskMetalnessMap.wrapS = maskMetalnessMap.wrapT = THREE.RepeatWrapping;

  // Mapa equiretangular procedural de reflexão para o aço da máscara brilhar nas Fases 1 e 2
  const envCanvas = document.createElement("canvas");
  envCanvas.width = 512;
  envCanvas.height = 256;
  const eCtx = envCanvas.getContext("2d")!;
  const envSky = eCtx.createLinearGradient(0, 0, 0, envCanvas.height);
  envSky.addColorStop(0, "#cfdcf0");
  envSky.addColorStop(0.28, "#7286a3");
  envSky.addColorStop(0.5, "#232a36");
  envSky.addColorStop(0.68, "#4b231d");
  envSky.addColorStop(1, "#120e10");
  eCtx.fillStyle = envSky;
  eCtx.fillRect(0, 0, envCanvas.width, envCanvas.height);

  // Luzes de estúdio + luar + clarões quentes para reflexos metálicos nítidos
  const highlights: Array<[number, number, number, string]> = [
    [96, 46, 56, "rgba(255,255,255,0.95)"],
    [256, 38, 72, "rgba(225,238,255,0.92)"],
    [418, 54, 52, "rgba(255,244,230,0.88)"],
    [170, 128, 42, "rgba(255,140,90,0.58)"],
    [355, 134, 46, "rgba(185,215,255,0.68)"],
    [260, 185, 38, "rgba(165,58,42,0.52)"],
  ];
  for (const [hx, hy, hr, col] of highlights) {
    const hg = eCtx.createRadialGradient(hx, hy, 2, hx, hy, hr);
    hg.addColorStop(0, col);
    hg.addColorStop(1, "rgba(0,0,0,0)");
    eCtx.fillStyle = hg;
    eCtx.fillRect(hx - hr, hy - hr, hr * 2, hr * 2);
  }
  eCtx.fillStyle = "rgba(255,255,255,0.75)";
  eCtx.fillRect(68, 74, 96, 12);
  eCtx.fillRect(320, 62, 118, 10);

  const maskEnvMap = new THREE.CanvasTexture(envCanvas);
  maskEnvMap.colorSpace = THREE.SRGBColorSpace;
  maskEnvMap.mapping = THREE.EquirectangularReflectionMapping;
  maskEnvMap.needsUpdate = true;

  const toonCanvas = document.createElement("canvas");
  toonCanvas.width = 4;
  toonCanvas.height = 1;
  const tCtx = toonCanvas.getContext("2d")!;
  tCtx.fillStyle = "#6b6b72";
  tCtx.fillRect(0, 0, 1, 1);
  tCtx.fillStyle = "#a6a6ae";
  tCtx.fillRect(1, 0, 1, 1);
  tCtx.fillStyle = "#dcdce2";
  tCtx.fillRect(2, 0, 1, 1);
  tCtx.fillStyle = "#ffffff";
  tCtx.fillRect(3, 0, 1, 1);
  const gradientMap = new THREE.CanvasTexture(toonCanvas);
  gradientMap.minFilter = THREE.NearestFilter;
  gradientMap.magFilter = THREE.NearestFilter;

  return {
    skinMap,
    skinRoughnessMap,
    skinBumpMap,
    jeansMap,
    jeansBumpMap,
    maskMap,
    maskBumpMap,
    maskRoughnessMap,
    maskMetalnessMap,
    maskEnvMap,
    gradientMap,
  };
}

function createUpperBodySkinnedGeometry() {
  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const skinIndices: number[] = [];
  const skinWeights: number[] = [];

  const morphBreath: number[] = [];
  const morphFlexLeft: number[] = [];
  const morphFlexRight: number[] = [];

  const torsoProfile: Array<[number, number, number]> = [
    [-0.09, 0.235, 0.155],
    [-0.02, 0.275, 0.182],
    [0.08, 0.295, 0.198],
    [0.24, 0.34, 0.22],
    [0.44, 0.41, 0.244],
    [0.59, 0.44, 0.252],
    [0.72, 0.41, 0.23],
    [0.83, 0.3, 0.19],
    [0.94, 0.21, 0.166],
    [1.03, 0.165, 0.148],
  ];

  const torsoRings = 84;
  const torsoSegs = 104;
  const torsoBase = 0;

  for (let iy = 0; iy <= torsoRings; iy++) {
    const v = iy / torsoRings;
    const yLocal = THREE.MathUtils.lerp(
      torsoProfile[0][0],
      torsoProfile[torsoProfile.length - 1][0],
      v
    );
    const yRoot = 1.05 + yLocal;
    let k = 0;
    while (k < torsoProfile.length - 2 && yLocal > torsoProfile[k + 1][0]) k++;
    const a = torsoProfile[k];
    const b = torsoProfile[k + 1];
    const f0 = THREE.MathUtils.clamp((yLocal - a[0]) / (b[0] - a[0]), 0, 1);
    const f = smoothstep(0, 1, f0);
    const rx = THREE.MathUtils.lerp(a[1], b[1], f);
    const rz = THREE.MathUtils.lerp(a[2], b[2], f);

    for (let ix = 0; ix <= torsoSegs; ix++) {
      const u = ix / torsoSegs;
      const angle = u * Math.PI * 2;
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);
      const front = Math.max(0, -sinA);
      const back = Math.max(0, sinA);

      const pecBand = Math.exp(-Math.pow((yLocal - 0.57) / 0.14, 2));
      const sternumGroove = Math.exp(-Math.pow(cosA / 0.16, 2)) * front * pecBand;
      const pecMass =
        pecBand *
        Math.pow(Math.abs(cosA), 0.7) *
        (1 - Math.exp(-Math.pow(cosA / 0.22, 2))) *
        front;
      const pecLowerEdge =
        Math.exp(-Math.pow((yLocal - 0.435) / 0.032, 2)) *
        front *
        Math.pow(Math.abs(cosA), 0.8);

      const absCol = Math.exp(-Math.pow((Math.abs(cosA) - 0.24) / 0.15, 2)) * front;
      const absRow =
        Math.exp(-Math.pow((yLocal - 0.31) / 0.055, 2)) +
        Math.exp(-Math.pow((yLocal - 0.19) / 0.055, 2)) +
        Math.exp(-Math.pow((yLocal - 0.06) / 0.065, 2));
      const lineaAlba =
        Math.exp(-Math.pow(cosA / 0.09, 2)) *
        front *
        Math.exp(-Math.pow((yLocal - 0.18) / 0.22, 2));
      const oblique =
        Math.exp(-Math.pow((yLocal - 0.14) / 0.14, 2)) *
        Math.pow(Math.abs(cosA), 2.4) *
        (0.65 + 0.35 * front);
      const serratus =
        Math.exp(-Math.pow((yLocal - 0.38) / 0.11, 2)) *
        Math.exp(-Math.pow((Math.abs(cosA) - 0.78) / 0.22, 2)) *
        (0.5 + 0.5 * Math.sin(yLocal * 95)) *
        front;

      const lats =
        Math.exp(-Math.pow((yLocal - 0.48) / 0.18, 2)) *
        Math.pow(Math.abs(cosA), 1.4) *
        back;
      const spineFurrow =
        Math.exp(-Math.pow(cosA / 0.15, 2)) *
        back *
        smoothstep(-0.15, 0.72, yLocal) *
        (1 - smoothstep(0.72, 0.92, yLocal));

      const clavicle =
        Math.exp(-Math.pow((yLocal - 0.76) / 0.035, 2)) *
        front *
        (0.25 + 0.75 * Math.abs(cosA));
      const neckCords =
        Math.exp(-Math.pow((yLocal - 0.91) / 0.09, 2)) *
        Math.exp(-Math.pow((Math.abs(cosA) - 0.38) / 0.18, 2)) *
        front;

      const xMod = rx + lats * 0.022 + oblique * 0.015 + pecMass * 0.014 + serratus * 0.006;
      const zMod =
        rz +
        front *
          (pecMass * 0.028 -
            pecLowerEdge * 0.008 -
            sternumGroove * 0.018 +
            absCol * absRow * 0.014 -
            lineaAlba * 0.009 +
            clavicle * 0.008 +
            neckCords * 0.007 +
            serratus * 0.005) +
        back * (lats * 0.016 - spineFurrow * 0.018);

      const x = cosA * xMod;
      const z = sinA * zMod;
      positions.push(x, yRoot, z);
      uvs.push(u * 2.2, v * 2.2);

      const cavity =
        sternumGroove * 0.18 +
        lineaAlba * 0.14 +
        spineFurrow * 0.20 +
        pecLowerEdge * 0.12 +
        Math.max(0, 0.45 - Math.abs(yLocal - 0.56)) * Math.pow(Math.abs(cosA), 4) * 0.18;
      let rCol = 1.0 - cavity * 0.55;
      let gCol = 0.97 - cavity * 0.78;
      let bCol = 0.95 - cavity * 0.85;

      const smear1 =
        Math.exp(-(Math.pow((x + 0.25) / 0.11, 2) + Math.pow((yLocal - 0.65) / 0.055, 2))) * front;
      const smear2 =
        Math.exp(-(Math.pow((x - 0.21) / 0.12, 2) + Math.pow((yLocal - 0.40) / 0.048, 2))) * front;
      const smear3 =
        Math.exp(-(Math.pow((x + 0.08) / 0.08, 2) + Math.pow((yLocal - 0.07) / 0.045, 2))) * front;
      const streak =
        Math.exp(-(Math.pow((x + 0.30) / 0.035, 2) + Math.pow((yLocal - 0.55) / 0.11, 2))) * front;
      const bloodAmt = Math.min(1, smear1 * 1.15 + smear2 * 1.05 + smear3 * 0.9 + streak * 1.1);
      if (bloodAmt > 0.04) {
        const bBlend = smoothstep(0.08, 0.55, bloodAmt);
        rCol = THREE.MathUtils.lerp(rCol, 0.42, bBlend);
        gCol = THREE.MathUtils.lerp(gCol, 0.045, bBlend);
        bCol = THREE.MathUtils.lerp(bCol, 0.065, bBlend);
      }
      colors.push(rCol, gCol, bCol);

      let b0 = BONE_CHEST,
        w0 = 1;
      let b1 = BONE_SPINE,
        w1 = 0;
      let b2 = BONE_HIPS,
        w2 = 0;
      let b3 = BONE_HEAD,
        w3 = 0;

      if (yLocal < 0.05) {
        const t = smoothstep(-0.09, 0.05, yLocal);
        b0 = BONE_HIPS;
        w0 = 1 - t * 0.72;
        b1 = BONE_SPINE;
        w1 = t * 0.72;
      } else if (yLocal < 0.44) {
        const t = smoothstep(0.05, 0.44, yLocal);
        b0 = BONE_SPINE;
        w0 = (1 - t) * 0.75 + 0.12;
        b1 = BONE_CHEST;
        w1 = t * 0.88;
      } else if (yLocal < 0.79) {
        const latFactor =
          smoothstep(0.28, 0.44, Math.abs(x)) * Math.exp(-Math.pow((yLocal - 0.59) / 0.15, 2));
        const armBone = x < 0 ? BONE_L_SHOULDER : BONE_R_SHOULDER;
        b0 = BONE_CHEST;
        w0 = 1 - latFactor * 0.24;
        b1 = armBone;
        w1 = latFactor * 0.24;
      } else if (yLocal < 0.93) {
        const t = smoothstep(0.79, 0.93, yLocal);
        b0 = BONE_CHEST;
        w0 = 1 - t;
        b1 = BONE_NECK;
        w1 = t;
      } else {
        const t = smoothstep(0.93, 1.03, yLocal);
        b0 = BONE_NECK;
        w0 = 1 - t;
        b1 = BONE_HEAD;
        w1 = t;
      }
      pushSkinWeights(skinIndices, skinWeights, b0, w0, b1, w1, b2, w2, b3, w3);

      const breathBand = Math.exp(-Math.pow((yLocal - 0.52) / 0.24, 2));
      morphBreath.push(
        cosA * breathBand * 0.011,
        breathBand * 0.008,
        sinA * breathBand * (front > 0 ? 0.015 : 0.008)
      );

      const pecLeftZone = x < -0.02 ? smoothstep(-0.02, -0.25, x) * pecBand * front : 0;
      const pecRightZone = x > 0.02 ? smoothstep(0.02, 0.25, x) * pecBand * front : 0;
      morphFlexLeft.push(-pecLeftZone * 0.006, pecLeftZone * 0.004, -pecLeftZone * 0.018);
      morphFlexRight.push(pecRightZone * 0.006, pecRightZone * 0.004, -pecRightZone * 0.018);
    }
  }
  appendGridIndices(indices, torsoBase, torsoRings, torsoSegs, false);

  const armRings = 54;
  const armSegs = 44;

  for (const side of [-1, 1] as const) {
    const armBase = positions.length / 3;
    const armBone = side === -1 ? BONE_L_SHOULDER : BONE_R_SHOULDER;
    const elbowBone = side === -1 ? BONE_L_ELBOW : BONE_R_ELBOW;

    for (let iy = 0; iy <= armRings; iy++) {
      const t = iy / armRings;

      let cx: number;
      if (t < 0.26) {
        cx = side * THREE.MathUtils.lerp(0.27, 0.455, smoothstep(0, 0.26, t));
      } else if (t < 0.5) {
        cx = side * THREE.MathUtils.lerp(0.455, 0.495, smoothstep(0.26, 0.5, t));
      } else {
        cx = side * THREE.MathUtils.lerp(0.495, 0.55, smoothstep(0.5, 1.0, t));
      }

      const cy = THREE.MathUtils.lerp(1.66, 1.11, t) + Math.sin(t * Math.PI) * 0.01;
      const cz = THREE.MathUtils.lerp(0.005, -0.015, smoothstep(0.18, 1.0, t));

      const endPinch = t < 0.14 ? smoothstep(0, 0.14, t) * 0.24 + 0.76 : 1.0;

      const baseR = THREE.MathUtils.lerp(0.13, 0.12, smoothstep(0.15, 1.0, t));

      const deltoidCap = Math.exp(-Math.pow((t - 0.2) / 0.135, 2));
      const deltoidDip = Math.exp(-Math.pow((t - 0.37) / 0.075, 2));
      const bicepBell = Math.exp(-Math.pow((t - 0.58) / 0.15, 2));
      const tricepBell = Math.exp(-Math.pow((t - 0.5) / 0.14, 2));
      const elbowCondyle = Math.exp(-Math.pow((t - 0.9) / 0.08, 2));

      for (let ix = 0; ix <= armSegs; ix++) {
        const u = ix / armSegs;
        const angle = u * Math.PI * 2;
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);
        const out = cosA * side;
        const front = -sinA;

        const deltSculpt =
          deltoidCap * (0.022 * Math.max(0, out + 0.28) + 0.012 * Math.max(0, front + 0.2));
        const insertionGroove = deltoidDip * (0.011 * Math.max(0, out + 0.2) + 0.005);
        const bicepSculpt =
          bicepBell * (0.028 * Math.pow(Math.max(0, front), 1.25) + 0.008 * Math.max(0, out));
        const tricepSculpt =
          tricepBell *
          (0.024 * Math.pow(Math.max(0, -front), 1.2) * (0.7 + 0.3 * Math.abs(out)));
        const lateralGroove =
          Math.exp(-Math.pow(front / 0.32, 2)) *
          Math.max(0, out) *
          Math.exp(-Math.pow((t - 0.54) / 0.17, 2)) *
          0.006;
        const medialFlatten = Math.max(0, -out) * 0.012 * (1 - smoothstep(0.55, 0.85, t));
        const condyleFlare =
          elbowCondyle * Math.abs(cosA) * 0.004 * (1 - smoothstep(0.92, 1.0, t));

        const r =
          (baseR +
            deltSculpt -
            insertionGroove +
            bicepSculpt +
            tricepSculpt -
            lateralGroove -
            medialFlatten +
            condyleFlare) *
          endPinch;

        const px = cx + cosA * r;
        const pz =
          cz + sinA * (r * (0.98 + 0.05 * bicepBell * (1 - smoothstep(0.75, 1.0, t))));

        positions.push(px, cy, pz);
        uvs.push(u * 1.4, t * 1.8);

        const grooveAO =
          deltoidDip * Math.max(0, out + 0.2) * 0.18 +
          lateralGroove * 9.0 +
          Math.max(0, -out) * 0.14;
        let rCol = 1.0 - grooveAO * 0.52;
        let gCol = 0.97 - grooveAO * 0.72;
        let bCol = 0.95 - grooveAO * 0.78;

        const armBlood =
          side === -1
            ? Math.exp(-(Math.pow((t - 0.19) / 0.11, 2) + Math.pow((front - 0.75) / 0.42, 2))) +
              Math.exp(-(Math.pow((t - 0.44) / 0.09, 2) + Math.pow((front - 0.65) / 0.35, 2))) *
                0.85
            : Math.exp(-(Math.pow((t - 0.16) / 0.09, 2) + Math.pow((front - 0.72) / 0.38, 2))) +
              Math.exp(-(Math.pow((t - 0.32) / 0.1, 2) + Math.pow((out - 0.55) / 0.45, 2))) *
                0.8;
        if (armBlood > 0.08) {
          const bBlend = smoothstep(0.12, 0.6, armBlood);
          rCol = THREE.MathUtils.lerp(rCol, 0.41, bBlend);
          gCol = THREE.MathUtils.lerp(gCol, 0.045, bBlend);
          bCol = THREE.MathUtils.lerp(bCol, 0.06, bBlend);
        }
        colors.push(rCol, gCol, bCol);

        let b0 = armBone,
          w0 = 1;
        let b1 = BONE_CHEST,
          w1 = 0;
        if (t < 0.38) {
          const blend = smoothstep(0.0, 0.38, t);
          b0 = BONE_CHEST;
          w0 = (1 - blend) * 0.88;
          b1 = armBone;
          w1 = 1 - w0;
        } else if (t > 0.72) {
          const blend = smoothstep(0.72, 1.0, t);
          b0 = armBone;
          w0 = 1 - blend * 0.92;
          b1 = elbowBone;
          w1 = blend * 0.92;
        }
        pushSkinWeights(skinIndices, skinWeights, b0, w0, b1, w1);

        const shLift = Math.max(0, 1 - t * 3.5);
        morphBreath.push(side * shLift * 0.004, shLift * 0.007, 0);

        const flexMag =
          deltoidCap * 0.015 * Math.max(0, out + 0.3) +
          bicepBell * 0.025 * Math.pow(Math.max(0, front), 1.1) +
          tricepBell * 0.014 * Math.pow(Math.max(0, -front), 1.1);
        const dx = cosA * flexMag;
        const dy = bicepBell * Math.max(0, front) * 0.008 + deltoidCap * 0.006;
        const dz = sinA * flexMag;

        if (side === -1) {
          morphFlexLeft.push(dx, dy, dz);
          morphFlexRight.push(0, 0, 0);
        } else {
          morphFlexLeft.push(0, 0, 0);
          morphFlexRight.push(dx, dy, dz);
        }
      }
    }
    appendGridIndices(indices, armBase, armRings, armSegs, true);
  }

  const geometry = finalizeGeometry(positions, uvs, indices, colors, skinIndices, skinWeights);
  geometry.morphTargetsRelative = true;
  geometry.morphAttributes.position = [
    new THREE.Float32BufferAttribute(morphBreath, 3),
    new THREE.Float32BufferAttribute(morphFlexLeft, 3),
    new THREE.Float32BufferAttribute(morphFlexRight, 3),
  ];
  return geometry;
}

function createTrousersSkinnedGeometry() {
  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const skinIndices: number[] = [];
  const skinWeights: number[] = [];
  const morphLegStrain: number[] = [];

  const pelvisProfile: Array<[number, number, number]> = [
    [0.78, 0.255, 0.175],
    [0.85, 0.31, 0.215],
    [0.92, 0.325, 0.228],
    [1.0, 0.3, 0.214],
    [1.07, 0.282, 0.202],
  ];
  const pRings = 24;
  const pSegs = 52;
  const pBase = 0;

  for (let iy = 0; iy <= pRings; iy++) {
    const v = iy / pRings;
    const yRoot = THREE.MathUtils.lerp(0.78, 1.07, v);
    let k = 0;
    while (k < pelvisProfile.length - 2 && yRoot > pelvisProfile[k + 1][0]) k++;
    const a = pelvisProfile[k];
    const b = pelvisProfile[k + 1];
    const f0 = THREE.MathUtils.clamp((yRoot - a[0]) / (b[0] - a[0]), 0, 1);
    const f = smoothstep(0, 1, f0);
    const rx = THREE.MathUtils.lerp(a[1], b[1], f);
    const rz = THREE.MathUtils.lerp(a[2], b[2], f);

    for (let ix = 0; ix <= pSegs; ix++) {
      const u = ix / pSegs;
      const angle = u * Math.PI * 2;
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);
      const back = Math.max(0, sinA);
      const glute =
        Math.exp(-Math.pow((yRoot - 0.88) / 0.08, 2)) *
        back *
        (1 - Math.exp(-Math.pow(cosA / 0.18, 2)));
      const x = cosA * rx;
      const z = sinA * (rz + glute * 0.022);
      positions.push(x, yRoot, z);
      uvs.push(u * 2, v * 0.8);

      const creaseAO = Math.exp(-Math.pow(cosA / 0.14, 2)) * back * 0.14 + (1 - v) * 0.12;
      colors.push(0.95 - creaseAO, 0.96 - creaseAO, 1.0 - creaseAO * 0.6);

      const lowerHip = (1 - smoothstep(0.8, 0.94, yRoot)) * smoothstep(0.08, 0.25, Math.abs(x));
      const thighBone = x < 0 ? BONE_L_THIGH : BONE_R_THIGH;
      pushSkinWeights(
        skinIndices,
        skinWeights,
        BONE_HIPS,
        1 - lowerHip * 0.35,
        thighBone,
        lowerHip * 0.35
      );
      morphLegStrain.push(0, 0, 0);
    }
  }
  appendGridIndices(indices, pBase, pRings, pSegs, false);

  const legRings = 48;
  const legSegs = 40;
  for (const side of [-1, 1] as const) {
    const legBase = positions.length / 3;
    const thighBone = side === -1 ? BONE_L_THIGH : BONE_R_THIGH;
    const kneeBone = side === -1 ? BONE_L_KNEE : BONE_R_KNEE;

    for (let iy = 0; iy <= legRings; iy++) {
      const t = iy / legRings;
      const yRoot = THREE.MathUtils.lerp(0.95, 0.14, t);
      const cx = side * THREE.MathUtils.lerp(0.162, 0.18, smoothstep(0, 0.45, t));
      const cz = Math.sin(t * Math.PI) * -0.012;

      const quad = Math.exp(-Math.pow((t - 0.26) / 0.18, 2));
      const kneePinch = Math.exp(-Math.pow((t - 0.58) / 0.08, 2));
      const calf = Math.exp(-Math.pow((t - 0.77) / 0.12, 2));
      const cuffFlare = smoothstep(0.9, 1.0, t);

      const baseR = THREE.MathUtils.lerp(0.168, 0.124, smoothstep(0.1, 0.95, t));
      const rx = baseR + quad * 0.022 - kneePinch * 0.012 + calf * 0.009 + cuffFlare * 0.012;
      const rz = baseR * 1.08 + quad * 0.028 - kneePinch * 0.008 + calf * 0.014 + cuffFlare * 0.014;

      for (let ix = 0; ix <= legSegs; ix++) {
        const u = ix / legSegs;
        const angle = u * Math.PI * 2;
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);
        const front = Math.max(0, -sinA);
        const back = Math.max(0, sinA);

        const shredWave =
          smoothstep(0.84, 1.0, t) *
          (Math.sin(angle * 7 + side * 1.4) * 0.018 + Math.cos(angle * 13) * 0.01);
        const yShred = yRoot - shredWave * 0.45;

        const foldRipple =
          Math.sin(t * 28 + cosA * 2.5) * 0.004 * (0.35 + 0.65 * kneePinch) +
          quad * front * 0.014 +
          calf * back * 0.014;
        const px = cx + cosA * (rx + foldRipple * 0.5 + shredWave * 0.25);
        const pz = cz + sinA * (rz + foldRipple);

        positions.push(px, yShred, pz);
        uvs.push(u * 1.5, t * 2.2);

        const fade = quad * front * 0.18 + kneePinch * front * 0.16;
        let rCol = 0.88 + fade;
        let gCol = 0.9 + fade;
        let bCol = 0.96 + fade * 0.7;

        const mudBlood = smoothstep(0.84, 1.0, t) * (0.45 + 0.35 * Math.sin(angle * 3 + side));
        if (mudBlood > 0.1) {
          rCol = THREE.MathUtils.lerp(rCol, 0.38, mudBlood * 0.55);
          gCol = THREE.MathUtils.lerp(gCol, 0.12, mudBlood * 0.65);
          bCol = THREE.MathUtils.lerp(bCol, 0.14, mudBlood * 0.65);
        }
        colors.push(rCol, gCol, bCol);

        let b0 = thighBone,
          w0 = 1;
        let b1 = BONE_HIPS,
          w1 = 0;
        if (yRoot > 0.75) {
          const blend = smoothstep(0.95, 0.75, yRoot);
          b0 = BONE_HIPS;
          w0 = (1 - blend) * 0.92;
          b1 = thighBone;
          w1 = 1 - w0;
        } else if (yRoot < 0.56) {
          const blend = smoothstep(0.56, 0.4, yRoot);
          b0 = thighBone;
          w0 = 1 - blend;
          b1 = kneeBone;
          w1 = blend;
        }
        pushSkinWeights(skinIndices, skinWeights, b0, w0, b1, w1);

        const strain = quad * 0.012 + calf * 0.01;
        morphLegStrain.push(cosA * strain, 0, sinA * strain);
      }
    }
    appendGridIndices(indices, legBase, legRings, legSegs, true);
  }

  const geometry = finalizeGeometry(positions, uvs, indices, colors, skinIndices, skinWeights);
  geometry.morphTargetsRelative = true;
  geometry.morphAttributes.position = [new THREE.Float32BufferAttribute(morphLegStrain, 3)];
  return geometry;
}

function createTerrorMaskGeometry() {
  const rings = 38;
  const segs = 32;
  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  for (let iy = 0; iy <= rings; iy++) {
    const v = iy / rings;
    const y = THREE.MathUtils.lerp(-0.24, 0.21, v);
    const vNorm = THREE.MathUtils.clamp((y + 0.24) / 0.45, 0, 1);

    // Front-only contoured horror mask leaving cranium and nuca completely open
    const jawTaper = smoothstep(0.0, 0.48, vNorm);
    const domeTaper = Math.sin(Math.pow(vNorm, 0.82) * Math.PI);
    const rx = THREE.MathUtils.lerp(0.18, 0.282, jawTaper) * (0.76 + 0.24 * domeTaper);
    const rz = THREE.MathUtils.lerp(0.18, 0.268, jawTaper) * (0.75 + 0.25 * domeTaper);

    for (let ix = 0; ix <= segs; ix++) {
      const u = ix / segs;
      const angle = THREE.MathUtils.lerp(-Math.PI * 0.88, -Math.PI * 0.12, u);
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);
      const front = Math.max(0, -sinA);
      const edgeRim =
        smoothstep(0.0, 0.14, Math.sin(u * Math.PI)) *
        smoothstep(0.0, 0.12, Math.sin(vNorm * Math.PI));

      const xBase = cosA * rx * (0.94 + 0.06 * edgeRim);
      const brow =
        Math.exp(-Math.pow((y - 0.11) / 0.04, 2)) *
        (1 - smoothstep(0.13, 0.24, Math.abs(xBase))) *
        front;
      const cheek =
        Math.exp(-Math.pow((y + 0.01) / 0.048, 2)) *
        Math.exp(-Math.pow((Math.abs(xBase) - 0.155) / 0.055, 2)) *
        front;
      const eyeSocket =
        Math.exp(-Math.pow((y - 0.055) / 0.044, 2)) *
        Math.exp(-Math.pow((Math.abs(xBase) - 0.105) / 0.052, 2)) *
        front;
      const noseSocket =
        Math.exp(-Math.pow((y + 0.045) / 0.048, 2)) *
        Math.exp(-Math.pow(xBase / 0.038, 2)) *
        front;
      const mouthSlot =
        Math.exp(-Math.pow((y + 0.155) / 0.04, 2)) *
        Math.exp(-Math.pow(xBase / 0.12, 2)) *
        front;
      const teethRidge =
        Math.exp(-Math.pow((y + 0.155) / 0.022, 2)) *
        (0.5 + 0.5 * Math.cos(xBase * 54)) *
        (1 - smoothstep(0.09, 0.13, Math.abs(xBase))) *
        front;

      const zOffset = -0.035 * edgeRim;
      const relief =
        brow * 0.026 +
        cheek * 0.022 -
        eyeSocket * 0.062 -
        noseSocket * 0.048 -
        mouthSlot * 0.045 +
        teethRidge * 0.022;
      const z = sinA * rz + zOffset - relief * front;

      positions.push(xBase, y, z);
      uvs.push(u, v);

      const darkCav = Math.min(
        1,
        eyeSocket * 1.55 + noseSocket * 1.45 + mouthSlot * 1.3 * (1 - teethRidge * 0.75)
      );
      let rC = 0.92 - darkCav * 0.85;
      let gC = 0.95 - darkCav * 0.88;
      let bC = 0.99 - darkCav * 0.9;
      const jawBlood =
        Math.exp(-(Math.pow((xBase + 0.1) / 0.075, 2) + Math.pow((y + 0.15) / 0.06, 2))) *
        front *
        (1 - darkCav * 0.5);
      if (jawBlood > 0.12) {
        rC = THREE.MathUtils.lerp(rC, 0.45, jawBlood * 0.8);
        gC = THREE.MathUtils.lerp(gC, 0.05, jawBlood * 0.85);
        bC = THREE.MathUtils.lerp(bC, 0.07, jawBlood * 0.85);
      }
      colors.push(rC, gC, bC);
    }
  }
  appendGridIndices(indices, 0, rings, segs, false);
  return finalizeGeometry(positions, uvs, indices, colors);
}

function createCombatBootGeometry() {
  const rings = 28;
  const segs = 32;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let iy = 0; iy <= rings; iy++) {
    const v = iy / rings;
    const y = THREE.MathUtils.lerp(-0.46, -0.22, v);
    const footMix = 1 - smoothstep(-0.44, -0.33, y);
    const rx = THREE.MathUtils.lerp(0.128, 0.145, footMix) * (v < 0.06 ? 0.85 + v * 2.5 : 1);
    const rz = THREE.MathUtils.lerp(0.132, 0.235, footMix);
    const zShift = -0.085 * footMix;

    for (let ix = 0; ix <= segs; ix++) {
      const u = ix / segs;
      const angle = u * Math.PI * 2;
      const x = Math.cos(angle) * rx;
      const z = zShift + Math.sin(angle) * rz;
      positions.push(x, y, z);
      uvs.push(u, v);
    }
  }
  appendGridIndices(indices, 0, rings, segs, false);
  return finalizeGeometry(positions, uvs, indices);
}

function ellipsoid(
  geometry: THREE.SphereGeometry,
  material: THREE.Material,
  position: [number, number, number],
  scale: [number, number, number]
) {
  return (
    <mesh
      geometry={geometry}
      material={material}
      position={position}
      scale={scale}
      castShadow
      receiveShadow
    />
  );
}

function HeldWeaponMesh({
  id,
  muzzleRef,
}: {
  id: RickWeaponId;
  muzzleRef: React.RefObject<THREE.Group | null>;
}) {
  if (id === "sickle") {
    return (
      <group position={[0, 0, -0.28]} rotation={[0, 0, -0.12]}>
        <mesh position={[0, 0, 0.22]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[0.035, 0.035, 0.52, 10]} />
          <meshStandardMaterial color="#513020" roughness={0.86} />
        </mesh>
        <mesh position={[0, 0.02, -0.18]} rotation={[0, 0, -0.42]} castShadow>
          <torusGeometry args={[0.34, 0.035, 10, 28, Math.PI * 0.82]} />
          <meshStandardMaterial color="#c7ccd0" metalness={0.92} roughness={0.2} />
        </mesh>
        <mesh position={[-0.13, 0.13, -0.18]} rotation={[0, 0, -0.42]} castShadow>
          <coneGeometry args={[0.055, 0.22, 10]} />
          <meshStandardMaterial color="#dce0df" metalness={0.9} roughness={0.18} />
        </mesh>
      </group>
    );
  }
  if (id === "pipe") {
    return (
      <group position={[0, 0, -0.35]}>
        <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[0.055, 0.055, 1.35, 14]} />
          <meshStandardMaterial color="#8d9290" metalness={0.82} roughness={0.26} />
        </mesh>
        <mesh position={[0, 0, 0.38]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.068, 0.068, 0.34, 12]} />
          <meshStandardMaterial color="#42261a" roughness={0.85} />
        </mesh>
      </group>
    );
  }
  if (id === "machete") {
    return (
      <group position={[0, 0, -0.28]}>
        <mesh position={[0, 0.02, -0.26]} castShadow>
          <boxGeometry args={[0.045, 0.12, 0.92]} />
          <meshStandardMaterial color="#caccc4" metalness={0.85} roughness={0.18} />
        </mesh>
        <mesh position={[0, 0, 0.28]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.055, 0.055, 0.34, 12]} />
          <meshStandardMaterial color="#513020" roughness={0.85} />
        </mesh>
      </group>
    );
  }
  return (
    <group position={[0, -0.24, -0.04]} rotation={[-Math.PI / 2, 0, 0]}>
      <mesh position={[0, 0, -0.18]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.045, 0.045, 1.05, 14]} />
        <meshStandardMaterial color="#777c7a" metalness={0.82} roughness={0.25} />
      </mesh>
      <mesh position={[0, -0.045, -0.22]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.042, 0.042, 0.32, 12]} />
        <meshStandardMaterial color="#3c2319" roughness={0.82} />
      </mesh>
      <mesh position={[0, -0.05, 0.42]}>
        <boxGeometry args={[0.12, 0.16, 0.45]} />
        <meshStandardMaterial color="#382219" roughness={0.85} />
      </mesh>
      <group ref={muzzleRef} position={[0, 0, -0.82]} visible={false}>
        <mesh>
          <sphereGeometry args={[0.28, 12, 10]} />
          <meshBasicMaterial color="#ffd266" />
        </mesh>
        <mesh position={[0, 0, -0.22]} rotation={[-Math.PI / 2, 0, 0]}>
          <coneGeometry args={[0.28, 0.65, 10]} />
          <meshBasicMaterial color="#ff5a1f" />
        </mesh>
      </group>
    </group>
  );
}

export function RickTaylorRig({
  motion,
  equippedWeapon = null,
  bloodIntensity = 1.0,
  headTuning,
  blendshapes,
  hideMask = false,
  showFaceMeshOverlay = false,
  showLandmarks = false,
}: RickTaylorCharacterProps) {
  const root = useRef<THREE.Group>(null);
  const headMount = useRef<THREE.Group>(null);
  const beltMount = useRef<THREE.Group>(null);
  const leftArmMount = useRef<THREE.Group>(null);
  const leftForearm = useRef<THREE.Group>(null);
  const rightArmMount = useRef<THREE.Group>(null);
  const rightForearm = useRef<THREE.Group>(null);
  const leftBootMount = useRef<THREE.Group>(null);
  const rightBootMount = useRef<THREE.Group>(null);
  const muzzleRef = useRef<THREE.Group>(null);
  const gaitPhase = useRef(0);
  const flexState = useRef({ left: 0.15, right: 0.18, leg: 0.1 });
  const facialMorphState = useRef<number[]>(FACIAL_BLENDSHAPE_NAMES.map(() => 0));

  const canvasMaps = useMemo(() => createProceduralPBRMaps(), []);
  const skinSurfaceMaps = useMemo(
    () => createProceduralSurfaceMaps("skin", 1024, bloodIntensity),
    [bloodIntensity]
  );
  const denimSurfaceMaps = useMemo(
    () => createProceduralSurfaceMaps("denim", 1024, bloodIntensity * 0.75),
    [bloodIntensity]
  );

  useEffect(() => {
    return () => {
      skinSurfaceMaps.dispose();
      denimSurfaceMaps.dispose();
    };
  }, [skinSurfaceMaps, denimSurfaceMaps]);

  // Materiais TSL / WebGPU para pele e jeans (normalMap + aoMap + roughnessMap)
  const skinMat = useMemo(
    () =>
      createWebGPUSurfaceNodeMaterial({
        baseColorHex: "#e3a88d",
        maps: skinSurfaceMaps,
        albedoMap: canvasMaps.skinMap,
        normalScale: 0.9,
        aoIntensity: 1.15,
        roughnessMultiplier: 1.0,
        metalness: 0.0,
        useSecondaryUVForAO: true,
      }),
    [skinSurfaceMaps, canvasMaps.skinMap]
  );

  // Material sem vertexColors/uv2 para cabeça, nuca, antebraços e mãos (Capsule/SphereGeometry)
  const skinAccessoryMat = useMemo(
    () =>
      createWebGPUSurfaceNodeMaterial({
        baseColorHex: "#dfb098",
        maps: skinSurfaceMaps,
        albedoMap: canvasMaps.skinMap,
        normalScale: 0.78,
        aoIntensity: 0.95,
        roughnessMultiplier: 1.0,
        metalness: 0.0,
        useSecondaryUVForAO: false,
        vertexColors: false,
      }),
    [skinSurfaceMaps, canvasMaps.skinMap]
  );

  const jeansMat = useMemo(
    () =>
      createWebGPUSurfaceNodeMaterial({
        baseColorHex: "#2f55a4",
        maps: denimSurfaceMaps,
        albedoMap: canvasMaps.jeansMap,
        normalScale: 1.0,
        aoIntensity: 1.2,
        roughnessMultiplier: 1.0,
        metalness: 0.0,
        useSecondaryUVForAO: true,
      }),
    [denimSurfaceMaps, canvasMaps.jeansMap]
  );

  useEffect(() => {
    return () => {
      skinMat.dispose();
      skinAccessoryMat.dispose();
      jeansMat.dispose();
    };
  }, [skinMat, skinAccessoryMat, jeansMat]);

  const parametricHead = useMemo(
    () => createParametricHumanHeadGeometry(headTuning),
    [headTuning]
  );

  useEffect(() => {
    return () => {
      parametricHead.geometry.dispose();
      parametricHead.overlayGeometry.dispose();
    };
  }, [parametricHead]);

  const headMesh = useMemo(() => {
    const mesh = new THREE.Mesh(parametricHead.geometry, skinMat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.updateMorphTargets();
    return mesh;
  }, [parametricHead.geometry, skinMat]);

  const faceMeshOverlayMat = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        color: "#52e5ff",
        transparent: true,
        opacity: 0.45,
      }),
    []
  );

  useEffect(() => {
    return () => {
      faceMeshOverlayMat.dispose();
    };
  }, [faceMeshOverlayMat]);

  const {
    upperBodyGeo,
    trousersGeo,
    maskGeo,
    bootGeo,
    capsuleGeo,
    sphereGeo,
    maskMat,
    bootSoleMat,
    leatherMat,
    metalMat,
    skinnedUpperBody,
    skinnedTrousers,
  } = useMemo(() => {
    const uBody = createUpperBodySkinnedGeometry();
    const trs = createTrousersSkinnedGeometry();
    // 3DMM corporal paramétrico: silhueta atlética de Rick sem perder os detalhes esculpidos.
    applyRickBody3DMM(uBody, DEFAULT_RICK_BODY_3DMM, "upper");
    applyRickBody3DMM(trs, DEFAULT_RICK_BODY_3DMM, "lower");
    const msk = createTerrorMaskGeometry();
    const bt = createCombatBootGeometry();
    const cap = new THREE.CapsuleGeometry(0.12, 0.42, 12, 28);
    const sph = new THREE.SphereGeometry(1, 24, 18);

    const mMat = new THREE.MeshPhysicalMaterial({
      map: canvasMaps.maskMap,
      bumpMap: canvasMaps.maskBumpMap,
      bumpScale: 0.018,
      roughnessMap: canvasMaps.maskRoughnessMap,
      roughness: 0.42,
      metalnessMap: canvasMaps.maskMetalnessMap,
      metalness: 0.96,
      clearcoat: 0.55,
      clearcoatRoughness: 0.08,
      reflectivity: 1.0,
      envMap: canvasMaps.maskEnvMap,
      envMapIntensity: 2.35,
      vertexColors: true,
      side: THREE.DoubleSide,
    });

    const bsMat = new THREE.MeshStandardMaterial({ color: "#362f35", roughness: 0.82 });
    const lMat = new THREE.MeshStandardMaterial({
      color: "#1d181a",
      roughness: 0.6,
      metalness: 0.06,
    });
    const mtMat = new THREE.MeshStandardMaterial({
      color: "#b6a16e",
      roughness: 0.26,
      metalness: 0.78,
    });

    const bones: THREE.Bone[] = [];
    for (let i = 0; i < 13; i++) {
      bones.push(new THREE.Bone());
    }
    // Rest hierarchy matching exact vertex coordinates (root hips at y = 1.05)
    bones[BONE_HIPS].position.set(0, 1.05, 0);
    bones[BONE_SPINE].position.set(0, 0.22, 0);
    bones[BONE_CHEST].position.set(0, 0.37, 0);
    bones[BONE_NECK].position.set(0, 0.28, 0);
    bones[BONE_HEAD].position.set(0, 0.17, 0.015);

    bones[BONE_L_SHOULDER].position.set(-0.47, 0.02, 0);
    bones[BONE_L_ELBOW].position.set(-0.06, -0.52, 0);
    bones[BONE_R_SHOULDER].position.set(0.47, 0.02, 0);
    bones[BONE_R_ELBOW].position.set(0.06, -0.52, 0);

    bones[BONE_L_THIGH].position.set(-0.18, -0.14, 0);
    bones[BONE_L_KNEE].position.set(0, -0.43, 0);
    bones[BONE_R_THIGH].position.set(0.18, -0.14, 0);
    bones[BONE_R_KNEE].position.set(0, -0.43, 0);

    bones[BONE_HIPS].add(bones[BONE_SPINE]);
    bones[BONE_SPINE].add(bones[BONE_CHEST]);
    bones[BONE_CHEST].add(bones[BONE_NECK]);
    bones[BONE_NECK].add(bones[BONE_HEAD]);
    bones[BONE_CHEST].add(bones[BONE_L_SHOULDER]);
    bones[BONE_L_SHOULDER].add(bones[BONE_L_ELBOW]);
    bones[BONE_CHEST].add(bones[BONE_R_SHOULDER]);
    bones[BONE_R_SHOULDER].add(bones[BONE_R_ELBOW]);

    bones[BONE_HIPS].add(bones[BONE_L_THIGH]);
    bones[BONE_L_THIGH].add(bones[BONE_L_KNEE]);
    bones[BONE_HIPS].add(bones[BONE_R_THIGH]);
    bones[BONE_R_THIGH].add(bones[BONE_R_KNEE]);

    bones[BONE_HIPS].updateMatrixWorld(true);
    const skeleton = new THREE.Skeleton(bones);
    const bindIdentity = new THREE.Matrix4();

    const meshUpper = new THREE.SkinnedMesh(uBody, skinMat);
    meshUpper.add(bones[BONE_HIPS]);
    meshUpper.bind(skeleton, bindIdentity);
    meshUpper.frustumCulled = false;
    meshUpper.castShadow = true;
    meshUpper.receiveShadow = true;
    meshUpper.updateMorphTargets();

    const meshTrousers = new THREE.SkinnedMesh(trs, jeansMat);
    meshTrousers.bind(skeleton, bindIdentity);
    meshTrousers.frustumCulled = false;
    meshTrousers.castShadow = true;
    meshTrousers.receiveShadow = true;
    meshTrousers.updateMorphTargets();

    return {
      upperBodyGeo: uBody,
      trousersGeo: trs,
      maskGeo: msk,
      bootGeo: bt,
      capsuleGeo: cap,
      sphereGeo: sph,
      maskMat: mMat,
      bootSoleMat: bsMat,
      leatherMat: lMat,
      metalMat: mtMat,
      skinnedUpperBody: meshUpper,
      skinnedTrousers: meshTrousers,
    };
  }, [canvasMaps, skinMat, jeansMat]);

  useEffect(() => {
    return () => {
      upperBodyGeo.dispose();
      trousersGeo.dispose();
      maskGeo.dispose();
      bootGeo.dispose();
      capsuleGeo.dispose();
      sphereGeo.dispose();
      maskMat.dispose();
      bootSoleMat.dispose();
      leatherMat.dispose();
      metalMat.dispose();
      Object.values(canvasMaps).forEach((tex) => tex.dispose());
    };
  }, [
    upperBodyGeo,
    trousersGeo,
    maskGeo,
    bootGeo,
    capsuleGeo,
    sphereGeo,
    maskMat,
    bootSoleMat,
    leatherMat,
    metalMat,
    canvasMaps,
  ]);

  useFrame((_, delta) => {
    if (!root.current) return;
    const dt = Math.min(delta, 0.05);
    const t = performance.now() * 0.001;
    gaitPhase.current += dt * (motion.moving ? 8.4 : 0);
    const phase = gaitPhase.current;
    const stride = Math.sin(phase);
    const oppositeStride = Math.sin(phase + Math.PI);
    const swing = motion.moving ? Math.max(0, Math.cos(phase)) : 0;
    const oppositeSwing = motion.moving ? Math.max(0, Math.cos(phase + Math.PI)) : 0;
    const gait = motion.moving ? stride : 0;
    const activeWeapon = equippedWeapon ?? motion.weapon;
    const attackDur =
      activeWeapon === "shotgun"
        ? 0.42
        : activeWeapon === "pipe"
        ? 0.68
        : activeWeapon === "machete"
        ? 0.56
        : 0.36;
    const p =
      motion.attackTime > 0
        ? activeWeapon === "pipe"
          ? THREE.MathUtils.clamp(motion.attackProgress, 0, 1)
          : THREE.MathUtils.clamp(1 - motion.attackTime / attackDur, 0, 1)
        : 0;
    const grabProgress =
      motion.grabTime > 0 ? THREE.MathUtils.clamp(1 - motion.grabTime / 1.35, 0, 1) : 0;
    const grab = grabProgress > 0 ? Math.sin(grabProgress * Math.PI) : 0;

    let torsoRotY = motion.moving ? gait * 0.045 : 0;
    let torsoRotX = motion.moving ? 0.035 + swing * 0.025 : 0;
    const torsoRotZ = motion.moving ? -gait * 0.035 : 0;

    let rShoulderX = gait * 0.52 + 0.1;
    let rShoulderZ = 0.06;
    let rElbowX = 0.52;
    let lShoulderX = -gait * 0.52 + 0.28;
    let lShoulderZ = -0.06;
    let lElbowX = 0.72;

    if (activeWeapon === "shotgun") {
      torsoRotX = 0;
      torsoRotY = 0.1 + (motion.moving ? gait * 0.02 : 0);
      rShoulderX = -0.18 + gait * 0.04;
      rElbowX = Math.PI / 2 - rShoulderX;
      rShoulderZ = -0.02;
      lShoulderX = 0.56 - gait * 0.04;
      lElbowX = 1.18 + gait * 0.04;
      lShoulderZ = 0.22;

      if (motion.attackTime > 0) {
        const aimPitch = motion.shotgunAimPitch ?? 0.2;
        const aimYaw = motion.shotgunAimYaw ?? 0;
        if (p < 0.24) {
          const aimEase = smoothstep(0, 0.2, p);
          torsoRotY = THREE.MathUtils.lerp(0.1, aimYaw, aimEase);
          torsoRotX = 0;
          rShoulderX = THREE.MathUtils.lerp(-0.18, 0.26 + aimPitch * 0.45, aimEase);
          const targetPitch = THREE.MathUtils.lerp(0, aimPitch, aimEase);
          rElbowX = Math.PI / 2 + targetPitch - rShoulderX;
          lShoulderX = THREE.MathUtils.lerp(0.56, 0.88 + aimPitch * 0.55, aimEase);
          lElbowX = THREE.MathUtils.lerp(1.18, 1.02 - aimPitch * 0.25, aimEase);
        } else {
          const kick = p < 0.42 ? smoothstep(0.24, 0.32, p) : 1 - smoothstep(0.42, 0.94, p);
          const settle = 1 - smoothstep(0.52, 1.0, p);
          torsoRotX = kick * 0.08;
          torsoRotY = THREE.MathUtils.lerp(0.1, aimYaw, settle) - kick * 0.06;
          const aimedShoulder = 0.26 + aimPitch * 0.45;
          rShoulderX = THREE.MathUtils.lerp(-0.18, aimedShoulder, settle) + kick * 0.14;
          const currentPitch = aimPitch * settle + kick * 0.12;
          rElbowX = Math.PI / 2 + currentPitch - rShoulderX - torsoRotX;
          lShoulderX = THREE.MathUtils.lerp(0.56, 0.88 + aimPitch * 0.55, settle) + kick * 0.14;
          lElbowX = THREE.MathUtils.lerp(1.18, 1.02 - aimPitch * 0.25, settle) - kick * 0.1;
        }
      }
    } else if (activeWeapon === "pipe") {
      rShoulderX = 0.18 + gait * 0.12;
      rShoulderZ = -0.06;
      rElbowX = 0.42;
      lShoulderX = 0.28 - gait * 0.08;
      lShoulderZ = 0.08;
      lElbowX = 0.78;
      if (motion.attackTime > 0) {
        if (motion.attackStyle === "bat") {
          if (p < 0.3) {
            const wind = smoothstep(0, 0.3, p);
            torsoRotY = THREE.MathUtils.lerp(0, -0.62, wind);
            torsoRotX = THREE.MathUtils.lerp(0.02, -0.17, wind);
            rShoulderX = THREE.MathUtils.lerp(0.18, 1.82, wind);
            rShoulderZ = THREE.MathUtils.lerp(-0.06, -0.58, wind);
            rElbowX = THREE.MathUtils.lerp(0.42, 0.82, wind);
            lShoulderX = THREE.MathUtils.lerp(0.28, 0.92, wind);
            lShoulderZ = 0.24;
            lElbowX = 1.12;
          } else if (p < 0.72) {
            const swingP = smoothstep(0.3, 0.72, p);
            const snap = 1 - Math.pow(1 - swingP, 2.6);
            torsoRotY = THREE.MathUtils.lerp(-0.62, 0.78, snap);
            torsoRotX = THREE.MathUtils.lerp(-0.17, 0.3, snap);
            rShoulderX = THREE.MathUtils.lerp(1.82, -1.02, snap);
            rShoulderZ = THREE.MathUtils.lerp(-0.58, 0.66, snap);
            rElbowX = THREE.MathUtils.lerp(0.82, 0.1, snap);
            lShoulderX = THREE.MathUtils.lerp(0.92, -0.22, snap);
            lShoulderZ = THREE.MathUtils.lerp(0.24, -0.18, snap);
            lElbowX = THREE.MathUtils.lerp(1.12, 0.76, snap);
          } else {
            const recover = smoothstep(0.72, 1, p);
            torsoRotY = THREE.MathUtils.lerp(0.78, 0, recover);
            torsoRotX = THREE.MathUtils.lerp(0.3, 0.03, recover);
            rShoulderX = THREE.MathUtils.lerp(-1.02, 0.18, recover);
            rShoulderZ = THREE.MathUtils.lerp(0.66, -0.06, recover);
            rElbowX = THREE.MathUtils.lerp(0.1, 0.42, recover);
            lShoulderX = THREE.MathUtils.lerp(-0.22, 0.28, recover);
            lShoulderZ = THREE.MathUtils.lerp(-0.18, 0.08, recover);
            lElbowX = THREE.MathUtils.lerp(0.76, 0.78, recover);
          }
        } else {
          if (p < 0.38) {
            const lift = smoothstep(0, 0.38, p);
            torsoRotX = THREE.MathUtils.lerp(0.02, -0.3, lift);
            torsoRotY = THREE.MathUtils.lerp(0, -0.12, lift);
            rShoulderX = THREE.MathUtils.lerp(0.18, 2.62, lift);
            rShoulderZ = THREE.MathUtils.lerp(-0.06, -0.22, lift);
            rElbowX = THREE.MathUtils.lerp(0.42, 0.36, lift);
            lShoulderX = THREE.MathUtils.lerp(0.28, 2.48, lift);
            lShoulderZ = THREE.MathUtils.lerp(0.08, 0.24, lift);
            lElbowX = THREE.MathUtils.lerp(0.78, 0.42, lift);
          } else if (p < 0.66) {
            const down = smoothstep(0.38, 0.66, p);
            const impact = 1 - Math.pow(1 - down, 3);
            torsoRotX = THREE.MathUtils.lerp(-0.3, 0.48, impact);
            torsoRotY = THREE.MathUtils.lerp(-0.12, 0.16, impact);
            rShoulderX = THREE.MathUtils.lerp(2.62, -0.92, impact);
            rShoulderZ = THREE.MathUtils.lerp(-0.22, 0.26, impact);
            rElbowX = THREE.MathUtils.lerp(0.36, 0.08, impact);
            lShoulderX = THREE.MathUtils.lerp(2.48, -0.74, impact);
            lShoulderZ = THREE.MathUtils.lerp(0.24, -0.22, impact);
            lElbowX = THREE.MathUtils.lerp(0.42, 0.12, impact);
          } else {
            const recover = smoothstep(0.66, 1, p);
            torsoRotX = THREE.MathUtils.lerp(0.48, 0.03, recover);
            torsoRotY = THREE.MathUtils.lerp(0.16, 0, recover);
            rShoulderX = THREE.MathUtils.lerp(-0.92, 0.18, recover);
            rShoulderZ = THREE.MathUtils.lerp(0.26, -0.06, recover);
            rElbowX = THREE.MathUtils.lerp(0.08, 0.42, recover);
            lShoulderX = THREE.MathUtils.lerp(-0.74, 0.28, recover);
            lShoulderZ = THREE.MathUtils.lerp(-0.22, 0.08, recover);
            lElbowX = THREE.MathUtils.lerp(0.12, 0.78, recover);
          }
        }
      }
    } else if (activeWeapon === "machete") {
      rShoulderX = 0.15 + gait * 0.22;
      rElbowX = 0.48;
      if (motion.attackTime > 0) {
        if (motion.attackStyle === "macheteArm") {
          if (p < 0.28) {
            const wind = smoothstep(0, 0.28, p);
            torsoRotY = THREE.MathUtils.lerp(0, 0.32, wind);
            torsoRotX = THREE.MathUtils.lerp(0.02, -0.08, wind);
            rShoulderX = THREE.MathUtils.lerp(0.15, 0.92, wind);
            rShoulderZ = THREE.MathUtils.lerp(-0.08, -0.72, wind);
            rElbowX = THREE.MathUtils.lerp(0.48, 1.05, wind);
            lShoulderX = 0.82;
            lShoulderZ = 0.18;
            lElbowX = 1.02;
          } else if (p < 0.62) {
            const cut = smoothstep(0.28, 0.62, p);
            const snap = 1 - Math.pow(1 - cut, 2.5);
            torsoRotY = THREE.MathUtils.lerp(0.32, -0.62, snap);
            torsoRotX = THREE.MathUtils.lerp(-0.08, 0.22, snap);
            rShoulderX = THREE.MathUtils.lerp(0.92, -0.72, snap);
            rShoulderZ = THREE.MathUtils.lerp(-0.72, 0.42, snap);
            rElbowX = THREE.MathUtils.lerp(1.05, 0.12, snap);
            lShoulderX = THREE.MathUtils.lerp(0.82, -0.12, snap);
            lShoulderZ = 0.12;
            lElbowX = 0.82;
          } else {
            const recover = smoothstep(0.62, 1, p);
            torsoRotY = THREE.MathUtils.lerp(-0.62, 0, recover);
            torsoRotX = THREE.MathUtils.lerp(0.22, 0.04, recover);
            rShoulderX = THREE.MathUtils.lerp(-0.72, 0.15, recover);
            rShoulderZ = THREE.MathUtils.lerp(0.42, -0.08, recover);
            rElbowX = THREE.MathUtils.lerp(0.12, 0.48, recover);
            lShoulderX = THREE.MathUtils.lerp(-0.12, 0.28, recover);
            lElbowX = THREE.MathUtils.lerp(0.82, 0.72, recover);
          }
        } else {
          if (p < 0.34) {
            const w = p / 0.34;
            const ease = w * w * (3 - 2 * w);
            torsoRotY = THREE.MathUtils.lerp(0, -0.42, ease);
            torsoRotX = THREE.MathUtils.lerp(0, -0.12, ease);
            rShoulderX = THREE.MathUtils.lerp(0.15, 2.15, ease);
            rShoulderZ = THREE.MathUtils.lerp(-0.08, -0.35, ease);
            rElbowX = THREE.MathUtils.lerp(0.48, 0.72, ease);
            lShoulderX = 0.55;
            lElbowX = 0.95;
          } else if (p < 0.62) {
            const s = (p - 0.34) / 0.28;
            const snap = 1 - Math.pow(1 - s, 2.2);
            torsoRotY = THREE.MathUtils.lerp(-0.42, 0.5, snap);
            torsoRotX = THREE.MathUtils.lerp(-0.12, 0.24, snap);
            rShoulderX = THREE.MathUtils.lerp(2.15, -0.2, snap);
            rShoulderZ = THREE.MathUtils.lerp(-0.35, 0.28, snap);
            rElbowX = THREE.MathUtils.lerp(0.72, 0.16, snap);
            lShoulderX = -0.2;
            lElbowX = 0.85;
          } else {
            const r = (p - 0.62) / 0.38;
            torsoRotY = THREE.MathUtils.lerp(0.5, 0, r);
            torsoRotX = THREE.MathUtils.lerp(0.24, 0.04, r);
            rShoulderX = THREE.MathUtils.lerp(-0.2, 0.15, r);
            rShoulderZ = THREE.MathUtils.lerp(0.28, -0.08, r);
            rElbowX = THREE.MathUtils.lerp(0.16, 0.48, r);
          }
        }
      }
    } else if (motion.attackTime > 0) {
      if (p < 0.22) {
        const w = p / 0.22;
        torsoRotY = THREE.MathUtils.lerp(0, -0.36, w);
        torsoRotX = THREE.MathUtils.lerp(0, 0.06, w);
        rShoulderX = THREE.MathUtils.lerp(0.12, -0.58, w);
        rShoulderZ = THREE.MathUtils.lerp(-0.08, -0.18, w);
        rElbowX = THREE.MathUtils.lerp(0.52, 1.72, w);
        lShoulderX = THREE.MathUtils.lerp(0.32, 0.82, w);
        lElbowX = 1.05;
      } else if (p < 0.5) {
        const s = (p - 0.22) / 0.28;
        const snap = 1 - Math.pow(1 - s, 3);
        torsoRotY = THREE.MathUtils.lerp(-0.36, 0.48, snap);
        torsoRotX = THREE.MathUtils.lerp(0.06, 0.2, snap);
        rShoulderX = THREE.MathUtils.lerp(-0.58, 1.56, snap);
        rShoulderZ = THREE.MathUtils.lerp(-0.18, 0.16, snap);
        rElbowX = THREE.MathUtils.lerp(1.72, 0.06, snap);
        lShoulderX = THREE.MathUtils.lerp(0.82, -0.25, snap);
        lElbowX = 0.95;
      } else {
        const r = (p - 0.5) / 0.5;
        torsoRotY = THREE.MathUtils.lerp(0.48, 0, r);
        torsoRotX = THREE.MathUtils.lerp(0.2, 0.04, r);
        rShoulderX = THREE.MathUtils.lerp(1.56, 0.12, r);
        rShoulderZ = THREE.MathUtils.lerp(0.16, -0.08, r);
        rElbowX = THREE.MathUtils.lerp(0.06, 0.52, r);
        lShoulderX = THREE.MathUtils.lerp(-0.25, 0.32, r);
        lElbowX = 0.72;
      }
    }

    if (motion.grabTime > 0) {
      if (grabProgress < 0.24) {
        const reach = grabProgress / 0.24;
        torsoRotX = THREE.MathUtils.lerp(0.02, -0.24, reach);
        lShoulderX = THREE.MathUtils.lerp(0.32, 0.92, reach);
        rShoulderX = THREE.MathUtils.lerp(0.12, 0.92, reach);
        lShoulderZ = THREE.MathUtils.lerp(0.1, 0.2, reach);
        rShoulderZ = THREE.MathUtils.lerp(-0.08, -0.2, reach);
        lElbowX = THREE.MathUtils.lerp(0.72, 1.22, reach);
        rElbowX = THREE.MathUtils.lerp(0.52, 1.22, reach);
      } else if (grabProgress < 0.68) {
        const lift = (grabProgress - 0.24) / 0.44;
        const ease = lift * lift * (3 - 2 * lift);
        torsoRotX = THREE.MathUtils.lerp(-0.24, 0.2, ease);
        lShoulderX = THREE.MathUtils.lerp(0.92, 2.35, ease);
        rShoulderX = THREE.MathUtils.lerp(0.92, 2.35, ease);
        lShoulderZ = THREE.MathUtils.lerp(0.2, 0.28, ease);
        rShoulderZ = THREE.MathUtils.lerp(-0.2, -0.28, ease);
        lElbowX = THREE.MathUtils.lerp(1.22, 0.58, ease);
        rElbowX = THREE.MathUtils.lerp(1.22, 0.58, ease);
      } else {
        const throwProgress = (grabProgress - 0.68) / 0.32;
        const snap = Math.sin(throwProgress * Math.PI * 0.5);
        torsoRotX = THREE.MathUtils.lerp(0.2, -0.16, snap);
        torsoRotY = THREE.MathUtils.lerp(0, -0.3, snap);
        lShoulderX = THREE.MathUtils.lerp(2.35, 0.62, snap);
        rShoulderX = THREE.MathUtils.lerp(2.35, 0.62, snap);
        lShoulderZ = THREE.MathUtils.lerp(0.28, 0.42, snap);
        rShoulderZ = THREE.MathUtils.lerp(-0.28, -0.42, snap);
        lElbowX = THREE.MathUtils.lerp(0.58, 1.05, snap);
        rElbowX = THREE.MathUtils.lerp(0.58, 1.05, snap);
      }
    }

    const sliding = THREE.MathUtils.clamp((motion.slideTime ?? 0) / 0.58, 0, 1);
    const sweeping = motion.specialMove === "sweep" ? 1 : 0;

    const skel = skinnedUpperBody.skeleton;
    if (skel && skel.bones.length >= 13) {
      const [
        hipsBone,
        spineBone,
        chestBone,
        neckBone,
        headBone,
        leftShoulderBone,
        leftElbowBone,
        rightShoulderBone,
        rightElbowBone,
        leftThighBone,
        leftKneeBone,
        rightThighBone,
        rightKneeBone,
      ] = skel.bones;

      const bounceY = motion.moving ? Math.abs(Math.sin(phase * 2)) * 0.045 : Math.sin(t * 1.7) * 0.009;
      hipsBone.position.y = 1.05 + bounceY;

      const shotgunFiring = activeWeapon === "shotgun" && motion.attackTime > 0;
      const torsoDamp = shotgunFiring ? 38 : 18;
      const armDamp = shotgunFiring ? 48 : 24;

      spineBone.rotation.y = THREE.MathUtils.damp(spineBone.rotation.y, torsoRotY * 0.42, torsoDamp, dt);
      spineBone.rotation.x = THREE.MathUtils.damp(spineBone.rotation.x, torsoRotX * 0.45, torsoDamp, dt);
      spineBone.rotation.z = THREE.MathUtils.damp(spineBone.rotation.z, torsoRotZ * 0.42, 10, dt);

      chestBone.rotation.y = THREE.MathUtils.damp(chestBone.rotation.y, torsoRotY * 0.58, torsoDamp, dt);
      chestBone.rotation.x = THREE.MathUtils.damp(chestBone.rotation.x, torsoRotX * 0.55, torsoDamp, dt);
      chestBone.rotation.z = THREE.MathUtils.damp(chestBone.rotation.z, torsoRotZ * 0.58, 10, dt);

      neckBone.rotation.y = THREE.MathUtils.damp(neckBone.rotation.y, -torsoRotY * 0.25, 14, dt);
      headBone.rotation.y = THREE.MathUtils.damp(headBone.rotation.y, -torsoRotY * 0.4, 14, dt);
      if(motion.specialMove==="sweep"||motion.specialMove==="escorrao"){
        torsoRotX=0.28;rShoulderX=0.72;lShoulderX=0.68;rElbowX=0.95;lElbowX=0.95;
      }else if(motion.specialMove==="slide"){
        torsoRotX=0.34;rShoulderX=0.95;lShoulderX=0.95;rElbowX=1.05;lElbowX=1.05;
      }
      headBone.rotation.x = THREE.MathUtils.damp(headBone.rotation.x, grab * 0.08 - torsoRotX * 0.35, 10, dt);

      leftShoulderBone.rotation.x = THREE.MathUtils.damp(
        leftShoulderBone.rotation.x,
        lShoulderX,
        shotgunFiring ? 44 : 22,
        dt
      );
      leftShoulderBone.rotation.z = THREE.MathUtils.damp(leftShoulderBone.rotation.z, lShoulderZ, 18, dt);
      rightShoulderBone.rotation.x = THREE.MathUtils.damp(rightShoulderBone.rotation.x, rShoulderX, armDamp, dt);
      rightShoulderBone.rotation.z = THREE.MathUtils.damp(rightShoulderBone.rotation.z, rShoulderZ, 20, dt);

      const nextLElbow = leftForearm.current
        ? THREE.MathUtils.damp(leftForearm.current.rotation.x, lElbowX, shotgunFiring ? 44 : 22, dt)
        : lElbowX;
      const nextRElbow = rightForearm.current
        ? THREE.MathUtils.damp(rightForearm.current.rotation.x, rElbowX, armDamp, dt)
        : rElbowX;

      if (leftForearm.current) leftForearm.current.rotation.x = nextLElbow;
      if (rightForearm.current) rightForearm.current.rotation.x = nextRElbow;
      leftElbowBone.rotation.x = nextLElbow;
      rightElbowBone.rotation.x = nextRElbow;

      leftThighBone.rotation.x = THREE.MathUtils.damp(
        leftThighBone.rotation.x,
        sweeping ? 1.18 : sliding ? 0.78 : motion.moving ? stride * 0.48 : 0.015 * Math.sin(t),
        14,
        dt
      );
      rightThighBone.rotation.x = THREE.MathUtils.damp(
        rightThighBone.rotation.x,
        sweeping ? -0.72 : sliding ? 0.55 : motion.moving ? oppositeStride * 0.48 : -0.015 * Math.sin(t),
        14,
        dt
      );
      leftKneeBone.rotation.x = THREE.MathUtils.damp(
        leftKneeBone.rotation.x,
        sweeping ? -0.35 : sliding ? -0.18 : motion.moving ? -swing * 0.82 : 0,
        14,
        dt
      );
      rightKneeBone.rotation.x = THREE.MathUtils.damp(
        rightKneeBone.rotation.x,
        sweeping ? -0.95 : sliding ? -0.18 : motion.moving ? -oppositeSwing * 0.82 : 0,
        14,
        dt
      );

      hipsBone.updateMatrix();
      spineBone.updateMatrix();
      chestBone.updateMatrix();
      neckBone.updateMatrix();
      headBone.updateMatrix();
      leftShoulderBone.updateMatrix();
      rightShoulderBone.updateMatrix();
      leftThighBone.updateMatrix();
      leftKneeBone.updateMatrix();
      rightThighBone.updateMatrix();
      rightKneeBone.updateMatrix();

      _matHips.copy(hipsBone.matrix);
      _matSpine.multiplyMatrices(_matHips, spineBone.matrix);
      _matChest.multiplyMatrices(_matSpine, chestBone.matrix);
      _matNeck.multiplyMatrices(_matChest, neckBone.matrix);
      _matHead.multiplyMatrices(_matNeck, headBone.matrix);
      _matLShoulder.multiplyMatrices(_matChest, leftShoulderBone.matrix);
      _matRShoulder.multiplyMatrices(_matChest, rightShoulderBone.matrix);
      _matLThigh.multiplyMatrices(_matHips, leftThighBone.matrix);
      _matLKnee.multiplyMatrices(_matLThigh, leftKneeBone.matrix);
      _matRThigh.multiplyMatrices(_matHips, rightThighBone.matrix);
      _matRKnee.multiplyMatrices(_matRThigh, rightKneeBone.matrix);

      if (beltMount.current) _matHips.decompose(beltMount.current.position, beltMount.current.quaternion, beltMount.current.scale);
      if (headMount.current) _matHead.decompose(headMount.current.position, headMount.current.quaternion, headMount.current.scale);
      if (leftArmMount.current) _matLShoulder.decompose(leftArmMount.current.position, leftArmMount.current.quaternion, leftArmMount.current.scale);
      if (rightArmMount.current) _matRShoulder.decompose(rightArmMount.current.position, rightArmMount.current.quaternion, rightArmMount.current.scale);
      if (leftBootMount.current) _matLKnee.decompose(leftBootMount.current.position, leftBootMount.current.quaternion, leftBootMount.current.scale);
      if (rightBootMount.current) _matRKnee.decompose(rightBootMount.current.position, rightBootMount.current.quaternion, rightBootMount.current.scale);
    }

    const targetLeftFlex =
      (motion.leftFlex ?? 0) +
      (motion.grabTime > 0
        ? 0.95
        : activeWeapon === "shotgun"
        ? 0.65
        : motion.attackTime > 0
        ? 0.42
        : motion.moving
        ? 0.25
        : 0.12);
    const targetRightFlex =
      (motion.rightFlex ?? 0) +
      (motion.attackTime > 0
        ? 1.0
        : motion.grabTime > 0
        ? 0.95
        : activeWeapon
        ? 0.58
        : motion.moving
        ? 0.26
        : 0.15);
    const targetLegFlex =
      (motion.legFlex ?? 0) + (motion.jumpHeight > 0.05 ? 0.9 : motion.moving ? 0.65 : 0.1);

    flexState.current.left = THREE.MathUtils.damp(
      flexState.current.left,
      THREE.MathUtils.clamp(targetLeftFlex, 0, 1),
      14,
      dt
    );
    flexState.current.right = THREE.MathUtils.damp(
      flexState.current.right,
      THREE.MathUtils.clamp(targetRightFlex, 0, 1),
      16,
      dt
    );
    flexState.current.leg = THREE.MathUtils.damp(
      flexState.current.leg,
      THREE.MathUtils.clamp(targetLegFlex, 0, 1),
      10,
      dt
    );

    if (skinnedUpperBody.morphTargetInfluences) {
      skinnedUpperBody.morphTargetInfluences[0] = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * 2.1));
      skinnedUpperBody.morphTargetInfluences[1] = flexState.current.left;
      skinnedUpperBody.morphTargetInfluences[2] = flexState.current.right;
    }
    if (skinnedTrousers.morphTargetInfluences) {
      skinnedTrousers.morphTargetInfluences[0] = flexState.current.leg;
    }

    if (headMesh.morphTargetInfluences) {
      const attackActive = motion.attackTime > 0;
      const roarPeak = attackActive && p >= 0.18 && p <= 0.68 ? Math.sin(((p - 0.18) / 0.5) * Math.PI) : 0;
      const exertion = Math.max(
        attackActive ? 0.65 + roarPeak * 0.35 : 0,
        grab * 0.95,
        motion.moving ? 0.25 : 0
      );

      const targetMorphs: Record<FacialBlendshapeName, number> = {
        jawDrop: THREE.MathUtils.clamp((blendshapes?.jawDrop ?? 0) + roarPeak * 0.45 + grab * 0.68, 0, 1),
        browFurrow: THREE.MathUtils.clamp((blendshapes?.browFurrow ?? 0.28) + exertion * 0.62, 0, 1),
        lipSnarl: THREE.MathUtils.clamp((blendshapes?.lipSnarl ?? 0.12) + roarPeak * 0.65 + grab * 0.72, 0, 1),
        cheekSquint: THREE.MathUtils.clamp((blendshapes?.cheekSquint ?? 0.14) + exertion * 0.52, 0, 1),
        nostrilFlare: THREE.MathUtils.clamp((blendshapes?.nostrilFlare ?? 0.08) + exertion * 0.65, 0, 1),
        nucaTense: THREE.MathUtils.clamp(
          (blendshapes?.nucaTense ?? 0.14) + (motion.moving ? 0.28 : 0) + exertion * 0.75,
          0,
          1
        ),
        breath: THREE.MathUtils.clamp(
          (blendshapes?.breath ?? 0) + (0.5 + 0.5 * Math.sin(t * 2.1)) * 0.55,
          0,
          1
        ),
      };

      FACIAL_BLENDSHAPE_NAMES.forEach((name, idx) => {
        const damped = THREE.MathUtils.damp(
          facialMorphState.current[idx],
          targetMorphs[name],
          14,
          dt
        );
        facialMorphState.current[idx] = damped;
        headMesh.morphTargetInfluences![idx] = damped;
      });
    }

    if (muzzleRef.current) {
      muzzleRef.current.visible =
        activeWeapon === "shotgun" && motion.attackTime > 0 && p >= 0.18 && p <= 0.4;
    }
    root.current.position.y = motion.jumpHeight - sliding*0.48 - sweeping*0.08;
    root.current.rotation.x = THREE.MathUtils.damp(root.current.rotation.x,sliding*0.18+sweeping*0.06,18,dt);
  });

  const activeWeapon = equippedWeapon ?? motion.weapon;

  return (
    <group ref={root} scale={1.04} dispose={null}>
      <primitive object={skinnedUpperBody} />
      <primitive object={skinnedTrousers} />

      <group ref={beltMount} position={[0, 1.05, 0]}>
        <mesh position={[0, -0.02, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[1.38, 1, 1]} castShadow>
          <torusGeometry args={[0.214, 0.032, 10, 36]} />
          <primitive object={leatherMat} attach="material" />
        </mesh>
        <mesh position={[0, -0.02, -0.228]} castShadow>
          <boxGeometry args={[0.125, 0.088, 0.036]} />
          <primitive object={metalMat} attach="material" />
        </mesh>
      </group>

      {/* Parametric 3DMM + FaceMesh + GPU Blendshape Head, Nuca & Metallic Terror Mask */}
      <group ref={headMount} position={[0, 2.09, 0.015]}>
        <primitive object={headMesh} />
        {showFaceMeshOverlay && (
          <lineSegments geometry={parametricHead.overlayGeometry} material={faceMeshOverlayMat} />
        )}
        {showLandmarks &&
          parametricHead.landmarks.map((lm) => (
            <mesh key={lm.id} position={lm.position}>
              <sphereGeometry args={[0.0085, 8, 8]} />
              <meshBasicMaterial
                color={
                  lm.region === "nuca"
                    ? "#ff9c47"
                    : lm.region === "cranium"
                    ? "#54e3ff"
                    : lm.region === "jaw"
                    ? "#ff5d73"
                    : "#8bff8b"
                }
              />
            </mesh>
          ))}
        {!hideMask && (
          <>
            <mesh geometry={maskGeo} material={maskMat} position={[0, 0.01, -0.015]} castShadow receiveShadow />
            <mesh position={[0, 0.06, 0.025]} rotation={[Math.PI / 2, 0, 0]} scale={[1.03, 0.99, 1]} castShadow>
              <torusGeometry args={[0.262, 0.018, 8, 32]} />
              <primitive object={leatherMat} attach="material" />
            </mesh>
          </>
        )}
      </group>

      {/* Untouched Forearms mounted identically to shoulder bones */}
      <group ref={leftArmMount} position={[-0.47, 1.66, 0]}>
        <group ref={leftForearm} position={[-0.06, -0.52, 0]}>
          <mesh
            geometry={capsuleGeo}
            material={skinAccessoryMat}
            position={[-0.02, -0.24, -0.015]}
            rotation={[0, 0, 0.04]}
            castShadow
            receiveShadow
          />
          {ellipsoid(sphereGeo, skinAccessoryMat, [-0.03, -0.47, -0.025], [0.15, 0.14, 0.15])}
        </group>
      </group>

      <group ref={rightArmMount} position={[0.47, 1.66, 0]}>
        <group ref={rightForearm} position={[0.06, -0.52, 0]}>
          <mesh
            geometry={capsuleGeo}
            material={skinAccessoryMat}
            position={[0.02, -0.24, -0.015]}
            rotation={[0, 0, -0.04]}
            castShadow
            receiveShadow
          />
          {ellipsoid(sphereGeo, skinAccessoryMat, [0.03, -0.47, -0.025], [0.16, 0.15, 0.15])}
          {[-0.09, -0.035, 0.02, 0.075].map((x, i) => (
            <group key={i}>
              <mesh
                geometry={capsuleGeo}
                material={skinAccessoryMat}
                position={[x, -0.56, -0.105]}
                rotation={[0, 0, Math.PI / 2]}
                scale={[0.34, 0.34, 0.34]}
                castShadow
              />
            </group>
          ))}
          {activeWeapon && (
            <group position={[0.03, -0.47, -0.025]}>
              <HeldWeaponMesh id={activeWeapon} muzzleRef={muzzleRef} />
            </group>
          )}
        </group>
      </group>

      <group ref={leftBootMount} position={[-0.18, 0.48, 0]}>
        <mesh geometry={bootGeo} material={leatherMat} castShadow receiveShadow />
        {ellipsoid(sphereGeo, bootSoleMat, [0, -0.478, -0.09], [0.155, 0.034, 0.245])}
        {[-0.31, -0.36].map((y, i) => (
          <mesh key={i} position={[0, y, -0.175]} material={metalMat} castShadow>
            <boxGeometry args={[0.16, 0.016, 0.024]} />
          </mesh>
        ))}
      </group>

      <group ref={rightBootMount} position={[0.18, 0.48, 0]}>
        <mesh geometry={bootGeo} material={leatherMat} castShadow receiveShadow />
        {ellipsoid(sphereGeo, bootSoleMat, [0, -0.478, -0.09], [0.155, 0.034, 0.245])}
        {[-0.31, -0.36].map((y, i) => (
          <mesh key={i} position={[0, y, -0.175]} material={metalMat} castShadow>
            <boxGeometry args={[0.16, 0.016, 0.024]} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

/** Variante jogável do Rick HD: reutiliza o rig e recebe o mesmo estado de combate do jogo. */
export function RickTaylorCharacter3DHDPlayer({
  motion,
  equippedWeapon = null,
  bloodIntensity = 1.0,
  headTuning,
  blendshapes,
  hideMask = false,
}: RickTaylorCharacterProps) {
  return (
    <RickTaylorRig
      motion={motion}
      equippedWeapon={equippedWeapon}
      bloodIntensity={bloodIntensity}
      headTuning={headTuning}
      blendshapes={blendshapes}
      hideMask={hideMask}
    />
  );
}

function RendererInitHelper({ onReady }: { onReady: (mode: "WebGPU" | "WebGL") => void }) {
  const { gl } = useThree();
  useEffect(() => {
    const isWebGPU =
      typeof (gl as unknown as { isWebGPURenderer?: boolean }).isWebGPURenderer === "boolean" &&
      Boolean((gl as unknown as { isWebGPURenderer?: boolean }).isWebGPURenderer);
    onReady(isWebGPU ? "WebGPU" : "WebGL");
  }, [gl, onReady]);
  return null;
}

type ShowcaseCameraFocus = "full" | "headFront" | "headNuca";

function ShowcaseCameraRig({
  focus,
  controlsRef,
}: {
  focus: ShowcaseCameraFocus;
  controlsRef: React.RefObject<OrbitControlsImpl | null>;
}) {
  const { camera } = useThree();
  useEffect(() => {
    if (focus === "full") {
      camera.position.set(0, 1.35, -3.2);
      controlsRef.current?.target.set(0, 1.15, 0);
    } else if (focus === "headFront") {
      camera.position.set(0.18, 2.18, -0.92);
      controlsRef.current?.target.set(0, 2.12, 0);
    } else {
      camera.position.set(0.76, 2.16, 0.56);
      controlsRef.current?.target.set(0, 2.1, 0.03);
    }
    controlsRef.current?.update();
  }, [focus, camera, controlsRef]);
  return null;
}

async function createShowcaseRenderer(canvas: HTMLCanvasElement) {
  const hasWebGPU = typeof navigator !== "undefined" && "gpu" in navigator;

  if (hasWebGPU) {
    try {
      const gpuRenderer = new WebGPURenderer({
        canvas,
        antialias: true,
        powerPreference: "high-performance",
      });
      await gpuRenderer.init();
      gpuRenderer.shadowMap.enabled = true;
      gpuRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
      gpuRenderer.toneMapping = THREE.ACESFilmicToneMapping;
      gpuRenderer.toneMappingExposure = 1.05;
      return gpuRenderer;
    } catch {
      // Falls back to WebGLRenderer when WebGPU adapter initialization fails.
    }
  }

  const glRenderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: "high-performance",
  });
  glRenderer.shadowMap.enabled = true;
  glRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
  glRenderer.toneMapping = THREE.ACESFilmicToneMapping;
  glRenderer.toneMappingExposure = 1.05;
  return glRenderer;
}

const HEAD_TUNING_CONTROLS: Array<{
  key: keyof HeadFineTuningParams;
  label: string;
  group: "nuca" | "face";
}> = [
  { key: "nucaProjection", label: "Projecao da Nuca (Occipital)", group: "nuca" },
  { key: "cranialHeight", label: "Altura do Cranio", group: "nuca" },
  { key: "cranialWidth", label: "Largura Biparietal", group: "nuca" },
  { key: "templePinch", label: "Recorte Temporal", group: "nuca" },
  { key: "neckThickness", label: "Calibre do Pescoco (SCM)", group: "nuca" },
  { key: "neckSlope", label: "Base Cervical / Trapezio", group: "nuca" },
  { key: "browRidge", label: "Arco Supraciliar (Brow)", group: "face" },
  { key: "zygomaticWidth", label: "Zigoma (Macas do Rosto)", group: "face" },
  { key: "noseBridge", label: "Ponte Nasal", group: "face" },
  { key: "noseProjection", label: "Ponta Nasal", group: "face" },
  { key: "jawWidth", label: "Largura da Mandibula", group: "face" },
  { key: "jawAngle", label: "Angulo Mandibular", group: "face" },
  { key: "chinProjection", label: "Projecao do Queixo", group: "face" },
  { key: "earProminence", label: "Escala / Abertura Orelhas", group: "face" },
];

const BLENDSHAPE_LABELS: Record<FacialBlendshapeName, string> = {
  jawDrop: "Abertura Mandibular (TMJ)",
  browFurrow: "Franzir Sobrancelha",
  lipSnarl: "Rosnado Labio Superior",
  cheekSquint: "Compressao Zigomatica",
  nostrilFlare: "Dilatacao Nasal",
  nucaTense: "Tensao Nuca / SCM",
  breath: "Pulso Respiratorio",
};

export default function RickTaylorCharacter3DHD() {
  const [backend, setBackend] = useState<"WebGPU" | "WebGL">("WebGL");
  const [poseMode, setPoseMode] = useState<RickPoseMode>("idle");
  const [weapon, setWeapon] = useState<RickWeaponId | null>("pipe");
  const [bloodIntensity, setBloodIntensity] = useState<number>(0.85);
  const [leftFlex, setLeftFlex] = useState<number>(0.25);
  const [rightFlex, setRightFlex] = useState<number>(0.35);
  const [legFlex, setLegFlex] = useState<number>(0.15);

  const [panelOpen, setPanelOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<"head" | "blendshapes" | "body">("head");
  const [cameraFocus, setCameraFocus] = useState<ShowcaseCameraFocus>("headFront");
  const [hideMask, setHideMask] = useState(true);
  const [showFaceMeshOverlay, setShowFaceMeshOverlay] = useState(false);
  const [showLandmarks, setShowLandmarks] = useState(false);
  const [presetId, setPresetId] = useState<Head3DMMPresetId>("canonical");
  const [headTuning, setHeadTuning] = useState<HeadFineTuningParams>({
    ...DEFAULT_HEAD_FINE_TUNING,
  });
  const [blendshapes, setBlendshapes] = useState<FacialBlendshapeWeights>({
    ...DEFAULT_FACIAL_BLENDSHAPES,
  });

  const controlsRef = useRef<OrbitControlsImpl | null>(null);

  const anthropometry = useMemo(() => computeHeadAnthropometry(headTuning), [headTuning]);

  const motion: RickMotion = useMemo(
    () => ({
      moving: poseMode === "walk",
      attackTime: poseMode === "attack" ? 0.4 : 0,
      attackStyle: poseMode === "attack" ? "bat" : null,
      attackProgress: poseMode === "attack" ? 0.5 : 0,
      grabTime: poseMode === "grab" ? 0.4 : 0,
      jumpHeight: poseMode === "jump" ? 0.35 : 0,
      weapon,
      leftFlex,
      rightFlex,
      legFlex,
    }),
    [poseMode, weapon, leftFlex, rightFlex, legFlex]
  );

  const handlePresetChange = (nextId: Head3DMMPresetId) => {
    setPresetId(nextId);
    setHeadTuning({ ...HEAD_3DMM_PRESETS[nextId].tuning });
  };

  return (
    <div style={{ width: "100vw", height: "100vh", position: "relative", background: "#141418" }}>
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ position: [0.18, 2.18, -0.92], fov: 40 }}
        gl={(defaultProps) =>
          createShowcaseRenderer(defaultProps.canvas as HTMLCanvasElement) as unknown as THREE.WebGLRenderer
        }
      >
        <color attach="background" args={["#18181f"]} />
        <RendererInitHelper onReady={setBackend} />
        <ShowcaseCameraRig focus={cameraFocus} controlsRef={controlsRef} />

        <ambientLight intensity={0.65} />
        <directionalLight position={[-2.5, 4.5, -3.5]} intensity={1.45} castShadow />
        <directionalLight position={[3, 2.5, 3]} intensity={0.75} color="#9bb8ff" />

        <RickTaylorRig
          motion={motion}
          equippedWeapon={weapon}
          bloodIntensity={bloodIntensity}
          headTuning={headTuning}
          blendshapes={blendshapes}
          hideMask={hideMask}
          showFaceMeshOverlay={showFaceMeshOverlay}
          showLandmarks={showLandmarks}
        />

        <ContactShadows position={[0, 0, 0]} opacity={0.55} scale={6} blur={1.8} />
        <Environment preset="studio" />
        <OrbitControls ref={controlsRef} target={[0, 2.12, 0]} />
      </Canvas>

      <div
        style={{
          position: "absolute",
          top: 16,
          left: 16,
          padding: 12,
          borderRadius: 10,
          background: "rgba(18, 18, 24, 0.9)",
          border: "1px solid rgba(255,255,255,0.12)",
          color: "#f4f4f6",
          fontFamily: "system-ui, sans-serif",
          fontSize: 12,
          display: "flex",
          flexDirection: "column",
          gap: 10,
          width: panelOpen ? 290 : "auto",
          maxHeight: "calc(100vh - 32px)",
          overflowY: "auto",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <div>
            <strong>Rick HD · 3DMM Head</strong> ({backend})
          </div>
          <button
            type="button"
            onClick={() => setPanelOpen((v) => !v)}
            style={{
              background: "rgba(255,255,255,0.1)",
              color: "#f4f4f6",
              border: "none",
              borderRadius: 6,
              padding: "3px 8px",
              cursor: "pointer",
              fontSize: 11,
            }}
          >
            {panelOpen ? "Ocultar" : "Ajustes"}
          </button>
        </div>

        {panelOpen && (
          <>
            <div style={{ display: "flex", gap: 4 }}>
              {(
                [
                  ["headFront", "Face"],
                  ["headNuca", "Nuca / Perfil"],
                  ["full", "Corpo"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setCameraFocus(id)}
                  style={{
                    flex: 1,
                    padding: "5px 6px",
                    borderRadius: 6,
                    border: "1px solid rgba(255,255,255,0.15)",
                    background: cameraFocus === id ? "#a62424" : "rgba(255,255,255,0.06)",
                    color: "#fff",
                    cursor: "pointer",
                    fontSize: 11,
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={!hideMask}
                  onChange={(e) => setHideMask(!e.target.checked)}
                />
                Mascara Aco
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={showFaceMeshOverlay}
                  onChange={(e) => setShowFaceMeshOverlay(e.target.checked)}
                />
                FaceMesh
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={showLandmarks}
                  onChange={(e) => setShowLandmarks(e.target.checked)}
                />
                Landmarks
              </label>
            </div>

            <div style={{ display: "flex", gap: 4 }}>
              {(
                [
                  ["head", "3DMM / Nuca"],
                  ["blendshapes", "Blendshapes"],
                  ["body", "Rig / Pose"],
                ] as const
              ).map(([tab, label]) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  style={{
                    flex: 1,
                    padding: "5px 6px",
                    borderRadius: 6,
                    border: "1px solid rgba(255,255,255,0.15)",
                    background: activeTab === tab ? "#2e528c" : "rgba(255,255,255,0.06)",
                    color: "#fff",
                    cursor: "pointer",
                    fontSize: 11,
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            {activeTab === "head" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <span>Base 3DMM:</span>
                  <select
                    value={presetId}
                    onChange={(e) => handlePresetChange(e.target.value as Head3DMMPresetId)}
                    style={{ background: "#232530", color: "#fff", borderRadius: 5, padding: "2px 6px" }}
                  >
                    {Object.entries(HEAD_3DMM_PRESETS).map(([id, p]) => (
                      <option key={id} value={id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </label>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 4,
                    padding: 6,
                    borderRadius: 6,
                    background: "rgba(255,255,255,0.05)",
                    fontSize: 11,
                  }}
                >
                  <span>Cefalico: {anthropometry.cephalicIndex}%</span>
                  <span>Nuca/Face: {anthropometry.nucaToFaceRatio}x</span>
                  <span>Tercio Inf.: {anthropometry.lowerThirdRatio}</span>
                  <span>Pescoco/Mand.: {anthropometry.neckToJawRatio}</span>
                </div>

                {HEAD_TUNING_CONTROLS.map(({ key, label }) => (
                  <label key={key} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>{label}</span>
                      <span>{headTuning[key].toFixed(2)}</span>
                    </div>
                    <input
                      type="range"
                      min={-1}
                      max={1}
                      step={0.05}
                      value={headTuning[key]}
                      onChange={(e) =>
                        setHeadTuning((prev) => ({ ...prev, [key]: parseFloat(e.target.value) }))
                      }
                      style={{ width: "100%" }}
                    />
                  </label>
                ))}

                <button
                  type="button"
                  onClick={() => handlePresetChange("canonical")}
                  style={{
                    padding: "5px 8px",
                    borderRadius: 6,
                    border: "1px solid rgba(255,255,255,0.18)",
                    background: "rgba(255,255,255,0.08)",
                    color: "#fff",
                    cursor: "pointer",
                  }}
                >
                  Restaurar Proporcoes Padrao
                </button>
              </div>
            )}

            {activeTab === "blendshapes" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {FACIAL_BLENDSHAPE_NAMES.map((name) => (
                  <label key={name} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>{BLENDSHAPE_LABELS[name]}</span>
                      <span>{blendshapes[name].toFixed(2)}</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.02}
                      value={blendshapes[name]}
                      onChange={(e) =>
                        setBlendshapes((prev) => ({ ...prev, [name]: parseFloat(e.target.value) }))
                      }
                      style={{ width: "100%" }}
                    />
                  </label>
                ))}
                <button
                  type="button"
                  onClick={() => setBlendshapes({ ...DEFAULT_FACIAL_BLENDSHAPES })}
                  style={{
                    padding: "5px 8px",
                    borderRadius: 6,
                    border: "1px solid rgba(255,255,255,0.18)",
                    background: "rgba(255,255,255,0.08)",
                    color: "#fff",
                    cursor: "pointer",
                  }}
                >
                  Zerar Expressoes
                </button>
              </div>
            )}

            {activeTab === "body" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <label style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span>Pose:</span>
                  <select value={poseMode} onChange={(e) => setPoseMode(e.target.value as RickPoseMode)}>
                    <option value="idle">Idle</option>
                    <option value="walk">Walk</option>
                    <option value="attack">Attack</option>
                    <option value="grab">Grab</option>
                    <option value="jump">Jump</option>
                  </select>
                </label>

                <label style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span>Arma:</span>
                  <select
                    value={weapon ?? ""}
                    onChange={(e) => setWeapon((e.target.value || null) as RickWeaponId | null)}
                  >
                    <option value="">Nenhuma</option>
                    <option value="pipe">Cano</option>
                    <option value="machete">Machete</option>
                    <option value="shotgun">Shotgun</option>
                  </select>
                </label>

                <label>
                  Sangue / Brilho: {bloodIntensity.toFixed(2)}
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={bloodIntensity}
                    onChange={(e) => setBloodIntensity(parseFloat(e.target.value))}
                    style={{ width: "100%" }}
                  />
                </label>

                <label>
                  Flexao Esq.: {leftFlex.toFixed(2)}
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={leftFlex}
                    onChange={(e) => setLeftFlex(parseFloat(e.target.value))}
                    style={{ width: "100%" }}
                  />
                </label>

                <label>
                  Flexao Dir.: {rightFlex.toFixed(2)}
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={rightFlex}
                    onChange={(e) => setRightFlex(parseFloat(e.target.value))}
                    style={{ width: "100%" }}
                  />
                </label>

                <label>
                  Tensao Pernas: {legFlex.toFixed(2)}
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={legFlex}
                    onChange={(e) => setLegFlex(parseFloat(e.target.value))}
                    style={{ width: "100%" }}
                  />
                </label>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
