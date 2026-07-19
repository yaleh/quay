// FIXTURE (loadbearing gate) — imports fixture-imported.mjs (making THAT one load-bearing via
// criterion (a)). This importer is itself NOT load-bearing: nobody imports it, it is not registered
// in the fake registry, and it is not named as a milestone_counter++ gate in the fake OUTER-LOOP.
// The gate must classify it N/A (not FAIL despite having no sibling test).
import { noop } from "./fixture-imported.mjs";
export const value = noop();
