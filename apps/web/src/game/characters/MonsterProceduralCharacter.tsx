import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

export type ProceduralMonsterKind = "crawler" | "brute" | "spitter";

function organicGeometry(seed:number, stretch:[number,number,number], segments=28, rings=22) {
  const g=new THREE.SphereGeometry(1,segments,rings);
  const p=g.attributes.position;
  for(let i=0;i<p.count;i++){
    const x=p.getX(i),y=p.getY(i),z=p.getZ(i);
    const n=1+0.075*Math.sin(x*9+seed)*Math.cos(y*11+seed*1.7)+0.035*Math.sin(z*17+y*8+seed);
    p.setXYZ(i,x*stretch[0]*n,y*stretch[1]*n,z*stretch[2]*n);
  }
  p.needsUpdate=true;g.computeVertexNormals();g.computeBoundingSphere();return g;
}
function Flesh({geometry,color,roughness=0.72}:{geometry:THREE.BufferGeometry;color:string;roughness?:number}) {
  return <mesh geometry={geometry} castShadow receiveShadow><meshStandardMaterial color={color} roughness={roughness}/></mesh>;
}
function Tendon({from,to,r,color}:{from:[number,number,number];to:[number,number,number];r:number;color:string}) {
  const a=new THREE.Vector3(...from),b=new THREE.Vector3(...to),mid=a.clone().add(b).multiplyScalar(.5);
  const dir=b.clone().sub(a);const length=dir.length();
  return <mesh position={mid.toArray()} quaternion={new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),dir.normalize())} castShadow>
    <capsuleGeometry args={[r,length,6,12]}/><meshStandardMaterial color={color} roughness={0.68}/>
  </mesh>;
}

/** Procedural, articulated horror creature. Meshes are grouped into a hierarchical joint rig
 * and driven by locomotion/idle motion; shared combat remains controlled by GameView. */
export default function MonsterProceduralCharacter({kind,headless=false,missingArm=false,dissolve=0,animation=0,fallen=false}:{kind:ProceduralMonsterKind;headless?:boolean;missingArm?:boolean;dissolve?:number;animation?:number;fallen?:boolean}) {
  const root=useRef<THREE.Group>(null), torso=useRef<THREE.Group>(null), neck=useRef<THREE.Group>(null), leftArm=useRef<THREE.Group>(null),rightArm=useRef<THREE.Group>(null),leftLeg=useRef<THREE.Group>(null),rightLeg=useRef<THREE.Group>(null);
  const brute=kind==="brute",crawler=kind==="crawler";
  const color=kind==="brute"?"#88704c":kind==="spitter"?"#a17a58":"#815448";
  const geos=useMemo(()=>({
    torso:organicGeometry(1,[brute?.72:.55,crawler?.36:brute?.78:.64,.42]),
    head:organicGeometry(2,[brute?.52:.43,brute?.5:.43,.39]),
    shoulder:organicGeometry(3,[brute?.42:.29,.34,.36]),
    muscle:organicGeometry(4,[.28,.5,.22]),
    pelvis:organicGeometry(5,[brute?.54:.42,.34,.36]),
    hand:organicGeometry(6,[.22,.27,.18]),
    foot:organicGeometry(7,[.27,.16,.42]),
  }),[brute,crawler]);
  const opacity=THREE.MathUtils.clamp(1-dissolve,0,1);
  useFrame((_,dt)=>{
    const t=animation;
    const bob=crawler?Math.abs(Math.sin(t))*0.055:Math.sin(t*2)*0.035;
    if(root.current)root.current.position.y=fallen?-.58:bob;
    if(torso.current)torso.current.rotation.z=fallen?1.22:Math.sin(t*1.3)*.035;
    if(neck.current)neck.current.rotation.x=Math.sin(t*1.7)*.06;
    if(leftArm.current)leftArm.current.rotation.z=fallen?.8:Math.sin(t*1.6)*.12+0.15;
    if(rightArm.current)rightArm.current.rotation.z=fallen?-.8:-Math.sin(t*1.6)*.12-0.15;
    if(leftLeg.current)leftLeg.current.rotation.x=fallen?0:Math.sin(t*2)*.24;
    if(rightLeg.current)rightLeg.current.rotation.x=fallen?0:-Math.sin(t*2)*.24;
  });
  return <group ref={root} scale={[1,1,1]}>
    <group ref={torso}>
      <mesh position={[0,crawler?.62:.95,0]} geometry={geos.torso} castShadow><meshStandardMaterial color={color} roughness={.7} transparent={dissolve>0} opacity={opacity}/></mesh>
      <Flesh geometry={geos.pelvis} color={color}/>
      {[-1,1].map(side=><group key={side} position={[side*(brute?.55:.42),crawler?.65:1.03,0]}>
        <Flesh geometry={geos.shoulder} color={color}/>
        {side===1&&missingArm?null:<group ref={side<0?leftArm:rightArm} position={[side*.08,-.12,0]}>
          <Tendon from={[0,0,0]} to={[side*.16,-.48,.04]} r={brute?.21:.16} color={color}/>
          <Flesh geometry={geos.muscle} color={color}/>
          <group position={[side*.16,-.53,.04]}>
            <Tendon from={[0,0,0]} to={[side*.07,-.42,.08]} r={brute?.16:.13} color={color}/>
            <Flesh geometry={geos.hand} color={color}/>
            {Array.from({length:3},(_,i)=><Tendon key={i} from={[side*.05,-.12,.06]} to={[side*(.13+i*.055),-.35,.13]} r={.045} color={color}/>)}
          </group>
        </group>}
      </group>)}
      {[-1,1].map(side=><group key={"leg"+side} position={[side*(brute?.3:.23),crawler?.28:.42,0]}>
        <Flesh geometry={geos.pelvis} color={color}/>
        <group ref={side<0?leftLeg:rightLeg}>
          <Tendon from={[0,0,0]} to={[side*.04,-.55,.04]} r={brute?.22:.16} color={color}/>
          <Flesh geometry={geos.muscle} color={color}/>
          <group position={[side*.04,-.55,.04]}>
            <Tendon from={[0,0,0]} to={[0,-.48,.02]} r={brute?.18:.13} color={color}/>
            <mesh position={[0,-.48,.16]} geometry={geos.foot} castShadow><meshStandardMaterial color={color} roughness={.72}/></mesh>
          </group>
        </group>
      </group>)}
      {!headless&&<group ref={neck} position={[0,crawler?1.04:1.58,.03]}>
        <Flesh geometry={geos.head} color={color}/>
        <mesh position={[0,-.13,.29]} scale={[.55,.25,.15]}><sphereGeometry args={[1,20,14]}/><meshStandardMaterial color="#351016" roughness={.3}/></mesh>
        {[-1,1].map(s=><group key={s}>
          <mesh position={[s*.19,.1,.31]} scale={[.09,.12,.07]}><sphereGeometry args={[1,12,10]}/><meshStandardMaterial color="#ff552d" emissive="#a92710"/></mesh>
          {Array.from({length:3},(_,i)=><mesh key={i} position={[s*(.11+i*.08),-.21,.36]} rotation={[0,0,s*.12]}><coneGeometry args={[.045,.16,7]}/><meshStandardMaterial color="#e0d2b6"/></mesh>)}
        </group>)}
        {brute&&Array.from({length:4},(_,i)=><mesh key={i} position={[-.32+i*.21,.38,-.1]} rotation={[0,0,-.25]}><coneGeometry args={[.11,.38,7]}/><meshStandardMaterial color="#44302a"/></mesh>)}
        {kind==="spitter"&&<mesh position={[.22,-.26,.1]} scale={[.25,.38,.26]}><sphereGeometry args={[1,20,16]}/><meshPhysicalMaterial color="#8da454" roughness=.18 clearcoat={.9}/></mesh>}
      </group>}
      {/* Raised asymmetrical fleshy folds, nodules and ridges */}
      {Array.from({length:9},(_,i)=><mesh key={"lobe"+i} position={[Math.sin(i*2.1)*.43,.45+i*.13,.28-(i%3)*.05]} scale={[.16+(i%3)*.045,.09+(i%2)*.08,.08]} castShadow><sphereGeometry args={[1,20,14]}/><meshPhysicalMaterial color={i%2?"#98734c":"#76503e"} roughness=.25 clearcoat=.65 transparent={dissolve>0} opacity={opacity}/></mesh>)}
    </group>
  </group>;
}
