// code-span-strip.ts — the CODE-SPAN stripping family (stripFences / stripInlineCodeSpans /
// stripCodeSpans), extracted VERBATIM from ready-pool-check.ts (tasks/gap-arch-import-cycles-zero,
// GOAL-025 AC-308).
//
// WHY A SEPARATE FILE: strategic-doc-staleness-check.ts VALUE-imported `stripCodeSpans` from
// ready-pool-check.ts, while ready-pool-check.ts VALUE-imports `judgePoolCandidate` back from it —
// a real value-level import cycle (import-graph-check.ts `valueSccs`), which is why the two checkers
// could not be tested or moved independently. Moving this small pure-string cluster to a leaf module
// removes the cycle's back edge.
//
// ⛔ PURE REFACTOR: the three function bodies are moved BYTE-FOR-BYTE (no regex/logic edits). The two
// helpers were module-private in ready-pool-check.ts and are EXPORTED here so BOTH callers share the
// one definition — no parallel copy. ready-pool-check.ts re-exports `stripCodeSpans`, so its public
// API surface is unchanged.
//
// ⛔ Keep this file a LEAF: it imports nothing (pure string -> string). An import that transitively
// reaches back into ready-pool-check.ts would recreate the very cycle this file exists to break.

/** Strip fenced code blocks (```…``` / ~~~…~~~). Inline backticks are NOT stripped here — they are the
 *  repo's citation form, matched separately by BACKTICK_ID_RE in prosePrereqRefs. */
export function stripFences(text) {
  return text.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, " ");
}

/** Strip inline backtick spans (`…`) only (no fences). Used for the WIKILINK arm of prosePrereqRefs so
 *  a QUOTED wikilink stays an illustrative mention. */
export function stripInlineCodeSpans(text) {
  return text.replace(/`[^`\n]*`/g, " ");
}

/** Strip fenced code blocks (```…``` / ~~~…~~~) and inline backtick spans (`…`) so a QUOTED wikilink
 *  inside code is not read as a prereq declaration. Fences are removed before inline spans (an inline
 *  backtick can appear inside a fence). Exported — strategic-doc-staleness-check.ts reuses it (its
 *  contract is fence+inline stripping, so it is left unchanged). */
export function stripCodeSpans(text) {
  return stripInlineCodeSpans(stripFences(text));
}
