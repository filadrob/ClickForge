import * as THREE from "three";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import JSZip from "jszip";

export type MeshGroups = {
  shell: THREE.Mesh[];
  clicker: THREE.Mesh[];
  /** Optional key-ring lug mesh attached to the outer shell. */
  keyRing?: THREE.Mesh | null;
};

// ---------------------------------------------------------------------------
// Flat export (all parts as individual meshes in one file)
// ---------------------------------------------------------------------------

export function exportSTL(meshes: THREE.Mesh[]): void {
  const exporter = new STLExporter();
  const scene = new THREE.Scene();
  meshes.forEach((m) => scene.add(m.clone()));
  const stlString = exporter.parse(scene, { binary: false });
  const blob = new Blob([stlString], { type: "application/octet-stream" });
  downloadBlob(blob, "fidget-toy.stl");
}

export async function export3MF(meshes: THREE.Mesh[]): Promise<void> {
  const xml = buildObjectXml([{ name: "fidget_toy", meshes }]);
  const blob = await buildZip(xml);
  downloadBlob(blob, "fidget-toy.3mf");
}

// ---------------------------------------------------------------------------
// Merged export (shell → one mesh, clicker → one mesh, two files / objects)
// ---------------------------------------------------------------------------

export async function exportSTLMerged(groups: MeshGroups): Promise<void> {
  const exporter = new STLExporter();

  const shellMeshes = groups.keyRing ? [...groups.shell, groups.keyRing] : groups.shell;
  const shellGeo = mergeInWorldSpace(shellMeshes);
  const clickerGeo = mergeInWorldSpace(groups.clicker);

  const zip = new JSZip();

  if (shellGeo) {
    const shellScene = new THREE.Scene();
    shellScene.add(new THREE.Mesh(shellGeo));
    zip.file("outer_shell.stl", exporter.parse(shellScene, { binary: false }));
  }

  if (clickerGeo) {
    const clickerScene = new THREE.Scene();
    clickerScene.add(new THREE.Mesh(clickerGeo));
    zip.file("inner_clicker.stl", exporter.parse(clickerScene, { binary: false }));
  }

  const blob = await zip.generateAsync({ type: "blob" });
  downloadBlob(blob, "fidget-toy-parts.zip");
}

export async function export3MFMerged(groups: MeshGroups): Promise<void> {
  const shellMeshes = groups.keyRing ? [...groups.shell, groups.keyRing] : groups.shell;
  const shellGeo   = mergeInWorldSpace(shellMeshes);
  const clickerGeo = mergeInWorldSpace(groups.clicker);

  const objects: { name: string; meshes: THREE.Mesh[] }[] = [];

  if (shellGeo)   objects.push({ name: "outer_shell",   meshes: [new THREE.Mesh(shellGeo)] });
  if (clickerGeo) objects.push({ name: "inner_clicker", meshes: [new THREE.Mesh(clickerGeo)] });

  if (objects.length === 0) return;

  const xml  = buildObjectXml(objects);
  const blob = await buildZip(xml);
  downloadBlob(blob, "fidget-toy-merged.3mf");
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/**
 * Clone each mesh's geometry, apply its world transform, convert to
 * non-indexed (ensures consistent attributes), then merge into one geometry.
 */
function mergeInWorldSpace(meshes: THREE.Mesh[]): THREE.BufferGeometry | null {
  const geos: THREE.BufferGeometry[] = [];
  for (const mesh of meshes) {
    const geo = mesh.geometry.clone();
    geo.applyMatrix4(mesh.matrixWorld);
    // Ensure every piece is non-indexed so mergeGeometries handles them uniformly
    geos.push(geo.index ? geo.toNonIndexed() : geo);
  }
  if (geos.length === 0) return null;
  return mergeGeometries(geos, false) ?? null;
}

// ---------------------------------------------------------------------------
// 3MF builder
// ---------------------------------------------------------------------------

/**
 * Build the 3D model XML for one or more named objects, each containing an
 * array of meshes. When there are multiple objects they appear as separate
 * items in the 3MF build list so slicers import them as independent parts.
 */
function buildObjectXml(objects: { name: string; meshes: THREE.Mesh[] }[]): string {
  let resourcesXml = "";
  let buildXml = "";
  let objectId = 1;

  for (const obj of objects) {
    let verticesXml = "";
    let trianglesXml = "";
    let vertexOffset = 0;

    for (const mesh of obj.meshes) {
      const geo = mesh.geometry.clone();
      geo.applyMatrix4(mesh.matrixWorld);

      if (geo.index) {
        const pos = geo.attributes.position;
        const idx = geo.index;
        for (let i = 0; i < pos.count; i++) {
          verticesXml += `<vertex x="${pos.getX(i).toFixed(4)}" y="${pos.getY(i).toFixed(4)}" z="${pos.getZ(i).toFixed(4)}" />`;
        }
        for (let i = 0; i < idx.count; i += 3) {
          verticesXml;
          trianglesXml += `<triangle v1="${vertexOffset + idx.getX(i)}" v2="${vertexOffset + idx.getX(i + 1)}" v3="${vertexOffset + idx.getX(i + 2)}" />`;
        }
        vertexOffset += pos.count;
      } else {
        const pos = geo.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          verticesXml += `<vertex x="${pos.getX(i).toFixed(4)}" y="${pos.getY(i).toFixed(4)}" z="${pos.getZ(i).toFixed(4)}" />`;
        }
        const triCount = pos.count / 3;
        for (let i = 0; i < triCount; i++) {
          const a = vertexOffset + i * 3;
          trianglesXml += `<triangle v1="${a}" v2="${a + 1}" v3="${a + 2}" />`;
        }
        vertexOffset += pos.count;
      }
    }

    resourcesXml += `<object id="${objectId}" name="${obj.name}" type="model"><mesh><vertices>${verticesXml}</vertices><triangles>${trianglesXml}</triangles></mesh></object>`;
    buildXml += `<item objectid="${objectId}" />`;
    objectId++;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources>${resourcesXml}</resources>
  <build>${buildXml}</build>
</model>`;
}

async function buildZip(modelXml: string): Promise<Blob> {
  const zip = new JSZip();
  zip.file("3D/3dmodel.model", modelXml);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" /></Relationships>`);
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" /><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml" /></Types>`);
  return zip.generateAsync({ type: "blob" });
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

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
