/**
 * True geometric inward polygon offset (path inset).
 *
 * Every point on the resulting boundary is exactly `offsetMm` units from the
 * nearest point on the original boundary, measured along the local normal —
 * i.e. a true "parallel curve" of the polygon.
 *
 * Algorithm
 * ---------
 *  1. Determine winding (CW vs CCW) from the signed area.
 *  2. For every edge shift a parallel copy inward by `offsetMm`.
 *  3. New vertices = intersections of adjacent shifted edges.
 *     At concave corners where the intersection would be farther than
 *     `miterLimit × offsetMm` away (a "spike"), replace with a bevel
 *     (two points at the clamped edge endpoints).
 *  4. Detect and remove self-intersecting loops created when concave regions
 *     collapse: find the first crossing of non-adjacent edges, shortcut past
 *     the loop, repeat until clean.
 *  5. Verify the result still has valid area and the same winding as the
 *     input; return [] if the shape has fully collapsed.
 *
 * Handles:
 *  - Convex shapes  — perfect, uniform wall thickness.
 *  - Concave shapes — concave corners move outward (correct).  Spikes are
 *                     capped by the miter limit.
 *  - Tight necks    — the self-intersection removal correctly clips away the
 *                     collapsed region.
 */

import * as THREE from "three";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute the inward offset of a closed 2-D polygon.
 *
 * @param points   Closed polygon vertices (do NOT repeat the first point).
 * @param offsetMm Positive distance to move every point inward (mm).
 * @param miterLimit  Max allowed vertex-displacement as a multiple of
 *                    `offsetMm` before switching to a bevel. Default 4.
 * @returns  Array of result contours. Usually one; may be empty if the shape
 *           fully collapses; may be more than one if the shape splits (rare).
 */
export function insetPolygon(
  points: THREE.Vector2[],
  offsetMm: number,
  miterLimit = 4
): THREE.Vector2[][] {
  if (points.length < 3 || offsetMm <= 0) return [];

  // THREE.Shape.getPoints(n) returns n+1 samples at t=0…1.  For a closed
  // path pts[0] === pts[n], which creates a zero-length degenerate edge that
  // breaks the edge-normal computation.  Strip the closing duplicate here so
  // callers never have to think about it.
  const last  = points[points.length - 1];
  const first = points[0];
  const deduped =
    last.distanceTo(first) < 1e-6 ? points.slice(0, -1) : points;
  if (deduped.length < 3) return [];

  const area0 = signedArea(deduped);
  if (Math.abs(area0) < 1e-9) return [];

  // Ensure CCW orientation (positive area in standard math / Three.js Y-up)
  const pts = area0 < 0 ? [...deduped].reverse() : [...deduped];

  // Compute the raw offset polygon
  const raw = computeRawOffset(pts, offsetMm, miterLimit);
  if (raw.length < 3) return [];

  // Verify winding not flipped (would mean the shape over-collapsed)
  const area1 = signedArea(raw);
  if (area1 <= 0) return [];

  // Remove self-intersecting loops
  const clean = removeSelfIntersections(raw);
  if (clean.length < 3) return [];

  // Final area check
  if (signedArea(clean) <= 0) return [];

  return [clean];
}

// ---------------------------------------------------------------------------
// Step 1+2+3 — parallel edge shift + vertex intersection
// ---------------------------------------------------------------------------

interface ShiftedEdge {
  /** A point on the shifted edge */
  px: number;
  py: number;
  /** Unit direction of the edge */
  dx: number;
  dy: number;
}

function computeRawOffset(
  pts: THREE.Vector2[],
  d: number,
  miterLimit: number
): THREE.Vector2[] {
  const n = pts.length;

  // Build inward-shifted parallel edges.
  // For a CCW polygon, the inward normal of edge (a→b) is (-ey, ex)/|e|.
  const edges: ShiftedEdge[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const len = Math.hypot(ex, ey);
    if (len < 1e-10) continue; // degenerate edge — skip

    // Inward normal for CCW: rotate edge 90° CCW → (-ey, ex)
    const nx = -ey / len;
    const ny =  ex / len;

    edges.push({
      px: a.x + nx * d,
      py: a.y + ny * d,
      dx: ex / len,
      dy: ey / len,
    });
  }

  if (edges.length < 3) return [];

  const maxDist = d * miterLimit;
  const result: THREE.Vector2[] = [];

  for (let i = 0; i < edges.length; i++) {
    const e0 = edges[(i - 1 + edges.length) % edges.length]; // incoming
    const e1 = edges[i];                                       // outgoing

    const denom = e0.dx * e1.dy - e0.dy * e1.dx;

    if (Math.abs(denom) < 1e-10) {
      // Parallel / anti-parallel edges — just use the start of the outgoing edge
      result.push(new THREE.Vector2(e1.px, e1.py));
      continue;
    }

    // Line–line intersection: e0.p + t·e0.d = e1.p + s·e1.d
    const t = ((e1.px - e0.px) * e1.dy - (e1.py - e0.py) * e1.dx) / denom;
    const ix = e0.px + t * e0.dx;
    const iy = e0.py + t * e0.dy;

    // Miter limit: how far did the vertex travel from the offset line?
    const distFromE1 = Math.hypot(ix - e1.px, iy - e1.py);

    if (distFromE1 > maxDist) {
      // Bevel: two points at the ends of the two adjacent offset edges
      //        (effectively clamps the spike to be no deeper than maxDist)
      const tClamp = t >= 0 ? Math.min(t, maxDist / (Math.hypot(e0.dx, e0.dy) || 1)) : 0;
      result.push(new THREE.Vector2(e0.px + tClamp * e0.dx, e0.py + tClamp * e0.dy));
      result.push(new THREE.Vector2(e1.px, e1.py));
    } else {
      result.push(new THREE.Vector2(ix, iy));
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Step 4 — remove self-intersecting loops
// ---------------------------------------------------------------------------

/**
 * Iteratively find the first pair of non-adjacent crossing edges, shortcut
 * past the loop they create, and repeat until the polygon is clean.
 *
 * Complexity: O(iterations × n²) — very fast for practical SVG shapes where
 * at most a handful of crossings can appear.
 */
function removeSelfIntersections(pts: THREE.Vector2[]): THREE.Vector2[] {
  let current = pts.slice();

  // Upper bound: each pass removes at least 1 vertex, so O(n) passes max.
  for (let iter = 0; iter < pts.length; iter++) {
    const cross = findFirstCrossing(current);
    if (!cross) break; // Clean — done.

    const { i, j, pt } = cross;
    // Remove vertices i+1 … j (the collapsed loop) and insert the crossing pt.
    const next = [
      ...current.slice(0, i + 1),
      pt,
      ...current.slice(j + 1),
    ];
    if (next.length < 3) return [];
    current = next;
  }

  return current;
}

interface Crossing {
  i: number;         // Index of the first edge (i → i+1)
  j: number;         // Index of the second edge (j → j+1)
  pt: THREE.Vector2; // Intersection point
}

function findFirstCrossing(pts: THREE.Vector2[]): Crossing | null {
  const n = pts.length;
  for (let i = 0; i < n - 2; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    // Only test non-adjacent edges (skip i-1 and i+1 neighbours)
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // also adjacent (wrap-around)
      const c = pts[j];
      const d = pts[(j + 1) % n];
      const pt = segmentIntersection(a, b, c, d);
      if (pt) return { i, j, pt };
    }
  }
  return null;
}

/**
 * Strict segment–segment intersection test.
 * Returns the crossing point only when both parameters are in the open
 * interval (0, 1) — touching endpoints are excluded.
 */
function segmentIntersection(
  a: THREE.Vector2, b: THREE.Vector2,
  c: THREE.Vector2, d: THREE.Vector2
): THREE.Vector2 | null {
  const ax = b.x - a.x, ay = b.y - a.y;
  const cx = d.x - c.x, cy = d.y - c.y;
  const denom = ax * cy - ay * cx;
  if (Math.abs(denom) < 1e-10) return null;

  const t = ((c.x - a.x) * cy - (c.y - a.y) * cx) / denom;
  const s = ((c.x - a.x) * ay - (c.y - a.y) * ax) / denom;

  const EPS = 1e-8;
  if (t <= EPS || t >= 1 - EPS || s <= EPS || s >= 1 - EPS) return null;

  return new THREE.Vector2(a.x + t * ax, a.y + t * ay);
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/** Signed area (positive = CCW in Y-up / Three.js coordinate space). */
export function signedArea(pts: THREE.Vector2[]): number {
  let area = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return area / 2;
}
