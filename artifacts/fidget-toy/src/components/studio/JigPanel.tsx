import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import type { FidgetSettings } from "@/lib/fidgetGeometry";
import type { JigOutput } from "@/lib/jig/types";

const MM_TO_IN = 1 / 25.4;

function mmIn(mm: number) {
  return `${mm.toFixed(2)}mm / ${(mm * MM_TO_IN).toFixed(3)}"`;
}

interface JigPanelProps {
  settings: FidgetSettings;
  setSetting: <K extends keyof FidgetSettings>(key: K, value: FidgetSettings[K]) => void;
  extrudeDepth: number;
  innerJigOutput?: JigOutput | null;
  outerJigOutput?: JigOutput | null;
}

export default function JigPanel({ settings, setSetting, extrudeDepth, innerJigOutput, outerJigOutput }: JigPanelProps) {
  const s = settings;

  const showInner = s.jigTarget === "inner" || s.jigTarget === "both";
  const showOuter = s.jigTarget === "outer" || s.jigTarget === "both";

  const totalZ = extrudeDepth + s.jigZAdjust;

  return (
    <div>
      {/* Section header + enable toggle */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          UV Print Jig
        </h2>
        <label className="flex items-center gap-1.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={s.jigEnabled}
            onChange={(e) => setSetting("jigEnabled", e.target.checked)}
            className="h-3.5 w-3.5 rounded accent-primary"
          />
          <span className="text-xs text-muted-foreground">Enable</span>
        </label>
      </div>

      {s.jigEnabled && (
        <div className="space-y-5">
          {/* Jig for */}
          <div className="space-y-2">
            <Label className="text-xs">Jig for</Label>
            <div className="flex rounded-md border border-border overflow-hidden text-xs">
              {(["inner", "outer", "both"] as const).map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setSetting("jigTarget", opt)}
                  className={`flex-1 py-1.5 px-2 transition-colors ${
                    s.jigTarget === opt
                      ? "bg-primary text-primary-foreground font-medium"
                      : "bg-background text-muted-foreground hover:bg-accent/50"
                  }`}
                >
                  {opt === "inner" ? "Inner Clicker" : opt === "outer" ? "Outer Shell" : "Both"}
                </button>
              ))}
            </div>
          </div>

          {/* Mirror X */}
          <div className="space-y-2">
            <Label className="text-xs">Mirror X</Label>
            <div className="flex flex-col gap-1.5 pl-1">
              {showInner && (
                <label className="flex items-center gap-2 cursor-pointer select-none text-xs">
                  <input
                    type="checkbox"
                    checked={s.jigMirrorXInner}
                    onChange={(e) => setSetting("jigMirrorXInner", e.target.checked)}
                    className="h-3.5 w-3.5 rounded accent-primary"
                  />
                  Inner Clicker
                </label>
              )}
              {showOuter && (
                <label className="flex items-center gap-2 cursor-pointer select-none text-xs">
                  <input
                    type="checkbox"
                    checked={s.jigMirrorXOuter}
                    onChange={(e) => setSetting("jigMirrorXOuter", e.target.checked)}
                    className="h-3.5 w-3.5 rounded accent-primary"
                  />
                  Outer Shell
                </label>
              )}
            </div>
          </div>

          {/* Clearance */}
          <div className="space-y-1.5">
            <div className="flex justify-between items-center">
              <Label className="text-xs">Clearance</Label>
              <span className="text-xs text-muted-foreground">{mmIn(s.jigClearance)}</span>
            </div>
            <Slider
              value={[s.jigClearance]}
              min={0}
              max={1}
              step={0.05}
              onValueChange={([v]) => setSetting("jigClearance", v)}
              className="w-full"
            />
          </div>

          {/* Jig Width + Height */}
          <div className="space-y-2">
            <Label className="text-xs">Jig Size</Label>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <span className="text-[10px] text-muted-foreground">Width</span>
                <Input
                  type="number"
                  value={s.jigWidth}
                  min={10}
                  step={1}
                  onChange={(e) => setSetting("jigWidth", parseFloat(e.target.value) || 90)}
                  className="h-7 text-xs"
                />
                <span className="text-[10px] text-muted-foreground">{(s.jigWidth * MM_TO_IN).toFixed(3)}"</span>
              </div>
              <div className="space-y-1">
                <span className="text-[10px] text-muted-foreground">Height</span>
                <Input
                  type="number"
                  value={s.jigHeight}
                  min={10}
                  step={1}
                  onChange={(e) => setSetting("jigHeight", parseFloat(e.target.value) || 90)}
                  className="h-7 text-xs"
                />
                <span className="text-[10px] text-muted-foreground">{(s.jigHeight * MM_TO_IN).toFixed(3)}"</span>
              </div>
            </div>
          </div>

          {/* Z Adjust */}
          <div className="space-y-1.5">
            <div className="flex justify-between items-center">
              <Label className="text-xs">Z Adjust</Label>
              <span className="text-xs text-muted-foreground">
                {extrudeDepth.toFixed(2)} + {s.jigZAdjust.toFixed(2)} = {totalZ.toFixed(2)}mm
              </span>
            </div>
            <Slider
              value={[s.jigZAdjust]}
              min={-2}
              max={2}
              step={0.1}
              onValueChange={([v]) => setSetting("jigZAdjust", v)}
              className="w-full"
            />
          </div>

          {/* Rows + Cols */}
          <div className="space-y-2">
            <Label className="text-xs">Layout</Label>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <span className="text-[10px] text-muted-foreground">Rows</span>
                <Input
                  type="number"
                  value={s.jigRows}
                  min={1}
                  step={1}
                  onChange={(e) => setSetting("jigRows", Math.max(1, parseInt(e.target.value) || 1))}
                  className="h-7 text-xs"
                />
              </div>
              <div className="space-y-1">
                <span className="text-[10px] text-muted-foreground">Columns</span>
                <Input
                  type="number"
                  value={s.jigCols}
                  min={1}
                  step={1}
                  onChange={(e) => setSetting("jigCols", Math.max(1, parseInt(e.target.value) || 1))}
                  className="h-7 text-xs"
                />
              </div>
            </div>
          </div>

          {/* Spacing */}
          <div className="space-y-1.5">
            <div className="flex justify-between items-center">
              <Label className="text-xs">Spacing</Label>
              <span className="text-xs text-muted-foreground">{s.jigSpacing.toFixed(1)}mm</span>
            </div>
            <Input
              type="number"
              value={s.jigSpacing}
              min={2}
              step={0.5}
              onChange={(e) => setSetting("jigSpacing", Math.max(2, parseFloat(e.target.value) || 2))}
              className="h-7 text-xs"
            />
          </div>

          {/* Fit Status */}
          <div className="space-y-1.5">
            {(showInner) && (() => {
              const out = innerJigOutput;
              if (!out) return (
                <div className="rounded-md border border-border/60 bg-accent/10 px-3 py-2 text-xs text-muted-foreground">
                  Computing…
                </div>
              );
              return (
                <div className={`rounded-md border px-3 py-2 text-xs font-medium ${
                  out.fits
                    ? "border-green-800/50 bg-green-950/30 text-green-400"
                    : "border-red-800/50 bg-red-950/30 text-red-400"
                }`}>
                  {s.jigTarget === "both" && <span className="opacity-70 mr-1">Inner:</span>}
                  {out.fits ? "✓ Fits" : (out.errorMessage ?? "Doesn't fit")}
                </div>
              );
            })()}
            {(showOuter) && (() => {
              const out = outerJigOutput;
              if (!out) return (
                <div className="rounded-md border border-border/60 bg-accent/10 px-3 py-2 text-xs text-muted-foreground">
                  Computing…
                </div>
              );
              return (
                <div className={`rounded-md border px-3 py-2 text-xs font-medium ${
                  out.fits
                    ? "border-green-800/50 bg-green-950/30 text-green-400"
                    : "border-red-800/50 bg-red-950/30 text-red-400"
                }`}>
                  {s.jigTarget === "both" && <span className="opacity-70 mr-1">Outer:</span>}
                  {out.fits ? "✓ Fits" : (out.errorMessage ?? "Doesn't fit")}
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
