// quay Core: shared task parsing primitives (gap-abi-promote-section-parsing-flip-store-reverse-import).
//
// The AUTHORITATIVE home for three pure, side-effect-free functions that used to live only in the
// mechanism layer (its task-schema.ts / task-status-drift-check.ts). This reverses the ONE
// product-layer → mechanism-layer src-level hard import: the native store (packages/quay-native/src/
// store.ts) used to import parseFrontmatterCompletely from the mechanism layer. The product layer is
// now the SOURCE for the PRODUCT (store.ts consumes from here). The mechanism layer keeps its own
// copies — it CANNOT statically import this module (build-plugin-dist stages plugin/ → packages/quay/
// plugin/ and bundles each entry WITHOUT the packages/ tree, the same reason loop-complete-task.ts and
// config-wiring-check.ts use DYNAMIC pathToFileURL imports for `../../packages/...`). The two copies
// are pinned BEHAVIORALLY identical by plugin/test/task-parsing-parity.test.mjs — a divergence there
// means the two frontmatter/section readers silently disagree (the drift class this promotion exists
// to end).
//
//   extractSection             — depth-aware `## Heading` → body slicing (moved from task-schema.ts).
//   parseFrontmatterCompletely — the ONE complete task-frontmatter YAML parser (moved from task-schema.ts).
//   countAcCheckboxes          — GFM checkbox counting with a fail-closed absent-section shape (moved
//                                from task-status-drift-check.ts).
//
// All three are migrated VERBATIM — logic unchanged, behavior unchanged. The existing unit tests
// (plugin/test/mechanism-count / ready-pool-check / workflow-invariant-ownership / slot-refill /
// task-status-drift-check) are the regression evidence that the move did not alter behavior.
//
// Scope honesty: this module carries ONLY these three capabilities. It is NOT mechanism-layer
// bootstrap completion — the remaining §2.6 items (③ shape-aware four-artifact judgment, ④ batch
// status write, ⑤ workspace-root parameterization, ⑥ depends_on first-class) are still unexpressed in
// the ABI, per docs/proposals/archguard-generation-era-primitives.md §2.6. This task must not be
// cited as "the self-bootstrap gap is solved".

import { parse as parseYaml } from "yaml";

/**
 * Depth-aware section extractor (moved verbatim from task-schema.ts). Match the heading line, capture
 * its `#` depth, stop the body at the next line whose heading is at the SAME OR SHALLOWER depth (so a
 * `## X` section extends through its nested `### ` subheadings and stops only at the next `## ` or
 * shallower — never silently truncated).
 */
export function extractSection(fullText, heading) {
  const headingLineRe = new RegExp(`^(##+)\\s*${heading}\\s*$`, "im");
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
 * Count GFM checkbox boxes in an AC section (`- [ ]`, `- [x]`, `- [X]`, `- [~]`; moved verbatim from
 * task-status-drift-check.ts). The acceptance gate reads `- [x]` boxes, so a `done` task with boxes but
 * ZERO checked could NOT have passed the gate as written. `[~]` (partial) counts as unchecked, matching
 * the gate semantics.
 *
 * FAIL-CLOSED (gap-ac47-completion-predicate-consumer-fail-closed, AC1): an ABSENT / UNREADABLE section
 * (null) must NOT read as `{ unchecked: 0 }`. `sectionFound:false` is the distinguishable state for
 * readers that check it; `total: NaN` is the STRUCTURAL guarantee that OLD destructuring read-patterns
 * (`const { total, checked } = …`) cannot obtain a pass (`total === 0` and `checked === total` are both
 * FALSE for NaN), so every pre-existing consumer fails CLOSED without being edited.
 */
export function countAcCheckboxes(acSection) {
  if (acSection == null) {
    return { total: NaN, checked: NaN, unchecked: NaN, sectionFound: false };
  }
  const boxes = acSection.match(/^\s*-\s+\[(.)\]/gm) ?? [];
  let checked = 0;
  for (const b of boxes) if (/\[[xX]\]/.test(b)) checked++;
  return { total: boxes.length, checked, unchecked: boxes.length - checked, sectionFound: true };
}
