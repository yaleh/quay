// regex-escape.ts — the plugin side's ENTRY POINT to the kernel's single regex escaper.
//
// The SINGLE SOURCE of `escapeRegExp` lives at `packages/quay/src/kernel/regex-escape.ts` (see that
// file for the full reachability argument: the product-side `packages/quay-native/src/store.ts` and
// eleven `plugin/scripts/*.ts` instruments shared a byte-identical body, and the kernel is the only
// placement both layers can reach without a `packages/**` → `plugin/**` reverse edge).
//
// This path exists so that the sibling `./regex-escape.ts` specifier every laid-down methodology
// tool uses resolves under quay-init's FLAT laydown, exactly like `./shape-sections.ts` /
// `./write-json-atomic.ts`. It is `NEVER_LAYDOWN`-free on purpose: quay-init's dependency-closure
// step (d) only scans `${SCRIPT_DIR}/<name>` SHELL sibling references, so an ESM `./` import is
// INVISIBLE to it — without the explicit `_derive_loop_scripts_once` entry, a cold-started consumer
// lays down `ready-pool-check.ts` with no sibling `regex-escape.ts` and dies with
// ERR_MODULE_NOT_FOUND.
//
// The direction is plugin → kernel, NEVER the reverse: a kernel file re-exporting from here would
// re-create the `packages/**` → `plugin/**` reverse edge this move exists to remove.
//
// It ships self-contained the same way the other kernel-backed entries do — build-plugin-dist's
// `coreSrcAliasPlugin` re-points the `packages/quay/src/**` specifier onto the real Core source tree
// and INLINES the implementation into the `dist/*.js` bundles. This path carries NO logic of its own
// (a re-export only), so nothing here can diverge between the product bundle and the methodology
// layer.

export * from "../../packages/quay/src/kernel/regex-escape.ts";
