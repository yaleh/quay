// FIXTURE (loadbearing gate) — a LOAD-BEARING script via criterion (a): it is imported by a
// sibling module (fixture-importer.mjs). It HAS a sibling test (../test/fixture-imported.test.mjs),
// so the loadbearing-test-gate must classify it PASS. Do NOT add real logic here — this file exists
// only to be enumerated + grep-detected by the gate.
export function noop() {
  return 42;
}
