// target.mjs — the fixture module for the L_S first-reading instrument
// (tasks/gap-ls-product-code-behavior-variance-first-reading AC1).
//
// Small on purpose: every function is a PURE decision with one operator that changes its answer, so
// a strong assertion set can kill mutants a weak "does not throw" check cannot. The same mutant set
// is run against both checks; that is what makes the two survived counts comparable.

export function classify(n) {
  if (n === 0) return "zero";
  return "nonzero";
}

export function combine(a, b) {
  return a && b;
}

export function pick(flag) {
  return flag === true ? "yes" : "no";
}
