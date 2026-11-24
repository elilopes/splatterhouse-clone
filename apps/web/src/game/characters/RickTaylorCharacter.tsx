import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

export type RickMotion = {
  moving: boolean;
  attackTime: number;
  grabTime: number;
  jumpHeight: number;
};

type Props = { motion: RickMotion };

function ellipsoid(geometry: THREE.SphereGeometry, material: THREE.Material, position: [number,number,number], scale: [number,number,number]) {
  return <mesh geometry={geometry} material={material} position={position} scale={scale} castShadow receiveShadow />;
}

/** Rick's procedural replacement model. Smooth overlapping anatomy, no per-part comic outlines. */
export default function RickTaylorCharacter({ motion }: Props) {
  const root = useRef<THREE.Group>(null);
  const torso = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const leftArm = useRef<THREE.Group>(null);
  const rightArm = useRef<THREE.Group>(null);
  const leftLeg = useRef<THREE.Group>(null);
  const rightLeg = useRef<THREE.Group>(null);
  const materials = useMemo(() => {
    const skin = new THREE.MeshStandardMaterial({ color: "#b77b63", roughness: 0.72 });
    const skinLight = new THREE.MeshStandardMaterial({ color: "#d49a7c", roughness: 0.68 });
    const denim = new THREE.MeshStandardMaterial({ color: "#244d91", roughness: 0.9 });
    const denimLight = new THREE.MeshStandardMaterial({ color: "#416bb0", roughness: 0.92 });
    const mask = new THREE.MeshStandardMaterial({ color: "#d9d5c9", roughness: 0.58 });
    const maskShade = new THREE.MeshStandardMaterial({ color: "#262326", roughness: 0.8 });
    const blood = new THREE.MeshStandardMaterial({ color: "#4c1119", roughness: 0.42 });
    const boot = new THREE.MeshStandardMaterial({ color: "#171518", roughness: 0.82 });
    const metal = new THREE.MeshStandardMaterial({ color: "#a6a19a", metalness: 0.72, roughness: 0.28 });
    return { skin, skinLight, denim, denimLight, mask, maskShade, blood, boot, metal };
  }, []);
  const sphere = useMemo(() => new THREE.SphereGeometry(1, 32, 24), []);
  const capsule = useMemo(() => new THREE.CapsuleGeometry(0.12, 0.42, 8, 20), []);
  useFrame((_, dt) => {
    if (!root.current) return;
    const t = performance.now() * 0.001;
    const gait = motion.moving ? Math.sin(t * 10) : 0;
    if (torso.current) {
      torso.current.position.y = 1.05 + (motion.moving ? Math.abs(gait) * 0.035 : Math.sin(t * 2.2) * 0.012);
      torso.current.rotation.z = THREE.MathUtils.damp(torso.current.rotation.z, motion.moving ? gait * 0.025 : 0, 8, dt);
    }
    if (leftLeg.current) leftLeg.current.rotation.x = THREE.MathUtils.damp(leftLeg.current.rotation.x, gait * 0.55, 10, dt);
    if (rightLeg.current) rightLeg.current.rotation.x = THREE.MathUtils.damp(rightLeg.current.rotation.x, -gait * 0.55, 10, dt);
    const punch = motion.attackTime > 0 ? Math.sin((1 - motion.attackTime / 0.34) * Math.PI) : 0;
    const grab = motion.grabTime > 0 ? Math.sin((1 - motion.grabTime / 0.46) * Math.PI) : 0;
    if (leftArm.current) {
      leftArm.current.rotation.x = THREE.MathUtils.damp(leftArm.current.rotation.x, -gait * 0.32 - grab * 1.05, 12, dt);
      leftArm.current.rotation.z = THREE.MathUtils.damp(leftArm.current.rotation.z, 0.08 + grab * 0.16, 12, dt);
    }
    if (rightArm.current) {
      rightArm.current.rotation.x = THREE.MathUtils.damp(rightArm.current.rotation.x, gait * 0.32 - punch * 1.65 - grab * 1.05, 14, dt);
      rightArm.current.rotation.z = THREE.MathUtils.damp(rightArm.current.rotation.z, -0.08 - grab * 0.16, 12, dt);
    }
    if (head.current) head.current.rotation.x = THREE.MathUtils.damp(head.current.rotation.x, grab * 0.08, 8, dt);
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
      </group>
      <group ref={rightLeg} position={[0.18,0.91,0]}>
        {ellipsoid(sphere, materials.denim, [0,-0.24,0], [0.19,0.39,0.22])}
        {ellipsoid(sphere, materials.denimLight, [0,-0.43,-0.005], [0.16,0.12,0.19])}
        <mesh geometry={capsule} material={materials.denim} position={[0,-0.69,0]} rotation={[0,0,Math.PI]} castShadow />
        {ellipsoid(sphere, materials.boot, [0,-0.99,-0.09], [0.18,0.13,0.29])}
      </group>
      {/* Broad, tapered torso; large overlapping volumes blend visually with smooth shading */}
      <group ref={torso} position={[0,1.05,0]}>
        {ellipsoid(sphere, materials.skin, [0,0.34,0], [0.43,0.58,0.27])}
        {ellipsoid(sphere, materials.skinLight, [0,0.57,0.025], [0.55,0.34,0.30])}
        {ellipsoid(sphere, materials.skin, [0,0.12,0.015], [0.34,0.32,0.235])}
        {ellipsoid(sphere, materials.skinLight, [-0.17,0.56,0.19], [0.27,0.19,0.13])}
        {ellipsoid(sphere, materials.skinLight, [0.17,0.56,0.19], [0.27,0.19,0.13])}
        {ellipsoid(sphere, materials.skin, [0,0.79,0], [0.22,0.22,0.2])}
        {/* Subtle abdominal anatomy integrated into the torso surface */}
        {[-0.12,0.02,0.16].map((y,i) => <group key={i}>
          {ellipsoid(sphere, materials.skinLight, [-0.085,y,0.205], [0.075,0.065,0.035])}
          {ellipsoid(sphere, materials.skinLight, [0.085,y,0.205], [0.075,0.065,0.035])}
        </group>)}
        <group ref={leftArm} position={[-0.47,0.61,0]}>
          {ellipsoid(sphere, materials.skinLight, [0,0,0], [0.22,0.24,0.22])}
          <mesh geometry={capsule} material={materials.skin} position={[-0.035,-0.29,0]} rotation={[0,0,0.08]} castShadow receiveShadow />
          {ellipsoid(sphere, materials.skinLight, [-0.06,-0.52,0], [0.15,0.16,0.15])}
          <mesh geometry={capsule} material={materials.skin} position={[-0.08,-0.76,-0.015]} rotation={[0,0,0.04]} castShadow receiveShadow />
          {ellipsoid(sphere, materials.skinLight, [-0.09,-0.99,-0.025], [0.15,0.14,0.15])}
          {ellipsoid(sphere, materials.blood, [-0.12,0.06,-0.17], [0.11,0.045,0.025])}
        </group>
        <group ref={rightArm} position={[0.47,0.61,0]}>
          {ellipsoid(sphere, materials.skinLight, [0,0,0], [0.22,0.24,0.22])}
          <mesh geometry={capsule} material={materials.skin} position={[0.035,-0.29,0]} rotation={[0,0,-0.08]} castShadow receiveShadow />
          {ellipsoid(sphere, materials.skinLight, [0.06,-0.52,0], [0.15,0.16,0.15])}
          <mesh geometry={capsule} material={materials.skin} position={[0.08,-0.76,-0.015]} rotation={[0,0,-0.04]} castShadow receiveShadow />
          {ellipsoid(sphere, materials.skinLight, [0.09,-0.99,-0.025], [0.15,0.14,0.15])}
          {ellipsoid(sphere, materials.blood, [0.11,0.08,-0.17], [0.08,0.035,0.02])}
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
          {[-2,-1,0,1,2].map(i => ellipsoid(sphere, materials.mask, [i*0.055,-0.205,-0.328], [0.018,0.035,0.012]))}
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
