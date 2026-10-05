// ratchet-baseline.ts — the ONE reader/writer for this repo's shrink-only ratchet baseline files.
//
// Why this module exists (tasks/gap-routine-semantic-dedup-scan-baseline-reader-septuplication, the
// `semantic-dedup-scan` routine's `baseline-reader-septuplication` finding, kind
// `identity-replication`, verdict `real-duplication`): SEVEN readers of the identical 12-line body
// had accumulated under five names — readBaseline / readDodSuiteLineBaseline /
// readBareDirTouchesBaseline / readWiringClaimAcProbeBaseline / readOneEntryBaseline / readRatchet —
// each "read the ratchet file, parse `# baseline-count:`, build the set of non-comment lines", and
// THREE copies of the shrink-only writer diverged only in their header comment and their reason
// nouns. Identical bodies under different names are not three mechanisms; they are ONE mechanism
// that three future fixes would have had to find three times.
//
// WHAT IS SHARED is exactly the mechanism: the header token, the absent-file reading
// (`{ baseline: empty, baselineCount: null }` — 硬规则 3: an absent file is "nothing listed", which
// is the shrink-only floor, NOT an unevaluated state the way a missing *input* would be), the
// non-comment-line set, and the shrink-only guard (ceiling + "no NEW entries").
//
// WHAT IS NOT SHARED is everything each consumer genuinely owns: the file path, the header prose,
// the noun its entries are called, and what the author should do instead of adding an entry. Those
// stay at the call site, passed in — so a call site cannot silently inherit another's wording.
//
// ⛔ The two narrower ceiling-only parsers that used to live in test-framework-policy-check.ts and
// test-isolation-check.ts ARE now this module's `parseBaselineCount` below
// (tasks/gap-routine-semantic-dedup-scan-parse-baseline-count-divergent-anchor, the
// `semantic-dedup-scan` routine's `parse-baseline-count-divergent-anchor` finding, kind
// `same-symbol-multi-file`, verdict `divergent-implementation`). The two bodies were byte-identical
// to EACH OTHER and they read the token with an end-ANCHORED regex
// (`^#\s*baseline-count:\s*(\d+)\s*$`) while every entry-set reader here read it with
// `BASELINE_COUNT_RE` — same token, same files, TWO grammars. The anchored one was the WEAKER:
// `# baseline-count: 51 (frozen)` reads 51 for the entry-set consumers and null for the
// ceiling-only ones, and a null ceiling is "no ceiling enforced" (硬规则 3b) ⇒ a trailing annotation
// silently disabled the commit-surviving AC4 backstop the parser exists to supply. ONE token now has
// ONE grammar and ONE home; the anchored form is retired. Recorded, not silently dropped (硬规则 5b).

import fs from "node:fs";
import path from "node:path";

/** The ceiling token every baseline file carries in its header. Deliberately UNANCHORED at the end
 * (this is the regex the seven readers used) so the shared reader changes no existing behaviour.
 *
 * `[ \t]*` after the `#` is the ONE widening on top of the shipped `# ` form: a token separated by
 * zero or more spaces/tabs was read by NEITHER grammar before (the anchored copy allowed it, the
 * readers did not), so widening here can only turn "no ceiling" into "the ceiling that is written",
 * never the reverse. Everything after the token name is unchanged (`\s*(\d+)`, no end anchor) so the
 * change stays a strict superset of the grammar the seven readers shipped with. */
export const BASELINE_COUNT_RE = /^#[ \t]*baseline-count:\s*(\d+)/m;

export interface RatchetBaseline {
  /** The non-comment, non-blank lines, trimmed — one entry per line. */
  baseline: Set<string>;
  /** The `# baseline-count:` header value; `null` when the token is absent (no ceiling enforced). */
  baselineCount: number | null;
}

/** The CEILING-ONLY half of the token, read from a *string*: the consumers that never build the
 * entry set (test-framework-policy-check.ts, test-isolation-check.ts) call this directly, and
 * `parseRatchetBaselineText` below is built on it — so the two contracts share one grammar rather
 * than one grammar each. Returns `null` when the token is absent (no ceiling enforced) — NOT 0,
 * which would be a ceiling of zero (硬规则 3b). */
export function parseBaselineCount(text: string): number | null {
  const m = text.match(BASELINE_COUNT_RE);
  return m ? Number(m[1]) : null;
}

/** Parse a baseline file's TEXT into `{ baseline, baselineCount }`. Pure — the unit-testable half. */
export function parseRatchetBaselineText(text: string): RatchetBaseline {
  const baseline = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    baseline.add(t);
  }
  return { baseline, baselineCount: parseBaselineCount(text) };
}

/** The absolute path of a committed baseline file: `<root>` + the consumer's own
 * repo-root-relative constant, joined segment-by-segment so the constant's `/` separators never
 * survive into a platform path.
 *
 * Why this is here (tasks/gap-routine-semantic-dedup-scan-baseline-file-quad, the
 * `semantic-dedup-scan` routine's `baseline-file-quad` finding, kind `byte-identical-body`,
 * verdict `real-duplication`): FOUR ratchets (host-repo-surface-ratchet, import-graph-check,
 * quay-init-closure-ratchet, sh-census-check) each exported a `baselineFile(root)` whose body was
 * byte-identical — `path.join(root, ...BASELINE_FILE_REL.split("/"))` — differing only in which
 * module-local `BASELINE_FILE_REL` constant it closed over. The mechanism is the path derivation;
 * the constant is what each consumer genuinely OWNS, so it stays at the call site and is passed in
 * (硬规则 5b: the fix is the shared source, not a fifth correct-looking copy). */
export function baselinePath(root: string, rel: string): string {
  return path.join(root, ...rel.split("/"));
}

/** Read `<root>/<baseline rel>`. Absent file ⇒ `{ baseline: empty, baselineCount: null }` — the
 * shrink-only floor, identical for every ratchet (a ratchet that was never created has nothing
 * listed). */
export function readRatchetBaseline(root: string, rel: string): RatchetBaseline {
  const p = baselinePath(root, rel);
  if (!fs.existsSync(p)) return { baseline: new Set(), baselineCount: null };
  return parseRatchetBaselineText(fs.readFileSync(p, "utf8"));
}

export interface WriteRatchetOptions {
  /** The DELIBERATE one-shot re-baseline: bypasses the shrink-only guard ONCE and re-anchors the
   * ceiling to the current entry set. The caller must record the before/after run output. */
  reset?: boolean;
  /** The file's own header lines (each a complete `# …` line), written above the ceiling token.
   * Per-consumer prose — the reason this is a parameter and not a shared constant. */
  headerLines: string[];
  /** What this ratchet's entries are called in the over-ceiling refusal, e.g. "unowned ACs". */
  entriesLabel: string;
  /** What a single not-in-the-baseline entry is called in the new-entry refusal, e.g. "unowned AC(s)".
   * Separate from `entriesLabel` because the two sentences are not derivable from one another
   * (comparing "NEW unowned AC(s)" with "NEW violation(s)") and a fallback would silently reword a
   * refusal the consumer's own test pins. */
  newEntryLabel: string;
  /** The over-ceiling refusal's closing advice, e.g. "fix violations, do not add them". */
  overCeilingAdvice: string;
}

/** The shrink-only writer. Refuses (ok:false, no write) when the current entries exceed the ceiling
 * or introduce an entry the baseline does not already list — the list can only get SHORTER. */
export function writeRatchetBaseline(
  root: string,
  rel: string,
  currentEntries: string[],
  { reset = false, headerLines, entriesLabel, newEntryLabel, overCeilingAdvice }: WriteRatchetOptions,
): { ok: boolean; reason: string } {
  const p = baselinePath(root, rel);
  const { baseline, baselineCount } = readRatchetBaseline(root, rel);
  const ceiling = reset ? currentEntries.length : (baselineCount ?? currentEntries.length);
  if (!reset && currentEntries.length > ceiling) {
    return { ok: false, reason: `current ${entriesLabel} (${currentEntries.length}) exceed the ratchet ceiling (${ceiling}) — the list can only get SHORTER; ${overCeilingAdvice}` };
  }
  if (!reset && baseline.size > 0) {
    const newOnes = currentEntries.filter((e) => !baseline.has(e));
    if (newOnes.length > 0) {
      return { ok: false, reason: `refusing to write: ${newOnes.length} NEW ${newEntryLabel} not in the baseline — the list can only get SHORTER: ${newOnes.slice(0, 5).join(", ")}${newOnes.length > 5 ? "…" : ""}` };
    }
  }
  const lines = [
    ...headerLines,
    "# baseline-count: " + ceiling,
    "",
    ...currentEntries,
    "",
  ];
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, lines.join("\n"));
  return { ok: true, reason: reset
    ? `ratchet baseline RESET to ${currentEntries.length} entry/entries (ceiling re-anchored to ${ceiling})`
    : `ratchet list written (${currentEntries.length} entry/entries; ceiling ${ceiling})` };
}
