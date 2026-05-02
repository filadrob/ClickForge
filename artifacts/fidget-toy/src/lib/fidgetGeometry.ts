import * as THREE from "three";

export interface FidgetSettings {
  totalDepth: number;       // outer wall total height (mm), e.g. 22
  innerFillDepth: number;   // inner fill height (mm), e.g. 12
  insetAmount: number;      // how much inner fill is inset from outer wall (mm each side), e.g. 1
  keycapSize: number;       // keycap square hole side length (mm), e.g. 14
  pegRadius: number;        // inner clicker peg radius (mm), e.g. 3.5
  targetSizeMm: number;     // target dimension of the imported SVG in mm
  lockDimension: "width" | "height"; // which SVG axis to lock to targetSizeMm
}

export const DEFAULT_SETTINGS: FidgetSettings = {
  totalDepth: 22,
  innerFillDepth: 12,
  insetAmount: 1,
  keycapSize: 14,
  pegRadius: 3.5,
  targetSizeMm: 50,
  lockDimension: "width",
};

export interface OuterShellGeometries {
  outerWall: THREE.BufferGeometry;
  innerFill: THREE.BufferGeometry;
  keycapHousing: THREE.BufferGeometry;
  /** Offset so parts can be positioned with outer wall bottom at z=0 */
  zOffsets: { outerWall: number; innerFill: number; keycapHousing: number };
}

export interface InnerClickerGeometries {
  body: THREE.BufferGeometry;
  peg: THREE.BufferGeometry;
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
  const scaledW = svgWidth * scale;
  const scaledH = svgHeight * scale;

  const baseShape = svgShapes.length > 0 ? svgShapes[0] : createDefaultShape(40);
  const { totalDepth, innerFillDepth, insetAmount, keycapSize } = settings;

  // Inset scale factor: shrink from center by insetAmount on each side
  const insetFactor = Math.max(
    0.5,
    Math.min(
      scaledW - 2 * insetAmount,
      scaledH - 2 * insetAmount
    ) / Math.max(scaledW, scaledH)
  );

  // --- 1. Outer wall: ring = full SVG shape with inset shape as hole ---
  const outerShape = transformShape(baseShape, scale, svgWidth, svgHeight);
  const insetShapeForHole = transformShape(baseShape, scale * insetFactor, svgWidth, svgHeight);
  // Add inset shape as hole to make a ring
  const ringHole = new THREE.Path(insetShapeForHole.getPoints(64));
  outerShape.holes.push(ringHole);
  const outerWallGeo = extrudeShape(outerShape, totalDepth);

  // --- 2. Inner fill: inset solid shape with keycap square hole ---
  const fillShape = transformShape(baseShape, scale * insetFactor, svgWidth, svgHeight);
  addSquareHole(fillShape, keycapSize);
  const innerFillGeo = extrudeShape(fillShape, innerFillDepth);

  // --- 3. Keycap housing: hollow square rim sitting inside the recess ---
  const recessDepth = totalDepth - innerFillDepth; // 10mm
  const housingDepth = Math.min(recessDepth * 0.8, 8); // use 80% of recess, max 8mm
  const outerHalf = keycapSize / 2 + 2.5; // 2.5mm wall
  const innerHalf = keycapSize / 2;
  const housingShape = makeRectRingShape(outerHalf, innerHalf);
  const keycapHousingGeo = extrudeShape(housingShape, housingDepth);

  return {
    outerWall: outerWallGeo,
    innerFill: innerFillGeo,
    keycapHousing: keycapHousingGeo,
    zOffsets: {
      outerWall: 0,
      innerFill: 0,               // flush with bottom of outer wall
      keycapHousing: innerFillDepth, // sits on top of inner fill inside recess
    },
  };
}

export function createInnerClickerGeometries(
  svgShapes: THREE.Shape[],
  settings: FidgetSettings,
  svgWidth: number,
  svgHeight: number
): InnerClickerGeometries {
  const { scale } = computeScale(settings, svgWidth, svgHeight);
  const scaledW = svgWidth * scale;
  const scaledH = svgHeight * scale;

  const baseShape = svgShapes.length > 0 ? svgShapes[0] : createDefaultShape(40);
  const { totalDepth, innerFillDepth, insetAmount, keycapSize, pegRadius } = settings;

  // Inner clicker fits inside the recess (10mm deep) with clearance
  const recessDepth = totalDepth - innerFillDepth;
  const clickerDepth = recessDepth - 1; // 1mm clearance at top

  // Clicker is scaled to fit inside the inset area with 0.5mm clearance
  const insetFactor = Math.max(
    0.5,
    Math.min(
      scaledW - 2 * insetAmount,
      scaledH - 2 * insetAmount
    ) / Math.max(scaledW, scaledH)
  );
  const clickerScale = scale * insetFactor * 0.98; // 2% clearance

  const clickerShape = transformShape(baseShape, clickerScale, svgWidth, svgHeight);
  addSquareHole(clickerShape, keycapSize);

  const bodyGeo = extrudeShape(clickerShape, clickerDepth);

  // Peg cylinder: attached to bottom of inner clicker, fits through keycap hole
  const pegHeight = innerFillDepth * 0.6;
  const pegGeo = new THREE.CylinderGeometry(pegRadius, pegRadius, pegHeight, 32);

  return { body: bodyGeo, peg: pegGeo };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeScale(
  settings: FidgetSettings,
  svgWidth: number,
  svgHeight: number
): { scale: number } {
  const { targetSizeMm, lockDimension } = settings;
  const base = lockDimension === "width" ? svgWidth : svgHeight;
  const scale = base > 0 ? targetSizeMm / base : 1;
  return { scale };
}

function transformShape(
  shape: THREE.Shape,
  scale: number,
  svgWidth: number,
  svgHeight: number
): THREE.Shape {
  // SVG origin is top-left with Y down; we flip Y and center
  const cx = (svgWidth * scale) / 2;
  const cy = (svgHeight * scale) / 2;

  const pts = shape.getPoints(64).map((p) => new THREE.Vector2(p.x * scale - cx, -(p.y * scale - cy)));
  const out = new THREE.Shape();
  out.setFromPoints(pts);

  for (const hole of shape.holes) {
    const holePts = hole.getPoints(32).map((p) => new THREE.Vector2(p.x * scale - cx, -(p.y * scale - cy)));
    const h = new THREE.Path();
    h.setFromPoints(holePts);
    out.holes.push(h);
  }
  return out;
}

function addSquareHole(shape: THREE.Shape, size: number): void {
  const half = size / 2;
  const hole = new THREE.Path();
  hole.moveTo(-half, -half);
  hole.lineTo(half, -half);
  hole.lineTo(half, half);
  hole.lineTo(-half, half);
  hole.closePath();
  shape.holes.push(hole);
}

function makeRectRingShape(outerHalf: number, innerHalf: number): THREE.Shape {
  const outer = new THREE.Shape();
  outer.moveTo(-outerHalf, -outerHalf);
  outer.lineTo(outerHalf, -outerHalf);
  outer.lineTo(outerHalf, outerHalf);
  outer.lineTo(-outerHalf, outerHalf);
  outer.closePath();

  const hole = new THREE.Path();
  hole.moveTo(-innerHalf, -innerHalf);
  hole.lineTo(innerHalf, -innerHalf);
  hole.lineTo(innerHalf, innerHalf);
  hole.lineTo(-innerHalf, innerHalf);
  hole.closePath();
  outer.holes.push(hole);

  return outer;
}

function extrudeShape(shape: THREE.Shape, depth: number): THREE.BufferGeometry {
  return new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.2,
    bevelSize: 0.2,
    bevelSegments: 2,
  });
}

function createDefaultShape(size: number): THREE.Shape {
  const half = size / 2;
  const r = size * 0.1;
  const s = new THREE.Shape();
  s.moveTo(-half + r, -half);
  s.lineTo(half - r, -half);
  s.quadraticCurveTo(half, -half, half, -half + r);
  s.lineTo(half, half - r);
  s.quadraticCurveTo(half, half, half - r, half);
  s.lineTo(-half + r, half);
  s.quadraticCurveTo(-half, half, -half, half - r);
  s.lineTo(-half, -half + r);
  s.quadraticCurveTo(-half, -half, -half + r, -half);
  s.closePath();
  return s;
}
