import { useEffect, useRef } from "react";
import {
  Camera, Color3, Engine, HemisphericLight, MeshBuilder,
  Scene, StandardMaterial, Vector3, FreeCamera, DirectionalLight
} from "@babylonjs/core";
import { RickProcedural } from "./characters/RickProcedural";

type Props = {
  onScore: (points: number) => void;
  onKill: () => void;
  paused: boolean;
  onStageChange: (stage: 1 | 2) => void;
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
  // Part 1 — long organic wall, with restrained slime drips and pools.
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
  // Part 2 — dead trees and sparse undergrowth.
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
  // Part 3 — mansion facade, windows, columns and entrance.
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
  // Distant moon and fog-like silhouettes.
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
  // Portraits and furniture create a readable 2.5D interior depth.
  for(const x of [-5,0,5]){
    box(scene,`portrait-frame-${x}`,{width:1.35,height:1.65,depth:0.16},new Vector3(x,4.65,2.08),gold);
    box(scene,`portrait-shadow-${x}`,{width:1.08,height:1.38,depth:0.08},new Vector3(x,4.65,1.96),dark);
  }
  box(scene,"hall-table-top",{width:2.4,height:0.22,depth:0.85},new Vector3(-4,1.0,0.65),dark);
  for(const x of [-4.9,-3.1]) box(scene,`hall-table-leg-${x}`,{width:0.18,height:1.0,depth:0.18},new Vector3(x,0.5,0.65),dark);
  box(scene,"hall-stair-platform",{width:3.3,height:0.45,depth:1.1},new Vector3(6.8,0.22,0.85),dark);
  // A distant doorway marks the way further into the mansion.
  box(scene,"interior-exit-frame",{width:2.2,height:3.5,depth:0.25},new Vector3(8.1,1.75,1.9),gold);
  box(scene,"interior-exit-dark",{width:1.8,height:3.15,depth:0.12},new Vector3(8.1,1.58,1.72),dark);
  return {};
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
    let attackCooldown=0;
    let interiorBuilt=false;
    const buildRoom=()=>{ if(interiorBuilt)return; interiorBuilt=true; buildInterior(scene); };
    const keyDown=(e:KeyboardEvent)=>{
      const key=e.key.toLowerCase(); keys.add(key);
      if(["arrowleft","arrowright","arrowup","arrowdown"," "].includes(key)) e.preventDefault();
      if(key==="j" && attackCooldown<=0){attackCooldown=0.48;rick.playAttack();}
    };
    const keyUp=(e:KeyboardEvent)=>keys.delete(e.key.toLowerCase());
    window.addEventListener("keydown",keyDown); window.addEventListener("keyup",keyUp);
    let last=performance.now();
    engine.runRenderLoop(()=>{
      const now=performance.now(); const dt=Math.min((now-last)/1000,0.045); last=now;
      if(!pausedRef.current){
        attackCooldown=Math.max(0,attackCooldown-dt);
        const horizontal=Number(keys.has("d")||keys.has("arrowright"))-Number(keys.has("a")||keys.has("arrowleft"));
        const depth=Number(keys.has("s")||keys.has("arrowdown"))-Number(keys.has("w")||keys.has("arrowup"));
        const move=new Vector3(horizontal,0,depth);
        if(move.lengthSquared()>0){
          move.normalize(); player.position.x+=move.x*4.25*dt;
          player.position.z=Math.max(-1.35,Math.min(1.35,player.position.z+move.z*2.1*dt));
          player.rotation.y=horizontal<0?Math.PI/2:horizontal>0?-Math.PI/2:player.rotation.y;
        }
        rick.update(dt,move.lengthSquared()>0);
        if(phase===1){
          player.position.x=Math.max(-16.2,Math.min(11.4,player.position.x));
          camera.position.x+=(player.position.x-camera.position.x)*Math.min(1,dt*3.8);
          camera.setTarget(new Vector3(camera.position.x,2.0,0));
          if(player.position.x>=exterior.doorX && !transitionLock){
            transitionLock=true; phase=2; exteriorMeshes.forEach(mesh=>mesh.setEnabled(false)); buildRoom(); player.position.set(-7.3,0,0); camera.position.set(-7.3,3.3,-16); camera.setTarget(new Vector3(-7.3,2,0)); callbacks.current.onStageChange(2);
          }
        } else {
          player.position.x=Math.max(-8.1,Math.min(8.4,player.position.x));
          camera.position.x+=(player.position.x-camera.position.x)*Math.min(1,dt*3.8);
          camera.setTarget(new Vector3(camera.position.x,2,0));
        }
      }
      scene.render();
    });
    const resize=()=>{engine.resize();updateCameraBounds();}; window.addEventListener("resize",resize);
    return ()=>{window.removeEventListener("keydown",keyDown);window.removeEventListener("keyup",keyUp);window.removeEventListener("resize",resize);rick.dispose();scene.dispose();engine.dispose();};
  },[]);

  return <canvas ref={canvasRef} className="game-canvas" aria-label="Splatterhouse: fase externa em rolagem lateral e interior 2,5D" />;
}
