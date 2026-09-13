#!/usr/bin/env node
// threshold-scope-check.ts — driver-doc prose hygiene checker
// (tasks/gap-quantified-stop-conditions-have-no-scope). TWO detectors, ONE scan surface:
//
//   SCAN SURFACE (the three normative driver docs — the set is a Contract invariant, see below):
//     plugin/loop/fast-mode-loop-tick.md
//     plugin/loop/orchestrator-loop-tick.md
//     CLAUDE.md
//   `tasks/` is deliberately NOT scanned — task-body thresholds are task-contract-check.ts's
//   jurisdiction (same two-judgment family, different objects).
//
//   1. QUANTIFIED-STOP-CONDITION SCOPE — a stop/trigger condition carrying a count threshold
//      (≥ N / >= N / 超过 N / N 次以上) must name BOTH its SET and its WINDOW. The defect class is
//      the 2026-08-03 dispatch freeze: `needs-human 积压 ≥ 3` was read as "ever, total" instead of
//      "newly added within the window" — ≥3 has no ambiguity, "≥3 个什么、在什么窗口内" is where the
//      ambiguity lives. For a COUNT-threshold line the set is the subject noun (almost always
//      present); the WINDOW is the discriminative missing half. A line is reported when it carries a
//      count threshold with NO window word AND the line is a stop/trigger condition (trigger verb)
//      or counts discrete items (backlog/count noun).
//
//      DELIBERATELY NOT REPORTED (the false-alarm class this repo has recorded 7 times):
//        - bare duration mentions (`间隔应长（20–30 分钟）`, `任务超 90 分钟`) — a duration is
//          inherently scoped (one thing's elapsed time), not a "how many, over which window"
//          ambiguity. Only a ≥/超过/次以上 COUNT threshold is a candidate.
//        - a line with a window word (`窗口内新增`, `本轮`, `近期`, `每 tick`, `连续`…) — the
//          window IS named.
//        - paragraphs marked `<!-- unmechanized: -->` / `<!-- unmechanizable: -->` — an explicit
//          declared-scope marker (the outer's 2026-08-03 edit); the marker's whole paragraph AND
//          (when the marker sits on its own line) its two neighbours are skipped, and the skip is
//          COUNTED in `skippedByMarker` so a silent skip is distinguishable from "no findings".
//        - fenced code blocks and HTML-comment content (matching is by line CONTENT, AC4).
//
//   2. STALE PATH — a backtick-named path must resolve, judged in THREE layers (the task's table).
//      Candidates are SLASH-BEARING repo-relative paths AND bare basenames with a real filename
//      shape (`quay-native.js`, `it0-dod-check.mjs`, `lifecycle.ts` — three of the task's stale
//      examples were bare names):
//        exact path exists                        → pass
//        basename exists anywhere in the repo      → local reference, pass (legal shorthand style)
//        basename missing, same name diff ext      → STALE (extension changed: .js → .ts migration)
//        neither, and no placeholder               → STALE
//        placeholder (`NNN`, `<...>`, `*`, `{`)    → skipped (e.g. `tasks/DIR-NNN.md`)
//      EXEMPT from a STALE verdict (the path is genuinely gone BUT it is not a stale SOURCE path):
//        - the line (or a ±1 neighbour for strong markers) carries a retired/deleted/renamed/
//          runtime-state/never-existing annotation — a reader following it is NOT misled, the text
//          itself says it is gone;
//        - the missing path is gitignored (`git check-ignore`), under `.quay/` (runtime-state dir),
//          or a basename named in `.gitignore` (`tick-log.md` → orchestration/tick-log.md) — runtime
//          state, expected absent in a fresh checkout.
//
// REPORT-ONLY (AC7) by default: this module never edits the scanned docs and exits 0 even when
// violations exist — the gate must not block. The ONE exception is the RATCHET on its own data file
// (docs/analysis/threshold-scope-violations.md, AC6): that list can only get SHORTER, so a NEW
// violation not already listed (or a list that would exceed the baseline-count ceiling) exits 1.
//
// MODES:
//   default        — scan the three SCAN_SURFACE docs under --root; exit 0 iff no ratchet growth.
//   --judge <path> — judge ONE arbitrary doc (absolute or --root-relative); exit 1 iff it carries
//                    any threshold or stale-path violation (the AC2/AC3/AC10/AC11 controls + tests).
//   --json         — machine-readable output; the ## Contract measures read the `violations`
//                    (threshold) and `stalePaths` array lengths and the `skippedByMarker` count.
//   --write-ratchet [--reset-baseline] — persist the (shrunken) violation list to the data file.
//
// CONTRACT INVARIANT ("被扫描的文档集合在改前后一致"): the scan set is a FIXED three-doc list; a
// missing scan doc is an ERROR (exit 1) so a rename/delete of a scan target fails loudly instead of
// silently shrinking the surface.
//
// Exit codes: 0 = PASS; 1 = FAIL (ratchet growth in default mode / violation in --judge mode /
//              a scan target missing); 2 = usage/env error.
//
// Run:
//   node --experimental-strip-types plugin/scripts/threshold-scope-check.ts [--root <dir>]
//       [--judge <path>] [--json] [--write-ratchet] [--reset-baseline]
//   scripts/test.sh plugin/test/threshold-scope-check.test.mjs

import fs from "node:fs";
import { repoRoot } from "./repo-root.ts";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { helpExit, isDirectEntry } from "./gate-script-base.ts";

export const DATA_FILE_REL = "docs/analysis/threshold-scope-violations.md";

/** The fixed scan surface (a Contract invariant — the doc set must stay byte-identical across runs). */
export const SCAN_DOCS = [
  "plugin/loop/fast-mode-loop-tick.md",
  "plugin/loop/orchestrator-loop-tick.md",
  "CLAUDE.md",
] as const;

// ── 1. Quantified-stop-condition scope detector ──────────────────────────────────────────────────────
// A CANDIDATE is a line carrying a COUNT threshold. `N 分钟` (a bare duration) is NOT a candidate —
// see the header for why. Duration/measure thresholds (`≥ 3 分钟`, `超过 90`) are excluded by
// DURATION_AFTER_RE: the number is measuring elapsed time, not counting items over a window.
export const QUANT_RE = /(?:≥|>=|超过)\s*\d+(?:\.\d+)?|\d+\s*次以上/;

/** A count-threshold whose number measures a DURATION/continuous quantity is not the ambiguity class.
 *  (Checked immediately after the matched number — "≥ 3 分钟", "超过 90 分钟" are scoped by nature.) */
export const DURATION_AFTER_RE = /(?:分钟|秒|毫秒|ms|微秒|us|%|倍|核|档|MB|GB|天|小时|秒级|量级)/;

/** A window word — naming it satisfies the "说明窗口" requirement (the positive control's shape). */
export const WINDOW_RE =
  /窗口|窗口内|内新增|新增|近期|最近|本轮|本次|本 tick|本tick|每 tick|每tick|每次|连续|累计|时间窗|每步|每轮|该批|该轮|过去|同一|当轮|当日|当天|一段时间|同日|上一天|最近一轮/;

/** A stop/trigger verb — the line is a stop condition (not a status fact / config note). */
export const TRIGGER_RE =
  /停止|停止派发|停派|不派发|停下|就停|该停|需要停|触发|判据|命中|分诊|不得|禁止|一律|只能|必须|不再|阻断|挡住|空转|起跑条件|停止条件|升级|中止|退回/;

/** A count-of-discrete-items noun — the line counts things (the "≥3 个什么" half of the ambiguity). */
export const COUNT_SUBJECT_RE =
  /积压|backlog|新增|总数|失败|收尾|closed|in_flight|需求|pool|refusal|拒绝|次数/;

/** The explicit declared-scope markers (outer's 2026-08-03 edit): a marked paragraph is not reported. */
export const MARKER_RE = /<!--\s*unmechanized:[\s\S]*?-->|<!--\s*unmechanizable:[\s\S]*?-->/;

// ── 2. Stale-path detector ───────────────────────────────────────────────────────────────────────────
/** Repo top-level dirs — a whitespace token is path-like if it starts with one of these OR has an ext. */
const TOP_LEVELS = [
  "packages", "plugin", "scripts", "docs", "tasks", "orchestration", "experiments",
  "adr", "dist", ".github", ".quay", ".claude", "milestones", "src", "test",
];
const PATH_EXT_RE = /\.(ts|js|mjs|md|sh|json|yml|yaml|txt|env|tsx|jsx|css|html|png|py|lock|snapshot|jsonl)$/;

/** Placeholder patterns (AC10) — a path carrying one is a PATTERN, not a literal path: skipped. */
export const PLACEHOLDER_RE = /NNN|<[^>]*>|\*|\{/;

/** An annotation on the SAME line as a stale-path reference that explains why the path is gone —
 *  a reader following it is not misled (the text itself says it is retired/deleted/renamed/runtime
 *  state). `原\s*`` / `旧\s*`` are the "formerly named X" rename shorthands the docs use
 *  ("原 `outer-liveness.sh`", "旧 `inner-state.sh`"). */
export const STALE_ANNOT_RE =
  /(retired|superseded|RETIRED|SUPERSEDED|historical|ADR-022|退役|退休|废除|已退休|已废除|已删除|旧路径|never-existing|错误|不正确|incorrect|不再|不存在|NOT read|不是|未读|已修正|固定|gitignored|运行时|runtime|历史|作废|不可用|已随|改名|泛化|原\s*`|旧\s*`)/;

/** STRONG annotations, applied across the ±1 line window. Prose routinely wraps the reference and
 *  its annotation across two lines ("…`inner-state.sh`\n已退役）"). A weak marker like "历史" or
 *  "不存在" describes CONTENT near the reference, not the reference's own status — only a marker that
 *  unambiguously says the MECHANISM/FILE is gone suppresses a neighbour-line reference (mirrors
 *  strategic-doc-staleness-check's STRONG_ANNOTATION_RE split). */
export const STALE_STRONG_ANNOT_RE =
  /(retired|superseded|RETIRED|SUPERSEDED|ADR-022|退役|退休|已退休|已废除|已删除|废除|不可用|已随|作废)/;


// ── File index (for the basename / same-stem-diff-ext layers) ────────────────────────────────────────
export interface FileIndex {
  byBasename: Map<string, string>; // basename -> first repo-relative path found
  byStem: Map<string, Set<string>>; // stem -> set of extensions seen
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
        // `tmp/` or `milestones/*/worktrees/` (e.g. a run-identity fixture copy of a retired script)
        // must not falsely resolve a genuinely stale reference in the scanned docs.
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

/** Extract path-like candidates from a backtick token.
 *  - A SLASH-BEARING token (or whitespace-token) is a candidate when it starts with a known
 *    repo top-level OR carries a file extension ("node … script.ts <cmd>" yields its path token;
 *    math expressions like "nproc / 1.0" and data shapes are not candidates).
 *  - A BARE basename (no `/`, e.g. `quay-native.js`, `lifecycle.ts`, `it0-dod-check.mjs`) is ALSO a
 *    candidate — the task's own stale examples include three bare names (`quay-native.js`,
 *    `it0-dod-check.mjs`, `lifecycle.js`) — but only when it looks like a REAL filename: chars before
 *    AND after the extension. A pure extension mention (`.mjs`), a shell word (`pgrep`, `--json`),
 *    or a numeric fragment (`0.5`) is not a path.
 *  Absolute / home paths (`/tmp/...`, `~/.claude/...`) are not repo-relative — skipped. */
export function pathCandidates(token: string): string[] {
  const out: string[] = [];
  for (const w of token.split(/\s+/)) {
    let w2 = w.replace(/^[`'"(]+/, "").replace(/[),;.]+$/, "");
    // A trailing `:NNN` is a LINE-NUMBER CITATION (`path.md:NNN`), not part of the path — the repo
    // cites `quay-init.sh:1011` / `inner-brief-2026-08-04-restart.md:103` / `select-preflight.ts:113`
    // everywhere. Strip it so the citation resolves to its base path (the file itself exists) instead
    // of being misread as a `stale-path-ext` (stem `x` ext `md` vs candExt `md:16` false positive,
    // round-312 CLAUDE.md:19). A genuinely-missing `path.md:NNN` still flags (base path missing).
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

// ── Paragraph grouping (for the marked-paragraph skip, AC3) ──────────────────────────────────────────
interface Para { start: number; end: number; }
function groupParagraphs(lines: string[]): Para[] {
  const paras: Para[] = [];
  let cur: Para | null = null;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== "") {
      if (!cur) cur = { start: i, end: i };
      cur.end = i;
    } else if (cur) {
      paras.push(cur);
      cur = null;
    }
  }
  if (cur) paras.push(cur);
  return paras;
}

/** Which paragraph indices are marked (AC3): a paragraph whose text contains a marker, PLUS — when
 *  the marker sits on its own line (isolated paragraph between two text blocks) — its two neighbours,
 *  because a lone marker line is ambiguous about which block it marks ("覆盖上方…表" / "下方规则"). */
export function markParagraphs(lines: string[], paras: Para[]): { marked: Set<number>; markerCount: number } {
  const marked = new Set<number>();
  let markerCount = 0;
  for (let pi = 0; pi < paras.length; pi++) {
    const p = paras[pi];
    const ptext = lines.slice(p.start, p.end + 1).join("\n");
    if (MARKER_RE.test(ptext)) {
      marked.add(pi);
      markerCount++;
      if (p.end === p.start) {
        if (pi > 0) marked.add(pi - 1);
        if (pi + 1 < paras.length) marked.add(pi + 1);
      }
    }
  }
  return { marked, markerCount };
}

// ── gitignore batch check (runtime-state exemption for missing paths) ────────────────────────────────
/** Which of `missingPaths` are gitignored under `root`. A missing gitignored path is runtime state
 *  (expected absent in a fresh checkout), not a stale reference. Fail-open: a non-git/non-repo
 *  fixture returns an empty set (nothing is exempt via git — the .quay/ prefix rule still applies). */
export function gitignoredPaths(root: string, missingPaths: string[]): Set<string> {
  if (missingPaths.length === 0) return new Set();
  const res = spawnSync("git", ["check-ignore", "--stdin"], {
    cwd: root, input: missingPaths.join("\n"), encoding: "utf8",
  });
  if (res.status !== 0 || !res.stdout) return new Set();
  return new Set(res.stdout.split("\n").map((s) => s.trim()).filter(Boolean));
}

/** Basenames mentioned in the repo's `.gitignore` — a bare reference to one of these is a known
 *  runtime/ignored artifact (`tick-log.md`, `gate-events.jsonl`, `full-suite-state.json`), not a
 *  stale SOURCE path. `git check-ignore` cannot match a bare basename against a prefixed pattern
 *  (`orchestration/tick-log.md`), so this is the bare-name companion to gitignoredPaths. */
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

// ── The per-doc scan ─────────────────────────────────────────────────────────────────────────────────
export interface ThresholdHit {
  line: number;
  hit: string;
  snippet: string;
}
export interface StaleHit {
  line: number;
  path: string;
  kind: "stale-path" | "stale-path-ext";
  snippet: string;
}
export interface DocResult {
  rel: string;
  violations: ThresholdHit[];
  stalePaths: StaleHit[];
  skippedByMarker: number;
}

/**
 * Scan one document's text for threshold-scope and stale-path violations.
 * @param ignored = the set of gitignored missing paths (batch-computed once for all docs).
 * @param ignoredBasenames = basenames named in .gitignore (bare-name runtime-artifact exemption).
 */
export function scanDoc(text: string, rel: string, root: string, index: FileIndex, ignored: Set<string>, ignoredBasenames: Set<string> = new Set()): DocResult {
  const lines = text.split("\n");
  const paras = groupParagraphs(lines);
  const { marked, markerCount } = markParagraphs(lines, paras);

  // Fenced code blocks (```): EVIDENCE, not live prose — skipped (AC4).
  const fenced = new Set<number>();
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*```/.test(lines[i])) { inFence = !inFence; continue; }
    if (inFence) fenced.add(i);
  }

  const violations: ThresholdHit[] = [];
  const stalePaths: StaleHit[] = [];
  lines.forEach((raw, i) => {
    if (fenced.has(i)) return;
    const paraIdx = paras.findIndex((p) => p.start <= i && i <= p.end);
    if (paraIdx !== -1 && marked.has(paraIdx)) return;

    // Threshold check: match by LINE CONTENT with HTML-comment content stripped (AC4).
    const clean = raw.replace(/<!--[\s\S]*?-->/g, " ");
    const qm = clean.match(QUANT_RE);
    if (qm) {
      if (!WINDOW_RE.test(clean)) {
        // Exclude a threshold whose number measures a duration/continuous quantity.
        const after = clean.slice(qm.index! + qm[0].length, qm.index! + qm[0].length + 8);
        if (!DURATION_AFTER_RE.test(after)
          && (TRIGGER_RE.test(clean) || COUNT_SUBJECT_RE.test(clean))) {
          violations.push({
            line: i + 1,
            hit: qm[0],
            snippet: raw.trim().replace(/\s+/g, " ").slice(0, 70),
          });
        }
      }
    }

    // Stale-path check: every backtick-named path candidate in the RAW line (markers live in backticks).
    for (const bm of raw.matchAll(/`([^`\n]+)`/g)) {
      for (const cand of pathCandidates(bm[1])) {
        if (PLACEHOLDER_RE.test(cand)) continue;
        const exact = fs.existsSync(path.join(root, cand));
        const base = cand.split("/").pop() || cand;
        const dot = base.lastIndexOf(".");
        const stem = dot > 0 ? base.slice(0, dot) : base;
        const candExt = dot > 0 ? base.slice(dot + 1) : "";
        const sameStemDiffExt = dot > 0
          && index.byStem.has(stem)
          && [...(index.byStem.get(stem) as Set<string>)].some((e) => e !== candExt);
        if (exact) continue;
        if (index.byBasename.has(base)) continue; // local reference — legal shorthand
        // Annotated as gone — the text says so. Own line: all markers; neighbour lines (wrapped
        // prose "…`inner-state.sh`\n已退役）"): STRONG markers only.
        let annotated = STALE_ANNOT_RE.test(raw);
        if (!annotated) {
          for (let j = Math.max(0, i - 1); j <= Math.min(lines.length - 1, i + 1); j++) {
            if (j === i) continue;
            if (STALE_STRONG_ANNOT_RE.test(lines[j])) { annotated = true; break; }
          }
        }
        if (annotated) continue;
        // runtime state (expected absent in a fresh checkout): gitignored path, a .quay/ runtime
        // file, or a basename named in .gitignore (e.g. `tick-log.md` → orchestration/tick-log.md).
        // UNCONDITIONAL — NOT gated on !sameStemDiffExt: a `.quay/config.yml` that collides with a
        // same-stem-diff-ext `config.ts` in the code is STILL a runtime file whose absence in a fresh
        // checkout (worktree/CI) is expected — the diff-ext heuristic exists to catch SOURCE path
        // migrations (lifecycle.js → lifecycle.ts), never to re-flag runtime state. Round-217 was
        // green on the primary checkout (which has .quay/config.yml on disk); a fresh worktree
        // false-positived stale-path-ext. gap-threshold-scope-worktree-config-yml-false-positive.
        if (ignored.has(cand) || cand.startsWith(".quay/") || ignoredBasenames.has(base)) continue;
        stalePaths.push({
          line: i + 1,
          path: cand,
          kind: sameStemDiffExt ? "stale-path-ext" : "stale-path",
          snippet: raw.trim().replace(/\s+/g, " ").slice(0, 70),
        });
      }
    }
  });

  return { rel, violations, stalePaths, skippedByMarker: markerCount };
}

// ── Ratchet keys (AC6: shrink-only, keyed so a NEW violation is detectable) ──────────────────────────
export function thresholdKey(rel: string, v: ThresholdHit): string {
  return `${rel}: unscoped-threshold: ${v.snippet}`;
}
export function staleKey(rel: string, v: StaleHit): string {
  return `${rel}: ${v.kind}: ${v.path}`;
}
export function collectKeys(results: DocResult[]): string[] {
  const keys: string[] = [];
  for (const r of results) {
    for (const v of r.violations) keys.push(thresholdKey(r.rel, v));
    for (const s of r.stalePaths) keys.push(staleKey(r.rel, s));
  }
  return [...new Set(keys)].sort();
}

// ── Data-file ratchet (same model as contract-violations.md) ────────────────────────────────────────
export function readRatchet(root: string): { baseline: Set<string>; baselineCount: number | null } {
  const p = path.join(root, DATA_FILE_REL);
  if (!fs.existsSync(p)) return { baseline: new Set(), baselineCount: null };
  const text = fs.readFileSync(p, "utf8");
  const countMatch = text.match(/^# baseline-count:\s*(\d+)/m);
  const baseline = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    baseline.add(t);
  }
  return { baseline, baselineCount: countMatch ? Number(countMatch[1]) : null };
}

export function writeRatchet(root: string, currentKeys: string[], { reset = false } = {}): { ok: boolean; reason: string } {
  const p = path.join(root, DATA_FILE_REL);
  const { baseline, baselineCount } = readRatchet(root);
  const ceiling = reset ? currentKeys.length : (baselineCount ?? currentKeys.length);
  if (!reset && currentKeys.length > ceiling) {
    return { ok: false, reason: `current violations (${currentKeys.length}) exceed the ratchet ceiling (${ceiling}) — the list can only get SHORTER; fix the scanned docs, do not add violations` };
  }
  if (!reset && baseline.size > 0) {
    const newOnes = currentKeys.filter((k) => !baseline.has(k));
    if (newOnes.length > 0) {
      return { ok: false, reason: `refusing to write: ${newOnes.length} NEW violation(s) not in the baseline — the list can only get SHORTER: ${newOnes.slice(0, 5).join(", ")}${newOnes.length > 5 ? "…" : ""}` };
    }
  }
  const lines = [
    "# threshold-scope-violations.md — shrink-only ratchet list for the quantified stop-condition scope",
    "# and stale-path checks (tasks/gap-quantified-stop-conditions-have-no-scope). A violation here means",
    "# a scanned driver doc (plugin/loop/fast-mode-loop-tick.md / plugin/loop/orchestrator-loop-tick.md",
    "# / CLAUDE.md) carries a count-threshold stop/trigger condition without naming its window, or a",
    "# backtick-named path that cannot be resolved (three-layer judgment, placeholder-skipped).",
    "#",
    "# RATCHET: the list can ONLY get SHORTER. threshold-scope-check.ts exits 1 if a NEW violation",
    "# appears that is not already listed, or if the list would exceed the baseline-count ceiling.",
    "# Remove an entry only after the underlying doc is fixed (then run --write-ratchet to persist the",
    "# shrunken list). `--write-ratchet --reset-baseline` is the deliberate one-shot re-baseline after a",
    "# criterion fix; it re-anchors the ceiling to the current violation set.",
    "#",
    "# Format: one `<rel-file>: <code>: <detail>` per line (repo-root-relative, sorted).",
    "# baseline-count: " + ceiling,
    "",
    ...currentKeys,
    "",
  ];
  fs.writeFileSync(p, lines.join("\n"));
  return { ok: true, reason: reset
    ? `ratchet baseline RESET to ${currentKeys.length} entry/entries (ceiling re-anchored to ${ceiling})`
    : `ratchet list written (${currentKeys.length} entry/entries; ceiling ${ceiling})` };
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────────
export function runCli(argv: string[]): number {
  const args = argv.slice();
  if (args.includes("--help") || args.includes("-h")) helpExit("usage: node threshold-scope-check.ts [--root <dir>] [--json] [--judge <j>] [--write-ratchet] [--reset-baseline]");
  let root: string | null = null;
  let json = false;
  let judge: string | null = null;
  let writeRatchetFlag = false;
  let resetBaseline = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--root") root = args[++i];
    else if (a === "--json") json = true;
    else if (a === "--judge") judge = args[++i];
    else if (a === "--write-ratchet") writeRatchetFlag = true;
    else if (a === "--reset-baseline") resetBaseline = true;
    else if (a.startsWith("-")) { console.error(`threshold-scope-check: unknown flag: ${a}`); return 2; }
    else { console.error(`threshold-scope-check: unexpected positional: ${a}`); return 2; }
  }
  if (resetBaseline && !writeRatchetFlag) {
    console.error("threshold-scope-check: --reset-baseline requires --write-ratchet (it is the write that re-anchors the ceiling)");
    return 2;
  }
  const wsRoot = root ? path.resolve(root) : repoRoot();
  if (!fs.existsSync(wsRoot)) {
    console.error(`threshold-scope-check: scan root not found: ${wsRoot}`);
    return 2;
  }

  // ── --judge mode (AC2/AC3/AC10/AC11 controls + tests): ONE arbitrary doc, no ratchet ─────────────
  if (judge !== null) {
    const abs = path.isAbsolute(judge) ? judge : path.join(wsRoot, judge);
    if (!fs.existsSync(abs)) {
      console.error(`threshold-scope-check: --judge file not found: ${judge}`);
      return 2;
    }
    const rel = path.isAbsolute(judge) ? path.basename(abs) : judge.split(path.sep).join("/");
    const text = fs.readFileSync(abs, "utf8");
    const index = buildFileIndex(wsRoot);
    const res = scanDoc(text, rel, wsRoot, index, new Set(), readGitignoreBasenames(wsRoot));
    const flagged = res.violations.length > 0 || res.stalePaths.length > 0;
    if (json) {
      console.log(JSON.stringify({
        mode: "judge",
        file: rel,
        violations: res.violations.map((v) => ({ ...v, key: thresholdKey(rel, v) })),
        stalePaths: res.stalePaths.map((s) => ({ ...s, key: staleKey(rel, s) })),
        skippedByMarker: res.skippedByMarker,
        flagged,
      }, null, 2));
    } else if (flagged) {
      console.log(`threshold-scope-check --judge ${rel}: ${res.violations.length} threshold + ${res.stalePaths.length} stale-path violation(s)`);
      for (const v of res.violations) console.log(`  ${rel}:${v.line}  [${v.hit}]  ${v.snippet}`);
      for (const s of res.stalePaths) console.log(`  ${rel}:${s.line}  [${s.kind}] ${s.path}  ${s.snippet}`);
      console.log(`skippedByMarker: ${res.skippedByMarker}`);
      console.log("FAIL: the judged doc carries a quantified stop-condition without a window, or an unresolvable path");
    } else {
      console.log(`threshold-scope-check --judge ${rel}: clean (skippedByMarker ${res.skippedByMarker})`);
    }
    return flagged ? 1 : 0;
  }

  // ── default doc gate (wired into run_static_checks; the Contract's invoke) ───────────────────────
  const missing = SCAN_DOCS.filter((rel) => !fs.existsSync(path.join(wsRoot, rel)));
  if (missing.length > 0) {
    console.error(`threshold-scope-check: SCAN-SET INVARIANT BROKEN — the scanned doc set must stay identical across runs, but these scan targets are missing: ${missing.join(", ")}`);
    return 1;
  }
  const index = buildFileIndex(wsRoot);
  const results: DocResult[] = [];
  // Collect missing path candidates across ALL docs first so `git check-ignore` is ONE batch.
  const missingCandidates = new Set<string>();
  for (const rel of SCAN_DOCS) {
    const text = fs.readFileSync(path.join(wsRoot, rel), "utf8");
    for (const bm of text.matchAll(/`([^`\n]+)`/g)) {
      for (const cand of pathCandidates(bm[1])) {
        if (PLACEHOLDER_RE.test(cand)) continue;
        if (!fs.existsSync(path.join(wsRoot, cand))) missingCandidates.add(cand);
      }
    }
  }
  const ignored = gitignoredPaths(wsRoot, [...missingCandidates]);
  const ignoredBasenames = readGitignoreBasenames(wsRoot);
  for (const rel of SCAN_DOCS) {
    const text = fs.readFileSync(path.join(wsRoot, rel), "utf8");
    results.push(scanDoc(text, rel, wsRoot, index, ignored, ignoredBasenames));
  }
  const currentKeys = collectKeys(results);
  const skippedByMarker = results.reduce((n, r) => n + r.skippedByMarker, 0);
  const { baseline, baselineCount } = readRatchet(wsRoot);
  const firstBaseline = baselineCount === null;
  const newOnes = currentKeys.filter((k) => !baseline.has(k));
  const resolved = baseline.size > 0 ? [...baseline].filter((k) => !currentKeys.includes(k)).sort() : [];
  const growth = !firstBaseline && newOnes.length > 0 && !resetBaseline;

  let writeOutcome: { ok: boolean; reason: string } | null = null;
  if (writeRatchetFlag && !growth) {
    writeOutcome = writeRatchet(wsRoot, currentKeys, { reset: resetBaseline });
    if (!writeOutcome.ok) {
      console.log(JSON.stringify({ mode: "threshold-scope-docs", scanned: results.map((r) => r.rel), violations: [], stalePaths: [], skippedByMarker, ratchet: { baselineCount, currentCount: currentKeys.length, newViolations: newOnes, resolved, growth: true }, writeOutcome }, null, 2));
      return 1;
    }
  }

  const allViolations = results.flatMap((r) => r.violations.map((v) => ({ file: r.rel, line: v.line, hit: v.hit, snippet: v.snippet })));
  const allStale = results.flatMap((r) => r.stalePaths.map((s) => ({ file: r.rel, line: s.line, path: s.path, kind: s.kind })));

  if (json) {
    console.log(JSON.stringify({
      mode: "threshold-scope-docs",
      scanned: results.map((r) => r.rel),
      violations: allViolations,
      stalePaths: allStale,
      skippedByMarker,
      ratchet: {
        baselineCount,
        currentCount: currentKeys.length,
        newViolations: newOnes,
        resolved,
        growth,
      },
      writeOutcome,
    }, null, 2));
  } else {
    console.log(`threshold-scope-check — ${results.length} driver doc(s) scanned (fast-mode-loop-tick / orchestrator-loop-tick / CLAUDE.md)`);
    console.log(`violations (count-threshold stop-condition without a window): ${allViolations.length}`);
    for (const v of allViolations) console.log(`  ${v.file}:${v.line}  [${v.hit}]  ${v.snippet}`);
    console.log(`stalePaths: ${allStale.length}`);
    for (const s of allStale) console.log(`  ${s.file}:${s.line}  [${s.kind}] ${s.path}`);
    console.log(`skippedByMarker: ${skippedByMarker}${skippedByMarker ? " (marked paragraphs skipped — the skip is VISIBLE, not silent)" : ""}`);
    if (baselineCount !== null) {
      console.log(`ratchet ceiling: ${baselineCount}; new since baseline: ${newOnes.length}${newOnes.length ? ` (${newOnes.join(", ")})` : ""}; resolved: ${resolved.length}${resolved.length ? ` (${resolved.join(", ")})` : ""}`);
    }
    if (writeOutcome) console.log(`write: ${writeOutcome.reason}`);
  }
  return growth ? 1 : 0;
}

if (isDirectEntry(import.meta, undefined, "threshold-scope-check")) {
  process.exit(runCli(process.argv.slice(2)));
}
