// task-shape-artifacts.ts — THE SINGLE shape-aware four-artifact completeness judge.
//
// ── THE DEFECT THIS CLOSES (task gap-ready-check-duplicated-algorithm-store-vs-ready-pool-check) ──
// The todo→ready "four artifacts complete?" predicate used to exist as TWO independent
// implementations that shared only the underlying heading TABLES (`shape-sections.ts`):
//   · `packages/quay-native/src/store.ts`                       — `artifactSections()` (product judge,
//     backing MCP `task_check` / CLI `quay task check`)
//   · `plugin/scripts/ready-pool-check.ts`                      — `artifactsComplete()` (methodology
//     judge, backing the promotion driver's pool + targeted-promotion eligibility)
// The tables were unified first (gap-shape-section-tables-dual-copy-no-single-source), but the
// MATCH + JUDGE algorithm was still written twice — so a new heading form, a changed content floor,
// or a section-boundary rule could land on one side only and the two judges would disagree on the
// SAME body. That is not hypothetical: a shape-table drift had already forced an AC/DoD draft-heading
// fix, and a `\b`-vs-whole-line heading regex had diverged the two judges on CJK headings
// (gap-cjk-proposal-slot-word-boundary). Both fixes re-aligned two copies; neither removed the
// structural root cause. This module removes it: ONE `artifactsComplete()` both judges call.
//
// ── WHY IT LIVES IN `kernel/` (the reachability argument, both sides) ────────────────────────────
// The product judge (`packages/quay-native`) may NOT import the mechanism layer: a
// `packages/**` → `plugin/**` edge is a reverse edge the import-graph ratchet counts
// (`plugin/scripts/import-graph-check.ts`). The methodology judge (`plugin/scripts/*`) MAY import
// Core source (`../../packages/quay/src/…`, the same route shape-sections.ts / profile-policy.ts
// use). A `kernel/` home is therefore the one location BOTH sides can legally import: kernel files
// may import nothing outside `kernel/` except bare specifiers (node:*, npm), so this module has no
// back-edge and cannot create an import cycle. The plugin bundler (`build-plugin-dist.mjs`'s
// `coreSrcAliasPlugin`) re-points every `packages/quay/src/**` specifier onto the real Core source
// tree and INLINES it, so the shipped `dist/ready-pool-check.js` stays self-contained.
//
// PURE LOGIC over PURE DATA — no imports beyond two kernel leaves (`shape-sections.ts`,
// `regex-escape.ts`), no fs, no node builtins. It runs in the product bundle AND the methodology
// layer, so it must stay side-effect-free.

import { SHAPE_SECTIONS } from "./shape-sections.ts";
import { escapeRegExp } from "./regex-escape.ts";

/**
 * Minimum non-whitespace content per section (QN-005): a heading followed by one word is not an
 * artifact. This is the SAME floor the store has always used and ready-pool-check.ts documented as
 * mirroring it — it now lives once, next to the judge that reads it.
 */
export const MIN_SECTION_CHARS = 40;

/** The registered task shapes plus the fail-closed `unknown`. */
export type TaskShape = "contract" | "finding" | "plan" | "proposal" | "unknown";

/** Does `body` contain a `## <heading>` line that is EXACTLY that heading (trailing whitespace
 *  allowed)? Exact match (never a subheading like `## Finding (measured …)`). The heading is escaped
 *  so a registered name carrying regex metacharacters is matched literally. */
function hasExactHeading(body: string, heading: string): boolean {
  return new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$`, "im").test(body);
}

/**
 * Detect a task's shape from its body.
 * Precedence: contract → finding → plan → proposal → unknown. `## Finding` precedes `## Plan`
 * because meta-cc's DIR template carries BOTH (Finding replaces Proposal, Plan stays); classifying
 * it as `plan` would demand a `## Proposal` the template lacks. `proposal` is checked last so a body
 * carrying `## Proposal` next to its own shape's proposal-slot heading still resolves to that shape.
 * An unregistered body returns `unknown` — the caller fails CLOSED on it, never leniently.
 */
export function detectShape(body: string): TaskShape {
  if (hasExactHeading(body, "Contract")) return "contract";
  if (hasExactHeading(body, "Finding")) return "finding";
  if (hasExactHeading(body, "Plan")) return "plan";
  if (hasExactHeading(body, "Proposal")) return "proposal";
  return "unknown";
}

/**
 * Extract the content of a `## <heading>` section: everything after the heading line up to the next
 * line whose heading is at the SAME OR SHALLOWER depth (so a `## X` section runs through its nested
 * `### ` subheadings but stops at the next `## ` — or any `# ` — heading), or the end of the body.
 * Returns `null` when the heading is absent.
 *
 * Depth-awareness is the one behavior the two former copies disagreed on: the store's old stop
 * pattern (`^##\s`) did NOT terminate on a shallower `# ` heading, so an H1 wedged between two H2
 * sections was silently swallowed into the preceding one (three corpus tasks read `plan:true` for a
 * Contract section that was in fact empty). The depth-aware rule — already the semantics of
 * `task-parsing.ts` / `task-schema.ts` `extractSection`, and the one the methodology judge used — is
 * the single rule both judges now share. It is STRICTER, never looser: it can only end a section
 * earlier, never extend one.
 */
export function findShapeSection(fullText: string, heading: string): string | null {
  const headingLineRe = new RegExp(`^(##+)\\s*${escapeRegExp(heading)}\\s*$`, "im");
  const headingMatch = fullText.match(headingLineRe);
  if (!headingMatch) return null;
  const depth = headingMatch[1].length;
  const startIdx = headingMatch.index! + headingMatch[0].length;
  const rest = fullText.slice(startIdx);
  const stopRe = new RegExp(`^#{1,${depth}}\\s`, "m");
  const stopMatch = rest.match(stopRe);
  return stopMatch ? rest.slice(0, stopMatch.index) : rest;
}

/** Non-whitespace length of a heading's section (0 when the heading is absent). */
export function sectionNonWhitespaceLength(body: string, heading: string): number {
  const sec = findShapeSection(body, heading);
  return sec === null ? 0 : sec.replace(/\s/g, "").length;
}

/**
 * First matching section from an alias list, or `""` when none match. The plural form the store's
 * AC/DoD checkbox scanning and Contract-key reader use (they pass alias lists, not one heading).
 */
export function sectionAfterHeading(fullText: string, headings: string[]): string {
  for (const h of headings) {
    const sec = findShapeSection(fullText, h);
    if (sec !== null) return sec;
  }
  return "";
}

/** The artifact keys the store's `check()` result always carries (used for the unknown-shape map,
 *  preserving the store's long-standing all-false output for an unrecognized shape). */
const ALL_ARTIFACTS_ABSENT = { proposal: false, plan: false, ac: false, dod: false };

export interface ArtifactsComplete {
  shape: TaskShape;
  complete: boolean;
  artifacts: Record<string, boolean>;
  /** Artifact names reading absent; `["unknown-shape"]` when the shape itself is unregistered. */
  missing: string[];
}

/**
 * Shape-aware four-artifact completeness — THE judge (task-shape-artifacts.ts header).
 * Dispatches on the detected shape and reads the shape's OWN registered section lists from
 * `SHAPE_SECTIONS`; a `finding`-shape task has NO `plan` dimension (its map omits the key rather
 * than carrying a false — dispatch is not a waiver). Every registered artifact must clear
 * `MIN_SECTION_CHARS`. An unregistered shape fails closed: `complete:false`, `missing:
 * ["unknown-shape"]`, and an all-false artifact map.
 *
 * `shape` may be passed explicitly (the store already computed it) — it defaults to `detectShape`.
 */
export function artifactsComplete(body: string, shape: TaskShape = detectShape(body)): ArtifactsComplete {
  const spec = SHAPE_SECTIONS[shape as keyof typeof SHAPE_SECTIONS];
  if (!spec) {
    return {
      shape,
      complete: false,
      artifacts: { ...ALL_ARTIFACTS_ABSENT },
      missing: ["unknown-shape"],
    };
  }
  const artifacts: Record<string, boolean> = {};
  const missing: string[] = [];
  for (const [name, headings] of Object.entries(spec)) {
    const ok = headings.some((h) => sectionNonWhitespaceLength(body, h) >= MIN_SECTION_CHARS);
    artifacts[name] = ok;
    if (!ok) missing.push(name);
  }
  return { shape, complete: Object.values(artifacts).every(Boolean), artifacts, missing };
}

/** The boolean artifact map the store's `createStore().artifactSections()` / `check()` expose.
 *  Thin adapter over the ONE judge so the two surfaces can never disagree. */
export function artifactSections(body: string, shape: TaskShape = detectShape(body)): Record<string, boolean> {
  return artifactsComplete(body, shape).artifacts;
}
