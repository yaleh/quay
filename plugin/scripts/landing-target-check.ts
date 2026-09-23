#!/usr/bin/env node
// landing-target-check.ts — 任务落地目标分支必须 == 当前前锋分支
// (tasks/gap-landing-target-branch-consistency-check)
//
// THE DEFECT THIS CLOSES (机制家族第 4 次): 「落地路径」字段与当前分支模型的一致性没有检查。
// 新建任务 gap-a1-freeze-unlanded-content-preserve 时把落地目标写成「合入 integration」, 而当前
// 分支模型是 develop 为前锋分支 (develop..integration=0 不变式) — 往 integration 合会把
// develop..integration 从 0 变非 0、重开两线, 而没有任何检查会报出来。修的是「落地路径」这个字段
// 与当前分支模型的一致性, 不是某一条任务。
//
// WHAT IT DETECTS (by POSITION, never by bare keyword — CLAUDE.md 硬规则 2): a 落地目标表述 is a
// statement of the form [合入 | merge(到|into|to) | 落到 | 落地(到) | 落地目标[:=]] <branch>, where
// <branch> is a REAL git branch (validated against `git for-each-ref refs/heads` — a bare "落地
// ADR-016" / "merge into 1 mechanism" / "落地 disjointness 排序" is NOT a landing target and never
// hits). Reported by position (file+line+target branch).
//
// SCAN SURFACE — the AUTHORING sections where a task DECLARES its landing target:
//   the `title:` frontmatter line, and lines inside `## Proposal` / `## Plan` / `## Contract` /
//   `## Finding` (the task-shape sections; a `（draft）` heading suffix is normalized away).
// Evidence / `## AC` checkboxes / `## DoD` / 「翻 done」 blocks are RECORDS of what happened, not
// declarations — a historical "代码已合入 integration 且被 r308-green 覆盖" is history, not drift.
//
// STATEMENT-CONTEXT EXCLUSIONS (a match that merely records/hypothesizes is not a declaration):
//   negated      — 未/不/别/勿/不要/避免/不得/不会/无需/没有 within the pre-window
//   past/agentive — 已/曾/经/由/被/刚/已经/fan-in within the pre-window (「已合入」/「经…fan-in 合入」)
//   temporal     — 后/前/before/prior within the pre- or post-window (「merge 到 integration 后」)
//   quoted       — the phrase wrapped in 「」/""/'' (a quoted example, e.g. 「合入 integration」)
//   reconciled   — the line carries a `landing-exception:` note (AC4's 「本次例外何时清回 0」说明;
//                   an explicit, positional declaration that THIS statement is a recorded exception,
//                   not a current landing target).
//
// FORWARD BRANCH (AC2 — 不硬编码分支名): derived from the two-line model's git relation, reading
// the host — NOT a hardcoded branch name:
//   develop..integration == 0 (integration ⊆ develop)  ⇒ forward = develop
//   else integration..develop == 0 (develop ⊆ integration) ⇒ forward = integration
//   else ⇒ diverged (the two-line invariant is BROKEN) — fail closed with a model-ambiguous report.
// When the branch model migrates (develop merged into integration ⇒ integration becomes forward),
// the SAME formula reads the host and yields the new forward branch. Only the two model REFS
// (develop/integration) are named — the SPEC's relation, not a hardcoded forward branch.
//
// MODES:
//   --scan [--root]    measure mode — print every hit with its classification (匹配 / 违规 / 排除-*)
//                      + a 0-violation summary. Exit 0 (measure, never a gate).
//   --gate [--root]    static-tier gate (wired into scripts/test.sh run_static_checks). Exit 1 iff
//                      any hit is a violation (a declared landing target ≠ the forward branch).
//   --json             machine-readable output.
//
// Exit: 0 = PASS / measure; 1 = gate FAIL (>=1 violation or diverged model); 2 = usage/env error.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
// flagVal (below) is now a one-line arity adapter over the shared `flagValue`; its algorithm was one
// of the ~73 hand-written copies of the indexOf+next-arg idiom in plugin/scripts
// (.quay/routine-findings.jsonl finding `arg-parsing-helper-family`, routine `semantic-dedup-scan`).
import { isDirectEntry, helpExit, flagValue, resolveRoot } from "./gate-script-base.ts";

/** The two-line model's refs — the SPEC's relation (develop..integration=0), not a hardcoded forward. */
export const MODEL_REFS = ["develop", "integration"] as const;

/** Landing-target constructs: [verb] <branch>, and the explicit 落地目标[:=] <branch> noun form. */
export const LANDING_RE =
  /合入\s*([A-Za-z0-9._/-]+)|merge\s*(?:到|into|to)\s*([A-Za-z0-9._/-]+)|落到\s*([A-Za-z0-9._/-]+)|落地(?:到)?\s*([A-Za-z0-9._/-]+)|落地目标(?:分支)?\s*[:=]\s*([A-Za-z0-9._/-]+)/g;

/** Negation markers in the pre-window (「未合入」/「不要合入」/「避免合入」). */
export const NEGATION_RE = /未|不|别|勿|不要|避免|不得|不会|无需|没有|没/i;

/** Past/agentive markers in the pre-window (「已合入」/「经…fan-in 合入」/「由…落地并合入」). */
export const PAST_RE = /已|曾|经|由|被|刚|已经|fan-in/i;

/** Temporal markers (「合入 integration 后」/「merge 到 master 前」— a temporal/precaution construct, not a target). */
export const TEMPORAL_RE = /后|前|before|prior/i;

/** The reconciliation marker (AC4's 「本次例外何时清回 0」说明) — an explicit positional exception. */
export const EXCEPTION_MARKER = "landing-exception";

/** The authoring sections where a task DECLARES its landing target (task-shape sections). */
export const AUTHORING_SECTIONS = new Set(["proposal", "plan", "contract", "finding"]);

export type HitKind =
  | "match"          // target == forward — GREEN
  | "violation"      // target != forward — FAILS the gate
  | "excluded-negation"
  | "excluded-past"
  | "excluded-temporal"
  | "excluded-quoted"
  | "excluded-reconciled";

export interface LandingHit {
  file: string;
  line: number;
  target: string;
  forward: string;
  kind: HitKind;
  text: string;
}

export interface ForwardResult {
  forward: string | null;
  model: "develop-forward" | "integration-forward" | "diverged";
  evidence: string;
}

// ── git-backed forward-branch derivation (AC2 — 读宿主, 不写死分支名) ─────────────────────────────

function gitOut(root: string, args: string[]): string {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
    .trim();
}

/** `git rev-list --count <range>`; null on failure (missing ref / not a repo). */
export function gitRevListCount(root: string, range: string): number | null {
  try {
    return Number.parseInt(gitOut(root, ["rev-list", "--count", range]), 10);
  } catch {
    return null;
  }
}

/** The repo's real branch names (`git for-each-ref refs/heads`) — branch validation source. */
export function branchSet(root: string): Set<string> {
  try {
    const out = gitOut(root, ["for-each-ref", "refs/heads", "--format=%(refname:short)"]);
    return new Set(out.length ? out.split("\n") : []);
  } catch {
    return new Set();
  }
}

/**
 * AC2 — forward branch from the two-line relation, reading the host:
 *   develop..integration==0 (integration ⊆ develop) ⇒ develop; integration..develop==0 ⇒ integration;
 *   both==0 (equal refs) ⇒ develop (the two-line default); neither ⇒ diverged (invariant broken).
 * AC48 (2026-08-13) — integration branch RETIRED: the two-line model is retired in favor of single-line
 * develop (per-task verification forks from develop and merges back). When the integration ref no
 * longer exists, the two-line relation cannot be computed and the forward branch is trivially develop
 * (single-line). This is a MODEL MIGRATION read off the host, not a hardcoded name: a downstream that
 * still HAS the integration branch keeps the two-line formula below.
 */
export function forwardBranch(root: string): ForwardResult {
  if (!branchSet(root).has("integration")) {
    return { forward: "develop", model: "single-line", evidence: "integration retired (AC48) — single-line develop-forward" };
  }
  const di = gitRevListCount(root, "develop..integration");
  const id = gitRevListCount(root, "integration..develop");
  if (di === null || id === null) {
    return { forward: null, model: "diverged", evidence: `git-error develop..integration=${di} integration..develop=${id}` };
  }
  if (di === 0) return { forward: "develop", model: "develop-forward", evidence: `develop..integration=${di}` };
  if (id === 0) return { forward: "integration", model: "integration-forward", evidence: `integration..develop=${id}` };
  return { forward: null, model: "diverged", evidence: `diverged develop..integration=${di} integration..develop=${id}` };
}

// ── scan surface: tasks/*.md in the AUTHORING sections ────────────────────────────────────────────

export function scanSurface(root: string): string[] {
  const tasksDir = path.join(root, "tasks");
  if (!fs.existsSync(tasksDir)) return [];
  return fs.readdirSync(tasksDir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => path.join("tasks", f))
    .sort();
}

/** The markdown section a line belongs to (the last `## X` heading at or above it), draft suffix normalized. */
export function sectionOf(lines: string[], idx: number): string {
  for (let i = idx; i >= 0; i--) {
    const m = lines[i].trim().match(/^##\s+(.+)$/);
    if (m) {
      return m[1].toLowerCase().replace(/[（(]draft[）)]\s*$/, "").trim();
    }
  }
  return "";
}

/** Is the match wrapped in 「」/""/'' (a quoted example, not a declaration)? */
export function isQuoted(line: string, vstart: number, bend: number): boolean {
  const pre = line.slice(Math.max(0, vstart - 6), vstart);
  const post = line.slice(bend, bend + 6);
  return (pre.includes("「") && post.includes("」"))
    || (pre.includes('"') && post.includes('"'))
    || (pre.includes("'") && post.includes("'"));
}

/** Clause separators — a marker on the far side of one must not leak into this clause's judgment
 *  (「未落地修复——合入 develop」: the 未 belongs to the "not-yet-landed" clause, not the landing target). */
export const CLAUSE_SEP_RE = /[，。；：、——…？！,;:!?]/g;

/** The clause-local pre-window: up to `width` chars before `vstart`, cut at the LAST clause separator
 *  so a past/negation marker in a PREVIOUS clause (「已 X；合入 develop」) never mis-excludes this one. */
export function clauseWindow(line: string, vstart: number, width: number): string {
  const start = Math.max(0, vstart - width);
  const seg = line.slice(start, vstart);
  let lastSep = -1;
  let m: RegExpExecArray | null;
  const re = new RegExp(CLAUSE_SEP_RE.source, CLAUSE_SEP_RE.flags);
  while ((m = re.exec(seg)) !== null) lastSep = m.index;
  return seg.slice(lastSep + 1);
}

/** Classify one match (token = the captured branch candidate) against the forward branch.
 *  Returns null only when the token is NOT a real branch (a bare "落地 ADR-016" / "merge into 1"
 *  is not a landing-target construct at all). Otherwise returns a hit with its kind — including the
 *  excluded sub-kinds, so --scan ENUMERATES the historical/negated/quoted statements it declined
 *  (AC4: 「列出所有已写 integration 落地目标的表述」), while the gate only fails on `violation`. */
export function classifyHit(
  line: string,
  vstart: number,
  bend: number,
  token: string,
  forward: string | null,
  branches: Set<string>,
): LandingHit | null {
  if (!branches.has(token)) return null; // not a real branch — NOT a landing-target construct
  const pre = clauseWindow(line, vstart, 14);
  const post = line.slice(bend, bend + 6);
  let kind: HitKind = token === forward ? "match" : "violation";
  if (isQuoted(line, vstart, bend)) kind = "excluded-quoted"; // 「合入 integration」— quoted example
  else if (line.includes(EXCEPTION_MARKER)) kind = "excluded-reconciled"; // explicit landing-exception note
  else if (TEMPORAL_RE.test(post)) kind = "excluded-temporal"; // 「合入 integration 后」/「merge 到 master 前」
  else if (NEGATION_RE.test(pre)) kind = "excluded-negation"; // 「未合入」/「不要合入」/「避免合入」
  else if (PAST_RE.test(pre)) kind = "excluded-past"; // 「已合入」/「经…fan-in 合入」/「由…落地并合入」
  else if (TEMPORAL_RE.test(pre)) kind = "excluded-temporal"; // 「restore 后落地到 master」
  return {
    file: "",
    line: 0,
    target: token,
    forward: forward ?? "?",
    kind,
    text: line.trim().slice(0, 120),
  };
}

/** Scan ONE task file. Returns hits (with file/line filled). */
export function scanFile(rel: string, abs: string, forward: string | null, branches: Set<string>): LandingHit[] {
  const src = fs.readFileSync(abs, "utf8");
  const lines = src.split("\n");
  const hits: LandingHit[] = [];
  let inFrontmatter = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i === 0 && line.trim() === "---") { inFrontmatter = true; continue; }
    if (inFrontmatter && line.trim() === "---") { inFrontmatter = false; continue; }
    const inTitle = inFrontmatter && /^title:/.test(line); // the title line anywhere in the frontmatter block
    const sec = inTitle ? "title" : sectionOf(lines, i);
    if (!inTitle && !AUTHORING_SECTIONS.has(sec)) continue;
    const re = new RegExp(LANDING_RE.source, LANDING_RE.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      const token = m.slice(1).find((g) => g !== undefined && g !== null);
      if (!token) { if (m[0].length === 0) re.lastIndex++; continue; }
      const h = classifyHit(line, m.index, m.index + m[0].length, token, forward, branches);
      if (h) { h.file = rel; h.line = i + 1; hits.push(h); }
      if (m[0].length === 0) re.lastIndex++;
    }
  }
  return hits;
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────

const usage = `landing-target-check.ts — 任务落地目标分支必须 == 当前前锋分支
(gap-landing-target-branch-consistency-check)

Usage:
  node --experimental-strip-types landing-target-check.ts --scan [--root <dir>] [--json]
      measure mode — print every landing-target statement with its target vs forward branch.
      Exit 0 always (measure).
  node --experimental-strip-types landing-target-check.ts --gate [--root <dir>] [--json]
      gate mode — scan the task store's authoring sections (title/Proposal/Plan/Contract/Finding);
      exit 1 iff any declared landing target != the forward branch (or the two-line model diverged).

Exit codes: 0 PASS/measure · 1 gate FAIL · 2 usage/env error.`;

export function main(argv: string[]): number {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) helpExit(usage);
  const asJson = args.includes("--json");
  const root = resolveRoot(flagValue(args, "--root"));
  const fwd = forwardBranch(root);
  const branches = branchSet(root);
  const surface = scanSurface(root);
  const hits: LandingHit[] = [];
  for (const rel of surface) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) continue;
    hits.push(...scanFile(rel, abs, fwd.forward, branches));
  }
  hits.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  const violations = hits.filter((h) => h.kind === "violation");
  const modelBroken = fwd.forward === null;
  const gateFail = violations.length > 0 || modelBroken;

  const isGate = args.includes("--gate");
  if (asJson) {
    console.log(JSON.stringify({
      mode: isGate ? "gate" : "scan",
      forward: fwd.forward,
      model: fwd.model,
      evidence: fwd.evidence,
      ok: !gateFail,
      surface,
      hits: hits.map((h) => ({ file: h.file, line: h.line, target: h.target, forward: h.forward, kind: h.kind, text: h.text })),
      violations: violations.map((h) => ({ file: h.file, line: h.line, target: h.target, forward: h.forward, text: h.text })),
      modelBroken,
    }, null, 2));
  } else {
    console.log(`landing-target-check ${isGate ? "--gate" : "--scan"} — ${surface.length} task(s) scanned; forward branch = ${fwd.forward ?? "?"} (${fwd.evidence})`);
    for (const h of hits) {
      const tag = h.kind === "violation" ? "违规" : h.kind === "match" ? "匹配" : `排除-${h.kind.replace("excluded-", "")}`;
      console.log(`  [${tag}] ${h.file}:${h.line} target=${h.target} forward=${h.forward} ${h.text}`);
    }
    if (modelBroken) {
      console.log(`FAIL — two-line branch model is ambiguous/diverged: ${fwd.evidence}`);
    } else if (violations.length === 0) {
      console.log(`PASS — every declared landing target == forward branch '${fwd.forward}' (0 violations)`);
    } else {
      console.log(`FAIL — ${violations.length} declared landing target(s) != forward branch '${fwd.forward}':`);
      for (const v of violations) console.log(`  - ${v.file}:${v.line} target=${v.target} ${v.text}`);
    }
  }
  // --scan is a measure (exit 0 always, like the sibling concurrency-literal-check); only --gate fails.
  return isGate && gateFail ? 1 : 0;
}

if (isDirectEntry(import.meta, undefined, "landing-target-check")) {
  process.exit(main(process.argv));
}
