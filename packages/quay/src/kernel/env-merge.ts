// env-merge.ts — SINGLE SOURCE of the env-merge rule「override 里的 `""` = 取消继承（删键）」.
// Imported by BOTH `packages/quay/src/goal-store.ts` (the product judge: the fidelity-judge argv
// default wiring) and `plugin/scripts/profile-policy.ts` (the mechanism layer: L2 profile/role
// resolution) — routine `semantic-dedup-scan` finding
// `mergeenv-cross-layer-byte-identical-under-renamed-symbol`, task
// gap-routine-semantic-dedup-scan-mergeenv-cross-layer-byte-identical-under-rename.
//
// ── WHY IT LIVES IN `kernel/` (the reachability argument, both sides) ────────────────────────────
// The two copies were an 8-line byte-identical body under TWO names (`mergeEnv` in
// plugin/scripts/profile-policy.ts, `mergeProfileEnv` in packages/quay/src/goal-store.ts), and the
// goal-store copy documented itself as a deliberate 复刻 of the profile-policy one. The rename is
// exactly what hid the pair from name-based scans; only a body digest could see it.
//
// The direction must be `plugin → kernel`. The same implementation CANNOT live in
// `plugin/scripts/profile-policy.ts` and be imported by the product side: `packages/**` importing
// `plugin/**` is the REVERSE EDGE that `plugin/scripts/import-graph-check.ts`'s `reverseEdges`
// ratchet (baselined at 0) forbids — and `goal-store.ts` already records that direction explicitly
// ("DIRECTION OF THE DEPENDENCY: product → plugin, never the reverse"). So the kernel leaf is the
// one placement both layers reach: the product side imports it in-package, and the mechanism side
// imports it across the tree (the same shape as `plugin/scripts/worker-driver.ts` /
// `manager-tick-readings.ts` → `kernel/proc-identity.ts`, neither of which needs a plugin-side
// re-export shim because no laid-down tool imports it by a sibling specifier).
//
// In the SHIPPED artifact the plugin bundler (packages/quay/scripts/build-plugin-dist.mjs,
// `coreSrcAliasPlugin`) re-points every `packages/quay/src/**` specifier coming from a plugin source
// onto the real Core source tree and INLINES it into the bundle — so the mechanism side's bundles
// carry this file themselves and need no `packages/` tree at runtime.
//
// KERNEL BOUNDARY (import-graph-check 第四规则): this file imports NOTHING. It is a leaf, so it can
// never participate in a value or type cycle, and the boundary rule that kernel files may not
// import outside the kernel is satisfied vacuously.
//
// NOT A CHECKER, NOT AN INSTRUMENT: it answers no question of its own and is deliberately absent
// from the capability catalog's QUESTION table — it is a primitive consumed by instruments that do.

/**
 * Merge `override` on top of `base`, with the `""`-cancels-inheritance rule: a key whose override
 * value is `""` is DELETED from the result (not set to the empty string), so it stops inheriting a
 * `base` value. Every OTHER value — including `"0"` — is taken as-is.
 *
 * Byte-semantics note (this is the contract the two copies were held to by hand): a key whose override
 * value is `""` is DELETED from the result, so it stops inheriting a `base` value. The mechanism layer
 * retains this form deliberately (plugin/scripts/profile-policy.ts:12 的 ⚠️: manager 靠它取消 917k
 * 三件套；`"0"` 是有效值要保留 —— 丢了会让 manager 静默继承 917k). `"0"` is a VALID value and must
 * survive, so the test is `=== ""`, never truthiness.
 *
 * ⛔ THE ANCHOR IS DEAD, and this note records that rather than repeating it (2026-09-26, measured):
 * both copies used to cite `quay-launch.sh:98`'s jq `with_entries(select(.value != ""))` as the rule's
 * source. That jq is GONE — the shell layer migrated to the explicit `unset` list, and says so at
 * `plugin/scripts/quay-launch.sh:124`: 「取消继承 = 从 base env 删 unset 键（显式列表，⛔ 非空串约定）」.
 * `applyUnset` (profile-policy.ts) is that explicit form's TypeScript counterpart. The `""` rule is
 * kept here because the TS policy layer still honours it, NOT because a shell site still defines it.
 *
 * @param base     the inherited env (never mutated)
 * @param override the layer on top (never mutated; `""` values delete their key)
 */
export function mergeEnv(base: Record<string, string>, override: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = { ...base };
  for (const [k, v] of Object.entries(override)) {
    if (v === "") delete out[k];
    else out[k] = v;
  }
  return out;
}
