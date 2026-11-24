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

function ellipsoid(geometry: THREE.SphereGeometry, material: THREE.Material, position: [number,number,number], scale: [number,number,number]) {
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
    <group position={[0, -0.28, -0.02]} rotation={[-Math.PI / 2, 0, 0]}>
      <mesh position={[0, 0, -0.18]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.045, 0.045, 1.05, 12]} />
        <meshStandardMaterial color="#777c7a" metalness={0.82} roughness={0.25} />
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

/** Rick's procedural replacement model with articulated elbows, torso twist, and hand-mounted weapons. */
export default function RickTaylorCharacter({ motion, equippedWeapon = null }: Props) {
  const root = useRef<THREE.Group>(null);
  const torso = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const leftArm = useRef<THREE.Group>(null);
  const leftForearm = useRef<THREE.Group>(null);
  const rightArm = useRef<THREE.Group>(null);
  const rightForearm = useRef<THREE.Group>(null);
  const leftLeg = useRef<THREE.Group>(null);
  const rightLeg = useRef<THREE.Group>(null);
  const muzzleRef = useRef<THREE.Group>(null);

  const materials = useMemo(() => {
    const makeTexture = (base: string, fiber: string, seed: number) => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 512;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, 512, 512);
      for (let i = 0; i < 12000; i++) {
        const x = ((Math.sin(i * 91.7 + seed) * 43758.5) % 1 + 1) * 256;
        const y = ((Math.sin(i * 17.13 + seed * 2) * 12931.7) % 1 + 1) * 256;
        ctx.globalAlpha = 0.025 + (i % 5) * 0.009;
        ctx.fillStyle = i % 3 ? fiber : "#211b1a";
        ctx.fillRect(x, y, 1 + (i % 3), 1);
      }
      ctx.globalAlpha = 1;
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.anisotropy = 8;
      return texture;
    };
    const skinMap = makeTexture("#bd8068", "#f0c1a2", 13);
    const denimMap = makeTexture("#294b82", "#8da4c5", 29);
    const makeSkinSurface = (seed: number) => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 512;
      const ctx = canvas.getContext("2d")!;
      const image = ctx.createImageData(512, 512);
      for (let i = 0; i < image.data.length; i += 4) {
        const p = i / 4;
        const n = Math.sin(p * 0.017 + seed) * 0.5 + Math.sin(p * 0.0031 + seed * 2) * 0.25 + Math.sin(p * 0.071) * 0.12;
        const v = Math.max(82, Math.min(184, 132 + n * 48 + ((p * 37) % 13)));
        image.data[i] = image.data[i + 1] = image.data[i + 2] = v;
        image.data[i + 3] = 255;
      }
      ctx.putImageData(image, 0, 0);
      const texture = new THREE.CanvasTexture(canvas);
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(1.5, 1.5);
      texture.anisotropy = 8;
      return texture;
    };
    const skinSurface = makeSkinSurface(17);
    const skin = new THREE.MeshPhysicalMaterial({ color: "#d0a087", map: skinMap, roughnessMap: skinSurface, bumpMap: skinSurface, bumpScale: 0.026, roughness: 0.48, clearcoat: 0.38, clearcoatRoughness: 0.24, sheen: 0.22, sheenRoughness: 0.48 });
    const skinLight = new THREE.MeshPhysicalMaterial({ color: "#e0ad91", map: skinMap, roughnessMap: skinSurface, bumpMap: skinSurface, bumpScale: 0.022, roughness: 0.46, clearcoat: 0.42, clearcoatRoughness: 0.22, sheen: 0.2 });
    const denim = new THREE.MeshStandardMaterial({ color: "#ffffff", map: denimMap, roughness: 0.9 });
    const denimLight = new THREE.MeshStandardMaterial({ color: "#5276a7", map: denimMap, roughness: 0.88 });
    const mask = new THREE.MeshPhysicalMaterial({ color: "#e0ddd1", roughness: 0.42, metalness: 0.035, clearcoat: 0.35 });
    const maskShade = new THREE.MeshStandardMaterial({ color: "#1c1a1d", roughness: 0.78 });
    const blood = new THREE.MeshPhysicalMaterial({ color: "#641019", roughness: 0.24, metalness: 0.015, clearcoat: 0.92, clearcoatRoughness: 0.09 });
    const sweat = new THREE.MeshPhysicalMaterial({ color: "#d9b6a0", roughness: 0.07, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.025, transparent: true, opacity: 0.82 });
    const boot = new THREE.MeshPhysicalMaterial({ color: "#171518", roughness: 0.48, clearcoat: 0.3 });
    const bootSole = new THREE.MeshStandardMaterial({ color: "#393238", roughness: 0.8 });
    const seam = new THREE.MeshStandardMaterial({ color: "#91a7c4", roughness: 0.88 });
    const metal = new THREE.MeshStandardMaterial({ color: "#a99a7c", metalness: 0.82, roughness: 0.24 });
    return { skin, skinLight, denim, denimLight, mask, maskShade, blood, sweat, boot, bootSole, seam, metal };
  }, []);

  const sphere = useMemo(() => new THREE.SphereGeometry(1, 56, 40), []);
  const capsule = useMemo(() => new THREE.CapsuleGeometry(0.12, 0.42, 12, 28), []);

  useFrame((_, dt) => {
    if (!root.current) return;
    const t = performance.now() * 0.001;
    const gait = motion.moving ? Math.sin(t * 10) : 0;
    const activeWeapon = equippedWeapon ?? motion.weapon;
    const attackDur = activeWeapon === "shotgun" ? 0.34 : activeWeapon === "pipe" ? 0.68 : activeWeapon === "machete" ? 0.44 : 0.36;
    const p = motion.attackTime > 0 ? THREE.MathUtils.clamp(1 - motion.attackTime / attackDur, 0, 1) : 0;
    const grabProgress = motion.grabTime > 0 ? THREE.MathUtils.clamp(1 - motion.grabTime / 1.35, 0, 1) : 0;
    const grab = grabProgress > 0 ? Math.sin(grabProgress * Math.PI) : 0;

    let torsoRotY = motion.moving ? gait * 0.06 : 0;
    let torsoRotX = motion.moving ? 0.05 : 0;
    let torsoRotZ = motion.moving ? gait * 0.025 : 0;

    let rShoulderX = gait * 0.35 + 0.12;
    let rShoulderZ = -0.08;
    let rElbowX = 0.52;
    let lShoulderX = -gait * 0.35 + 0.32;
    let lShoulderZ = 0.1;
    let lElbowX = 0.72;

    if (activeWeapon === "shotgun") {
      rShoulderX = -0.22 + gait * 0.1;
      rElbowX = 1.65;
      rShoulderZ = -0.04;
      lShoulderX = 0.35 - gait * 0.1;
      lElbowX = 1.25;
      lShoulderZ = 0.24;
      torsoRotY = 0.22;
      if (motion.attackTime > 0) {
        const kick = Math.sin(p * Math.PI);
        rShoulderX -= kick * 0.42;
        rElbowX -= kick * 0.18;
        torsoRotX -= kick * 0.16;
      }
    } else if (activeWeapon === "pipe" || activeWeapon === "machete") {
      rShoulderX = 0.15 + gait * 0.22;
      rElbowX = 0.48;
      if (motion.attackTime > 0) {
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
      // Three distinct two-handed phases: reach/grip, lift overhead, then forceful backward throw.
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

    if (torso.current) {
      torso.current.position.y = 1.05 + (motion.moving ? Math.abs(gait) * 0.035 : Math.sin(t * 2.2) * 0.012);
      torso.current.rotation.y = THREE.MathUtils.damp(torso.current.rotation.y, torsoRotY, 18, dt);
      torso.current.rotation.x = THREE.MathUtils.damp(torso.current.rotation.x, torsoRotX, 18, dt);
      torso.current.rotation.z = THREE.MathUtils.damp(torso.current.rotation.z, torsoRotZ, 10, dt);
    }

    if (leftLeg.current) leftLeg.current.rotation.x = THREE.MathUtils.damp(leftLeg.current.rotation.x, gait * 0.55, 10, dt);
    if (rightLeg.current) rightLeg.current.rotation.x = THREE.MathUtils.damp(rightLeg.current.rotation.x, -gait * 0.55, 10, dt);

    if (leftArm.current) {
      leftArm.current.rotation.x = THREE.MathUtils.damp(leftArm.current.rotation.x, lShoulderX, 22, dt);
      leftArm.current.rotation.z = THREE.MathUtils.damp(leftArm.current.rotation.z, lShoulderZ, 18, dt);
    }
    if (leftForearm.current) {
      leftForearm.current.rotation.x = THREE.MathUtils.damp(leftForearm.current.rotation.x, lElbowX, 22, dt);
    }
    if (rightArm.current) {
      rightArm.current.rotation.x = THREE.MathUtils.damp(rightArm.current.rotation.x, rShoulderX, 24, dt);
      rightArm.current.rotation.z = THREE.MathUtils.damp(rightArm.current.rotation.z, rShoulderZ, 20, dt);
    }
    if (rightForearm.current) {
      rightForearm.current.rotation.x = THREE.MathUtils.damp(rightForearm.current.rotation.x, rElbowX, 24, dt);
    }
    if (head.current) {
      head.current.rotation.y = THREE.MathUtils.damp(head.current.rotation.y, -torsoRotY * 0.65, 14, dt);
      head.current.rotation.x = THREE.MathUtils.damp(head.current.rotation.x, grab * 0.08, 8, dt);
    }
    if (muzzleRef.current) {
      muzzleRef.current.visible = activeWeapon === "shotgun" && motion.attackTime > 0.22;
    }
    root.current.position.y = motion.jumpHeight;
  });

  return (
    <group ref={root} scale={1.04} dispose={null}>
      {/* Pelvis and trousers form a continuous silhouette */}
      {ellipsoid(sphere, materials.denim, [0,0.91,0], [0.34,0.28,0.25])}
      <group ref={leftLeg} position={[-0.18,0.91,0]}>
        {ellipsoid(sphere, materials.denim, [0,-0.20,0], [0.19,0.36,0.22])}
        {ellipsoid(sphere, materials.denimLight, [0,-0.39,-0.005], [0.16,0.12,0.19])}
        <mesh geometry={capsule} material={materials.denim} position={[0,-0.59,0]} rotation={[0,0,Math.PI]} castShadow />
        {ellipsoid(sphere, materials.boot, [0,-0.82,-0.09], [0.18,0.13,0.29])}
        {ellipsoid(sphere, materials.bootSole, [0,-0.925,-0.09], [0.185,0.035,0.295])}
        {[-0.46,-0.51].map((y,i)=><mesh key={i} position={[0,y,-0.185]} rotation={[0,0,i===0?0.1:-0.1]}><boxGeometry args={[0.2,0.012,0.012]}/><meshStandardMaterial color="#91a7c4" roughness={0.88}/></mesh>)}
        <mesh position={[0,-0.77,-0.29]}><boxGeometry args={[0.11,0.014,0.012]}/><meshStandardMaterial color="#91a7c4" roughness={0.88}/></mesh>
      </group>
      <group ref={rightLeg} position={[0.18,0.91,0]}>
        {ellipsoid(sphere, materials.denim, [0,-0.20,0], [0.19,0.36,0.22])}
        {ellipsoid(sphere, materials.denimLight, [0,-0.39,-0.005], [0.16,0.12,0.19])}
        <mesh geometry={capsule} material={materials.denim} position={[0,-0.59,0]} rotation={[0,0,Math.PI]} castShadow />
        {ellipsoid(sphere, materials.boot, [0,-0.82,-0.09], [0.18,0.13,0.29])}
      </group>
      {/* Broad, tapered torso; large overlapping volumes blend visually with smooth shading */}
      <group ref={torso} position={[0,1.05,0]}>
        {ellipsoid(sphere, materials.skin, [0,0.34,0], [0.43,0.58,0.27])}
        {ellipsoid(sphere, materials.skinLight, [0,0.57,-0.025], [0.55,0.34,0.30])}
        {ellipsoid(sphere, materials.skin, [0,0.12,-0.015], [0.34,0.32,0.235])}
        {ellipsoid(sphere, materials.skinLight, [-0.17,0.56,-0.19], [0.29,0.205,0.145])}
        {ellipsoid(sphere, materials.skinLight, [0.17,0.56,-0.19], [0.29,0.205,0.145])}
        {ellipsoid(sphere, materials.skin, [0,0.79,0], [0.25,0.23,0.22])}
        {/* Anatomical clavicles, pectoral separation and sculpted abdominal planes */}
        {ellipsoid(sphere, materials.skinLight, [-0.19,0.78,-0.12], [0.25,0.09,0.11],)}
        {ellipsoid(sphere, materials.skinLight, [0.19,0.78,-0.12], [0.25,0.09,0.11])}
        {ellipsoid(sphere, materials.skin, [0,0.40,-0.225], [0.018,0.22,0.018])}
        {[-0.13,0.02,0.17].map((y,i) => <group key={i}>
          {ellipsoid(sphere, materials.skinLight, [-0.09,y,-0.205], [0.083,0.068,0.045])}
          {ellipsoid(sphere, materials.skinLight, [0.09,y,-0.205], [0.083,0.068,0.045])}
        </group>)}
        {ellipsoid(sphere, materials.skin, [0,-0.18,-0.20], [0.035,0.025,0.018])}
        {/* Irregular fresh blood smears and small coagulated droplets across the chest and abdomen */}
        {ellipsoid(sphere, materials.blood, [-0.28,0.68,-0.245], [0.105,0.035,0.018])}
        {ellipsoid(sphere, materials.blood, [-0.34,0.62,-0.246], [0.045,0.065,0.016])}
        {ellipsoid(sphere, materials.blood, [0.23,0.42,-0.232], [0.12,0.026,0.014])}
        {ellipsoid(sphere, materials.blood, [0.19,0.36,-0.235], [0.035,0.074,0.014])}
        {ellipsoid(sphere, materials.blood, [-0.09,0.05,-0.238], [0.07,0.025,0.014])}
        {ellipsoid(sphere, materials.blood, [0.31,0.73,-0.19], [0.045,0.018,0.012])}
        {/* Sweat beads catch the scene lights; varied sizes avoid a uniform plastic sheen */}
        {ellipsoid(sphere, materials.sweat, [-0.22,0.83,-0.245], [0.018,0.032,0.012])}
        {ellipsoid(sphere, materials.sweat, [0.12,0.76,-0.272], [0.012,0.024,0.01])}
        {ellipsoid(sphere, materials.sweat, [0.34,0.51,-0.18], [0.016,0.038,0.012])}
        {ellipsoid(sphere, materials.sweat, [-0.14,0.29,-0.226], [0.011,0.027,0.009])}
        {ellipsoid(sphere, materials.sweat, [0.04,-0.02,-0.235], [0.014,0.03,0.01])}
        <group ref={leftArm} position={[-0.47,0.61,0]}>
          {ellipsoid(sphere, materials.skinLight, [0,0,0], [0.245,0.25,0.235])}
          {ellipsoid(sphere, materials.skin, [-0.025,-0.20,0.01], [0.19,0.245,0.18],)}
          <mesh geometry={capsule} material={materials.skin} position={[-0.035,-0.29,0]} rotation={[0,0,0.08]} castShadow receiveShadow />
          {ellipsoid(sphere, materials.skinLight, [-0.06,-0.52,0], [0.15,0.16,0.15])}
          {ellipsoid(sphere, materials.blood, [-0.12,0.06,-0.17], [0.11,0.045,0.025])}
          {ellipsoid(sphere, materials.blood, [-0.08,-0.12,-0.166], [0.045,0.07,0.018])}
          {ellipsoid(sphere, materials.sweat, [-0.12,-0.31,-0.145], [0.014,0.04,0.012])}
          {ellipsoid(sphere, materials.sweat, [0.02,-0.43,-0.12], [0.012,0.03,0.01])}
          <group ref={leftForearm} position={[-0.06,-0.52,0]}>
            <mesh geometry={capsule} material={materials.skin} position={[-0.02,-0.24,-0.015]} rotation={[0,0,0.04]} castShadow receiveShadow />
            {ellipsoid(sphere, materials.skinLight, [-0.03,-0.47,-0.025], [0.15,0.14,0.15])}
          </group>
        </group>
        <group ref={rightArm} position={[0.47,0.61,0]}>
          {ellipsoid(sphere, materials.skinLight, [0,0,0], [0.245,0.25,0.235])}
          {ellipsoid(sphere, materials.skin, [0.025,-0.20,0.01], [0.19,0.245,0.18])}
          <mesh geometry={capsule} material={materials.skin} position={[0.035,-0.29,0]} rotation={[0,0,-0.08]} castShadow receiveShadow />
          {ellipsoid(sphere, materials.skinLight, [0.06,-0.52,0], [0.16,0.17,0.16])}
          {ellipsoid(sphere, materials.skin, [0.04,-0.57,0.09], [0.095,0.12,0.075])}
          {ellipsoid(sphere, materials.blood, [0.11,0.08,-0.17], [0.08,0.035,0.02])}
          {ellipsoid(sphere, materials.blood, [0.15,-0.01,-0.168], [0.035,0.06,0.016])}
          {ellipsoid(sphere, materials.sweat, [0.12,-0.28,-0.14], [0.013,0.034,0.011])}
          {ellipsoid(sphere, materials.sweat, [-0.025,-0.42,-0.12], [0.012,0.03,0.01])}
          <group ref={rightForearm} position={[0.06,-0.52,0]}>
            <mesh geometry={capsule} material={materials.skin} position={[0.02,-0.24,-0.015]} rotation={[0,0,-0.04]} castShadow receiveShadow />
            {ellipsoid(sphere, materials.skinLight, [0.03,-0.47,-0.025], [0.16,0.15,0.15])}
            {[-0.09,-0.035,0.02,0.075].map((x,i)=><group key={i}>
              <mesh geometry={capsule} material={materials.skinLight} position={[x,-0.56,-0.105]} rotation={[0,0,Math.PI/2]} scale={[0.34,0.34,0.34]} castShadow/>
            </group>)}
            <group position={[0.03,-0.47,-0.025]}>
              {equippedWeapon && <HeldWeaponMesh id={equippedWeapon} muzzleRef={muzzleRef} />}
            </group>
          </group>
        </group>
        <group ref={head} position={[0,1.04,0.015]}>
          {ellipsoid(sphere, materials.skin, [0,0.02,0], [0.32,0.38,0.27])}
          {/* Oversized, sculptural skull mask */}
          {ellipsoid(sphere, materials.mask, [0,0.015,-0.105], [0.335,0.34,0.235])}
          {ellipsoid(sphere, materials.mask, [0,-0.19,-0.12], [0.255,0.16,0.20])}
          {ellipsoid(sphere, materials.maskShade, [-0.125,0.075,-0.304], [0.105,0.065,0.035])}
          {ellipsoid(sphere, materials.maskShade, [0.125,0.075,-0.304], [0.105,0.065,0.035])}
          {ellipsoid(sphere, materials.maskShade, [0, -0.055,-0.325], [0.065,0.09,0.045])}
          {ellipsoid(sphere, materials.maskShade, [0,-0.205,-0.29], [0.17,0.055,0.04])}
          {[-2,-1,0,1,2].map(i => <mesh key={i} geometry={sphere} material={materials.mask} position={[i*0.055,-0.205,-0.328]} scale={[0.018,0.035,0.012]} castShadow receiveShadow />)}
          {ellipsoid(sphere, materials.maskShade, [0,0.29,-0.04], [0.31,0.055,0.21])}
        </group>
      </group>
      {/* Belt and buckle */}
      <mesh position={[0,0.98,-0.246]} castShadow>
        <boxGeometry args={[0.12,0.085,0.035]} />
        <meshStandardMaterial color="#b6a16e" metalness={0.72} roughness={0.3} />
      </mesh>
    </group>
  );
}
