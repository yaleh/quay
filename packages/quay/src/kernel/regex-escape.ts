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
// 5b 边界 — 为什么「TWELVE 处」这个数**不完整**，以及本文件的第二条收敛
// (routine `semantic-dedup-scan` finding `escaperegexp-sweep-missed-two`, task
// gap-routine-semantic-dedup-scan-escaperegexp-sweep-missed-two):
// 上面那句 TWELVE 是**逐字节 body** 判定的产物，它对两种**语义等价但拼写不同**的重写是盲的 ——
//   ① char-by-char `Set` 循环重写（`plugin/scripts/precommit-guard.ts`、`.../select-static-checks-for-touches.ts`）；
//   ② 接收者拼作 `String(s)` 而不是 `s` 的同一 body（`plugin/scripts/fast-mode-telemetry.ts` 的
//      `escapeGrep`）—— 逐字节针是 `s.replace(`，而它是 `String(s).replace(`，**字面上就差一个字符**。
// 因此「重跑家族检查、看它绿」不等于家族已收敛（硬规则 5b：修好一处 ≠ 它只在一处）。本任务按同一
// 原则**重新枚举**，把上面两种重写与另外 7 处**内联** body 一并并入本叶（`escapeGrep` 这个薄名一并删除，
// 让家族只剩一个名字），并把家族检查升级为双判定 —— 见
// `packages/quay/test/kernel-regex-escape.test.mjs` ④：
//   · 家族**声明位**（escapeRegExp / escapeRegex / escapeRe / escapeGrep）在探针扫描面上恰好 1 处（本文件）；
//   · 转义 **body 字面量**在探针扫描面上恰好 1 个文件（本文件）；Set 循环拼写 0 处。
// 扫描面 = `plugin/**` + `packages/*/src/**`，排除 node_modules / dist / archive / test / fixtures
// （与探针自身的排除规则一致，⛔ 不是随手定的）。
// ⛔ 本条**不声称**全仓再无该写法：`experiments/quay-perpetual-stream/scripts/it0-dod-check.ts` 尚有 2 处
// 内联调用（methodology 层，在探针扫描面之外），测试面（`plugin/test`、`packages/quay/test`）的内联调用同理
// —— 它们与本条的对象（探针扫描面上的家族副本）不同类，写明而非沉默略过。
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
