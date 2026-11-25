import type * as THREE from "three";

export interface BodyMorphParameters {
  shoulderWidth: number;
  chestVolume: number;
  waistTaper: number;
  armMass: number;
  pelvisWidth: number;
  thighMass: number;
  torsoDepth: number;
}

export interface HeadMorphParameters {
  cranialWidth?: number;
  cranialHeight?: number;
  jawWidth?: number;
  jawHeight?: number;
  cheekVolume?: number;
  noseProjection?: number;
  earProminence?: number;
  [parameter: string]: number | undefined;
}

export interface CharacterCustomization {
  body?: Partial<BodyMorphParameters>;
  head?: HeadMorphParameters;
  blendshapes?: Record<string, number>;
  materials?: Record<string, string>;
}

export interface CharacterConfig {
  height?: number;
  quality?: "performance" | "high" | "ultra";
  proceduralTextures?: boolean;
  textureResolution?: 256 | 512 | 1024 | 2048;
  customization?: CharacterCustomization;
}

export interface CharacterPhysicsAdapter {
  update?(delta: number): void;
  setVelocity?(velocity: THREE.Vector3): void;
  getVelocity?(): THREE.Vector3;
  dispose?(): void;
}

export interface CharacterController {
  move?(direction: THREE.Vector3, delta: number): void;
  jump?(): void;
  setAction?(action: string): void;
}
