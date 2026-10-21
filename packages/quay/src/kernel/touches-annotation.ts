// touches-annotation.ts — the ONE Touches annotation stripper, a kernel leaf:
//   · `stripTrailingFullWidthAnnotation` — the trailing full-width `（…）` half;
//   · `stripTouchAnnotation` — the COMPLETE entry strip (leading-path cut + both trailing
//     annotation spellings repeated to a fixed point), used by BOTH the plugin parser and Core.
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

// ── stripTouchAnnotation — the COMPLETE entry strip (single definition) ─────────────────────────
// BEFORE (task gap-routine-semantic-dedup-scan-strip-touch-annotation): this function existed as TWO
// copies of the same algorithm — same three regexes, same fixed-point loop over the kernel's
// full-width strip + an ASCII `(…)` regex — in `plugin/scripts/touches-parser.ts` and
// `packages/quay/src/observation.ts`. They differed only by a `String(entry)` type-safety wrapper,
// and both ALREADY imported `stripTrailingFullWidthAnnotation` from THIS file, so nothing structural
// prevented the composite from living here. The fix is the same one gap-three-pure-judges-kernel-
// single-def applied to the full-width half: move the whole algorithm into the kernel leaf and let
// both callers delegate. `String()` is applied once, inside, so the wrapper difference disappears.
//
// ORDER-INDEPENDENCE (gap-touches-parser-annotation-strip-single-shot-order-dependent): the two
// annotation spellings must commute. Two parts:
//   1. LEADING-PATH CUT — a repo path contains no whitespace, backtick/quote, or parenthesis (ASCII
//      or full-width), so when a bullet STARTS with a concrete path token and an annotation begins
//      right after, the path IS that token and the remainder is annotation/prose. GATED on the token
//      being CONCRETE (contains `/`, or ends in a file extension) so a prose bullet is never
//      truncated into a short spurious glob.
//   2. FIXED-POINT LOOP over the two trailing strips (full-width balanced-paren + ASCII `(…)`) —
//      keeps the historical reading for entries the cut does not cover while making the two
//      annotation spellings commute. Strictly shorter on every strip ⇒ it halts.
//
// NESTED-PAREN handling for the full-width half lives in stripTrailingFullWidthAnnotation above.
const TOUCH_PATH_TOKEN_RE = /^[^\s`'"()（）]+/;
const TOUCH_CONCRETE_PATH_RE = /\/|\.[A-Za-z0-9]{1,10}$/;
const TOUCH_ANNOTATION_HEAD_RE = /^[`'"（(]/;

/** Strip a trailing annotation (`（…）` full-width or `(…)` ASCII) from a Touches entry, with the
 *  leading-path cut that makes the two spellings commute. The ONE implementation: both
 *  `plugin/scripts/touches-parser.ts` and `packages/quay/src/observation.ts` delegate here. */
export function stripTouchAnnotation(entry: string): string {
  const raw = String(entry);
  // 1. Leading-path cut — a concrete leading path token whose annotation starts immediately after.
  const t = raw.trim();
  const m = TOUCH_PATH_TOKEN_RE.exec(t);
  if (m && TOUCH_CONCRETE_PATH_RE.test(m[0])) {
    const tail = t.slice(m[0].length).replace(/^\s+/, "");
    if (tail && TOUCH_ANNOTATION_HEAD_RE.test(tail)) return m[0];
  }
  // 2. The two trailing strips, repeated to a fixed point (strictly shorter on every strip ⇒ halts).
  let s = raw.trimEnd();
  for (;;) {
    const before = s;
    s = stripTrailingFullWidthAnnotation(s);
    s = s.replace(/\s*\([^)]*\)\s*$/, "").trimEnd();
    if (s === before) break;
  }
  return s.trim();
}
