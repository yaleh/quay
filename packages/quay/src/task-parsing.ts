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
//   extractSection             — depth-aware `## Heading` → body slicing (moved from task-schema.ts).
//   parseFrontmatterCompletely — the ONE complete task-frontmatter YAML parser (moved from task-schema.ts).
//   countAcCheckboxes          — GFM checkbox counting with a fail-closed absent-section shape.
//                                MOVED OUT (task gap-three-pure-judges-kernel-single-def): the one
//                                definition now lives in `./kernel/ac-checkbox-count.ts` and is
//                                re-exported at the bottom of this file, so both layers — and this
//                                module's existing import surface — resolve the same function.
//
// extractSection / parseFrontmatterCompletely are still migrated VERBATIM — logic unchanged, behavior
// unchanged. The mechanism layer still keeps its own copies of THESE TWO, pinned BEHAVIORALLY
// identical by plugin/test/task-parsing-parity.test.mjs (converging them is out of this task's
// scope); countAcCheckboxes is now structurally single. Existing unit tests
// (plugin/test/mechanism-count / ready-pool-check / workflow-invariant-ownership / slot-refill /
// task-status-drift-check) are the regression evidence that the moves did not alter behavior.
//
// Scope honesty: this module carries ONLY these two capabilities (plus the countAcCheckboxes
// re-export). It is NOT mechanism-layer
// bootstrap completion — the remaining §2.6 items (③ shape-aware four-artifact judgment, ④ batch
// status write, ⑤ workspace-root parameterization, ⑥ depends_on first-class) are still unexpressed in
// the ABI, per docs/proposals/archguard-generation-era-primitives.md §2.6. This task must not be
// cited as "the self-bootstrap gap is solved".

import { parse as parseYaml } from "yaml";
import { escapeRegExp } from "./kernel/regex-escape.ts";

/**
 * Depth-aware section extractor. Match the heading line, capture
 * its `#` depth, stop the body at the next line whose heading is at the SAME OR SHALLOWER depth (so a
 * `## X` section extends through its nested `### ` subheadings and stops only at the next `## ` or
 * shallower — never silently truncated).
 *
 * `heading` is matched LITERALLY: it is escaped through the kernel's `escapeRegExp` before it is
 * interpolated into the heading regex. Without that, a heading carrying a regex metacharacter would be
 * read as a pattern — `Plan (draft)` would become the capture group `Plan draft` and never match the
 * literal `## Plan (draft)` line, and an unbalanced `(` would throw at `new RegExp`. Escaping is a
 * no-op for the plain section names most callers pass, so their behavior is unchanged; the
 * metacharacter-heading case is pinned by plugin/test/task-parsing-parity.test.mjs. (Task
 * gap-extract-section-heading-interpolated-unescaped-into-regexp.)
 */
export function extractSection(fullText, heading) {
  const headingLineRe = new RegExp(`^(##+)\\s*${escapeRegExp(heading)}\\s*$`, "im");
  const headingMatch = fullText.match(headingLineRe);
  if (!headingMatch) return null;
  const depth = headingMatch[1].length;
  const startIdx = headingMatch.index + headingMatch[0].length;
  const rest = fullText.slice(startIdx);
  const stopRe = new RegExp(`^#{1,${depth}}\\s`, "m");
  const stopMatch = rest.match(stopRe);
  return stopMatch ? rest.slice(0, stopMatch.index) : rest;
}

/**
 * The ONE complete frontmatter parser (gap-unified-frontmatter-parser, moved verbatim from
 * task-schema.ts). Single source of truth for reading a task file's YAML frontmatter — parseTask,
 * readDependsOn, and the native store's parse() ALL delegate here; there is no second frontmatter
 * reader to drift out of sync.
 *
 * Canonical schema (the TypeScript interface this parser realizes — the complete field set a task
 * frontmatter MAY carry; unknown keys are preserved, never dropped):
 *
 *   interface TaskFrontmatter {
 *     id?: string;                 // task id (the storage key; the store falls back to the filename)
 *     title?: string;              // human title
 *     status?: string;             // todo | ready | done | needs-human | superseded
 *     labels?: string[];           // flow `[a, b]` or block `- a`
 *     parent?: string | null;      // parent task id (relation edge)
 *     children?: string[];         // child task ids (relation edge)
 *     depends_on?: string[];       // prerequisite task ids (relation edge; top-level OR legacy extra)
 *     goal_ac?: string;            // owning goal AC id (task→AC linkage, G7; top-level single scalar, optional)
 *     extra?: {
 *       schema?: string;           // "v1" — the schema marker (the grandfather boundary)
 *       dirFile?: string;          // projection-scaffolding field (forbidden by assertion A6)
 *       dirStatus?: string;        // directive disposition
 *       depends_on?: string[];     // legacy home — task_write used to nest it under extra
 *       malformed?: string[];      // store-injected diagnosis markers
 *       [key: string]: unknown;
 *     };
 *     [key: string]: unknown;      // forward-compatible: unknown fields survive the round-trip
 *   }
 *
 * Full YAML semantics (quoting, escapes, nested maps/lists) come from the `yaml` package — the SAME
 * parser the native store uses to serialize/validate — so a frontmatter written by store.serialize()
 * round-trips byte-identically through every reader. This REPLACES the old lenient hand-parse (scalars
 * only) that silently dropped nested extra structures (e.g. `extra.depends_on` read back as "").
 */
export function parseFrontmatterCompletely(frontmatterRaw) {
  return (parseYaml(frontmatterRaw) ?? {});
}

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

