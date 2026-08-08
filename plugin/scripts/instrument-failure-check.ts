#!/usr/bin/env node
// instrument-failure-check.ts — 管理者仪器失效五族的机械检出器
// (tasks/gap-manager-instrument-failures-need-mechanical-detection-not-carefulness)
//
// The defect this closes: the manager's instrument failures recurred 7 times in one night across
// five families, every one already documented in manager-loop-tick.md §4 — yet prose rules provably
// don't work (writing a failure down ≠ mechanically detecting it). The manager cannot write their
// own checker (role boundary); this scanner is the inner's deliverable.
//
// It scans the tick docs (orchestration/manager-loop-tick.md, orchestration/orchestrator-loop-tick.md,
// plugin/loop/*.md) — and, via --scan, any files given — for the FIVE documented failure families in
// shell commands. Each family detector is a heuristic over a line's text (fenced code, inline code,
// and prose that names the failure shape). The five families (each with a §4 row + a live example):
//
//   FAMILY-1  grep/pgrep 自匹配 (self-match): `pgrep -f '<literal>'` — the query's own argv contains
//             the pattern, so pgrep -f matches the shell that runs it. Correct form: `pgrep -x`,
//             `pgrep -xc`, `comm=` exact match, or explicit `grep -v` self-exclusion.
//   FAMILY-2  零命中当「不存在」 (zero-hit-as-absent): a `grep -c` count read as "nothing happened"
//             without a positive control, or 零命中 asserted as 没发生/不存在.
//   FAMILY-3  管道后读 `$?` (pipe-then-$?): a `$?` read at a position AFTER a pipe `|` (with no
//             PIPESTATUS) — reads the LAST pipeline stage, not the command. Correct: read `$?`
//             BEFORE the pipe, or use PIPESTATUS.
//   FAMILY-4  片段当进程名 (fragment-as-process-name): `comm=<bare-word>` or `grep -cx <bare-word>`
//             where the bare word (no hyphen) is a fragment of the real comm (e.g. `comm=node`
//             never matches node-MainThread).
//   FAMILY-5  读派生视图断言实时 (derived-view-as-real-time): reading a snapshot file
//             (`full-suite-state.json`, `*.json`) and asserting real-time state from it WITHOUT a
//             freshness check (stat/mtime/startedAt/finishedAt/新鲜度) on the same line.
//
// Modes:
//   --scan <file...>   measure mode (the ## Contract surface). Prints one `FAMILY-<n>` line per
//                      detected family (the Contract measure greps `^FAMILY-`), then per-hit detail.
//                      Exit 0 always (measure, never a gate).
//   --gate [--root]    static-tier gate (wired into scripts/test.sh run_static_checks). Scans the
//                      DEFAULT_SURFACE (the five tick docs). Enforces:
//                        (a) band   — every family fires ≥1 time (the Contract `detected_families
//                            ≥ 5`; "五族必须有机械检出路径" as an executable invariant). A family
//                            with 0 detections exits 1.
//                        (b) shrink-only — every family's hit count ≤ FAMILY_BASELINE[n]. A NEW
//                            failure-form instance beyond the documented baseline exits 1 (the
//                            anti-regression: prose can't silently add another un-detected failure).
//                      Exit 0 = PASS (both hold), 1 = FAIL, 2 = usage/env error.
//   --json             machine-readable output.
//
// Exit: 0 = PASS / measure; 1 = gate FAIL; 2 = usage/env error.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDirectEntry } from "./gate-script-base.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** The five documented failure families, in order. `id` is the FAMILY-<id> suffix. */
export const FAMILIES = [
  { id: 1, key: "self-match", name: "grep/pgrep 自匹配 (self-match)", row: "pgrep -f 杀掉自己的 shell" },
  { id: 2, key: "zero-hit-as-absent", name: "零命中当「不存在」 (zero-hit-as-absent)", row: "零命中当「没发生」" },
  { id: 3, key: "pipe-then-dollar-q", name: "管道后读 `$?` (pipe-then-$?)", row: "管道后读 `$?`" },
  { id: 4, key: "fragment-as-process-name", name: "片段当进程名 (fragment-as-process-name)", row: "comm=node 永不匹配" },
  { id: 5, key: "derived-view-as-real-time", name: "读派生视图断言实时 (derived-view-as-real-time)", row: "读 full-suite-state.json 的 state" },
] as const;

/** The ## Contract scan surface (also the --gate default object set). */
export const DEFAULT_SURFACE = [
  "orchestration/manager-loop-tick.md",
  "orchestration/orchestrator-loop-tick.md",
  "plugin/loop/fast-mode-loop-tick.md",
  "plugin/loop/manager-loop-tick.md",
  "plugin/loop/orchestrator-loop-tick.md",
];

/**
 * Shrink-only per-family baselines — the number of real hits each family produces on the
 * CURRENT documented surface (measured 2026-08-08, at the task's land: 2/5/2/7/10 — each family
 * has at least one real, documented instance per AC1). A NEW failure-form instance beyond these
 * counts red-lights the gate. To rebaseline after an INTENTIONAL doc change, re-run --gate and
 * copy the `detected` numbers here (the audit trail is in the git history of this constant).
 */
export const FAMILY_BASELINE: Record<number, number> = { 1: 2, 2: 5, 3: 2, 4: 7, 5: 10 };

// ── Per-family detectors (PURE: line text → boolean) ──────────────────────────────────────────────────
// The detectors scan a whole line (fenced code lines, inline backtick code, and prose that names a
// failure shape). Comment/prose mentions of a BARE flag (`pgrep -f` with no quoted literal) do NOT
// fire family 1; the §4 table's own `$?` rows DO fire family 3 (a real documented instance). Each
// detector's correct-form negative control is asserted in plugin/test/instrument-failure-check.test.mjs
// and the mutation case.

/** FAMILY-1 — `pgrep -f`/`grep -f` with an inline quoted literal (the query's own argv contains the
 *  pattern ⇒ pgrep -f matches the shell running it). A bare `pgrep -f` (prose naming the flag) does
 *  not fire. */
export function detectFamily1(line: string): boolean {
  return /pgrep\s+-f\s+['"][^'"]+['"]/.test(line) || /grep\s+-f\s+['"][^'"]+['"]/.test(line);
}

/** FAMILY-2 — a `grep -c` count asserted/annotated as absence ("0 = nothing"), or 零命中 asserted as
 *  没发生/不存在. Requires the absence SEMANTIC, not just a count. */
export function detectFamily2(line: string): boolean {
  if (/grep\s+-c/.test(line) && /(0\s*=|[-=]{1,2}\s*0\b|返回\s*0|永远返回\s*0|0\s*命中)/.test(line)) {
    return true;
  }
  if (/(零命中|0\s*命中)/.test(line) && /(没发生|不存在|无数据|nothing)/.test(line)) {
    return true;
  }
  return false;
}

/** FAMILY-3 — a `$?` read AFTER a pipe `|` (no PIPESTATUS). Reads the LAST pipeline stage, not the
 *  command. `echo "$?" | cat` (read BEFORE the pipe) does NOT fire; PIPESTATUS does NOT fire. */
export function detectFamily3(line: string): boolean {
  if (line.includes("PIPESTATUS")) return false;
  const qi = line.indexOf("$?");
  if (qi === -1) return false;
  const pi = line.indexOf("|");
  return pi !== -1 && pi < qi;
}

/** FAMILY-4 — `comm=` compared against a bare word, or `grep -c<flags> <bare-word>`, where the bare
 *  word (no hyphen) is a fragment of the real comm (comm=node never matches node-MainThread). The
 *  full token is captured so `node-MainThread` (the correct exact form) does NOT fire. */
export function detectFamily4(line: string): boolean {
  if (!line.includes("comm=")) return false;
  const grepTok = line.match(/grep\s+-c?x?\s+([A-Za-z_][A-Za-z0-9_-]*)/);
  if (grepTok && !grepTok[1].includes("-")) return true;
  const commVal = line.match(/comm=([A-Za-z_][A-Za-z0-9_-]*)/);
  if (commVal && !commVal[1].includes("-")) return true;
  return false;
}

/** Freshness tokens for FAMILY-5 — a line carrying one is a freshness-CHECKED snapshot read (the
 *  correct form), so it does NOT fire. `新鲜度` is included: a line that names freshness is
 *  acknowledging the concern even when it says 无新鲜度检查. */
export const FRESHNESS_TOKENS =
  /\b(stat\b|mtime|mmin|-nt\b|find\b|age\b|startedAt|finishedAt|durationMs|freshen|newer|陈旧|滞后|新鲜度|freshness)\b/;

/** FAMILY-5 — reading a snapshot/derived-view file (`full-suite-state`, `state.json`, `*.json` —
 *  NOT `.jsonl` event streams) to assert real-time state, WITHOUT a freshness check on the same
 *  line. Writing (runner 写 …) is not a read-assertion and does NOT fire. */
export function detectFamily5(line: string): boolean {
  const hasSnapshot =
    /(full-suite-state|state\.json|state-file|derived-view|聚合快照)/.test(line) ||
    (/\.json\b/.test(line) && !/\.jsonl/.test(line));
  if (!hasSnapshot) return false;
  if (!/(读|read|assert|断言|判断|判定)/.test(line)) return false;
  if (/(写|write|append|>>)/.test(line)) return false;
  if (!/(state|状态|在跑|正在跑|green|red|当前|实时)/.test(line)) return false;
  if (FRESHNESS_TOKENS.test(line)) return false;
  return true;
}

/** All family detectors, indexed by family id. */
export const DETECTORS: Record<number, (line: string) => boolean> = {
  1: detectFamily1,
  2: detectFamily2,
  3: detectFamily3,
  4: detectFamily4,
  5: detectFamily5,
};

// ── Scan ───────────────────────────────────────────────────────────────────────────────────────────────

export interface FamilyHit {
  file: string;
  line: number;
  text: string;
}

export interface FileResult {
  /** family id → hits */
  byFamily: Record<number, FamilyHit[]>;
}

/** Scan one file's text, returning per-family hit lists. PURE (no fs). */
export function scanText(text: string, relFile = "<input>"): Record<number, FamilyHit[]> {
  const byFamily: Record<number, FamilyHit[]> = { 1: [], 2: [], 3: [], 4: [], 5: [] };
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const fam of FAMILIES) {
      if (DETECTORS[fam.id](line)) {
        byFamily[fam.id].push({ file: relFile, line: i + 1, text: line.trim() });
      }
    }
  }
  return byFamily;
}

/** Scan a set of files on disk. Returns per-file results. */
export function scanFiles(files: string[]): { relFile: string; byFamily: Record<number, FamilyHit[]> }[] {
  const out = [];
  for (const f of files) {
    if (!fs.existsSync(f)) throw new Error(`scan file not found: ${f}`);
    out.push({ relFile: f, byFamily: scanText(fs.readFileSync(f, "utf8"), f) });
  }
  return out;
}

/** Aggregate per-file results into a single per-family hit list, sorted by (file, line). */
export function aggregate(results: { relFile: string; byFamily: Record<number, FamilyHit[]> }[]): {
  byFamily: Record<number, FamilyHit[]>;
  counts: Record<number, number>;
} {
  const byFamily: Record<number, FamilyHit[]> = { 1: [], 2: [], 3: [], 4: [], 5: [] };
  for (const r of results) {
    for (const fam of FAMILIES) {
      byFamily[fam.id].push(...r.byFamily[fam.id]);
    }
  }
  for (const fam of FAMILIES) {
    byFamily[fam.id].sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1));
  }
  const counts: Record<number, number> = {};
  for (const fam of FAMILIES) counts[fam.id] = byFamily[fam.id].length;
  return { byFamily, counts };
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────────────

const usage = `instrument-failure-check.ts — 管理者仪器失效五族的机械检出器
(gap-manager-instrument-failures-need-mechanical-detection-not-carefulness)

Usage:
  node --experimental-strip-types instrument-failure-check.ts --scan <file...> [--json]
      measure mode — print one FAMILY-<n> line per detected family + per-hit detail. Exit 0.
  node --experimental-strip-types instrument-failure-check.ts --gate [--root <dir>] [--json]
      static-tier gate — scan DEFAULT_SURFACE; require (a) all 5 families ≥1 hit (band),
      (b) each family ≤ FAMILY_BASELINE[n] (shrink-only). Exit 1 on violation.

Exit codes: 0 PASS/measure · 1 gate FAIL · 2 usage/env error.`;

function resolveRoot(rootArg: string | undefined): string {
  return path.resolve(rootArg ?? process.cwd());
}

export function main(argv: string[]): number {
  const args = argv.slice(2);
  const flagVal = (name: string) => {
    const i = args.indexOf(name);
    return i !== -1 ? args[i + 1] : undefined;
  };
  const asJson = args.includes("--json");
  const root = resolveRoot(flagVal("--root"));
  const scanIdx = args.indexOf("--scan");

  if (scanIdx !== -1) {
    const files = args.slice(scanIdx + 1).filter((a) => !a.startsWith("--"));
    if (files.length === 0) {
      console.error(usage);
      return 2;
    }
    const resolved = files.map((f) => (path.isAbsolute(f) ? f : path.join(root, f)));
    let results;
    try {
      results = scanFiles(resolved);
    } catch (e) {
      console.error(`instrument-failure-check: ${(e as Error).message}`);
      return 2;
    }
    const { byFamily, counts } = aggregate(results);
    const detected = FAMILIES.filter((f) => counts[f.id] > 0);

    if (asJson) {
      console.log(
        JSON.stringify(
          {
            mode: "scan",
            files: files,
            detectedFamilies: detected.map((f) => f.id),
            counts: counts,
            hits: Object.fromEntries(
              FAMILIES.map((f) => [f.id, byFamily[f.id].map((h) => ({ file: h.file, line: h.line, text: h.text }))]),
            ),
          },
          null,
          2,
        ),
      );
    } else {
      // The ## Contract measure greps `^FAMILY-`; emit exactly one line per family.
      for (const f of FAMILIES) {
        if (counts[f.id] > 0) {
          const first = byFamily[f.id][0];
          console.log(
            `FAMILY-${f.id}: ${f.name} — ${counts[f.id]} hit(s), first at ${first.file}:${first.line}`,
          );
        }
      }
      for (const f of FAMILIES) {
        if (counts[f.id] === 0) continue;
        console.log(`  FAMILY-${f.id} hits:`);
        for (const h of byFamily[f.id]) console.log(`    ${h.file}:${h.line}: ${h.text.slice(0, 110)}`);
      }
    }
    return 0;
  }

  if (args.includes("--gate")) {
    const files = DEFAULT_SURFACE.map((f) => path.join(root, f));
    const missing = files.filter((f) => !fs.existsSync(f));
    if (missing.length > 0) {
      console.error(`instrument-failure-check: --gate surface missing files under --root ${root}:`);
      for (const m of missing) console.error(`  ${m}`);
      return 2;
    }
    let results;
    try {
      results = scanFiles(files);
    } catch (e) {
      console.error(`instrument-failure-check: ${(e as Error).message}`);
      return 2;
    }
    const { byFamily, counts } = aggregate(results);

    const bandFailures = FAMILIES.filter((f) => counts[f.id] === 0);
    const shrinkFailures = FAMILIES.filter((f) => counts[f.id] > FAMILY_BASELINE[f.id]);
    const ok = bandFailures.length === 0 && shrinkFailures.length === 0;

    if (asJson) {
      console.log(
        JSON.stringify(
          {
            mode: "gate",
            ok,
            counts: counts,
            baselines: FAMILY_BASELINE,
            bandFailures: bandFailures.map((f) => f.id),
            shrinkFailures: shrinkFailures.map((f) => ({ family: f.id, detected: counts[f.id], baseline: FAMILY_BASELINE[f.id] })),
            hits: Object.fromEntries(
              FAMILIES.map((f) => [f.id, byFamily[f.id].map((h) => ({ file: h.file, line: h.line, text: h.text }))]),
            ),
          },
          null,
          2,
        ),
      );
    } else {
      for (const f of FAMILIES) {
        const c = counts[f.id];
        const b = FAMILY_BASELINE[f.id];
        const status = c === 0 ? "NO-DETECTION" : c > b ? "ABOVE-BASELINE" : "ok";
        console.log(`  FAMILY-${f.id}: detected=${c} baseline=${b}  ${status}`);
      }
      if (ok) {
        console.log("instrument-failure-check --gate: PASS — 5/5 families mechanically detectable, no shrink-only violation");
      } else {
        console.log("instrument-failure-check --gate: FAIL — see FAMILY lines above");
        if (bandFailures.length) {
          console.log(`  band violation: family/ies ${bandFailures.map((f) => f.id).join(",")} have 0 mechanical detections (the §4 family is no longer detectable)`);
        }
        for (const f of shrinkFailures) {
          console.log(`  shrink-only violation: family ${f.id} detected ${counts[f.id]} > baseline ${FAMILY_BASELINE[f.id]} — a NEW failure-form instance entered the documented surface`);
        }
      }
    }
    return ok ? 0 : 1;
  }

  console.error(usage);
  return 2;
}

if (isDirectEntry(import.meta)) {
  process.exitCode = main(process.argv);
}
