import * as THREE from "three";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";

export interface ParsedSVG {
  shapes: THREE.Shape[];
  width: number;
  height: number;
}

/**
 * Returns true when a <rect> element is invisible — no fill and no visible stroke.
 * These are artboard boundary markers from Illustrator / Figma / Affinity Designer.
 */
function isInvisibleRect(el: Element): boolean {
  const fill   = (el.getAttribute("fill")   ?? "").trim();
  const stroke = (el.getAttribute("stroke") ?? "").trim();
  const sw     = parseFloat(el.getAttribute("stroke-width") ?? "0");

  const style       = (el.getAttribute("style") ?? "");
  const styleFill   = style.match(/(?:^|;)\s*fill\s*:\s*([^;]+)/i)?.[1]?.trim() ?? "";
  const styleStroke = style.match(/(?:^|;)\s*stroke\s*:\s*([^;]+)/i)?.[1]?.trim() ?? "";
  const styleSW     = parseFloat(style.match(/(?:^|;)\s*stroke-width\s*:\s*([^;]+)/i)?.[1] ?? "0");

  const effectiveFill   = styleFill   || fill;
  const effectiveStroke = styleStroke || stroke;
  const effectiveSW     = isNaN(styleSW) ? sw : styleSW;

  const noFill   = effectiveFill   === "" || effectiveFill   === "none";
  const noStroke = effectiveStroke === "" || effectiveStroke === "none" || effectiveSW === 0;

  // If the element uses a CSS class, its fill may be defined in <defs><style>.
  // We cannot resolve class-based styles here, so treat it as visible.
  const hasClass = (el.getAttribute("class") ?? "").trim() !== "";
  if (hasClass) return false;

  return noFill && noStroke;
}

/**
 * Wrap all direct children of `svgEl` in a new <g> with the given SVG transform,
 * then update the viewBox to "0 0 w h" (removing explicit width/height so the
 * viewBox is the sole size authority).
 *
 * <defs> elements are intentionally kept as direct children of <svg> rather
 * than moved into the <g>.  SVGLoader (and browsers) process <defs> for CSS
 * styles only when they are a direct child of the root <svg> element.  Moving
 * <defs> inside a <g> can cause style lookups to fail, which would reset
 * `fill: none` paths to the SVG default fill (black) or silently break class-
 * based style resolution.
 */
function wrapAndReframe(
  doc: Document,
  svgEl: Element,
  tx: number,
  ty: number,
  w: number,
  h: number,
): void {
  const NS = "http://www.w3.org/2000/svg";
  const g  = doc.createElementNS(NS, "g");
  g.setAttribute("transform", `translate(${tx} ${ty})`);

  // Collect children to move — keep <defs> at the SVG root so CSS styles
  // defined inside them remain accessible to SVGLoader's style resolver.
  const toMove: ChildNode[] = [];
  for (const child of Array.from(svgEl.childNodes)) {
    const tag = (child as Element).tagName?.toLowerCase?.() ?? "";
    if (tag !== "defs") toMove.push(child);
  }
  for (const child of toMove) g.appendChild(child);
  svgEl.appendChild(g);

  svgEl.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svgEl.removeAttribute("width");
  svgEl.removeAttribute("height");
}

/**
 * Inline all <use> elements by replacing them with a deep clone of the
 * element they reference. Handles both local (#id) and same-document hrefs.
 * After this pass SVGLoader never sees a <use> element, so icon-library SVGs
 * that rely on <symbol> + <use> patterns parse correctly.
 */
function inlineUseElements(doc: Document): void {
  const uses = Array.from(doc.querySelectorAll("use"));
  for (const use of uses) {
    const href =
      use.getAttribute("href") ?? use.getAttribute("xlink:href") ?? "";
    if (!href.startsWith("#")) continue; // external refs — skip
    const target = doc.getElementById(href.slice(1));
    if (!target) continue;

    const clone = target.cloneNode(true) as Element;

    // If the target is a <symbol>, replace it with a <g> so SVGLoader
    // processes its children as normal drawable elements.
    if (clone.tagName.toLowerCase() === "symbol") {
      const NS = "http://www.w3.org/2000/svg";
      const g = doc.createElementNS(NS, "g");
      while (clone.firstChild) g.appendChild(clone.firstChild);
      // Copy presentation attributes from the <use> element (x, y, transform)
      for (const attr of Array.from(use.attributes)) {
        if (!["href", "xlink:href", "width", "height"].includes(attr.name)) {
          g.setAttribute(attr.name, attr.value);
        }
      }
      use.parentElement?.replaceChild(g, use);
    } else {
      // Copy position/transform from <use> onto the clone
      for (const attr of Array.from(use.attributes)) {
        if (!["href", "xlink:href"].includes(attr.name)) {
          clone.setAttribute(attr.name, attr.value);
        }
      }
      use.parentElement?.replaceChild(clone, use);
    }
  }
}

/**
 * Convert <polygon> elements to <path> elements, reversing point order if
 * needed so the path winds CCW in SVG Y-down space (negative signed area).
 * SVGLoader.createShapes() treats positive-area (CW in Y-down) paths as holes
 * rather than outer shapes, producing garbage geometry. By guaranteeing CCW
 * winding here, we ensure every polygon is treated as a solid outer boundary.
 */
function convertPolygonsToPath(doc: Document): void {
  const NS = "http://www.w3.org/2000/svg";
  for (const el of Array.from(doc.querySelectorAll("polygon"))) {
    const pointsAttr = el.getAttribute("points") ?? "";
    const nums = pointsAttr.trim().split(/[\s,]+/).map(Number).filter(n => !isNaN(n));
    if (nums.length < 6) continue; // need at least 3 points (6 numbers)

    let coords: [number, number][] = [];
    for (let i = 0; i + 1 < nums.length; i += 2) {
      coords.push([nums[i], nums[i + 1]]);
    }

    // Compute signed area in SVG Y-down space.
    // Negative = CCW in Y-down = outer shape in SVGLoader.
    // Positive = CW in Y-down = hole in SVGLoader.
    // Reverse points if positive so SVGLoader treats this as an outer boundary.
    let area = 0;
    for (let i = 0; i < coords.length; i++) {
      const j = (i + 1) % coords.length;
      area += coords[i][0] * coords[j][1] - coords[j][0] * coords[i][1];
    }
    if (area > 0) coords = coords.reverse();

    const d =
      `M ${coords[0][0]} ${coords[0][1]} ` +
      coords.slice(1).map(([x, y]) => `L ${x} ${y}`).join(" ") +
      " Z";

    const path = doc.createElementNS(NS, "path");
    path.setAttribute("d", d);
    for (const attr of Array.from(el.attributes)) {
      if (attr.name !== "points") path.setAttribute(attr.name, attr.value);
    }
    el.parentElement?.replaceChild(path, el);
  }
}

/**
 * Convert <polyline> elements to closed <path> elements with winding
 * correction. <polyline> is an open path that produces no filled geometry
 * in SVGLoader. Since users uploading a polyline almost always intend a
 * filled shape, we close it and guarantee CCW winding (same logic as
 * convertPolygonsToPath).
 */
function closePolylines(doc: Document): void {
  const NS = "http://www.w3.org/2000/svg";
  for (const el of Array.from(doc.querySelectorAll("polyline"))) {
    const pointsAttr = el.getAttribute("points") ?? "";
    const nums = pointsAttr.trim().split(/[\s,]+/).map(Number).filter(n => !isNaN(n));
    if (nums.length < 6) continue;

    let coords: [number, number][] = [];
    for (let i = 0; i + 1 < nums.length; i += 2) {
      coords.push([nums[i], nums[i + 1]]);
    }

    let area = 0;
    for (let i = 0; i < coords.length; i++) {
      const j = (i + 1) % coords.length;
      area += coords[i][0] * coords[j][1] - coords[j][0] * coords[i][1];
    }
    if (area > 0) coords = coords.reverse();

    const d =
      `M ${coords[0][0]} ${coords[0][1]} ` +
      coords.slice(1).map(([x, y]) => `L ${x} ${y}`).join(" ") +
      " Z";

    const path = doc.createElementNS(NS, "path");
    path.setAttribute("d", d);
    for (const attr of Array.from(el.attributes)) {
      if (attr.name !== "points") path.setAttribute(attr.name, attr.value);
    }
    el.parentElement?.replaceChild(path, el);
  }
}

/**
 * Run SVGLoader on a serialized SVG string and return all shapes.
 * Holes added by SVGLoader's winding-detection heuristic are stripped —
 * the outer-shell silhouette pipeline never uses holes; legitimate cut-outs
 * are handled separately via parseSVGColorRegions.
 * Shapes are sorted descending by filled area so the largest body is [0],
 * preventing a stroke-only outline path at the front of the document from
 * being picked as the shell/clicker silhouette.
 */
function parseSvgString(svg: string): THREE.Shape[] {
  const loader = new SVGLoader();
  const data   = loader.parse(svg);
  const shapes: THREE.Shape[] = [];
  for (const path of data.paths) {
    const created = SVGLoader.createShapes(path);
    for (const shape of created) {
      // SVGLoader sometimes adds a polygon's own subpath as a hole when
      // winding detection misfires (particularly for <polygon> elements whose
      // ShapePath lacks autoClose). Strip all parser-imposed holes — the outer
      // shell silhouette pipeline never uses holes; legitimate cut-outs are
      // handled separately via parseSVGColorRegions.
      shape.holes = [];
      shapes.push(shape);
    }
  }

  // Sort descending by polygon area so the largest filled body is always [0].
  // This prevents a stroke-only outline path that appears first in document
  // order from being picked as the shell/clicker silhouette.
  shapes.sort((a, b) => {
    const areaOf = (s: THREE.Shape) => {
      const pts = s.getPoints(64);
      let area = 0;
      for (let i = 0; i < pts.length; i++) {
        const j = (i + 1) % pts.length;
        area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
      }
      return Math.abs(area / 2);
    };
    return areaOf(b) - areaOf(a);
  });

  return shapes;
}

/** Compute the tight axis-aligned bounding box of all shape points. */
function shapeBounds(shapes: THREE.Shape[]): { minX: number; minY: number; w: number; h: number } | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const shape of shapes) {
    for (const pt of shape.getPoints(128)) {
      if (pt.x < minX) minX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y > maxY) maxY = pt.y;
    }
  }
  return isFinite(minX) ? { minX, minY, w: maxX - minX, h: maxY - minY } : null;
}

/**
 * Run the same two-pass DOM normalisation used by `parseSVGContent`:
 *   pass 1 — translate the viewBox origin to (0, 0)
 *   pass 2 — wrap content so the tight bbox origin is also (0, 0)
 *
 * Returns the final normalised SVG string plus its content dimensions.
 * Callers can then run `SVGLoader.parse(svg)` on the result to get shapes
 * and per-path metadata (fill colour, etc.) in a clean coord space.
 */
function normalizeSvgForParsing(svgContent: string): { svg: string; width: number; height: number } {
  const domParser = new DOMParser();
  const doc       = domParser.parseFromString(svgContent, "image/svg+xml");
  const svgEl     = doc.querySelector("svg");

  if (svgEl) {
    for (const rect of Array.from(doc.querySelectorAll("rect"))) {
      if (isInvisibleRect(rect)) rect.parentElement?.removeChild(rect);
    }
  }

  // Inline <use>/<symbol> references so SVGLoader sees concrete elements
  inlineUseElements(doc);

  // Convert <polygon> to winding-corrected <path> so SVGLoader treats them
  // as outer boundaries, not holes
  convertPolygonsToPath(doc);

  // Close open <polyline> elements into winding-corrected closed <path> shapes
  closePolylines(doc);

  let vbX = 0, vbY = 0, vbW = 100, vbH = 100;
  if (svgEl) {
    const vb = svgEl.getAttribute("viewBox");
    if (vb) {
      const p = vb.split(/[\s,]+/).map(Number);
      if (p.length === 4) { [vbX, vbY, vbW, vbH] = p; }
    } else {
      const w = parseFloat(svgEl.getAttribute("width")  ?? "100");
      const h = parseFloat(svgEl.getAttribute("height") ?? "100");
      if (!isNaN(w)) vbW = w;
      if (!isNaN(h)) vbH = h;
    }
  }

  if (svgEl && (vbX !== 0 || vbY !== 0)) {
    wrapAndReframe(doc, svgEl, -vbX, -vbY, vbW, vbH);
  }

  const pass1Svg    = new XMLSerializer().serializeToString(doc);
  const pass1Shapes = parseSvgString(pass1Svg);

  if (pass1Shapes.length === 0) {
    return { svg: pass1Svg, width: vbW, height: vbH };
  }

  const bounds = shapeBounds(pass1Shapes);
  if (!bounds) {
    return { svg: pass1Svg, width: vbW, height: vbH };
  }

  const { minX, minY, w: tightW, h: tightH } = bounds;

  if (minX === 0 && minY === 0) {
    return { svg: pass1Svg, width: tightW, height: tightH };
  }

  const svgEl2 = doc.querySelector("svg")!;
  wrapAndReframe(doc, svgEl2, -minX, -minY, tightW, tightH);

  const pass2Svg = new XMLSerializer().serializeToString(doc);
  return { svg: pass2Svg, width: tightW, height: tightH };
}

export function parseSVGContent(svgContent: string): ParsedSVG & { warnings: string[] } {
  const warnings: string[] = [];

  // Detect unsupported elements and warn
  const domParser = new DOMParser();
  const doc = domParser.parseFromString(svgContent, "image/svg+xml");
  if (doc.querySelector("text, tspan, textPath")) {
    warnings.push(
      "This SVG contains text elements, which are not supported and will be ignored. " +
      "To include text in your design, convert it to outlines in your SVG editor first."
    );
  }
  if (doc.querySelector("image")) {
    warnings.push(
      "This SVG contains an embedded image, which is not supported and will be ignored."
    );
  }

  const { svg, width, height } = normalizeSvgForParsing(svgContent);
  const shapes = parseSvgString(svg);
  return { shapes, width, height, warnings };
}

/**
 * Group every visibly-filled SVGLoader path into a list of color regions.
 * Each entry has a normalised hex color and the THREE.Shapes that share it.
 *
 * - Skips paths whose fill is `none`, `transparent`, or empty.
 * - Skips paths whose fill matches the dominant outer-shell silhouette color
 *   (as resolved by `extractSvgColor`) so the silhouette is never duplicated
 *   as a flat color body.
 * - Applies the same two-pass bounding-box normalisation used by
 *   `parseSVGContent` so returned shapes share the main shape's coordinate
 *   space.
 */
export function parseSVGColorRegions(
  svgContent: string,
): Array<{ color: string; shapes: THREE.Shape[] }> {
  const { svg } = normalizeSvgForParsing(svgContent);

  const loader = new SVGLoader();
  let data: ReturnType<typeof loader.parse>;
  try {
    data = loader.parse(svg);
  } catch {
    return [];
  }

  // Group every visibly-filled path by its resolved hex color.  The dominant
  // silhouette is identified by total filled area (sum across the colour's
  // shapes minus their holes), not by document order — this keeps detail
  // paths that happen to appear first in the SVG from being mis-classified
  // as the silhouette.
  const groups = new Map<string, THREE.Shape[]>();
  for (const path of data.paths) {
    const fill = (path.userData as { style?: { fill?: string } } | undefined)?.style?.fill;
    if (!fill || fill === "none" || fill === "transparent" || fill === "") continue;
    let hex: string;
    try {
      hex = `#${new THREE.Color(fill).getHexString()}`;
    } catch {
      continue;
    }
    const shapes = SVGLoader.createShapes(path);
    if (shapes.length === 0) continue;
    const list = groups.get(hex);
    if (list) list.push(...shapes);
    else groups.set(hex, [...shapes]);
  }

  if (groups.size === 0) return [];

  // Determine the dominant outer silhouette colour by total filled area.
  let dominant: string | null = null;
  let dominantArea = -Infinity;
  for (const [color, shapes] of groups.entries()) {
    let area = 0;
    for (const s of shapes) area += filledShapeArea(s);
    if (area > dominantArea) {
      dominantArea = area;
      dominant = color;
    }
  }

  return Array.from(groups.entries())
    .filter(([color]) => color !== dominant)
    .map(([color, shapes]) => ({ color, shapes }));
}

/** Absolute polygon area via the shoelace formula. */
function polyAreaAbs(pts: THREE.Vector2[]): number {
  let a = 0;
  const n = pts.length;
  if (n < 3) return 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return Math.abs(a) * 0.5;
}

/** Net filled area of a THREE.Shape (outer minus holes), tessellated coarsely. */
function filledShapeArea(shape: THREE.Shape): number {
  const { shape: outer, holes } = shape.extractPoints(12);
  let area = polyAreaAbs(outer);
  for (const hole of holes) area -= polyAreaAbs(hole);
  return Math.max(0, area);
}

/**
 * Extract the dominant color from an SVG string.
 * Priority: first non-none fill → first non-none stroke → fallback.
 * Leverages SVGLoader's built-in CSS / inline-style resolver so that
 * class-based, inline-style, and attribute-based colours all work.
 */
export function extractSvgColor(svgContent: string, fallback = "#a888d8"): string {
  const loader = new SVGLoader();
  let data: ReturnType<typeof loader.parse>;
  try {
    data = loader.parse(svgContent);
  } catch {
    return fallback;
  }

  const isVisible = (c: string | undefined) =>
    c && c !== "none" && c !== "transparent" && c !== "";

  // Pass 1 — fills
  for (const path of data.paths) {
    const fill = (path.userData as { style?: { fill?: string } } | undefined)
      ?.style?.fill;
    if (isVisible(fill)) {
      try {
        return `#${new THREE.Color(fill!).getHexString()}`;
      } catch { /* invalid colour string — skip */ }
    }
  }

  // Pass 2 — strokes
  for (const path of data.paths) {
    const stroke = (path.userData as { style?: { stroke?: string } } | undefined)
      ?.style?.stroke;
    if (isVisible(stroke)) {
      try {
        return `#${new THREE.Color(stroke!).getHexString()}`;
      } catch { /* invalid colour string — skip */ }
    }
  }

  return fallback;
}

/**
 * Create a square hole shape (for the keycap negative space)
 * centered at the given position with the given size.
 */
export function createSquareHole(centerX: number, centerY: number, size: number): THREE.Path {
  const half = size / 2;
  const hole = new THREE.Path();
  hole.moveTo(centerX - half, centerY - half);
  hole.lineTo(centerX + half, centerY - half);
  hole.lineTo(centerX + half, centerY + half);
  hole.lineTo(centerX - half, centerY + half);
  hole.closePath();
  return hole;
}

/**
 * Create a circle shape for the peg.
 */
export function createCircle(centerX: number, centerY: number, radius: number): THREE.Shape {
  const shape = new THREE.Shape();
  shape.absarc(centerX, centerY, radius, 0, Math.PI * 2, false);
  return shape;
}
