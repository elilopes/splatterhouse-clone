import React, { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, Environment, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { createProceduralSurfaceMaps } from "./proceduralSurfaceMaps";

export type RickWeaponId = "pipe" | "machete" | "shotgun";

export type RickPipeAttackStyle = "bat" | "overhead" | "macheteHead" | "macheteArm";

export type RickPoseMode = "idle" | "walk" | "attack" | "grab" | "jump";

export type RickMotion = {
  moving: boolean;
  attackTime: number;
  attackStyle: RickPipeAttackStyle | null;
  attackProgress: number;
  grabTime: number;
  jumpHeight: number;
  weapon: RickWeaponId | null;
  shotgunAimPitch?: number;
  shotgunAimYaw?: number;
  leftFlex?: number;
  rightFlex?: number;
  legFlex?: number;
};

type CharacterProps = {
  motion: RickMotion;
  equippedWeapon?: RickWeaponId | null;
  bloodIntensity?: number;
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

  mCtx.fillStyle = "#f2efe6";
  mCtx.fillRect(0, 0, size, size);
  mbCtx.fillStyle = "rgb(128,128,128)";
  mbCtx.fillRect(0, 0, size, size);

  for (let b = 0; b < 900; b++) {
    const bx = deterministicNoise(b * 61.1) * size;
    const by = deterministicNoise(b * 67.7) * size;
    const br = 2 + deterministicNoise(b * 71.9) * 18;
    mCtx.fillStyle = b % 2 === 0 ? "rgba(185,175,155,0.12)" : "rgba(255,252,245,0.14)";
    mCtx.beginPath();
    mCtx.arc(bx, by, br, 0, Math.PI * 2);
    mCtx.fill();

    mbCtx.fillStyle = b % 2 === 0 ? "rgba(165,165,165,0.2)" : "rgba(95,95,95,0.2)";
    mbCtx.fillRect(bx, by, br * 0.6, br * 0.6);
  }

  const maskMap = new THREE.CanvasTexture(maskCanvas);
  maskMap.colorSpace = THREE.SRGBColorSpace;
  maskMap.wrapS = maskMap.wrapT = THREE.RepeatWrapping;

  const maskBumpMap = new THREE.CanvasTexture(maskBumpCanvas);
  maskBumpMap.wrapS = maskBumpMap.wrapT = THREE.RepeatWrapping;

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
    [-0.29, 0.285, 0.205],
    [-0.20, 0.305, 0.215],
    [-0.06, 0.315, 0.210],
    [0.10, 0.295, 0.202],
    [0.26, 0.345, 0.222],
    [0.44, 0.415, 0.245],
    [0.59, 0.445, 0.254],
    [0.72, 0.420, 0.232],
    [0.83, 0.305, 0.192],
    [0.94, 0.215, 0.168],
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
        const t = smoothstep(-0.29, 0.05, yLocal);
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
          smoothstep(0.24, 0.43, Math.abs(x)) * Math.exp(-Math.pow((yLocal - 0.59) / 0.16, 2));
        const armBone = x < 0 ? BONE_L_SHOULDER : BONE_R_SHOULDER;
        b0 = BONE_CHEST;
        w0 = 1 - latFactor * 0.36;
        b1 = armBone;
        w1 = latFactor * 0.36;
        b2 = BONE_SPINE;
        w2 = 0.08 * (1 - latFactor);
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
      if (t < 0.22) {
        cx = side * THREE.MathUtils.lerp(0.34, 0.475, smoothstep(0, 0.22, t));
      } else if (t < 0.45) {
        cx = side * THREE.MathUtils.lerp(0.475, 0.495, smoothstep(0.22, 0.45, t));
      } else {
        cx = side * THREE.MathUtils.lerp(0.495, 0.55, smoothstep(0.45, 1.0, t));
      }

      const cy = THREE.MathUtils.lerp(1.68, 1.11, t) + Math.sin(t * Math.PI) * 0.012;
      const cz = THREE.MathUtils.lerp(0.01, -0.015, smoothstep(0.18, 1.0, t));

      const endPinch =
        t < 0.04
          ? smoothstep(0, 0.04, t) * 0.35 + 0.65
          : t > 0.96
          ? smoothstep(1.0, 0.96, t) * 0.3 + 0.7
          : 1.0;

      const baseR = THREE.MathUtils.lerp(0.132, 0.114, smoothstep(0.15, 1.0, t));

      const deltoidCap = Math.exp(-Math.pow((t - 0.17) / 0.105, 2));
      const deltoidDip = Math.exp(-Math.pow((t - 0.34) / 0.068, 2));
      const bicepBell = Math.exp(-Math.pow((t - 0.56) / 0.145, 2));
      const tricepBell = Math.exp(-Math.pow((t - 0.49) / 0.135, 2));
      const elbowCondyle = Math.exp(-Math.pow((t - 0.91) / 0.07, 2));

      for (let ix = 0; ix <= armSegs; ix++) {
        const u = ix / armSegs;
        const angle = u * Math.PI * 2;
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);
        const out = cosA * side;
        const front = -sinA;

        const deltSculpt =
          deltoidCap * (0.036 * Math.max(0, out + 0.32) + 0.014 * Math.max(0, front + 0.25));
        const insertionGroove = deltoidDip * (0.019 * Math.max(0, out + 0.25) + 0.008);
        const bicepSculpt =
          bicepBell * (0.035 * Math.pow(Math.max(0, front), 1.25) + 0.01 * Math.max(0, out));
        const tricepSculpt =
          tricepBell *
          (0.03 * Math.pow(Math.max(0, -front), 1.2) * (0.7 + 0.3 * Math.abs(out)));
        const lateralGroove =
          Math.exp(-Math.pow(front / 0.32, 2)) *
          Math.max(0, out) *
          Math.exp(-Math.pow((t - 0.54) / 0.17, 2)) *
          0.009;
        const medialFlatten = Math.max(0, -out) * 0.015 * (1 - smoothstep(0.65, 0.95, t));
        const condyleFlare = elbowCondyle * Math.abs(cosA) * 0.008;

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
        const pz = cz + sinA * (r * (0.98 + 0.06 * bicepBell));

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
              Math.exp(-(Math.pow((t - 0.44) / 0.09, 2) + Math.pow((front - 0.65) / 0.35, 2))) * 0.85
            : Math.exp(-(Math.pow((t - 0.16) / 0.09, 2) + Math.pow((front - 0.72) / 0.38, 2))) +
              Math.exp(-(Math.pow((t - 0.32) / 0.1, 2) + Math.pow((out - 0.55) / 0.45, 2))) * 0.8;
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
        if (t < 0.32) {
          const blend = smoothstep(0.0, 0.32, t);
          b0 = BONE_CHEST;
          w0 = (1 - blend) * 0.72;
          b1 = armBone;
          w1 = 1 - w0;
        } else if (t > 0.8) {
          const blend = smoothstep(0.8, 1.0, t);
          b0 = armBone;
          w0 = 1 - blend * 0.38;
          b1 = elbowBone;
          w1 = blend * 0.38;
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
  const rings = 42;
  const segs = 44;
  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  for (let iy = 0; iy <= rings; iy++) {
    const v = iy / rings;
    const y = THREE.MathUtils.lerp(-0.29, 0.31, v);
    const vNorm = THREE.MathUtils.clamp((y + 0.29) / 0.6, 0, 1);

    const jawTaper = smoothstep(0.0, 0.46, vNorm);
    const domeTaper = Math.sin(Math.pow(vNorm, 0.78) * Math.PI);
    const rx = THREE.MathUtils.lerp(0.18, 0.325, jawTaper) * (0.68 + 0.32 * domeTaper);
    const rz = THREE.MathUtils.lerp(0.16, 0.27, jawTaper) * (0.62 + 0.38 * domeTaper);

    for (let ix = 0; ix <= segs; ix++) {
      const u = ix / segs;
      const angle = u * Math.PI * 2;
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);
      const front = Math.max(0, -sinA);

      const xBase = cosA * rx;
      const brow =
        Math.exp(-Math.pow((y - 0.14) / 0.045, 2)) *
        (1 - smoothstep(0.14, 0.26, Math.abs(xBase))) *
        front;
      const cheek =
        Math.exp(-Math.pow((y + 0.01) / 0.05, 2)) *
        Math.exp(-Math.pow((Math.abs(xBase) - 0.18) / 0.06, 2)) *
        front;
      const eyeSocket =
        Math.exp(-Math.pow((y - 0.07) / 0.048, 2)) *
        Math.exp(-Math.pow((Math.abs(xBase) - 0.115) / 0.055, 2)) *
        front;
      const noseSocket =
        Math.exp(-Math.pow((y + 0.05) / 0.055, 2)) *
        Math.exp(-Math.pow(xBase / 0.042, 2)) *
        front;
      const mouthSlot =
        Math.exp(-Math.pow((y + 0.185) / 0.045, 2)) *
        Math.exp(-Math.pow(xBase / 0.135, 2)) *
        front;
      const teethRidge =
        Math.exp(-Math.pow((y + 0.185) / 0.025, 2)) *
        (0.5 + 0.5 * Math.cos(xBase * 52)) *
        (1 - smoothstep(0.1, 0.15, Math.abs(xBase))) *
        front;

      const zOffset = -0.045 * front;
      const relief =
        brow * 0.028 +
        cheek * 0.024 -
        eyeSocket * 0.065 -
        noseSocket * 0.052 -
        mouthSlot * 0.05 +
        teethRidge * 0.024;
      const z = sinA * rz + zOffset - relief * front;

      positions.push(xBase, y, z);
      uvs.push(u, v);

      const darkCav = Math.min(
        1,
        eyeSocket * 1.45 + noseSocket * 1.4 + mouthSlot * 1.25 * (1 - teethRidge * 0.75)
      );
      let rC = 0.96 - darkCav * 0.85;
      let gC = 0.94 - darkCav * 0.84;
      let bC = 0.88 - darkCav * 0.78;
      const jawBlood =
        Math.exp(-(Math.pow((xBase + 0.11) / 0.08, 2) + Math.pow((y + 0.19) / 0.07, 2))) *
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
  bloodIntensity = 0.85,
}: CharacterProps) {
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

  const canvasMaps = useMemo(() => createProceduralPBRMaps(), []);
  const skinSurfaceMaps = useMemo(
    () => createProceduralSurfaceMaps("skin", 512, bloodIntensity),
    [bloodIntensity]
  );
  const denimSurfaceMaps = useMemo(
    () => createProceduralSurfaceMaps("denim", 512, bloodIntensity * 0.75),
    [bloodIntensity]
  );

  useEffect(() => {
    return () => {
      skinSurfaceMaps.dispose();
      denimSurfaceMaps.dispose();
    };
  }, [skinSurfaceMaps, denimSurfaceMaps]);

  const {
    upperBodyGeo,
    trousersGeo,
    maskGeo,
    bootGeo,
    sphereGeo,
    skinMat,
    jeansMat,
    maskMat,
    darkVoidMat,
    leatherMat,
    metalMat,
    skinnedUpperBody,
    skinnedTrousers,
  } = useMemo(() => {
    const uBody = createUpperBodySkinnedGeometry();
    const trs = createTrousersSkinnedGeometry();
    const msk = createTerrorMaskGeometry();
    const bt = createCombatBootGeometry();
    const sph = new THREE.SphereGeometry(1, 20, 16);

    const sMat = new THREE.MeshStandardMaterial({
      map: canvasMaps.skinMap,
      normalMap: skinSurfaceMaps.normalMap,
      normalScale: new THREE.Vector2(0.9, 0.9),
      aoMap: skinSurfaceMaps.aoMap,
      aoMapIntensity: 1.15,
      roughnessMap: skinSurfaceMaps.roughnessMap,
      roughness: 1.0,
      metalness: 0.0,
      vertexColors: true,
    });

    const jMat = new THREE.MeshStandardMaterial({
      map: canvasMaps.jeansMap,
      normalMap: denimSurfaceMaps.normalMap,
      normalScale: new THREE.Vector2(1.0, 1.0),
      aoMap: denimSurfaceMaps.aoMap,
      aoMapIntensity: 1.2,
      roughnessMap: denimSurfaceMaps.roughnessMap,
      roughness: 1.0,
      metalness: 0.0,
      vertexColors: true,
    });

    const mMat = new THREE.MeshStandardMaterial({
      map: canvasMaps.maskMap,
      bumpMap: canvasMaps.maskBumpMap,
      bumpScale: 0.012,
      roughness: 0.58,
      metalness: 0.02,
      vertexColors: true,
    });

    const dMat = new THREE.MeshBasicMaterial({ color: "#09090b" });
    const lMat = new THREE.MeshStandardMaterial({
      color: "#2c1b14",
      roughness: 0.55,
      metalness: 0.08,
    });
    const mtMat = new THREE.MeshStandardMaterial({
      color: "#a8b0bc",
      roughness: 0.28,
      metalness: 0.85,
    });

    const bones: THREE.Bone[] = [];
    for (let i = 0; i < 13; i++) {
      bones.push(new THREE.Bone());
    }
    bones[BONE_HIPS].position.set(0, 0.95, 0);
    bones[BONE_SPINE].position.set(0, 0.16, 0);
    bones[BONE_CHEST].position.set(0, 0.34, 0);
    bones[BONE_NECK].position.set(0, 0.42, 0);
    bones[BONE_HEAD].position.set(0, 0.16, 0);

    bones[BONE_L_SHOULDER].position.set(-0.36, 0.32, 0);
    bones[BONE_L_ELBOW].position.set(-0.18, -0.56, -0.01);
    bones[BONE_R_SHOULDER].position.set(0.36, 0.32, 0);
    bones[BONE_R_ELBOW].position.set(0.18, -0.56, -0.01);

    bones[BONE_L_THIGH].position.set(-0.162, -0.02, 0);
    bones[BONE_L_KNEE].position.set(0, -0.44, 0);
    bones[BONE_R_THIGH].position.set(0.162, -0.02, 0);
    bones[BONE_R_KNEE].position.set(0, -0.44, 0);

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

    const skeleton = new THREE.Skeleton(bones);

    const meshUpper = new THREE.SkinnedMesh(uBody, sMat);
    meshUpper.add(bones[BONE_HIPS]);
    meshUpper.bind(skeleton);
    meshUpper.castShadow = true;
    meshUpper.receiveShadow = true;

    const meshTrousers = new THREE.SkinnedMesh(trs, jMat);
    meshTrousers.bind(skeleton);
    meshTrousers.castShadow = true;
    meshTrousers.receiveShadow = true;

    return {
      upperBodyGeo: uBody,
      trousersGeo: trs,
      maskGeo: msk,
      bootGeo: bt,
      sphereGeo: sph,
      skinMat: sMat,
      jeansMat: jMat,
      maskMat: mMat,
      darkVoidMat: dMat,
      leatherMat: lMat,
      metalMat: mtMat,
      skinnedUpperBody: meshUpper,
      skinnedTrousers: meshTrousers,
    };
  }, [canvasMaps, skinSurfaceMaps, denimSurfaceMaps]);

  useEffect(() => {
    return () => {
      upperBodyGeo.dispose();
      trousersGeo.dispose();
      maskGeo.dispose();
      bootGeo.dispose();
      sphereGeo.dispose();
      skinMat.dispose();
      jeansMat.dispose();
      maskMat.dispose();
      darkVoidMat.dispose();
      leatherMat.dispose();
      metalMat.dispose();
      Object.values(canvasMaps).forEach((tex) => tex.dispose());
    };
  }, [
    upperBodyGeo,
    trousersGeo,
    maskGeo,
    bootGeo,
    sphereGeo,
    skinMat,
    jeansMat,
    maskMat,
    darkVoidMat,
    leatherMat,
    metalMat,
    canvasMaps,
  ]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    if (motion.moving || motion.jumpHeight > 0.01) {
      gaitPhase.current += dt * (motion.moving ? 9.5 : 3.0);
    } else {
      gaitPhase.current += dt * 1.8;
    }

    const p = gaitPhase.current;
    const isAttacking = motion.attackTime > 0;
    const isGrabbing = motion.grabTime > 0;
    const swingLeg = motion.moving ? Math.sin(p) * 0.55 : 0;

    const targetLeftFlex =
      (motion.leftFlex ?? 0.15) + (isGrabbing ? 0.45 : motion.moving ? Math.max(0, -swingLeg) * 0.35 : 0.05);
    const targetRightFlex =
      (motion.rightFlex ?? 0.18) + (isAttacking ? 0.75 : motion.moving ? Math.max(0, swingLeg) * 0.35 : 0.08);
    const targetLegFlex = (motion.legFlex ?? 0.1) + (motion.moving ? Math.abs(swingLeg) * 0.45 : 0);

    flexState.current.left = THREE.MathUtils.lerp(flexState.current.left, targetLeftFlex, dt * 12);
    flexState.current.right = THREE.MathUtils.lerp(flexState.current.right, targetRightFlex, dt * 12);
    flexState.current.leg = THREE.MathUtils.lerp(flexState.current.leg, targetLegFlex, dt * 12);

    const breathWeight = 0.5 + 0.5 * Math.sin(p * 1.15);
    if (skinnedUpperBody.morphTargetInfluences) {
      skinnedUpperBody.morphTargetInfluences[0] = breathWeight;
      skinnedUpperBody.morphTargetInfluences[1] = THREE.MathUtils.clamp(flexState.current.left, 0, 1);
      skinnedUpperBody.morphTargetInfluences[2] = THREE.MathUtils.clamp(flexState.current.right, 0, 1);
    }
    if (skinnedTrousers.morphTargetInfluences) {
      skinnedTrousers.morphTargetInfluences[0] = THREE.MathUtils.clamp(flexState.current.leg, 0, 1);
    }

    const attackSwing = isAttacking ? Math.sin(THREE.MathUtils.clamp(motion.attackProgress, 0, 1) * Math.PI) : 0;
    const spineTwist = attackSwing * 0.38 - swingLeg * 0.08;
    const chestPitch = attackSwing * 0.22 + (isGrabbing ? 0.16 : 0.03);

    const skel = skinnedUpperBody.skeleton;
    if (skel && skel.bones.length >= 13) {
      const b = skel.bones;

      _matHips.makeRotationFromEuler(new THREE.Euler(0, swingLeg * 0.12, 0));
      _matHips.setPosition(0, 0.95 + motion.jumpHeight, 0);
      b[BONE_HIPS].matrix.copy(_matHips);

      _matSpine.makeRotationFromEuler(new THREE.Euler(chestPitch * 0.5, spineTwist * 0.5, 0));
      _matSpine.setPosition(0, 0.16, 0);
      b[BONE_SPINE].matrix.copy(_matSpine);

      _matChest.makeRotationFromEuler(new THREE.Euler(chestPitch * 0.5, spineTwist * 0.5, 0));
      _matChest.setPosition(0, 0.34, 0);
      b[BONE_CHEST].matrix.copy(_matChest);

      _matNeck.makeRotationFromEuler(new THREE.Euler(-chestPitch * 0.3, -spineTwist * 0.3, 0));
      _matNeck.setPosition(0, 0.42, 0);
      b[BONE_NECK].matrix.copy(_matNeck);

      _matHead.makeRotationFromEuler(
        new THREE.Euler(
          motion.shotgunAimPitch ?? -chestPitch * 0.2,
          motion.shotgunAimYaw ?? -spineTwist * 0.2,
          0
        )
      );
      _matHead.setPosition(0, 0.16, 0);
      b[BONE_HEAD].matrix.copy(_matHead);

      const lShPitch = isGrabbing ? -1.15 : swingLeg * 0.65 - 0.12;
      const lElbPitch = isGrabbing ? -0.45 : -0.42 - flexState.current.left * 0.3;
      _matLShoulder.makeRotationFromEuler(new THREE.Euler(lShPitch, 0, -0.18));
      _matLShoulder.setPosition(-0.36, 0.32, 0);
      b[BONE_L_SHOULDER].matrix.copy(_matLShoulder);

      _matLElbow.makeRotationFromEuler(new THREE.Euler(lElbPitch, 0, 0));
      _matLElbow.setPosition(-0.18, -0.56, -0.01);
      b[BONE_L_ELBOW].matrix.copy(_matLElbow);

      const rShPitch = isAttacking ? -1.65 * attackSwing - 0.2 : -swingLeg * 0.65 - 0.12;
      const rElbPitch = isAttacking ? -0.25 - attackSwing * 0.35 : -0.42 - flexState.current.right * 0.3;
      _matRShoulder.makeRotationFromEuler(new THREE.Euler(rShPitch, attackSwing * 0.3, 0.18));
      _matRShoulder.setPosition(0.36, 0.32, 0);
      b[BONE_R_SHOULDER].matrix.copy(_matRShoulder);

      _matRElbow.makeRotationFromEuler(new THREE.Euler(rElbPitch, 0, 0));
      _matRElbow.setPosition(0.18, -0.56, -0.01);
      b[BONE_R_ELBOW].matrix.copy(_matRElbow);

      const lThighPitch = swingLeg;
      const lKneePitch = Math.max(0, -swingLeg) * 0.75 + 0.08;
      _matLThigh.makeRotationFromEuler(new THREE.Euler(lThighPitch, 0, 0));
      _matLThigh.setPosition(-0.162, -0.02, 0);
      b[BONE_L_THIGH].matrix.copy(_matLThigh);

      _matLKnee.makeRotationFromEuler(new THREE.Euler(lKneePitch, 0, 0));
      _matLKnee.setPosition(0, -0.44, 0);
      b[BONE_L_KNEE].matrix.copy(_matLKnee);

      const rThighPitch = -swingLeg;
      const rKneePitch = Math.max(0, swingLeg) * 0.75 + 0.08;
      _matRThigh.makeRotationFromEuler(new THREE.Euler(rThighPitch, 0, 0));
      _matRThigh.setPosition(0.162, -0.02, 0);
      b[BONE_R_THIGH].matrix.copy(_matRThigh);

      _matRKnee.makeRotationFromEuler(new THREE.Euler(rKneePitch, 0, 0));
      _matRKnee.setPosition(0, -0.44, 0);
      b[BONE_R_KNEE].matrix.copy(_matRKnee);

      for (let i = 0; i < b.length; i++) {
        b[i].matrixAutoUpdate = false;
      }
      b[BONE_HIPS].updateMatrixWorld(true);
      skel.update();

      if (headMount.current) {
        headMount.current.position.set(0, 2.08 + motion.jumpHeight, 0.02);
        headMount.current.rotation.set(
          motion.shotgunAimPitch ?? 0,
          motion.shotgunAimYaw ?? 0,
          0
        );
      }
      if (beltMount.current) {
        beltMount.current.position.set(0, 1.03 + motion.jumpHeight, 0);
      }
      if (leftArmMount.current && leftForearm.current) {
        leftArmMount.current.position.set(-0.55, 1.12 + motion.jumpHeight, -0.015);
        leftArmMount.current.rotation.set(lShPitch + lElbPitch, 0, -0.14);
      }
      if (rightArmMount.current && rightForearm.current) {
        rightArmMount.current.position.set(0.55, 1.12 + motion.jumpHeight, -0.015);
        rightArmMount.current.rotation.set(rShPitch + rElbPitch, attackSwing * 0.25, 0.14);
      }
      if (leftBootMount.current) {
        leftBootMount.current.position.set(-0.175, 0.45 + motion.jumpHeight + Math.max(0, -swingLeg) * 0.08, swingLeg * 0.14);
        leftBootMount.current.rotation.set(swingLeg * 0.4, 0, 0);
      }
      if (rightBootMount.current) {
        rightBootMount.current.position.set(0.175, 0.45 + motion.jumpHeight + Math.max(0, swingLeg) * 0.08, -swingLeg * 0.14);
        rightBootMount.current.rotation.set(-swingLeg * 0.4, 0, 0);
      }
    }
  });

  const activeWeapon = equippedWeapon ?? motion.weapon;

  return (
    <group ref={root}>
      <primitive object={skinnedUpperBody} />
      <primitive object={skinnedTrousers} />

      <group ref={beltMount} position={[0, 1.03, 0]}>
        <mesh position={[0, 0, 0]} material={leatherMat} castShadow>
          <cylinderGeometry args={[0.295, 0.295, 0.075, 28]} />
        </mesh>
        <mesh position={[0, 0, -0.295]} material={metalMat}>
          <boxGeometry args={[0.09, 0.07, 0.025]} />
        </mesh>
      </group>

      <group ref={headMount} position={[0, 2.08, 0.02]}>
        <mesh geometry={maskGeo} material={maskMat} castShadow receiveShadow />
        {ellipsoid(sphereGeo, darkVoidMat, [-0.115, 0.07, -0.195], [0.052, 0.04, 0.025])}
        {ellipsoid(sphereGeo, darkVoidMat, [0.115, 0.07, -0.195], [0.052, 0.04, 0.025])}
        {ellipsoid(sphereGeo, darkVoidMat, [0, -0.045, -0.205], [0.032, 0.042, 0.025])}
      </group>

      <group ref={leftArmMount} position={[-0.55, 1.12, -0.015]}>
        <group ref={leftForearm}>
          <mesh position={[0, -0.18, 0]} material={skinMat} castShadow receiveShadow>
            <capsuleGeometry args={[0.105, 0.28, 10, 16]} />
          </mesh>
          {ellipsoid(sphereGeo, skinMat, [0, -0.37, -0.01], [0.105, 0.095, 0.12])}
        </group>
      </group>

      <group ref={rightArmMount} position={[0.55, 1.12, -0.015]}>
        <group ref={rightForearm}>
          <mesh position={[0, -0.18, 0]} material={skinMat} castShadow receiveShadow>
            <capsuleGeometry args={[0.105, 0.28, 10, 16]} />
          </mesh>
          {ellipsoid(sphereGeo, skinMat, [0, -0.37, -0.01], [0.105, 0.095, 0.12])}
          {activeWeapon && (
            <group position={[0, -0.38, -0.06]}>
              <HeldWeaponMesh id={activeWeapon} muzzleRef={muzzleRef} />
            </group>
          )}
        </group>
      </group>

      <group ref={leftBootMount} position={[-0.175, 0.45, 0]}>
        <mesh geometry={bootGeo} material={leatherMat} castShadow receiveShadow />
      </group>

      <group ref={rightBootMount} position={[0.175, 0.45, 0]}>
        <mesh geometry={bootGeo} material={leatherMat} castShadow receiveShadow />
      </group>
    </group>
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

export default function RickTaylorCharacter3DHD() {
  const [backend, setBackend] = useState<"WebGPU" | "WebGL">("WebGL");
  const [poseMode, setPoseMode] = useState<RickPoseMode>("idle");
  const [weapon, setWeapon] = useState<RickWeaponId | null>("pipe");
  const [bloodIntensity, setBloodIntensity] = useState<number>(0.85);
  const [leftFlex, setLeftFlex] = useState<number>(0.25);
  const [rightFlex, setRightFlex] = useState<number>(0.35);
  const [legFlex, setLegFlex] = useState<number>(0.15);

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

  return (
    <div style={{ width: "100vw", height: "100vh", position: "relative", background: "#141418" }}>
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ position: [0, 1.35, 3.2], fov: 42 }}
      >
        <color attach="background" args={["#18181f"]} />
        <RendererInitHelper onReady={setBackend} />

        <ambientLight intensity={0.65} />
        <directionalLight position={[3, 5, 4]} intensity={1.5} castShadow />
        <directionalLight position={[-3, 2, -2]} intensity={0.5} color="#9bb8ff" />

        <RickTaylorRig
          motion={motion}
          equippedWeapon={weapon}
          bloodIntensity={bloodIntensity}
        />

        <ContactShadows position={[0, 0, 0]} opacity={0.55} scale={6} blur={1.8} />
        <Environment preset="studio" />
        <OrbitControls target={[0, 1.15, 0]} />
      </Canvas>

      <div
        style={{
          position: "absolute",
          top: 16,
          left: 16,
          padding: 14,
          borderRadius: 10,
          background: "rgba(18, 18, 24, 0.88)",
          color: "#f4f4f6",
          fontFamily: "system-ui, sans-serif",
          fontSize: 13,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          minWidth: 240,
        }}
      >
        <div>
          <strong>Rick Taylor 3D HD</strong> ({backend})
        </div>

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
          Flexão Esq.: {leftFlex.toFixed(2)}
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
          Flexão Dir.: {rightFlex.toFixed(2)}
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
          Tensão Pernas: {legFlex.toFixed(2)}
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
    </div>
  );
}
