import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import RickTaylorCharacter, { type RickMotion } from "./characters/RickTaylorCharacter";
import { RickTaylorCharacter3DHDPlayer } from "./characters/RickTaylorCharacter3DHD";
import { CORRIDOR_COVERS, CORRIDOR_DOORS, MansionCorridor3 } from "./MansionCorridor3";
import { HauntedCemetery, MansionBasement, UndergroundDungeon } from "./AdditionalStages";
import { WebGPURenderer } from "three/webgpu";
import MonsterProceduralCharacter from "./characters/MonsterProceduralCharacter";

export type GraphicsQuality = "auto" | "standard" | "high";

type Props = {
  onScore:(points:number)=>void;
  onKill:()=>void;
  paused:boolean;
  onStageChange:(stage:1|2|3|4|5|6)=>void;
  graphicsQuality:GraphicsQuality;
  initialStage?:1|2|3|4|5|6;
  onPhase3Clear?:()=>void;
};
type WeaponId = "sickle" | "pipe" | "machete" | "shotgun";
type EnemyKind = "crawler" | "brute" | "spitter";
type BodyState = "alive" | "wallFlying" | "wallStuck" | "falling" | "fallen" | "macheteFalling" | "macheteMelting" | "grabLift" | "grabThrown" | "grabFallen" | "grabMelting" | "grabInvertLift" | "grabInvertSlam" | "grabInvertFallen" | "pipeSlam" | "gone";
type EnemyState = {
  id:number; x:number; y:number; z:number; health:number; alive:boolean; kind:EnemyKind;
  knocked:number; vx:number; vy:number; vz:number; fall:number; animation:number;
  activated:boolean; bodyState:BodyState; stickRot:number; targetZ:number; headless:boolean; severedArm:boolean; grabTimer:number; spitCooldown:number; boss:boolean;
};
type SpitProjectile = {id:number;x:number;y:number;z:number;vx:number;vy:number;vz:number;age:number};
type SpitSplash = {id:number;x:number;z:number;age:number};
type SeveredHead = {
  id:number; kind:EnemyKind; x:number; y:number; z:number;
  vx:number; vy:number; vz:number; rotZ:number; stuck:boolean; targetZ:number;
};
type BloodPool = { id:number; x:number; z:number; radius:number };
type PickupState = { id:WeaponId; x:number; z:number; collected:boolean };
type ThrowableKind = "crate"|"stone"|"bone"|"head"|"arm";
type ThrowableItem = {id:number;kind:ThrowableKind;x:number;y:number;z:number;vx:number;vy:number;vz:number;rotation:number;held:boolean;thrown:boolean;age:number};
type CombatEffect = {
  id:number; kind:"gore"|"skull"|"arm"|"spark"; x:number; y:number; z:number;
  vx:number; vy:number; vz:number; size:number; age:number;
};
type BulletTracer = {
  id:number; x0:number; y0:number; z0:number; x1:number; y1:number; z1:number; age:number;
};
type TpsHudState = {
  ammo:number; maxAmmo:number; reloading:boolean; ads:boolean; hitMarker:"none"|"body"|"head";
};

const makeEnemy = (id:number, x:number, z:number, kind:EnemyKind, animation:number, activated=false): EnemyState => ({
  id, x, y:0, z, health:kind==="crawler"?1:2, alive:true, kind, knocked:0,
  vx:0, vy:0, vz:0, fall:0, animation, activated, bodyState:"alive", stickRot:0, targetZ:-1.72, headless:false, severedArm:false, grabTimer:0, spitCooldown:1.1+Math.random()*1.4, boss:false
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
  horizontal:number; depth:number; attack:boolean; grab:boolean; jump:boolean; pickup:boolean; slide:boolean; sweep:boolean; superJump:boolean; escorrao:boolean; headKick:boolean;
};
type TpsAimInput = { yawDelta:number; pitchDelta:number; ads:boolean; reload:boolean };
type WorldProps = Omit<Props, "graphicsQuality"> & {
  controls:React.MutableRefObject<WorldControls>;
  useHDCharacter:boolean;
  zoomTargetRef:React.MutableRefObject<number>;
  tpsAimRef:React.MutableRefObject<TpsAimInput>;
  onTpsHudUpdate:(hud:TpsHudState)=>void;
  onRickVisible:()=>void;
  onStageLoading:()=>void;
  spendEnergy:(amount:number)=>boolean;
};
type PipeAttackStyle = "bat" | "overhead";
type PipeCombo = { steps:PipeAttackStyle[]; elapsed:number; stepIndex:number; hit:boolean };
const PIPE_STRIKE_DURATION = 0.72;
const TPS_MAG_SIZE = 8;

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
    {/* Urubu carniceiro pousado no topo do muro da Fase 1. */}
    <group position={[-12.8,5.18,-2.18]} rotation={[0,-0.22,0]}>
      {/* Corpo e peito escuro */}
      <mesh position={[0,0.05,0]} rotation={[0,0,-0.12]} scale={[0.62,0.42,0.34]} castShadow>
        <sphereGeometry args={[1,20,14]}/>
        <meshStandardMaterial color="#171719" roughness={0.94}/>
      </mesh>
      <mesh position={[0.12,0.28,0.015]} scale={[0.43,0.29,0.31]} castShadow>
        <sphereGeometry args={[1,18,12]}/>
        <meshStandardMaterial color="#29272a" roughness={0.98}/>
      </mesh>
      {/* Pescoço nu e cabeça avermelhada */}
      <mesh position={[0.43,0.42,0]} rotation={[0,0,-0.52]} castShadow>
        <capsuleGeometry args={[0.105,0.42,6,10]}/>
        <meshStandardMaterial color="#6e2924" roughness={0.8}/>
      </mesh>
      <mesh position={[0.62,0.66,0.015]} scale={[0.19,0.22,0.17]} castShadow>
        <sphereGeometry args={[1,16,12]}/>
        <meshStandardMaterial color="#8d3930" roughness={0.76}/>
      </mesh>
      <mesh position={[0.78,0.58,0.02]} rotation={[0,0,-0.35]} castShadow>
        <coneGeometry args={[0.095,0.28,7]}/>
        <meshStandardMaterial color="#b58a43" roughness={0.58}/>
      </mesh>
      <mesh position={[0.67,0.7,0.16]}><sphereGeometry args={[0.025,8,8]}/><meshBasicMaterial color="#e3c66d"/></mesh>
      {/* Asas dobradas com penas recortadas */}
      <mesh position={[-0.08,0.22,0.28]} rotation={[0.18,0.08,-0.08]} scale={[0.48,0.12,0.24]} castShadow>
        <sphereGeometry args={[1,16,10]}/>
        <meshStandardMaterial color="#111114" roughness={1}/>
      </mesh>
      <mesh position={[-0.08,0.2,-0.28]} rotation={[-0.18,-0.08,-0.08]} scale={[0.48,0.12,0.24]} castShadow>
        <sphereGeometry args={[1,16,10]}/>
        <meshStandardMaterial color="#111114" roughness={1}/>
      </mesh>
      {[-1,0,1].map((v)=><mesh key={v} position={[-0.35+v*0.12,0.13,0.31]} rotation={[0.12,0,-0.3+v*0.13]} scale={[0.13,0.055,0.2]}><capsuleGeometry args={[0.09,0.42,4,8]}/><meshStandardMaterial color="#252329" roughness={1}/></mesh>)}
      {/* Pernas agarradas à borda */}
      {[-0.2,0.18].map((x)=><group key={x} position={[x,-0.28,0.04]}>
        <mesh position={[0,-0.12,0]}><cylinderGeometry args={[0.035,0.025,0.28,7]}/><meshStandardMaterial color="#8b5c36"/></mesh>
        {[-1,0,1].map((z)=><mesh key={z} position={[0.045,-0.25,z*0.07]} rotation={[0,0,-0.5]}><coneGeometry args={[0.035,0.18,6]}/><meshStandardMaterial color="#a47a45"/></mesh>)}
      </group>)}
    </group>
    {/* Planta retorcida e ressequida crescendo por cima da muralha. */}
    <group position={[-8.2,5.05,-1.62]}>
      <mesh position={[0,0.68,0]} rotation={[0,0,-0.16]}><cylinderGeometry args={[0.035,0.09,1.45,7]}/><meshStandardMaterial color="#30251a" roughness={1}/></mesh>
      <mesh position={[-0.24,1.25,0.02]} rotation={[0,0,0.58]}><cylinderGeometry args={[0.025,0.045,0.92,6]}/><meshStandardMaterial color="#40301e" roughness={1}/></mesh>
      <mesh position={[0.27,1.48,-0.02]} rotation={[0,0,-0.82]}><cylinderGeometry args={[0.02,0.04,1.05,6]}/><meshStandardMaterial color="#3b2b1d" roughness={1}/></mesh>
      <mesh position={[-0.46,1.67,0.02]} rotation={[0,0,0.9]}><cylinderGeometry args={[0.012,0.03,0.62,6]}/><meshStandardMaterial color="#4a3520" roughness={1}/></mesh>
      <mesh position={[0.58,1.92,-0.03]} rotation={[0,0,-0.55]}><cylinderGeometry args={[0.012,0.025,0.68,6]}/><meshStandardMaterial color="#49341f" roughness={1}/></mesh>
      <mesh position={[-0.56,1.98,0.02]} rotation={[0,0,0.65]}><coneGeometry args={[0.12,0.42,5]}/><meshStandardMaterial color="#34351d" roughness={1}/></mesh>
      <mesh position={[0.77,2.22,-0.02]} rotation={[0,0,-0.8]}><coneGeometry args={[0.11,0.38,5]}/><meshStandardMaterial color="#3b3a20" roughness={1}/></mesh>
      <mesh position={[0.04,2.05,0.02]} rotation={[0,0,0.35]}><coneGeometry args={[0.1,0.34,5]}/><meshStandardMaterial color="#34351d" roughness={1}/></mesh>
      {[-0.34,0.34].map((x)=><mesh key={x} position={[x,0.14,0.02]} rotation={[0,0,x*1.8]}><capsuleGeometry args={[0.045,0.72,5,7]}/><meshStandardMaterial color="#4a3b23" roughness={1}/></mesh>)}
    </group>
    {/* Único monstro grudado no início do muro da Fase 1: crawler sem uma perna e com cabeça quebrada */}
    <group position={[-22.0,1.38,-1.52]} rotation={[0.08,0.06,-0.26]} scale={[1.08,1.02,0.42]}>
      <MonsterProceduralCharacter kind="crawler" missingLeg brokenHead pinned moving={false} attackPulse={0}/>
      <mesh position={[0,0.65,-0.18]}><circleGeometry args={[0.92,18]}/><meshStandardMaterial color="#4a0911" roughness={0.32}/></mesh>
      <mesh position={[-0.22,0.68,0.14]} rotation={[0,0,0.42]} scale={[0.14,0.42,0.18]}><capsuleGeometry args={[0.16,0.45,5,8]}/><meshStandardMaterial color="#3e4d20" roughness={0.28}/></mesh>
      <mesh position={[0.24,0.52,0.14]} rotation={[0,0,-0.48]} scale={[0.13,0.38,0.18]}><capsuleGeometry args={[0.15,0.42,5,8]}/><meshStandardMaterial color="#283819" roughness={0.3}/></mesh>
    </group>
    <mesh position={[-22.0,0.024,-1.35]} rotation={[-Math.PI/2,0,0]}>
      <circleGeometry args={[0.68,16]}/>
      <meshStandardMaterial color="#4e060e" roughness={0.24}/>
    </mesh>
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
    {/* Framed painting, antique clock, and glowing Upper Corridor Doorway (Phase 3 entry) */}
    <group position={[0,3.5,-17.52]}>
      <mesh position={[0,1.75,0]}><boxGeometry args={[3.35,3.5,0.28]}/><meshStandardMaterial color="#170f0c" roughness={0.85}/></mesh>
      <mesh position={[0,1.65,0.06]}><boxGeometry args={[2.55,3.15,0.16]}/><meshStandardMaterial color="#8f2912" emissive="#6d1c0a" emissiveIntensity={1.1}/></mesh>
      <mesh position={[-1.08,1.6,0.18]} rotation={[0,0.42,0]}><boxGeometry args={[0.92,3.1,0.12]}/><meshStandardMaterial color="#2b1612" roughness={0.8}/></mesh>
      <mesh position={[1.08,1.6,0.18]} rotation={[0,-0.42,0]}><boxGeometry args={[0.92,3.1,0.12]}/><meshStandardMaterial color="#2b1612" roughness={0.8}/></mesh>
      <mesh rotation={[-Math.PI/2,0,0]} position={[0,0.03,0.85]}><ringGeometry args={[0.55,0.72,24]}/><meshBasicMaterial color="#c95b2b"/></mesh>
    </group>
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

function World({onScore,onKill,paused,onStageChange,initialStage=1,onPhase3Clear,controls,useHDCharacter,zoomTargetRef,tpsAimRef,onTpsHudUpdate,onRickVisible,onStageLoading,spendEnergy}:WorldProps) {
  const { camera, set, size } = useThree();
  const orthoCamRef=useRef<THREE.OrthographicCamera|null>(null);
  const perspCamRef=useMemo(()=>new THREE.PerspectiveCamera(56,16/9,0.1,140),[]);
  const player=useRef<THREE.Group>(null);
  const hdZoomCurrent=useRef(1);
  const enemyGroups=useRef<Record<number, THREE.Group|null>>({});
  const throwableGroups=useRef<Record<number,THREE.Group|null>>({});
  const headGroups=useRef<Record<number, THREE.Group|null>>({});
  const effectGroups=useRef<Record<number, THREE.Group|null>>({});
  const tracerGroups=useRef<Record<number, THREE.Mesh|null>>({});
  const severedHeads=useRef<SeveredHead[]>([]);
  const bloodPools=useRef<BloodPool[]>([]);
  const effects=useRef<CombatEffect[]>([]);
  const tracers=useRef<BulletTracer[]>([]);
  const spitProjectiles=useRef<SpitProjectile[]>([]);
  const spitSplashes=useRef<SpitSplash[]>([]);
  const spitGroups=useRef<Record<number,THREE.Group|null>>({});
  const splashGroups=useRef<Record<number,THREE.Group|null>>({});
  const spitHitCooldown=useRef(0);
  const nextEffectId=useRef(1);
  const nextEnemyId=useRef(100);
  const triggeredWaves=useRef(new Set<number>());
  const triggeredCorridorWaves=useRef(new Set<number>());
  const openedCorridorDoors=useRef(new Set<number>());
  const phase3ClearedSent=useRef(false);
  const phase3SpawnDelay=useRef(2.2);
  const phase3InitialWaveSpawned=useRef(false);
  const rickVisibleSent=useRef(false);
  const rickReadyFrames=useRef(0);
  const enemies=useRef<EnemyState[]>(initialStage===1?initialEnemies.map(e=>({...e})):[]);
  const pickups=useRef<PickupState[]>(initialPickups.map(p=>({...p})));
  const throwableItems=useRef<ThrowableItem[]>([]);
  const droppedEnemyParts=useRef(new Set<number>());
  const heldThrowable=useRef<number|null>(null);
  const [heldThrowableKind,setHeldThrowableKind]=useState<ThrowableKind|null>(null);
  const motion=useRef<RickMotion>({moving:false,attackTime:0,attackStyle:null,attackProgress:0,grabTime:0,jumpHeight:0,weapon:null,slideTime:0,specialMove:null,superJumpTuck:false,grabStyle:null});
  const pipeCombo=useRef<PipeCombo|null>(null);
  const pendingShotgun=useRef<{timer:number;targetId:number|null}|null>(null);
  const macheteAttackVariant=useRef<"head"|"arm">("head");
  const grabVariant=useRef<"throw"|"piledriver">("throw");
  const [phase,setPhase]=useState<1|2|3|4|5|6>(initialStage);
  const [initialEnemiesVisible,setInitialEnemiesVisible]=useState(false);
  const [equipped,setEquipped]=useState<WeaponId|null>(initialStage===1?"sickle":null);
  const facing=useRef(1);
  const attackDirection=useRef({x:1,z:0});
  const upperDeckAccess=useRef(false);
  const basementKeyCollected=useRef(false);
  const destroyedGraves=useRef(new Set<number>());
  const attackCooldown=useRef(0),grabCooldown=useRef(0),slideCooldown=useRef(0),jumpVelocity=useRef(0),grounded=useRef(true);const specialJumpActive=useRef(false),specialJumpVel=useRef({x:0,z:0}),specialJumpCooldown=useRef(0),escorraoCooldown=useRef(0),escorraoVel=useRef({x:0,z:0}),escorraoHitIds=useRef(new Set<number>());
  const [,setEnemyVersion]=useState(0);
  const lastActions=useRef({attack:false,grab:false,jump:false,pickup:false,slide:false,sweep:false,superJump:false,escorrao:false,headKick:false});
  const keys=useRef(new Set<string>());

  // Phase 3 Uncharted TPS states
  const tpsYaw=useRef(0);
  const tpsPitch=useRef(-0.02);
  const tpsRecoil=useRef(0);
  const tpsAmmo=useRef(TPS_MAG_SIZE);
  const tpsReloadTimer=useRef(0);
  const hitMarkerTimer=useRef(0);
  const hitMarkerKind=useRef<"none"|"body"|"head">("none");
  const lastTpsHud=useRef<TpsHudState>({ammo:TPS_MAG_SIZE,maxAmmo:TPS_MAG_SIZE,reloading:false,ads:false,hitMarker:"none"});

  useEffect(()=>{
    if((camera as THREE.OrthographicCamera).isOrthographicCamera){
      orthoCamRef.current=camera as THREE.OrthographicCamera;
    }
  },[camera]);

  const placeThrowableProps=(positions:Array<{kind:ThrowableKind;x:number;z:number}>)=>{
    throwableItems.current=positions.map((p)=>({id:nextEffectId.current++,kind:p.kind,x:p.x,y:0.32,z:p.z,vx:0,vy:0,vz:0,rotation:Math.random()*Math.PI,held:false,thrown:false,age:0}));
    heldThrowable.current=null;setHeldThrowableKind(null);droppedEnemyParts.current.clear();
  };

  const enterPhase2=(resetCameraImmediate=false)=>{
    if(!player.current)return;
    rickVisibleSent.current=false;
    rickReadyFrames.current=0;
    onStageLoading();
    setPhase(2);onStageChange(2);
    player.current.position.set(0,0,9);
    player.current.rotation.set(0,0,0);
    player.current.visible=true;
    attackDirection.current={x:0,z:-1};
    upperDeckAccess.current=false;
    pendingShotgun.current=null;
    pipeCombo.current=null;
    spitHitCooldown.current=0;
    jumpVelocity.current=0;
    grounded.current=true;
    specialJumpActive.current=false;
    specialJumpVel.current={x:0,z:0};
    escorraoVel.current={x:0,z:0};
    escorraoHitIds.current.clear();
    motion.current.jumpHeight=0;
    motion.current.superJumpTuck=false;
    motion.current.grabStyle=null;
    spitProjectiles.current=[];
    spitSplashes.current=[];
    effects.current=[];
    tracers.current=[];
    enemies.current=[];
    placeThrowableProps([{kind:"crate",x:-11,z:3},{kind:"stone",x:10,z:4},{kind:"bone",x:-7,z:-8},{kind:"crate",x:8,z:-11}]);
    const hallWave=[
      [-13.2,-12.8,"crawler"],[13.0,-12.2,"spitter"],[-14.0,5.0,"brute"],
      [14.0,8.0,"crawler"],[-5.5,15.0,"spitter"],[7.0,15.2,"brute"]
    ] as const;
    hallWave.forEach((spawn,idx)=>enemies.current.push(makeEnemy(nextEnemyId.current++,spawn[0],spawn[1],spawn[2],idx*1.4,true)));
    severedHeads.current=[];
    bloodPools.current=[];
    if(resetCameraImmediate&&orthoCamRef.current){
      orthoCamRef.current.position.set(0,8.4,15.8);
      orthoCamRef.current.lookAt(0,1.7,6.4);
    }
    setEnemyVersion(v=>v+1);
  };

  const enterPhase3=()=>{
    if(!player.current)return;
    rickVisibleSent.current=false;
    rickReadyFrames.current=0;
    onStageLoading();
    setPhase(3);onStageChange(3);
    phase3ClearedSent.current=false;
    phase3SpawnDelay.current=2.2;
    phase3InitialWaveSpawned.current=false;
    player.current.position.set(0,0,26.0);
    player.current.rotation.set(0,0,0);
    player.current.visible=true;
    tpsYaw.current=0;
    tpsPitch.current=-0.02;
    tpsRecoil.current=0;
    tpsAmmo.current=TPS_MAG_SIZE;
    tpsReloadTimer.current=0;
    hitMarkerTimer.current=0;
    hitMarkerKind.current="none";
    attackDirection.current={x:0,z:-1};
    upperDeckAccess.current=false;
    pendingShotgun.current=null;
    pipeCombo.current=null;
    spitHitCooldown.current=0;
    jumpVelocity.current=0;
    grounded.current=true;
    specialJumpActive.current=false;
    specialJumpVel.current={x:0,z:0};
    escorraoVel.current={x:0,z:0};
    escorraoHitIds.current.clear();
    motion.current.jumpHeight=0;
    motion.current.superJumpTuck=false;
    motion.current.grabStyle=null;
    motion.current.weapon="shotgun";
    setEquipped("shotgun");
    spitProjectiles.current=[];
    spitSplashes.current=[];
    effects.current=[];
    tracers.current=[];
    severedHeads.current=[];
    bloodPools.current=[];
    openedCorridorDoors.current.clear();
    triggeredCorridorWaves.current.clear();
    enemies.current=[];
    placeThrowableProps([{kind:"crate",x:-1.8,z:20},{kind:"stone",x:1.8,z:12},{kind:"bone",x:-1.5,z:-9},{kind:"crate",x:1.6,z:-27}]);
    perspCamRef.position.set(0.72,1.88,29.1);
    perspCamRef.lookAt(0.35,1.45,10.0);
    setEnemyVersion(v=>v+1);
  };

  const enterPhase4=()=>{
    if(!player.current)return;onStageLoading();setPhase(4);onStageChange(4);phase3ClearedSent.current=false;basementKeyCollected.current=false;
    player.current.position.set(0,0,17);player.current.rotation.set(0,0,0);player.current.visible=true;
    attackDirection.current={x:0,z:-1};upperDeckAccess.current=false;
    enemies.current=[];severedHeads.current=[];bloodPools.current=[];effects.current=[];tracers.current=[];
    placeThrowableProps([{kind:"stone",x:-3,z:13},{kind:"crate",x:3,z:6},{kind:"bone",x:-3,z:-3},{kind:"stone",x:3,z:-12}]);
    const wave:[number,number,EnemyKind][]=[[-4,-7,"crawler"],[4,-10,"spitter"],[-3,-15,"brute"],[0,-17,"brute"]];
    wave.forEach((p,i)=>{const enemy=makeEnemy(nextEnemyId.current++,p[0],p[1],p[2],i*1.2,true);if(i===3){enemy.boss=true;enemy.health=12;}enemies.current.push(enemy);});setEnemyVersion(v=>v+1);
  };
  const enterPhase5=()=>{
    if(!player.current)return;onStageLoading();setPhase(5);onStageChange(5);
    player.current.position.set(-30,0,0);player.current.rotation.set(0,0,0);player.current.visible=true;
    attackDirection.current={x:1,z:0};facing.current=1;
    enemies.current=[];severedHeads.current=[];bloodPools.current=[];effects.current=[];tracers.current=[];
    placeThrowableProps([{kind:"bone",x:-23,z:0.4},{kind:"stone",x:-8,z:-0.45},{kind:"crate",x:7,z:0.45},{kind:"bone",x:27,z:-0.4},{kind:"stone",x:48,z:0.35}]);
    const wave:[number,EnemyKind][]=[[-15,"crawler"],[-4,"brute"],[10,"spitter"],[24,"crawler"],[39,"brute"]];
    wave.forEach((p,i)=>enemies.current.push(makeEnemy(nextEnemyId.current++,p[0],0,p[1],i*1.1,true)));
    camera.position.set(-30,4.6,18);camera.lookAt(-30,3.2,0);setEnemyVersion(v=>v+1);
  };
  const enterPhase6=()=>{
    if(!player.current)return;onStageLoading();setPhase(6);onStageChange(6);phase3ClearedSent.current=false;destroyedGraves.current.clear();
    player.current.position.set(-30,0,0);player.current.rotation.set(0,0,0);player.current.visible=true;
    attackDirection.current={x:1,z:0};facing.current=1;
    enemies.current=[];severedHeads.current=[];bloodPools.current=[];effects.current=[];tracers.current=[];
    placeThrowableProps([{kind:"stone",x:-23,z:0.45},{kind:"bone",x:-9,z:-0.4},{kind:"stone",x:7,z:0.4},{kind:"crate",x:25,z:-0.4},{kind:"bone",x:45,z:0.45}]);
    const wave:[number,EnemyKind][]=[[-16,"crawler"],[-5,"spitter"],[9,"brute"],[23,"crawler"],[38,"brute"],[54,"spitter"]];
    wave.forEach((p,i)=>{const enemy=makeEnemy(nextEnemyId.current++,p[0],0,p[1],i*1.3,true);enemy.y=-1.25;if(i===5){enemy.boss=true;enemy.health=16;}enemies.current.push(enemy);});
    camera.position.set(-30,4.6,18);camera.lookAt(-30,3.2,0);setEnemyVersion(v=>v+1);
  };

  useEffect(()=>{
    const spawnTimer=window.setTimeout(()=>setInitialEnemiesVisible(true),2000);
    return ()=>window.clearTimeout(spawnTimer);
  },[]);

  useEffect(()=>{
    if(phase===3){
      set({camera:perspCamRef});
    }else if(orthoCamRef.current&&camera!==orthoCamRef.current){
      set({camera:orthoCamRef.current});
    }
  },[phase,perspCamRef,camera,set]);

  useEffect(()=>{
    rickVisibleSent.current=false;
    rickReadyFrames.current=0;
    onStageLoading();
    if(initialStage===6){enterPhase6();return;}
    if(initialStage===5){enterPhase5();return;}
    if(initialStage===4){enterPhase4();return;}
    if(initialStage===3){
      enterPhase3();
      return;
    }
    if(initialStage===2){
      enterPhase2(true);
      return;
    }
    camera.position.set(-24,4.6,18);
    camera.lookAt(-24,3.2,0);
    if(player.current){
      placeThrowableProps([{kind:"crate",x:-19,z:0.5},{kind:"stone",x:-8,z:-0.4},{kind:"bone",x:8,z:0.4},{kind:"crate",x:25,z:-0.45},{kind:"stone",x:43,z:0.5}]);
      player.current.position.set(-24,0,0);
      player.current.rotation.y=-Math.PI/2;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[initialStage]);

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

  const spawnGore=(x:number,y:number,z:number,count:number,spread=4.2,skullCount=0,style:"sickle"|"pipe"|"machete"|"shotgun"|"generic"="generic")=>{
    const enhancedCount=Math.ceil(count*1.55);
    for(let i=0;i<enhancedCount;i++){
      const angle=(i/count)*Math.PI*2+Math.random()*0.4;
      const styleAngle=style==="sickle"?-Math.PI/2+(Math.random()-0.5)*1.55:style==="pipe"?(i%2===0?0:Math.PI)+(Math.random()-0.5)*0.9:style==="machete"?-Math.PI/2+(Math.random()-0.5)*2.8:style==="shotgun"?Math.random()*Math.PI*2:angle;
      const finalAngle=style==="generic"?angle:styleAngle;
      const spd=style==="sickle"?2.2+Math.random()*spread:style==="pipe"?1.1+Math.random()*spread*0.7:style==="machete"?2.8+Math.random()*spread:style==="shotgun"?3.4+Math.random()*spread*1.35:1.6+Math.random()*spread;
      effects.current.push({
        id:nextEffectId.current++,kind:"gore",x,y,z,
        vx:Math.cos(finalAngle)*spd,vy:(style==="shotgun"?2.8:style==="machete"?2.2:1.6)+Math.random()*(style==="shotgun"?6:4.4),vz:Math.sin(finalAngle)*spd*(style==="pipe"?1.05:0.65),
        size:0.65+Math.random()*1.15,age:0
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

  const spawnSparks=(x:number,y:number,z:number,nx=0,nz=0)=>{
    for(let i=0;i<7;i++){
      effects.current.push({
        id:nextEffectId.current++,kind:"spark",x,y,z,
        vx:nx*2.5+(Math.random()-0.5)*3.2,vy:1.0+Math.random()*2.8,vz:nz*2.5+(Math.random()-0.5)*3.2,
        size:0.55+Math.random()*0.55,age:0
      });
    }
    setEnemyVersion(v=>v+1);
  };

  const firePhase3Shotgun=()=>{
    if(!player.current||tpsReloadTimer.current>0)return;
    if(tpsAmmo.current<=0){
      tpsReloadTimer.current=1.05;
      return;
    }
    tpsAmmo.current-=1;
    if(tpsAmmo.current<=0)tpsReloadTimer.current=1.05;

    attackCooldown.current=0.38;
    motion.current.attackTime=0.36;
    motion.current.attackStyle=null;
    motion.current.attackProgress=0;
    tpsRecoil.current=0.14;
    tpsPitch.current=THREE.MathUtils.clamp(tpsPitch.current+0.022,-0.45,0.42);

    const rayOrigin=perspCamRef.position.clone();
    const rayDir=new THREE.Vector3();
    perspCamRef.getWorldDirection(rayDir).normalize();

    const px=player.current.position.x, pz=player.current.position.z, py=player.current.position.y;
    const fwdX=-Math.sin(tpsYaw.current), fwdZ=-Math.cos(tpsYaw.current);
    const rightX=Math.cos(tpsYaw.current), rightZ=-Math.sin(tpsYaw.current);
    const muzzleX=px+fwdX*0.82+rightX*0.28;
    const muzzleY=py+1.34+Math.sin(tpsPitch.current)*0.4;
    const muzzleZ=pz+fwdZ*0.82+rightZ*0.28;

    const rayHitSphere=(oX:number,oY:number,oZ:number,dX:number,dY:number,dZ:number,cx:number,cy:number,cz:number,radius:number)=>{
      const ocX=oX-cx, ocY=oY-cy, ocZ=oZ-cz;
      const b=ocX*dX+ocY*dY+ocZ*dZ;
      const c=ocX*ocX+ocY*ocY+ocZ*ocZ-radius*radius;
      const disc=b*b-c;
      if(disc<0)return null;
      const sqrtDisc=Math.sqrt(disc);
      const t1=-b-sqrtDisc;
      const t2=-b+sqrtDisc;
      if(t2<=0.05)return null;
      return Math.max(0.15,t1);
    };

    let wallDist=44;
    // Wall / floor / ceiling clip distance
    if(Math.abs(rayDir.x)>1e-4){
      const tWall=((rayDir.x>0?3.25:-3.25)-rayOrigin.x)/rayDir.x;
      if(tWall>0.5&&tWall<wallDist)wallDist=tWall;
    }
    if(Math.abs(rayDir.z)>1e-4){
      const tEnd=((rayDir.z>0?30.1:-38.9)-rayOrigin.z)/rayDir.z;
      if(tEnd>0.5&&tEnd<wallDist)wallDist=tEnd;
    }
    if(Math.abs(rayDir.y)>1e-4){
      const tPlane=((rayDir.y>0?4.55:0.04)-rayOrigin.y)/rayDir.y;
      if(tPlane>0.5&&tPlane<wallDist)wallDist=tPlane;
    }

    let bestDist=wallDist+0.35;
    let bestEnemy:EnemyState|null=null;
    let isHeadshot=false;
    let hitPointOverride:{x:number;y:number;z:number}|null=null;

    const getMonsterHitMetrics=(e:EnemyState)=>{
      const scaleY=e.kind==="brute"?1.28:e.kind==="crawler"?0.56:1.0;
      const scaleX=e.kind==="brute"?1.32:e.kind==="crawler"?0.82:1.0;
      const rootY=0.56*scaleY;
      const headY=e.y+rootY+1.85*scaleY;
      const chestY=e.y+rootY+1.12*scaleY;
      const pelvisY=e.y+rootY+0.45*scaleY;
      return {scaleX,headY,chestY,pelvisY};
    };

    const adsBonus=tpsAimRef.current.ads?0.06:0.12;
    for(const e of enemies.current){
      if(!e.alive)continue;
      const distToRick=Math.hypot(e.x-px,e.z-pz);
      const closeSpread=distToRick<4.5?0.16:0;
      const {scaleX,headY,chestY,pelvisY}=getMonsterHitMetrics(e);
      const tHead=rayHitSphere(rayOrigin.x,rayOrigin.y,rayOrigin.z,rayDir.x,rayDir.y,rayDir.z,e.x,headY,e.z,0.44*scaleX+adsBonus*0.5+closeSpread*0.5);
      if(tHead!==null&&tHead<bestDist){
        bestDist=tHead;
        bestEnemy=e;
        isHeadshot=true;
      }
      const tChest=rayHitSphere(rayOrigin.x,rayOrigin.y,rayOrigin.z,rayDir.x,rayDir.y,rayDir.z,e.x,chestY,e.z,0.62*scaleX+adsBonus+closeSpread);
      if(tChest!==null&&tChest<bestDist){
        bestDist=tChest;
        bestEnemy=e;
        isHeadshot=false;
      }
      const tPelvis=rayHitSphere(rayOrigin.x,rayOrigin.y,rayOrigin.z,rayDir.x,rayDir.y,rayDir.z,e.x,pelvisY,e.z,0.56*scaleX+adsBonus+closeSpread);
      if(tPelvis!==null&&tPelvis<bestDist){
        bestDist=tPelvis;
        bestEnemy=e;
        isHeadshot=false;
      }
    }

    // Over-the-shoulder parallax & point-blank buckshot cone fallback for monsters close to Rick
    if(!bestEnemy){
      const aimLen=Math.min(wallDist,16);
      const aimX=rayOrigin.x+rayDir.x*aimLen;
      const aimY=rayOrigin.y+rayDir.y*aimLen;
      const aimZ=rayOrigin.z+rayDir.z*aimLen;
      const muzDir=new THREE.Vector3(aimX-px,aimY-(py+1.42),aimZ-pz).normalize();
      const fwdDir=new THREE.Vector3(fwdX,Math.sin(tpsPitch.current),fwdZ).normalize();

      let bestMuzzleT=6.5;
      for(const e of enemies.current){
        if(!e.alive)continue;
        const distToRick=Math.hypot(e.x-px,e.z-pz);
        if(distToRick>6.2)continue;
        const {scaleX,headY,chestY,pelvisY}=getMonsterHitMetrics(e);
        const rBody=0.68*scaleX+adsBonus+0.18;
        for(const [cy,rad,head] of [[headY,0.48*scaleX+adsBonus,true],[chestY,rBody,false],[pelvisY,rBody*0.92,false]] as const){
          const tMuz=rayHitSphere(px,py+1.42,pz,muzDir.x,muzDir.y,muzDir.z,e.x,cy,e.z,rad);
          if(tMuz!==null&&tMuz<bestMuzzleT){
            bestMuzzleT=tMuz;
            bestEnemy=e;
            isHeadshot=head;
            hitPointOverride={x:px+muzDir.x*tMuz,y:py+1.42+muzDir.y*tMuz,z:pz+muzDir.z*tMuz};
          }
          const tFwd=rayHitSphere(px,py+1.42,pz,fwdDir.x,fwdDir.y,fwdDir.z,e.x,cy,e.z,rad);
          if(tFwd!==null&&tFwd<bestMuzzleT){
            bestMuzzleT=tFwd;
            bestEnemy=e;
            isHeadshot=head;
            hitPointOverride={x:px+fwdDir.x*tFwd,y:py+1.42+fwdDir.y*tFwd,z:pz+fwdDir.z*tFwd};
          }
        }
      }

      if(!bestEnemy){
        let closestPointBlank=4.2;
        for(const e of enemies.current){
          if(!e.alive)continue;
          const dx=e.x-px, dz=e.z-pz;
          const dist=Math.hypot(dx,dz);
          if(dist>4.2)continue;
          const dot=dist<0.25?1:(dx*fwdX+dz*fwdZ)/dist;
          const inCone=(dist<=2.35&&dot>=0.35)||(dist<=4.2&&dot>=0.78);
          if(inCone&&dist<closestPointBlank){
            closestPointBlank=dist;
            bestEnemy=e;
            isHeadshot=false;
            const {chestY}=getMonsterHitMetrics(e);
            hitPointOverride={x:e.x,y:chestY,z:e.z};
          }
        }
      }
    }

    const finalDist=bestEnemy?Math.min(bestDist,wallDist+0.35):wallDist;
    const hitX=hitPointOverride?hitPointOverride.x:rayOrigin.x+rayDir.x*finalDist;
    const hitY=hitPointOverride?hitPointOverride.y:rayOrigin.y+rayDir.y*finalDist;
    const hitZ=hitPointOverride?hitPointOverride.z:rayOrigin.z+rayDir.z*finalDist;

    tracers.current.push({
      id:nextEffectId.current++,
      x0:muzzleX,y0:muzzleY,z0:muzzleZ,
      x1:hitX,y1:hitY,z1:hitZ,
      age:0
    });

    if(bestEnemy){
      const e=bestEnemy;
      const distToRick=Math.hypot(e.x-px,e.z-pz);
      const {headY}=getMonsterHitMetrics(e);
      if(e.kind==="brute"&&e.health>1){
        e.health-=1;
        e.vx=rayDir.x*3.4;
        e.vz=rayDir.z*3.4;
        e.fall=rayDir.x||rayDir.z||1;
        spawnGore(hitX,hitY,hitZ,14,4.8,0);
        hitMarkerKind.current=isHeadshot?"head":"body";
        hitMarkerTimer.current=0.2;
      }else if(isHeadshot){
        e.alive=false;
        e.headless=true;
        e.bodyState="falling";
        e.knocked=0.65;
        e.fall=rayDir.x||rayDir.z||1;
        e.vx=rayDir.x*4.2;
        e.vz=rayDir.z*4.2;
        spawnGore(e.x,headY,e.z,26,6.2,10);
        addBloodPool(e.x,e.z,1.15);
        onKill();
        onScore(150);
        hitMarkerKind.current="head";
        hitMarkerTimer.current=0.24;
      }else{
        const dmg=e.kind==="crawler"?1:distToRick<4.8?3:distToRick<8.5?2:1;
        e.health-=dmg;
        e.vx=rayDir.x*3.4;
        e.vz=rayDir.z*3.4;
        e.fall=rayDir.x||rayDir.z||1;
        spawnGore(hitX,hitY,hitZ,e.health<=0?20:11,4.6,0,"shotgun");
        hitMarkerKind.current="body";
        hitMarkerTimer.current=0.18;
        if(e.health<=0){
          e.alive=false;
          e.bodyState="falling";
          e.knocked=0.65;
          addBloodPool(e.x,e.z,1.0);
          onKill();
          onScore(100);
        }
      }
      setEnemyVersion(v=>v+1);
    }else{
      spawnSparks(hitX,hitY,hitZ,-rayDir.x,-rayDir.z);
    }
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
    if(!player.current)return;
    if(heldThrowable.current!==null){
      const item=throwableItems.current.find(v=>v.id===heldThrowable.current);
      if(item){const dir=attackDirection.current;item.held=false;item.thrown=true;item.age=0;item.x=player.current.position.x+dir.x*0.78;item.y=1.25+motion.current.jumpHeight;item.z=player.current.position.z+dir.z*0.78;item.vx=dir.x*10.5;item.vy=4.2;item.vz=dir.z*10.5;}
      heldThrowable.current=null;setHeldThrowableKind(null);setEnemyVersion(v=>v+1);return;
    }
    const nearby=throwableItems.current.filter(v=>!v.held&&!v.thrown).sort((a,b)=>Math.hypot(a.x-player.current!.position.x,a.z-player.current!.position.z)-Math.hypot(b.x-player.current!.position.x,b.z-player.current!.position.z))[0];
    if(nearby&&Math.hypot(nearby.x-player.current.position.x,nearby.z-player.current.position.z)<2.35){nearby.held=true;heldThrowable.current=nearby.id;setHeldThrowableKind(nearby.kind);setEnemyVersion(v=>v+1);return;}
    if(phase===1){const next=pickups.current.find(p=>!p.collected);if(!next)return;if(Math.hypot(next.x-player.current.position.x,next.z-player.current.position.z)>2.65)return;next.collected=true;motion.current.weapon=next.id;setEquipped(next.id);setEnemyVersion(v=>v+1);}
  };

  const applyPipeImpact=(style:PipeAttackStyle)=>{
    if(!player.current)return;
    const e=nearest(2.8,1.8,-0.4);
    if(!e)return;
    if(e.kind==="brute"&&e.health>1){
      e.health-=1;
      e.fall=attackDirection.current.x||attackDirection.current.z||facing.current;
      e.vx=attackDirection.current.x*3.6;
      e.vz=attackDirection.current.z*3.6;
      spawnGore(e.x,1.45,e.z,14,4.5,0,"pipe");
      setEnemyVersion(v=>v+1);
      return;
    }

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
      spawnGore(e.x,1.25,e.z,18,5.4,0,"pipe");
      addBloodPool(e.x,e.z,0.82);
    }else{
      // Overhead pipe strike: the monster is driven down into the ground.
      e.bodyState="pipeSlam";
      e.y=0.38;
      spawnGore(e.x,1.0,e.z,20,4.8,0,"pipe");
      addBloodPool(e.x,e.z,0.95);
    }
    onKill();
    onScore(100);
    setEnemyVersion(v=>v+1);
  };

  const breakNearbyGrave=()=>{
    if(phase!==6||!player.current)return false;
    const px=player.current.position.x,pz=player.current.position.z;
    let best=-1,bestDistance=1.8;
    for(let i=0;i<27;i++){
      if(destroyedGraves.current.has(i))continue;
      const gx=-34+i*3.45,gz=(i%3-1)*1.0;
      const distance=Math.hypot(px-gx,pz-gz);
      if(distance<bestDistance){best=i;bestDistance=distance;}
    }
    if(best<0)return false;
    destroyedGraves.current.add(best);
    const gx=-34+best*3.45,gz=(best%3-1)*1.0;
    spawnSparks(gx,0.65,gz);onScore(25);setEnemyVersion(v=>v+1);
    return true;
  };

  const doAttack=()=>{
    if(attackCooldown.current>0)return;
    if(phase===3&&equipped!=="sickle"){
      firePhase3Shotgun();
      return;
    }
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
    const macheteStyle=equipped==="machete"?macheteAttackVariant.current:equipped==="sickle"?"head":null;
    if(macheteStyle)macheteAttackVariant.current=macheteStyle==="head"?"arm":"head";
    motion.current.attackStyle=macheteStyle==="head"?"macheteHead":macheteStyle==="arm"?"macheteArm":null;
    motion.current.attackProgress=0;

    if(equipped==="shotgun"){
      const pz=player.current?.position.z??0;
      const py=player.current?.position.y??0;
      const target=findShotgunTarget(px,pz);
      if(!target)breakNearbyGrave();
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
    if(!e){breakNearbyGrave();return;}

    if(equipped==="machete"||equipped==="sickle"){
      if(e.kind==="brute"&&e.health>1){
        e.health-=1;
        e.fall=attackDirection.current.x||attackDirection.current.z||facing.current;
        e.vx=attackDirection.current.x*3.2;
        e.vz=attackDirection.current.z*3.2;
        spawnGore(e.x,1.45,e.z,15,4.6,0,equipped==="sickle"?"sickle":"machete");
        setEnemyVersion(v=>v+1);
        return;
      }
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
        spawnGore(e.x,e.kind==="crawler"?1.05:1.65,e.z,22,5.2,0,equipped==="sickle"?"sickle":"machete");
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
        spawnGore(e.x+0.42,e.kind==="crawler"?0.9:1.18,e.z,16,4.8,0,"machete");
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
    const variant=grabVariant.current;
    grabVariant.current=variant==="throw"?"piledriver":"throw";
    const dur=variant==="piledriver"?1.65:1.35;
    grabCooldown.current=dur;
    motion.current.grabTime=dur;
    motion.current.grabStyle=variant;
    // Hold the enemy in front of Rick before throw or piledriver inversion.
    e.bodyState=variant==="piledriver"?"grabInvertLift":"grabLift";
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
  const doSuperJump=()=>{if(!player.current||!grounded.current||specialJumpCooldown.current>0||phase===3||!spendEnergy(34))return;specialJumpActive.current=true;grounded.current=false;specialJumpCooldown.current=0.8;motion.current.specialMove="superJump";motion.current.superJumpTuck=false;jumpVelocity.current=Math.sqrt(2*5.2*3.5);motion.current.jumpHeight=0;const d=attackDirection.current;specialJumpVel.current={x:d.x*1.55,z:d.z*1.55};};
  const doEscorrao=()=>{if(!player.current||escorraoCooldown.current>0||phase===3||!spendEnergy(67))return;escorraoCooldown.current=1.05;motion.current.specialMove="escorrao";motion.current.slideTime=0.72;escorraoHitIds.current.clear();const d=attackDirection.current;escorraoVel.current={x:d.x*8.2,z:d.z*8.2};};
  const doSlide=()=>{
    if(slideCooldown.current>0||!player.current||phase===3)return;
    slideCooldown.current=1.05;motion.current.slideTime=0.58;motion.current.specialMove="slide";
    const dir=attackDirection.current;
    player.current.position.x+=dir.x*3.35;
    player.current.position.z+=dir.z*3.35;
  };
  const doSpecialStrike=(style:"sweep")=>{
    if(attackCooldown.current>0||phase===3)return;
    attackCooldown.current=0.68;motion.current.attackTime=0.58;motion.current.attackStyle=style;motion.current.attackProgress=0;motion.current.specialMove=style;
    const target=nearest(2.15,1.15,-0.1);
    if(!target)return;
    if(target.kind==="brute"&&target.health>1){target.health-=1;target.vx=attackDirection.current.x*4.2;target.vz=attackDirection.current.z*4.2;target.fall=attackDirection.current.x||attackDirection.current.z||facing.current;spawnGore(target.x,0.55,target.z,14,4.5);setEnemyVersion(v=>v+1);return;}
    target.alive=false;target.bodyState="falling";target.fall=attackDirection.current.x||attackDirection.current.z||facing.current;
    target.vx=attackDirection.current.x*3.6;target.vz=attackDirection.current.z*3.6;target.vy=1.2;
    spawnGore(target.x,0.55,target.z,20,5.0);addBloodPool(target.x,target.z,0.85);onKill();onScore(100);setEnemyVersion(v=>v+1);
  };
  const doHeadKick=()=>{
    if(attackCooldown.current>0||phase===3)return;
    attackCooldown.current=0.56;
    motion.current.attackTime=0.52;
    motion.current.attackStyle=null;
    motion.current.attackProgress=0;
    motion.current.specialMove="headKick";
    const target=nearest(2.15,1.35,-0.2);
    if(!target)return;
    const headH=target.kind==="crawler"?1.05:target.kind==="brute"?1.95:1.65;
    if(target.kind==="brute"&&target.health>1){
      target.health-=1;
      target.vx=attackDirection.current.x*4.4;
      target.vz=attackDirection.current.z*4.4;
      target.fall=attackDirection.current.x||attackDirection.current.z||facing.current;
      spawnGore(target.x,headH,target.z,16,5.0);
      setEnemyVersion(v=>v+1);
      return;
    }
    target.alive=false;
    target.headless=true;
    target.bodyState="falling";
    target.fall=attackDirection.current.x||attackDirection.current.z||facing.current;
    target.vx=attackDirection.current.x*3.4;
    target.vz=attackDirection.current.z*3.4;
    target.vy=1.0;
    severedHeads.current.push({
      id:nextEffectId.current++,
      kind:target.kind,
      x:target.x,
      y:headH,
      z:target.z,
      vx:attackDirection.current.x*4.8,
      vy:5.2,
      vz:attackDirection.current.z*4.8-(phase===1?13.5:0),
      rotZ:(Math.random()-0.5)*0.8,
      stuck:false,
      targetZ:targetWallZ(target.x),
    });
    spawnGore(target.x,headH,target.z,24,5.6,10);
    addBloodPool(target.x,target.z,1.05);
    onKill();
    onScore(150);
    setEnemyVersion(v=>v+1);
  };

  useEffect(()=>{
    const down=(e:KeyboardEvent)=>{const k=e.key.toLowerCase();keys.current.add(k);if(["arrowleft","arrowright","arrowup","arrowdown"," "].includes(k))e.preventDefault();if(k==="k"&&phase!==3)doGrab();if(k===" "||k==="l")doJump();if(k==="c")doSlide();if(k==="z")doSpecialStrike("sweep");if(k==="f")doHeadKick();if(k==="b")doSuperJump();if(k==="n")doEscorrao();if(k==="e"||k==="g")doPickup();if(k==="v"&&phase===3){const next=equipped==="shotgun"?"sickle":"shotgun";setEquipped(next);motion.current.weapon=next;}if(k==="r"&&phase===3&&tpsReloadTimer.current<=0&&tpsAmmo.current<TPS_MAG_SIZE){tpsReloadTimer.current=1.05;}};
    const up=(e:KeyboardEvent)=>keys.current.delete(e.key.toLowerCase());
    window.addEventListener("keydown",down);window.addEventListener("keyup",up);return()=>{window.removeEventListener("keydown",down);window.removeEventListener("keyup",up);};
  });

  useFrame((_,dt)=>{
    if(!rickVisibleSent.current&&player.current&&player.current.visible&&(phase!==3||camera===perspCamRef)){
      let hasMesh=false;
      player.current.traverse(obj=>{
        if((obj as THREE.Mesh).isMesh)hasMesh=true;
      });
      if(hasMesh){
        rickReadyFrames.current+=1;
        if(rickReadyFrames.current>=3){
          rickVisibleSent.current=true;
          onRickVisible();
        }
      }
    }
    if(paused||!player.current)return;
    motion.current.weapon=equipped;
    const c=controls.current;const prior=lastActions.current;
    const attackHeld=c.attack||keys.current.has("j");
    if(attackHeld&&!prior.attack){if(heldThrowable.current!==null)doPickup();else doAttack();}if(c.grab&&!prior.grab)doGrab();if(c.jump&&!prior.jump)doJump();if(c.pickup&&!prior.pickup)doPickup();
    if(c.slide&&!prior.slide)doSlide();if(c.sweep&&!prior.sweep)doSpecialStrike("sweep");if(c.headKick&&!prior.headKick)doHeadKick();if(c.superJump&&!prior.superJump)doSuperJump();if(c.escorrao&&!prior.escorrao)doEscorrao();
    lastActions.current={attack:attackHeld,grab:c.grab,jump:c.jump,pickup:c.pickup,slide:c.slide,sweep:c.sweep,superJump:c.superJump,escorrao:c.escorrao,headKick:c.headKick};
    attackCooldown.current=Math.max(0,attackCooldown.current-dt);grabCooldown.current=Math.max(0,grabCooldown.current-dt);slideCooldown.current=Math.max(0,slideCooldown.current-dt);
    motion.current.slideTime=Math.max(0,(motion.current.slideTime??0)-dt);specialJumpCooldown.current=Math.max(0,specialJumpCooldown.current-dt);escorraoCooldown.current=Math.max(0,escorraoCooldown.current-dt);
    if(motion.current.slideTime<=0&&(motion.current.specialMove==="slide"||motion.current.specialMove==="escorrao"||motion.current.specialMove==="impact")){if(motion.current.specialMove==="escorrao"){escorraoVel.current={x:0,z:0};escorraoHitIds.current.clear();}motion.current.specialMove=null;}
    if(motion.current.attackTime<=0&&(motion.current.specialMove==="sweep"||motion.current.specialMove==="headKick"))motion.current.specialMove=null;
    spitHitCooldown.current=Math.max(0,spitHitCooldown.current-dt);
    if(phase===3){
      if(tpsAimRef.current.reload&&tpsReloadTimer.current<=0&&tpsAmmo.current<TPS_MAG_SIZE){
        tpsReloadTimer.current=1.05;
      }
      tpsAimRef.current.reload=false;
      if(tpsReloadTimer.current>0){
        tpsReloadTimer.current=Math.max(0,tpsReloadTimer.current-dt);
        if(tpsReloadTimer.current<=0)tpsAmmo.current=TPS_MAG_SIZE;
      }
      if(hitMarkerTimer.current>0){
        hitMarkerTimer.current=Math.max(0,hitMarkerTimer.current-dt);
        if(hitMarkerTimer.current<=0)hitMarkerKind.current="none";
      }
      tpsRecoil.current=THREE.MathUtils.damp(tpsRecoil.current,0,14,dt);

      const arrowYaw=(Number(keys.current.has("arrowleft"))-Number(keys.current.has("arrowright")))*1.85*dt;
      tpsYaw.current+=tpsAimRef.current.yawDelta+arrowYaw;
      tpsPitch.current=THREE.MathUtils.clamp(tpsPitch.current+tpsAimRef.current.pitchDelta,-0.45,0.42);
      tpsAimRef.current.yawDelta=0;
      tpsAimRef.current.pitchDelta=0;
      motion.current.shotgunAimPitch=tpsPitch.current;
      motion.current.shotgunAimYaw=0;
    }

    const keyH=phase===3
      ? Number(keys.current.has("d"))-Number(keys.current.has("a"))
      : Number(keys.current.has("d")||keys.current.has("arrowright"))-Number(keys.current.has("a")||keys.current.has("arrowleft"));
    const keyD=Number(keys.current.has("s")||keys.current.has("arrowdown"))-Number(keys.current.has("w")||keys.current.has("arrowup"));
    const dx=THREE.MathUtils.clamp(c.horizontal+keyH,-1,1),dz=THREE.MathUtils.clamp(c.depth+keyD,-1,1);
    const moving=Math.abs(dx)+Math.abs(dz)>0.08;motion.current.moving=moving;
    const airSuperLeap=specialJumpActive.current&&!grounded.current;
    const escorraoSliding=motion.current.specialMove==="escorrao"&&(motion.current.slideTime??0)>0;
    if(moving||airSuperLeap||escorraoSliding){
      const v=moving?new THREE.Vector3(dx,0,dz).normalize():new THREE.Vector3(0,0,0);
      if(phase===3){
        const fwdX=-Math.sin(tpsYaw.current), fwdZ=-Math.cos(tpsYaw.current);
        const rightX=Math.cos(tpsYaw.current), rightZ=-Math.sin(tpsYaw.current);
        const moveFwd=-v.z;
        const moveRight=v.x;
        const speed=tpsAimRef.current.ads?2.75:4.45;
        const stepX=(fwdX*moveFwd+rightX*moveRight)*speed*dt;
        const stepZ=(fwdZ*moveFwd+rightZ*moveRight)*speed*dt;
        const px=player.current.position.x, pz=player.current.position.z;
        const nextX=THREE.MathUtils.clamp(px+stepX,-2.76,2.76);
        const nextZ=THREE.MathUtils.clamp(pz+stepZ,-38.2,29.1);
        const blockedByCover=(x:number,z:number)=>CORRIDOR_COVERS.some(cov=>Math.abs(x-cov.x)<cov.halfW+0.36&&Math.abs(z-cov.z)<cov.halfD+0.36);
        if(!blockedByCover(nextX,pz))player.current.position.x=nextX;
        const rx=player.current.position.x;
        if(!blockedByCover(rx,nextZ))player.current.position.z=nextZ;
      }else{
        const airScale=airSuperLeap?0.45:escorraoSliding?0.25:1;
        const stepX=(moving?v.x*4.25*airScale*dt:0)+(airSuperLeap?specialJumpVel.current.x*dt:0)+(escorraoSliding?escorraoVel.current.x*dt:0);
        const depthSpeed=phase===2?4.25:2.1;
        const stepZ=(moving?v.z*depthSpeed*airScale*dt:0)+(airSuperLeap?specialJumpVel.current.z*dt:0)+(escorraoSliding?escorraoVel.current.z*dt:0);
        if(phase===1||phase===5||phase===6){
          player.current.position.x=THREE.MathUtils.clamp(player.current.position.x+stepX,-32.0,65.0);
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
          const inStairBlock=(x:number,z:number)=>Math.abs(x)<3.22&&z>-2.55&&z<5.42&&!canUseStairFootprint;
          const blockedByStair=(x:number,z:number)=>{
            if(!inStairBlock(x,z))return false;
            if(inStairBlock(px,pz)){
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
        if(moving){
          if(Math.abs(dx)>0.05)facing.current=dx>0?1:-1;
          if(phase===1||phase===5||phase===6){
            attackDirection.current={x:facing.current,z:0};
            player.current.rotation.y=facing.current>0?-Math.PI/2:Math.PI/2;
          }else{
            attackDirection.current={x:v.x,z:v.z};
            player.current.rotation.y=Math.atan2(-v.x,-v.z);
          }
        }
      }
    }
    if(escorraoSliding){
      let hits=0;
      const sx=escorraoVel.current.x, sz=escorraoVel.current.z;
      const fallDir=sx||sz||facing.current;
      for(const e of enemies.current){
        if(!e.alive||escorraoHitIds.current.has(e.id))continue;
        const dist=Math.hypot(e.x-player.current.position.x,e.z-player.current.position.z);
        if(dist>2.35)continue;
        escorraoHitIds.current.add(e.id);
        hits++;
        e.vx=sx*0.72;e.vz=sz*0.72;e.vy=1.1;e.fall=fallDir;e.knocked=0.85;
        if(e.kind==="brute"&&e.health>1){
          e.health-=1;
          spawnGore(e.x,0.75,e.z,14,4.5);
        }else{
          e.alive=false;e.bodyState="falling";e.knocked=0.65;
          addBloodPool(e.x,e.z,0.95);spawnGore(e.x,0.55,e.z,18,4.8);
          onKill();onScore(100);
        }
      }
      if(hits)setEnemyVersion(v=>v+1);
    }
    if(phase===3){
      const fwdX=-Math.sin(tpsYaw.current), fwdZ=-Math.cos(tpsYaw.current);
      attackDirection.current={x:fwdX,z:fwdZ};
      player.current.rotation.y=tpsYaw.current;
    }
    if(!grounded.current){const jumpGravity=specialJumpActive.current?5.2:16.5;motion.current.jumpHeight=Math.max(0,motion.current.jumpHeight+jumpVelocity.current*dt);jumpVelocity.current-=jumpGravity*dt;if(specialJumpActive.current&&jumpVelocity.current<=0.65)motion.current.superJumpTuck=true;if(motion.current.jumpHeight<=0){motion.current.jumpHeight=0;jumpVelocity.current=0;grounded.current=true;motion.current.superJumpTuck=false;if(specialJumpActive.current){specialJumpActive.current=false;specialJumpVel.current={x:0,z:0};motion.current.specialMove="impact";motion.current.slideTime=0.25;let count=0;for(const e of enemies.current){if(!e.alive||Math.hypot(e.x-player.current.position.x,e.z-player.current.position.z)>1.25)continue;count++;e.alive=false;e.health=0;e.bodyState="falling";e.knocked=0.65;e.vx=attackDirection.current.x*1.1;e.vz=attackDirection.current.z*1.1;e.vy=0;addBloodPool(e.x,e.z,1.15);spawnGore(e.x,0.22,e.z,26,5.8);onKill();onScore(100);}if(count)setEnemyVersion(v=>v+1);}}}
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
    if(motion.current.grabTime<=0)motion.current.grabStyle=null;
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
          if(target.kind==="brute"&&target.health>1){
            target.health-=1;
            target.fall=attackDirection.current.x||attackDirection.current.z||facing.current;
            target.vx=attackDirection.current.x*4.0;
            target.vz=attackDirection.current.z*4.0;
            spawnGore(target.x,1.6,target.z,18,5.2);
            setEnemyVersion(v=>v+1);
          }else{
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
    }else if(phase===3&&rickVisibleSent.current){
      if(phase3SpawnDelay.current>0){
        phase3SpawnDelay.current=Math.max(0,phase3SpawnDelay.current-dt);
      }else{
        if(!phase3InitialWaveSpawned.current){
          phase3InitialWaveSpawned.current=true;
          const z1=Math.max(-36,Math.min(pz-14.5,11.5));
          const z2=Math.max(-36,Math.min(pz-19.0,7.0));
          enemies.current.push(makeEnemy(nextEnemyId.current++,-1.15,z1,"spitter",0.4,true));
          enemies.current.push(makeEnemy(nextEnemyId.current++,1.25,z2,"crawler",1.5,true));
          setEnemyVersion(v=>v+1);
        }
        for(const door of CORRIDOR_DOORS){
          const spawnX=door.side*3.9;
          if(pz<=door.triggerZ&&!triggeredCorridorWaves.current.has(door.id)&&Math.hypot(spawnX-px,door.z-pz)>=4.2){
            triggeredCorridorWaves.current.add(door.id);
            openedCorridorDoors.current.add(door.id);
            enemies.current.push(makeEnemy(nextEnemyId.current++,spawnX,door.z,door.spawnKind,door.id*0.8,true));
            if(door.secondaryKind){
              enemies.current.push(makeEnemy(nextEnemyId.current++,door.side*4.55,door.z-0.45,door.secondaryKind,door.id*1.3,true));
            }
            setEnemyVersion(v=>v+1);
          }
        }
        if(pz<=-25.5&&!triggeredCorridorWaves.current.has(99)){
          triggeredCorridorWaves.current.add(99);
          enemies.current.push(makeEnemy(nextEnemyId.current++,-1.3,-34.2,"brute",0.4,true));
          enemies.current.push(makeEnemy(nextEnemyId.current++,1.35,-34.8,"brute",1.1,true));
          enemies.current.push(makeEnemy(nextEnemyId.current++,0,-36.0,"spitter",1.8,true));
          setEnemyVersion(v=>v+1);
        }
      }
    }

    enemies.current.forEach((e)=>{
      const group=enemyGroups.current[e.id];
      if(!e.alive&&!droppedEnemyParts.current.has(e.id)&&e.bodyState!=="gone"){
        droppedEnemyParts.current.add(e.id);
        const kind:ThrowableKind=(e.headless||e.severedArm)?"arm":"head";
        throwableItems.current.push({id:nextEffectId.current++,kind,x:e.x+(Math.random()-0.5)*0.45,y:0.32,z:e.z+(Math.random()-0.5)*0.45,vx:0,vy:0,vz:0,rotation:Math.random()*Math.PI,held:false,thrown:false,age:0});
        setEnemyVersion(v=>v+1);
      }
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
      if(e.bodyState==="grabInvertLift"){
        e.grabTimer+=dt;
        const pX=player.current!.position.x;
        const pZ=player.current!.position.z;
        const dirX=attackDirection.current.x;
        const dirZ=attackDirection.current.z;
        if(e.grabTimer<0.46){
          const liftP=THREE.MathUtils.clamp(e.grabTimer/0.46,0,1);
          const ease=liftP*liftP*(3-2*liftP);
          e.x=THREE.MathUtils.lerp(pX+dirX*0.78,pX+dirX*0.86,ease);
          e.z=THREE.MathUtils.lerp(pZ+dirZ*0.78,pZ+dirZ*0.86,ease);
          e.y=THREE.MathUtils.lerp(0.45,2.05,ease);
          if(group){
            group.position.set(e.x,e.y,e.z);
            group.rotation.set(0,0,0);
            group.scale.set(1,1,1);
          }
        }else{
          const flipP=THREE.MathUtils.clamp((e.grabTimer-0.46)/0.56,0,1);
          const ease=flipP*flipP*(3-2*flipP);
          e.x=pX+dirX*0.86;
          e.z=pZ+dirZ*0.86;
          e.y=THREE.MathUtils.lerp(2.05,2.35,ease);
          if(group){
            group.position.set(e.x,e.y,e.z);
            group.rotation.set(0,0,THREE.MathUtils.lerp(0,Math.PI,ease));
            group.scale.set(1,1,1);
          }
        }
        if(e.grabTimer>=1.02){
          e.bodyState="grabInvertSlam";
          e.grabTimer=0;
        }
        return;
      }
      if(e.bodyState==="grabInvertSlam"){
        e.grabTimer+=dt;
        const pX=player.current!.position.x;
        const pZ=player.current!.position.z;
        const dirX=attackDirection.current.x;
        const dirZ=attackDirection.current.z;
        const slam=THREE.MathUtils.clamp(e.grabTimer/0.33,0,1);
        const headH=e.kind==="crawler"?1.05:e.kind==="brute"?1.95:1.6;
        e.x=pX+dirX*0.86;
        e.z=pZ+dirZ*0.86;
        e.y=THREE.MathUtils.lerp(2.35,headH-0.15,slam*slam);
        if(group){
          group.position.set(e.x,e.y,e.z);
          group.rotation.set(0,0,Math.PI);
          group.scale.set(1,1,1);
        }
        if(e.grabTimer>=0.33){
          e.y=headH-0.15;
          e.bodyState="grabInvertFallen";
          e.grabTimer=0;
          spawnGore(e.x,0.28,e.z,28,6.0,10);
          addBloodPool(e.x,e.z,1.28);
          onKill();
          onScore(150);
          setEnemyVersion(v=>v+1);
        }
        return;
      }
      if(e.bodyState==="grabInvertFallen"){
        e.grabTimer+=dt;
        const headH=e.kind==="crawler"?1.05:e.kind==="brute"?1.95:1.6;
        if(group){
          group.position.set(e.x,headH-0.15,e.z);
          group.rotation.set(0,0,Math.PI);
          group.scale.set(1,1,1);
        }
        if(e.grabTimer>=0.5){
          e.bodyState="grabMelting";
          e.grabTimer=0;
          e.fall=Math.PI/1.42;
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
      if(e.y<0){
        e.y=Math.min(0,e.y+dt*1.7);
        group.position.set(e.x,e.y,e.z);
        group.rotation.z=THREE.MathUtils.damp(group.rotation.z,0,5,dt);
        return;
      }
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
            group.rotation.y=THREE.MathUtils.damp(group.rotation.y,px>=e.x?0.82:-0.82,6,dt);
          }
        }else if(phase===3){
          const dxPlayer=px-e.x,dzPlayer=pz-e.z;
          const distPlayer=Math.hypot(dxPlayer,dzPlayer);
          if(!e.activated&&distPlayer<28)e.activated=true;
          if(e.activated){
            // Monsters emerging from bedroom alcoves first walk out through their doorway into the corridor
            if(Math.abs(e.x)>2.65){
              e.x-=Math.sign(e.x)*1.95*dt;
            }else if(distPlayer>1.55){
              const spd=e.kind==="crawler"?2.15:e.kind==="brute"?1.45:1.65;
              const step=Math.min(distPlayer-1.55,spd*dt);
              e.x+=(dxPlayer/distPlayer)*step;
              e.z+=(dzPlayer/distPlayer)*step;
            }
            group.rotation.y=THREE.MathUtils.damp(group.rotation.y,Math.atan2(dxPlayer,dzPlayer),6,dt);
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
      // Spitters guard the mansion entrance in Phase 1 and fire down the hallway in Phase 3.
      if(((phase===1&&e.kind==="spitter"&&e.x>=52.5)||(phase===3&&e.kind==="spitter"&&Math.abs(e.x)<2.9))&&e.activated&&e.spitCooldown<=0){
        const dx=px-e.x,dz=pz-e.z,distance=Math.hypot(dx,dz);
        if(distance>3.2&&distance<14.5){
          const flight=0.82;
          const startX=e.x+Math.sign(dx)*0.22,startY=1.72,startZ=e.z+Math.sign(dz)*0.22;
          spitProjectiles.current.push({
            id:nextEffectId.current++,x:startX,y:startY,z:startZ,
            vx:(px-startX)/flight,vy:(0.08-startY+4.9*flight*flight)/flight,
            vz:(pz-startZ)/flight,age:0
          });
          e.spitCooldown=phase===3?2.95:2.65;
          setEnemyVersion(v=>v+1);
        }
      }
      if(phase===3){
        // Allow enemies inside open bedrooms (|x| up to 4.9) to step through doorways into the corridor
        if(Math.abs(e.x)>2.85){
          e.x=THREE.MathUtils.clamp(e.x,-4.9,4.9);
        }else{
          e.x=THREE.MathUtils.clamp(e.x,-2.85,2.85);
        }
        e.z=THREE.MathUtils.clamp(e.z,-38.0,28.5);
      }else if(phase===1||phase===5||phase===6){
        e.x=THREE.MathUtils.clamp(e.x,-32.0,65.0);e.z=THREE.MathUtils.clamp(e.z,-1.35,1.35);
      }else{
        e.x=THREE.MathUtils.clamp(e.x,-15.5,15.5);e.z=THREE.MathUtils.clamp(e.z,-19.5,25.5);
      }
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

    tracers.current.forEach((tr)=>{
      tr.age+=dt;
      const m=tracerGroups.current[tr.id];
      if(m){
        const mat=m.material as THREE.MeshBasicMaterial;
        mat.opacity=Math.max(0,1-tr.age/0.11);
      }
    });
    const beforeTracers=tracers.current.length;
    tracers.current=tracers.current.filter(tr=>tr.age<0.11);
    if(tracers.current.length!==beforeTracers)setEnemyVersion(v=>v+1);

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
        if(phase===3){
          player.current.position.x=THREE.MathUtils.clamp(player.current.position.x+hitX/hitLength*0.6,-2.76,2.76);
          player.current.position.z=THREE.MathUtils.clamp(player.current.position.z+hitZ/hitLength*0.6,-38.2,29.1);
        }else{
          player.current.position.x=THREE.MathUtils.clamp(player.current.position.x+hitX/hitLength*0.9,-25.5,63.8);
          player.current.position.z=THREE.MathUtils.clamp(player.current.position.z+hitZ/hitLength*0.9,-1.35,1.35);
        }
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
    // Atualiza objetos arremessáveis e partes de monstros.
    let throwableChanged=false;
    for(const item of throwableItems.current){
      if(item.held&&heldThrowable.current===item.id){
        const dir=attackDirection.current;
        item.x=player.current.position.x+dir.x*0.48-dir.z*0.12;
        item.y=1.22+motion.current.jumpHeight;
        item.z=player.current.position.z+dir.z*0.48+dir.x*0.12;
      }else if(item.thrown){
        item.age+=dt;item.x+=item.vx*dt;item.y+=item.vy*dt;item.z+=item.vz*dt;
        item.vy-=10.5*dt;item.vx*=Math.max(0,1-dt*0.12);item.vz*=Math.max(0,1-dt*0.12);
        const hit=enemies.current.find(e=>e.alive&&Math.hypot(e.x-item.x,e.z-item.z)<0.82&&item.y<2.15);
        if(hit){
          hit.health-=hit.kind==="brute"?1:2;hit.vx=item.vx*0.38;hit.vz=item.vz*0.38;hit.vy=2.1;hit.knocked=0.75;
          spawnGore(hit.x,0.9,hit.z,10,3.8);
          if(hit.health<=0){hit.alive=false;hit.bodyState="falling";addBloodPool(hit.x,hit.z,0.9);onKill();onScore(100);}
          item.thrown=false;item.age=99;throwableChanged=true;setEnemyVersion(v=>v+1);
        }else if(item.y<=0.18){item.y=0.18;item.vy=0;item.vx*=0.25;item.vz*=0.25;if(item.age>0.8){item.thrown=false;item.age=99;}}
        if(item.age>3.2){item.thrown=false;item.age=99;}
      }
      const itemGroup=throwableGroups.current[item.id];
      if(itemGroup){itemGroup.position.set(item.x,item.y,item.z);itemGroup.rotation.set(0,item.rotation+item.age*5,item.thrown?item.age*7:0);}
    }
    const throwableCount=throwableItems.current.length;
    throwableItems.current=throwableItems.current.filter(v=>v.age<99);
    if(throwableChanged||throwableCount!==throwableItems.current.length)setEnemyVersion(v=>v+1);
    const beforeSplashes=spitSplashes.current.length;
    spitSplashes.current=spitSplashes.current.filter(s=>s.age<1.35);
    if(landedSpit||beforeSplashes!==spitSplashes.current.length)setEnemyVersion(v=>v+1);

    if(phase===4&&!basementKeyCollected.current&&Math.hypot(player.current.position.x-4,player.current.position.z-11)<1.15){
      basementKeyCollected.current=true;spawnSparks(4,0.9,11);setEnemyVersion(v=>v+1);
    }
    if(phase===1){
      player.current.position.x=THREE.MathUtils.clamp(player.current.position.x,-25.5,63.8);
      if(player.current.position.x>=62.5){
        enterPhase2(false);
      }
    }else if(phase===2){
      player.current.position.x=THREE.MathUtils.clamp(player.current.position.x,-15.1,15.1);
      player.current.position.z=THREE.MathUtils.clamp(player.current.position.z,-17.25,28.4);
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
      if(onUpperGallery&&stairX<=1.85&&stairZ<=-16.3){
        enterPhase3();
      }
    }else if(phase===3){
      player.current.position.x=THREE.MathUtils.clamp(player.current.position.x,-2.76,2.76);
      player.current.position.z=THREE.MathUtils.clamp(player.current.position.z,-38.2,29.1);
      player.current.position.y=0;
      player.current.visible=true;
      if(!phase3ClearedSent.current&&player.current.position.z<=-37.1&&Math.abs(player.current.position.x)<=1.85){
        phase3ClearedSent.current=true;enterPhase4();
      }
    }else if(phase===4){
      player.current.position.x=THREE.MathUtils.clamp(player.current.position.x,-5.35,5.35);
      player.current.position.z=THREE.MathUtils.clamp(player.current.position.z,-19.0,19.0);
      player.current.position.y=0;player.current.visible=true;
      if(player.current.position.z<=-18.3&&Math.abs(player.current.position.x)<2.4&&basementKeyCollected.current&&!enemies.current.some(e=>e.boss&&e.alive))enterPhase5();
    }else{
      player.current.position.x=THREE.MathUtils.clamp(player.current.position.x,-32.0,65.0);
      player.current.position.z=THREE.MathUtils.clamp(player.current.position.z,-1.35,1.35);
      player.current.position.y=0;player.current.visible=true;
      if(phase===5&&player.current.position.x>=63.5)enterPhase6();
      if(phase===6&&player.current.position.x>=63.5&&!enemies.current.some(e=>e.boss&&e.alive)&&!phase3ClearedSent.current){phase3ClearedSent.current=true;onPhase3Clear?.();}
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

    if(phase===3){
      const ads=tpsAimRef.current.ads;
      const fwdX=-Math.sin(tpsYaw.current), fwdZ=-Math.cos(tpsYaw.current);
      const rightX=Math.cos(tpsYaw.current), rightZ=-Math.sin(tpsYaw.current);
      const camDist=ads?1.88:3.18;
      const shoulderOffset=ads?0.54:0.72;
      const camHeight=(ads?1.66:1.88)+playerHeight+motion.current.jumpHeight*0.65;

      const desiredCamX=THREE.MathUtils.clamp(targetX-fwdX*camDist+rightX*shoulderOffset,-3.02,3.02);
      const desiredCamZ=THREE.MathUtils.clamp(targetZ-fwdZ*camDist+rightZ*shoulderOffset,-38.6,29.4);
      const desiredCamY=THREE.MathUtils.clamp(camHeight-Math.sin(tpsPitch.current)*(ads?0.55:0.9),0.72,4.15);

      perspCamRef.position.x=THREE.MathUtils.damp(perspCamRef.position.x,desiredCamX,16,dt);
      perspCamRef.position.y=THREE.MathUtils.damp(perspCamRef.position.y,desiredCamY,16,dt);
      perspCamRef.position.z=THREE.MathUtils.damp(perspCamRef.position.z,desiredCamZ,16,dt);
      perspCamRef.fov=THREE.MathUtils.damp(perspCamRef.fov,ads?42:56,14,dt);
      if(size.width>0){
        perspCamRef.aspect=size.width/Math.max(1,size.height);
      }
      perspCamRef.updateProjectionMatrix();

      const lookX=targetX+fwdX*18+rightX*(ads?0.24:0.35);
      const lookZ=targetZ+fwdZ*18+rightZ*(ads?0.24:0.35);
      const lookY=(ads?1.42:1.46)+playerHeight+Math.sin(tpsPitch.current)*18+tpsRecoil.current*1.4;
      perspCamRef.up.set(0,1,0);
      perspCamRef.lookAt(lookX,lookY,lookZ);

      const nextHud:TpsHudState={
        ammo:tpsAmmo.current,
        maxAmmo:TPS_MAG_SIZE,
        reloading:tpsReloadTimer.current>0,
        ads,
        hitMarker:hitMarkerKind.current,
      };
      if(
        nextHud.ammo!==lastTpsHud.current.ammo||
        nextHud.reloading!==lastTpsHud.current.reloading||
        nextHud.ads!==lastTpsHud.current.ads||
        nextHud.hitMarker!==lastTpsHud.current.hitMarker
      ){
        lastTpsHud.current=nextHud;
        onTpsHudUpdate(nextHud);
      }
    }else if(phase===1||phase===5||phase===6){
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
      camera.position.set(targetX,8.4+playerHeight,targetZ+6.8);
      camera.up.set(0,1,0);
      camera.lookAt(targetX,1.7+playerHeight,targetZ-2.6);
    }
    if(phase!==3&&size.width>0){const aspect=size.width/Math.max(1,size.height);const baseHalfH=(phase===1||phase===5||phase===6)?5.4:7.4;const halfH=hdPhase2ZoomActive?baseHalfH/THREE.MathUtils.clamp(hdZoomCurrent.current,0.55,2.4):baseHalfH;const ortho=camera as THREE.OrthographicCamera;ortho.zoom=1;ortho.left=-halfH*aspect;ortho.right=halfH*aspect;ortho.top=halfH;ortho.bottom=-halfH;ortho.updateProjectionMatrix();}
  });

  return <group>
    <color attach="background" args={["#08070a"]}/>
    <ambientLight intensity={phase===3?0.78:0.78}/>
    <directionalLight position={[-6,12,10]} intensity={phase===3?0.65:1.55} castShadow={phase!==3} shadow-mapSize={[2048,2048]}/>
    <pointLight position={[10,5,3]} intensity={0.45} color="#8d3330"/>
    {phase===3&&<>
      <hemisphereLight args={["#f2cbb8","#241412",0.72]}/>
      {[20,6,-8,-22,-35].map(lz=>(
        <pointLight key={`corridor-light-${lz}`} position={[0,3.55,lz]} intensity={14} distance={18} decay={1.65} color="#ffb37e"/>
      ))}
    </>}
    {phase===1?<Exterior/>:phase===2?<MansionRoom player={player}/>:phase===3?<MansionCorridor3 openedDoorsRef={openedCorridorDoors}/>:phase===4?<MansionBasement/>:phase===5?<UndergroundDungeon/>:<HauntedCemetery destroyedGraves={destroyedGraves.current}/>}
    {phase===4&&!basementKeyCollected.current&&<group position={[4,0.7,11]}><mesh rotation={[Math.PI/2,0,0]}><torusGeometry args={[0.28,0.055,8,18]}/><meshStandardMaterial color="#d9b44e" metalness={0.72} roughness={0.25} emissive="#6d4a12" emissiveIntensity={0.55}/></mesh><mesh position={[0,-0.22,0]} rotation={[0,0,Math.PI/2]}><cylinderGeometry args={[0.035,0.035,0.55,8]}/><meshStandardMaterial color="#c8a044" metalness={0.72}/></mesh><pointLight intensity={0.8} distance={3} color="#e4b84d"/></group>}
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

    {enemies.current.map((e)=>(e.alive||e.bodyState!=="alive")&&(phase!==1||e.id>14||initialEnemiesVisible)&&<group key={e.id} ref={node=>{enemyGroups.current[e.id]=node;}} position={[e.x,e.y,e.z]} scale={e.boss?2.15:1}>
      <MonsterProceduralCharacter kind={e.kind} headless={e.headless} missingArm={e.severedArm} missingLeg={e.bodyState==="wallStuck"} brokenHead={e.bodyState==="wallStuck"} pinned={e.bodyState==="wallStuck"} animation={e.animation} moving={e.alive&&(e.activated||Math.abs(e.vx)>0.08||Math.abs(e.vz)>0.08)} fallen={e.bodyState==="fallen"||e.bodyState==="grabFallen"||e.bodyState==="grabInvertFallen"||e.bodyState==="macheteFalling"} dissolve={e.bodyState==="grabMelting" ? THREE.MathUtils.clamp(e.grabTimer/1.05,0,1) : e.bodyState==="macheteMelting" ? THREE.MathUtils.clamp(e.grabTimer/0.92,0,1) : 0} attackPulse={e.knocked>0?THREE.MathUtils.clamp(e.knocked/0.65,0,1):e.bodyState==="grabLift"||e.bodyState==="grabThrown"||e.bodyState==="grabInvertLift"||e.bodyState==="grabInvertSlam"||e.bodyState==="wallFlying"?1:0}/>
      {e.boss&&<group>
        <mesh position={[-0.42,0.52,0.2]} rotation={[0.2,0.3,0.4]}><boxGeometry args={[0.34,0.42,0.3]}/><meshStandardMaterial color="#6b4842" roughness={0.9}/></mesh>
        <mesh position={[0.46,0.78,-0.08]} rotation={[0.4,0.1,-0.3]}><boxGeometry args={[0.28,0.5,0.26]}/><meshStandardMaterial color="#8a6251" roughness={0.9}/></mesh>
        <mesh position={[0,1.35,0.18]}><sphereGeometry args={[0.22,10,8]}/><meshStandardMaterial color="#b5a38b" roughness={0.9}/></mesh>
      </group>}
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
      </group>:fx.kind==="spark"?<mesh scale={fx.size*0.8}><boxGeometry args={[0.08,0.08,0.08]}/><meshBasicMaterial color="#ffcf6b"/></mesh>:<mesh scale={fx.size} rotation={[fx.age*3.1,fx.age*2.4,fx.age*1.8]}><sphereGeometry args={[0.12,14,10]}/><meshStandardMaterial color={fx.id%3===0?"#9e101c":fx.id%3===1?"#68030c":"#b71e28"} roughness={0.12} metalness={0.03}/></mesh>}
    </group>)}

    {tracers.current.map((tr)=>{
      const mx=(tr.x0+tr.x1)*0.5, my=(tr.y0+tr.y1)*0.5, mz=(tr.z0+tr.z1)*0.5;
      const len=Math.max(0.05,Math.hypot(tr.x1-tr.x0,tr.y1-tr.y0,tr.z1-tr.z0));
      const dir=new THREE.Vector3(tr.x1-tr.x0,tr.y1-tr.y0,tr.z1-tr.z0).normalize();
      const quat=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),dir);
      return (
        <mesh
          key={`tracer-${tr.id}`}
          ref={node=>{tracerGroups.current[tr.id]=node;}}
          position={[mx,my,mz]}
          quaternion={quat}
        >
          <cylinderGeometry args={[0.014,0.022,len,6]}/>
          <meshBasicMaterial color="#ffe08a" transparent opacity={0.95}/>
        </mesh>
      );
    })}

    {spitProjectiles.current.map(p=><group key={p.id} ref={node=>{spitGroups.current[p.id]=node;}} position={[p.x,p.y,p.z]}>
      <mesh scale={[0.16,0.19,0.16]} castShadow><sphereGeometry args={[1,16,12]}/><meshPhysicalMaterial color="#78d51d" emissive="#2e6508" emissiveIntensity={0.42} roughness={0.16} clearcoat={1}/></mesh>
      <mesh position={[0,-0.12,0]} scale={[0.11,0.16,0.11]}><sphereGeometry args={[1,12,10]}/><meshStandardMaterial color="#b4ed38" roughness={0.12}/></mesh>
    </group>)}
    {spitSplashes.current.map(s=><group key={s.id} ref={node=>{splashGroups.current[s.id]=node;}} position={[s.x,0.045,s.z]}>
      <mesh rotation={[-Math.PI/2,0,0]}><circleGeometry args={[0.42,20]}/><meshPhysicalMaterial color="#6fbd19" emissive="#254d08" emissiveIntensity={0.25} roughness={0.2} transparent opacity={0.88}/></mesh>
      <mesh position={[0,0.035,0]} scale={[0.7,0.18,0.7]}><sphereGeometry args={[0.38,16,10]}/><meshStandardMaterial color="#9bd72b" roughness={0.2}/></mesh>
    </group>)}

    {throwableItems.current.map(item=><group key={`throwable-${item.id}`} ref={node=>{throwableGroups.current[item.id]=node;}} position={[item.x,item.y,item.z]} rotation={[0,item.rotation+item.age*5,item.thrown?item.age*7:0]}>
      {item.kind==="head"?<mesh castShadow><sphereGeometry args={[0.22,14,12]}/><meshStandardMaterial color="#9a5d50" roughness={0.78}/></mesh>:item.kind==="arm"?<group rotation={[0,0,Math.PI/2]}><mesh castShadow><capsuleGeometry args={[0.12,0.48,6,10]}/><meshStandardMaterial color="#8e5141" roughness={0.8}/></mesh><mesh position={[0.32,0,0]}><sphereGeometry args={[0.13,10,8]}/><meshStandardMaterial color="#67252a"/></mesh></group>:item.kind==="bone"?<mesh rotation={[0,0,Math.PI/2]} castShadow><capsuleGeometry args={[0.1,0.48,5,9]}/><meshStandardMaterial color="#c7b99c" roughness={0.9}/></mesh>:item.kind==="stone"?<mesh castShadow><dodecahedronGeometry args={[0.3,0]}/><meshStandardMaterial color="#77716a" roughness={1}/></mesh>:<mesh castShadow><boxGeometry args={[0.58,0.58,0.58]}/><meshStandardMaterial color="#684b36" roughness={0.95}/></mesh>}
    </group>)}
    {phase===1&&pickups.current.map((p)=>!p.collected&&<group key={p.id} position={[p.x,0.16,p.z]}>
      <mesh rotation={[-Math.PI/2,0,0]}><torusGeometry args={[0.58,0.035,8,24]}/><meshStandardMaterial color="#db6b42" emissive="#612012"/></mesh>
      <group position={[0,0.18,0]}><WeaponModel id={p.id}/></group>
    </group>)}
    <mesh rotation={[-Math.PI/2,0,0]} position={[23,-0.035,0]} receiveShadow><planeGeometry args={[140,100]}/><shadowMaterial opacity={0.24}/></mesh>
  </group>;
}

export default function GameView({onScore,onKill,paused,onStageChange,graphicsQuality,initialStage=1,onPhase3Clear}:Props) {
  const [rendererMode,setRendererMode]=useState<"webgpu"|"webgl"|null>(null);
  const [worldPhase,setWorldPhase]=useState<1|2|3|4|5|6>(initialStage);
  const [phaseLoading,setPhaseLoading]=useState(true);
  const viewportRef=useRef<HTMLDivElement>(null);
  const zoomTargetRef=useRef(1);
  const [zoomDisplay,setZoomDisplay]=useState(1);
  const pinchDistRef=useRef<number|null>(null);
  // Qualidade Alta força o Rick HD independentemente do backend gráfico.
  // Automática usa o HD quando WebGPU está disponível; Standard mantém o Rick convencional.
  const useHDCharacter=graphicsQuality==="high"||(graphicsQuality==="auto"&&rendererMode==="webgpu");
  const isHDPhase2=useHDCharacter&&worldPhase===2;
  const isPhase3=worldPhase===3;

  const tpsAimRef=useRef<TpsAimInput>({yawDelta:0,pitchDelta:0,ads:false,reload:false});
  const lastMouseRef=useRef<{x:number;y:number}|null>(null);
  const lookTouchRef=useRef<{id:number;x:number;y:number}|null>(null);
  const [tpsHud,setTpsHud]=useState<TpsHudState>({ammo:TPS_MAG_SIZE,maxAmmo:TPS_MAG_SIZE,reloading:false,ads:false,hitMarker:"none"});
  const [energy,setEnergy]=useState(0);const energyRef=useRef(0);
  const handleKill=()=>{energyRef.current=Math.min(100,energyRef.current+12);setEnergy(energyRef.current);onKill();};
  const spendEnergy=(amount:number)=>{if(energyRef.current<amount)return false;energyRef.current-=amount;setEnergy(energyRef.current);return true;};

  const setHDZoom=(next:number)=>{
    const clamped=Math.round(THREE.MathUtils.clamp(next,0.55,2.4)*100)/100;
    zoomTargetRef.current=clamped;
    setZoomDisplay(clamped);
  };

  useEffect(()=>{
    let cancelled=false;
    setRendererMode(null);
    setPhaseLoading(true);
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

  useEffect(()=>{
    if(!isPhase3)return;
    const onKeyDown=(e:KeyboardEvent)=>{
      if(e.key==="Shift")tpsAimRef.current.ads=true;
    };
    const onKeyUp=(e:KeyboardEvent)=>{
      if(e.key==="Shift")tpsAimRef.current.ads=false;
    };
    window.addEventListener("keydown",onKeyDown);
    window.addEventListener("keyup",onKeyUp);
    return ()=>{
      window.removeEventListener("keydown",onKeyDown);
      window.removeEventListener("keyup",onKeyUp);
      tpsAimRef.current.ads=false;
      lastMouseRef.current=null;
    };
  },[isPhase3]);

  const joystickRef=useRef<HTMLDivElement>(null);
  const joystickInput=useRef({x:0,y:0,pointerId:-1});
  const [knob,setKnob]=useState({x:0,y:0});
  const controls=useRef<WorldControls>({horizontal:0,depth:0,attack:false,grab:false,jump:false,pickup:false,slide:false,sweep:false,superJump:false,escorrao:false,headKick:false});
  const updateJoystick=(event:ReactPointerEvent<HTMLDivElement>)=>{const el=joystickRef.current;if(!el)return;const r=el.getBoundingClientRect();const dx=event.clientX-(r.left+r.width/2),dy=event.clientY-(r.top+r.height/2),radius=r.width*0.34,d=Math.hypot(dx,dy),scale=d>radius?radius/d:1;const x=dx*scale,y=dy*scale;joystickInput.current.x=x/radius;joystickInput.current.y=y/radius;controls.current.horizontal=x/radius;controls.current.depth=y/radius;setKnob({x,y});};
  const releaseJoystick=(event:ReactPointerEvent<HTMLDivElement>)=>{if(joystickInput.current.pointerId!==event.pointerId)return;joystickInput.current={x:0,y:0,pointerId:-1};controls.current.horizontal=0;controls.current.depth=0;setKnob({x:0,y:0});if(joystickRef.current?.hasPointerCapture(event.pointerId))joystickRef.current.releasePointerCapture(event.pointerId);};
  const setAction=(key:"attack"|"grab"|"jump"|"pickup"|"slide"|"sweep"|"superJump"|"escorrao"|"headKick",value:boolean)=>{controls.current[key]=value;};
  const press=(key:"attack"|"grab"|"jump"|"pickup"|"slide"|"sweep"|"superJump"|"escorrao"|"headKick")=>(e:ReactPointerEvent<HTMLButtonElement>)=>{e.preventDefault();setAction(key,true);};
  const release=(key:"attack"|"grab"|"jump"|"pickup"|"slide"|"sweep"|"superJump"|"escorrao"|"headKick")=>(e:ReactPointerEvent<HTMLButtonElement>)=>{e.preventDefault();setAction(key,false);};
  const handleStageChange=(stage:1|2|3|4|5|6)=>{
    setWorldPhase(stage);
    if(stage===2)setHDZoom(1);
    onStageChange(stage);
  };
  return <div ref={viewportRef} className={`game-viewport${isPhase3?" tps-mode":""}`}
    onContextMenu={e=>{if(isPhase3)e.preventDefault();}}
    onPointerDown={e=>{
      if(!isPhase3||paused)return;
      const target=e.target as HTMLElement;
      if(target.closest("button,.virtual-joystick"))return;
      if(e.pointerType==="mouse"){
        lastMouseRef.current={x:e.clientX,y:e.clientY};
        if(e.button===2){
          tpsAimRef.current.ads=true;
        }else if(e.button===0){
          controls.current.attack=true;
        }
      }else{
        lookTouchRef.current={id:e.pointerId,x:e.clientX,y:e.clientY};
      }
    }}
    onPointerMove={e=>{
      if(!isPhase3||paused)return;
      if(e.pointerType==="mouse"){
        const sens=tpsAimRef.current.ads?0.0024:0.0038;
        if(document.pointerLockElement===viewportRef.current){
          tpsAimRef.current.yawDelta-=e.movementX*sens;
          tpsAimRef.current.pitchDelta-=e.movementY*sens*0.75;
        }else{
          if(lastMouseRef.current){
            const dx=e.clientX-lastMouseRef.current.x;
            const dy=e.clientY-lastMouseRef.current.y;
            tpsAimRef.current.yawDelta-=dx*sens;
            tpsAimRef.current.pitchDelta-=dy*sens*0.75;
          }
          lastMouseRef.current={x:e.clientX,y:e.clientY};
        }
      }else if(lookTouchRef.current&&lookTouchRef.current.id===e.pointerId){
        const dx=e.clientX-lookTouchRef.current.x;
        const dy=e.clientY-lookTouchRef.current.y;
        lookTouchRef.current={id:e.pointerId,x:e.clientX,y:e.clientY};
        tpsAimRef.current.yawDelta-=dx*0.0052;
        tpsAimRef.current.pitchDelta-=dy*0.0042;
      }
    }}
    onPointerUp={e=>{
      if(!isPhase3)return;
      if(e.pointerType==="mouse"){
        if(e.button===2)tpsAimRef.current.ads=false;
        if(e.button===0)controls.current.attack=false;
      }else if(lookTouchRef.current&&lookTouchRef.current.id===e.pointerId){
        lookTouchRef.current=null;
      }
    }}
    onPointerLeave={()=>{
      lastMouseRef.current=null;
      if(isPhase3){controls.current.attack=false;tpsAimRef.current.ads=false;}
    }}
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
    {rendererMode!==null && (
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
        <World onScore={onScore} onKill={handleKill} paused={paused} onStageChange={handleStageChange} initialStage={initialStage} onPhase3Clear={onPhase3Clear} controls={controls} useHDCharacter={useHDCharacter} zoomTargetRef={zoomTargetRef} tpsAimRef={tpsAimRef} onTpsHudUpdate={setTpsHud} spendEnergy={spendEnergy} onRickVisible={()=>setPhaseLoading(false)} onStageLoading={()=>setPhaseLoading(true)}/>
      </Canvas>
    )}
    {(rendererMode===null||phaseLoading)&&(
      <div className="phase-loading-overlay" role="status" aria-live="polite">
        <span className="phase-loading-text">Carregando fase...</span>
      </div>
    )}
    {isPhase3&&<>
      <div className={`tps-crosshair${tpsHud.ads?" ads":""}${tpsHud.hitMarker!=="none"?` hit-${tpsHud.hitMarker}`:""}`} aria-hidden="true">
        <span className="tps-pip tps-top"/><span className="tps-pip tps-bottom"/><span className="tps-pip tps-left"/><span className="tps-pip tps-right"/><span className="tps-dot"/>
      </div>
      <div className="tps-weapon-hud">
        <small>ESCOPETA</small>
        <strong>{tpsHud.reloading?"RECARREGANDO…":`${tpsHud.ammo} / ${tpsHud.maxAmmo}`}</strong>
      </div>
    </>}
    {isHDPhase2&&<div className="hd-zoom-controls" aria-label="Zoom da câmera HD">
      <button type="button" className="hd-zoom-btn" aria-label="Afastar câmera" disabled={zoomDisplay<=0.56} onClick={()=>setHDZoom(zoomTargetRef.current-0.2)}>−</button>
      <button type="button" className="hd-zoom-readout" aria-label="Redefinir zoom" onClick={()=>setHDZoom(1)}>{Math.round(zoomDisplay*100)}%</button>
      <button type="button" className="hd-zoom-btn" aria-label="Aproximar câmera" disabled={zoomDisplay>=2.39} onClick={()=>setHDZoom(zoomTargetRef.current+0.2)}>+</button>
    </div>}
    <div className="rick-energy-hud" role="progressbar" aria-label="Energia de Rick" aria-valuemin={0} aria-valuemax={100} aria-valuenow={energy}>
      <span className="rick-energy-label">ENERGIA</span>
      <div className="rick-energy-track">
        <span className="rick-energy-segment energy-green" style={{width:`${Math.min(energy,34)/34*33.333}%`}}/>
        <span className="rick-energy-segment energy-yellow" style={{width:`${Math.max(0,Math.min(energy-34,33))/33*33.333}%`}}/>
        <span className="rick-energy-segment energy-red" style={{width:`${Math.max(0,energy-67)/33*33.334}%`}}/>
      </div>
      <span className="rick-energy-value">{energy}%</span>
    </div>
    <div className="action-buttons" aria-label="Ações de Rick">
      <button type="button" className="action-button action-punch" aria-label={isPhase3?"Atirar com escopeta":"Soco ou ataque"} onPointerDown={press("attack")} onPointerUp={release("attack")} onPointerCancel={release("attack")} onPointerLeave={release("attack")}>{isPhase3?"ATIRAR":"SOCO"}</button>
      <div className="action-grab-column">
        {isPhase3 ? (
          <button type="button" className={`action-button action-grab${tpsHud.ads?" is-active":""}`} aria-label="Mirar sobre o ombro" onPointerDown={e=>{e.preventDefault();tpsAimRef.current.ads=true;}} onPointerUp={e=>{e.preventDefault();tpsAimRef.current.ads=false;}} onPointerCancel={()=>{tpsAimRef.current.ads=false;}} onPointerLeave={()=>{tpsAimRef.current.ads=false;}}>MIRAR</button>
        ) : (
          <button type="button" className="action-button action-grab" aria-label="Agarrar e arremessar" onPointerDown={press("grab")} onPointerUp={release("grab")} onPointerCancel={release("grab")} onPointerLeave={release("grab")}>AGARRÃO</button>
        )}
        {isPhase3 ? (
          <button type="button" className="action-button action-pickup" aria-label={heldThrowableKind?"Arremessar objeto":"Pegar objeto ou parte de monstro"} onPointerDown={press("pickup")} onPointerUp={release("pickup")} onPointerCancel={release("pickup")} onPointerLeave={release("pickup")}>{heldThrowableKind?"ARREM.":"PEGAR"}</button>
        ) : (
          <button type="button" className="action-button action-pickup" aria-label={heldThrowableKind?"Arremessar objeto":"Pegar objeto ou parte de monstro"} onPointerDown={press("pickup")} onPointerUp={release("pickup")} onPointerCancel={release("pickup")} onPointerLeave={release("pickup")}>{heldThrowableKind?"ARREM.":"PEGAR"}</button>
        )}
      </div>
      <button type="button" className="action-button action-jump" aria-label="Pular" onPointerDown={press("jump")} onPointerUp={release("jump")} onPointerCancel={release("jump")} onPointerLeave={release("jump")}>PULO</button>
      {!isPhase3&&<>
        {energy>=34&&<button type="button" className="action-button action-special" aria-label="Super pulo" onPointerDown={press("superJump")} onPointerUp={release("superJump")} onPointerCancel={release("superJump")} onPointerLeave={release("superJump")}>SUPER PULO</button>}
        {energy>=67&&<button type="button" className="action-button action-special" aria-label="Escorão" onPointerDown={press("escorrao")} onPointerUp={release("escorrao")} onPointerCancel={release("escorrao")} onPointerLeave={release("escorrao")}>ESCORÃO</button>}
        <button type="button" className="action-button action-headkick" aria-label="Chutar cabeça" onPointerDown={press("headKick")} onPointerUp={release("headKick")} onPointerCancel={release("headKick")} onPointerLeave={release("headKick")}>CHUTAR CABEÇA</button>
        <button type="button" className="action-button action-slide" aria-label="Deslizar" onPointerDown={press("slide")} onPointerUp={release("slide")} onPointerCancel={release("slide")} onPointerLeave={release("slide")}>DESLIZAR</button>
        <button type="button" className="action-button action-sweep" aria-label="Rasteira" onPointerDown={press("sweep")} onPointerUp={release("sweep")} onPointerCancel={release("sweep")} onPointerLeave={release("sweep")}>RASTEIRA</button>
      </>}
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
