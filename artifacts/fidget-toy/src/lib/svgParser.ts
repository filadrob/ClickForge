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

/** Run SVGLoader on a serialized SVG string and return all shapes. */
function parseSvgString(svg: string): THREE.Shape[] {
  const loader = new SVGLoader();
  const data   = loader.parse(svg);
  const shapes: THREE.Shape[] = [];
  for (const path of data.paths) shapes.push(...SVGLoader.createShapes(path));
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

export function parseSVGContent(svgContent: string): ParsedSVG {
  // ── 1. Parse to DOM and strip invisible artboard rects ─────────────────
  // Illustrator / Figma / Affinity emit <rect fill="none"> spanning the entire
  // artboard as a bounding-box placeholder.  Strip them first so they don't
  // inflate the bounding box calculation.
  const domParser = new DOMParser();
  const doc       = domParser.parseFromString(svgContent, "image/svg+xml");
  const svgEl     = doc.querySelector("svg");

  if (svgEl) {
    for (const rect of Array.from(doc.querySelectorAll("rect"))) {
      if (isInvisibleRect(rect)) rect.parentElement?.removeChild(rect);
    }
  }

  // ── 2. Read the original viewBox (for fallback and origin normalisation) ─
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

  // ── 3. Pass 1 — normalise the viewBox origin to (0, 0) ─────────────────
  // SVGLoader's behaviour with a non-zero viewBox origin (e.g. "5.2 8.1 640 100")
  // is implementation-dependent: it may or may not subtract the origin before
  // emitting shape coordinates.  To avoid that ambiguity entirely we translate
  // the content in the DOM by (-vbX, -vbY) and rewrite the viewBox to start
  // at (0, 0).  After this transform, SVGLoader's output coordinate space and
  // the SVG DOM coordinate space are guaranteed to share the same origin.
  if (svgEl && (vbX !== 0 || vbY !== 0)) {
    wrapAndReframe(doc, svgEl, -vbX, -vbY, vbW, vbH);
  }

  const pass1Svg    = new XMLSerializer().serializeToString(doc);
  const pass1Shapes = parseSvgString(pass1Svg);

  if (pass1Shapes.length === 0) {
    return { shapes: [], width: vbW, height: vbH };
  }

  // ── 4. Compute the tight content bounding box ───────────────────────────
  // After Pass 1 the SVG has a (0,0) viewBox origin, so SVGLoader output
  // coordinates align with DOM user-unit coordinates.  The tight bbox
  // (minX, minY) is therefore a valid SVG DOM translate value.
  const bounds = shapeBounds(pass1Shapes);
  if (!bounds) {
    return { shapes: pass1Shapes, width: vbW, height: vbH };
  }

  const { minX, minY, w: tightW, h: tightH } = bounds;

  // If the content already starts exactly at (0, 0) we can skip Pass 2.
  const needsShift = minX !== 0 || minY !== 0;

  if (!needsShift) {
    return { shapes: pass1Shapes, width: tightW, height: tightH };
  }

  // ── 5. Pass 2 — translate content so tight bbox origin → (0, 0) ─────────
  // Wrap the Pass-1 DOM (which already has the viewBox-origin correction) in
  // another <g translate(-minX, -minY)> and update the viewBox to the tight
  // dimensions.  This is done in the DOM so that SVGLoader receives clean
  // (0,0)-origin input and produces shapes directly in [0,tightW]×[0,tightH]
  // without any post-processing of shape coordinates.
  const svgEl2 = doc.querySelector("svg")!;
  wrapAndReframe(doc, svgEl2, -minX, -minY, tightW, tightH);

  const pass2Svg    = new XMLSerializer().serializeToString(doc);
  const pass2Shapes = parseSvgString(pass2Svg);

  return {
    shapes: pass2Shapes.length > 0 ? pass2Shapes : pass1Shapes,
    width:  tightW,
    height: tightH,
  };
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
