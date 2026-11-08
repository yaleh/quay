// The TARGET of the `cross-tree` fixture. It is a SEED (named on the CLI) that imports a module in a
// DIFFERENT top-level entry — so the sandbox has to follow imports transitively, not merely stage the
// two named seeds' own tops.
import { double } from "../../../plugin/scripts/shared.mjs";

export function scale(value, factor) {
  if (factor === 0 || value === 0) {
    return 0;
  }
  return double(value) * factor;
}

export function describe(on) {
  if (on) {
    return "on";
  }
  return "off";
}
