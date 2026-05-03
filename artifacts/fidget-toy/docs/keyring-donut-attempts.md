# Key Ring "Donut Cutout" — what was tried, why it was removed

The original task spec (`.local/tasks/key-ring-attachment.md`) only called
for a single attachment style: the **lug** (a solid cylinder with a
through-hole, straddling the top edge of the outer shell). That ships and
works well.

A second "donut cutout" style was attempted in response to the system task
title "Key Ring Attachment (Two Types)" but never landed in a usable form.
It has been removed pending a clearer plan.

## What we tried

### Attempt 1 — flat annular extrusion sitting above the top edge
- Reused the lug's `ExtrudeGeometry` (circle + concentric hole) and just
  shifted its centre outward so the whole ring sat above the shell with a
  ~0.6 mm fuse overlap to weld it on.
- **Why it failed**: it's still purely additive. From the user's
  perspective it looked like "another lug, just placed differently" — not
  a round 3-D donut and not a negative shape.

### Attempt 2 — true `THREE.TorusGeometry` standing vertically off the top edge
- Replaced the extrusion with a real torus (R = (outer+hole)/2, r =
  (outer-hole)/2), rotated 90° about X so its axis is +Y, bottom-aligned
  in Z, and pushed outward in Y so only ~0.6 mm of the back of the tube
  overlaps the shell.
- **Why it failed**: visually closer to a real keyring loop, but the user
  reported it still wasn't working right. The fuse to the shell is only a
  small tangent strip of the tube which produces non-manifold geometry
  where torus and shell meet — fine for the preview, problematic for the
  STL/3MF merge in slicers and visually awkward against irregular SVG
  outlines.

## Real blockers

A truly **subtractive** donut cutout — i.e. a round hole punched through
the outer shell wall at the top edge — would need either:

1. A polygon-union utility to merge a circular boss into `outerShape` so
   the wall ring has enough material to hold a clean through-hole, or
2. A CSG library (e.g. `three-bvh-csg`) to subtract a cylinder from the
   built shell mesh.

Neither is available in the repo today (`polygonOffset.ts` only does
inset/outset, not union). Without one of those, every attempt collapses
to "another additive shape next to the lug", which isn't what was asked
for.

## Status

- Setting `keyRingType` and the corresponding sidebar type selector have
  been removed. The lug is once again the only key-ring style.
- All other lug behaviour (`keyRingEnabled`, `keyRingOuterDiameter`,
  `keyRingHoleDiameter`, `keyRingThickness`, bottom-alignment, floor
  clamping) is unchanged.
- Re-add the donut as a separate, well-scoped task once a polygon-union
  or CSG dependency is introduced.
