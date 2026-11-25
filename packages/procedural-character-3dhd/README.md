# Procedural Character 3D HD

React/Three.js library architecture for customizable, procedural, playable HD characters.

## Design goals
- Procedural anatomy and parametric head/body controls.
- PBR surface generation (normal, AO, roughness and albedo).
- Rig, skinning and blendshape interfaces.
- Pluggable animation/controller and physics adapters.
- Engine-agnostic game controls with React Three Fiber rendering integration.

## Proposed dependencies
- React and React Three Fiber
- Three.js (including TSL/WebGPU where supported)
- @react-three/drei (optional helpers)
- Physics adapter interface; a concrete provider can be implemented for Rapier or another engine.

## API sketch
```tsx
<ProceduralCharacter3DHD
  config={characterConfig}
  controller={controller}
  physics={physicsAdapter}
  customization={{ body: { shoulderWidth: 0.2 }, head: { cranialWidth: 0.1 } }}
/>
```

This package scaffold defines the API boundary. The original Rick implementation in
`apps/web/src/game/characters/RickTaylorCharacter3DHD.tsx`, head generator and surface-map
code are the source modules to modularize in subsequent integration work; they are not
yet relocated or rewritten by this scaffold.

## Architecture
- `core`: component lifecycle and factory
- `anatomy`: body/head generators and morph controls
- `materials`: procedural PBR maps and material providers
- `rig`: skeleton and skinning
- `animation`: animation controller interfaces
- `physics`: collision and physics adapter interfaces
- `customization`: presets and customization schema

See `src/types.ts` and `src/index.ts` for the starter public API.
