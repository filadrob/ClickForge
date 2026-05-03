import { useState, useEffect, useRef, useCallback } from "react";
import { X, Download, ArrowRight, Loader2, ImageIcon, ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
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

const DEFAULT_OPTS: TraceOptions = {
  numColors: 4,
  simplification: 3,
  removeBackground: true,
  bgTolerance: 40,
};

const DEFAULT_VP: Viewport = { zoom: 1, panX: 0, panY: 0 };
const MAX_DIM = 800;

// ---------------------------------------------------------------------------
// Background removal — BFS flood-fill from every corner
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
  let left = width;
  let right = -1;
  let top = height;
  let bottom = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 0) {
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
  }

  if (right < left || bottom < top) {
    return imageData;
  }

  const cropWidth = right - left + 1;
  const cropHeight = bottom - top + 1;
  const cropped = new Uint8ClampedArray(cropWidth * cropHeight * 4);

  for (let y = 0; y < cropHeight; y++) {
    for (let x = 0; x < cropWidth; x++) {
      const srcIndex = ((top + y) * width + (left + x)) * 4;
      const dstIndex = (y * cropWidth + x) * 4;
      cropped[dstIndex] = data[srcIndex];
      cropped[dstIndex + 1] = data[srcIndex + 1];
      cropped[dstIndex + 2] = data[srcIndex + 2];
      cropped[dstIndex + 3] = data[srcIndex + 3];
    }
  }

  return new ImageData(cropped, cropWidth, cropHeight);
}

// ---------------------------------------------------------------------------
// Load image → ImageData (with optional bg removal)
// ---------------------------------------------------------------------------

async function loadImageData(
  file: File,
  removeBackground: boolean,
  bgTolerance: number
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
// Trace to SVG
// ---------------------------------------------------------------------------

function traceToSVG(imageData: ImageData, opts: TraceOptions): string {
  const ltres = opts.simplification * 1.2;
  return ImageTracer.imagedataToSVG(imageData, {
    numberofcolors: opts.numColors,
    ltres,
    qtres: ltres,
    scale: 1,
    strokewidth: 0,
    linefilter: opts.simplification > 5,
    rightangleenhance: false,
  }) as string;
}

// ---------------------------------------------------------------------------
// Download helper
// ---------------------------------------------------------------------------

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
// Shared preview pane — applies synchronized viewport transform
// ---------------------------------------------------------------------------

function PreviewPane({
  label,
  vp,
  onWheel,
  onMouseDown,
  children,
  overlay,
}: {
  label: string;
  vp: Viewport;
  onWheel: (e: WheelEvent) => void;
  onMouseDown: (e: React.MouseEvent) => void;
  children: React.ReactNode;
  overlay?: React.ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Attach non-passive wheel listener so preventDefault() works
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [onWheel]);

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <div className="px-4 py-2 border-b border-border shrink-0">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</span>
      </div>
      <div
        ref={containerRef}
        className="flex-1 relative overflow-hidden bg-[repeating-conic-gradient(#80808015_0%_25%,transparent_0%_50%)] bg-[length:16px_16px] select-none"
        style={{ cursor: vp.zoom > 1 ? "grab" : "default" }}
        onMouseDown={onMouseDown}
      >
        {/* Transformed content layer */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transform: `translate(${vp.panX}px, ${vp.panY}px) scale(${vp.zoom})`,
            transformOrigin: "center center",
            willChange: "transform",
          }}
        >
          {children}
        </div>
        {/* Fixed overlays (spinner, error) — not transformed */}
        {overlay}
      </div>
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

  // ── Shared viewport state ────────────────────────────────────────────────
  const [vp, setVp] = useState<Viewport>(DEFAULT_VP);
  const isPanning = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });

  // Wheel handler (stable ref so both panes share the same function instance)
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const el = e.currentTarget as HTMLDivElement;
    const rect = el.getBoundingClientRect();
    // Cursor offset from the CENTER of the pane (matches transform-origin: center center)
    const ocx = e.clientX - rect.left - rect.width / 2;
    const ocy = e.clientY - rect.top - rect.height / 2;

    setVp((prev) => {
      const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
      const newZoom = Math.min(16, Math.max(0.2, prev.zoom * factor));
      // Keep the image point under the cursor fixed
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

  // ── Zoom button helpers ──────────────────────────────────────────────────
  const zoomBy = (factor: number) =>
    setVp((p) => ({ ...p, zoom: Math.min(16, Math.max(0.2, p.zoom * factor)) }));

  // ── Tracing ─────────────────────────────────────────────────────────────
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
      const imageData = await loadImageData(file, currentOpts.removeBackground, currentOpts.bgTolerance);
      setSvgOutput(traceToSVG(imageData, currentOpts));
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

  const svgDataUrl = svgOutput
    ? `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgOutput)))}`
    : null;

  const baseName = file.name.replace(/\.(png|jpe?g|webp)$/i, "");
  const svgFileName = `${baseName}.svg`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.55)" }}
    >
      <div
        className="relative bg-card border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        style={{ width: "min(960px, 96vw)", maxHeight: "92vh" }}
        onMouseMove={handleMouseMove}
        onMouseUp={stopPan}
        onMouseLeave={stopPan}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div>
            <h2 className="text-base font-semibold text-foreground">Convert Image to SVG</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{file.name}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 min-h-0 overflow-hidden">

          {/* Preview area */}
          <div className="flex flex-1 min-h-0 relative">

            {/* Zoom toolbar — floats over the divider between panes */}
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 bg-card/95 backdrop-blur border border-border rounded-lg shadow px-2 py-1">
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
                title="Reset zoom and pan"
              >
                <Maximize2 className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Before pane */}
            <PreviewPane
              label="Original"
              vp={vp}
              onWheel={handleWheel}
              onMouseDown={handleMouseDown}
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
            </PreviewPane>

            {/* Divider */}
            <div className="w-px shrink-0 bg-border" />

            {/* After pane */}
            <PreviewPane
              label="SVG Preview"
              vp={vp}
              onWheel={handleWheel}
              onMouseDown={handleMouseDown}
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
            </PreviewPane>
          </div>

          {/* Controls panel */}
          <div className="w-64 shrink-0 border-l border-border flex flex-col overflow-y-auto">
            <div className="p-4 space-y-5">
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Adjust settings — the SVG preview updates automatically. Scroll or drag to compare detail.
              </p>

              <SliderControl
                label="Colors"
                value={opts.numColors}
                min={1} max={24} step={1}
                onChange={(v) => setOpts((o) => ({ ...o, numColors: v }))}
                hint="Fewer = simpler, bolder shapes"
              />

              <SliderControl
                label="Path simplification"
                value={opts.simplification}
                min={1} max={10} step={1}
                onChange={(v) => setOpts((o) => ({ ...o, simplification: v }))}
                hint="Higher = smoother, less detailed outlines"
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
                      label="Tolerance"
                      value={opts.bgTolerance}
                      min={5} max={120} step={1}
                      onChange={(v) => setOpts((o) => ({ ...o, bgTolerance: v }))}
                      hint="Higher = remove more similar colors"
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-border shrink-0 gap-3">
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Continuing will use this SVG as the inner clicker shape.
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
              disabled={!svgOutput || isProcessing}
              onClick={() => svgOutput && onApply(svgOutput, svgFileName)}
              className="gap-1.5"
            >
              Use as clicker shape
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
