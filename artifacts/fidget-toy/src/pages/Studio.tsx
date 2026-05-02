import { useState, useRef, useCallback, useMemo, Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Grid } from "@react-three/drei";
import * as THREE from "three";
import { useLocation, Link } from "wouter";
import { useUser, useClerk } from "@clerk/react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  useCreateProject,
  useUpdateProject,
  getListProjectsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { parseSVGContent } from "@/lib/svgParser";
import {
  createOuterShellGeometries,
  createInnerClickerGeometries,
  DEFAULT_SETTINGS,
  type FidgetSettings,
} from "@/lib/fidgetGeometry";
import { exportSTL, export3MF } from "@/lib/exporters";
import {
  Upload,
  Download,
  Save,
  LayoutList,
  LogOut,
  ChevronLeft,
  Box,
  Ruler,
  Layers,
} from "lucide-react";

interface ParsedSVGState {
  shapes: THREE.Shape[];
  width: number;
  height: number;
  rawSvg: string;
  fileName: string;
}

// ─── Outer shell: outer wall ring + inner fill (floor + pocket walls) ────

function OuterShellGroup({
  shapes,
  settings,
  svgWidth,
  svgHeight,
  outerWallRef,
  innerFillFloorRef,
  innerFillPinSectionRef,
  innerFillWallsRef,
  fitCheck,
}: {
  shapes: THREE.Shape[];
  settings: FidgetSettings;
  svgWidth: number;
  svgHeight: number;
  outerWallRef: React.RefObject<THREE.Mesh | null>;
  innerFillFloorRef: React.RefObject<THREE.Mesh | null>;
  innerFillPinSectionRef: React.RefObject<THREE.Mesh | null>;
  innerFillWallsRef: React.RefObject<THREE.Mesh | null>;
  fitCheck: boolean;
}) {
  const geos = useMemo(
    () => createOuterShellGeometries(shapes, settings, svgWidth, svgHeight),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shapes, settings, svgWidth, svgHeight]
  );

  const groupZ = -settings.totalDepth / 2;
  const groupX = fitCheck ? 0 : -35;

  return (
    <group position={[groupX, 0, groupZ]}>
      {/* Outer wall ring — ghost in fit-check so you can see inside */}
      <mesh ref={outerWallRef} position={[0, 0, geos.zOffsets.outerWall]} castShadow={!fitCheck} receiveShadow>
        <primitive object={geos.outerWall} />
        <meshStandardMaterial
          color="#6C63FF"
          metalness={0.25}
          roughness={0.45}
          opacity={fitCheck ? 0.28 : 1}
          transparent={fitCheck}
          depthWrite={!fitCheck}
        />
      </mesh>

      {/* Solid floor — never penetrated */}
      <mesh ref={innerFillFloorRef} position={[0, 0, geos.zOffsets.innerFillFloor]} castShadow receiveShadow>
        <primitive object={geos.innerFillFloor} />
        <meshStandardMaterial color="#9B94FF" metalness={0.2} roughness={0.5} />
      </mesh>

      {/* MX pin-hole section — deepest part of pocket (only when enabled) */}
      {geos.innerFillPinSection && (
        <mesh ref={innerFillPinSectionRef} position={[0, 0, geos.zOffsets.innerFillPinSection]} castShadow receiveShadow>
          <primitive object={geos.innerFillPinSection} />
          <meshStandardMaterial color="#7C74E8" metalness={0.2} roughness={0.5} />
        </mesh>
      )}

      {/* Keycap square pocket walls — upper / shallower section of pocket */}
      <mesh ref={innerFillWallsRef} position={[0, 0, geos.zOffsets.innerFillWalls]} castShadow receiveShadow>
        <primitive object={geos.innerFillWalls} />
        <meshStandardMaterial color="#9B94FF" metalness={0.2} roughness={0.5} />
      </mesh>
    </group>
  );
}

// ─── Inner clicker: body + peg ────────────────────────────────────────────

function InnerClickerGroup({
  shapes,
  settings,
  svgWidth,
  svgHeight,
  clickerFloorRef,
  clickerWallsRef,
  bossRef,
  pegRef,
  fitCheck,
}: {
  shapes: THREE.Shape[];
  settings: FidgetSettings;
  svgWidth: number;
  svgHeight: number;
  clickerFloorRef: React.RefObject<THREE.Mesh | null>;
  clickerWallsRef: React.RefObject<THREE.Mesh | null>;
  bossRef: React.RefObject<THREE.Mesh | null>;
  pegRef: React.RefObject<THREE.Mesh | null>;
  fitCheck: boolean;
}) {
  const geos = useMemo(
    () => createInnerClickerGeometries(shapes, settings, svgWidth, svgHeight),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shapes, settings, svgWidth, svgHeight]
  );

  const { totalDepth, innerFillDepth } = settings;
  const { clickerTotalDepth, clickerFloorDepth, bossFloorGap, bossHeight, pegHeight, pegBottomOffset } = geos;

  // In normal mode the clicker floats beside the shell.
  // In fit-check mode it is positioned to sit exactly inside the recess.
  //   Recess bottom (world z) = -totalDepth/2 + innerFillDepth
  //   Clicker local geo runs 0 → clickerTotalDepth; centre offset = -clickerTotalDepth/2
  //   → groupZ = -totalDepth/2 + innerFillDepth + clickerTotalDepth/2
  const normalGroupPos: [number, number, number] = [35, 0, 0];
  const fitCheckGroupPos: [number, number, number] = [
    0,
    0,
    -totalDepth / 2 + innerFillDepth + clickerTotalDepth / 2,
  ];
  const groupPos = fitCheck ? fitCheckGroupPos : normalGroupPos;

  // Local z origins (geo starts at 0, mesh is centred at -clickerTotalDepth/2)
  const baseZ  = -clickerTotalDepth / 2;
  const floorZ = baseZ;                              // solid floor: 0 → clickerFloorDepth
  const wallsZ = baseZ + clickerFloorDepth;          // walls: clickerFloorDepth → top
  // Boss: starts bossFloorGap mm from absolute clicker bottom.
  const bossZ  = baseZ + bossFloorGap + bossHeight / 2;
  // Peg: starts pegBottomOffset mm above the clicker bottom (inside the body),
  // extends 1 mm into the cavity — does NOT push through the back face.
  const pegZ   = baseZ + pegBottomOffset + pegHeight / 2;

  return (
    <group position={groupPos}>
      <mesh ref={clickerFloorRef} position={[0, 0, floorZ]} castShadow receiveShadow>
        <primitive object={geos.floor} />
        <meshStandardMaterial color="#10B981" metalness={0.25} roughness={0.45} />
      </mesh>
      <mesh ref={clickerWallsRef} position={[0, 0, wallsZ]} castShadow receiveShadow>
        <primitive object={geos.walls} />
        <meshStandardMaterial color="#10B981" metalness={0.25} roughness={0.45} />
      </mesh>
      <mesh ref={bossRef} position={[0, 0, bossZ]} rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
        <primitive object={geos.boss} />
        <meshStandardMaterial color="#34D399" metalness={0.3} roughness={0.4} />
      </mesh>
      <mesh ref={pegRef} position={[0, 0, pegZ]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <primitive object={geos.peg} />
        <meshStandardMaterial color="#059669" metalness={0.2} roughness={0.5} />
      </mesh>
    </group>
  );
}

// ─── Placeholder ──────────────────────────────────────────────────────────

function PlaceholderMeshes() {
  return (
    <>
      {/* Outer shell placeholder */}
      <group position={[-35, 0, 0]}>
        <mesh position={[0, 0, 0]} castShadow>
          <boxGeometry args={[38, 38, 22]} />
          <meshStandardMaterial color="#6C63FF" opacity={0.18} transparent wireframe />
        </mesh>
        <mesh position={[0, 0, -5]}>
          <boxGeometry args={[36, 36, 12]} />
          <meshStandardMaterial color="#9B94FF" opacity={0.12} transparent wireframe />
        </mesh>
      </group>
      {/* Inner clicker placeholder */}
      <mesh position={[35, 0, 0]} castShadow>
        <boxGeometry args={[34, 34, 9]} />
        <meshStandardMaterial color="#10B981" opacity={0.18} transparent wireframe />
      </mesh>
    </>
  );
}

// ─── Main component ───────────────────────────────────────────────────────

export default function Studio() {
  const { user } = useUser();
  const { signOut } = useClerk();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const [svgState, setSvgState] = useState<ParsedSVGState | null>(null);
  const [projectName, setProjectName] = useState("My Fidget Toy");
  const [projectId, setProjectId] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [settings, setSettings] = useState<FidgetSettings>(DEFAULT_SETTINGS);
  const [fitCheckMode, setFitCheckMode] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const outerWallRef = useRef<THREE.Mesh | null>(null);
  const innerFillFloorRef = useRef<THREE.Mesh | null>(null);
  const innerFillPinSectionRef = useRef<THREE.Mesh | null>(null);
  const innerFillWallsRef = useRef<THREE.Mesh | null>(null);
  const clickerFloorRef = useRef<THREE.Mesh | null>(null);
  const clickerWallsRef = useRef<THREE.Mesh | null>(null);
  const bossRef = useRef<THREE.Mesh | null>(null);
  const pegRef = useRef<THREE.Mesh | null>(null);

  const createProject = useCreateProject();
  const updateProject = useUpdateProject();

  const handleSVGLoad = useCallback(
    (content: string, fileName: string) => {
      try {
        const parsed = parseSVGContent(content);
        setSvgState({
          shapes: parsed.shapes,
          width: parsed.width,
          height: parsed.height,
          rawSvg: content,
          fileName,
        });
        setProjectName(fileName.replace(/\.svg$/i, ""));
        toast({
          title: "SVG loaded",
          description: `${parsed.shapes.length} shape(s) · ${parsed.width.toFixed(0)}×${parsed.height.toFixed(0)} px`,
        });
      } catch {
        toast({ title: "Failed to parse SVG", variant: "destructive" });
      }
    },
    [toast]
  );

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => handleSVGLoad(ev.target?.result as string, file.name);
    reader.readAsText(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file?.name.endsWith(".svg")) {
      const reader = new FileReader();
      reader.onload = (ev) => handleSVGLoad(ev.target?.result as string, file.name);
      reader.readAsText(file);
    } else {
      toast({ title: "Please drop an SVG file", variant: "destructive" });
    }
  };

  const getMeshes = (): THREE.Mesh[] => {
    return [outerWallRef, innerFillFloorRef, innerFillPinSectionRef, innerFillWallsRef, clickerFloorRef, clickerWallsRef, bossRef, pegRef]
      .map((r) => r.current)
      .filter((m): m is THREE.Mesh => m !== null);
  };

  const handleExportSTL = () => {
    const meshes = getMeshes();
    if (!meshes.length) {
      toast({ title: "Upload an SVG first", variant: "destructive" });
      return;
    }
    exportSTL(meshes);
    toast({ title: "STL exported" });
  };

  const handleExport3MF = async () => {
    const meshes = getMeshes();
    if (!meshes.length) {
      toast({ title: "Upload an SVG first", variant: "destructive" });
      return;
    }
    await export3MF(meshes);
    toast({ title: "3MF exported" });
  };

  const handleSave = async () => {
    if (!svgState) {
      toast({ title: "Upload an SVG first", variant: "destructive" });
      return;
    }
    try {
      const payload = {
        name: projectName,
        svgData: svgState.rawSvg,
        extrudeDepth: settings.totalDepth,
        keycapSize: settings.keycapSize,
        pegRadius: settings.pegRadius,
      };
      if (projectId) {
        await updateProject.mutateAsync({ id: projectId, data: payload });
        toast({ title: "Project saved" });
      } else {
        const project = await createProject.mutateAsync({ data: payload });
        setProjectId(project.id);
        queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
        toast({ title: "Project created", description: project.name });
      }
    } catch {
      toast({ title: "Failed to save project", variant: "destructive" });
    }
  };

  const setSetting = <K extends keyof FidgetSettings>(key: K, value: FidgetSettings[K]) =>
    setSettings((s) => ({ ...s, [key]: value }));

  const isSaving = createProject.isPending || updateProject.isPending;

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* ── Top bar ── */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-3">
          <Link href="/">
            <Button variant="ghost" size="sm">
              <ChevronLeft className="h-4 w-4 mr-1" />
              Home
            </Button>
          </Link>
          <img src="/logo.svg" alt="ClickForge" className="h-6 w-6" />
          <Input
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            className="h-8 w-48 text-sm font-medium"
          />
          {projectId && <Badge variant="secondary">Saved</Badge>}
        </div>
        <div className="flex items-center gap-2">
          <Link href="/projects">
            <Button variant="ghost" size="sm">
              <LayoutList className="h-4 w-4 mr-1" />
              My Projects
            </Button>
          </Link>
          <Button variant="ghost" size="sm" onClick={() => signOut(() => setLocation("/"))}>
            <LogOut className="h-4 w-4 mr-1" />
            {user?.firstName ?? "Sign out"}
          </Button>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* ── Left sidebar ── */}
        <aside className="w-72 border-r border-border bg-card flex flex-col shrink-0 overflow-y-auto">
          <div className="p-4 space-y-6">

            {/* Upload zone */}
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
                Upload SVG
              </h2>
              <div
                className={`border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-colors ${
                  isDragging
                    ? "border-primary bg-accent"
                    : "border-border hover:border-primary hover:bg-accent/50"
                }`}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
              >
                <Upload className="h-5 w-5 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">
                  {svgState ? (
                    <span className="text-foreground font-medium">{svgState.fileName}</span>
                  ) : (
                    "Drop SVG or click to browse"
                  )}
                </p>
                {svgState && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {svgState.width.toFixed(0)} × {svgState.height.toFixed(0)} px
                  </p>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".svg"
                className="hidden"
                onChange={handleFileChange}
              />

              {/* Import dimension controls — always visible so user can set before importing */}
              <div className="mt-3 space-y-2">
                <div className="flex items-center gap-1 text-xs text-muted-foreground font-medium">
                  <Ruler className="h-3 w-3" />
                  Import size
                </div>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <Label className="text-xs text-muted-foreground mb-1 block">Lock to</Label>
                    <select
                      value={settings.lockDimension}
                      onChange={(e) => setSetting("lockDimension", e.target.value as "width" | "height")}
                      className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      <option value="width">Width</option>
                      <option value="height">Height</option>
                    </select>
                  </div>
                  <div className="flex-1">
                    <Label className="text-xs text-muted-foreground mb-1 block">
                      Size (mm)
                    </Label>
                    <Input
                      type="number"
                      min={10}
                      max={200}
                      step={1}
                      value={settings.targetSizeMm}
                      onChange={(e) => setSetting("targetSizeMm", Number(e.target.value))}
                      className="h-8 text-xs"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Outer shell dimensions */}
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
                Outer Shell
              </h2>
              <div className="space-y-5">
                <SliderRow
                  label="Total depth"
                  value={settings.totalDepth}
                  min={10}
                  max={40}
                  step={0.01}
                  unit="mm"
                  onChange={(v) => setSetting("totalDepth", v)}
                />
                <SliderRow
                  label="Housing depth"
                  value={settings.innerFillDepth}
                  min={4}
                  max={settings.totalDepth - 2}
                  step={0.01}
                  unit="mm"
                  onChange={(v) => setSetting("innerFillDepth", v)}
                />
                <SliderRow
                  label="Keycap pocket depth"
                  value={settings.keycapPocketDepth ?? DEFAULT_SETTINGS.keycapPocketDepth}
                  min={2}
                  max={settings.innerFillDepth - 1}
                  step={0.01}
                  unit="mm"
                  onChange={(v) => setSetting("keycapPocketDepth", v)}
                />
                <SliderRow
                  label="Wall thickness"
                  value={settings.insetAmount}
                  min={0.5}
                  max={5}
                  step={0.01}
                  unit="mm"
                  onChange={(v) => setSetting("insetAmount", v)}
                />
                <SliderRow
                  label="Keycap square"
                  value={settings.keycapSize}
                  min={10}
                  max={22}
                  step={0.01}
                  unit="mm"
                  onChange={(v) => setSetting("keycapSize", v)}
                />
              </div>
            </div>

            {/* Switch pin holes */}
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
                Switch Pin Holes
              </h2>
              <label className="flex items-center gap-2 cursor-pointer select-none mb-3">
                <input
                  type="checkbox"
                  checked={settings.pinHolesEnabled}
                  onChange={(e) => setSetting("pinHolesEnabled", e.target.checked)}
                  className="h-4 w-4 rounded accent-primary"
                />
                <span className="text-sm">
                  Cherry MX 5-pin holes
                </span>
              </label>
              {settings.pinHolesEnabled && (
                <>
                  <SliderRow
                    label="Pin section depth"
                    value={settings.pinHoleDepth ?? DEFAULT_SETTINGS.pinHoleDepth}
                    min={1}
                    max={Math.max(1, (settings.keycapPocketDepth ?? DEFAULT_SETTINGS.keycapPocketDepth) - 1)}
                    step={0.01}
                    unit="mm"
                    onChange={(v) => setSetting("pinHoleDepth", v)}
                  />
                  <SliderRow
                    label="Print clearance"
                    value={settings.pinHoleRadius ?? DEFAULT_SETTINGS.pinHoleRadius}
                    min={0}
                    max={0.5}
                    step={0.01}
                    unit="mm"
                    onChange={(v) => setSetting("pinHoleRadius", v)}
                  />
                </>
              )}
              <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                Punches the Cherry MX 5-pin footprint into the deepest section of the pocket: Ø4 mm center guide · Ø1.8 mm retention pegs (±5.08 mm) · Ø1.5 mm contacts (±3.81 mm / −2.54 mm). The pin section sits below the 14×14 keycap square — from the pocket floor upward.
              </p>
            </div>

            {/* Inner clicker dimensions */}
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
                Inner Clicker
              </h2>
              <div className="space-y-5">
                <SliderRow
                  label="Total thickness"
                  value={settings.clickerTotalDepth ?? DEFAULT_SETTINGS.clickerTotalDepth}
                  min={3}
                  max={30}
                  step={0.01}
                  unit="mm"
                  onChange={(v) => setSetting("clickerTotalDepth", v)}
                />
                <SliderRow
                  label="Solid floor"
                  value={settings.clickerFloorDepth ?? DEFAULT_SETTINGS.clickerFloorDepth}
                  min={0.5}
                  max={Math.max(0.5, (settings.clickerTotalDepth ?? DEFAULT_SETTINGS.clickerTotalDepth) - 1)}
                  step={0.01}
                  unit="mm"
                  onChange={(v) => setSetting("clickerFloorDepth", v)}
                />
                <SliderRow
                  label="Switch cavity size"
                  value={settings.clickerSquareSize ?? DEFAULT_SETTINGS.clickerSquareSize}
                  min={10}
                  max={30}
                  step={0.01}
                  unit="mm"
                  onChange={(v) => setSetting("clickerSquareSize", v)}
                />
                <SliderRow
                  label="Switch cavity depth"
                  value={settings.clickerSquareDepth ?? DEFAULT_SETTINGS.clickerSquareDepth}
                  min={1}
                  max={Math.max(1, (settings.clickerTotalDepth ?? DEFAULT_SETTINGS.clickerTotalDepth) - (settings.clickerFloorDepth ?? DEFAULT_SETTINGS.clickerFloorDepth))}
                  step={0.01}
                  unit="mm"
                  onChange={(v) => setSetting("clickerSquareDepth", v)}
                />
                <SliderRow
                  label="Boss diameter"
                  value={settings.bossDiameter ?? DEFAULT_SETTINGS.bossDiameter}
                  min={1}
                  max={15}
                  step={0.01}
                  unit="mm"
                  onChange={(v) => setSetting("bossDiameter", v)}
                />
                <SliderRow
                  label="Boss height"
                  value={settings.bossHeight ?? DEFAULT_SETTINGS.bossHeight}
                  min={0.5}
                  max={15}
                  step={0.01}
                  unit="mm"
                  onChange={(v) => setSetting("bossHeight", v)}
                />
                <SliderRow
                  label="Boss floor gap"
                  value={settings.bossFloorGap ?? DEFAULT_SETTINGS.bossFloorGap}
                  min={0}
                  max={Math.max(0, (settings.clickerFloorDepth ?? DEFAULT_SETTINGS.clickerFloorDepth) - 0.1)}
                  step={0.01}
                  unit="mm"
                  onChange={(v) => setSetting("bossFloorGap", v)}
                />
                <SliderRow
                  label="Peg radius"
                  value={settings.pegRadius}
                  min={1.5}
                  max={6}
                  step={0.01}
                  unit="mm"
                  onChange={(v) => setSetting("pegRadius", v)}
                />
              </div>
            </div>

            {/* Parts legend */}
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
                Parts
              </h2>
              <div className="space-y-1.5 text-xs">
                <LegendRow color="#6C63FF" label="Outer wall (ring)" />
                <LegendRow color="#9B94FF" label="Solid floor + keycap square walls" />
                {settings.pinHolesEnabled && (
                  <LegendRow color="#7C74E8" label="MX pin-hole section" />
                )}
                <LegendRow color="#10B981" label="Inner clicker body" />
                <LegendRow color="#34D399" label="Actuator boss" />
                <LegendRow color="#059669" label="Connector peg" />
              </div>
              {svgState && (() => {
                const kpd = settings.keycapPocketDepth ?? DEFAULT_SETTINGS.keycapPocketDepth;
                const phd = settings.pinHoleDepth ?? DEFAULT_SETTINGS.pinHoleDepth;
                const pocketDepth = Math.min(kpd, settings.innerFillDepth - 1);
                const floorDepth = settings.innerFillDepth - pocketDepth;
                const pinDepth = settings.pinHolesEnabled ? Math.min(phd, pocketDepth - 1) : 0;
                const squareDepth = pocketDepth - pinDepth;
                return (
                  <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                    <p>Solid floor: <span className="font-mono font-medium text-foreground">{floorDepth.toFixed(1)} mm</span></p>
                    {settings.pinHolesEnabled && (
                      <p>Pin section: <span className="font-mono font-medium text-foreground">{pinDepth.toFixed(1)} mm</span></p>
                    )}
                    <p>Keycap square: <span className="font-mono font-medium text-foreground">{squareDepth.toFixed(1)} mm</span></p>
                    <p>Clicker recess: <span className="font-mono font-medium text-foreground">{(settings.totalDepth - settings.innerFillDepth).toFixed(1)} mm</span></p>
                  </div>
                );
              })()}
            </div>

            {/* Actions */}
            <div className="space-y-2">
              <Button
                className="w-full"
                onClick={handleSave}
                disabled={isSaving || !svgState}
              >
                <Save className="h-4 w-4 mr-2" />
                {isSaving ? "Saving…" : projectId ? "Update Project" : "Save Project"}
              </Button>
              <Button
                variant="outline"
                className="w-full"
                onClick={handleExportSTL}
                disabled={!svgState}
              >
                <Download className="h-4 w-4 mr-2" />
                Export STL
              </Button>
              <Button
                variant="outline"
                className="w-full"
                onClick={handleExport3MF}
                disabled={!svgState}
              >
                <Download className="h-4 w-4 mr-2" />
                Export 3MF
              </Button>
            </div>

          </div>
        </aside>

        {/* ── 3D canvas ── */}
        <main className="flex-1 relative">
          {!svgState && (
            <div className="absolute inset-0 flex flex-col items-center justify-center z-10 pointer-events-none">
              <Box className="h-12 w-12 text-muted-foreground/30 mb-3" />
              <p className="text-muted-foreground text-sm">Upload an SVG to see your fidget toy</p>
            </div>
          )}

          {/* ── Fit-check toggle ── */}
          {svgState && (
            <div className="absolute top-3 right-3 z-10 flex items-center gap-2">
              <button
                onClick={() => setFitCheckMode((v) => !v)}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium border transition-colors ${
                  fitCheckMode
                    ? "bg-indigo-600 border-indigo-500 text-white shadow-lg"
                    : "bg-background/80 border-border text-muted-foreground hover:text-foreground backdrop-blur-sm"
                }`}
                title="Toggle fit-check view — snap pieces together to verify pocket & recess alignment"
              >
                <Layers className="h-3.5 w-3.5" />
                Fit Check
              </button>
              {fitCheckMode && (
                <span className="text-[10px] text-indigo-300/80 bg-indigo-950/60 border border-indigo-800/40 rounded px-2 py-1 backdrop-blur-sm">
                  Outer shell ghosted · clicker seated in recess
                </span>
              )}
            </div>
          )}

          <Canvas
            camera={{ position: [0, 60, 100], fov: 40 }}
            shadows
            style={{ background: "hsl(240 15% 8%)" }}
          >
            <ambientLight intensity={0.6} />
            <directionalLight position={[50, 80, 40]} intensity={1.4} castShadow
              shadow-mapSize={[2048, 2048]}
            />
            <directionalLight position={[-30, 30, -20]} intensity={0.35} />

            <Suspense fallback={null}>
              {svgState ? (
                <>
                  <OuterShellGroup
                    shapes={svgState.shapes}
                    settings={settings}
                    svgWidth={svgState.width}
                    svgHeight={svgState.height}
                    outerWallRef={outerWallRef}
                    innerFillFloorRef={innerFillFloorRef}
                    innerFillPinSectionRef={innerFillPinSectionRef}
                    innerFillWallsRef={innerFillWallsRef}
                    fitCheck={fitCheckMode}
                  />
                  <InnerClickerGroup
                    shapes={svgState.shapes}
                    settings={settings}
                    svgWidth={svgState.width}
                    svgHeight={svgState.height}
                    clickerFloorRef={clickerFloorRef}
                    clickerWallsRef={clickerWallsRef}
                    bossRef={bossRef}
                    pegRef={pegRef}
                    fitCheck={fitCheckMode}
                  />
                </>
              ) : (
                <PlaceholderMeshes />
              )}
            </Suspense>

            <Grid
              args={[300, 300]}
              cellSize={5}
              cellThickness={0.5}
              cellColor="#1e1e2e"
              sectionSize={25}
              sectionThickness={1}
              sectionColor="#2e2e4e"
              fadeDistance={200}
              position={[0, -25, 0]}
            />

            <OrbitControls makeDefault enablePan enableZoom enableRotate />
          </Canvas>

          {/* Labels */}
          {svgState && (
            <>
              <div className="absolute top-4 left-[25%] -translate-x-1/2 text-xs text-white/70 bg-[#6C63FF]/20 border border-[#6C63FF]/30 rounded px-2 py-1 pointer-events-none">
                Outer Shell
              </div>
              <div className="absolute top-4 right-[25%] translate-x-1/2 text-xs text-white/70 bg-[#10B981]/20 border border-[#10B981]/30 rounded px-2 py-1 pointer-events-none">
                Inner Clicker
              </div>
            </>
          )}

          <div className="absolute bottom-4 right-4 text-xs text-muted-foreground bg-card/80 backdrop-blur px-2 py-1 rounded">
            Drag to rotate · Scroll to zoom
          </div>
        </main>
      </div>
    </div>
  );
}

// ─── Small sub-components ─────────────────────────────────────────────────

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (v: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  const commit = (raw: string) => {
    const n = parseFloat(raw);
    if (!isNaN(n)) onChange(Math.min(max, Math.max(min, n)));
    setDraft(null);
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-1">
        <Label className="text-xs">{label}</Label>
        <div className="flex items-center gap-1">
          <input
            type="number"
            min={min}
            max={max}
            step={step}
            value={draft ?? (value ?? 0).toFixed(2)}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit((e.target as HTMLInputElement).value);
              if (e.key === "Escape") setDraft(null);
            }}
            className="w-16 text-xs font-mono text-right bg-transparent border border-transparent hover:border-border focus:border-primary focus:outline-none rounded px-1 py-0.5 text-muted-foreground focus:text-foreground transition-colors"
          />
          <span className="text-xs text-muted-foreground">{unit}</span>
        </div>
      </div>
      <Slider
        min={min}
        max={max}
        step={step}
        value={[value ?? min]}
        onValueChange={([v]) => onChange(v)}
      />
    </div>
  );
}

function LegendRow({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="inline-block h-2.5 w-2.5 rounded-sm shrink-0"
        style={{ background: color }}
      />
      <span className="text-muted-foreground">{label}</span>
    </div>
  );
}
