// quay Core: shared task parsing primitives (gap-abi-promote-section-parsing-flip-store-reverse-import).
//
// The AUTHORITATIVE home for three pure, side-effect-free functions that used to live only in the
// mechanism layer (its task-schema.ts / task-status-drift-check.ts). This reverses the ONE
// product-layer → mechanism-layer src-level hard import: the native store (packages/quay-native/src/
// store.ts) used to import parseFrontmatterCompletely from the mechanism layer. The product layer is
// now the SOURCE for the PRODUCT (store.ts consumes from here).
//
// The stale claim that the mechanism layer cannot reach this source tree (because the plugin bundle
// is staged without it) is RETIRED: build-plugin-dist's `coreSrcAliasPlugin` re-points every
// `packages/quay/src/**` specifier onto the real Core source tree and INLINES it into `dist/*.js` —
// `plugin/scripts/ready-pool-check.ts` already statically imports
// `../../packages/quay/src/kernel/task-shape-artifacts.ts` and ships. The kernel is the one
// location BOTH layers reach, which is why the converged pure judges live there.
//
//   extractSection             — depth-aware `## Heading` → body slicing.
//                                MOVED OUT (task gap-routine-semantic-dedup-scan-extract-section-
//                                byte-identical): the one definition now lives in
//                                `./kernel/extract-section.ts` and is re-exported at the top of the
//                                implementation, so both layers — and this module's existing import
//                                surface — resolve the same function.
//   parseFrontmatterCompletely — the ONE complete task-frontmatter YAML parser.
//                                MOVED OUT (task gap-routine-semantic-dedup-scan-parse-frontmatter-
//                                completely): the one definition now lives in
//                                `./kernel/frontmatter.ts` and is re-exported below, so both layers
//                                — and this module's existing import surface — resolve the same
//                                function object.
//   countAcCheckboxes          — GFM checkbox counting with a fail-closed absent-section shape.
//                                MOVED OUT (task gap-three-pure-judges-kernel-single-def): the one
//                                definition now lives in `./kernel/ac-checkbox-count.ts` and is
//                                re-exported at the bottom of this file, so both layers — and this
//                                module's existing import surface — resolve the same function.
//
// All three pure judges are now structurally single (extractSection / parseFrontmatterCompletely /
// countAcCheckboxes): each has ONE definition under `./kernel/` and this module only re-exports it,
// so a body edit cannot land on one side of the product/mechanism pair alone. Existing unit tests
// (plugin/test/mechanism-count / ready-pool-check / workflow-invariant-ownership / slot-refill /
// task-status-drift-check) plus `plugin/test/task-parsing-parity.test.mjs`'s identity assertions
// are the regression evidence that the moves did not alter behavior.
//
// Scope honesty: this module now carries NO implementation of its own — only the three kernel
// re-exports. It is NOT mechanism-layer bootstrap completion — the remaining §2.6 items
// (③ shape-aware four-artifact judgment, ④ batch status write, ⑤ workspace-root parameterization,
// ⑥ depends_on first-class) are still unexpressed in the ABI, per
// docs/proposals/archguard-generation-era-primitives.md §2.6. This task must not be cited as "the
// self-bootstrap gap is solved".

/**
 * Depth-aware section extractor.
 *
 * MOVED to the kernel (task gap-routine-semantic-dedup-scan-extract-section-byte-identical): the ONE
 * definition — depth-aware `## Heading` slicing with the literal (escaped) heading match — now lives
 * in `./kernel/extract-section.ts` and is re-exported below. The mechanism layer
 * (`plugin/scripts/task-schema.ts`) imports that same kernel file, so the former product/mechanism
 * copy pair is structurally ONE function (identity-equal across both import surfaces) rather than two
 * byte-identical bodies pinned only by `plugin/test/task-parsing-parity.test.mjs`.
 */
export { extractSection } from "./kernel/extract-section.ts";

/**
 * The ONE complete frontmatter parser (gap-unified-frontmatter-parser).
 *
 * MOVED to the kernel (task gap-routine-semantic-dedup-scan-parse-frontmatter-completely): the one
 * definition — `(parseYaml(raw) ?? {})` plus the canonical `TaskFrontmatter` schema doc — now lives
 * in `./kernel/frontmatter.ts` and is re-exported here. The mechanism layer
 * (`plugin/scripts/task-schema.ts`) imports that same kernel file, so the former product/mechanism
 * copy pair is structurally ONE function (identity-equal across both import surfaces) rather than
 * two byte-identical bodies pinned only by `plugin/test/task-parsing-parity.test.mjs`.
 */
export { parseFrontmatterCompletely } from "./kernel/frontmatter.ts";

/**
 * Count GFM checkbox boxes in an AC section (`- [ ]`, `- [x]`, `- [X]`, `- [~]`).
 *
 * MOVED to the kernel (task gap-three-pure-judges-kernel-single-def, AC-909): the ONE definition —
 * including the fail-closed `null → { total: NaN, checked: NaN, unchecked: NaN, sectionFound:false }`
 * shape and the `[~]`-counts-as-unchecked semantics — now lives in
 * `./kernel/ac-checkbox-count.ts`, re-exported below. The mechanism layer
 * (plugin/scripts/task-schema.ts) imports that same kernel file, so the former product/mechanism copy
 * pair is structurally ONE function (identity-equal across both import surfaces) rather than two
 * bodies pinned only by plugin/test/task-parsing-parity.test.mjs.
 */
export { countAcCheckboxes } from "./kernel/ac-checkbox-count.ts";

