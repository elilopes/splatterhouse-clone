import { useEffect, useRef } from "react";
import {
  Camera, Color3, Engine, HemisphericLight, Mesh, MeshBuilder,
  Scene, StandardMaterial, Vector3, FreeCamera, DirectionalLight, TransformNode
} from "@babylonjs/core";
import { RickProcedural } from "./characters/RickProcedural";

type Props = {
  onScore: (points: number) => void;
  onKill: () => void;
  paused: boolean;
  onStageChange: (stage: 1 | 2) => void;
};

type WeaponId = "pipe" | "machete" | "shotgun";
type Enemy = {
  root: TransformNode;
  body: Mesh;
  head: Mesh;
  health: number;
  alive: boolean;
  velocity: Vector3;
  attackCooldown: number;
  crushed: boolean;
};

const mat = (scene: Scene, name: string, color: Color3, emissive?: Color3) => {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = color;
  m.specularColor = new Color3(0.08, 0.08, 0.08);
  if (emissive) m.emissiveColor = emissive;
  return m;
};

function box(scene: Scene, name: string, size: {width:number;height:number;depth:number}, pos: Vector3, material: StandardMaterial) {
  const m = MeshBuilder.CreateBox(name, size, scene);
  m.position.copyFrom(pos); m.material = material; m.isPickable = false; return m;
}

function buildExterior(scene: Scene) {
  const ground = mat(scene, "mud-ground", new Color3(0.105, 0.09, 0.075));
  const wall = mat(scene, "slime-wall", new Color3(0.17, 0.24, 0.13));
  const slime = mat(scene, "slime-drips", new Color3(0.31, 0.42, 0.17));
  const bark = mat(scene, "tree-bark", new Color3(0.12, 0.075, 0.055));
  const leaves = mat(scene, "dead-leaves", new Color3(0.10, 0.15, 0.09));
  const stone = mat(scene, "mansion-stone", new Color3(0.22, 0.20, 0.19));
  const trim = mat(scene, "mansion-trim", new Color3(0.07, 0.065, 0.07));
  const windowMat = mat(scene, "lit-windows", new Color3(0.34, 0.13, 0.075), new Color3(0.16, 0.035, 0.012));
  const doorMat = mat(scene, "front-door", new Color3(0.075, 0.025, 0.025));
  const moon = mat(scene, "moon", new Color3(0.48, 0.48, 0.42), new Color3(0.2, 0.2, 0.16));

  const floor = MeshBuilder.CreateGround("exterior-ground", {width:34,height:7}, scene);
  floor.position.set(0,0,0); floor.material = ground; floor.isPickable = false;
  box(scene,"slimy-boundary-wall",{width:13,height:4.8,depth:0.55},new Vector3(-10,2.35,2.0),wall);
  for(let i=0;i<12;i++){
    const x=-16+i*1.08;
    const drip=MeshBuilder.CreateCylinder(`slime-drip-${i}`,{height:0.45+(i%4)*0.2,diameter:0.16+(i%3)*0.06,tessellation:6},scene);
    drip.position.set(x,4.15-(i%3)*0.18,1.68); drip.material=slime; drip.isPickable=false;
  }
  for(let i=0;i<6;i++){
    const pool=MeshBuilder.CreateSphere(`slime-pool-${i}`,{diameter:0.5,segments:6},scene);
    pool.scaling.set(1.6,0.22,0.65); pool.position.set(-15+i*1.6,0.1,1.35); pool.material=slime; pool.isPickable=false;
  }
  for(let i=0;i<9;i++){
    const x=-1.8+i*1.35;
    const trunk=MeshBuilder.CreateCylinder(`tree-trunk-${i}`,{height:4.3+(i%3)*0.55,diameter:0.32+(i%2)*0.1,tessellation:6},scene);
    trunk.position.set(x,2.15,2.6+(i%2)*0.55); trunk.material=bark; trunk.isPickable=false;
    for(let b=0;b<3;b++){
      const branch=MeshBuilder.CreateCylinder(`tree-branch-${i}-${b}`,{height:1.8,diameter:0.14,tessellation:5},scene);
      branch.position.set(x+(b-1)*0.55,3.35+(b%2)*0.45,2.55); branch.rotation.z=(b-1)*0.65; branch.material=bark; branch.isPickable=false;
    }
    const canopy=MeshBuilder.CreateSphere(`tree-foliage-${i}`,{diameter:1.8,segments:5},scene);
    canopy.position.set(x,4.05,2.8); canopy.scaling.y=0.7; canopy.material=leaves; canopy.isPickable=false;
  }
  box(scene,"mansion-facade",{width:12,height:7,depth:1.0},new Vector3(11,3.45,2.3),stone);
  box(scene,"mansion-roof",{width:13.2,height:0.55,depth:1.5},new Vector3(11,7.15,2.2),trim);
  for(const x of [7.2,10.2,13.2,16.2]){
    box(scene,`mansion-window-${x}`,{width:1.25,height:2.0,depth:0.08},new Vector3(x,4.35,1.72),windowMat);
    box(scene,`mansion-window-frame-${x}`,{width:1.48,height:2.22,depth:0.12},new Vector3(x,4.35,1.82),trim);
    box(scene,`mansion-window-inset-${x}`,{width:1.15,height:1.9,depth:0.05},new Vector3(x,4.35,1.64),windowMat);
  }
  box(scene,"door-frame",{width:2.5,height:3.6,depth:0.28},new Vector3(11,1.8,1.58),trim);
  box(scene,"mansion-door",{width:1.9,height:3.15,depth:0.18},new Vector3(11,1.62,1.38),doorMat);
  const knob=MeshBuilder.CreateSphere("door-knob",{diameter:0.13,segments:8},scene); knob.position.set(11.65,1.55,1.25); knob.material=moon; knob.isPickable=false;
  const orb=MeshBuilder.CreateSphere("moon-disc",{diameter:2.1,segments:12},scene); orb.position.set(-9,8,5); orb.material=moon; orb.isPickable=false;
  for(let i=0;i<10;i++){
    const silhouette=MeshBuilder.CreateSphere(`distant-shrub-${i}`,{diameter:2.2,segments:5},scene);
    silhouette.position.set(-16+i*3.3,0.8,5.5); silhouette.scaling.y=0.7; silhouette.material=trim; silhouette.isPickable=false;
  }
  return { doorX: 10.7 };
}

function buildInterior(scene: Scene) {
  const floorMat=mat(scene,"hall-floor",new Color3(0.16,0.12,0.105));
  const wallMat=mat(scene,"hall-wall",new Color3(0.19,0.16,0.15));
  const dark=mat(scene,"hall-dark-wood",new Color3(0.055,0.035,0.03));
  const red=mat(scene,"hall-red-glow",new Color3(0.28,0.045,0.035),new Color3(0.12,0.012,0.008));
  const gold=mat(scene,"hall-gold",new Color3(0.38,0.25,0.11));
  const floor=MeshBuilder.CreateGround("mansion-hall-floor",{width:18,height:7},scene); floor.material=floorMat; floor.isPickable=false;
  box(scene,"hall-back-wall",{width:18,height:7,depth:0.5},new Vector3(0,3.45,2.5),wallMat);
  box(scene,"hall-ceiling-beam",{width:18,height:0.35,depth:3.5},new Vector3(0,6.8,0.8),dark);
  for(const x of [-7,-3,1,5,8]){
    box(scene,`hall-panel-${x}`,{width:1.8,height:4.8,depth:0.12},new Vector3(x,3.0,2.18),dark);
    box(scene,`hall-sconce-${x}`,{width:0.28,height:0.7,depth:0.2},new Vector3(x,4.2,1.95),gold);
    const light=MeshBuilder.CreateSphere(`hall-lamp-${x}`,{diameter:0.34,segments:8},scene); light.position.set(x,4.45,1.9); light.material=red; light.isPickable=false;
  }
  for(const x of [-5,0,5]){
    box(scene,`portrait-frame-${x}`,{width:1.35,height:1.65,depth:0.16},new Vector3(x,4.65,2.08),gold);
    box(scene,`portrait-shadow-${x}`,{width:1.08,height:1.38,depth:0.08},new Vector3(x,4.65,1.96),dark);
  }
  box(scene,"hall-table-top",{width:2.4,height:0.22,depth:0.85},new Vector3(-4,1.0,0.65),dark);
  for(const x of [-4.9,-3.1]) box(scene,`hall-table-leg-${x}`,{width:0.18,height:1.0,depth:0.18},new Vector3(x,0.5,0.65),dark);
  box(scene,"hall-stair-platform",{width:3.3,height:0.45,depth:1.1},new Vector3(6.8,0.22,0.85),dark);
  box(scene,"interior-exit-frame",{width:2.2,height:3.5,depth:0.25},new Vector3(8.1,1.75,1.9),gold);
  box(scene,"interior-exit-dark",{width:1.8,height:3.15,depth:0.12},new Vector3(8.1,1.58,1.72),dark);
}

function makeEnemy(scene: Scene, x: number, z: number, skin: StandardMaterial, eyes: StandardMaterial): Enemy {
  const root = new TransformNode("slime-creature-root", scene);
  root.position.set(x, 0, z);
  const body = MeshBuilder.CreateCapsule("slime-creature-body", {height:1.55, radius:0.42, tessellation:7, subdivisions:1}, scene);
  body.parent=root; body.position.y=0.83; body.material=skin; body.isPickable=false;
  const head = MeshBuilder.CreateSphere("slime-creature-head", {diameter:0.76, segments:7}, scene);
  head.parent=root; head.position.set(0,1.72,-0.02); head.material=skin; head.isPickable=false;
  for(const side of [-1,1]){
    const eye=MeshBuilder.CreateSphere("slime-creature-eye",{diameter:0.12,segments:5},scene);
    eye.parent=root; eye.position.set(side*0.16,1.78,-0.34); eye.material=eyes; eye.isPickable=false;
  }
  return {root,body,head,health:2,alive:true,velocity:Vector3.Zero(),attackCooldown:0,crushed:false};
}

function makeWeapon(scene: Scene, id: WeaponId, position: Vector3, metal: StandardMaterial, wood: StandardMaterial, glow: StandardMaterial) {
  const root = new TransformNode(`pickup-${id}`, scene);
  root.position.copyFrom(position);
  const parts: Mesh[] = [];
  if(id==="pipe"){
    const shaft=MeshBuilder.CreateCylinder("pickup-pipe-shaft",{height:1.35,diameter:0.105,tessellation:8},scene);
    shaft.rotation.z=Math.PI/2; shaft.position.y=0.1; shaft.material=metal; parts.push(shaft);
    const grip=MeshBuilder.CreateCylinder("pickup-pipe-grip",{height:0.32,diameter:0.13,tessellation:8},scene);
    grip.rotation.z=Math.PI/2; grip.position.set(-0.35,0.1,0); grip.material=wood; parts.push(grip);
  } else if(id==="machete"){
    const blade=MeshBuilder.CreateBox("pickup-machete-blade",{width:0.92,height:0.075,depth:0.055},scene);
    blade.position.set(0.35,0.13,0); blade.material=metal; parts.push(blade);
    const handle=MeshBuilder.CreateCylinder("pickup-machete-handle",{height:0.34,diameter:0.12,tessellation:8},scene);
    handle.rotation.z=Math.PI/2; handle.position.set(-0.28,0.13,0); handle.material=wood; parts.push(handle);
  } else {
    const barrel=MeshBuilder.CreateCylinder("pickup-shotgun-barrel",{height:1.05,diameter:0.09,tessellation:8},scene);
    barrel.rotation.z=Math.PI/2; barrel.position.set(0.12,0.18,0); barrel.material=metal; parts.push(barrel);
    const stock=MeshBuilder.CreateBox("pickup-shotgun-stock",{width:0.45,height:0.14,depth:0.14},scene);
    stock.position.set(-0.58,0.12,0); stock.material=wood; parts.push(stock);
    const pump=MeshBuilder.CreateBox("pickup-shotgun-pump",{width:0.28,height:0.15,depth:0.16},scene);
    pump.position.set(-0.02,0.04,0); pump.material=wood; parts.push(pump);
  }
  const marker=MeshBuilder.CreateTorus(`pickup-${id}-ring`,{diameter:1.15,thickness:0.035,tessellation:20},scene);
  marker.rotation.x=Math.PI/2; marker.position.y=0.04; marker.material=glow; parts.push(marker);
  for(const part of parts){part.parent=root;part.isPickable=false;}
  return root;
}

function addImpact(scene: Scene, position: Vector3, material: StandardMaterial) {
  for(let i=0;i<7;i++){
    const drop=MeshBuilder.CreateSphere("impact-gore",{diameter:0.12+Math.random()*0.16,segments:5},scene);
    drop.position.set(position.x+(Math.random()-0.5)*0.9,0.08,position.z+(Math.random()-0.5)*0.55);
    drop.scaling.y=0.28; drop.material=material; drop.isPickable=false;
  }
}

export default function GameView({ onScore, onKill, paused, onStageChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const callbacks = useRef({ onScore, onKill, onStageChange });
  callbacks.current = { onScore, onKill, onStageChange };
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: true, adaptToDeviceRatio: true });
    const scene = new Scene(engine);
    scene.clearColor.set(0.018,0.016,0.023,1);
    new HemisphericLight("ambient",new Vector3(0,1,0),scene).intensity=0.72;
    const keyLight=new DirectionalLight("moonlight",new Vector3(-0.35,-1,0.25),scene); keyLight.intensity=0.75;

    let phase: 1 | 2 = 1;
    let transitionLock=false;
    let facing=1;
    let equipped: WeaponId | null=null;
    let attackCooldown=0;
    let grabCooldown=0;
    let shotgunAmmo=6;
    let interiorBuilt=false;
    const camera=new FreeCamera("side-camera",new Vector3(-14,3.3,-16),scene);
    camera.setTarget(new Vector3(-14,1.8,0));
    camera.mode=Camera.ORTHOGRAPHIC_CAMERA;
    const updateCameraBounds=()=>{
      const aspect=engine.getRenderWidth()/Math.max(1,engine.getRenderHeight());
      const halfH=4.6; camera.orthoTop=halfH; camera.orthoBottom=-halfH; camera.orthoLeft=-halfH*aspect; camera.orthoRight=halfH*aspect;
    };
    updateCameraBounds();
    const exterior=buildExterior(scene);
    const exteriorMeshes=[...scene.meshes];
    const rick=new RickProcedural(scene);
    const player=rick.root;
    player.position.set(-14,0,0);
    const keys=new Set<string>();
    const enemies: Enemy[]=[];
    const enemySkin=mat(scene,"enemy-flesh",new Color3(0.28,0.34,0.19));
    const enemyEyes=mat(scene,"enemy-eyes",new Color3(0.65,0.04,0.025),new Color3(0.25,0.01,0.005));
    const blood=mat(scene,"enemy-blood",new Color3(0.25,0.012,0.018));
    const metal=mat(scene,"weapon-metal",new Color3(0.42,0.43,0.40));
    const wood=mat(scene,"weapon-grip",new Color3(0.16,0.075,0.045));
    const pickupGlow=mat(scene,"weapon-pickup-glow",new Color3(0.65,0.16,0.08),new Color3(0.28,0.025,0.008));
    const pickups: {id:WeaponId;root:TransformNode;collected:boolean}[]=[
      {id:"pipe",root:makeWeapon(scene,"pipe",new Vector3(-7.3,0.15,0),metal,wood,pickupGlow),collected:false},
      {id:"machete",root:makeWeapon(scene,"machete",new Vector3(0.9,0.15,0),metal,wood,pickupGlow),collected:false},
      {id:"shotgun",root:makeWeapon(scene,"shotgun",new Vector3(8.1,0.15,0),metal,wood,pickupGlow),collected:false}
    ];
    const heldWeapon=new TransformNode("rick-held-weapon",scene);
    heldWeapon.parent=player; heldWeapon.position.set(0.58,1.0,-0.22); heldWeapon.rotation.z=-0.15;
    const heldParts: Mesh[]=[];
    const makeHeldWeapon=(id:WeaponId)=>{
      heldParts.forEach(m=>m.dispose()); heldParts.length=0;
      const add=(m:Mesh)=>{m.parent=heldWeapon;m.isPickable=false;heldParts.push(m);};
      if(id==="pipe"){
        const m=MeshBuilder.CreateCylinder("held-pipe",{height:1.35,diameter:0.105,tessellation:8},scene);m.rotation.z=Math.PI/2;m.material=metal;add(m);
      } else if(id==="machete"){
        const blade=MeshBuilder.CreateBox("held-machete-blade",{width:0.92,height:0.075,depth:0.055},scene);blade.position.x=0.38;blade.material=metal;add(blade);
        const handle=MeshBuilder.CreateCylinder("held-machete-handle",{height:0.34,diameter:0.12,tessellation:8},scene);handle.rotation.z=Math.PI/2;handle.position.x=-0.22;handle.material=wood;add(handle);
      } else {
        const barrel=MeshBuilder.CreateCylinder("held-shotgun-barrel",{height:1.05,diameter:0.09,tessellation:8},scene);barrel.rotation.z=Math.PI/2;barrel.position.x=0.12;barrel.material=metal;add(barrel);
        const stock=MeshBuilder.CreateBox("held-shotgun-stock",{width:0.45,height:0.14,depth:0.14},scene);stock.position.x=-0.58;stock.material=wood;add(stock);
      }
      heldWeapon.setEnabled(true);
    };
    heldWeapon.setEnabled(false);
    const spawnEnemy=(x:number,z:number)=>enemies.push(makeEnemy(scene,x,z,enemySkin,enemyEyes));
    [-11.2,-9.4,-4.6,-2.8,2.6,4.4,7.0,9.2].forEach((x,i)=>spawnEnemy(x,i%2===0?-0.75:0.75));
    const buildRoom=()=>{if(interiorBuilt)return;interiorBuilt=true;buildInterior(scene);};
    const nearestEnemy=(range:number)=>{
      let found:Enemy|null=null;let distance=range;
      for(const enemy of enemies){if(!enemy.alive)continue;const d=Vector3.Distance(player.position,enemy.root.position);if(d<distance){distance=d;found=enemy;}}
      return found;
    };
    const killEnemy=(enemy:Enemy)=>{
      if(!enemy.alive)return;enemy.alive=false;enemy.root.setEnabled(false);
      callbacks.current.onKill();callbacks.current.onScore(100);
    };
    const damageEnemy=(enemy:Enemy,kind:"hands"|"pipe"|"machete"|"shotgun"|"throw")=>{
      if(!enemy.alive)return;
      if(kind==="pipe"){
        enemy.health=1;enemy.velocity.x=facing*20;enemy.root.position.x+=facing*0.55;
        enemy.body.scaling.y=0.9;enemy.root.position.y=0;
      } else if(kind==="machete"){
        enemy.health=0;
        enemy.head.parent=null;enemy.head.position.copyFrom(enemy.root.position.add(new Vector3(0,1.7,0)));
        enemy.head.position.x+=facing*0.2;enemy.head.position.y+=0.3;
        enemy.head.rotation.z=facing*0.7;enemy.head.scaling.set(0.82,0.82,0.82);
        enemy.head.metadata={velocity:new Vector3(facing*8,3.2,0),headProjectile:true};
        enemy.body.scaling.y=0.72;enemy.root.scaling.y=0.72;
        addImpact(scene,enemy.root.position,blood);
      } else if(kind==="shotgun"){
        enemy.health=0;enemy.head.setEnabled(false);addImpact(scene,enemy.root.position,blood);
        for(let i=0;i<10;i++){
          const fragment=MeshBuilder.CreateSphere("shotgun-head-fragment",{diameter:0.09+Math.random()*0.12,segments:5},scene);
          fragment.position.set(enemy.root.position.x,1.7,enemy.root.position.z);
          fragment.material=blood;fragment.isPickable=false;
          fragment.metadata={velocity:new Vector3((Math.random()-0.5)*7,Math.random()*5,(Math.random()-0.5)*3)};
        }
      } else {
        enemy.health-=kind==="throw"?2:1;
        enemy.velocity.x=facing*(kind==="throw"?7:3.2);
        if(enemy.health<=0)addImpact(scene,enemy.root.position,blood);
      }
      if(enemy.health<=0)killEnemy(enemy);
    };
    const pickupWeapon=()=>{
      const candidate=pickups.find(p=>!p.collected);
      if(!candidate||Vector3.Distance(player.position,candidate.root.position)>=1.35)return;
      candidate.collected=true;candidate.root.setEnabled(false);equipped=candidate.id;makeHeldWeapon(candidate.id);
    };
    const attack=()=>{
      if(attackCooldown>0)return;
      attackCooldown=equipped==="shotgun"?0.7:0.48;rick.playAttack();
      if(equipped==="shotgun"){
        if(shotgunAmmo<=0)return;shotgunAmmo--;
        const target=nearestEnemy(7.0);
        if(target&&Math.sign(target.root.position.x-player.position.x)===facing)damageEnemy(target,"shotgun");
        return;
      }
      const target=nearestEnemy(equipped==="pipe"?2.0:equipped==="machete"?2.0:1.65);
      if(!target||Math.sign(target.root.position.x-player.position.x)!==facing)return;
      damageEnemy(target,equipped??"hands");
    };
    const grabAndThrow=()=>{
      if(grabCooldown>0)return;grabCooldown=0.85;
      const target=nearestEnemy(1.65);if(!target)return;
      target.velocity.x=facing*8;target.velocity.z=(target.root.position.z-player.position.z)*2;
      target.root.position.x+=facing*0.35;
      damageEnemy(target,"throw");
    };
    const keyDown=(e:KeyboardEvent)=>{
      const key=e.key.toLowerCase();keys.add(key);
      if(["arrowleft","arrowright","arrowup","arrowdown"," "].includes(key))e.preventDefault();
      if(key==="j")attack();
      if(key==="k")grabAndThrow();
      if(key==="e")pickupWeapon();
    };
    const keyUp=(e:KeyboardEvent)=>keys.delete(e.key.toLowerCase());
    window.addEventListener("keydown",keyDown);window.addEventListener("keyup",keyUp);
    let last=performance.now();
    engine.runRenderLoop(()=>{
      const now=performance.now();const dt=Math.min((now-last)/1000,0.045);last=now;
      if(!pausedRef.current){
        attackCooldown=Math.max(0,attackCooldown-dt);grabCooldown=Math.max(0,grabCooldown-dt);
        const horizontal=Number(keys.has("d")||keys.has("arrowright"))-Number(keys.has("a")||keys.has("arrowleft"));
        const depth=Number(keys.has("s")||keys.has("arrowdown"))-Number(keys.has("w")||keys.has("arrowup"));
        const move=new Vector3(horizontal,0,depth);
        if(move.lengthSquared()>0){
          move.normalize();player.position.x+=move.x*4.25*dt;
          player.position.z=Math.max(-1.35,Math.min(1.35,player.position.z+move.z*2.1*dt));
          if(horizontal!==0)facing=horizontal>0?1:-1;
          player.rotation.y=facing>0?-Math.PI/2:Math.PI/2;
        }
        rick.update(dt,move.lengthSquared()>0);
        pickups.forEach(p=>{if(!p.collected){p.root.rotation.y+=dt*0.65;p.root.position.y=0.15+Math.sin(now*0.002+p.root.position.x)*0.06;}});
        for(const enemy of enemies){
          if(!enemy.alive)continue;
          enemy.attackCooldown=Math.max(0,enemy.attackCooldown-dt);
          if(Math.abs(enemy.velocity.x)>0.08){
            enemy.root.position.x+=enemy.velocity.x*dt;enemy.root.position.z+=enemy.velocity.z*dt;
            enemy.velocity.scaleInPlace(Math.max(0,1-dt*(equipped==="pipe"?1.5:2.8)));
          } else if(phase===1){
            const dx=player.position.x-enemy.root.position.x;
            if(Math.abs(dx)>0.85)enemy.root.position.x+=Math.sign(dx)*1.15*dt;
            const dz=player.position.z-enemy.root.position.z;
            enemy.root.position.z+=Math.sign(dz)*Math.min(Math.abs(dz),1.2*dt);
          }
          enemy.root.position.x=Math.max(-16.0,Math.min(10.25,enemy.root.position.x));
          enemy.root.position.z=Math.max(-1.35,Math.min(1.35,enemy.root.position.z));
          if(enemy.velocity.length()<0.12)enemy.velocity.set(0,0,0);
          if(enemy.root.position.x<=-15.8||enemy.root.position.x>=10.15){
            if(!enemy.crushed&&(Math.abs(enemy.velocity.x)>1||equipped==="pipe")){
              enemy.crushed=true;enemy.body.scaling.y=0.12;enemy.root.scaling.y=0.45;enemy.root.position.y=0.02;
              addImpact(scene,enemy.root.position,blood);killEnemy(enemy);
            }
            enemy.velocity.set(0,0,0);
          }
        }
        // Thrown bodies can collide with another creature and knock it down.
        for(const thrown of enemies){
          if(!thrown.alive||Math.abs(thrown.velocity.x)<2)continue;
          for(const other of enemies){
            if(other===thrown||!other.alive)continue;
            if(Vector3.Distance(thrown.root.position,other.root.position)<0.8){
              other.velocity.x=Math.sign(thrown.velocity.x)*5;damageEnemy(other,"throw");thrown.velocity.scaleInPlace(0.45);break;
            }
          }
        }
        // Small detached shotgun fragments fall under a simple visual gravity.
        scene.meshes.forEach(mesh=>{
          const velocity=mesh.metadata?.velocity as Vector3|undefined;
          if(velocity){mesh.position.addInPlace(velocity.scale(dt));velocity.y-=9.8*dt;if(mesh.position.y<0.05){mesh.position.y=0.05;velocity.y=0;}
          if(mesh.metadata?.headProjectile&&(mesh.position.x<=-15.8||mesh.position.x>=10.0)){mesh.scaling.set(0.9,0.12,0.45);mesh.metadata={};}}
        });
        if(phase===1){
          player.position.x=Math.max(-16.2,Math.min(11.4,player.position.x));
          camera.position.x+=(player.position.x-camera.position.x)*Math.min(1,dt*3.8);
          camera.setTarget(new Vector3(camera.position.x,2.0,0));
          if(player.position.x>=exterior.doorX&&!transitionLock){
            transitionLock=true;phase=2;exteriorMeshes.forEach(mesh=>mesh.setEnabled(false));enemies.forEach(enemy=>enemy.root.setEnabled(false));pickups.forEach(pickup=>pickup.root.setEnabled(false));buildRoom();
            player.position.set(-7.3,0,0);camera.position.set(-7.3,3.3,-16);camera.setTarget(new Vector3(-7.3,2,0));
            callbacks.current.onStageChange(2);
          }
        }else{
          player.position.x=Math.max(-8.1,Math.min(8.4,player.position.x));
          camera.position.x+=(player.position.x-camera.position.x)*Math.min(1,dt*3.8);
          camera.setTarget(new Vector3(camera.position.x,2,0));
        }
      }
      scene.render();
    });
    const resize=()=>{engine.resize();updateCameraBounds();};window.addEventListener("resize",resize);
    return ()=>{
      window.removeEventListener("keydown",keyDown);window.removeEventListener("keyup",keyUp);window.removeEventListener("resize",resize);
      rick.dispose();scene.dispose();engine.dispose();
    };
  },[]);

  return <canvas ref={canvasRef} className="game-canvas" aria-label="Splatterhouse: combate com armas na fase externa e interior 2,5D" />;
}
