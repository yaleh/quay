// FIXTURE (loadbearing gate) — a LOAD-BEARING script via criterion (b): it is named by the fake gate
// registry (../fake-registry.js). It has NO sibling test, so the loadbearing-test-gate must classify
// it FAIL. This is the core RED case: a load-bearing method-infra script shipped without a test.
export function registeredCheck() {
  return true;
}
