import { useState, useEffect, useRef, useCallback } from "react";
import {
  X, Download, ArrowRight, ArrowLeft, Loader2, ImageIcon,
  ZoomIn, ZoomOut, Maximize2, MousePointerClick,
} from "lucide-react";
import { Button } from "@/components/ui/button";
// @ts-ignore — no types for imagetracerjs
import ImageTracer from "imagetracerjs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Props {
  file: File;
  onClose: () => void;
  onApply: (svgString: string, fileName: string) => void;
}

interface TraceOptions {
  numColors: number;
  simplification: number;
  removeBackground: boolean;
  bgTolerance: number;
}

interface Viewport {
  zoom: number;
  panX: number;
  panY: number;
}

interface TracedPath {
  id: number;
  d: string;
  fill: string;
}

interface SVGMeta {
  viewBox: string;
  width: string;
  height: string;
}

type Phase = "trace" | "pick";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_OPTS: TraceOptions = {
  numColors: 4,
  simplification: 3,
  removeBackground: true,
  bgTolerance: 40,
};
const DEFAULT_VP: Viewport = { zoom: 1, panX: 0, panY: 0 };
const MAX_DIM = 800;

// ---------------------------------------------------------------------------
// Image processing helpers
// ---------------------------------------------------------------------------

function floodFillBackground(imageData: ImageData, tolerance: number): ImageData {
  const { data, width, height } = imageData;
  const result = new Uint8ClampedArray(data);
  const visited = new Uint8Array(width * height);
  const corners: [number, number][] = [
    [0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1],
  ];
  for (const [cx, cy] of corners) {
    const ci = (cy * width + cx) * 4;
    if (data[ci + 3] < 128) continue;
    const cr = data[ci], cg = data[ci + 1], cb = data[ci + 2];
    const pi = cy * width + cx;
    if (visited[pi]) continue;
    visited[pi] = 1;
    const queue: number[] = [pi];
    let head = 0;
    while (head < queue.length) {
      const p = queue[head++];
      const di = p * 4;
      const dist = Math.sqrt(
        (data[di] - cr) ** 2 + (data[di + 1] - cg) ** 2 + (data[di + 2] - cb) ** 2
      );
      if (dist > tolerance) continue;
      result[di + 3] = 0;
      const py = Math.floor(p / width);
      const px = p % width;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as [number, number][]) {
        const nx = px + dx, ny = py + dy;
        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
          const ni = ny * width + nx;
          if (!visited[ni]) { visited[ni] = 1; queue.push(ni); }
        }
      }
    }
  }
  return new ImageData(result, width, height);
}

function trimTransparentBorder(imageData: ImageData): ImageData {
  const { data, width, height } = imageData;
  let left = width, right = -1, top = height, bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 0) {
        left = Math.min(left, x); right = Math.max(right, x);
        top = Math.min(top, y); bottom = Math.max(bottom, y);
      }
    }
  }
  if (right < left || bottom < top) return imageData;
  const cropWidth = right - left + 1;
  const cropHeight = bottom - top + 1;
  const cropped = new Uint8ClampedArray(cropWidth * cropHeight * 4);
  for (let y = 0; y < cropHeight; y++) {
    for (let x = 0; x < cropWidth; x++) {
      const src = ((top + y) * width + (left + x)) * 4;
      const dst = (y * cropWidth + x) * 4;
      cropped[dst] = data[src]; cropped[dst + 1] = data[src + 1];
      cropped[dst + 2] = data[src + 2]; cropped[dst + 3] = data[src + 3];
    }
  }
  return new ImageData(cropped, cropWidth, cropHeight);
}

async function loadImageData(
  file: File, removeBackground: boolean, bgTolerance: number
): Promise<ImageData> {
  const url = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let w = img.naturalWidth, h = img.naturalHeight;
      if (w > MAX_DIM || h > MAX_DIM) {
        const r = Math.min(MAX_DIM / w, MAX_DIM / h);
        w = Math.round(w * r); h = Math.round(h * r);
      }
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      let imageData = ctx.getImageData(0, 0, w, h);
      if (removeBackground) {
        imageData = floodFillBackground(imageData, bgTolerance);
        imageData = trimTransparentBorder(imageData);
      }
      resolve(imageData);
    };
    img.onerror = reject;
    img.crossOrigin = "anonymous";
    img.src = url;
  });
}

// ---------------------------------------------------------------------------
// SVG helpers
// ---------------------------------------------------------------------------

function traceToSVG(imageData: ImageData, opts: TraceOptions): string {
  const ltres = opts.simplification * 1.2;
  const svg = ImageTracer.imagedataToSVG(imageData, {
    numberofcolors: opts.numColors,
    ltres, qtres: ltres,
    scale: 1,
    strokewidth: 0,
    linefilter: opts.simplification > 5,
    rightangleenhance: false,
  }) as string;
  return svg
    .replace(/\sfill="none"/g, "")
    .replace(/\sstroke="none"/g, "")
    .replace(/\sfill='none'/g, "")
    .replace(/\sstroke='none'/g, "");
}

function parseSVGPaths(svg: string): { paths: TracedPath[]; meta: SVGMeta } {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svg, "image/svg+xml");
  const svgEl = doc.querySelector("svg");
  const meta: SVGMeta = {
    viewBox: svgEl?.getAttribute("viewBox") ?? "0 0 100 100",
    width: svgEl?.getAttribute("width") ?? "100",
    height: svgEl?.getAttribute("height") ?? "100",
  };
  const pathEls = doc.querySelectorAll("path");
  const paths: TracedPath[] = Array.from(pathEls)
    .map((el, i) => ({
      id: i,
      d: el.getAttribute("d") ?? "",
      fill: el.getAttribute("fill") ?? "#000000",
    }))
    .filter((p) => p.d.length > 0);
  return { paths, meta };
}

function buildSVGFromPaths(paths: TracedPath[], meta: SVGMeta): string {
  const pathStr = paths
    .map((p) => `  <path fill="${p.fill}" d="${p.d}"/>`)
    .join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${meta.width}" height="${meta.height}" viewBox="${meta.viewBox}">\n${pathStr}\n</svg>`;
}

function downloadSVG(svg: string, name: string) {
  const blob = new Blob([svg], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// SliderControl
// ---------------------------------------------------------------------------

function SliderControl({
  label, value, min, max, step, onChange, hint,
}: {
  label: string; value: number; min: number; max: number;
  step: number; onChange: (v: number) => void; hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between items-baseline">
        <label className="text-xs font-medium text-foreground">{label}</label>
        <span className="text-xs text-muted-foreground tabular-nums">{value}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1.5 rounded-full accent-primary cursor-pointer"
      />
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ZoomPane — a scrollable/pannable container used in both phases
// ---------------------------------------------------------------------------

function ZoomPane({
  vp, onWheel, onMouseDown, children, overlay, className,
}: {
  vp: Viewport;
  onWheel: (e: WheelEvent) => void;
  onMouseDown: (e: React.MouseEvent) => void;
  children: React.ReactNode;
  overlay?: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [onWheel]);

  return (
    <div
      ref={ref}
      className={`flex-1 relative overflow-hidden select-none ${className ?? ""}`}
      style={{ cursor: vp.zoom > 1 ? "grab" : "default" }}
      onMouseDown={onMouseDown}
    >
      <div
        style={{
          position: "absolute", inset: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          transform: `translate(${vp.panX}px, ${vp.panY}px) scale(${vp.zoom})`,
          transformOrigin: "center center",
          willChange: "transform",
        }}
      >
        {children}
      </div>
      {overlay}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function RasterToSvgModal({ file, onClose, onApply }: Props) {
  const [opts, setOpts] = useState<TraceOptions>(DEFAULT_OPTS);
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [svgOutput, setSvgOutput] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Phase & pick state
  const [phase, setPhase] = useState<Phase>("trace");
  const [tracedPaths, setTracedPaths] = useState<TracedPath[]>([]);
  const [svgMeta, setSvgMeta] = useState<SVGMeta | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [hoveredId, setHoveredId] = useState<number | null>(null);

  // ── Viewport (shared across phases) ──────────────────────────────────────
  const [vp, setVp] = useState<Viewport>(DEFAULT_VP);
  const isPanning = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });

  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const el = e.currentTarget as HTMLDivElement;
    const rect = el.getBoundingClientRect();
    const ocx = e.clientX - rect.left - rect.width / 2;
    const ocy = e.clientY - rect.top - rect.height / 2;
    setVp((prev) => {
      const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
      const newZoom = Math.min(16, Math.max(0.2, prev.zoom * factor));
      const imgX = (ocx - prev.panX) / prev.zoom;
      const imgY = (ocy - prev.panY) / prev.zoom;
      return { zoom: newZoom, panX: ocx - imgX * newZoom, panY: ocy - imgY * newZoom };
    });
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    isPanning.current = true;
    lastMouse.current = { x: e.clientX, y: e.clientY };
    e.preventDefault();
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning.current) return;
    const dx = e.clientX - lastMouse.current.x;
    const dy = e.clientY - lastMouse.current.y;
    lastMouse.current = { x: e.clientX, y: e.clientY };
    setVp((prev) => ({ ...prev, panX: prev.panX + dx, panY: prev.panY + dy }));
  }, []);

  const stopPan = useCallback(() => { isPanning.current = false; }, []);
  const zoomBy = (factor: number) =>
    setVp((p) => ({ ...p, zoom: Math.min(16, Math.max(0.2, p.zoom * factor)) }));

  // ── Tracing ───────────────────────────────────────────────────────────────
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestOpts = useRef(opts);
  latestOpts.current = opts;

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setOriginalUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const runTrace = useCallback(async (currentOpts: TraceOptions) => {
    setIsProcessing(true);
    setError(null);
    try {
      const imageData = await loadImageData(
        file, currentOpts.removeBackground, currentOpts.bgTolerance
      );
      const svg = traceToSVG(imageData, currentOpts);
      setSvgOutput(svg);
      // Pre-parse for the picker (don't switch phases yet)
      const { paths, meta } = parseSVGPaths(svg);
      setTracedPaths(paths);
      setSvgMeta(meta);
      setSelectedIds(new Set(paths.map((p) => p.id)));
    } catch (e) {
      setError("Conversion failed — try adjusting the settings.");
      console.error(e);
    } finally {
      setIsProcessing(false);
    }
  }, [file]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runTrace(latestOpts.current), 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts, runTrace]);

  // ── Pick phase helpers ────────────────────────────────────────────────────
  const togglePath = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const enterPickPhase = () => {
    setVp(DEFAULT_VP);
    setPhase("pick");
  };

  const applySelection = () => {
    if (!svgMeta || selectedIds.size === 0) return;
    const selected = tracedPaths.filter((p) => selectedIds.has(p.id));
    const svg = buildSVGFromPaths(selected, svgMeta);
    const baseName = file.name.replace(/\.(png|jpe?g|webp)$/i, "");
    onApply(svg, `${baseName}.svg`);
  };

  // ── Derived ───────────────────────────────────────────────────────────────
  const svgDataUrl = svgOutput
    ? `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgOutput)))}`
    : null;
  const baseName = file.name.replace(/\.(png|jpe?g|webp)$/i, "");
  const svgFileName = `${baseName}.svg`;

  // ── Zoom toolbar (shared) ─────────────────────────────────────────────────
  const zoomBar = (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 bg-card/95 backdrop-blur border border-border rounded-lg shadow px-2 py-1 pointer-events-auto">
      <button
        onClick={() => zoomBy(1.5)}
        className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
        title="Zoom in"
      >
        <ZoomIn className="h-3.5 w-3.5" />
      </button>
      <span className="text-[11px] tabular-nums text-muted-foreground w-10 text-center">
        {Math.round(vp.zoom * 100)}%
      </span>
      <button
        onClick={() => zoomBy(1 / 1.5)}
        className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
        title="Zoom out"
      >
        <ZoomOut className="h-3.5 w-3.5" />
      </button>
      <div className="w-px h-4 bg-border mx-0.5" />
      <button
        onClick={() => setVp(DEFAULT_VP)}
        className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
        title="Reset view"
      >
        <Maximize2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.55)" }}
    >
      <div
        className="relative bg-card border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        style={{
          width: phase === "pick" ? "min(1100px, 96vw)" : "min(960px, 96vw)",
          maxHeight: "92vh",
          transition: "width 0.2s ease",
        }}
        onMouseMove={handleMouseMove}
        onMouseUp={stopPan}
        onMouseLeave={stopPan}
      >
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div>
            <h2 className="text-base font-semibold text-foreground">
              {phase === "trace" ? "Convert Image to SVG" : "Pick shape outline"}
            </h2>
            <div className="flex items-center gap-2 mt-0.5">
              <p className="text-xs text-muted-foreground">{file.name}</p>
              {/* Step indicator */}
              <div className="flex items-center gap-1">
                <span className={`h-1.5 w-5 rounded-full transition-colors ${phase === "trace" ? "bg-primary" : "bg-border"}`} />
                <span className={`h-1.5 w-5 rounded-full transition-colors ${phase === "pick" ? "bg-primary" : "bg-border"}`} />
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ── Body ───────────────────────────────────────────────────────── */}
        {phase === "trace" ? (
          /* ─── PHASE 1: Trace ─────────────────────────────────────── */
          <div className="flex flex-1 min-h-0 overflow-hidden">
            <div className="flex flex-1 min-h-0 relative">
              {zoomBar}

              {/* Before pane */}
              <div className="flex-1 flex flex-col min-w-0">
                <div className="px-4 py-2 border-b border-border shrink-0">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Original</span>
                </div>
                <ZoomPane
                  vp={vp}
                  onWheel={handleWheel}
                  onMouseDown={handleMouseDown}
                  className="bg-[repeating-conic-gradient(#80808015_0%_25%,transparent_0%_50%)] bg-[length:16px_16px]"
                >
                  {originalUrl ? (
                    <img
                      src={originalUrl}
                      alt="Original"
                      draggable={false}
                      className="max-w-full max-h-full object-contain rounded pointer-events-none"
                    />
                  ) : (
                    <ImageIcon className="h-10 w-10 text-muted-foreground/30" />
                  )}
                </ZoomPane>
              </div>

              <div className="w-px shrink-0 bg-border" />

              {/* After pane */}
              <div className="flex-1 flex flex-col min-w-0">
                <div className="px-4 py-2 border-b border-border shrink-0">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">SVG Preview</span>
                </div>
                <ZoomPane
                  vp={vp}
                  onWheel={handleWheel}
                  onMouseDown={handleMouseDown}
                  className="bg-[repeating-conic-gradient(#80808015_0%_25%,transparent_0%_50%)] bg-[length:16px_16px]"
                  overlay={
                    isProcessing ? (
                      <div className="absolute inset-0 flex items-center justify-center bg-card/60 backdrop-blur-sm z-10 pointer-events-none">
                        <Loader2 className="h-7 w-7 text-primary animate-spin" />
                      </div>
                    ) : undefined
                  }
                >
                  {svgDataUrl && !error ? (
                    <img
                      src={svgDataUrl}
                      alt="SVG output"
                      draggable={false}
                      className="max-w-full max-h-full object-contain rounded pointer-events-none"
                    />
                  ) : error ? (
                    <p className="text-xs text-destructive text-center px-4">{error}</p>
                  ) : (
                    <ImageIcon className="h-10 w-10 text-muted-foreground/30" />
                  )}
                </ZoomPane>
              </div>
            </div>

            {/* Controls panel */}
            <div className="w-64 shrink-0 border-l border-border flex flex-col overflow-y-auto">
              <div className="p-4 space-y-5">
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Adjust settings — the preview updates automatically. Scroll or drag to inspect detail.
                </p>
                <SliderControl
                  label="Colors" value={opts.numColors} min={1} max={24} step={1}
                  onChange={(v) => setOpts((o) => ({ ...o, numColors: v }))}
                  hint="Fewer = simpler, bolder shapes"
                />
                <SliderControl
                  label="Path simplification" value={opts.simplification} min={1} max={10} step={1}
                  onChange={(v) => setOpts((o) => ({ ...o, simplification: v }))}
                  hint="Higher = smoother, fewer nodes"
                />
                <div className="space-y-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={opts.removeBackground}
                      onChange={(e) => setOpts((o) => ({ ...o, removeBackground: e.target.checked }))}
                      className="h-4 w-4 rounded accent-primary"
                    />
                    <span className="text-xs font-medium text-foreground">Remove background</span>
                  </label>
                  {opts.removeBackground && (
                    <div className="pl-6">
                      <SliderControl
                        label="Tolerance" value={opts.bgTolerance} min={5} max={120} step={1}
                        onChange={(v) => setOpts((o) => ({ ...o, bgTolerance: v }))}
                        hint="Higher = remove more similar colors"
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* ─── PHASE 2: Pick shape ─────────────────────────────────── */
          <div className="flex flex-1 min-h-0 overflow-hidden">
            {/* Interactive shape picker */}
            <div className="flex-1 min-h-0 relative">
              {zoomBar}
              <ZoomPane
                vp={vp}
                onWheel={handleWheel}
                onMouseDown={handleMouseDown}
                className="bg-[repeating-conic-gradient(#80808015_0%_25%,transparent_0%_50%)] bg-[length:16px_16px] h-full"
              >
                {svgMeta && tracedPaths.length > 0 && (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox={svgMeta.viewBox}
                    style={{
                      maxWidth: "100%",
                      maxHeight: "100%",
                      display: "block",
                      overflow: "visible",
                    }}
                  >
                    {tracedPaths.map((path) => {
                      const isSelected = selectedIds.has(path.id);
                      const isHovered = hoveredId === path.id;
                      return (
                        <path
                          key={path.id}
                          d={path.d}
                          fill={path.fill}
                          opacity={isSelected ? 1 : isHovered ? 0.75 : 0.2}
                          stroke={
                            isSelected
                              ? "#6366f1"
                              : isHovered
                              ? "#a5b4fc"
                              : "transparent"
                          }
                          strokeWidth={isSelected || isHovered ? 3 : 0}
                          strokeLinejoin="round"
                          style={{ cursor: "pointer", transition: "opacity 0.1s, stroke 0.1s" }}
                          onMouseDown={(e) => e.stopPropagation()}
                          onMouseEnter={() => setHoveredId(path.id)}
                          onMouseLeave={() => setHoveredId(null)}
                          onClick={() => togglePath(path.id)}
                        />
                      );
                    })}
                  </svg>
                )}
              </ZoomPane>
            </div>

            {/* Pick sidebar */}
            <div className="w-56 shrink-0 border-l border-border flex flex-col">
              <div className="p-4 flex flex-col gap-4 flex-1">
                <div className="flex items-start gap-2">
                  <MousePointerClick className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Click each shape to include or exclude it from the clicker outline. Drag the canvas to pan.
                  </p>
                </div>

                {/* Selection counter */}
                <div className="bg-muted rounded-lg px-3 py-2 text-center">
                  <p className="text-lg font-semibold text-foreground tabular-nums">
                    {selectedIds.size}
                    <span className="text-sm font-normal text-muted-foreground"> / {tracedPaths.length}</span>
                  </p>
                  <p className="text-[10px] text-muted-foreground">shapes selected</p>
                </div>

                {/* Quick-select buttons */}
                <div className="flex flex-col gap-1.5">
                  <button
                    onClick={() => setSelectedIds(new Set(tracedPaths.map((p) => p.id)))}
                    className="text-xs text-center py-1.5 px-3 rounded-md border border-border hover:bg-accent transition-colors text-foreground"
                  >
                    Select all
                  </button>
                  <button
                    onClick={() => setSelectedIds(new Set())}
                    className="text-xs text-center py-1.5 px-3 rounded-md border border-border hover:bg-accent transition-colors text-foreground"
                  >
                    Deselect all
                  </button>
                </div>

                {/* Color legend */}
                {tracedPaths.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                      Shapes ({tracedPaths.length})
                    </p>
                    <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
                      {tracedPaths.map((p) => (
                        <button
                          key={p.id}
                          onClick={() => togglePath(p.id)}
                          onMouseEnter={() => setHoveredId(p.id)}
                          onMouseLeave={() => setHoveredId(null)}
                          className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-colors text-xs ${
                            selectedIds.has(p.id)
                              ? "bg-primary/10 border border-primary/30 text-foreground"
                              : hoveredId === p.id
                              ? "bg-accent text-foreground"
                              : "text-muted-foreground hover:bg-accent"
                          }`}
                        >
                          <span
                            className="h-3 w-3 rounded-sm shrink-0 border border-black/10"
                            style={{ backgroundColor: p.fill }}
                          />
                          <span className="truncate">Shape {p.id + 1}</span>
                          {selectedIds.has(p.id) && (
                            <span className="ml-auto text-primary">✓</span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Footer ─────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-border shrink-0 gap-3">
          {phase === "trace" ? (
            <>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                When happy with the trace, pick which shape to use as the clicker outline.
              </p>
              <div className="flex gap-2 shrink-0">
                <Button
                  variant="outline" size="sm"
                  disabled={!svgOutput || isProcessing}
                  onClick={() => svgOutput && downloadSVG(svgOutput, svgFileName)}
                  className="gap-1.5"
                >
                  <Download className="h-3.5 w-3.5" />
                  Download SVG
                </Button>
                <Button
                  size="sm"
                  disabled={!svgOutput || isProcessing || tracedPaths.length === 0}
                  onClick={enterPickPhase}
                  className="gap-1.5"
                >
                  Pick shape
                  <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                {selectedIds.size === 0
                  ? "Select at least one shape to continue."
                  : `${selectedIds.size} shape${selectedIds.size !== 1 ? "s" : ""} will be used as the clicker outline.`}
              </p>
              <div className="flex gap-2 shrink-0">
                <Button
                  variant="outline" size="sm"
                  onClick={() => { setPhase("trace"); setVp(DEFAULT_VP); }}
                  className="gap-1.5"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Back
                </Button>
                <Button
                  size="sm"
                  disabled={selectedIds.size === 0}
                  onClick={applySelection}
                  className="gap-1.5"
                >
                  Use as clicker shape
                  <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
