// frontmatter.ts — the ONE complete task-frontmatter YAML parser, a kernel leaf.
//
// ── THE DEFECT THIS CLOSES (task gap-routine-semantic-dedup-scan-parse-frontmatter-completely) ──
// `parseFrontmatterCompletely` existed as TWO byte-identical definitions that shared no import edge:
//   · `packages/quay/src/task-parsing.ts` — the product-side copy (native store `parse()` /
//     MCP `task_check` / goal-ac-write-face)
//   · `plugin/scripts/task-schema.ts`     — the mechanism-side copy (parseTask / readDependsOn /
//     readGoalAc / statusFromFrontmatter and every mechanism consumer of those)
// Both bodies were exactly `return (parseYaml(raw) ?? {});`, pinned together only BEHAVIORALLY
// (`plugin/test/task-parsing-parity.test.mjs`). A semantics change landing on one side only would
// have been caught by that test, but the structural root cause — two bodies to edit — survived.
// A routine `semantic-dedup-scan` finding (`parse-frontmatter-completely`, runId
// `semantic-dedup-scan-1793051606259`) reported the pair as `real-duplication`
// (`byte-identical-body`). This module removes it, following the identical reduction its two
// siblings already took: `kernel/extract-section.ts` (task
// gap-routine-semantic-dedup-scan-extract-section-byte-identical) and
// `kernel/ac-checkbox-count.ts` (task gap-three-pure-judges-kernel-single-def, AC-909).
//
// ── WHY IT LIVES IN `kernel/` (the reachability argument, both sides) ────────────────────────────
// The product layer may NOT import the mechanism layer (`packages/**` → `plugin/**` is the reverse
// edge `plugin/scripts/import-graph-check.ts` ratchets at 0). The kernel is the one location BOTH
// layers can legally import: a kernel file may import nothing outside `kernel/` except bare
// specifiers (`node:*`, npm), so this module has no back-edge and cannot create a cycle. `yaml` is
// a bare npm specifier, so it is permitted here. It ships self-contained —
// `packages/quay/scripts/build-plugin-dist.mjs`'s `coreSrcAliasPlugin` re-points every
// `packages/quay/src/**` specifier onto the real Core source tree and INLINES it into `dist/*.js`
// (the SAME route the sibling kernels already take through `plugin/scripts/task-schema.ts`).
//
// PURE LOGIC — imports one bare npm specifier, no fs, no node builtins, no side effects. Both the
// product bundle and the methodology layer run the SAME function object.
//
// Canonical schema (the TypeScript interface this parser realizes — the complete field set a task
// frontmatter MAY carry; unknown keys are preserved, never dropped):
//
//   interface TaskFrontmatter {
//     id?: string;                 // task id (the storage key; the store falls back to the filename)
//     title?: string;              // human title
//     status?: string;             // todo | ready | done | needs-human | superseded
//     labels?: string[];           // flow `[a, b]` or block `- a`
//     parent?: string | null;      // parent task id (relation edge)
//     children?: string[];         // child task ids (relation edge)
//     depends_on?: string[];       // prerequisite task ids (relation edge; top-level OR legacy extra)
//     goal_ac?: string;            // owning goal AC id (task→AC linkage, G7; top-level single scalar, optional)
//     extra?: {
//       schema?: string;           // "v1" — the schema marker (the grandfather boundary)
//       dirFile?: string;          // projection-scaffolding field (forbidden by assertion A6)
//       dirStatus?: string;        // directive disposition
//       depends_on?: string[];     // legacy home — task_write used to nest it under extra
//       malformed?: string[];      // store-injected diagnosis markers
//       deliveryCriticalSource?: string; // "evidence" | "adhoc" — which source attached the delivery-critical label
//       [key: string]: unknown;
//     };
//     [key: string]: unknown;      // forward-compatible: unknown fields survive the round-trip
//   }
//
// Full YAML semantics (quoting, escapes, nested maps/lists) come from the `yaml` package — the SAME
// parser the native store uses to serialize/validate — so a frontmatter written by store.serialize()
// round-trips byte-identically through every reader. This REPLACES the old lenient hand-parse
// (scalars only) that silently dropped nested extra structures (e.g. `extra.depends_on` read back
// as ""). An EMPTY / null document parses to `{}` (never null), so every projection below can
// destructure without a guard.

import { parse as parseYaml } from "yaml";

export function parseFrontmatterCompletely(frontmatterRaw) {
  return (parseYaml(frontmatterRaw) ?? {});
}
