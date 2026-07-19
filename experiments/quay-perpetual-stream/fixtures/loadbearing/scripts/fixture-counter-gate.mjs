// FIXTURE (loadbearing gate) — a LOAD-BEARING script via criterion (c): it is named by the fake
// OUTER-LOOP (../fake-outer-loop.md) as a milestone_counter++ gate. It has NO sibling test, so the
// loadbearing-test-gate must classify it FAIL.
export function counterGate() {
  return true;
}
