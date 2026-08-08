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
export function stripTouchAnnotation(entry) {
  return entry
    .replace(/\s*（[^）]*）\s*$/, "")   // full-width （…） first
    .replace(/\s*\([^)]*\)\s*$/, "")  // then ASCII (…)
    .trim();
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
export function parseTouchEntriesWithTags(touchesSection) {
  if (!touchesSection) return [];
  const out = [];
  for (const raw of String(touchesSection).split(/\r?\n/)) {
    const line = raw.trim();
    const m = line.match(/^[-*]\s+(.+)$/);
    if (!m) continue;
    let entry = m[1].trim();
    entry = entry.replace(/^[`"'']+|[`"'']+$/g, "").trim(); // surrounding quotes/backticks first
    let tag = null;
    const ann = entry.match(/\s*\(([^)]*)\)\s*$/);
    if (ann) {
      const a = ann[1].trim().toLowerCase();
      if (a === "new") tag = "new";
      else if (a === "delete" || a === "deleted") tag = "delete";
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

// Locate the `## Touches` section of a full task/charter body. Returns { hasSection, section }.
// `hasSection` distinguishes "no declaration" (→ conservative) from "declared empty", matching
// touches-orthogonality-check.ts's parseTouches contract. The section is the raw text between the
// `## Touches` heading and the next heading of ANY depth (matching extractSection's depth rule is
// not needed here — parseTouches historically stopped at the next `#`/`##` heading line).
export function extractTouchesSection(fullText) {
  const lines = String(fullText).split(/\r?\n/);
  let inSection = false;
  let hasSection = false;
  const out = [];
  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    if (heading) {
      if (inSection) break; // next heading ends the section
      inSection = /^touches\b/i.test(heading[1].trim());
      if (inSection) hasSection = true;
      continue;
    }
    if (inSection) out.push(line);
  }
  return { hasSection, section: out.join("\n") };
}

// Direct invocation is NOT a CLI operation — this is a shared library. The experiments/
// quay-perpetual-stream/scripts/touches-parser.ts entry is a SYMLINK to this file (so the
// plugin/experiment task-status-drift-check mirrors stay byte-identical and grep finds ONE
// `function parseTouchEntries`). The symlink-mirror-invocation contract requires every symlinked
// .ts under experiments/.../scripts/ to be NON-SILENT on no args, so present the report-tool
// no-args "Usage:" signature here rather than exiting silently (gap-touches-orthogonality-
// symlink-isdirect-mismatch). Imports of this module never trigger this block (isDirectEntry).
if (isDirectEntry(import.meta)) {
  process.stdout.write("Usage: touches-parser.ts is a shared module, not a CLI — import { parseTouchEntries, extractTouchesSection, stripTouchAnnotation } from it.\n");
}
