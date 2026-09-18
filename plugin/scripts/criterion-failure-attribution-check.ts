#!/usr/bin/env node
// criterion-failure-attribution-check.ts — mechanical enumeration of goal criteria whose FAILURE exits
// write no cause (tasks/gap-goal-criteria-bare-failing-exit-unattributable, GOAL-009 AC-241).
//
// THE DEFECT THIS CLOSES: `goals/AC-*.md` criteria are shell strings executed by
// packages/quay/src/gate/acceptance-runner.ts. When a criterion exits non-zero and writes NOTHING to
// stderr/stdout, the runner's third branch (acceptance-runner.ts) composes
//   `acceptance failed (exit 1) — criterion wrote no output to stderr/stdout`
// — a verdict that says a criterion failed but not WHY. That is unattributable: "no anchorable site
// exists" and "the site exists but has no matching record" are different situations with different
// dispositions, and they were collapsed into one identical string. AC-237 fixed the RUNNER side (the
// failure reason now carries whatever the criterion wrote); it could not observe the CRITERION side,
// because its own fixture (`echo CAUSE-TOKEN >&2; exit 1`) necessarily writes a cause (hard rule 4
// 推论三: a fixture proves "can produce", not "did produce"). This checker is the criterion-side
// complement: it enumerates, BY POSITION, the criteria whose failure exits write nothing.
//
// ⛔ THE PREDICATE IS NOT DEFINED HERE ANY MORE (gap-criterion-attribution-write-gate-at-birth). The
// judgment "this line is a failure exit and writes no cause" now lives in
// `packages/quay/src/goal-store.ts`, because a SECOND surface asks the same question: the write gate
// that refuses to let such a criterion be BORN. Two implementations of one judgment drift — measured,
// not hypothetical: this file's own history is three successive blind spots (the direct form, the
// trailing computed form, the implicit-exit class), each fixed here while nothing else moved, and
// AC-243 exists solely to pin one constant to its producer. So the predicate was moved to the product
// side and this file IMPORTS it. The arrow is product → plugin by construction: `plugin/scripts/
// goal-driver.ts` and `meta-driver.ts` already import `goal-store.ts`; nothing under `packages/quay/`
// imports `plugin/scripts/`. The `export { … }` block below re-exports the moved names so this
// module's public surface (and plugin/test/criterion-failure-attribution-check.test.mjs) is unchanged.
//
// WHAT IT ENUMERATES (hard rule 2 — position, not keyword): see the predicate's own documentation in
// goal-store.ts. In one line: per criterion LINE, failure-exit ∧ ¬(stderr | >&2 | console.error);
// plus, for a criterion with NO exit statement at all, the silent status-bearing segment whose
// inherited non-zero IS the criterion's exit.
//
// THREE-STATE OUTPUT (hard rule 3b — 读不懂输入 ≠ 合格):
//   0 = PASS (bare-AC count ≤ committed baseline; the ratchet is shrink-only, see below)
//   1 = FAIL (bare-AC count > baseline — a new or modified criterion introduced a bare failure exit)
//   3 = NOT-EVALUATED (the goals dir cannot be read, or it yields ZERO in-domain criteria — a
//       structurally-unreadable input must never render as "no bare exits"; printed to STDERR)
//   2 = usage/env error
//
// THE RATCHET IS SHRINK-ONLY: baseline is anchored at the mechanically-measured count at capture time
// and may only go DOWN. Fixing a criterion lowers the count and stays green; adding or modifying a
// criterion so it gains a bare failure exit raises the count and goes RED. ⛔ It is deliberately NOT a
// zero target: demanding 32 simultaneous rewrites would make this task unachievable (hard rule 12 —
// do not block an achievable goal on an unmeasured residual). ⛔ And it is deliberately NOT waivable by
// loosening the detector: the baseline is produced by --capture from the REAL enumeration.
//
// ⚠️ THE RATCHET IS 事后 BY CONSTRUCTION, AND THAT IS WHY THE WRITE GATE EXISTS. Creating an AC touches
// only `goals/` — a DOC_SURFACE (select-static-checks-for-touches.ts) — so the delta carries an empty
// `code_delta` and the `@static-tier change` checker is SKIPPED that round (runner-static-gate.ts:650
// says so verbatim, and forbids patching the hole with a directory glob: that would flip the whole
// `goals/` surface from doc to CODE and red unrelated cases). Measured 2026-09-12: the last full suite
// ran at 03:45 while AC-247/248/249 were born at 08:43–08:45 — this checker never once ran on them,
// and the goal-driver kept appending unattributable fails to the ledger every round. Detection alone
// could never have prevented that; only the write surface could.
//
// MODES:
//   default  [--root <dir>] [--json] — gate mode: enumerate, compare against the committed baseline.
//   --capture [--root <dir>] [--json] — enumerate and WRITE the committed baseline file.
// Test seams (used by plugin/test + the mutation case, ⛔ never by the registry):
//   --goals-dir <dir>   enumerate this dir instead of <root>/goals
//   --baseline <path>   read/write this baseline file instead of the committed one

import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
// getArgValue now lives in gate-script-base.ts as `flagValue` (it was one of the ~73 byte-identical
// copies of the indexOf+next-arg idiom in plugin/scripts; .quay/routine-findings.jsonl finding
// `arg-parsing-helper-family`, routine `semantic-dedup-scan`).
import { emitPass, emitFail, emitNotEvaluated, helpExit, isDirectEntry, flagValue } from "./gate-script-base.ts";
import { repoRoot } from "./repo-root.ts";
import { bareFailureExitsOfCriterion, type BareLine } from "../../packages/quay/src/goal-store.ts";

// ── the moved predicate, re-exported (see the ⛔ note above — ONE implementation lives in
//    packages/quay/src/goal-store.ts; this module's consumers keep importing it from here) ──────────
export {
  FAILURE_EXIT_RE,
  hasTrailingComputedFailureExit,
  hasFailureExit,
  splitTopLevelSegments,
  isSilentOnFailureSegment,
  statusBearingStatement,
  implicitFailureExitLines,
  maskHashComments,
  maskValueStrings,
  isBareFailureExitLine,
  bareFailureExitsOfCriterion,
  evaluateCriterionAttribution,
  type Segment,
  type BareLine,
  type CriterionAttributionVerdict,
} from "../../packages/quay/src/goal-store.ts";

// ── surfaces ────────────────────────────────────────────────────────────────────────────────────────

/** The committed, mechanically-generated baseline (docs/analysis/, alongside the other .baseline.json). */
export const BASELINE_FILE_REL = "docs/analysis/criterion-failure-attribution.baseline.json";

/** The in-domain statuses: the I5 re-verification domain (AC-216 — an achieved AC still gates). */
export const IN_DOMAIN_STATUSES: readonly string[] = ["active", "achieved"];

// ── types ───────────────────────────────────────────────────────────────────────────────────────────

export interface BareEntry {
  id: string;
  file: string;
  /** How many bare failure exits this criterion has (AC-157 has 3, AC-239 had 2, …). */
  bareLines: BareLine[];
}

export interface Enumeration {
  /** false ⇒ NOT-EVALUATED: the input could not be read/parsed. Never conflated with "zero bare". */
  evaluated: boolean;
  error?: string;
  /** goals/AC-*.md in-domain (status ∈ {active, achieved}) with a non-empty criterion. */
  inDomain: number;
  /** Total bare failure-exit LINES across all in-domain criteria. */
  bareLines: number;
  /** The ACs carrying ≥1 bare failure exit — THE ratcheted count is bareAcs.length. */
  bareAcs: BareEntry[];
}

export interface Baseline {
  /** The ratcheted number: how many in-domain ACs carry ≥1 bare failure exit. */
  count: number;
  inDomain: number;
  entries: Array<{ id: string; file: string; bareLines: number[] }>;
  generatedAt: string;
}

export interface RatchetVerdict {
  ok: boolean;
  /** current − baseline.count (negative = shrank = good). */
  delta: number;
  /** AC ids bare now that were not bare at capture time (the "新增或修改的判据" that must not happen). */
  added: string[];
  /** AC ids bare at capture time and no longer bare (the fixes — always welcome). */
  fixed: string[];
}

// ── enumeration ─────────────────────────────────────────────────────────────────────────────────────

/** Split a goal file into (frontmatter, body). null when there is no `---` frontmatter block. */
export function splitFrontmatter(src: string): { fm: string } | null {
  if (!src.startsWith("---")) return null;
  const end = src.indexOf("\n---", 3);
  if (end === -1) return null;
  return { fm: src.slice(3, end) };
}

/** Parse one goal file's frontmatter. Returns null when it is not parseable as a goal record. */
export function parseGoalFile(src: string): { id: string; status: string; criterion: string } | null {
  const split = splitFrontmatter(src);
  if (split === null) return null;
  let raw: any;
  try {
    raw = parseYaml(split.fm);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const id = typeof raw.id === "string" ? raw.id : null;
  const status = typeof raw.status === "string" ? raw.status : null;
  if (id === null || status === null) return null;
  const criterion = typeof raw.criterion === "string" ? raw.criterion : "";
  return { id, status, criterion };
}

/**
 * Enumerate the bare-failure-exit ACs under `goalsDir`.
 * evaluated:false (NOT-EVALUATED) when the dir cannot be read, when NO file parses as a goal record,
 * or when the parse yields ZERO in-domain criteria — an input we could not read must not render as
 * "nothing to report" (hard rule 3b).
 */
export function enumerateBareFailureExits(goalsDir: string): Enumeration {
  const empty = { inDomain: 0, bareLines: 0, bareAcs: [] as BareEntry[] };
  let names: string[];
  try {
    names = fs.readdirSync(goalsDir).filter((f) => f.startsWith("AC-") && f.endsWith(".md"));
  } catch (e: any) {
    return { ...empty, evaluated: false, error: `the goals dir (${goalsDir}) could not be read: ${e?.message ?? e}` };
  }
  if (names.length === 0) {
    return { ...empty, evaluated: false, error: `the goals dir (${goalsDir}) holds no AC-*.md records` };
  }
  let parsed = 0;
  let inDomain = 0;
  const bareAcs: BareEntry[] = [];
  for (const name of names.sort()) {
    let src: string;
    try {
      src = fs.readFileSync(path.join(goalsDir, name), "utf8");
    } catch {
      continue;
    }
    const rec = parseGoalFile(src);
    if (rec === null) continue;
    parsed += 1;
    if (!IN_DOMAIN_STATUSES.includes(rec.status)) continue;
    if (rec.criterion.trim() === "") continue;
    inDomain += 1;
    // THE shared predicate (goal-store.ts): explicit failure-exit lines, plus the implicit-exit class
    // when no explicit failure exit exists (the two are disjoint by construction — see its docs).
    const bareLines = bareFailureExitsOfCriterion(rec.criterion);
    if (bareLines.length > 0) bareAcs.push({ id: rec.id, file: name, bareLines });
  }
  if (parsed === 0) {
    return { ...empty, evaluated: false, error: `no file under ${goalsDir} parsed as a goal record` };
  }
  if (inDomain === 0) {
    return { ...empty, evaluated: false, error: `${goalsDir} yielded zero in-domain (${IN_DOMAIN_STATUSES.join("/")}) criteria with a non-empty criterion` };
  }
  const bareLines = bareAcs.reduce((n, e) => n + e.bareLines.length, 0);
  return { evaluated: true, inDomain, bareLines, bareAcs };
}

// ── judgment (shrink-only ratchet — pure, the testable core) ────────────────────────────────────────

/** The ratchet: ok iff the current bare-AC count does not EXCEED the baseline. Additions are the only
 *  red; removals (fixes) are always legal. */
export function checkRatchet(current: Enumeration, baseline: Baseline): RatchetVerdict {
  const cur = new Set(current.bareAcs.map((e) => e.id));
  const base = new Set(baseline.entries.map((e) => e.id));
  const added = [...cur].filter((id) => !base.has(id)).sort();
  const fixed = [...base].filter((id) => !cur.has(id)).sort();
  const delta = cur.size - baseline.count;
  return { ok: delta <= 0, delta, added, fixed };
}

// ── baseline file ───────────────────────────────────────────────────────────────────────────────────

export function baselinePath(root: string, override?: string): string {
  return override ?? path.join(root, ...BASELINE_FILE_REL.split("/"));
}

/** Strict-shape load: anything malformed returns null (⇒ NOT-EVALUATED), never a silent "≤ baseline". */
export function readBaseline(p: string): Baseline | null {
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf8"));
    if (typeof raw?.count !== "number" || typeof raw?.inDomain !== "number" || !Array.isArray(raw?.entries)) {
      return null;
    }
    if (!raw.entries.every((e: any) => typeof e?.id === "string" && Array.isArray(e?.bareLines))) return null;
    return {
      count: raw.count,
      inDomain: raw.inDomain,
      entries: raw.entries.map((e: any) => ({ id: e.id, file: String(e.file ?? ""), bareLines: e.bareLines })),
      generatedAt: String(raw.generatedAt ?? ""),
    };
  } catch {
    return null;
  }
}

export function writeBaseline(p: string, e: Enumeration): void {
  const body: Baseline = {
    count: e.bareAcs.length,
    inDomain: e.inDomain,
    entries: e.bareAcs.map((x) => ({ id: x.id, file: x.file, bareLines: x.bareLines.map((b) => b.line) })),
    generatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(body, null, 2) + "\n");
}

// ── modes ───────────────────────────────────────────────────────────────────────────────────────────

const usage = `criterion-failure-attribution-check.ts — enumerate goals/AC-*.md criteria whose failure exits write no cause (GOAL-009 AC-241)

Usage:
  node --experimental-strip-types criterion-failure-attribution-check.ts [--root <dir>] [--json]
      gate mode — exit 1 iff the bare-failure-exit AC count EXCEEDS the committed baseline (shrink-only
      ratchet); exit 3 iff the goals dir cannot be read or yields zero in-domain criteria.
  node --experimental-strip-types criterion-failure-attribution-check.ts --capture [--root <dir>] [--json]
      capture mode — enumerate and WRITE the committed baseline file.
  Test seams: --goals-dir <dir> · --baseline <path>
Exit: 0 PASS · 1 FAIL (ratchet raised) · 2 usage/env · 3 NOT-EVALUATED
The predicate itself lives in packages/quay/src/goal-store.ts (shared with the write gate).`;

export function main(argv: string[]): number {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) helpExit(usage);
  const root = path.resolve(flagValue(args, "--root") ?? repoRoot());
  const goalsDir = path.resolve(flagValue(args, "--goals-dir") ?? path.join(root, "goals"));
  const asJson = args.includes("--json");
  const capture = args.includes("--capture");

  const summary = (e: Enumeration) => ({
    inDomain: e.inDomain,
    bareAcs: e.bareAcs.length,
    bareLines: e.bareLines,
    ids: e.bareAcs.map((x) => x.id),
  });

  const enum0 = enumerateBareFailureExits(goalsDir);
  if (!enum0.evaluated) {
    return emitNotEvaluated(
      `criterion-failure-attribution-check: NOT-EVALUATED — ${enum0.error ?? "the goals dir could not be enumerated"} (a checker that cannot read its input is never conflated with "no bare failure exits")`,
      { evaluated: false },
      { json: asJson, stream: "stderr" },
    );
  }

  if (capture) {
    const p = baselinePath(root, flagValue(args, "--baseline"));
    writeBaseline(p, enum0);
    return emitPass(
      `criterion-failure-attribution-check: captured baseline → inDomain=${enum0.inDomain} bareAcs=${enum0.bareAcs.length} bareLines=${enum0.bareLines}`,
      { ...summary(enum0), baselineFile: p },
      { json: asJson },
    );
  }

  const p = baselinePath(root, flagValue(args, "--baseline"));
  const baseline = readBaseline(p);
  if (baseline === null) {
    return emitNotEvaluated(
      `criterion-failure-attribution-check: NOT-EVALUATED — baseline file missing or malformed (${p}); run --capture to create it (a checker that cannot read its baseline is never conflated with "≤ baseline")`,
      { ...summary(enum0), evaluated: false, baselineMissing: true },
      { json: asJson, stream: "stderr" },
    );
  }

  const verdict = checkRatchet(enum0, baseline);
  if (verdict.ok) {
    return emitPass(
      `criterion failure attribution intact: inDomain=${enum0.inDomain} bareAcs=${enum0.bareAcs.length} ≤ baseline ${baseline.count} (bareLines=${enum0.bareLines}${verdict.fixed.length ? `; fixed since baseline: ${verdict.fixed.join(",")}` : ""})`,
      { ...summary(enum0), baseline: baseline.count, delta: verdict.delta, fixed: verdict.fixed },
      { json: asJson },
    );
  }
  return emitFail(
    `criterion failure attribution REGRESSED: bareAcs=${enum0.bareAcs.length} > baseline ${baseline.count} (delta +${verdict.delta}); new bare-failure-exit AC(s): ${verdict.added.join(", ") || "(none — a re-count mismatch)"} — a failing criterion must write its cause to stderr/stdout`,
    { ...summary(enum0), baseline: baseline.count, delta: verdict.delta, added: verdict.added },
    { json: asJson },
  );
}

if (isDirectEntry(import.meta, undefined, "criterion-failure-attribution-check")) {
  process.exitCode = main(process.argv);
}
