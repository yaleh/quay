// FIXTURE (loadbearing gate) — a stand-in for packages/quay/src/gate/registry.js. The gate greps this
// file for references to scripts/*.mjs basenames to detect criterion (b) (wrapped/registered). Here it
// names fixture-registered.mjs, making that script load-bearing.
const SOME_SCRIPT = "experiments/.../scripts/fixture-registered.mjs";
export const fakeRegistry = { registered: SOME_SCRIPT };
