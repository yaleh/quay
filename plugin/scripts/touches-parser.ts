// touches-parser.ts — the ONE `## Touches` bullet-parser implementation (ADR-004 single-source).
import fs from "node:fs";
import path from "node:path";
import { isDirectEntry } from "./gate-script-base.ts";
// The annotation-strip algorithm (full-width + ASCII, leading-path cut, fixed-point loop) AND the
// bullet→path pipeline that wraps it are the kernel's ONE definitions; this module delegates and
// re-exports them for its own consumers (e.g. task-status-drift-check.ts). Task
// gap-routine-semantic-dedup-scan-strip-touch-annotation removed the annotation-strip copy that used
// to live here; gap-routine-semantic-dedup-scan-parse-touch-paths removed the pipeline copy.
import { stripTouchAnnotation, parseTouchBulletPaths, normalizeTouchEntry, stripTouchQuotes } from "../../packages/quay/src/kernel/touches-annotation.ts";
// The NAMED rules (task gap-touches-parser-a-self-describing): two pure-data tables in the kernel.
// This module reports them via `diagnoseTouches` below; cli/help.ts RENDERS them. ⛔ Neither layer
// re-types a code — the kernel table is the one naming point.
import { TOUCHES_PROBLEM_CODES, TOUCHES_READING_CODES, TOUCHES_RULE_IDS } from "../../packages/quay/src/kernel/touches-annotation.ts";
export { stripTouchAnnotation, TOUCHES_PROBLEM_CODES, TOUCHES_READING_CODES, TOUCHES_RULE_IDS };
//
// Root cause this module exists to close (gap-task-body-has-n-parsers-and-no-authority):
// the repo had N independent Touches parsers, none authoritative, and they DISAGREED on the
// same input line. `touches-orthogonality-check.ts`'s `parseTouches` stripped backticks only at
// the very start/end of the line, so a bullet like `` - `foo.ts` (new) `` lost its LEADING
// backtick but kept the annotation, then the annotation strip left a RESIDUAL trailing backtick
// → wrong path `` "foo.ts`" ``. `task-status-drift-check.ts`'s `parseTouchEntries` got it right
// (it strips quotes/backticks BEFORE and AFTER the annotation strip). The wrong one is the one
// fast mode uses for concurrency eligibility (`concurrent-batch-scheduler.ts` →
// `checkTouchesPair`), so a `(new)`-annotated task was judged "matched nothing (likely a typo)"
// when the real cause was an un-stripped annotation.
//
// THIS module is the single implementation. Every other parser — parseTouches
// (touches-orthogonality-check.ts), parseBulletList (select-tests-for-touches.ts),
// _extractGlobsFromSection (prepare-admission-check.ts), checkTouches (task-schema.ts) —
// delegates to it. There is deliberately NO second copy of this logic anywhere (AC1: grep for
// `function parseTouchEntries` finds exactly one definition).
//
// Behavior (the "already-correct" task-status-drift-check implementation, plus the leading
// `./` strip that every other parser already applied — a clean path is a clean path):
//   - bullets: `- ` or `* ` (leading whitespace tolerated)
//   - surrounding quotes/backticks stripped BEFORE the annotation strip
//   - a trailing `(…)` annotation stripped (the annotation can sit OUTSIDE the backticks —
//     `` `path/x.ts` (new) `` — or INSIDE — `` `path/x.ts (new)` ``; both forms resolve)
//   - any quote/backtick the annotation had MASKED (a trailing backtick before the `(…)`)
//     stripped AFTER — this is the residual-backtick bug the naive parsers all had
//   - a leading `./` stripped
//   - empty entries dropped

// Trailing "(…)" annotation strip — a Touches entry commonly carries a trailing parenthetical
// note (`(new)`, `(refactor Verify phase)`, `(extract from)`) that is NOT part of the path.
// Repo paths never contain parentheses, so stripping a trailing "(…)" cannot corrupt a real path.
// The FULL-WIDTH spelling `（…）` (the CJK convention used by many task Touches bullet lists in
// this repo, e.g. `plugin/scripts/（触摸→…映射）`) is stripped too (gap-scoped-runs-pay-full-static-
// check-overhead AC3: the touch-selection mechanism must resolve every annotation spelling the repo
// actually uses, so a scoped run never silently skips a change-relevant check because of a
// full-width annotation).
//
// NESTED-PAREN handling (gap-touches-parser-strip-annotation-nested-parens) and ORDER-INDEPENDENCE
// (gap-touches-parser-annotation-strip-single-shot-order-dependent: leading-path cut + the two
// trailing strips repeated to a fixed point) both live in the kernel implementation —
// `packages/quay/src/kernel/touches-annotation.ts` (see its header for the algorithm and the
// measured corpus). This module no longer carries any part of it: `stripTouchAnnotation` is
// imported and re-exported above. It ships self-contained through build-plugin-dist's
// `coreSrcAliasPlugin` (the same inlining precedent as ready-pool-check.ts importing
// kernel/task-shape-artifacts.ts).

// Parse a `## Touches` bullet list into bare path/glob strings (backticks/quotes removed,
// trailing "(…)" annotations stripped, leading `./` removed). Returns [] for a missing/empty
// section.
//
// The WHOLE pipeline — not just the annotation half — is the kernel leaf's ONE definition
// (`parseTouchBulletPaths` in `packages/quay/src/kernel/touches-annotation.ts`), re-exported here
// under the historical name every consumer imports (gap-routine-semantic-dedup-scan-parse-touch-
// paths: the eight steps below used to be copied verbatim into
// `packages/quay/src/observation/blocking.ts`'s `parseTouchPaths`, pinned only by a prose "mirror"
// comment). Re-exporting the FUNCTION OBJECT — rather than wrapping it in an equal-bodied local
// function — is what makes the two layers unable to drift; `kernel-pure-judges.test.mjs` asserts
// the identity, not merely equal output.
export { parseTouchBulletPaths as parseTouchEntries };

// Parse a `## Touches` bullet list into bare path/glob strings PLUS the trailing "(…)" annotation
// when it is one of the structural markers the dispatch-eligibility resolve check understands:
// `(new)` — a file this task will CREATE, so it need NOT exist yet; `(delete)` — a file this task
// will DELETE, and a delete of an already-gone file is a no-op, so it need NOT exist either. Both
// tags are EXEMPT from the existence check (the AC2 wording: "NOT tagged `(new)`/`(delete)`").
// Returns [{path, tag}] where tag is 'new' | 'delete' | null.
// The path extraction is BYTE-IDENTICAL to parseTouchEntries (same quote/backtick strip before the
// annotation, same single annotation strip, same masked-backtick strip after, same leading "./");
// the only difference is the tag is captured from the annotation before it is stripped. This is
// the tag-aware read used by touches-orthogonality-check.ts's checkTouchesResolve
// (gap-ready-queue-still-lists-eight-tasks-targeting-retired-pipeline-files): a `(new)` touch must
// never be judged "missing from the tree", and the parity test asserts
// parseTouchEntriesWithTags(s).map(e => e.path) === parseTouchEntries(s) for the fixture set.
/** Structural-tag reader: `(new)` / `(delete)` / `(deleted)` → the tag; anything else → null. */
function tagFromAnnotation(text) {
  const a = String(text ?? "").trim().toLowerCase();
  if (a === "new") return "new";
  if (a === "delete" || a === "deleted") return "delete";
  return null;
}

/** Read the structural tag off ONE Touches entry (bullet marker already removed) — the ONE tag
 *  capture, used by `parseTouchEntriesWithTags` and by `diagnoseTouches`'s counterfactual reading.
 *  FIRST the common end-anchored form `path (new)`; then, when the line terminates with a full-width
 *  annotation (）， not )）, the ASCII (…) sits BEFORE it — `` path/x.ts (new)（描述） `` — the
 *  end-anchored match can't see it, so a pre-existing quirk silently dropped the tag (every
 *  (new)（…） task was judged "must-exist-missing" → promotion reject). Match the last ASCII (…)
 *  that precedes a （ to recover it. The PATH is unaffected (the annotation strip removes both);
 *  only the tag is recovered. ⛔ sa5b-4 — this is the rule's whole surface: only the ASCII spelling,
 *  only these three words. `touches-label-fullwidth` / `touches-label-unrecognized` name its two
 *  silent-failure edges. */
export function touchTagOf(entry) {
  const e = stripTouchQuotes(String(entry ?? ""));
  const tag = tagFromAnnotation(e.match(/\s*\(([^)]*)\)\s*$/)?.[1]);
  if (tag) return tag;
  return tagFromAnnotation(e.match(/\s*\(([^)]*)\)\s*[（]/)?.[1]);
}

export function parseTouchEntriesWithTags(touchesSection) {
  if (!touchesSection) return [];
  const out = [];
  for (const raw of String(touchesSection).split(/\r?\n/)) {
    const line = raw.trim();
    const m = line.match(/^[-*]\s+(.+)$/);
    if (!m) continue;
    let entry = m[1].trim();
    entry = stripTouchQuotes(entry); // surrounding quotes/backticks first — so a `path (new)` tag is visible
    // The tag capture is `touchTagOf` BELOW — one definition. `diagnoseTouches` (this file, the rules
    // block at the bottom) reads the SAME function, so a counterfactual reading (sa5b-4 switched off)
    // and the shipped reading can never disagree about what a tag spelling is.
    const tag = touchTagOf(entry);
    // The post-marker half (annotation strip → masked-backtick strip → leading "./") is the kernel's
    // ONE `normalizeTouchEntry` — the SAME five steps parseTouchEntries runs, so the "path extraction
    // is byte-identical" claim above is structural, not prose (gap-routine-semantic-dedup-scan-
    // parse-touch-paths, 硬规则 5b: the copy inside this very file is a sibling of the reported one).
    const path = normalizeTouchEntry(entry);
    if (!path) continue;
    out.push({ path, tag });
  }
  return out;
}

// ── Bare-directory + uncertain-annotation detection ───────────────────────────────────────────────────
// (tasks/gap-touches-bare-dir-uncertain-declaration-drags-the-pool) — a Touches entry must NOT declare
// a bare-directory glob with an uncertain annotation ('若成脚本' / '或等价' / '可能'). A bare directory
// expands to EVERYTHING under it (a SPECULATIVE broad declaration that collides with every other task
// touching that dir — measured: branch-model's `plugin/scripts/（…，若成脚本）` expanded to 100+ files and
// sank 5/6 pool candidates). Rule: declare a CONCRETE path, or PRE-CLAIM an explicit candidate path
// (e.g. `plugin/scripts/branch-helper.sh`), never a bare dir with '若成脚本'-style uncertainty.
// NEW-FILE COROLLARY: if the pre-claimed file does NOT exist yet, mark the entry `(new)` — the
// trailing-annotation form (`path/file.ts (new)`) is what parseTouchEntriesWithTags extracts as
// tag="new" (NOT a mid-line `(new)` — the annotation must be the LAST `(...)` on the bullet). The
// admission gate's `touchesResolve` then counts it as resolveable-by-construction instead of MISSING
// (gap-check-set-after-change-diff-nameonly-intersect-judged-objects: mid-line `(new)` before a
// full-width（…）annotation was NOT captured → tag=null → entry treated as a missing file).
// This module provides the MECHANICAL flag; the consumer check (task-contract-check.ts
// `bare-dir-uncertain-touch`) wires it to the task store + a shrink-only baseline.
export const UNCERTAIN_TOUCH_ANNOTATION_RE = /若成|若作|若|或等价|或|可能|也许|待定|暂定|拟|说不定|未定/;

/** True when a (post-annotation-strip) Touches path is a BARE DIRECTORY declaration:
 *  - empty (the annotation IS the whole entry — no concrete path at all);
 *  - a trailing `/` (an explicit directory);
 *  - an existing directory on disk (when `root` is given);
 *  - directory-shaped (no wildcard and the last segment carries no `.` extension marker) — a path
 *    that is neither an existing file nor an existing directory and names no concrete file.
 *  A concrete file path (`plugin/scripts/fork-baseline.ts`, `plugin/VERSION`) is NOT bare.
 *  `root` is optional; when given it fs-confirms existing files (so an extension-less concrete file
 *  like `plugin/VERSION` is not mistaken for a directory). */
export function isBareDirectoryTouch(p, root) {
  const s = String(p ?? "").replace(/^\.\//, "").trim();
  if (!s) return true;                // empty declaration
  if (s.endsWith("/")) return true;   // trailing slash = directory
  if (/[*?]/.test(s)) return false;   // a wildcard is a glob, judged by the overbroad rules
  if (root) {
    try {
      const st = fs.statSync(path.join(root, s));
      if (st.isDirectory()) return true;
      if (st.isFile()) return false;  // an existing file (even extension-less) is concrete
    } catch { /* not on disk — fall through to the shape heuristic */ }
  }
  return !s.split("/").pop().includes("."); // directory-shaped: no file-extension in the last segment
}

/** Flag Touches entries that combine a BARE-DIRECTORY path with an UNCERTAIN annotation
 *  ('若成脚本' / '或等价' / '可能' family). Returns [{ raw, path, annotation }] — `raw` is the bullet
 *  text after the `- ` marker, `path` is the post-annotation-strip path, `annotation` is the trailing
 *  （…）/(…) content. `root` is optional (fs-confirms existing directories/files). */
export function flagBareDirUncertainTouches(touchesSection, root) {
  if (!touchesSection) return [];
  const out = [];
  for (const raw of String(touchesSection).split(/\r?\n/)) {
    const line = raw.trim();
    const m = line.match(/^[-*]\s+(.+)$/);
    if (!m) continue;
    const entry = m[1].trim();
    const annM = entry.match(/(?:（([^）]*)）|\(([^)]*)\))\s*$/);
    if (!annM) continue;
    const annotation = (annM[1] ?? annM[2] ?? "").trim();
    if (!annotation || !UNCERTAIN_TOUCH_ANNOTATION_RE.test(annotation)) continue;
    const p = stripTouchAnnotation(entry);
    if (isBareDirectoryTouch(p, root)) out.push({ raw: entry, path: p, annotation });
  }
  return out;
}

// Locate the `## Touches` section of a full task/charter body.
//
// Returns { hasSection, section, heading, startLine, level }:
//   hasSection  "no declaration" (→ conservative) vs "declared empty/no bullet paths" — the
//               touches-orthogonality-check.ts parseTouches contract.
//   section     the raw body text of the SELECTED section.
//   heading     the selected heading's text (trimmed, `#` markers removed); null when none matched.
//   startLine   1-based line number of the selected heading; null when none matched.
//   level       the selected heading's `#` depth (1..6); null when none matched.
//
// The last three exist for 硬规则 3b: without them, "read a Touches section that declares no
// bullet paths" and "never found a Touches section at all" are the SAME reading (`section: ""`),
// so a consumer cannot report the second without also accusing the first. They make the two
// non-isomorphic.
//
// SELECTION RULE (gap-touches-parser-early-subheading-latch-hides-declaration). The old rule took
// the FIRST heading whose text matched /^touches\b/i and ended the section at the next heading of
// ANY depth. A `### Touches 最终清单（…）`-style subheading placed BEFORE the real `## Touches`
// therefore latched the section early, its body was cut at the next `###`, and the real `## Touches`
// was never read → `globs = []`, indistinguishable from "no declaration". Downstream
// anti-drift-touches-check.ts then reported every changed file as `out-of-declared: task wrote
// <file> (matches no declared Touches glob)` — blaming the declaration for a parser defect, and
// making the task permanently unlandable. Measured on the real victim body
// (tasks/gap-git-history-window-notes-ref-dominates.md): 0 globs read while the real `## Touches`
// carried 10.
//
// The rule is now, over ALL headings whose text matches /^touches\b/i (case-insensitive, trimmed):
//   1. an EXACT `Touches` wins (case-insensitive; a `## Touches 声明…` prose heading is not one);
//      earliest of those if several;
//   2. otherwise the HIGHEST level (`#` fewest); earliest among ties.
// Two same-level `## Touches` → the first, preserving the historical semantics.
//
// The EXTENT rule is deliberately UNCHANGED: the section still ends at the next heading of ANY
// depth. Loosening it to "level <= the selected level" (so a subheading would not truncate its own
// section) was measured against all 2299 bodies in tasks/*.md and REJECTED — it is not a hypothesis
// left untested. The repo's own convention puts a `### Finding：…` note immediately after
// `## Touches`, and those notes carry PROSE BULLET LISTS; under the loosened rule the parser reads
// them as declared paths. Four real tasks were affected:
//   DIR-075                                                                  3 -> 15
//   gap-closed-goal-acs-leave-reverify-scope-standing-invariants-undeclared  17 -> 20
//   gap-mcp-server-test-deadlocks-at-high-test-concurrency                    5 -> 18
//   gap-write-ownership-extend-beyond-tasks-to-outer-core-and-hot-files       6 ->  8
// e.g. `- **① 确定性规则**：冲突路径…` and `- ① 首次（昨日…）conc=16 —— 死锁` became globs. That is
// the SAME defect class this function is being fixed for — a declaration reading that does not
// match the declaration's intent — and it is the dangerous direction (a spurious glob makes a
// genuinely out-of-declared write PASS anti-drift). The SELECTION rule alone fixes the latch
// (measured: exactly ONE body in the store changes, the intended 0 -> 5).
export function extractTouchesSection(fullText) {
  const lines = String(fullText).split(/\r?\n/);
  const candidates = [];
  for (let i = 0; i < lines.length; i++) {
    const heading = lines[i].trimEnd().match(/^(#{1,6})\s+(.*)$/);
    if (!heading) continue;
    const text = heading[2].trim();
    if (/^touches\b/i.test(text)) candidates.push({ line: i, level: heading[1].length, text });
  }
  if (candidates.length === 0) {
    return { hasSection: false, section: "", heading: null, startLine: null, level: null };
  }
  // Priority 1 — an exact `Touches` heading (the canonical spelling), earliest first.
  const exact = candidates.filter((c) => c.text.toLowerCase() === "touches");
  const chosen = exact.length
    ? exact[0]
    : candidates.slice().sort((a, b) => a.level - b.level || a.line - b.line)[0];
  const out = [];
  for (let i = chosen.line + 1; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    if (/^#{1,6}\s+/.test(line)) break; // the next heading of ANY depth ends the section
    out.push(line);
  }
  return {
    hasSection: true,
    section: out.join("\n"),
    heading: chosen.text,
    startLine: chosen.line + 1,
    level: chosen.level,
  };
}

// Direct invocation is NOT a CLI operation — this is a shared library. The experiments/
// quay-perpetual-stream/scripts/touches-parser.ts entry is a SYMLINK to this file (so the
// plugin/experiment task-status-drift-check mirrors stay byte-identical and grep finds ONE
// `function parseTouchEntries`). The symlink-mirror-invocation contract requires every symlinked
// .ts under experiments/.../scripts/ to be NON-SILENT on no args, so present the report-tool
// no-args "Usage:" signature here rather than exiting silently (gap-touches-orthogonality-
// symlink-isdirect-mismatch). Imports of this module never trigger this block (isDirectEntry).
// ── diagnoseTouches — the NAMED-RULE reporter (task gap-touches-parser-a-self-describing) ────────
// Before this block an agent could not learn the three `## Touches` rules (s3-7 annotation strip,
// sa5b-3 section selection, sa5b-4 label recognition) from any surface: they existed only as the
// behaviour of the functions above, with no code to name a failure and no way to tell an
// annotation mis-strip from a swallowed section from an unrecognized tag. This function reports
// them by their table codes, and — the part that makes it more than a label printer — every
// READING it reports is computed THROUGH its rule, so switching a rule off changes the reading,
// not merely the message.
//
// ⛔ ADDITIVE ONLY. `parseTouchEntries` / `parseTouchEntriesWithTags` / `extractTouchesSection`
// keep their signatures and return shapes (22 importers); this function is a NEW read surface. It
// never fixes what it reports — an annotation that a rule mis-strips is REPORTED, not re-parsed,
// so the diagnostic cannot silently disagree with what the production readers actually do.
//
// The counterfactual (`options.rules` naming a subset) exists for exactly one purpose: the AC3
// negative arm. With rule X out of the registry, code X must vanish AND the reading on the SAME
// input must change (section heading / entry paths / tags) — otherwise X is decoration. Those
// paths below are the counterfactual READINGS (what the parser would have said without the rule),
// NOT second implementations of it.

/** Bullet entries of a section, bullet marker removed, quotes/backticks stripped — the raw form
 *  the counterfactual readings start from. (The shipped readings go through the kernel pipeline.) */
function touchesBulletEntries(sectionText) {
  const out = [];
  for (const raw of String(sectionText ?? "").split(/\r?\n/)) {
    const m = raw.trim().match(/^[-*]\s+(.+)$/);
    if (m) out.push(stripTouchQuotes(m[1].trim()));
  }
  return out;
}

/** Every heading in the body whose text starts with the word `Touches` — the candidate set
 *  sa5b-3 selects ONE section out of. */
function touchesHeadingCandidates(fullText) {
  const out = [];
  for (const line of String(fullText ?? "").split(/\r?\n/)) {
    const h = line.trimEnd().match(/^(#{1,6})\s+(.*)$/);
    if (h && /^touches\b/i.test(h[2].trim())) out.push({ level: h[1].length, text: h[2].trim() });
  }
  return out;
}

/** sa5b-3 OFF — the counterfactual section read: the FIRST heading whose text starts with `Touches`
 *  latches the section, extent to the next heading of ANY depth (the pre-gap-touches-parser-early-
 *  subheading-latch-hides-declaration behaviour). Kept tiny and named as a counterfactual: it is a
 *  READING of what the rule buys, not a second section parser. */
function sectionWithoutSa5b3(fullText) {
  const lines = String(fullText ?? "").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].trimEnd().match(/^(#{1,6})\s+(.*)$/);
    if (!h || !/^touches\b/i.test(h[2].trim())) continue;
    const body = [];
    for (let j = i + 1; j < lines.length; j++) {
      if (/^#{1,6}\s+/.test(lines[j].trimEnd())) break;
      body.push(lines[j].trimEnd());
    }
    return { hasSection: true, section: body.join("\n"), heading: h[2].trim(), startLine: i + 1, level: h[1].length, selection: "latch" };
  }
  return { hasSection: false, section: "", heading: null, startLine: null, level: null, selection: "absent" };
}

/** The label vocabulary sa5b-4 nearly covers: a word here that is NOT one of the three recognized
 *  spellings (new / delete / deleted) is an UNRECOGNIZED label — the author meant a structural tag
 *  and got prose. Deliberately closed and small: a free-text annotation (`refactor Verify phase`,
 *  `extract from`, `新增…说明`) is NOT a label and must not be reported as one. */
const TOUCHES_LABEL_FAMILY = new Set([
  "new", "create", "created", "add", "added", "add new",
  "delete", "deleted", "del", "remove", "removed", "drop",
  "新增", "新建", "删除", "移除",
]);
const TOUCHES_RECOGNIZED_TAGS = new Set(["new", "delete", "deleted"]);

/** One table row by code, plus the kind it was declared under. Read from the kernel tables — ⛔
 *  never re-typed here (a second copy of a vocabulary is the drift shape this repo keeps paying for). */
function touchesCodeRow(code) {
  for (const row of TOUCHES_PROBLEM_CODES) if (row.code === code) return { ...row, kind: "problem" };
  for (const row of TOUCHES_READING_CODES) if (row.code === code) return { ...row, kind: "reading" };
  throw new Error(`diagnoseTouches: unknown code ${code} (not in TOUCHES_PROBLEM_CODES / TOUCHES_READING_CODES)`);
}

/**
 * Report the `## Touches` declaration of `text` against the three named rules.
 *
 * @param {string} text  a full task body (the `## Touches` section is selected out of it).
 * @param {{rules?: readonly string[]}} [options]  `rules` = the ENABLED rule ids; default = all of
 *        TOUCHES_RULE_IDS. A subset produces a COUNTERFACTUAL reading (see the block comment).
 * @returns {{problems: Array, readings: Array, notEvaluated: Array, section: object, tags: Array,
 *            rules: string[]}}
 *   problems     — `{code, atom, rule, meaning, detail}` for each VIOLATED rule-derived condition.
 *   readings     — `{code, atom, rule, meaning, value}` for each code whose rule is enabled.
 *   notEvaluated — `{code, atom, rule, reason}` for each code whose rule is DISABLED. This is an
 *                  independent value on purpose (硬规则 3b): "the rule was off" must never be
 *                  reported in the same shape as "the rule ran and found nothing".
 *   section      — `{hasSection, section, heading, startLine, level, selection}`; `selection` is
 *                  `exact` | `fallback` | `latch` (counterfactual) | `absent`.
 *   tags         — `[{path, tag}]`, the entry reading (annotation strip + label capture) that the
 *                  s3-7 / sa5b-4 counterfactuals change.
 */
export function diagnoseTouches(text, options = {}) {
  const enabled = Array.from(options.rules ?? TOUCHES_RULE_IDS);
  const has = (rule) => enabled.includes(rule);

  // ── section (sa5b-3) ───────────────────────────────────────────────────────────────────────────
  let section;
  if (has("sa5b-3")) {
    const sel = extractTouchesSection(text);
    const selection = !sel.hasSection ? "absent" : sel.heading.toLowerCase() === "touches" ? "exact" : "fallback";
    section = { ...sel, selection };
  } else {
    section = sectionWithoutSa5b3(text);
  }
  const sectionText = section.section;

  // ── entry reading (s3-7 annotation strip, sa5b-4 label capture) ───────────────────────────────
  let tags;
  if (has("s3-7") && has("sa5b-4")) {
    tags = parseTouchEntriesWithTags(sectionText);           // the shipped reader, unchanged
  } else if (has("s3-7")) {
    // sa5b-4 OFF: the shipped paths, but no spelling is recognized as a structural tag.
    tags = parseTouchEntriesWithTags(sectionText).map(({ path }) => ({ path, tag: null }));
  } else {
    // s3-7 OFF: the entry keeps its trailing annotation — the path reading visibly changes.
    tags = touchesBulletEntries(sectionText)
      .map((entry) => ({
        path: entry.replace(/^\.\//, "").trim(),
        tag: has("sa5b-4") ? touchTagOf(entry) : null,
      }))
      .filter((e) => e.path);
  }

  // ── problems ──────────────────────────────────────────────────────────────────────────────────
  const problems = [];
  const push = (code, detail) => problems.push({ ...touchesCodeRow(code), detail });

  if (has("s3-7")) {
    // A half-width (…) with anything after its closing paren is LITERAL text, not an annotation
    // (`foo(bar).ts`). The annotation strip cannot tell the two apart — it cuts at the paren — so
    // the tail is silently lost. Report the hazard rather than re-parse around it.
    for (const entry of touchesBulletEntries(sectionText)) {
      const m = /\([^)]*\)(\S)/.exec(entry);
      if (m) push("touches-annotation-halfwidth-literal", `half-width paren is literal in entry: ${entry}`);
    }
  }

  if (has("sa5b-4")) {
    for (const entry of touchesBulletEntries(sectionText)) {
      const fullWidth = entry.match(/（([^（）]*)）\s*$/);
      if (fullWidth) {
        const inner = fullWidth[1].trim().toLowerCase();
        if (TOUCHES_RECOGNIZED_TAGS.has(inner)) {
          push("touches-label-fullwidth", `structural tag spelled in full-width parens (tag not captured): ${entry}`);
          continue;
        }
      }
      const trailing = entry.match(/\s*\(([^)]*)\)\s*$/);
      const inner = trailing?.[1]?.trim().toLowerCase();
      if (inner && TOUCHES_LABEL_FAMILY.has(inner) && !TOUCHES_RECOGNIZED_TAGS.has(inner)) {
        push("touches-label-unrecognized", `annotation "${inner}" is label-family but not a recognized tag (new|delete|deleted): ${entry}`);
      }
    }
  }

  if (has("sa5b-3")) {
    const candidates = touchesHeadingCandidates(text);
    if (candidates.length > 1) {
      push(
        "touches-section-ambiguous",
        `${candidates.length} headings match ^touches (${candidates.map((c) => `"${c.text}"`).join(", ")}) — only "${section.heading}" is read`,
      );
    }
  }

  // Deterministic order: TOUCHES_PROBLEM_CODES declaration order, then detail (so a two-entry body
  // reports its entries in body order).
  const order = new Map(TOUCHES_PROBLEM_CODES.map((r, i) => [r.code, i]));
  problems.sort((a, b) => order.get(a.code) - order.get(b.code));

  // ── readings + notEvaluated ──────────────────────────────────────────────────────────────────
  const readings = [];
  const notEvaluated = [];
  for (const row of TOUCHES_PROBLEM_CODES.concat(TOUCHES_READING_CODES)) {
    if (!has(row.rule)) {
      notEvaluated.push({ code: row.code, atom: row.atom, rule: row.rule, reason: `rule ${row.rule} is not in the enabled rule registry (${enabled.join(", ") || "<empty>"})` });
    }
  }

  if (has("sa5b-3")) {
    const row = touchesCodeRow("touches-section-canonical");
    readings.push({ code: row.code, atom: row.atom, rule: row.rule, meaning: row.meaning, value: section.selection });
  }
  if (has("sa5b-4")) {
    const newCount = tags.filter((t) => t.tag === "new").length;
    const deleteCount = tags.filter((t) => t.tag === "delete").length;
    for (const [code, value] of [["touches-label-new", newCount], ["touches-label-delete", deleteCount]]) {
      const row = touchesCodeRow(code);
      readings.push({ code: row.code, atom: row.atom, rule: row.rule, meaning: row.meaning, value });
    }
  }

  return { problems, readings, notEvaluated, section, tags, rules: enabled };
}

if (isDirectEntry(import.meta, undefined, "touches-parser")) {
  process.stdout.write("Usage: touches-parser.ts is a shared module, not a CLI — import { parseTouchEntries, extractTouchesSection, stripTouchAnnotation, diagnoseTouches } from it.\n");
}
