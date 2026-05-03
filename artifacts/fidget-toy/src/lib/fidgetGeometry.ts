import * as THREE from "three";
import { insetPolygon, outsetPolygon } from "./polygonOffset";

export interface FidgetSettings {
  totalDepth: number;          // outer wall total height (mm), e.g. 22
  innerFillDepth: number;      // total inner fill block height (pocket + floor), e.g. 12
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
  // When true the SVG silhouette is used as the inner clicker body and the
  // outer shell is computed by expanding it outward by `insetAmount`.
  svgIsClickerShape: boolean;
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
}

export const DEFAULT_SETTINGS: FidgetSettings = {
  totalDepth: 22,
  innerFillDepth: 12,
  keycapPocketDepth: 10,
  insetAmount: 1.5,
  keycapSize: 14,
  targetSizeMm: 50,
  lockDimension: "width",
  pinHolesEnabled: false,
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
  clearanceMm: 0.3,
  flipShell: false,
  flipClicker: false,
  mirrorShell: false,
  mirrorClicker: false,
  svgIsClickerShape: false,
  shellColor: "#6C63FF",
  clickerColor: "#10B981",
  keyRingEnabled: false,
  keyRingOuterDiameter: 10,
  keyRingHoleDiameter: 5,
  keyRingThickness: 1,
};

/**
 * Pocket cross-section from the CLOSED END (floor surface) upward to the OPENING:
 *
 *   ┌─────────────────────────────┐  ← z = innerFillDepth (pocket opening, faces clicker)
 *   │   keycap square cavity      │  keycapSquareDepth = keycapPocketDepth − pinHoleDepth
 *   │   (14 × 14 mm aperture)     │
 *   ├─────────────────────────────┤  ← z = floorDepth + pinHoleDepth
 *   │   MX pin holes              │  pinHoleDepth  (e.g. 3 mm)
 *   │   (5 cylinders, no square)  │
 *   ├─────────────────────────────┤  ← z = floorDepth (solid floor surface)
 *   │   solid floor               │  floorDepth = innerFillDepth − keycapPocketDepth
 *   └─────────────────────────────┘  ← z = 0  (bottom of toy)
 *
 * Wall geometry uses a true geometric inward offset (not uniform scaling):
 *   Every point on the inner wall boundary is exactly `insetAmount` mm from
 *   the outer SVG path, measured along the local surface normal.
 */
export interface OuterShellGeometries {
  outerWall: THREE.BufferGeometry;
  innerFillFloor: THREE.BufferGeometry;
  /** null when pinHolesEnabled = false */
  innerFillPinSection: THREE.BufferGeometry | null;
  innerFillWalls: THREE.BufferGeometry;
  zOffsets: {
    outerWall: number;
    innerFillFloor: number;
    innerFillPinSection: number;
    innerFillWalls: number;
  };
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
   */
  bossBase: THREE.BufferGeometry;
  /**
   * Main cylindrical shell of the boss with the MX cross pocket cut through
   * it from the top face downward.
   */
  bossMain: THREE.BufferGeometry;
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
  const {
    totalDepth, innerFillDepth,
    keycapSize, pinHolesEnabled,
  } = settings;
  const keycapPocketDepth = settings.keycapPocketDepth ?? DEFAULT_SETTINGS.keycapPocketDepth;
  const insetAmount      = settings.insetAmount      ?? DEFAULT_SETTINGS.insetAmount;
  const pinHoleRadius    = settings.pinHoleRadius    ?? DEFAULT_SETTINGS.pinHoleRadius;
  const pinHoleDepth     = settings.pinHoleDepth     ?? DEFAULT_SETTINGS.pinHoleDepth;
  // In clicker mode the clicker stays locked to the SVG's chosen dimension;
  // clearance is handled by the shell pocket.
  const CLEARANCE = settings.clearanceMm ?? DEFAULT_SETTINGS.clearanceMm;

  const pocketDepth = Math.min(keycapPocketDepth, innerFillDepth - 1);
  const floorDepth  = innerFillDepth - pocketDepth;
  const pinDepth    = pinHolesEnabled ? Math.min(pinHoleDepth, pocketDepth - 1) : 0;
  const squareDepth = pocketDepth - pinDepth;

  const mirrorShell = settings.mirrorShell ?? false;
  const svgIsClickerShape = settings.svgIsClickerShape ?? false;

  // ── Transform SVG path to world-space mm coords ─────────────────────────
  const svgShape = transformToMm(baseShape, scale, svgWidth, svgHeight, mirrorShell);

  // ── Derive outer + inner wall boundaries ───────────────────────────────
  // Normal mode: SVG = outer boundary, inset inward to get inner pocket wall.
  // Clicker mode: SVG = clicker body; shell expands around it.
  let outerShape: THREE.Shape;
  let innerShape: THREE.Shape;

  if (svgIsClickerShape) {
    // Keep the clicker outline exactly on the locked SVG scale.
    innerShape = cloneShape(svgShape);
    const shellExpand = insetAmount + CLEARANCE;
    outerShape =
      offsetShapeOutward(innerShape, shellExpand) ??
      offsetShapeOutward(innerShape, Math.min(shellExpand, 0.8)) ??
      offsetShapeOutward(innerShape, 0.3) ??
      expandShapeOutward(cloneShape(innerShape), shellExpand);
  } else {
    // Normal mode: SVG is the outer wall; inset to get the inner pocket.
    outerShape = cloneShape(svgShape);
    innerShape =
      offsetShapeInward(outerShape, insetAmount) ??
      offsetShapeInward(outerShape, Math.min(insetAmount, 0.8)) ??
      offsetShapeInward(outerShape, 0.3) ??
      cloneShape(outerShape);
  }

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

  // ── 2. Solid floor — never penetrated ──────────────────────────────────
  const floorShape = cloneShape(innerShape);
  const innerFillFloorGeo = extrudeShape(floorShape, floorDepth, "shell/innerFloor", shellStats);

  const ox = settings.pocketOffsetX ?? 0;
  const oy = settings.pocketOffsetY ?? 0;

  // ── 3. MX pin-hole section (deepest part of pocket) ────────────────────
  let innerFillPinSectionGeo: THREE.BufferGeometry | null = null;
  if (pinHolesEnabled && pinDepth > 0) {
    const pinShape = cloneShape(innerShape);
    addMXPinHoles(pinShape, pinHoleRadius, ox, oy);
    innerFillPinSectionGeo = extrudeShape(pinShape, pinDepth, "shell/pinSection", shellStats);
  }

  // ── 4. Keycap square walls (upper / shallower part of pocket) ──────────
  const wallsShape = cloneShape(innerShape);
  addSquareHole(wallsShape, keycapSize, ox, oy);
  const innerFillWallsGeo = extrudeShape(wallsShape, squareDepth, "shell/keycapWalls", shellStats);

  console.log("[fidget-geo] SHELL", shellStats.map(s =>
    `${s.label}:${s.nanCount + s.spikeCount > 0 ? "SPIKE!" : "ok"} v=${s.verts} maxXY=(${s.maxX.toFixed(1)},${s.maxY.toFixed(1)})${s.firstSpike ? " first="+s.firstSpike : ""}`
  ).join(" | "));

  return {
    outerWall: outerWallGeo,
    innerFillFloor: innerFillFloorGeo,
    innerFillPinSection: innerFillPinSectionGeo,
    innerFillWalls: innerFillWallsGeo,
    zOffsets: {
      outerWall: 0,
      innerFillFloor: 0,
      innerFillPinSection: floorDepth,
      innerFillWalls: floorDepth + pinDepth,
    },
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
  position: { x: number; y: number };
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

  return {
    geometry,
    position: { x: 0, y: outerShellBounds.h / 2 },
  };
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
  const insetAmount      = settings.insetAmount      ?? DEFAULT_SETTINGS.insetAmount;
  const keycapPocketDepth = settings.keycapPocketDepth ?? DEFAULT_SETTINGS.keycapPocketDepth;
  const clickerTotalDepth  = settings.clickerTotalDepth  ?? DEFAULT_SETTINGS.clickerTotalDepth;
  const clickerFloorDepth  = settings.clickerFloorDepth  ?? DEFAULT_SETTINGS.clickerFloorDepth;
  const clickerSquareSize  = settings.clickerSquareSize  ?? DEFAULT_SETTINGS.clickerSquareSize;
  const clickerSquareDepth = settings.clickerSquareDepth ?? DEFAULT_SETTINGS.clickerSquareDepth;
  const bossDiameter       = settings.bossDiameter       ?? DEFAULT_SETTINGS.bossDiameter;
  const bossHeight         = settings.bossHeight         ?? DEFAULT_SETTINGS.bossHeight;
  const bossFloorGap       = settings.bossFloorGap       ?? DEFAULT_SETTINGS.bossFloorGap;

  // The clicker's outer boundary is sized so it slides cleanly into the shell
  // pocket without binding. Controlled by the user-facing clearance slider.
  const CLEARANCE = settings.clearanceMm ?? DEFAULT_SETTINGS.clearanceMm;
  const mirrorClicker = settings.mirrorClicker ?? false;
  const svgIsClickerShape = settings.svgIsClickerShape ?? false;
  const svgShape = transformToMm(baseShape, scale, svgWidth, svgHeight, mirrorClicker);

  // Normal mode: SVG = shell outer wall → clicker = SVG − insetAmount − clearance
  // Clicker mode: SVG is already the clicker body.
  const clickerShape: THREE.Shape = svgIsClickerShape
    ? cloneShape(svgShape)
    : (offsetShapeInward(svgShape, insetAmount + CLEARANCE) ??
       offsetShapeInward(svgShape, CLEARANCE) ??
       cloneShape(svgShape));

  // 0.01 mm outward bleed on the floor so it overlaps the walls section
  // by a tiny amount, preventing the coincident-face gap that slicers mistake
  // for separate bodies and leave as an artefact between layers.
  const FLOOR_BLEED = 0.01;

  const ox = settings.pocketOffsetX ?? 0;
  const oy = settings.pocketOffsetY ?? 0;

  // Solid floor — expanded outward by FLOOR_BLEED to close the slicer gap
  const clickerStats: GeoStat[] = [];
  const floorShape = expandShapeOutward(cloneShape(clickerShape), FLOOR_BLEED);
  const floorGeo = extrudeShape(floorShape, clickerFloorDepth, "clicker/floor", clickerStats);
  // Upper section — switch housing cavity cut from the top (original size)
  const wallsShape = cloneShape(clickerShape);
  addSquareHole(wallsShape, clickerSquareSize, ox, oy);
  const wallsGeo = extrudeShape(wallsShape, clickerSquareDepth, "clicker/walls", clickerStats);

  // ── Actuator boss with MX cross pocket ──────────────────────────────────
  const bossRadius     = bossDiameter / 2;
  const crossSize      = settings.crossSize      ?? DEFAULT_SETTINGS.crossSize;
  const crossDepth     = settings.crossDepth     ?? DEFAULT_SETTINGS.crossDepth;
  const crossArmWidth  = settings.crossArmWidth  ?? DEFAULT_SETTINGS.crossArmWidth;

  // The solid base sits below the cross pocket so the pocket has a closed floor.
  const bossBaseHeight = Math.max(bossHeight - crossDepth, 0.05);
  const bossCrossDepth = bossHeight - bossBaseHeight; // actual pocket depth

  // Boss is offset by (ox, oy) so it stays centred on the switch cavity.
  const bossBaseShape = makeCircleShape(bossRadius, 64, ox, oy);
  const bossBaseGeo   = extrudeShape(bossBaseShape, bossBaseHeight, "clicker/bossBase", clickerStats);

  // Main section: circle with MX cross pocket cut through from top to bottom
  const bossMainShape = makeCircleShape(bossRadius, 64, ox, oy);
  addCrossHole(bossMainShape, crossSize, crossArmWidth, ox, oy);
  const bossMainGeo   = extrudeShape(bossMainShape, bossCrossDepth, "clicker/bossMain", clickerStats);

  console.log("[fidget-geo] CLICKER", clickerStats.map(s =>
    `${s.label}:${s.nanCount + s.spikeCount > 0 ? "SPIKE!" : "ok"} v=${s.verts} maxXY=(${s.maxX.toFixed(1)},${s.maxY.toFixed(1)})${s.firstSpike ? " first="+s.firstSpike : ""}`
  ).join(" | "));

  return {
    floor: floorGeo,
    walls: wallsGeo,
    bossBase: bossBaseGeo,
    bossMain: bossMainGeo,
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
  // Sample the boundary and strip the closing duplicate
  const raw = shape.getPoints(128);
  let pts = raw.slice(0, raw.length - 1);
  if (pts.length < 3) return shape;

  const n = pts.length;

  // Compute outward-shifted parallel edges (for CCW polygon, outward normal of
  // edge a→b is (+ey, -ex)/|e|, the opposite of the inward normal used by insetPolygon)
  interface ShiftedEdge { px: number; py: number; dx: number; dy: number }
  const edges: ShiftedEdge[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const ex = b.x - a.x, ey = b.y - a.y;
    const len = Math.hypot(ex, ey);
    if (len < 1e-10) continue;
    // Outward normal for CCW: (+ey, -ex) / len
    const nx =  ey / len;
    const ny = -ex / len;
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

function computeScale(s: FidgetSettings, w: number, h: number): { scale: number } {
  const base = s.lockDimension === "width" ? w : h;
  return { scale: base > 0 ? s.targetSizeMm / base : 1 };
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

  const warnings: GeometryWarning[] = [];
  const base = settings.lockDimension === "width" ? svgWidth : svgHeight;
  const scale = base > 0 ? settings.targetSizeMm / base : 1;
  const baseShape = svgShapes[0];

  const insetAmount       = settings.insetAmount       ?? DEFAULT_SETTINGS.insetAmount;
  const keycapSize        = settings.keycapSize        ?? DEFAULT_SETTINGS.keycapSize;
  const clickerSquareSize = settings.clickerSquareSize ?? DEFAULT_SETTINGS.clickerSquareSize;
  const bossDiameter      = settings.bossDiameter      ?? DEFAULT_SETTINGS.bossDiameter;
  const CLEARANCE = settings.clearanceMm ?? DEFAULT_SETTINGS.clearanceMm;

  // ── Step 1: shell outer → shell inner ────────────────────────────────────
  // Keep nullable — a null means the shape collapses at this wall thickness,
  // which is itself a fatal geometry problem. Never fall back to the outer
  // shape for the bbox check; that would mask the failure.
  const shellOuter = transformToMm(baseShape, scale, svgWidth, svgHeight, settings.mirrorShell ?? false);
  const shellInner: THREE.Shape | null =
    offsetShapeInward(shellOuter, insetAmount) ??
    offsetShapeInward(shellOuter, Math.min(insetAmount, 0.8)) ??
    offsetShapeInward(shellOuter, 0.3);

  const { w: shellW, h: shellH } = shellInner
    ? boundingBoxMm(shellInner)
    : { w: 0, h: 0 };

  if (shellW < keycapSize || shellH < keycapSize) {
    warnings.push({
      part: "shell",
      severity: "error",
      message: shellInner
        ? `Shell interior is ${shellW.toFixed(1)} × ${shellH.toFixed(1)} mm — ` +
          `too small for the ${keycapSize} × ${keycapSize} mm keycap pocket. ` +
          `Increase model size or reduce "Keycap square".`
        : `Shell interior collapses at the current wall thickness — ` +
          `too small for the ${keycapSize} × ${keycapSize} mm keycap pocket. ` +
          `Increase model size.`,
    });
  }

  // ── Step 2: shell inner → clicker body (deflate by print clearance) ──────
  // The clicker is physically derived from the shell's inner cavity, NOT
  // independently from the outer SVG. Derive it the same way: take shellInner
  // and shrink it by CLEARANCE so the clicker slides in without binding.
  // If shellInner is null the clicker has no space at all — treat as zero.
  const clickerBody: THREE.Shape | null = shellInner
    ? (offsetShapeInward(shellInner, CLEARANCE) ?? cloneShape(shellInner))
    : null;

  const { w: clickerW, h: clickerH } = clickerBody
    ? boundingBoxMm(clickerBody)
    : { w: 0, h: 0 };

  if (clickerW < clickerSquareSize || clickerH < clickerSquareSize) {
    warnings.push({
      part: "clicker",
      severity: "error",
      message: clickerBody
        ? `Clicker body is ${clickerW.toFixed(1)} × ${clickerH.toFixed(1)} mm — ` +
          `too small for the ${clickerSquareSize} × ${clickerSquareSize} mm switch cavity. ` +
          `Increase model size or reduce "Switch cavity size".`
        : `Model is too small — clicker body cannot hold the ` +
          `${clickerSquareSize} × ${clickerSquareSize} mm switch cavity. ` +
          `Increase model size.`,
    });
  }

  // ── Step 3: boss diameter vs switch cavity ────────────────────────────────
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
