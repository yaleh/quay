// shape-sections.ts — OLD-PATH RE-EXPORT (tasks/gap-arch-reverse-edges-zero).
//
// The SINGLE SOURCE of the shape section-heading lists now lives at
// `packages/quay/src/kernel/shape-sections.ts` (see that file for the full reachability argument).
// This path is kept as a re-export for one release cycle so that the sibling `./shape-sections.ts`
// specifier every laid-down methodology tool already uses (`ready-pool-check.ts`, quay-init's
// explicit mechanism entry) keeps resolving unchanged.
//
// The direction is plugin → kernel, NEVER the reverse: a `kernel` file re-exporting from here would
// re-create the `packages/**` → `plugin/**` reverse edge this move exists to remove.
//
// It ships self-contained the same way it always did — build-plugin-dist's `coreSrcAliasPlugin`
// re-points the `packages/quay/src/**` specifier onto the real Core source tree and INLINES the
// tables into `dist/ready-pool-check.js`. (This file was pure data with zero imports before the
// move; it is now a pure re-export of pure data, so the "no logic here" property is preserved —
// logic on this path would run in both the product bundle and the methodology layer.)

export * from "../../packages/quay/src/kernel/shape-sections.ts";
