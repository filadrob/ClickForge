import { useMemo, useEffect } from "react";
import * as THREE from "three";
import type { JigOutput } from "@/lib/jig/types";
import { lightenHex } from "@/lib/jig/color";


interface JigMeshProps {
  jigOutput: JigOutput;
  jigWidth: number;
  jigHeight: number;
  rows: number;
  cols: number;
  mirrorX: boolean;
  color: string;
  /** X position within the scene rotation group (±separationX) */
  positionX: number;
  /** Y position within the scene rotation group — offset below parts to avoid overlap */
  positionY: number;
  /** getShellTotalDepth(settings) — used to align the jig bottom with the parts' floor */
  shellDepth: number;
}

export default function JigMesh({
  jigOutput,
  jigWidth,
  jigHeight,
  rows,
  cols,
  mirrorX,
  color,
  positionX,
  positionY,
  shellDepth,
}: JigMeshProps) {
  const { cavityPolygon, cavityBBox, jigZ, fits, evenSpacing } = jigOutput;

  const geometry = useMemo(() => {
    if (!fits || cavityPolygon.length < 3) return null;

    // Outer jig rectangle centred at origin in XY
    const shape = new THREE.Shape();
    shape.moveTo(-jigWidth / 2, -jigHeight / 2);
    shape.lineTo( jigWidth / 2, -jigHeight / 2);
    shape.lineTo( jigWidth / 2,  jigHeight / 2);
    shape.lineTo(-jigWidth / 2,  jigHeight / 2);
    shape.closePath();

    // Bounding-box centre of cavityPolygon (it is centred ~at origin but
    // lug union can shift it slightly)
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of cavityPolygon) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const polyCx = (minX + maxX) / 2;
    const polyCy = (minY + maxY) / 2;

    // Tile cavities centred on the jig origin so the grid is symmetric about X and Y.
    const totalW = cols * cavityBBox.w + (cols > 1 ? (cols - 1) * evenSpacing.x : 0);
    const totalH = rows * cavityBBox.h + (rows > 1 ? (rows - 1) * evenSpacing.y : 0);
    const startCx = -totalW / 2 + cavityBBox.w / 2;
    const startCy = -totalH / 2 + cavityBBox.h / 2;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const cx = startCx + col * (cavityBBox.w + evenSpacing.x);
        const cy = startCy + row * (cavityBBox.h + evenSpacing.y);
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
  }, [fits, cavityPolygon, cavityBBox, jigWidth, jigHeight, jigZ, evenSpacing, rows, cols]);

  useEffect(() => () => { geometry?.dispose(); }, [geometry]);

  if (!fits || !geometry) return null;

  const jigColor = lightenHex(color, 0.1);

  // Place the jig bottom face flush with the parts' floor (local_Z = -shellDepth/2).
  // ExtrudeGeometry extrudes from local_Z = 0 upward to +jigZ, so the group origin
  // sits on the floor and the jig rises to match the piece height.
  const groupZ = -shellDepth / 2;

  return (
    <mesh
      position={[positionX, positionY, groupZ]}
      scale={mirrorX ? [-1, 1, 1] : [1, 1, 1]}
    >
      <primitive object={geometry} />
      <meshStandardMaterial
        color={jigColor}
        metalness={0.1}
        roughness={0.6}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}
