/**
 * /jig-test — Dev-only verification page for the Jig Geometry Engine.
 * NOT linked from navigation. Accessible only in dev mode.
 *
 * Calls computeJigCavity() directly and renders the full JigOutput as JSON.
 * Pre-filled with values matching the spec.md §Story 1 sanity check scenarios.
 */

import { useState } from "react";
import { computeJigCavity } from "@/lib/jig/cavity";
import type { JigInput, JigOutput } from "@/lib/jig/types";

// ── Default test SVG: a 40×40mm square ────────────────────────────────────
// The SVG viewBox is 40×40 (units = mm equivalent), so tessellateShape()
// will produce a 40×40mm polygon centred at origin.
const SQUARE_40_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">
  <rect x="0" y="0" width="40" height="40" fill="black"/>
</svg>`;

const defaultInput: JigInput = {
  svgPaths: SQUARE_40_SVG,
  pieceType: "inner",
  clearance: 0.15,
  gap: 1,
  wallThickness: 1,
  lugRadius: 5,
  lugCenter: { x: 0, y: 22.15 }, // bisects top edge: 40/2 + 44.3/2 ≈ top of offsetPoly
  extrudeDepth: 9.4,
  jigWidth: 90,
  jigHeight: 90,
  rows: 1,
  cols: 1,
  spacing: 2,
  zAdjust: 0,
  mirrorX: false,
};

// ── Scenarios for one-click testing ───────────────────────────────────────

interface Scenario {
  label: string;
  overrides: Partial<JigInput> & { lugCenter?: { x: number; y: number } };
  expectedBBox: string;
}

const scenarios: Scenario[] = [
  {
    label: "Scenario 1 — Inner clicker, 40×40mm square",
    overrides: { pieceType: "inner", clearance: 0.15 },
    expectedBBox: "40.3 × 40.3mm",
  },
  {
    label: "Scenario 2 — Outer shell, 40×40mm, no lug (lugRadius=0)",
    overrides: {
      pieceType: "outer",
      clearance: 0.15,
      gap: 1,
      wallThickness: 1,
      lugRadius: 0,
    },
    expectedBBox: "44.3 × 44.3mm",
  },
  {
    label: "Scenario 3 — Outer shell, 40×40mm, lug r=5 bisecting top edge",
    overrides: {
      pieceType: "outer",
      clearance: 0.15,
      gap: 1,
      wallThickness: 1,
      lugRadius: 5,
      lugCenter: { x: 0, y: 22.15 }, // centred horizontally, bisects top of offset poly
    },
    expectedBBox: "44.3 × 49.45mm (approx)",
  },
  {
    label: "Scenario 4 — 2×2 layout, cavityBBox ~44.3×49.45, jig 90×90 → fits=false",
    overrides: {
      pieceType: "outer",
      clearance: 0.15,
      gap: 1,
      wallThickness: 1,
      lugRadius: 5,
      lugCenter: { x: 0, y: 22.15 },
      rows: 2,
      cols: 2,
      spacing: 2,
      jigWidth: 90,
      jigHeight: 90,
    },
    expectedBBox: "fits=false, error references ~106.9mm height",
  },
];

// ── Form field helpers ─────────────────────────────────────────────────────

function NumField({
  label,
  value,
  onChange,
  step = 0.01,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
      <label style={{ minWidth: 160, fontFamily: "monospace", fontSize: 13 }}>
        {label}
      </label>
      <input
        type="number"
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        style={{ width: 100, fontFamily: "monospace", fontSize: 13, padding: 2 }}
      />
    </div>
  );
}

// ── Page component ─────────────────────────────────────────────────────────

export default function JigTestPage() {
  const [input, setInput] = useState<JigInput>(defaultInput);
  const [output, setOutput] = useState<JigOutput | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);

  function set<K extends keyof JigInput>(key: K, value: JigInput[K]) {
    setInput((prev) => ({ ...prev, [key]: value }));
  }

  function runCompute() {
    const t0 = performance.now();
    try {
      const result = computeJigCavity(input);
      setOutput(result);
    } catch (err) {
      setOutput({
        cavityPolygon: [],
        cavityBBox: { w: 0, h: 0 },
        jigZ: 0,
        fits: false,
        errorMessage: String(err),
        evenSpacing: { x: 0, y: 0 },
      });
    }
    setElapsed(performance.now() - t0);
  }

  function loadScenario(s: Scenario) {
    setInput((prev) => ({
      ...defaultInput,
      ...prev,
      svgPaths: SQUARE_40_SVG,
      ...s.overrides,
    }));
    setOutput(null);
    setElapsed(null);
  }

  const summaryStyle: React.CSSProperties = {
    fontFamily: "monospace",
    fontSize: 14,
    background: output?.fits ? "#d4edda" : "#f8d7da",
    padding: "12px 16px",
    borderRadius: 6,
    marginBottom: 12,
    border: `1px solid ${output?.fits ? "#c3e6cb" : "#f5c6cb"}`,
  };

  return (
    <div
      style={{
        maxWidth: 900,
        margin: "0 auto",
        padding: 24,
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>🔧 Jig Geometry Engine — Test Page</h1>
      <p style={{ fontSize: 13, color: "#666", marginBottom: 20 }}>
        Dev-only verification route (<code>/jig-test</code>). Not linked from navigation.
      </p>

      {/* Quick scenario buttons */}
      <section style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 15, marginBottom: 8 }}>Quick Scenarios</h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {scenarios.map((s, i) => (
            <button
              key={i}
              onClick={() => loadScenario(s)}
              style={{
                padding: "6px 12px",
                fontSize: 12,
                cursor: "pointer",
                background: "#f0f0f0",
                border: "1px solid #ccc",
                borderRadius: 4,
              }}
            >
              S{i + 1}: {s.label.split("—")[1]?.trim() ?? s.label}
            </button>
          ))}
        </div>
        {scenarios.map((s, i) => (
          <div key={i} style={{ fontSize: 12, color: "#555", marginTop: 4 }}>
            <strong>S{i + 1}:</strong> {s.label} — Expected: <em>{s.expectedBBox}</em>
          </div>
        ))}
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        {/* Left: Inputs */}
        <section>
          <h2 style={{ fontSize: 15, marginBottom: 12 }}>Inputs</h2>

          {/* SVG Paths */}
          <div style={{ marginBottom: 8 }}>
            <label
              style={{ display: "block", fontFamily: "monospace", fontSize: 13, marginBottom: 4 }}
            >
              svgPaths (SVG string or path d-attr):
            </label>
            <textarea
              rows={5}
              value={input.svgPaths}
              onChange={(e) => set("svgPaths", e.target.value)}
              style={{
                width: "100%",
                fontFamily: "monospace",
                fontSize: 11,
                padding: 4,
                boxSizing: "border-box",
              }}
            />
          </div>

          {/* Piece type */}
          <div style={{ marginBottom: 8 }}>
            <span style={{ fontFamily: "monospace", fontSize: 13, marginRight: 8 }}>
              pieceType:
            </span>
            <label style={{ marginRight: 12, fontSize: 13 }}>
              <input
                type="radio"
                checked={input.pieceType === "inner"}
                onChange={() => set("pieceType", "inner")}
              />{" "}
              inner
            </label>
            <label style={{ fontSize: 13 }}>
              <input
                type="radio"
                checked={input.pieceType === "outer"}
                onChange={() => set("pieceType", "outer")}
              />{" "}
              outer
            </label>
          </div>

          <NumField label="clearance (mm)" value={input.clearance} onChange={(v) => set("clearance", v)} step={0.05} />
          <NumField label="gap (mm)" value={input.gap} onChange={(v) => set("gap", v)} />
          <NumField label="wallThickness (mm)" value={input.wallThickness} onChange={(v) => set("wallThickness", v)} />
          <NumField label="lugRadius (mm)" value={input.lugRadius} onChange={(v) => set("lugRadius", v)} />
          <NumField label="lugCenter.x (mm)" value={input.lugCenter.x} onChange={(v) => set("lugCenter", { ...input.lugCenter, x: v })} />
          <NumField label="lugCenter.y (mm)" value={input.lugCenter.y} onChange={(v) => set("lugCenter", { ...input.lugCenter, y: v })} />
          <NumField label="extrudeDepth (mm)" value={input.extrudeDepth} onChange={(v) => set("extrudeDepth", v)} />
          <NumField label="jigWidth (mm)" value={input.jigWidth} onChange={(v) => set("jigWidth", v)} />
          <NumField label="jigHeight (mm)" value={input.jigHeight} onChange={(v) => set("jigHeight", v)} />
          <NumField label="rows" value={input.rows} onChange={(v) => set("rows", Math.max(1, Math.round(v)))} step={1} />
          <NumField label="cols" value={input.cols} onChange={(v) => set("cols", Math.max(1, Math.round(v)))} step={1} />
          <NumField label="spacing (mm)" value={input.spacing} onChange={(v) => set("spacing", v)} />
          <NumField label="zAdjust (mm)" value={input.zAdjust} onChange={(v) => set("zAdjust", v)} step={0.1} />

          <div style={{ marginBottom: 8 }}>
            <label style={{ fontFamily: "monospace", fontSize: 13 }}>
              <input
                type="checkbox"
                checked={input.mirrorX}
                onChange={(e) => set("mirrorX", e.target.checked)}
                style={{ marginRight: 6 }}
              />
              mirrorX
            </label>
          </div>

          <button
            id="jig-test-compute"
            onClick={runCompute}
            style={{
              marginTop: 12,
              padding: "8px 20px",
              fontSize: 14,
              fontWeight: "bold",
              cursor: "pointer",
              background: "#0070f3",
              color: "white",
              border: "none",
              borderRadius: 6,
            }}
          >
            Compute Jig Cavity
          </button>
        </section>

        {/* Right: Output */}
        <section>
          <h2 style={{ fontSize: 15, marginBottom: 12 }}>Output</h2>

          {output === null && (
            <p style={{ color: "#888", fontStyle: "italic" }}>
              Press "Compute Jig Cavity" to see results.
            </p>
          )}

          {output !== null && (
            <>
              <div style={summaryStyle}>
                <div>
                  <strong>cavityBBox:</strong>{" "}
                  {output.cavityBBox.w.toFixed(3)} × {output.cavityBBox.h.toFixed(3)} mm
                </div>
                <div>
                  <strong>jigZ:</strong> {output.jigZ.toFixed(3)} mm
                </div>
                <div>
                  <strong>fits:</strong> {output.fits ? "✅ YES" : "❌ NO"}
                </div>
                {output.errorMessage && (
                  <div style={{ color: "#721c24", marginTop: 4 }}>
                    <strong>error:</strong> {output.errorMessage}
                  </div>
                )}
                {output.fits && (
                  <div>
                    <strong>evenSpacing:</strong> x={output.evenSpacing.x.toFixed(3)}mm,{" "}
                    y={output.evenSpacing.y.toFixed(3)}mm
                  </div>
                )}
                {elapsed !== null && (
                  <div style={{ marginTop: 4, color: "#555", fontSize: 12 }}>
                    Computed in {elapsed.toFixed(1)}ms
                  </div>
                )}
              </div>

              <h3 style={{ fontSize: 13, marginBottom: 4 }}>Full JigOutput JSON:</h3>
              <pre
                id="jig-test-output"
                style={{
                  background: "#f5f5f5",
                  border: "1px solid #ddd",
                  padding: 12,
                  borderRadius: 4,
                  fontSize: 11,
                  fontFamily: "monospace",
                  overflow: "auto",
                  maxHeight: 480,
                  whiteSpace: "pre-wrap",
                }}
              >
                {JSON.stringify(
                  {
                    ...output,
                    cavityPolygon: `[${output.cavityPolygon.length} points — truncated]`,
                  },
                  null,
                  2,
                )}
              </pre>

              {output.cavityPolygon.length > 0 && (
                <>
                  <h3 style={{ fontSize: 13, marginTop: 12, marginBottom: 4 }}>
                    Cavity Preview (SVG, not to scale):
                  </h3>
                  <CavityPreview polygon={output.cavityPolygon} />
                </>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

// ── Simple SVG preview of the cavity polygon ──────────────────────────────

function CavityPreview({ polygon }: { polygon: number[][] }) {
  if (polygon.length < 3) return null;

  const SIZE = 200;
  const PAD = 10;

  let minX = polygon[0][0],
    maxX = polygon[0][0];
  let minY = polygon[0][1],
    maxY = polygon[0][1];
  for (const [x, y] of polygon) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const w = maxX - minX || 1;
  const h = maxY - minY || 1;
  const scale = Math.min((SIZE - 2 * PAD) / w, (SIZE - 2 * PAD) / h);

  const pts = polygon
    .map(([x, y]) => {
      const sx = (x - minX) * scale + PAD;
      // SVG Y-down — flip back
      const sy = (maxY - y) * scale + PAD;
      return `${sx.toFixed(2)},${sy.toFixed(2)}`;
    })
    .join(" ");

  return (
    <svg
      width={SIZE}
      height={SIZE}
      style={{ border: "1px solid #ccc", background: "#fff", display: "block" }}
    >
      <polygon points={pts} fill="#bde0ff" stroke="#0070f3" strokeWidth={1} />
    </svg>
  );
}
