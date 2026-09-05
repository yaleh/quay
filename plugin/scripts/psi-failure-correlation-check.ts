#!/usr/bin/env node
// psi-failure-correlation-check.ts — Phase 0 回溯分析：PSI（cpu_stall）对测试失败是否有超出
// 「并发文件数」的增量预测力（tasks/gap-psi-shadow-admission-controller）。
//
// THE QUESTION this script makes askable: does higher cpu_stall coincide with more test FAILURE,
// once the known confounder (concurrent file count) is controlled? A positive answer would justify
// building a PSI feedback admission controller (Phase 1); a negative/insufficient answer means
// Phase 1 is not warranted.
//
// WHY TWO DATA SOURCES, SPLIT (人 2026-09-05 定向, 订正②): the naive "correlation(concurrency,
// cpu_stall)" (already measured r=0.918 but decoupled in both tails) is unusable because the
// historical cpu_stall trace is ENDOGENOUS — produced by the current admission policy, so replaying
// it to judge a NEW policy is the gap-suite-cost-model-is-wrong error. Instead this script reports
// TWO INDEPENDENT, DIFFERENTLY-NATURED sources, and NEVER merges their numbers:
//
//   (a) 主动制造 (ACTIVE, primary, 规模受控 per 订正③, 候选 7 per 订正④) — enumerate the 7
//       verified-clean CORE candidates (full serial/lowconc groups are OPTIONAL via
//       --include-all-groups, never a hard requirement), EXCLUDE any file listed in
//       plugin/test-isolation-violations.txt (hard constraint, AC1), then run each candidate under a
//       SHORT background CPU-load burst (busy-wait subprocesses saturating cores, injection window
//       ≤10s default 5s — the 订正③ fix for the orphan-process root cause; the discussion-phase
//       control experiment needed only 2s for a 650× runDelay signal), sampling the REAL
//       /proc/pressure/cpu `some avg10` AND the tested process tree's /proc/<pid>/schedstat run_delay
//       (订正⑤ mechanism confirmation) during each trial, recording pass/fail + the failure's error
//       signature. ANY induced failure is adjudicated against known isolation-conflict signatures
//       (EADDRINUSE / EEXIST / port-in-use) BEFORE it counts as a valid (scheduling-like) failure —
//       the adjudication itself is recorded, never just pass/fail counts. Busy-wait procs are spawned
//       → awaited → killed within the SAME control flow (no cross-tool-call polling, no orphan).
//
//   (b) 被动历史 (PASSIVE, supplementary) — join .quay/verification-round.jsonl perFile
//       {file, startedAtMs, endedAtMs, passed} with .quay/suite-load-<runId>.jsonl {t, cpu_stall},
//       and compare, WITHIN each concurrency bin (file count at window midpoint), the in-window
//       cpu_stall of failing vs passing files. It captures the long-tail external load sources
//       (other claude/agent processes on the machine) that the active experiment cannot easily
//       reproduce, but the sample is naturally sparse (240 fails / 65 files, most since deleted).
//
// DATA-SOURCE RESOLUTION (订正①, AC2): the two historical carriers (.quay/verification-round.jsonl
// and .quay/suite-load-*.jsonl) are BOTH gitignored — `git worktree add` does not carry them, and
// dispatch-worktree-setup.sh does not refresh them. The script resolves the carrier root as
// `--root` → `process.env.QUAY_MAIN_CHECKOUT` → cwd, and FAIL-CLOSED (exit 2) when the carrier is
// absent in the resolved root — a worker in a fresh worktree that forgets `--root` must see
// "carrier not found", never a silent empty result. The active experiment (a) does NOT depend on
// those carriers and runs in any environment (including a bare worktree).
//
// MIN-N (honest small-sample floor, AC3): the PASSIVE source still defines a minimum sample N; a bin
// whose fail-group N is below the floor reports 「样本不足」, never a direction (硬规则 3b).
//   - passive  MIN_N_PASSIVE  = 10 fail records in a concurrency bin.
// The ACTIVE source's floor is replaced by run_delay mechanism confirmation (订正⑤): a count can only
// show "fails under load", never "fails BECAUSE it was scheduled out". The go/no-go for the active
// source rests on whether each load-induced failure's run_delay is significantly elevated over the
// same file's low-load baseline — not on whether the hit count clears an arbitrary constant.
//
// GO/NO-GO (deterministic): primary = active source; passive is cross-validation.
//   订正⑥: only 真实复现 (real-reproduction) hits count — truncated and design-intent hits are
//   reported but excluded. Per-candidate timeouts (CANDIDATE_CONFIG) are set above each candidate's
//   known historical failure range, never a blind global constant.
//   - signal        iff the active source produced ≥1 real-reproduction load-induced failure whose
//                   run_delay is significantly elevated (≥SIGNIFICANT_RUN_DELAY_RATIO× the low-load
//                   baseline and ≥MIN_RUN_DELAY_NS) — i.e. the mechanism really is schedule-out, so PSI
//                   (which tracks that stall) carries incremental signal.
//   - no-signal     iff the active experiment ran to completion but produced no load-induced failure,
//                   OR produced load-induced failures whose run_delay was NOT elevated (failures are
//                   isolation-conflicts / deterministic / some non-scheduling resource).
//   - insufficient  iff the active experiment could not run enough trials to judge (no high-load
//                   baseline).
//
// Exit codes: 0 = analysis produced a conclusion (read the verdict); 2 = usage/environment error
// (missing carrier for passive, bad args).
//
// Usage:
//   node --experimental-strip-types plugin/scripts/psi-failure-correlation-check.ts \
//        [--source active|passive|both] [--root <repo-root>] [--trials <N>] \
//        [--load-levels 0,<n>] [--inject-window-ms <N>] [--include-all-groups] \
//        [--test-timeout-ms <N>] [--json] [--help]
//   --source          which data source to run (default: both).
//   --root            repo/carrier root for the PASSIVE historical carriers (default: QUAY_MAIN_CHECKOUT
//                     → cwd). The active experiment (a) always runs against its own cwd tree.
//   --trials          trials per (candidate, load level) (default 1).
//   --load-levels     comma list of busy-wait process counts (default "0,<2×availableParallelism()>" —
//                     oversubscription, the load regime this task's discussion-phase experiment
//                     validated: 1× nproc ≈ no stall, 2× nproc ≈ ~28% cpu_stall avg10).
//   --inject-window-ms  load-injection window (busy-wait subprocess lifetime) in ms, default 5000,
//                     hard-capped at 10000 (订正③/AC1: ≤10s; minute-scale windows were the orphan
//                     root cause).
//   --include-all-groups  OPTIONAL: expand the candidate set from the 7 core candidates to the full
//                     serial+lowconc groups (订正③: core-7 is mandatory, full groups are a budget
//                     allowance, never a hard requirement).

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { repoRoot } from "./repo-root.ts";
import { canonicalTestFiles } from "./canonical-test-files.ts";
import { classifyFile } from "./runner-grouping.ts";

type Sample = { t: number; cpu_stall: number };
type PerFileRec = { file: string; startedAtMs: number; endedAtMs: number; passed: boolean };

const DEFAULT_MIN_N_PASSIVE = 10;
// 订正⑤: the MIN_N_ACTIVE count threshold is retired — a count only shows "fails under load", never
// "fails BECAUSE it was scheduled out". The mechanism axis is run_delay: a hit's /proc/<pid>/schedstat
// run_delay (field 2, ns) must be significantly elevated over the same file's low-load baseline. The
// discussion-phase control experiment measured ~650× (0.29ms quiet → 188.4ms at 2× oversubscription).
const SIGNIFICANT_RUN_DELAY_RATIO = 3; // conservative factor; raw numbers are always reported
const MIN_RUN_DELAY_NS = 1_000_000;    // 1ms floor — below this the absolute delay is negligible noise

// The proposal's verified-clean historical-failure candidates — the MANDATORY core set (订正③, AC1):
// exactly these 7 (订正④: 5→7 — proposal-convergence.test.mjs and full-suite-runner-phases.test.mjs
// are CONFIRMED positives from the wide-aperture 26-candidate run, added so the narrowed default set
// no longer screens out two known hits). The full serial/lowconc group enumeration is an OPTIONAL
// extension (--include-all-groups), never a hard requirement. The earlier design ("full serial/lowconc
// + extras", minute-scale load windows) was the needs-human 复盘's root cause — scale far beyond a
// single worker session's budget.
const CORE_CANDIDATES = [
  "plugin/test/help-contract-incompatible-behaviors.test.mjs", // serial, 15x
  "plugin/test/writestate-atomicity-split.test.mjs",           // engine, 14x
  "plugin/test/worker-driver-fan-in.test.mjs",                 // lowconc, 11x — 订正④ confirmed positive
  "plugin/test/worker-driver-resident.test.mjs",               // lowconc, 7x
  "plugin/test/suite-bucket-reattr-ratchet-check.test.mjs",    // engine, 5x
  "experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs", // 订正④ confirmed positive
  "plugin/test/full-suite-runner-phases.test.mjs",             // 订正④ confirmed positive
];

// 订正⑥: per-candidate timeout + three-state hit classification. The 180s default was a blind
// constant — it is NOT a production constraint (scripts/test.sh never passes --test-timeout to
// `node --test`; Node applies no per-file wall-clock kill without it). A candidate with a KNOWN
// historical failure DURATION range must be given a timeout ABOVE that range's upper bound, or a
// timeout "hit" becomes a truncation artifact (the script killing the test before its real failure
// point), not evidence. Every load-induced hit must be classified into one of three states:
//   真实复现 (real-reproduction) / 被截断不构成证据 (truncated) / 疑似设计意图需另行分诊 (design-intent).
interface CandidateConfig {
  timeoutMs: number;               // --test-timeout-ms for this candidate (>= its histFail upper bound)
  histFailMs?: [number, number];   // known historical failure duration range (ms), from 订正⑥
  designIntent?: boolean;          // internal hang-detection design (proposal-convergence)
  unverifiableInBudget?: boolean;  // honest timeout exceeds the <=10min budget (full-suite-runner-phases)
}
const DEFAULT_TEST_TIMEOUT_MS = 180_000;
const CANDIDATE_CONFIG: Record<string, CandidateConfig> = {
  // 订正⑥: real failures cluster at 128~188s; 240s covers the upper bound. Of the three candidates the
  // only credible real reproduction — run_delay mechanism confirmation must target it first.
  "plugin/test/worker-driver-fan-in.test.mjs": { timeoutMs: 240_000, histFailMs: [128_000, 188_000] },
  // 订正⑥: real failures at 386~407s; observing one needs ~450s which exceeds the <=10min total budget
  // combined with the other candidates — skip it (report 未验证), never run it under a shorter timeout.
  "plugin/test/full-suite-runner-phases.test.mjs": { timeoutMs: 450_000, histFailMs: [386_000, 407_000], unverifiableInBudget: true },
  // 订正⑥: 0 historical failures; the source carries its own hang-detection ("blocked in a futex under
  // load") — its "failure" is likely design-intent, excluded from go/no-go evidence either way.
  "experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs": { timeoutMs: DEFAULT_TEST_TIMEOUT_MS, designIntent: true },
};

// Load-injection window (订正③, AC1): the busy-wait subprocesses run for this many ms — a few seconds
// (the discussion-phase control experiment needed only 2s to measure a 650× runDelay signal). Hard
// cap 10s; minute-scale windows were the orphan-process root cause and are never used.
const DEFAULT_INJECT_WINDOW_MS = 5000;
const MAX_INJECT_WINDOW_MS = 10_000;

// Known test-isolation-conflict error signatures (AC1): a failure matching one of these is an
// isolation defect (shared tmp path / port), NOT scheduling starvation — must be excluded.
const ISOLATION_CONFLICT_RE =
  /EADDRINUSE|address already in use|EEXIST|file already exists|ENOTEMPTY|listen E|connect ECONNREFUSED|ECONNREFUSED|port .*in use|already in use|address already/i;
const SCHEDULING_RE = /timeout|timed ?out|deadline|exceeded|wall.?clock|elapsed|TOOK TOO LONG|timed out/i;

const BINS: { lo: number; hi: number }[] = [
  { lo: 1, hi: 2 },
  { lo: 3, hi: 5 },
  { lo: 6, hi: 10 },
  { lo: 11, hi: 20 },
  { lo: 21, hi: 40 },
  { lo: 41, hi: Number.POSITIVE_INFINITY },
];

function parseArgs(argv: string[]) {
  const out = {
    source: "both" as "active" | "passive" | "both",
    root: "",
    trials: 1,
    loadLevels: [] as number[],
    testTimeoutMs: 180_000,
    minNPassive: DEFAULT_MIN_N_PASSIVE,
    includeAllGroups: false,
    injectWindowMs: DEFAULT_INJECT_WINDOW_MS,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = argv[i + 1];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--source" && v) { out.source = v === "active" || v === "passive" ? v : "both"; i++; }
    else if (a === "--root" && v) { out.root = v; i++; }
    else if (a === "--trials" && v) { const n = Number(v); out.trials = Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1; i++; }
    else if (a === "--load-levels" && v) { out.loadLevels = v.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n >= 0); i++; }
    else if (a === "--test-timeout-ms" && v) { const n = Number(v); out.testTimeoutMs = Number.isFinite(n) && n > 0 ? Math.floor(n) : out.testTimeoutMs; i++; }
    else if (a === "--min-n-passive" && v) { const n = Number(v); out.minNPassive = Number.isFinite(n) && n >= 1 ? Math.floor(n) : out.minNPassive; i++; }
    else if (a === "--include-all-groups") out.includeAllGroups = true;
    else if (a === "--inject-window-ms" && v) { const n = Number(v); out.injectWindowMs = Number.isFinite(n) && n >= 0 ? Math.min(Math.floor(n), MAX_INJECT_WINDOW_MS) : out.injectWindowMs; i++; }
    else if (a === "--json") out.json = true;
  }
  if (out.loadLevels.length === 0) out.loadLevels = [0, 2 * os.availableParallelism()];
  return out;
}

function resolveCarrierRoot(argRoot: string): string {
  if (argRoot) return argRoot;
  if (process.env.QUAY_MAIN_CHECKOUT) return process.env.QUAY_MAIN_CHECKOUT;
  return repoRoot();
}

function readCpuStall(): number | null {
  try {
    const line = fs.readFileSync("/proc/pressure/cpu", "utf8").split("\n")[0] ?? "";
    const m = line.match(/avg10=([0-9]+(?:\.[0-9]+)?)/);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

// /proc/<pid>/schedstat field 2 = run_delay (ns): cumulative time the task was runnable but not
// scheduled (waiting on a runqueue). This is the DIRECT causal quantity the Proposal's hypothesis
// is about ("真正需要低并发运行的测试，敏感的是自己被 schedule out 的概率") — the discussion-phase
// control experiment measured it as 0.29ms (quiet) → 188.4ms (2× oversubscription), ~650×.
function readRunDelayNs(pid: number): number | null {
  try {
    const text = fs.readFileSync(`/proc/${pid}/schedstat`, "utf8").trim();
    const parts = text.split(/\s+/);
    const v = Number(parts[1]);
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

// The tested process (the `node --test` runner) spawns worker subprocesses; their run_delay is what
// reflects the test code being scheduled out, so sample the WHOLE tree (runner + descendants).
function listDescendantPids(rootPid: number): number[] {
  const seen = new Set<number>();
  const stack = [rootPid];
  const out: number[] = [];
  while (stack.length > 0) {
    const pid = stack.pop()!;
    if (seen.has(pid)) continue;
    seen.add(pid);
    out.push(pid);
    try {
      const children = fs.readFileSync(`/proc/${pid}/task/${pid}/children`, "utf8").trim();
      for (const c of children.split(/\s+/)) {
        const cp = Number(c);
        if (Number.isFinite(cp) && cp > 0) stack.push(cp);
      }
    } catch {
      /* process exited between samples */
    }
  }
  return out;
}

function readTreeRunDelayNs(rootPid: number): number {
  let sum = 0;
  for (const pid of listDescendantPids(rootPid)) {
    const v = readRunDelayNs(pid);
    if (v !== null) sum += v;
  }
  return sum;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function mean(vals: number[]): number {
  if (vals.length === 0) return Number.NaN;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}
function max(vals: number[]): number {
  return vals.length === 0 ? Number.NaN : Math.max(...vals);
}
function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}
function median(sorted: number[]): number {
  return pct(sorted, 0.5);
}
function fmt(n: number): string {
  return Number.isFinite(n) ? n.toFixed(2) : "  n/a";
}
function fmtRange(lo: number, hi: number): string {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return "  n/a";
  return `${fmt(lo)}-${fmt(hi)}`;
}
function fmtRunDelay(ns: number): string {
  if (!Number.isFinite(ns)) return "  n/a";
  if (ns < 1_000_000) return `${(ns / 1000).toFixed(1)}µs`;
  return `${(ns / 1_000_000).toFixed(1)}ms`;
}

function readJsonLines(file: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return out;
  }
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim();
    if (!s) continue;
    try {
      const v = JSON.parse(s);
      if (v && typeof v === "object") out.push(v as Record<string, unknown>);
    } catch {
      /* skip */
    }
  }
  return out;
}

// ── (b) passive historical ──────────────────────────────────────────────────────────
function loadSamples(root: string): Map<string, Sample[]> {
  const map = new Map<string, Sample[]>();
  const dir = path.join(root, ".quay");
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return map;
  }
  for (const name of names) {
    if (!name.startsWith("suite-load-") || !name.endsWith(".jsonl")) continue;
    const runId = name.slice("suite-load-".length, -".jsonl".length);
    const samples: Sample[] = [];
    for (const obj of readJsonLines(path.join(dir, name))) {
      const t = obj.t as number | undefined;
      const cs = obj.cpu_stall as number | undefined;
      if (typeof t === "number" && Number.isFinite(t) && typeof cs === "number" && Number.isFinite(cs)) {
        samples.push({ t, cpu_stall: cs });
      }
    }
    samples.sort((a, b) => a.t - b.t);
    if (samples.length > 0) map.set(runId, samples);
  }
  return map;
}

function windowMeanStall(samples: Sample[], s: number, e: number): number | null {
  let sum = 0;
  let n = 0;
  for (const { t, cpu_stall } of samples) {
    if (s <= t && t <= e) { sum += cpu_stall; n++; }
    else if (t > e) break;
  }
  return n === 0 ? null : sum / n;
}

function midpointConcurrency(windows: [number, number][], s: number, e: number): number {
  const mid = (s + e) / 2;
  let n = 0;
  for (const [ws, we] of windows) if (ws <= mid && mid <= we) n++;
  return n;
}

function binOf(c: number): { lo: number; hi: number } {
  for (const b of BINS) if (c >= b.lo && c <= b.hi) return b;
  return BINS[BINS.length - 1];
}

function passiveAnalyze(root: string, minN: number) {
  const vrf = path.join(root, ".quay", "verification-round.jsonl");
  if (!fs.existsSync(vrf)) {
    return { carrierFound: false as const, path: vrf };
  }
  const samplesByRunId = loadSamples(root);
  const roundsWithPerFile: number[] = [];
  let matchedRounds = 0;
  let filesWithWindow = 0;
  let failTotal = 0;
  let passWithPsi = 0;
  let failWithPsi = 0;
  let noPsiInWindow = 0;
  const bins = BINS.map((b) => ({ lo: b.lo, hi: b.hi, passN: 0, passVals: [] as number[], failN: 0, failVals: [] as number[] }));

  for (const raw of readJsonLines(vrf)) {
    const pfRaw = raw.perFile;
    if (!Array.isArray(pfRaw) || pfRaw.length === 0) continue;
    roundsWithPerFile.push(1);
    const runId = typeof raw.runId === "string" ? raw.runId : "";
    const samples = runId ? samplesByRunId.get(runId) : undefined;
    if (!samples) continue;
    matchedRounds++;
    const recs: PerFileRec[] = [];
    const windows: [number, number][] = [];
    for (const r of pfRaw as Record<string, unknown>[]) {
      const s = r.startedAtMs as number | undefined;
      const e = r.endedAtMs as number | undefined;
      if (typeof s !== "number" || !Number.isFinite(s) || typeof e !== "number" || !Number.isFinite(e)) continue;
      recs.push({ file: String(r.file ?? ""), startedAtMs: s, endedAtMs: e, passed: r.passed !== false });
      windows.push([s, e]);
    }
    for (const rec of recs) {
      filesWithWindow++;
      if (!rec.passed) failTotal++;
      const stall = windowMeanStall(samples, rec.startedAtMs, rec.endedAtMs);
      if (stall === null) { noPsiInWindow++; continue; }
      if (rec.passed) passWithPsi++; else failWithPsi++;
      const conc = midpointConcurrency(windows, rec.startedAtMs, rec.endedAtMs);
      const b = binOf(conc);
      const stats = bins.find((x) => x.lo === b.lo && x.hi === b.hi)!;
      if (rec.passed) { stats.passN++; stats.passVals.push(stall); }
      else { stats.failN++; stats.failVals.push(stall); }
    }
  }

  let judgeable = 0;
  let positiveSignal = 0;
  for (const b of bins) {
    if (b.failN >= minN) {
      judgeable++;
      if (mean(b.failVals) > mean(b.passVals)) positiveSignal++;
    }
  }
  const verdict = positiveSignal > 0 ? "signal" : judgeable > 0 ? "no-signal" : "insufficient";
  return {
    carrierFound: true as const,
    roundsWithPerFile: roundsWithPerFile.length,
    matchedRounds,
    filesWithWindow,
    failTotal,
    passWithPsi,
    failWithPsi,
    noPsiInWindow,
    minN,
    bins,
    verdict,
  };
}

// ── (a) active induction ───────────────────────────────────────────────────────────
function readIsolationViolations(root: string): Set<string> {
  const set = new Set<string>();
  const file = path.join(root, "plugin", "test-isolation-violations.txt");
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return set;
  }
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith("#")) continue;
    const idx = s.indexOf(":");
    if (idx === -1) continue;
    const rel = s.slice(0, idx).trim();
    if (rel) set.add(rel);
  }
  return set;
}

interface CandidateSet {
  core: string[];
  serial: string[];
  lowconc: string[];
  excluded: string[];
}

function enumerateCandidates(root: string, includeAllGroups: boolean): CandidateSet {
  const iso = readIsolationViolations(root);
  const core: string[] = [];
  const serial: string[] = [];
  const lowconc: string[] = [];
  const excluded: string[] = [];
  for (const rel of CORE_CANDIDATES) {
    if (iso.has(rel)) { excluded.push(rel); continue; }
    core.push(rel);
  }
  if (includeAllGroups) {
    const all = canonicalTestFiles(root);
    for (const rel of all) {
      const abs = path.join(root, rel);
      const g = classifyFile(abs); // fail-closed on unknown group (green repo)
      if (g !== "serial" && g !== "lowconc") continue;
      if (iso.has(rel)) { if (!excluded.includes(rel)) excluded.push(rel); continue; }
      if (core.includes(rel)) continue;
      (g === "serial" ? serial : lowconc).push(rel);
    }
  }
  return { core, serial, lowconc, excluded };
}

function spawnBusyWait(count: number, durationMs: number): { proc: ReturnType<typeof spawn> }[] {
  const procs: { proc: ReturnType<typeof spawn> }[] = [];
  for (let i = 0; i < count; i++) {
    const proc = spawn(
      process.execPath,
      ["-e", `const e=Date.now()+${durationMs}; while(Date.now()<e);`],
      { stdio: "ignore" }
    );
    procs.push({ proc });
  }
  return procs;
}

interface ActiveTrial {
  file: string;
  loadProcs: number;
  passed: boolean;
  code: number | null;
  wallMs: number;
  timeoutMs: number; // 订正⑥: the per-candidate --test-timeout-ms actually used (for three-state classification)
  cpuStallMean: number;
  cpuStallMax: number;
  cpuStallN: number;
  runDelayNs: number; // 订正⑤: cumulative run_delay of the tested process tree during the trial (ns)
  timedOut: boolean;
  errorSignature: string | null;
  adjudication: "pass" | "isolation-conflict" | "scheduling-like" | "other";
}

function adjudicate(passed: boolean, timedOut: boolean, output: string): ActiveTrial["adjudication"] {
  if (passed) return "pass";
  if (timedOut) return "scheduling-like"; // a wall-clock timeout is the prototype scheduling failure
  if (ISOLATION_CONFLICT_RE.test(output)) return "isolation-conflict";
  if (SCHEDULING_RE.test(output)) return "scheduling-like";
  return "other";
}

// 订正⑥ three-state hit classification. A "hit" (a load-induced scheduling-like failure) is not
// homogeneous evidence: it must be one of 真实复现 (real-reproduction) / 被截断不构成证据 (truncated)
// / 疑似设计意图需另行分诊 (design-intent). Only 真实复现 counts toward go/no-go; the other two are
// reported but excluded (AC1: 三态归类缺失，把命中一律当同质证据合并 ⇒ 假).
type HitClass = "real-reproduction" | "truncated" | "design-intent";

function classifyHit(t: ActiveTrial): HitClass {
  const cfg = CANDIDATE_CONFIG[t.file];
  if (cfg?.designIntent) return "design-intent";                 // 订正⑥: internal hang-detection, not a defect
  if (cfg?.histFailMs && t.timeoutMs < cfg.histFailMs[1]) return "truncated"; // timeout below the real failure range
  return "real-reproduction";
}

function extractErrorSignature(output: string): string | null {
  const lines = output.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  const err = lines.find((l) => /error|fail|assert|timeout|exception/i.test(l));
  if (!err) return null;
  return err.slice(0, 160);
}

async function runActiveTrial(fileAbs: string, rel: string, loadProcs: number, cwd: string, timeoutMs: number, injectWindowMs: number): Promise<ActiveTrial> {
  const busy = spawnBusyWait(loadProcs, injectWindowMs);
  await sleep(1500); // let the busy-wait load register in the 10s PSI window
  const stalls: number[] = [];
  let childPid: number | null = null;
  let runDelayMaxNs = 0;
  const s0 = readCpuStall();
  if (s0 !== null) stalls.push(s0);

  // Inline the test spawn (was runNodeTest) so we can sample the child's process-tree run_delay
  // while it runs (订正⑤). Spawn → await → kill the busy-wait load all inside this one control flow.
  const res = await new Promise<{ code: number | null; stdout: string; stderr: string; wallMs: number; timedOut: boolean }>((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const start = Date.now();
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(process.execPath, ["--test", fileAbs], { cwd, env: process.env });
    } catch (err) {
      resolve({ code: 1, stdout: "", stderr: String(err), wallMs: 0, timedOut: false });
      return;
    }
    childPid = child.pid ?? null;
    child.stdout?.on("data", (d) => { stdout += String(d); });
    child.stderr?.on("data", (d) => { stderr += String(d); });
    const timer = setTimeout(() => { timedOut = true; try { child.kill("SIGKILL"); } catch { /* ignore */ } }, timeoutMs);
    const sampler = setInterval(() => {
      const s = readCpuStall();
      if (s !== null) stalls.push(s);
      if (childPid !== null) {
        const rd = readTreeRunDelayNs(childPid);
        if (rd > runDelayMaxNs) runDelayMaxNs = rd;
      }
    }, 1000);
    child.on("close", (code) => {
      clearTimeout(timer);
      clearInterval(sampler);
      resolve({ code, stdout, stderr, wallMs: Date.now() - start, timedOut });
    });
  });

  const s1 = readCpuStall();
  if (s1 !== null) stalls.push(s1);
  if (childPid !== null) {
    const rd = readTreeRunDelayNs(childPid);
    if (rd > runDelayMaxNs) runDelayMaxNs = rd;
  }
  for (const b of busy) { try { b.proc.kill("SIGKILL"); } catch { /* ignore */ } }
  const output = `${res.stdout}\n${res.stderr}`;
  const passed = res.code === 0 && !res.timedOut;
  return {
    file: rel,
    loadProcs,
    passed,
    code: res.code,
    wallMs: res.wallMs,
    timeoutMs,
    cpuStallMean: mean(stalls),
    cpuStallMax: max(stalls),
    cpuStallN: stalls.length,
    runDelayNs: runDelayMaxNs,
    timedOut: res.timedOut,
    errorSignature: passed ? null : extractErrorSignature(output),
    adjudication: adjudicate(passed, res.timedOut, output),
  };
}

async function activeRun(root: string, args: ReturnType<typeof parseArgs>): Promise<{
  candidates: CandidateSet;
  trials: ActiveTrial[];
  validFailures: ActiveTrial[];
  isolationFailures: ActiveTrial[];
  unverified: string[];   // 订正⑥: candidates skipped because their honest timeout exceeds the budget
  loadLevels: number[];
}> {
  const candidates = enumerateCandidates(root, args.includeAllGroups);
  const rels = [...candidates.core, ...candidates.serial, ...candidates.lowconc];
  const trials: ActiveTrial[] = [];
  const unverified: string[] = [];
  for (const rel of rels) {
    const cfg = CANDIDATE_CONFIG[rel];
    if (cfg?.unverifiableInBudget) { unverified.push(rel); continue; } // 订正⑥: never run under a shorter timeout
    const timeoutMs = cfg?.timeoutMs ?? args.testTimeoutMs;
    const abs = path.join(root, rel);
    for (const loadProcs of args.loadLevels) {
      for (let t = 0; t < args.trials; t++) {
        const trial = await runActiveTrial(abs, rel, loadProcs, root, timeoutMs, args.injectWindowMs);
        trials.push(trial);
      }
    }
  }
  const validFailures = trials.filter((t) => t.adjudication === "scheduling-like");
  const isolationFailures = trials.filter((t) => t.adjudication === "isolation-conflict");
  return { candidates, trials, validFailures, isolationFailures, unverified, loadLevels: args.loadLevels };
}

interface ActiveMechanism {
  loadInduced: ActiveTrial[];
  hitClasses: Map<string, HitClass>;    // file -> three-state classification (订正⑥)
  evidence: ActiveTrial[];              // loadInduced hits classified 真实复现 — the only go/no-go evidence
  baselineRunDelay: Map<string, number>; // file -> low-load (loadProcs=0) run_delay (ns)
  confirmed: ActiveTrial[];              // evidence hits whose run_delay is significantly elevated (mechanism confirmed)
  verdict: "signal" | "no-signal" | "insufficient";
}

// 订正⑤: mechanism confirmation replaces the MIN_N_ACTIVE count threshold. A "load-induced" failure
// = a valid (non-isolation) failure under a HIGH-load trial (loadProcs > 0) whose file did NOT also
// fail scheduling-like under the LOW-load baseline (a deterministic failure that reproduces at
// loadProcs=0 is not load-induced — it would fire the signal spuriously). 订正⑥: among load-induced
// hits, ONLY 真实复现 (real-reproduction) counts as evidence — truncated and design-intent hits are
// reported but excluded (三态归类). Among real-reproduction hits, the verdict rests on run_delay
// mechanism confirmation, NOT on the hit count: signal iff ≥1 hit's run_delay is significantly
// elevated over its own low-load baseline (schedule-out, the quantity PSI tracks); no-signal otherwise.
function activeMechanism(validFailures: ActiveTrial[], trials: ActiveTrial[], loadLevels: number[]): ActiveMechanism {
  const empty: ActiveMechanism = { loadInduced: [], hitClasses: new Map(), evidence: [], baselineRunDelay: new Map(), confirmed: [], verdict: "insufficient" };
  if (trials.length === 0) return empty;
  const highLoadLevels = loadLevels.filter((n) => n > 0);
  if (highLoadLevels.length === 0) return empty;
  const lowLoadFailFiles = new Set(validFailures.filter((f) => f.loadProcs === 0).map((f) => f.file));
  const loadInduced = validFailures.filter((f) => f.loadProcs > 0 && !lowLoadFailFiles.has(f.file));
  const hitClasses = new Map<string, HitClass>();
  const evidence: ActiveTrial[] = [];
  for (const f of loadInduced) {
    const cls = classifyHit(f);
    hitClasses.set(f.file, cls);
    if (cls === "real-reproduction") evidence.push(f); // 订正⑥: only real-reproduction is evidence
  }
  const baselineRunDelay = new Map<string, number>();
  for (const t of trials) {
    if (t.loadProcs !== 0) continue;
    const prev = baselineRunDelay.get(t.file) ?? 0;
    baselineRunDelay.set(t.file, Math.max(prev, t.runDelayNs));
  }
  const confirmed = evidence.filter((f) => {
    const base = baselineRunDelay.get(f.file) ?? 0;
    return f.runDelayNs >= MIN_RUN_DELAY_NS && f.runDelayNs >= SIGNIFICANT_RUN_DELAY_RATIO * Math.max(base, 1);
  });
  const verdict = evidence.length === 0 ? "no-signal" : confirmed.length > 0 ? "signal" : "no-signal";
  return { loadInduced, hitClasses, evidence, baselineRunDelay, confirmed, verdict };
}

// ── report ─────────────────────────────────────────────────────────────────────────
function binLabel(b: { lo: number; hi: number }): string {
  return Number.isFinite(b.hi) ? `${b.lo}-${b.hi}` : `${b.lo}+`;
}

function printActive(res: Awaited<ReturnType<typeof activeRun>>): void {
  const { candidates, trials, validFailures, isolationFailures, unverified, loadLevels } = res;
  console.log("── (a) 主动制造 (primary) ──");
  console.log(`候选: core=${candidates.core.length} serial=${candidates.serial.length} lowconc=${candidates.lowconc.length}`);
  console.log(`隔离违规排除: ${candidates.excluded.length} 个 → ${candidates.excluded.join(", ") || "(无)"}`);
  if (unverified.length > 0) console.log(`未验证(预算外跳过, 订正⑥): ${unverified.join(", ")}`);
  console.log(`load levels (busy-wait procs): [${loadLevels.join(", ")}]  | trials 总数=${trials.length}`);
  const byLoad = new Map<number, ActiveTrial[]>();
  for (const t of trials) {
    const arr = byLoad.get(t.loadProcs) ?? [];
    arr.push(t);
    byLoad.set(t.loadProcs, arr);
  }
  for (const lv of loadLevels) {
    const arr = byLoad.get(lv) ?? [];
    const pass = arr.filter((t) => t.passed).length;
    const fail = arr.length - pass;
    const stalls = arr.map((t) => t.cpuStallMean).filter((n) => Number.isFinite(n));
    console.log(`  load=${String(lv).padStart(3)}  trials=${String(arr.length).padStart(3)}  pass=${pass}  fail=${fail}  cpu_stall均值=${fmt(mean(stalls))}  max=${fmt(max(stalls))}`);
  }
  console.log(`有效失败样本（非隔离冲突）: ${validFailures.length} | 隔离冲突失败(已排除): ${isolationFailures.length}`);
  for (const t of [...validFailures, ...isolationFailures]) {
    console.log(`  [${t.adjudication}] ${t.file}  load=${t.loadProcs}  cpu_stall均值=${fmt(t.cpuStallMean)}  run_delay=${fmtRunDelay(t.runDelayNs)}  sig=${t.errorSignature ?? "(无)"}`);
  }
  // 订正⑤ mechanism confirmation — the verdict axis (not the hit count), 订正⑥ three-state classification
  const mech = activeMechanism(validFailures, trials, loadLevels);
  const CLS_LABEL: Record<HitClass, string> = { "real-reproduction": "真实复现", "truncated": "被截断", "design-intent": "疑似设计意图" };
  console.log(`load-induced 命中样本: ${mech.loadInduced.length} | 真实复现(证据): ${mech.evidence.length} | run_delay 机制确认: ${mech.confirmed.length}/${mech.evidence.length}`);
  for (const t of mech.loadInduced) {
    const cls = mech.hitClasses.get(t.file) ?? "real-reproduction";
    const base = mech.baselineRunDelay.get(t.file) ?? 0;
    const ratio = base > 0 ? t.runDelayNs / base : Number.POSITIVE_INFINITY;
    const ok = t.runDelayNs >= MIN_RUN_DELAY_NS && t.runDelayNs >= SIGNIFICANT_RUN_DELAY_RATIO * Math.max(base, 1);
    const tag = cls === "real-reproduction" ? (ok ? "机制确认" : "机制未确认") : "不计入证据";
    console.log(`  [${CLS_LABEL[cls]}] ${t.file}  load=32 run_delay=${fmtRunDelay(t.runDelayNs)} vs load=0 基线=${fmtRunDelay(base)}  比值=${Number.isFinite(ratio) ? ratio.toFixed(1) + "×" : "∞"}  ${tag}`);
  }
}

function printPassive(res: ReturnType<typeof passiveAnalyze>): void {
  if (!res.carrierFound) {
    console.log("── (b) 被动历史 (supplementary) ──");
    console.log(`载体未找到: ${res.path} — 在干净 worktree 里不传 --root 就会这样（fail-closed，不是空数据合格）`);
    return;
  }
  console.log("── (b) 被动历史 (supplementary) ──");
  console.log(`rounds(含 perFile)=${res.roundsWithPerFile} matched=${res.matchedRounds} | perFile 有时间窗=${res.filesWithWindow} passed:false=${res.failTotal}`);
  console.log(`窗内有 PSI: pass=${res.passWithPsi} fail=${res.failWithPsi} | 无采样排除=${res.noPsiInWindow} | MIN_N=${res.minN}`);
  console.log("  并发区间  通过N  通过均值  失败N  失败均值  差值(失败-通过)  判定");
  for (const b of res.bins) {
    const pv = [...b.passVals].sort((x, y) => x - y);
    const fv = [...b.failVals].sort((x, y) => x - y);
    const pMean = mean(pv);
    const fMean = mean(fv);
    const delta = Number.isFinite(pMean) && Number.isFinite(fMean) ? fMean - pMean : Number.NaN;
    const judge = b.failN < res.minN ? "样本不足" : (delta > 0 ? "信号" : "无信号");
    console.log(
      `  ${binLabel(b).padStart(8)}  ${String(b.passN).padStart(6)} ${fmt(pMean).padStart(8)} ${String(b.failN).padStart(6)} ${fmt(fMean).padStart(8)} ${fmt(delta).padStart(14)}  ${judge}`
    );
  }
}

function printJson(args: ReturnType<typeof parseArgs>, active: Awaited<ReturnType<typeof activeRun>> | null, passive: ReturnType<typeof passiveAnalyze> | null, verdict: string): void {
  const out: Record<string, unknown> = { verdict };
  if (active) {
    const mech = activeMechanism(active.validFailures, active.trials, active.loadLevels);
    out.active = {
      candidates: {
        core: active.candidates.core.length,
        serial: active.candidates.serial.length,
        lowconc: active.candidates.lowconc.length,
        excluded: active.candidates.excluded,
      },
      loadLevels: active.loadLevels,
      injectWindowMs: args.injectWindowMs,
      trials: active.trials.map((t) => ({
        file: t.file, loadProcs: t.loadProcs, passed: t.passed, code: t.code, wallMs: t.wallMs,
        timeoutMs: t.timeoutMs,
        cpuStallMean: t.cpuStallMean, cpuStallMax: t.cpuStallMax, runDelayNs: t.runDelayNs,
        adjudication: t.adjudication, errorSignature: t.errorSignature,
      })),
      validFailureCount: active.validFailures.length,
      isolationFailureCount: active.isolationFailures.length,
      unverified: active.unverified,
      mechanism: {
        loadInducedCount: mech.loadInduced.length,
        evidenceCount: mech.evidence.length,
        confirmedCount: mech.confirmed.length,
        significantRunDelayRatio: SIGNIFICANT_RUN_DELAY_RATIO,
        minRunDelayNs: MIN_RUN_DELAY_NS,
        hits: mech.loadInduced.map((t) => ({
          file: t.file,
          hitClass: mech.hitClasses.get(t.file) ?? "real-reproduction",
          runDelayNs: t.runDelayNs,
          baselineRunDelayNs: mech.baselineRunDelay.get(t.file) ?? 0,
          confirmed: mech.confirmed.includes(t),
        })),
      },
    };
  }
  if (passive && passive.carrierFound) {
    out.passive = {
      roundsWithPerFile: passive.roundsWithPerFile, matchedRounds: passive.matchedRounds,
      filesWithWindow: passive.filesWithWindow, failTotal: passive.failTotal,
      passWithPsi: passive.passWithPsi, failWithPsi: passive.failWithPsi, noPsiInWindow: passive.noPsiInWindow,
      minN: passive.minN,
      bins: passive.bins.map((b) => {
        const pv = [...b.passVals].sort((x, y) => x - y);
        const fv = [...b.failVals].sort((x, y) => x - y);
        return {
          bin: binLabel(b), passN: b.passN, passMean: mean(pv), passMedian: median(pv),
          failN: b.failN, failMean: mean(fv), failMedian: median(fv),
          delta: Number.isFinite(mean(pv)) && Number.isFinite(mean(fv)) ? mean(fv) - mean(pv) : null,
          verdict: b.failN < passive.minN ? "insufficient" : (mean(fv) > mean(pv) ? "signal" : "no-signal"),
        };
      }),
    };
  } else if (passive && !passive.carrierFound) {
    out.passive = { carrierFound: false, path: passive.path };
  }
  process.stdout.write(JSON.stringify(out, null, 2) + "\n");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(
      "psi-failure-correlation-check.ts — Phase 0 回溯分析（PSI 对失败的增量预测力）\n" +
      "usage: node --experimental-strip-types plugin/scripts/psi-failure-correlation-check.ts " +
      "[--source active|passive|both] [--root <repo-root>] [--trials N] [--load-levels 0,N] [--inject-window-ms N] [--include-all-groups] [--json]\n"
    );
    return;
  }
  let active: Awaited<ReturnType<typeof activeRun>> | null = null;
  let passive: ReturnType<typeof passiveAnalyze> | null = null;

  if (args.source === "active" || args.source === "both") {
    active = await activeRun(repoRoot(), args);
    if (!args.json) printActive(active);
  }
  if (args.source === "passive" || args.source === "both") {
    const root = resolveCarrierRoot(args.root);
    passive = passiveAnalyze(root, args.minNPassive);
    if (!args.json) printPassive(passive);
    if (passive && !passive.carrierFound) {
      process.exitCode = 2; // fail-closed: carrier absent is NOT an empty-but-valid result (AC2)
    }
  }

  let verdict = "insufficient";
  if (active) {
    verdict = activeMechanism(active.validFailures, active.trials, active.loadLevels).verdict;
  } else if (passive && passive.carrierFound) {
    verdict = passive.verdict;
  }
  if (args.json) {
    printJson(args, active, passive, verdict);
  } else {
    console.log("");
    console.log(`GO/NO-GO 结论(主=主动, 辅=被动): ${verdict === "signal" ? "有增量信号，进入 Phase 1" : verdict === "no-signal" ? "无增量信号，Phase 1 不做" : "样本不足，Phase 1 不做"}`);
  }
}

const isDirect =
  process.argv[1] && path.basename(process.argv[1]).replace(/\.(?:js|ts|mjs)$/, "") === "psi-failure-correlation-check";
if (isDirect) {
  await main();
}
