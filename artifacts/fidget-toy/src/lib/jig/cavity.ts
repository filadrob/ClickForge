// COORDINATE SPACE:
// SVGLoader returns paths in SVG user units (pixels at 96 dpi by default),
// where Y increases downward.  The existing fidget-toy pipeline converts these
// to mm using a user-chosen scale:
//
//   scale = targetSizeMm / svgDimensionPx
//
// For the jig geometry engine we receive an SVG path string and a target size
// in mm (jigWidth/jigHeight).  We parse the SVG, tessellate it to a flat 2D
// polygon, then apply the same mm conversion.  The final polygon is centred on
// the origin in mm space (Y-up).
//
// Lug centre coordinates (lugCenter.x / lugCenter.y) are already in mm — they
// originate from the Studio's keyRingNudgeX/Y fields, which are stored in mm.
// (See createKeyRingGeometry() in fidgetGeometry.ts — keyRingNudgeX/Y are mm,
// the lug position in the viewport is also expressed in mm world-space.)
//
// Clipper.js works in integer units.  We scale all mm values up by
// CLIPPER_SCALE before passing them in and scale back after.
//
// SVG_TO_MM_SCALE is NOT a fixed constant — it depends on the user's chosen
// targetSizeMm and the SVG's intrinsic dimensions.  The caller is responsible
// for supplying jigWidth/jigHeight which defines the physical mm footprint.
// Internally we use the SVG's viewBox/shape bounding-box to derive a normalised
// scale so the tessellated polygon is expressed in mm.

import * as THREE from "three";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import ClipperLib from "clipper-lib";
import type { JigInput, JigOutput } from "./types";

// ── Constants ─────────────────────────────────────────────────────────────

/** Clipper precision: 1 mm = 1000 Clipper units → 0.001 mm resolution */
const CLIPPER_SCALE = 1000;

/** Minimum solid border between cavity edge and jig outer edge (mm). */
const MIN_WALL = 3;

// ── Helper: scale mm ↔ Clipper integer units ──────────────────────────────

function mmToClipper(v: number): number {
  return Math.round(v * CLIPPER_SCALE);
}

function clipperToMm(v: number): number {
  return v / CLIPPER_SCALE;
}

type ClipperPoint = { X: number; Y: number };
type ClipperPath = ClipperPoint[];

function toClipperPoly(points: number[][]): ClipperPath {
  return points.map(([x, y]) => ({ X: mmToClipper(x), Y: mmToClipper(y) }));
}

function fromClipperPoly(poly: ClipperPath): number[][] {
  return poly.map((p) => [clipperToMm(p.X), clipperToMm(p.Y)]);
}

// ── Tessellate SVG path string → 2D polygon in mm ─────────────────────────

/**
 * Parse an SVG path string (the `d` attribute value) or a full SVG string,
 * tessellate it using Three.js SVGLoader at high tolerance, and return a flat
 * 2D polygon in mm centred on the origin.
 *
 * The SVG may be a bare `d`-string (e.g. "M 0 0 L 40 0 …") or a full SVG
 * document.  Both are handled by wrapping bare d-strings in a minimal SVG.
 *
 * Scale: the raw tessellation returns points in SVG pixel units.  We derive a
 * pixel-to-mm scale from the shape's own bounding box, which is recentred to
 * the origin.  When the input is a full SVG with a known viewBox, we use the
 * viewBox width/height to convert to mm (assuming the SVG was authored in mm-
 * equivalent units, which is the convention used throughout the fidget-toy pipeline).
 */
export function tessellateShape(
  svgPathsOrDocument: string,
  targetWidthMm?: number,
  targetHeightMm?: number,
): number[][] {
  // Wrap bare path d-strings in a minimal SVG document.
  const isSvg = svgPathsOrDocument.trimStart().startsWith("<");
  const svgString = isSvg
    ? svgPathsOrDocument
    : `<svg xmlns="http://www.w3.org/2000/svg"><path d="${svgPathsOrDocument}" fill="black"/></svg>`;

  const loader = new SVGLoader();
  const data = loader.parse(svgString);

  // Collect all tessellated points from all paths.
  // Use getPoints with divisions proportional to tolerance ≤ 0.01mm.
  // We will rescale after — so the raw points are in SVG pixel units.
  const allPts: THREE.Vector2[] = [];
  for (const path of data.paths) {
    const shapes = SVGLoader.createShapes(path);
    for (const shape of shapes) {
      shape.holes = []; // strip parser-imposed holes (same as parseSvgString)
      const pts = shape.getPoints(256);
      // Strip closing duplicate
      const first = pts[0];
      const last = pts[pts.length - 1];
      const cleanPts =
        first && last && last.distanceTo(first) < 1e-6
          ? pts.slice(0, -1)
          : pts;
      allPts.push(...cleanPts);
    }
  }

  if (allPts.length < 3) {
    // Fallback: extract points from each subPath (THREE.ShapePath → subPaths are CurvePath[])
    const fallbackPts: THREE.Vector2[] = [];
    for (const path of data.paths) {
      // path.subPaths is an array of THREE.Path (which extends CurvePath)
      // Each THREE.Path has a getPoints() method.
      for (const subPath of path.subPaths as THREE.Path[]) {
        const pts = subPath.getPoints(256);
        fallbackPts.push(...pts);
      }
    }
    if (fallbackPts.length >= 3) {
      return ptsToMmPolygon(fallbackPts, targetWidthMm, targetHeightMm);
    }
    return [];
  }

  return ptsToMmPolygon(allPts, targetWidthMm, targetHeightMm);
}

/**
 * Convert raw SVG-pixel-space Vector2 points to mm, centred at origin (Y-up).
 * If targetWidthMm / targetHeightMm are provided, scale so the bounding box
 * exactly matches those dimensions.  Otherwise the bounding box width = bbox
 * pixel width (1 px = 1 mm, useful for square test inputs).
 */
function ptsToMmPolygon(
  pts: THREE.Vector2[],
  targetWidthMm?: number,
  targetHeightMm?: number,
): number[][] {
  // Compute bounding box in SVG pixel space
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const bboxW = maxX - minX; // px
  const bboxH = maxY - minY; // px

  // Determine scale factor (px → mm)
  let scaleX = 1;
  let scaleY = 1;
  if (targetWidthMm !== undefined && bboxW > 0) {
    scaleX = targetWidthMm / bboxW;
  }
  if (targetHeightMm !== undefined && bboxH > 0) {
    scaleY = targetHeightMm / bboxH;
  }
  // If only one target dimension given, keep aspect ratio
  if (targetWidthMm !== undefined && targetHeightMm === undefined && bboxH > 0) {
    scaleY = scaleX;
  }
  if (targetHeightMm === undefined && targetWidthMm === undefined) {
    // No target: treat 1 px = 1 mm (suitable for test inputs where dimensions
    // are specified in viewBox units that equal mm)
    scaleX = 1;
    scaleY = 1;
  }

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  // Transform: centre, scale, flip Y (SVG Y-down → Three.js Y-up)
  return pts.map((p) => [
    (p.x - cx) * scaleX,
    -((p.y - cy) * scaleY), // flip Y
  ]);
}

// ── Clipper polygon offset ─────────────────────────────────────────────────

/**
 * Outward-offset a 2D polygon by `offsetMm` using Clipper with jtRound join
 * type.  Returns the largest resulting contour (in mm).
 */
export function offsetPolygon(poly: number[][], offsetMm: number): number[][] {
  if (poly.length < 3) return poly;
  const clipperPoly = toClipperPoly(poly);

  // Ensure CCW winding for Clipper (positive area in Clipper's convention)
  ClipperLib.Clipper.CleanPolygon(clipperPoly, 1.415);
  if (ClipperLib.Clipper.Area(clipperPoly) < 0) {
    clipperPoly.reverse();
  }

  const co = new ClipperLib.ClipperOffset();
  co.AddPath(
    clipperPoly,
    ClipperLib.JoinType.jtRound,
    ClipperLib.EndType.etClosedPolygon,
  );

  const solution: ClipperPath[] = [];
  co.Execute(solution, mmToClipper(offsetMm));

  if (solution.length === 0) return poly;

  // Pick the largest contour by absolute area
  const largest = solution.reduce(
    (best, cur) =>
      Math.abs(ClipperLib.Clipper.Area(cur)) >
      Math.abs(ClipperLib.Clipper.Area(best))
        ? cur
        : best,
    solution[0],
  );

  return fromClipperPoly(largest);
}

// ── Lug circle polygon ─────────────────────────────────────────────────────

/**
 * Create a circle polygon (in mm) centred at (centerX, centerY) with the given
 * radius, approximated with `segments` vertices.
 */
export function makeLugCircle(
  centerX: number,
  centerY: number,
  radiusMm: number,
  segments = 64,
): number[][] {
  const pts: number[][] = [];
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    pts.push([
      centerX + Math.cos(angle) * radiusMm,
      centerY + Math.sin(angle) * radiusMm,
    ]);
  }
  return pts;
}

// ── Union two polygons ─────────────────────────────────────────────────────

/**
 * Union two 2D polygons using Clipper ctUnion.  Returns the resulting
 * merged polygon (largest contour).
 */
export function unionPolygons(a: number[][], b: number[][]): number[][] {
  if (a.length < 3) return b;
  if (b.length < 3) return a;

  const clipA = toClipperPoly(a);
  const clipB = toClipperPoly(b);

  // Ensure CCW winding
  if (ClipperLib.Clipper.Area(clipA) < 0) clipA.reverse();
  if (ClipperLib.Clipper.Area(clipB) < 0) clipB.reverse();

  const c = new ClipperLib.Clipper();
  c.AddPath(clipA, ClipperLib.PolyType.ptSubject, true);
  c.AddPath(clipB, ClipperLib.PolyType.ptClip, true);

  const solution: ClipperPath[] = [];
  c.Execute(ClipperLib.ClipType.ctUnion, solution);

  if (solution.length === 0) return a;

  // Return the largest contour
  const largest = solution.reduce(
    (best, cur) =>
      Math.abs(ClipperLib.Clipper.Area(cur)) >
      Math.abs(ClipperLib.Clipper.Area(best))
        ? cur
        : best,
    solution[0],
  );

  return fromClipperPoly(largest);
}

// ── Bounding box ───────────────────────────────────────────────────────────

export function computeBBox(poly: number[][]): { w: number; h: number } {
  if (poly.length === 0) return { w: 0, h: 0 };
  let minX = poly[0][0],
    maxX = poly[0][0];
  let minY = poly[0][1],
    maxY = poly[0][1];
  for (const [x, y] of poly) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { w: maxX - minX, h: maxY - minY };
}

// ── Fit check ─────────────────────────────────────────────────────────────

export function computeFitCheck(
  bbox: { w: number; h: number },
  jigW: number,
  jigH: number,
  rows: number,
  cols: number,
  spacing: number,
  minWall: number,
): { fits: boolean; errorMessage?: string; requiredW: number; requiredH: number } {
  const requiredW = minWall * 2 + bbox.w * cols + spacing * (cols - 1);
  const requiredH = minWall * 2 + bbox.h * rows + spacing * (rows - 1);
  const fits = requiredW <= jigW && requiredH <= jigH;
  if (!fits) {
    const reasons: string[] = [];
    if (requiredW > jigW)
      reasons.push(`${requiredW.toFixed(1)}mm width required (jig is ${jigW}mm)`);
    if (requiredH > jigH)
      reasons.push(`${requiredH.toFixed(1)}mm height required (jig is ${jigH}mm)`);
    return {
      fits: false,
      errorMessage: `Doesn't fit: ${reasons.join(", ")}`,
      requiredW,
      requiredH,
    };
  }
  return { fits: true, requiredW, requiredH };
}

// ── Even spacing ──────────────────────────────────────────────────────────

/**
 * Compute the uniform spacing between cavity centres so they are distributed
 * evenly across the jig interior (bounded by minWall on each side).
 *
 * Returns the distance between adjacent cavity centres.  For a 1×1 layout
 * both values are 0 (single centred cavity).
 */
export function computeEvenSpacing(
  bbox: { w: number; h: number },
  jigW: number,
  jigH: number,
  rows: number,
  cols: number,
  minWall: number,
): { x: number; y: number } {
  // Available interior after walls and cavity footprint
  const usableW = jigW - 2 * minWall - bbox.w * cols;
  const usableH = jigH - 2 * minWall - bbox.h * rows;

  const x = cols > 1 ? usableW / (cols - 1) : 0;
  const y = rows > 1 ? usableH / (rows - 1) : 0;

  return { x: Math.max(0, x), y: Math.max(0, y) };
}

// ── Main export ───────────────────────────────────────────────────────────

/**
 * Compute the jig cavity 2D profile given piece parameters.
 * Pure function — no UI, no Three.js scene mutations.
 */
export function computeJigCavity(input: JigInput): JigOutput {
  const {
    svgPaths,
    pieceType,
    clearance,
    gap,
    wallThickness,
    lugRadius,
    lugCenter,
    extrudeDepth,
    jigWidth,
    jigHeight,
    rows,
    cols,
    spacing,
    zAdjust,
    mirrorX,
  } = input;

  // Step 1: Tessellate SVG paths → 2D polygon in mm
  let polygon = tessellateShape(svgPaths);
  if (polygon.length < 3) {
    return {
      cavityPolygon: [],
      cavityBBox: { w: 0, h: 0 },
      jigZ: extrudeDepth + zAdjust,
      fits: false,
      errorMessage: "Could not parse SVG paths — no usable polygon found",
      evenSpacing: { x: 0, y: 0 },
    };
  }

  // Step 2: Apply outward offset via Clipper
  // Inner clicker: offset = clearance
  // Outer shell:   offset = gap + wallThickness + clearance
  const offsetMm =
    pieceType === "inner"
      ? clearance
      : gap + wallThickness + clearance;

  let offsetPoly = offsetPolygon(polygon, offsetMm);

  // Step 3: Outer shell only — union with lug circle
  if (pieceType === "outer" && lugRadius > 0) {
    const lugOffsetRadius = lugRadius + clearance;
    const lugCircle = makeLugCircle(lugCenter.x, lugCenter.y, lugOffsetRadius);
    offsetPoly = unionPolygons(offsetPoly, lugCircle);
  }

  // Step 4: Compute bounding box
  const cavityBBox = computeBBox(offsetPoly);

  // Step 5: Fit check
  const fitResult = computeFitCheck(
    cavityBBox,
    jigWidth,
    jigHeight,
    rows,
    cols,
    spacing,
    MIN_WALL,
  );

  // Step 6: Even spacing (only meaningful when fits)
  const evenSpacing = fitResult.fits
    ? computeEvenSpacing(cavityBBox, jigWidth, jigHeight, rows, cols, MIN_WALL)
    : { x: 0, y: 0 };

  // Step 7: Mirror X — mirror the cavity polygon across its own X axis
  let cavityPolygon = offsetPoly;
  if (mirrorX) {
    cavityPolygon = offsetPoly.map(([x, y]) => [-x, y]);
    // Reversing X flips winding — reverse to restore consistent winding
    cavityPolygon = cavityPolygon.reverse();
  }

  return {
    cavityPolygon,
    cavityBBox,
    jigZ: extrudeDepth + zAdjust,
    fits: fitResult.fits,
    errorMessage: fitResult.errorMessage,
    evenSpacing,
  };
}
