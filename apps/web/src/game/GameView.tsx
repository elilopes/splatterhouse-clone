import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import RickTaylorCharacter, { type RickMotion } from "./characters/RickTaylorCharacter";
import { RickTaylorCharacter3DHDPlayer } from "./characters/RickTaylorCharacter3DHD";
import { WebGPURenderer } from "three/webgpu";
import MonsterProceduralCharacter from "./characters/MonsterProceduralCharacter";

export type GraphicsQuality = "auto" | "standard" | "high";

type Props = { onScore:(points:number)=>void; onKill:()=>void; paused:boolean; onStageChange:(stage:1|2)=>void; graphicsQuality:GraphicsQuality };
type WeaponId = "pipe" | "machete" | "shotgun";
type EnemyKind = "crawler" | "brute" | "spitter";
type BodyState = "alive" | "wallFlying" | "wallStuck" | "falling" | "fallen" | "macheteFalling" | "macheteMelting" | "grabLift" | "grabThrown" | "grabFallen" | "grabMelting" | "pipeSlam" | "gone";
type EnemyState = {
  id:number; x:number; y:number; z:number; health:number; alive:boolean; kind:EnemyKind;
  knocked:number; vx:number; vy:number; vz:number; fall:number; animation:number;
  activated:boolean; bodyState:BodyState; stickRot:number; targetZ:number; headless:boolean; severedArm:boolean; grabTimer:number; spitCooldown:number;
};
type SpitProjectile = {id:number;x:number;y:number;z:number;vx:number;vy:number;vz:number;age:number};
type SpitSplash = {id:number;x:number;z:number;age:number};
type SeveredHead = {
  id:number; kind:EnemyKind; x:number; y:number; z:number;
  vx:number; vy:number; vz:number; rotZ:number; stuck:boolean; targetZ:number;
};
type BloodPool = { id:number; x:number; z:number; radius:number };
type PickupState = { id:WeaponId; x:number; z:number; collected:boolean };
type CombatEffect = {
  id:number; kind:"gore"|"skull"|"arm"; x:number; y:number; z:number;
  vx:number; vy:number; vz:number; size:number; age:number;
};

const makeEnemy = (id:number, x:number, z:number, kind:EnemyKind, animation:number, activated=false): EnemyState => ({
  id, x, y:0, z, health:kind==="brute"?3:2, alive:true, kind, knocked:0,
  vx:0, vy:0, vz:0, fall:0, animation, activated, bodyState:"alive", stickRot:0, targetZ:-1.72, headless:false, severedArm:false, grabTimer:0, spitCooldown:1.1+Math.random()*1.4
});

const initialEnemies: EnemyState[] = [
  // Muro gosmento (-26 .. -1.5)
  makeEnemy(1, -19.5, -0.65, "crawler", 0, true),
  makeEnemy(2, -16.0, 0.7, "crawler", 1, true),
  makeEnemy(3, -11.0, -0.7, "spitter", 2),
  makeEnemy(4, -6.5, 0.75, "crawler", 3),
  makeEnemy(5, -2.5, -0.6, "brute", 4),
  // Floresta (-1.5 .. 52.5)
  makeEnemy(6, 3.5, 0.65, "crawler", 5),
  makeEnemy(7, 9.5, -0.75, "spitter", 6),
  makeEnemy(8, 15.5, 0.65, "brute", 7),
  makeEnemy(9, 22.0, -0.6, "crawler", 8),
  makeEnemy(10, 28.5, 0.7, "spitter", 9),
  makeEnemy(11, 35.0, -0.5, "brute", 10),
  makeEnemy(12, 41.5, 0.65, "crawler", 11),
  makeEnemy(13, 47.5, -0.6, "spitter", 12),
  // Entrada da mansão (52.5 .. 63)
  makeEnemy(14, 56.0, 0.55, "brute", 13),
];

const initialPickups: PickupState[] = [
  {id:"pipe",x:-15.5,z:0.15,collected:false},
  {id:"machete",x:12.0,z:0.1,collected:false},
  {id:"shotgun",x:37.5,z:0.1,collected:false},
];

type WorldControls = {
  horizontal:number; depth:number; attack:boolean; grab:boolean; jump:boolean; pickup:boolean;
};
type WorldProps = Omit<Props, "graphicsQuality"> & { controls:React.MutableRefObject<WorldControls>; useHDCharacter:boolean; zoomTargetRef:React.MutableRefObject<number> };
type PipeAttackStyle = "bat" | "overhead";
type PipeCombo = { steps:PipeAttackStyle[]; elapsed:number; stepIndex:number; hit:boolean };
const PIPE_STRIKE_DURATION = 0.72;

function FleshyWall() {
  const lobes = useMemo(()=>Array.from({length:114},(_,i)=>({
    x:-26.2+(i%38)*0.67,
    y:0.45+Math.floor(i/38)*1.55+(Math.sin(i*1.7)*0.16),
    sx:0.38+(i%4)*0.07,
    sy:0.52+(i%3)*0.09,
    sz:0.18+(i%3)*0.035
  })),[]);
  return <group>
    <mesh position={[-14.0,2.6,-2.25]} castShadow receiveShadow><boxGeometry args={[25.6,5.2,0.65]}/><meshStandardMaterial color="#18210d" roughness={0.92}/></mesh>
    {lobes.map((p,i)=><mesh key={i} position={[p.x,p.y,-1.84]} scale={[p.sx,p.sy,p.sz]} castShadow receiveShadow>
      <sphereGeometry args={[1,20,16]}/><meshStandardMaterial color={i%5===0?"#647333":i%3===0?"#3e4d20":"#283819"} roughness={0.28} metalness={0.02}/>
    </mesh>)}
    {Array.from({length:24},(_,i)=><group key={i} position={[-25.9+i*1.04,0,-1.45]}>
      <mesh position={[0,2.2,0]} rotation={[0,0,Math.sin(i*2)*0.12]}><cylinderGeometry args={[0.038,0.06,4.1,10]}/><meshStandardMaterial color="#17240f" roughness={0.65}/></mesh>
      <mesh position={[0.18,0.3,-0.08]} scale={[0.16,0.6,0.15]}><capsuleGeometry args={[0.12,0.65,6,12]}/><meshStandardMaterial color="#71803b" roughness={0.24}/></mesh>
    </group>)}
    {Array.from({length:30},(_,i)=><mesh key={i} position={[-26.2+i*0.84,4.2-(i%4)*0.14,-1.52]} rotation={[0,0,Math.PI]}><capsuleGeometry args={[0.085,0.42+(i%4)*0.1,5,10]}/><meshStandardMaterial color="#637638" roughness={0.22}/></mesh>)}
    {Array.from({length:20},(_,i)=><mesh key={i} position={[-26.0+i*1.25,0.12,-1.42]} scale={[0.78,0.12,0.44]}><sphereGeometry args={[0.5,16,10]}/><meshStandardMaterial color="#65783a" roughness={0.2}/></mesh>)}
  </group>;
}

function ForestZone() {
  const foregroundTrees = useMemo(()=>Array.from({length:36},(_,i)=>({
    x: -1.3 + i * 1.5 + (i % 2 === 0 ? 0.14 : -0.18),
    z: -2.35 - (i % 3) * 0.72,
    h: 6.0 + (i % 4) * 0.9,
    rBottom: 0.36 + (i % 3) * 0.06,
    rTop: 0.22 + (i % 2) * 0.04,
    lean: Math.sin(i * 1.9) * 0.06,
    canopyScale: 1.5 + (i % 3) * 0.28,
  })),[]);

  const deepTrees = useMemo(()=>Array.from({length:46},(_,i)=>({
    x: -2.0 + i * 1.22,
    z: -4.8 - (i % 3) * 1.1,
    h: 7.6 + (i % 4) * 0.95,
    rBottom: 0.44 + (i % 2) * 0.08,
    canopyScale: 1.9 + (i % 3) * 0.34,
  })),[]);

  const undergrowth = useMemo(()=>Array.from({length:38},(_,i)=>({
    x: -1.5 + i * 1.44,
    z: -1.85 - (i % 2) * 0.48,
    scale: 0.55 + (i % 3) * 0.22,
  })),[]);

  return <group>
    {foregroundTrees.map((t,i)=><group key={`fg-${i}`} position={[t.x,0,t.z]} rotation={[0,0,t.lean]}>
      <mesh position={[0,t.h*0.5,0]} castShadow><cylinderGeometry args={[t.rTop,t.rBottom,t.h,9]}/><meshStandardMaterial color="#2a1912" roughness={0.98}/></mesh>
      <mesh position={[0,0.28,0]} scale={[1.4,0.45,1.2]}><cylinderGeometry args={[t.rBottom,t.rBottom*1.55,0.75,7]}/><meshStandardMaterial color="#21140e" roughness={1}/></mesh>
      {[-1,0,1].map(b=><mesh key={b} position={[b*0.72,t.h*0.72+(b===0?0.45:0),0]} rotation={[0,0,b*-0.58]}><cylinderGeometry args={[0.08,0.14,2.35,7]}/><meshStandardMaterial color="#241610" roughness={0.95}/></mesh>)}
      <mesh position={[0,t.h*0.95,0]} scale={[t.canopyScale,t.canopyScale*0.72,t.canopyScale*0.85]}><icosahedronGeometry args={[1,1]}/><meshStandardMaterial color="#182218" flatShading roughness={0.95}/></mesh>
      <mesh position={[0.65,t.h*0.85,0.2]} scale={[t.canopyScale*0.72,t.canopyScale*0.55,t.canopyScale*0.68]}><icosahedronGeometry args={[1,1]}/><meshStandardMaterial color="#131c14" flatShading roughness={0.95}/></mesh>
      <mesh position={[-0.6,t.h*0.87,-0.15]} scale={[t.canopyScale*0.68,t.canopyScale*0.52,t.canopyScale*0.65]}><icosahedronGeometry args={[1,1]}/><meshStandardMaterial color="#1b261b" flatShading roughness={0.95}/></mesh>
    </group>)}

    {deepTrees.map((t,i)=><group key={`bg-${i}`} position={[t.x,0,t.z]}>
      <mesh position={[0,t.h*0.5,0]}><cylinderGeometry args={[t.rBottom*0.65,t.rBottom,t.h,8]}/><meshStandardMaterial color="#19110d" roughness={1}/></mesh>
      <mesh position={[0,t.h*0.92,0]} scale={[t.canopyScale,t.canopyScale*0.78,t.canopyScale*0.8]}><icosahedronGeometry args={[1,1]}/><meshStandardMaterial color="#101712" flatShading roughness={1}/></mesh>
    </group>)}

    {undergrowth.map((b,i)=><mesh key={`bush-${i}`} position={[b.x,0.38,b.z]} scale={[b.scale*1.3,b.scale*0.75,b.scale*0.85]}>
      <icosahedronGeometry args={[0.7,1]}/><meshStandardMaterial color={i%2===0?"#162015":"#1d2618"} flatShading roughness={0.95}/>
    </mesh>)}
  </group>;
}

function MansionFacade() {
  const mansionX = 63;
  return <group position={[mansionX,0,0]}>
    <mesh position={[0,4.7,-3.1]} castShadow receiveShadow><boxGeometry args={[17.5,9.4,1.6]}/><meshStandardMaterial color="#3c3432" roughness={0.9}/></mesh>
    {[-8.4,8.4].map(wx=><group key={wx} position={[wx,0,-2.85]}>
      <mesh position={[0,5.2,0]} castShadow><boxGeometry args={[4.4,10.4,2.1]}/><meshStandardMaterial color="#322b29" roughness={0.92}/></mesh>
      <mesh position={[0,10.8,0]} rotation={[0,Math.PI/4,0]}><coneGeometry args={[3.5,2.4,4]}/><meshStandardMaterial color="#181316" roughness={0.85}/></mesh>
      {[2.7,6.6].map(wy=><group key={wy} position={[0,wy,1.08]}>
        <mesh><boxGeometry args={[1.65,2.45,0.16]}/><meshStandardMaterial color="#130f12"/></mesh>
        <mesh position={[0,0,0.07]}><boxGeometry args={[1.28,2.08,0.05]}/><meshStandardMaterial color="#7e2c1c" emissive="#49130a"/></mesh>
        <mesh position={[0,0,0.1]}><boxGeometry args={[0.1,2.08,0.04]}/><meshStandardMaterial color="#130f12"/></mesh>
        <mesh position={[0,0.1,0.1]}><boxGeometry args={[1.28,0.1,0.04]}/><meshStandardMaterial color="#130f12"/></mesh>
      </group>)}
    </group>)}

    <mesh position={[0,9.65,-2.95]}><boxGeometry args={[18.8,0.6,2.2]}/><meshStandardMaterial color="#1a1518"/></mesh>
    <mesh position={[0,10.9,-3.2]}><boxGeometry args={[16.2,2.0,1.9]}/><meshStandardMaterial color="#141114" roughness={0.88}/></mesh>
    {[-4.2,4.2].map(cx=><mesh key={cx} position={[cx,12.2,-3.3]}><boxGeometry args={[0.85,1.8,0.85]}/><meshStandardMaterial color="#2a2220"/></mesh>)}

    {[-4.3,-2.3,2.3,4.3].map(wx=><group key={`up-${wx}`}>
      <group position={[wx,6.8,-2.28]}>
        <mesh><boxGeometry args={[1.55,2.45,0.15]}/><meshStandardMaterial color="#130f12"/></mesh>
        <mesh position={[0,0,0.07]}><boxGeometry args={[1.2,2.08,0.05]}/><meshStandardMaterial color="#7d2b1b" emissive="#481209"/></mesh>
        <mesh position={[0,0,0.1]}><boxGeometry args={[0.09,2.08,0.04]}/><meshStandardMaterial color="#130f12"/></mesh>
        <mesh position={[0,0.1,0.1]}><boxGeometry args={[1.2,0.09,0.04]}/><meshStandardMaterial color="#130f12"/></mesh>
      </group>
      <group position={[wx,2.85,-2.28]}>
        <mesh><boxGeometry args={[1.55,2.55,0.15]}/><meshStandardMaterial color="#130f12"/></mesh>
        <mesh position={[0,0,0.07]}><boxGeometry args={[1.2,2.15,0.05]}/><meshStandardMaterial color="#87301e" emissive="#52160b"/></mesh>
        <mesh position={[0,0,0.1]}><boxGeometry args={[0.09,2.15,0.04]}/><meshStandardMaterial color="#130f12"/></mesh>
        <mesh position={[0,0.1,0.1]}><boxGeometry args={[1.2,0.09,0.04]}/><meshStandardMaterial color="#130f12"/></mesh>
      </group>
    </group>)}

    <group position={[0,7.1,-2.15]}>
      <mesh><boxGeometry args={[2.1,2.3,0.18]}/><meshStandardMaterial color="#151013"/></mesh>
      <mesh position={[0,0,0.08]}><boxGeometry args={[1.65,1.85,0.05]}/><meshStandardMaterial color="#91321c" emissive="#581509"/></mesh>
    </group>

    <mesh position={[0,0.18,-1.85]} receiveShadow><boxGeometry args={[5.8,0.36,1.65]}/><meshStandardMaterial color="#2b2524" roughness={0.95}/></mesh>
    <mesh position={[0,0.42,-2.05]} receiveShadow><boxGeometry args={[5.1,0.28,1.3]}/><meshStandardMaterial color="#342d2b" roughness={0.95}/></mesh>
    {[-2.15,-1.1,1.1,2.15].map(px=><mesh key={px} position={[px,2.95,-1.55]} castShadow><cylinderGeometry args={[0.2,0.24,4.9,12]}/><meshStandardMaterial color="#4a403d" roughness={0.85}/></mesh>)}
    <mesh position={[0,5.55,-1.85]}><boxGeometry args={[5.4,0.45,1.45]}/><meshStandardMaterial color="#221c1d"/></mesh>
    <mesh position={[0,6.3,-1.85]} rotation={[0,Math.PI/4,0]}><coneGeometry args={[3.8,1.3,4]}/><meshStandardMaterial color="#1b1619"/></mesh>

    <mesh position={[0,2.4,-2.22]}><boxGeometry args={[3.0,4.2,0.24]}/><meshStandardMaterial color="#120b0b"/></mesh>
    <mesh position={[-0.66,2.3,-2.12]}><boxGeometry args={[1.18,3.7,0.12]}/><meshStandardMaterial color="#2b1111" roughness={0.75}/></mesh>
    <mesh position={[0.66,2.3,-2.12]}><boxGeometry args={[1.18,3.7,0.12]}/><meshStandardMaterial color="#2b1111" roughness={0.75}/></mesh>
    {[-0.18,0.18].map(kx=><mesh key={kx} position={[kx,2.2,-2.03]}><sphereGeometry args={[0.08,10,8]}/><meshStandardMaterial color="#c49d56" metalness={0.75} roughness={0.3}/></mesh>)}
    {[-1.5,1.5].map(lx=><mesh key={lx} position={[lx,3.4,-2.05]}><sphereGeometry args={[0.17,12,10]}/><meshStandardMaterial color="#d96738" emissive="#8f2911"/></mesh>)}

    {[-9.8,-7.2,7.2,9.8].map(fx=><mesh key={fx} position={[fx,1.25,-1.45]}><boxGeometry args={[0.55,2.5,0.55]}/><meshStandardMaterial color="#252020" roughness={0.95}/></mesh>)}
  </group>;
}

function Exterior() {
  return <group>
    <mesh rotation={[-Math.PI/2,0,0]} position={[23,0,0]} receiveShadow><planeGeometry args={[118,16]}/><meshStandardMaterial color="#211d19" roughness={1}/></mesh>
    <FleshyWall/>
    <ForestZone/>
    <MansionFacade/>
    <mesh position={[-18,8.2,-8]}><sphereGeometry args={[1.35,24,18]}/><meshBasicMaterial color="#b4ae95"/></mesh>
  </group>;
}

function MansionRoom({player}:{player:React.RefObject<THREE.Group|null>}) {
  const wood="#302019", darkWood="#17100e", stone="#51433a", brass="#80613b";
  const frontWallGroup=useRef<THREE.Group>(null);
  const wallOpacity=useRef(1);
  useFrame(()=>{
    const playerZ=player.current?.position.z??0;
    const fade=THREE.MathUtils.smoothstep(playerZ,25.2,28.4);
    const nextOpacity=THREE.MathUtils.lerp(1,0.16,fade);
    if(Math.abs(nextOpacity-wallOpacity.current)<0.008)return;
    wallOpacity.current=nextOpacity;
    frontWallGroup.current?.traverse(child=>{
      if(!(child as THREE.Mesh).isMesh)return;
      const mesh=child as THREE.Mesh;
      const materials=Array.isArray(mesh.material)?mesh.material:[mesh.material];
      materials.forEach(material=>{
        material.transparent=nextOpacity<0.999;
        material.opacity=nextOpacity;
        material.depthWrite=nextOpacity>0.55;
        material.needsUpdate=true;
      });
    });
  });
  return <group>
    {/* Broad stone-and-wood floor: the playable room extends well beyond the camera view. */}
    <mesh rotation={[-Math.PI/2,0,0]} position={[0,-0.08,8.5]} receiveShadow>
      <planeGeometry args={[34,53]}/><meshStandardMaterial color="#302720" roughness={0.94}/>
    </mesh>
    {Array.from({length:13},(_,i)=><mesh key={"floor-seam-"+i} rotation={[-Math.PI/2,0,0]} position={[-15.5+i*2.58,0,8.5]}>
      <planeGeometry args={[0.035,52]}/><meshStandardMaterial color="#17120f" roughness={1}/>
    </mesh>)}
    {/* Four enclosing walls and a high, dark ceiling rim; the lower hall is deeper. */}
    <mesh position={[0,7.2,-18]}><boxGeometry args={[34,14.4,0.65]}/><meshStandardMaterial color="#241b19" roughness={0.96}/></mesh>
    <group ref={frontWallGroup}>
      <mesh position={[0,7.2,35]}><boxGeometry args={[34,14.4,0.65]}/><meshStandardMaterial color="#211917" roughness={0.96}/></mesh>
      {[-13,-8,-3,3,8,13].map(x=><mesh key={"front-pilaster-"+x} position={[x,6.8,34.55]}><boxGeometry args={[0.42,13.5,0.35]}/><meshStandardMaterial color="#4a3429" roughness={0.88}/></mesh>)}
    </group>
    <mesh position={[-17,7.2,8.5]}><boxGeometry args={[0.65,14.4,53]}/><meshStandardMaterial color="#2b201d" roughness={0.96}/></mesh>
    <mesh position={[17,7.2,8.5]}><boxGeometry args={[0.65,14.4,53]}/><meshStandardMaterial color="#2b201d" roughness={0.96}/></mesh>
    <mesh position={[0,14.2,8.5]}><boxGeometry args={[34,0.5,53]}/><meshStandardMaterial color="#120e0e" roughness={1}/></mesh>

    {/* Jagged stone-floor fractures with branching hairline cracks. */}
    <group position={[-13.2,-0.052,-11.2]} rotation={[0,0.22,0]}>
      <mesh><boxGeometry args={[2.05,0.018,0.035]}/><meshStandardMaterial color="#110d0b" roughness={1}/></mesh>
      <mesh position={[-0.62,0,0.12]} rotation={[0,-0.38,0]}><boxGeometry args={[0.92,0.019,0.028]}/><meshStandardMaterial color="#17110e" roughness={1}/></mesh>
      <mesh position={[0.22,0,-0.12]} rotation={[0,0.55,0]}><boxGeometry args={[0.82,0.019,0.026]}/><meshStandardMaterial color="#17110e" roughness={1}/></mesh>
      <mesh position={[0.82,0,0.18]} rotation={[0,-0.72,0]}><boxGeometry args={[0.66,0.019,0.025]}/><meshStandardMaterial color="#17110e" roughness={1}/></mesh>
    </group>
    <group position={[12.5,-0.051,-11.5]} rotation={[0,-0.5,0]}>
      <mesh><boxGeometry args={[2.25,0.018,0.034]}/><meshStandardMaterial color="#120d0b" roughness={1}/></mesh>
      <mesh position={[-0.55,0,0.13]} rotation={[0,0.62,0]}><boxGeometry args={[0.88,0.019,0.026]}/><meshStandardMaterial color="#19120f" roughness={1}/></mesh>
      <mesh position={[0.48,0,-0.13]} rotation={[0,-0.42,0]}><boxGeometry args={[1.02,0.019,0.028]}/><meshStandardMaterial color="#19120f" roughness={1}/></mesh>
      <mesh position={[0.98,0,0.16]} rotation={[0,0.8,0]}><boxGeometry args={[0.62,0.019,0.024]}/><meshStandardMaterial color="#19120f" roughness={1}/></mesh>
    </group>
    <group position={[-13.1,-0.052,7.2]} rotation={[0,-0.28,0]}>
      <mesh><boxGeometry args={[2.55,0.018,0.036]}/><meshStandardMaterial color="#100c0a" roughness={1}/></mesh>
      <mesh position={[-0.72,0,-0.14]} rotation={[0,0.5,0]}><boxGeometry args={[0.92,0.019,0.028]}/><meshStandardMaterial color="#19120f" roughness={1}/></mesh>
      <mesh position={[0.28,0,0.14]} rotation={[0,-0.7,0]}><boxGeometry args={[0.98,0.019,0.026]}/><meshStandardMaterial color="#19120f" roughness={1}/></mesh>
      <mesh position={[1.05,0,-0.1]} rotation={[0,0.36,0]}><boxGeometry args={[0.68,0.019,0.025]}/><meshStandardMaterial color="#19120f" roughness={1}/></mesh>
    </group>
    <group position={[12.2,-0.052,13.8]} rotation={[0,0.32,0]}>
      <mesh><boxGeometry args={[2.6,0.018,0.035]}/><meshStandardMaterial color="#100c0a" roughness={1}/></mesh>
      <mesh position={[-0.66,0,0.14]} rotation={[0,-0.58,0]}><boxGeometry args={[0.94,0.019,0.027]}/><meshStandardMaterial color="#19120f" roughness={1}/></mesh>
      <mesh position={[0.35,0,-0.13]} rotation={[0,0.68,0]}><boxGeometry args={[1.02,0.019,0.027]}/><meshStandardMaterial color="#19120f" roughness={1}/></mesh>
      <mesh position={[1.08,0,0.12]} rotation={[0,-0.35,0]}><boxGeometry args={[0.72,0.019,0.025]}/><meshStandardMaterial color="#19120f" roughness={1}/></mesh>
    </group>
    <group position={[-4.8,-0.052,18.8]} rotation={[0,-0.18,0]}>
      <mesh><boxGeometry args={[2.05,0.018,0.032]}/><meshStandardMaterial color="#100c0a" roughness={1}/></mesh>
      <mesh position={[-0.52,0,0.13]} rotation={[0,0.62,0]}><boxGeometry args={[0.82,0.019,0.026]}/><meshStandardMaterial color="#19120f" roughness={1}/></mesh>
      <mesh position={[0.58,0,-0.12]} rotation={[0,-0.55,0]}><boxGeometry args={[0.88,0.019,0.026]}/><meshStandardMaterial color="#19120f" roughness={1}/></mesh>
    </group>
    <group position={[4.6,-0.052,21.2]} rotation={[0,0.48,0]}>
      <mesh><boxGeometry args={[1.8,0.018,0.032]}/><meshStandardMaterial color="#100c0a" roughness={1}/></mesh>
      <mesh position={[-0.48,0,0.12]} rotation={[0,-0.6,0]}><boxGeometry args={[0.75,0.019,0.026]}/><meshStandardMaterial color="#19120f" roughness={1}/></mesh>
      <mesh position={[0.52,0,-0.12]} rotation={[0,0.7,0]}><boxGeometry args={[0.7,0.019,0.025]}/><meshStandardMaterial color="#19120f" roughness={1}/></mesh>
    </group>
    {/* Wall paneling, pilasters and dim gothic sconces. */}
    {[-14,-10,-6,6,10,14].map(x=><group key={"back-panel-"+x} position={[x,4.8,-17.55]}>
      <mesh><boxGeometry args={[2.65,8.4,0.18]}/><meshStandardMaterial color="#382823" roughness={0.86}/></mesh>
      <mesh position={[0,0,0.12]}><boxGeometry args={[2.28,7.9,0.06]}/><meshStandardMaterial color="#241917" roughness={0.9}/></mesh>
      <mesh position={[0,2.1,0.2]}><sphereGeometry args={[0.2,14,10]}/><meshStandardMaterial color="#a33c22" emissive="#7d210f" emissiveIntensity={0.65}/></mesh>
    </group>)}
     {[-14,14].map(x=><group key={"side-pilasters-"+x}>
      {[-13,-5,3,11].map(z=><mesh key={z} position={[x,6.6,z]}><boxGeometry args={[0.35,13,0.42]}/><meshStandardMaterial color="#49352b" roughness={0.9}/></mesh>)}
    </group>)}
    {/* Large circular, worn carpet in the center of the hall. */}
    <group position={[0,0.015,1]}>
      <mesh rotation={[-Math.PI/2,0,0]}><circleGeometry args={[4.7,64]}/><meshStandardMaterial color="#4b2020" roughness={1}/></mesh>
      <mesh rotation={[-Math.PI/2,0,0]} position={[0,0.008,0]}><ringGeometry args={[4.1,4.48,64]}/><meshStandardMaterial color="#b18a54" roughness={0.82}/></mesh>
      <mesh rotation={[-Math.PI/2,0,0]} position={[0,0.012,0]}><ringGeometry args={[2.85,2.94,64]}/><meshStandardMaterial color="#9a7446" roughness={0.9}/></mesh>
      <mesh rotation={[-Math.PI/2,0,0]} position={[0,0.016,0]}><circleGeometry args={[1.05,48]}/><meshStandardMaterial color="#2c1114" roughness={1}/></mesh>
    </group>
    {/* Monumental central staircase, upper landing and two branching galleries. */}
    {Array.from({length:13},(_,i)=><mesh key={"stair-"+i} position={[0,0.17+i*0.26,5.1-i*0.59]} castShadow receiveShadow>
      <boxGeometry args={[5.8,0.34,0.78]}/><meshStandardMaterial color={i%2?stone:"#40332b"} roughness={0.92}/>
    </mesh>)}
    {Array.from({length:13},(_,i)=><mesh key={"stair-nosing-"+i} position={[0,0.36+i*0.26,4.72-i*0.59]} castShadow>
      <boxGeometry args={[5.86,0.075,0.12]}/><meshStandardMaterial color={brass} metalness={0.28} roughness={0.62}/>
    </mesh>)}
    {/* Upper-storey deck now runs all the way to the rear wall. */}
    <mesh position={[0,3.29,-9.65]} castShadow receiveShadow>
      <boxGeometry args={[24.4,0.42,16.0]}/><meshStandardMaterial color="#49382e" roughness={0.88}/>
    </mesh>
    {/* Framed painting and antique clock mounted on the rear wall, visible from the upper deck. */}
    <group position={[-4.2,6.9,-17.48]}>
      <mesh castShadow><boxGeometry args={[2.45,1.9,0.18]}/><meshStandardMaterial color="#74502f" metalness={0.18} roughness={0.55}/></mesh>
      <mesh position={[0,0,0.105]}><boxGeometry args={[2.16,1.61,0.035]}/><meshStandardMaterial color="#211512" roughness={0.95}/></mesh>
      <mesh position={[0,0,0.13]}><planeGeometry args={[2.02,1.47]}/><meshStandardMaterial color="#713b35" roughness={0.9}/></mesh>
      <mesh position={[0,-0.18,0.15]}><circleGeometry args={[0.48,32]}/><meshStandardMaterial color="#a98a5b" roughness={0.82}/></mesh>
      <mesh position={[0,-0.18,0.17]}><circleGeometry args={[0.035,12]}/><meshStandardMaterial color="#241711"/></mesh>
      <mesh position={[0.12,-0.02,0.18]} rotation={[0,0,-0.62]}><boxGeometry args={[0.035,0.32,0.025]}/><meshStandardMaterial color="#241711"/></mesh>
      <mesh position={[-0.08,-0.02,0.18]} rotation={[0,0,0.9]}><boxGeometry args={[0.03,0.25,0.025]}/><meshStandardMaterial color="#241711"/></mesh>
    </group>
    <group position={[4.35,7.0,-17.48]}>
      <mesh castShadow><boxGeometry args={[1.42,1.72,0.2]}/><meshStandardMaterial color="#4a2c1d" roughness={0.72}/></mesh>
      <mesh position={[0,0.08,0.12]}><circleGeometry args={[0.58,40]}/><meshStandardMaterial color="#d2bd8b" roughness={0.72}/></mesh>
      <mesh position={[0,0.08,0.145]}><ringGeometry args={[0.52,0.57,40]}/><meshStandardMaterial color="#8a633b" metalness={0.45}/></mesh>
      <mesh position={[0,0.08,0.16]}><circleGeometry args={[0.035,12]}/><meshStandardMaterial color="#211710"/></mesh>
      <mesh position={[0.08,0.25,0.17]} rotation={[0,0,-0.55]}><boxGeometry args={[0.035,0.32,0.025]}/><meshStandardMaterial color="#211710"/></mesh>
      <mesh position={[-0.14,0.02,0.17]} rotation={[0,0,1.1]}><boxGeometry args={[0.035,0.43,0.025]}/><meshStandardMaterial color="#211710"/></mesh>
      <mesh position={[0,-0.78,0.12]}><boxGeometry args={[0.42,0.16,0.14]}/><meshStandardMaterial color="#8a633b" metalness={0.35}/></mesh>
    </group>
    {[-1,1].map(side=><group key={"upper-wing-"+side}>
       
      <mesh position={[side*7.25,4.2,-4.22]}><boxGeometry args={[8.8,0.12,0.12]}/><meshStandardMaterial color={brass} metalness={0.32}/></mesh>
      {[-1,1].map(edge=><mesh key={edge} position={[side*7.25+edge*4.28,3.98,-3.05]}><boxGeometry args={[0.14,0.9,2.55]}/><meshStandardMaterial color={wood}/></mesh>)}
      {Array.from({length:8},(_,i)=><mesh key={"baluster-"+i} position={[side*(3.2+i*1.16),3.98,-4.22]}><boxGeometry args={[0.09,0.72,0.09]}/><meshStandardMaterial color={wood}/></mesh>)}
      <mesh position={[side*7.25,4.36,-4.22]}><boxGeometry args={[8.8,0.14,0.2]}/><meshStandardMaterial color={wood}/></mesh>
    </group>)}
    {[-2.9,2.9].map(x=><group key={"stair-rail-"+x} position={[x,0,0]}>
      <mesh position={[0,1.85,1.1]} rotation={[-0.48,0,0]}><boxGeometry args={[0.16,0.16,7.8]}/><meshStandardMaterial color={wood}/></mesh>
      {Array.from({length:9},(_,i)=><mesh key={i} position={[0,0.35+i*0.36,4.1-i*0.62]}><boxGeometry args={[0.13,0.72,0.13]}/><meshStandardMaterial color={wood}/></mesh>)}
    </group>)}
    {/* Old, sagging sofa abandoned beside the carpet. */}
    <group position={[-10.2,0,1.8]} rotation={[0,0.18,0]}>
      <mesh position={[0,0.62,0]} castShadow><boxGeometry args={[3.8,0.55,1.35]}/><meshStandardMaterial color="#49302b" roughness={1}/></mesh>
      <mesh position={[0,1.25,-0.52]} rotation={[-0.08,0,0]} castShadow><boxGeometry args={[3.7,1.25,0.32]}/><meshStandardMaterial color="#382421" roughness={1}/></mesh>
      {[-1.82,1.82].map(x=><mesh key={x} position={[x,0.95,0]}><boxGeometry args={[0.38,0.95,1.45]}/><meshStandardMaterial color="#33201d" roughness={1}/></mesh>)}
      {[-1.35,0,1.28].map(x=><mesh key={x} position={[x,0.94,0.05]} rotation={[0,0,(x===0?0.12:-0.08)]}><boxGeometry args={[1.12,0.28,1.05]}/><meshStandardMaterial color={x===0?"#5a3932":"#432b27"} roughness={1}/></mesh>)}
      {[-1.45,1.45].map(x=><mesh key={x} position={[x,0.22,0.42]}><boxGeometry args={[0.16,0.42,0.16]}/><meshStandardMaterial color={darkWood}/></mesh>)}
      <mesh position={[0,1.4,-0.33]} rotation={[0,0,-0.16]}><boxGeometry args={[0.85,0.16,0.025]}/><meshStandardMaterial color="#1d1514"/></mesh>
    </group>
    {/* Two overturned chairs; the second has a visibly missing fourth leg. */}
    <group position={[8.4,0.18,4.8]} rotation={[0.18,0.15,1.02]}>
      <mesh position={[0,0,0]}><boxGeometry args={[1.15,0.18,1.05]}/><meshStandardMaterial color="#503526" roughness={0.94}/></mesh>
      <mesh position={[0,0.63,-0.43]}><boxGeometry args={[1.12,1.12,0.16]}/><meshStandardMaterial color="#3b261e" roughness={0.94}/></mesh>
      {[-1,1].map(x=><mesh key={x} position={[x*0.46,-0.58,0.38]} rotation={[0,0,-0.12]}><boxGeometry args={[0.13,1.05,0.13]}/><meshStandardMaterial color="#39251b"/></mesh>)}
      {[-1,1].map(x=><mesh key={"rear-"+x} position={[x*0.46,-0.58,-0.39]}><boxGeometry args={[0.13,1.05,0.13]}/><meshStandardMaterial color="#39251b"/></mesh>)}
    </group>
    <group position={[-7.8,0.16,-7.1]} rotation={[0.12,-0.28,-0.92]}>
      <mesh position={[0,0,0]}><boxGeometry args={[1.12,0.18,1.02]}/><meshStandardMaterial color="#60402c" roughness={0.95}/></mesh>
      <mesh position={[0,0.62,-0.42]}><boxGeometry args={[1.1,1.1,0.16]}/><meshStandardMaterial color="#493021" roughness={0.95}/></mesh>
      {[-1,1].map(x=><mesh key={x} position={[x*0.44,-0.58,0.38]}><boxGeometry args={[0.13,1.0,0.13]}/><meshStandardMaterial color="#493021"/></mesh>)}
      <mesh position={[-0.44,-0.58,-0.38]}><boxGeometry args={[0.13,1.0,0.13]}/><meshStandardMaterial color="#493021"/></mesh>
      {/* Broken stump and splintered edge where the fourth leg should be. */}
      <mesh position={[0.44,-0.28,-0.38]} rotation={[0,0,0.34]}><boxGeometry args={[0.14,0.42,0.14]}/><meshStandardMaterial color="#765037"/></mesh>
    </group>
    {/* Dusty side tables, toppled debris and dim wall lamps add scale to the hall. */}
    {[-13.6,13.6].map(x=><group key={"side-lamp-"+x} position={[x,4.8,-8]}>
      <mesh><boxGeometry args={[0.32,2.4,0.32]}/><meshStandardMaterial color="#211613"/></mesh>
      <mesh position={[0,1.45,0]}><sphereGeometry args={[0.3,14,10]}/><meshStandardMaterial color="#b84a25" emissive="#7b220e" emissiveIntensity={0.9}/></mesh>
    </group>)}
    {[-12,12].map(x=><group key={"debris-"+x} position={[x,0.12,8.5]} rotation={[0.1,0.3,x*0.02]}>
      <mesh><boxGeometry args={[1.2,0.22,0.65]}/><meshStandardMaterial color="#211a17"/></mesh>
      <mesh position={[0,0.22,0.08]} rotation={[0.2,0,0.4]}><boxGeometry args={[0.75,0.18,0.25]}/><meshStandardMaterial color="#554034"/></mesh>
    </group>)}
  </group>;
}

function EnemyHeadMesh({ kind }: {kind:EnemyKind}) {
  const brute=kind==="brute", crawler=kind==="crawler";
  const flesh=brute?"#75513d":kind==="spitter"?"#a05c43":"#873b36";
  return <group>
    <mesh scale={[brute?0.48:0.38,brute?0.48:0.38,0.34]} castShadow><sphereGeometry args={[1,20,16]}/><meshStandardMaterial color={flesh}/></mesh>
    <mesh position={[0,crawler?-0.15:-0.2,0.23]} scale={[0.27,0.12,0.09]}><sphereGeometry args={[1,14,10]}/><meshStandardMaterial color="#310b10"/></mesh>
    {[-1,1].map(side=><mesh key={side} position={[side*0.19,0.08,0.28]}><sphereGeometry args={[0.075,10,8]}/><meshStandardMaterial color="#ff4c28" emissive="#a41b08"/></mesh>)}
  </group>;
}


function WeaponModel({ id }: {id:WeaponId}) {
  return <group rotation={[0,0,-0.35]}>
    {id==="pipe"?<mesh rotation={[0,0,Math.PI/2]}><cylinderGeometry args={[0.055,0.055,1.35,12]}/><meshStandardMaterial color="#858987" metalness={0.78} roughness={0.28}/></mesh>:id==="machete"?<>
      <mesh position={[0.22,0,0]}><boxGeometry args={[0.88,0.075,0.055]}/><meshStandardMaterial color="#c2c4bd" metalness={0.8} roughness={0.2}/></mesh>
      <mesh position={[-0.28,0,0]}><cylinderGeometry args={[0.06,0.06,0.34,10]}/><meshStandardMaterial color="#513020"/></mesh>
    </>:<>
      <mesh rotation={[0,0,Math.PI/2]}><cylinderGeometry args={[0.045,0.045,1.05,12]}/><meshStandardMaterial color="#777c7a" metalness={0.8}/></mesh>
      <mesh position={[-0.55,-0.05,0]}><boxGeometry args={[0.45,0.14,0.14]}/><meshStandardMaterial color="#382219"/></mesh>
    </>}
  </group>;
}

function World({onScore,onKill,paused,onStageChange,controls,useHDCharacter,zoomTargetRef}:WorldProps) {
  const { camera, size } = useThree();
  const player=useRef<THREE.Group>(null);
  const hdZoomCurrent=useRef(1);
  const enemyGroups=useRef<Record<number, THREE.Group|null>>({});
  const headGroups=useRef<Record<number, THREE.Group|null>>({});
  const effectGroups=useRef<Record<number, THREE.Group|null>>({});
  const severedHeads=useRef<SeveredHead[]>([]);
  const bloodPools=useRef<BloodPool[]>([]);
  const effects=useRef<CombatEffect[]>([]);
  const spitProjectiles=useRef<SpitProjectile[]>([]);
  const spitSplashes=useRef<SpitSplash[]>([]);
  const spitGroups=useRef<Record<number,THREE.Group|null>>({});
  const splashGroups=useRef<Record<number,THREE.Group|null>>({});
  const spitHitCooldown=useRef(0);
  const nextEffectId=useRef(1);
  const nextEnemyId=useRef(100);
  const triggeredWaves=useRef(new Set<number>());
  const enemies=useRef<EnemyState[]>(initialEnemies.map(e=>({...e})));
  const pickups=useRef<PickupState[]>(initialPickups.map(p=>({...p})));
  const motion=useRef<RickMotion>({moving:false,attackTime:0,attackStyle:null,attackProgress:0,grabTime:0,jumpHeight:0,weapon:null});
  const pipeCombo=useRef<PipeCombo|null>(null);
  const pendingShotgun=useRef<{timer:number;targetId:number|null}|null>(null);
  const macheteAttackVariant=useRef<"head"|"arm">("head");
  const [phase,setPhase]=useState<1|2>(1);
  const [initialEnemiesVisible,setInitialEnemiesVisible]=useState(false);
  const [equipped,setEquipped]=useState<WeaponId|null>(null);
  const facing=useRef(1);
  const attackDirection=useRef({x:1,z:0});
  const upperDeckAccess=useRef(false);
  const attackCooldown=useRef(0),grabCooldown=useRef(0),jumpVelocity=useRef(0),grounded=useRef(true);
  const [,setEnemyVersion]=useState(0);
  const lastActions=useRef({attack:false,grab:false,jump:false,pickup:false});
  const keys=useRef(new Set<string>());

  useEffect(()=>{
    const spawnTimer=window.setTimeout(()=>setInitialEnemiesVisible(true),2000);
    return ()=>window.clearTimeout(spawnTimer);
  },[]);

  useEffect(()=>{
    camera.position.set(-24,4.6,18);
    camera.lookAt(-24,3.2,0);
    if(player.current){
      player.current.position.set(-24,0,0);
      player.current.rotation.y=-Math.PI/2;
    }
  },[camera]);

  const targetWallZ = (x:number) => {
    if(phase===2)return -2.18; // interior back wall
    if(x < -1.5)return -1.72; // fleshy outer wall
    if(x < 52.5){
      // Match the nearest foreground tree trunk so the monster sticks to wood,
      // rather than stopping in front of an arbitrary invisible plane.
      const treeIndex=THREE.MathUtils.clamp(Math.round((x+1.3)/1.5),0,35);
      const treeX=-1.3+treeIndex*1.5+(treeIndex%2===0?0.14:-0.18);
      const treeZ=-2.35-(treeIndex%3)*0.72;
      const treeRadius=0.36+(treeIndex%3)*0.06;
      return Math.abs(x-treeX)<1.05?treeZ+treeRadius+0.05:-2.28;
    }
    return -2.15; // mansion facade
  };

  const spawnGore=(x:number,y:number,z:number,count:number,spread=4.2,skullCount=0)=>{
    for(let i=0;i<count;i++){
      const angle=(i/count)*Math.PI*2+Math.random()*0.4;
      const spd=1.6+Math.random()*spread;
      effects.current.push({
        id:nextEffectId.current++,kind:"gore",x,y,z,
        vx:Math.cos(angle)*spd,vy:1.6+Math.random()*4.4,vz:Math.sin(angle)*spd*0.65,
        size:0.75+Math.random()*0.85,age:0
      });
    }
    for(let i=0;i<skullCount;i++){
      const angle=(i/skullCount)*Math.PI*2+Math.random()*0.5;
      const spd=2.2+Math.random()*4.5;
      effects.current.push({
        id:nextEffectId.current++,kind:"skull",x,y,z,
        vx:Math.cos(angle)*spd,vy:2.4+Math.random()*4.2,vz:Math.sin(angle)*spd*0.7,
        size:0.8+Math.random()*0.6,age:0
      });
    }
    setEnemyVersion(v=>v+1);
  };

  const addBloodPool=(x:number,z:number,radius=0.85)=>{
    bloodPools.current.push({id:nextEffectId.current++,x,z,radius});
    if(bloodPools.current.length>28)bloodPools.current.shift();
  };

  const kill=(enemy:EnemyState)=>{
    if(!enemy.alive)return;
    enemy.alive=false;
    addBloodPool(enemy.x,enemy.z,0.9);
    onKill();
    onScore(100);
    setEnemyVersion(v=>v+1);
  };

  const nearest=(range:number, zRange=2.0, minDot=-0.35)=>{
    let result:EnemyState|null=null;
    let bestScore=Infinity;
    const px=player.current?.position.x??0;
    const pz=player.current?.position.z??0;
    const fx=attackDirection.current.x;
    const fz=attackDirection.current.z;
    const effectiveRange=phase===2?range+0.35:range;
    for(const e of enemies.current){
      if(!e.alive)continue;
      if(phase===1&&e.id<=14&&!initialEnemiesVisible)continue;
      const dx=e.x-px,dz=e.z-pz;
      const d=Math.hypot(dx,dz);
      if(d>effectiveRange)continue;
      const forward=dx*fx+dz*fz;
      if(phase===1){
        if(Math.abs(dz)>zRange)continue;
        if(forward<minDot)continue;
        if(d<bestScore){bestScore=d;result=e;}
      }else{
        const lateral=Math.abs(dx*(-fz)+dz*fx);
        const allowCloseHug=d<=1.25&&forward>=-0.6;
        if(!allowCloseHug&&(forward<minDot||lateral>Math.max(1.35,effectiveRange*0.72)))continue;
        const score=d-Math.max(0,forward)*0.25;
        if(score<bestScore){bestScore=score;result=e;}
      }
    }
    return result;
  };

  const findShotgunTarget=(px:number,pz:number)=>{
    const fx=attackDirection.current.x;
    const fz=attackDirection.current.z;
    let bestTarget:EnemyState|null=null;
    let bestScore=Infinity;
    const maxRange=phase===2?12.0:9.5;
    for(const e of enemies.current){
      if(!e.alive)continue;
      if(phase===1&&e.id<=14&&!initialEnemiesVisible)continue;
      const dx=e.x-px,dz=e.z-pz;
      const forward=dx*fx+dz*fz;
      const lateral=Math.abs(dx*(-fz)+dz*fx);
      const d=Math.hypot(dx,dz);
      if(d>maxRange)continue;
      if(phase===1){
        if(Math.abs(dz)>1.85)continue;
        if(forward<-0.35)continue;
      }else{
        const coneWidth=1.35+Math.max(0,forward)*0.3;
        if(lateral>coneWidth)continue;
        if(forward<-0.55||(forward<0.05&&d>1.35))continue;
      }
      const score=d+lateral*0.55;
      if(score<bestScore){bestScore=score;bestTarget=e;}
    }
    return bestTarget;
  };

  const doPickup=()=>{
    if(phase!==1||!player.current)return;
    // Weapons are collected in the intended progression: pipe, machete, shotgun.
    const next=pickups.current.find(p=>!p.collected);
    if(!next)return;
    const dx=next.x-player.current.position.x;
    const dz=next.z-player.current.position.z;
    const distance=Math.hypot(dx,dz);
    if(distance>2.65)return;
    next.collected=true;
    motion.current.weapon=next.id;
    setEquipped(next.id);
    setEnemyVersion(v=>v+1);
  };

  const applyPipeImpact=(style:PipeAttackStyle)=>{
    if(!player.current)return;
    const e=nearest(2.8,1.8,-0.4);
    if(!e)return;

    e.alive=false;
    e.grabTimer=0;
    e.fall=attackDirection.current.x||attackDirection.current.z||facing.current;
    e.vx=0;e.vy=0;e.vz=0;
    if(style==="bat"){
      // Baseball-bat arc: launch the creature backward into the fleshy wall or a foreground tree.
      e.bodyState="wallFlying";
      e.targetZ=targetWallZ(e.x);
      e.vx=attackDirection.current.x*2.8;
      e.vy=5.8;
      e.vz=attackDirection.current.z*2.8-(phase===1?17.5:0);
      e.stickRot=(Math.random()-0.5)*0.5;
      spawnGore(e.x,1.25,e.z,18,5.4);
      addBloodPool(e.x,e.z,0.82);
    }else{
      // Overhead pipe strike: the monster is driven down into the ground.
      e.bodyState="pipeSlam";
      e.y=0.38;
      spawnGore(e.x,1.0,e.z,20,4.8);
      addBloodPool(e.x,e.z,0.95);
    }
    onKill();
    onScore(100);
    setEnemyVersion(v=>v+1);
  };

  const doAttack=()=>{
    if(attackCooldown.current>0)return;
    const px=player.current?.position.x??0;
    if(equipped==="pipe"){
      // Every press starts exactly one randomized strike. Further strikes in the
      // selected rhythm are allowed only while the player keeps the button held.
      const patterns:PipeAttackStyle[][]=[
        ["bat","bat","overhead","overhead"],
        ["bat","overhead","overhead"],
        ["bat","bat","bat","overhead","overhead"],
        ["overhead","overhead","bat","bat"],
        ["overhead","bat","bat"],
        ["overhead","overhead","overhead","bat","bat"],
      ];
      const selected=patterns[Math.floor(Math.random()*patterns.length)];
      const steps=[...selected];
      pipeCombo.current={steps,elapsed:0,stepIndex:0,hit:false};
      attackCooldown.current=PIPE_STRIKE_DURATION+0.12;
      motion.current.attackTime=PIPE_STRIKE_DURATION;
      motion.current.attackStyle=steps[0];
      motion.current.attackProgress=0;
      return;
    }
    attackCooldown.current=equipped==="shotgun"?0.62:equipped==="machete"?0.56:0.42;
    motion.current.attackTime=equipped==="shotgun"?0.42:equipped==="machete"?0.56:0.36;
    const macheteStyle=equipped==="machete"?macheteAttackVariant.current:null;
    if(macheteStyle)macheteAttackVariant.current=macheteStyle==="head"?"arm":"head";
    motion.current.attackStyle=macheteStyle==="head"?"macheteHead":macheteStyle==="arm"?"macheteArm":null;
    motion.current.attackProgress=0;

    if(equipped==="shotgun"){
      const pz=player.current?.position.z??0;
      const py=player.current?.position.y??0;
      const target=findShotgunTarget(px,pz);
      if(target){
        const dx=target.x-px;
        const dz=target.z-pz;
        const fx=attackDirection.current.x;
        const fz=attackDirection.current.z;
        const localFwd=Math.max(0.75,dx*fx+dz*fz);
        const localX=dx*(-fz)+dz*fx;
        const headY=target.y+(target.kind==="crawler"?1.05:1.65);
        const muzzleY=py+1.34;
        motion.current.shotgunAimPitch=THREE.MathUtils.clamp(Math.atan2(headY-muzzleY,localFwd),-0.65,0.55);
        motion.current.shotgunAimYaw=THREE.MathUtils.clamp(-Math.atan2(localX,localFwd),-0.65,0.65);
      }else{
        motion.current.shotgunAimPitch=0.18;
        motion.current.shotgunAimYaw=0;
      }
      pendingShotgun.current={timer:0.085,targetId:target?.id??null};
      return;
    }

    const e=nearest(equipped==="machete"?2.35:1.65,2.0,equipped==="machete"?-0.35:-0.2);
    if(!e)return;

    if(equipped==="machete"){
      e.alive=false;
      e.grabTimer=0;
      e.bodyState="macheteFalling";
      e.fall=attackDirection.current.x||attackDirection.current.z||facing.current;
      e.vx=attackDirection.current.x*1.15;
      e.vz=attackDirection.current.z*1.15;
      if(macheteStyle==="head"){
        e.headless=true;
        severedHeads.current.push({
          id:nextEffectId.current++,
          kind:e.kind,
          x:e.x,
          y:e.kind==="crawler"?1.05:1.65,
          z:e.z,
          vx:attackDirection.current.x*1.8,
          vy:4.0,
          vz:attackDirection.current.z*1.8-(phase===1?15.5:0),
          rotZ:(Math.random()-0.5)*0.6,
          stuck:false,
          targetZ:targetWallZ(e.x),
        });
        spawnGore(e.x,e.kind==="crawler"?1.05:1.65,e.z,22,5.2);
      }else{
        // The alternate cut removes the creature's right arm and sends it
        // backward in a spinning ballistic arc from the shoulder to the floor.
        e.severedArm=true;
        const sideX=-attackDirection.current.z;
        const sideZ=attackDirection.current.x;
        effects.current.push({
          id:nextEffectId.current++,
          kind:"arm",
          x:e.x+0.43,
          y:e.kind==="crawler"?0.88:1.18,
          z:e.z+0.08,
          vx:-attackDirection.current.x*2.9+sideX*1.05,
          vy:4.35,
          vz:-attackDirection.current.z*2.9+sideZ*1.05,
          size:1,
          age:0
        });
        spawnGore(e.x+0.42,e.kind==="crawler"?0.9:1.18,e.z,16,4.8);
      }
      addBloodPool(e.x,e.z,1.05);
      onKill();
      onScore(100);
      setEnemyVersion(v=>v+1);
    }else{
      // Unarmed punch — original mechanic preserved + extra blood splatter
      e.health--;
      e.vx=attackDirection.current.x*3.2;
      e.vz=attackDirection.current.z*3.2;
      e.fall=attackDirection.current.x||attackDirection.current.z||facing.current;
      spawnGore(e.x,1.15,e.z,e.health<=0?16:10,4.0);
      if(e.health<=0)kill(e);
    }
  };

  const doGrab=()=>{
    if(grabCooldown.current>0||!player.current)return;
    const e=nearest(1.95,1.65,-0.25);
    if(!e)return;
    grabCooldown.current=1.35;
    motion.current.grabTime=1.35;
    // Hold the enemy in front of Rick before applying the backward throw impulse.
    e.bodyState="grabLift";
    e.alive=false;
    e.grabTimer=0;
    e.fall=-(attackDirection.current.x||attackDirection.current.z||facing.current);
    e.vx=0;e.vy=0;e.vz=0;
    e.x=player.current.position.x+attackDirection.current.x*0.82;
    e.z=player.current.position.z+attackDirection.current.z*0.82;
    e.y=0.45;
    setEnemyVersion(v=>v+1);
  };
  const doJump=()=>{if(!grounded.current)return;grounded.current=false;jumpVelocity.current=6.2;};

  useEffect(()=>{
    const down=(e:KeyboardEvent)=>{const k=e.key.toLowerCase();keys.current.add(k);if(["arrowleft","arrowright","arrowup","arrowdown"," "].includes(k))e.preventDefault();if(k==="k")doGrab();if(k===" "||k==="l")doJump();if(k==="e")doPickup();};
    const up=(e:KeyboardEvent)=>keys.current.delete(e.key.toLowerCase());
    window.addEventListener("keydown",down);window.addEventListener("keyup",up);return()=>{window.removeEventListener("keydown",down);window.removeEventListener("keyup",up);};
  });

  useFrame((_,dt)=>{
    if(paused||!player.current)return;
    motion.current.weapon=equipped;
    const c=controls.current;const prior=lastActions.current;
    const attackHeld=c.attack||keys.current.has("j");
    if(attackHeld&&!prior.attack)doAttack();if(c.grab&&!prior.grab)doGrab();if(c.jump&&!prior.jump)doJump();if(c.pickup&&!prior.pickup)doPickup();
    lastActions.current={attack:attackHeld,grab:c.grab,jump:c.jump,pickup:c.pickup};
    attackCooldown.current=Math.max(0,attackCooldown.current-dt);grabCooldown.current=Math.max(0,grabCooldown.current-dt);
    spitHitCooldown.current=Math.max(0,spitHitCooldown.current-dt);
    const keyH=Number(keys.current.has("d")||keys.current.has("arrowright"))-Number(keys.current.has("a")||keys.current.has("arrowleft"));
    const keyD=Number(keys.current.has("s")||keys.current.has("arrowdown"))-Number(keys.current.has("w")||keys.current.has("arrowup"));
    const dx=THREE.MathUtils.clamp(c.horizontal+keyH,-1,1),dz=THREE.MathUtils.clamp(c.depth+keyD,-1,1);
    const moving=Math.abs(dx)+Math.abs(dz)>0.08;motion.current.moving=moving;
    if(moving){
      const v=new THREE.Vector3(dx,0,dz).normalize();
      const stepX=v.x*4.25*dt;
      const depthSpeed=phase===2?4.25:2.1;
      const stepZ=v.z*depthSpeed*dt;
      if(phase===1){
        player.current.position.x+=stepX;
        player.current.position.z=THREE.MathUtils.clamp(player.current.position.z+stepZ,-1.35,1.35);
      }else{
        const px=player.current.position.x,pz=player.current.position.z,py=player.current.position.y;
        const nextX=THREE.MathUtils.clamp(px+stepX,-15.1,15.1);
        const nextZ=THREE.MathUtils.clamp(pz+stepZ,-17.25,28.4);
        const onDeckNow=upperDeckAccess.current&&py>=2.5&&Math.abs(px)<=12.0&&pz>=-17.25&&pz<=-1.65;
        const inStairCorridor=Math.abs(px)<=2.95&&pz>=-2.45&&pz<=5.55;
        const onStairNow=upperDeckAccess.current&&inStairCorridor;
        const entersStairFromFront=pz>=4.4&&Math.abs(px)<=2.95&&Math.abs(nextX)<=2.82&&nextZ<=5.6&&nextZ>=4.0;
        if(entersStairFromFront)upperDeckAccess.current=true;
        const canUseStairFootprint=onDeckNow||onStairNow||entersStairFromFront;
        // Ground-level access to the stair footprint is allowed cleanly from its front;
        // elevated players stay within the stair rails or upper deck, and overlapping positions can always exit.
        const inStairBlock=(x:number,z:number)=>Math.abs(x)<3.22&&z>-2.55&&z<5.42&&!canUseStairFootprint;
        const blockedByStair=(x:number,z:number)=>{
          if(!inStairBlock(x,z))return false;
          if(inStairBlock(px,pz)){
            // Never trap Rick inside the stair footprint: allow steps that move toward an exit.
            const distNow=Math.min(3.22-Math.abs(px),5.42-pz,pz+2.55);
            const distNext=Math.min(3.22-Math.abs(x),5.42-z,z+2.55);
            return distNext>distNow;
          }
          return true;
        };
        const blockedByStairRail=(x:number,z:number)=>onStairNow&&!onDeckNow&&z<5.35&&Math.abs(x)>2.85&&Math.abs(x)>=Math.abs(px);
        const blockedByDeckEdge=(x:number,z:number)=>onDeckNow&&(Math.abs(x)>11.9||(Math.abs(x)>2.82&&z>-1.75&&(Math.abs(x)>=Math.abs(px)||z>=pz)));
        const blockedByFurniture=(x:number,z:number)=>{
          const sofa=((x+10.2)/2.45)**2+((z-1.8)/1.22)**2<1;
          const chairA=Math.hypot(x-8.4,z-4.8)<0.92;
          const chairB=Math.hypot(x+7.8,z+7.1)<0.88;
          return py<0.55&&(sofa||chairA||chairB);
        };
        const canMove=(x:number,z:number)=>!blockedByStair(x,z)&&!blockedByStairRail(x,z)&&!blockedByDeckEdge(x,z)&&!blockedByFurniture(x,z);
        if(canMove(nextX,pz))player.current.position.x=nextX;
        const resolvedX=player.current.position.x;
        if(canMove(resolvedX,nextZ))player.current.position.z=nextZ;
        if(onStairNow||entersStairFromFront)upperDeckAccess.current=true;
        if(py<0.05&&player.current.position.z>5.6&&!onDeckNow)upperDeckAccess.current=false;
        if((player.current.position.x>12.35||player.current.position.x<-12.35||player.current.position.z<-17.3)&&py<0.1){
          upperDeckAccess.current=false;
        }
      }
      // Keep the horizontal combat-facing state for weapon targeting, and align
      // the 3D character + attack ray directly with the movement direction in the free-roam hall.
      if(Math.abs(dx)>0.05)facing.current=dx>0?1:-1;
      if(phase===1){
        attackDirection.current={x:facing.current,z:0};
        player.current.rotation.y=facing.current>0?-Math.PI/2:Math.PI/2;
      }else{
        attackDirection.current={x:v.x,z:v.z};
        player.current.rotation.y=Math.atan2(-v.x,-v.z);
      }
    }
    if(!grounded.current){motion.current.jumpHeight=Math.max(0,motion.current.jumpHeight+jumpVelocity.current*dt);jumpVelocity.current-=16.5*dt;if(motion.current.jumpHeight<=0){motion.current.jumpHeight=0;jumpVelocity.current=0;grounded.current=true;}}
    if(pipeCombo.current){
      const combo=pipeCombo.current;
      combo.elapsed+=dt;
      const nextIndex=Math.floor(combo.elapsed/PIPE_STRIKE_DURATION);
      if(nextIndex>=combo.steps.length || (nextIndex>combo.stepIndex&&!attackHeld)){
        // Releasing the button completes the current strike but prevents the
        // remaining combo steps from starting.
        pipeCombo.current=null;
        motion.current.attackTime=0;
        motion.current.attackStyle=null;
        motion.current.attackProgress=0;
      }else{
        if(nextIndex!==combo.stepIndex){combo.stepIndex=nextIndex;combo.hit=false;}
        const localProgress=(combo.elapsed-nextIndex*PIPE_STRIKE_DURATION)/PIPE_STRIKE_DURATION;
        const style=combo.steps[nextIndex];
        motion.current.attackTime=PIPE_STRIKE_DURATION-localProgress*PIPE_STRIKE_DURATION;
        motion.current.attackStyle=style;
        motion.current.attackProgress=localProgress;
        const impactAt=style==="bat"?0.48:0.56;
        if(!combo.hit&&localProgress>=impactAt){
          combo.hit=true;
          applyPipeImpact(style);
        }
      }
    }else{
      motion.current.attackTime=Math.max(0,motion.current.attackTime-dt);
      if(motion.current.attackTime<=0){
        motion.current.attackStyle=null;
        motion.current.attackProgress=0;
      }
    }
    motion.current.grabTime=Math.max(0,motion.current.grabTime-dt);
    const px=player.current.position.x, pz=player.current.position.z;
    if(pendingShotgun.current){
      pendingShotgun.current.timer-=dt;
      if(pendingShotgun.current.timer<=0){
        const shot=pendingShotgun.current;
        pendingShotgun.current=null;
        const target=
          (shot.targetId!==null?enemies.current.find(en=>en.id===shot.targetId&&en.alive):undefined)??
          findShotgunTarget(px,pz);
        if(target){
          target.alive=false;
          target.headless=true;
          target.bodyState="falling";
          target.knocked=0.65;
          target.fall=attackDirection.current.x||attackDirection.current.z||facing.current;
          target.vx=attackDirection.current.x*4.5;
          target.vz=attackDirection.current.z*4.5;
          const headHeight=target.kind==="crawler"?1.05:1.65;
          // Shot blast originates at the aimed monster head and explodes it into gore + skull shards.
          spawnGore(target.x,headHeight,target.z,28,6.2,11);
          addBloodPool(target.x,target.z,1.15);
          onKill();
          onScore(100);
          setEnemyVersion(v=>v+1);
        }
      }
    }

    if(phase===1){
      const close=pickups.current.some(p=>!p.collected&&Math.hypot(px-p.x,pz-p.z)<1.4);
      if(close)doPickup();

      const spawnWave = (waveId:number, triggerX:number, list:{x:number;z:number;kind:EnemyKind}[]) => {
        if(initialEnemiesVisible && px>=triggerX && !triggeredWaves.current.has(waveId)){
          triggeredWaves.current.add(waveId);
          list.forEach((s,idx)=>enemies.current.push(makeEnemy(nextEnemyId.current++, s.x, s.z, s.kind, idx*1.3, true)));
          setEnemyVersion(v=>v+1);
        }
      };
      spawnWave(1, 2.0, [{x:10.5,z:-0.65,kind:"crawler"},{x:-4.5,z:0.65,kind:"crawler"}]);
      spawnWave(2, 11.0, [{x:19.5,z:0.7,kind:"spitter"},{x:5.5,z:-0.55,kind:"crawler"}]);
      spawnWave(3, 21.0, [{x:29.5,z:-0.65,kind:"brute"},{x:15.0,z:0.6,kind:"crawler"}]);
      spawnWave(4, 31.0, [{x:39.5,z:0.6,kind:"spitter"},{x:25.0,z:-0.6,kind:"crawler"}]);
      spawnWave(5, 41.0, [{x:49.5,z:-0.6,kind:"brute"},{x:36.0,z:0.65,kind:"crawler"}]);
      spawnWave(6, 51.0, [{x:58.5,z:0.6,kind:"brute"},{x:56.2,z:-0.65,kind:"spitter"},{x:60.0,z:-0.6,kind:"spitter"}]);
    }

    enemies.current.forEach((e)=>{
      const group=enemyGroups.current[e.id];
      // Keep the initial Phase 1 enemies hidden and inactive during the opening delay.
      if(phase===1 && e.id<=14 && !initialEnemiesVisible)return;
      if(e.bodyState==="grabLift"){
        e.grabTimer+=dt;
        const liftProgress=THREE.MathUtils.clamp(e.grabTimer/0.62,0,1);
        const ease=liftProgress*liftProgress*(3-2*liftProgress);
        const pX=player.current!.position.x;
        const pZ=player.current!.position.z;
        e.x=THREE.MathUtils.lerp(pX+attackDirection.current.x*0.78,pX+attackDirection.current.x*0.92,ease);
        e.z=THREE.MathUtils.lerp(pZ+attackDirection.current.z*0.78,pZ+attackDirection.current.z*0.92,ease);
        e.y=0.48+ease*1.38;
        if(group){
          group.position.set(e.x,e.y,e.z);
          group.rotation.set(0,0,THREE.MathUtils.lerp(0,-facing.current*0.18,ease));
          group.scale.set(1,1,1);
        }
        if(e.grabTimer>=0.62){
          e.bodyState="grabThrown";
          e.grabTimer=0;
          // Strong impulse sends the monster behind Rick, away from the direction he faces.
          e.vx=-attackDirection.current.x*7.4;
          e.vy=5.1;
          e.vz=-attackDirection.current.z*7.4+(pZ-e.z)*1.2;
        }
        return;
      }
      if(e.bodyState==="grabThrown"){
        e.grabTimer+=dt;
        e.x+=e.vx*dt;e.y+=e.vy*dt;e.z+=e.vz*dt;
        e.vy-=17.5*dt;
        e.vx*=Math.max(0,1-dt*0.32);
        e.vz*=Math.max(0,1-dt*1.8);
        if(group){
          group.position.set(e.x,Math.max(0.18,e.y),e.z);
          group.rotation.z=THREE.MathUtils.damp(group.rotation.z,e.fall*1.42,9,dt);
          group.rotation.x=THREE.MathUtils.damp(group.rotation.x,0.18,6,dt);
        }
        if(e.y<=0.18&&e.vy<0){
          e.y=0.18;e.vy=0;e.vx=0;e.vz=0;
          e.bodyState="grabFallen";e.grabTimer=0;
          if(group){group.position.set(e.x,0.18,e.z);group.rotation.set(0,0,e.fall*1.42);}
          // Blood burst is synchronized with the body hitting the floor.
          spawnGore(e.x,0.62,e.z,24,5.2);
          addBloodPool(e.x,e.z,1.18);
          onKill();
          onScore(100);
          setEnemyVersion(v=>v+1);
        }
        return;
      }
      if(e.bodyState==="grabFallen"){
        e.grabTimer+=dt;
        if(group){
          group.position.set(e.x,0.18,e.z);
          group.rotation.set(0,0,e.fall*1.42);
          group.scale.set(1,1,1);
        }
        if(e.grabTimer>=0.72){e.bodyState="grabMelting";e.grabTimer=0;}
        return;
      }
      if(e.bodyState==="grabMelting"){
        e.grabTimer+=dt;
        const melt=THREE.MathUtils.clamp(e.grabTimer/1.05,0,1);
        if(group){
          group.position.set(e.x,0.035+(1-melt)*0.12,e.z);
          group.rotation.set(0,0,e.fall*1.42);
          group.scale.set(1+0.12*melt,Math.max(0.015,1-melt),1+0.12*melt);
          group.traverse((child)=>{
            if((child as THREE.Mesh).isMesh){
              const mesh=child as THREE.Mesh;
              const mats=Array.isArray(mesh.material)?mesh.material:[mesh.material];
              mats.forEach((mat)=>{
                const material=mat as THREE.MeshStandardMaterial;
                if("opacity" in material){material.transparent=true;material.opacity=1-melt;}
              });
            }
          });
        }
        if(e.grabTimer>=1.05){
          e.bodyState="gone";
          if(group)group.visible=false;
          setEnemyVersion(v=>v+1);
        }
        return;
      }
      if(e.bodyState==="macheteFalling"){
        e.grabTimer+=dt;
        const progress=THREE.MathUtils.clamp(e.grabTimer/0.58,0,1);
        const ease=progress*progress*(3-2*progress);
        if(group){
          group.position.set(e.x,Math.max(0.12,0.24+Math.sin(progress*Math.PI)*0.16),e.z);
          group.rotation.set(0,0,e.fall*1.42*ease);
          group.scale.set(1,1,1);
        }
        if(e.grabTimer>=0.58){
          e.bodyState="macheteMelting";
          e.grabTimer=0;
          addBloodPool(e.x,e.z,1.12);
        }
        return;
      }
      if(e.bodyState==="macheteMelting"){
        e.grabTimer+=dt;
        const melt=THREE.MathUtils.clamp(e.grabTimer/0.92,0,1);
        if(group){
          group.position.set(e.x,0.035+(1-melt)*0.1,e.z);
          group.rotation.set(0,0,e.fall*1.42);
          group.scale.set(1+0.1*melt,Math.max(0.018,1-melt),1+0.1*melt);
          group.traverse(child=>{
            if(!(child as THREE.Mesh).isMesh)return;
            const mesh=child as THREE.Mesh;
            const materials=Array.isArray(mesh.material)?mesh.material:[mesh.material];
            materials.forEach(material=>{
              const mat=material as THREE.MeshStandardMaterial;
              if("opacity" in mat){mat.transparent=true;mat.opacity=1-melt;}
            });
          });
        }
        if(e.grabTimer>=0.92){
          e.bodyState="gone";
          if(group)group.visible=false;
          setEnemyVersion(v=>v+1);
        }
        return;
      }
      if(e.bodyState==="pipeSlam"){
        e.grabTimer+=dt;
        const sink=THREE.MathUtils.clamp(e.grabTimer/0.62,0,1);
        const ease=sink*sink*(3-2*sink);
        if(group){
          group.position.set(e.x,THREE.MathUtils.lerp(0.34,-0.42,ease),e.z);
          group.rotation.set(0.12*ease,0,e.fall*0.12*ease);
          group.scale.set(1+0.12*ease,Math.max(0.025,1-0.94*ease),1+0.12*ease);
        }
        if(e.grabTimer>=0.62){
          e.bodyState="gone";
          if(group)group.visible=false;
          setEnemyVersion(v=>v+1);
        }
        return;
      }
      if(e.bodyState==="gone")return;
      if(e.bodyState==="wallFlying"){
        e.x+=e.vx*dt; e.y+=e.vy*dt; e.z+=e.vz*dt; e.vy-=9.8*dt;
        if(group){
          group.position.set(e.x,e.y,e.z);
          group.rotation.x=THREE.MathUtils.damp(group.rotation.x,-0.48,10,dt);
          group.rotation.z=THREE.MathUtils.damp(group.rotation.z,e.stickRot,10,dt);
        }
        if(e.z<=e.targetZ){
          e.z=e.targetZ; e.y=THREE.MathUtils.clamp(e.y,0.85,2.2);
          e.vx=0; e.vy=0; e.vz=0; e.bodyState="wallStuck";
          spawnGore(e.x,e.y,e.targetZ+0.08,18,5.0);
          setEnemyVersion(v=>v+1);
        }else if(phase===2&&e.vy<0&&e.y<=0.18){
          e.y=0.18; e.vy=0; e.vx=0; e.vz=0; e.bodyState="fallen";
          addBloodPool(e.x,e.z,1.0);
          setEnemyVersion(v=>v+1);
        }
        return;
      }
      if(e.bodyState==="wallStuck"){
        if(group){
          group.position.set(e.x,e.y,e.z);
          group.rotation.set(0,0,e.stickRot);
          group.scale.set(1.26,1.14,0.22);
        }
        return;
      }
      if(e.bodyState==="falling"){
        e.knocked=Math.max(0,e.knocked-dt);
        e.x+=e.vx*dt;
        e.z+=e.vz*dt;
        e.vx*=Math.max(0,1-dt*4.5);
        e.vz*=Math.max(0,1-dt*4.5);
        const progress=1-e.knocked/0.65;
        if(group){
          group.position.set(e.x,Math.max(0.16,Math.sin(progress*Math.PI)*0.22),e.z);
          group.rotation.z=e.fall*Math.min(1,progress*1.35)*1.5;
        }
        if(e.knocked<=0){
          e.bodyState="fallen";
          e.vx=0;e.vz=0;
          addBloodPool(e.x,e.z,1.15);
          setEnemyVersion(v=>v+1);
        }
        return;
      }
      if(e.bodyState==="fallen"){
        if(group){
          group.position.set(e.x,0.16,e.z);
          group.rotation.set(0,0,e.fall*1.5);
        }
        return;
      }
      if(!e.alive||!group)return;
      e.animation+=dt*(e.kind==="crawler"?8:e.kind==="brute"?3.2:5);
      e.spitCooldown=Math.max(0,e.spitCooldown-dt);
      if(e.knocked>0){
        e.knocked=Math.max(0,e.knocked-dt);e.x+=e.vx*dt;e.z+=e.vz*dt;
        e.vx*=Math.max(0,1-dt*3.8);e.vz*=Math.max(0,1-dt*3.8);
        const progress=1-e.knocked/1.25;
        group.rotation.z=e.fall*Math.min(1,progress*1.8)*1.48;
        group.position.y=Math.max(0.035,Math.sin(progress*Math.PI)*0.16);
        if(e.knocked<=0)kill(e);
      }else{
        group.rotation.z=THREE.MathUtils.damp(group.rotation.z,0,8,dt);
        if(Math.abs(e.vx)>0.08||Math.abs(e.vz)>0.08){
          e.x+=e.vx*dt;e.z+=e.vz*dt;e.vx*=Math.max(0,1-dt*2.8);e.vz*=Math.max(0,1-dt*2.8);
        }else if(phase===1){
          if(!e.activated&&Math.hypot(px-e.x,pz-e.z)<11.5)e.activated=true;
          if(e.activated){
            if(Math.abs(px-e.x)>0.85)e.x+=Math.sign(px-e.x)*1.2*dt;
            e.z+=Math.sign(pz-e.z)*Math.min(Math.abs(pz-e.z),1.2*dt);
            group.rotation.y=THREE.MathUtils.damp(group.rotation.y,px>=e.x?0.45:-0.45,6,dt);
          }
        }else{
          const dxPlayer=px-e.x,dzPlayer=pz-e.z;
          const distPlayer=Math.hypot(dxPlayer,dzPlayer);
          if(!e.activated&&distPlayer<20)e.activated=true;
          if(e.activated){
            if(distPlayer>0.95){
              const step=Math.min(distPlayer-0.95,1.35*dt);
              e.x+=(dxPlayer/distPlayer)*step;
              e.z+=(dzPlayer/distPlayer)*step;
            }
            group.rotation.y=THREE.MathUtils.damp(group.rotation.y,Math.atan2(dxPlayer,dzPlayer),6,dt);
          }
        }
        group.position.y=e.kind==="crawler"?Math.abs(Math.sin(e.animation))*0.035:Math.sin(e.animation*2)*0.025;
      }
      // Only the spitters that guard the mansion entrance use the green projectile attack.
      if(phase===1&&e.kind==="spitter"&&e.x>=52.5&&e.activated&&e.spitCooldown<=0){
        const dx=px-e.x,dz=pz-e.z,distance=Math.hypot(dx,dz);
        if(distance>3.2&&distance<11.5){
          const flight=0.82;
          const startX=e.x+Math.sign(dx)*0.22,startY=1.72,startZ=e.z+0.18;
          spitProjectiles.current.push({
            id:nextEffectId.current++,x:startX,y:startY,z:startZ,
            vx:(px-startX)/flight,vy:(0.08-startY+4.9*flight*flight)/flight,
            vz:(pz-startZ)/flight,age:0
          });
          e.spitCooldown=2.65;
          setEnemyVersion(v=>v+1);
        }
      }
      e.x=THREE.MathUtils.clamp(e.x,phase===1?-25.2:-15.5,phase===1?61.5:15.5);
      e.z=THREE.MathUtils.clamp(e.z,phase===1?-1.35:-16.2,phase===1?1.35:25.5);
      group.position.x=e.x;group.position.z=e.z;
    });

    severedHeads.current.forEach((h)=>{
      const group=headGroups.current[h.id];
      if(!h.stuck){
        h.x+=h.vx*dt; h.y+=h.vy*dt; h.z+=h.vz*dt; h.vy-=9.8*dt;
        if(group){
          group.position.set(h.x,h.y,h.z);
          group.rotation.z+=dt*8;
        }
        if(h.z<=h.targetZ){
          h.z=h.targetZ;
          h.y=THREE.MathUtils.clamp(h.y,1.0,2.5);
          h.stuck=true;
          spawnGore(h.x,h.y,h.targetZ+0.08,14,4.0);
          setEnemyVersion(v=>v+1);
        }
      }else if(group){
        group.position.set(h.x,h.y,h.z);
        group.rotation.set(0,0,h.rotZ);
      }
    });

    effects.current.forEach((fx)=>{
      const group=effectGroups.current[fx.id];
      fx.age+=dt;fx.x+=fx.vx*dt;fx.y+=fx.vy*dt;fx.z+=fx.vz*dt;fx.vy-=9.8*dt;
      if(fx.y<0.06){fx.y=0.06;fx.vy=0;fx.vx*=0.45;fx.vz*=0.45;}
      if(fx.x<=-25.0||fx.x>=61.5){fx.vx=0;fx.vy=0;fx.vz=0;}
      if(group){group.position.set(fx.x,fx.y,fx.z);if(fx.kind==="arm"){group.rotation.x+=dt*9;group.rotation.y+=dt*11;group.rotation.z+=dt*13;}else group.rotation.z+=dt*5;}
    });
    const beforeEffects=effects.current.length;
    effects.current=effects.current.filter(fx=>fx.age<2.8);
    if(effects.current.length!==beforeEffects)setEnemyVersion(v=>v+1);

    // Integrate the green glob with gravity to create a visible mouth-to-ground arc.
    let landedSpit=false;
    spitProjectiles.current.forEach(projectile=>{
      projectile.age+=dt;
      projectile.x+=projectile.vx*dt;
      projectile.y+=projectile.vy*dt;
      projectile.z+=projectile.vz*dt;
      projectile.vy-=9.8*dt;
      if(spitHitCooldown.current<=0&&player.current&&projectile.y<1.35&&Math.hypot(projectile.x-player.current.position.x,projectile.z-player.current.position.z)<0.62){
        const hitX=player.current.position.x-projectile.x;
        const hitZ=player.current.position.z-projectile.z;
        const hitLength=Math.max(0.001,Math.hypot(hitX,hitZ));
        player.current.position.x=THREE.MathUtils.clamp(player.current.position.x+hitX/hitLength*0.9,-25.5,63.8);
        player.current.position.z=THREE.MathUtils.clamp(player.current.position.z+hitZ/hitLength*0.9,-1.35,1.35);
        spitHitCooldown.current=1.15;
        projectile.y=0.08;
      }
      const mesh=spitGroups.current[projectile.id];
      if(mesh)mesh.position.set(projectile.x,Math.max(0.08,projectile.y),projectile.z);
      if(projectile.y<=0.08){
        spitSplashes.current.push({id:projectile.id,x:projectile.x,z:projectile.z,age:0});
        landedSpit=true;
      }
    });
    const activeSpits=spitProjectiles.current.filter(p=>p.y>0.08&&p.age<2.2);
    if(activeSpits.length!==spitProjectiles.current.length)landedSpit=true;
    spitProjectiles.current=activeSpits;
    spitSplashes.current.forEach(splash=>{
      splash.age+=dt;
      const mesh=splashGroups.current[splash.id];
      if(mesh){
        mesh.position.set(splash.x,0.045,splash.z);
        const spread=1+Math.min(1,splash.age*3)*0.55;
        mesh.scale.set(spread,0.22,spread);
      }
    });
    const beforeSplashes=spitSplashes.current.length;
    spitSplashes.current=spitSplashes.current.filter(s=>s.age<1.35);
    if(landedSpit||beforeSplashes!==spitSplashes.current.length)setEnemyVersion(v=>v+1);

    if(phase===1){
      player.current.position.x=THREE.MathUtils.clamp(player.current.position.x,-25.5,63.8);
      if(player.current.position.x>=62.5){
        setPhase(2);onStageChange(2);player.current.position.set(0,0,9);
        player.current.rotation.y=0;
        attackDirection.current={x:0,z:-1};
        upperDeckAccess.current=false;
        pendingShotgun.current=null;
        pipeCombo.current=null;
        spitHitCooldown.current=0;
        jumpVelocity.current=0;
        grounded.current=true;
        motion.current.jumpHeight=0;
        spitProjectiles.current=[];
        spitSplashes.current=[];
        effects.current=[];
        enemies.current.forEach(e=>{e.alive=false;e.bodyState="alive";});
        // The hall is an arena: its first wave enters from several sides, not a single corridor.
        const hallWave=[
          [-13.2,-12.8,"crawler"],[13.0,-12.2,"spitter"],[-14.0,5.0,"brute"],
          [14.0,8.0,"crawler"],[-5.5,15.0,"spitter"],[7.0,15.2,"brute"]
        ] as const;
        hallWave.forEach((spawn,idx)=>enemies.current.push(makeEnemy(nextEnemyId.current++,spawn[0],spawn[1],spawn[2],idx*1.4,true)));
        severedHeads.current=[];
        bloodPools.current=[];
        setEnemyVersion(v=>v+1);
      }
    }else{
      player.current.position.x=THREE.MathUtils.clamp(player.current.position.x,-15.1,15.1);
      player.current.position.z=THREE.MathUtils.clamp(player.current.position.z,-17.25,28.4);
      // Only the front-facing staircase grants access to the upper-storey deck.
      const stairX=Math.abs(player.current.position.x);
      const stairZ=player.current.position.z;
      const onStair=upperDeckAccess.current&&stairX<=2.95&&stairZ>=-2.45&&stairZ<=5.55;
      const onUpperGallery=upperDeckAccess.current&&stairZ>=-17.25&&stairZ<=-1.75&&stairX<=12.0;
      if(onUpperGallery)player.current.position.y=3.5;
      else if(onStair)player.current.position.y=THREE.MathUtils.clamp((5.45-stairZ)/7.2,0,1)*3.5;
      else player.current.position.y=0;
      if(!onUpperGallery&&!onStair&&(stairZ>5.6||stairX>2.95))upperDeckAccess.current=false;
      const underUpperDeck=player.current.position.y<2.5&&stairX<=12.25&&stairZ>=-17.25&&stairZ<=-2.55;
      player.current.visible=!underUpperDeck;
    }

    const targetX=player.current.position.x;
    const targetZ=player.current.position.z;
    const playerHeight=player.current.position.y;
    const hdPhase2ZoomActive=useHDCharacter&&phase===2;
    if(hdPhase2ZoomActive){
      hdZoomCurrent.current=THREE.MathUtils.damp(hdZoomCurrent.current,zoomTargetRef.current,10,dt);
    }else{
      hdZoomCurrent.current=1;
    }
    if(phase===1){
      camera.position.x=THREE.MathUtils.damp(camera.position.x,targetX,3.8,dt);
      camera.position.z=18;
      camera.position.y=4.6;
      camera.lookAt(camera.position.x,3.2,0);
    }else if(hdPhase2ZoomActive){
      const zoomLevel=THREE.MathUtils.clamp(hdZoomCurrent.current,0.55,2.4);
      const focus=THREE.MathUtils.clamp((zoomLevel-1)/1.4,0,1);
      const camY=THREE.MathUtils.lerp(8.4,5.6,focus)+playerHeight;
      const camZ=targetZ+THREE.MathUtils.lerp(6.8,5.0,focus);
      const lookY=THREE.MathUtils.lerp(1.7,1.28,focus)+playerHeight;
      const lookZ=targetZ-THREE.MathUtils.lerp(2.6,0.35,focus);
      camera.position.set(targetX,camY,camZ);
      camera.up.set(0,1,0);
      camera.lookAt(targetX,lookY,lookZ);
    }else{
      // Rigid follow offset prevents the room from swaying as Rick changes direction.
      camera.position.set(targetX,8.4+playerHeight,targetZ+6.8);
      camera.up.set(0,1,0);
      camera.lookAt(targetX,1.7+playerHeight,targetZ-2.6);
    }
    if(size.width>0){const aspect=size.width/Math.max(1,size.height);const baseHalfH=phase===1?5.4:7.4;const halfH=hdPhase2ZoomActive?baseHalfH/THREE.MathUtils.clamp(hdZoomCurrent.current,0.55,2.4):baseHalfH;const ortho=camera as THREE.OrthographicCamera;ortho.zoom=1;ortho.left=-halfH*aspect;ortho.right=halfH*aspect;ortho.top=halfH;ortho.bottom=-halfH;ortho.updateProjectionMatrix();}
  });

  return <group>
    <color attach="background" args={["#08070a"]}/>
    <ambientLight intensity={0.78}/>
    <directionalLight position={[-6,12,10]} intensity={1.55} castShadow shadow-mapSize={[2048,2048]}/>
    <pointLight position={[10,5,3]} intensity={0.45} color="#8d3330"/>
    {phase===1?<Exterior/>:<MansionRoom player={player}/>}
    {phase===1&&<group position={[-24,0,0]}><mesh position={[0,0.02,0]} rotation={[-Math.PI/2,0,0]}><ringGeometry args={[0.48,0.56,32]}/><meshBasicMaterial color="#7d342d"/></mesh></group>}
    <group ref={player}>{useHDCharacter
      ? <RickTaylorCharacter3DHDPlayer motion={motion.current} equippedWeapon={equipped}/>
      : <RickTaylorCharacter motion={motion.current} equippedWeapon={equipped}/>}</group>

    {bloodPools.current.map(pool=>(
      <mesh key={`pool-${pool.id}`} position={[pool.x,0.022,pool.z]} rotation={[-Math.PI/2,0,0]}>
        <circleGeometry args={[pool.radius,18]}/>
        <meshStandardMaterial color="#4e060e" roughness={0.25}/>
      </mesh>
    ))}

    {enemies.current.map((e)=>(e.alive||e.bodyState!=="alive")&&(phase!==1||e.id>14||initialEnemiesVisible)&&<group key={e.id} ref={node=>{enemyGroups.current[e.id]=node;}} position={[e.x,e.y,e.z]}>
      <MonsterProceduralCharacter kind={e.kind} headless={e.headless} missingArm={e.severedArm} animation={e.animation} fallen={e.bodyState==="fallen"||e.bodyState==="grabFallen"||e.bodyState==="macheteFalling"} dissolve={e.bodyState==="grabMelting" ? THREE.MathUtils.clamp(e.grabTimer/1.05,0,1) : e.bodyState==="macheteMelting" ? THREE.MathUtils.clamp(e.grabTimer/0.92,0,1) : 0} attackPulse={e.knocked>0?THREE.MathUtils.clamp(e.knocked/0.65,0,1):e.bodyState==="grabLift"||e.bodyState==="grabThrown"||e.bodyState==="wallFlying"?1:0}/>
      {e.bodyState==="wallStuck"&&<mesh position={[0,0.95,-0.25]}><circleGeometry args={[1.05,16]}/><meshStandardMaterial color="#4a0911" roughness={0.35}/></mesh>}
    </group>)}

    {severedHeads.current.map((h)=><group key={`head-${h.id}`} ref={node=>{headGroups.current[h.id]=node;}} position={[h.x,h.y,h.z]}>
      <EnemyHeadMesh kind={h.kind}/>
      {h.stuck&&<mesh position={[0,0,-0.25]}><circleGeometry args={[0.62,14]}/><meshStandardMaterial color="#590811" roughness={0.32}/></mesh>}
    </group>)}

    {effects.current.map((fx)=><group key={fx.id} ref={node=>{effectGroups.current[fx.id]=node;}} position={[fx.x,fx.y,fx.z]}>
      {fx.kind==="skull"?<mesh scale={fx.size}><boxGeometry args={[0.14,0.1,0.12]}/><meshStandardMaterial color="#d4cdbc" roughness={0.65}/></mesh>:fx.kind==="arm"?<group scale={fx.size}>
        <mesh position={[0,0.16,0]} rotation={[0,0,0.08]} castShadow><capsuleGeometry args={[0.125,0.48,7,12]}/><meshStandardMaterial color="#8e5141" roughness={0.72}/></mesh>
        <mesh position={[0,0.37,0]} scale={[0.16,0.13,0.15]}><sphereGeometry args={[1,14,10]}/><meshStandardMaterial color="#64212a" roughness={0.55}/></mesh>
        <mesh position={[0,-0.18,0]} scale={[0.14,0.13,0.13]}><sphereGeometry args={[1,14,10]}/><meshStandardMaterial color="#a05c43" roughness={0.72}/></mesh>
        <mesh position={[0,-0.29,0]} rotation={[0,0,-0.12]}><capsuleGeometry args={[0.075,0.16,5,8]}/><meshStandardMaterial color="#a05c43" roughness={0.72}/></mesh>
      </group>:<mesh scale={fx.size}><icosahedronGeometry args={[0.11,0]}/><meshStandardMaterial color="#7e0c18" roughness={0.35}/></mesh>}
    </group>)}

    {spitProjectiles.current.map(p=><group key={p.id} ref={node=>{spitGroups.current[p.id]=node;}} position={[p.x,p.y,p.z]}>
      <mesh scale={[0.16,0.19,0.16]} castShadow><sphereGeometry args={[1,16,12]}/><meshPhysicalMaterial color="#78d51d" emissive="#2e6508" emissiveIntensity={0.42} roughness={0.16} clearcoat={1}/></mesh>
      <mesh position={[0,-0.12,0]} scale={[0.11,0.16,0.11]}><sphereGeometry args={[1,12,10]}/><meshStandardMaterial color="#b4ed38" roughness={0.12}/></mesh>
    </group>)}
    {spitSplashes.current.map(s=><group key={s.id} ref={node=>{splashGroups.current[s.id]=node;}} position={[s.x,0.045,s.z]}>
      <mesh rotation={[-Math.PI/2,0,0]}><circleGeometry args={[0.42,20]}/><meshPhysicalMaterial color="#6fbd19" emissive="#254d08" emissiveIntensity={0.25} roughness={0.2} transparent opacity={0.88}/></mesh>
      <mesh position={[0,0.035,0]} scale={[0.7,0.18,0.7]}><sphereGeometry args={[0.38,16,10]}/><meshStandardMaterial color="#9bd72b" roughness={0.2}/></mesh>
    </group>)}

    {phase===1&&pickups.current.map((p)=>!p.collected&&<group key={p.id} position={[p.x,0.16,p.z]}>
      <mesh rotation={[-Math.PI/2,0,0]}><torusGeometry args={[0.58,0.035,8,24]}/><meshStandardMaterial color="#db6b42" emissive="#612012"/></mesh>
      <group position={[0,0.18,0]}><WeaponModel id={p.id}/></group>
    </group>)}
    <mesh rotation={[-Math.PI/2,0,0]} position={[23,-0.035,0]} receiveShadow><planeGeometry args={[140,100]}/><shadowMaterial opacity={0.24}/></mesh>
  </group>;
}

export default function GameView({onScore,onKill,paused,onStageChange,graphicsQuality}:Props) {
  const [rendererMode,setRendererMode]=useState<"webgpu"|"webgl"|null>(null);
  const [worldPhase,setWorldPhase]=useState<1|2>(1);
  const viewportRef=useRef<HTMLDivElement>(null);
  const zoomTargetRef=useRef(1);
  const [zoomDisplay,setZoomDisplay]=useState(1);
  const pinchDistRef=useRef<number|null>(null);
  const isHDPhase2=rendererMode==="webgpu"&&worldPhase===2;

  const setHDZoom=(next:number)=>{
    const clamped=Math.round(THREE.MathUtils.clamp(next,0.55,2.4)*100)/100;
    zoomTargetRef.current=clamped;
    setZoomDisplay(clamped);
  };

  useEffect(()=>{
    let cancelled=false;
    setRendererMode(null);
    const resolveRenderer=async()=>{
      if(graphicsQuality==="standard"){if(!cancelled)setRendererMode("webgl");return;}
      try{
        if(typeof navigator==="undefined"||!("gpu" in navigator))throw new Error("WebGPU indisponível");
        const probe=new WebGPURenderer({antialias:true,powerPreference:"high-performance"});
        await probe.init();
        probe.dispose();
        if(!cancelled)setRendererMode("webgpu");
      }catch{
        if(!cancelled)setRendererMode("webgl");
      }
    };
    void resolveRenderer();
    return ()=>{cancelled=true;};
  },[graphicsQuality]);

  useEffect(()=>{
    if(!isHDPhase2)return;
    const onKeyDown=(e:KeyboardEvent)=>{
      if(e.key==="+"||e.key==="="){setHDZoom(zoomTargetRef.current+0.15);}
      else if(e.key==="-"||e.key==="_"){setHDZoom(zoomTargetRef.current-0.15);}
      else if(e.key==="0"){setHDZoom(1);}
    };
    const el=viewportRef.current;
    const onWheel=(e:WheelEvent)=>{
      e.preventDefault();
      setHDZoom(zoomTargetRef.current+(e.deltaY<0?0.14:-0.14));
    };
    window.addEventListener("keydown",onKeyDown);
    el?.addEventListener("wheel",onWheel,{passive:false});
    return ()=>{
      window.removeEventListener("keydown",onKeyDown);
      el?.removeEventListener("wheel",onWheel);
    };
  },[isHDPhase2]);

  const joystickRef=useRef<HTMLDivElement>(null);
  const joystickInput=useRef({x:0,y:0,pointerId:-1});
  const [knob,setKnob]=useState({x:0,y:0});
  const controls=useRef<WorldControls>({horizontal:0,depth:0,attack:false,grab:false,jump:false,pickup:false});
  const updateJoystick=(event:ReactPointerEvent<HTMLDivElement>)=>{const el=joystickRef.current;if(!el)return;const r=el.getBoundingClientRect();const dx=event.clientX-(r.left+r.width/2),dy=event.clientY-(r.top+r.height/2),radius=r.width*0.34,d=Math.hypot(dx,dy),scale=d>radius?radius/d:1;const x=dx*scale,y=dy*scale;joystickInput.current.x=x/radius;joystickInput.current.y=y/radius;controls.current.horizontal=x/radius;controls.current.depth=y/radius;setKnob({x,y});};
  const releaseJoystick=(event:ReactPointerEvent<HTMLDivElement>)=>{if(joystickInput.current.pointerId!==event.pointerId)return;joystickInput.current={x:0,y:0,pointerId:-1};controls.current.horizontal=0;controls.current.depth=0;setKnob({x:0,y:0});if(joystickRef.current?.hasPointerCapture(event.pointerId))joystickRef.current.releasePointerCapture(event.pointerId);};
  const setAction=(key:"attack"|"grab"|"jump"|"pickup",value:boolean)=>{controls.current[key]=value;};
  const press=(key:"attack"|"grab"|"jump"|"pickup")=>(e:ReactPointerEvent<HTMLButtonElement>)=>{e.preventDefault();setAction(key,true);};
  const release=(key:"attack"|"grab"|"jump"|"pickup")=>(e:ReactPointerEvent<HTMLButtonElement>)=>{e.preventDefault();setAction(key,false);};
  const handleStageChange=(stage:1|2)=>{
    setWorldPhase(stage);
    if(stage===2)setHDZoom(1);
    onStageChange(stage);
  };
  return <div ref={viewportRef} className="game-viewport"
    onTouchStart={e=>{
      if(!isHDPhase2||e.touches.length!==2)return;
      const a=e.touches[0],b=e.touches[1];
      pinchDistRef.current=Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY);
    }}
    onTouchMove={e=>{
      if(!isHDPhase2||e.touches.length!==2||pinchDistRef.current===null)return;
      const a=e.touches[0],b=e.touches[1];
      const nextDist=Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY);
      const delta=nextDist-pinchDistRef.current;
      pinchDistRef.current=nextDist;
      setHDZoom(zoomTargetRef.current+delta*0.0045);
    }}
    onTouchEnd={e=>{if(e.touches.length<2)pinchDistRef.current=null;}}>
    {rendererMode===null ? <div className="renderer-loading" role="status">Preparando qualidade gráfica…</div> : (
      <Canvas key={rendererMode} className="game-canvas" shadows dpr={[1,1.7]} orthographic camera={{position:[-24,4.6,18],zoom:1,near:0.1,far:100}}
        gl={async (defaultProps)=>{
          const canvas=defaultProps.canvas as HTMLCanvasElement;
          if(rendererMode==="webgpu"){
            const renderer=new WebGPURenderer({canvas,antialias:true,powerPreference:"high-performance"});
            try{
              await renderer.init();
              renderer.shadowMap.enabled=true;
              return renderer as unknown as THREE.WebGLRenderer;
            }catch{
              setRendererMode("webgl");
              const fallback=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:"high-performance"});
              fallback.shadowMap.enabled=true;
              fallback.shadowMap.type=THREE.PCFSoftShadowMap;
              return fallback;
            }
          }
          const renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:"high-performance"});
          renderer.shadowMap.enabled=true;
          renderer.shadowMap.type=THREE.PCFSoftShadowMap;
          return renderer;
        }}>
        <World onScore={onScore} onKill={onKill} paused={paused} onStageChange={handleStageChange} controls={controls} useHDCharacter={rendererMode==="webgpu"} zoomTargetRef={zoomTargetRef}/>
      </Canvas>
    )}
    {isHDPhase2&&<div className="hd-zoom-controls" aria-label="Zoom da câmera HD">
      <button type="button" className="hd-zoom-btn" aria-label="Afastar câmera" disabled={zoomDisplay<=0.56} onClick={()=>setHDZoom(zoomTargetRef.current-0.2)}>−</button>
      <button type="button" className="hd-zoom-readout" aria-label="Redefinir zoom" onClick={()=>setHDZoom(1)}>{Math.round(zoomDisplay*100)}%</button>
      <button type="button" className="hd-zoom-btn" aria-label="Aproximar câmera" disabled={zoomDisplay>=2.39} onClick={()=>setHDZoom(zoomTargetRef.current+0.2)}>+</button>
    </div>}
    <div className="action-buttons" aria-label="Ações de Rick">
      <button type="button" className="action-button action-punch" aria-label="Soco ou ataque" onPointerDown={press("attack")} onPointerUp={release("attack")} onPointerCancel={release("attack")} onPointerLeave={release("attack")}>SOCO</button>
      <button type="button" className="action-button action-grab" aria-label="Agarrar e arremessar" onPointerDown={press("grab")} onPointerUp={release("grab")} onPointerCancel={release("grab")} onPointerLeave={release("grab")}>AGARRÃO</button>
      <button type="button" className="action-button action-jump" aria-label="Pular" onPointerDown={press("jump")} onPointerUp={release("jump")} onPointerCancel={release("jump")} onPointerLeave={release("jump")}>PULO</button>
      <button type="button" className="action-button action-pickup" aria-label="Pegar próxima arma" onPointerDown={press("pickup")} onPointerUp={release("pickup")} onPointerCancel={release("pickup")} onPointerLeave={release("pickup")}>PEGAR</button>
    </div>
    <div ref={joystickRef} className="virtual-joystick" role="application" aria-label="Joystick virtual para movimentar Rick"
      onPointerDown={e=>{e.preventDefault();joystickInput.current.pointerId=e.pointerId;e.currentTarget.setPointerCapture(e.pointerId);updateJoystick(e);}}
      onPointerMove={e=>{if(joystickInput.current.pointerId===e.pointerId)updateJoystick(e);}}
      onPointerUp={releaseJoystick} onPointerCancel={releaseJoystick}
      onLostPointerCapture={()=>{joystickInput.current={x:0,y:0,pointerId:-1};controls.current.horizontal=0;controls.current.depth=0;setKnob({x:0,y:0});}}>
      <span className="virtual-joystick-ring"/><span className="virtual-joystick-knob" style={{transform:"translate(calc(-50% + "+knob.x+"px), calc(-50% + "+knob.y+"px))"}}/><span className="virtual-joystick-label">MOVE</span>
    </div>
  </div>;
}
