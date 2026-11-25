import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

export type CorridorDoorSpec = {
  id: number;
  side: -1 | 1;
  z: number;
  roomLabel: string;
  triggerZ: number;
  spawnKind: "crawler" | "brute" | "spitter";
  secondaryKind?: "crawler" | "brute" | "spitter";
};

export const CORRIDOR_DOORS: CorridorDoorSpec[] = [
  { id: 1, side: -1, z: 18, roomLabel: "Quarto 01", triggerZ: 22.5, spawnKind: "crawler" },
  { id: 2, side: 1, z: 12, roomLabel: "Quarto 02", triggerZ: 17.0, spawnKind: "spitter" },
  { id: 3, side: -1, z: 6, roomLabel: "Quarto 03", triggerZ: 11.2, spawnKind: "brute", secondaryKind: "crawler" },
  { id: 4, side: 1, z: 0, roomLabel: "Quarto 04", triggerZ: 5.4, spawnKind: "crawler", secondaryKind: "spitter" },
  { id: 5, side: -1, z: -6, roomLabel: "Quarto 05", triggerZ: -0.6, spawnKind: "spitter", secondaryKind: "crawler" },
  { id: 6, side: 1, z: -12, roomLabel: "Quarto 06", triggerZ: -6.4, spawnKind: "brute" },
  { id: 7, side: -1, z: -18, roomLabel: "Quarto 07", triggerZ: -12.6, spawnKind: "spitter", secondaryKind: "brute" },
  { id: 8, side: 1, z: -24, roomLabel: "Quarto 08", triggerZ: -18.5, spawnKind: "brute", secondaryKind: "spitter" },
];

export type CorridorCoverSpec = {
  id: string;
  x: number;
  z: number;
  halfW: number;
  halfD: number;
  kind: "table" | "chest" | "console";
};

export const CORRIDOR_COVERS: CorridorCoverSpec[] = [
  { id: "c1", x: -1.85, z: 15.0, halfW: 0.72, halfD: 0.45, kind: "chest" },
  { id: "c2", x: 1.85, z: 9.2, halfW: 0.76, halfD: 0.5, kind: "table" },
  { id: "c3", x: -1.75, z: 2.5, halfW: 0.78, halfD: 0.5, kind: "table" },
  { id: "c4", x: 1.85, z: -3.2, halfW: 0.72, halfD: 0.45, kind: "chest" },
  { id: "c5", x: -1.82, z: -9.5, halfW: 0.76, halfD: 0.48, kind: "console" },
  { id: "c6", x: 1.82, z: -15.4, halfW: 0.78, halfD: 0.5, kind: "table" },
  { id: "c7", x: -1.78, z: -21.2, halfW: 0.72, halfD: 0.45, kind: "chest" },
  { id: "c8", x: 1.78, z: -27.5, halfW: 0.76, halfD: 0.48, kind: "console" },
];

const DOOR_SLOTS_Z = [18, 12, 6, 0, -6, -12, -18, -24];
const SCONCE_Z = [22, 14, 6, -2, -10, -18, -26, -34];

export function MansionCorridor3({
  openedDoorsRef,
}: {
  openedDoorsRef: React.MutableRefObject<Set<number>>;
}) {
  const doorLeafRefs = useRef<Record<number, THREE.Group | null>>({});
  const doorCurrentAngles = useRef<Record<number, number>>({});

  useFrame((_, dt) => {
    for (const door of CORRIDOR_DOORS) {
      const group = doorLeafRefs.current[door.id];
      if (!group) continue;
      const isOpen = openedDoorsRef.current.has(door.id);
      // Doors swing inward into their respective bedroom alcoves (-side * angle)
      const targetAngle = isOpen ? door.side * 1.42 : door.id % 3 === 0 ? door.side * 0.1 : 0;
      const cur = doorCurrentAngles.current[door.id] ?? 0;
      const next = THREE.MathUtils.damp(cur, targetAngle, 7.5, Math.min(dt, 0.05));
      doorCurrentAngles.current[door.id] = next;
      group.rotation.y = next;
    }
  });

  const woodWall = "#2d1f1b";
  const darkOak = "#19110f";
  const wainscoting = "#3b2821";
  const trimGold = "#947043";
  const carpetRed = "#4e191c";

  return (
    <group>
      {/* Corridor floor: worn dark oak planks extending z = -40..+31 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, -4.5]} receiveShadow>
        <planeGeometry args={[7.2, 71]} />
        <meshStandardMaterial color="#2a201a" roughness={0.86} />
      </mesh>
      {/* Floor plank seams */}
      {[-2.4, -1.6, -0.8, 0.8, 1.6, 2.4].map((x) => (
        <mesh key={`plank-${x}`} rotation={[-Math.PI / 2, 0, 0]} position={[x, -0.01, -4.5]}>
          <planeGeometry args={[0.03, 70]} />
          <meshStandardMaterial color="#140f0c" roughness={1} />
        </mesh>
      ))}
      {/* Long crimson corridor runner carpet with brass border */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, -4.5]} receiveShadow>
        <planeGeometry args={[2.1, 67.5]} />
        <meshStandardMaterial color={carpetRed} roughness={0.96} />
      </mesh>
      {[-0.96, 0.96].map((x) => (
        <mesh key={`carpet-trim-${x}`} rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.007, -4.5]}>
          <planeGeometry args={[0.08, 67.2]} />
          <meshStandardMaterial color="#9e7a48" roughness={0.78} />
        </mesh>
      ))}

      {/* Ceiling and dark coffered beams */}
      <mesh position={[0, 4.75, -4.5]}>
        <boxGeometry args={[7.4, 0.35, 71.5]} />
        <meshStandardMaterial color="#120d0d" roughness={0.96} />
      </mesh>
      {Array.from({ length: 15 }, (_, i) => {
        const z = 27 - i * 4.7;
        return (
          <group key={`beam-${i}`} position={[0, 4.46, z]}>
            <mesh>
              <boxGeometry args={[7.1, 0.28, 0.34]} />
              <meshStandardMaterial color={darkOak} roughness={0.88} />
            </mesh>
            {i % 2 === 0 && (
              <group position={[0, -0.45, 0]}>
                <mesh position={[0, 0.2, 0]}>
                  <cylinderGeometry args={[0.025, 0.025, 0.45, 8]} />
                  <meshStandardMaterial color="#251d1a" metalness={0.6} roughness={0.4} />
                </mesh>
                <mesh>
                  <torusGeometry args={[0.26, 0.03, 6, 16]} />
                  <meshStandardMaterial color="#58432b" metalness={0.5} roughness={0.45} />
                </mesh>
                <mesh position={[0, -0.05, 0]}>
                  <sphereGeometry args={[0.14, 12, 10]} />
                  <meshStandardMaterial color="#e0743a" emissive="#a83412" emissiveIntensity={1.1} />
                </mesh>
              </group>
            )}
          </group>
        );
      })}

      {/* Rear entry wall behind Rick (z = +30.5) */}
      <mesh position={[0, 2.35, 30.6]}>
        <boxGeometry args={[7.2, 4.7, 0.45]} />
        <meshStandardMaterial color={woodWall} roughness={0.92} />
      </mesh>

      {/* End-of-corridor Master Suite Double Door & Gothic Transom (z = -39.2) */}
      <group position={[0, 0, -39.2]}>
        <mesh position={[0, 2.35, -0.25]}>
          <boxGeometry args={[7.2, 4.7, 0.5]} />
          <meshStandardMaterial color="#1f1614" roughness={0.95} />
        </mesh>
        {/* Tall doorway arch frame */}
        <mesh position={[0, 3.65, 0.1]}>
          <boxGeometry args={[3.1, 0.35, 0.28]} />
          <meshStandardMaterial color={darkOak} roughness={0.85} />
        </mesh>
        {[-1.42, 1.42].map((dx) => (
          <mesh key={`end-jamb-${dx}`} position={[dx, 1.8, 0.1]}>
            <boxGeometry args={[0.26, 3.6, 0.28]} />
            <meshStandardMaterial color={darkOak} roughness={0.85} />
          </mesh>
        ))}
        {/* Double oak doors */}
        {[-0.64, 0.64].map((dx, i) => (
          <group key={`end-door-${i}`} position={[dx, 1.75, 0.08]}>
            <mesh castShadow>
              <boxGeometry args={[1.22, 3.45, 0.12]} />
              <meshStandardMaterial color="#381817" roughness={0.76} />
            </mesh>
            <mesh position={[dx > 0 ? -0.45 : 0.45, -0.1, 0.09]}>
              <sphereGeometry args={[0.075, 10, 8]} />
              <meshStandardMaterial color={trimGold} metalness={0.75} roughness={0.28} />
            </mesh>
          </group>
        ))}
        {/* Glowing crimson gothic transom above exit doors */}
        <mesh position={[0, 4.08, 0.08]}>
          <boxGeometry args={[2.5, 0.62, 0.1]} />
          <meshStandardMaterial color="#c43822" emissive="#8f1e10" emissiveIntensity={1.25} />
        </mesh>
      </group>

      {/* Left and right corridor walls segmented around the 8 bedroom door openings */}
      {[-1, 1].map((side) => {
        // Wall segments between doors (z: +30.5..-39.2)
        const wallCenters = [27.0, 21.8, 15.0, 9.0, 3.0, -3.0, -9.0, -15.0, -21.0, -32.2];
        const wallLengths = [7.0, 3.4, 4.2, 4.2, 4.2, 4.2, 4.2, 4.2, 4.2, 14.4];
        //Wait: doors are at z = 18, 12, 6, 0, -6, -12, -18, -24 with opening width 1.75 (half 0.875)
        //Let's compute exact wall spans so there is zero overlap and zero gap!
        const segments: Array<{ zCenter: number; len: number }> = [
          { zCenter: 24.75, len: 11.75 }, // +30.625 down to +18.875
          { zCenter: 15.0, len: 4.25 }, // +17.125 down to +12.875
          { zCenter: 9.0, len: 4.25 }, // +11.125 down to +6.875
          { zCenter: 3.0, len: 4.25 }, // +5.125 down to +0.875
          { zCenter: -3.0, len: 4.25 }, // -0.875 down to -5.125
          { zCenter: -9.0, len: 4.25 }, // -6.875 down to -11.125
          { zCenter: -15.0, len: 4.25 }, // -12.875 down to -17.125
          { zCenter: -21.0, len: 4.25 }, // -18.875 down to -23.125
          { zCenter: -32.125, len: 14.5 }, // -24.875 down to -39.375
        ];
        void wallCenters;
        void wallLengths;
        return (
          <group key={`wall-side-${side}`}>
            {segments.map((seg, idx) => (
              <group key={`wseg-${side}-${idx}`} position={[side * 3.42, 0, seg.zCenter]}>
                {/* Upper painted/wallpapered corridor wall */}
                <mesh position={[0, 2.95, 0]} receiveShadow>
                  <boxGeometry args={[0.38, 3.3, seg.len]} />
                  <meshStandardMaterial color={woodWall} roughness={0.92} />
                </mesh>
                {/* Lower oak wainscoting */}
                <mesh position={[-side * 0.03, 0.65, 0]} receiveShadow>
                  <boxGeometry args={[0.42, 1.3, seg.len]} />
                  <meshStandardMaterial color={wainscoting} roughness={0.85} />
                </mesh>
                {/* Chair-rail molding */}
                <mesh position={[-side * 0.06, 1.32, 0]}>
                  <boxGeometry args={[0.44, 0.1, seg.len]} />
                  <meshStandardMaterial color={darkOak} roughness={0.8} />
                </mesh>
              </group>
            ))}

            {/* Upper lintels above every doorway slot so wall is continuous overhead */}
            {DOOR_SLOTS_Z.map((dz) => (
              <mesh key={`lintel-${side}-${dz}`} position={[side * 3.42, 3.65, dz]}>
                <boxGeometry args={[0.4, 2.0, 1.8]} />
                <meshStandardMaterial color={woodWall} roughness={0.92} />
              </mesh>
            ))}
          </group>
        );
      })}

      {/* 8 Bedroom Doors (4 left, 4 right) + interior furnished bedroom alcoves */}
      {CORRIDOR_DOORS.map((door) => {
        const doorX = door.side * 3.28;
        const roomX = door.side * 5.05;
        return (
          <group key={`bedroom-door-${door.id}`}>
            {/* Door frame architrave */}
            <group position={[doorX, 0, door.z]}>
              {[-0.88, 0.88].map((jz) => (
                <mesh key={`jamb-${jz}`} position={[0, 1.32, jz]}>
                  <boxGeometry args={[0.32, 2.65, 0.14]} />
                  <meshStandardMaterial color={darkOak} roughness={0.82} />
                </mesh>
              ))}
              <mesh position={[0, 2.68, 0]}>
                <boxGeometry args={[0.34, 0.18, 1.92]} />
                <meshStandardMaterial color={darkOak} roughness={0.82} />
              </mesh>
              {/* Brass room number plaque */}
              <mesh position={[-door.side * 0.18, 2.28, 0]}>
                <boxGeometry args={[0.04, 0.14, 0.32]} />
                <meshStandardMaterial color={trimGold} metalness={0.72} roughness={0.32} />
              </mesh>

              {/* Hinged animated bedroom door leaf */}
              <group
                ref={(node) => {
                  doorLeafRefs.current[door.id] = node;
                }}
                position={[0, 0, -0.79]}
              >
                <mesh position={[0, 1.3, 0.79]} castShadow receiveShadow>
                  <boxGeometry args={[0.11, 2.58, 1.58]} />
                  <meshStandardMaterial color="#3c221b" roughness={0.78} />
                </mesh>
                {/* Raised door panels */}
                {[0.68, 1.82].map((py) => (
                  <mesh key={`panel-${py}`} position={[-door.side * 0.055, py, 0.79]}>
                    <boxGeometry args={[0.04, 0.76, 1.12]} />
                    <meshStandardMaterial color="#2a1612" roughness={0.82} />
                  </mesh>
                ))}
                {/* Brass doorknob */}
                <mesh position={[-door.side * 0.08, 1.12, 1.38]}>
                  <sphereGeometry args={[0.06, 10, 8]} />
                  <meshStandardMaterial color={trimGold} metalness={0.82} roughness={0.25} />
                </mesh>
              </group>
            </group>

            {/* Furnished Bedroom Alcove visible behind each opened door */}
            <group position={[roomX, 0, door.z]}>
              {/* Bedroom floor */}
              <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.015, 0]} receiveShadow>
                <planeGeometry args={[3.4, 4.1]} />
                <meshStandardMaterial color="#231915" roughness={0.95} />
              </mesh>
              {/* Bedroom rear wall & side walls */}
              <mesh position={[door.side * 1.65, 2.1, 0]}>
                <boxGeometry args={[0.25, 4.2, 4.1]} />
                <meshStandardMaterial color="#1d1413" roughness={0.96} />
              </mesh>
              {[-2.0, 2.0].map((sz) => (
                <mesh key={`rside-${sz}`} position={[0, 2.1, sz]}>
                  <boxGeometry args={[3.4, 4.2, 0.22]} />
                  <meshStandardMaterial color="#191211" roughness={0.96} />
                </mesh>
              ))}
              {/* Eerie moonlight bedroom window */}
              <mesh position={[door.side * 1.48, 2.15, 0]}>
                <boxGeometry args={[0.08, 1.55, 1.15]} />
                <meshStandardMaterial color="#6e2e24" emissive="#42140d" emissiveIntensity={0.65} />
              </mesh>
              {/* Wooden bed silhouette + crimson bedspread */}
              <group position={[door.side * 0.55, 0, 0.65]}>
                <mesh position={[0, 0.34, 0]}>
                  <boxGeometry args={[1.65, 0.36, 1.15]} />
                  <meshStandardMaterial color="#2b1b15" roughness={0.92} />
                </mesh>
                <mesh position={[0, 0.56, 0]}>
                  <boxGeometry args={[1.56, 0.16, 1.06]} />
                  <meshStandardMaterial color="#581b1e" roughness={0.95} />
                </mesh>
                <mesh position={[door.side * 0.72, 0.72, 0]}>
                  <boxGeometry args={[0.14, 0.95, 1.18]} />
                  <meshStandardMaterial color="#1f1410" roughness={0.9} />
                </mesh>
              </group>
              {/* Nightstand */}
              <mesh position={[door.side * 0.72, 0.35, -0.72]}>
                <boxGeometry args={[0.56, 0.7, 0.56]} />
                <meshStandardMaterial color="#291a14" roughness={0.88} />
              </mesh>
            </group>
          </group>
        );
      })}

      {/* Gothic Corridor Wall Sconces & Framed Portraits */}
      {SCONCE_Z.map((sz, idx) => (
        <group key={`sconce-row-${sz}`}>
          {[-1, 1].map((side) => (
            <group key={`sconce-${side}`} position={[side * 3.18, 2.38, sz]}>
              <mesh>
                <boxGeometry args={[0.1, 0.42, 0.16]} />
                <meshStandardMaterial color="#3b2c1d" metalness={0.5} roughness={0.45} />
              </mesh>
              <mesh position={[-side * 0.12, 0.14, 0]}>
                <sphereGeometry args={[0.11, 10, 8]} />
                <meshStandardMaterial color="#e06f34" emissive="#b33412" emissiveIntensity={1.15} />
              </mesh>
            </group>
          ))}
          {idx % 2 === 0 && (
            <mesh position={[idx % 4 === 0 ? -3.2 : 3.2, 2.45, sz - 2.6]}>
              <boxGeometry args={[0.06, 1.05, 0.8]} />
              <meshStandardMaterial color="#5c3e24" roughness={0.65} />
            </mesh>
          )}
        </group>
      ))}

      {/* Waist-high tactical Uncharted cover props staggered down the corridor */}
      {CORRIDOR_COVERS.map((cov) => (
        <group key={cov.id} position={[cov.x, 0, cov.z]}>
          {cov.kind === "table" ? (
            <>
              <mesh position={[0, 0.48, 0]} castShadow receiveShadow>
                <boxGeometry args={[cov.halfW * 2, 0.92, cov.halfD * 2]} />
                <meshStandardMaterial color="#3c261c" roughness={0.88} />
              </mesh>
              <mesh position={[0, 0.95, 0]}>
                <boxGeometry args={[cov.halfW * 2 + 0.08, 0.08, cov.halfD * 2 + 0.08]} />
                <meshStandardMaterial color="#281812" roughness={0.85} />
              </mesh>
            </>
          ) : cov.kind === "chest" ? (
            <>
              <mesh position={[0, 0.45, 0]} castShadow receiveShadow>
                <boxGeometry args={[cov.halfW * 2, 0.9, cov.halfD * 2]} />
                <meshStandardMaterial color="#2e1e18" roughness={0.86} />
              </mesh>
              <mesh position={[0, 0.72, 0]}>
                <boxGeometry args={[cov.halfW * 2 + 0.04, 0.08, cov.halfD * 2 + 0.04]} />
                <meshStandardMaterial color={trimGold} metalness={0.55} roughness={0.4} />
              </mesh>
            </>
          ) : (
            <>
              <mesh position={[0, 0.46, 0]} castShadow receiveShadow>
                <boxGeometry args={[cov.halfW * 2, 0.92, cov.halfD * 2]} />
                <meshStandardMaterial color="#442423" roughness={0.92} />
              </mesh>
              <mesh position={[0, 0.93, 0]}>
                <boxGeometry args={[cov.halfW * 2 + 0.06, 0.07, cov.halfD * 2 + 0.06]} />
                <meshStandardMaterial color="#241512" roughness={0.86} />
              </mesh>
            </>
          )}
        </group>
      ))}
    </group>
  );
}
