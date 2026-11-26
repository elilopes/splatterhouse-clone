import * as THREE from "three";

function Stone({position,scale,color="#29252a",rotation}:{position:[number,number,number];scale:[number,number,number];color?:string;rotation?:[number,number,number]}) {
  return <mesh position={position} scale={scale} rotation={rotation} castShadow receiveShadow><boxGeometry args={[1,1,1]}/><meshStandardMaterial color={color} roughness={0.94}/></mesh>;
}
function WallTorch({position}:{position:[number,number,number]}) {
  return <group position={position}>
    <mesh position={[0,0.42,0]}><cylinderGeometry args={[0.045,0.07,0.65,8]}/><meshStandardMaterial color="#39251d"/></mesh>
    <mesh position={[0,0.83,0]}><sphereGeometry args={[0.12,10,8]}/><meshBasicMaterial color="#ff8a36"/></mesh>
    <pointLight position={[0,0.9,0]} color="#ff7137" intensity={2.1} distance={6}/>
  </group>;
}

export function MansionBasement() {
  return <group>
    <color attach="background" args={["#080709"]}/>
    <Stone position={[0,-0.35,0]} scale={[13,0.7,42]} color="#29252a"/>
    <Stone position={[0,3.35,-20.7]} scale={[13,7,0.8]} color="#252127"/>
    <Stone position={[-6.3,3.1,0]} scale={[0.7,6.4,42]} color="#211d23"/>
    <Stone position={[6.3,3.1,0]} scale={[0.7,6.4,42]} color="#211d23"/>
    {Array.from({length:7},(_,i)=><group key={i} position={[i%2?-5.25:5.25,0,-16+i*5.1]}>
      <Stone position={[0,1.55,0]} scale={[0.25,3.1,3.9]} color="#423a40"/>
      {[-1.1,-0.55,0,0.55,1.1].map(x=><mesh key={x} position={[x,1.55,0.16]}><cylinderGeometry args={[0.035,0.035,2.8,7]}/><meshStandardMaterial color="#70666b" metalness={0.7} roughness={0.42}/></mesh>)}
      <Stone position={[0,3.05,0]} scale={[2.5,0.18,0.25]} color="#66595f"/>
      <Stone position={[0,0.38,-1.38]} scale={[1.5,0.5,1.0]} color="#51474c"/>
    </group>)}
    {Array.from({length:9},(_,i)=><group key={i} position={[-5.4+i*1.35,5.15,-17+(i%3)*13]}>
      <mesh rotation={[0,0,Math.PI/2]}><cylinderGeometry args={[0.11,0.11,1.25,10]}/><meshStandardMaterial color="#4c5657" metalness={0.72} roughness={0.36}/></mesh>
      <mesh position={[0,-0.5,0]}><cylinderGeometry args={[0.035,0.035,0.8,8]}/><meshStandardMaterial color="#3d4748" metalness={0.6}/></mesh>
    </group>)}
    {[-15,-6,3,12].map(z=><WallTorch key={z} position={[-5.5,2.45,z]}/>)}
    {[-11,-1,9].map(z=><WallTorch key={z} position={[5.5,2.45,z]}/>)}
    <group position={[0,0,-17.5]}>
      <Stone position={[0,1.5,0]} scale={[4.8,3,0.55]} color="#171317"/>
      <Stone position={[0,3.1,0]} scale={[5.1,0.2,0.8]} color="#66575a"/>
      <mesh position={[0,1.5,0.31]}><planeGeometry args={[2.6,1.8]}/><meshStandardMaterial color="#4a2025" emissive="#28080c" emissiveIntensity={0.7}/></mesh>
      <Stone position={[-3.25,0.48,0]} scale={[0.4,0.96,0.65]} color="#594a4d"/>
      <Stone position={[3.25,0.48,0]} scale={[0.4,0.96,0.65]} color="#594a4d"/>
    </group>
    <Stone position={[0,2.25,5.8]} scale={[4.5,0.24,0.55]} color="#55474b"/>
    <Stone position={[-1.35,1.0,5.8]} scale={[0.18,2,0.18]} color="#8b7774"/>
    <Stone position={[1.35,1.0,5.8]} scale={[0.18,2,0.18]} color="#8b7774"/>
    <pointLight position={[0,4,-16]} intensity={2.6} color="#a52f3b" distance={13}/>
  </group>;
}

export function UndergroundDungeon() {
  return <group>
    <color attach="background" args={["#08090c"]}/>
    <Stone position={[0,-0.35,0]} scale={[16,0.7,42]} color="#29272a"/>
    <Stone position={[0,6.35,0]} scale={[16,0.65,42]} color="#17171b"/>
    <Stone position={[-7.7,2.7,0]} scale={[0.9,5.7,42]} color="#302b30"/>
    <Stone position={[7.7,2.7,0]} scale={[0.9,5.7,42]} color="#302b30"/>
    {Array.from({length:8},(_,i)=><group key={i} position={[i%2?-4.8:4.8,0,-15+Math.floor(i/2)*9.5]}>
      <mesh position={[0,1.65,0]}><cylinderGeometry args={[0.62,0.82,3.3,7]}/><meshStandardMaterial color="#51494d" roughness={1}/></mesh>
      <mesh position={[0,3.35,0]}><cylinderGeometry args={[0.95,0.95,0.28,7]}/><meshStandardMaterial color="#77686b"/></mesh>
    </group>)}
    {Array.from({length:28},(_,i)=><mesh key={i} position={[-6+(i*1.91)%12,5.5-(0.8+(i%5)*0.28)/2,-17+(i*3.17)%34]}><coneGeometry args={[0.22+(i%3)*0.06,0.8+(i%5)*0.28,6]}/><meshStandardMaterial color="#39343a"/></mesh>)}
    {[-14,-5,4,13].map(z=><group key={z}><WallTorch position={[-6.7,2,z]}/><WallTorch position={[6.7,2,z]}/></group>)}
    {[-10,1,12].map(z=><group key={z} position={[0,0,z]}>
      <Stone position={[0,0.14,0]} scale={[5.2,0.28,2.2]} color="#494146"/>
      {Array.from({length:7},(_,i)=><mesh key={i} position={[-2+i*0.66,0.52,0]}><coneGeometry args={[0.23,0.7,4]}/><meshStandardMaterial color="#8b7779" metalness={0.25}/></mesh>)}
    </group>)}
    <group position={[0,0,-17.3]}>
      <Stone position={[0,2.2,0]} scale={[6.5,4.4,0.9]} color="#211c22"/>
      <mesh position={[0,2.2,0.52]}><circleGeometry args={[1.5,14]}/><meshStandardMaterial color="#5b1b28" emissive="#3b0710" emissiveIntensity={1.1}/></mesh>
      <mesh position={[0,2.2,0.6]}><torusGeometry args={[1.95,0.14,8,18]}/><meshStandardMaterial color="#92745c" metalness={0.35}/></mesh>
    </group>
  </group>;
}

export function HauntedCemetery() {
  return <group>
    <color attach="background" args={["#090b12"]}/>
    <Stone position={[0,-0.3,0]} scale={[84,0.6,18]} color="#29272a"/>
    <mesh position={[0,0.02,0]} rotation={[-Math.PI/2,0,0]}><planeGeometry args={[84,18]}/><meshStandardMaterial color="#37302d" roughness={1}/></mesh>
    {Array.from({length:25},(_,i)=>{
      const x=-31+i*2.55,z=(i%3-1)*1.0,broken=i%6===0;
      return <group key={i} position={[x,0,z]} rotation={[0,(i%5-2)*0.07,0]}>
        <mesh position={[0,0.65,0]} rotation={[broken?0.18:0,0,0]} castShadow><boxGeometry args={[0.82,1.3,0.24]}/><meshStandardMaterial color={broken?"#4b4548":"#777174"} roughness={1}/></mesh>
        <mesh position={[0,1.34,0]}><boxGeometry args={[0.98,0.14,0.32]}/><meshStandardMaterial color="#5c5559"/></mesh>
        {broken&&<mesh position={[0.28,0.36,0.2]} rotation={[0.2,0.2,0.5]}><boxGeometry args={[0.4,0.12,0.13]}/><meshStandardMaterial color="#70666a"/></mesh>}
      </group>;
    })}
    {Array.from({length:10},(_,i)=><group key={i} position={[-29+i*6.5,0,-2.6-(i%2)*0.45]} rotation={[0,0,(i%2?1:-1)*0.18]}>
      <mesh position={[0,2.3,0]}><cylinderGeometry args={[0.18,0.42,4.6,7]}/><meshStandardMaterial color="#211c1d"/></mesh>
      {[-1,1].map(side=><mesh key={side} position={[side*0.78,3.35,0]} rotation={[0,0,-side*0.72]}><cylinderGeometry args={[0.07,0.15,2.0,6]}/><meshStandardMaterial color="#211c1d"/></mesh>)}
    </group>)}
    <group position={[25,0,-0.7]}>
      <mesh position={[0,1.7,0]}><boxGeometry args={[7,3.4,2.8]}/><meshStandardMaterial color="#39333a" roughness={1}/></mesh>
      <mesh position={[0,3.55,0]}><coneGeometry args={[4.2,1.2,4]}/><meshStandardMaterial color="#28222a"/></mesh>
      <mesh position={[0,1.7,1.45]}><planeGeometry args={[2.1,2.5]}/><meshStandardMaterial color="#120f14" emissive="#321017" emissiveIntensity={0.6}/></mesh>
    </group>
    {[-24,-11,2,15,29].map(x=><pointLight key={x} position={[x,3.7,-3]} color="#95617f" intensity={0.9} distance={11}/>)}
  </group>;
}
