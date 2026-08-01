// composite-audit.ts — M189/DIR-119-B Stage 2.4: read-only audit shards.
//
// A shard audits the FINAL integrated candidate and returns immutable per-task/per-AC verdicts
// plus a bundle verdict. This module enforces the hard architectural boundary the milestone
// requires: "NO auditor ticks boxes, writes absorb dispositions, updates dashboards, or changes
// lifecycle state." `runReadOnlyAuditShard` gives the shard function an ISOLATED, deep-frozen
// snapshot of state — not the real object — so even a shard implementation that tries to mutate
// it (a) throws (ES modules are strict-mode by default; assigning to a frozen property is a
// TypeError) and (b) could not have reached the real state even if it caught that error, because
// the snapshot was structurally cloned before freezing. The negative-control test in this file's
// selftest() exercises exactly that: a hostile shard fn attempts a mutation, and the REAL state
// object passed in is proven byte-identical before/after the call.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

// ── Types ───────────────────────────────────────────────────────────────────────────────────────────

export type Verdict = "PASS" | "REFUTED" | "CONCERNS";

export interface TaskAcVerdict {
  taskId: string;
  acIndex: number;
  verdict: Verdict;
  detail: string;
}

export interface AuditShardResult {
  shardId: string;
  verdicts: TaskAcVerdict[];
  shardVerdict: Verdict;
}

export interface BundleAuditResult {
  candidateId: string;
  shardResults: AuditShardResult[];
  bundleVerdict: Verdict;
  generationId?: string;
}

/** The read-only view a shard function is allowed to inspect. Never the real backing store. */
export interface CandidateStateView {
  tasks: Record<string, { status: string; checkboxes: Record<string, boolean> }>;
  absorbDispositions: Record<string, string>;
  dashboardEntries: string[];
  milestoneCounter: number;
}

export type ShardOutcome<T> = { ok: true; result: T } | { ok: false; violation: string };

// ── deepFreeze / deepClone ─────────────────────────────────────────────────────────────────────────

function deepFreeze<T>(obj: T): T {
  if (obj !== null && typeof obj === "object" && !Object.isFrozen(obj)) {
    for (const name of Object.getOwnPropertyNames(obj)) {
      const val = (obj as Record<string, unknown>)[name];
      if (val && typeof val === "object") deepFreeze(val);
    }
    Object.freeze(obj);
  }
  return obj;
}

/** Structural clone so a shard function can NEVER reach the caller's real object graph, even via
 *  a reference captured before freezing. `structuredClone` is available globally since Node 17. */
function isolate<T>(value: T): T {
  return structuredClone(value);
}

// ── runReadOnlyAuditShard ──────────────────────────────────────────────────────────────────────────

export function runReadOnlyAuditShard<T>(
  stateView: CandidateStateView,
  shardFn: (frozenView: CandidateStateView) => T,
): ShardOutcome<T> {
  const beforeSnapshot = JSON.stringify(stateView);
  const frozen = deepFreeze(isolate(stateView));
  try {
    const result = shardFn(frozen);
    const afterSnapshot = JSON.stringify(stateView);
    if (beforeSnapshot !== afterSnapshot) {
      // Should be unreachable given isolation above — kept as a belt-and-suspenders hard failure.
      return { ok: false, violation: "read-only-violation: real state object changed despite isolation" };
    }
    return { ok: true, result };
  } catch (err) {
    if (err instanceof TypeError) {
      return { ok: false, violation: `read-only-violation: ${(err as Error).message}` };
    }
    throw err;
  }
}

// ── combineShardVerdicts (Stage 2.4: immutable per-task/per-AC verdicts + one bundle verdict) ───────

export function combineShardVerdicts(shardResults: AuditShardResult[], candidateId: string, generationId?: string): BundleAuditResult {
  const allVerdicts = shardResults.flatMap((s) => s.verdicts);
  const hasRefuted = shardResults.some((s) => s.shardVerdict === "REFUTED") || allVerdicts.some((v) => v.verdict === "REFUTED");
  const hasConcerns = shardResults.some((s) => s.shardVerdict === "CONCERNS") || allVerdicts.some((v) => v.verdict === "CONCERNS");
  const bundleVerdict: Verdict = hasRefuted ? "REFUTED" : hasConcerns ? "CONCERNS" : "PASS";
  return { candidateId, shardResults, bundleVerdict, generationId };
}

// ── snapshot / guard / combine-json: mechanically-enforced read-only audit shards (DIR-119-D3 / M211) ──
//
// runReadOnlyAuditShard's deepFreeze/structuredClone isolation above binds ONLY in-process JS
// object mutation — it is PROVABLY BLIND to a shard's real filesystem writes (the AC5 negative
// control in this file's sibling test asserts exactly that: a shard fn performs a real
// fs.writeFileSync and outcome.ok is still true). These modes add the enforcement surface that
// CAN see real filesystem effects: a `git status --porcelain=v1 --untracked-files=all` snapshot
// taken before and after a shard's inspection window, diffed by the CALLER — the workflow itself
// (execute-milestone.js's inline _diffAuditSnapshotLines), never the shard's self-report. The
// --guard CLI form wraps the same diff for a shard's own recorded double-check; the workflow's
// diff of the raw returned snapshots is the load-bearing enforcement point. Trust-boundary
// limitation stated plainly: mechanical adjudication of returned command output within the
// existing agent/tool boundary, NOT a cryptographic attestation that an agent cannot forge its
// own output — raw snapshot retention in the journaled typed return is the auditability backstop.

/** Snapshot the working tree's REAL filesystem state: `git status --porcelain=v1
 *  --untracked-files=all` lines, split/sorted/normalized. The --untracked-files=all flag is
 *  load-bearing — a shard dropping a NEW file is the primary hostile case. */
export function takeGitSnapshot(cwd: string = process.cwd()): string[] {
  const out = execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd, encoding: "utf8" });
  return out.split("\n").filter((line) => line.length > 0).sort();
}

/** Line-multiset delta (added ∪ removed), order-stable (sorted keys). Empty array ⟺ clean. */
export function diffGitSnapshots(before: string[], after: string[]): string[] {
  const beforeCounts = new Map<string, number>();
  const afterCounts = new Map<string, number>();
  for (const line of before) beforeCounts.set(line, (beforeCounts.get(line) ?? 0) + 1);
  for (const line of after) afterCounts.set(line, (afterCounts.get(line) ?? 0) + 1);
  const delta: string[] = [];
  const allKeys = [...new Set([...beforeCounts.keys(), ...afterCounts.keys()])].sort();
  for (const key of allKeys) {
    const n = afterCounts.get(key) ?? 0;
    const m = beforeCounts.get(key) ?? 0;
    for (let i = 0; i < n - m; i++) delta.push(`+ ${key}`);
    for (let i = 0; i < m - n; i++) delta.push(`- ${key}`);
  }
  return delta;
}

/** Mechanical read-only adjudication of one shard's before/after snapshots. The violation string
 *  is EXACTLY `audit-shard-write-violation:<shardId>`. Delegates to diffGitSnapshots — single
 *  diff implementation, no duplicated comparison logic. */
export function guardShardReadOnly(
  shardId: string,
  before: string[],
  after: string[],
): { ok: true } | { ok: false; violation: string; delta: string[] } {
  const delta = diffGitSnapshots(before, after);
  if (delta.length === 0) return { ok: true };
  return { ok: false, violation: `audit-shard-write-violation:${shardId}`, delta };
}

/** THIN wrapper delegating to the exported combineShardVerdicts — NEVER a reimplementation
 *  (DIR-119-D3 AC3: the audit-combine dispatch must invoke the real combine logic). */
export function combineShardVerdictsFromJson(
  shardResults: AuditShardResult[],
  candidateId: string,
  generationId?: string,
): BundleAuditResult {
  return combineShardVerdicts(shardResults, candidateId, generationId);
}

// ── selftest ───────────────────────────────────────────────────────────────────────────────────────

export function selftest(): boolean {
  let allPassed = true;
  function check(name: string, condition: boolean, detail: string): void {
    if (condition) {
      console.log(`SELFTEST PASS: ${name} — ${detail}`);
    } else {
      console.error(`SELFTEST FAIL: ${name} — ${detail}`);
      allPassed = false;
    }
  }

  const makeState = (): CandidateStateView => ({
    tasks: { "T-0": { status: "ready", checkboxes: { "ac-0": false } } },
    absorbDispositions: {},
    dashboardEntries: [],
    milestoneCounter: 41,
  });

  // A well-behaved shard reads state and returns verdicts — no violation.
  {
    const state = makeState();
    const outcome = runReadOnlyAuditShard(state, (view) => {
      return view.tasks["T-0"].status === "ready" ? "PASS" : "REFUTED";
    });
    check("well-behaved-shard-succeeds", outcome.ok === true && outcome.result === "PASS", JSON.stringify(outcome));
  }

  // NEGATIVE CONTROL: a hostile shard tries to mutate task status — must throw / be reported as a violation.
  {
    const state = makeState();
    const beforeJson = JSON.stringify(state);
    const outcome = runReadOnlyAuditShard(state, (view) => {
      (view.tasks["T-0"] as { status: string }).status = "done"; // hostile mutation attempt
      return "should-not-reach-here";
    });
    check("hostile-mutation-attempt-reported-as-violation", outcome.ok === false, JSON.stringify(outcome));
    check("real-state-unchanged-after-hostile-attempt", JSON.stringify(state) === beforeJson, "real state must be byte-identical before/after");
  }

  // NEGATIVE CONTROL: a hostile shard tries to write an absorb disposition — blocked.
  {
    const state = makeState();
    const beforeJson = JSON.stringify(state);
    const outcome = runReadOnlyAuditShard(state, (view) => {
      (view.absorbDispositions as Record<string, string>)["T-0"] = "forged-disposition";
      return "unreachable";
    });
    check("hostile-absorb-write-blocked", outcome.ok === false, JSON.stringify(outcome));
    check("real-state-unchanged-after-absorb-attempt", JSON.stringify(state) === beforeJson, "real state must be byte-identical");
  }

  // NEGATIVE CONTROL: a hostile shard tries to append a dashboard entry (array mutation) — blocked.
  {
    const state = makeState();
    const beforeJson = JSON.stringify(state);
    const outcome = runReadOnlyAuditShard(state, (view) => {
      view.dashboardEntries.push("forged entry");
      return "unreachable";
    });
    check("hostile-dashboard-push-blocked", outcome.ok === false, JSON.stringify(outcome));
    check("real-state-unchanged-after-dashboard-attempt", JSON.stringify(state) === beforeJson, "real state must be byte-identical");
  }

  // NEGATIVE CONTROL: a hostile shard tries to bump the milestone counter — blocked (frozen top-level number field).
  {
    const state = makeState();
    const beforeJson = JSON.stringify(state);
    const outcome = runReadOnlyAuditShard(state, (view) => {
      (view as { milestoneCounter: number }).milestoneCounter = 999;
      return "unreachable";
    });
    check("hostile-counter-write-blocked", outcome.ok === false, JSON.stringify(outcome));
    check("real-state-unchanged-after-counter-attempt", JSON.stringify(state) === beforeJson, "real state must be byte-identical");
  }

  // Isolation: mutating the FROZEN VIEW's nested object is what throws; but even a shard function
  // that captures a totally separate closure over `stateView` cannot exist here, because it never
  // receives `stateView` at all — only the frozen clone. Confirm identity difference.
  {
    const state = makeState();
    let capturedView: CandidateStateView | null = null;
    runReadOnlyAuditShard(state, (view) => {
      capturedView = view;
      return null;
    });
    check("shard-receives-isolated-clone-not-real-object", (capturedView as unknown as CandidateStateView) !== state, "must not be reference-equal to the real state");
  }

  // combineShardVerdicts: any REFUTED verdict anywhere makes the bundle REFUTED.
  {
    const shardResults: AuditShardResult[] = [
      { shardId: "s0", verdicts: [{ taskId: "T-0", acIndex: 0, verdict: "PASS", detail: "" }], shardVerdict: "PASS" },
      { shardId: "s1", verdicts: [{ taskId: "T-1", acIndex: 0, verdict: "REFUTED", detail: "gap" }], shardVerdict: "REFUTED" },
    ];
    const bundle = combineShardVerdicts(shardResults, "c-1");
    check("bundle-refuted-if-any-shard-refuted", bundle.bundleVerdict === "REFUTED", bundle.bundleVerdict);
  }

  // combineShardVerdicts: all-PASS shards produce a PASS bundle.
  {
    const shardResults: AuditShardResult[] = [
      { shardId: "s0", verdicts: [{ taskId: "T-0", acIndex: 0, verdict: "PASS", detail: "" }], shardVerdict: "PASS" },
      { shardId: "s1", verdicts: [{ taskId: "T-1", acIndex: 0, verdict: "PASS", detail: "" }], shardVerdict: "PASS" },
    ];
    const bundle = combineShardVerdicts(shardResults, "c-2");
    check("bundle-pass-if-all-pass", bundle.bundleVerdict === "PASS", bundle.bundleVerdict);
  }

  // One shard covers several homogeneous tasks (Stage 2.4: "one shard may cover several homogeneous tasks").
  {
    const shardResults: AuditShardResult[] = [
      {
        shardId: "s-homogeneous",
        verdicts: [
          { taskId: "T-0", acIndex: 0, verdict: "PASS", detail: "" },
          { taskId: "T-1", acIndex: 0, verdict: "PASS", detail: "" },
          { taskId: "T-2", acIndex: 0, verdict: "PASS", detail: "" },
        ],
        shardVerdict: "PASS",
      },
    ];
    const bundle = combineShardVerdicts(shardResults, "c-3");
    check("one-shard-covers-multiple-tasks", bundle.shardResults[0].verdicts.length === 3, JSON.stringify(bundle.shardResults[0].verdicts.length));
  }

  console.log(`\nSELFTEST: ${allPassed ? "all fixture cases PASS" : "SOME FIXTURES FAILED"}`);
  return allPassed;
}

if (process.argv[1] != null && process.argv[1].endsWith("composite-audit.ts")) {
  const argv = process.argv;
  const argValue = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
  };
  if (argv.includes("--selftest")) {
    process.exitCode = selftest() ? 0 : 1;
  } else if (argv.includes("--snapshot")) {
    // DIR-119-D3 (M211): print the working tree's git-status snapshot as JSON (non-selftest mode;
    // production callsite: execute-milestone.js's per-shard Audit prompt, both mirrors).
    console.log(JSON.stringify({ snapshot: takeGitSnapshot() }));
    process.exitCode = 0;
  } else if (argv.includes("--guard")) {
    // DIR-119-D3 (M211): mechanically diff a shard's before/after snapshots; exit 1 on ANY delta.
    const shardId = argValue("--shard-id");
    const beforePath = argValue("--before");
    if (!shardId || !beforePath) {
      console.error("usage: composite-audit.ts --guard --shard-id <id> --before <file> [--after <file>]");
      process.exitCode = 1;
    } else {
      try {
        const before = JSON.parse(readFileSync(beforePath, "utf8")) as string[];
        const afterPath = argValue("--after");
        const after = afterPath ? (JSON.parse(readFileSync(afterPath, "utf8")) as string[]) : takeGitSnapshot();
        if (!Array.isArray(before) || !Array.isArray(after)) throw new Error("snapshot files must contain string[] JSON");
        const result = guardShardReadOnly(shardId, before, after);
        console.log(JSON.stringify(result));
        process.exitCode = result.ok ? 0 : 1;
      } catch (err) {
        console.error(`--guard failed: ${(err as Error).message}`);
        process.exitCode = 1;
      }
    }
  } else if (argv.includes("--combine-json")) {
    // DIR-119-D3 (M211): wrap the REAL combineShardVerdicts over an AuditShardResult[] JSON file
    // (production callsite: execute-milestone.js's audit-combine dispatch, both mirrors).
    const inPath = argValue("--in");
    const candidateId = argValue("--candidate-id");
    if (!inPath || !candidateId) {
      console.error("usage: composite-audit.ts --combine-json --in <file> --candidate-id <id> [--generation-id <g>]");
      process.exitCode = 1;
    } else {
      try {
        const shardResults = JSON.parse(readFileSync(inPath, "utf8")) as AuditShardResult[];
        if (!Array.isArray(shardResults)) throw new Error("input JSON must be an AuditShardResult[] array");
        console.log(JSON.stringify(combineShardVerdictsFromJson(shardResults, candidateId, argValue("--generation-id"))));
        process.exitCode = 0;
      } catch (err) {
        console.error(`--combine-json failed: ${(err as Error).message}`);
        process.exitCode = 1;
      }
    }
  }
}
