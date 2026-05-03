import { useState, useRef, useCallback, useMemo, Suspense, useEffect } from "react";
import { Canvas, useThree, useFrame } from "@react-three/fiber";
import { OrbitControls, Grid, Html, Line } from "@react-three/drei";
import * as THREE from "three";
import { useLocation, Link } from "wouter";
import { useUser, useClerk } from "@clerk/react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  useCreateProject,
  useUpdateProject,
  getListProjectsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { parseSVGContent, extractSvgColor } from "@/lib/svgParser";
import {
  createOuterShellGeometries,
  createInnerClickerGeometries,
  validateGeometry,
  DEFAULT_SETTINGS,
  type FidgetSettings,
  type GeometryWarning,
} from "@/lib/fidgetGeometry";
import { exportSTL, export3MF, exportSTLMerged, export3MFMerged, type MeshGroups } from "@/lib/exporters";
import {
  Upload,
  Download,
  Save,
  LayoutList,
  LogOut,
  ChevronLeft,
  Box,
  Ruler,
  Layers,
  AlertTriangle,
  HelpCircle,
  Crosshair,
} from "lucide-react";

// ─── Colour utilities ─────────────────────────────────────────────────────

/** Shift the HSL lightness of a 6-char hex colour by `deltaPercent` (−100…100). */
function adjustLightness(hex: string, deltaPercent: number): string {
  const full =
    hex.length === 4
      ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
      : hex;
  const r = parseInt(full.slice(1, 3), 16) / 255;
  const g = parseInt(full.slice(3, 5), 16) / 255;
  const b = parseInt(full.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r)      h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else                h = ((r - g) / d + 4) / 6;
  }

  const newL = Math.max(0, Math.min(1, l + deltaPercent / 100));
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  let nr, ng, nb;
  if (s === 0) {
    nr = ng = nb = newL;
  } else {
    const q = newL < 0.5 ? newL * (1 + s) : newL + s - newL * s;
    const p = 2 * newL - q;
    nr = hue2rgb(p, q, h + 1 / 3);
    ng = hue2rgb(p, q, h);
    nb = hue2rgb(p, q, h - 1 / 3);
  }
  const toHex = (n: number) => Math.round(n * 255).toString(16).padStart(2, "0");
  return `#${toHex(nr)}${toHex(ng)}${toHex(nb)}`;
}

/**
 * Derive the outer-shell colour from the clicker colour.
 * Darkens by 20% unless the colour is already very dark (lightness < 0.20),
 * in which case it lightens by 20% instead.
 */
function deriveShellColor(clickerHex: string): string {
  const full =
    clickerHex.length === 4
      ? `#${clickerHex[1]}${clickerHex[1]}${clickerHex[2]}${clickerHex[2]}${clickerHex[3]}${clickerHex[3]}`
      : clickerHex;
  const r = parseInt(full.slice(1, 3), 16) / 255;
  const g = parseInt(full.slice(3, 5), 16) / 255;
  const b = parseInt(full.slice(5, 7), 16) / 255;
  const l = (Math.max(r, g, b) + Math.min(r, g, b)) / 2;
  return adjustLightness(clickerHex, l < 0.20 ? 20 : -20);
}

// ──────────────────────────────────────────────────────────────────────────

interface ParsedSVGState {
  shapes: THREE.Shape[];
  width: number;
  height: number;
  rawSvg: string;
  fileName: string;
}

// ─── Outer shell: outer wall ring + inner fill (floor + pocket walls) ────

function OuterShellGroup({
  shapes,
  settings,
  svgWidth,
  svgHeight,
  outerWallRef,
  innerFillFloorRef,
  innerFillPinSectionRef,
  innerFillWallsRef,
  fitCheck,
  onBounds,
  color,
  activeHighlights = [],
}: {
  shapes: THREE.Shape[];
  settings: FidgetSettings;
  svgWidth: number;
  svgHeight: number;
  outerWallRef: React.RefObject<THREE.Mesh | null>;
  innerFillFloorRef: React.RefObject<THREE.Mesh | null>;
  innerFillPinSectionRef: React.RefObject<THREE.Mesh | null>;
  innerFillWallsRef: React.RefObject<THREE.Mesh | null>;
  fitCheck: boolean;
  onBounds?: (b: { w: number; h: number }) => void;
  color: string;
  activeHighlights: MeshKey[];
}) {
  const geos = useMemo(
    () => createOuterShellGeometries(shapes, settings, svgWidth, svgHeight),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shapes, settings, svgWidth, svgHeight]
  );

  // Report actual shell footprint to parent whenever geometry changes.
  useEffect(() => { onBounds?.(geos.bounds); }, [geos, onBounds]);

  const flip = settings.flipShell ?? false;
  // Geometry runs from local z=0 to z=totalDepth. When unflipped we centre it
  // at world z=0 by shifting the group to -totalDepth/2.  When flipped we
  // rotate 180° around X (so local +z becomes world -z) and shift to
  // +totalDepth/2 so the part still straddles world z=0.
  const groupZ = flip ? settings.totalDepth / 2 : -settings.totalDepth / 2;

  // Separation must grow with the model so the two parts never overlap.
  // Compute the actual model half-width from the locked dimension + aspect ratio.
  const svgBase = settings.lockDimension === "width" ? svgWidth : svgHeight;
  const scale = svgBase > 0 ? settings.targetSizeMm / svgBase : 1;
  const modelHalfW = (svgWidth * scale) / 2;
  const separationX = Math.max(35, modelHalfW + 12);

  const groupX = fitCheck ? 0 : -separationX;

  const hl = (k: MeshKey) => activeHighlights.includes(k);
  return (
    <group position={[groupX, 0, groupZ]} rotation={[flip ? Math.PI : 0, 0, 0]}>
      {/* Outer wall ring — ghost in fit-check so you can see inside */}
      <mesh ref={outerWallRef} position={[0, 0, geos.zOffsets.outerWall]} castShadow={!fitCheck} receiveShadow>
        <primitive object={geos.outerWall} />
        <meshStandardMaterial
          color={color}
          metalness={0.25}
          roughness={0.45}
          opacity={fitCheck ? 0.28 : 1}
          transparent={fitCheck}
          depthWrite={!fitCheck}
        />
      </mesh>
      <MeshHighlightOverlay geometry={geos.outerWall} position={[0, 0, geos.zOffsets.outerWall]} highlighted={hl("shell_outer")} />

      {/* Solid floor — never penetrated */}
      <mesh ref={innerFillFloorRef} position={[0, 0, geos.zOffsets.innerFillFloor]} castShadow receiveShadow>
        <primitive object={geos.innerFillFloor} />
        <meshStandardMaterial color={color} metalness={0.15} roughness={0.55} />
      </mesh>
      <MeshHighlightOverlay geometry={geos.innerFillFloor} position={[0, 0, geos.zOffsets.innerFillFloor]} highlighted={hl("shell_floor")} />

      {/* MX pin-hole section — deepest part of pocket (only when enabled) */}
      {geos.innerFillPinSection && (
        <>
          <mesh ref={innerFillPinSectionRef} position={[0, 0, geos.zOffsets.innerFillPinSection]} castShadow receiveShadow>
            <primitive object={geos.innerFillPinSection} />
            <meshStandardMaterial color={color} metalness={0.15} roughness={0.55} />
          </mesh>
          <MeshHighlightOverlay geometry={geos.innerFillPinSection} position={[0, 0, geos.zOffsets.innerFillPinSection]} highlighted={hl("shell_pin")} />
        </>
      )}

      {/* Keycap square pocket walls — upper / shallower section of pocket */}
      <mesh ref={innerFillWallsRef} position={[0, 0, geos.zOffsets.innerFillWalls]} castShadow receiveShadow>
        <primitive object={geos.innerFillWalls} />
        <meshStandardMaterial color={color} metalness={0.15} roughness={0.55} />
      </mesh>
      <MeshHighlightOverlay geometry={geos.innerFillWalls} position={[0, 0, geos.zOffsets.innerFillWalls]} highlighted={hl("shell_walls")} />
    </group>
  );
}

// ─── Inner clicker: body + actuator boss ──────────────────────────────────

function InnerClickerGroup({
  shapes,
  settings,
  svgWidth,
  svgHeight,
  clickerFloorRef,
  clickerWallsRef,
  bossBaseRef,
  bossMainRef,
  fitCheck,
  onBounds,
  color,
  activeHighlights = [],
}: {
  shapes: THREE.Shape[];
  settings: FidgetSettings;
  svgWidth: number;
  svgHeight: number;
  clickerFloorRef: React.RefObject<THREE.Mesh | null>;
  clickerWallsRef: React.RefObject<THREE.Mesh | null>;
  bossBaseRef: React.RefObject<THREE.Mesh | null>;
  bossMainRef: React.RefObject<THREE.Mesh | null>;
  fitCheck: boolean;
  onBounds?: (b: { w: number; h: number }) => void;
  color: string;
  activeHighlights: MeshKey[];
}) {
  const geos = useMemo(
    () => createInnerClickerGeometries(shapes, settings, svgWidth, svgHeight),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shapes, settings, svgWidth, svgHeight]
  );

  // Report actual clicker footprint to parent whenever geometry changes.
  useEffect(() => { onBounds?.(geos.bounds); }, [geos, onBounds]);

  const { totalDepth, innerFillDepth } = settings;
  const { clickerTotalDepth, clickerFloorDepth, bossFloorGap, bossHeight, bossBaseHeight } = geos;

  // In normal mode the clicker floats beside the shell.
  // In fit-check mode it is positioned to sit exactly inside the recess.
  //   Recess bottom (world z) = -totalDepth/2 + innerFillDepth
  //   Clicker local geo runs 0 → clickerTotalDepth; centre offset = -clickerTotalDepth/2
  //   → groupZ = -totalDepth/2 + innerFillDepth + clickerTotalDepth/2
  const flip = settings.flipClicker ?? false;

  // Mirror the shell's dynamic separation so the gap stays consistent.
  const svgBase = settings.lockDimension === "width" ? svgWidth : svgHeight;
  const scale = svgBase > 0 ? settings.targetSizeMm / svgBase : 1;
  const modelHalfW = (svgWidth * scale) / 2;
  const separationX = Math.max(35, modelHalfW + 12);

  const normalGroupPos: [number, number, number] = [separationX, 0, 0];
  const fitCheckGroupPos: [number, number, number] = [
    0,
    0,
    -totalDepth / 2 + innerFillDepth + clickerTotalDepth / 2,
  ];
  const groupPos = fitCheck ? fitCheckGroupPos : normalGroupPos;

  // Local z origins (geo starts at 0, mesh centred at -clickerTotalDepth/2)
  const baseZ      = -clickerTotalDepth / 2;
  const floorZ     = baseZ;                        // clicker solid floor
  const wallsZ     = baseZ + clickerFloorDepth;    // clicker wall section
  // Boss sits bossFloorGap mm above the absolute clicker bottom.
  // The two boss pieces are stacked: solid base then main shell (with cross pocket).
  const bossBaseZ  = baseZ + bossFloorGap;                    // solid base starts here
  const bossMainZ  = bossBaseZ + bossBaseHeight;              // main shell starts here

  // Clicker geometry is already centred at local z=0 (spans –depth/2 → +depth/2),
  // so a 180° rotation around X keeps it centred without any extra translation.
  const hl = (k: MeshKey) => activeHighlights.includes(k);
  return (
    <group position={groupPos} rotation={[flip ? Math.PI : 0, 0, 0]}>
      <mesh ref={clickerFloorRef} position={[0, 0, floorZ]} castShadow receiveShadow>
        <primitive object={geos.floor} />
        <meshStandardMaterial color={color} metalness={0.25} roughness={0.45} />
      </mesh>
      <MeshHighlightOverlay geometry={geos.floor} position={[0, 0, floorZ]} highlighted={hl("click_floor")} />

      <mesh ref={clickerWallsRef} position={[0, 0, wallsZ]} castShadow receiveShadow>
        <primitive object={geos.walls} />
        <meshStandardMaterial color={color} metalness={0.25} roughness={0.45} />
      </mesh>
      <MeshHighlightOverlay geometry={geos.walls} position={[0, 0, wallsZ]} highlighted={hl("click_walls")} />

      {/* Boss base — solid disk that closes the bottom of the cross pocket */}
      <mesh ref={bossBaseRef} position={[0, 0, bossBaseZ]} castShadow receiveShadow>
        <primitive object={geos.bossBase} />
        <meshStandardMaterial color={color} metalness={0.3} roughness={0.4} />
      </mesh>
      <MeshHighlightOverlay geometry={geos.bossBase} position={[0, 0, bossBaseZ]} highlighted={hl("click_boss")} />

      {/* Boss main — cylindrical shell with MX cross pocket cut through the top */}
      <mesh ref={bossMainRef} position={[0, 0, bossMainZ]} castShadow receiveShadow>
        <primitive object={geos.bossMain} />
        <meshStandardMaterial color={color} metalness={0.3} roughness={0.4} />
      </mesh>
      <MeshHighlightOverlay geometry={geos.bossMain} position={[0, 0, bossMainZ]} highlighted={hl("click_boss")} />
    </group>
  );
}

// ─── Placeholder ──────────────────────────────────────────────────────────

function PlaceholderMeshes() {
  return (
    <>
      {/* Outer shell placeholder */}
      <group position={[-35, 0, 0]}>
        <mesh position={[0, 0, 0]} castShadow>
          <boxGeometry args={[38, 38, 22]} />
          <meshStandardMaterial color="#6C63FF" opacity={0.18} transparent wireframe />
        </mesh>
        <mesh position={[0, 0, -5]}>
          <boxGeometry args={[36, 36, 12]} />
          <meshStandardMaterial color="#9B94FF" opacity={0.12} transparent wireframe />
        </mesh>
      </group>
      {/* Inner clicker placeholder */}
      <mesh position={[35, 0, 0]} castShadow>
        <boxGeometry args={[34, 34, 9]} />
        <meshStandardMaterial color="#10B981" opacity={0.18} transparent wireframe />
      </mesh>
    </>
  );
}

// ─── ViewCube — orientation gizmo ─────────────────────────────────────────

interface SnapTarget { pos: THREE.Vector3; tgt: THREE.Vector3 }

/** Runs inside Canvas: syncs camera state to refs and applies ViewCube commands. */
function CameraTracker({
  stateRef,
  snapRef,
  dragRef,
}: {
  stateRef: React.MutableRefObject<{ quaternion: THREE.Quaternion; dist: number }>;
  snapRef: React.MutableRefObject<SnapTarget | null>;
  dragRef: React.MutableRefObject<{ dx: number; dy: number } | null>;
}) {
  const { camera, controls } = useThree();
  useFrame(() => {
    stateRef.current.quaternion.copy(camera.quaternion);
    stateRef.current.dist = camera.position.length();

    const oc = controls as unknown as {
      target: THREE.Vector3;
      update: () => void;
    } | null;

    if (dragRef.current && oc) {
      const { dx, dy } = dragRef.current;
      dragRef.current = null;
      const sph = new THREE.Spherical().setFromVector3(
        camera.position.clone().sub(oc.target)
      );
      sph.theta -= dx;
      sph.phi = THREE.MathUtils.clamp(sph.phi - dy, 0.05, Math.PI - 0.05);
      camera.position.copy(
        new THREE.Vector3().setFromSpherical(sph).add(oc.target)
      );
      oc.update();
    }

    if (snapRef.current && oc) {
      const snap = snapRef.current;
      camera.position.lerp(snap.pos, 0.16);
      oc.target.lerp(snap.tgt, 0.16);
      oc.update();
      if (camera.position.distanceTo(snap.pos) < 0.4) {
        camera.position.copy(snap.pos);
        oc.target.copy(snap.tgt);
        oc.update();
        snapRef.current = null;
      }
    }
  });
  return null;
}

const VC_SIZE = 76;
const VC_HALF = VC_SIZE / 2;

const VC_FACES: {
  label: string;
  cssTransform: string;
  bg: string;
  dir: string;
}[] = [
  { label: "TOP",   cssTransform: `rotateX(-90deg) translateZ(${VC_HALF}px)`,  bg: "rgba(160,155,255,0.93)", dir: "0,1,0" },
  { label: "BTM",   cssTransform: `rotateX(90deg) translateZ(${VC_HALF}px)`,   bg: "rgba(85,80,175,0.82)",   dir: "0,-1,0" },
  { label: "FRONT", cssTransform: `translateZ(${VC_HALF}px)`,                   bg: "rgba(135,130,245,0.90)", dir: "0,0,1" },
  { label: "BACK",  cssTransform: `rotateY(180deg) translateZ(${VC_HALF}px)`,  bg: "rgba(85,80,175,0.78)",   dir: "0,0,-1" },
  { label: "RIGHT", cssTransform: `rotateY(90deg) translateZ(${VC_HALF}px)`,   bg: "rgba(115,110,225,0.85)", dir: "1,0,0" },
  { label: "LEFT",  cssTransform: `rotateY(-90deg) translateZ(${VC_HALF}px)`,  bg: "rgba(115,110,225,0.85)", dir: "-1,0,0" },
];

/** CSS 3D ViewCube — syncs rotation with main camera; click to snap, drag to orbit. */
function ViewCube({
  stateRef,
  snapRef,
  dragRef,
}: {
  stateRef: React.MutableRefObject<{ quaternion: THREE.Quaternion; dist: number }>;
  snapRef: React.MutableRefObject<SnapTarget | null>;
  dragRef: React.MutableRefObject<{ dx: number; dy: number } | null>;
}) {
  const innerRef = useRef<HTMLDivElement>(null);
  const rafRef   = useRef<number>(0);
  const dragState = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  useEffect(() => {
    const tick = () => {
      if (innerRef.current) {
        const q = stateRef.current.quaternion.clone().invert();
        const m = new THREE.Matrix4().makeRotationFromQuaternion(q);
        const e = m.elements;
        // Y-axis flip: CSS Y points down, Three.js Y points up
        innerRef.current.style.transform =
          `matrix3d(${e[0]},${-e[1]},${e[2]},0,` +
          `${-e[4]},${e[5]},${-e[6]},0,` +
          `${e[8]},${-e[9]},${e[10]},0,` +
          `0,0,0,1)`;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [stateRef]);

  const onPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragState.current = { x: e.clientX, y: e.clientY, moved: false };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragState.current) return;
    const dx = (e.clientX - dragState.current.x) * 0.009;
    const dy = (e.clientY - dragState.current.y) * 0.009;
    if (Math.abs(e.clientX - dragState.current.x) > 3 ||
        Math.abs(e.clientY - dragState.current.y) > 3) {
      dragState.current.moved = true;
    }
    dragRef.current = { dx, dy };
    dragState.current = { ...dragState.current, x: e.clientX, y: e.clientY };
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!dragState.current?.moved) {
      const target = e.target as HTMLElement;
      const dir = target.dataset.dir ?? (target.parentElement as HTMLElement | null)?.dataset.dir;
      if (dir) {
        const [x, y, z] = dir.split(",").map(Number);
        const dist = stateRef.current.dist || 130;
        snapRef.current = {
          pos: new THREE.Vector3(x, y, z).multiplyScalar(dist),
          tgt: new THREE.Vector3(0, 0, 0),
        };
      }
    }
    dragState.current = null;
  };

  return (
    <div
      style={{ width: VC_SIZE, height: VC_SIZE, perspective: "260px", cursor: "grab", flexShrink: 0 }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <div
        ref={innerRef}
        style={{ width: VC_SIZE, height: VC_SIZE, position: "relative", transformStyle: "preserve-3d" }}
      >
        {VC_FACES.map((face) => (
          <div
            key={face.label}
            data-dir={face.dir}
            style={{
              position: "absolute",
              inset: 0,
              background: face.bg,
              border: "1px solid rgba(255,255,255,0.15)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 7,
              fontWeight: 700,
              letterSpacing: "0.08em",
              color: "rgba(255,255,255,0.95)",
              transform: face.cssTransform,
              cursor: "pointer",
              userSelect: "none",
            }}
          >
            {face.label}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Mesh highlight overlay ───────────────────────────────────────────────

type MeshKey =
  | "shell_outer" | "shell_floor" | "shell_walls" | "shell_pin"
  | "click_floor" | "click_walls" | "click_boss";

/** Maps each FidgetSettings slider key to the mesh(es) it most directly affects. */
const SLIDER_HIGHLIGHTS: Partial<Record<keyof FidgetSettings, MeshKey[]>> = {
  totalDepth:         ["shell_outer"],
  innerFillDepth:     ["shell_floor", "shell_walls"],
  keycapPocketDepth:  ["shell_walls"],
  insetAmount:        ["shell_outer", "shell_floor", "shell_walls"],
  pinHoleDepth:       ["shell_pin"],
  pinHoleRadius:      ["shell_pin"],
  keycapSize:         ["shell_walls"],
  clickerSquareSize:  ["click_walls"],
  clickerSquareDepth: ["click_walls"],
  pocketOffsetX:      ["shell_walls", "click_boss", "click_walls"],
  pocketOffsetY:      ["shell_walls", "click_boss", "click_walls"],
  clickerTotalDepth:  ["click_floor", "click_walls"],
  clickerFloorDepth:  ["click_floor"],
  bossDiameter:       ["click_boss"],
  bossHeight:         ["click_boss"],
  bossFloorGap:       ["click_boss"],
  crossSize:          ["click_boss"],
  crossDepth:         ["click_boss"],
  crossArmWidth:      ["click_boss"],
  targetSizeMm:       ["shell_outer", "shell_floor", "shell_walls", "click_floor", "click_walls", "click_boss"],
};

/**
 * Additive emissive overlay on top of one mesh face.
 * Uses AdditiveBlending so the base material is never altered — only bright
 * light is added on top.  Opacity lerps to/from 0 in ~100 ms via useFrame.
 */
function MeshHighlightOverlay({
  geometry,
  position,
  highlighted,
}: {
  geometry: THREE.BufferGeometry;
  position: [number, number, number];
  highlighted: boolean;
}) {
  const matRef  = useRef<THREE.MeshBasicMaterial>(null);
  const opRef   = useRef(0);
  const hlRef   = useRef(highlighted);
  useEffect(() => { hlRef.current = highlighted; }, [highlighted]);

  useFrame((_, delta) => {
    const target = hlRef.current ? 0.40 : 0;
    opRef.current += (target - opRef.current) * Math.min(1, delta / 0.10);
    if (matRef.current) {
      matRef.current.opacity = opRef.current;
      matRef.current.visible = opRef.current > 0.002;
    }
  });

  return (
    <mesh geometry={geometry} position={position} renderOrder={2}>
      <meshBasicMaterial
        ref={matRef}
        color="#22eeff"
        transparent
        opacity={0}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  );
}

// ─── Dimension annotation ─────────────────────────────────────────────────
// Renders X-width and Z-height dimension callouts around one model footprint.
// Lives OUTSIDE the rotation group so all positions are world-space.
//
// World-space layout after scene rotation [-π/2, 0, 0]:
//   Model footprint: X ∈ [centerX−w/2, centerX+w/2], Z ∈ [−h/2, +h/2]
//   Width  line → along X, at Z = +h/2 + OFFSET  (in front of model)
//   Height line → along Z, at X = centerX−w/2 − OFFSET  (left of model)
//   Both lines sit at Y = lineY (the floor/grid plane).

function ModelDimensionAnnotation({
  centerX,
  widthMm,
  heightMm,
  color,
  lineY,
}: {
  centerX: number;
  widthMm: number;
  heightMm: number;
  color: string;
  lineY: number;
}) {
  const OFFSET = 9;
  const TICK   = 2.5;
  const hw = widthMm  / 2;
  const hh = heightMm / 2;

  // Width line – spans X from left to right edge, placed in front of model
  const wz  = hh + OFFSET;
  const wx1 = centerX - hw;
  const wx2 = centerX + hw;

  // Height line – spans Z from top to bottom, placed left of model
  const hx  = centerX - hw - OFFSET;

  const labelStyle: React.CSSProperties = {
    color:        "#ffffff",
    background:   "rgba(10,10,18,0.92)",
    border:       `1.5px solid ${color}`,
    borderRadius: 5,
    padding:      "3px 10px",
    fontSize:     13,
    fontWeight:   700,
    fontFamily:   "ui-monospace, 'Cascadia Code', monospace",
    whiteSpace:   "nowrap",
    pointerEvents:"none",
    lineHeight:   "1.4",
    letterSpacing: "0.02em",
    boxShadow:    `0 2px 8px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.06)`,
  };

  // Tiny vertical offset so lines don't z-fight with the grid (grid sits at lineY)
  const y = lineY + 0.15;

  return (
    <>
      {/* ── Width dimension (X) ── */}
      <Line points={[[wx1, y, wz], [wx2, y, wz]]} color={color} lineWidth={1.5} />
      {/* end ticks */}
      <Line points={[[wx1, y, wz - TICK], [wx1, y, wz + TICK]]} color={color} lineWidth={1.5} />
      <Line points={[[wx2, y, wz - TICK], [wx2, y, wz + TICK]]} color={color} lineWidth={1.5} />
      {/* leader lines from model edge to dimension line */}
      <Line points={[[wx1, y, hh + 0.5], [wx1, y, wz - TICK]]} color={color} lineWidth={0.6} />
      <Line points={[[wx2, y, hh + 0.5], [wx2, y, wz - TICK]]} color={color} lineWidth={0.6} />
      {/* label */}
      <Html position={[(wx1 + wx2) / 2, y, wz + 6]} center>
        <div style={labelStyle}>{widthMm.toFixed(2)} mm</div>
      </Html>

      {/* ── Height dimension (Z, which is SVG-space Y) ── */}
      <Line points={[[hx, y, -hh], [hx, y, +hh]]} color={color} lineWidth={1.5} />
      {/* end ticks */}
      <Line points={[[hx - TICK, y, -hh], [hx + TICK, y, -hh]]} color={color} lineWidth={1.5} />
      <Line points={[[hx - TICK, y, +hh], [hx + TICK, y, +hh]]} color={color} lineWidth={1.5} />
      {/* leader lines */}
      <Line points={[[centerX - hw - 0.5, y, -hh], [hx + TICK, y, -hh]]} color={color} lineWidth={0.6} />
      <Line points={[[centerX - hw - 0.5, y, +hh], [hx + TICK, y, +hh]]} color={color} lineWidth={0.6} />
      {/* label — horizontal, no rotation (easier to read in 3D view) */}
      <Html position={[hx - 10, y, 0]} center>
        <div style={labelStyle}>{heightMm.toFixed(2)} mm</div>
      </Html>
    </>
  );
}

// ─── Info tooltip ─────────────────────────────────────────────────────────

function InfoTooltip({ text }: { text: string }) {
  return (
    <span className="relative group inline-flex items-center">
      <HelpCircle className="h-3.5 w-3.5 text-muted-foreground/60 hover:text-muted-foreground cursor-default transition-colors" />
      <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg opacity-0 group-hover:opacity-100 transition-opacity z-50 leading-relaxed whitespace-normal">
        {text}
      </span>
    </span>
  );
}

// ─── Auto-fit camera ──────────────────────────────────────────────────────
// Repositions the camera whenever the model footprint changes (targetSizeMm,
// SVG aspect ratio, or totalDepth).  Does NOT fire on every orbit/zoom so
// the user can still navigate freely between size changes.

function AutoCamera({
  targetSizeMm,
  svgWidth,
  svgHeight,
  lockDimension,
  totalDepth,
  recenterKey,
}: {
  targetSizeMm: number;
  svgWidth: number;
  svgHeight: number;
  lockDimension: "width" | "height";
  totalDepth: number;
  recenterKey: number;
}) {
  const { camera, controls } = useThree();

  useEffect(() => {
    const svgBase   = lockDimension === "width" ? svgWidth : svgHeight;
    const scale     = svgBase > 0 ? targetSizeMm / svgBase : 1;
    const modelHalfW = (svgWidth  * scale) / 2;
    const modelHalfH = (svgHeight * scale) / 2;

    // Both parts sit side-by-side; scene half-width ≈ separation + modelHalfW.
    const separationX = Math.max(35, modelHalfW + 12);
    const sceneHalfW  = separationX + modelHalfW;

    // Bounding sphere radius with 20 % padding.
    const sceneRadius = Math.max(sceneHalfW, modelHalfH, totalDepth / 2) * 1.2;

    // FOV is 40°; half-angle = 20°.  Distance needed to fit the scene.
    const fovRad   = (40 * Math.PI) / 180;
    const distance = sceneRadius / Math.tan(fovRad / 2);

    // More overhead angle to view the flat-lying models like a print-bed preview.
    // [0, 100, 60] → ~59° above horizontal gives a clear top-down-ish view.
    const baseY = 100, baseZ = 60;
    const baseMag = Math.sqrt(baseY * baseY + baseZ * baseZ);
    camera.position.set(0, (baseY / baseMag) * distance, (baseZ / baseMag) * distance);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();

    // OrbitControls stores its own pivot `target` separately from camera.lookAt.
    // Without resetting it here, the next frame OrbitControls calls
    // camera.lookAt(oldTarget) and overrides our positioning, so the camera
    // appears to drift off-center after the user has panned.
    if (controls && "target" in controls) {
      (controls as { target: THREE.Vector3; update: () => void }).target.set(0, 0, 0);
      (controls as { target: THREE.Vector3; update: () => void }).update();
    }
  // controls must be in deps so the effect re-runs once OrbitControls mounts.
  // recenterKey is incremented by the Re-center button to trigger on demand.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetSizeMm, svgWidth, svgHeight, lockDimension, totalDepth, controls, recenterKey]);

  return null;
}

// ─── Main component ───────────────────────────────────────────────────────

export default function Studio() {
  const { user } = useUser();
  const { signOut } = useClerk();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const [svgState, setSvgState] = useState<ParsedSVGState | null>(null);
  const [projectName, setProjectName] = useState("My Fidget Toy");
  const [projectId, setProjectId] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [settings, setSettings] = useState<FidgetSettings>(DEFAULT_SETTINGS);
  const [fitCheckMode, setFitCheckMode] = useState(false);
  const [showDimensions, setShowDimensions] = useState(true);
  const [recenterKey, setRecenterKey] = useState(0);
  const [sliderHighlight, setSliderHighlight] = useState<MeshKey[]>([]);
  const hl = (keys: MeshKey[]) => ({
    onHighlightIn:  () => setSliderHighlight(keys),
    onHighlightOut: () => setSliderHighlight([]),
  });
  const [shellBounds, setShellBounds] = useState({ w: 0, h: 0 });

  // ViewCube shared state refs (avoids re-renders)
  const vcStateRef = useRef<{ quaternion: THREE.Quaternion; dist: number }>({
    quaternion: new THREE.Quaternion(),
    dist: 130,
  });
  const vcSnapRef  = useRef<SnapTarget | null>(null);
  const vcDragRef  = useRef<{ dx: number; dy: number } | null>(null);
  const [clickerBounds, setClickerBounds] = useState({ w: 0, h: 0 });
  // Draft value for the size input — lets the user finish typing before
  // the 3D scene recalculates.  Committed on blur or Enter.
  const [draftSizeMm, setDraftSizeMm] = useState<string>(String(DEFAULT_SETTINGS.targetSizeMm));

  const geoWarnings = useMemo<GeometryWarning[]>(
    () => svgState
      ? validateGeometry(svgState.shapes, settings, svgState.width, svgState.height)
      : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [svgState, settings]
  );

  // Compute grid metrics that track the actual model footprint so the
  // grid always sits flush under the models regardless of targetSizeMm.
  const sceneMetrics = useMemo(() => {
    if (!svgState) {
      // Placeholder box depth is 22 mm; after -90° scene rotation its back face
      // is at world Y = -(22/2) = -11. Put the grid just there.
      return { gridY: -11, gridSize: 300, cellSize: 5, sectionSize: 25, fadeDistance: 200,
               modelW: 0, modelH: 0, separationX: 35 };
    }
    const svgBase = settings.lockDimension === "width" ? svgState.width : svgState.height;
    const scale   = svgBase > 0 ? settings.targetSizeMm / svgBase : 1;
    // Models now lie flat (extruded along world Y after scene rotation).
    // The back face sits at world Y = -totalDepth/2, which is the print-bed floor.
    const gridY = -(settings.totalDepth / 2);

    // Scale grid cell/section density so lines aren't too dense for huge models
    // or too sparse for tiny ones.  Target ~10 cells across the model.
    const targetSize = settings.targetSizeMm;
    const rawCell    = targetSize / 10;
    // Snap cell size to a "nice" value: 1, 2, 5, 10, 20, 50, 100 …
    const niceSteps  = [0.5, 1, 2, 5, 10, 20, 50, 100, 200];
    const cellSize   = niceSteps.find(s => s >= rawCell) ?? 200;
    const sectionSize = cellSize * 5;
    const gridSize    = Math.max(300, targetSize * 8);
    const fadeDistance = Math.max(200, targetSize * 5);

    const modelHalfW  = (svgState.width  * scale) / 2;
    const separationX = Math.max(35, modelHalfW + 12);
    const modelW      = svgState.width  * scale;
    const modelH      = svgState.height * scale;

    return { gridY, gridSize, cellSize, sectionSize, fadeDistance, modelW, modelH, separationX };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [svgState, settings.lockDimension, settings.targetSizeMm]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const outerWallRef = useRef<THREE.Mesh | null>(null);
  const innerFillFloorRef = useRef<THREE.Mesh | null>(null);
  const innerFillPinSectionRef = useRef<THREE.Mesh | null>(null);
  const innerFillWallsRef = useRef<THREE.Mesh | null>(null);
  const clickerFloorRef = useRef<THREE.Mesh | null>(null);
  const clickerWallsRef = useRef<THREE.Mesh | null>(null);
  const bossBaseRef = useRef<THREE.Mesh | null>(null);
  const bossMainRef = useRef<THREE.Mesh | null>(null);

  const createProject = useCreateProject();
  const updateProject = useUpdateProject();

  const handleSVGLoad = useCallback(
    (content: string, fileName: string) => {
      try {
        const parsed = parseSVGContent(content);
        setSvgState({
          shapes: parsed.shapes,
          width: parsed.width,
          height: parsed.height,
          rawSvg: content,
          fileName,
        });
        setProjectName(fileName.replace(/\.svg$/i, ""));

        // Derive preview colours from the SVG's own fill/stroke palette
        const clickerColor = extractSvgColor(content);
        const shellColor   = deriveShellColor(clickerColor);
        setSettings((prev) => ({ ...prev, clickerColor, shellColor }));

        toast({
          title: "SVG loaded",
          description: `${parsed.shapes.length} shape(s) · ${parsed.width.toFixed(0)}×${parsed.height.toFixed(0)} px`,
        });
      } catch {
        toast({ title: "Failed to parse SVG", variant: "destructive" });
      }
    },
    [toast]
  );

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => handleSVGLoad(ev.target?.result as string, file.name);
    reader.readAsText(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file?.name.endsWith(".svg")) {
      const reader = new FileReader();
      reader.onload = (ev) => handleSVGLoad(ev.target?.result as string, file.name);
      reader.readAsText(file);
    } else {
      toast({ title: "Please drop an SVG file", variant: "destructive" });
    }
  };

  const [mergeForExport, setMergeForExport] = useState(false);

  const getMeshGroups = (): MeshGroups => ({
    shell: [outerWallRef, innerFillFloorRef, innerFillPinSectionRef, innerFillWallsRef]
      .map((r) => r.current).filter((m): m is THREE.Mesh => m !== null),
    clicker: [clickerFloorRef, clickerWallsRef, bossBaseRef, bossMainRef]
      .map((r) => r.current).filter((m): m is THREE.Mesh => m !== null),
  });

  const getMeshes = (): THREE.Mesh[] => {
    const g = getMeshGroups();
    return [...g.shell, ...g.clicker];
  };

  const handleExportSTL = async () => {
    const groups = getMeshGroups();
    if (!groups.shell.length && !groups.clicker.length) {
      toast({ title: "Upload an SVG first", variant: "destructive" });
      return;
    }
    if (mergeForExport) {
      await exportSTLMerged(groups);
      toast({ title: "STL exported — two files in zip" });
    } else {
      exportSTL(getMeshes());
      toast({ title: "STL exported" });
    }
  };

  const handleExport3MF = async () => {
    const groups = getMeshGroups();
    if (!groups.shell.length && !groups.clicker.length) {
      toast({ title: "Upload an SVG first", variant: "destructive" });
      return;
    }
    if (mergeForExport) {
      await export3MFMerged(groups);
      toast({ title: "3MF exported — two objects inside" });
    } else {
      await export3MF(getMeshes());
      toast({ title: "3MF exported" });
    }
  };

  const handleSave = async () => {
    if (!svgState) {
      toast({ title: "Upload an SVG first", variant: "destructive" });
      return;
    }
    try {
      const payload = {
        name: projectName,
        svgData: svgState.rawSvg,
        extrudeDepth: settings.totalDepth,
        keycapSize: settings.keycapSize,
      };
      if (projectId) {
        await updateProject.mutateAsync({ id: projectId, data: payload });
        toast({ title: "Project saved" });
      } else {
        const project = await createProject.mutateAsync({ data: payload });
        setProjectId(project.id);
        queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
        toast({ title: "Project created", description: project.name });
      }
    } catch {
      toast({ title: "Failed to save project", variant: "destructive" });
    }
  };

  const setSetting = <K extends keyof FidgetSettings>(key: K, value: FidgetSettings[K]) =>
    setSettings((s) => ({ ...s, [key]: value }));

  const isSaving = createProject.isPending || updateProject.isPending;

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* ── Top bar ── */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-3">
          <Link href="/">
            <Button variant="ghost" size="sm">
              <ChevronLeft className="h-4 w-4 mr-1" />
              Home
            </Button>
          </Link>
          <img src="/logo.svg" alt="ClickForge" className="h-6 w-6" />
          <Input
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            className="h-8 w-48 text-sm font-medium"
          />
          {projectId && <Badge variant="secondary">Saved</Badge>}
        </div>
        <div className="flex items-center gap-2">
          <Link href="/projects">
            <Button variant="ghost" size="sm">
              <LayoutList className="h-4 w-4 mr-1" />
              My Projects
            </Button>
          </Link>
          <Button variant="ghost" size="sm" onClick={() => signOut(() => setLocation("/"))}>
            <LogOut className="h-4 w-4 mr-1" />
            {user?.firstName ?? "Sign out"}
          </Button>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* ── Left sidebar ── */}
        <aside className="w-72 border-r border-border bg-card flex flex-col shrink-0 overflow-y-auto">
          <div className="p-4 space-y-6">

            {/* Upload zone */}
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
                Upload SVG
              </h2>

              {svgState ? (
                /* ── SVG preview ── */
                <div className="space-y-2">
                  <div className="rounded-xl border border-border bg-accent/30 p-3 flex items-center justify-center min-h-[110px]">
                    <img
                      src={`data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgState.rawSvg)))}`}
                      alt={svgState.fileName}
                      className="max-h-[120px] max-w-full object-contain"
                    />
                  </div>
                  <div className="text-center">
                    <p className="text-xs font-medium text-foreground truncate">{svgState.fileName}</p>
                    <p className="text-xs text-muted-foreground">
                      {svgState.width.toFixed(0)} × {svgState.height.toFixed(0)} px
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-border hover:border-primary hover:bg-accent/50 text-xs text-muted-foreground hover:text-foreground transition-colors py-2 cursor-pointer"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    Upload new SVG
                  </button>
                </div>
              ) : (
                /* ── Empty drop zone ── */
                <div
                  className={`border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-colors ${
                    isDragging
                      ? "border-primary bg-accent"
                      : "border-border hover:border-primary hover:bg-accent/50"
                  }`}
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                >
                  <Upload className="h-5 w-5 mx-auto text-muted-foreground mb-2" />
                  <p className="text-sm text-muted-foreground">Drop SVG or click to browse</p>
                </div>
              )}

              <input
                ref={fileInputRef}
                type="file"
                accept=".svg"
                className="hidden"
                onChange={handleFileChange}
              />

              {/* Import dimension controls — always visible so user can set before importing */}
              <div className="mt-3 space-y-2">
                <div className="flex items-center gap-1 text-xs text-muted-foreground font-medium">
                  <Ruler className="h-3 w-3" />
                  Import size
                </div>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <Label className="text-xs text-muted-foreground mb-1 block">Lock to</Label>
                    <select
                      value={settings.lockDimension}
                      onChange={(e) => setSetting("lockDimension", e.target.value as "width" | "height")}
                      className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      <option value="width">Width</option>
                      <option value="height">Height</option>
                    </select>
                  </div>
                  <div className="flex-1">
                    <Label className="text-xs text-muted-foreground mb-1 block">
                      Size (mm)
                    </Label>
                    <Input
                      type="number"
                      min={10}
                      max={200}
                      step={1}
                      value={draftSizeMm}
                      onChange={(e) => setDraftSizeMm(e.target.value)}
                      onBlur={() => {
                        const n = Number(draftSizeMm);
                        const clamped = Number.isFinite(n) ? Math.min(200, Math.max(10, n)) : settings.targetSizeMm;
                        setDraftSizeMm(String(clamped));
                        setSetting("targetSizeMm", clamped);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      }}
                      className="h-8 text-xs"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Geometry warnings */}
            {geoWarnings.length > 0 && (
              <div className="space-y-2">
                {geoWarnings.map((w, i) => (
                  <div
                    key={i}
                    className={`flex gap-2 rounded-lg px-3 py-2.5 text-xs leading-snug border ${
                      w.severity === "error"
                        ? "bg-red-950/60 border-red-800/50 text-red-200"
                        : "bg-amber-950/60 border-amber-800/50 text-amber-200"
                    }`}
                  >
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <span>{w.message}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Outer shell dimensions */}
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
                Outer Shell
              </h2>
              <div className="space-y-5">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Preview color</span>
                  <input
                    type="color"
                    value={settings.shellColor ?? DEFAULT_SETTINGS.shellColor}
                    onChange={(e) => setSetting("shellColor", e.target.value)}
                    className="h-8 w-14 rounded border border-input cursor-pointer bg-transparent p-0.5"
                  />
                </div>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={settings.mirrorShell ?? false}
                    onChange={(e) => setSetting("mirrorShell", e.target.checked)}
                    className="h-4 w-4 rounded accent-primary"
                  />
                  <span className="text-sm">Mirror left-right</span>
                </label>
                <SliderRow
                  label="Total depth"
                  value={settings.totalDepth}
                  min={10}
                  max={40}
                  step={0.01}
                  unit="mm"
                  onChange={(v) => setSetting("totalDepth", v)}
                  {...hl(["shell_outer"])}
                />
                <SliderRow
                  label="Housing depth"
                  value={settings.innerFillDepth}
                  min={4}
                  max={settings.totalDepth - 2}
                  step={0.01}
                  unit="mm"
                  onChange={(v) => setSetting("innerFillDepth", v)}
                  {...hl(["shell_floor", "shell_walls"])}
                />
                <SliderRow
                  label="Keycap pocket depth"
                  value={settings.keycapPocketDepth ?? DEFAULT_SETTINGS.keycapPocketDepth}
                  min={2}
                  max={settings.innerFillDepth - 1}
                  step={0.01}
                  unit="mm"
                  onChange={(v) => setSetting("keycapPocketDepth", v)}
                  {...hl(["shell_walls"])}
                />
                <SliderRow
                  label="Wall thickness"
                  value={settings.insetAmount}
                  min={0.5}
                  max={5}
                  step={0.01}
                  unit="mm"
                  onChange={(v) => setSetting("insetAmount", v)}
                  {...hl(["shell_outer", "shell_floor", "shell_walls"])}
                />

                {/* Switch pin holes — sub-section under Outer Shell */}
                <div className="border-t border-border/40 pt-4 space-y-3">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={settings.pinHolesEnabled}
                      onChange={(e) => setSetting("pinHolesEnabled", e.target.checked)}
                      className="h-4 w-4 rounded accent-primary"
                    />
                    <span className="text-sm">Cherry MX 5-pin holes</span>
                    <InfoTooltip text="Punches the Cherry MX 5-pin footprint into the deepest section of the pocket: Ø4 mm center guide · Ø1.8 mm retention pegs (±5.08 mm) · Ø1.5 mm contacts (±3.81 mm / −2.54 mm). The pin section sits below the keycap square — from the pocket floor upward." />
                  </label>
                  {settings.pinHolesEnabled && (
                    <div className="space-y-3 pl-6">
                      <SliderRow
                        label="Pin section depth"
                        value={settings.pinHoleDepth ?? DEFAULT_SETTINGS.pinHoleDepth}
                        min={1}
                        max={Math.max(1, (settings.keycapPocketDepth ?? DEFAULT_SETTINGS.keycapPocketDepth) - 1)}
                        step={0.01}
                        unit="mm"
                        onChange={(v) => setSetting("pinHoleDepth", v)}
                        {...hl(["shell_pin"])}
                      />
                      <SliderRow
                        label="Print clearance"
                        value={settings.pinHoleRadius ?? DEFAULT_SETTINGS.pinHoleRadius}
                        min={0}
                        max={0.5}
                        step={0.01}
                        unit="mm"
                        onChange={(v) => setSetting("pinHoleRadius", v)}
                        {...hl(["shell_pin"])}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Switch dimensions — keycap pocket + switch housing cavity */}
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
                Switch Dimensions
              </h2>
              <div className="space-y-5">
                <SliderRow
                  label="Keycap square"
                  value={settings.keycapSize}
                  min={10}
                  max={22}
                  step={0.01}
                  unit="mm"
                  onChange={(v) => setSetting("keycapSize", v)}
                  {...hl(["shell_walls"])}
                />
                <SliderRow
                  label="Switch cavity size"
                  value={settings.clickerSquareSize ?? DEFAULT_SETTINGS.clickerSquareSize}
                  min={10}
                  max={30}
                  step={0.01}
                  unit="mm"
                  onChange={(v) => setSetting("clickerSquareSize", v)}
                  {...hl(["click_walls"])}
                />
                <SliderRow
                  label="Switch cavity depth"
                  value={settings.clickerSquareDepth ?? DEFAULT_SETTINGS.clickerSquareDepth}
                  min={1}
                  max={Math.max(1, (settings.clickerTotalDepth ?? DEFAULT_SETTINGS.clickerTotalDepth) - (settings.clickerFloorDepth ?? DEFAULT_SETTINGS.clickerFloorDepth))}
                  step={0.01}
                  unit="mm"
                  onChange={(v) => setSetting("clickerSquareDepth", v)}
                  {...hl(["click_walls"])}
                />

                {/* Pocket position nudge */}
                <div className="border-t border-border/40 pt-4 space-y-3">
                  <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">
                    Pocket position nudge
                    <InfoTooltip text="Shifts the keycap pocket, switch cavity, and boss together as a unit. Use this to visually re-centre the switch on irregular or asymmetric shapes. Both parts move identically so they stay aligned." />
                  </div>
                  <SliderRow
                    label="Offset X"
                    value={settings.pocketOffsetX ?? 0}
                    min={-20}
                    max={20}
                    step={0.1}
                    unit="mm"
                    onChange={(v) => setSetting("pocketOffsetX", v)}
                    {...hl(["shell_walls", "click_boss", "click_walls"])}
                  />
                  <SliderRow
                    label="Offset Y"
                    value={settings.pocketOffsetY ?? 0}
                    min={-20}
                    max={20}
                    step={0.1}
                    unit="mm"
                    onChange={(v) => setSetting("pocketOffsetY", v)}
                    {...hl(["shell_walls", "click_boss", "click_walls"])}
                  />
                </div>
              </div>
            </div>

            {/* Inner clicker dimensions */}
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
                Inner Clicker
              </h2>
              <div className="space-y-5">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Preview color</span>
                  <input
                    type="color"
                    value={settings.clickerColor ?? DEFAULT_SETTINGS.clickerColor}
                    onChange={(e) => setSetting("clickerColor", e.target.value)}
                    className="h-8 w-14 rounded border border-input cursor-pointer bg-transparent p-0.5"
                  />
                </div>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={settings.mirrorClicker ?? false}
                    onChange={(e) => setSetting("mirrorClicker", e.target.checked)}
                    className="h-4 w-4 rounded accent-primary"
                  />
                  <span className="text-sm">Mirror left-right</span>
                </label>
                <SliderRow
                  label="Total thickness"
                  value={settings.clickerTotalDepth ?? DEFAULT_SETTINGS.clickerTotalDepth}
                  min={3}
                  max={30}
                  step={0.01}
                  unit="mm"
                  onChange={(v) => setSetting("clickerTotalDepth", v)}
                  {...hl(["click_floor", "click_walls"])}
                />
                <SliderRow
                  label="Solid floor"
                  value={settings.clickerFloorDepth ?? DEFAULT_SETTINGS.clickerFloorDepth}
                  min={0.5}
                  max={Math.max(0.5, (settings.clickerTotalDepth ?? DEFAULT_SETTINGS.clickerTotalDepth) - 1)}
                  step={0.01}
                  unit="mm"
                  onChange={(v) => setSetting("clickerFloorDepth", v)}
                  {...hl(["click_floor"])}
                />
                <SliderRow
                  label="Boss diameter"
                  value={settings.bossDiameter ?? DEFAULT_SETTINGS.bossDiameter}
                  min={1}
                  max={15}
                  step={0.01}
                  unit="mm"
                  onChange={(v) => setSetting("bossDiameter", v)}
                  {...hl(["click_boss"])}
                />
                <SliderRow
                  label="Boss height"
                  value={settings.bossHeight ?? DEFAULT_SETTINGS.bossHeight}
                  min={0.5}
                  max={15}
                  step={0.01}
                  unit="mm"
                  onChange={(v) => setSetting("bossHeight", v)}
                  {...hl(["click_boss"])}
                />
                <SliderRow
                  label="Boss floor gap"
                  value={settings.bossFloorGap ?? DEFAULT_SETTINGS.bossFloorGap}
                  min={0}
                  max={Math.max(0, (settings.clickerFloorDepth ?? DEFAULT_SETTINGS.clickerFloorDepth) - 0.1)}
                  step={0.01}
                  unit="mm"
                  onChange={(v) => setSetting("bossFloorGap", v)}
                  {...hl(["click_boss"])}
                />
                <div className="pt-1 pb-0.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">
                  MX cross pocket
                </div>
                <SliderRow
                  label="Cross size"
                  value={settings.crossSize ?? DEFAULT_SETTINGS.crossSize}
                  min={2}
                  max={6}
                  step={0.01}
                  unit="mm"
                  onChange={(v) => setSetting("crossSize", v)}
                  {...hl(["click_boss"])}
                />
                <SliderRow
                  label="Cross depth"
                  value={settings.crossDepth ?? DEFAULT_SETTINGS.crossDepth}
                  min={0.5}
                  max={Math.max(0.5, (settings.bossHeight ?? DEFAULT_SETTINGS.bossHeight) - 0.05)}
                  step={0.01}
                  unit="mm"
                  onChange={(v) => setSetting("crossDepth", v)}
                  {...hl(["click_boss"])}
                />
                <SliderRow
                  label="Arm width"
                  value={settings.crossArmWidth ?? DEFAULT_SETTINGS.crossArmWidth}
                  min={0.8}
                  max={Math.max(0.8, (settings.crossSize ?? DEFAULT_SETTINGS.crossSize) * 0.9)}
                  step={0.01}
                  unit="mm"
                  onChange={(v) => setSetting("crossArmWidth", v)}
                  {...hl(["click_boss"])}
                />
              </div>
            </div>

            {/* Parts legend */}
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
                Parts
              </h2>
              <div className="space-y-1.5 text-xs">
                <LegendRow color="#6C63FF" label="Outer wall (ring)" />
                <LegendRow color="#9B94FF" label="Solid floor + keycap square walls" />
                {settings.pinHolesEnabled && (
                  <LegendRow color="#7C74E8" label="MX pin-hole section" />
                )}
                <LegendRow color="#10B981" label="Inner clicker body" />
                <LegendRow color="#34D399" label="Actuator boss" />
              </div>
              {svgState && (() => {
                const kpd = settings.keycapPocketDepth ?? DEFAULT_SETTINGS.keycapPocketDepth;
                const phd = settings.pinHoleDepth ?? DEFAULT_SETTINGS.pinHoleDepth;
                const pocketDepth = Math.min(kpd, settings.innerFillDepth - 1);
                const floorDepth = settings.innerFillDepth - pocketDepth;
                const pinDepth = settings.pinHolesEnabled ? Math.min(phd, pocketDepth - 1) : 0;
                const squareDepth = pocketDepth - pinDepth;
                return (
                  <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                    <p>Solid floor: <span className="font-mono font-medium text-foreground">{floorDepth.toFixed(1)} mm</span></p>
                    {settings.pinHolesEnabled && (
                      <p>Pin section: <span className="font-mono font-medium text-foreground">{pinDepth.toFixed(1)} mm</span></p>
                    )}
                    <p>Keycap square: <span className="font-mono font-medium text-foreground">{squareDepth.toFixed(1)} mm</span></p>
                    <p>Clicker recess: <span className="font-mono font-medium text-foreground">{(settings.totalDepth - settings.innerFillDepth).toFixed(1)} mm</span></p>
                  </div>
                );
              })()}
            </div>

            {/* Actions */}
            <div className="space-y-2">
              <Button
                className="w-full"
                onClick={handleSave}
                disabled={isSaving || !svgState}
              >
                <Save className="h-4 w-4 mr-2" />
                {isSaving ? "Saving…" : projectId ? "Update Project" : "Save Project"}
              </Button>

              {/* Merge toggle */}
              <label className="flex items-center gap-2 cursor-pointer select-none px-1 py-0.5">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded accent-indigo-600"
                  checked={mergeForExport}
                  onChange={(e) => setMergeForExport(e.target.checked)}
                />
                <span className="text-xs text-muted-foreground leading-tight">
                  Merge parts on export
                  <span className="block text-[10px] opacity-70">
                    {mergeForExport
                      ? "Shell & clicker exported as separate fused meshes"
                      : "Each part exported individually"}
                  </span>
                </span>
              </label>

              <Button
                variant="outline"
                className="w-full"
                onClick={handleExportSTL}
                disabled={!svgState}
              >
                <Download className="h-4 w-4 mr-2" />
                {mergeForExport ? "Export STL (zip)" : "Export STL"}
              </Button>
              <Button
                variant="outline"
                className="w-full"
                onClick={handleExport3MF}
                disabled={!svgState}
              >
                <Download className="h-4 w-4 mr-2" />
                Export 3MF
              </Button>
            </div>

          </div>
        </aside>

        {/* ── 3D canvas ── */}
        <main className="flex-1 relative">
          {!svgState && (
            <div className="absolute inset-0 flex flex-col items-center justify-center z-10 pointer-events-none">
              <Box className="h-12 w-12 text-muted-foreground/30 mb-3" />
              <p className="text-muted-foreground text-sm">Upload an SVG to see your fidget toy</p>
            </div>
          )}

          {/* ── Dimensions + Fit-check (top-right) ── */}
          {svgState && (
            <div className="absolute top-3 right-3 z-10 flex items-center gap-2">
              {/* Dimensions toggle */}
              <button
                onClick={() => setShowDimensions((v) => !v)}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium border transition-colors ${
                  showDimensions
                    ? "bg-amber-600/80 border-amber-500 text-white shadow-lg"
                    : "bg-background/80 border-border text-muted-foreground hover:text-foreground backdrop-blur-sm"
                }`}
                title="Toggle dimension callouts"
              >
                <Ruler className="h-3.5 w-3.5" />
                Dimensions
              </button>
              <button
                onClick={() => setFitCheckMode((v) => !v)}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium border transition-colors ${
                  fitCheckMode
                    ? "bg-indigo-600 border-indigo-500 text-white shadow-lg"
                    : "bg-background/80 border-border text-muted-foreground hover:text-foreground backdrop-blur-sm"
                }`}
                title="Toggle fit-check view — snap pieces together to verify pocket & recess alignment"
              >
                <Layers className="h-3.5 w-3.5" />
                Fit Check
              </button>
              {fitCheckMode && (
                <span className="text-[10px] text-indigo-300/80 bg-indigo-950/60 border border-indigo-800/40 rounded px-2 py-1 backdrop-blur-sm">
                  Outer shell ghosted · clicker seated in recess
                </span>
              )}
            </div>
          )}

          <Canvas
            camera={{ position: [0, 100, 60], fov: 40 }}
            shadows
            style={{ background: "hsl(240 15% 8%)" }}
          >
            <ambientLight intensity={0.6} />
            <directionalLight position={[50, 80, 40]} intensity={1.4} castShadow
              shadow-mapSize={[2048, 2048]}
            />
            <directionalLight position={[-30, 30, -20]} intensity={0.35} />

            <Suspense fallback={null}>
              {/* Rotate entire scene so models lie flat on the print bed.
                  -90° around X maps extrusion-Z → world +Y (depth goes up),
                  putting the pocket/housing face at world +Y (facing the viewer)
                  and the flat base at world -Y (on the print-bed grid). */}
              <group rotation={[-Math.PI / 2, 0, 0]}>
                {svgState ? (
                  <>
                    <OuterShellGroup
                      shapes={svgState.shapes}
                      settings={settings}
                      svgWidth={svgState.width}
                      svgHeight={svgState.height}
                      outerWallRef={outerWallRef}
                      innerFillFloorRef={innerFillFloorRef}
                      innerFillPinSectionRef={innerFillPinSectionRef}
                      innerFillWallsRef={innerFillWallsRef}
                      fitCheck={fitCheckMode}
                      onBounds={setShellBounds}
                      color={settings.shellColor ?? DEFAULT_SETTINGS.shellColor}
                      activeHighlights={sliderHighlight}
                    />
                    <InnerClickerGroup
                      shapes={svgState.shapes}
                      settings={settings}
                      svgWidth={svgState.width}
                      svgHeight={svgState.height}
                      clickerFloorRef={clickerFloorRef}
                      clickerWallsRef={clickerWallsRef}
                      bossBaseRef={bossBaseRef}
                      bossMainRef={bossMainRef}
                      fitCheck={fitCheckMode}
                      onBounds={setClickerBounds}
                      color={settings.clickerColor ?? DEFAULT_SETTINGS.clickerColor}
                      activeHighlights={sliderHighlight}
                    />
                  </>
                ) : (
                  <PlaceholderMeshes />
                )}
              </group>
            </Suspense>

            <Grid
              args={[sceneMetrics.gridSize, sceneMetrics.gridSize]}
              cellSize={sceneMetrics.cellSize}
              cellThickness={1}
              cellColor="#2a2a42"
              sectionSize={sceneMetrics.sectionSize}
              sectionThickness={1.8}
              sectionColor="#4a4a72"
              fadeDistance={sceneMetrics.fadeDistance}
              position={[0, sceneMetrics.gridY, 0]}
            />

            {svgState && (
              <AutoCamera
                targetSizeMm={settings.targetSizeMm}
                svgWidth={svgState.width}
                svgHeight={svgState.height}
                lockDimension={settings.lockDimension}
                totalDepth={settings.totalDepth}
                recenterKey={recenterKey}
              />
            )}

            {/* Dimension annotations — world-space, outside the rotation group */}
            {svgState && showDimensions && !fitCheckMode && sceneMetrics.modelW > 0 && (
              <>
                {/* Shell: use actual outer-wall bounding box */}
                <ModelDimensionAnnotation
                  centerX={-sceneMetrics.separationX}
                  widthMm={shellBounds.w}
                  heightMm={shellBounds.h}
                  color="#8b8fff"
                  lineY={sceneMetrics.gridY}
                />
                {/* Clicker: use actual clicker-body bounding box */}
                <ModelDimensionAnnotation
                  centerX={sceneMetrics.separationX}
                  widthMm={clickerBounds.w}
                  heightMm={clickerBounds.h}
                  color="#34d399"
                  lineY={sceneMetrics.gridY}
                />
              </>
            )}

            <CameraTracker stateRef={vcStateRef} snapRef={vcSnapRef} dragRef={vcDragRef} />
            <OrbitControls makeDefault enablePan enableZoom enableRotate />
          </Canvas>

          {/* Labels */}
          {svgState && (
            <>
              <div
                className="absolute top-4 left-[25%] -translate-x-1/2 text-xs text-white/70 rounded px-2 py-1 pointer-events-none"
                style={{
                  backgroundColor: `${settings.shellColor ?? DEFAULT_SETTINGS.shellColor}33`,
                  borderWidth: 1,
                  borderStyle: "solid",
                  borderColor: `${settings.shellColor ?? DEFAULT_SETTINGS.shellColor}4D`,
                }}
              >
                Outer Shell
              </div>
              <div
                className="absolute top-4 right-[25%] translate-x-1/2 text-xs text-white/70 rounded px-2 py-1 pointer-events-none"
                style={{
                  backgroundColor: `${settings.clickerColor ?? DEFAULT_SETTINGS.clickerColor}33`,
                  borderWidth: 1,
                  borderStyle: "solid",
                  borderColor: `${settings.clickerColor ?? DEFAULT_SETTINGS.clickerColor}4D`,
                }}
              >
                Inner Clicker
              </div>
            </>
          )}

          {/* ── ViewCube + Re-center (bottom-left) ── */}
          <div className="absolute bottom-4 left-4 z-10 flex items-end gap-2">
            <ViewCube stateRef={vcStateRef} snapRef={vcSnapRef} dragRef={vcDragRef} />
            <button
              onClick={() => setRecenterKey((k) => k + 1)}
              className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium border transition-colors bg-background/80 border-border text-muted-foreground hover:text-foreground backdrop-blur-sm mb-0.5"
              title="Re-center — reset the camera to frame both parts"
            >
              <Crosshair className="h-3.5 w-3.5" />
              Re-center
            </button>
          </div>

          <div className="absolute bottom-4 right-4 text-xs text-muted-foreground bg-card/80 backdrop-blur px-2 py-1 rounded">
            Scroll to zoom · Middle-drag to pan
          </div>
        </main>
      </div>
    </div>
  );
}

// ─── Small sub-components ─────────────────────────────────────────────────

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
  onHighlightIn,
  onHighlightOut,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (v: number) => void;
  onHighlightIn?: () => void;
  onHighlightOut?: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  const commit = (raw: string) => {
    const n = parseFloat(raw);
    if (!isNaN(n)) onChange(Math.min(max, Math.max(min, n)));
    setDraft(null);
  };

  return (
    <div onMouseEnter={onHighlightIn} onMouseLeave={onHighlightOut}>
      <div className="flex justify-between items-center mb-1">
        <Label className="text-xs">{label}</Label>
        <div className="flex items-center gap-1">
          <input
            type="number"
            min={min}
            max={max}
            step={step}
            value={draft ?? (value ?? 0).toFixed(2)}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit((e.target as HTMLInputElement).value);
              if (e.key === "Escape") setDraft(null);
            }}
            className="w-16 text-xs font-mono text-right bg-transparent border border-transparent hover:border-border focus:border-primary focus:outline-none rounded px-1 py-0.5 text-muted-foreground focus:text-foreground transition-colors"
          />
          <span className="text-xs text-muted-foreground">{unit}</span>
        </div>
      </div>
      <Slider
        min={min}
        max={max}
        step={step}
        value={[value ?? min]}
        onValueChange={([v]) => onChange(v)}
      />
    </div>
  );
}

function LegendRow({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="inline-block h-2.5 w-2.5 rounded-sm shrink-0"
        style={{ background: color }}
      />
      <span className="text-muted-foreground">{label}</span>
    </div>
  );
}
