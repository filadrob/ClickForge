// ── JigInput / JigOutput ──────────────────────────────────────────────────
// Types for the UV Print Jig geometry engine.
// See spec.md §Story 1 for field definitions and units.

export type JigInput = {
  /** Raw SVG path data (the `d` attribute string of one or more <path> elements,
   *  or a full SVG string).  Passed through SVGLoader → tessellation. */
  svgPaths: string;
  pieceType: "inner" | "outer";
  clearance: number; // mm
  gap: number; // mm (outer shell only)
  wallThickness: number; // mm (outer shell only)
  lugRadius: number; // mm (outer shell only)
  lugCenter: { x: number; y: number }; // mm (outer shell only)
  extrudeDepth: number; // mm — jig Z height, read from studio state
  jigWidth: number; // mm
  jigHeight: number; // mm
  rows: number;
  cols: number;
  spacing: number; // mm — minimum gap between cavities
  zAdjust: number; // mm, range -2 to +2
  mirrorX: boolean;
};

export type JigOutput = {
  cavityPolygon: number[][]; // 2D points [x, y] of offset+unioned cavity profile (mm)
  cavityBBox: { w: number; h: number }; // bounding box in mm
  jigZ: number; // extrudeDepth + zAdjust
  fits: boolean; // whether rows/cols fit in jig dimensions
  errorMessage?: string; // if !fits, human-readable reason
  evenSpacing: { x: number; y: number }; // computed even spacing between cavity centres
};
