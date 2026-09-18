// touches-parser.ts — the ONE `## Touches` bullet-parser implementation (ADR-004 single-source).
import fs from "node:fs";
import path from "node:path";
import { isDirectEntry } from "./gate-script-base.ts";
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
// NESTED-PAREN handling (gap-touches-parser-strip-annotation-nested-parens — 2 real occurrences:
// a23 `（…`（新增…）`…）` + provisioning `（新：…（config/gates/运行时载体）…）`, each of which the old
// `\s*（[^）]*）\s*$` regex could NOT strip because `[^）]*` cannot cross a `）`): the FULL-WIDTH pass is
// now a BALANCED-PAREN scan, not a regex. We scan from the END for the LAST `）` and walk backward to
// its MATCHING `（`, counting depth so a NESTED full-width pair inside the annotation does not
// terminate the scan early. Only FULL-WIDTH parens are counted — an ASCII `(` that is literal text
// inside the annotation (`$(` command-substitution syntax) is NOT mistaken for the annotation's
// opener, and an unbalanced trailing `）` (no matching `（`) is left alone (old behavior). The ASCII
// `(…)` pass then runs on the result, preserving the old sequential double-strip for entries that
// carry BOTH an ASCII and a full-width annotation (`path/x.ts (new)（…）` → pass 1 leaves
// `path/x.ts (new)`, pass 2 strips ` (new)`).
export function stripTouchAnnotation(entry) {
  let s = String(entry);
  const t = s.trimEnd();
  const i = t.length - 1;
  if (t[i] === "）") {
    let depth = 0;
    let open = -1;
    for (let j = i; j >= 0; j--) {
      const c = t[j];
      if (c === "）") depth++;
      else if (c === "（" && --depth === 0) { open = j; break; }
    }
    if (open !== -1) {
      let k = open;
      while (k > 0 && /\s/.test(t[k - 1])) k--; // also drop whitespace before the annotation (old \s*)
      s = t.slice(0, k);
    }
  }
  return s.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

// Parse a `## Touches` bullet list into bare path/glob strings (backticks/quotes removed,
// trailing "(…)" annotations stripped, leading `./` removed). Returns [] for a missing/empty
// section. This is the ONE implementation — every other Touches parser delegates here.
export function parseTouchEntries(touchesSection) {
  if (!touchesSection) return [];
  return touchesSection
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^[-*]\s+/.test(l))
    .map((l) => l.replace(/^[-*]\s+/, "").trim())
    .map((l) => l.replace(/^[`"'']+|[`"'']+$/g, "").trim()) // surrounding quotes/backticks first
    .map(stripTouchAnnotation)                                  // then trailing "(…)"
    .map((l) => l.replace(/^[`"'']+|[`"'']+$/g, "").trim()) // then any backtick the annotation masked
    .map((l) => l.replace(/^\.\//, "").trim())                  // then a leading "./"
    .filter(Boolean);
}

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

export function parseTouchEntriesWithTags(touchesSection) {
  if (!touchesSection) return [];
  const out = [];
  for (const raw of String(touchesSection).split(/\r?\n/)) {
    const line = raw.trim();
    const m = line.match(/^[-*]\s+(.+)$/);
    if (!m) continue;
    let entry = m[1].trim();
    entry = entry.replace(/^[`"'']+|[`"'']+$/g, "").trim(); // surrounding quotes/backticks first
    // Structural tag (new/delete): FIRST the common end-anchored form `path (new)`; then, when the
    // line terminates with a full-width annotation (）， not )）, the ASCII (…) sits BEFORE it —
    // `` path/x.ts (new)（描述） `` — the end-anchored match can't see it, so a pre-existing quirk
    // silently dropped the tag (every (new)（…） task was judged "must-exist-missing" → promotion
    // reject). Match the last ASCII (…) that precedes a （ to recover it. The PATH is unaffected
    // (stripTouchAnnotation below removes both annotations); only the tag is recovered.
    let tag = tagFromAnnotation(entry.match(/\s*\(([^)]*)\)\s*$/)?.[1]);
    if (!tag) {
      const beforeFullWidth = entry.match(/\s*\(([^)]*)\)\s*[（]/);
      tag = tagFromAnnotation(beforeFullWidth?.[1]);
    }
    const stripped = stripTouchAnnotation(entry); // the ONE annotation-strip implementation
    const cleaned = stripped.replace(/^[`"'']+|[`"'']+$/g, "").trim(); // backtick the annotation masked
    const path = cleaned.replace(/^\.\//, "").trim(); // leading "./"
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
if (isDirectEntry(import.meta, undefined, "touches-parser")) {
  process.stdout.write("Usage: touches-parser.ts is a shared module, not a CLI — import { parseTouchEntries, extractTouchesSection, stripTouchAnnotation } from it.\n");
}
