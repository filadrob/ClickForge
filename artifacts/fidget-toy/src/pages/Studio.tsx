import { useState, useRef, useCallback, useMemo, Suspense, useEffect, memo } from "react";
import { Canvas, useThree, useFrame } from "@react-three/fiber";
import { OrbitControls, Grid, Html, Line } from "@react-three/drei";
import * as THREE from "three";
import { useLocation, useParams, Link } from "wouter";
import { useUser, useAuth } from "@/lib/auth";
import { useTier, FREE_PROJECT_LIMIT, type GatedFeature } from "@/lib/tier";
import {
  loadDraft,
  saveDraft,
  clearDraft,
  getAnonStlExportCount,
  incrementAnonStlExportCount,
  loadSidebarMode,
  saveSidebarMode,
  setPromotePending,
  getPromotePending,
  type SidebarMode,
} from "@/lib/draft";
import { PremiumLabel } from "@/components/PremiumLabel";
import { UpgradeModal } from "@/components/UpgradeModal";
import { AuthRequiredModal } from "@/components/AuthRequiredModal";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useCreateProject, useUpdateProject, useGetProject } from "@/hooks/useProjects";
import { useGetPreferences, useUpdatePreferences } from "@/hooks/usePreferences";
import { useQueryClient } from "@tanstack/react-query";
import { parseSVGContent, parseSVGColorRegions, extractSvgColor, analyzeSVG } from "@/lib/svgParser";
import type { SVGCompatibilityIssue } from "@/lib/svgParser";
import LibraryPickerPanel from "@/components/LibraryPickerPanel";
import { consumePendingLibrarySvg } from "@/lib/librarySession";
import BananaMesh from "@/components/BananaMesh";
import {
  createOuterShellGeometries,
  createInnerClickerGeometries,
  createKeyRingGeometry,
  createColorLayerGeometries,
  validateGeometry,
  getShellTotalDepth,
  getOuterShellSig,
  getInnerClickerSig,
  getColorLayerSig,
  getKeyRingSig,
  getValidateSig,
  DEFAULT_SETTINGS,
  computeAutoPocketOffset,
  type FidgetSettings,
  type GeometryWarning,
} from "@/lib/fidgetGeometry";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { exportSTL, export3MF, exportSTLMerged, export3MFMerged, exportOBJ, exportOBJMerged, type MeshGroups } from "@/lib/exporters";
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
  Scan,
  Mouse,
  MoveHorizontal,
  RotateCcw,
  ChevronDown,
  Settings2,
  Crown,
  EyeOff,
  LogIn,
} from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

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

// ─── View mode ────────────────────────────────────────────────────────────

type ViewMode = "solid" | "wireframe" | "xray";

// ─── Outer shell: outer wall ring + inner fill (floor + pocket walls) ────

/**
 * Renders the per-color flat extruded slab bodies that pair with the outer
 * shell.  Each region becomes its own mesh in the SVG's true fill color and
 * is bumped by `i * 0.01` mm in local z purely to avoid preview z-fighting
 * when nested regions overlap.  The geometry itself remains flush with the
 * shell's bottom face (z=0 .. colorLayerThickness) so exports are unaffected
 * by the preview-only stagger.
 */
function ColorLayersGroupInner({
  geometries,
  settings,
  svgWidth,
  svgHeight,
  fitCheck,
  groupRef,
}: {
  geometries: Array<{ color: string; geometry: THREE.BufferGeometry }>;
  settings: FidgetSettings;
  svgWidth: number;
  svgHeight: number;
  fitCheck: boolean;
  groupRef: React.RefObject<THREE.Group | null>;
}) {
  const flip = settings.flipShell ?? false;
  const shellDepth = getShellTotalDepth(settings);
  const groupZ = flip ? shellDepth / 2 : -shellDepth / 2;

  const svgBase = settings.lockDimension === "width" ? svgWidth : svgHeight;
  const scale = svgBase > 0 ? settings.targetSizeMm / svgBase : 1;
  const modelHalfW = (svgWidth * scale) / 2;
  const separationX = Math.max(35, modelHalfW + 12);
  const groupX = fitCheck ? 0 : -separationX;

  // The per-mesh `i * 0.01` z bump is preview-only — exporters intentionally
  // do NOT use these mesh transforms; they read geometries directly and
  // apply only the parent group's world matrix (see getMeshGroups()).
  return (
    <group ref={groupRef} position={[groupX, 0, groupZ]} rotation={[flip ? Math.PI : 0, 0, 0]}>
      {geometries.map((g, i) => (
        <mesh key={`${g.color}-${i}`} position={[0, 0, i * 0.01]}>
          <primitive object={g.geometry} />
          <meshStandardMaterial color={g.color} metalness={0.05} roughness={0.7} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * Shallow-equal an array of primitives.  Used by the React.memo comparators
 * below so transient `activeHighlights` array re-allocations (which happen on
 * every parent render) don't defeat memoisation.
 */
function arraysShallowEqual<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * React.memo wrapper for ColorLayersGroup.  Skips re-rendering when only the
 * `shellColor` / `clickerColor` parent state changed (which doesn't affect
 * colour-layer geometry or rendering at all).
 */
const ColorLayersGroup = memo(
  ColorLayersGroupInner,
  (prev, next) =>
    prev.geometries === next.geometries &&
    prev.svgWidth === next.svgWidth &&
    prev.svgHeight === next.svgHeight &&
    prev.fitCheck === next.fitCheck &&
    prev.groupRef === next.groupRef &&
    getColorLayerSig(prev.settings) === getColorLayerSig(next.settings) &&
    // ColorLayersGroup also reads flipShell + targetSizeMm/lockDimension
    // outside the geometry sig (for positioning), so guard those too.
    (prev.settings.flipShell ?? false) === (next.settings.flipShell ?? false),
);

function OuterShellGroupInner({
  shapes,
  settings,
  svgWidth,
  svgHeight,
  outerWallRef,
  innerFillFloorRef,
  innerFillPinSectionRef,
  innerFillWallsRef,
  innerFillHousingCapRef,
  shellBossBaseRef,
  shellBossMainRef,
  keyRingRef,
  fitCheck,
  onBounds,
  color,
  activeHighlights = [],
  viewMode = "solid",
}: {
  shapes: THREE.Shape[];
  settings: FidgetSettings;
  svgWidth: number;
  svgHeight: number;
  outerWallRef: React.RefObject<THREE.Mesh | null>;
  innerFillFloorRef: React.RefObject<THREE.Mesh | null>;
  innerFillPinSectionRef: React.RefObject<THREE.Mesh | null>;
  innerFillWallsRef: React.RefObject<THREE.Mesh | null>;
  innerFillHousingCapRef: React.RefObject<THREE.Mesh | null>;
  shellBossBaseRef: React.RefObject<THREE.Mesh | null>;
  shellBossMainRef: React.RefObject<THREE.Mesh | null>;
  keyRingRef: React.RefObject<THREE.Mesh | null>;
  fitCheck: boolean;
  onBounds?: (b: { w: number; h: number }) => void;
  color: string;
  activeHighlights: MeshKey[];
  viewMode?: ViewMode;
}) {
  // Cache keys that exclude cosmetic colour fields and any setting the
  // matching builder doesn't read.  Same-content strings compare equal under
  // React's Object.is dep check so this is effectively memoised — picking a
  // new colour, toggling the key ring, or moving the colour-layer slider all
  // skip the (very expensive) ExtrudeGeometry rebuild here.
  const shellSig   = getOuterShellSig(settings);
  const keyRingSig = getKeyRingSig(settings);
  const geos = useMemo(
    () => createOuterShellGeometries(shapes, settings, svgWidth, svgHeight),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shapes, shellSig, svgWidth, svgHeight]
  );

  const keyRing = useMemo(
    () => (settings.keyRingEnabled && (settings.keyRingOnShell ?? true))
      ? createKeyRingGeometry(geos.bounds, settings)
      : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [geos, keyRingSig]
  );

  // Report actual shell footprint to parent whenever geometry changes.
  useEffect(() => { onBounds?.(geos.bounds); }, [geos, onBounds]);

  const flip = settings.flipShell ?? false;
  // Geometry runs from local z=0 to z=totalDepth. When unflipped we centre it
  // at world z=0 by shifting the group to -totalDepth/2.  When flipped we
  // rotate 180° around X (so local +z becomes world -z) and shift to
  // +totalDepth/2 so the part still straddles world z=0.
  const shellDepth = getShellTotalDepth(settings);
  const groupZ = flip ? shellDepth / 2 : -shellDepth / 2;

  // Separation must grow with the model so the two parts never overlap.
  // Compute the actual model half-width from the locked dimension + aspect ratio.
  const svgBase = settings.lockDimension === "width" ? svgWidth : svgHeight;
  const scale = svgBase > 0 ? settings.targetSizeMm / svgBase : 1;
  const modelHalfW = (svgWidth * scale) / 2;
  const separationX = Math.max(35, modelHalfW + 12);

  const groupX = fitCheck ? 0 : -separationX;

  const isWire = viewMode === "wireframe";
  const isXray = viewMode === "xray";
  const hl = (k: MeshKey) => activeHighlights.includes(k);
  return (
    <group position={[groupX, 0, groupZ]} rotation={[flip ? Math.PI : 0, 0, 0]}>
      {/* Outer wall ring — ghost in fit-check so you can see inside */}
      <mesh ref={outerWallRef} position={[0, 0, geos.zOffsets.outerWall]} castShadow={!fitCheck && !isXray && !isWire} receiveShadow>
        <primitive object={geos.outerWall} />
        <meshStandardMaterial
          color={color}
          metalness={0.25}
          roughness={0.45}
          opacity={isWire ? 0 : fitCheck ? 0.28 : isXray ? 0.3 : 1}
          transparent={isWire || fitCheck || isXray}
          depthWrite={!isWire && !fitCheck && !isXray}
        />
      </mesh>
      {isWire && <EdgeWireframe geometry={geos.outerWall} position={[0, 0, geos.zOffsets.outerWall]} color={color} />}
      <MeshHighlightOverlay geometry={geos.outerWall} position={[0, 0, geos.zOffsets.outerWall]} highlighted={hl("shell_outer")} />
      <MeshHighlightOverlay geometry={geos.outerWallExtension} position={[0, 0, geos.zOffsets.outerWallExtension]} highlighted={hl("shell_extension")} />

      {/* Solid floor — never penetrated */}
      <mesh ref={innerFillFloorRef} position={[0, 0, geos.zOffsets.innerFillFloor]} castShadow={!isXray && !isWire} receiveShadow>
        <primitive object={geos.innerFillFloor} />
        <meshStandardMaterial color={color} metalness={0.15} roughness={0.55} opacity={isWire ? 0 : isXray ? 0.3 : 1} transparent={isWire || isXray} depthWrite={!isWire && !isXray} />
      </mesh>
      {isWire && <EdgeWireframe geometry={geos.innerFillFloor} position={[0, 0, geos.zOffsets.innerFillFloor]} color={color} />}
      <MeshHighlightOverlay geometry={geos.innerFillFloor} position={[0, 0, geos.zOffsets.innerFillFloor]} highlighted={hl("shell_floor")} />

      {/* MX pin-hole section — deepest part of pocket (only when enabled) */}
      {geos.innerFillPinSection && (
        <>
          <mesh ref={innerFillPinSectionRef} position={[0, 0, geos.zOffsets.innerFillPinSection]} castShadow={!isXray && !isWire} receiveShadow>
            <primitive object={geos.innerFillPinSection} />
            <meshStandardMaterial color={color} metalness={0.15} roughness={0.55} opacity={isWire ? 0 : isXray ? 0.3 : 1} transparent={isWire || isXray} depthWrite={!isWire && !isXray} />
          </mesh>
          {isWire && <EdgeWireframe geometry={geos.innerFillPinSection} position={[0, 0, geos.zOffsets.innerFillPinSection]} color={color} />}
          <MeshHighlightOverlay geometry={geos.innerFillPinSection} position={[0, 0, geos.zOffsets.innerFillPinSection]} highlighted={hl("shell_pin")} />
        </>
      )}

      {/* Optional key-ring lug — sits straddling the top edge of the shell */}
      {keyRing && (
        <mesh
          ref={keyRingRef}
          position={[keyRing.position.x, keyRing.position.y, geos.zOffsets.outerWall + keyRing.position.z]}
          castShadow={!fitCheck && !isXray && !isWire}
          receiveShadow
        >
          <primitive object={keyRing.geometry} />
          <meshStandardMaterial
            color={color}
            metalness={0.25}
            roughness={0.45}
            opacity={isWire ? 0 : fitCheck ? 0.28 : isXray ? 0.3 : 1}
            transparent={isWire || fitCheck || isXray}
            depthWrite={!isWire && !fitCheck && !isXray}
          />
        </mesh>
      )}
      {keyRing && isWire && (
        <EdgeWireframe
          geometry={keyRing.geometry}
          position={[keyRing.position.x, keyRing.position.y, geos.zOffsets.outerWall + keyRing.position.z]}
          color={color}
        />
      )}

      {/* Keycap square pocket walls — upper / shallower section of pocket */}
      <mesh ref={innerFillWallsRef} position={[0, 0, geos.zOffsets.innerFillWalls]} castShadow={!isXray && !isWire} receiveShadow>
        <primitive object={geos.innerFillWalls} />
        <meshStandardMaterial color={color} metalness={0.15} roughness={0.55} opacity={isWire ? 0 : isXray ? 0.3 : 1} transparent={isWire || isXray} depthWrite={!isWire && !isXray} />
      </mesh>
      {isWire && <EdgeWireframe geometry={geos.innerFillWalls} position={[0, 0, geos.zOffsets.innerFillWalls]} color={color} />}
      <MeshHighlightOverlay geometry={geos.innerFillWalls} position={[0, 0, geos.zOffsets.innerFillWalls]} highlighted={hl("shell_walls")} />

      {/* Shell-side actuator boss — swap-cutouts mode only, sits inside the switch cavity */}
      {geos.bossBase && (
        <>
          <mesh ref={shellBossBaseRef} position={[0, 0, geos.zOffsets.bossBase]} castShadow={!isXray && !isWire} receiveShadow>
            <primitive object={geos.bossBase} />
            <meshStandardMaterial color={color} metalness={0.3} roughness={0.4} opacity={isWire ? 0 : isXray ? 0.3 : 1} transparent={isWire || isXray} depthWrite={!isWire && !isXray} />
          </mesh>
          {isWire && <EdgeWireframe geometry={geos.bossBase} position={[0, 0, geos.zOffsets.bossBase]} color={color} />}
          <MeshHighlightOverlay geometry={geos.bossBase} position={[0, 0, geos.zOffsets.bossBase]} highlighted={hl("shell_walls")} />
        </>
      )}
      {geos.bossMain && (
        <>
          <mesh ref={shellBossMainRef} position={[0, 0, geos.zOffsets.bossMain]} castShadow={!isXray && !isWire} receiveShadow>
            <primitive object={geos.bossMain} />
            <meshStandardMaterial color={color} metalness={0.3} roughness={0.4} opacity={isWire ? 0 : isXray ? 0.3 : 1} transparent={isWire || isXray} depthWrite={!isWire && !isXray} />
          </mesh>
          {isWire && <EdgeWireframe geometry={geos.bossMain} position={[0, 0, geos.zOffsets.bossMain]} color={color} />}
          <MeshHighlightOverlay geometry={geos.bossMain} position={[0, 0, geos.zOffsets.bossMain]} highlighted={hl("shell_walls")} />
        </>
      )}

      {/* Housing cap — solid fill above pocket when keycapPocketDepth < shellSwitchHousing */}
      {geos.innerFillHousingCap && (
        <>
          <mesh ref={innerFillHousingCapRef} position={[0, 0, geos.zOffsets.innerFillHousingCap]} castShadow={!isXray && !isWire} receiveShadow>
            <primitive object={geos.innerFillHousingCap} />
            <meshStandardMaterial color={color} metalness={0.15} roughness={0.55} opacity={isWire ? 0 : isXray ? 0.3 : 1} transparent={isWire || isXray} depthWrite={!isWire && !isXray} />
          </mesh>
          {isWire && <EdgeWireframe geometry={geos.innerFillHousingCap} position={[0, 0, geos.zOffsets.innerFillHousingCap]} color={color} />}
          <MeshHighlightOverlay geometry={geos.innerFillHousingCap} position={[0, 0, geos.zOffsets.innerFillHousingCap]} highlighted={hl("shell_walls")} />
        </>
      )}
    </group>
  );
}

/**
 * React.memo wrapper for OuterShellGroup.  Bypasses the entire JSX rebuild
 * when the parent re-renders for reasons unrelated to the shell geometry
 * (e.g. picking a clicker colour, hovering a clicker-only slider).  Refs
 * (outerWallRef etc.) are stable across renders so identity comparison is
 * safe.  Active-highlight arrays are recreated each parent render but their
 * contents only change on hover, so we shallow-compare them.
 */
const OuterShellGroup = memo(
  OuterShellGroupInner,
  (prev, next) =>
    prev.shapes === next.shapes &&
    prev.svgWidth === next.svgWidth &&
    prev.svgHeight === next.svgHeight &&
    prev.color === next.color &&
    prev.fitCheck === next.fitCheck &&
    prev.viewMode === next.viewMode &&
    prev.onBounds === next.onBounds &&
    prev.outerWallRef === next.outerWallRef &&
    prev.innerFillFloorRef === next.innerFillFloorRef &&
    prev.innerFillPinSectionRef === next.innerFillPinSectionRef &&
    prev.innerFillWallsRef === next.innerFillWallsRef &&
    prev.innerFillHousingCapRef === next.innerFillHousingCapRef &&
    prev.shellBossBaseRef === next.shellBossBaseRef &&
    prev.shellBossMainRef === next.shellBossMainRef &&
    prev.keyRingRef === next.keyRingRef &&
    arraysShallowEqual(prev.activeHighlights, next.activeHighlights) &&
    getOuterShellSig(prev.settings) === getOuterShellSig(next.settings) &&
    getKeyRingSig(prev.settings) === getKeyRingSig(next.settings) &&
    // flipShell / pinHolesEnabled gate JSX branches outside the sig.
    (prev.settings.flipShell ?? false) === (next.settings.flipShell ?? false) &&
    (prev.settings.pinHolesEnabled ?? false) === (next.settings.pinHolesEnabled ?? false),
);

// ─── Inner clicker: body + actuator boss ──────────────────────────────────

function InnerClickerGroupInner({
  shapes,
  settings,
  svgWidth,
  svgHeight,
  clickerFloorRef,
  clickerWallsRef,
  clickerPinSectionRef,
  bossBaseRef,
  bossMainRef,
  clickerKeyRingRef,
  fitCheck,
  onBounds,
  color,
  activeHighlights = [],
  viewMode = "solid",
}: {
  shapes: THREE.Shape[];
  settings: FidgetSettings;
  svgWidth: number;
  svgHeight: number;
  clickerFloorRef: React.RefObject<THREE.Mesh | null>;
  clickerWallsRef: React.RefObject<THREE.Mesh | null>;
  clickerPinSectionRef: React.RefObject<THREE.Mesh | null>;
  bossBaseRef: React.RefObject<THREE.Mesh | null>;
  bossMainRef: React.RefObject<THREE.Mesh | null>;
  clickerKeyRingRef: React.RefObject<THREE.Mesh | null>;
  fitCheck: boolean;
  onBounds?: (b: { w: number; h: number }) => void;
  color: string;
  activeHighlights: MeshKey[];
  viewMode?: ViewMode;
}) {
  // Per-concern cache key — see getInnerClickerSig.  Excludes shell-only
  // fields so e.g. dragging the shell wall extension never rebuilds the
  // inner clicker.
  const clickerSig = getInnerClickerSig(settings);
  const geos = useMemo(
    () => createInnerClickerGeometries(shapes, settings, svgWidth, svgHeight),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shapes, clickerSig, svgWidth, svgHeight]
  );

  // Report actual clicker footprint to parent whenever geometry changes.
  useEffect(() => { onBounds?.(geos.bounds); }, [geos, onBounds]);

  // Optional key-ring lug on the clicker — shares all key-ring settings with
  // the shell lug but is positioned using the clicker's own bounding box.
  const keyRingSig = getKeyRingSig(settings);
  const clickerKeyRing = useMemo(
    () => (settings.keyRingEnabled && (settings.keyRingOnClicker ?? false))
      ? createKeyRingGeometry(geos.bounds, settings)
      : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [geos, keyRingSig]
  );

  const { clickerTotalDepth, clickerFloorDepth, bossFloorGap, bossHeight, bossBaseHeight, pinSectionDepth } = geos;
  const shellDepth = getShellTotalDepth(settings);
  const shellHousingDepth = (settings.shellSolidFloor ?? DEFAULT_SETTINGS.shellSolidFloor)
                          + (settings.shellSwitchHousing ?? DEFAULT_SETTINGS.shellSwitchHousing);

  // In normal mode the clicker floats beside the shell.
  // In fit-check mode it is positioned to sit exactly inside the recess.
  //   Recess bottom (world z) = -shellDepth/2 + shellHousingDepth
  //   Clicker local geo runs 0 → clickerTotalDepth; centre offset = -clickerTotalDepth/2
  //   → groupZ = -shellDepth/2 + shellHousingDepth + clickerTotalDepth/2
  const flip = settings.flipClicker ?? false;

  // Mirror the shell's dynamic separation so the gap stays consistent.
  const svgBase = settings.lockDimension === "width" ? svgWidth : svgHeight;
  const scale = svgBase > 0 ? settings.targetSizeMm / svgBase : 1;
  const modelHalfW = (svgWidth * scale) / 2;
  const separationX = Math.max(35, modelHalfW + 12);

  // Anchor the clicker's bottom face to the same world-Z baseline the shell
  // uses (-shellDepth/2 → grid plane after the scene's -PI/2 X rotation).
  // Geometry runs from local z=-clickerTotalDepth/2 to +clickerTotalDepth/2,
  // so to put the bottom face at -shellDepth/2 we shift the group up by
  // clickerTotalDepth/2 from that baseline.  When flipped, local +z becomes
  // world -z, so we mirror to +shellDepth/2 - clickerTotalDepth/2 so the part
  // still rests on the same baseline instead of poking through it.
  const clickerBaseZ = flip
    ? shellDepth / 2 - clickerTotalDepth / 2
    : -shellDepth / 2 + clickerTotalDepth / 2;
  const normalGroupPos: [number, number, number] = [separationX, 0, clickerBaseZ];
  const fitCheckGroupPos: [number, number, number] = [
    0,
    0,
    -shellDepth / 2 + shellHousingDepth + clickerTotalDepth / 2,
  ];
  const groupPos = fitCheck ? fitCheckGroupPos : normalGroupPos;

  // Local z origins (geo starts at 0, mesh centred at -clickerTotalDepth/2)
  const baseZ      = -clickerTotalDepth / 2;
  const floorZ     = baseZ;                                   // clicker solid floor
  // In swap mode, an optional pin-hole section sits between the floor and the
  // square cavity walls (mirrors the shell's default-mode layering).
  const pinSectionZ = baseZ + clickerFloorDepth;
  const wallsZ     = pinSectionZ + pinSectionDepth;           // clicker wall section
  // Boss sits bossFloorGap mm above the absolute clicker bottom.
  // The two boss pieces are stacked: solid base then main shell (with cross pocket).
  const bossBaseZ  = baseZ + bossFloorGap;                    // solid base starts here
  const bossMainZ  = bossBaseZ + bossBaseHeight;              // main shell starts here

  // Clicker geometry is already centred at local z=0 (spans –depth/2 → +depth/2),
  // so a 180° rotation around X keeps it centred without any extra translation.
  const isWire = viewMode === "wireframe";
  const isXray = viewMode === "xray";
  const hl = (k: MeshKey) => activeHighlights.includes(k);
  return (
    <group position={groupPos} rotation={[flip ? Math.PI : 0, 0, 0]}>
      <mesh ref={clickerFloorRef} position={[0, 0, floorZ]} castShadow={!isXray && !isWire} receiveShadow>
        <primitive object={geos.floor} />
        <meshStandardMaterial color={color} metalness={0.25} roughness={0.45} opacity={isWire ? 0 : isXray ? 0.3 : 1} transparent={isWire || isXray} depthWrite={!isWire && !isXray} />
      </mesh>
      {isWire && <EdgeWireframe geometry={geos.floor} position={[0, 0, floorZ]} color={color} />}
      <MeshHighlightOverlay geometry={geos.floor} position={[0, 0, floorZ]} highlighted={hl("click_floor")} />

      {/* MX pin-hole section — swap-cutout mode only, sits below the square cavity */}
      {geos.pinSection && (
        <>
          <mesh ref={clickerPinSectionRef} position={[0, 0, pinSectionZ]} castShadow={!isXray && !isWire} receiveShadow>
            <primitive object={geos.pinSection} />
            <meshStandardMaterial color={color} metalness={0.25} roughness={0.45} opacity={isWire ? 0 : isXray ? 0.3 : 1} transparent={isWire || isXray} depthWrite={!isWire && !isXray} />
          </mesh>
          {isWire && <EdgeWireframe geometry={geos.pinSection} position={[0, 0, pinSectionZ]} color={color} />}
          <MeshHighlightOverlay geometry={geos.pinSection} position={[0, 0, pinSectionZ]} highlighted={hl("click_walls")} />
        </>
      )}

      <mesh ref={clickerWallsRef} position={[0, 0, wallsZ]} castShadow={!isXray && !isWire} receiveShadow>
        <primitive object={geos.walls} />
        <meshStandardMaterial color={color} metalness={0.25} roughness={0.45} opacity={isWire ? 0 : isXray ? 0.3 : 1} transparent={isWire || isXray} depthWrite={!isWire && !isXray} />
      </mesh>
      {isWire && <EdgeWireframe geometry={geos.walls} position={[0, 0, wallsZ]} color={color} />}
      <MeshHighlightOverlay geometry={geos.walls} position={[0, 0, wallsZ]} highlighted={hl("click_walls")} />

      {/* Boss base — solid disk that closes the bottom of the cross pocket (default mode only) */}
      {geos.bossBase && (
        <>
          <mesh ref={bossBaseRef} position={[0, 0, bossBaseZ]} castShadow={!isXray && !isWire} receiveShadow>
            <primitive object={geos.bossBase} />
            <meshStandardMaterial color={color} metalness={0.3} roughness={0.4} opacity={isWire ? 0 : isXray ? 0.3 : 1} transparent={isWire || isXray} depthWrite={!isWire && !isXray} />
          </mesh>
          {isWire && <EdgeWireframe geometry={geos.bossBase} position={[0, 0, bossBaseZ]} color={color} />}
          <MeshHighlightOverlay geometry={geos.bossBase} position={[0, 0, bossBaseZ]} highlighted={hl("click_boss")} />
        </>
      )}

      {/* Boss main — cylindrical shell with MX cross pocket cut through the top (default mode only) */}
      {geos.bossMain && (
        <>
          <mesh ref={bossMainRef} position={[0, 0, bossMainZ]} castShadow={!isXray && !isWire} receiveShadow>
            <primitive object={geos.bossMain} />
            <meshStandardMaterial color={color} metalness={0.3} roughness={0.4} opacity={isWire ? 0 : isXray ? 0.3 : 1} transparent={isWire || isXray} depthWrite={!isWire && !isXray} />
          </mesh>
          {isWire && <EdgeWireframe geometry={geos.bossMain} position={[0, 0, bossMainZ]} color={color} />}
          <MeshHighlightOverlay geometry={geos.bossMain} position={[0, 0, bossMainZ]} highlighted={hl("click_boss")} />
        </>
      )}

      {/* Optional key-ring lug on the clicker — anchored to the clicker's bottom face */}
      {clickerKeyRing && (
        <mesh
          ref={clickerKeyRingRef}
          position={[clickerKeyRing.position.x, clickerKeyRing.position.y, baseZ + clickerKeyRing.position.z]}
          castShadow={!fitCheck && !isXray && !isWire}
          receiveShadow
        >
          <primitive object={clickerKeyRing.geometry} />
          <meshStandardMaterial
            color={color}
            metalness={0.25}
            roughness={0.45}
            opacity={isWire ? 0 : fitCheck ? 0.28 : isXray ? 0.3 : 1}
            transparent={isWire || fitCheck || isXray}
            depthWrite={!isWire && !fitCheck && !isXray}
          />
        </mesh>
      )}
      {clickerKeyRing && isWire && (
        <EdgeWireframe
          geometry={clickerKeyRing.geometry}
          position={[clickerKeyRing.position.x, clickerKeyRing.position.y, baseZ + clickerKeyRing.position.z]}
          color={color}
        />
      )}
    </group>
  );
}

/**
 * React.memo wrapper for InnerClickerGroup — symmetric with OuterShellGroup.
 * Skips re-render when only shell-side or cosmetic state changed.
 */
const InnerClickerGroup = memo(
  InnerClickerGroupInner,
  (prev, next) =>
    prev.shapes === next.shapes &&
    prev.svgWidth === next.svgWidth &&
    prev.svgHeight === next.svgHeight &&
    prev.color === next.color &&
    prev.fitCheck === next.fitCheck &&
    prev.viewMode === next.viewMode &&
    prev.onBounds === next.onBounds &&
    prev.clickerFloorRef === next.clickerFloorRef &&
    prev.clickerWallsRef === next.clickerWallsRef &&
    prev.clickerPinSectionRef === next.clickerPinSectionRef &&
    prev.bossBaseRef === next.bossBaseRef &&
    prev.bossMainRef === next.bossMainRef &&
    prev.clickerKeyRingRef === next.clickerKeyRingRef &&
    arraysShallowEqual(prev.activeHighlights, next.activeHighlights) &&
    getInnerClickerSig(prev.settings) === getInnerClickerSig(next.settings) &&
    getKeyRingSig(prev.settings) === getKeyRingSig(next.settings) &&
    // The clicker reads shell housing depth + flipClicker for positioning
    // outside the geometry sig, so include those too.
    (prev.settings.flipClicker ?? false) === (next.settings.flipClicker ?? false) &&
    (prev.settings.shellSolidFloor ?? DEFAULT_SETTINGS.shellSolidFloor) ===
      (next.settings.shellSolidFloor ?? DEFAULT_SETTINGS.shellSolidFloor) &&
    (prev.settings.shellSwitchHousing ?? DEFAULT_SETTINGS.shellSwitchHousing) ===
      (next.settings.shellSwitchHousing ?? DEFAULT_SETTINGS.shellSwitchHousing) &&
    (prev.settings.shellWallExtension ?? DEFAULT_SETTINGS.shellWallExtension) ===
      (next.settings.shellWallExtension ?? DEFAULT_SETTINGS.shellWallExtension),
);

// ─── Edge wireframe overlay — EdgesGeometry lines, Blender-style ─────────

function EdgeWireframe({
  geometry,
  position,
  color,
}: {
  geometry: THREE.BufferGeometry;
  position?: [number, number, number];
  color: string;
}) {
  // 15° threshold keeps only meaningful shape edges, skips tessellation lines
  const edges = useMemo(() => new THREE.EdgesGeometry(geometry, 15), [geometry]);
  useEffect(() => () => edges.dispose(), [edges]);
  return (
    <lineSegments geometry={edges} position={position}>
      <lineBasicMaterial color={color} />
    </lineSegments>
  );
}

// ─── Label projector — runs inside Canvas, tracks model centers to screen ──

function LabelProjector({
  separationX,
  shellLabelRef,
  clickerLabelRef,
}: {
  separationX: number;
  shellLabelRef: React.RefObject<HTMLDivElement | null>;
  clickerLabelRef: React.RefObject<HTMLDivElement | null>;
}) {
  const { camera } = useThree();
  useFrame(() => {
    const projectXPct = (wx: number) => {
      const v = new THREE.Vector3(wx, 0, 0);
      v.project(camera);
      return ((v.x + 1) / 2) * 100;
    };
    const shellPct   = projectXPct(-separationX);
    const clickerPct = projectXPct(separationX);
    if (shellLabelRef.current) {
      shellLabelRef.current.style.left      = `${shellPct}%`;
      shellLabelRef.current.style.transform = "translateX(-50%)";
    }
    if (clickerLabelRef.current) {
      clickerLabelRef.current.style.left      = `${clickerPct}%`;
      clickerLabelRef.current.style.transform = "translateX(-50%)";
    }
  });
  return null;
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
  // Store dir at pointerdown (before setPointerCapture changes e.target in subsequent events)
  const dragState = useRef<{ x: number; y: number; moved: boolean; dir: string | null } | null>(null);
  const [hoveredFace, setHoveredFace] = useState<string | null>(null);

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

  const getFaceDir = (target: EventTarget | null): string | null => {
    const el = target as HTMLElement | null;
    return el?.dataset.dir ?? (el?.parentElement?.dataset.dir ?? null);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    // Read dir NOW before setPointerCapture re-routes subsequent e.target to the outer div
    const dir = getFaceDir(e.target);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragState.current = { x: e.clientX, y: e.clientY, moved: false, dir };
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

  const onPointerUp = () => {
    if (dragState.current && !dragState.current.moved && dragState.current.dir) {
      const [x, y, z] = dragState.current.dir.split(",").map(Number);
      const dist = stateRef.current.dist || 130;
      snapRef.current = {
        pos: new THREE.Vector3(x, y, z).multiplyScalar(dist),
        tgt: new THREE.Vector3(0, 0, 0),
      };
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
            onPointerEnter={() => setHoveredFace(face.dir)}
            onPointerLeave={() => setHoveredFace(null)}
            style={{
              position: "absolute",
              inset: 0,
              background: hoveredFace === face.dir
                ? face.bg.replace(/[\d.]+\)$/, (m) => `${Math.min(1, parseFloat(m) + 0.22)})`)
                : face.bg,
              border: hoveredFace === face.dir
                ? "1.5px solid rgba(255,255,255,0.55)"
                : "1px solid rgba(255,255,255,0.15)",
              boxShadow: hoveredFace === face.dir ? "inset 0 0 12px rgba(255,255,255,0.18)" : "none",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: "0.08em",
              color: "rgba(255,255,255,0.95)",
              transform: face.cssTransform,
              cursor: "pointer",
              userSelect: "none",
              transition: "background 0.12s, box-shadow 0.12s, border 0.12s",
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
  | "shell_outer" | "shell_extension" | "shell_floor" | "shell_walls" | "shell_pin"
  | "click_floor" | "click_walls" | "click_boss";

/** Maps each FidgetSettings slider key to the mesh(es) it most directly affects. */
const SLIDER_HIGHLIGHTS: Partial<Record<keyof FidgetSettings, MeshKey[]>> = {
  shellSolidFloor:    ["shell_floor"],
  shellSwitchHousing: ["shell_walls", "shell_pin"],
  shellWallExtension: ["shell_extension"],
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
  shellDepth,
  recenterKey,
}: {
  targetSizeMm: number;
  svgWidth: number;
  svgHeight: number;
  lockDimension: "width" | "height";
  shellDepth: number;
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
    const sceneRadius = Math.max(sceneHalfW, modelHalfH, shellDepth / 2) * 1.2;

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
      (controls as unknown as { target: THREE.Vector3; update: () => void }).target.set(0, 0, 0);
      (controls as unknown as { target: THREE.Vector3; update: () => void }).update();
    }
  // controls must be in deps so the effect re-runs once OrbitControls mounts.
  // recenterKey is incremented by the Re-center button to trigger on demand.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetSizeMm, svgWidth, svgHeight, lockDimension, shellDepth, controls, recenterKey]);

  return null;
}

// ─── Main component ───────────────────────────────────────────────────────

export default function Studio() {
  const { user, isSignedIn } = useUser();
  const { signOut } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const params = useParams<{ id?: string }>();
  const routeProjectId = params.id ? Number(params.id) : null;

  const [svgState, setSvgState] = useState<ParsedSVGState | null>(null);
  const [libraryPickerOpen, setLibraryPickerOpen] = useState(false);
  const [projectName, setProjectName] = useState("My Fidget Toy");
  const [projectId, setProjectId] = useState<number | null>(routeProjectId);
  const [isDragging, setIsDragging] = useState(false);
  const [settings, setSettings] = useState<FidgetSettings>(DEFAULT_SETTINGS);
  const [fitCheckMode, setFitCheckMode] = useState(false);
  const [showDimensions, setShowDimensions] = useState(true);
  const [recenterKey, setRecenterKey] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>("solid");

  // ── Free / Premium tier ──────────────────────────────────────────────
  const tier = useTier();
  const isPremium = tier === "premium";
  const isGuest = tier === "guest";
  const [upgradeFeature, setUpgradeFeature] = useState<GatedFeature | null>(null);
  const [authAction, setAuthAction] = useState<string | null>(null);
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>(() => loadSidebarMode("simple"));
  // Local fallback so guests still get persistence via localStorage.
  useEffect(() => { saveSidebarMode(sidebarMode); }, [sidebarMode]);

  // For signed-in users, mirror the choice on the server so it follows
  // them across browsers and devices.
  const userPrefs = useGetPreferences();
  const updatePrefs = useUpdatePreferences();
  const prefsHydratedRef = useRef(false);
  // Track the last sidebarMode we've sent to the server so we don't re-fire
  // the sync effect on every render (updatePrefs is a fresh reference each
  // render, and userPrefs.data briefly lags after mutations + invalidation,
  // which previously caused a runaway PUT loop).
  const lastSyncedModeRef = useRef<SidebarMode | null>(null);
  useEffect(() => {
    if (isGuest || prefsHydratedRef.current || !userPrefs.data) return;
    prefsHydratedRef.current = true;
    const remote = userPrefs.data.sidebarMode === "advanced" ? "advanced" : "simple";
    lastSyncedModeRef.current = remote;
    if (remote !== sidebarMode) setSidebarMode(remote);
  }, [isGuest, userPrefs.data, sidebarMode]);
  useEffect(() => {
    if (isGuest || !prefsHydratedRef.current) return;
    if (lastSyncedModeRef.current === sidebarMode) return;
    lastSyncedModeRef.current = sidebarMode;
    updatePrefs
      .mutateAsync({ sidebarMode })
      .then(() =>
        queryClient.invalidateQueries({ queryKey: ["user-preferences"] }),
      )
      .catch(() => {
        // Best effort; localStorage already kept it locally. Clear the ref so
        // a later render or value change can retry.
        lastSyncedModeRef.current = null;
      });
    // Intentionally exclude updatePrefs / userPrefs.data / queryClient — they
    // change references each render and would re-fire the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGuest, sidebarMode]);

  /** Show the upgrade modal for a Premium-only feature. */
  const requirePremium = useCallback(
    (feature: GatedFeature, action?: () => void) => {
      if (isPremium) { action?.(); return; }
      if (isGuest) {
        // Guests get a sign-in prompt first; the upgrade pitch lives behind it.
        setAuthAction(`use ${feature.replace(/_/g, " ")}`);
        return;
      }
      setUpgradeFeature(feature);
    },
    [isPremium, isGuest],
  );

  /** Require a signed-in user (any tier). Opens the auth modal otherwise. */
  const requireSignedIn = useCallback(
    (action: string, fn: () => void) => {
      if (!isGuest) { fn(); return; }
      setAuthAction(action);
    },
    [isGuest],
  );
  const shellLabelRef   = useRef<HTMLDivElement>(null);
  const clickerLabelRef = useRef<HTMLDivElement>(null);
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

  // Per-color flat regions parsed from the SVG fill palette.
  const colorRegions = useMemo(
    () => (svgState ? parseSVGColorRegions(svgState.rawSvg) : []),
    [svgState],
  );

  // Per-concern cache keys for the parent-side memos.  Colour-layer extrusion
  // and validation each only depend on a tight subset of fields, so this
  // keeps cosmetic edits and unrelated slider drags from retriggering them.
  const colorLayerSig = useMemo(() => getColorLayerSig(settings), [settings]);
  const validateSig   = useMemo(() => getValidateSig(settings),   [settings]);

  // Extruded slab geometry for each color region — recomputed only when the
  // SVG, the colour regions, or a colour-layer-affecting setting changes.
  const colorLayerGeometries = useMemo(
    () =>
      svgState
        ? createColorLayerGeometries(colorRegions, settings, svgState.width, svgState.height)
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [colorRegions, colorLayerSig, svgState],
  );

  const geoWarnings = useMemo<GeometryWarning[]>(
    () => svgState
      ? validateGeometry(svgState.shapes, settings, svgState.width, svgState.height)
      : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [svgState, validateSig]
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
    // The back face sits at world Y = -shellDepth/2, which is the print-bed floor.
    const gridY = -(getShellTotalDepth(settings) / 2);

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
  const innerFillHousingCapRef = useRef<THREE.Mesh | null>(null);
  const shellBossBaseRef = useRef<THREE.Mesh | null>(null);
  const shellBossMainRef = useRef<THREE.Mesh | null>(null);
  const keyRingRef = useRef<THREE.Mesh | null>(null);
  const clickerKeyRingRef = useRef<THREE.Mesh | null>(null);
  const clickerFloorRef = useRef<THREE.Mesh | null>(null);
  const clickerWallsRef = useRef<THREE.Mesh | null>(null);
  const clickerPinSectionRef = useRef<THREE.Mesh | null>(null);
  const bossBaseRef = useRef<THREE.Mesh | null>(null);
  const bossMainRef = useRef<THREE.Mesh | null>(null);
  // World-space transform of the color-layer assembly.  We export from raw
  // geometries + this group's matrixWorld, NOT from individual mesh refs,
  // so the per-mesh `i * 0.01` preview z-bump stays preview-only.
  const colorLayersGroupRef = useRef<THREE.Group | null>(null);
  const [stlColorWarnOpen, setStlColorWarnOpen] = useState(false);
  const [svgWarningOpen, setSvgWarningOpen] = useState(false);
  const [svgWarningIssues, setSvgWarningIssues] = useState<SVGCompatibilityIssue[]>([]);
  const [pendingSvgFile, setPendingSvgFile] = useState<{ content: string; fileName: string } | null>(null);

  const createProject = useCreateProject();
  const updateProject = useUpdateProject();

  const loadedProject = useGetProject(routeProjectId ?? undefined);

  const [hydratedForId, setHydratedForId] = useState<number | null>(null);

  // ── Anonymous draft persistence ─────────────────────────────────────
  // Restore a guest's previous /studio session if any (only when there is
  // no route project ID and no in-memory svg yet).
  const [draftHydrated, setDraftHydrated] = useState(false);
  useEffect(() => {
    if (draftHydrated || routeProjectId !== null) return;
    if (!isGuest) { setDraftHydrated(true); return; }
    const draft = loadDraft();
    if (draft) {
      try {
        const parsed = parseSVGContent(draft.svgData);
        setSvgState({
          shapes: parsed.shapes,
          width: parsed.width,
          height: parsed.height,
          rawSvg: draft.svgData,
          fileName: `${draft.name}.svg`,
        });
        setProjectName(draft.name);
        setSettings({ ...DEFAULT_SETTINGS, ...(draft.settings as Partial<FidgetSettings>) });
        setDraftSizeMm(String(
          (draft.settings as Partial<FidgetSettings>).targetSizeMm ?? DEFAULT_SETTINGS.targetSizeMm,
        ));
      } catch { /* ignore broken draft */ }
    }
    setDraftHydrated(true);
  }, [draftHydrated, isGuest, routeProjectId]);

  // Persist any guest changes to localStorage so a refresh keeps the work.
  useEffect(() => {
    if (!isGuest || !svgState) return;
    saveDraft({
      name: projectName,
      svgData: svgState.rawSvg,
      settings: settings as unknown as Record<string, unknown>,
      updatedAt: Date.now(),
    });
    setPromotePending(true);
  }, [isGuest, svgState, projectName, settings]);

  // After sign-in: if the user has a pending guest draft and is on the
  // empty /studio route, prompt them with a Yes/No to save it as a real
  // project. Yes → create project; No → clear the local draft.
  const [promoteOpen, setPromoteOpen] = useState(false);
  const promoteOfferedRef = useRef(false);
  useEffect(() => {
    if (isGuest || routeProjectId !== null || projectId !== null) return;
    if (promoteOfferedRef.current) return;
    if (!svgState || !getPromotePending()) return;
    promoteOfferedRef.current = true;
    setPromoteOpen(true);
  }, [isGuest, routeProjectId, projectId, svgState]);

  useEffect(() => {
    if (!loadedProject.data || hydratedForId === routeProjectId) return;
    const p = loadedProject.data;
    setProjectName(p.name);
    setProjectId(p.id);

    const raw = (p.settings as Partial<FidgetSettings & { totalDepth?: number; innerFillDepth?: number }> | null) ?? {};

    // ── Legacy migration ─────────────────────────────────────────────────
    // Old saved projects stored `totalDepth` + `innerFillDepth` instead of
    // the three additive components introduced by Task #7.  Derive sensible
    // equivalents so geometry is preserved on load.
    const migratedRaw: Partial<FidgetSettings> = { ...raw };
    if (
      "totalDepth" in raw && "innerFillDepth" in raw &&
      !("shellSolidFloor" in raw) && !("shellSwitchHousing" in raw) && !("shellWallExtension" in raw)
    ) {
      const legacyTotal = (raw as { totalDepth: number }).totalDepth;
      const legacyFill  = (raw as { innerFillDepth: number }).innerFillDepth;
      const kpd = (raw.keycapPocketDepth ?? DEFAULT_SETTINGS.keycapPocketDepth);
      const housing   = Math.max(3, Math.min(kpd, legacyFill));
      const floor     = Math.max(0.5, legacyFill - housing);
      const extension = Math.max(0, legacyTotal - legacyFill);
      migratedRaw.shellSolidFloor    = floor;
      migratedRaw.shellSwitchHousing = housing;
      migratedRaw.shellWallExtension = extension;
    }

    const savedSettings: FidgetSettings = {
      ...DEFAULT_SETTINGS,
      ...migratedRaw,
    };
    setSettings(savedSettings);
    setDraftSizeMm(String(savedSettings.targetSizeMm));
    if ((raw as any).svgIsClickerShape === false || !("svgIsClickerShape" in (raw ?? {}))) {
      toast({
        title: "Project loaded in new mode",
        description: "This project was saved with the old layout. Clicker size now controls the inner piece — you may need to adjust the size slider.",
      });
    }

    if (p.svgData) {
      try {
        const parsed = parseSVGContent(p.svgData);
        setSvgState({
          shapes: parsed.shapes,
          width: parsed.width,
          height: parsed.height,
          rawSvg: p.svgData,
          fileName: p.name,
        });
      } catch {
        toast({ title: "Could not restore SVG from saved project", variant: "destructive" });
      }
    }
    setHydratedForId(p.id);
  }, [loadedProject.data, hydratedForId, routeProjectId, toast]);

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
        // Auto-centre the pocket on the shape's visual centroid so that
        // asymmetric SVGs (logos, non-rectangular outlines) start with the
        // switch pocket already aligned, requiring less manual nudging.
        setSettings((prev) => {
          const autoOffset = computeAutoPocketOffset(
            parsed.shapes,
            parsed.width,
            parsed.height,
            prev,
          );
          return {
            ...prev,
            clickerColor,
            shellColor,
            pocketOffsetX: autoOffset.x,
            pocketOffsetY: autoOffset.y,
          };
        });

        toast({
          title: "SVG loaded",
          description: `${parsed.shapes.length} shape(s) · ${parsed.width.toFixed(0)}×${parsed.height.toFixed(0)} px`,
        });
        for (const warning of parsed.warnings) {
          toast({ title: "SVG Warning", description: warning, variant: "destructive" });
        }
      } catch {
        toast({ title: "Failed to parse SVG", variant: "destructive" });
      }
    },
    [toast]
  );

  const RASTER_TYPES = ["image/png", "image/jpeg", "image/webp"];

  const dispatchFile = (file: File) => {
    if (file.name.toLowerCase().endsWith(".svg") || file.type === "image/svg+xml") {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const content = ev.target?.result as string;
        const issues = analyzeSVG(content);
        if (issues.length > 0) {
          setPendingSvgFile({ content, fileName: file.name });
          setSvgWarningIssues(issues);
          setSvgWarningOpen(true);
        } else {
          handleSVGLoad(content, file.name);
        }
      };
      reader.readAsText(file);
    } else if (RASTER_TYPES.includes(file.type) || /\.(png|jpe?g|webp)$/i.test(file.name)) {
      toast({
        title: "Convert images in the Library",
        description: "Image-to-SVG conversion lives in the Library. Save a design there, then load it here.",
      });
    } else {
      toast({ title: "Unsupported file type", description: "Please upload an SVG, PNG, JPG, or WebP.", variant: "destructive" });
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset so the same file can be re-selected
    e.target.value = "";
    dispatchFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) dispatchFile(file);
  };

  /** Called when the user picks an SVG from their saved library. */
  const handleLibraryPick = useCallback(
    (svgData: string, name: string) => {
      handleSVGLoad(svgData, `${name}.svg`);
      setProjectName(name);
    },
    [handleSVGLoad],
  );

  // One-shot consume: if the Library page handed us an SVG, load it now.
  const consumedLibraryRef = useRef(false);
  useEffect(() => {
    if (consumedLibraryRef.current || routeProjectId !== null) return;
    const pending = consumePendingLibrarySvg();
    if (pending) {
      consumedLibraryRef.current = true;
      handleSVGLoad(pending.svgData, `${pending.name}.svg`);
      setProjectName(pending.name);
    }
  }, [handleSVGLoad, routeProjectId]);

  const [mergeForExport, setMergeForExport] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [showBanana, setShowBanana] = useState(false);

  const getMeshGroups = (): MeshGroups => ({
    shell: [outerWallRef, innerFillFloorRef, innerFillPinSectionRef, innerFillWallsRef, innerFillHousingCapRef, shellBossBaseRef, shellBossMainRef]
      .map((r) => r.current).filter((m): m is THREE.Mesh => m !== null),
    clicker: [clickerFloorRef, clickerPinSectionRef, clickerWallsRef, bossBaseRef, bossMainRef, clickerKeyRingRef]
      .map((r) => r.current).filter((m): m is THREE.Mesh => m !== null),
    keyRing: (settings.keyRingEnabled && (settings.keyRingOnShell ?? true)) ? keyRingRef.current : null,
    colorLayers: (() => {
      const group = colorLayersGroupRef.current;
      if (!group || colorLayerGeometries.length === 0) return [];
      // Make sure world matrices reflect any pending transform updates so
      // exported color layers land aligned with the outer shell.
      group.updateMatrixWorld(true);
      return colorLayerGeometries.map((g, i) => {
        const mesh = new THREE.Mesh(g.geometry);
        // Bypass per-mesh local transform (which carries the preview z-bump
        // when reading from live ColorLayersGroup children) and use only the
        // parent group's world matrix.  Exporters consume mesh.matrixWorld.
        mesh.matrixAutoUpdate = false;
        mesh.matrix.identity();
        mesh.matrixWorld.copy(group.matrixWorld);
        return { name: `color_layer_${i + 1}`, color: g.color, mesh };
      });
    })(),
  });

  const getMeshes = (): THREE.Mesh[] => {
    const g = getMeshGroups();
    return [...g.shell, ...g.clicker, ...(g.keyRing ? [g.keyRing] : [])];
  };

  const performExportSTL = async () => {
    const groups = getMeshGroups();
    if (!groups.shell.length && !groups.clicker.length) {
      toast({ title: "Upload an SVG first", variant: "destructive" });
      return;
    }
    if (mergeForExport) {
      await exportSTLMerged(groups);
      toast({ title: "STL exported — two files in zip" });
    } else {
      // Color layers are intentionally omitted from STL (no color support).
      exportSTL(groups);
      toast({ title: "STL exported" });
    }
    if (isGuest) incrementAnonStlExportCount();
  };

  const handleExportSTL = async () => {
    // Anonymous "try it now" guests get exactly one free STL export.
    if (isGuest && getAnonStlExportCount() >= 1) {
      setAuthAction("export more than one STL file");
      return;
    }
    // If the SVG carries color regions, warn that STL will drop the color
    // information before exporting.  Confirming proceeds; cancelling aborts.
    if (colorRegions.length > 0) {
      setStlColorWarnOpen(true);
      return;
    }
    await performExportSTL();
  };

  const handleExport3MF = async () => {
    requirePremium("export_3mf", async () => {
      const groups = getMeshGroups();
      if (!groups.shell.length && !groups.clicker.length) {
        toast({ title: "Upload an SVG first", variant: "destructive" });
        return;
      }
      await export3MF(groups);
      toast({
        title: mergeForExport
          ? "3MF exported — per-part objects with color"
          : "3MF exported",
      });
    });
  };

  const handleExportOBJ = async () => {
    requirePremium("export_obj", () => {
      const groups = getMeshGroups();
      if (!groups.shell.length && !groups.clicker.length) {
        toast({ title: "Upload an SVG first", variant: "destructive" });
        return;
      }
      exportOBJ(groups);
      toast({
        title: mergeForExport
          ? "OBJ exported — per-part objects with color"
          : "OBJ exported",
      });
    });
  };

  const performSave = useCallback(async () => {
    if (!svgState) {
      toast({ title: "Upload an SVG first", variant: "destructive" });
      return;
    }
    try {
      const payload = {
        name: projectName,
        svgData: svgState.rawSvg,
        extrudeDepth: getShellTotalDepth(settings),
        keycapSize: settings.keycapSize,
        settings: settings as unknown as Record<string, unknown>,
      };
      if (projectId) {
        await updateProject.mutateAsync({ id: projectId, ...payload });
        toast({ title: "Project saved" });
      } else {
        const project = await createProject.mutateAsync(payload);
        setProjectId(project.id);
        queryClient.invalidateQueries({ queryKey: ["projects"] });
        clearDraft();
        toast({ title: "Project created", description: project.name });
      }
    } catch (err) {
      // Server enforces the Free-tier 3-project save limit. Map that into
      // the Premium upgrade modal so the call to action is consistent.
      if (
        err instanceof Error &&
        err.message?.includes("PROJECT_LIMIT_REACHED")
      ) {
        setUpgradeFeature("save_over_limit");
        return;
      }
      toast({ title: "Failed to save project", variant: "destructive" });
    }
  }, [svgState, projectName, settings, projectId, updateProject, createProject, queryClient, toast]);

  const handleSave = () => {
    requireSignedIn("save your project", () => { void performSave(); });
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
          {/* Tier badge */}
          {tier === "premium" && (
            <Badge className="bg-amber-500 hover:bg-amber-500 text-white gap-1">
              <Crown className="h-3 w-3" /> Premium
            </Badge>
          )}
          {tier === "free" && (
            <>
              <Badge variant="secondary">Free</Badge>
              <Button
                variant="outline"
                size="sm"
                className="border-amber-500 text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950"
                onClick={() => setUpgradeFeature("save_over_limit")}
              >
                <Crown className="h-3.5 w-3.5 mr-1" /> Upgrade
              </Button>
            </>
          )}
          {tier === "guest" && (
            <Badge variant="outline" className="text-muted-foreground">Guest</Badge>
          )}

          {!isGuest && (
            <Link href="/projects">
              <Button variant="ghost" size="sm">
                <LayoutList className="h-4 w-4 mr-1" />
                My Projects
              </Button>
            </Link>
          )}
          {isGuest ? (
            <Link href="/sign-in">
              <Button size="sm">
                <LogIn className="h-4 w-4 mr-1" />
                Sign in
              </Button>
            </Link>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => { signOut(); setLocation("/"); }}>
              <LogOut className="h-4 w-4 mr-1" />
              {user?.email?.split("@")[0] ?? "Sign out"}
            </Button>
          )}
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* ── Left sidebar ── */}
        <aside className="w-72 border-r border-border bg-card flex flex-col shrink-0 overflow-y-auto">
          <div className="p-4 space-y-6">

            {/* ── Simple / Advanced mode toggle ── */}
            <div className="flex rounded-md border border-border bg-accent/30 p-0.5 text-xs font-medium">
              <button
                type="button"
                onClick={() => setSidebarMode("simple")}
                className={`flex-1 rounded px-2 py-1 transition-colors ${
                  sidebarMode === "simple"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Simple
              </button>
              <button
                type="button"
                onClick={() => setSidebarMode("advanced")}
                className={`flex-1 rounded px-2 py-1 transition-colors ${
                  sidebarMode === "advanced"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Advanced
              </button>
            </div>

            {/* Upload zone */}
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
                Upload Image
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
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-border hover:border-primary hover:bg-accent/50 text-xs text-muted-foreground hover:text-foreground transition-colors py-2 cursor-pointer"
                      data-testid="button-replace-image"
                    >
                      <Upload className="h-3.5 w-3.5" />
                      Replace
                    </button>
                    {!isGuest && (
                      <button
                        type="button"
                        onClick={() => setLibraryPickerOpen(true)}
                        className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-border hover:border-primary hover:bg-accent/50 text-xs text-muted-foreground hover:text-foreground transition-colors py-2 cursor-pointer"
                        data-testid="button-pick-library"
                      >
                        <LayoutList className="h-3.5 w-3.5" />
                        Library
                      </button>
                    )}
                  </div>

                </div>
              ) : (
                /* ── Empty drop zone ── */
                <div className="space-y-2">
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
                    <p className="text-sm text-muted-foreground">Drop SVG or image here</p>
                    <p className="text-[10px] text-muted-foreground/70 mt-1 inline-flex items-center gap-1">
                      SVG ·{" "}
                      {isPremium ? (
                        <span>PNG · JPG · WebP</span>
                      ) : (
                        <PremiumLabel className="text-[10px]" iconClassName="h-2.5 w-2.5">
                          PNG · JPG · WebP
                        </PremiumLabel>
                      )}
                    </p>
                  </div>
                  {!isGuest && (
                    <button
                      type="button"
                      onClick={() => setLibraryPickerOpen(true)}
                      className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-border hover:border-primary hover:bg-accent/50 text-xs text-muted-foreground hover:text-foreground transition-colors py-2 cursor-pointer"
                      data-testid="button-pick-library-empty"
                    >
                      <LayoutList className="h-3.5 w-3.5" />
                      Pick from Library
                    </button>
                  )}
                </div>
              )}

              <input
                ref={fileInputRef}
                type="file"
                accept=".svg,.png,.jpg,.jpeg,.webp,image/svg+xml,image/png,image/jpeg,image/webp"
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
                    <Label className="text-xs text-muted-foreground mb-1 block">Constraint</Label>
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
                      Clicker size (mm)
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

            {/* Geometry warnings (advanced only — they reference advanced controls) */}
            {sidebarMode === "advanced" && geoWarnings.length > 0 && (
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

            {/* In Simple mode, expose only the preview color of the model. */}
            {sidebarMode === "simple" && (
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
                  Preview color
                </h2>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Model color</span>
                  <DebouncedColorInput
                    value={settings.shellColor ?? DEFAULT_SETTINGS.shellColor}
                    onChange={(v) => {
                      // Keep both parts visually in-sync in Simple mode.
                      setSettings((s) => ({
                        ...s,
                        shellColor: v,
                        clickerColor: v,
                      }));
                    }}
                    className="h-8 w-14 rounded border border-input cursor-pointer bg-transparent p-0.5"
                  />
                </div>
                <p className="text-[10px] text-muted-foreground/70 mt-2 leading-relaxed">
                  Switch to <button type="button" className="underline hover:text-foreground" onClick={() => setSidebarMode("advanced")}>Advanced</button> to tweak shell depth, key ring, fit clearance, and per-region colors.
                </p>
              </div>
            )}

            {/* Save + Export — shown in both Simple and Advanced mode */}
            {sidebarMode === "simple" && (
            <div className="space-y-2">
              <Button
                className="w-full"
                onClick={handleSave}
                disabled={isSaving || !svgState}
              >
                {isGuest ? <LogIn className="h-4 w-4 mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                {isSaving
                  ? "Saving…"
                  : isGuest
                    ? "Sign in to save"
                    : projectId ? "Update Project" : "Save Project"}
              </Button>
              <Button
                variant="outline"
                className="w-full"
                onClick={handleExportSTL}
                disabled={!svgState}
              >
                <Download className="h-4 w-4 mr-2" />
                Export STL
                {isGuest && (
                  <span className="ml-2 text-[10px] text-muted-foreground">
                    ({Math.max(0, 1 - getAnonStlExportCount())} free)
                  </span>
                )}
              </Button>
              <Button
                variant="outline"
                className="w-full"
                onClick={handleExport3MF}
                disabled={!svgState}
              >
                <Download className="h-4 w-4 mr-2" />
                {isPremium ? "Export 3MF" : <PremiumLabel>Export 3MF</PremiumLabel>}
              </Button>
              <Button
                variant="outline"
                className="w-full"
                onClick={handleExportOBJ}
                disabled={!svgState}
              >
                <Download className="h-4 w-4 mr-2" />
                {isPremium ? "Export OBJ" : <PremiumLabel>Export OBJ</PremiumLabel>}
              </Button>
            </div>
            )}

            {/* Settings header + reset (advanced only) */}
            {sidebarMode === "advanced" && (
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Settings</span>
              <button
                type="button"
                onClick={() => {
                  setSettings((prev) => ({
                    ...DEFAULT_SETTINGS,
                    // Keep auto-extracted preview colours from the uploaded SVG
                    shellColor: prev.shellColor,
                    clickerColor: prev.clickerColor,
                  }));
                  setDraftSizeMm(String(DEFAULT_SETTINGS.targetSizeMm));
                }}
                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                title="Reset all sliders and checkboxes to defaults"
              >
                <RotateCcw className="h-3 w-3" />
                Reset
              </button>
            </div>
            )}

            {/* ── Outer Shell (basics) ── */}
            {sidebarMode === "advanced" && (
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
                Outer Shell
              </h2>
              <div className="space-y-5">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Preview color</span>
                  <DebouncedColorInput
                    value={settings.shellColor ?? DEFAULT_SETTINGS.shellColor}
                    onChange={(v) => setSetting("shellColor", v)}
                    className="h-8 w-14 rounded border border-input cursor-pointer bg-transparent p-0.5"
                  />
                </div>
                <label className="flex items-center gap-2 cursor-pointer select-none"
                  onClick={(e) => {
                    if (!isPremium) {
                      e.preventDefault();
                      requirePremium("mirror_shell");
                    }
                  }}
                >
                  <input
                    type="checkbox"
                    checked={settings.mirrorShell ?? false}
                    onChange={(e) => isPremium && setSetting("mirrorShell", e.target.checked)}
                    disabled={!isPremium}
                    className="h-4 w-4 rounded accent-primary"
                  />
                  <span className="text-sm">
                    {isPremium ? "Mirror left-right" : <PremiumLabel>Mirror left-right</PremiumLabel>}
                  </span>
                  <ResetButton
                    isDefault={(settings.mirrorShell ?? false) === DEFAULT_SETTINGS.mirrorShell}
                    onReset={() => setSetting("mirrorShell", DEFAULT_SETTINGS.mirrorShell)}
                    defaultLabel={DEFAULT_SETTINGS.mirrorShell ? "on" : "off"}
                  />
                </label>
                <SliderRow
                  label="Solid floor"
                  value={settings.shellSolidFloor ?? DEFAULT_SETTINGS.shellSolidFloor}
                  min={0.5}
                  max={10}
                  step={0.01}
                  unit="mm"
                  onChange={(v) => setSetting("shellSolidFloor", v)}
                  defaultValue={DEFAULT_SETTINGS.shellSolidFloor}
                  onReset={() => setSetting("shellSolidFloor", DEFAULT_SETTINGS.shellSolidFloor)}
                  commitOnRelease
                  {...hl(["shell_floor"])}
                />
                <SliderRow
                  label="Switch housing"
                  value={settings.shellSwitchHousing ?? DEFAULT_SETTINGS.shellSwitchHousing}
                  min={3}
                  max={30}
                  step={0.01}
                  unit="mm"
                  onChange={(v) => setSetting("shellSwitchHousing", v)}
                  defaultValue={DEFAULT_SETTINGS.shellSwitchHousing}
                  onReset={() => setSetting("shellSwitchHousing", DEFAULT_SETTINGS.shellSwitchHousing)}
                  commitOnRelease
                  {...hl(["shell_walls", "shell_pin"])}
                />
                <SliderRow
                  label="Wall extension"
                  value={settings.shellWallExtension ?? DEFAULT_SETTINGS.shellWallExtension}
                  min={0}
                  max={30}
                  step={0.01}
                  unit="mm"
                  onChange={(v) => setSetting("shellWallExtension", v)}
                  defaultValue={DEFAULT_SETTINGS.shellWallExtension}
                  onReset={() => setSetting("shellWallExtension", DEFAULT_SETTINGS.shellWallExtension)}
                  commitOnRelease
                  {...hl(["shell_extension"])}
                />
                <div className="flex items-center justify-between text-xs text-muted-foreground py-0.5">
                  <span>Total depth</span>
                  <span className="font-mono font-medium text-foreground">
                    {getShellTotalDepth(settings).toFixed(1)} mm
                  </span>
                </div>
                <SliderRow
                  label="Wall thickness"
                  value={settings.insetAmount}
                  min={0.5}
                  max={5}
                  step={0.01}
                  unit="mm"
                  onChange={(v) => setSetting("insetAmount", v)}
                  commitOnRelease
                  defaultValue={DEFAULT_SETTINGS.insetAmount}
                  onReset={() => setSetting("insetAmount", DEFAULT_SETTINGS.insetAmount)}
                  {...hl(["shell_outer", "shell_floor", "shell_walls"])}
                />
              </div>
            </div>
            )}

            {/* ── Mechanisms ── */}
            {sidebarMode === "advanced" && (
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
                Mechanisms
              </h2>
              <div className="space-y-3">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={settings.housingsEnabled ?? true}
                    onChange={(e) => setSetting("housingsEnabled", e.target.checked)}
                    className="h-4 w-4 rounded accent-primary"
                  />
                  <span className="text-sm">Inner housings</span>
                  <InfoTooltip text="When off, all MX mechanism geometry (keycap pocket, switch cavity, boss, pin holes) is removed from both pieces. Use this for decorative two-piece shells." />
                </label>
              </div>
            </div>
            )}

            {/* ── Key Ring (outer shell only) ── */}
            {sidebarMode === "advanced" && (
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
                Key Ring
              </h2>
              <div className="space-y-5">
                <label className="flex items-center gap-2 cursor-pointer select-none"
                  onClick={(e) => {
                    if (!isPremium) {
                      e.preventDefault();
                      requirePremium("key_ring");
                    }
                  }}
                >
                  <input
                    type="checkbox"
                    checked={settings.keyRingEnabled ?? true}
                    onChange={(e) => isPremium && setSetting("keyRingEnabled", e.target.checked)}
                    disabled={!isPremium}
                    className="h-4 w-4 rounded accent-primary"
                  />
                  <span className="text-sm">
                    {isPremium ? "Add key ring lug" : <PremiumLabel>Add key ring lug</PremiumLabel>}
                  </span>
                  <InfoTooltip text="Adds a cylindrical tab with a through-hole at the top-centre of the outer shell so you can clip on a real key ring or carabiner. Inner clicker is unchanged." />
                </label>
                {settings.keyRingEnabled && (
                  <div className="space-y-5 pl-6">
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-muted-foreground w-24 shrink-0">Position</span>
                      <div className="flex gap-1">
                        {(["top", "bottom"] as const).map((pos) => (
                          <button
                            key={pos}
                            type="button"
                            onClick={() => setSetting("keyRingPosition", pos)}
                            className={`px-3 py-0.5 text-xs rounded border transition-colors ${
                              (settings.keyRingPosition ?? "top") === pos
                                ? "bg-primary text-primary-foreground border-primary"
                                : "border-border hover:border-primary/60"
                            }`}
                          >
                            {pos.charAt(0).toUpperCase() + pos.slice(1)}
                          </button>
                        ))}
                      </div>
                    </div>
                    <SliderRow
                      label="Cylinder diameter"
                      value={settings.keyRingOuterDiameter ?? DEFAULT_SETTINGS.keyRingOuterDiameter}
                      min={6}
                      max={20}
                      step={0.1}
                      unit="mm"
                      onChange={(v) => setSetting("keyRingOuterDiameter", v)}
                      commitOnRelease
                      defaultValue={DEFAULT_SETTINGS.keyRingOuterDiameter}
                      onReset={() => setSetting("keyRingOuterDiameter", DEFAULT_SETTINGS.keyRingOuterDiameter)}
                    />
                    <SliderRow
                      label="Hole diameter"
                      value={settings.keyRingHoleDiameter ?? DEFAULT_SETTINGS.keyRingHoleDiameter}
                      min={2}
                      max={Math.max(2, (settings.keyRingOuterDiameter ?? DEFAULT_SETTINGS.keyRingOuterDiameter) - 0.8)}
                      step={0.1}
                      unit="mm"
                      onChange={(v) => setSetting("keyRingHoleDiameter", v)}
                      commitOnRelease
                      defaultValue={DEFAULT_SETTINGS.keyRingHoleDiameter}
                      onReset={() => setSetting("keyRingHoleDiameter", DEFAULT_SETTINGS.keyRingHoleDiameter)}
                    />
                    <SliderRow
                      label="Thickness (Z)"
                      value={settings.keyRingThickness ?? DEFAULT_SETTINGS.keyRingThickness}
                      min={0.5}
                      max={5}
                      step={0.1}
                      unit="mm"
                      onChange={(v) => setSetting("keyRingThickness", v)}
                      commitOnRelease
                      defaultValue={DEFAULT_SETTINGS.keyRingThickness}
                      onReset={() => setSetting("keyRingThickness", DEFAULT_SETTINGS.keyRingThickness)}
                    />
                    <SliderRow
                      label="Nudge X"
                      value={settings.keyRingNudgeX ?? DEFAULT_SETTINGS.keyRingNudgeX}
                      min={-20}
                      max={20}
                      step={0.5}
                      unit="mm"
                      onChange={(v) => setSetting("keyRingNudgeX", v)}
                      commitOnRelease
                      defaultValue={DEFAULT_SETTINGS.keyRingNudgeX}
                      onReset={() => setSetting("keyRingNudgeX", DEFAULT_SETTINGS.keyRingNudgeX)}
                    />
                    <SliderRow
                      label="Nudge Y"
                      value={settings.keyRingNudgeY ?? DEFAULT_SETTINGS.keyRingNudgeY}
                      min={-20}
                      max={20}
                      step={0.5}
                      unit="mm"
                      onChange={(v) => setSetting("keyRingNudgeY", v)}
                      commitOnRelease
                      defaultValue={DEFAULT_SETTINGS.keyRingNudgeY}
                      onReset={() => setSetting("keyRingNudgeY", DEFAULT_SETTINGS.keyRingNudgeY)}
                    />
                    <SliderRow
                      label="Nudge Z"
                      value={settings.keyRingNudgeZ ?? DEFAULT_SETTINGS.keyRingNudgeZ}
                      min={-10}
                      max={10}
                      step={0.5}
                      unit="mm"
                      onChange={(v) => setSetting("keyRingNudgeZ", v)}
                      commitOnRelease
                      defaultValue={DEFAULT_SETTINGS.keyRingNudgeZ}
                      onReset={() => setSetting("keyRingNudgeZ", DEFAULT_SETTINGS.keyRingNudgeZ)}
                    />
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Lug sits flush with the bottom of the shell. Use Position to anchor it to the top or bottom edge, then Nudge X/Y/Z for fine adjustment.
                    </p>
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={settings.keyRingOnShell ?? true}
                        onChange={(e) => setSetting("keyRingOnShell", e.target.checked)}
                        className="h-4 w-4 rounded accent-primary"
                      />
                      <span className="text-sm">On outer shell</span>
                      <InfoTooltip text="Show the key-ring lug on the outer shell piece." />
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={settings.keyRingOnClicker ?? false}
                        onChange={(e) => setSetting("keyRingOnClicker", e.target.checked)}
                        className="h-4 w-4 rounded accent-primary"
                      />
                      <span className="text-sm">On inner clicker</span>
                      <InfoTooltip text="Adds an identical key-ring lug to the inner clicker piece, using the same size, position, and nudge settings." />
                    </label>
                  </div>
                )}
              </div>
            </div>
            )}

            {/* ── Inner Clicker (basics) ── */}
            {sidebarMode === "advanced" && (
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
                Inner Clicker
              </h2>
              <div className="space-y-5">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Preview color</span>
                  <DebouncedColorInput
                    value={settings.clickerColor ?? DEFAULT_SETTINGS.clickerColor}
                    onChange={(v) => setSetting("clickerColor", v)}
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
                  <ResetButton
                    isDefault={(settings.mirrorClicker ?? false) === DEFAULT_SETTINGS.mirrorClicker}
                    onReset={() => setSetting("mirrorClicker", DEFAULT_SETTINGS.mirrorClicker)}
                    defaultLabel={DEFAULT_SETTINGS.mirrorClicker ? "on" : "off"}
                  />
                </label>
                <SliderRow
                  label="Total thickness"
                  value={settings.clickerTotalDepth ?? DEFAULT_SETTINGS.clickerTotalDepth}
                  min={3}
                  max={30}
                  step={0.01}
                  unit="mm"
                  onChange={(v) => setSetting("clickerTotalDepth", v)}
                  commitOnRelease
                  defaultValue={DEFAULT_SETTINGS.clickerTotalDepth}
                  onReset={() => setSetting("clickerTotalDepth", DEFAULT_SETTINGS.clickerTotalDepth)}
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
                  commitOnRelease
                  defaultValue={DEFAULT_SETTINGS.clickerFloorDepth}
                  onReset={() => setSetting("clickerFloorDepth", DEFAULT_SETTINGS.clickerFloorDepth)}
                  {...hl(["click_floor"])}
                />
              </div>
            </div>
            )}

            {/* ── Fit Clearance ── */}
            {sidebarMode === "advanced" && (
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
                Fit Clearance
              </h2>
              <div className="space-y-5">
                <SliderRow
                  label="XY gap"
                  value={settings.clearanceMm ?? DEFAULT_SETTINGS.clearanceMm}
                  min={0.05}
                  max={1.0}
                  step={0.01}
                  unit="mm"
                  onChange={(v) => setSetting("clearanceMm", v)}
                  commitOnRelease
                  defaultValue={DEFAULT_SETTINGS.clearanceMm}
                  onReset={() => setSetting("clearanceMm", DEFAULT_SETTINGS.clearanceMm)}
                  {...hl(["shell_outer", "shell_floor", "shell_walls"])}
                />
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Gap added between the clicker body and the shell pocket so the clicker slides in cleanly.
                </p>
              </div>
            </div>
            )}

            {/* ── Advanced disclosure ── */}
            {sidebarMode === "advanced" && (
            <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="group flex w-full items-center justify-between rounded-lg border border-border/60 bg-accent/20 hover:bg-accent/40 px-3 py-2.5 transition-colors"
                >
                  <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground group-hover:text-foreground">
                    <Settings2 className="h-3.5 w-3.5" />
                    Advanced
                  </span>
                  <ChevronDown
                    className={`h-4 w-4 text-muted-foreground transition-transform ${advancedOpen ? "rotate-180" : ""}`}
                  />
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-5 space-y-6">

                {/* Cutout layout — swap functional cutouts between the two parts */}
                <div className="space-y-3">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={settings.swapCutouts ?? false}
                      onChange={(e) => setSetting("swapCutouts", e.target.checked)}
                      className="h-4 w-4 rounded accent-primary"
                    />
                    <span className="text-sm">Swap stem-mount and switch-cavity cutouts</span>
                    <InfoTooltip text="Flips which part holds which feature. Default: outer shell has the keycap square pocket + 5 MX pin holes, inner clicker has the switch cavity + actuator boss with cross pocket. When on: outer shell gets the switch cavity + actuator boss (with cross pocket for the MX stem), and the inner clicker carries the switch-housing square cavity with the 5 MX pin holes punched inside it (no boss). All other geometry stays unchanged." />
                    <ResetButton
                      isDefault={(settings.swapCutouts ?? false) === DEFAULT_SETTINGS.swapCutouts}
                      onReset={() => setSetting("swapCutouts", DEFAULT_SETTINGS.swapCutouts)}
                      defaultLabel={DEFAULT_SETTINGS.swapCutouts ? "on" : "off"}
                    />
                  </label>
                </div>

                {/* Color regions — only shown when the SVG actually has them */}
                {colorRegions.length > 0 && (
                  <div>
                    <div className="flex items-center gap-1.5 mb-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/80">
                      Color Regions
                      <InfoTooltip text="Each non-silhouette fill in the SVG becomes a flat extruded slab flush with the bottom face of the outer shell. Sized for multi-color FDM (single-extruder color swap or AMS) — typically 0.4–0.6 mm." />
                    </div>
                    <div className="space-y-3 pl-0">
                      <SliderRow
                        label="Layer thickness"
                        value={settings.colorLayerThickness ?? DEFAULT_SETTINGS.colorLayerThickness}
                        min={0.1}
                        max={1.0}
                        step={0.01}
                        unit="mm"
                        onChange={(v) => setSetting("colorLayerThickness", v)}
                        defaultValue={DEFAULT_SETTINGS.colorLayerThickness}
                        onReset={() => setSetting("colorLayerThickness", DEFAULT_SETTINGS.colorLayerThickness)}
                        commitOnRelease
                      />
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        {colorRegions.length} region{colorRegions.length === 1 ? "" : "s"} detected.
                        Exported as a composite outer shell in 3MF and as a vertex-color OBJ zip;
                        STL drops color information.
                      </p>
                    </div>
                  </div>
                )}

                {/* Switch cavity (keycap + cavity dims) */}
                <div>
                  <div className="flex items-center gap-1.5 mb-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/80">
                    Switch Cavity
                    <InfoTooltip text="Cherry MX–compatible defaults. Only adjust if you're using a non-standard switch or want a deliberately loose/tight fit." />
                  </div>
                  <div className="space-y-5">
                    <SliderRow
                      label="Keycap pocket depth"
                      value={settings.keycapPocketDepth ?? DEFAULT_SETTINGS.keycapPocketDepth}
                      min={2}
                      max={settings.shellSwitchHousing ?? DEFAULT_SETTINGS.shellSwitchHousing}
                      step={0.01}
                      unit="mm"
                      onChange={(v) => setSetting("keycapPocketDepth", v)}
                      defaultValue={DEFAULT_SETTINGS.keycapPocketDepth}
                      onReset={() => setSetting("keycapPocketDepth", DEFAULT_SETTINGS.keycapPocketDepth)}
                      commitOnRelease
                      {...hl(["shell_walls"])}
                    />
                    <SliderRow
                      label="Keycap square"
                      value={settings.keycapSize}
                      min={10}
                      max={22}
                      step={0.01}
                      unit="mm"
                      onChange={(v) => setSetting("keycapSize", v)}
                      commitOnRelease
                      defaultValue={DEFAULT_SETTINGS.keycapSize}
                      onReset={() => setSetting("keycapSize", DEFAULT_SETTINGS.keycapSize)}
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
                      commitOnRelease
                      defaultValue={DEFAULT_SETTINGS.clickerSquareSize}
                      onReset={() => setSetting("clickerSquareSize", DEFAULT_SETTINGS.clickerSquareSize)}
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
                      commitOnRelease
                      defaultValue={DEFAULT_SETTINGS.clickerSquareDepth}
                      onReset={() => setSetting("clickerSquareDepth", DEFAULT_SETTINGS.clickerSquareDepth)}
                      {...hl(["click_walls"])}
                    />
                  </div>
                </div>

                {/* Actuator boss + MX cross pocket */}
                <div className="border-t border-border/40 pt-5">
                  <div className="flex items-center gap-1.5 mb-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/80">
                    Actuator Boss
                    <InfoTooltip text="The cylindrical boss on the clicker that engages the MX switch stem. Cross pocket sits on top." />
                  </div>
                  <div className="space-y-5">
                    <SliderRow
                      label="Boss diameter"
                      value={settings.bossDiameter ?? DEFAULT_SETTINGS.bossDiameter}
                      min={1}
                      max={15}
                      step={0.01}
                      unit="mm"
                      onChange={(v) => setSetting("bossDiameter", v)}
                      commitOnRelease
                      defaultValue={DEFAULT_SETTINGS.bossDiameter}
                      onReset={() => setSetting("bossDiameter", DEFAULT_SETTINGS.bossDiameter)}
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
                      commitOnRelease
                      defaultValue={DEFAULT_SETTINGS.bossHeight}
                      onReset={() => setSetting("bossHeight", DEFAULT_SETTINGS.bossHeight)}
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
                      commitOnRelease
                      defaultValue={DEFAULT_SETTINGS.bossFloorGap}
                      onReset={() => setSetting("bossFloorGap", DEFAULT_SETTINGS.bossFloorGap)}
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
                      commitOnRelease
                      defaultValue={DEFAULT_SETTINGS.crossSize}
                      onReset={() => setSetting("crossSize", DEFAULT_SETTINGS.crossSize)}
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
                      commitOnRelease
                      defaultValue={DEFAULT_SETTINGS.crossDepth}
                      onReset={() => setSetting("crossDepth", DEFAULT_SETTINGS.crossDepth)}
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
                      commitOnRelease
                      defaultValue={DEFAULT_SETTINGS.crossArmWidth}
                      onReset={() => setSetting("crossArmWidth", DEFAULT_SETTINGS.crossArmWidth)}
                      {...hl(["click_boss"])}
                    />
                  </div>
                </div>

                {/* Cherry MX 5-pin holes */}
                <div className="border-t border-border/40 pt-5 space-y-3">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={settings.pinHolesEnabled}
                      onChange={(e) => setSetting("pinHolesEnabled", e.target.checked)}
                      className="h-4 w-4 rounded accent-primary"
                    />
                    <span className="text-sm">Cherry MX 5-pin holes</span>
                    <InfoTooltip text="Punches the Cherry MX 5-pin footprint into the deepest section of the pocket: Ø4 mm center guide · Ø1.8 mm retention pegs (±5.08 mm) · Ø1.5 mm contacts (±3.81 mm / −2.54 mm). The pin section sits below the keycap square — from the pocket floor upward." />
                    <ResetButton
                      isDefault={settings.pinHolesEnabled === DEFAULT_SETTINGS.pinHolesEnabled}
                      onReset={() => setSetting("pinHolesEnabled", DEFAULT_SETTINGS.pinHolesEnabled)}
                      defaultLabel={DEFAULT_SETTINGS.pinHolesEnabled ? "on" : "off"}
                    />
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
                        defaultValue={DEFAULT_SETTINGS.pinHoleDepth}
                        onReset={() => setSetting("pinHoleDepth", DEFAULT_SETTINGS.pinHoleDepth)}
                        commitOnRelease
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
                        commitOnRelease
                        defaultValue={DEFAULT_SETTINGS.pinHoleRadius}
                        onReset={() => setSetting("pinHoleRadius", DEFAULT_SETTINGS.pinHoleRadius)}
                        {...hl(["shell_pin"])}
                      />
                    </div>
                  )}
                </div>

                {/* Pocket position nudge */}
                <div className="border-t border-border/40 pt-5 space-y-3">
                  <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/80">
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
                    defaultValue={DEFAULT_SETTINGS.pocketOffsetX}
                    onReset={() => setSetting("pocketOffsetX", DEFAULT_SETTINGS.pocketOffsetX)}
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
                    defaultValue={DEFAULT_SETTINGS.pocketOffsetY}
                    onReset={() => setSetting("pocketOffsetY", DEFAULT_SETTINGS.pocketOffsetY)}
                    {...hl(["shell_walls", "click_boss", "click_walls"])}
                  />
                </div>

              </CollapsibleContent>
            </Collapsible>
            )}

            {/* Parts legend */}
            {sidebarMode === "advanced" && (
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
                const shellHousing = settings.shellSwitchHousing ?? DEFAULT_SETTINGS.shellSwitchHousing;
                const shellFloor = settings.shellSolidFloor ?? DEFAULT_SETTINGS.shellSolidFloor;
                const shellExt = settings.shellWallExtension ?? DEFAULT_SETTINGS.shellWallExtension;
                const pocketDepth = Math.min(kpd, shellHousing - 1);
                const pinDepth = settings.pinHolesEnabled ? Math.min(phd, pocketDepth - 1) : 0;
                const squareDepth = pocketDepth - pinDepth;
                return (
                  <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                    <p>Solid floor: <span className="font-mono font-medium text-foreground">{shellFloor.toFixed(1)} mm</span></p>
                    {settings.pinHolesEnabled && (
                      <p>Pin section: <span className="font-mono font-medium text-foreground">{pinDepth.toFixed(1)} mm</span></p>
                    )}
                    <p>Keycap square: <span className="font-mono font-medium text-foreground">{squareDepth.toFixed(1)} mm</span></p>
                    <p>Clicker recess: <span className="font-mono font-medium text-foreground">{shellExt.toFixed(1)} mm</span></p>
                  </div>
                );
              })()}
            </div>
            )}

            {/* Actions — Advanced only. Simple mode keeps the sidebar to
                upload, size, and preview color per the product spec. */}
            {sidebarMode === "advanced" && (
            <div className="space-y-2">
              <Button
                className="w-full"
                onClick={handleSave}
                disabled={isSaving || !svgState}
              >
                {isGuest ? <LogIn className="h-4 w-4 mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                {isSaving
                  ? "Saving…"
                  : isGuest
                    ? "Sign in to save"
                    : projectId ? "Update Project" : "Save Project"}
              </Button>

              {/* Merge toggle (advanced only) */}
              {sidebarMode === "advanced" && (
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
              )}

              <Button
                variant="outline"
                className="w-full"
                onClick={handleExportSTL}
                disabled={!svgState}
              >
                <Download className="h-4 w-4 mr-2" />
                {mergeForExport ? "Export STL (zip)" : "Export STL"}
                {isGuest && (
                  <span className="ml-2 text-[10px] text-muted-foreground">
                    ({Math.max(0, 1 - getAnonStlExportCount())} free)
                  </span>
                )}
              </Button>
              <Button
                variant="outline"
                className="w-full"
                onClick={handleExport3MF}
                disabled={!svgState}
              >
                <Download className="h-4 w-4 mr-2" />
                {isPremium ? "Export 3MF" : <PremiumLabel>Export 3MF</PremiumLabel>}
              </Button>
              <Button
                variant="outline"
                className="w-full"
                onClick={handleExportOBJ}
                disabled={!svgState}
              >
                <Download className="h-4 w-4 mr-2" />
                {isPremium ? "Export OBJ" : <PremiumLabel>Export OBJ</PremiumLabel>}
              </Button>
            </div>
            )}

          </div>
        </aside>

        {/* ── 3D canvas ── */}
        <main className="flex-1 relative z-0 isolate">
          {!svgState && (
            <div className="absolute inset-0 flex flex-col items-center justify-center z-10 pointer-events-none">
              <Box className="h-12 w-12 text-muted-foreground/30 mb-3" />
              <p className="text-muted-foreground text-sm">Upload an SVG to see your fidget toy</p>
            </div>
          )}

          {/* ── View toggles (top-right) ── */}
          {svgState && (
            <div className="absolute top-3 right-3 z-10 flex flex-col items-end gap-2">
            <div className="flex items-center gap-2">
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
              {/* Wireframe toggle */}
              <button
                onClick={() => setViewMode((v) => v === "wireframe" ? "solid" : "wireframe")}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium border transition-colors ${
                  viewMode === "wireframe"
                    ? "bg-sky-600/90 border-sky-500 text-white shadow-lg"
                    : "bg-background/80 border-border text-muted-foreground hover:text-foreground backdrop-blur-sm"
                }`}
                title="Toggle wireframe view"
              >
                <Scan className="h-3.5 w-3.5" />
                Wireframe
              </button>
              <button
                onClick={() => requirePremium("fit_check", () => setFitCheckMode((v) => !v))}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium border transition-colors ${
                  fitCheckMode
                    ? "bg-indigo-600 border-indigo-500 text-white shadow-lg"
                    : "bg-background/80 border-border text-muted-foreground hover:text-foreground backdrop-blur-sm"
                }`}
                title="Toggle fit-check view — snap pieces together to verify pocket & recess alignment"
              >
                <Layers className="h-3.5 w-3.5" />
                Fit Check
                {!isPremium && <Crown className="h-3 w-3 text-amber-400" />}
              </button>
              {/* X-Ray (Premium) */}
              <button
                onClick={() => requirePremium("x_ray", () =>
                  setViewMode((v) => v === "xray" ? "solid" : "xray")
                )}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium border transition-colors ${
                  viewMode === "xray"
                    ? "bg-fuchsia-600/90 border-fuchsia-500 text-white shadow-lg"
                    : "bg-background/80 border-border text-muted-foreground hover:text-foreground backdrop-blur-sm"
                }`}
                title="Toggle x-ray view"
              >
                <EyeOff className="h-3.5 w-3.5" />
                X-Ray
                {!isPremium && <Crown className="h-3 w-3 text-amber-400" />}
              </button>
              {fitCheckMode && (
                <span className="text-[10px] text-indigo-300/80 bg-indigo-950/60 border border-indigo-800/40 rounded px-2 py-1 backdrop-blur-sm">
                  Outer shell ghosted · clicker seated in recess
                </span>
              )}
              <button
                onClick={() => setShowBanana((v) => !v)}
                className={`flex items-center justify-center rounded-md px-2 py-1.5 text-xs font-medium border transition-colors ${
                  showBanana
                    ? "bg-indigo-600 border-indigo-500 text-white shadow-lg"
                    : "bg-background/80 border-border text-muted-foreground hover:text-foreground backdrop-blur-sm"
                }`}
                title="Banana for scale (200 mm)"
                aria-label="Banana for scale"
              >
                <span aria-hidden style={{ color: "#FFE135" }}>🍌</span>
              </button>
            </div>
              {/* ── Controls hint — below the buttons row ── */}
              <div className="flex flex-col items-end gap-1 text-[10px] text-white/30 pointer-events-none select-none">
                <div className="flex items-center gap-1.5">
                  <Mouse className="h-3 w-3" />
                  Scroll to zoom
                </div>
                <div className="flex items-center gap-1.5">
                  <MoveHorizontal className="h-3 w-3" />
                  Middle-drag to pan
                </div>
              </div>
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
                      innerFillHousingCapRef={innerFillHousingCapRef}
                      shellBossBaseRef={shellBossBaseRef}
                      shellBossMainRef={shellBossMainRef}
                      keyRingRef={keyRingRef}
                      fitCheck={fitCheckMode}
                      onBounds={setShellBounds}
                      color={settings.shellColor ?? DEFAULT_SETTINGS.shellColor}
                      activeHighlights={sliderHighlight}
                      viewMode={viewMode}
                    />
                    {colorLayerGeometries.length > 0 && (
                      <ColorLayersGroup
                        geometries={colorLayerGeometries}
                        settings={settings}
                        svgWidth={svgState.width}
                        svgHeight={svgState.height}
                        fitCheck={fitCheckMode}
                        groupRef={colorLayersGroupRef}
                      />
                    )}
                    <InnerClickerGroup
                      shapes={svgState.shapes}
                      settings={settings}
                      svgWidth={svgState.width}
                      svgHeight={svgState.height}
                      clickerFloorRef={clickerFloorRef}
                      clickerWallsRef={clickerWallsRef}
                      clickerPinSectionRef={clickerPinSectionRef}
                      bossBaseRef={bossBaseRef}
                      bossMainRef={bossMainRef}
                      clickerKeyRingRef={clickerKeyRingRef}
                      fitCheck={fitCheckMode}
                      onBounds={setClickerBounds}
                      color={settings.clickerColor ?? DEFAULT_SETTINGS.clickerColor}
                      activeHighlights={sliderHighlight}
                      viewMode={viewMode}
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
                shellDepth={getShellTotalDepth(settings)}
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

            {svgState && (
              <LabelProjector
                separationX={sceneMetrics.separationX}
                shellLabelRef={shellLabelRef}
                clickerLabelRef={clickerLabelRef}
              />
            )}
            {showBanana && <BananaMesh />}

            <CameraTracker stateRef={vcStateRef} snapRef={vcSnapRef} dragRef={vcDragRef} />
            <OrbitControls makeDefault enablePan enableZoom enableRotate />
          </Canvas>

          {/* Labels — horizontal position is driven every frame by LabelProjector */}
          {svgState && (
            <>
              <div
                ref={shellLabelRef}
                className="absolute top-4 text-xs text-white/70 rounded px-2 py-1 pointer-events-none"
                style={{
                  left: "25%",
                  transform: "translateX(-50%)",
                  backgroundColor: `${settings.shellColor ?? DEFAULT_SETTINGS.shellColor}33`,
                  borderWidth: 1,
                  borderStyle: "solid",
                  borderColor: `${settings.shellColor ?? DEFAULT_SETTINGS.shellColor}4D`,
                }}
              >
                Outer Shell
              </div>
              <div
                ref={clickerLabelRef}
                className="absolute top-4 text-xs text-white/70 rounded px-2 py-1 pointer-events-none"
                style={{
                  left: "75%",
                  transform: "translateX(-50%)",
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
          <div className="absolute bottom-8 left-8 z-10 flex items-end gap-4">
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

        </main>
      </div>

      {/* Pick-from-library modal */}
      <LibraryPickerPanel
        open={libraryPickerOpen}
        onClose={() => setLibraryPickerOpen(false)}
        onPick={handleLibraryPick}
      />

      {/* SVG compatibility warning modal */}
      <AlertDialog open={svgWarningOpen} onOpenChange={setSvgWarningOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>This file may not convert correctly</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  We found {svgWarningIssues.length === 1 ? "a potential issue" : "some potential issues"} with this SVG file that {svgWarningIssues.some(i => i.blocking) ? "may cause incorrect 3D geometry" : "are worth knowing about"}:
                </p>
                <ul className="space-y-2">
                  {svgWarningIssues.map((issue, idx) => (
                    <li key={idx} className="rounded-md border p-3 text-sm">
                      <span className="font-medium">{issue.title}</span>
                      <p className="mt-1 text-muted-foreground">{issue.description}</p>
                    </li>
                  ))}
                </ul>
                <p className="text-sm text-muted-foreground">
                  You can still try loading it — it might work fine. Or go back and try a different file.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                setPendingSvgFile(null);
                setSvgWarningIssues([]);
              }}
            >
              Go back
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingSvgFile) {
                  handleSVGLoad(pendingSvgFile.content, pendingSvgFile.fileName);
                }
                setPendingSvgFile(null);
                setSvgWarningIssues([]);
                setSvgWarningOpen(false);
              }}
            >
              Load anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* STL color-loss warning — STL has no concept of color, so per-region
          slabs are dropped and only the merged shell + clicker bodies survive.
          Confirming proceeds with the colorless STL export. */}
      <AlertDialog open={stlColorWarnOpen} onOpenChange={setStlColorWarnOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>STL doesn’t support colors</AlertDialogTitle>
            <AlertDialogDescription>
              Your SVG has {colorRegions.length} color region
              {colorRegions.length === 1 ? "" : "s"}. STL files only contain
              geometry, so the per-color flat bodies will be dropped — you’ll
              get just the outer shell and inner clicker. Use 3MF or OBJ to
              keep color information.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                setStlColorWarnOpen(false);
                await performExportSTL();
              }}
            >
              Export STL anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Promote anonymous draft after sign-in */}
      <AlertDialog open={promoteOpen} onOpenChange={setPromoteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Save the project you were working on?</AlertDialogTitle>
            <AlertDialogDescription>
              You started a design as a guest. Would you like to save it to your
              account so you can come back to it later?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                // No: discard the in-browser draft, keep the in-memory work.
                clearDraft();
                setPromotePending(false);
                setPromoteOpen(false);
              }}
            >
              No, discard draft
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setPromotePending(false);
                setPromoteOpen(false);
                void performSave();
              }}
            >
              Yes, save it
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Premium upgrade modal */}
      <UpgradeModal
        open={upgradeFeature !== null}
        onOpenChange={(o) => { if (!o) setUpgradeFeature(null); }}
        feature={upgradeFeature}
      />

      {/* Sign-in required modal */}
      <AuthRequiredModal
        open={authAction !== null}
        onOpenChange={(o) => { if (!o) setAuthAction(null); }}
        action={authAction ?? ""}
      />
    </div>
  );
}

// ─── Small sub-components ─────────────────────────────────────────────────

function ResetButton({
  isDefault,
  onReset,
  defaultLabel,
}: {
  isDefault: boolean;
  onReset: () => void;
  defaultLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onReset();
      }}
      disabled={isDefault}
      title={isDefault ? "Already at default" : `Reset to ${defaultLabel}`}
      className={`ml-auto flex items-center justify-center rounded p-0.5 transition-colors ${
        isDefault
          ? "opacity-30 cursor-default"
          : "text-orange-500 hover:text-orange-400 hover:bg-accent/50 cursor-pointer"
      }`}
    >
      <RotateCcw className="h-3 w-3" />
    </button>
  );
}

/**
 * Tiny debounce hook — no new dependency. Returns a stable callback that
 * delays invoking `fn` until `delayMs` has elapsed since the last call.
 * Re-creates the timer on each call. Cancels on unmount.
 */
type DebouncedFn<A extends unknown[]> = ((...args: A) => void) & {
  /** Drop any pending invocation so it never fires. */
  cancel: () => void;
};

function useDebouncedCallback<A extends unknown[]>(
  fn: (...args: A) => void,
  delayMs: number,
): DebouncedFn<A> {
  const fnRef = useRef(fn);
  useEffect(() => { fnRef.current = fn; }, [fn]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);
  return useMemo(() => {
    const debounced = ((...args: A) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        fnRef.current(...args);
      }, delayMs);
    }) as DebouncedFn<A>;
    debounced.cancel = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
    return debounced;
  }, [delayMs]);
}

/**
 * Native colour input that mirrors the chosen value locally for instant UI
 * feedback while debouncing the (expensive) parent state update so dragging
 * the picker no longer triggers a re-render storm.
 */
function DebouncedColorInput({
  value,
  onChange,
  className,
  delayMs = 80,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  delayMs?: number;
}) {
  const [draft, setDraft] = useState(value);
  // Sync local state when the parent value changes externally (e.g. SVG load,
  // reset to defaults). Only update when not actively driving the input.
  const draggingRef = useRef(false);
  useEffect(() => {
    if (!draggingRef.current) setDraft(value);
  }, [value]);
  const debouncedCommit = useDebouncedCallback(onChange, delayMs);
  return (
    <input
      type="color"
      value={draft}
      onChange={(e) => {
        draggingRef.current = true;
        setDraft(e.target.value);
        debouncedCommit(e.target.value);
      }}
      onBlur={(e) => {
        draggingRef.current = false;
        // Cancel any pending debounced commit first so it can't fire after
        // (and overwrite) the immediate flush below.
        debouncedCommit.cancel();
        onChange(e.target.value);
      }}
      className={className}
    />
  );
}

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
  defaultValue,
  onReset,
  commitOnRelease = false,
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
  defaultValue?: number;
  onReset?: () => void;
  /**
   * When true the slider drag updates only a local value for visual feedback
   * and only commits to `onChange` on Radix's `onValueCommit` (pointer-up /
   * keyup).  Use for geometry-heavy sliders so dragging doesn't rebuild
   * `THREE.ExtrudeGeometry` 60 times a second.
   */
  commitOnRelease?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  // Local mirror of the slider value for commit-on-release mode.  Synced from
  // the parent value when not actively dragging, so external resets and
  // typed-input commits both flow through correctly.
  const [liveValue, setLiveValue] = useState(value);
  const draggingRef = useRef(false);
  useEffect(() => {
    if (!draggingRef.current) setLiveValue(value);
  }, [value]);
  const displayValue = commitOnRelease ? liveValue : value;

  const commit = (raw: string) => {
    const n = parseFloat(raw);
    if (!isNaN(n)) onChange(Math.min(max, Math.max(min, n)));
    setDraft(null);
  };

  const showReset = defaultValue !== undefined && onReset !== undefined;
  const isDefault = showReset && displayValue === defaultValue;

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
            value={draft ?? (displayValue ?? 0).toFixed(2)}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit((e.target as HTMLInputElement).value);
              if (e.key === "Escape") setDraft(null);
            }}
            className="w-16 text-xs font-mono text-right bg-transparent border border-transparent hover:border-border focus:border-primary focus:outline-none rounded px-1 py-0.5 text-muted-foreground focus:text-foreground transition-colors"
          />
          <span className="text-xs text-muted-foreground">{unit}</span>
          {showReset && (
            <button
              type="button"
              onClick={onReset}
              disabled={isDefault}
              title={isDefault ? "Already at default" : `Reset to ${defaultValue}`}
              className={`ml-0.5 flex items-center justify-center rounded p-0.5 transition-colors ${
                isDefault
                  ? "opacity-30 cursor-default"
                  : "text-orange-500 hover:text-orange-400 hover:bg-accent/50 cursor-pointer"
              }`}
            >
              <RotateCcw className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
      <Slider
        min={min}
        max={max}
        step={step}
        value={[displayValue ?? min]}
        onValueChange={([v]) => {
          if (commitOnRelease) {
            draggingRef.current = true;
            setLiveValue(v);
          } else {
            onChange(v);
          }
        }}
        onValueCommit={([v]) => {
          if (commitOnRelease) {
            draggingRef.current = false;
            onChange(v);
          }
        }}
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
