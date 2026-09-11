#!/usr/bin/env node
// criterion-failure-attribution-check.ts — mechanical enumeration of goal criteria whose FAILURE exits
// write no cause (tasks/gap-goal-criteria-bare-failing-exit-unattributable, GOAL-009 AC-241).
//
// THE DEFECT THIS CLOSES: `goals/AC-*.md` criteria are shell strings executed by
// packages/quay/src/gate/acceptance-runner.ts. When a criterion exits non-zero and writes NOTHING to
// stderr/stdout, the runner's third branch (acceptance-runner.ts:143) composes
//   `acceptance failed (exit 1) — criterion wrote no output to stderr/stdout`
// — a verdict that says a criterion failed but not WHY. That is unattributable: "no anchorable site
// exists" and "the site exists but has no matching record" are different situations with different
// dispositions, and they were collapsed into one identical string. AC-237 fixed the RUNNER side (the
// failure reason now carries whatever the criterion wrote); it could not observe the CRITERION side,
// because its own fixture (`echo CAUSE-TOKEN >&2; exit 1`) necessarily writes a cause (hard rule 4
// 推论三: a fixture proves "can produce", not "did produce"). This checker is the criterion-side
// complement: it enumerates, BY POSITION, the criteria whose failure exits write nothing.
//
// WHAT IT ENUMERATES (hard rule 2 — position, not keyword):
//   goals/AC-*.md whose frontmatter `status` ∈ {active, achieved} (the I5 re-verification domain —
//   an achieved AC that turns red writes to the same ledger) AND whose `criterion` is a non-empty
//   string. For each such criterion, LINE BY LINE:
//     · a FAILURE-EXIT line   = matches /(?:sys\.)?exit\s*\(\s*1\s*\)/ or /\bexit\s+1\b/
//       (python `sys.exit(1)` / `exit(1)`; shell `exit 1` in any position, incl. `|| exit 1`)
//     · an ATTRIBUTED line    = also matches /stderr|>&2|console\.error/
//       (sys.stderr.write / print(..., file=sys.stderr) / shell `>&2` / console.error)
//   BARE = failure-exit ∧ ¬attributed. Comments and strings are not masked: a criterion is a SHELL
//   SCRIPT, so `#` is a comment but also a valid token inside a string — masking by position would be
//   a proxy for the real question. The real question is exactly "does this failure exit line carry a
//   write to a stream the runner captures", and that is what the two regexes answer.
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
// MODES:
//   default  [--root <dir>] [--json] — gate mode: enumerate, compare against the committed baseline.
//   --capture [--root <dir>] [--json] — enumerate and WRITE the committed baseline file.
// Test seams (used by plugin/test + the mutation case, ⛔ never by the registry):
//   --goals-dir <dir>   enumerate this dir instead of <root>/goals
//   --baseline <path>   read/write this baseline file instead of the committed one

import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { emitPass, emitFail, emitNotEvaluated, helpExit, isDirectEntry } from "./gate-script-base.ts";
import { repoRoot } from "./repo-root.ts";

// ── surfaces ────────────────────────────────────────────────────────────────────────────────────────

/** The committed, mechanically-generated baseline (docs/analysis/, alongside the other .baseline.json). */
export const BASELINE_FILE_REL = "docs/analysis/criterion-failure-attribution.baseline.json";

/** The in-domain statuses: the I5 re-verification domain (AC-216 — an achieved AC still gates). */
export const IN_DOMAIN_STATUSES: readonly string[] = ["active", "achieved"];

/** A failure exit: python `sys.exit(1)` / `exit(1)` (also the computed form `sys.exit(1 if bare else 0)`
 *  — it fails with no cause on its red branch), or shell `exit 1` in any position (incl. `|| exit 1`).
 *  `(?![\d])` keeps `exit(10)` / `exit(123)` out; `\b` keeps shell `exit 10` out. ⛔ A *trailing* computed
 *  1 (`sys.exit(0 if ok else 1)`) is NOT matched — documented limitation, not a silent pass. */
const FAILURE_EXIT_RE = /(?:sys\.)?exit\s*\(\s*1(?![\d])|\bexit\s+1\b/;

/** An attribution: something the acceptance-runner captures (stderr) or the shell redirects to it. */
const ATTRIBUTION_RE = /stderr|>&2|console\.error/;

// ── types ───────────────────────────────────────────────────────────────────────────────────────────

export interface BareLine {
  /** 1-based line number inside the criterion text. */
  line: number;
  /** The trimmed line, so a reader can judge the classification without re-reading the goal file. */
  text: string;
}

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

// ── position-based masking (hard rule 2) ────────────────────────────────────────────────────────────

/** Blank an unquoted `#`-to-end-of-line comment. `#` is the comment starter in BOTH shells and python,
 *  and a criterion is a shell string whose embedded heredocs are usually python — so one masker covers
 *  both. Quote-aware: `#` inside '…' / "…" / `…` is data, not a comment. ⛔ Strings are deliberately NOT
 *  masked: unlike a C-style `//` slice, a shell criterion's quoted `bash -c "exit 1"` really does exit 1,
 *  so masking strings would manufacture false NEGATIVES — the harder error to notice (hard rule 4). */
export function maskHashComments(line: string): string {
  let out = "";
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote !== null) {
      if (c === "\\" && quote !== "'") {
        out += c;
        if (i + 1 < line.length) out += line[++i];
        continue;
      }
      if (c === quote) quote = null;
      out += c;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      quote = c;
      out += c;
      continue;
    }
    if (c === "#") break;
    out += c;
  }
  return out;
}

// ── enumeration ─────────────────────────────────────────────────────────────────────────────────────

/** Split a goal file into (frontmatter, body). null when there is no `---` frontmatter block. */
export function splitFrontmatter(src: string): { fm: string } | null {
  if (!src.startsWith("---")) return null;
  const end = src.indexOf("\n---", 3);
  if (end === -1) return null;
  return { fm: src.slice(3, end) };
}

/** True iff this criterion LINE is a failure exit that writes no cause. Pure — the testable core.
 *  Judged BY POSITION (hard rule 2): a `#`-comment that merely mentions `exit 1` is not a failure exit. */
export function isBareFailureExitLine(line: string): boolean {
  const code = maskHashComments(line);
  return FAILURE_EXIT_RE.test(code) && !ATTRIBUTION_RE.test(code);
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
    const bareLines: BareLine[] = [];
    rec.criterion.split("\n").forEach((line, i) => {
      if (isBareFailureExitLine(line)) bareLines.push({ line: i + 1, text: line.trim() });
    });
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
  Exit: 0 PASS · 1 FAIL (ratchet raised) · 2 usage/env · 3 NOT-EVALUATED`;

function getArgValue(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  return idx === -1 ? undefined : args[idx + 1];
}

export function main(argv: string[]): number {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) helpExit(usage);
  const root = path.resolve(getArgValue(args, "--root") ?? repoRoot());
  const goalsDir = path.resolve(getArgValue(args, "--goals-dir") ?? path.join(root, "goals"));
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
    const p = baselinePath(root, getArgValue(args, "--baseline"));
    writeBaseline(p, enum0);
    return emitPass(
      `criterion-failure-attribution-check: captured baseline → inDomain=${enum0.inDomain} bareAcs=${enum0.bareAcs.length} bareLines=${enum0.bareLines}`,
      { ...summary(enum0), baselineFile: p },
      { json: asJson },
    );
  }

  const p = baselinePath(root, getArgValue(args, "--baseline"));
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
