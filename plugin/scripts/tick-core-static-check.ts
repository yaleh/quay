#!/usr/bin/env node
// tick-core-static-check.ts — execution-core static coverage checker
// (tasks/gap-tick-core-zero-static-coverage, AC2-AC7)
// @judges orchestration/*-tick-core.md
//
// WHAT IT DETECTS: the three execution cores (orchestration/*-tick-core.md — what the three layers
// ACTUALLY read every tick, the AC30(a) judgment objects) previously had ZERO static coverage:
// scripts/test.sh's @static-object pointed at the *-loop-tick.md REASON archives, not the
// *-tick-core.md EXECUTION cores (grep -c "tick-core" scripts/test.sh = 0). The 2026-08-10
// incidents — AC30(a) ≤80 lines, a pointer target file deleted, criterion numbering reused against
// the B3 group, and an unconditional "外层不直接改代码" prohibition contradicting the core's own
// Agent(run_in_background) dispatch — were ALL hand-found with wc -l / grep, zero mechanical gate.
// This checker closes the four gates:
//
//   AC3  — each core's A/B/C items carry (src:N) back-references to the reason archive (AC30(a)
//          measure = coverage, target 100%). An item without (src:N) reddens. (The retired ≤80-line
//          criterion was an n=3 placeholder conflicting with AC41 actionization — manager-phase-goal
//          :324, 2026-08-10.)
//   AC4  — every pointer target (a backtick-named repo-relative path a core references, e.g.
//          `orchestration/manager-loop-tick.md`) must EXIST. Three-layer resolution (exact →
//          basename → same-stem-diff-ext); placeholders (`NNN`/`<…>`/`*`/`{`), `.quay/` runtime
//          state, gitignored build artifacts, and stale-annotated references (the line itself says
//          the file is retired/replaced/banned) are skipped. A missing pointer target reddens.
//   AC5  — the manager B3 group's numbering (甲乙丙丁戊) must not collide with the criteria
//          numbering (①-⑤, reserved for manager-tick-criteria.md). The B3 section must carry all
//          five 甲乙丙丁戊 markers (the 2026-08-10 shape: three B3 tick-log lines reused ①-⑤ and
//          absence was disguised as presence). A B3 section missing any marker reddens.
//   AC6  — prohibition text in the four prohibition docs ("不要自己用 Agent / 外层不直接改代码")
//          must be CONSISTENT with the cores' background Agent dispatch. When a core uses
//          `run_in_background` (it does: fast-mode C5 / orchestrator C8), an UNCONDITIONAL
//          prohibition (a prohibition paragraph WITHOUT the 收窄/单一写入者/共享树 narrowing that
//          scopes it to the shared tree, permitting infrastructure work in one's own worktree)
//          contradicts the core and reddens. A narrowed prohibition passes.
//
// SCAN SURFACE (a ## Contract invariant — the set must stay byte-identical across runs; a missing
// scan target is an ERROR, never a silent green):
//     CORES           = orchestration/{manager,orchestrator,fast-mode}-tick-core.md
//     PROHIBITION_DOCS = orchestration/outer-brief-2026-08-04-third-restart.md
//                      + orchestration/QUAY-OUTER-HANDOFF.md
//                      + orchestration/exp6-phase1-sustained-unattended-operation.md
//                      + orchestration/orchestrator-loop-tick.md (boundary table)
//
// MODES:
//   default / --check  — scan the full surface under --root; exit 0 iff all four criteria pass.
//   --only <ac3|ac4|ac5|ac6> — run ONE criterion on the full surface (per-criterion tests).
//   --judge <path>     — judge ONE file: a prohibition doc → AC6; anything else → AC3+AC4+AC5.
//   --json             — machine-readable {ok, lines, ac3, ac4, ac5, ac6}.
//
// Exit codes: 0 = PASS; 1 = FAIL (any criterion violated, or a scan target missing); 2 = usage.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isDirectEntry } from "./gate-script-base.ts";

// ── Scan surface (a ## Contract invariant — missing target = ERROR, never silent green) ──────────────
export const CORES = [
  "orchestration/manager-tick-core.md",
  "orchestration/orchestrator-tick-core.md",
  "orchestration/fast-mode-tick-core.md",
] as const;

export const PROHIBITION_DOCS = [
  "orchestration/outer-brief-2026-08-04-third-restart.md",
  "orchestration/QUAY-OUTER-HANDOFF.md",
  "orchestration/exp6-phase1-sustained-unattended-operation.md",
  "orchestration/orchestrator-loop-tick.md",
] as const;

// (AC30(a) retired the ≤80-line ceiling — the measure is now (src:N) coverage, target 100%.)
export const PROHIBITION_PHRASES = ["不要自己用", "外层不直接改"];
export const NARROWING_MARKERS = ["收窄", "单一写入者", "共享树"];
export const B3_MARKERS = ["甲", "乙", "丙", "丁", "戊"];

// ── AC4 path-resolution constants (mirror threshold-scope-check.ts's three-layer judgment) ───────────
const TOP_LEVELS = [
  "packages", "plugin", "scripts", "docs", "tasks", "orchestration", "experiments",
  "adr", "dist", ".github", ".quay", ".claude", "milestones", "src", "test",
];
const PATH_EXT_RE = /\.(ts|js|mjs|md|sh|json|yml|yaml|txt|env|tsx|jsx|css|html|png|py|lock|snapshot|jsonl)$/;
const PLACEHOLDER_RE = /NNN|<[^>]*>|\*|\{/;
/** An annotation on the SAME line as a missing reference that explains why the path is gone — a
 *  reader following it is not misled (the text itself says it is retired/replaced/banned/runtime
 *  state). The deleted-superseded references in the cores (send-keys-verified.sh, the
 *  A16-deprecated subagent-budget counting script) carry such annotations. */
const STALE_ANNOT_RE =
  /(retired|superseded|RETIRED|SUPERSEDED|退役|退休|已退休|已废除|已删除|旧路径|never-existing|不存在|已修正|作废|不可用|已随|改名|取代|废弃|禁止|已停用|已退役)/;

// ── Result shapes ────────────────────────────────────────────────────────────────────────────────────
export interface PointerHit { file: string; line: number; path: string; kind: "missing" | "stale-ext"; }
export interface ProhibitionViolation { file: string; line: number; phrase: string; snippet: string; }

// ── AC3: (src:N) coverage ───────────────────────────────────────────────────────────────────────────
// AC30(a) (manager-phase-goal.md:324) RETIRED the "≤80 行" criterion: it was an n=3 placeholder that
// structurally conflicted with AC41 actionization. The AC30(a) measure is:
//   "每条带源行号 `(src:N)` 回指理由档案——measure = 覆盖率,目标 100%"
// An "item" is an actionable A-row (`| A<num> |`), B-bullet (`- **B<num>**`), or C-row (`| C<num> |`).
// Coverage = items carrying a `(src:...)` back-reference / total items; a core below 100% reddens.
export function srcNCoverage(text: string): { covered: number; total: number; missing: string[] } {
  const lines = text.split("\n");
  const missing: string[] = [];
  let total = 0;
  let covered = 0;
  lines.forEach((raw, i) => {
    const s = raw.trim();
    if (/^\| A\d+/.test(s) || /^- \*\*B\d+/.test(s) || /^\| C\d+/.test(s)) {
      total += 1;
      if (/\(src:[^)]*\)/.test(s)) covered += 1;
      else missing.push(`${raw.slice(0, 60)}...`);
    }
  });
  return { covered, total, missing };
}

// ── AC3b: (src:N "锚句") anchor verification (gap-src-n-anchor-coupling) ───────────────────────────────
// AC30(a) RETIRED the "parenthesis exists" reading of the (src:N) coverage measure: a line-number
// pointer rots as the reason archive is edited every tick, and the gate reported 100% while a 3/3
// spot-check of manager-core pointers all pointed at the WRONG content (A15→nyf ladder not inbox,
// A2→"push already-adjudicated to human" not fixed-cap, A16→a BLANK line). The measure is now
// "the pointer points at the right content", and the JUDGE is the anchor string, not the line number:
//   - a reference in the two-element form `(src:N "锚句")` is GREEN when 锚句 appears ANYWHERE in the
//     source document. N is a HINT only — an archive line-shift (e.g. +7 from a doc edit; round
//     137/138: every manager-core anchor-miss was exactly N+7 and the static check aborted the WHOLE
//     suite before tests ran, tests=0) does NOT redden a pointer whose anchor is still present
//     somewhere. RED ("锚句缺失") only when 锚句 appears NOWHERE in the document — a genuinely
//     missing anchor (anti-false-green).
//   - a reference still in the old `(src:N)` form (no anchor) is accepted as COVERAGE, not verified:
//     there is no anchor string to check, and a line-number-only pointer is exactly the drift-prone
//     shape the content measure replaces. UNIFIED across all three cores — fast-mode's former
//     "don't verify old-form line numbers" exemption is now the default (AC3).
//   - comma forms `(src:1570,1623)` count by REFERENCE, not by parenthesis (AC3b) — each N is
//     verified independently (each carries its own anchor).
//
// SCAN CAVEAT: the reason archive must exist at CORE_ARCHIVES[rel]. A missing archive SKIPS
// verification for that core (fail-open) — the fixture roots in plugin/test build the 3 cores
// without their archives, and a missing archive must not redden a fixture that is only testing
// coverage/pointer/numbering/prohibition. The real repo always carries the archives.
export const CORE_ARCHIVES: Record<string, string> = {
  "orchestration/manager-tick-core.md": "orchestration/manager-loop-tick.md",
  "orchestration/orchestrator-tick-core.md": "orchestration/orchestrator-loop-tick.md",
  "orchestration/fast-mode-tick-core.md": "plugin/loop/fast-mode-loop-tick.md",
};

export type SrcRef =
  | { kind: "n"; n: number; anchor?: string }
  | { kind: "task"; text: string };

/** Parse all `(src:…)` references out of a core row. Comma-separated items inside one parenthesis are
 *  split OUTSIDE quotes (an anchor may itself contain a comma); each item is a line number, a
 *  `N "锚句"` pair, or a `任务体 <task-id> …` task-body reference (not a line pointer — skipped). */
export function parseSrcRefs(text: string): SrcRef[] {
  const out: SrcRef[] = [];
  const re = /\(src:([^)]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const content = m[1];
    const parts: string[] = [];
    let cur = "";
    let inQ = false;
    for (const ch of content) {
      if (ch === '"') { inQ = !inQ; cur += ch; }
      else if (ch === "," && !inQ) { parts.push(cur.trim()); cur = ""; }
      else cur += ch;
    }
    parts.push(cur.trim());
    for (const p of parts) {
      if (!p) continue;
      const nn = /^(\d+)(?:\s+"([^"]*)")?\s*$/.exec(p);
      if (nn) { out.push({ kind: "n", n: parseInt(nn[1], 10), anchor: nn[2] !== undefined ? nn[2] : undefined }); continue; }
      if (/^任务体/.test(p)) { out.push({ kind: "task", text: p }); continue; }
      // Unparseable (e.g. "39-228") — kept for old coverage semantics (counts as a ref, not verified).
      out.push({ kind: "n", n: NaN, anchor: undefined });
    }
  }
  return out;
}

export interface AnchorViolation {
  file: string;        // the CORE file
  line: number;        // line in the CORE file
  item: string;        // first 12 chars of the item row
  srcN: number;        // the line number the pointer claims in the archive (a HINT, not the judge)
  kind: "anchor-miss"; // content-based anchoring: only a truly-missing anchor reddens
  anchor?: string;
  actualLines?: number[]; // 1-based lines where the anchor actually appears in the archive; [] = nowhere → miss
}

function findAllAnchorLines(lines: string[], anchor: string): number[] {
  const out: number[] = [];
  lines.forEach((l, i) => { if (l.includes(anchor)) out.push(i + 1); });
  return out;
}

/** Verify every (src:N …) reference in every core against its reason archive. A missing archive for a
 *  core is recorded in `skipped` (fail-open); anything verified and wrong is a violation. */
export function runAnchorChecks(root: string, coresText: Map<string, string>): { violations: AnchorViolation[]; skipped: string[] } {
  const violations: AnchorViolation[] = [];
  const skipped: string[] = [];
  for (const rel of CORES) {
    const archive = CORE_ARCHIVES[rel];
    if (!archive) continue;
    const abs = path.join(root, archive);
    if (!fs.existsSync(abs)) { skipped.push(`${rel} (archive ${archive} not found)`); continue; }
    const archLines = fs.readFileSync(abs, "utf8").split("\n");
    const text = coresText.get(rel)!;
    text.split("\n").forEach((raw, i) => {
      const s = raw.trim();
      if (!(/^\| A\d+/.test(s) || /^- \*\*B\d+/.test(s) || /^\| C\d+/.test(s))) return;
      for (const r of parseSrcRefs(s)) {
        if (r.kind !== "n" || Number.isNaN(r.n)) continue;
        // Old-form (src:N) with no anchor: coverage only — no content to check, and line numbers are
        // drift-prone hints, not verified (unified across all three cores, gap-src-n-anchor-coupling AC3).
        if (r.anchor === undefined) continue;
        const actualLines = findAllAnchorLines(archLines, r.anchor);
        if (actualLines.length === 0) {
          violations.push({
            file: rel, line: i + 1, item: s.slice(0, 12), srcN: r.n,
            kind: "anchor-miss", anchor: r.anchor,
            actualLines,
          });
        }
      }
    });
  }
  return { violations, skipped };
}

// ── AC4: pointer targets exist ───────────────────────────────────────────────────────────────────────

export interface FileIndex {
  byBasename: Map<string, string>;
  byStem: Map<string, Set<string>>;
}

export function buildFileIndex(root: string): FileIndex {
  const byBasename = new Map<string, string>();
  const byStem = new Map<string, Set<string>>();
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        // Exclude hidden / node_modules / TEST-ARTIFACT + WORKTREE dirs: a basename found only in
        // tmp/worktree/milestone copies must not falsely resolve a genuinely stale reference.
        if (e.name.startsWith(".") || e.name === "node_modules" || e.name === "tmp"
          || e.name === "worktrees" || e.name === "milestones") continue;
        walk(path.join(dir, e.name));
        continue;
      }
      const rel = path.relative(root, path.join(dir, e.name)).split(path.sep).join("/");
      if (!byBasename.has(e.name)) byBasename.set(e.name, rel);
      const dot = e.name.lastIndexOf(".");
      if (dot > 0) {
        const stem = e.name.slice(0, dot);
        if (!byStem.has(stem)) byStem.set(stem, new Set());
        byStem.get(stem)!.add(e.name.slice(dot + 1));
      }
    }
  };
  walk(root);
  return { byBasename, byStem };
}

/** Extract path-like candidates from a backtick token (same judgment as threshold-scope-check:
 *  slash-bearing tokens that start at a repo top-level or carry a known extension; bare basenames
 *  only when they look like real filenames; absolute/home/numeric/shell-word tokens skipped).
 *  A trailing `:N` line reference (e.g. `orchestration/orchestrator-loop-tick.md:302`) is stripped —
 *  the doc uses `path:N` as a source-locator shorthand, never a filename. */
export function pathCandidates(token: string): string[] {
  const out: string[] = [];
  for (const w of token.split(/\s+/)) {
    let w2 = w.replace(/^[`'"(]+/, "").replace(/[),;.]+$/, "");
    w2 = w2.replace(/:\d+$/, "");
    if (w2.length < 3) continue;
    if (w2.startsWith("/") || w2.startsWith("~")) continue;
    if (!w2.includes("/")) {
      const dot = w2.lastIndexOf(".");
      if (dot <= 0 || dot === w2.length - 1) continue; // ".mjs" or "foo." — not a filename
      const base = w2.slice(0, dot);
      const ext = w2.slice(dot + 1);
      if (!PATH_EXT_RE.test(`.${ext}`)) continue;
      if (!/^[A-Za-z0-9_@-]/.test(base)) continue; // shell/flag/quote leftovers
      out.push(w2);
      continue;
    }
    if (w2.length <= 2) continue; // lone "/" from math
    const startsTop = TOP_LEVELS.some((t) => w2 === t || w2.startsWith(t + "/"));
    if (startsTop || PATH_EXT_RE.test(w2)) out.push(w2);
  }
  return out;
}

/** Which of `missingPaths` are gitignored under `root` (git check-ignore --stdin, batched). A
 *  missing gitignored path is expected runtime/build state (e.g. `dist/quay.js`), not a stale
 *  reference. Fail-open: a non-git fixture returns an empty set (nothing exempt via git). */
export function gitignoredPaths(root: string, missingPaths: string[]): Set<string> {
  const out = new Set<string>();
  if (missingPaths.length === 0) return out;
  try {
    const res = execFileSync("git", ["check-ignore", "--stdin"], {
      cwd: root, encoding: "utf8", input: missingPaths.join("\n") + "\n",
      timeout: 5_000, stdio: ["pipe", "pipe", "ignore"],
    });
    for (const line of res.split("\n")) {
      const p = line.trim();
      if (p) out.add(p.replace(/\\/g, "/"));
    }
  } catch {
    // git absent / not a repo / error — fail-open (nothing exempt).
  }
  return out;
}

/** Basenames mentioned in `.gitignore` — a BARE reference to one is a known runtime/ignored
 *  artifact (`batch2-queue-state.md` → `docs/analysis/batch2-queue-state.md`), not a stale SOURCE
 *  path. `git check-ignore` cannot match a bare basename against a prefixed pattern, so this is the
 *  bare-name companion to gitignoredPaths (mirrors threshold-scope-check). */
export function readGitignoreBasenames(root: string): Set<string> {
  const p = path.join(root, ".gitignore");
  if (!fs.existsSync(p)) return new Set();
  const out = new Set<string>();
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const seg = t.split("/").pop() || "";
    const base = seg.replace(/[*?]/g, "").trim();
    const dot = base.lastIndexOf(".");
    if (dot > 0 && dot < base.length - 1 && /^[A-Za-z0-9_@-]/.test(base.slice(0, dot))) out.add(base);
  }
  return out;
}

/** Scan one core's text for backtick-named pointer targets that cannot be resolved. */
export function scanPointerTargets(text: string, rel: string, root: string, index: FileIndex, ignored: Set<string>, ignoredBasenames: Set<string> = new Set()): PointerHit[] {
  const hits: PointerHit[] = [];
  const lines = text.split("\n");
  lines.forEach((raw, i) => {
    for (const bm of raw.matchAll(/`([^`\n]+)`/g)) {
      for (const cand of pathCandidates(bm[1])) {
        if (PLACEHOLDER_RE.test(cand)) continue;
        const exact = fs.existsSync(path.join(root, cand));
        if (exact) continue;
        const base = cand.split("/").pop() || cand;
        const dot = base.lastIndexOf(".");
        const stem = dot > 0 ? base.slice(0, dot) : base;
        const candExt = dot > 0 ? base.slice(dot + 1) : "";
        if (index.byBasename.has(base)) continue; // local reference — legal shorthand
        // Annotated as gone on the same line — the text itself says retired/replaced/banned.
        if (STALE_ANNOT_RE.test(raw)) continue;
        // Runtime/build state expected absent in a fresh checkout.
        if (cand.startsWith(".quay/") || ignored.has(cand) || ignoredBasenames.has(base)) continue;
        const sameStemDiffExt = dot > 0
          && index.byStem.has(stem)
          && [...(index.byStem.get(stem) as Set<string>)].some((e) => e !== candExt);
        hits.push({ file: rel, line: i + 1, path: cand, kind: sameStemDiffExt ? "stale-ext" : "missing" });
      }
    }
  });
  return hits;
}

// ── AC5: criterion numbering ≠ B3 group ──────────────────────────────────────────────────────────────
export function findB3Section(text: string): { start: number; end: number } | null {
  const lines = text.split("\n");
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^- \*\*B3\b/.test(lines[i].trim())) { start = i; break; }
  }
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^- \*\*B[0-9]+\b/.test(lines[i].trim())) { end = i; break; }
  }
  return { start, end };
}

/** The five B3 markers must all be present in the B3 section. A B3 group that renumbers its items
 *  to ①-⑤ (the criteria numbering, reserved for manager-tick-criteria.md) loses the 甲-戊 markers
 *  and reddens — the 2026-08-10 "absence disguised as presence" shape. */
export function missingB3Markers(section: string): string[] {
  return B3_MARKERS.filter((m) => !section.includes(m));
}

// ── AC6: prohibition consistency ─────────────────────────────────────────────────────────────────────
export function groupParagraphs(text: string): string[] {
  return text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
}

/** Scan one prohibition doc's paragraphs: a paragraph carrying a prohibition phrase must also carry
 *  a narrowing marker (收窄 / 单一写入者 / 共享树). An UNCONDITIONAL prohibition — with the cores'
 *  run_in_background dispatch in force — contradicts the core and is a violation. */
export function scanProhibition(text: string, rel: string): ProhibitionViolation[] {
  const out: ProhibitionViolation[] = [];
  const paras = groupParagraphs(text);
  for (const p of paras) {
    for (const phrase of PROHIBITION_PHRASES) {
      if (!p.includes(phrase)) continue;
      const narrowed = NARROWING_MARKERS.some((m) => p.includes(m));
      if (narrowed) continue;
      const line = text.split("\n").findIndex((l) => l.includes(phrase)) + 1;
      out.push({ file: rel, line: line || 1, phrase, snippet: p.slice(0, 120) });
      break;
    }
  }
  return out;
}

// ── Aggregated result ────────────────────────────────────────────────────────────────────────────────
export interface CheckResult {
  ok: boolean;
  coverage: Record<string, { covered: number; total: number }>;
  ac3: {
    ok: boolean;
    uncovered: { file: string; covered: number; total: number; missing: string[] }[];
    anchorViolations: AnchorViolation[];
    anchorSkipped: string[];
  };
  ac4: { ok: boolean; missing: PointerHit[] };
  ac5: { ok: boolean; missingMarkers: string[]; b3Found: boolean };
  ac6: { ok: boolean; precondition: boolean; violations: ProhibitionViolation[] };
}

function readText(root: string, rel: string): string {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) {
    throw new Error(`tick-core-static-check: scan target missing — ${rel} (the scan surface is a ## Contract invariant; a renamed/deleted file must fail loudly, not shrink the surface)`);
  }
  return fs.readFileSync(abs, "utf8");
}

export function runChecks(root: string, only?: string): CheckResult {
  const coresText = new Map<string, string>();
  for (const rel of CORES) coresText.set(rel, readText(root, rel));

  const coverage: Record<string, { covered: number; total: number }> = {};
  const covMap = new Map<string, ReturnType<typeof srcNCoverage>>();
  for (const rel of CORES) {
    const c = srcNCoverage(coresText.get(rel)!);
    covMap.set(rel, c);
    coverage[rel] = { covered: c.covered, total: c.total };
  }

  // AC3 (src:N coverage + anchor verification)
  const uncovered: { file: string; covered: number; total: number; missing: string[] }[] = [];
  for (const rel of CORES) {
    const c = covMap.get(rel)!;
    if (c.covered < c.total) uncovered.push({ file: rel, covered: c.covered, total: c.total, missing: c.missing });
  }
  const anchor = runAnchorChecks(root, coresText);
  const ac3 = { ok: uncovered.length === 0 && anchor.violations.length === 0, uncovered, anchorViolations: anchor.violations, anchorSkipped: anchor.skipped };

  // AC4
  const index = buildFileIndex(root);
  const ignoredBasenames = readGitignoreBasenames(root);
  let missing: PointerHit[] = [];
  if (!only || only === "ac4") {
    const allMissing: PointerHit[] = [];
    for (const rel of CORES) {
      allMissing.push(...scanPointerTargets(coresText.get(rel)!, rel, root, index, new Set(), ignoredBasenames));
    }
    const notIgnored = allMissing.filter((h) => !h.path.startsWith(".quay/"));
    const ignored = gitignoredPaths(root, notIgnored.map((h) => h.path));
    missing = notIgnored.filter((h) => !ignored.has(h.path));
  }
  const ac4 = { ok: missing.length === 0, missing };

  // AC5 (manager core only — the B3 group is manager-specific)
  let missingMarkers: string[] = [];
  let b3Found = true;
  if (!only || only === "ac5") {
    const managerText = coresText.get("orchestration/manager-tick-core.md")!;
    const b3 = findB3Section(managerText);
    if (!b3) { b3Found = false; missingMarkers = B3_MARKERS.slice(); }
    else {
      const section = managerText.split("\n").slice(b3.start, b3.end).join("\n");
      missingMarkers = missingB3Markers(section);
    }
  }
  const ac5 = { ok: b3Found && missingMarkers.length === 0, missingMarkers, b3Found };

  // AC6 (prohibition docs vs cores' run_in_background)
  let precondition = false;
  let violations: ProhibitionViolation[] = [];
  if (!only || only === "ac6") {
    for (const rel of CORES) {
      if (coresText.get(rel)!.includes("run_in_background")) { precondition = true; break; }
    }
    if (precondition) {
      for (const rel of PROHIBITION_DOCS) {
        violations.push(...scanProhibition(readText(root, rel), rel));
      }
    }
  }
  const ac6 = { ok: violations.length === 0, precondition, violations };

  return { ok: ac3.ok && ac4.ok && ac5.ok && ac6.ok, coverage, ac3, ac4, ac5, ac6 };
}

// ── Drift check (gap-tick-core-drift-check-not-in-suite) ─────────────────────────────────────────────
// The three execution cores each ship in TWO copies: orchestration/<name>-tick-core.md (what the
// three layers ACTUALLY read every tick) and plugin/loop/<name>-tick-core.md (the shipped/laid-down
// copy that quay-init --loop delivers to installed targets — see quay-init.sh's exec-core tick-doc
// landing). The quay-init `--check-drift` report already LISTED these as drift but had NO suite
// consumer (the fifth "instrument exists, consumer doesn't" instance). A12 was actually misled:
// the same item was :31 in orchestration/ and :45 in plugin/loop/, costing a full round of message
// alignment. This mode makes the pair-drift a HARD gate: exit 1 when ANY pair differs, printing
// BOTH sides' line counts + a diff summary (AC2 — not a "drift/consistent" boolean).
export const DRIFT_PAIRS = CORES.map((rel) => {
  const base = rel.split("/").pop()!; // e.g. "manager-tick-core.md"
  return { core: rel, shipped: `plugin/loop/${base}` };
});

export interface DriftPair {
  core: string;          // orchestration/<name>-tick-core.md
  shipped: string;       // plugin/loop/<name>-tick-core.md
  consistent: boolean;
  coreLines: number;     // -1 when the file is missing
  shippedLines: number;  // -1 when the file is missing
  diffStat: string;      // unified-diff summary: hunks + +N/-M + hunk headers (empty when consistent)
}

export interface DriftResult {
  ok: boolean;
  pairs: DriftPair[];
}

/** Line count of a file, or -1 when it does not exist. */
function lineCountOrMinusOne(abs: string): number {
  if (!fs.existsSync(abs)) return -1;
  return fs.readFileSync(abs, "utf8").split("\n").length;
}

/** Summarize a 0-context unified diff: the +N/-M change counts + the hunk location headers. */
function summarizeDiff(u: string): string {
  if (!u) return "";
  const lines = u.split("\n");
  const hunks = lines.filter((l) => l.startsWith("@@"));
  const added = lines.filter((l) => /^\+[^+]/.test(l)).length;
  const removed = lines.filter((l) => /^-[^-]/.test(l)).length;
  const head = `unified diff: ${hunks.length} hunk${hunks.length === 1 ? "" : "s"}, +${added}/-${removed} lines`;
  const hunkHead = hunks.slice(0, 5).join(" ; ");
  return hunkHead ? `${head}\n    ${hunkHead}` : head;
}

/** A diff SUMMARY between two files (AC2 — a magnitude/character readout, not a boolean). GNU
 *  `diff --stat` is missing on some builds, so compute the summary from a 0-context unified diff:
 *  hunk count + added/removed line counts + hunk location headers. diff exits 1 on difference, so
 *  the stdout is read off the thrown error (the standard execFileSync pattern for a
 *  non-zero-expected tool); on any failure a fallback "files differ" is returned so the drift gate
 *  never hangs on diff. */
function diffStat(a: string, b: string): string {
  try {
    return summarizeDiff(execFileSync("diff", ["-U0", a, b], { encoding: "utf8", timeout: 5_000 }).trim());
  } catch (err) {
    const stdout = (err as { stdout?: string | Buffer }).stdout;
    if (typeof stdout === "string" && stdout.trim()) return summarizeDiff(stdout.trim());
    return "files differ";
  }
}

export function runDriftCheck(root: string): DriftResult {
  const pairs = DRIFT_PAIRS.map(({ core, shipped }) => {
    const coreAbs = path.join(root, core);
    const shippedAbs = path.join(root, shipped);
    const coreLines = lineCountOrMinusOne(coreAbs);
    const shippedLines = lineCountOrMinusOne(shippedAbs);
    const bothExist = coreLines >= 0 && shippedLines >= 0;
    const consistent = bothExist
      && fs.readFileSync(coreAbs, "utf8") === fs.readFileSync(shippedAbs, "utf8");
    return {
      core, shipped, consistent, coreLines, shippedLines,
      diffStat: consistent ? "" : diffStat(coreAbs, shippedAbs),
    };
  });
  return { ok: pairs.every((p) => p.consistent), pairs };
}

function printDriftReport(res: DriftResult): string[] {
  const out: string[] = [];
  for (const p of res.pairs) {
    if (p.consistent) {
      out.push(`  ok: ${p.core} (${p.coreLines} lines) == ${p.shipped} (${p.shippedLines} lines)`);
      continue;
    }
    const coreLines = p.coreLines >= 0 ? `${p.coreLines}` : "MISSING";
    const shippedLines = p.shippedLines >= 0 ? `${p.shippedLines}` : "MISSING";
    out.push(`  DRIFT: ${p.core} (${coreLines} lines) vs ${p.shipped} (${shippedLines} lines)`);
    if (p.diffStat) for (const l of p.diffStat.split("\n")) out.push(`    ${l}`);
  }
  return out;
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────────
interface CliResult { code: number; json: unknown; }

function usage(): CliResult {
  process.stderr.write(
    "usage: tick-core-static-check.ts [--root <dir>] [--only <ac3|ac4|ac5|ac6>] [--check-drift] [--json]\n",
  );
  return { code: 2, json: { error: "usage" } };
}

export function main(argv: string[]): CliResult {
  let root = process.cwd();
  let only: string | undefined;
  let json = false;
  let checkDrift = false;
  let noBlock = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") {
      root = argv[++i];
      if (root === undefined) return usage();
    } else if (a === "--only") {
      only = argv[++i];
      if (only === undefined || !/^ac[3456]$/.test(only)) return usage();
    } else if (a === "--json") {
      json = true;
    } else if (a === "--check-drift") {
      checkDrift = true;
    } else if (a === "--no-block") {
      // Report-only drift check: print the full RED/consistent readout but exit 0. Used by the
      // pre-commit doc surface (run_doc_checks) so the CURRENT pre-existing drift is VISIBLE at
      // every commit without halting unrelated commits until a follow-up reconciles the pairs.
      noBlock = true;
    } else if (a === "--check") {
      // Explicit alias for the default full-surface check (the ## Contract `invoke` form).
    } else if (a === "--help" || a === "-h") {
      process.stdout.write(
        "tick-core-static-check.ts — are the three execution cores ≤80 lines, with every pointer target existing, the B3 group numbering distinct from the criteria numbering, the prohibition docs consistent with the cores' run_in_background, and (--check-drift) each orchestration/*-tick-core.md byte-identical to its plugin/loop/ shipped copy?\n",
      );
      return { code: 0, json: { help: true } };
    } else {
      return usage();
    }
  }

  if (checkDrift) {
    let driftRes: DriftResult;
    try {
      driftRes = runDriftCheck(root);
    } catch (err) {
      process.stderr.write(`${(err as Error).message}\n`);
      return { code: 1, json: { error: (err as Error).message } };
    }
    if (json) {
      process.stdout.write(`${JSON.stringify(driftRes, null, 2)}\n`);
      return { code: driftRes.ok || noBlock ? 0 : 1, json: driftRes };
    }
    process.stdout.write(
      `tick-core-static-check: drift check — ${DRIFT_PAIRS.length} pairs, ` +
      `${driftRes.pairs.filter((p) => p.consistent).length} consistent / ${driftRes.pairs.filter((p) => !p.consistent).length} drifted\n`,
    );
    for (const l of printDriftReport(driftRes)) process.stdout.write(`${l}\n`);
    if (!driftRes.ok) process.stdout.write(`tick-core-static-check: RED — execution-core drift gate violated (orchestration/*-tick-core.md vs plugin/loop/*-tick-core.md).\n`);
    else process.stdout.write(`tick-core-static-check: PASS — every execution core matches its shipped copy.\n`);
    if (!driftRes.ok && noBlock) process.stdout.write(`tick-core-static-check: --no-block — drift REPORTED, not blocking (gap-tick-core-drift-check-not-in-suite; reconcile the pairs to green).\n`);
    return { code: driftRes.ok || noBlock ? 0 : 1, json: driftRes };
  }

  let res: CheckResult;
  try {
    res = runChecks(root, only);
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`);
    return { code: 1, json: { error: (err as Error).message } };
  }

  if (json) {
    process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
    return { code: res.ok ? 0 : 1, json: res };
  }

  const line = CORES.map((r) => r.split("/").pop()).map((b, i) => `${b}=${res.coverage[CORES[i]].covered}/${res.coverage[CORES[i]].total}`).join(" / ");
  process.stdout.write(`tick-core-static-check: AC3 src:N coverage ${line} (target 100%)\n`);
  if (res.ac3.uncovered.length > 0) {
    for (const o of res.ac3.uncovered) {
      process.stdout.write(`  FAIL: ${o.file} src:N coverage ${o.covered}/${o.total} — items without (src:N):\n`);
      for (const m of o.missing) process.stdout.write(`    ${m}\n`);
    }
  }
  for (const v of res.ac3.anchorViolations) {
    const anchor = v.anchor ? ` anchor="${v.anchor}"` : "";
    const actual = v.actualLines ? ` actualLines=${v.actualLines.join(",")}` : "";
    process.stdout.write(`  FAIL: ${v.file}:${v.line} ${v.item} (src:${v.srcN})${anchor} — ${v.kind}${actual}\n`);
  }
  if (res.ac3.anchorSkipped.length > 0) {
    for (const s of res.ac3.anchorSkipped) process.stdout.write(`  skip: ${s} (archive missing — anchor verification off)\n`);
  }
  process.stdout.write(
    `tick-core-static-check: AC4 pointer targets ${res.ac4.missing.length === 0 ? "OK" : `FAIL (${res.ac4.missing.length} missing)`}\n`,
  );
  for (const m of res.ac4.missing) process.stdout.write(`  FAIL: ${m.path} (${m.kind}) at line ${m.line}\n`);
  process.stdout.write(
    `tick-core-static-check: AC5 B3 numbering ${res.ac5.ok ? "OK" : `FAIL (missing ${res.ac5.missingMarkers.join("") || "(no B3 section)"})`}\n`,
  );
  process.stdout.write(
    `tick-core-static-check: AC6 prohibition ${res.ac6.ok ? "consistent" : `FAIL (${res.ac6.violations.length} unconditional)`}\n`,
  );
  for (const v of res.ac6.violations) process.stdout.write(`  FAIL: ${v.file}:${v.line} — ${v.phrase}\n    ${v.snippet}\n`);
  if (!res.ok) process.stdout.write(`tick-core-static-check: RED — execution-core static gate violated.\n`);
  else process.stdout.write(`tick-core-static-check: PASS — execution cores are statically covered.\n`);
  return { code: res.ok ? 0 : 1, json: res };
}

if (isDirectEntry(import.meta)) {
  const r = main(process.argv.slice(2));
  process.exitCode = r.code;
}
