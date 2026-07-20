// strong-module.mjs — L_S fixture: a module whose test suite pins EVERY branch (GREEN case).
export function classify(n) {
  if (n === 0) return 'zero';
  if (n > 0 && n < 10) return 'small-positive';
  if (n >= 10) return 'large-positive';
  return 'negative';
}
