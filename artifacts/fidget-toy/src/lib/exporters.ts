import * as THREE from "three";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import JSZip from "jszip";

export type MeshGroups = {
  shell: THREE.Mesh[];
  clicker: THREE.Mesh[];
  /** Optional key-ring lug mesh attached to the outer shell. */
  keyRing?: THREE.Mesh | null;
  /**
   * Optional flat per-color region bodies — always belong to the outer shell
   * assembly.  Each entry's `color` is a 6-char hex string (e.g. "#ff8800").
   */
  colorLayers?: Array<{ name: string; color: string; mesh: THREE.Mesh }>;
};

/**
 * A single export part: one mesh that becomes its own top-level object in
 * 3MF / its own `o` block in OBJ.  No boolean merging is performed — parts
 * are kept fully separate so slicers can assign per-part materials.
 *
 * The mesh's geometry has already been baked to world space, rotated to the
 * slicer Z-up convention, and translated so the assembly's minimum Z = 0.
 */
type ExportPartKind = "shell" | "keyRing" | "clicker" | "colorLayer";

type ExportPart = {
  name: string;
  mesh: THREE.Mesh;
  /** Source group this part came from, used for robust partitioning. */
  kind: ExportPartKind;
  /** Optional 6-char hex color, e.g. "#ff8800". */
  color?: string;
};

// ---------------------------------------------------------------------------
// Slicer-orientation correction
// ---------------------------------------------------------------------------
//
// The viewer wraps the entire scene in a `<group rotation={[-PI/2, 0, 0]}>`
// so the extrusion axis (geometry +Z) shows as world +Y, putting the flat
// base face on world -Y.  When we bake `mesh.matrixWorld` into geometry, that
// scene rotation gets baked too — the exported file ends up with -Y as the
// bottom face, which slicers (PrusaSlicer, Bambu Studio, Cura) can't open
// correctly because they assume Z-up with the build plate at Z = 0.
//
// To undo the viewer rotation we apply Rx(+PI/2) after baking matrixWorld.
// This brings the original extrusion axis back to +Z (slicer up) so the flat
// base face sits at the model's minimum Z.  We then translate every part
// uniformly so that minimum Z = 0 — i.e., the model sits on the build plate.

/**
 * Bake `mesh.matrixWorld` into a clone of its geometry, then apply the
 * Rx(+PI/2) correction that undoes the viewer's scene rotation.  The
 * returned geometry is independent of the source mesh and safe to mutate.
 */
function bakeAndOrientGeometry(mesh: THREE.Mesh): THREE.BufferGeometry {
  const geo = mesh.geometry.clone();
  geo.applyMatrix4(mesh.matrixWorld);
  // Rotate +90° around X to undo the viewer's -90° X rotation, restoring the
  // original geometry-Z (extrusion axis) as world Z (slicer up).
  const fix = new THREE.Matrix4().makeRotationX(Math.PI / 2);
  geo.applyMatrix4(fix);
  return geo;
}

/**
 * Convert MeshGroups into a flat ExportPart[] with each part's geometry
 * already baked, oriented Z-up, and translated so the assembly's minimum Z
 * across all parts is exactly 0.  Color layers are always included as
 * separate parts carrying their hex color so downstream writers can emit
 * per-part material info (3MF basematerials, OBJ vertex colors).
 */
function buildPartsFromGroups(groups: MeshGroups): ExportPart[] {
  type Pending = {
    name: string;
    geo: THREE.BufferGeometry;
    kind: ExportPartKind;
    color?: string;
  };
  const pending: Pending[] = [];

  groups.shell.forEach((m, i) =>
    pending.push({
      name: m.name || `shell_${i + 1}`,
      geo: bakeAndOrientGeometry(m),
      kind: "shell",
    }),
  );
  if (groups.keyRing) {
    pending.push({
      name: groups.keyRing.name || "key_ring",
      geo: bakeAndOrientGeometry(groups.keyRing),
      kind: "keyRing",
    });
  }
  groups.clicker.forEach((m, i) =>
    pending.push({
      name: m.name || `clicker_${i + 1}`,
      geo: bakeAndOrientGeometry(m),
      kind: "clicker",
    }),
  );
  (groups.colorLayers ?? []).forEach((c, i) =>
    pending.push({
      name: c.name || `color_layer_${i + 1}`,
      geo: bakeAndOrientGeometry(c.mesh),
      kind: "colorLayer",
      color: c.color,
    }),
  );

  // Compute the global minimum Z across every vertex of every part, then
  // translate the entire assembly up so the bottom face sits at Z = 0.
  let minZ = Infinity;
  for (const p of pending) {
    const pos = p.geo.attributes.position;
    if (!pos) continue;
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i);
      if (z < minZ) minZ = z;
    }
  }
  if (Number.isFinite(minZ) && minZ !== 0) {
    const lift = new THREE.Matrix4().makeTranslation(0, 0, -minZ);
    for (const p of pending) p.geo.applyMatrix4(lift);
  }

  // Wrap each oriented geometry in a fresh Mesh so the writers below can
  // continue to consume `THREE.Mesh` instances uniformly.
  return pending.map((p) => {
    const mesh = new THREE.Mesh(p.geo);
    mesh.name = p.name;
    return { name: p.name, mesh, kind: p.kind, color: p.color };
  });
}

// ---------------------------------------------------------------------------
// STL — geometry-only, no color support
// ---------------------------------------------------------------------------

/**
 * Single-file STL containing every shell + clicker mesh in one scene.
 * Color layers are intentionally dropped (STL has no color concept); callers
 * should warn the user beforehand when colorLayers are present.
 */
export function exportSTL(groups: MeshGroups): void {
  const exporter = new STLExporter();
  // STL is color-blind: build parts from a groups object with colorLayers
  // stripped out so they don't end up in the file.
  const parts = buildPartsFromGroups({ ...groups, colorLayers: [] });
  if (parts.length === 0) return;
  const scene = new THREE.Scene();
  for (const p of parts) scene.add(p.mesh);
  const stlString = exporter.parse(scene, { binary: false });
  downloadBlob(
    new Blob([stlString], { type: "application/octet-stream" }),
    "fidget-toy.stl",
  );
}

/**
 * Two-file STL zip: outer_shell.stl (shell + key ring) and inner_clicker.stl.
 * Color layers are still dropped — same color-blind limitation as STL itself.
 *
 * Both sub-files share the same Z-floor-to-zero baseline so they line up
 * correctly when re-imported into a slicer.
 */
export async function exportSTLMerged(groups: MeshGroups): Promise<void> {
  const exporter = new STLExporter();
  const zip = new JSZip();

  // Build everything together first so the Z-floor lift is applied across
  // both groups consistently.  Partition by the explicit `kind` tag rather
  // than by name so user-supplied mesh names can never misclassify a part.
  const parts = buildPartsFromGroups({ ...groups, colorLayers: [] });
  const shellParts = parts.filter(
    (p) => p.kind === "shell" || p.kind === "keyRing",
  );
  const clickerParts = parts.filter((p) => p.kind === "clicker");

  if (shellParts.length > 0) {
    const scene = new THREE.Scene();
    for (const p of shellParts) scene.add(p.mesh);
    zip.file("outer_shell.stl", exporter.parse(scene, { binary: false }));
  }

  if (clickerParts.length > 0) {
    const scene = new THREE.Scene();
    for (const p of clickerParts) scene.add(p.mesh);
    zip.file("inner_clicker.stl", exporter.parse(scene, { binary: false }));
  }

  const blob = await zip.generateAsync({ type: "blob" });
  downloadBlob(blob, "fidget-toy-parts.zip");
}

// ---------------------------------------------------------------------------
// 3MF — per-part objects with optional color via the m: material extension
// ---------------------------------------------------------------------------

/**
 * Emit a 3MF where every shell/clicker mesh and every color layer is its own
 * top-level <object> in the build list.  Colored parts reference a single
 * <m:basematerials> resource via `pid` + `pindex` so slicers (PrusaSlicer,
 * Bambu Studio, Cura, etc.) pick up the per-part color.
 *
 * No boolean merging happens here — keeping parts separate is precisely what
 * makes per-part color work in slicers.
 */
export async function export3MF(groups: MeshGroups): Promise<void> {
  const parts = buildPartsFromGroups(groups);
  if (parts.length === 0) return;
  const xml = buildPartsXml(parts);
  const blob = await buildZip(xml);
  downloadBlob(blob, "fidget-toy.3mf");
}

// ---------------------------------------------------------------------------
// OBJ — per-part `o` blocks; colored parts use the vertex-color extension
// ---------------------------------------------------------------------------

/**
 * Emit a single .obj file where every part is its own `o name` block.  Color
 * layers use the widely-supported OBJ extension `v x y z r g b` so loaders
 * like Blender, MeshLab, and Bambu Studio render the per-vertex color.  No
 * boolean merging happens; uncolored parts (shell/clicker) use the standard
 * `v x y z` form.
 */
export function exportOBJ(groups: MeshGroups): void {
  const parts = buildPartsFromGroups(groups);
  if (parts.length === 0) return;

  let text = "# fidget-toy.obj\n";
  let vertexOffset = 0;

  for (const part of parts) {
    const written = writeObjPart(part, vertexOffset);
    text += written.text;
    vertexOffset += written.vertexCount;
  }

  downloadBlob(new Blob([text], { type: "text/plain" }), "fidget-toy.obj");
}

// ---------------------------------------------------------------------------
// Backwards-compat aliases
// ---------------------------------------------------------------------------
//
// Older call sites pass through a "merged" toggle.  With the new per-part
// path there's no actual difference — colors and per-part separation are
// always preserved — so the *Merged variants are thin aliases.

export const export3MFMerged = export3MF;
export const exportOBJMerged: (g: MeshGroups) => void = exportOBJ;

// ---------------------------------------------------------------------------
// 3MF builder
// ---------------------------------------------------------------------------

function buildPartsXml(parts: ExportPart[]): string {
  // One basematerials resource shared by all colored parts; index = order of
  // first appearance.  Uncolored parts simply omit pid/pindex.
  const colorIndex = new Map<string, number>();
  const colorOrder: string[] = [];
  for (const p of parts) {
    if (!p.color) continue;
    const key = p.color.toLowerCase();
    if (!colorIndex.has(key)) {
      colorIndex.set(key, colorOrder.length);
      colorOrder.push(p.color);
    }
  }

  let resourcesXml = "";
  let buildXml = "";
  let nextId = 1;

  let basematerialsId = 0;
  if (colorOrder.length > 0) {
    basematerialsId = nextId++;
    let basesXml = "";
    for (const hex of colorOrder) {
      const display = normalizeHexForDisplay(hex);
      basesXml += `<m:base name="${xmlAttrEscape(display)}" displaycolor="${xmlAttrEscape(display)}" />`;
    }
    resourcesXml += `<m:basematerials id="${basematerialsId}">${basesXml}</m:basematerials>`;
  }

  for (const part of parts) {
    const id = nextId++;
    const { vertices, triangles } = meshToVerticesAndTriangles(part.mesh);

    const colorAttrs =
      part.color && colorIndex.has(part.color.toLowerCase())
        ? ` pid="${basematerialsId}" pindex="${colorIndex.get(part.color.toLowerCase())}"`
        : "";

    // pid/pindex on both <object> and <mesh> for max slicer compatibility.
    resourcesXml += `<object id="${id}" name="${xmlAttrEscape(part.name)}" type="model"${colorAttrs}><mesh${colorAttrs}><vertices>${vertices}</vertices><triangles>${triangles}</triangles></mesh></object>`;
    buildXml += `<item objectid="${id}" />`;
  }

  const requiredExt = colorOrder.length > 0 ? ` requiredextensions="m"` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02"${requiredExt}>
  <resources>${resourcesXml}</resources>
  <build>${buildXml}</build>
</model>`;
}

/**
 * Emit `<vertices>…</vertices><triangles>…</triangles>` for one mesh.
 *
 * The mesh's geometry has already been baked + oriented + lifted by
 * buildPartsFromGroups, so we read positions directly without any further
 * matrix application.
 */
function meshToVerticesAndTriangles(mesh: THREE.Mesh): {
  vertices: string;
  triangles: string;
} {
  const geo = mesh.geometry;

  let verts = "";
  let tris = "";

  if (geo.index) {
    const pos = geo.attributes.position;
    const idx = geo.index;
    for (let i = 0; i < pos.count; i++) {
      verts += `<vertex x="${pos.getX(i).toFixed(4)}" y="${pos.getY(i).toFixed(4)}" z="${pos.getZ(i).toFixed(4)}" />`;
    }
    for (let i = 0; i < idx.count; i += 3) {
      tris += `<triangle v1="${idx.getX(i)}" v2="${idx.getX(i + 1)}" v3="${idx.getX(i + 2)}" />`;
    }
  } else {
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      verts += `<vertex x="${pos.getX(i).toFixed(4)}" y="${pos.getY(i).toFixed(4)}" z="${pos.getZ(i).toFixed(4)}" />`;
    }
    const triCount = pos.count / 3;
    for (let i = 0; i < triCount; i++) {
      const a = i * 3;
      tris += `<triangle v1="${a}" v2="${a + 1}" v3="${a + 2}" />`;
    }
  }
  return { vertices: verts, triangles: tris };
}

/** Ensure hex is in "#RRGGBB" form (3MF displaycolor requires this). */
function normalizeHexForDisplay(hex: string): string {
  let h = hex.trim();
  if (!h.startsWith("#")) h = `#${h}`;
  if (/^#[0-9a-fA-F]{3}$/.test(h)) {
    h = `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`;
  }
  return h.toUpperCase();
}

function xmlAttrEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function buildZip(modelXml: string): Promise<Blob> {
  const zip = new JSZip();
  zip.file("3D/3dmodel.model", modelXml);
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" /></Relationships>`,
  );
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" /><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml" /></Types>`,
  );
  return zip.generateAsync({ type: "blob" });
}

// ---------------------------------------------------------------------------
// OBJ builder
// ---------------------------------------------------------------------------

/**
 * Write one ExportPart as an `o name` block.  Colored parts use the OBJ
 * vertex-color extension `v x y z r g b`; uncolored parts use the standard
 * `v x y z` form.  Faces use 1-indexed global vertex numbering offset by
 * `vertexOffsetIn` (the count of `v` lines already written earlier).
 *
 * The mesh's geometry has already been baked + oriented + lifted by
 * buildPartsFromGroups, so we read positions directly.
 */
function writeObjPart(
  part: ExportPart,
  vertexOffsetIn: number,
): { text: string; vertexCount: number } {
  const geo = part.mesh.geometry.index
    ? part.mesh.geometry.toNonIndexed()
    : part.mesh.geometry;
  const pos = geo.attributes.position;
  if (!pos || pos.count === 0) return { text: "", vertexCount: 0 };

  const colored = !!part.color;
  let rgbSuffix = "";
  if (colored) {
    const [r, g, b] = hexToRgb01(part.color!);
    rgbSuffix = ` ${r.toFixed(4)} ${g.toFixed(4)} ${b.toFixed(4)}`;
  }

  let text = `o ${objSafeName(part.name)}\n`;
  for (let i = 0; i < pos.count; i++) {
    text +=
      `v ${pos.getX(i).toFixed(6)} ${pos.getY(i).toFixed(6)} ${pos.getZ(i).toFixed(6)}` +
      rgbSuffix +
      "\n";
  }
  const triCount = pos.count / 3;
  for (let i = 0; i < triCount; i++) {
    const a = vertexOffsetIn + i * 3 + 1; // OBJ is 1-indexed
    text += `f ${a} ${a + 1} ${a + 2}\n`;
  }
  return { text, vertexCount: pos.count };
}

function objSafeName(name: string): string {
  // OBJ object names can't contain whitespace; replace with underscores.
  return name.replace(/\s+/g, "_") || "part";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert "#rrggbb" or "#rgb" to [r, g, b] floats in [0, 1]. */
function hexToRgb01(hex: string): [number, number, number] {
  const full =
    hex.length === 4
      ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
      : hex;
  const r = parseInt(full.slice(1, 3), 16) / 255;
  const g = parseInt(full.slice(3, 5), 16) / 255;
  const b = parseInt(full.slice(5, 7), 16) / 255;
  return [r, g, b];
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
