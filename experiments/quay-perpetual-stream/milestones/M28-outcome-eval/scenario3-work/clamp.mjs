// clamp.mjs — M28-outcome-eval scenario 3 (native) child B deliverable.
export function clamp(n, min, max) {
  if (n < min) return min;
  if (n > max) return max;
  return n;
}
