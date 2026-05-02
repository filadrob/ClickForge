import * as THREE from "three";
import { insetPolygon } from "./polygonOffset";

export interface FidgetSettings {
  totalDepth: number;         // outer wall total height (mm), e.g. 22
  innerFillDepth: number;     // total inner fill block height (pocket + floor), e.g. 12
  keycapPocketDepth: number;  // total pocket depth from top of inner fill (mm), e.g. 10
  insetAmount: number;        // true wall thickness — every interior point is exactly this far from outer wall (mm), e.g. 1.5
  keycapSize: number;         // keycap square pocket side length (mm), e.g. 14
  pegRadius: number;          // inner clicker peg radius (mm), e.g. 3.5
  targetSizeMm: number;       // target mm for the locked SVG dimension
  lockDimension: "width" | "height";
  pinHolesEnabled: boolean;
  pinHoleRadius: number;      // print clearance added to each MX spec radius (mm), e.g. 0.1
  pinHoleDepth: number;       // depth of pin-hole section at deepest end of pocket (mm), e.g. 3
}

export const DEFAULT_SETTINGS: FidgetSettings = {
  totalDepth: 22,
  innerFillDepth: 12,
  keycapPocketDepth: 10,
  insetAmount: 1.5,
  keycapSize: 14,
  pegRadius: 3.5,
  targetSizeMm: 50,
  lockDimension: "width",
  pinHolesEnabled: false,
  pinHoleRadius: 0.1,
  pinHoleDepth: 3,
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
}

export interface InnerClickerGeometries {
  body: THREE.BufferGeometry;
  peg: THREE.BufferGeometry;
  clickerDepth: number;
  pegHeight: number;
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

  const pocketDepth = Math.min(keycapPocketDepth, innerFillDepth - 1);
  const floorDepth  = innerFillDepth - pocketDepth;
  const pinDepth    = pinHolesEnabled ? Math.min(pinHoleDepth, pocketDepth - 1) : 0;
  const squareDepth = pocketDepth - pinDepth;

  // ── Transform outer SVG path to world-space mm coords ──────────────────
  const outerShape = transformToMm(baseShape, scale, svgWidth, svgHeight);

  // ── True geometric inward offset → inner wall boundary ─────────────────
  // insetAmount is the actual wall thickness on every side, regardless of
  // how irregular / concave the SVG outline is.
  const innerShape = offsetShapeInward(outerShape, insetAmount);
  if (!innerShape) {
    // Shape collapsed (inset > half the narrowest dimension) — fall back to
    // a small solid block so the viewer never shows nothing.
    const fallback = createDefaultShape(4);
    const fallbackGeo = extrudeShape(fallback, innerFillDepth);
    return {
      outerWall: extrudeShape(outerShape, totalDepth),
      innerFillFloor: fallbackGeo,
      innerFillPinSection: null,
      innerFillWalls: fallbackGeo,
      zOffsets: { outerWall: 0, innerFillFloor: 0, innerFillPinSection: 0, innerFillWalls: 0 },
      floorDepth: innerFillDepth,
    };
  }

  // ── 1. Outer wall ring ──────────────────────────────────────────────────
  const ringShape = transformToMm(baseShape, scale, svgWidth, svgHeight);
  ringShape.holes.push(new THREE.Path(innerShape.getPoints(128)));
  const outerWallGeo = extrudeShape(ringShape, totalDepth);

  // ── 2. Solid floor — never penetrated ──────────────────────────────────
  const floorShape = cloneShape(innerShape);
  const innerFillFloorGeo = extrudeShape(floorShape, floorDepth);

  // ── 3. MX pin-hole section (deepest part of pocket) ────────────────────
  let innerFillPinSectionGeo: THREE.BufferGeometry | null = null;
  if (pinHolesEnabled && pinDepth > 0) {
    const pinShape = cloneShape(innerShape);
    addMXPinHoles(pinShape, pinHoleRadius);
    innerFillPinSectionGeo = extrudeShape(pinShape, pinDepth);
  }

  // ── 4. Keycap square walls (upper / shallower part of pocket) ──────────
  const wallsShape = cloneShape(innerShape);
  addSquareHole(wallsShape, keycapSize);
  const innerFillWallsGeo = extrudeShape(wallsShape, squareDepth);

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
  };
}

export function createInnerClickerGeometries(
  svgShapes: THREE.Shape[],
  settings: FidgetSettings,
  svgWidth: number,
  svgHeight: number
): InnerClickerGeometries {
  const { scale } = computeScale(settings, svgWidth, svgHeight);

  const baseShape = svgShapes.length > 0 ? svgShapes[0] : createDefaultShape(40);
  const { totalDepth, innerFillDepth, keycapSize, pegRadius } = settings;
  const insetAmount = settings.insetAmount ?? DEFAULT_SETTINGS.insetAmount;
  const keycapPocketDepth = settings.keycapPocketDepth ?? DEFAULT_SETTINGS.keycapPocketDepth;

  const recessDepth = totalDepth - innerFillDepth;
  const clickerDepth = Math.max(1, recessDepth - 1);

  // The clicker's outer boundary is the inner wall shape plus 0.3 mm print clearance,
  // so it slides cleanly into the recess without binding.
  const CLEARANCE = 0.3;
  const outerShape = transformToMm(baseShape, scale, svgWidth, svgHeight);
  const clickerShape = offsetShapeInward(outerShape, insetAmount + CLEARANCE);

  let bodyGeo: THREE.BufferGeometry;
  if (clickerShape) {
    addSquareHole(clickerShape, keycapSize);
    bodyGeo = extrudeShape(clickerShape, clickerDepth);
  } else {
    // Fallback: tiny placeholder
    bodyGeo = extrudeShape(createDefaultShape(4), clickerDepth);
  }

  const pegHeight = keycapPocketDepth * 0.6;
  const pegGeo = new THREE.CylinderGeometry(pegRadius, pegRadius, pegHeight, 32);

  return { body: bodyGeo, peg: pegGeo, clickerDepth, pegHeight };
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/**
 * Transform an SVG-space THREE.Shape into world-space millimetre coordinates.
 * - Scales by `scale` (px → mm).
 * - Re-centres so the shape is centred on the origin.
 * - Flips Y axis (SVG Y-down → Three.js Y-up).
 * - Discretises curves to 128 points for high-fidelity offset computation.
 */
function transformToMm(
  shape: THREE.Shape,
  scale: number,
  svgWidth: number,
  svgHeight: number
): THREE.Shape {
  const cx = (svgWidth  * scale) / 2;
  const cy = (svgHeight * scale) / 2;
  // getPoints(n) returns n+1 samples including the closing t=1 point.
  // For a closed THREE.Shape t=1 equals t=0, so we take only the first n
  // samples (slice off the last) to avoid a degenerate zero-length closing
  // edge that would corrupt the polygon-offset computation.
  const raw = shape.getPoints(128); // 129 points, last ≈ first for closed paths
  const pts = raw.slice(0, raw.length - 1).map(
    (p) => new THREE.Vector2(p.x * scale - cx, -(p.y * scale - cy))
  );
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

/** Unsigned polygon area (for picking the largest contour). */
function polygonArea(pts: THREE.Vector2[]): number {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return Math.abs(area) / 2;
}

/** Shallow-clone a THREE.Shape (copies the outer curve points, drops holes). */
function cloneShape(shape: THREE.Shape): THREE.Shape {
  const pts = shape.getPoints(128);
  const s = new THREE.Shape();
  s.setFromPoints(pts);
  return s;
}

function computeScale(s: FidgetSettings, w: number, h: number): { scale: number } {
  const base = s.lockDimension === "width" ? w : h;
  return { scale: base > 0 ? s.targetSizeMm / base : 1 };
}

/**
 * Punches the official Cherry MX 5-pin PCB footprint holes through a shape.
 *
 *   Center guide pin:       ( 0.00,  0.00)  Ø 4.0 mm  r = 2.00
 *   Left  retention peg:    (-5.08,  0.00)  Ø 1.8 mm  r = 0.90
 *   Right retention peg:    (+5.08,  0.00)  Ø 1.8 mm  r = 0.90
 *   Left  electrical pin:   (-3.81, -2.54)  Ø 1.5 mm  r = 0.75
 *   Right electrical pin:   (+3.81, -2.54)  Ø 1.5 mm  r = 0.75
 *
 * `tolerance` (mm) is added to every radius for FDM over-extrusion compensation.
 */
function addMXPinHoles(shape: THREE.Shape, tolerance: number): void {
  const pins: [number, number, number][] = [
    [  0.00,  0.00, 2.00 ],
    [ -5.08,  0.00, 0.90 ],
    [  5.08,  0.00, 0.90 ],
    [ -3.81, -2.54, 0.75 ],
    [  3.81, -2.54, 0.75 ],
  ];
  for (const [x, y, r] of pins) {
    const h = new THREE.Path();
    h.absarc(x, y, r + tolerance, 0, Math.PI * 2, false);
    shape.holes.push(h);
  }
}

function addSquareHole(shape: THREE.Shape, size: number): void {
  const half = size / 2;
  const hole = new THREE.Path();
  hole.moveTo(-half, -half);
  hole.lineTo( half, -half);
  hole.lineTo( half,  half);
  hole.lineTo(-half,  half);
  hole.lineTo(-half, -half);
  shape.holes.push(hole);
}

function extrudeShape(shape: THREE.Shape, depth: number): THREE.BufferGeometry {
  return new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
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
