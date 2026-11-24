import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import RickTaylorCharacter, { type RickMotion } from "./characters/RickTaylorCharacter";

type Props = { onScore:(points:number)=>void; onKill:()=>void; paused:boolean; onStageChange:(stage:1|2)=>void };
type WeaponId = "pipe" | "machete" | "shotgun";
type EnemyKind = "crawler" | "brute" | "spitter";
type BodyState = "alive" | "wallFlying" | "wallStuck" | "falling" | "fallen" | "grabLift" | "grabThrown" | "grabFallen" | "grabMelting" | "pipeSlam" | "gone";
type EnemyState = {
  id:number; x:number; y:number; z:number; health:number; alive:boolean; kind:EnemyKind;
  knocked:number; vx:number; vy:number; vz:number; fall:number; animation:number;
  activated:boolean; bodyState:BodyState; stickRot:number; targetZ:number; headless:boolean; grabTimer:number;
};
type SeveredHead = {
  id:number; kind:EnemyKind; x:number; y:number; z:number;
  vx:number; vy:number; vz:number; rotZ:number; stuck:boolean; targetZ:number;
};
type BloodPool = { id:number; x:number; z:number; radius:number };
type PickupState = { id:WeaponId; x:number; z:number; collected:boolean };
type CombatEffect = {
  id:number; kind:"gore"|"skull"; x:number; y:number; z:number;
  vx:number; vy:number; vz:number; size:number; age:number;
};

const makeEnemy = (id:number, x:number, z:number, kind:EnemyKind, animation:number, activated=false): EnemyState => ({
  id, x, y:0, z, health:kind==="brute"?3:2, alive:true, kind, knocked:0,
  vx:0, vy:0, vz:0, fall:0, animation, activated, bodyState:"alive", stickRot:0, targetZ:-1.72, headless:false, grabTimer:0
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
type WorldProps = Props & { controls:React.MutableRefObject<WorldControls> };
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
    const fade=THREE.MathUtils.smoothstep(playerZ,17,20.2);
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
    <mesh rotation={[-Math.PI/2,0,0]} position={[0,-0.08,4.5]} receiveShadow>
      <planeGeometry args={[34,45]}/><meshStandardMaterial color="#302720" roughness={0.94}/>
    </mesh>
    {Array.from({length:13},(_,i)=><mesh key={"floor-seam-"+i} rotation={[-Math.PI/2,0,0]} position={[-15.5+i*2.58,0,4.5]}>
      <planeGeometry args={[0.035,44]}/><meshStandardMaterial color="#17120f" roughness={1}/>
    </mesh>)}
    {/* Four enclosing walls and a high, dark ceiling rim. */}
    <mesh position={[0,7.2,-18]}><boxGeometry args={[34,14.4,0.65]}/><meshStandardMaterial color="#241b19" roughness={0.96}/></mesh>
    <group ref={frontWallGroup}>
      <mesh position={[0,7.2,27]}><boxGeometry args={[34,14.4,0.65]}/><meshStandardMaterial color="#211917" roughness={0.96}/></mesh>
      {[-13,-8,-3,3,8,13].map(x=><mesh key={"front-pilaster-"+x} position={[x,6.8,26.55]}><boxGeometry args={[0.42,13.5,0.35]}/><meshStandardMaterial color="#4a3429" roughness={0.88}/></mesh>)}
    </group>
    <mesh position={[-17,7.2,4.5]}><boxGeometry args={[0.65,14.4,45]}/><meshStandardMaterial color="#2b201d" roughness={0.96}/></mesh>
    <mesh position={[17,7.2,4.5]}><boxGeometry args={[0.65,14.4,45]}/><meshStandardMaterial color="#2b201d" roughness={0.96}/></mesh>
    <mesh position={[0,14.2,4.5]}><boxGeometry args={[34,0.5,45]}/><meshStandardMaterial color="#120e0e" roughness={1}/></mesh>
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

function EnemyModel({ kind, headless=false, dissolve=0 }: {kind:EnemyKind; headless?:boolean; dissolve?:number}) {
  const brute=kind==="brute", crawler=kind==="crawler";
  const flesh=brute?"#75513d":kind==="spitter"?"#a05c43":"#873b36";
  return <group>
    <mesh position={[0,crawler?0.62:0.92,0]} scale={[brute?0.62:crawler?0.55:0.46,crawler?0.36:0.62,0.36]} castShadow><sphereGeometry args={[1,24,18]}/><meshStandardMaterial color={flesh} roughness={0.68} transparent={dissolve>0} opacity={1-dissolve}/></mesh>
    {!headless ? (
      <group position={[0,crawler?1.05:1.65,0.04]}>
        <EnemyHeadMesh kind={kind}/>
      </group>
    ) : (
      <mesh position={[0,crawler?0.95:1.48,0]} scale={[0.22,0.14,0.22]}>
        <cylinderGeometry args={[0.75,1,0.7,12]}/>
        <meshStandardMaterial color="#6e0c18" roughness={0.32}/>
      </mesh>
    )}
    {[-1,1].map(side=><group key={side}>
      <mesh position={[side*(brute?0.58:0.47),crawler?0.56:0.9,0]} rotation={[0,0,side*0.55]}><capsuleGeometry args={[brute?0.19:0.13,0.55,6,12]}/><meshStandardMaterial color={flesh} transparent={dissolve>0} opacity={1-dissolve}/></mesh>
      <mesh position={[side*0.24,crawler?0.22:0.36,-0.06]} rotation={[0,0,side*0.25]}><capsuleGeometry args={[0.14,0.45,6,12]}/><meshStandardMaterial color={flesh} transparent={dissolve>0} opacity={1-dissolve}/></mesh>
    </group>)}
    {/* Wet organic slime deposits: layered translucent films, raised blisters and gravity-formed drips */}
    <group>
      {[
        [-0.31,1.17,0.285,0.16,0.085,0.035],
        [0.24,0.86,0.325,0.19,0.07,0.028],
        [-0.08,0.48,0.31,0.12,0.055,0.026],
        [0.39,1.24,0.19,0.09,0.13,0.035],
        [-0.43,0.72,0.16,0.08,0.15,0.03],
        [0.02,1.48,0.24,0.13,0.045,0.022]
      ].map((p,i)=><mesh key={i} position={[p[0],p[1],p[2]]} scale={[p[3],p[4],p[5]]} castShadow>
        <sphereGeometry args={[1,28,20]}/>
        <meshPhysicalMaterial color={i%3===0?"#8f9b42":i%3===1?"#596d2b":"#a2a45a"} roughness={0.075} metalness={0.015} clearcoat={1} clearcoatRoughness={0.025} transmission={0.12} thickness={0.8} ior={1.34} transparent opacity={0.92*(1-dissolve)}/>
      </mesh>)}
      {[
        [-0.31,1.03,0.29,0.035,0.17],
        [0.25,0.69,0.33,0.026,0.14],
        [0.39,1.06,0.2,0.025,0.2],
        [-0.43,0.54,0.17,0.022,0.13],
        [0.04,1.42,0.25,0.018,0.12]
      ].map((p,i)=><mesh key={"drip"+i} position={[p[0],p[1],p[2]]} scale={[p[3],p[4],p[3]*0.9]}>
        <capsuleGeometry args={[0.5,0.6,8,12]}/>
        <meshPhysicalMaterial color={i%2?"#697b30":"#a2a45a"} roughness={0.055} clearcoat={1} clearcoatRoughness={0.02} transmission={0.16} thickness={1.1} ior={1.34} transparent opacity={0.94*(1-dissolve)}/>
      </mesh>)}
    </group>
    {brute&&Array.from({length:5},(_,i)=><mesh key={i} position={[-0.36+i*0.18,1.62,-0.1]} rotation={[0,0,-0.25]}><coneGeometry args={[0.12,0.48,7]}/><meshStandardMaterial color="#49332d"/></mesh>)}
    {kind==="spitter"&&<mesh position={[0.28,1.05,0.1]} scale={[0.28,0.45,0.27]}><sphereGeometry args={[1,20,16]}/><meshPhysicalMaterial color="#b46b4c" roughness={0.19} clearcoat={0.85} clearcoatRoughness={0.08}/></mesh>}
    {crawler&&Array.from({length:4},(_,i)=><mesh key={i} position={[-0.26+i*0.17,0.7,-0.25]} scale={[0.18,0.055,0.1]}><sphereGeometry args={[1,12,8]}/><meshStandardMaterial color="#4a171a"/></mesh>)}
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

function World({onScore,onKill,paused,onStageChange,controls}:WorldProps) {
  const { camera, size } = useThree();
  const player=useRef<THREE.Group>(null);
  const enemyGroups=useRef<Record<number, THREE.Group|null>>({});
  const headGroups=useRef<Record<number, THREE.Group|null>>({});
  const effectGroups=useRef<Record<number, THREE.Group|null>>({});
  const severedHeads=useRef<SeveredHead[]>([]);
  const bloodPools=useRef<BloodPool[]>([]);
  const effects=useRef<CombatEffect[]>([]);
  const nextEffectId=useRef(1);
  const nextEnemyId=useRef(100);
  const triggeredWaves=useRef(new Set<number>());
  const enemies=useRef<EnemyState[]>(initialEnemies.map(e=>({...e})));
  const pickups=useRef<PickupState[]>(initialPickups.map(p=>({...p})));
  const motion=useRef<RickMotion>({moving:false,attackTime:0,attackStyle:null,attackProgress:0,grabTime:0,jumpHeight:0,weapon:null});
  const pipeCombo=useRef<PipeCombo|null>(null);
  const [phase,setPhase]=useState<1|2>(1);
  const [equipped,setEquipped]=useState<WeaponId|null>(null);
  const [ammo,setAmmo]=useState(16);
  const facing=useRef(1);
  const upperDeckAccess=useRef(false);
  const attackCooldown=useRef(0),grabCooldown=useRef(0),jumpVelocity=useRef(0),grounded=useRef(true);
  const [,setEnemyVersion]=useState(0);
  const lastActions=useRef({attack:false,grab:false,jump:false,pickup:false});
  const keys=useRef(new Set<string>());

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

  const nearest=(range:number, zRange=2.0)=>{
    let result:EnemyState|null=null;
    let best=range;
    const px=player.current?.position.x??0;
    const pz=player.current?.position.z??0;
    for(const e of enemies.current){
      if(!e.alive)continue;
      if(Math.abs(e.z-pz)>zRange)continue;
      const d=Math.hypot(e.x-px,e.z-pz);
      if(d<best){best=d;result=e;}
    }
    return result;
  };

  const doPickup=()=>{
    if(!player.current)return;
    const next=pickups.current.find(p=>!p.collected);
    const candidates=next?[next]:[];
    let best:PickupState|undefined;
    let distance=1.75;
    for(const p of candidates){
      const d=Math.hypot(p.x-player.current.position.x,p.z-player.current.position.z);
      if(d<distance){best=p;distance=d;}
    }
    if(best){
      best.collected=true;
      motion.current.weapon=best.id;
      setEquipped(best.id);
    }
  };

  const applyPipeImpact=(style:PipeAttackStyle)=>{
    if(!player.current)return;
    const e=nearest(2.8,1.8);
    if(!e)return;
    const px=player.current.position.x;
    if((e.x-px)*facing.current < -0.4)return;

    e.alive=false;
    e.grabTimer=0;
    e.fall=facing.current;
    e.vx=0;e.vy=0;e.vz=0;
    if(style==="bat"){
      // Baseball-bat arc: launch the creature backward into the fleshy wall or a foreground tree.
      e.bodyState="wallFlying";
      e.targetZ=targetWallZ(e.x);
      e.vx=facing.current*2.8;
      e.vy=5.8;
      e.vz=-17.5;
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
    attackCooldown.current=equipped==="shotgun"?0.62:equipped==="machete"?0.48:0.42;
    motion.current.attackTime=equipped==="shotgun"?0.34:equipped==="machete"?0.44:0.36;
    motion.current.attackStyle=null;
    motion.current.attackProgress=0;

    if(equipped==="shotgun"){
      if(ammo<=0)return;
      setAmmo(a=>a-1);
      const e=nearest(9.5, 1.45);
      if(e&&(e.x-px)*facing.current>=-0.35){
        e.alive=false;
        e.headless=true;
        e.bodyState="falling";
        e.knocked=0.65;
        e.fall=facing.current;
        e.vx=facing.current*4.5;
        spawnGore(e.x,1.65,e.z,22,5.5,9);
        addBloodPool(e.x,e.z,1.1);
        onKill();
        onScore(100);
        setEnemyVersion(v=>v+1);
      }
      return;
    }

    const e=nearest(equipped==="machete"?2.35:1.65);
    if(!e)return;

    if(equipped==="machete"){
      if((e.x-px)*facing.current<-0.35)return;
      e.alive=false;
      e.headless=true;
      e.bodyState="falling";
      e.knocked=0.65;
      e.fall=facing.current;
      e.vx=facing.current*2.4;
      severedHeads.current.push({
        id:nextEffectId.current++,
        kind:e.kind,
        x:e.x,
        y:e.kind==="crawler"?1.05:1.65,
        z:e.z,
        vx:facing.current*1.8,
        vy:4.0,
        vz:-15.5,
        rotZ:(Math.random()-0.5)*0.6,
        stuck:false,
        targetZ:targetWallZ(e.x),
      });
      spawnGore(e.x,1.55,e.z,20,5.2);
      addBloodPool(e.x,e.z,1.05);
      onKill();
      onScore(100);
      setEnemyVersion(v=>v+1);
    }else{
      // Unarmed punch — original mechanic preserved + extra blood splatter
      if(Math.sign(e.x-px)!==facing.current)return;
      e.health--;
      e.vx=facing.current*3.2;
      spawnGore(e.x,1.15,e.z,e.health<=0?16:10,4.0);
      if(e.health<=0)kill(e);
    }
  };

  const doGrab=()=>{
    if(grabCooldown.current>0||!player.current)return;
    const e=nearest(1.95,1.65);
    if(!e)return;
    if((e.x-player.current.position.x)*facing.current < -0.25)return;
    grabCooldown.current=1.35;
    motion.current.grabTime=1.35;
    // Hold the enemy in front of Rick before applying the backward throw impulse.
    e.bodyState="grabLift";
    e.alive=false;
    e.grabTimer=0;
    e.fall=-facing.current;
    e.vx=0;e.vy=0;e.vz=0;
    e.x=player.current.position.x+facing.current*0.82;
    e.z=player.current.position.z;
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
        const px=player.current.position.x,pz=player.current.position.z;
        const nextX=THREE.MathUtils.clamp(px+stepX,-15.1,15.1);
        const nextZ=THREE.MathUtils.clamp(pz+stepZ,-17.25,20.4);
        const onStairNow=Math.abs(px)<=2.95&&pz>=-2.45&&pz<=5.35&&player.current.position.y>0.05;
        const onDeckNow=player.current.position.y>2.5&&Math.abs(px)<=12.0&&pz>=-17.25&&pz<=-1.55;
        const entersStairFromFront=pz>4.75&&nextZ<pz&&Math.abs(nextX)<=2.85&&nextZ>=-2.45&&nextZ<=5.35;
        if(entersStairFromFront)upperDeckAccess.current=true;
        // Ground-level access to the stair footprint is allowed only from its front;
        // an already elevated player may descend from the upper landing.
        const blockedByStair=(x:number,z:number)=>Math.abs(x)<3.25&&z>-2.55&&z<5.55&&!onStairNow&&!onDeckNow&&!entersStairFromFront;
        const blockedByFurniture=(x:number,z:number)=>{
          const sofa=((x+10.2)/2.45)**2+((z-1.8)/1.22)**2<1;
          const chairA=Math.hypot(x-8.4,z-4.8)<0.92;
          const chairB=Math.hypot(x+7.8,z+7.1)<0.88;
          return player.current!.position.y<0.55&&(sofa||chairA||chairB);
        };
        const canMove=(x:number,z:number)=>!blockedByStair(x,z)&&!blockedByFurniture(x,z);
        if(canMove(nextX,pz))player.current.position.x=nextX;
        const resolvedX=player.current.position.x;
        if(canMove(resolvedX,nextZ))player.current.position.z=nextZ;
        if(onStairNow||entersStairFromFront)upperDeckAccess.current=true;
        if(player.current.position.y<0.05&&player.current.position.z>5.55)upperDeckAccess.current=false;
        if(player.current.position.x>12.35||player.current.position.x< -12.35||player.current.position.z< -17.3) {
          if(player.current.position.y<0.1)upperDeckAccess.current=false;
        }
      }
      // Keep the horizontal combat-facing state for weapon targeting, but orient
      // the 3D character toward the actual travel direction in the free-roam hall.
      if(Math.abs(dx)>0.05)facing.current=dx>0?1:-1;
      if(phase===1){
        player.current.rotation.y=facing.current>0?-Math.PI/2:Math.PI/2;
      }else{
        // The character model's forward axis is -Z:
        // +Z (toward the camera) = front, -Z = back.
        if(Math.abs(dz)>Math.abs(dx)){
          player.current.rotation.y=dz>0?Math.PI:0;
        }else if(Math.abs(dx)>0.05){
          player.current.rotation.y=dx>0?-Math.PI/2:Math.PI/2;
        }
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
      motion.current.attackStyle=null;
      motion.current.attackProgress=0;
    }
    motion.current.grabTime=Math.max(0,motion.current.grabTime-dt);
    const px=player.current.position.x, pz=player.current.position.z;

    if(phase===1){
      const close=pickups.current.some(p=>!p.collected&&Math.hypot(px-p.x,pz-p.z)<1.4);
      if(close)doPickup();

      const spawnWave = (waveId:number, triggerX:number, list:{x:number;z:number;kind:EnemyKind}[]) => {
        if(px>=triggerX && !triggeredWaves.current.has(waveId)){
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
      spawnWave(6, 51.0, [{x:58.5,z:0.6,kind:"brute"},{x:60.0,z:-0.6,kind:"spitter"}]);
    }

    enemies.current.forEach((e)=>{
      const group=enemyGroups.current[e.id];
      if(e.bodyState==="grabLift"){
        e.grabTimer+=dt;
        const liftProgress=THREE.MathUtils.clamp(e.grabTimer/0.62,0,1);
        const ease=liftProgress*liftProgress*(3-2*liftProgress);
        const pX=player.current!.position.x;
        const pZ=player.current!.position.z;
        e.x=THREE.MathUtils.lerp(pX+facing.current*0.78,pX+facing.current*0.92,ease);
        e.z=THREE.MathUtils.lerp(pZ,pZ-0.08,ease);
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
          e.vx=-facing.current*7.4;
          e.vy=5.1;
          e.vz=(pZ-e.z)*1.2;
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
        e.vx*=Math.max(0,1-dt*4.5);
        const progress=1-e.knocked/0.65;
        if(group){
          group.position.set(e.x,Math.max(0.16,Math.sin(progress*Math.PI)*0.22),e.z);
          group.rotation.z=e.fall*Math.min(1,progress*1.35)*1.5;
        }
        if(e.knocked<=0){
          e.bodyState="fallen";
          e.vx=0;
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
      if(e.knocked>0){
        e.knocked=Math.max(0,e.knocked-dt);e.x+=e.vx*dt;e.z+=e.vz*dt;
        e.vx*=Math.max(0,1-dt*3.8);e.vz*=Math.max(0,1-dt*3.8);
        const progress=1-e.knocked/1.25;
        group.rotation.z=e.fall*Math.min(1,progress*1.8)*1.48;
        group.position.y=Math.max(0.035,Math.sin(progress*Math.PI)*0.16);
        if(e.knocked<=0)kill(e);
      }else{
        group.rotation.z=THREE.MathUtils.damp(group.rotation.z,0,8,dt);
        if(Math.abs(e.vx)>0.08){
          e.x+=e.vx*dt;e.z+=e.vz*dt;e.vx*=Math.max(0,1-dt*2.8);
        }else if(phase===1||phase===2){
          if(!e.activated&&Math.hypot(px-e.x,pz-e.z)<(phase===2?18:11.5))e.activated=true;
          if(e.activated){
            if(Math.abs(px-e.x)>0.85)e.x+=Math.sign(px-e.x)*(phase===2?1.35:1.2)*dt;
            if(phase===2)e.z+=Math.sign(pz-e.z)*Math.min(Math.abs(pz-e.z),1.35*dt);
            else e.z+=Math.sign(pz-e.z)*Math.min(Math.abs(pz-e.z),1.2*dt);
            group.rotation.y=THREE.MathUtils.damp(group.rotation.y,px>=e.x?0.45:-0.45,6,dt);
          }
        }
        group.position.y=e.kind==="crawler"?Math.abs(Math.sin(e.animation))*0.035:Math.sin(e.animation*2)*0.025;
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
      if(group){group.position.set(fx.x,fx.y,fx.z);group.rotation.z+=dt*5;}
    });
    const beforeEffects=effects.current.length;
    effects.current=effects.current.filter(fx=>fx.age<2.8);
    if(effects.current.length!==beforeEffects)setEnemyVersion(v=>v+1);

    if(phase===1){
      player.current.position.x=THREE.MathUtils.clamp(player.current.position.x,-25.5,63.8);
      if(player.current.position.x>=62.5){
        setPhase(2);onStageChange(2);player.current.position.set(0,0,9);
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
      player.current.position.z=THREE.MathUtils.clamp(player.current.position.z,-17.25,20.4);
      // Only the front-facing staircase grants access to the upper-storey deck.
      const stairX=Math.abs(player.current.position.x);
      const stairZ=player.current.position.z;
      const onStair=upperDeckAccess.current&&stairX<=2.95&&stairZ>=-2.45&&stairZ<=5.2;
      const onUpperGallery=upperDeckAccess.current&&stairZ>=-17.25&&stairZ<=-1.55&&stairX<=12.0;
      if(onUpperGallery)player.current.position.y=3.5;
      else if(onStair)player.current.position.y=THREE.MathUtils.clamp((5.2-stairZ)/7.45,0,1)*3.5;
      else player.current.position.y=0;
      if(!onUpperGallery&&!onStair&&player.current.position.y<0.05)upperDeckAccess.current=false;
      const underUpperDeck=player.current.position.y<2.5&&stairX<=12.25&&stairZ>=-17.25&&stairZ<=-2.55;
      player.current.visible=!underUpperDeck;
    }

    const targetX=player.current.position.x;
    const targetZ=player.current.position.z;
    const playerHeight=player.current.position.y;
    if(phase===1){
      camera.position.x=THREE.MathUtils.damp(camera.position.x,targetX,3.8,dt);
      camera.position.z=18;
      camera.position.y=4.6;
      camera.lookAt(camera.position.x,3.2,0);
    }else{
      // Rigid follow offset prevents the room from swaying as Rick changes direction.
      camera.position.set(targetX,8.4+playerHeight,targetZ+6.8);
      camera.up.set(0,1,0);
      camera.lookAt(targetX,1.7+playerHeight,targetZ-2.6);
    }
    if(size.width>0){const aspect=size.width/Math.max(1,size.height);const halfH=phase===1?5.4:7.4;const ortho=camera as THREE.OrthographicCamera;ortho.zoom=1;ortho.left=-halfH*aspect;ortho.right=halfH*aspect;ortho.top=halfH;ortho.bottom=-halfH;ortho.updateProjectionMatrix();}
  });

  return <group>
    <color attach="background" args={["#08070a"]}/>
    <ambientLight intensity={0.78}/>
    <directionalLight position={[-6,12,10]} intensity={1.55} castShadow shadow-mapSize={[2048,2048]}/>
    <pointLight position={[10,5,3]} intensity={0.45} color="#8d3330"/>
    {phase===1?<Exterior/>:<MansionRoom player={player}/>}
    {phase===1&&<group position={[-24,0,0]}><mesh position={[0,0.02,0]} rotation={[-Math.PI/2,0,0]}><ringGeometry args={[0.48,0.56,32]}/><meshBasicMaterial color="#7d342d"/></mesh></group>}
    <group ref={player}><RickTaylorCharacter motion={motion.current} equippedWeapon={equipped}/></group>

    {bloodPools.current.map(pool=>(
      <mesh key={`pool-${pool.id}`} position={[pool.x,0.022,pool.z]} rotation={[-Math.PI/2,0,0]}>
        <circleGeometry args={[pool.radius,18]}/>
        <meshStandardMaterial color="#4e060e" roughness={0.25}/>
      </mesh>
    ))}

    {enemies.current.map((e)=>(e.alive||e.bodyState!=="alive")&&<group key={e.id} ref={node=>{enemyGroups.current[e.id]=node;}} position={[e.x,e.y,e.z]}>
      <EnemyModel kind={e.kind} headless={e.headless} dissolve={e.bodyState==="grabMelting" ? THREE.MathUtils.clamp(e.grabTimer/1.05,0,1) : 0}/>
      {e.bodyState==="wallStuck"&&<mesh position={[0,0.95,-0.25]}><circleGeometry args={[1.05,16]}/><meshStandardMaterial color="#4a0911" roughness={0.35}/></mesh>}
    </group>)}

    {severedHeads.current.map((h)=><group key={`head-${h.id}`} ref={node=>{headGroups.current[h.id]=node;}} position={[h.x,h.y,h.z]}>
      <EnemyHeadMesh kind={h.kind}/>
      {h.stuck&&<mesh position={[0,0,-0.25]}><circleGeometry args={[0.62,14]}/><meshStandardMaterial color="#590811" roughness={0.32}/></mesh>}
    </group>)}

    {effects.current.map((fx)=><group key={fx.id} ref={node=>{effectGroups.current[fx.id]=node;}} position={[fx.x,fx.y,fx.z]}>
      {fx.kind==="skull"?<mesh scale={fx.size}><boxGeometry args={[0.14,0.1,0.12]}/><meshStandardMaterial color="#d4cdbc" roughness={0.65}/></mesh>:<mesh scale={fx.size}><icosahedronGeometry args={[0.11,0]}/><meshStandardMaterial color="#7e0c18" roughness={0.35}/></mesh>}
    </group>)}

    {phase===1&&pickups.current.map((p)=>!p.collected&&<group key={p.id} position={[p.x,0.16,p.z]}>
      <mesh rotation={[-Math.PI/2,0,0]}><torusGeometry args={[0.58,0.035,8,24]}/><meshStandardMaterial color="#db6b42" emissive="#612012"/></mesh>
      <group position={[0,0.18,0]}><WeaponModel id={p.id}/></group>
    </group>)}
    <mesh rotation={[-Math.PI/2,0,0]} position={[23,-0.035,0]} receiveShadow><planeGeometry args={[140,100]}/><shadowMaterial opacity={0.24}/></mesh>
  </group>;
}

export default function GameView({onScore,onKill,paused,onStageChange}:Props) {
  const joystickRef=useRef<HTMLDivElement>(null);
  const joystickInput=useRef({x:0,y:0,pointerId:-1});
  const [knob,setKnob]=useState({x:0,y:0});
  const controls=useRef<WorldControls>({horizontal:0,depth:0,attack:false,grab:false,jump:false,pickup:false});
  const updateJoystick=(event:ReactPointerEvent<HTMLDivElement>)=>{const el=joystickRef.current;if(!el)return;const r=el.getBoundingClientRect();const dx=event.clientX-(r.left+r.width/2),dy=event.clientY-(r.top+r.height/2),radius=r.width*0.34,d=Math.hypot(dx,dy),scale=d>radius?radius/d:1;const x=dx*scale,y=dy*scale;joystickInput.current.x=x/radius;joystickInput.current.y=y/radius;controls.current.horizontal=x/radius;controls.current.depth=y/radius;setKnob({x,y});};
  const releaseJoystick=(event:ReactPointerEvent<HTMLDivElement>)=>{if(joystickInput.current.pointerId!==event.pointerId)return;joystickInput.current={x:0,y:0,pointerId:-1};controls.current.horizontal=0;controls.current.depth=0;setKnob({x:0,y:0});if(joystickRef.current?.hasPointerCapture(event.pointerId))joystickRef.current.releasePointerCapture(event.pointerId);};
  const setAction=(key:"attack"|"grab"|"jump",value:boolean)=>{controls.current[key]=value;};
  const press=(key:"attack"|"grab"|"jump")=>(e:ReactPointerEvent<HTMLButtonElement>)=>{e.preventDefault();setAction(key,true);};
  const release=(key:"attack"|"grab"|"jump")=>(e:ReactPointerEvent<HTMLButtonElement>)=>{e.preventDefault();setAction(key,false);};
  return <div className="game-viewport">
    <Canvas className="game-canvas" shadows dpr={[1,1.7]} orthographic camera={{position:[-24,4.6,18],zoom:1,near:0.1,far:100}}>
      <World onScore={onScore} onKill={onKill} paused={paused} onStageChange={onStageChange} controls={controls}/>
    </Canvas>
    <div className="action-buttons" aria-label="Ações de Rick">
      <button type="button" className="action-button action-punch" aria-label="Soco ou ataque" onPointerDown={press("attack")} onPointerUp={release("attack")} onPointerCancel={release("attack")} onPointerLeave={release("attack")}>SOCO</button>
      <button type="button" className="action-button action-grab" aria-label="Agarrar e arremessar" onPointerDown={press("grab")} onPointerUp={release("grab")} onPointerCancel={release("grab")} onPointerLeave={release("grab")}>AGARRÃO</button>
      <button type="button" className="action-button action-jump" aria-label="Pular" onPointerDown={press("jump")} onPointerUp={release("jump")} onPointerCancel={release("jump")} onPointerLeave={release("jump")}>PULO</button>
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
