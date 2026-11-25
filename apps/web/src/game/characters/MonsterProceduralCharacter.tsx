import { useMemo, useRef, useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { createProceduralSurfaceMaps, createWebGPUSurfaceNodeMaterial } from "./proceduralSurfaceMaps";
import { WebGPURenderer } from "three/webgpu";
export type ProceduralMonsterKind="crawler"|"brute"|"spitter";
type Props={kind:ProceduralMonsterKind;headless?:boolean;missingArm?:boolean;dissolve?:number;animation?:number;fallen?:boolean;attackPulse?:number};
type Built={group:THREE.Group;mesh:THREE.SkinnedMesh;geometry:THREE.BufferGeometry;bones:THREE.Bone[];maps:ReturnType<typeof createProceduralSurfaceMaps>;material:THREE.MeshStandardMaterial;node:THREE.MeshStandardNodeMaterial;base:string};
function join(gs:THREE.BufferGeometry[]){let count=gs.reduce((a,g)=>a+g.attributes.position.count,0),p=new Float32Array(count*3),uv=new Float32Array(count*2);let k=0;for(const g of gs){const a=g.attributes.position,b=g.attributes.uv;for(let i=0;i<a.count;i++){p.set([a.getX(i),a.getY(i),a.getZ(i)],k*3);if(b)uv.set([b.getX(i),b.getY(i)],k*2);k++;}}const out=new THREE.BufferGeometry();out.setAttribute("position",new THREE.BufferAttribute(p,3));out.setAttribute("uv",new THREE.BufferAttribute(uv,2));return out;}
function build(kind:ProceduralMonsterKind):Built{
 const brute=kind==="brute",color=brute?"#8d7755":kind==="spitter"?"#a17b59":"#805448";
 const bones:THREE.Bone[]=[];const add=(name:string,parent:THREE.Bone|null,pos:THREE.Vector3)=>{const b=new THREE.Bone();b.name=name;b.position.copy(pos);parent?.add(b);bones.push(b);return b;};
 const root=add("root",null,new THREE.Vector3()),pelvis=add("pelvis",root,new THREE.Vector3(0,.42,0)),spine=add("spine",pelvis,new THREE.Vector3(0,.38,0)),chest=add("chest",spine,new THREE.Vector3(0,.4,0)),neck=add("neck",chest,new THREE.Vector3(0,.27,0)),head=add("head",neck,new THREE.Vector3(0,.22,0));
 for(const s of [-1,1]){const side=s<0?"left":"right";const sh=add(side+"Shoulder",chest,new THREE.Vector3(s*(brute?.57:.43),.1,0));const upper=add(side+"UpperArm",sh,new THREE.Vector3(s*.1,-.25,0));const fore=add(side+"Forearm",upper,new THREE.Vector3(s*.08,-.42,.04));add(side+"Hand",fore,new THREE.Vector3(s*.06,-.3,.05));const hip=add(side+"Hip",pelvis,new THREE.Vector3(s*(brute?.34:.26),-.12,0));const knee=add(side+"Knee",hip,new THREE.Vector3(s*.04,-.48,0));add(side+"Foot",knee,new THREE.Vector3(0,-.48,.12));}
 root.updateMatrixWorld(true);
 const specs:Array<[number,number,number,number,number,number,number]>=[
 [0,.95,0,brute?.72:.54,brute?.7:.62,.42,1],[0,.48,0,.45,.3,.36,2],[0,1.55,.02,.38,.32,.34,3],[0,1.85,.04,.43,.48,.38,4],
 ...[-1,1].flatMap(s=>[[s*.43,1.48,0,.3,.32,.34,5],[s*.57,1.05,.04,.18,.42,.22,6],[s*.65,.62,.05,.15,.36,.19,7],[s*.26,.35,0,.17,.46,.23,8],[s*.29,-.04,.04,.14,.42,.18,9],[s*.29,-.43,.16,.27,.16,.4,10]] as Array<[number,number,number,number,number,number,number]>),
 ...Array.from({length:18},(_,i)=>[Math.sin(i*2.3)*.42,.48+i*.075,.24,.14,.11,.09,11] as [number,number,number,number,number,number,number]);
 ];
 const geos=specs.map(([x,y,z,sx,sy,sz,seed])=>{const g=new THREE.SphereGeometry(1,64,48),a=g.attributes.position;for(let i=0;i<a.count;i++){const vx=a.getX(i),vy=a.getY(i),vz=a.getZ(i),n=1+.09*Math.sin(vx*11+seed)*Math.cos(vy*8+seed*1.4)*Math.sin(vz*7+seed);a.setXYZ(i,vx*sx*n+x,vy*sy*n+y,vz*sz*n+z);}a.needsUpdate=true;g.computeVertexNormals();return g;});
 const geo=join(geos),pos=geo.attributes.position,count=pos.count;
 const boneCenters=bones.map(b=>{const v=new THREE.Vector3();b.getWorldPosition(v);return v;});
 const si=new Uint16Array(count*4),sw=new Float32Array(count*4);
 for(let i=0;i<count;i++){const v=new THREE.Vector3(pos.getX(i),pos.getY(i),pos.getZ(i));let nearest=0,dmin=1e9;for(let j=0;j<boneCenters.length;j++){const d=v.distanceToSquared(boneCenters[j]);if(d<dmin){dmin=d;nearest=j;}}si[i*4]=nearest;sw[i*4]=1;}
 geo.setAttribute("skinIndex",new THREE.Uint16BufferAttribute(si,4));geo.setAttribute("skinWeight",new THREE.Float32BufferAttribute(sw,4));
 const morphs=["jawOpen","mouthSnarl","muscleFlex","bodySquash"].map(()=>new Float32Array(count*3));
 for(let i=0;i<count;i++){const x=pos.getX(i),y=pos.getY(i),z=pos.getZ(i);if(y>1.62&&z>.14){morphs[0][i*3+1]=-.14*Math.min(1,(y-1.62)*3);morphs[0][i*3+2]=.045;}if(y>1.58&&y<1.93&&z>.23){morphs[1][i*3+1]=.035*Math.sin(x*15);morphs[1][i*3+2]=.055;}if(Math.abs(x)>.48&&y>.55&&y<1.55){morphs[2][i*3]=x*.075;morphs[2][i*3+1]=-.04;}if(Math.abs(x)<.52&&y>.55&&y<1.5)morphs[3][i*3+1]=-.045;}
 geo.morphAttributes.position=morphs.map(a=>new THREE.Float32BufferAttribute(a,3));geo.morphTargetsRelative=true;geo.computeBoundingSphere();
 const maps=createProceduralSurfaceMaps("skin",2048,1);
 const material=new THREE.MeshStandardMaterial({color,normalMap:maps.normalMap,aoMap:maps.aoMap,roughnessMap:maps.roughnessMap,roughness:.72});
 const node=createWebGPUSurfaceNodeMaterial({baseColorHex:color,maps,normalScale:1,roughnessMultiplier:.9,aoIntensity:1.15,vertexColors:false});
 const mesh=new THREE.SkinnedMesh(geo,material);mesh.castShadow=true;mesh.receiveShadow=true;mesh.add(root);mesh.bind(new THREE.Skeleton(bones));mesh.updateMorphTargets();
 const group=new THREE.Group();group.add(mesh);return{group,mesh,geometry:geo,bones,maps,material,node,base:color};
}
export default function MonsterProceduralCharacter({kind,headless=false,missingArm=false,dissolve=0,animation=0,fallen=false,attackPulse=0}:Props){
 const root=useRef<THREE.Group>(null),{gl}=useThree();const rig=useMemo(()=>build(kind),[kind]);const isGPU=gl instanceof WebGPURenderer;
 useEffect(()=>{if(isGPU)rig.mesh.material=rig.node;return()=>{rig.geometry.dispose();rig.maps.dispose();rig.material.dispose();rig.node.dispose();};},[rig,isGPU]);
 useFrame(()=>{const t=animation,p=THREE.MathUtils.clamp(attackPulse,0,1),b=rig.bones;const get=(n:string)=>b.find(x=>x.name===n);const head=get("head"),neck=get("neck"),chest=get("chest"),spine=get("spine");if(head){head.rotation.x=Math.sin(t*2)*.05-p*.24;head.scale.setScalar(headless?0:1);}if(neck)neck.rotation.x=Math.sin(t*1.6)*.07;if(chest){chest.rotation.x=Math.sin(t*2)*.045-p*.15;chest.rotation.z=Math.sin(t)*.035;}if(spine)spine.rotation.z=Math.sin(t*.8)*.03;for(const side of ["left","right"]){const sign=side==="left"?1:-1,arm=get(side+"UpperArm"),fore=get(side+"Forearm"),hip=get(side+"Hip"),knee=get(side+"Knee");if(arm){arm.rotation.z=(fallen?sign*.65:Math.sin(t*1.6+sign)*.15)+p*sign*.7;if(missingArm&&side==="right")arm.scale.setScalar(0);else arm.scale.setScalar(1);}if(fore)fore.rotation.x=p*.4;if(hip)hip.rotation.x=fallen?0:Math.sin(t*2+sign)*.24;if(knee)knee.rotation.x=fallen?0:Math.max(0,-Math.sin(t*2+sign))*.3;}const m=rig.mesh.morphTargetInfluences;if(m){m[0]=p*.7;m[1]=p;m[2]=p*.85+Math.abs(Math.sin(t))*.12;m[3]=fallen?.65:p*.55;}rig.material.transparent=dissolve>0;rig.material.opacity=1-dissolve;rig.node.opacity=1-dissolve;rig.node.transparent=dissolve>0;if(root.current){root.current.position.y=fallen?-.5:Math.abs(Math.sin(t))* .04;root.current.rotation.z=fallen?1.15:0;root.current.scale.setScalar(1-dissolve*.25);}}
 );
 return <group ref={root} scale={kind==="brute"?[1.18,1.15,1.12]:kind==="crawler"?[.95,.82,1]:[1,1,1]}>{!headless&&null}<primitive object={rig.group}/>{missingArm&&<group position={[.75,1.1,0]} scale={[.18,.4,.18]}><mesh><sphereGeometry args={[1,24,16]}/><meshStandardMaterial color="#592820"/></mesh>}</group>;
}
