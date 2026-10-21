// touches-annotation.ts — the ONE trailing full-width `（…）` annotation stripper, a kernel leaf.
//
// ── THE DEFECT THIS CLOSES (task gap-three-pure-judges-kernel-single-def, AC-909) ───────────────
// `stripTrailingFullWidthAnnotation` existed as TWO byte-identical definitions that shared no import
// edge: `packages/quay/src/observation.ts` (Core's mirror of the plugin Touches parser) and
// `plugin/scripts/touches-parser.ts` (the ONE `## Touches` parser). The mirror relationship was held
// together by a comment ("Core cannot import a plugin script, so this is the mirror; keep the two in
// step") — prose, not structure. The reachability claim behind that comment is STALE: the plugin
// bundler (`packages/quay/scripts/build-plugin-dist.mjs`'s `coreSrcAliasPlugin`) re-points every
// `packages/quay/src/**` specifier onto the real Core source tree and INLINES it, so the mechanism
// layer CAN statically import this file (precedent: `plugin/scripts/ready-pool-check.ts` importing
// `kernel/task-shape-artifacts.ts`). `kernel/` is the one location both layers reach without a
// `packages/**` → `plugin/**` reverse edge; a kernel file may import nothing outside `kernel/`
// except bare specifiers, so this leaf cannot create a cycle.
//
// NESTED-PAREN handling (gap-touches-parser-strip-annotation-nested-parens — 2 real occurrences:
// a23 `（…`（新增…）`…）` + provisioning `（新：…（config/gates/运行时载体）…）`, each of which the old
// `\s*（[^）]*）\s*$` regex could NOT strip because `[^）]*` cannot cross a `）`): this is a
// BALANCED-PAREN scan, not a regex. We scan from the END for the LAST `）` and walk backward to its
// MATCHING `（`, counting depth so a NESTED full-width pair inside the annotation does not terminate
// the scan early. Only FULL-WIDTH parens are counted — an ASCII `(` that is literal text inside the
// annotation (`$(` command-substitution syntax) is NOT mistaken for the annotation's opener, and an
// unbalanced trailing `）` (no matching `（`) is left alone (old behavior).
//
// PURE LOGIC — no imports. Side-effect-free by contract.

/** Trailing balanced full-width `（…）` strip (nested pairs included); unchanged when the trimmed
 *  entry does not END in a full-width annotation. */
export function stripTrailingFullWidthAnnotation(s: string): string {
  const t = s.trimEnd();
  const i = t.length - 1;
  if (t[i] !== "）") return s;
  let depth = 0;
  let open = -1;
  for (let j = i; j >= 0; j--) {
    const c = t[j];
    if (c === "）") depth++;
    else if (c === "（" && --depth === 0) { open = j; break; }
  }
  if (open === -1) return s;
  let k = open;
  while (k > 0 && /\s/.test(t[k - 1])) k--; // also drop whitespace before the annotation (old \s*)
  return t.slice(0, k);
}
