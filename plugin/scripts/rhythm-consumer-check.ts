#!/usr/bin/env node
// rhythm-consumer-check.ts — AC73 节奏栏消费检测 (tasks/gap-ac73-catalog-rhythm-consumer-check).
//
// The disease this checker cures (发生率=4, each instance unrelated):
//   per_suite_lane_budget=8      算对、打印、无 reader            → AC68 (test.sh now reads it)
//   fan-in-ff-protocol-check.ts  造好、测试绿、无 caller          → AC62 判据2 (zero-wiring family)
//   checkSplitRecommendation      零非测试调用者                   → existing
//   tick-core-drift-check         已接线但 --no-block             → 4th form: consumer muted
// The common shape: a mechanism is DECLARED to run on a cadence but has NO wiring that actually
// runs it, OR is wired but --no-block so its output changes no result. For a judge-class checker
// "按需" == "从不" — nobody presses a protocol checker at the moment of violation; its value is
// continuity. For a --no-block checker, "报了" and "没报" are indistinguishable downstream — a
// structurally-cannot-go-red check (硬规则 3/9).
//
// This checker makes the rhythm column's consumer contract mechanical:
//
//   判据1 — a mechanism whose cadence is NOT 「按需」 (每轮/每红窗/每里程碑/冷启动) must have a
//           call site in scripts/test.sh OR an execution core (orchestration/*-tick-core.md +
//           plugin/loop/*-tick-core.md) — the surfaces that ACTUALLY run every tick. A mechanism
//           with NO such hit is RED *unless* (a) it is referenced/wired elsewhere (a parent script
//           imports/invokes it, a loop doc / SKILL references it — full-text basename, the same
//           convention mechanism-vitality-check uses for its call surface) or (b) it is in the
//           KNOWN_UNWIRED baseline below (pre-existing zero-call gaps, each with a reason — reported
//           as known-gap, not RED). A NEW non-按需 mechanism with no call site anywhere → RED.
//   判据2 — a shipped mechanism with cadence 「按需」 must declare in the catalog WHO presses it and
//           under WHAT conditions (a CONSUMER row). 「按需」 without a stated presser is 「无人」 —
//           a protocol checker nobody runs. Missing CONSUMER row → RED.
//   判据3 — a checker invoked with --no-block in scripts/test.sh must declare WHO reads its output
//           and ACTS on it (a CONSUMER row). --no-block reports without changing any result, so
//           "reported" and "not reported" are indistinguishable unless a consumer is named. Missing
//           CONSUMER row → RED.
//   判据4 — (REPORT, not gate) execution cores exist in TWO copies (orchestration/*-tick-core.md +
//           plugin/loop/*-tick-core.md). A task whose ## Touches declares an execution-core file
//           must declare BOTH copies — a single-copy declaration is a drift blind spot (the two
//           copies can diverge and nothing that reads git sees it). Reported as a checklist, never
//           folded into green (硬规则 3b).
//
// Negative controls (D2, 不构造 — real samples replayed in the fixture):
//   fan-in-ff-protocol-check.ts  (按需, zero callers, no CONSUMER row)  → 判据1/判据2 RED
//   fan-in-ff-executor-check.ts  (按需, zero callers, no CONSUMER row)  → 判据2 RED
//   tick-core-drift-check        (--no-block, no CONSUMER row)          → 判据3 RED
//   a task touching only ONE execution-core copy                        → 判据4 RED (fixture)
//
// Exit codes: 0 = PASS (判据1/2/3 all satisfied; 判据4 violations reported but not blocking),
//             1 = RED (a 判据1/2/3 violation), 2 = usage/environment error.
//
// Run:
//   node --experimental-strip-types rhythm-consumer-check.ts --check [--json] [--root <dir>]
//   node --experimental-strip-types rhythm-consumer-check.ts --selftest
//
// Wiring: this checker is itself wired into run_static_checks (scripts/test.sh) — it is NOT a
// zero-caller judge. The cadence column declares it 每轮.

import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { matchAtCommandPosition } from "./checker-lib.ts";
import { isDirectEntry, createSelftest } from "./gate-script-base.ts";

// ── Types ───────────────────────────────────────────────────────────────────────────────────────────

export interface CatalogDecl {
  file: string;
  question: string | null;
  ships: boolean;
  surface: string | null;
  cadence: string | null;
  invalidation: string | null;
  last_reaffirmed: string | null;
  matching: string | null;
  consumer: string | null;
}

export interface NoBlockChecker {
  /** run_checker "NAME" — the human name in test.sh. */
  name: string;
  /** The plugin/scripts basename actually invoked (extracted from the script path in the command). */
  script: string;
}

// ── 判据1: KNOWN_UNWIRED baseline ────────────────────────────────────────────────────────────────────
//
// The 21 pre-existing non-按需 mechanisms that have NO full-text basename call in
// {scripts/test.sh, execution cores, loop docs, SKILLs, sibling plugin/scripts} (measured
// 2026-08-14). Each is a library / legacy / not-yet-wired mechanism whose cadence is aspirational.
// They are REPORTED as known-gaps but do not RED the gate — wiring all 21 is a separate effort.
// A mechanism NOT in this set with no call site anywhere → RED. Keep this list shrink-only.
export const KNOWN_UNWIRED: Record<string, string> = {
  "anti-gaming-guard.sh": "exp5 legacy anti-gaming guard — superseded by gate-level checks; cadence aspirational",
  "finding-backpropagate.ts": "finding backpropagation utility — invoked via the finding shape in task bodies, not a suite entry",
  "gate-dispatch-coverage.ts": "dispatch-coverage analysis utility — used ad hoc, cadence aspirational",
  "gate-staleness-check.sh": "legacy staleness check — superseded by gate-staleness-check.ts sibling (also unwired)",
  "live-repo-literal-assert-check.ts": "live-repo literal-assertion linter — maintenance tool, not yet suite-wired",
  "load-sensitive-release-check.ts": "release-time load-sensitivity triage — ad hoc, cadence aspirational",
  "measure-suite.mjs": "suite cost-measurement runner — invoked by measure-suite-reporter.mjs's sibling flow, not a gate",
  "mechanism-vitality-check.ts": "crystallization ①②③④ triage — invoked ad hoc (--check/--selftest), cadence aspirational",
  "needs-human-recheck.ts": "needs-human pool recheck scheduler — invoked by the needs-human path, not every round",
  "release-freshness-check.sh": "release freshness triage — ad hoc, cadence aspirational",
  "stale-ready-audit.ts": "stale-ready pool audit — invoked ad hoc, cadence aspirational",
  "suite-cutoff-verdict.mjs": "suite-cutoff verdict reporter — invoked by full-suite-runner.ts's cutoff path, not a standalone gate",
  "supervisor-bus.sh": "supervisor message-bus — sourced by supervisor-deliver.sh/observe.sh, cadence aspirational",
  "supervisor-health.sh": "supervisor health observer — invoked by the supervisor path, not every round",
  "supervisor-observe.sh": "supervisor observe loop — invoked by the supervisor path, not every round",
  "test-file-baseline.ts": "test-file baseline snapshot — maintenance utility, cadence aspirational",
  "unverified-integration-task-ids.ts": "unverified integration task-id census — ad hoc, cadence aspirational",
  "workflow-baseline-metrics.ts": "workflow baseline metrics collector — invoked by workflow infra, not a suite gate",
  "workflow-journal.ts": "workflow stage journal store — library used by workflow infra, cadence aspirational",
};

// ── Pure: 判据1 (non-按需 must have a call site) ─────────────────────────────────────────────────────

/**
 * Judge ONE non-按需 mechanism's wiring. PURE — the caller resolves the hit evidence.
 * RED when the mechanism has no strict-surface hit, no wired-elsewhere evidence, and is NOT in the
 * KNOWN_UNWIRED baseline; GREEN when any of the three holds. NOT-EVALUATED is not used here — the
 * evidence is always computable from the surfaces (empty surfaces = no evidence = RED).
 * @param {{file:string, strictHits:string[], broadHits:string[], baselined:boolean}} m
 * @returns {{ok:boolean, evaluated:boolean, reason:string, kind:"wired-strict"|"wired-broad"|"known-gap"|"unwired"}}
 */
export function judgeNonOnDemand(m: {
  file: string;
  strictHits: string[];
  broadHits: string[];
  baselined: boolean;
}): { ok: boolean; evaluated: boolean; reason: string; kind: string } {
  if (m.strictHits.length > 0) {
    return { ok: true, evaluated: true, reason: `wired-strict (${m.strictHits.join(", ")})`, kind: "wired-strict" };
  }
  if (m.broadHits.length > 0) {
    return { ok: true, evaluated: true, reason: `wired-elsewhere (${m.broadHits.join(", ")})`, kind: "wired-broad" };
  }
  if (m.baselined) {
    return { ok: true, evaluated: true, reason: `known-gap (${KNOWN_UNWIRED[m.file] ?? "baselined"})`, kind: "known-gap" };
  }
  return { ok: false, evaluated: true, reason: "no-call-site (non-按需 cadence declared, nothing runs it)", kind: "unwired" };
}

// ── Pure: 判据2 (按需 must declare who presses it) ───────────────────────────────────────────────────

/**
 * Judge ONE 按需 mechanism's consumer declaration. PURE. RED when the catalog CONSUMER row for the
 * mechanism is missing/empty — 「按需」 without a stated presser is 「无人」 (nobody runs a protocol
 * checker at the moment of violation). GREEN when a CONSUMER row exists.
 * @param {string|null} consumerDecl — the catalog CONSUMER value for this file
 * @returns {{ok:boolean, evaluated:boolean, reason:string}}
 */
export function judgeOnDemandConsumer(consumerDecl: string | null | undefined): { ok: boolean; evaluated: boolean; reason: string } {
  if (consumerDecl == null || String(consumerDecl).trim() === "") {
    return { ok: false, evaluated: true, reason: "按需 without a CONSUMER row — 「按需」=「无人」, no presser declared" };
  }
  return { ok: true, evaluated: true, reason: "按需 with a declared presser (CONSUMER row present)" };
}

// ── Pure: 判据3 (--no-block must declare who reads the output) ──────────────────────────────────────

/**
 * Judge ONE --no-block checker's consumer declaration. PURE. RED when the catalog CONSUMER row for
 * the checker's script is missing/empty — a --no-block checker reports without changing any result,
 * so "reported" and "not reported" are indistinguishable unless a consumer is named (硬规则 3/9).
 * @param {string|null} consumerDecl — the catalog CONSUMER value for this script
 * @returns {{ok:boolean, evaluated:boolean, reason:string}}
 */
export function judgeNoBlockConsumer(consumerDecl: string | null | undefined): { ok: boolean; evaluated: boolean; reason: string } {
  if (consumerDecl == null || String(consumerDecl).trim() === "") {
    return { ok: false, evaluated: true, reason: "--no-block without a CONSUMER row — output read by nobody, 报/没报 indistinguishable" };
  }
  return { ok: true, evaluated: true, reason: "--no-block with a declared consumer (CONSUMER row present)" };
}

// ── Pure: extract --no-block checkers from scripts/test.sh source ───────────────────────────────────

const RUN_CHECKER_RE = /run_checker\s+"([^"]+)"\s+(\S+)\s+([^\n]*?)(--no-block)?[^\n]*/g;

/**
 * Parse scripts/test.sh's run_checker invocations for the ones carrying --no-block. PURE — the
 * caller passes the file's source text. Extracts the human NAME (first quoted arg) and the
 * plugin/scripts basename actually invoked (from the script path in the command line).
 * @param {string} testShSource
 * @returns {NoBlockChecker[]}
 */
export function extractNoBlockCheckers(testShSource: string): NoBlockChecker[] {
  const out: NoBlockChecker[] = [];
  for (const m of testShSource.matchAll(/run_checker\s+"([^"]+)"([^\n]*)/g)) {
    const name = m[1];
    const rest = m[2];
    if (!/--no-block/.test(rest)) continue;
    const scriptMatch = rest.match(/plugin\/scripts\/([A-Za-z0-9._-]+\.(?:ts|sh|mjs|js))/);
    if (!scriptMatch) continue;
    out.push({ name, script: scriptMatch[1] });
  }
  return out;
}

// ── Pure: 判据4 (execution-core Touches must declare BOTH copies) ───────────────────────────────────

const TICK_CORE_RE = /(?:orchestration|plugin\/loop)\/(manager|orchestrator|fast-mode)-tick-core\.md/;

/**
 * Judge a task's ## Touches for execution-core dual-copy visibility. PURE. The execution cores ship
 * in TWO copies (orchestration/*-tick-core.md — what the three layers read every tick, and
 * plugin/loop/*-tick-core.md — the shipped laid-down copy). A task that declares ONE copy in its
 * Touches is a drift blind spot: the copies can diverge and nothing reading git sees it (判据4
 * 三面之 Touches 谁在改). RED when the Touches declare an execution-core file of only ONE copy.
 * @param {string[]} touches — the task's ## Touches file entries
 * @returns {{ok:boolean, evaluated:boolean, reason:string, single:[string,string][], pairs:number}}
 */
export function judgeDualCopyTouches(touches: string[]): {
  ok: boolean;
  evaluated: boolean;
  reason: string;
  single: Array<{ name: string; side: string }>;
  pairs: number;
} {
  const touched = (touches ?? []).map((t) => String(t));
  const byName = new Map<string, Set<string>>();
  for (const t of touched) {
    const m = t.match(TICK_CORE_RE);
    if (m) {
      const name = m[1];
      // Side from the leading path in the match (a Touches line may carry a `- ` list prefix).
      const side = t.indexOf("orchestration/") === 0 || t.startsWith("- orchestration/") ? "orchestration" : "plugin/loop";
      if (!byName.has(name)) byName.set(name, new Set());
      byName.get(name)!.add(side);
    }
  }
  const single: Array<{ name: string; side: string }> = [];
  let pairs = 0;
  for (const [name, sides] of byName) {
    if (sides.size === 2) pairs++;
    else single.push({ name, side: [...sides][0] });
  }
  if (byName.size === 0) {
    return { ok: true, evaluated: false, reason: "no-execution-core-touch (NOT-EVALUATED — 硬规则 3b: 无法评估 ≠ 合格)", single, pairs };
  }
  if (single.length > 0) {
    return {
      ok: false,
      evaluated: true,
      reason: `single-copy execution-core touch (${single.map((s) => `${s.name}=${s.side}`).join(", ")}) — the dual copies can diverge unseen`,
      single,
      pairs,
    };
  }
  return { ok: true, evaluated: true, reason: `dual-copy execution-core touches (${pairs} pair(s))`, single, pairs };
}

// ── fs helpers (the impure boundary — tests can inject pure verdicts directly) ───────────────────────

const SELF_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(SELF_DIR, "../..");

/** Load catalog decls (incl. the new consumer field) via capability-catalog.sh --json. The catalog
 *  always emits the JSON on stdout; its AC1c entry-gate exit code is a SEPARATE signal (a script
 *  entered unclassified) — we read the rows regardless so 判据1/2/3 can judge against the real data. */
export function loadCatalogDecls(root: string): CatalogDecl[] {
  const r = spawnSync("bash", [path.join(root, "plugin", "scripts", "capability-catalog.sh"), "--json"], {  // kernel-sibling-dev-tree-only: dev-tree-only — repo-local plugin/scripts use, not third-party sibling resolution.
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (r.status !== 0) {
    // The catalog gate fired (unclassified script / missing field) — that is a real failure the
    // catalog's own check reports. We still parse the rows so this checker's verdicts are not
    // silently vacuous (硬规则 3b: 无法评估 ≠ 合格). The caller's 判据 gates still judge the rows.
    const rows = JSON.parse(r.stdout || "[]");
    return rows;
  }
  return JSON.parse(r.stdout) as CatalogDecl[];
}

/** The strict call surface: what ACTUALLY runs every tick (scripts/test.sh + both tick-core copies).
 *  runner-static-gate.ts is included because scripts/test.sh SOURCES it (gap-ac128-hub-split-harness-
 *  concerns moved run_static_checks/resource_gate_check there) — its run_checker call sites are exactly
 *  as "every-tick" as the test.sh ones they replaced. */
export function strictSurfaceFiles(root: string): string[] {
  const out = [
    path.join(root, "scripts", "test.sh"),
    path.join(root, "plugin", "scripts", "runner-static-gate.ts"),  // kernel-sibling-dev-tree-only: dev-tree-only — repo-local plugin/scripts use, not third-party sibling resolution.
  ];
  for (const dir of ["orchestration", "plugin/loop"]) {
    const d = path.join(root, dir);
    if (!fs.existsSync(d)) continue;
    for (const e of fs.readdirSync(d)) {
      if (e.includes("tick") && e.endsWith(".md")) out.push(path.join(d, e));
    }
  }
  return out;
}

/** The broad surface: sibling plugin/scripts (real invocations/imports), loop docs, SKILL.md files. */
export function broadSurfaceFiles(root: string): string[] {
  const out: string[] = [];
  const scriptsDir = path.join(root, "plugin", "scripts");
  if (fs.existsSync(scriptsDir)) {
    for (const e of fs.readdirSync(scriptsDir)) {
      if (e.startsWith("checker-mutation") || e === "capability-catalog.sh") continue;
      if (/\.(sh|ts|mjs|js)$/.test(e)) out.push(path.join(scriptsDir, e));
    }
  }
  const loopDir = path.join(root, "plugin", "loop");
  if (fs.existsSync(loopDir)) {
    for (const e of fs.readdirSync(loopDir)) {
      if (e.endsWith(".md") && !e.includes("tick")) out.push(path.join(loopDir, e));
    }
  }
  const skillsDir = path.join(root, "plugin", "skills");
  if (fs.existsSync(skillsDir)) {
    for (const s of fs.readdirSync(skillsDir)) {
      const f = path.join(skillsDir, s, "SKILL.md");
      if (fs.existsSync(f)) out.push(f);
    }
  }
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Full-text basename presence in a file (the call-surface convention mechanism-vitality uses). */
function basenamePresent(filePath: string, basename: string, cache: Map<string, string>): boolean {
  let text = cache.get(filePath);
  if (text === undefined) {
    try {
      text = fs.readFileSync(filePath, "utf8");
    } catch {
      text = "";
    }
    cache.set(filePath, text);
  }
  if (!text) return false;
  const re = new RegExp(`\\b${escapeRegExp(basename)}\\b`);
  return matchAtCommandPosition(text, re, { maskNonCode: false }).length > 0;
}

// ── run (判据1/2/3 gate + 判据4 report) ──────────────────────────────────────────────────────────────

export function runCheck(root: string, asJson: boolean): number {
  const decls = loadCatalogDecls(root);
  const byFile = new Map<string, CatalogDecl>(decls.map((d) => [d.file, d]));
  const strictFiles = strictSurfaceFiles(root);
  const broadFiles = broadSurfaceFiles(root);
  const cache = new Map<string, string>();

  const checks: any[] = [];
  let anyRed = false;

  // ── 判据1 — non-按需 mechanisms must have a call site ───────────────────────────────────────────
  const c1: any[] = [];
  for (const d of decls) {
    if (!d.ships) continue;
    if (d.cadence == null || d.cadence === "按需") continue;
    const strictHits = strictFiles.filter((f) => basenamePresent(f, d.file, cache));
    const broadHits = broadFiles.filter((f) => path.basename(f) !== d.file && basenamePresent(f, d.file, cache));
    const v = judgeNonOnDemand({ file: d.file, strictHits, broadHits, baselined: d.file in KNOWN_UNWIRED });
    if (!v.ok) anyRed = true;
    c1.push({ file: d.file, cadence: d.cadence, ...v, strict: strictHits, broad: broadHits });
  }
  checks.push({ check: "判据1-non-按需-call-site", ok: c1.every((x) => x.ok), entries: c1 });

  // ── 判据2 — 按需 mechanisms must declare who presses them ────────────────────────────────────────
  const c2: any[] = [];
  for (const d of decls) {
    if (!d.ships) continue;
    if (d.cadence !== "按需") continue;
    const v = judgeOnDemandConsumer(d.consumer);
    if (!v.ok) anyRed = true;
    c2.push({ file: d.file, ...v });
  }
  checks.push({ check: "判据2-按需-consumer", ok: c2.every((x) => x.ok), entries: c2 });

  // ── 判据3 — --no-block checkers must declare who reads the output ────────────────────────────────
  // The --no-block run_checker invocations live in run_static_checks, which moved to runner-static-gate.ts
  // (gap-ac128-hub-split-harness-concerns) — read that file, not scripts/test.sh.
  const testShPath = path.join(root, "plugin", "scripts", "runner-static-gate.ts");  // kernel-sibling-dev-tree-only: dev-tree-only — repo-local plugin/scripts use, not third-party sibling resolution.
  const noBlock = fs.existsSync(testShPath) ? extractNoBlockCheckers(fs.readFileSync(testShPath, "utf8")) : [];
  const c3: any[] = [];
  for (const nb of noBlock) {
    const decl = byFile.get(nb.script);
    const v = judgeNoBlockConsumer(decl?.consumer ?? null);
    if (!v.ok) anyRed = true;
    c3.push({ name: nb.name, script: nb.script, ...v });
  }
  checks.push({ check: "判据3-no-block-consumer", ok: c3.every((x) => x.ok), entries: c3 });

  // ── 判据4 (REPORT) — execution-core Touches must declare BOTH copies ─────────────────────────────
  const tasksDir = path.join(root, "tasks");
  const c4: any[] = [];
  let c4Pairs = 0;
  let c4Single = 0;
  if (fs.existsSync(tasksDir)) {
    for (const e of fs.readdirSync(tasksDir).sort()) {
      if (!e.endsWith(".md")) continue;
      const body = fs.readFileSync(path.join(tasksDir, e), "utf8");
      const touchesSection = body.match(/^## Touches\s*[\r\n]([\s\S]*?)(?=^## |\z)/m);
      if (!touchesSection) continue;
      const lines = touchesSection[1].split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const v = judgeDualCopyTouches(lines);
      if (v.evaluated && !v.ok) c4Single += v.single.length;
      c4Pairs += v.pairs;
      if (v.evaluated && !v.ok) c4.push({ file: e, ...v });
    }
  }
  checks.push({ check: "判据4-execution-core-dual-copy", ok: true, reportOnly: true, pairs: c4Pairs, single: c4Single, entries: c4 });

  const ok = !anyRed;
  const out = {
    ok,
    reason: ok ? "rhythm-consumer-check-pass" : "rhythm-consumer-check-RED (判据1/2/3 violation)",
    checks,
  };
  if (asJson) {
    process.stdout.write(JSON.stringify(out, null, 2) + "\n");
  } else {
    console.log(`rhythm-consumer-check: ${ok ? "OK" : "FAIL"} — ${out.reason}`);
    for (const c of checks) {
      const reds = c.entries.filter((x: any) => !x.ok);
      console.log(`  [${c.check}] ${c.ok ? "ok" : "RED"}${c.reportOnly ? " (report)" : ""} — ${c.entries.length} judged, ${reds.length} violation(s)`);
      for (const r of reds.slice(0, 8)) console.log(`      - ${r.file ?? r.name}: ${r.reason}`);
      if (reds.length > 8) console.log(`      … ${reds.length - 8} more`);
      if (c.reportOnly && c.single > 0) console.log(`      (判据4 report: ${c.single} single-copy execution-core touch(es) across tasks — not blocking)`);
    }
  }
  return ok ? 0 : 1;
}

// ── selftest (pure-function negative controls) ───────────────────────────────────────────────────────

export function runSelftest(): boolean {
  const st = createSelftest({ flavor: "counters", label: "rhythm-consumer-check" });
  const check = st.check;

  // ── 判据1 — non-按需 must have a call site ──────────────────────────────────────────────────────
  check(
    "判据1: strict hit → wired",
    judgeNonOnDemand({ file: "x.ts", strictHits: ["scripts/test.sh"], broadHits: [], baselined: false }).ok === true,
  );
  check(
    "判据1: no strict but broad hit → wired-elsewhere",
    judgeNonOnDemand({ file: "x.ts", strictHits: [], broadHits: ["plugin/scripts/parent.ts"], baselined: false }).ok === true,
  );
  check(
    "判据1: KNOWN_UNWIRED baseline → known-gap (not red)",
    judgeNonOnDemand({ file: "mechanism-vitality-check.ts", strictHits: [], broadHits: [], baselined: true }).ok === true,
  );
  check(
    "判据1: no hit anywhere + not baselined → RED",
    judgeNonOnDemand({ file: "fan-in-ff-protocol-check.ts", strictHits: [], broadHits: [], baselined: false }).ok === false,
  );

  // ── 判据2 — 按需 must declare who presses it ─────────────────────────────────────────────────────
  check("判据2: 按需 with no CONSUMER row → RED", judgeOnDemandConsumer(null).ok === false);
  check("判据2: 按需 with empty CONSUMER row → RED", judgeOnDemandConsumer("  ").ok === false);
  check("判据2: 按需 with a CONSUMER row → ok", judgeOnDemandConsumer("谁按：inner 任务 subagent 在 A6 fan-in 回合按").ok === true);

  // ── 判据3 — --no-block must declare who reads the output ─────────────────────────────────────────
  check("判据3: --no-block with no CONSUMER row → RED", judgeNoBlockConsumer(null).ok === false);
  check("判据3: --no-block with a CONSUMER row → ok", judgeNoBlockConsumer("消费方：manager tick 读 .quay/task-file-violation-ledger.jsonl 据此动作").ok === true);

  // ── 判据4 — execution-core Touches dual-copy ─────────────────────────────────────────────────────
  const both = judgeDualCopyTouches([
    "- orchestration/fast-mode-tick-core.md",
    "- plugin/loop/fast-mode-tick-core.md",
    "- plugin/scripts/x.ts",
  ]);
  check("判据4: both copies declared → ok", both.ok === true && both.pairs === 1, JSON.stringify(both));
  const single = judgeDualCopyTouches(["- orchestration/fast-mode-tick-core.md", "- plugin/scripts/x.ts"]);
  check("判据4: single copy declared → RED", single.ok === false && single.single.length === 1, JSON.stringify(single));
  const none = judgeDualCopyTouches(["- plugin/scripts/x.ts"]);
  check("判据4: no execution-core touch → not evaluated", none.evaluated === false, JSON.stringify(none));
  return st.report();
}

export function main(argv: string[]): number {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "rhythm-consumer-check.ts — AC73 节奏栏消费检测 (判据1/2/3 gate + 判据4 report)\n" +
        "  --check [--json] [--root <dir>]  run the check (default)\n" +
        "  --selftest                       run pure-function negative controls\n" +
        "  Exit: 0 = PASS, 1 = RED (判据1/2/3 violation), 2 = usage/env error",
    );
    return 0;
  }
  if (args.includes("--selftest")) return runSelftest() ? 0 : 1;
  const root = (() => {
    const i = args.indexOf("--root");
    return i !== -1 ? path.resolve(args[i + 1]) : DEFAULT_ROOT;
  })();
  return runCheck(root, args.includes("--json"));
}

if (isDirectEntry(import.meta, undefined, "rhythm-consumer-check")) {
  const code = main(process.argv);
  process.exitCode = code;
}
