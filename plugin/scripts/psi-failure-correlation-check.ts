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
//   (a) 主动制造 (ACTIVE, primary, 规模受控 per 订正③) — enumerate the 5 verified-clean CORE
//       candidates (full serial/lowconc groups are OPTIONAL via --include-all-groups, never a hard
//       requirement), EXCLUDE any file listed in plugin/test-isolation-violations.txt (hard
//       constraint, AC1), then run each candidate under a SHORT background CPU-load burst
//       (busy-wait subprocesses saturating cores, injection window ≤10s default 5s — the 订正③ fix
//       for the orphan-process root cause; the discussion-phase control experiment needed only 2s
//       for a 650× runDelay signal), sampling the REAL /proc/pressure/cpu `some avg10` during each
//       trial and recording pass/fail + the failure's error signature. ANY induced failure is
//       adjudicated against known isolation-conflict signatures (EADDRINUSE / EEXIST / port-in-use)
//       BEFORE it counts as a valid (scheduling-like) failure — the adjudication itself is recorded,
//       never just pass/fail counts. Busy-wait procs are spawned → awaited → killed within the SAME
//       control flow (no cross-tool-call polling, no orphan).
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
// MIN-N (honest small-sample floor, AC3): each source defines its own minimum sample N; a bin
// whose fail-group N is below the floor reports 「样本不足」, never a direction (硬规则 3b).
//   - active   MIN_N_ACTIVE   = 5 valid failures (induced + adjudicated non-isolation).
//   - passive  MIN_N_PASSIVE  = 10 fail records in a concurrency bin.
//
// GO/NO-GO (deterministic): primary = active source; passive is cross-validation.
//   - signal        iff the active source produced >= MIN_N_ACTIVE valid (non-isolation)
//                   load-induced failures — i.e. a scheduling-like failure under a HIGH-load trial
//                   whose file did NOT also fail scheduling-like under the LOW-load baseline (a
//                   deterministic failure that reproduces at loadProcs=0 is not load-induced, and
//                   would fire the signal spuriously). Below MIN_N_ACTIVE the floor rule applies:
//                   the source reports 样本不足, never a direction (AC3).
//   - no-signal     iff the active experiment ran to completion but produced no load-induced
//                   failure (candidates pass under both load levels, or failures are
//                   isolation-conflicts / deterministic).
//   - insufficient  iff the active experiment could not run enough trials to judge (no high-load
//                   baseline, or valid load-induced failures below MIN_N_ACTIVE).
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
//   --include-all-groups  OPTIONAL: expand the candidate set from the 5 core candidates to the full
//                     serial+lowconc groups (订正③: core-5 is mandatory, full groups are a budget
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
const MIN_N_ACTIVE = 5;

// The proposal's verified-clean historical-failure candidates — the MANDATORY core set (订正③, AC1):
// exactly these 5, covering serial/engine/lowconc groups and varied historical failure counts. The
// full serial/lowconc group enumeration is an OPTIONAL extension (--include-all-groups), never a hard
// requirement. The earlier design ("full serial/lowconc + extras", minute-scale load windows) was the
// needs-human 复盘's root cause — scale far beyond a single worker session's budget.
const CORE_CANDIDATES = [
  "plugin/test/help-contract-incompatible-behaviors.test.mjs", // serial, 15x
  "plugin/test/writestate-atomicity-split.test.mjs",           // engine, 14x
  "plugin/test/worker-driver-fan-in.test.mjs",                 // lowconc, 11x
  "plugin/test/worker-driver-resident.test.mjs",               // lowconc, 7x
  "plugin/test/suite-bucket-reattr-ratchet-check.test.mjs",    // engine, 5x
];

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

function runNodeTest(fileAbs: string, cwd: string, timeoutMs: number): Promise<{ code: number | null; stdout: string; stderr: string; wallMs: number; timedOut: boolean }> {
  return new Promise((resolve) => {
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
    child.stdout?.on("data", (d) => { stdout += String(d); });
    child.stderr?.on("data", (d) => { stderr += String(d); });
    const timer = setTimeout(() => { timedOut = true; try { child.kill("SIGKILL"); } catch { /* ignore */ } }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, wallMs: Date.now() - start, timedOut });
    });
  });
}

interface ActiveTrial {
  file: string;
  loadProcs: number;
  passed: boolean;
  code: number | null;
  wallMs: number;
  cpuStallMean: number;
  cpuStallMax: number;
  cpuStallN: number;
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
  const s0 = readCpuStall();
  if (s0 !== null) stalls.push(s0);
  const sampler = setInterval(() => {
    const s = readCpuStall();
    if (s !== null) stalls.push(s);
  }, 1000);
  const res = await runNodeTest(fileAbs, cwd, timeoutMs);
  clearInterval(sampler);
  const s1 = readCpuStall();
  if (s1 !== null) stalls.push(s1);
  for (const b of busy) { try { b.proc.kill("SIGKILL"); } catch { /* ignore */ } }
  const output = `${res.stdout}\n${res.stderr}`;
  const passed = res.code === 0 && !res.timedOut;
  return {
    file: rel,
    loadProcs,
    passed,
    code: res.code,
    wallMs: res.wallMs,
    cpuStallMean: mean(stalls),
    cpuStallMax: max(stalls),
    cpuStallN: stalls.length,
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
  loadLevels: number[];
}> {
  const candidates = enumerateCandidates(root, args.includeAllGroups);
  const rels = [...candidates.core, ...candidates.serial, ...candidates.lowconc];
  const trials: ActiveTrial[] = [];
  for (const rel of rels) {
    const abs = path.join(root, rel);
    for (const loadProcs of args.loadLevels) {
      for (let t = 0; t < args.trials; t++) {
        const trial = await runActiveTrial(abs, rel, loadProcs, root, args.testTimeoutMs, args.injectWindowMs);
        trials.push(trial);
      }
    }
  }
  const validFailures = trials.filter((t) => t.adjudication === "scheduling-like");
  const isolationFailures = trials.filter((t) => t.adjudication === "isolation-conflict");
  return { candidates, trials, validFailures, isolationFailures, loadLevels: args.loadLevels };
}

function activeVerdict(validFailures: ActiveTrial[], trials: ActiveTrial[], loadLevels: number[]) {
  if (trials.length === 0) return "insufficient";
  // a load-induced failure = a valid (non-isolation) failure under a HIGH-load trial (loadProcs > 0)
  // whose file did NOT also fail (scheduling-like) under the LOW-load baseline (loadProcs === 0) —
  // a deterministic failure that reproduces at loadProcs=0 is not load-induced (AC3: it would fire
  // the signal spuriously).
  const highLoadLevels = loadLevels.filter((n) => n > 0);
  if (highLoadLevels.length === 0) return "insufficient";
  const lowLoadFailFiles = new Set(validFailures.filter((f) => f.loadProcs === 0).map((f) => f.file));
  const loadInduced = validFailures.filter((f) => f.loadProcs > 0 && !lowLoadFailFiles.has(f.file));
  if (loadInduced.length === 0) return "no-signal";
  return loadInduced.length >= MIN_N_ACTIVE ? "signal" : "insufficient";
}

// ── report ─────────────────────────────────────────────────────────────────────────
function binLabel(b: { lo: number; hi: number }): string {
  return Number.isFinite(b.hi) ? `${b.lo}-${b.hi}` : `${b.lo}+`;
}

function printActive(res: Awaited<ReturnType<typeof activeRun>>): void {
  const { candidates, trials, validFailures, isolationFailures, loadLevels } = res;
  console.log("── (a) 主动制造 (primary) ──");
  console.log(`候选: core=${candidates.core.length} serial=${candidates.serial.length} lowconc=${candidates.lowconc.length}`);
  console.log(`隔离违规排除: ${candidates.excluded.length} 个 → ${candidates.excluded.join(", ") || "(无)"}`);
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
    console.log(`  [${t.adjudication}] ${t.file}  load=${t.loadProcs}  cpu_stall均值=${fmt(t.cpuStallMean)}  sig=${t.errorSignature ?? "(无)"}`);
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
        cpuStallMean: t.cpuStallMean, cpuStallMax: t.cpuStallMax, adjudication: t.adjudication,
        errorSignature: t.errorSignature,
      })),
      validFailureCount: active.validFailures.length,
      isolationFailureCount: active.isolationFailures.length,
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
    verdict = activeVerdict(active.validFailures, active.trials, active.loadLevels);
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
