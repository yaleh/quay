// regex-escape.ts — the ONE regex-literal escaper, a kernel leaf.
//
// WHY IT LIVES IN THE KERNEL (SPEC §2 P1: 共享原语落点 `packages/quay/src/kernel/`):
// the same one-line body — `s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")` — had accumulated TWELVE
// byte-identical copies under three names (`escapeRe` ×3, `escapeRegex` ×2, `escapeRegExp` ×7)
// across BOTH layers: eleven `plugin/scripts/*.ts` instruments and the product-side
// `packages/quay-native/src/store.ts` (routine `semantic-dedup-scan` finding
// `escapere-escaperegex-escaperegexp-fndefre-stemre-escapere`, task
// gap-routine-semantic-dedup-scan-escapere-escaperegex-escaperegexp-fndefre-stemre).
//
// The kernel is the only placement both sides can reach. The direction must be plugin → kernel:
// `packages/**` importing `plugin/**` is a REVERSE EDGE (import-graph-check's `reverseEdges`
// ratchet, baselined at 0), so the product-side judge cannot import the methodology-side copy.
// This is the same reachability argument that moved the shape section-heading tables to
// `kernel/shape-sections.ts` (gap-shape-section-tables-dual-copy-no-single-source) — and it is not
// a coincidence that the two most load-bearing copies here were `store.ts:117` and
// `ready-pool-check.ts:715`, which each independently documented themselves as mirroring the other
// ("Mirrors ready-pool-check.ts's own escapeRegExp (same byte semantics — the single-judge
// contract)"). That mirror was maintained by hand and by comment; it is now structural.
//
// ⛔ WHY NOT `plugin/scripts/checker-lib.ts` (the other "shared primitives" library): it is a
// methodology-side module, so putting the implementation there restores exactly the reverse edge
// this file removes. `plugin/scripts/regex-escape.ts` is the plugin side's entry point — a pure
// re-export, mirroring `plugin/scripts/shape-sections.ts` / `write-json-atomic.ts`.
//
// KERNEL BOUNDARY (import-graph-check 第四规则): this file imports NOTHING. It is a leaf, so it can
// never participate in a value or type cycle, and the boundary rule that kernel files may not
// import outside the kernel is satisfied vacuously.
//
// NOT A CHECKER, NOT AN INSTRUMENT: it answers no question of its own and is deliberately absent
// from the capability catalog's QUESTION table — it is a primitive consumed by instruments that do.

/**
 * Escape every regex metacharacter in `s`, so a caller-built `new RegExp` / `RegExp(test, flags)`
 * matches `s` LITERALLY rather than interpreting it as a pattern.
 *
 * The escaped set is exactly the 14 characters that are special in a regex character class or in a
 * pattern body: `. * + ? ^ $ { } ( ) | [ ] \`.
 *
 * Byte-semantics note (this is the contract the twelve copies were held to by hand): the replacement
 * escapes ONLY metacharacters and is a no-op for a plain identifier / section name. Callers that
 * build a heading matcher from a registered heading (`AC (draft)`, `Acceptance Criteria (runnable)`)
 * depend on the parenthesis being escaped — unescaped it would be read as a capture group and the
 * literal `## AC (draft)` line would never match.
 *
 * @param s the literal text to be matched (any string; coerced with `String()` is the CALLER's job
 *          when the input's type is not already `string`)
 */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
