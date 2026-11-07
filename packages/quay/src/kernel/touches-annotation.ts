// touches-annotation.ts — the ONE Touches entry normalizer, a kernel leaf:
//   · `stripTrailingFullWidthAnnotation` — the trailing full-width `（…）` half;
//   · `stripTouchAnnotation` — the COMPLETE entry strip (leading-path cut + both trailing
//     annotation spellings repeated to a fixed point), used by BOTH the plugin parser and Core;
//   · `parseTouchBulletPaths` — the COMPLETE bullet→path pipeline (split → trim → bullet filter →
//     bullet-marker strip → surrounding-quote strip → annotation strip → masked-backtick strip →
//     leading `./` strip → empty drop). Same two layers: `plugin/scripts/touches-parser.ts`
//     re-exports it as `parseTouchEntries`, Core's `observation/blocking.ts` as `parseTouchPaths`.
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

// ── normalizeTouchEntry + parseTouchBulletPaths — the COMPLETE bullet→path pipeline ──────────────
// BEFORE (task gap-routine-semantic-dedup-scan-parse-touch-paths, finding `parse-touch-paths`,
// routine runId `semantic-dedup-scan-1792940684375`): the eight-step pipeline below existed VERBATIM
// in TWO files that shared no import edge —
//   · `plugin/scripts/touches-parser.ts`      → `parseTouchEntries` (the ONE `## Touches` parser), and
//   · `packages/quay/src/observation/blocking.ts` → `parseTouchPaths` (Core's display-surface mirror).
// The annotation half had already been converged here (gap-routine-semantic-dedup-scan-strip-touch-
// annotation); the remaining six steps (split → trim → bullet filter → bullet-marker strip →
// surrounding-quote strip → leading `./` strip → empty drop) were still a hand-maintained mirror
// pinned ONLY by a prose comment ("mirrors touches-parser.ts parseTouchEntries"). Both entries now
// re-export THIS function object, so the mirror is structurally impossible rather than prose-pinned.
//
// The POST-MARKER half is factored out as `normalizeTouchEntry` because `parseTouchEntriesWithTags`
// (same plugin file) needs exactly those five steps around its tag capture — it carried its own copy
// and documented the path half as "BYTE-IDENTICAL to parseTouchEntries" in prose. It now calls the
// same function, so that sentence is true by construction (硬规则 5b: fix the sibling too).
//
// Behavior (unchanged from both former copies — `plugin/test/touches-parser-parity.test.mjs`'s
// fixture set is the golden, and `packages/quay/test/kernel-pure-judges.test.mjs` asserts identity):
//   - bullets: `- ` or `* ` (leading whitespace tolerated)
//   - surrounding quotes/backticks stripped BEFORE and AFTER the annotation strip, because the
//     annotation may sit OUTSIDE the backticks (`` `path/x.ts` (new) ``) or INSIDE them
//     (`` `path/x.ts (new)` ``) — the second strip removes the backtick the annotation had masked
//   - a trailing annotation (full-width `（…）` or ASCII `(…)`) stripped by stripTouchAnnotation
//   - a leading `./` stripped
//   - empty entries dropped
const TOUCH_QUOTE_STRIP_RE = /^[`"']+|[`"']+$/g;

/** Strip surrounding quotes/backticks from a Touches entry (the step that must run BOTH before the
 *  annotation strip — the annotation may sit inside the backticks — and after it — a trailing
 *  backtick the annotation had masked). Exported because the tag-aware reader
 *  (`parseTouchEntriesWithTags`) needs the pre-annotation form on its own, to see a trailing `(new)`
 *  that a closing backtick would otherwise hide. */
export function stripTouchQuotes(entry: string): string {
  return String(entry).replace(TOUCH_QUOTE_STRIP_RE, "").trim();
}

/** Normalize ONE Touches entry whose bullet marker is already removed: surrounding quotes/backticks
 *  (before AND after the annotation strip), the trailing annotation, and a leading `./`. */
export function normalizeTouchEntry(entry: string): string {
  const stripped = stripTouchAnnotation(stripTouchQuotes(entry)); // quotes → annotation → (masked) quotes
  const cleaned = stripTouchQuotes(stripped);
  return cleaned.replace(/^\.\//, "").trim();                    // then a leading "./"
}

export function parseTouchBulletPaths(touchesSection: string): string[] {
  if (!touchesSection) return [];
  return String(touchesSection)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^[-*]\s+/.test(l))
    .map((l) => l.replace(/^[-*]\s+/, "").trim())
    .map(normalizeTouchEntry)
    .filter(Boolean);
}

// ── THE RULES, NAMED (task gap-touches-parser-a-self-describing) ─────────────────────────────────
// The three rules below govern every `## Touches` declaration this repo reads. Until this block they
// had NO name, NO agent-visible code, and NO way to tell one failure from another: an agent could
// only learn them by reading this file or by hitting a downstream rejection, and a rejection could
// not say WHICH rule fired (annotation-strip vs. section-selection vs. label-recognition). The
// tables (PROBLEM, READING, and — appended below — JUDGEMENT) are the naming point: PURE DATA, no
// imports, no logic (this file is a kernel leaf).
//
// ⛔ These tables are the ONE place the codes are written down. The `task create --help` grammar
// section RENDERS them (`packages/quay/src/cli/help.ts`) and never re-types the list; the reader
// that reports them (`diagnoseTouches`, plugin/scripts/touches-parser.ts) also reads them. A second
// hand-written copy of a vocabulary is exactly the drift shape this repo keeps paying for.
//
// The three rules (ids are the historical probe ids they were named by; ⛔ never reuse an id):
//   s3-7    annotation stripping — a trailing full-width （…） or half-width (…) is an ANNOTATION,
//           not part of the path; the two spellings must commute (fixed-point strip).
//   sa5b-3  section selection — WHICH heading out of possibly several `^touches` headings is the
//           declaration (exact `Touches` first, then highest level, earliest among ties).
//   sa5b-4  label recognition — the structural tags `(new)` / `(delete)` / `(deleted)` that exempt
//           an entry from the exists-on-disk check, and only those exact spellings.

/** The rule ids above, in report order. A caller that wants a COUNTERFACTUAL reading (what the
 *  parser would say with rule X switched off) passes a subset of this list to `diagnoseTouches`. */
export const TOUCHES_RULE_IDS = ["s3-7", "sa5b-3", "sa5b-4"] as const;

/** PROBLEM codes — the diagnostics an author has to act on. Each carries the grammar `atom` it
 *  reports on (`annotation` | `section` | `label`), the `rule` that governs it, and a one-line
 *  `meaning` that is rendered verbatim in `quay task create --help`. */
export const TOUCHES_PROBLEM_CODES = [
  {
    code: "touches-annotation-halfwidth-literal",
    atom: "annotation",
    rule: "s3-7",
    meaning:
      "a half-width (…) that is LITERAL text (more path follows the closing paren, e.g. `foo(bar).ts`) is stripped as if it were a trailing annotation — the tail after the paren is lost",
  },
  {
    code: "touches-section-ambiguous",
    atom: "section",
    rule: "sa5b-3",
    meaning:
      "the body carries more than one heading matching ^touches — exactly ONE section is read, so the others are dead text that looks like a declaration",
  },
  {
    code: "touches-label-unrecognized",
    atom: "label",
    rule: "sa5b-4",
    meaning:
      "a label-family annotation ((add)/(create)/(removed)/…) is not one of the recognized structural tags — it is treated as prose and the entry keeps NO exists-on-disk exemption",
  },
  {
    code: "touches-label-fullwidth",
    atom: "label",
    rule: "sa5b-4",
    meaning:
      "a recognized structural tag written in FULL-WIDTH parens （new）/（delete） is not captured as a tag (only ASCII (…) is) — the entry silently loses its (new)/(delete) exemption",
  },
] as const;

/** READING codes — the non-boolean observables of a declaration. A problem code says "something is
 *  wrong"; a reading says "this is what the parser actually read", and it is what changes when a
 *  rule is switched off (that is the arm that proves the rule is load-bearing rather than a label). */
export const TOUCHES_READING_CODES = [
  {
    code: "touches-section-canonical",
    atom: "section",
    rule: "sa5b-3",
    meaning:
      "which selection path chose the section: 'exact' (a heading spelled exactly Touches), 'fallback' (highest level among ^touches headings), or 'absent'",
  },
  {
    code: "touches-label-new",
    atom: "label",
    rule: "sa5b-4",
    meaning: "how many declared entries carry the (new) structural tag (a file this task will CREATE)",
  },
  {
    code: "touches-label-delete",
    atom: "label",
    rule: "sa5b-4",
    meaning: "how many declared entries carry the (delete)/(deleted) structural tag (a file this task will DELETE)",
  },
] as const;

// ── JUDGEMENT codes — the third table, and a DIFFERENT kind of code ──────────────────────────────
// A PROBLEM code says "the parser could not read what you wrote"; a READING says "here is what the
// parser read". Neither says "the declaration was read fine, and it is a BAD declaration" — that is
// a JUDGEMENT, and until now the two judgements that exist had no name an author could see. One of
// them (`touches-overbroad`) lived only inside `task-schema-check` and
// `prepare-admission-check`; the other (`touches-multi-path-bullet`) appeared only as a promotion
// rejection reason. An agent that wrote `src/*` learned nothing about it from any author-facing
// surface (task gap-touches-judgement-codes-author-surface, the DSI triage's B slice / Q2).
//
// ⛔ These rows are NOT merged into `TOUCHES_PROBLEM_CODES`: a problem code is emitted by
// `diagnoseTouches` (plugin/scripts/touches-parser.ts) and carries a parser `atom` + a rule id from
// `TOUCHES_RULE_IDS` — the judgement codes are emitted by two separate judges and are NOT parser
// rules, so putting them in the same table would give `diagnoseTouches` a row it can never produce
// and `TOUCHES_RULE_IDS` an id with no counterfactual reading. Same naming point, separate table.
//
// ⛔ This is the ONE place these two codes are written down. `quay task create --help` renders the
// table (packages/quay/src/cli/help.ts's `touchesGrammarLines`), and the two judges reference the
// exported constants below rather than re-typing the literals — a second hand-written list is the
// drift shape this file's header forbids.
//
// Rule ids are the historical probe ids, kept for traceability (⛔ never reuse an id):
//   x3-1    overbroad glob — a declaration is overbroad when a wildcard is reachable with fewer than
//           two CONCRETE leading path segments (`*`, `**`, `src/*`, `packages/**`), or it is empty.
//           An exact path, or a glob anchored ≥2 segments deep (`packages/quay/**`), is fine.
//   sa5b-5  one entry one path — a single Touches bullet must declare exactly ONE path/glob; a bullet
//           joining several with " / ", " + ", "、", "，" or "," parses to one COMPOSITE entry that
//           matches no file and hides every real path from the overlap judgment.

/** `touches-overbroad` — the stable code string, exported so the judges name it without re-typing. */
export const TOUCHES_JUDGEMENT_CODE_OVERBROAD = "touches-overbroad";
/** `touches-multi-path-bullet` — ditto. */
export const TOUCHES_JUDGEMENT_CODE_MULTI_PATH = "touches-multi-path-bullet";

/** JUDGEMENT codes — shape judgements on a declaration the parser DID read. Rendered verbatim in
 *  `quay task create --help` next to the problem/reading codes, with `kind` = `judgement`. */
export const TOUCHES_JUDGEMENT_CODES = [
  {
    code: TOUCHES_JUDGEMENT_CODE_OVERBROAD,
    rule: "x3-1",
    meaning:
      "a declared glob is too broad to constrain writes: a wildcard reachable with fewer than two concrete leading path segments (`*`, `**`, `src/*`, `packages/**`) — write an exact path or anchor the glob ≥2 segments deep (`packages/quay/**`); enforced at the todo→ready promotion gate and by task-schema-check",
  },
  {
    code: TOUCHES_JUDGEMENT_CODE_MULTI_PATH,
    rule: "sa5b-5",
    meaning:
      "one bullet declares SEVERAL paths joined by a separator (` / `, ` + `, `、`, `，`, `,`) — the parser reads the whole line as ONE composite entry that matches nothing and hides every real path from the overlap judgment; put one path per bullet; enforced at the todo→ready promotion gate and by the pre-commit hook",
  },
] as const;
