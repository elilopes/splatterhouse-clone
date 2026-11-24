import {
  Color3,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";

/**
 * Rick low-quality procedural model.
 * A complete, deliberately low-detail humanoid built from reusable primitives.
 * Keep the silhouette, mask and restrained blood placement consistent with the
 * future high-quality GLB model; this is a performance-oriented representation.
 */
export class RickProcedural {
  readonly root: TransformNode;
  private readonly leftArm: TransformNode;
  private readonly rightArm: TransformNode;
  private readonly leftLeg: TransformNode;
  private readonly rightLeg: TransformNode;
  private walkTime = 0;
  private attackTime = 0;

  constructor(private readonly scene: Scene) {
    this.root = new TransformNode("rick-low-root", scene);
    this.leftArm = new TransformNode("rick-left-arm-pivot", scene);
    this.rightArm = new TransformNode("rick-right-arm-pivot", scene);
    this.leftLeg = new TransformNode("rick-left-leg-pivot", scene);
    this.rightLeg = new TransformNode("rick-right-leg-pivot", scene);

    const skin = this.material("rick-skin", new Color3(0.48, 0.34, 0.29));
    const skinShadow = this.material("rick-skin-shadow", new Color3(0.30, 0.20, 0.18));
    const mask = this.material("rick-mask", new Color3(0.24, 0.055, 0.045));
    const maskDark = this.material("rick-mask-dark", new Color3(0.045, 0.025, 0.025));
    const bone = this.material("rick-mask-bone", new Color3(0.58, 0.48, 0.37));
    const pants = this.material("rick-pants", new Color3(0.075, 0.065, 0.065));
    const boots = this.material("rick-boots", new Color3(0.035, 0.03, 0.03));
    const blood = this.material("rick-blood", new Color3(0.24, 0.012, 0.018));

    // Main body: broad shoulders, compact torso and restrained muscle definition.
    this.ellipsoid("rick-pelvis", new Vector3(0, 1.02, 0), new Vector3(0.34, 0.25, 0.22), pants);
    this.ellipsoid("rick-torso", new Vector3(0, 1.48, 0), new Vector3(0.43, 0.55, 0.25), skin);
    this.ellipsoid("rick-chest", new Vector3(0, 1.72, -0.005), new Vector3(0.46, 0.27, 0.255), skin);
    this.ellipsoid("rick-abdomen", new Vector3(0, 1.27, 0.012), new Vector3(0.34, 0.27, 0.215), skin);
    // One shallow center crease only; no individual six-pack geometry.
    const torsoCrease = this.ellipsoid("rick-abdomen-crease", new Vector3(0, 1.29, -0.204), new Vector3(0.012, 0.17, 0.008), skinShadow);
    torsoCrease.isPickable = false;

    // Neck and head.
    this.ellipsoid("rick-neck", new Vector3(0, 2.02, 0), new Vector3(0.15, 0.18, 0.15), skin);
    this.ellipsoid("rick-head", new Vector3(0, 2.28, 0), new Vector3(0.245, 0.30, 0.22), skin);
    // The mask is the key recognition feature: red-brown face plate, dark eye slots,
    // a simple brow ridge and a small row of pale teeth. It intentionally avoids
    // tiny spikes, pores and dense surface decoration in the low preset.
    this.ellipsoid("rick-terror-mask", new Vector3(0, 2.29, -0.187), new Vector3(0.252, 0.255, 0.085), mask);
    this.ellipsoid("rick-mask-brow", new Vector3(0, 2.43, -0.255), new Vector3(0.235, 0.055, 0.035), maskDark);
    for (const side of [-1, 1]) {
      this.ellipsoid(`rick-mask-eye-${side}`, new Vector3(side * 0.092, 2.335, -0.266), new Vector3(0.061, 0.035, 0.018), maskDark);
      this.ellipsoid(`rick-mask-cheek-${side}`, new Vector3(side * 0.145, 2.22, -0.245), new Vector3(0.075, 0.065, 0.028), maskDark);
    }
    this.ellipsoid("rick-mask-nose", new Vector3(0, 2.27, -0.285), new Vector3(0.045, 0.075, 0.025), maskDark);
    this.ellipsoid("rick-mask-mouth", new Vector3(0, 2.17, -0.264), new Vector3(0.105, 0.043, 0.018), maskDark);
    for (let i = -2; i <= 2; i++) {
      this.ellipsoid(`rick-mask-tooth-${i}`, new Vector3(i * 0.035, 2.176, -0.284), new Vector3(0.012, 0.018, 0.009), bone);
    }

    // Arms: simple upper/lower volumes and fists, attached to shoulder pivots.
    this.leftArm.parent = this.root;
    this.rightArm.parent = this.root;
    this.leftArm.position.set(-0.48, 1.78, 0);
    this.rightArm.position.set(0.48, 1.78, 0);
    for (const [label, pivot, direction] of [
      ["left", this.leftArm, -1], ["right", this.rightArm, 1],
    ] as const) {
      const upper = this.capsule(`rick-${label}-upper-arm`, 0.48, 0.145, skin);
      upper.parent = pivot;
      upper.position.set(direction * 0.035, -0.27, 0);
      const elbow = this.ellipsoid(`rick-${label}-elbow`, new Vector3(direction * 0.045, -0.51, 0), new Vector3(0.13, 0.13, 0.13), skin);
      elbow.parent = pivot;
      const forearm = this.capsule(`rick-${label}-forearm`, 0.43, 0.115, skin);
      forearm.parent = pivot;
      forearm.position.set(direction * 0.06, -0.75, -0.005);
      const fist = this.ellipsoid(`rick-${label}-fist`, new Vector3(direction * 0.07, -1.00, -0.025), new Vector3(0.13, 0.12, 0.12), skinShadow);
      fist.parent = pivot;
    }

    // Legs with dark trousers and boots. The pivots make a cheap walk cycle possible.
    this.leftLeg.parent = this.root;
    this.rightLeg.parent = this.root;
    this.leftLeg.position.set(-0.19, 1.16, 0);
    this.rightLeg.position.set(0.19, 1.16, 0);
    for (const [label, pivot] of [["left", this.leftLeg], ["right", this.rightLeg]] as const) {
      const thigh = this.capsule(`rick-${label}-thigh`, 0.52, 0.18, pants);
      thigh.parent = pivot;
      thigh.position.y = -0.29;
      const knee = this.ellipsoid(`rick-${label}-knee`, new Vector3(0, -0.54, -0.01), new Vector3(0.16, 0.15, 0.17), pants);
      knee.parent = pivot;
      const shin = this.capsule(`rick-${label}-shin`, 0.50, 0.14, pants);
      shin.parent = pivot;
      shin.position.y = -0.79;
      const boot = this.ellipsoid(`rick-${label}-boot`, new Vector3(0, -1.03, -0.075), new Vector3(0.17, 0.13, 0.27), boots);
      boot.parent = pivot;
    }

    // Small, controlled blood marks: a shoulder smear and a couple of torso stains.
    // Avoid full-body blood coverage and avoid high-cost particle effects in this preset.
    this.ellipsoid("rick-blood-left-shoulder", new Vector3(-0.39, 1.78, -0.205), new Vector3(0.10, 0.045, 0.018), blood);
    this.ellipsoid("rick-blood-chest", new Vector3(0.19, 1.62, -0.244), new Vector3(0.075, 0.035, 0.012), blood);
    this.ellipsoid("rick-blood-right-rib", new Vector3(0.32, 1.38, -0.205), new Vector3(0.045, 0.09, 0.012), blood);

    // Parent static torso/head pieces after creation; limb pivots already parented.
    for (const mesh of scene.meshes) {
      if (mesh.name.startsWith("rick-") && !mesh.parent) mesh.parent = this.root;
    }
    this.root.position.y = 0;
  }

  playAttack(): void {
    this.attackTime = 0.24;
  }

  update(deltaSeconds: number, moving: boolean): void {
    this.attackTime = Math.max(0, this.attackTime - deltaSeconds);
    if (moving) {
      this.walkTime += deltaSeconds * 8.5;
      const swing = Math.sin(this.walkTime) * 0.48;
      this.leftLeg.rotation.x = swing;
      this.rightLeg.rotation.x = -swing;
      this.leftArm.rotation.x = -swing * 0.62;
      this.rightArm.rotation.x = swing * 0.62;
    } else {
      const blend = Math.min(1, deltaSeconds * 9);
      this.leftLeg.rotation.x += (0 - this.leftLeg.rotation.x) * blend;
      this.rightLeg.rotation.x += (0 - this.rightLeg.rotation.x) * blend;
      this.leftArm.rotation.x += (0 - this.leftArm.rotation.x) * blend;
      this.rightArm.rotation.x += (0 - this.rightArm.rotation.x) * blend;
    }
    if (this.attackTime > 0) {
      const attackProgress = this.attackTime / 0.24;
      this.rightArm.rotation.x = Math.max(this.rightArm.rotation.x, Math.sin(attackProgress * Math.PI) * 1.15);
    }
  }

  dispose(): void {
    this.root.dispose(false, true);
  }

  private material(name: string, color: Color3): StandardMaterial {
    const material = new StandardMaterial(name, this.scene);
    material.diffuseColor = color;
    material.specularColor = new Color3(0.12, 0.12, 0.12);
    return material;
  }

  private ellipsoid(name: string, position: Vector3, scale: Vector3, material: StandardMaterial): Mesh {
    const mesh = MeshBuilder.CreateSphere(name, { segments: 8, diameter: 1 }, this.scene);
    mesh.position.copyFrom(position);
    mesh.scaling.copyFrom(scale);
    mesh.material = material;
    mesh.isPickable = false;
    return mesh;
  }

  private capsule(name: string, height: number, radius: number, material: StandardMaterial): Mesh {
    const mesh = MeshBuilder.CreateCapsule(name, { height, radius, tessellation: 8, subdivisions: 1 }, this.scene);
    mesh.material = material;
    mesh.isPickable = false;
    return mesh;
  }
}
