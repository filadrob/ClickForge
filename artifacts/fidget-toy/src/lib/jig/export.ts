import * as THREE from "three";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import type { JigOutput } from "./types";

// Must stay in sync with JigMesh.tsx and cavity.ts
const MIN_WALL = 3;

function buildJigGeometry(
  jigOutput: JigOutput,
  jigWidth: number,
  jigHeight: number,
  rows: number,
  cols: number,
): THREE.BufferGeometry {
  const { cavityPolygon, cavityBBox, jigZ, evenSpacing } = jigOutput;

  const shape = new THREE.Shape();
  shape.moveTo(-jigWidth / 2, -jigHeight / 2);
  shape.lineTo(jigWidth / 2, -jigHeight / 2);
  shape.lineTo(jigWidth / 2, jigHeight / 2);
  shape.lineTo(-jigWidth / 2, jigHeight / 2);
  shape.closePath();

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of cavityPolygon) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const polyCx = (minX + maxX) / 2;
  const polyCy = (minY + maxY) / 2;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const cx = -jigWidth / 2 + MIN_WALL + cavityBBox.w / 2 + col * (cavityBBox.w + evenSpacing.x);
      const cy = -jigHeight / 2 + MIN_WALL + cavityBBox.h / 2 + row * (cavityBBox.h + evenSpacing.y);
      const dx = cx - polyCx;
      const dy = cy - polyCy;

      const hole = new THREE.Path();
      hole.moveTo(cavityPolygon[0][0] + dx, cavityPolygon[0][1] + dy);
      for (let i = 1; i < cavityPolygon.length; i++) {
        hole.lineTo(cavityPolygon[i][0] + dx, cavityPolygon[i][1] + dy);
      }
      hole.closePath();
      shape.holes.push(hole);
    }
  }

  return new THREE.ExtrudeGeometry(shape, { depth: jigZ, bevelEnabled: false });
}

/**
 * Export a single jig as an STL file and trigger a browser download.
 *
 * The geometry is built from JigOutput (same algorithm as JigMesh) and
 * oriented to slicer Z-up convention (Rx +90°) so the file opens correctly
 * in PrusaSlicer, Bambu Studio, and Cura.
 */
export function exportJigSTL(
  jigOutput: JigOutput,
  jigWidth: number,
  jigHeight: number,
  rows: number,
  cols: number,
  mirrorX: boolean,
  filename: string,
): void {
  const geo = buildJigGeometry(jigOutput, jigWidth, jigHeight, rows, cols);

  if (mirrorX) {
    geo.applyMatrix4(new THREE.Matrix4().makeScale(-1, 1, 1));
  }

  // Rotate +90° around X to undo the viewer's -90° scene rotation,
  // restoring extrusion-Z as slicer-Z (same correction as exporters.ts).
  geo.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2));

  // Translate so minZ = 0 (model sits on the build plate).
  const pos = geo.attributes.position;
  let minZ = Infinity;
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    if (z < minZ) minZ = z;
  }
  if (Number.isFinite(minZ) && minZ !== 0) {
    geo.applyMatrix4(new THREE.Matrix4().makeTranslation(0, 0, -minZ));
  }

  const mesh = new THREE.Mesh(geo);
  const scene = new THREE.Scene();
  scene.add(mesh);

  const stlString = new STLExporter().parse(scene, { binary: false });
  geo.dispose();

  const url = URL.createObjectURL(
    new Blob([stlString], { type: "application/octet-stream" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
