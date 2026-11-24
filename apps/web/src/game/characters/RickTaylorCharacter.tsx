import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

export type RickWeaponId = "pipe" | "machete" | "shotgun";

export type RickMotion = {
  moving: boolean;
  attackTime: number;
  grabTime: number;
  jumpHeight: number;
  weapon: RickWeaponId | null;
};

type Props = { motion: RickMotion; equippedWeapon?: RickWeaponId | null };

function makeFabricTexture(base: string, stitch: string, seed: number) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 512, 512);

  // Fine irregular fibers, not a flat color fill.
  for (let i = 0; i < 14500; i++) {
    const x = (Math.sin(i * 12.9898 + seed) * 43758.5453 % 1 + 1) * 256;
    const y = (Math.sin(i * 78.233 + seed * 2) * 19341.234 % 1 + 1) * 256;
    ctx.globalAlpha = 0.035 + (i % 5) * 0.012;
    ctx.fillStyle = i % 2 ? "#d5d9df" : "#101a31";
    ctx.fillRect(x, y, 1 + (i % 3), 1);
  }
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = stitch;
  ctx.lineWidth = 1.4;
  for (let y = 18; y < 512; y += 34) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(512, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}

function makeSkinTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createLinearGradient(0, 0, 512, 512);
  gradient.addColorStop(0, "#d19a7e");
  gradient.addColorStop(0.5, "#bd8068");
  gradient.addColorStop(1, "#9e6556");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 18000; i++) {
    const x = (Math.sin(i * 91.7) * 43758.5 % 1 + 1) * 256;
    const y = (Math.sin(i * 17.13) * 12931.7 % 1 + 1) * 256;
    ctx.globalAlpha = 0.025 + (i % 4) * 0.012;
    ctx.fillStyle = i % 3 ? "#f2c2a2" : "#673f37";
    ctx.beginPath();
    ctx.arc(x, y, 0.5 + (i % 3) * 0.45, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}

function oval(
  geometry: THREE.SphereGeometry,
  material: THREE.Material,
  position: [number, number, number],
  scale: [number, number, number],
  rotation?: [number, number, number],
) {
  return (
    <mesh
      geometry={geometry}
      material={material}
      position={position}
      scale={scale}
      rotation={rotation}
      castShadow
      receiveShadow
    />
  );
}

function Capsule({
  geometry,
  material,
  position,
  rotation,
  scale,
}: {
  geometry: THREE.CapsuleGeometry;
  material: THREE.Material;
  position: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
}) {
  return (
    <mesh
      geometry={geometry}
      material={material}
      position={position}
      rotation={rotation}
      scale={scale}
      castShadow
      receiveShadow
    />
  );
}

/**
 * Rick Taylor — high-detail procedural R3F model.
 * Anatomical masses overlap deliberately to create a continuous silhouette;
 * fine material maps, layered anatomy and stitched clothing add close-up detail.
 */
export default function RickTaylorCharacter({ motion, equippedWeapon = null }: Props) {
  const root = useRef<THREE.Group>(null);
  const torso = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const leftArm = useRef<THREE.Group>(null);
  const rightArm = useRef<THREE.Group>(null);
  const leftLeg = useRef<THREE.Group>(null);
  const rightLeg = useRef<THREE.Group>(null);

  const assets = useMemo(() => {
    const skinMap = makeSkinTexture();
    const denimMap = makeFabricTexture("#294b82", "#6d8db5", 7);
    const skin = new THREE.MeshPhysicalMaterial({
      color: "#d2a087", map: skinMap, roughness: 0.64, metalness: 0,
      clearcoat: 0.12, clearcoatRoughness: 0.72,
    });
    const skinShadow = new THREE.MeshPhysicalMaterial({
      color: "#a96e5d", map: skinMap, roughness: 0.7, clearcoat: 0.08,
    });
    const skinLight = new THREE.MeshPhysicalMaterial({
      color: "#e0ae91", map: skinMap, roughness: 0.6, clearcoat: 0.15,
    });
    const denim = new THREE.MeshStandardMaterial({
      color: "#ffffff", map: denimMap, roughness: 0.91,
    });
    const denimDark = new THREE.MeshStandardMaterial({
      color: "#172f59", map: denimMap, roughness: 0.95,
    });
    const denimSeam = new THREE.MeshStandardMaterial({
      color: "#91a5bd", roughness: 0.86,
    });
    const mask = new THREE.MeshPhysicalMaterial({
      color: "#ded9ca", roughness: 0.46, metalness: 0.04,
      clearcoat: 0.32, clearcoatRoughness: 0.38,
    });
    const maskEdge = new THREE.MeshStandardMaterial({ color: "#aaa596", roughness: 0.68 });
    const maskDark = new THREE.MeshStandardMaterial({ color: "#17171a", roughness: 0.84 });
    const bone = new THREE.MeshStandardMaterial({ color: "#e6ddc6", roughness: 0.72 });
    const boot = new THREE.MeshPhysicalMaterial({ color: "#171619", roughness: 0.48, clearcoat: 0.28 });
    const bootEdge = new THREE.MeshStandardMaterial({ color: "#383034", roughness: 0.72 });
    const metal = new THREE.MeshStandardMaterial({ color: "#9a8c70", metalness: 0.78, roughness: 0.28 });
    const blood = new THREE.MeshStandardMaterial({ color: "#4d1119", roughness: 0.48 });
    const sphere = new THREE.SphereGeometry(1, 48, 32);
    const capsule = new THREE.CapsuleGeometry(0.12, 0.42, 10, 24);
    const smallCapsule = new THREE.CapsuleGeometry(0.045, 0.13, 6, 12);
    return {
      skinMap, denimMap, skin, skinShadow, skinLight, denim, denimDark,
      denimSeam, mask, maskEdge, maskDark, bone, boot, bootEdge, metal,
      blood, sphere, capsule, smallCapsule,
    };
  }, []);

  useFrame((_, dt) => {
    if (!root.current) return;
    const t = performance.now() * 0.001;
    const gait = motion.moving ? Math.sin(t * 10) : 0;
    const punch = motion.attackTime > 0
      ? Math.sin((1 - motion.attackTime / 0.34) * Math.PI) : 0;
    const activeWeapon = equippedWeapon ?? motion.weapon;
    const grab = motion.grabTime > 0
      ? Math.sin((1 - motion.grabTime / 0.46) * Math.PI) : 0;

    if (torso.current) {
      torso.current.position.y = 1.06 + (motion.moving
        ? Math.abs(gait) * 0.035 : Math.sin(t * 2.2) * 0.009);
      torso.current.rotation.z = THREE.MathUtils.damp(
        torso.current.rotation.z, motion.moving ? gait * 0.022 : 0, 8, dt,
      );
      torso.current.rotation.x = THREE.MathUtils.damp(
        torso.current.rotation.x, punch * -0.045 + grab * 0.06, 10, dt,
      );
    }
    if (leftLeg.current) {
      leftLeg.current.rotation.x = THREE.MathUtils.damp(leftLeg.current.rotation.x, gait * 0.55, 10, dt);
    }
    if (rightLeg.current) {
      rightLeg.current.rotation.x = THREE.MathUtils.damp(rightLeg.current.rotation.x, -gait * 0.55, 10, dt);
    }
    if (leftArm.current) {
      leftArm.current.rotation.x = THREE.MathUtils.damp(
        leftArm.current.rotation.x, -gait * 0.32 - grab * 1.12, 12, dt,
      );
      leftArm.current.rotation.z = THREE.MathUtils.damp(
        leftArm.current.rotation.z, 0.08 + grab * 0.2, 12, dt,
      );
    }
    if (rightArm.current) {
      rightArm.current.rotation.x = THREE.MathUtils.damp(
        rightArm.current.rotation.x, gait * 0.32 - punch * 1.72 - grab * 1.12, 14, dt,
      );
      rightArm.current.rotation.z = THREE.MathUtils.damp(
        rightArm.current.rotation.z, -0.08 - grab * 0.2, 12, dt,
      );
    }
    if (head.current) {
      head.current.rotation.x = THREE.MathUtils.damp(head.current.rotation.x, grab * 0.08, 8, dt);
      head.current.rotation.y = THREE.MathUtils.damp(head.current.rotation.y, punch * 0.035, 8, dt);
    }
    root.current.position.y = motion.jumpHeight;
  });

  const a = assets;
  return (
    <group ref={root} scale={1.04} dispose={null}>
      {/* Pelvis and tailored jeans */}
      {oval(a.sphere, a.denim, [0, 0.91, 0], [0.36, 0.29, 0.255])}
      <mesh position={[0, 1.065, -0.238]} castShadow>
        <boxGeometry args={[0.56, 0.055, 0.025]} />
        <meshStandardMaterial color="#1a2941" roughness={0.9} />
      </mesh>
      {[-1, 1].map((side) => (
        <group key={side} position={[side * 0.18, 0.91, 0]}>
          {oval(a.sphere, a.denim, [0, -0.2, 0], [0.195, 0.37, 0.22])}
          {oval(a.sphere, a.denimDark, [0, -0.405, -0.008], [0.164, 0.12, 0.19])}
          <Capsule geometry={a.capsule} material={a.denim} position={[0, -0.59, 0]} rotation={[0, 0, Math.PI]} />
          {oval(a.sphere, a.denim, [0, -0.48, -0.188], [0.115, 0.15, 0.035])}
          {/* Double-stitched outer seam */}
          <mesh position={[side * 0.176, -0.36, -0.005]}>
            <boxGeometry args={[0.012, 0.58, 0.012]} />
            <meshStandardMaterial color="#7892b3" roughness={0.9} />
          </mesh>
          {/* Knee folds */}
          {[-0.46, -0.51].map((y, i) => (
            <mesh key={i} position={[0, y, -0.18]} rotation={[0, 0, (i ? 1 : -1) * 0.12]}>
              <boxGeometry args={[0.19, 0.012, 0.012]} />
              <meshStandardMaterial color="#58769f" roughness={0.95} />
            </mesh>
          ))}
          {/* Work boot, welt, sole and laces */}
          {oval(a.sphere, a.boot, [0, -0.82, -0.09], [0.185, 0.14, 0.30])}
          {oval(a.sphere, a.bootEdge, [0, -0.925, -0.085], [0.19, 0.045, 0.30])}
          {oval(a.sphere, a.boot, [0, -0.785, -0.245], [0.16, 0.075, 0.13])}
          {[-0.04, 0.015, 0.07].map((z, i) => (
            <mesh key={i} position={[0, -0.75 + i * 0.018, z - 0.25]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.009, 0.009, 0.16, 8]} />
              <meshStandardMaterial color="#c4b8a5" roughness={0.8} />
            </mesh>
          ))}
        </group>
      ))}

      {/* Torso: broad chest, trapezius, pectorals and abdominal planes */}
      <group ref={torso} position={[0, 1.06, 0]}>
        {oval(a.sphere, a.skin, [0, 0.32, 0], [0.43, 0.57, 0.275])}
        {oval(a.sphere, a.skinLight, [0, 0.57, 0.025], [0.56, 0.35, 0.305])}
        {oval(a.sphere, a.skinShadow, [0, 0.12, 0.012], [0.35, 0.33, 0.24])}
        {oval(a.sphere, a.skin, [0, 0.79, -0.015], [0.27, 0.23, 0.22])}
        {/* Clavicles and separated pectoral masses */}
        {oval(a.sphere, a.skinLight, [-0.18, 0.56, 0.205], [0.285, 0.19, 0.125], [0, 0, -0.08])}
        {oval(a.sphere, a.skinLight, [0.18, 0.56, 0.205], [0.285, 0.19, 0.125], [0, 0, 0.08])}
        {oval(a.sphere, a.skinShadow, [0, 0.43, 0.28], [0.018, 0.13, 0.018])}
        {oval(a.sphere, a.skinLight, [0, 0.77, 0.13], [0.29, 0.075, 0.105])}
        {/* Anatomical abdominal planes */}
        {[-0.08, 0.08, 0.23].map((y, i) => (
          <group key={i}>
            {oval(a.sphere, a.skinLight, [-0.085, y, 0.218], [0.079, 0.066, 0.043])}
            {oval(a.sphere, a.skinLight, [0.085, y, 0.218], [0.079, 0.066, 0.043])}
          </group>
        ))}
        {oval(a.sphere, a.skinShadow, [0, 0.08, 0.254], [0.012, 0.23, 0.012])}
        {oval(a.sphere, a.skinShadow, [0, -0.18, 0.20], [0.035, 0.025, 0.018])}
        {/* Shoulder caps, biceps, triceps and forearm muscle groups */}
        <group ref={leftArm} position={[-0.48, 0.61, 0]}>
          {oval(a.sphere, a.skinLight, [0, 0.015, 0], [0.245, 0.25, 0.235])}
          {oval(a.sphere, a.skin, [-0.035, -0.22, 0.015], [0.19, 0.25, 0.18], [0, 0, -0.08])}
          <Capsule geometry={a.capsule} material={a.skin} position={[-0.035, -0.32, 0]} rotation={[0, 0, 0.08]} />
          {oval(a.sphere, a.skinLight, [-0.06, -0.51, 0.005], [0.16, 0.17, 0.155])}
          {oval(a.sphere, a.skinShadow, [-0.04, -0.57, 0.105], [0.09, 0.12, 0.075])}
          <Capsule geometry={a.capsule} material={a.skin} position={[-0.08, -0.76, -0.015]} rotation={[0, 0, 0.04]} />
          {oval(a.sphere, a.skinLight, [-0.09, -0.99, -0.025], [0.155, 0.145, 0.15])}
          {/* Knuckles and fingers */}
          {[-0.16, -0.105, -0.05, 0.005].map((x, i) => (
            <group key={i}>
              <Capsule geometry={a.smallCapsule} material={a.skinLight} position={[x, -1.09, -0.12]} rotation={[0, 0, Math.PI / 2]} />
              {oval(a.sphere, a.skinShadow, [x, -1.15, -0.12], [0.027, 0.027, 0.027])}
            </group>
          ))}
          {oval(a.sphere, a.skin, [-0.19, -1.01, -0.04], [0.055, 0.075, 0.06], [0, 0, -0.55])}
          {oval(a.sphere, a.blood, [-0.12, 0.06, -0.17], [0.11, 0.045, 0.025])}
        </group>
        <group ref={rightArm} position={[0.48, 0.61, 0]}>
          {oval(a.sphere, a.skinLight, [0, 0.015, 0], [0.245, 0.25, 0.235])}
          {oval(a.sphere, a.skin, [0.035, -0.22, 0.015], [0.19, 0.25, 0.18], [0, 0, 0.08])}
          <Capsule geometry={a.capsule} material={a.skin} position={[0.035, -0.32, 0]} rotation={[0, 0, -0.08]} />
          {oval(a.sphere, a.skinLight, [0.06, -0.51, 0.005], [0.16, 0.17, 0.155])}
          {oval(a.sphere, a.skinShadow, [0.04, -0.57, 0.105], [0.09, 0.12, 0.075])}
          <Capsule geometry={a.capsule} material={a.skin} position={[0.08, -0.76, -0.015]} rotation={[0, 0, -0.04]} />
          {oval(a.sphere, a.skinLight, [0.09, -0.99, -0.025], [0.155, 0.145, 0.15])}
          {[-0.005, 0.05, 0.105, 0.16].map((x, i) => (
            <group key={i}>
              <Capsule geometry={a.smallCapsule} material={a.skinLight} position={[x, -1.09, -0.12]} rotation={[0, 0, Math.PI / 2]} />
              {oval(a.sphere, a.skinShadow, [x, -1.15, -0.12], [0.027, 0.027, 0.027])}
            </group>
          ))}
          {oval(a.sphere, a.skin, [0.19, -1.01, -0.04], [0.055, 0.075, 0.06], [0, 0, 0.55])}
          {oval(a.sphere, a.blood, [0.11, 0.08, -0.17], [0.08, 0.035, 0.02])}
          {activeWeapon === "pipe" && <group position={[0.12, -1.03, -0.18]} rotation={[0.18, 0, 0.08]}>
            <mesh rotation={[Math.PI / 2, 0, 0]} castShadow><cylinderGeometry args={[0.055, 0.055, 1.22, 16]} /><meshStandardMaterial color="#929895" metalness={0.82} roughness={0.24} /></mesh>
            <mesh position={[0, 0, 0.36]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.067, 0.067, 0.28, 12]} /><meshStandardMaterial color="#503222" roughness={0.86} /></mesh>
          </group>}
          {activeWeapon === "machete" && <group position={[0.12, -1.03, -0.18]} rotation={[0.12, 0, 0.05]}>
            <mesh position={[0, 0, -0.31]} castShadow><boxGeometry args={[0.055, 0.12, 0.88]} /><meshStandardMaterial color="#d1d2c8" metalness={0.86} roughness={0.2} /></mesh>
            <mesh position={[0, 0, 0.2]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.06, 0.06, 0.3, 12]} /><meshStandardMaterial color="#503020" roughness={0.86} /></mesh>
          </group>}
          {activeWeapon === "shotgun" && <group position={[0.12, -0.92, -0.18]} rotation={[0.15, 0, 0]}>
            <mesh position={[0, 0, -0.25]} castShadow><boxGeometry args={[0.14, 0.17, 0.72]} /><meshStandardMaterial color="#292326" metalness={0.3} roughness={0.48} /></mesh>
            <mesh position={[0, 0.015, -0.73]} castShadow><cylinderGeometry args={[0.045, 0.045, 0.78, 16]} /><meshStandardMaterial color="#858b89" metalness={0.82} roughness={0.23} /></mesh>
            <mesh position={[0, -0.12, 0.12]} castShadow><boxGeometry args={[0.095, 0.25, 0.16]} /><meshStandardMaterial color="#4a2c20" roughness={0.84} /></mesh>
          </group>}
        </group>

        {/* Neck and trapezius transition */}
        {oval(a.sphere, a.skinShadow, [0, 0.91, 0], [0.19, 0.23, 0.18])}
        {oval(a.sphere, a.skinLight, [0, 1.0, 0.015], [0.16, 0.16, 0.16])}

        {/* Large sculpted skull mask */}
        <group ref={head} position={[0, 1.12, 0.015]}>
          {oval(a.sphere, a.skin, [0, 0.02, 0], [0.33, 0.39, 0.28])}
          {oval(a.sphere, a.maskEdge, [0, 0.015, -0.11], [0.35, 0.355, 0.245])}
          {oval(a.sphere, a.mask, [0, 0.025, -0.135], [0.337, 0.345, 0.235])}
          {oval(a.sphere, a.mask, [0, -0.19, -0.145], [0.26, 0.16, 0.20])}
          {/* Brow, eye sockets, nasal cavity and jaw opening */}
          {oval(a.sphere, a.maskEdge, [0, 0.16, -0.315], [0.31, 0.075, 0.045])}
          {oval(a.sphere, a.maskDark, [-0.13, 0.075, -0.326], [0.112, 0.068, 0.035])}
          {oval(a.sphere, a.maskDark, [0.13, 0.075, -0.326], [0.112, 0.068, 0.035])}
          {oval(a.sphere, a.maskEdge, [-0.13, 0.16, -0.315], [0.12, 0.035, 0.035], [0, 0, -0.12])}
          {oval(a.sphere, a.maskEdge, [0.13, 0.16, -0.315], [0.12, 0.035, 0.035], [0, 0, 0.12])}
          {oval(a.sphere, a.maskDark, [0, -0.055, -0.344], [0.068, 0.105, 0.045])}
          {oval(a.sphere, a.maskDark, [0, -0.205, -0.318], [0.18, 0.06, 0.045])}
          {[-2, -1, 0, 1, 2].map((i) => (
            <group key={i}>
              {oval(a.sphere, a.bone, [i * 0.058, -0.205, -0.357], [0.021, 0.037, 0.014])}
            </group>
          ))}
          {/* Cracks and worn mask rivets */}
          {[-1, 1].map((side) => (
            <group key={side}>
              {oval(a.sphere, a.maskEdge, [side * 0.285, -0.075, -0.285], [0.018, 0.09, 0.018], [0, 0, side * -0.32])}
              {oval(a.sphere, a.metal, [side * 0.285, 0.235, -0.28], [0.025, 0.025, 0.018])}
            </group>
          ))}
        </group>
      </group>

      {/* Belt, metal buckle and rear/side belt loops */}
      <mesh position={[0, 0.99, -0.255]} castShadow>
        <boxGeometry args={[0.64, 0.075, 0.035]} />
        <meshStandardMaterial color="#252329" roughness={0.72} />
      </mesh>
      <mesh position={[0, 0.99, -0.282]} castShadow>
        <boxGeometry args={[0.13, 0.095, 0.025]} />
        <primitive object={a.metal} attach="material" />
      </mesh>
      {[-0.25, 0.25].map((x) => (
        <mesh key={x} position={[x, 1.0, -0.26]}>
          <boxGeometry args={[0.055, 0.12, 0.025]} />
          <meshStandardMaterial color="#1b1b20" roughness={0.85} />
        </mesh>
      ))}
    </group>
  );
}
