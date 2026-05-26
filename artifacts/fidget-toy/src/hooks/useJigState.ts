import type { FidgetSettings } from "@/lib/fidgetGeometry";

export type JigState = Pick<
  FidgetSettings,
  | "jigEnabled"
  | "jigTarget"
  | "jigMirrorXInner"
  | "jigMirrorXOuter"
  | "jigClearance"
  | "jigWidth"
  | "jigHeight"
  | "jigZAdjust"
  | "jigRows"
  | "jigCols"
  | "jigSpacing"
>;

export const DEFAULT_JIG_STATE: JigState = {
  jigEnabled: false,
  jigTarget: "inner",
  jigMirrorXInner: false,
  jigMirrorXOuter: false,
  jigClearance: 0.15,
  jigWidth: 90,
  jigHeight: 90,
  jigZAdjust: 0,
  jigRows: 1,
  jigCols: 1,
  jigSpacing: 2,
};
