import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

export type RickWeaponId = "pipe" | "machete" | "shotgun";

export type RickPipeAttackStyle = "bat" | "overhead" | "macheteHead" | "macheteArm";

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
};

type Props = { motion: RickMotion; equippedWeapon?: RickWeaponId | null };

const _matHips = new THREE.Matrix4();
const _matSpine = new THREE.Matrix4();
const _matChest = new THREE.Matrix4();
const _matNeck = new THREE.Matrix4();
const _matHead = new THREE.Matrix4();
const _matLShoulder = new THREE.Matrix4();
const _matRShoulder = new THREE.Matrix4();
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

function smoothstep(edge0: number, edge1: number, x: number) {
  const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
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
  geometry.computeTangents();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Continuous skinned torso, clavicles, trapezius, neck, and undulating upper arms.
 * Eliminates robot-like overlapping primitives via dual-bone skinning weights and
 * additive muscular morph targets (breathing + left/right deltoid/bicep/pec flex).
 */
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

  // 1) Torso + Neck loft in root space (y = 0.76 -> 2.08, matching torso origin y = 1.05)
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

  const torsoRings = 78;
  const torsoSegs = 96;
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
    const f = f0 * f0 * (3 - 2 * f0);
    const rx = THREE.MathUtils.lerp(a[1], b[1], f);
    const rz = THREE.MathUtils.lerp(a[2], b[2], f);

    for (let ix = 0; ix <= torsoSegs; ix++) {
      const u = ix / torsoSegs;
      const angle = u * Math.PI * 2;
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);
      const front = Math.max(0, -sinA);
      const back = Math.max(0, sinA);

      // Pectoralis major + sternum cleft + lower pec undercut
      const pecBand = Math.exp(-Math.pow((yLocal - 0.57) / 0.14, 2));
      const sternumGroove = Math.exp(-Math.pow(cosA / 0.16, 2)) * front * pecBand;
      const pecMass = pecBand * Math.pow(Math.abs(cosA), 0.7) * (1 - Math.exp(-Math.pow(cosA / 0.22, 2))) * front;
      const pecLowerEdge = Math.exp(-Math.pow((yLocal - 0.435) / 0.032, 2)) * front * Math.pow(Math.abs(cosA), 0.8);

      // Rectus abdominis (6-pack) + linea alba + obliques
      const absCol = Math.exp(-Math.pow((Math.abs(cosA) - 0.24) / 0.15, 2)) * front;
      const absRow =
        Math.exp(-Math.pow((yLocal - 0.31) / 0.055, 2)) +
        Math.exp(-Math.pow((yLocal - 0.19) / 0.055, 2)) +
        Math.exp(-Math.pow((yLocal - 0.06) / 0.065, 2));
      const lineaAlba = Math.exp(-Math.pow(cosA / 0.09, 2)) * front * Math.exp(-Math.pow((yLocal - 0.18) / 0.22, 2));
      const oblique = Math.exp(-Math.pow((yLocal - 0.14) / 0.14, 2)) * Math.pow(Math.abs(cosA), 2.4) * (0.65 + 0.35 * front);

      // Latissimus dorsi & spinal furrow on back
      const lats = Math.exp(-Math.pow((yLocal - 0.48) / 0.18, 2)) * Math.pow(Math.abs(cosA), 1.4) * back;
      const spineFurrow = Math.exp(-Math.pow(cosA / 0.15, 2)) * back * smoothstep(-0.15, 0.72, yLocal) * (1 - smoothstep(0.72, 0.92, yLocal));

      // Clavicle & SCM neck cords
      const clavicle = Math.exp(-Math.pow((yLocal - 0.76) / 0.035, 2)) * front * (0.25 + 0.75 * Math.abs(cosA));
      const neckCords = Math.exp(-Math.pow((yLocal - 0.91) / 0.09, 2)) * Math.exp(-Math.pow((Math.abs(cosA) - 0.38) / 0.18, 2)) * front;

      const xMod = rx + lats * 0.022 + oblique * 0.015 + pecMass * 0.014;
      const zMod =
        rz +
        front * (pecMass * 0.028 - pecLowerEdge * 0.008 - sternumGroove * 0.018 + absCol * absRow * 0.014 - lineaAlba * 0.009 + clavicle * 0.008 + neckCords * 0.007) +
        back * (lats * 0.016 - spineFurrow * 0.018);

      const x = cosA * xMod;
      const z = sinA * zMod;
      positions.push(x, yRoot, z);
      uvs.push(u * 2.2, v * 2.2);

      // Anatomical vertex coloring: cavity AO + warm muscular crests + horror blood smears
      const cavity =
        sternumGroove * 0.18 +
        lineaAlba * 0.14 +
        spineFurrow * 0.20 +
        pecLowerEdge * 0.12 +
        Math.max(0, 0.45 - Math.abs(yLocal - 0.56)) * Math.pow(Math.abs(cosA), 4) * 0.18;
      let rCol = 1.0 - cavity * 0.55;
      let gCol = 0.97 - cavity * 0.78;
      let bCol = 0.95 - cavity * 0.85;

      // Fresh & dried blood smears baked directly onto torso skin
      const smear1 = Math.exp(-(Math.pow((x + 0.25) / 0.11, 2) + Math.pow((yLocal - 0.65) / 0.055, 2))) * front;
      const smear2 = Math.exp(-(Math.pow((x - 0.21) / 0.12, 2) + Math.pow((yLocal - 0.40) / 0.048, 2))) * front;
      const smear3 = Math.exp(-(Math.pow((x + 0.08) / 0.08, 2) + Math.pow((yLocal - 0.07) / 0.045, 2))) * front;
      const streak = Math.exp(-(Math.pow((x + 0.30) / 0.035, 2) + Math.pow((yLocal - 0.55) / 0.11, 2))) * front;
      const bloodAmt = Math.min(1, smear1 * 1.15 + smear2 * 1.05 + smear3 * 0.9 + streak * 1.1);
      if (bloodAmt > 0.04) {
        const bBlend = smoothstep(0.08, 0.55, bloodAmt);
        rCol = THREE.MathUtils.lerp(rCol, 0.42, bBlend);
        gCol = THREE.MathUtils.lerp(gCol, 0.045, bBlend);
        bCol = THREE.MathUtils.lerp(bCol, 0.065, bBlend);
      }
      colors.push(rCol, gCol, bCol);

      // Dual/triple bone skinning weights across torso & shoulder pockets
      let b0 = BONE_CHEST, w0 = 1;
      let b1 = BONE_SPINE, w1 = 0;
      let b2 = BONE_HIPS, w2 = 0;
      let b3 = BONE_HEAD, w3 = 0;

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
        const latFactor = smoothstep(0.24, 0.43, Math.abs(x)) * Math.exp(-Math.pow((yLocal - 0.59) / 0.16, 2));
        const armBone = x < 0 ? BONE_L_SHOULDER : BONE_R_SHOULDER;
        b0 = BONE_CHEST;
        w0 = 1 - latFactor * 0.36;
        b1 = armBone;
        w1 = latFactor * 0.36;
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

      // Morph targets: breathing + left/right pectoral/shoulder flex
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

  // 2) Sculpted Undulating Upper Arms (Left side = -1, Right side = +1)
  // Flows cleanly from inside shoulder socket -> deltoid dome -> deltoid insertion dip ->
  // bicep/tricep swell -> brachialis taper -> forearm top [side*0.55, 1.12, -0.015]
  const armRings = 50;
  const armSegs = 40;

  for (const side of [-1, 1] as const) {
    const armBase = positions.length / 3;
    const armBone = side === -1 ? BONE_L_SHOULDER : BONE_R_SHOULDER;
    const elbowBone = side === -1 ? BONE_L_ELBOW : BONE_R_ELBOW;

    for (let iy = 0; iy <= armRings; iy++) {
      const t = iy / armRings; // 0 = shoulder socket top, 1 = elbow joint

      // Curved humeral centerline for natural anatomical sweep & undulation
      let cx: number;
      if (t < 0.22) {
        const k = smoothstep(0, 0.22, t);
        cx = side * THREE.MathUtils.lerp(0.34, 0.475, k);
      } else if (t < 0.45) {
        const k = smoothstep(0.22, 0.45, t);
        cx = side * THREE.MathUtils.lerp(0.475, 0.495, k);
      } else {
        const k = smoothstep(0.45, 1.0, t);
        cx = side * THREE.MathUtils.lerp(0.495, 0.55, k);
      }

      const cy = THREE.MathUtils.lerp(1.68, 1.11, t) + Math.sin(t * Math.PI) * 0.012;
      const cz = THREE.MathUtils.lerp(0.01, -0.015, smoothstep(0.18, 1.0, t));

      // End-cap closure smoothing at t=0 and t=1
      const endPinch = t < 0.04 ? smoothstep(0, 0.04, t) * 0.35 + 0.65 : t > 0.96 ? smoothstep(1.0, 0.96, t) * 0.30 + 0.70 : 1.0;

      // Base radius tapers cleanly from athletic shoulder to elbow (~0.115 matching forearm capsule 0.12)
      const baseR = THREE.MathUtils.lerp(0.132, 0.114, smoothstep(0.15, 1.0, t));

      // Anatomical undulation along outer/front/back profile
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
        const out = cosA * side; // +1 outer lateral, -1 inner ribcage
        const front = -sinA; // +1 anterior bicep (-Z), -1 posterior tricep (+Z)

        // Sculpted deltoid cap -> crisp V-insertion dip -> high bicep/tricep swell
        const deltSculpt = deltoidCap * (0.036 * Math.max(0, out + 0.32) + 0.014 * Math.max(0, front + 0.25));
        const insertionGroove = deltoidDip * (0.019 * Math.max(0, out + 0.25) + 0.008);
        const bicepSculpt = bicepBell * (0.035 * Math.pow(Math.max(0, front), 1.25) + 0.010 * Math.max(0, out));
        const tricepSculpt = tricepBell * (0.030 * Math.pow(Math.max(0, -front), 1.2) * (0.7 + 0.3 * Math.abs(out)));
        const lateralGroove =
          Math.exp(-Math.pow(front / 0.32, 2)) *
          Math.max(0, out) *
          Math.exp(-Math.pow((t - 0.54) / 0.17, 2)) *
          0.009;
        const medialFlatten = Math.max(0, -out) * 0.015 * (1 - smoothstep(0.65, 0.95, t));
        const condyleFlare = elbowCondyle * Math.abs(cosA) * 0.008;

        const r =
          (baseR + deltSculpt - insertionGroove + bicepSculpt + tricepSculpt - lateralGroove - medialFlatten + condyleFlare) *
          endPinch;

        const px = cx + cosA * r;
        const pz = cz + sinA * (r * (0.98 + 0.06 * bicepBell));

        positions.push(px, cy, pz);
        uvs.push(u * 1.4, t * 1.8);

        // Cavity AO + fresh blood smears on upper arm
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
              Math.exp(-(Math.pow((t - 0.32) / 0.10, 2) + Math.pow((out - 0.55) / 0.45, 2))) * 0.8;
        if (armBlood > 0.08) {
          const bBlend = smoothstep(0.12, 0.6, armBlood);
          rCol = THREE.MathUtils.lerp(rCol, 0.41, bBlend);
          gCol = THREE.MathUtils.lerp(gCol, 0.045, bBlend);
          bCol = THREE.MathUtils.lerp(bCol, 0.06, bBlend);
        }
        colors.push(rCol, gCol, bCol);

        // Smooth dual-bone skinning: chest <-> shoulder <-> elbow
        let b0 = armBone, w0 = 1;
        let b1 = BONE_CHEST, w1 = 0;
        if (t < 0.32) {
          const blend = smoothstep(0.0, 0.32, t);
          b0 = BONE_CHEST;
          w0 = (1 - blend) * 0.72;
          b1 = armBone;
          w1 = 1 - w0;
        } else if (t > 0.80) {
          const blend = smoothstep(0.80, 1.0, t);
          b0 = armBone;
          w0 = 1 - blend * 0.38;
          b1 = elbowBone;
          w1 = blend * 0.38;
        }
        pushSkinWeights(skinIndices, skinWeights, b0, w0, b1, w1);

        // Breathing subtly lifts shoulder origin
        const shLift = Math.max(0, 1 - t * 3.5);
        morphBreath.push(side * shLift * 0.004, shLift * 0.007, 0);

        // Dynamic muscular flex morph target for biceps, deltoids, and triceps
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

/**
 * Continuous skinned denim trousers (pelvis + thighs + knees + calves) replacing stacked spheres.
 */
function createTrousersSkinnedGeometry() {
  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const skinIndices: number[] = [];
  const skinWeights: number[] = [];
  const morphLegStrain: number[] = [];

  // 1) Pelvis & waistband shell (y_root = 0.78 -> 1.07)
  const pelvisProfile: Array<[number, number, number]> = [
    [0.78, 0.255, 0.175],
    [0.85, 0.310, 0.215],
    [0.92, 0.325, 0.228],
    [1.00, 0.300, 0.214],
    [1.07, 0.282, 0.202],
  ];
  const pRings = 22;
  const pSegs = 48;
  const pBase = 0;

  for (let iy = 0; iy <= pRings; iy++) {
    const v = iy / pRings;
    const yRoot = THREE.MathUtils.lerp(0.78, 1.07, v);
    let k = 0;
    while (k < pelvisProfile.length - 2 && yRoot > pelvisProfile[k + 1][0]) k++;
    const a = pelvisProfile[k];
    const b = pelvisProfile[k + 1];
    const f0 = THREE.MathUtils.clamp((yRoot - a[0]) / (b[0] - a[0]), 0, 1);
    const f = f0 * f0 * (3 - 2 * f0);
    const rx = THREE.MathUtils.lerp(a[1], b[1], f);
    const rz = THREE.MathUtils.lerp(a[2], b[2], f);

    for (let ix = 0; ix <= pSegs; ix++) {
      const u = ix / pSegs;
      const angle = u * Math.PI * 2;
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);
      const back = Math.max(0, sinA);
      const glute = Math.exp(-Math.pow((yRoot - 0.88) / 0.08, 2)) * back * (1 - Math.exp(-Math.pow(cosA / 0.18, 2)));
      const x = cosA * rx;
      const z = sinA * (rz + glute * 0.022);
      positions.push(x, yRoot, z);
      uvs.push(u * 2, v * 0.8);

      const creaseAO = Math.exp(-Math.pow(cosA / 0.14, 2)) * back * 0.14 + (1 - v) * 0.12;
      colors.push(0.95 - creaseAO, 0.96 - creaseAO, 1.0 - creaseAO * 0.6);

      // Blend lower hip sides gently into left/right thighs
      const lowerHip = (1 - smoothstep(0.80, 0.94, yRoot)) * smoothstep(0.08, 0.25, Math.abs(x));
      const thighBone = x < 0 ? BONE_L_THIGH : BONE_R_THIGH;
      pushSkinWeights(skinIndices, skinWeights, BONE_HIPS, 1 - lowerHip * 0.35, thighBone, lowerHip * 0.35);
      morphLegStrain.push(0, 0, 0);
    }
  }
  appendGridIndices(indices, pBase, pRings, pSegs, false);

  // 2) Continuous Left & Right Leg Sleeves (y_root = 0.95 -> 0.14)
  const legRings = 44;
  const legSegs = 36;
  for (const side of [-1, 1] as const) {
    const legBase = positions.length / 3;
    const thighBone = side === -1 ? BONE_L_THIGH : BONE_R_THIGH;
    const kneeBone = side === -1 ? BONE_L_KNEE : BONE_R_KNEE;

    for (let iy = 0; iy <= legRings; iy++) {
      const t = iy / legRings; // 0 = hip socket (0.95), 1 = boot cuff (0.14)
      const yRoot = THREE.MathUtils.lerp(0.95, 0.14, t);
      const cx = side * THREE.MathUtils.lerp(0.162, 0.18, smoothstep(0, 0.45, t));
      const cz = Math.sin(t * Math.PI) * -0.012;

      // Anatomical leg profile: muscular quad -> knee taper -> calf swell -> pant cuff
      const quad = Math.exp(-Math.pow((t - 0.26) / 0.18, 2));
      const kneePinch = Math.exp(-Math.pow((t - 0.58) / 0.08, 2));
      const calf = Math.exp(-Math.pow((t - 0.77) / 0.12, 2));
      const cuffFlare = smoothstep(0.90, 1.0, t);

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

        const foldRipple =
          Math.sin(t * 28 + cosA * 2.5) * 0.004 * (0.35 + 0.65 * kneePinch) +
          quad * front * 0.014 +
          calf * back * 0.014;
        const px = cx + cosA * (rx + foldRipple * 0.5);
        const pz = cz + sinA * (rz + foldRipple);

        positions.push(px, yRoot, pz);
        uvs.push(u * 1.5, t * 2.2);

        // Denim whisker fade at thighs & knee + mud/blood splatter near cuffs
        const fade = (quad * front * 0.18 + kneePinch * front * 0.16);
        let rCol = 0.88 + fade;
        let gCol = 0.90 + fade;
        let bCol = 0.96 + fade * 0.7;

        const mudBlood = smoothstep(0.84, 1.0, t) * (0.45 + 0.35 * Math.sin(angle * 3 + side));
        if (mudBlood > 0.1) {
          rCol = THREE.MathUtils.lerp(rCol, 0.38, mudBlood * 0.55);
          gCol = THREE.MathUtils.lerp(gCol, 0.12, mudBlood * 0.65);
          bCol = THREE.MathUtils.lerp(bCol, 0.14, mudBlood * 0.65);
        }
        colors.push(rCol, gCol, bCol);

        // Smooth skinning weights across hip and knee joints
        let b0 = thighBone, w0 = 1;
        let b1 = BONE_HIPS, w1 = 0;
        if (yRoot > 0.75) {
          const blend = smoothstep(0.95, 0.75, yRoot);
          b0 = BONE_HIPS;
          w0 = (1 - blend) * 0.92;
          b1 = thighBone;
          w1 = 1 - w0;
        } else if (yRoot < 0.56) {
          const blend = smoothstep(0.56, 0.40, yRoot);
          b0 = thighBone;
          w0 = 1 - blend;
          b1 = kneeBone;
          w1 = blend;
        }
        pushSkinWeights(skinIndices, skinWeights, b0, w0, b1, w1);

        const strain = quad * 0.010 + calf * 0.008;
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

/**
 * Contoured Terror Mask faceplate geometry sculpted with brow ridge, cheekbones,
 * sunken orbital sockets, nasal cavity, and fanged skull jaw.
 */
function createTerrorMaskGeometry() {
  const rings = 38;
  const segs = 40;
  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  for (let iy = 0; iy <= rings; iy++) {
    const v = iy / rings;
    const y = THREE.MathUtils.lerp(-0.29, 0.31, v);
    const vNorm = THREE.MathUtils.clamp((y + 0.29) / 0.60, 0, 1);

    // Skull outline narrower at jaw, wider at temples/cheekbones
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
      // Sculpted facial reliefs on anterior mask (-Z)
      const brow = Math.exp(-Math.pow((y - 0.14) / 0.045, 2)) * (1 - smoothstep(0.14, 0.26, Math.abs(xBase))) * front;
      const cheek = Math.exp(-Math.pow((y + 0.01) / 0.05, 2)) * Math.exp(-Math.pow((Math.abs(xBase) - 0.18) / 0.06, 2)) * front;
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
        (1 - smoothstep(0.10, 0.15, Math.abs(xBase))) *
        front;

      const zOffset = -0.045 * front;
      const relief = brow * 0.028 + cheek * 0.024 - eyeSocket * 0.065 - noseSocket * 0.052 - mouthSlot * 0.05 + teethRidge * 0.024;
      const z = sinA * rz + zOffset - relief * front;

      positions.push(xBase, y, z);
      uvs.push(u, v);

      const darkCav = Math.min(1, eyeSocket * 1.45 + noseSocket * 1.4 + mouthSlot * 1.25 * (1 - teethRidge * 0.75));
      let rC = 0.96 - darkCav * 0.85;
      let gC = 0.94 - darkCav * 0.84;
      let bC = 0.88 - darkCav * 0.78;
      // Dried blood smudge along lower left mask mandible
      const jawBlood = Math.exp(-(Math.pow((xBase + 0.11) / 0.08, 2) + Math.pow((y + 0.19) / 0.07, 2))) * front * (1 - darkCav * 0.5);
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

/**
 * Contoured leather combat boot geometry (shaft + ankle + vamp + toe cap) for kneeBone space.
 */
function createCombatBootGeometry() {
  const rings = 26;
  const segs = 28;
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
  return <mesh geometry={geometry} material={material} position={position} scale={scale} castShadow receiveShadow />;
}

function HeldWeaponMesh({ id, muzzleRef }: { id: RickWeaponId; muzzleRef: React.RefObject<THREE.Group | null> }) {
  if (id === "pipe") {
    return (
      <group position={[0, 0, -0.35]}>
        <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[0.055, 0.055, 1.35, 12]} />
          <meshStandardMaterial color="#8d9290" metalness={0.82} roughness={0.26} />
        </mesh>
        <mesh position={[0, 0, 0.38]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.068, 0.068, 0.34, 10]} />
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
          <cylinderGeometry args={[0.055, 0.055, 0.34, 10]} />
          <meshStandardMaterial color="#513020" roughness={0.85} />
        </mesh>
      </group>
    );
  }
  return (
    <group position={[0, -0.24, -0.04]} rotation={[-Math.PI / 2, 0, 0]}>
      <mesh position={[0, 0, -0.18]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.045, 0.045, 1.05, 12]} />
        <meshStandardMaterial color="#777c7a" metalness={0.82} roughness={0.25} />
      </mesh>
      <mesh position={[0, -0.045, -0.22]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.042, 0.042, 0.32, 10]} />
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

/**
 * Rick Taylor anatomical horror rig:
 * - Unified Skeleton with dual-bone skinning weights across spine, shoulders, hips, knees
 * - Morph-target muscular flexing (breathing, pectorals, deltoids, biceps/triceps, legs)
 * - 1024x1024 procedural PBR albedo, normal, displacement, roughness & AO maps
 * - Sculpted undulating upper arms seamlessly matching untouched forearms
 */
export default function RickTaylorCharacter({ motion, equippedWeapon = null }: Props) {
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

  const assets = useMemo(() => {
    const texSize = 512;

    // 1) Procedural Skin Albedo with pores, subcutaneous veins & grime
    const skinCanvas = document.createElement("canvas");
    skinCanvas.width = skinCanvas.height = texSize;
    const sCtx = skinCanvas.getContext("2d")!;
    sCtx.fillStyle = "#c88d74";
    sCtx.fillRect(0, 0, texSize, texSize);

    // Subtle branching veins
    sCtx.lineCap = "round";
    for (let v = 0; v < 26; v++) {
      let vx = ((Math.sin(v * 73.1) * 43758.5) % 1 + 1) * 256;
      let vy = ((Math.sin(v * 29.3) * 19231.1) % 1 + 1) * 256;
      sCtx.strokeStyle = v % 2 === 0 ? "rgba(62, 74, 88, 0.14)" : "rgba(112, 46, 44, 0.12)";
      sCtx.lineWidth = 1.2 + (v % 3) * 0.6;
      sCtx.beginPath();
      sCtx.moveTo(vx, vy);
      for (let step = 0; step < 9; step++) {
        vx += Math.sin(v * 3.1 + step * 1.4) * 24;
        vy += 18 + Math.cos(v * 2.3 + step) * 10;
        sCtx.lineTo(vx, vy);
      }
      sCtx.stroke();
    }

    // Pores & organic skin mottling
    for (let i = 0; i < 16000; i++) {
      const x = ((Math.sin(i * 91.7 + 13) * 43758.5) % 1 + 1) * 256;
      const y = ((Math.sin(i * 17.13 + 26) * 12931.7) % 1 + 1) * 256;
      sCtx.globalAlpha = 0.024 + (i % 5) * 0.009;
      sCtx.fillStyle = i % 3 ? "#efc2a6" : "#38211b";
      sCtx.fillRect(x, y, 1 + (i % 3), 1 + (i % 2));
    }
    sCtx.globalAlpha = 1;
    const skinMap = new THREE.CanvasTexture(skinCanvas);
    skinMap.colorSpace = THREE.SRGBColorSpace;
    skinMap.wrapS = skinMap.wrapT = THREE.RepeatWrapping;
    skinMap.anisotropy = 8;

    // 2) Skin Height/Displacement + Roughness + AO + Sobel Normal Map
    const heightCanvas = document.createElement("canvas");
    heightCanvas.width = heightCanvas.height = texSize;
    const hCtx = heightCanvas.getContext("2d")!;
    const hImg = hCtx.createImageData(texSize, texSize);

    const roughCanvas = document.createElement("canvas");
    roughCanvas.width = roughCanvas.height = texSize;
    const rCtx = roughCanvas.getContext("2d")!;
    const rImg = rCtx.createImageData(texSize, texSize);

    const aoCanvas = document.createElement("canvas");
    aoCanvas.width = aoCanvas.height = texSize;
    const aCtx = aoCanvas.getContext("2d")!;
    const aImg = aCtx.createImageData(texSize, texSize);

    for (let y = 0; y < texSize; y++) {
      for (let x = 0; x < texSize; x++) {
        const i = (y * texSize + x) * 4;
        const fx = x / texSize;
        const fy = y / texSize;
        // Multi-scale organic muscle striation + pores
        const striation = Math.sin(fx * Math.PI * 24 + Math.sin(fy * Math.PI * 6) * 2.2) * 0.28;
        const mottling =
          Math.sin(fx * Math.PI * 10 + fy * Math.PI * 4) * 0.32 +
          Math.cos(fx * Math.PI * 32 - fy * Math.PI * 26) * 0.18;
        const pore = Math.sin((x * 13.7 + y * 29.3) * 0.41) * 0.16;
        const hVal = THREE.MathUtils.clamp(128 + (striation + mottling + pore) * 64, 48, 220);
        hImg.data[i] = hImg.data[i + 1] = hImg.data[i + 2] = hVal;
        hImg.data[i + 3] = 255;

        // Sweat & pore roughness contrast (lower = wetter sheen)
        const sweatPatch = Math.sin(fx * Math.PI * 6) * Math.cos(fy * Math.PI * 8);
        const rVal = THREE.MathUtils.clamp(118 - sweatPatch * 42 + pore * 22, 42, 185);
        rImg.data[i] = rImg.data[i + 1] = rImg.data[i + 2] = rVal;
        rImg.data[i + 3] = 255;

        // Micro cavity AO
        const aoVal = THREE.MathUtils.clamp(210 + (striation + pore) * 40, 155, 255);
        aImg.data[i] = aImg.data[i + 1] = aImg.data[i + 2] = aoVal;
        aImg.data[i + 3] = 255;
      }
    }
    hCtx.putImageData(hImg, 0, 0);
    rCtx.putImageData(rImg, 0, 0);
    aCtx.putImageData(aImg, 0, 0);

    const skinHeight = new THREE.CanvasTexture(heightCanvas);
    skinHeight.wrapS = skinHeight.wrapT = THREE.RepeatWrapping;
    skinHeight.anisotropy = 8;

    const skinRoughness = new THREE.CanvasTexture(roughCanvas);
    skinRoughness.wrapS = skinRoughness.wrapT = THREE.RepeatWrapping;
    skinRoughness.anisotropy = 8;

    const skinAO = new THREE.CanvasTexture(aoCanvas);
    skinAO.wrapS = skinAO.wrapT = THREE.RepeatWrapping;

    const buildNormalFromHeight = (srcData: Uint8ClampedArray, strength: number) => {
      const nCanvas = document.createElement("canvas");
      nCanvas.width = nCanvas.height = texSize;
      const nCtx = nCanvas.getContext("2d")!;
      const nImg = nCtx.createImageData(texSize, texSize);
      for (let y = 0; y < texSize; y++) {
        for (let x = 0; x < texSize; x++) {
          const i = (y * texSize + x) * 4;
          const l = srcData[(y * texSize + ((x + texSize - 1) % texSize)) * 4];
          const r = srcData[(y * texSize + ((x + 1) % texSize)) * 4];
          const u = srcData[(((y + texSize - 1) % texSize) * texSize + x) * 4];
          const d = srcData[(((y + 1) % texSize) * texSize + x) * 4];
          const nx = ((l - r) / 255) * strength;
          const ny = ((u - d) / 255) * strength;
          const len = Math.hypot(nx, ny, 1);
          nImg.data[i] = (nx / len * 0.5 + 0.5) * 255;
          nImg.data[i + 1] = (ny / len * 0.5 + 0.5) * 255;
          nImg.data[i + 2] = (1 / len * 0.5 + 0.5) * 255;
          nImg.data[i + 3] = 255;
        }
      }
      nCtx.putImageData(nImg, 0, 0);
      const tex = new THREE.CanvasTexture(nCanvas);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.anisotropy = 8;
      return tex;
    };

    const skinNormal = buildNormalFromHeight(hImg.data, 3.2);

    // 3) Weathered Denim Twill Albedo + Height + Normal
    const denimCanvas = document.createElement("canvas");
    denimCanvas.width = denimCanvas.height = texSize;
    const dCtx = denimCanvas.getContext("2d")!;
    dCtx.fillStyle = "#26477d";
    dCtx.fillRect(0, 0, texSize, texSize);

    const denimHeightCanvas = document.createElement("canvas");
    denimHeightCanvas.width = denimHeightCanvas.height = texSize;
    const dhCtx = denimHeightCanvas.getContext("2d")!;
    const dhImg = dhCtx.createImageData(texSize, texSize);

    for (let y = 0; y < texSize; y++) {
      for (let x = 0; x < texSize; x++) {
        const i = (y * texSize + x) * 4;
        const twill = Math.sin((x + y * 1.1) * 0.85) * 0.5 + Math.cos((x - y) * 0.45) * 0.25;
        const fold = Math.sin(y * 0.075 + Math.sin(x * 0.04) * 1.8) * 0.35;
        const val = THREE.MathUtils.clamp(128 + (twill * 22 + fold * 38), 40, 220);
        dhImg.data[i] = dhImg.data[i + 1] = dhImg.data[i + 2] = val;
        dhImg.data[i + 3] = 255;
      }
    }
    dhCtx.putImageData(dhImg, 0, 0);
    for (let i = 0; i < 14000; i++) {
      const x = ((Math.sin(i * 61.3 + 29) * 43758.5) % 1 + 1) * 256;
      const y = ((Math.sin(i * 19.7 + 58) * 12931.7) % 1 + 1) * 256;
      dCtx.globalAlpha = 0.03 + (i % 5) * 0.01;
      dCtx.fillStyle = i % 3 ? "#8aa4c9" : "#15233d";
      dCtx.fillRect(x, y, 2 + (i % 3), 1);
    }
    dCtx.globalAlpha = 1;
    const denimMap = new THREE.CanvasTexture(denimCanvas);
    denimMap.colorSpace = THREE.SRGBColorSpace;
    denimMap.wrapS = denimMap.wrapT = THREE.RepeatWrapping;
    denimMap.anisotropy = 8;
    const denimHeight = new THREE.CanvasTexture(denimHeightCanvas);
    denimHeight.wrapS = denimHeight.wrapT = THREE.RepeatWrapping;
    const denimNormal = buildNormalFromHeight(dhImg.data, 2.8);

    // 4) Aged Bone / Horror Mask Normal & Height
    const maskHeightCanvas = document.createElement("canvas");
    maskHeightCanvas.width = maskHeightCanvas.height = texSize;
    const mhCtx = maskHeightCanvas.getContext("2d")!;
    const mhImg = mhCtx.createImageData(texSize, texSize);
    for (let y = 0; y < texSize; y++) {
      for (let x = 0; x < texSize; x++) {
        const i = (y * texSize + x) * 4;
        const crack = Math.abs(Math.sin(x * 0.045 + Math.sin(y * 0.07) * 2.1)) < 0.05 ? -46 : 0;
        const grain = Math.sin(x * 0.25 + y * 0.13) * 14 + Math.cos(x * 0.11 - y * 0.31) * 12;
        const val = THREE.MathUtils.clamp(138 + grain + crack, 40, 225);
        mhImg.data[i] = mhImg.data[i + 1] = mhImg.data[i + 2] = val;
        mhImg.data[i + 3] = 255;
      }
    }
    mhCtx.putImageData(mhImg, 0, 0);
    const maskHeight = new THREE.CanvasTexture(maskHeightCanvas);
    maskHeight.wrapS = maskHeight.wrapT = THREE.RepeatWrapping;
    const maskNormal = buildNormalFromHeight(mhImg.data, 2.6);

    // Materials
    const skinnedBodySkin = new THREE.MeshPhysicalMaterial({
      color: "#d9a78e",
      map: skinMap,
      normalMap: skinNormal,
      normalScale: new THREE.Vector2(0.84, 0.84),
      roughnessMap: skinRoughness,
      bumpMap: skinHeight,
      bumpScale: 0.015,
      displacementMap: skinHeight,
      displacementScale: 0.014,
      displacementBias: -0.007,
      aoMap: skinAO,
      aoMapIntensity: 0.75,
      roughness: 0.50,
      clearcoat: 0.48,
      clearcoatRoughness: 0.20,
      sheen: 0.24,
      sheenRoughness: 0.45,
      sheenColor: new THREE.Color("#f0ac8e"),
      vertexColors: true,
    });

    // Forearm materials keep untouched forearm CapsuleGeometry + sphere fists compatible (no vertexColors attr required)
    const skin = new THREE.MeshPhysicalMaterial({
      color: "#d0a087",
      map: skinMap,
      normalMap: skinNormal,
      normalScale: new THREE.Vector2(0.75, 0.75),
      roughnessMap: skinRoughness,
      bumpMap: skinHeight,
      bumpScale: 0.012,
      displacementMap: skinHeight,
      displacementScale: 0.008,
      displacementBias: -0.004,
      roughness: 0.48,
      clearcoat: 0.42,
      clearcoatRoughness: 0.22,
      sheen: 0.22,
      sheenRoughness: 0.48,
    });

    const skinLight = new THREE.MeshPhysicalMaterial({
      color: "#e0ad91",
      map: skinMap,
      normalMap: skinNormal,
      normalScale: new THREE.Vector2(0.65, 0.65),
      roughnessMap: skinRoughness,
      bumpMap: skinHeight,
      bumpScale: 0.01,
      displacementMap: skinHeight,
      displacementScale: 0.006,
      displacementBias: -0.003,
      roughness: 0.46,
      clearcoat: 0.42,
      clearcoatRoughness: 0.22,
      sheen: 0.2,
    });

    const denimSkinned = new THREE.MeshStandardMaterial({
      color: "#ffffff",
      map: denimMap,
      normalMap: denimNormal,
      normalScale: new THREE.Vector2(0.78, 0.78),
      displacementMap: denimHeight,
      displacementScale: 0.009,
      displacementBias: -0.0045,
      roughness: 0.88,
      vertexColors: true,
    });

    const mask = new THREE.MeshPhysicalMaterial({
      color: "#e5dfd1",
      normalMap: maskNormal,
      normalScale: new THREE.Vector2(0.62, 0.62),
      displacementMap: maskHeight,
      displacementScale: 0.008,
      displacementBias: -0.004,
      roughness: 0.39,
      metalness: 0.04,
      clearcoat: 0.38,
      clearcoatRoughness: 0.22,
      vertexColors: true,
    });

    const boot = new THREE.MeshPhysicalMaterial({
      color: "#181519",
      normalMap: denimNormal,
      normalScale: new THREE.Vector2(0.42, 0.42),
      roughness: 0.46,
      clearcoat: 0.34,
    });
    const bootSole = new THREE.MeshStandardMaterial({ color: "#362f35", roughness: 0.82 });
    const leatherBelt = new THREE.MeshStandardMaterial({ color: "#1d181a", roughness: 0.62 });
    const metal = new THREE.MeshStandardMaterial({ color: "#b6a16e", metalness: 0.78, roughness: 0.26 });

    // Geometries
    const sphere = new THREE.SphereGeometry(1, 36, 28);
    const capsule = new THREE.CapsuleGeometry(0.12, 0.42, 12, 28);
    const upperBodyGeo = createUpperBodySkinnedGeometry();
    const trousersGeo = createTrousersSkinnedGeometry();
    const maskGeo = createTerrorMaskGeometry();
    const bootGeo = createCombatBootGeometry();

    // Skeleton Hierarchy matching rest pose in rootGroup space
    const hipsBone = new THREE.Bone();
    hipsBone.position.set(0, 1.05, 0);

    const spineBone = new THREE.Bone();
    spineBone.position.set(0, 0.22, 0);
    hipsBone.add(spineBone);

    const chestBone = new THREE.Bone();
    chestBone.position.set(0, 0.37, 0);
    spineBone.add(chestBone);

    const neckBone = new THREE.Bone();
    neckBone.position.set(0, 0.28, 0);
    chestBone.add(neckBone);

    const headBone = new THREE.Bone();
    headBone.position.set(0, 0.17, 0.015);
    neckBone.add(headBone);

    const leftShoulderBone = new THREE.Bone();
    leftShoulderBone.position.set(-0.47, 0.02, 0);
    chestBone.add(leftShoulderBone);

    const leftElbowBone = new THREE.Bone();
    leftElbowBone.position.set(-0.06, -0.52, 0);
    leftShoulderBone.add(leftElbowBone);

    const rightShoulderBone = new THREE.Bone();
    rightShoulderBone.position.set(0.47, 0.02, 0);
    chestBone.add(rightShoulderBone);

    const rightElbowBone = new THREE.Bone();
    rightElbowBone.position.set(0.06, -0.52, 0);
    rightShoulderBone.add(rightElbowBone);

    const leftThighBone = new THREE.Bone();
    leftThighBone.position.set(-0.18, -0.14, 0);
    hipsBone.add(leftThighBone);

    const leftKneeBone = new THREE.Bone();
    leftKneeBone.position.set(0, -0.43, 0);
    leftThighBone.add(leftKneeBone);

    const rightThighBone = new THREE.Bone();
    rightThighBone.position.set(0.18, -0.14, 0);
    hipsBone.add(rightThighBone);

    const rightKneeBone = new THREE.Bone();
    rightKneeBone.position.set(0, -0.43, 0);
    rightThighBone.add(rightKneeBone);

    hipsBone.updateMatrixWorld(true);
    const bones = [
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
    ];
    const skeleton = new THREE.Skeleton(bones);
    const bindIdentity = new THREE.Matrix4();

    const upperBodyMesh = new THREE.SkinnedMesh(upperBodyGeo, skinnedBodySkin);
    upperBodyMesh.bind(skeleton, bindIdentity);
    upperBodyMesh.frustumCulled = false;
    upperBodyMesh.castShadow = true;
    upperBodyMesh.receiveShadow = true;
    upperBodyMesh.updateMorphTargets();

    const trousersMesh = new THREE.SkinnedMesh(trousersGeo, denimSkinned);
    trousersMesh.bind(skeleton, bindIdentity);
    trousersMesh.frustumCulled = false;
    trousersMesh.castShadow = true;
    trousersMesh.receiveShadow = true;
    trousersMesh.updateMorphTargets();

    return {
      textures: [skinMap, skinHeight, skinRoughness, skinAO, skinNormal, denimMap, denimHeight, denimNormal, maskHeight, maskNormal],
      materials: [skinnedBodySkin, skin, skinLight, denimSkinned, mask, boot, bootSole, leatherBelt, metal],
      geometries: [sphere, capsule, upperBodyGeo, trousersGeo, maskGeo, bootGeo],
      skin,
      skinLight,
      mask,
      boot,
      bootSole,
      leatherBelt,
      metal,
      sphere,
      capsule,
      maskGeo,
      bootGeo,
      upperBodyMesh,
      trousersMesh,
      bones: {
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
      },
    };
  }, []);

  useEffect(() => {
    return () => {
      assets.textures.forEach((tex) => tex.dispose());
      assets.materials.forEach((mat) => mat.dispose());
      assets.geometries.forEach((geo) => geo.dispose());
    };
  }, [assets]);

  useFrame((_, dt) => {
    if (!root.current) return;
    const t = performance.now() * 0.001;
    gaitPhase.current += dt * (motion.moving ? 8.4 : 0);
    const phase = gaitPhase.current;
    const stride = Math.sin(phase);
    const oppositeStride = Math.sin(phase + Math.PI);
    const swing = motion.moving ? Math.max(0, Math.cos(phase)) : 0;
    const oppositeSwing = motion.moving ? Math.max(0, Math.cos(phase + Math.PI)) : 0;
    const gait = motion.moving ? stride : 0;
    const activeWeapon = equippedWeapon ?? motion.weapon;
    const attackDur = activeWeapon === "shotgun" ? 0.42 : activeWeapon === "pipe" ? 0.68 : activeWeapon === "machete" ? 0.56 : 0.36;
    const p = motion.attackTime > 0
      ? activeWeapon === "pipe"
        ? THREE.MathUtils.clamp(motion.attackProgress, 0, 1)
        : THREE.MathUtils.clamp(1 - motion.attackTime / attackDur, 0, 1)
      : 0;
    const grabProgress = motion.grabTime > 0 ? THREE.MathUtils.clamp(1 - motion.grabTime / 1.35, 0, 1) : 0;
    const grab = grabProgress > 0 ? Math.sin(grabProgress * Math.PI) : 0;

    let torsoRotY = motion.moving ? gait * 0.045 : 0;
    let torsoRotX = motion.moving ? 0.035 + swing * 0.025 : 0;
    let torsoRotZ = motion.moving ? -gait * 0.035 : 0;

    let rShoulderX = gait * 0.52 + 0.10;
    let rShoulderZ = -0.08;
    let rElbowX = 0.52;
    let lShoulderX = -gait * 0.52 + 0.28;
    let lShoulderZ = 0.1;
    let lElbowX = 0.72;

    if (activeWeapon === "shotgun") {
      // Ready pose: keep shotgun barrel horizontal and pointing straight forward (-Z).
      torsoRotX = 0;
      torsoRotY = 0.10 + (motion.moving ? gait * 0.02 : 0);
      rShoulderX = -0.18 + gait * 0.04;
      rElbowX = Math.PI / 2 - rShoulderX;
      rShoulderZ = -0.02;
      lShoulderX = 0.56 - gait * 0.04;
      lElbowX = 1.18 + gait * 0.04;
      lShoulderZ = 0.22;

      if (motion.attackTime > 0) {
        const aimPitch = motion.shotgunAimPitch ?? 0.20;
        const aimYaw = motion.shotgunAimYaw ?? 0;
        if (p < 0.24) {
          // Snap aim directly toward the target monster's head.
          const aimEase = smoothstep(0, 0.20, p);
          torsoRotY = THREE.MathUtils.lerp(0.10, aimYaw, aimEase);
          torsoRotX = 0;
          rShoulderX = THREE.MathUtils.lerp(-0.18, 0.26 + aimPitch * 0.45, aimEase);
          const targetPitch = THREE.MathUtils.lerp(0, aimPitch, aimEase);
          rElbowX = Math.PI / 2 + targetPitch - rShoulderX;
          lShoulderX = THREE.MathUtils.lerp(0.56, 0.88 + aimPitch * 0.55, aimEase);
          lElbowX = THREE.MathUtils.lerp(1.18, 1.02 - aimPitch * 0.25, aimEase);
        } else {
          // Muzzle blast and recoil kick from the head-aimed line back to ready stance.
          const kick = p < 0.42 ? smoothstep(0.24, 0.32, p) : 1 - smoothstep(0.42, 0.94, p);
          const settle = 1 - smoothstep(0.52, 1.0, p);
          torsoRotX = kick * 0.08;
          torsoRotY = THREE.MathUtils.lerp(0.10, aimYaw, settle) - kick * 0.06;
          const aimedShoulder = 0.26 + aimPitch * 0.45;
          rShoulderX = THREE.MathUtils.lerp(-0.18, aimedShoulder, settle) + kick * 0.14;
          const currentPitch = aimPitch * settle + kick * 0.12;
          rElbowX = Math.PI / 2 + currentPitch - rShoulderX - torsoRotX;
          lShoulderX = THREE.MathUtils.lerp(0.56, 0.88 + aimPitch * 0.55, settle) + kick * 0.14;
          lElbowX = THREE.MathUtils.lerp(1.18, 1.02 - aimPitch * 0.25, settle) - kick * 0.10;
        }
      }
    } else if (activeWeapon === "pipe") {
      // Pipe is held ready; each randomized strike drives the skinned torso and both arms.
      rShoulderX = 0.18 + gait * 0.12;
      rShoulderZ = -0.06;
      rElbowX = 0.42;
      lShoulderX = 0.28 - gait * 0.08;
      lShoulderZ = 0.08;
      lElbowX = 0.78;
      if (motion.attackTime > 0) {
        if (motion.attackStyle === "bat") {
          // Circular baseball-bat swing: load the shoulders, rotate the trunk, then whip across.
          if (p < 0.30) {
            const wind = smoothstep(0, 0.30, p);
            torsoRotY = THREE.MathUtils.lerp(0, -0.62, wind);
            torsoRotX = THREE.MathUtils.lerp(0.02, -0.17, wind);
            rShoulderX = THREE.MathUtils.lerp(0.18, 1.82, wind);
            rShoulderZ = THREE.MathUtils.lerp(-0.06, -0.58, wind);
            rElbowX = THREE.MathUtils.lerp(0.42, 0.82, wind);
            lShoulderX = THREE.MathUtils.lerp(0.28, 0.92, wind);
            lShoulderZ = 0.24;
            lElbowX = 1.12;
          } else if (p < 0.72) {
            const swing = smoothstep(0.30, 0.72, p);
            const snap = 1 - Math.pow(1 - swing, 2.6);
            torsoRotY = THREE.MathUtils.lerp(-0.62, 0.78, snap);
            torsoRotX = THREE.MathUtils.lerp(-0.17, 0.30, snap);
            rShoulderX = THREE.MathUtils.lerp(1.82, -1.02, snap);
            rShoulderZ = THREE.MathUtils.lerp(-0.58, 0.66, snap);
            rElbowX = THREE.MathUtils.lerp(0.82, 0.10, snap);
            lShoulderX = THREE.MathUtils.lerp(0.92, -0.22, snap);
            lShoulderZ = THREE.MathUtils.lerp(0.24, -0.18, snap);
            lElbowX = THREE.MathUtils.lerp(1.12, 0.76, snap);
          } else {
            const recover = smoothstep(0.72, 1, p);
            torsoRotY = THREE.MathUtils.lerp(0.78, 0, recover);
            torsoRotX = THREE.MathUtils.lerp(0.30, 0.03, recover);
            rShoulderX = THREE.MathUtils.lerp(-1.02, 0.18, recover);
            rShoulderZ = THREE.MathUtils.lerp(0.66, -0.06, recover);
            rElbowX = THREE.MathUtils.lerp(0.10, 0.42, recover);
            lShoulderX = THREE.MathUtils.lerp(-0.22, 0.28, recover);
            lShoulderZ = THREE.MathUtils.lerp(-0.18, 0.08, recover);
            lElbowX = THREE.MathUtils.lerp(0.76, 0.78, recover);
          }
        } else {
          // Overhead two-arm lift followed by a forceful downward pipe strike.
          if (p < 0.38) {
            const lift = smoothstep(0, 0.38, p);
            torsoRotX = THREE.MathUtils.lerp(0.02, -0.30, lift);
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
            torsoRotX = THREE.MathUtils.lerp(-0.30, 0.48, impact);
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
          // Low, cross-body horizontal cut: Rick braces with his left arm,
          // then drives the blade outward to sever the monster's arm.
          if (p < 0.28) {
            const wind = smoothstep(0,0.28,p);
            torsoRotY = THREE.MathUtils.lerp(0,0.32,wind);
            torsoRotX = THREE.MathUtils.lerp(0.02,-0.08,wind);
            rShoulderX = THREE.MathUtils.lerp(0.15,0.92,wind);
            rShoulderZ = THREE.MathUtils.lerp(-0.08,-0.72,wind);
            rElbowX = THREE.MathUtils.lerp(0.48,1.05,wind);
            lShoulderX = 0.82;
            lShoulderZ = 0.18;
            lElbowX = 1.02;
          } else if (p < 0.62) {
            const cut = smoothstep(0.28,0.62,p);
            const snap = 1-Math.pow(1-cut,2.5);
            torsoRotY = THREE.MathUtils.lerp(0.32,-0.62,snap);
            torsoRotX = THREE.MathUtils.lerp(-0.08,0.22,snap);
            rShoulderX = THREE.MathUtils.lerp(0.92,-0.72,snap);
            rShoulderZ = THREE.MathUtils.lerp(-0.72,0.42,snap);
            rElbowX = THREE.MathUtils.lerp(1.05,0.12,snap);
            lShoulderX = THREE.MathUtils.lerp(0.82,-0.12,snap);
            lShoulderZ = 0.12;
            lElbowX = 0.82;
          } else {
            const recover = smoothstep(0.62,1,p);
            torsoRotY = THREE.MathUtils.lerp(-0.62,0,recover);
            torsoRotX = THREE.MathUtils.lerp(0.22,0.04,recover);
            rShoulderX = THREE.MathUtils.lerp(-0.72,0.15,recover);
            rShoulderZ = THREE.MathUtils.lerp(0.42,-0.08,recover);
            rElbowX = THREE.MathUtils.lerp(0.12,0.48,recover);
            lShoulderX = THREE.MathUtils.lerp(-0.12,0.28,recover);
            lElbowX = THREE.MathUtils.lerp(0.82,0.72,recover);
          }
        } else {
          // High diagonal decapitation slash, with a stronger shoulder wind-up.
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
      // Unarmed heavy punch: wind-up -> torso snap + elbow extension -> recovery
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

    const {
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
    } = assets.bones;

    // Update bone hierarchy with natural spine distribution & damped kinematics
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
    headBone.rotation.y = THREE.MathUtils.damp(headBone.rotation.y, -torsoRotY * 0.40, 14, dt);
    headBone.rotation.x = THREE.MathUtils.damp(headBone.rotation.x, grab * 0.08 - torsoRotX * 0.35, 10, dt);

    leftShoulderBone.rotation.x = THREE.MathUtils.damp(leftShoulderBone.rotation.x, lShoulderX, shotgunFiring ? 44 : 22, dt);
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
      motion.moving ? stride * 0.48 : 0.015 * Math.sin(t),
      12,
      dt
    );
    rightThighBone.rotation.x = THREE.MathUtils.damp(
      rightThighBone.rotation.x,
      motion.moving ? oppositeStride * 0.48 : -0.015 * Math.sin(t),
      12,
      dt
    );
    leftKneeBone.rotation.x = THREE.MathUtils.damp(
      leftKneeBone.rotation.x,
      motion.moving ? -swing * 0.82 : 0,
      14,
      dt
    );
    rightKneeBone.rotation.x = THREE.MathUtils.damp(
      rightKneeBone.rotation.x,
      motion.moving ? -oppositeSwing * 0.82 : 0,
      14,
      dt
    );

    // Sync bone local matrices to mounted groups (untouched forearms, mask/head, belt, boots)
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

    // Drive muscular deformation morph targets
    const targetLeftFlex =
      motion.grabTime > 0 ? 0.95 : activeWeapon === "shotgun" ? 0.65 : motion.attackTime > 0 ? 0.42 : motion.moving ? 0.25 : 0.12;
    const targetRightFlex =
      motion.attackTime > 0 ? 1.0 : motion.grabTime > 0 ? 0.95 : activeWeapon ? 0.58 : motion.moving ? 0.26 : 0.15;
    const targetLegFlex = motion.jumpHeight > 0.05 ? 0.9 : motion.moving ? 0.65 : 0.1;

    flexState.current.left = THREE.MathUtils.damp(flexState.current.left, targetLeftFlex, 14, dt);
    flexState.current.right = THREE.MathUtils.damp(flexState.current.right, targetRightFlex, 16, dt);
    flexState.current.leg = THREE.MathUtils.damp(flexState.current.leg, targetLegFlex, 10, dt);

    const upperInf = assets.upperBodyMesh.morphTargetInfluences;
    if (upperInf) {
      upperInf[0] = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * 2.1));
      upperInf[1] = flexState.current.left;
      upperInf[2] = flexState.current.right;
    }
    const legInf = assets.trousersMesh.morphTargetInfluences;
    if (legInf) {
      legInf[0] = flexState.current.leg;
    }

    if (muzzleRef.current) {
      muzzleRef.current.visible = activeWeapon === "shotgun" && motion.attackTime > 0 && p >= 0.18 && p <= 0.40;
    }
    root.current.position.y = motion.jumpHeight;
  });

  return (
    <group ref={root} scale={1.04} dispose={null}>
      {/* Unified bone root for skinned upper body and trousers */}
      <primitive object={assets.bones.hipsBone} />
      <primitive object={assets.upperBodyMesh} />
      <primitive object={assets.trousersMesh} />

      {/* Belt & weathered brass buckle synced to hips */}
      <group ref={beltMount} position={[0, 1.05, 0]}>
        <mesh position={[0, -0.02, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[1.38, 1, 1]} castShadow>
          <torusGeometry args={[0.214, 0.032, 10, 36]} />
          <primitive object={assets.leatherBelt} attach="material" />
        </mesh>
        <mesh position={[0, -0.02, -0.228]} castShadow>
          <boxGeometry args={[0.125, 0.088, 0.036]} />
          <primitive object={assets.metal} attach="material" />
        </mesh>
      </group>

      {/* Left & Right combat boots synced to knee bones */}
      <group ref={leftBootMount} position={[-0.18, 0.48, 0]}>
        <mesh geometry={assets.bootGeo} material={assets.boot} castShadow receiveShadow />
        {ellipsoid(assets.sphere, assets.bootSole, [0, -0.478, -0.09], [0.155, 0.034, 0.245])}
        {[-0.31, -0.36].map((y, i) => (
          <mesh key={i} position={[0, y, -0.175]} castShadow>
            <boxGeometry args={[0.16, 0.016, 0.024]} />
            <primitive object={assets.metal} attach="material" />
          </mesh>
        ))}
      </group>
      <group ref={rightBootMount} position={[0.18, 0.48, 0]}>
        <mesh geometry={assets.bootGeo} material={assets.boot} castShadow receiveShadow />
        {ellipsoid(assets.sphere, assets.bootSole, [0, -0.478, -0.09], [0.155, 0.034, 0.245])}
        {[-0.31, -0.36].map((y, i) => (
          <mesh key={i} position={[0, y, -0.175]} castShadow>
            <boxGeometry args={[0.16, 0.016, 0.024]} />
            <primitive object={assets.metal} attach="material" />
          </mesh>
        ))}
      </group>

      {/* Untouched Forearms mounted identically to shoulder bones */}
      <group ref={leftArmMount} position={[-0.47, 1.66, 0]}>
        <group ref={leftForearm} position={[-0.06, -0.52, 0]}>
          <mesh geometry={assets.capsule} material={assets.skin} position={[-0.02, -0.24, -0.015]} rotation={[0, 0, 0.04]} castShadow receiveShadow />
          {ellipsoid(assets.sphere, assets.skinLight, [-0.03, -0.47, -0.025], [0.15, 0.14, 0.15])}
        </group>
      </group>
      <group ref={rightArmMount} position={[0.47, 1.66, 0]}>
        <group ref={rightForearm} position={[0.06, -0.52, 0]}>
          <mesh geometry={assets.capsule} material={assets.skin} position={[0.02, -0.24, -0.015]} rotation={[0, 0, -0.04]} castShadow receiveShadow />
          {ellipsoid(assets.sphere, assets.skinLight, [0.03, -0.47, -0.025], [0.16, 0.15, 0.15])}
          {[-0.09, -0.035, 0.02, 0.075].map((x, i) => (
            <group key={i}>
              <mesh geometry={assets.capsule} material={assets.skinLight} position={[x, -0.56, -0.105]} rotation={[0, 0, Math.PI / 2]} scale={[0.34, 0.34, 0.34]} castShadow />
            </group>
          ))}
          <group position={[0.03, -0.47, -0.025]}>
            {equippedWeapon && <HeldWeaponMesh id={equippedWeapon} muzzleRef={muzzleRef} />}
          </group>
        </group>
      </group>

      {/* Head & Sculpted Terror Mask synced to headBone */}
      <group ref={headMount} position={[0, 2.09, 0.015]}>
        {ellipsoid(assets.sphere, assets.skin, [0, 0.02, 0.02], [0.27, 0.33, 0.24])}
        <mesh geometry={assets.maskGeo} material={assets.mask} position={[0, 0.01, -0.055]} castShadow receiveShadow />
        {/* Mask leather strap wrapping cranium */}
        <mesh position={[0, 0.08, 0.02]} rotation={[Math.PI / 2, 0, 0]} scale={[1.05, 0.96, 1]} castShadow>
          <torusGeometry args={[0.255, 0.018, 8, 32]} />
          <primitive object={assets.leatherBelt} attach="material" />
        </mesh>
      </group>
    </group>
  );
}
