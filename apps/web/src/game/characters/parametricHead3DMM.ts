import * as THREE from "three";

export type HeadFineTuningParams = {
  // Cranio e Nuca (Occipito-Cervical)
  nucaProjection: number; // -1..1 (projecao do osso occipital / nuca)
  cranialHeight: number; // -1..1 (altura da abobada craniana)
  cranialWidth: number; // -1..1 (largura biparietal)
  templePinch: number; // -1..1 (concavidade temporal)
  neckThickness: number; // -1..1 (calibre cervical / SCM)
  neckSlope: number; // -1..1 (inclinacao nuca-trapezio)
  // Face e Osteologia
  browRidge: number; // -1..1 (arco supraciliar / glabela)
  zygomaticWidth: number; // -1..1 (proeminencia malar / macas do rosto)
  noseBridge: number; // -1..1 (altura da ponte nasal)
  noseProjection: number; // -1..1 (projecao da ponta nasal)
  jawWidth: number; // -1..1 (largura goniaca / mandibula)
  jawAngle: number; // -1..1 (definicao do ramo mandibular)
  chinProjection: number; // -1..1 (proeminencia mentoniana)
  earProminence: number; // -1..1 (abertura/escala das orelhas)
};

export const DEFAULT_HEAD_FINE_TUNING: HeadFineTuningParams = {
  nucaProjection: 0.12,
  cranialHeight: 0.04,
  cranialWidth: 0.0,
  templePinch: 0.15,
  neckThickness: 0.18,
  neckSlope: 0.1,
  browRidge: 0.22,
  zygomaticWidth: 0.1,
  noseBridge: 0.08,
  noseProjection: 0.0,
  jawWidth: 0.16,
  jawAngle: 0.2,
  chinProjection: 0.12,
  earProminence: 0.05,
};

export type Head3DMMPresetId = "canonical" | "brutalist" | "athletic" | "dolichocephalic";

export const HEAD_3DMM_PRESETS: Record<
  Head3DMMPresetId,
  { label: string; tuning: HeadFineTuningParams }
> = {
  canonical: {
    label: "Rick Canonico",
    tuning: { ...DEFAULT_HEAD_FINE_TUNING },
  },
  brutalist: {
    label: "Mandibula Larga",
    tuning: {
      nucaProjection: 0.28,
      cranialHeight: -0.08,
      cranialWidth: 0.24,
      templePinch: 0.3,
      neckThickness: 0.55,
      neckSlope: 0.35,
      browRidge: 0.65,
      zygomaticWidth: 0.4,
      noseBridge: 0.32,
      noseProjection: 0.18,
      jawWidth: 0.62,
      jawAngle: 0.55,
      chinProjection: 0.35,
      earProminence: 0.1,
    },
  },
  athletic: {
    label: "Cranio Esculpido",
    tuning: {
      nucaProjection: 0.18,
      cranialHeight: 0.12,
      cranialWidth: -0.14,
      templePinch: 0.42,
      neckThickness: 0.08,
      neckSlope: 0.05,
      browRidge: 0.3,
      zygomaticWidth: 0.26,
      noseBridge: 0.22,
      noseProjection: 0.2,
      jawWidth: 0.08,
      jawAngle: 0.42,
      chinProjection: 0.24,
      earProminence: -0.05,
    },
  },
  dolichocephalic: {
    label: "Nuca Profunda",
    tuning: {
      nucaProjection: 0.68,
      cranialHeight: 0.28,
      cranialWidth: -0.22,
      templePinch: 0.25,
      neckThickness: 0.22,
      neckSlope: 0.24,
      browRidge: 0.2,
      zygomaticWidth: -0.06,
      noseBridge: 0.28,
      noseProjection: 0.22,
      jawWidth: -0.05,
      jawAngle: 0.18,
      chinProjection: 0.1,
      earProminence: 0.08,
    },
  },
};

/**
 * 7 GPU Morph Targets (<= 8 WebGPU/WebGL hardware morph slot limit).
 * Indices match geometry.morphAttributes.position order.
 */
export const FACIAL_BLENDSHAPE_NAMES = [
  "jawDrop",
  "browFurrow",
  "lipSnarl",
  "cheekSquint",
  "nostrilFlare",
  "nucaTense",
  "breath",
] as const;

export type FacialBlendshapeName = (typeof FACIAL_BLENDSHAPE_NAMES)[number];
export type FacialBlendshapeWeights = Record<FacialBlendshapeName, number>;

export const DEFAULT_FACIAL_BLENDSHAPES: FacialBlendshapeWeights = {
  jawDrop: 0,
  browFurrow: 0.25,
  lipSnarl: 0.1,
  cheekSquint: 0.15,
  nostrilFlare: 0,
  nucaTense: 0.15,
  breath: 0,
};

export type FaceMeshLandmarkId =
  | "vertexCrown"
  | "inionOcciput"
  | "nuchalBase"
  | "glabella"
  | "nasion"
  | "pronasale"
  | "leftOrbit"
  | "rightOrbit"
  | "leftZygoma"
  | "rightZygoma"
  | "labialeSuperius"
  | "menton"
  | "leftGonion"
  | "rightGonion"
  | "leftPinna"
  | "rightPinna";

export type FaceMeshLandmarkPoint = {
  id: FaceMeshLandmarkId;
  label: string;
  region: "cranium" | "nuca" | "face" | "jaw" | "ear";
  position: [number, number, number];
};

export type HeadAnthropometry = {
  cephalicIndex: number; // breadth / depth %
  nucaToFaceRatio: number;
  lowerThirdRatio: number;
  neckToJawRatio: number;
};

export type ParametricHeadResult = {
  geometry: THREE.BufferGeometry;
  overlayGeometry: THREE.BufferGeometry;
  landmarks: FaceMeshLandmarkPoint[];
  anthropometry: HeadAnthropometry;
  tuning: HeadFineTuningParams;
};

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0 || 1e-5), 0, 1);
  return t * t * (3 - 2 * t);
}

function gaussian(x: number, center: number, sigma: number): number {
  const d = (x - center) / sigma;
  return Math.exp(-d * d);
}

function gaussian2D(
  x: number,
  y: number,
  cx: number,
  cy: number,
  sx: number,
  sy: number
): number {
  const dx = (x - cx) / sx;
  const dy = (y - cy) / sy;
  return Math.exp(-(dx * dx + dy * dy));
}

export function resolveHeadFineTuning(
  partial?: Partial<HeadFineTuningParams>
): HeadFineTuningParams {
  return {
    ...DEFAULT_HEAD_FINE_TUNING,
    ...(partial ?? {}),
  };
}

export function computeHeadAnthropometry(
  partial?: Partial<HeadFineTuningParams>
): HeadAnthropometry {
  const t = resolveHeadFineTuning(partial);
  const width = 0.215 * (1 + t.cranialWidth * 0.14);
  const faceDepth = 0.228 + t.noseProjection * 0.015 + t.browRidge * 0.008;
  const nucaDepth = 0.236 + t.nucaProjection * 0.032;
  const totalDepth = faceDepth + nucaDepth;
  const cephalicIndex = ((width * 2) / totalDepth) * 100;
  const nucaToFaceRatio = nucaDepth / faceDepth;
  const lowerThirdRatio = (0.145 + t.jawAngle * 0.012) / (0.43 + t.cranialHeight * 0.025);
  const neckW = 0.156 * (1 + t.neckThickness * 0.18);
  const jawW = 0.168 * (1 + t.jawWidth * 0.18);
  return {
    cephalicIndex: Math.round(cephalicIndex * 10) / 10,
    nucaToFaceRatio: Math.round(nucaToFaceRatio * 100) / 100,
    lowerThirdRatio: Math.round(lowerThirdRatio * 100) / 100,
    neckToJawRatio: Math.round((neckW / jawW) * 100) / 100,
  };
}

type EvaluatedSurfacePoint = {
  x: number;
  y: number;
  z: number;
  rCol: number;
  gCol: number;
  bCol: number;
  dJawDrop: [number, number, number];
  dBrowFurrow: [number, number, number];
  dLipSnarl: [number, number, number];
  dCheekSquint: [number, number, number];
  dNostrilFlare: [number, number, number];
  dNucaTense: [number, number, number];
  dBreath: [number, number, number];
};

/**
 * Evaluates a continuous anatomical 3DMM + FaceMesh surface point in headMount local space:
 * - Rick faces -Z (anterior face), +Z is occiput / nuca, +Y is crown, -Y is neck collar.
 * - Calibrated to sit cleanly under Rick's metallic front mask while exposing real cranium,
 *   occipital protuberance, suboccipital hollow, sternocleidomastoid cords, jaw & ears.
 */
function evaluateHeadSurface(
  u: number,
  v: number,
  tuning: HeadFineTuningParams
): EvaluatedSurfacePoint {
  // u in [0..1] wraps azimuth around Y:
  // theta = u * 2PI -> cos(theta) = X, sin(theta) = Z
  // Anterior (-Z) occurs at theta = 1.5*PI (u = 0.75, sin = -1)
  // Posterior / Nuca (+Z) occurs at theta = 0.5*PI (u = 0.25, sin = +1)
  const theta = u * Math.PI * 2;
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);

  const front = Math.max(0, -sinT);
  const back = Math.max(0, sinT);
  const absXDir = Math.abs(cosT);

  // Smooth anatomical ellipsoidal vault parameterization (no conical pinching at crown or occiput)
  const V_NECK = 0.24;
  const PHI_MIN = -0.62;
  const PHI_MAX = Math.PI * 0.5;
  const ySkullCenter = 0.055;
  const ryUpper = 0.25 * (1 + tuning.cranialHeight * 0.1);
  const ryLower = 0.24;
  const yNeckTop = ySkullCenter + Math.sin(PHI_MIN) * ryLower; // ~ -0.084

  let y: number;
  let phi: number;
  if (v < V_NECK) {
    const tn = v / V_NECK;
    y = THREE.MathUtils.lerp(-0.215, yNeckTop, tn);
    phi = PHI_MIN;
  } else {
    const th = (v - V_NECK) / (1 - V_NECK);
    phi = THREE.MathUtils.lerp(PHI_MIN, PHI_MAX, th);
    const ry = phi >= 0 ? ryUpper : ryLower;
    y = ySkullCenter + Math.sin(phi) * ry;
  }

  // Ellipsoidal horizontal dome envelope: 1.0 at equator (phi=0), smoothly 0.0 at crown (phi=PI/2)
  const cosPhi = Math.max(0.0, Math.cos(phi));
  // Subtle lower-jaw/suboccipital fullness so transition into neck stays natural
  const lowerTuck = phi < 0 ? 0.96 + 0.04 * Math.cos(phi) : 1.0;

  // Neck vs Skull blend (C1-smooth across [-0.135 .. -0.040])
  const isNeck = 1 - smoothstep(-0.135, -0.04, y);
  const jawHeightBand = smoothstep(-0.145, -0.09, y) * (1 - smoothstep(-0.015, 0.04, y));

  const neckThickScale = 1 + tuning.neckThickness * 0.18;
  const cranialWScale = 1 + tuning.cranialWidth * 0.12;
  const nucaScale = 1 + tuning.nucaProjection * 0.095;

  // Cranial vault & neck lateral radii (X) calibrated to fill leather strap snugly (0.262)
  const neckRx = THREE.MathUtils.lerp(0.166, 0.144, smoothstep(-0.215, -0.08, y)) * neckThickScale;
  const skullRx = 0.244 * cosPhi * lowerTuck * cranialWScale;
  const rx = THREE.MathUtils.lerp(skullRx, neckRx, isNeck);

  // Anterior (-Z) and Posterior/Nuca (+Z) ellipsoidal radii
  const neckRzFront = THREE.MathUtils.lerp(0.15, 0.134, smoothstep(-0.215, -0.08, y)) * neckThickScale;
  const neckRzBack =
    THREE.MathUtils.lerp(0.158 + tuning.neckSlope * 0.018, 0.142, smoothstep(-0.215, -0.075, y)) *
    neckThickScale;

  const skullRzFront = 0.214 * cosPhi * lowerTuck;
  const skullRzBack = 0.236 * cosPhi * lowerTuck * nucaScale;

  const rzFront = THREE.MathUtils.lerp(skullRzFront, neckRzFront, isNeck);
  const rzBack = THREE.MathUtils.lerp(skullRzBack, neckRzBack, isNeck);

  // Subtle cranial center shift aft so face stays cleanly inside mask cavity and nuca fills strap
  const centerZOffset = 0.026 * smoothstep(-0.14, -0.02, y) * Math.max(0.15, cosPhi);

  const rzBase = sinT >= 0 ? rzBack : rzFront;
  let x = cosT * rx;
  let z = sinT * rzBase + centerZOffset;

  // =========================================================================
  // 1. OCCIPUT & NUCA ANATOMY (+Z posterior cranium & cervical muscles)
  // =========================================================================
  // Broad, smooth occipital rounding (zero sharp rear spike)
  const crownFade = smoothstep(0.18, 0.65, cosPhi);
  const occiputBulge =
    gaussian(y, 0.042, 0.078) *
    smoothstep(0.15, 0.95, back) *
    crownFade *
    (0.009 + Math.max(-0.008, tuning.nucaProjection * 0.014));
  // Broad parietal fullness on upper-rear skull
  const parietalBoss =
    gaussian(y, 0.125, 0.068) *
    gaussian(absXDir, 0.56, 0.36) *
    smoothstep(-0.15, 0.65, sinT) *
    crownFade *
    (0.008 + tuning.cranialWidth * 0.007);
  // Gentle suboccipital transition at base of skull
  const suboccipitalHollow =
    gaussian(y, -0.068, 0.036) *
    smoothstep(0.25, 0.95, back) *
    gaussian(cosT, 0, 0.38) *
    0.009;
  // Nuchal midline & semispinalis columns on neck
  const nuchalFurrow =
    smoothstep(-0.21, -0.06, y) *
    (1 - smoothstep(-0.02, 0.04, y)) *
    gaussian(cosT, 0, 0.2) *
    back *
    0.007;
  const nuchalMuscleCols =
    smoothstep(-0.21, -0.05, y) *
    (1 - smoothstep(-0.01, 0.045, y)) *
    gaussian(absXDir, 0.35, 0.2) *
    back *
    (0.008 + tuning.neckSlope * 0.005);
  // Sternocleidomastoid (SCM) oblique cords
  const scmLineX = THREE.MathUtils.lerp(0.24, 0.62, smoothstep(-0.21, -0.02, y));
  const scmCord =
    smoothstep(-0.215, -0.17, y) *
    (1 - smoothstep(-0.04, 0.03, y)) *
    gaussian(absXDir, scmLineX, 0.18) *
    smoothstep(-0.7, 0.35, -sinT) *
    0.008;
  // Laryngeal prominence (Adam's apple)
  const larynx =
    gaussian2D(cosT, y, 0, -0.132, 0.18, 0.024) * front * 0.009;

  // =========================================================================
  // 2. FACEMESH LANDMARK OSTEOLOGY (-Z anterior face)
  // =========================================================================
  const templeConcavity =
    gaussian(y, 0.086, 0.046) *
    gaussian(absXDir, 0.84, 0.22) *
    smoothstep(-0.65, 0.25, -sinT) *
    crownFade *
    (0.007 + tuning.templePinch * 0.009);

  const browArcY = 0.088 - 0.012 * Math.pow(absXDir, 1.4);
  const browRidge =
    gaussian(y, browArcY, 0.024) *
    (1 - smoothstep(0.45, 0.82, absXDir)) *
    Math.pow(front, 1.3) *
    (0.015 + tuning.browRidge * 0.014);
  const glabellaBridge =
    gaussian2D(cosT, y, 0, 0.082, 0.14, 0.022) * front * (0.006 + tuning.browRidge * 0.005);

  const orbitMask =
    gaussian2D(absXDir, y, 0.34, 0.048, 0.175, 0.028) * Math.pow(front, 1.4);
  const eyeballDome =
    gaussian2D(absXDir, y, 0.34, 0.045, 0.095, 0.015) * Math.pow(front, 1.6);
  const eyeCrease =
    gaussian2D(absXDir, y, 0.34, 0.056, 0.12, 0.007) * Math.pow(front, 1.6);

  const zygomaMask =
    gaussian2D(absXDir, y, 0.62, 0.012, 0.23, 0.032) *
    smoothstep(0.15, 0.9, front) *
    (0.013 + tuning.zygomaticWidth * 0.015);

  const noseBridgeMask =
    smoothstep(-0.015, 0.055, y) *
    (1 - smoothstep(0.055, 0.09, y)) *
    gaussian(cosT, 0, 0.115) *
    Math.pow(front, 1.8) *
    (0.016 + tuning.noseBridge * 0.012);
  const noseTipMask =
    gaussian2D(cosT, y, 0, -0.012, 0.11, 0.018) *
    Math.pow(front, 2.0) *
    (0.024 + tuning.noseProjection * 0.014);
  const noseAlae =
    gaussian2D(absXDir, y, 0.14, -0.018, 0.075, 0.014) *
    Math.pow(front, 1.8) *
    0.01;
  const nostrilIndent =
    gaussian2D(absXDir, y, 0.075, -0.025, 0.042, 0.008) *
    Math.pow(front, 2.0) *
    0.007;

  const muzzleConvex =
    gaussian2D(cosT, y, 0, -0.058, 0.36, 0.042) * Math.pow(front, 1.4) * 0.012;
  const upperLip =
    gaussian2D(cosT, y, 0, -0.052, 0.22, 0.011) * Math.pow(front, 1.8) * 0.01;
  const lowerLip =
    gaussian2D(cosT, y, 0, -0.073, 0.19, 0.011) * Math.pow(front, 1.8) * 0.009;
  const mouthSeam =
    gaussian2D(cosT, y, 0, -0.062, 0.21, 0.005) * Math.pow(front, 2.0) * 0.009;
  const philtrum =
    gaussian2D(cosT, y, 0, -0.038, 0.055, 0.013) * Math.pow(front, 1.8) * 0.004;

  const jawRamus =
    jawHeightBand *
    gaussian(absXDir, 0.74, 0.22) *
    smoothstep(-0.35, 0.6, -sinT) *
    (0.014 + tuning.jawWidth * 0.018 + tuning.jawAngle * 0.01);
  const chinSculpt =
    gaussian2D(cosT, y, 0, -0.104, 0.22, 0.024) *
    Math.pow(front, 1.45) *
    (0.019 + tuning.chinProjection * 0.016);
  const submentalTuck =
    smoothstep(-0.145, -0.11, y) *
    (1 - smoothstep(-0.105, -0.082, y)) *
    front *
    0.012;

  x += cosT * (parietalBoss + zygomaMask * 0.55 + jawRamus - templeConcavity + scmCord * 0.5);
  z +=
    occiputBulge +
    parietalBoss * 0.35 -
    suboccipitalHollow -
    nuchalFurrow +
    nuchalMuscleCols +
    scmCord * 0.3 -
    larynx -
    templeConcavity * 0.3 -
    browRidge -
    glabellaBridge +
    orbitMask * 0.02 -
    eyeballDome * 0.011 +
    eyeCrease * 0.005 -
    zygomaMask * 0.65 -
    noseBridgeMask -
    noseTipMask -
    noseAlae +
    nostrilIndent -
    muzzleConvex -
    upperLip -
    lowerLip +
    mouthSeam +
    philtrum -
    chinSculpt +
    submentalTuck;

  // =========================================================================
  // 3. ANATOMICAL VERTEX COLORS & AO SHADING (Nuca Hairline / Face Crevices)
  // =========================================================================
  const orbitShade = THREE.MathUtils.clamp(orbitMask * 0.95 + eyeCrease * 1.4, 0, 1);
  const mouthShade = THREE.MathUtils.clamp(mouthSeam * 55 + nostrilIndent * 48, 0, 1);
  const suboccipitalShade = THREE.MathUtils.clamp(suboccipitalHollow * 28 + nuchalFurrow * 22, 0, 1);

  // Subtle vascular warmth on ears, nose tip, cheekbones & lips
  const flush = THREE.MathUtils.clamp(
    noseTipMask * 14 + zygomaMask * 18 + (upperLip + lowerLip) * 26,
    0,
    0.45
  );

  // Subtle close-cropped dark stubble / cranial hair shadow on upper/rear cranium & nuca
  // Stops cleanly above the suboccipital nuchal line so the neck stays bare skin.
  const rearHairArc = smoothstep(-0.15, 0.35, sinT);
  const crownHairMask =
    smoothstep(0.085, 0.145, y) * smoothstep(-0.45, 0.15, sinT) +
    rearHairArc * smoothstep(-0.045, 0.015, y);
  const stubbleBand = THREE.MathUtils.clamp(crownHairMask, 0, 1) * 0.32;

  let rCol = 1.0 - orbitShade * 0.28 - mouthShade * 0.45 - suboccipitalShade * 0.18 - stubbleBand * 0.24;
  let gCol = 0.96 - orbitShade * 0.36 - mouthShade * 0.56 - suboccipitalShade * 0.24 - stubbleBand * 0.30;
  let bCol = 0.93 - orbitShade * 0.38 - mouthShade * 0.58 - suboccipitalShade * 0.25 - stubbleBand * 0.31;

  // Warm blood/lip tint
  rCol = THREE.MathUtils.lerp(rCol, Math.min(1, rCol + 0.08), flush);
  gCol = THREE.MathUtils.lerp(gCol, gCol * 0.84, flush);
  bCol = THREE.MathUtils.lerp(bCol, bCol * 0.82, flush);

  // =========================================================================
  // 4. GPU BLENDSHAPE MORPH TARGET DELTAS (7 targets)
  // =========================================================================
  // Target 0: jawDrop — anatomical rotation around TMJ (y = 0.012, z = 0.03)
  const jawInfluence =
    (1 - smoothstep(-0.095, -0.058, y)) *
    smoothstep(-0.20, -0.105, y) *
    smoothstep(-0.15, 0.45, front);
  const tmjY = 0.012;
  const tmjZ = 0.03;
  const jawAngleRad = -0.34; // rotate chin downward & slightly aft
  const dyRel = y - tmjY;
  const dzRel = z - tmjZ;
  const rotY = dyRel * Math.cos(jawAngleRad) - dzRel * Math.sin(jawAngleRad) + tmjY;
  const rotZ = dyRel * Math.sin(jawAngleRad) + dzRel * Math.cos(jawAngleRad) + tmjZ;
  const dJawDrop: [number, number, number] = [
    0,
    (rotY - y) * jawInfluence,
    (rotZ - z) * jawInfluence,
  ];

  // Target 1: browFurrow — corrugator inward/downward squeeze
  const browFurrowMask =
    gaussian(y, 0.084, 0.026) *
    (1 - smoothstep(0.2, 0.58, absXDir)) *
    Math.pow(front, 1.4);
  const dBrowFurrow: [number, number, number] = [
    -Math.sign(cosT) * browFurrowMask * 0.011,
    -browFurrowMask * 0.014,
    -browFurrowMask * 0.008,
  ];

  // Target 2: lipSnarl — levator labii superioris upward lip flare
  const snarlMask =
    gaussian2D(absXDir, y, 0.13, -0.048, 0.14, 0.016) * Math.pow(front, 1.5);
  const dLipSnarl: [number, number, number] = [
    Math.sign(cosT) * snarlMask * 0.005,
    snarlMask * 0.014,
    -snarlMask * 0.009,
  ];

  // Target 3: cheekSquint — orbicularis & zygoma upward compress
  const squintMask =
    gaussian2D(absXDir, y, 0.44, 0.022, 0.22, 0.026) * Math.pow(front, 1.3);
  const dCheekSquint: [number, number, number] = [
    Math.sign(cosT) * squintMask * 0.006,
    squintMask * 0.012,
    -squintMask * 0.009,
  ];

  // Target 4: nostrilFlare — nasal alar dilation
  const flareMask =
    gaussian2D(absXDir, y, 0.135, -0.018, 0.085, 0.016) * Math.pow(front, 1.6);
  const dNostrilFlare: [number, number, number] = [
    Math.sign(cosT) * flareMask * 0.009,
    flareMask * 0.003,
    -flareMask * 0.005,
  ];

  // Target 5: nucaTense — SCM + suboccipital/nuchal muscle tightening under effort
  const nucaTenseMask =
    smoothstep(-0.20, -0.14, y) * (1 - smoothstep(-0.02, 0.06, y));
  const scmPull = scmCord * 1.1 + nuchalMuscleCols * 1.1;
  const dNucaTense: [number, number, number] = [
    cosT * nucaTenseMask * 0.008,
    -nucaTenseMask * 0.004,
    sinT * (nucaTenseMask * 0.008 + scmPull * 0.85),
  ];

  // Target 6: breath — subtle mandibular & carotid relaxation pulse
  const breathMask = smoothstep(-0.2, -0.06, y) * (1 - smoothstep(-0.04, 0.04, y));
  const dBreath: [number, number, number] = [
    cosT * breathMask * 0.003,
    -breathMask * 0.002,
    sinT * breathMask * 0.004,
  ];

  return {
    x,
    y,
    z,
    rCol,
    gCol,
    bCol,
    dJawDrop,
    dBrowFurrow,
    dLipSnarl,
    dCheekSquint,
    dNostrilFlare,
    dNucaTense,
    dBreath,
  };
}

function appendEarGeometry(
  side: -1 | 1,
  tuning: HeadFineTuningParams,
  positions: number[],
  uvs: number[],
  colors: number[],
  indices: number[],
  morphArrays: number[][]
) {
  const earScale = 1 + tuning.earProminence * 0.22;
  const earOutAngle = 0.24 + tuning.earProminence * 0.18;
  const headWidth = 0.238 * (1 + tuning.cranialWidth * 0.12);
  const earX = side * (headWidth + 0.002);
  const earY = 0.024;
  const earZ = 0.028;

  const rings = 14;
  const segs = 18;
  const baseVert = positions.length / 3;

  for (let iy = 0; iy <= rings; iy++) {
    const v = iy / rings;
    // Closed pinna ellipsoid deformed into helix rim, concha hollow, and lobe
    const phi = v * Math.PI;
    const sinP = Math.sin(phi);
    const cosP = Math.cos(phi);

    for (let ix = 0; ix <= segs; ix++) {
      const u = ix / segs;
      const psi = u * Math.PI * 2;
      const cosA = Math.cos(psi);
      const sinA = Math.sin(psi);

      // Local ear coordinates before side flare:
      // ex = thickness, ey = vertical height, ez = front-to-back depth
      const lobeFactor = smoothstep(-0.2, -0.95, cosP);
      const earH = 0.056 * earScale * (1 - lobeFactor * 0.18);
      const earD = 0.032 * earScale * (1 - lobeFactor * 0.28);
      const earT = 0.015 * earScale;

      const ey = cosP * earH;
      const ez = sinP * cosA * earD;
      // Hollow out the anterior concha bowl on the lateral face (sinA > 0)
      const isOuterFace = Math.max(0, sinA);
      const conchaDist = Math.hypot(ey / (earH * 0.52), (ez + 0.004) / (earD * 0.56));
      const conchaHollow = Math.max(0, 1 - conchaDist * conchaDist) * isOuterFace;
      const helixRim = gaussian(conchaDist, 0.92, 0.24) * isOuterFace;

      const exLocal = sinP * sinA * earT - conchaHollow * 0.012 + helixRim * 0.006;

      // Rotate slightly outward towards the rear so ears sweep anatomically backward
      const flaredX = exLocal * Math.cos(earOutAngle) + ez * side * Math.sin(earOutAngle);
      const flaredZ = -exLocal * side * Math.sin(earOutAngle) + ez * Math.cos(earOutAngle);

      const px = earX + side * (flaredX + 0.006 * sinP);
      const py = earY + ey;
      const pz = earZ + flaredZ;

      positions.push(px, py, pz);
      uvs.push(u * 0.4 + 0.5, v * 0.4 + 0.5);

      const shade = 0.94 - conchaHollow * 0.3;
      colors.push(shade, shade * 0.86, shade * 0.83);

      // Ears stay anchored to cranium, subtle TMJ/nuca tension pull
      for (let m = 0; m < FACIAL_BLENDSHAPE_NAMES.length; m++) {
        if (m === 5) {
          morphArrays[m].push(side * 0.002, -0.001, 0.003);
        } else {
          morphArrays[m].push(0, 0, 0);
        }
      }
    }
  }

  for (let iy = 0; iy < rings; iy++) {
    for (let ix = 0; ix < segs; ix++) {
      const a = baseVert + iy * (segs + 1) + ix;
      const b = a + 1;
      const c = a + segs + 1;
      const d = c + 1;
      if (side === 1) {
        indices.push(a, c, b, b, c, d);
      } else {
        indices.push(a, b, c, b, d, c);
      }
    }
  }
}

function buildFaceMeshLandmarks(tuning: HeadFineTuningParams): FaceMeshLandmarkPoint[] {
  const sample = (u: number, v: number): [number, number, number] => {
    const p = evaluateHeadSurface(u, v, tuning);
    return [p.x, p.y, p.z];
  };

  return [
    { id: "vertexCrown", label: "Vertex Craniano", region: "cranium", position: sample(0.25, 0.99) },
    { id: "inionOcciput", label: "Inion (Nuca)", region: "nuca", position: sample(0.25, 0.46) },
    { id: "nuchalBase", label: "Base Cervical", region: "nuca", position: sample(0.25, 0.12) },
    { id: "glabella", label: "Glabela", region: "face", position: sample(0.75, 0.51) },
    { id: "nasion", label: "Nasio", region: "face", position: sample(0.75, 0.45) },
    { id: "pronasale", label: "Ponta Nasal", region: "face", position: sample(0.75, 0.36) },
    { id: "leftOrbit", label: "Orbita Esq.", region: "face", position: sample(0.692, 0.45) },
    { id: "rightOrbit", label: "Orbita Dir.", region: "face", position: sample(0.808, 0.45) },
    { id: "leftZygoma", label: "Zigoma Esq.", region: "face", position: sample(0.642, 0.39) },
    { id: "rightZygoma", label: "Zigoma Dir.", region: "face", position: sample(0.858, 0.39) },
    { id: "labialeSuperius", label: "Labio Sup.", region: "face", position: sample(0.75, 0.28) },
    { id: "menton", label: "Mento (Queixo)", region: "jaw", position: sample(0.75, 0.22) },
    { id: "leftGonion", label: "Gonio Esq.", region: "jaw", position: sample(0.61, 0.26) },
    { id: "rightGonion", label: "Gonio Dir.", region: "jaw", position: sample(0.89, 0.26) },
    { id: "leftPinna", label: "Orelha Esq.", region: "ear", position: sample(0.51, 0.39) },
    { id: "rightPinna", label: "Orelha Dir.", region: "ear", position: sample(0.99, 0.39) },
  ];
}

function createFaceMeshOverlayGeometry(tuning: HeadFineTuningParams): THREE.BufferGeometry {
  const linePositions: number[] = [];
  const uLines = 18;
  const vLines = 14;
  const uSamples = 64;
  const vSamples = 40;

  // Longitudinal FaceMesh meridians
  for (let iu = 0; iu < uLines; iu++) {
    const u = iu / uLines;
    for (let iv = 0; iv < vSamples; iv++) {
      const p0 = evaluateHeadSurface(u, iv / vSamples, tuning);
      const p1 = evaluateHeadSurface(u, (iv + 1) / vSamples, tuning);
      linePositions.push(p0.x * 1.006, p0.y, p0.z * 1.006, p1.x * 1.006, p1.y, p1.z * 1.006);
    }
  }

  // Cranial, Facial & Nuca contour parallels
  for (let iv = 1; iv < vLines; iv++) {
    const v = iv / vLines;
    for (let iu = 0; iu < uSamples; iu++) {
      const p0 = evaluateHeadSurface(iu / uSamples, v, tuning);
      const p1 = evaluateHeadSurface((iu + 1) / uSamples, v, tuning);
      linePositions.push(p0.x * 1.006, p0.y, p0.z * 1.006, p1.x * 1.006, p1.y, p1.z * 1.006);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(linePositions, 3));
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Generates an indexed high-resolution parametric 3D human head BufferGeometry
 * integrating 3DMM shape parameterization, FaceMesh anatomical osteology,
 * vertex colors + secondary UV2 AO, sculpted ears, and 7 GPU morph targets.
 */
export function createParametricHumanHeadGeometry(
  partialTuning?: Partial<HeadFineTuningParams>
): ParametricHeadResult {
  const tuning = resolveHeadFineTuning(partialTuning);
  const rings = 68;
  const segs = 76;

  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  const morphArrays: number[][] = FACIAL_BLENDSHAPE_NAMES.map(() => []);

  for (let iy = 0; iy <= rings; iy++) {
    const v = iy / rings;
    for (let ix = 0; ix <= segs; ix++) {
      const u = ix / segs;
      const s = evaluateHeadSurface(u, v, tuning);

      positions.push(s.x, s.y, s.z);
      uvs.push(u * 1.5, v * 1.35);
      colors.push(s.rCol, s.gCol, s.bCol);

      morphArrays[0].push(s.dJawDrop[0], s.dJawDrop[1], s.dJawDrop[2]);
      morphArrays[1].push(s.dBrowFurrow[0], s.dBrowFurrow[1], s.dBrowFurrow[2]);
      morphArrays[2].push(s.dLipSnarl[0], s.dLipSnarl[1], s.dLipSnarl[2]);
      morphArrays[3].push(s.dCheekSquint[0], s.dCheekSquint[1], s.dCheekSquint[2]);
      morphArrays[4].push(s.dNostrilFlare[0], s.dNostrilFlare[1], s.dNostrilFlare[2]);
      morphArrays[5].push(s.dNucaTense[0], s.dNucaTense[1], s.dNucaTense[2]);
      morphArrays[6].push(s.dBreath[0], s.dBreath[1], s.dBreath[2]);
    }
  }

  for (let iy = 0; iy < rings; iy++) {
    for (let ix = 0; ix < segs; ix++) {
      const a = iy * (segs + 1) + ix;
      const b = a + 1;
      const c = a + segs + 1;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  // Append anatomically positioned & angled outer ears (pinnae)
  appendEarGeometry(-1, tuning, positions, uvs, colors, indices, morphArrays);
  appendEarGeometry(1, tuning, positions, uvs, colors, indices, morphArrays);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("uv2", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  try {
    geometry.computeTangents();
  } catch {
    // Tangent fallback if index layout prevents automatic calculation
  }

  geometry.morphTargetsRelative = true;
  geometry.morphAttributes.position = morphArrays.map(
    (arr) => new THREE.Float32BufferAttribute(arr, 3)
  );
  geometry.computeBoundingSphere();

  return {
    geometry,
    overlayGeometry: createFaceMeshOverlayGeometry(tuning),
    landmarks: buildFaceMeshLandmarks(tuning),
    anthropometry: computeHeadAnthropometry(tuning),
    tuning,
  };
}
