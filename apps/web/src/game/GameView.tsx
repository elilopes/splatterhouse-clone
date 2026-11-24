import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import RickTaylorCharacter, { type RickMotion } from "./characters/RickTaylorCharacter";

type Props = { onScore:(points:number)=>void; onKill:()=>void; paused:boolean; onStageChange:(stage:1|2)=>void };
type WeaponId = "pipe" | "machete" | "shotgun";
type EnemyKind = "crawler" | "brute" | "spitter";
type EnemyState = { x:number; z:number; health:number; alive:boolean; kind:EnemyKind; knocked:number; vx:number; vz:number; fall:number; animation:number };
type PickupState = { id:WeaponId; x:number; z:number; collected:boolean };

const initialEnemies: EnemyState[] = [
  {x:-10.5,z:-0.65,health:2,alive:true,kind:"crawler",knocked:0,vx:0,vz:0,fall:0,animation:0},
  {x:-7.4,z:0.7,health:2,alive:true,kind:"crawler",knocked:0,vx:0,vz:0,fall:0,animation:1},
  {x:-3.0,z:-0.7,health:3,alive:true,kind:"brute",knocked:0,vx:0,vz:0,fall:0,animation:2},
  {x:0.7,z:0.75,health:2,alive:true,kind:"crawler",knocked:0,vx:0,vz:0,fall:0,animation:3},
  {x:4.0,z:-0.75,health:2,alive:true,kind:"spitter",knocked:0,vx:0,vz:0,fall:0,animation:4},
  {x:7.4,z:0.65,health:3,alive:true,kind:"brute",knocked:0,vx:0,vz:0,fall:0,animation:5},
];
const initialPickups: PickupState[] = [
  {id:"pipe",x:-6.1,z:0.15,collected:false},
  {id:"machete",x:-0.5,z:0.1,collected:false},
  {id:"shotgun",x:5.2,z:0.1,collected:false},
];

type WorldControls = {
  horizontal:number; depth:number; attack:boolean; grab:boolean; jump:boolean; pickup:boolean;
};
type WorldProps = Props & { controls:React.MutableRefObject<WorldControls> };

function FleshyWall() {
  const lobes = useMemo(()=>Array.from({length:66},(_,i)=>({x:-16+(i%22)*0.64,y:0.45+Math.floor(i/22)*1.42+(Math.sin(i*1.7)*0.16),sx:0.35+(i%4)*0.07,sy:0.48+(i%3)*0.09,sz:0.16+(i%3)*0.035})),[]);
  return <group>
    <mesh position={[-9.2,2.35,2]} castShadow receiveShadow><boxGeometry args={[14,4.8,0.6]}/><meshStandardMaterial color="#18210d" roughness={0.92}/></mesh>
    {lobes.map((p,i)=><mesh key={i} position={[p.x,p.y,1.62]} scale={[p.sx,p.sy,p.sz]} castShadow receiveShadow>
      <sphereGeometry args={[1,24,18]}/><meshStandardMaterial color={i%5===0?"#647333":i%3===0?"#3e4d20":"#283819"} roughness={0.28} metalness={0.02}/>
    </mesh>)}
    {Array.from({length:14},(_,i)=><group key={i} position={[-15.7+i*1.05,0,1.22]}>
      <mesh position={[0,2.1,0]} rotation={[0,0,Math.sin(i*2)*0.12]}><cylinderGeometry args={[0.035,0.055,3.8,10]}/><meshStandardMaterial color="#17240f" roughness={0.65}/></mesh>
      <mesh position={[0.18,0.3,0.08]} scale={[0.16,0.6,0.15]}><capsuleGeometry args={[0.12,0.65,6,12]}/><meshStandardMaterial color="#71803b" roughness={0.24}/></mesh>
    </group>)}
    {Array.from({length:18},(_,i)=><mesh key={i} position={[-16+i*0.78,3.95-(i%4)*0.14,1.3]} rotation={[0,0,Math.PI]}><capsuleGeometry args={[0.08,0.38+(i%4)*0.1,5,10]}/><meshStandardMaterial color="#637638" roughness={0.22}/></mesh>)}
    {Array.from({length:12},(_,i)=><mesh key={i} position={[-16+i*1.28,0.12,1.2]} rotation={[0,0,0]} scale={[0.75,0.12,0.42]}><sphereGeometry args={[0.5,18,12]}/><meshStandardMaterial color="#65783a" roughness={0.2}/></mesh>)}
  </group>;
}

function Exterior() {
  return <group>
    <mesh rotation={[-Math.PI/2,0,0]} position={[-2,0,0]} receiveShadow><planeGeometry args={[34,7]}/><meshStandardMaterial color="#211d19" roughness={1}/></mesh>
    <FleshyWall/>
    {Array.from({length:9},(_,i)=><group key={i} position={[-1.8+i*1.35,0,2.7+(i%2)*0.5]}>
      <mesh position={[0,2.1,0]} castShadow><cylinderGeometry args={[0.17,0.26,4.2+(i%3)*0.45,9]}/><meshStandardMaterial color="#291912" roughness={1}/></mesh>
      {Array.from({length:3},(_,b)=><mesh key={b} position={[(b-1)*0.42,3.4+(b%2)*0.4,0]} rotation={[0,0,(b-1)*0.55]}><cylinderGeometry args={[0.06,0.1,1.7,7]}/><meshStandardMaterial color="#241711"/></mesh>)}
      <mesh position={[0,4.15,0]} scale={[1.05,0.7,0.9]}><icosahedronGeometry args={[1,1]}/><meshStandardMaterial color="#182018" flatShading/></mesh>
    </group>)}
    <mesh position={[11,3.4,2.35]} castShadow><boxGeometry args={[12,7,1]}/><meshStandardMaterial color="#38302e" roughness={0.92}/></mesh>
    <mesh position={[11,7.1,2.3]}><boxGeometry args={[13,0.5,1.5]}/><meshStandardMaterial color="#171416"/></mesh>
    {[7.2,10.2,13.2,16.2].map(x=><group key={x} position={[x,4.3,1.7]}>
      <mesh><boxGeometry args={[1.4,2.2,0.13]}/><meshStandardMaterial color="#100e12"/></mesh>
      <mesh position={[0,0,-0.08]}><boxGeometry args={[1.12,1.9,0.04]}/><meshStandardMaterial color="#6b2920" emissive="#3a1009"/></mesh>
    </group>)}
    <mesh position={[11,1.7,1.55]}><boxGeometry args={[2.5,3.6,0.24]}/><meshStandardMaterial color="#100b0b"/></mesh>
    <mesh position={[-9,8,5]}><sphereGeometry args={[1.05,24,18]}/><meshBasicMaterial color="#a8a28a"/></mesh>
  </group>;
}

function MansionRoom() {
  return <group>
    <mesh rotation={[-Math.PI/2,0,0]} receiveShadow><planeGeometry args={[18,7]}/><meshStandardMaterial color="#332923" roughness={0.88}/></mesh>
    <mesh position={[0,3.5,2.5]}><boxGeometry args={[18,7,0.5]}/><meshStandardMaterial color="#302522" roughness={0.94}/></mesh>
    <mesh position={[0,6.8,0.8]}><boxGeometry args={[18,0.35,3.5]}/><meshStandardMaterial color="#1b1110"/></mesh>
    {[-7,-3,1,5,8].map(x=><group key={x} position={[x,3,2.16]}>
      <mesh><boxGeometry args={[1.8,4.8,0.12]}/><meshStandardMaterial color="#170f0d"/></mesh>
      <mesh position={[0,1.25,-0.15]}><sphereGeometry args={[0.18,16,12]}/><meshStandardMaterial color="#a13a22" emissive="#57170d"/></mesh>
    </group>)}
    <mesh position={[-4,1,0.65]}><boxGeometry args={[2.4,0.22,0.85]}/><meshStandardMaterial color="#20120e"/></mesh>
    {[-4.9,-3.1].map(x=><mesh key={x} position={[x,0.5,0.65]}><boxGeometry args={[0.18,1,0.18]}/><meshStandardMaterial color="#20120e"/></mesh>)}
    <mesh position={[6.8,0.22,0.85]}><boxGeometry args={[3.3,0.45,1.1]}/><meshStandardMaterial color="#211512"/></mesh>
  </group>;
}

function EnemyModel({ kind }: {kind:EnemyKind}) {
  const brute=kind==="brute", crawler=kind==="crawler";
  const flesh=brute?"#75513d":kind==="spitter"?"#a05c43":"#873b36";
  return <group>
    <mesh position={[0,crawler?0.62:0.92,0]} scale={[brute?0.62:crawler?0.55:0.46,crawler?0.36:0.62,0.36]} castShadow><sphereGeometry args={[1,24,18]}/><meshStandardMaterial color={flesh} roughness={0.68}/></mesh>
    <mesh position={[0,crawler?1.05:1.65,-0.04]} scale={[brute?0.48:0.38,brute?0.48:0.38,0.34]} castShadow><sphereGeometry args={[1,24,18]}/><meshStandardMaterial color={flesh}/></mesh>
    <mesh position={[0,crawler?0.9:1.45,-0.27]} scale={[0.27,0.12,0.09]}><sphereGeometry args={[1,18,12]}/><meshStandardMaterial color="#310b10"/></mesh>
    {[-1,1].map(side=><group key={side}>
      <mesh position={[side*(brute?0.58:0.47),crawler?0.56:0.9,0]} rotation={[0,0,side*0.55]}><capsuleGeometry args={[brute?0.19:0.13,0.55,6,12]}/><meshStandardMaterial color={flesh}/></mesh>
      <mesh position={[side*0.24,crawler?0.22:0.36,0.06]} rotation={[0,0,side*0.25]}><capsuleGeometry args={[0.14,0.45,6,12]}/><meshStandardMaterial color={flesh}/></mesh>
      <mesh position={[side*0.19,crawler?1.12:1.75,-0.32]}><sphereGeometry args={[0.075,12,10]}/><meshStandardMaterial color="#ff4c28" emissive="#a41b08"/></mesh>
    </group>)}
    {brute&&Array.from({length:5},(_,i)=><mesh key={i} position={[-0.36+i*0.18,1.62,0.1]} rotation={[0,0,-0.25]}><coneGeometry args={[0.12,0.48,7]}/><meshStandardMaterial color="#49332d"/></mesh>)}
    {kind==="spitter"&&<mesh position={[0.28,1.05,-0.1]} scale={[0.28,0.45,0.27]}><sphereGeometry args={[1,20,16]}/><meshStandardMaterial color="#b46b4c" roughness={0.35}/></mesh>}
    {crawler&&Array.from({length:4},(_,i)=><mesh key={i} position={[-0.26+i*0.17,0.7,0.25]} scale={[0.18,0.055,0.1]}><sphereGeometry args={[1,12,8]}/><meshStandardMaterial color="#4a171a"/></mesh>)}
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
  const enemyGroups=useRef<(THREE.Group|null)[]>([]);
  const enemies=useRef<EnemyState[]>(initialEnemies.map(e=>({...e})));
  const pickups=useRef<PickupState[]>(initialPickups.map(p=>({...p})));
  const motion=useRef<RickMotion>({moving:false,attackTime:0,grabTime:0,jumpHeight:0});
  const [phase,setPhase]=useState<1|2>(1);
  const [equipped,setEquipped]=useState<WeaponId|null>(null);
  const [ammo,setAmmo]=useState(6);
  const facing=useRef(1);
  const attackCooldown=useRef(0),grabCooldown=useRef(0),jumpVelocity=useRef(0),grounded=useRef(true);
  const [,setEnemyVersion]=useState(0);
  const lastActions=useRef({attack:false,grab:false,jump:false,pickup:false});
  const keys=useRef(new Set<string>());
  useEffect(()=>{camera.position.set(-14,3.6,-18);camera.lookAt(-14,1.8,0);},[camera]);
  const kill=(enemy:EnemyState)=>{if(!enemy.alive)return;enemy.alive=false;onKill();onScore(100);setEnemyVersion(v=>v+1);};
  const nearest=(range:number)=>{let result:EnemyState|null=null;let best=range;for(const e of enemies.current){if(!e.alive)continue;const d=Math.hypot(e.x-(player.current?.position.x??0),e.z-(player.current?.position.z??0));if(d<best){best=d;result=e;}}return result;};
  const doPickup=()=>{if(!player.current)return;const next=pickups.current.find(p=>!p.collected);const candidates=next?[next]:[];let best:PickupState|undefined;let distance=1.75;for(const p of candidates){const d=Math.hypot(p.x-player.current.position.x,p.z-player.current.position.z);if(d<distance){best=p;distance=d;}}if(best){best.collected=true;setEquipped(best.id);}};
  const doAttack=()=>{if(attackCooldown.current>0)return;attackCooldown.current=equipped==="shotgun"?0.7:0.48;motion.current.attackTime=0.34;if(equipped==="shotgun"){if(ammo<=0)return;setAmmo(a=>a-1);const e=nearest(7);if(e&&Math.sign(e.x-(player.current?.position.x??0))===facing.current)kill(e);return;}const e=nearest(equipped==="pipe"||equipped==="machete"?2:1.65);if(!e||Math.sign(e.x-(player.current?.position.x??0))!==facing.current)return;if(equipped==="pipe"){e.health=1;e.vx=facing.current*12;}else if(equipped==="machete"){e.health=0;kill(e);}else{e.health--;e.vx=facing.current*3.2;if(e.health<=0)kill(e);}};
  const doGrab=()=>{if(grabCooldown.current>0||!player.current)return;grabCooldown.current=1.15;const e=nearest(1.8);motion.current.grabTime=0.46;if(!e)return;e.knocked=1.25;e.fall=-facing.current;e.vx=-facing.current*5.8;e.vz=(e.z-player.current.position.z)*1.8;};
  const doJump=()=>{if(!grounded.current)return;grounded.current=false;jumpVelocity.current=6.2;};
  useEffect(()=>{
    const down=(e:KeyboardEvent)=>{const k=e.key.toLowerCase();keys.current.add(k);if(["arrowleft","arrowright","arrowup","arrowdown"," "].includes(k))e.preventDefault();if(k==="j")doAttack();if(k==="k")doGrab();if(k===" "||k==="l")doJump();if(k==="e")doPickup();};
    const up=(e:KeyboardEvent)=>keys.current.delete(e.key.toLowerCase());
    window.addEventListener("keydown",down);window.addEventListener("keyup",up);return()=>{window.removeEventListener("keydown",down);window.removeEventListener("keyup",up);};
  });
  useEffect(()=>{controls.current.attack=doAttack;controls.current.grab=doGrab;controls.current.jump=doJump;controls.current.pickup=doPickup;});
  useFrame((_,dt)=>{
    if(paused||!player.current)return;
    const c=controls.current;const prior=lastActions.current;
    if(c.attack&&!prior.attack)doAttack();if(c.grab&&!prior.grab)doGrab();if(c.jump&&!prior.jump)doJump();if(c.pickup&&!prior.pickup)doPickup();
    lastActions.current={attack:c.attack,grab:c.grab,jump:c.jump,pickup:c.pickup};
    attackCooldown.current=Math.max(0,attackCooldown.current-dt);grabCooldown.current=Math.max(0,grabCooldown.current-dt);
    const keyH=Number(keys.current.has("d")||keys.current.has("arrowright"))-Number(keys.current.has("a")||keys.current.has("arrowleft"));const keyD=Number(keys.current.has("s")||keys.current.has("arrowdown"))-Number(keys.current.has("w")||keys.current.has("arrowup"));const dx=THREE.MathUtils.clamp(c.horizontal+keyH,-1,1),dz=THREE.MathUtils.clamp(c.depth+keyD,-1,1);
    const moving=Math.abs(dx)+Math.abs(dz)>0.08;motion.current.moving=moving;
    if(moving){const v=new THREE.Vector3(dx,0,dz).normalize();player.current.position.x+=v.x*4.25*dt;player.current.position.z=THREE.MathUtils.clamp(player.current.position.z+v.z*2.1*dt,-1.35,1.35);if(Math.abs(dx)>0.05)facing.current=dx>0?1:-1;player.current.rotation.y=facing.current>0?-Math.PI/2:Math.PI/2;}
    if(!grounded.current){motion.current.jumpHeight=Math.max(0,motion.current.jumpHeight+jumpVelocity.current*dt);jumpVelocity.current-=16.5*dt;if(motion.current.jumpHeight<=0){motion.current.jumpHeight=0;jumpVelocity.current=0;grounded.current=true;}}
    motion.current.attackTime=Math.max(0,motion.current.attackTime-dt);motion.current.grabTime=Math.max(0,motion.current.grabTime-dt);
    if(phase===1){const close=pickups.current.some(p=>!p.collected&&Math.hypot(player.current!.position.x-p.x,player.current!.position.z-p.z)<1.4);if(close)doPickup();}
    enemies.current.forEach((e,i)=>{
      if(!e.alive)return;const group=enemyGroups.current[i];if(!group)return;
      e.animation+=dt*(e.kind==="crawler"?8:e.kind==="brute"?3.2:5);
      if(e.knocked>0){e.knocked=Math.max(0,e.knocked-dt);e.x+=e.vx*dt;e.z+=e.vz*dt;e.vx*=Math.max(0,1-dt*3.8);e.vz*=Math.max(0,1-dt*3.8);const progress=1-e.knocked/1.25;group.rotation.z=e.fall*Math.min(1,progress*1.8)*1.48;group.position.y=Math.max(0.035,Math.sin(progress*Math.PI)*0.16);if(e.knocked<=0)kill(e);}
      else {group.rotation.z=THREE.MathUtils.damp(group.rotation.z,0,8,dt);if(Math.abs(e.vx)>0.08){e.x+=e.vx*dt;e.z+=e.vz*dt;e.vx*=Math.max(0,1-dt*2.8);}else if(phase===1){const px=player.current!.position.x,pz=player.current!.position.z;if(Math.abs(px-e.x)>0.85)e.x+=Math.sign(px-e.x)*1.15*dt;e.z+=Math.sign(pz-e.z)*Math.min(Math.abs(pz-e.z),1.2*dt);}group.position.y=e.kind==="crawler"?Math.abs(Math.sin(e.animation))*0.035:Math.sin(e.animation*2)*0.025;}
      e.x=THREE.MathUtils.clamp(e.x,phase===1?-16: -8.1,phase===1?10.25:8.4);e.z=THREE.MathUtils.clamp(e.z,-1.35,1.35);group.position.x=e.x;group.position.z=e.z;if(phase===1&&equipped==="pipe"&&(e.x<=-15.8||e.x>=10.1)&&Math.abs(e.vx)>1){kill(e);}
    });
    if(phase===1){player.current.position.x=THREE.MathUtils.clamp(player.current.position.x,-16.2,11.4);if(player.current.position.x>=10.7){setPhase(2);onStageChange(2);player.current.position.set(-7.3,0,0);enemies.current.forEach(e=>{e.alive=false;});setEnemyVersion(v=>v+1);}}
    else player.current.position.x=THREE.MathUtils.clamp(player.current.position.x,-8.1,8.4);
    const targetX=player.current.position.x;camera.position.x=THREE.MathUtils.damp(camera.position.x,targetX,3.8,dt);camera.position.z=phase===1?-18:-17;camera.position.y=phase===1?3.6:4.2;camera.lookAt(targetX,1.8,0);
    if(size.width>0){const aspect=size.width/Math.max(1,size.height);const halfH=phase===1?5.0:4.6;(camera as THREE.OrthographicCamera).left=-halfH*aspect;(camera as THREE.OrthographicCamera).right=halfH*aspect;(camera as THREE.OrthographicCamera).top=halfH;(camera as THREE.OrthographicCamera).bottom=-halfH;(camera as THREE.OrthographicCamera).updateProjectionMatrix();}
  });
  return <group>
    <color attach="background" args={["#08070a"]}/>
    <ambientLight intensity={0.78}/>
    <directionalLight position={[-5,9,-6]} intensity={1.55} castShadow shadow-mapSize={[2048,2048]}/>
    <pointLight position={[3,4,0]} intensity={0.45} color="#8d3330"/>
    {phase===1?<Exterior/>:<MansionRoom/>}
    {phase===1&&<group position={[-14,0,0]}><mesh position={[0,0.02,0]} rotation={[-Math.PI/2,0,0]}><ringGeometry args={[0.48,0.56,32]}/><meshBasicMaterial color="#7d342d"/></mesh></group>}
    <group ref={player}><RickTaylorCharacter motion={motion.current}/>{equipped&&<group position={[facing.current*0.48,1.12,-0.22]}><WeaponModel id={equipped}/></group>}</group>
    {enemies.current.map((e,i)=>e.alive&&<group key={i} ref={node=>{enemyGroups.current[i]=node;}} position={[e.x,0,e.z]}><EnemyModel kind={e.kind}/></group>)}
    {phase===1&&pickups.current.map((p,i)=>!p.collected&&<group key={p.id} position={[p.x,0.16,p.z]}>
      <mesh rotation={[-Math.PI/2,0,0]}><torusGeometry args={[0.58,0.035,8,24]}/><meshStandardMaterial color="#db6b42" emissive="#612012"/></mesh>
      <group position={[0,0.18,0]}><WeaponModel id={p.id}/></group>
    </group>)}
    {phase===1&&<group position={[11,0,2.0]}><mesh position={[0,1.8,0]}><boxGeometry args={[2.3,3.6,0.22]}/><meshStandardMaterial color="#100a0b"/></mesh></group>}
    <mesh rotation={[-Math.PI/2,0,0]} position={[0,-0.035,0]} receiveShadow><planeGeometry args={[100,100]}/><shadowMaterial opacity={0.24}/></mesh>
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
    <Canvas className="game-canvas" shadows dpr={[1,1.7]} orthographic camera={{position:[-14,3.6,-18],zoom:80,near:0.1,far:100}}>
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
