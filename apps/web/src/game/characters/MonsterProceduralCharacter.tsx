import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { MeshStandardNodeMaterial, WebGPURenderer } from "three/webgpu";
import {
  createProceduralSurfaceMaps,
  createWebGPUSurfaceNodeMaterial,
  type ProceduralPBRMaps,
} from "./proceduralSurfaceMaps";

export type ProceduralMonsterKind = "crawler" | "brute" | "spitter";

type Props = {
  kind: ProceduralMonsterKind;
  headless?: boolean;
  missingArm?: boolean;
  missingLeg?: boolean;
  brokenHead?: boolean;
  pinned?: boolean;
  dissolve?: number;
  animation?: number;
  moving?: boolean;
  fallen?: boolean;
  attackPulse?: number;
};

type PartSpec = [
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
  seed: number,
  boneName: string,
];

type Built = {
  group: THREE.Group;
  mesh: THREE.SkinnedMesh;
  geometry: THREE.BufferGeometry;
  bones: THREE.Bone[];
  boneMap: Record<string, THREE.Bone>;
  material: THREE.MeshStandardMaterial;
  node: MeshStandardNodeMaterial;
  headBone: THREE.Bone | null;
  neckStump: THREE.Mesh;
  brokenSkullGroup: THREE.Group;
  legStumpGroup: THREE.Group;
  rightEye: THREE.Mesh;
  leftEye: THREE.Mesh;
  extraDisposables: Array<{ dispose: () => void }>;
};

let sharedSkinMaps: ProceduralPBRMaps | null = null;
function getSharedMonsterSkinMaps(): ProceduralPBRMaps {
  if (!sharedSkinMaps) {
    sharedSkinMaps = createProceduralSurfaceMaps("skin", 512, 0.9);
  }
  return sharedSkinMaps;
}

function joinIndexedGeometriesWithBones(
  parts: Array<{ geo: THREE.BufferGeometry; boneIndex: number }>
): { geometry: THREE.BufferGeometry; vertexBoneIndices: Uint16Array } {
  let vertexCount = 0;
  let indexCount = 0;
  for (const p of parts) {
    vertexCount += p.geo.attributes.position.count;
    indexCount += p.geo.index ? p.geo.index.count : p.geo.attributes.position.count;
  }

  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices = new Uint32Array(indexCount);
  const vertexBoneIndices = new Uint16Array(vertexCount);

  let vOffset = 0;
  let iOffset = 0;

  for (const { geo: g, boneIndex } of parts) {
    const pos = g.attributes.position;
    const norm = g.attributes.normal;
    const uv = g.attributes.uv;

    for (let i = 0; i < pos.count; i++) {
      const dst = (vOffset + i) * 3;
      positions[dst] = pos.getX(i);
      positions[dst + 1] = pos.getY(i);
      positions[dst + 2] = pos.getZ(i);
      vertexBoneIndices[vOffset + i] = boneIndex;

      if (norm) {
        normals[dst] = norm.getX(i);
        normals[dst + 1] = norm.getY(i);
        normals[dst + 2] = norm.getZ(i);
      }

      if (uv) {
        const uvDst = (vOffset + i) * 2;
        uvs[uvDst] = uv.getX(i);
        uvs[uvDst + 1] = uv.getY(i);
      }
    }

    if (g.index) {
      const idx = g.index;
      for (let i = 0; i < idx.count; i++) {
        indices[iOffset + i] = idx.getX(i) + vOffset;
      }
      iOffset += idx.count;
    } else {
      for (let i = 0; i < pos.count; i++) {
        indices[iOffset + i] = vOffset + i;
      }
      iOffset += pos.count;
    }

    vOffset += pos.count;
    g.dispose();
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  out.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  out.setIndex(new THREE.BufferAttribute(indices, 1));
  return { geometry: out, vertexBoneIndices };
}

function build(kind: ProceduralMonsterKind): Built {
  const brute = kind === "brute";
  const crawler = kind === "crawler";
  const color = brute ? "#7d6048" : kind === "spitter" ? "#a05c43" : "#873b36";

  const bones: THREE.Bone[] = [];
  const boneIndexMap: Record<string, number> = {};
  const boneMap: Record<string, THREE.Bone> = {};
  const add = (name: string, parent: THREE.Bone | null, pos: THREE.Vector3) => {
    const b = new THREE.Bone();
    b.name = name;
    b.position.copy(pos);
    parent?.add(b);
    boneIndexMap[name] = bones.length;
    boneMap[name] = b;
    bones.push(b);
    return b;
  };

  const root = add("root", null, new THREE.Vector3());
  const pelvis = add("pelvis", root, new THREE.Vector3(0, 0.42, 0));
  const spine = add("spine", pelvis, new THREE.Vector3(0, 0.38, 0));
  const chest = add("chest", spine, new THREE.Vector3(0, 0.4, 0));
  const neck = add("neck", chest, new THREE.Vector3(0, 0.27, 0));
  const head = add("head", neck, new THREE.Vector3(0, 0.22, 0));

  for (const s of [-1, 1] as const) {
    const side = s < 0 ? "left" : "right";
    const sh = add(`${side}Shoulder`, chest, new THREE.Vector3(s * (brute ? 0.68 : crawler ? 0.32 : 0.43), 0.1, 0));
    const upper = add(`${side}UpperArm`, sh, new THREE.Vector3(s * 0.1, -0.25, 0));
    const fore = add(`${side}Forearm`, upper, new THREE.Vector3(s * 0.08, -0.42, 0.04));
    add(`${side}Hand`, fore, new THREE.Vector3(s * 0.06, -0.3, 0.05));

    const hip = add(`${side}Hip`, pelvis, new THREE.Vector3(s * (brute ? 0.42 : crawler ? 0.19 : 0.26), -0.02, 0));
    const knee = add(`${side}Knee`, hip, new THREE.Vector3(s * 0.03, -0.42, 0));
    add(`${side}Foot`, knee, new THREE.Vector3(0, -0.42, 0.12));
  }

  root.updateMatrixWorld(true);

  const specs: PartSpec[] = [
    [0, 0.95, 0, brute ? 0.78 : crawler ? 0.38 : 0.54, brute ? 0.78 : crawler ? 0.52 : 0.62, brute ? 0.48 : crawler ? 0.28 : 0.42, 1, "spine"],
    [0, 0.48, 0, brute ? 0.56 : crawler ? 0.32 : 0.45, brute ? 0.42 : crawler ? 0.24 : 0.3, brute ? 0.42 : crawler ? 0.28 : 0.36, 2, "pelvis"],
    [0, 1.55, 0.02, brute ? 0.48 : crawler ? 0.27 : 0.38, brute ? 0.4 : crawler ? 0.26 : 0.32, brute ? 0.42 : crawler ? 0.27 : 0.34, 3, "neck"],
    [0, 1.85, 0.04, brute ? 0.5 : crawler ? 0.31 : 0.43, brute ? 0.48 : crawler ? 0.34 : 0.48, brute ? 0.44 : crawler ? 0.3 : 0.38, 4, "head"],
    ...([-1, 1] as const).flatMap((s): PartSpec[] => {
      const side = s < 0 ? "left" : "right";
      return [
        [s * (brute ? 0.52 : crawler ? 0.3 : 0.43), 1.48, 0, brute ? 0.43 : crawler ? 0.19 : 0.3, brute ? 0.42 : crawler ? 0.22 : 0.32, brute ? 0.43 : crawler ? 0.22 : 0.34, 5, `${side}Shoulder`],
        [s * (brute ? 0.69 : crawler ? 0.39 : 0.57), 1.05, 0.04, brute ? 0.24 : crawler ? 0.11 : 0.18, brute ? 0.46 : crawler ? 0.32 : 0.42, brute ? 0.28 : crawler ? 0.13 : 0.22, 6, `${side}UpperArm`],
        [s * (brute ? 0.8 : crawler ? 0.45 : 0.65), 0.62, 0.05, brute ? 0.21 : crawler ? 0.09 : 0.15, brute ? 0.4 : crawler ? 0.27 : 0.36, brute ? 0.26 : crawler ? 0.12 : 0.19, 7, `${side}Forearm`],
        [s * 0.26, 0.25, 0, 0.17, 0.44, 0.22, 8, `${side}Hip`],
        [s * 0.29, -0.14, 0.03, 0.14, 0.4, 0.18, 9, `${side}Knee`],
        [s * 0.29, -0.45, 0.16, 0.25, 0.15, 0.38, 10, `${side}Foot`],
      ];
    }),
    ...Array.from({ length: 18 }, (_, i): PartSpec => [
      Math.sin(i * 2.3) * 0.42,
      0.48 + i * 0.075,
      0.24,
      0.14,
      0.11,
      0.09,
      11,
      i > 10 ? "chest" : "spine",
    ]),
  ];

  const parts = specs.map(([x, y, z, sx, sy, sz, seed, boneName]) => {
    const g = new THREE.SphereGeometry(1, 22, 16);
    const a = g.attributes.position;
    for (let i = 0; i < a.count; i++) {
      const vx = a.getX(i);
      const vy = a.getY(i);
      const vz = a.getZ(i);
      const n =
        1 +
        0.09 *
          Math.sin(vx * 11 + seed) *
          Math.cos(vy * 8 + seed * 1.4) *
          Math.sin(vz * 7 + seed);
      a.setXYZ(i, vx * sx * n + x, vy * sy * n + y, vz * sz * n + z);
    }
    a.needsUpdate = true;
    g.computeVertexNormals();
    return { geo: g, boneIndex: boneIndexMap[boneName] ?? 0 };
  });

  const { geometry: geo, vertexBoneIndices } = joinIndexedGeometriesWithBones(parts);
  const pos = geo.attributes.position;
  const count = pos.count;

  const si = new Uint16Array(count * 4);
  const sw = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    si[i * 4] = vertexBoneIndices[i];
    sw[i * 4] = 1;
  }
  geo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(si, 4));
  geo.setAttribute("skinWeight", new THREE.Float32BufferAttribute(sw, 4));

  const morphs = ["jawOpen", "mouthSnarl", "muscleFlex", "bodySquash"].map(
    () => new Float32Array(count * 3)
  );
  for (let i = 0; i < count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    if (y > 1.62 && z > 0.14) {
      morphs[0][i * 3 + 1] = -0.14 * Math.min(1, (y - 1.62) * 3);
      morphs[0][i * 3 + 2] = 0.045;
    }
    if (y > 1.58 && y < 1.93 && z > 0.23) {
      morphs[1][i * 3 + 1] = 0.035 * Math.sin(x * 15);
      morphs[1][i * 3 + 2] = 0.055;
    }
    if (Math.abs(x) > 0.48 && y > 0.55 && y < 1.55) {
      morphs[2][i * 3] = x * 0.075;
      morphs[2][i * 3 + 1] = -0.04;
    }
    if (Math.abs(x) < 0.52 && y > 0.55 && y < 1.5) {
      morphs[3][i * 3 + 1] = -0.045;
    }
  }
  geo.morphAttributes.position = morphs.map(
    (a) => new THREE.Float32BufferAttribute(a, 3)
  );
  geo.morphTargetsRelative = true;
  geo.computeBoundingSphere();

  const maps = getSharedMonsterSkinMaps();
  const material = new THREE.MeshStandardMaterial({
    color,
    normalMap: maps.normalMap,
    aoMap: maps.aoMap,
    roughnessMap: maps.roughnessMap,
    roughness: 0.72,
  });
  const node = createWebGPUSurfaceNodeMaterial({
    baseColorHex: color,
    maps,
    normalScale: 1,
    roughnessMultiplier: 0.9,
    aoIntensity: 1.15,
    useSecondaryUVForAO: false,
    vertexColors: false,
  });

  const mesh = new THREE.SkinnedMesh(geo, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.add(root);
  mesh.bind(new THREE.Skeleton(bones));
  mesh.updateMorphTargets();

  // Glowing eyes & dark maw mounted to the head bone so they animate with the skull
  const eyeGeo = new THREE.SphereGeometry(0.068, 10, 8);
  const eyeMat = new THREE.MeshStandardMaterial({
    color: "#ff4c28",
    emissive: "#b82008",
    emissiveIntensity: 1.15,
  });
  const eyes: THREE.Mesh[] = [];
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.set(s * 0.16, 0.22, 0.39);
    head.add(eye);
    eyes.push(eye);
  }
  const mouthGeo = new THREE.SphereGeometry(0.16, 12, 8);
  const mouthMat = new THREE.MeshStandardMaterial({ color: "#26070c", roughness: 0.4 });
  const mouth = new THREE.Mesh(mouthGeo, mouthMat);
  mouth.position.set(0, -0.01, 0.37);
  mouth.scale.set(1.35, 0.52, 0.5);
  head.add(mouth);

  // Bloody neck stump shown when decapitated
  const stumpGeo = new THREE.CylinderGeometry(0.18, 0.23, 0.14, 12);
  const stumpMat = new THREE.MeshStandardMaterial({ color: "#6e0c18", roughness: 0.32 });
  const neckStump = new THREE.Mesh(stumpGeo, stumpMat);
  neckStump.position.set(0, 0.08, 0);
  neckStump.visible = false;
  neck.add(neckStump);

  // Crushed / broken skull gore & bone shards attached to head bone
  const brokenSkullGroup = new THREE.Group();
  const brainGeo = new THREE.SphereGeometry(0.21, 14, 10);
  const brainMat = new THREE.MeshStandardMaterial({ color: "#7a1420", roughness: 0.26 });
  const brainBlob = new THREE.Mesh(brainGeo, brainMat);
  brainBlob.position.set(0.11, 0.34, 0.08);
  brainBlob.scale.set(1.15, 0.78, 1.05);
  brokenSkullGroup.add(brainBlob);

  const shardGeo = new THREE.ConeGeometry(0.08, 0.22, 5);
  const shardMat = new THREE.MeshStandardMaterial({ color: "#d6cbb8", roughness: 0.55 });
  const shardSpecs: Array<[number, number, number, number, number, number]> = [
    [0.24, 0.42, 0.16, 0.4, 0.2, -0.6],
    [0.02, 0.46, 0.22, 0.55, 0.1, 0.35],
    [0.26, 0.26, -0.05, -0.3, 0.4, -0.95],
  ];
  for (const [sx, sy, sz, rx, ry, rz] of shardSpecs) {
    const shard = new THREE.Mesh(shardGeo, shardMat);
    shard.position.set(sx, sy, sz);
    shard.rotation.set(rx, ry, rz);
    brokenSkullGroup.add(shard);
  }
  brokenSkullGroup.visible = false;
  head.add(brokenSkullGroup);

  // Bloody severed thigh stump attached to right hip socket
  const legStumpGroup = new THREE.Group();
  const thighStumpGeo = new THREE.CylinderGeometry(0.13, 0.16, 0.24, 12);
  const thighStump = new THREE.Mesh(thighStumpGeo, stumpMat);
  thighStump.position.set(0, -0.1, 0);
  legStumpGroup.add(thighStump);
  const femurGeo = new THREE.CylinderGeometry(0.045, 0.055, 0.18, 8);
  const femurTip = new THREE.Mesh(femurGeo, shardMat);
  femurTip.position.set(0, -0.22, 0.02);
  femurTip.rotation.z = 0.15;
  legStumpGroup.add(femurTip);
  const rightHipX = brute ? 0.42 : crawler ? 0.19 : 0.26;
  legStumpGroup.position.set(rightHipX, -0.02, 0);
  legStumpGroup.visible = false;
  pelvis.add(legStumpGroup);

  const group = new THREE.Group();
  group.add(mesh);

  return {
    group,
    mesh,
    geometry: geo,
    bones,
    boneMap,
    material,
    node,
    headBone: head,
    neckStump,
    brokenSkullGroup,
    legStumpGroup,
    leftEye: eyes[0],
    rightEye: eyes[1],
    extraDisposables: [
      eyeGeo,
      eyeMat,
      mouthGeo,
      mouthMat,
      stumpGeo,
      stumpMat,
      brainGeo,
      brainMat,
      shardGeo,
      shardMat,
      thighStumpGeo,
      femurGeo,
    ],
  };
}

export default function MonsterProceduralCharacter({
  kind,
  headless = false,
  missingArm = false,
  missingLeg = false,
  brokenHead = false,
  pinned = false,
  dissolve = 0,
  animation = 0,
  moving = true,
  fallen = false,
  attackPulse = 0,
}: Props) {
  const root = useRef<THREE.Group>(null);
  const animClock = useRef(animation);
  const { gl } = useThree();
  const rig = useMemo(() => build(kind), [kind]);
  const isGPU = gl instanceof WebGPURenderer;

  useEffect(() => {
    rig.mesh.material = isGPU ? rig.node : rig.material;
  }, [rig, isGPU]);

  useEffect(() => {
    return () => {
      rig.geometry.dispose();
      rig.material.dispose();
      rig.node.dispose();
      rig.extraDisposables.forEach((d) => d.dispose());
    };
  }, [rig]);

  useFrame((_, dt) => {
    const clampedDt = Math.min(dt, 0.05);
    const strideRate = kind === "crawler" ? 7.8 : kind === "brute" ? 4.4 : 5.6;
    if (!fallen && !pinned) {
      animClock.current += clampedDt * (moving ? strideRate : 1.3);
    }

    const t = animClock.current;
    const p = pinned ? 0 : THREE.MathUtils.clamp(attackPulse, 0, 1);
    const bm = rig.boneMap;
    const head = bm.head;
    const neck = bm.neck;
    const chest = bm.chest;
    const spine = bm.spine;
    const pelvis = bm.pelvis;

    if (head) {
      if (brokenHead && !headless) {
        head.rotation.set(0.32, 0.16, -0.52);
        head.scale.set(0.88, 0.56, 0.72);
        head.visible = true;
      } else {
        head.rotation.set(pinned ? 0.18 : Math.sin(t * 1.4) * 0.07 - p * 0.24, 0, 0);
        head.scale.setScalar(headless ? 0.0001 : 1);
        head.visible = !headless;
      }
    }
    rig.neckStump.visible = headless;
    rig.brokenSkullGroup.visible = brokenHead && !headless;
    rig.rightEye.visible = !brokenHead;
    rig.leftEye.scale.setScalar(brokenHead ? 0.62 : 1);
    rig.legStumpGroup.visible = missingLeg;

    if (pelvis) {
      pelvis.position.y = fallen || pinned ? 0.42 : 0.42 + (moving ? Math.abs(Math.sin(t)) * 0.055 : 0);
      pelvis.rotation.z = fallen || pinned ? 0 : moving ? Math.sin(t) * 0.055 : 0;
    }
    if (neck) neck.rotation.x = pinned ? 0.22 : Math.sin(t * 1.1) * 0.07;
    if (chest) {
      chest.rotation.x = pinned ? 0.24 : (moving ? 0.06 : 0) + Math.sin(t * 1.4) * 0.045 - p * 0.15;
      chest.rotation.z = pinned ? -0.14 : Math.sin(t * 0.7) * 0.04;
    }
    if (spine) spine.rotation.z = pinned ? 0.08 : Math.sin(t * 0.6) * 0.03;

    for (const side of ["left", "right"] as const) {
      const sign = side === "left" ? 1 : -1;
      const phaseOffset = side === "left" ? 0 : Math.PI;
      const arm = bm[`${side}UpperArm`];
      const fore = bm[`${side}Forearm`];
      const hip = bm[`${side}Hip`];
      const knee = bm[`${side}Knee`];
      const foot = bm[`${side}Foot`];

      if (arm) {
        arm.rotation.z = pinned
          ? sign * 0.36
          : (fallen ? sign * 0.65 : Math.sin(t * 0.8 + sign) * 0.12) + p * sign * 0.7;
        arm.rotation.x = pinned
          ? 0.28
          : fallen
            ? 0
            : -Math.sin(t + phaseOffset) * (moving ? 0.42 : 0.06);
        const hideArm = missingArm && side === "right";
        arm.scale.setScalar(hideArm ? 0.0001 : 1);
        arm.visible = !hideArm;
      }
      if (fore) fore.rotation.x = pinned ? -0.35 : p * 0.4 - (moving ? 0.25 : 0.08);
      if (hip) {
        const hideLeg = missingLeg && side === "right";
        hip.scale.setScalar(hideLeg ? 0.0001 : 1);
        hip.visible = !hideLeg;
        hip.rotation.x = pinned ? 0.16 : fallen ? 0 : Math.sin(t + phaseOffset) * (moving ? 0.62 : 0.08);
      }
      if (knee) {
        knee.rotation.x = pinned ? 0.28 : fallen ? 0 : moving ? Math.max(0, -Math.cos(t + phaseOffset)) * 0.78 : 0.06;
      }
      if (foot) {
        foot.rotation.x = pinned ? 0.25 : fallen ? 0 : moving ? Math.sin(t + phaseOffset) * 0.22 : 0;
      }
    }

    const m = rig.mesh.morphTargetInfluences;
    if (m) {
      m[0] = p * 0.7;
      m[1] = p;
      m[2] = p * 0.85 + Math.abs(Math.sin(t)) * 0.12;
      m[3] = fallen ? 0.65 : p * 0.55;
    }

    rig.material.transparent = dissolve > 0;
    rig.material.opacity = 1 - dissolve;
    rig.node.opacity = 1 - dissolve;
    rig.node.transparent = dissolve > 0;

    const baseScale: [number, number, number] =
      kind === "brute"
        ? [1.32, 1.28, 1.22]
        : kind === "crawler"
          ? [0.78, 0.56, 0.82]
          : [1, 1, 1];

    if (root.current) {
      const dissolveScale = 1 - dissolve * 0.25;
      root.current.position.y = fallen || pinned
        ? 0
        : 0.56 * baseScale[1] + (moving ? Math.abs(Math.sin(t)) * 0.04 * baseScale[1] : 0);
      root.current.rotation.z = 0;
      root.current.scale.set(
        baseScale[0] * dissolveScale,
        baseScale[1] * dissolveScale,
        baseScale[2] * dissolveScale
      );
    }
  });

  return (
    <group
      ref={root}
      scale={
        kind === "brute"
          ? [1.32, 1.28, 1.22]
          : kind === "crawler"
            ? [0.78, 0.56, 0.82]
            : [1, 1, 1]
      }
    >
      <primitive object={rig.group} />
      {missingArm && (
        <mesh position={[0.62, 1.32, 0]} scale={[0.16, 0.14, 0.16]}>
          <sphereGeometry args={[1, 16, 12]} />
          <meshStandardMaterial color="#6e0c18" roughness={0.35} />
        </mesh>
      )}
    </group>
  );
}

