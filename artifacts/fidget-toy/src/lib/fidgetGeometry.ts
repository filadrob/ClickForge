import * as THREE from "three";
import { insetPolygon, outsetPolygon } from "./polygonOffset";

export type ProductType = "fidget" | "standee" | "magnet" | "keychain";

export interface FidgetSettings {
  // Outer shell depth — three additive components (total = sum of all three)
  shellSolidFloor: number;     // solid floor at the very bottom of the shell (mm), e.g. 2
  shellSwitchHousing: number;  // depth of the switch-housing pocket region (mm), e.g. 10
  shellWallExtension: number;  // plain wall that extends above the housing pocket (mm), e.g. 10
  keycapPocketDepth: number;   // total pocket depth from top of inner fill (mm), e.g. 10
  insetAmount: number;         // true wall thickness — every interior point is exactly this far from outer wall (mm), e.g. 1.5
  keycapSize: number;          // keycap square pocket side length (mm), e.g. 14
  targetSizeMm: number;        // target mm for the locked SVG dimension
  lockDimension: "width" | "height";
  pinHolesEnabled: boolean;
  pinHoleRadius: number;       // print clearance added to each MX spec radius (mm), e.g. 0.1
  pinHoleDepth: number;        // depth of pin-hole section at deepest end of pocket (mm), e.g. 3
  // Inner clicker geometry
  clickerTotalDepth: number;   // total clicker height (mm), e.g. 9.4
  clickerFloorDepth: number;   // solid floor at bottom of clicker (mm), e.g. 2.0
  clickerSquareSize: number;   // switch housing cavity square side (mm), e.g. 16.2
  clickerSquareDepth: number;  // depth of switch housing cavity from top (mm), e.g. 7.4
  // Actuator boss (centre cylinder inside the cavity)
  bossDiameter: number;        // boss cylinder diameter (mm), e.g. 5.87
  bossHeight: number;          // boss cylinder height (mm), e.g. 4.92
  bossFloorGap: number;        // gap from clicker absolute bottom to boss start (mm), e.g. 1.0
  // MX stem cross pocket (cut from the top face of the boss downward)
  crossSize: number;           // overall bounding box of the plus sign (mm), e.g. 4.18
  crossDepth: number;          // how deep the cross is cut (mm), e.g. 4.8
  crossArmWidth: number;       // width of each cross arm (mm), e.g. 1.31
  // Pocket offset — shifts the keycap pocket, pin holes, switch cavity, and
  // boss as a unit so the switch sits at the visual centre of irregular shapes.
  pocketOffsetX: number;       // horizontal nudge (mm), positive = right
  pocketOffsetY: number;       // vertical nudge (mm), positive = up
  // Orientation flips — mirror the part so the decorative face is on the
  // correct side for printing / assembly
  flipShell: boolean;          // flip outer shell upside-down (rotate 180° around X)
  flipClicker: boolean;        // flip inner clicker upside-down (rotate 180° around X)
  mirrorShell: boolean;        // mirror outer shell silhouette left-right
  mirrorClicker: boolean;      // mirror inner clicker silhouette left-right
  // Lateral (X/Y) gap between the outer edge of the clicker body and the
  // inner edge of the shell pocket — controls how loose/tight the slide fit is.
  clearanceMm: number;
  // Preview colours (hex strings, e.g. "#6C63FF")
  shellColor: string;
  clickerColor: string;
  // Key ring lug — optional cylindrical tab with through-hole at top-centre
  // of the outer shell.  Inner clicker is unaffected.
  keyRingEnabled: boolean;
  keyRingOuterDiameter: number; // mm, e.g. 10
  keyRingHoleDiameter: number;  // mm, e.g. 5
  keyRingThickness: number;     // mm, lug Z thickness (aligned to bottom), e.g. 1
  keyRingNudgeX: number;        // mm, horizontal offset from centre, e.g. 0
  keyRingNudgeY: number;        // mm, vertical offset from top-centre default, e.g. 0
  keyRingNudgeZ: number;        // mm, depth offset from default bottom face, e.g. 0
  // Color region flat bodies — thickness of each per-color extruded slab,
  // sitting flush with the bottom face of the outer shell (z=0 upward).
  colorLayerThickness: number;
  // When true, swap the functional cutouts between the two parts so the
  // keycap-mount mechanism lives on the outer shell and the switch-mount
  // mechanism lives on the inner clicker:
  //   - Outer shell loses its keycap square pocket + MX pin holes and
  //     instead carries the switch-housing square cavity (clickerSquareSize)
  //     with a cylindrical boss inside it; the boss has the MX cross
  //     pocket cut into its top (sized by bossDiameter / bossHeight /
  //     crossSize / crossDepth / crossArmWidth, anchored above the floor
  //     by bossFloorGap, all centred at (pocketOffsetX, pocketOffsetY)).
  //   - Inner clicker loses its boss + cross pocket and instead carries
  //     the square switch cavity with the 5 MX pin holes punched inside
  //     it (gated by pinHolesEnabled).
  // All other geometry (outer boundaries, wall thicknesses, depth layers,
  // key-ring lug, etc.) is unchanged.
  swapCutouts: boolean;
  // When false, all MX mechanism geometry (keycap pocket, switch cavity,
  // boss, cross pocket, pin holes) is omitted from both pieces.
  // The toy becomes a purely decorative two-piece shell.
  housingsEnabled: boolean;
  // Which edge of the outer shell the key-ring lug anchors to.
  keyRingPosition: "top" | "bottom";
  // When true, an identical key-ring lug is also added to the inner clicker.
  keyRingOnClicker: boolean;
  // When false, the key-ring lug is suppressed on the outer shell.
  keyRingOnShell: boolean;
  // UV Print Jig
  jigEnabled: boolean;
  jigTarget: 'inner' | 'outer' | 'both';
  jigMirrorXInner: boolean;
  jigMirrorXOuter: boolean;
  jigClearance: number;   // mm, default 0.15
  jigWidth: number;       // mm, default 90
  jigHeight: number;      // mm, default 90
  jigZAdjust: number;     // mm, default 0, range -2 to +2
  jigRows: number;        // default 1
  jigCols: number;        // default 1
  jigSpacing: number;     // mm, default 2
  product?: ProductType;
  // Magnet Hole Settings
  magnetHoleEnabled: boolean;
  magnetDiameter: number; // mm
  magnetDepth: number;    // mm, cut from the top face downwards
}

export const DEFAULT_SETTINGS: FidgetSettings = {
  shellSolidFloor: 1,
  shellSwitchHousing: 10,
  shellWallExtension: 8,
  keycapPocketDepth: 10,
  insetAmount: 1,
  keycapSize: 14,
  targetSizeMm: 44,
  lockDimension: "height",
  pinHolesEnabled: true,
  pinHoleRadius: 0.1,
  pinHoleDepth: 3,
  clickerTotalDepth: 9.4,
  clickerFloorDepth: 2.0,
  clickerSquareSize: 16.2,
  clickerSquareDepth: 7.4,
  bossDiameter: 5.87,
  bossHeight: 4.92,
  bossFloorGap: 1.0,
  crossSize: 4.18,
  crossDepth: 4.8,
  crossArmWidth: 1.31,
  pocketOffsetX: 0,
  pocketOffsetY: 0,
  clearanceMm: 1,
  flipShell: false,
  flipClicker: false,
  mirrorShell: false,
  mirrorClicker: true,
  shellColor: "#6C63FF",
  clickerColor: "#10B981",
  keyRingEnabled: true,
  keyRingOuterDiameter: 10,
  keyRingHoleDiameter: 5,
  keyRingThickness: 3,
  keyRingNudgeX: 0,
  keyRingNudgeY: 0,
  keyRingNudgeZ: 7,
  colorLayerThickness: 0.4,
  swapCutouts: false,
  housingsEnabled: true,
  keyRingPosition: "top",
  keyRingOnClicker: false,
  keyRingOnShell: true,
  jigEnabled: false,
  jigTarget: 'inner',
  jigMirrorXInner: false,
  jigMirrorXOuter: false,
  jigClearance: 0.15,
  jigWidth: 90,
  jigHeight: 90,
  jigZAdjust: 0,
  jigRows: 1,
  jigCols: 1,
  jigSpacing: 2,
  product: "fidget",
  magnetHoleEnabled: false,
  magnetDiameter: 12,
  magnetDepth: 3,
};

export const PRODUCT_DEFAULTS: Record<ProductType, Partial<FidgetSettings>> = {
  fidget: {
    ...DEFAULT_SETTINGS,
  },
  standee: {
    ...DEFAULT_SETTINGS,
    product: "standee",
    housingsEnabled: false,
    keyRingEnabled: false,
    mirrorClicker: false,
  },
  magnet: {
    ...DEFAULT_SETTINGS,
    product: "magnet",
    housingsEnabled: false,
    keyRingEnabled: false,
    mirrorClicker: false,
    magnetHoleEnabled: true,
  },
  keychain: {
    ...DEFAULT_SETTINGS,
    product: "keychain",
    housingsEnabled: false,
    keyRingEnabled: true,
    keyRingOnShell: false,
    keyRingOnClicker: true,
    keyRingNudgeZ: 0,
  },
};

/**
 * Outer shell depth from the BOTTOM upward:
 *
 *   ┌─────────────────────────────┐  ← z = shellTotalDepth (top of outer wall)
 *   │   wall extension            │  shellWallExtension (e.g. 10 mm)
 *   ├─────────────────────────────┤  ← z = shellSolidFloor + shellSwitchHousing
 *   │   switch housing pocket     │  shellSwitchHousing (e.g. 10 mm)
 *   │  ┌───────────────────────┐  │
 *   │  │   keycap square       │  │  keycapPocketDepth (clamped to shellSwitchHousing−1)
 *   │  ├───────────────────────┤  │
 *   │  │   MX pin holes        │  │  pinHoleDepth (e.g. 3 mm)
 *   │  └───────────────────────┘  │
 *   ├─────────────────────────────┤  ← z = shellSolidFloor (solid floor surface)
 *   │   solid floor               │  shellSolidFloor (e.g. 2 mm)
 *   └─────────────────────────────┘  ← z = 0  (bottom of toy)
 *
 * Wall geometry uses a true geometric inward offset (not uniform scaling):
 *   Every point on the inner wall boundary is exactly `insetAmount` mm from
 *   the outer SVG path, measured along the local surface normal.
 */
export interface OuterShellGeometries {
  /** Full outer wall ring (used for rendering and export). */
  outerWall: THREE.BufferGeometry;
  /**
   * Extension-only portion of the outer wall ring — extrudes from the top of
   * the switch-housing region to the top of the part.  Used only for the
   * highlight overlay so the "Wall extension" slider can light up just its zone.
   */
  outerWallExtension: THREE.BufferGeometry;
  innerFillFloor: THREE.BufferGeometry;
  /** null when pinHolesEnabled = false */
  innerFillPinSection: THREE.BufferGeometry | null;
  innerFillWalls: THREE.BufferGeometry;
  /**
   * Solid cap filling the unused housing height above the keycap pocket when
   * keycapPocketDepth < shellSwitchHousing.  null when they are equal (no gap).
   */
  innerFillHousingCap: THREE.BufferGeometry | null;
  /**
   * Solid base of the shell-side actuator boss (swap-cutouts mode only).  Sits
   * at the bottom of the keycap pocket and gives the cross pocket a closed
   * floor.  Null when `swapCutouts` is off.
   */
  bossBase: THREE.BufferGeometry | null;
  /**
   * Main cylindrical shell-side boss with the MX cross pocket cut through it
   * from the top face downward (swap-cutouts mode only).  Null otherwise.
   */
  bossMain: THREE.BufferGeometry | null;
  zOffsets: {
    outerWall: number;
    outerWallExtension: number;
    innerFillFloor: number;
    innerFillPinSection: number;
    innerFillWalls: number;
    innerFillHousingCap: number;
    bossBase: number;
    bossMain: number;
  };
  /** Height of the shell-side boss base section (0 when not in swap mode). */
  bossBaseHeight: number;
  floorDepth: number;
  /** Actual bounding box of the outer wall's outer boundary (mm). */
  bounds: { w: number; h: number };
}

export interface InnerClickerGeometries {
  /** Solid bottom section (no cavity). */
  floor: THREE.BufferGeometry;
  /** Upper section with switch housing cavity cut from top. */
  walls: THREE.BufferGeometry;
  /**
   * Solid base of the boss (below the cross pocket) — gives the pocket a
   * closed floor so the boss doesn't extrude all the way through.
   * Null when `swapCutouts` is on (boss is moved to the shell-side cross hole).
   */
  bossBase: THREE.BufferGeometry | null;
  /**
   * Main cylindrical shell of the boss with the MX cross pocket cut through
   * it from the top face downward.  Null when `swapCutouts` is on.
   */
  bossMain: THREE.BufferGeometry | null;
  /**
   * Lower part of the switch cavity carrying the MX 5-pin holes.  Only
   * present when `swapCutouts` is on AND `pinHolesEnabled` is true.
   * Sits between the clicker floor and the upper square cavity walls.
   */
  pinSection: THREE.BufferGeometry | null;
  /** Height of the pin-hole section (mm); 0 when `pinSection` is null. */
  pinSectionDepth: number;
  /**
   * Upper-most section of the clicker walls with a circular hole for the magnet.
   * Only present when `magnetHoleEnabled` is true.
   */
  magnetSection: THREE.BufferGeometry | null;
  /** Height of the magnet section (mm); 0 when `magnetSection` is null. */
  magnetSectionDepth: number;
  clickerTotalDepth: number;
  clickerFloorDepth: number;
  bossFloorGap: number;
  bossHeight: number;
  /** Height of the solid base section (= bossHeight − crossDepth, min 0.05 mm). */
  bossBaseHeight: number;
  /** Actual bounding box of the clicker's outer boundary (mm). */
  bounds: { w: number; h: number };
}

// ---------------------------------------------------------------------------
// Derived helpers
// ---------------------------------------------------------------------------

/**
 * Per-concern cache keys.  Each lists ONLY the fields the matching builder
 * actually reads, so unrelated edits (e.g. picking a clicker colour, toggling
 * the key ring while looking at the inner clicker, nudging the colour-layer
 * thickness while looking at the shell) cannot invalidate the wrong memo.
 *
 * Two strings with identical contents compare equal under `Object.is`, so
 * React's dep array treats them as unchanged.  Whenever you add a new
 * geometry-affecting setting, list it in EVERY signature whose builder reads
 * it — otherwise the corresponding preview will silently go stale.
 */
export function getOuterShellSig(s: FidgetSettings): string {
  return [
    s.shellSolidFloor, s.shellSwitchHousing, s.shellWallExtension,
    s.keycapPocketDepth, s.insetAmount, s.keycapSize,
    s.pinHolesEnabled, s.pinHoleRadius, s.pinHoleDepth,
    s.bossDiameter, s.bossHeight, s.bossFloorGap,
    s.crossSize, s.crossDepth, s.crossArmWidth,
    s.pocketOffsetX, s.pocketOffsetY,
    s.mirrorShell, s.clearanceMm,
    s.swapCutouts, s.clickerSquareSize,
    s.targetSizeMm, s.lockDimension,
    s.housingsEnabled ?? true,
  ].join("|");
}

export function getInnerClickerSig(s: FidgetSettings): string {
  return [
    s.insetAmount, s.keycapPocketDepth,
    s.clickerTotalDepth, s.clickerFloorDepth,
    s.clickerSquareSize, s.clickerSquareDepth,
    s.bossDiameter, s.bossHeight, s.bossFloorGap,
    s.crossSize, s.crossDepth, s.crossArmWidth,
    s.swapCutouts, s.pinHolesEnabled, s.pinHoleRadius, s.pinHoleDepth,
    s.pocketOffsetX, s.pocketOffsetY,
    s.mirrorClicker, s.clearanceMm,
    s.targetSizeMm, s.lockDimension,
    s.housingsEnabled ?? true,
    s.magnetHoleEnabled ?? false, s.magnetDiameter, s.magnetDepth,
  ].join("|");
}

export function getColorLayerSig(s: FidgetSettings): string {
  return [
    s.colorLayerThickness, s.mirrorShell,
    s.targetSizeMm, s.lockDimension,
  ].join("|");
}

export function getKeyRingSig(s: FidgetSettings): string {
  return [
    s.keyRingEnabled, s.keyRingOuterDiameter,
    s.keyRingHoleDiameter, s.keyRingThickness,
    s.keyRingNudgeX ?? DEFAULT_SETTINGS.keyRingNudgeX,
    s.keyRingNudgeY ?? DEFAULT_SETTINGS.keyRingNudgeY,
    s.keyRingNudgeZ ?? DEFAULT_SETTINGS.keyRingNudgeZ,
    s.keyRingPosition ?? "top",
    s.keyRingOnClicker ?? false,
    s.keyRingOnShell ?? true,
  ].join("|");
}

export function getValidateSig(s: FidgetSettings): string {
  return [
    s.insetAmount, s.keycapSize, s.clickerSquareSize,
    s.bossDiameter, s.clearanceMm,
    s.mirrorShell,
    s.targetSizeMm, s.lockDimension,
    s.housingsEnabled ?? true,
  ].join("|");
}

/** Derived total outer shell depth = solid floor + switch housing + wall extension. */
export function getShellTotalDepth(settings: Pick<FidgetSettings, "shellSolidFloor" | "shellSwitchHousing" | "shellWallExtension">): number {
  const floor   = settings.shellSolidFloor   ?? DEFAULT_SETTINGS.shellSolidFloor;
  const housing = settings.shellSwitchHousing ?? DEFAULT_SETTINGS.shellSwitchHousing;
  const ext     = settings.shellWallExtension ?? DEFAULT_SETTINGS.shellWallExtension;
  return floor + housing + ext;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function createOuterShellGeometries(
  svgShapes: THREE.Shape[],
  settings: FidgetSettings,
  svgWidth: number,
  svgHeight: number
): OuterShellGeometries {
  const { scale } = computeScale(settings, svgWidth, svgHeight);

  const baseShape = svgShapes.length > 0 ? svgShapes[0] : createDefaultShape(40);
  const { keycapSize, pinHolesEnabled } = settings;
  const housingsEnabled = settings.housingsEnabled ?? true;

  // Resolve the three additive depth components (with migration fallbacks).
  const shellSolidFloor   = settings.shellSolidFloor   ?? DEFAULT_SETTINGS.shellSolidFloor;
  const shellSwitchHousing = settings.shellSwitchHousing ?? DEFAULT_SETTINGS.shellSwitchHousing;
  const shellWallExtension = settings.shellWallExtension ?? DEFAULT_SETTINGS.shellWallExtension;

  const totalDepth = shellSolidFloor + shellSwitchHousing + shellWallExtension;
  const floorDepth = shellSolidFloor; // explicit solid floor — no longer derived

  const keycapPocketDepth = settings.keycapPocketDepth ?? DEFAULT_SETTINGS.keycapPocketDepth;
  const insetAmount      = settings.insetAmount      ?? DEFAULT_SETTINGS.insetAmount;
  const pinHoleRadius    = settings.pinHoleRadius    ?? DEFAULT_SETTINGS.pinHoleRadius;
  const pinHoleDepth     = settings.pinHoleDepth     ?? DEFAULT_SETTINGS.pinHoleDepth;
  // In clicker mode the clicker stays locked to the SVG's chosen dimension;
  // clearance is handled by the shell pocket.
  const CLEARANCE = settings.clearanceMm ?? DEFAULT_SETTINGS.clearanceMm;

  const swapCutouts = settings.swapCutouts ?? false;

  const pocketDepth = Math.min(keycapPocketDepth, shellSwitchHousing);
  // In swap mode — or when all mechanism geometry is disabled — the shell
  // carries no separate pin-hole sub-section, so the walls fill the full
  // pocketDepth contiguously and no void layer is left.
  const pinDepth    = (swapCutouts || !housingsEnabled)
    ? 0
    : (pinHolesEnabled ? Math.min(pinHoleDepth, pocketDepth - 1) : 0);
  const squareDepth = pocketDepth - pinDepth;

  const mirrorShell = settings.mirrorShell ?? false;

  // ── Transform SVG path to world-space mm coords ─────────────────────────
  const svgShape = transformToMm(baseShape, scale, svgWidth, svgHeight, mirrorShell);

  // ── Derive outer + inner wall boundaries ────────────────────────────────
  // SVG = clicker body. Pocket = SVG + clearance. Outer wall = pocket + wall thickness.
  // Use Clipper-based offsetShapeOutward for both steps — it correctly handles the
  // CW winding that transformToMm produces (SVGLoader CCW-in-Y-down → CW-in-Y-up).
  const innerShape = offsetShapeOutward(cloneShape(svgShape), CLEARANCE) ?? cloneShape(svgShape);
  const outerShape = offsetShapeOutward(innerShape, insetAmount) ?? cloneShape(innerShape);

  // ── 1. Outer wall ring ──────────────────────────────────────────────────
  const ringShape = cloneShape(outerShape);
  // getPoints(128) returns 129 pts; the last duplicates the first for closed shapes.
  // That zero-length closing edge creates a degenerate triangle in ExtrudeGeometry
  // which renders as a visible spike.  Strip it before pushing the hole.
  const innerPts = innerShape.getPoints(128);
  const innerHolePts = innerPts[innerPts.length - 1].distanceTo(innerPts[0]) < 1e-6
    ? innerPts.slice(0, -1)
    : innerPts;
  ringShape.holes.push(new THREE.Path(innerHolePts));
  const shellStats: GeoStat[] = [];
  const outerWallGeo = extrudeShape(ringShape, totalDepth, "shell/outerWall", shellStats);

  // Extension-only ring — same cross-section, extruded only for the wall-extension
  // height, positioned at the top of the housing region.  Used exclusively for
  // the highlight overlay so the "Wall extension" slider lights up only its zone.
  const extRingShape = cloneShape(outerShape);
  extRingShape.holes.push(new THREE.Path(innerHolePts));
  const outerWallExtensionGeo = shellWallExtension > 0
    ? extrudeShape(extRingShape, shellWallExtension, "shell/outerWallExtension", shellStats)
    : extrudeShape(extRingShape, 0.01, "shell/outerWallExtension", shellStats); // degenerate but non-null

  // ── 2. Solid floor — never penetrated ──────────────────────────────────
  const floorShape = cloneShape(innerShape);
  const innerFillFloorGeo = extrudeShape(floorShape, floorDepth, "shell/innerFloor", shellStats);

  // Negate X offset when the shell is mirrored: transformToMm has already
  // flipped the SVG's X axis, so the pocket nudge must follow that flip.
  const ox = (settings.pocketOffsetX ?? 0) * (mirrorShell ? -1 : 1);
  const oy = settings.pocketOffsetY ?? 0;

  // ── 3. MX pin-hole section (deepest part of pocket) ────────────────────
  let innerFillPinSectionGeo: THREE.BufferGeometry | null = null;
  if (!swapCutouts && pinHolesEnabled && pinDepth > 0 && housingsEnabled) {
    const pinShape = cloneShape(innerShape);
    addMXPinHoles(pinShape, pinHoleRadius, ox, oy);
    innerFillPinSectionGeo = extrudeShape(pinShape, pinDepth, "shell/pinSection", shellStats);
  }

  // ── 4. Pocket walls — keycap square (default) or switch cavity + boss (swap) ─
  let innerFillWallsGeo: THREE.BufferGeometry;
  let shellBossBaseGeo: THREE.BufferGeometry | null = null;
  let shellBossMainGeo: THREE.BufferGeometry | null = null;
  let shellBossBaseHeight = 0;
  let shellBossBaseZ = 0;
  let shellBossMainZ = 0;
  if (swapCutouts) {
    // Mirror the inner clicker's default switch-cavity-with-boss arrangement:
    // a square switch-housing pocket cut through the full pocketDepth, with a
    // cylindrical boss (cross pocket cut into its top) sitting inside it.
    const clickerSquareSize = settings.clickerSquareSize ?? DEFAULT_SETTINGS.clickerSquareSize;
    const wallsShape = cloneShape(innerShape);
    if (housingsEnabled) addSquareHole(wallsShape, clickerSquareSize, ox, oy);
    innerFillWallsGeo = extrudeShape(wallsShape, squareDepth, "shell/swapCavity", shellStats);

    if (housingsEnabled) {
      // Boss assembly — solid base + main shell with cross pocket through the top.
      const bossDiameter   = settings.bossDiameter   ?? DEFAULT_SETTINGS.bossDiameter;
      const bossHeight     = settings.bossHeight     ?? DEFAULT_SETTINGS.bossHeight;
      const bossFloorGap   = settings.bossFloorGap   ?? DEFAULT_SETTINGS.bossFloorGap;
      const crossSize      = settings.crossSize      ?? DEFAULT_SETTINGS.crossSize;
      const crossDepth     = settings.crossDepth     ?? DEFAULT_SETTINGS.crossDepth;
      const crossArmWidth  = settings.crossArmWidth  ?? DEFAULT_SETTINGS.crossArmWidth;
      const bossRadius     = bossDiameter / 2;
      shellBossBaseHeight  = Math.max(bossHeight - crossDepth, 0.05);
      const bossCrossDepth = bossHeight - shellBossBaseHeight;

      const bossBaseShape = makeCircleShape(bossRadius, 64, ox, oy);
      shellBossBaseGeo = extrudeShape(bossBaseShape, shellBossBaseHeight, "shell/swapBossBase", shellStats);

      const bossMainShape = makeCircleShape(bossRadius, 64, ox, oy);
      addCrossHole(bossMainShape, crossSize, crossArmWidth, ox, oy);
      shellBossMainGeo = extrudeShape(bossMainShape, bossCrossDepth, "shell/swapBossMain", shellStats);

      // Anchor the boss inside the pocket: floor → bossFloorGap → boss base → boss main.
      shellBossBaseZ = floorDepth + bossFloorGap;
      shellBossMainZ = shellBossBaseZ + shellBossBaseHeight;
    }
  } else {
    const wallsShape = cloneShape(innerShape);
    if (housingsEnabled) addSquareHole(wallsShape, keycapSize, ox, oy);
    innerFillWallsGeo = extrudeShape(wallsShape, squareDepth, "shell/keycapWalls", shellStats);
  }

  // ── 5. Housing cap — solid section above pocket, up to shellSwitchHousing ─
  // Guarantees the full housing region is always modelled, even when
  // keycapPocketDepth < shellSwitchHousing.
  const housingCapDepth = shellSwitchHousing - pocketDepth;
  let innerFillHousingCapGeo: THREE.BufferGeometry | null = null;
  if (housingCapDepth > 1e-4) {
    const capShape = cloneShape(innerShape);
    innerFillHousingCapGeo = extrudeShape(capShape, housingCapDepth, "shell/housingCap", shellStats);
  }

  const housingDepth = shellSolidFloor + shellSwitchHousing;
  return {
    outerWall: outerWallGeo,
    outerWallExtension: outerWallExtensionGeo,
    innerFillFloor: innerFillFloorGeo,
    innerFillPinSection: innerFillPinSectionGeo,
    innerFillWalls: innerFillWallsGeo,
    innerFillHousingCap: innerFillHousingCapGeo,
    bossBase: shellBossBaseGeo,
    bossMain: shellBossMainGeo,
    zOffsets: {
      outerWall: 0,
      outerWallExtension: housingDepth,
      innerFillFloor: 0,
      innerFillPinSection: floorDepth,
      innerFillWalls: floorDepth + pinDepth,
      innerFillHousingCap: floorDepth + pocketDepth,
      bossBase: shellBossBaseZ,
      bossMain: shellBossMainZ,
    },
    bossBaseHeight: shellBossBaseHeight,
    floorDepth,
    // Outer wall's OUTER boundary — the true physical footprint of the shell.
    bounds: boundingBoxMm(outerShape),
  };
}

/**
 * Build the optional key-ring lug geometry: a solid cylinder with a concentric
 * through-hole, extruded the same depth as the outer shell.  Position the
 * returned mesh at `{x, y}` (in shell-local mm coords) and z=0; it will sit
 * straddling the top edge of the shell's bounding box.
 *
 * Inner clicker is intentionally untouched.
 */
export interface KeyRingGeometryResult {
  geometry: THREE.BufferGeometry;
  position: { x: number; y: number; z: number };
}

export function createKeyRingGeometry(
  outerShellBounds: { w: number; h: number },
  settings: FidgetSettings
): KeyRingGeometryResult {
  const outer = settings.keyRingOuterDiameter ?? DEFAULT_SETTINGS.keyRingOuterDiameter;
  const holeRequested = settings.keyRingHoleDiameter ?? DEFAULT_SETTINGS.keyRingHoleDiameter;
  // Cap hole so it stays strictly smaller than the cylinder (leave ≥0.4 mm wall).
  const hole = Math.min(holeRequested, Math.max(0, outer - 0.8));
  const outerR = outer / 2;
  const holeR  = Math.max(0, hole / 2);

  const ring = new THREE.Shape();
  const SEG = 64;
  for (let i = 0; i < SEG; i++) {
    const a = (i / SEG) * Math.PI * 2;
    const x = Math.cos(a) * outerR;
    const y = Math.sin(a) * outerR;
    if (i === 0) ring.moveTo(x, y); else ring.lineTo(x, y);
  }

  if (holeR > 0) {
    const holePath = new THREE.Path();
    for (let i = 0; i < SEG; i++) {
      // Wind hole CW (opposite of outer CCW) so ExtrudeGeometry treats it as a hole.
      const a = -(i / SEG) * Math.PI * 2;
      const x = Math.cos(a) * holeR;
      const y = Math.sin(a) * holeR;
      if (i === 0) holePath.moveTo(x, y); else holePath.lineTo(x, y);
    }
    ring.holes.push(holePath);
  }

  const thickness = Math.max(
    0.1,
    settings.keyRingThickness ?? DEFAULT_SETTINGS.keyRingThickness
  );
  const geometry = new THREE.ExtrudeGeometry(ring, {
    depth: thickness,
    bevelEnabled: false,
  });

  const nudgeX = settings.keyRingNudgeX ?? DEFAULT_SETTINGS.keyRingNudgeX;
  const nudgeY = settings.keyRingNudgeY ?? DEFAULT_SETTINGS.keyRingNudgeY;
  const nudgeZ = settings.keyRingNudgeZ ?? DEFAULT_SETTINGS.keyRingNudgeZ;
  const yAnchor = (settings.keyRingPosition ?? "top") === "bottom"
    ? -(outerShellBounds.h / 2)
    :   outerShellBounds.h / 2;

  return {
    geometry,
    position: { x: nudgeX, y: yAnchor + nudgeY, z: nudgeZ },
  };
}

/**
 * Build per-color flat extruded slab geometries for the live preview and
 * the color-layer export pipeline.  Each region's shapes are transformed to
 * mm using the same `transformToMm` logic as the shell, then extruded from
 * z=0 upward to `colorLayerThickness` (no z bump — the geometry is flush
 * with the shell's bottom face; preview-only anti-flicker offsets are
 * applied at the mesh level by the renderer, never baked into geometry).
 */
export function createColorLayerGeometries(
  colorRegions: Array<{ color: string; shapes: THREE.Shape[] }>,
  settings: FidgetSettings,
  svgWidth: number,
  svgHeight: number,
): Array<{ color: string; geometry: THREE.BufferGeometry }> {
  if (colorRegions.length === 0) return [];

  const { scale } = computeScale(settings, svgWidth, svgHeight);
  const thickness = Math.max(
    0.01,
    settings.colorLayerThickness ?? DEFAULT_SETTINGS.colorLayerThickness,
  );
  // Match the shell's mirroring so color regions stay aligned with the shell.
  const mirror = settings.mirrorShell ?? false;

  const out: Array<{ color: string; geometry: THREE.BufferGeometry }> = [];
  for (const region of colorRegions) {
    const geos: THREE.BufferGeometry[] = [];
    for (const shape of region.shapes) {
      const transformed = transformToMm(shape, scale, svgWidth, svgHeight, mirror);
      const geo = new THREE.ExtrudeGeometry(transformed, {
        depth: thickness,
        bevelEnabled: false,
      });
      geos.push(geo.index ? geo.toNonIndexed() : geo);
    }
    if (geos.length === 0) continue;
    const merged =
      geos.length === 1
        ? geos[0]
        : (mergeGeometriesSafe(geos) ?? geos[0]);
    out.push({ color: region.color, geometry: merged });
  }
  return out;
}

/** Concat several non-indexed BufferGeometries by manually merging position+normal+uv. */
function mergeGeometriesSafe(geos: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  if (geos.length === 0) return null;
  let totalPos = 0, totalNorm = 0, totalUv = 0;
  for (const g of geos) {
    totalPos  += g.attributes.position?.count ?? 0;
    totalNorm += g.attributes.normal?.count   ?? 0;
    totalUv   += g.attributes.uv?.count       ?? 0;
  }
  const pos  = new Float32Array(totalPos * 3);
  const norm = totalNorm > 0 ? new Float32Array(totalNorm * 3) : null;
  const uv   = totalUv   > 0 ? new Float32Array(totalUv   * 2) : null;
  let pOff = 0, nOff = 0, uOff = 0;
  for (const g of geos) {
    const p = g.attributes.position;
    if (p) { pos.set(p.array as Float32Array, pOff); pOff += p.array.length; }
    const n = g.attributes.normal;
    if (n && norm) { norm.set(n.array as Float32Array, nOff); nOff += n.array.length; }
    const u = g.attributes.uv;
    if (u && uv)   { uv.set(u.array as Float32Array, uOff);   uOff += u.array.length; }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  if (norm) out.setAttribute("normal", new THREE.BufferAttribute(norm, 3));
  if (uv)   out.setAttribute("uv",     new THREE.BufferAttribute(uv,   2));
  return out;
}

/** Build a circle THREE.Shape at (cx, cy). cx/cy default to 0 for backward compat. */
function makeCircleShape(radius: number, segments = 64, cx = 0, cy = 0): THREE.Shape {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    pts.push(new THREE.Vector2(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius));
  }
  const shape = new THREE.Shape();
  shape.setFromPoints(pts);
  return shape;
}

/**
 * Punch a Cherry-MX-style plus/cross pocket into a THREE.Shape as a hole.
 *
 * Uses moveTo/lineTo/closePath (the same pattern as addSquareHole) so the
 * hole path is properly closed before earcut triangulation.
 *
 * Vertices are wound CW — correct for a hole whose outer shape is CCW.
 *
 * @param totalSize  Overall bounding box of the cross (mm), e.g. 4.18.
 * @param armWidth   Width of each arm of the cross (mm), e.g. 1.31.
 */
function addCrossHole(shape: THREE.Shape, totalSize: number, armWidth: number, cx = 0, cy = 0): void {
  const h = totalSize / 2;
  const a = armWidth  / 2;
  const hole = new THREE.Path();
  hole.moveTo(cx - a, cy + h);
  hole.lineTo(cx + a, cy + h);
  hole.lineTo(cx + a, cy + a);
  hole.lineTo(cx + h, cy + a);
  hole.lineTo(cx + h, cy - a);
  hole.lineTo(cx + a, cy - a);
  hole.lineTo(cx + a, cy - h);
  hole.lineTo(cx - a, cy - h);
  hole.lineTo(cx - a, cy - a);
  hole.lineTo(cx - h, cy - a);
  hole.lineTo(cx - h, cy + a);
  hole.lineTo(cx - a, cy + a);
  // No closePath() — same reason as addSquareHole: closePath() appends a
  // closing LineCurve that causes a degenerate side face in ExtrudeGeometry.
  shape.holes.push(hole);
}

export function createInnerClickerGeometries(
  svgShapes: THREE.Shape[],
  settings: FidgetSettings,
  svgWidth: number,
  svgHeight: number
): InnerClickerGeometries {
  const { scale } = computeScale(settings, svgWidth, svgHeight);

  const baseShape = svgShapes.length > 0 ? svgShapes[0] : createDefaultShape(40);
  const keycapPocketDepth = settings.keycapPocketDepth ?? DEFAULT_SETTINGS.keycapPocketDepth;
  const clickerTotalDepth  = settings.clickerTotalDepth  ?? DEFAULT_SETTINGS.clickerTotalDepth;
  const clickerFloorDepth  = settings.clickerFloorDepth  ?? DEFAULT_SETTINGS.clickerFloorDepth;
  const clickerSquareSize  = settings.clickerSquareSize  ?? DEFAULT_SETTINGS.clickerSquareSize;
  const clickerSquareDepth = settings.clickerSquareDepth ?? DEFAULT_SETTINGS.clickerSquareDepth;
  const bossDiameter       = settings.bossDiameter       ?? DEFAULT_SETTINGS.bossDiameter;
  const bossHeight         = settings.bossHeight         ?? DEFAULT_SETTINGS.bossHeight;
  const bossFloorGap       = settings.bossFloorGap       ?? DEFAULT_SETTINGS.bossFloorGap;
  const swapCutouts        = settings.swapCutouts        ?? false;
  const pinHolesEnabled    = settings.pinHolesEnabled    ?? false;
  const pinHoleRadius      = settings.pinHoleRadius      ?? DEFAULT_SETTINGS.pinHoleRadius;
  const pinHoleDepth       = settings.pinHoleDepth       ?? DEFAULT_SETTINGS.pinHoleDepth;
  const housingsEnabled    = settings.housingsEnabled    ?? true;

  const mirrorClicker = settings.mirrorClicker ?? false;
  const svgShape = transformToMm(baseShape, scale, svgWidth, svgHeight, mirrorClicker);

  // SVG is always the clicker body.
  const clickerShape: THREE.Shape = cloneShape(svgShape);

  // 0.01 mm outward bleed on the floor so it overlaps the walls section
  // by a tiny amount, preventing the coincident-face gap that slicers mistake
  // for separate bodies and leave as an artefact between layers.
  const FLOOR_BLEED = 0.01;

  // Negate X offset when the clicker is mirrored: same reasoning as the shell.
  const ox = (settings.pocketOffsetX ?? 0) * (mirrorClicker ? -1 : 1);
  const oy = settings.pocketOffsetY ?? 0;

  // Solid floor — expanded outward by FLOOR_BLEED to close the slicer gap
  const clickerStats: GeoStat[] = [];
  const floorShape = expandShapeOutward(cloneShape(clickerShape), FLOOR_BLEED);
  const floorGeo = extrudeShape(floorShape, clickerFloorDepth, "clicker/floor", clickerStats);

  // Default mode: walls = full clickerSquareDepth with square hole.
  // Swap mode:    walls = upper part (clickerSquareDepth − pinSectionDepth) with
  //               square hole, and an optional separate pin section sitting
  //               below it (when pinHolesEnabled).
  // When housings are disabled there is no pin-hole sub-section, so wallsDepth
  // equals the full clickerSquareDepth and no void layer is left below the walls.
  const pinSectionDepth = (swapCutouts && pinHolesEnabled && housingsEnabled)
    ? Math.min(pinHoleDepth, Math.max(0, clickerSquareDepth - 1))
    : 0;
  
  let wallsDepth = clickerSquareDepth - pinSectionDepth;

  const magnetHoleEnabled = settings.magnetHoleEnabled ?? false;
  const magnetDiameter    = settings.magnetDiameter ?? DEFAULT_SETTINGS.magnetDiameter;
  const magnetDepth       = settings.magnetDepth ?? DEFAULT_SETTINGS.magnetDepth;

  let magnetSectionDepth = 0;
  let magnetGeo: THREE.BufferGeometry | null = null;
  
  if (magnetHoleEnabled) {
    // Magnet section eats into wallsDepth from the top
    magnetSectionDepth = Math.min(magnetDepth, Math.max(0, wallsDepth));
    wallsDepth -= magnetSectionDepth;

    if (magnetSectionDepth > 0) {
      const magnetShape = cloneShape(clickerShape);
      addCircleHole(magnetShape, magnetDiameter / 2, ox, oy);
      magnetGeo = extrudeShape(magnetShape, magnetSectionDepth, "clicker/magnet", clickerStats);
    }
  }

  // Middle section (or full upper section if no magnet) — solid walls (with switch cavity if enabled)
  let wallsGeo: THREE.BufferGeometry | null = null;
  if (wallsDepth > 0) {
    const wallsShape = cloneShape(clickerShape);
    if (housingsEnabled) addSquareHole(wallsShape, clickerSquareSize, ox, oy);
    wallsGeo = extrudeShape(wallsShape, wallsDepth, "clicker/walls", clickerStats);
  }

  // Lower pin-hole section (swap mode only) — sits between floor and walls,
  // mirroring the layering pattern the shell uses in default mode.
  let pinSectionGeo: THREE.BufferGeometry | null = null;
  if (pinSectionDepth > 0 && housingsEnabled) {
    const pinShape = cloneShape(clickerShape);
    addMXPinHoles(pinShape, pinHoleRadius, ox, oy);
    pinSectionGeo = extrudeShape(pinShape, pinSectionDepth, "clicker/pinSection", clickerStats);
  }

  // ── Actuator boss with MX cross pocket (default mode only) ──────────────
  const crossSize      = settings.crossSize      ?? DEFAULT_SETTINGS.crossSize;
  const crossDepth     = settings.crossDepth     ?? DEFAULT_SETTINGS.crossDepth;
  const crossArmWidth  = settings.crossArmWidth  ?? DEFAULT_SETTINGS.crossArmWidth;

  // The solid base sits below the cross pocket so the pocket has a closed floor.
  const bossBaseHeight = Math.max(bossHeight - crossDepth, 0.05);
  const bossCrossDepth = bossHeight - bossBaseHeight; // actual pocket depth

  let bossBaseGeo: THREE.BufferGeometry | null = null;
  let bossMainGeo: THREE.BufferGeometry | null = null;
  if (!swapCutouts && housingsEnabled) {
    const bossRadius = bossDiameter / 2;
    // Boss is offset by (ox, oy) so it stays centred on the switch cavity.
    const bossBaseShape = makeCircleShape(bossRadius, 64, ox, oy);
    bossBaseGeo = extrudeShape(bossBaseShape, bossBaseHeight, "clicker/bossBase", clickerStats);

    // Main section: circle with MX cross pocket cut through from top to bottom
    const bossMainShape = makeCircleShape(bossRadius, 64, ox, oy);
    addCrossHole(bossMainShape, crossSize, crossArmWidth, ox, oy);
    bossMainGeo = extrudeShape(bossMainShape, bossCrossDepth, "clicker/bossMain", clickerStats);
  }

  console.log("[fidget-geo] CLICKER", clickerStats.map(s =>
    `${s.label}:${s.nanCount + s.spikeCount > 0 ? "SPIKE!" : "ok"} v=${s.verts} maxXY=(${s.maxX.toFixed(1)},${s.maxY.toFixed(1)})${s.firstSpike ? " first="+s.firstSpike : ""}`
  ).join(" | "));

  return {
    floor: floorGeo,
    walls: wallsGeo!, // Guaranteed to be created if clickerSquareDepth > pinSectionDepth + magnetSectionDepth
    bossBase: bossBaseGeo,
    bossMain: bossMainGeo,
    pinSection: pinSectionGeo,
    pinSectionDepth,
    magnetSection: magnetGeo,
    magnetSectionDepth,
    clickerTotalDepth,
    clickerFloorDepth,
    bossFloorGap,
    bossHeight,
    bossBaseHeight,
    // Clicker's outer boundary — smaller than shell by insetAmount + clearance.
    bounds: boundingBoxMm(clickerShape),
  };
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/**
 * Transform an SVG-space THREE.Shape into world-space millimetre coordinates.
 * - Scales by `scale` (px → mm).
 * - Re-centres so the shape is centred on the origin.
 * - Flips Y axis (SVG Y-down → Three.js Y-up).
 * - Optionally mirrors left-right (negates X, then reverses winding so
 *   ExtrudeGeometry still sees a CCW outer boundary).
 * - Discretises curves to 128 points for high-fidelity offset computation.
 */
function transformToMm(
  shape: THREE.Shape,
  scale: number,
  svgWidth: number,
  svgHeight: number,
  mirrorX = false
): THREE.Shape {
  const cx = (svgWidth  * scale) / 2;
  const cy = (svgHeight * scale) / 2;
  // getPoints(n) returns n+1 samples including the closing t=1 point.
  // For a closed THREE.Shape t=1 equals t=0, so we take only the first n
  // samples (slice off the last) to avoid a degenerate zero-length closing
  // edge that would corrupt the polygon-offset computation.
  const raw = shape.getPoints(128); // 129 points, last ≈ first for closed paths
  let pts = raw.slice(0, raw.length - 1).map(
    (p: THREE.Vector2) => new THREE.Vector2(
      mirrorX ? -(p.x * scale - cx) : (p.x * scale - cx),
      -(p.y * scale - cy)
    )
  );
  // Negating X reverses the polygon winding (CCW → CW).  Reversing the point
  // order restores CCW so ExtrudeGeometry produces outward-facing normals.
  if (mirrorX) pts = pts.reverse();
  const out = new THREE.Shape();
  out.setFromPoints(pts);
  return out;
}

/**
 * Compute the true inward offset of a THREE.Shape.
 * Returns a new THREE.Shape whose boundary is everywhere exactly
 * `offsetMm` mm inward from the input boundary, or null if the shape
 * is too small to offset (would collapse to nothing).
 */
function offsetShapeInward(shape: THREE.Shape, offsetMm: number): THREE.Shape | null {
  const pts = shape.getPoints(128);
  const contours = insetPolygon(pts, offsetMm);
  if (contours.length === 0) return null;

  // If there are multiple contours (very rare — only in extreme concavities
  // that split the shape), use the largest one.
  const largest = contours.sort(
    (a, b) => polygonArea(b) - polygonArea(a)
  )[0];

  if (largest.length < 3) return null;

  const result = new THREE.Shape();
  result.setFromPoints(largest);
  return result;
}

/**
 * Expand a THREE.Shape outward by `offsetMm` using the proper parallel-curve
 * algorithm with self-intersection removal.  Concave shapes that would produce
 * crossing walls with a naive miter join are handled correctly.
 *
 * Returns null only if the polygon is degenerate (fewer than 3 distinct pts).
 */
function offsetShapeOutward(shape: THREE.Shape, offsetMm: number): THREE.Shape | null {
  if (offsetMm <= 0) return cloneShape(shape);
  const pts = shape.getPoints(128);
  const contours = outsetPolygon(pts, offsetMm);
  if (contours.length === 0) return null;

  // Pick the largest contour (outset should always produce exactly one)
  const largest = contours.sort(
    (a, b) => polygonArea(b) - polygonArea(a)
  )[0];
  if (largest.length < 3) return null;

  const result = new THREE.Shape();
  result.setFromPoints(largest);
  return result;
}

/** Unsigned polygon area (for picking the largest contour). */
function polygonArea(pts: THREE.Vector2[]): number {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return Math.abs(area) / 2;
}

/**
 * Shallow-clone a THREE.Shape (copies the outer curve points, drops holes).
 * Strips the closing duplicate that THREE.Shape.getPoints(n) appends for
 * closed paths — the duplicate creates a zero-length degenerate edge which
 * ExtrudeGeometry turns into a NaN-normal triangle and a visible streak.
 */
function cloneShape(shape: THREE.Shape): THREE.Shape {
  const raw = shape.getPoints(128); // n+1 pts; last ≈ first for closed shapes
  // A valid closed polygon needs at least 3 distinct vertices.
  // If the shape is degenerate (empty SVG, single point, collapsed offset)
  // fall back to a small circle so downstream geometry never crashes.
  if (raw.length < 3) return createDefaultShape(4);
  const first = raw[0];
  const last  = raw[raw.length - 1];
  const pts = last.distanceTo(first) < 1e-6 ? raw.slice(0, -1) : raw;
  if (pts.length < 3) return createDefaultShape(4);
  const s = new THREE.Shape();
  s.setFromPoints(pts);
  return s;
}

/**
 * Return a new THREE.Shape whose boundary is expanded outward by `amountMm`
 * using a true edge-normal parallel offset (every edge shifted outward by the
 * same perpendicular distance).  Used for the clicker floor so it overlaps the
 * walls section by a hair and eliminates the coincident-face slicer gap.
 */
function expandShapeOutward(shape: THREE.Shape, amountMm: number): THREE.Shape {
  // Sample the boundary and strip the closing duplicate only when the last
  // point is actually a duplicate of the first (autoClose=true shapes from
  // SVGLoader).  Shapes built via setFromPoints() have autoClose=false and
  // getPoints() returns exactly N distinct vertices — stripping
  // unconditionally would remove a real corner and produce a missing facet.
  const raw = shape.getPoints(128);
  const first = raw[0];
  const last  = raw[raw.length - 1];
  let pts = (first && last && last.distanceTo(first) < 1e-6)
    ? raw.slice(0, -1)
    : raw;
  if (pts.length < 3) return shape;

  const n = pts.length;

  // Compute outward-shifted parallel edges (for CCW polygon, outward normal of
  // edge a→b is (+ey, -ex)/|e|, the opposite of the inward normal used by insetPolygon)
  interface ShiftedEdge { px: number; py: number; dx: number; dy: number }
  // Detect winding: positive signed area = CCW (Y-up), negative = CW.
  // Shapes from transformToMm are CW (SVGLoader CCW-in-Y-down → CW-in-Y-up after Y-negation).
  // Outward normal: right perpendicular (+ey, -ex) for CCW; left (-ey, +ex) for CW.
  let winding = 0;
  for (let i = 0; i < n; i++) {
    const q = pts[(i + 1) % n];
    winding += pts[i].x * q.y - q.x * pts[i].y;
  }
  const isCCW = winding > 0;

  const edges: ShiftedEdge[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const ex = b.x - a.x, ey = b.y - a.y;
    const len = Math.hypot(ex, ey);
    if (len < 1e-10) continue;
    const nx = isCCW ?  ey / len : -ey / len;
    const ny = isCCW ? -ex / len :  ex / len;
    edges.push({ px: a.x + nx * amountMm, py: a.y + ny * amountMm, dx: ex / len, dy: ey / len });
  }

  if (edges.length < 3) return shape;

  // Find intersection of consecutive shifted edges to get new vertices.
  // Miter limit: when two adjacent edges are nearly collinear (common after
  // resampling to 128 pts), their shifted parallels meet very far away.
  // Cap the displacement to prevent spike vertices that render as infinite lines.
  const maxMiter = Math.max(amountMm * 8, 0.5); // generous but finite cap
  const result: THREE.Vector2[] = [];
  for (let i = 0; i < edges.length; i++) {
    const e0 = edges[(i - 1 + edges.length) % edges.length];
    const e1 = edges[i];
    const denom = e0.dx * e1.dy - e0.dy * e1.dx;
    if (Math.abs(denom) < 1e-10) {
      // Parallel edges — use start of outgoing edge (no miter needed)
      result.push(new THREE.Vector2(e1.px, e1.py));
    } else {
      const t = ((e1.px - e0.px) * e1.dy - (e1.py - e0.py) * e1.dx) / denom;
      const ix = e0.px + t * e0.dx;
      const iy = e0.py + t * e0.dy;
      // Miter limit: clamp spikes caused by near-collinear resampled points
      const dist = Math.hypot(ix - e1.px, iy - e1.py);
      if (dist > maxMiter) {
        result.push(new THREE.Vector2(e1.px, e1.py));
      } else {
        result.push(new THREE.Vector2(ix, iy));
      }
    }
  }

  const out = new THREE.Shape();
  out.setFromPoints(result);
  return out;
}

function computeScale(
  s: Pick<FidgetSettings, "targetSizeMm" | "lockDimension">,
  w: number,
  h: number
): { scale: number } {
  const base = s.lockDimension === "width" ? w : h;
  return { scale: base > 0 ? s.targetSizeMm / base : 1 };
}

/**
 * Compute the auto-centre pocket offset (mm) for a freshly-loaded SVG.
 *
 * The pipeline centres shapes on the origin using the *bounding-box* midpoint,
 * so for symmetric shapes the centroid happens to land at (0, 0) and the
 * default zero nudge is correct.  For asymmetric shapes the centroid of the
 * largest filled region is offset from the bounding-box centre, meaning the
 * pocket ends up visually off-centre without any nudge.
 *
 * This function returns the centroid of shapes[0] (the largest filled region)
 * expressed in world-space mm using the same transform as transformToMm().
 * Applying the result as pocketOffsetX/Y places the switch pocket at the
 * shape's true visual centre of mass with zero user nudge.
 *
 * Only call this on a fresh SVG upload — saved projects carry their own
 * serialised offset and must not be overwritten.
 */
export function computeAutoPocketOffset(
  shapes: THREE.Shape[],
  svgWidth: number,
  svgHeight: number,
  settings: Pick<FidgetSettings, "targetSizeMm" | "lockDimension">
): { x: number; y: number } {
  if (shapes.length === 0) return { x: 0, y: 0 };

  const { scale } = computeScale(settings, svgWidth, svgHeight);

  const shape = shapes[0];
  const raw = shape.getPoints(128);
  if (raw.length < 3) return { x: 0, y: 0 };

  // Strip the closing duplicate point that THREE appends for closed shapes.
  const first = raw[0];
  const last  = raw[raw.length - 1];
  const pts   = last.distanceTo(first) < 1e-10 ? raw.slice(0, -1) : raw;
  const n     = pts.length;
  if (n < 3) return { x: 0, y: 0 };

  // Area-weighted centroid via the shoelace formula (SVG pixel space, Y-down).
  let area = 0;
  let cx   = 0;
  let cy   = 0;
  for (let i = 0; i < n; i++) {
    const j     = (i + 1) % n;
    const cross = pts[i].x * pts[j].y - pts[j].x * pts[i].y;
    area += cross;
    cx   += (pts[i].x + pts[j].x) * cross;
    cy   += (pts[i].y + pts[j].y) * cross;
  }
  area /= 2;
  if (Math.abs(area) < 1e-10) return { x: 0, y: 0 };
  cx /= 6 * area;
  cy /= 6 * area;

  // Apply the same affine transform as transformToMm() (no mirror):
  //   worldX =  px * scale - (svgWidth  * scale / 2)
  //   worldY = -(py * scale - (svgHeight * scale / 2))
  const bbCx = (svgWidth  * scale) / 2;
  const bbCy = (svgHeight * scale) / 2;
  const x    =  cx * scale - bbCx;
  const y    = -(cy * scale - bbCy);

  return { x, y };
}

// ---------------------------------------------------------------------------
// Geometry validation
// ---------------------------------------------------------------------------

export type GeometryWarningSeverity = "error" | "warning";

export interface GeometryWarning {
  part: "shell" | "clicker";
  severity: GeometryWarningSeverity;
  message: string;
}

/**
 * Sample the bounding box (width × height in mm) of a world-space shape.
 * Uses 128 samples — enough resolution for any SVG outline we'll encounter.
 */
function boundingBoxMm(shape: THREE.Shape): { w: number; h: number } {
  const pts = shape.getPoints(128);
  if (pts.length === 0) return { w: 0, h: 0 };
  let minX = pts[0].x, maxX = pts[0].x;
  let minY = pts[0].y, maxY = pts[0].y;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { w: maxX - minX, h: maxY - minY };
}

/**
 * Validate that the current SVG + settings combination won't produce
 * degenerate geometry (features larger than the space available for them).
 *
 * Geometry chain modelled here:
 *   shellOuter  = SVG scaled to targetSizeMm
 *   shellInner  = shellOuter inset by insetAmount   (shell wall thickness)
 *   clickerBody = shellInner deflated by CLEARANCE  (clicker slides into shell)
 *
 *   keycapSize       must fit inside shellInner
 *   clickerSquareSize must fit inside clickerBody
 *   bossDiameter     must fit inside clickerSquareSize
 *
 * Returns an array of warnings/errors, or [] when everything is fine.
 */
export function validateGeometry(
  svgShapes: THREE.Shape[],
  settings: FidgetSettings,
  svgWidth: number,
  svgHeight: number
): GeometryWarning[] {
  if (!svgShapes.length || svgWidth <= 0 || svgHeight <= 0) return [];
  // No mechanism geometry to validate when housings are disabled.
  if (!(settings.housingsEnabled ?? true)) return [];

  const warnings: GeometryWarning[] = [];
  const base = settings.lockDimension === "width" ? svgWidth : svgHeight;
  const scale = base > 0 ? settings.targetSizeMm / base : 1;
  const baseShape = svgShapes[0];

  const keycapSize        = settings.keycapSize        ?? DEFAULT_SETTINGS.keycapSize;
  const clickerSquareSize = settings.clickerSquareSize ?? DEFAULT_SETTINGS.clickerSquareSize;
  const bossDiameter      = settings.bossDiameter      ?? DEFAULT_SETTINGS.bossDiameter;

  // ── Geometry chain ──────────────────────────────────────────────────────
  // SVG = clicker body; shell inner (pocket) = SVG + CLEARANCE; outer wall = pocket + insetAmount.
  // Keycap pocket is cut into shell interior (= SVG boundary).
  // Switch cavity is cut into clicker body (= SVG boundary).
  const svgMm = transformToMm(baseShape, scale, svgWidth, svgHeight, settings.mirrorShell ?? false);
  const { w: svgW, h: svgH } = boundingBoxMm(svgMm);

  // Step 1: keycap pocket must fit inside the shell interior (= SVG).
  if (svgW < keycapSize || svgH < keycapSize) {
    warnings.push({
      part: "shell",
      severity: "error",
      message:
        `Shell interior is ${svgW.toFixed(1)} × ${svgH.toFixed(1)} mm — ` +
        `too small for the ${keycapSize} × ${keycapSize} mm keycap pocket. ` +
        `Increase clicker size or reduce "Keycap square".`,
    });
  }

  // Step 2: switch cavity must fit inside the clicker body (= SVG).
  if (svgW < clickerSquareSize || svgH < clickerSquareSize) {
    warnings.push({
      part: "clicker",
      severity: "error",
      message:
        `Clicker body is ${svgW.toFixed(1)} × ${svgH.toFixed(1)} mm — ` +
        `too small for the ${clickerSquareSize} × ${clickerSquareSize} mm switch cavity. ` +
        `Increase clicker size or reduce "Switch cavity size".`,
    });
  }

  // Step 3: boss diameter vs switch cavity.
  if (bossDiameter > clickerSquareSize) {
    warnings.push({
      part: "clicker",
      severity: "error",
      message:
        `Boss diameter (${bossDiameter.toFixed(2)} mm) exceeds the switch cavity ` +
        `(${clickerSquareSize} × ${clickerSquareSize} mm). Reduce "Boss diameter".`,
    });
  }

  return warnings;
}

/**
 * Punches the Cherry MX 5-pin PCB footprint holes through a shape.
 * Coordinates measured from diagram (Gemini analysis), all units mm.
 *
 *   Center guide pin:    ( 0.00,  0.00)  Ø 4.0 mm (+0.1/-0 tol)  r = 2.00
 *   Right peg:           (+5.08,  0.00)  Ø 1.8 mm                 r = 0.90
 *   Left  peg:           (-5.08,  0.00)  Ø 1.8 mm                 r = 0.90
 *   Upper-right pin:     (+2.54, +5.08)  Ø 1.5 mm                 r = 0.75
 *   Upper-left  pin:     (-3.81, +2.54)  Ø 1.5 mm                 r = 0.75
 *
 * `tolerance` (mm) is added to every radius for FDM over-extrusion compensation.
 */
function addMXPinHoles(shape: THREE.Shape, tolerance: number, cx = 0, cy = 0): void {
  const pins: [number, number, number][] = [
    [  0.00,  0.00, 2.00 ],
    [  5.08,  0.00, 0.90 ],
    [ -5.08,  0.00, 0.90 ],
    [  2.54,  5.08, 0.75 ],
    [ -3.81,  2.54, 0.75 ],
  ];
  const SEG = 32;
  for (const [x, y, r] of pins) {
    // Use explicit circle points instead of absarc(0→2π).
    // absarc creates an EllipseCurve whose getPoints(n) returns n+1 points
    // with the last == first (closing duplicate), producing a degenerate
    // zero-area side face (spike) in ExtrudeGeometry.
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i < SEG; i++) {
      const angle = (i / SEG) * Math.PI * 2;
      pts.push(new THREE.Vector2(cx + x + Math.cos(angle) * (r + tolerance), cy + y + Math.sin(angle) * (r + tolerance)));
    }
    const h = new THREE.Path();
    h.setFromPoints(pts);
    shape.holes.push(h);
  }
}

function addSquareHole(shape: THREE.Shape, size: number, cx = 0, cy = 0): void {
  const half = size / 2;
  const hole = new THREE.Path();
  hole.moveTo(cx - half, cy - half);
  hole.lineTo(cx + half, cy - half);
  hole.lineTo(cx + half, cy + half);
  hole.lineTo(cx - half, cy + half);
  // Do NOT call hole.closePath() — closePath() internally appends a
  // LineCurve back to the moveTo start, so getPoints() returns n+1
  // samples where the last equals the first.  ExtrudeGeometry's
  // sidewalls() then creates a zero-area quad at index 0 → degenerate
  // triangle → NaN normal → visible spike.  Omitting closePath() lets
  // sidewalls() wrap implicitly (k = pts.length-1 when i = 0) with no
  // duplicate vertex, and earcut triangulates the face correctly.
  shape.holes.push(hole);
}

function addCircleHole(shape: THREE.Shape, radius: number, cx = 0, cy = 0): void {
  const SEG = 64;
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i < SEG; i++) {
    const angle = (i / SEG) * Math.PI * 2;
    pts.push(new THREE.Vector2(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius));
  }
  const hole = new THREE.Path();
  hole.setFromPoints(pts);
  shape.holes.push(hole);
}

interface GeoStat {
  label: string;
  verts: number;
  maxX: number; maxY: number; maxZ: number;
  nanCount: number;
  spikeCount: number; // vertices with any coord > SPIKE_THRESHOLD
  firstSpike: string | null;
}

const SPIKE_THRESHOLD = 300; // anything >300 mm is suspicious for a ~50 mm model

function checkGeo(geo: THREE.BufferGeometry, label: string, stats: GeoStat[]): THREE.BufferGeometry {
  const pos = geo.attributes.position;
  const stat: GeoStat = { label, verts: pos?.count ?? 0, maxX: 0, maxY: 0, maxZ: 0, nanCount: 0, spikeCount: 0, firstSpike: null };
  if (pos) {
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      if (!isFinite(x) || !isFinite(y) || !isFinite(z)) {
        stat.nanCount++;
        if (!stat.firstSpike) stat.firstSpike = `v[${i}]=(${x},${y},${z})`;
      } else {
        stat.maxX = Math.max(stat.maxX, Math.abs(x));
        stat.maxY = Math.max(stat.maxY, Math.abs(y));
        stat.maxZ = Math.max(stat.maxZ, Math.abs(z));
        if (Math.abs(x) > SPIKE_THRESHOLD || Math.abs(y) > SPIKE_THRESHOLD || Math.abs(z) > SPIKE_THRESHOLD) {
          stat.spikeCount++;
          if (!stat.firstSpike) stat.firstSpike = `v[${i}]=(${x.toFixed(1)},${y.toFixed(1)},${z.toFixed(1)})`;
        }
      }
    }
  }
  stats.push(stat);
  return geo;
}

function extrudeShape(shape: THREE.Shape, depth: number, label = "?", stats?: GeoStat[]): THREE.BufferGeometry {
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  if (stats) checkGeo(geo, label, stats);
  return geo;
}

function createDefaultShape(size: number): THREE.Shape {
  const s = new THREE.Shape();
  const r = size / 2;
  s.moveTo(-r, -r);
  s.lineTo( r, -r);
  s.lineTo( r,  r);
  s.lineTo(-r,  r);
  s.lineTo(-r, -r);
  return s;
}
