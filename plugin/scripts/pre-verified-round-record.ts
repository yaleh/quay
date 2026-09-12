#!/usr/bin/env node
// pre-verified-round-record.ts — the SHARED verification-round writer for the fan-in suite paths.
// gap-preverified-suite-bypasses-verification-round-ledger AC1/AC2 (the pre-verified branch) +
// gap-fan-in-realsuite-bypasses-verification-round-ledger AC1/AC2 (the real-suite branch).
//
// ⛔ RETIRED FROM THE FAN-IN PATH (gap-fan-in-red-bucket-run-not-recorded, 人裁定「定义正确机制并实现」):
// the fan-in bucket path now runs through full-suite-runner.ts --buckets (SUITE_LAUNCH in
// fan-in-execute.js), which is the single writer of verification-round.jsonl GREEN AND RED — a red bucket
// round is recorded at suite exit, never left unrecorded. This module's green-only writer (state:"green")
// was the parallel harness's graft; its CALL SITE was removed from fan-in-execute.js step 4.5 (两套平行
// 机制收敛为一). The module is retained (uncalled) because it is a HUB file (orchestration list) with its
// own test surface; do NOT re-wire it into the fan-in path — route through the runner instead.
//
// writer: append ONE verification-round.jsonl record for a full-suite round that ran OUTSIDE
// full-suite-runner.ts (the only other verification-round writer) — i.e. a fan-in landing whose
// suite went through fan-in-execute.js's detached `bash scripts/test.sh` path.
//
// WHY IT EXISTS: the normal full-suite path writes verification-round.jsonl via full-suite-runner.ts's
// appendVerificationRound. The fan-in paths (fan-in-execute.js step 4) run the suite EITHER as a
// pre-verified reuse (a capture produced by the caller OUTSIDE the fan-in subagent's round — suite_head
// pinned to the worktree HEAD + suite_exit=0, ec434eb8) OR as a real detached run in this fan-in
// (`setsid bash -c 'bash scripts/test.sh'`, 9327056a) — BOTH never call full-suite-runner and never
// trigger a verification-round write. The trend ledger (the `/tests` page + suite-cost analysis data
// source) went blind to the most-used landing path (the 7h+ gap gap-preverified closed; the real-suite
// branch stayed blind at 19:45/20:36/20:52 — three real landings, zero records, 2026-08-17).
//
// THIS WRITER IS SHARED (AC3): both fan-in branches call the same writer + the same guard
// (`full_suite_ran=true`), and the `preverified` boolean (1 = reused capture, 0 = real run in this
// fan-in) comes from the suite_preverified marker — no duplicated writer for the real-suite branch
// (hard rule 5b: 在某处修好 X ≠ X 只在那一处).
//
// Record shape: SuiteRoundRecord-compatible (full-suite-runner.ts:1265) so `/tests` (parseVerificationRound
// in packages/quay/src/observation.ts) and trend-check read it. Fields:
//   round        = prior line count + 1 (same numbering appendVerificationRound uses)
//   startedAt    = the suite start (start_iso)
//   durationMs   = the suite wall-clock (wall_ms) — a real detached run's own wall clock, or the
//                  reused capture's wall clock on the pre-verified path
//   laneCount    = the suite's lane_count
//   load         = the suite's load (the /proc/loadavg 1min at the suite's end)
//   state        = "green" (both fan-in branches only write after suite_exit=0)
//   runner       = layer identity (default "inner" — the fan-in suite is an inner-layer run; the SAME
//                  default mirror-full-suite-state.ts writes, so the state + verification-round carriers
//                  agree. Explicit --runner overrides.)
//   scope        = "worktree" (the fan-in suite ran against the task worktree's HEAD)
//   commit       = the pinned suite_head (the exact HEAD that was verified)
//   cpu_time_s / cpu_source = the capture's GNU-time CPU seconds / provenance (AC6: explicit null +
//                  not-wired when the source was unavailable, NEVER 0)
//   preverified  = 1 for a reused-capture round, 0 for a real suite run in this fan-in (AC1 marker —
//                  distinguishes a reused-capture round from a full-suite-runner row AND from a real
//                  detached run)
//   taskId/runId = which fan-in produced this round (traceability; tolerated by every reader)
//   phase_overlap = whether the two-phase-overlap scheduling ACTUALLY ran, derived from the suite
//                  log's `overlap: running` marker (gap-phase-overlap-field-always-false-negative).
//                  ALWAYS present: true = overlap ran; false = log readable + marker absent
//                  (sequential); null = log absent/unreadable (n/a, never fabricated).
//   lock_wait_ms / effective_parallelism / lowconc_phase_ms = gap-wiring-B-verification-round-
//                  write-path AC1: the three observability-holes / phases-overlap-merged fields ride
//                  the REAL landing path (previously only full-suite-runner.ts — dead on fan-in —
//                  wrote them). lock_wait_ms ← test.sh's `__OVERHEAD__ lock_wait_ms=N` (the flock
//                  START→acquired wall, EPOCHREALTIME), falling back to `lock_overhead` (the whole
//                  lock-acquire wall) on pre-marker logs; absent on scoped/nested — 缺键, never 0;
//                  effective_parallelism ← cpu_time_s ÷ wall-seconds (absent when cpu_time_s is
//                  null/≤0 — a fabricated 0 would read "infinite cores"); lowconc_phase_ms carries
//                  the `overlap_lowconc_ms` sub-time on an overlap round instead of the subsumed 0.
//
// pass/fail/cancelled/tests are parsed from --suite-log when the log carries the node:test spec-reporter
// summary (`ℹ pass N` / `ℹ fail N` / `ℹ cancelled N`; gap-suite-round-pass-fail-cancel-fields). A log
// without a summary block (a pre-verified reuse whose caller recorded no log path) leaves them ABSENT —
// the /tests reader renders null as "—" and trend-check skips per-test cost for a row with no tests —
// both honest, neither fabricates a count.
//
// This writer is the equivalent writer the task mandates (a NEW module — it does NOT modify
// plugin/scripts/per-task-suite-record.ts, the per-task ledger writer, so the two ledgers stay
// disjoint: verification-round = full-suite trend / per-task-suite-records = per-task verification).
//
// Record shape: SuiteRoundRecord-compatible (full-suite-runner.ts:1265) so `/tests` (parseVerificationRound
// in packages/quay/src/observation.ts) and trend-check read it. Fields:
//   round        = prior line count + 1 (same numbering appendVerificationRound uses)
//   startedAt    = the reused capture's suite start (start_iso)
//   durationMs   = the reused capture's wall-clock (wall_ms) — semantics: the OUTER pre-verification
//                  suite's wall clock, NOT a re-run inside this fan-in; the `preverified: true`
//                  marker makes that explicit (AC2).
//   laneCount    = the capture's lane_count
//   load         = the capture's load (the /proc/loadavg 1min at the pre-verification suite's end)
//   state        = "green" (the pre-verified path only reuses a capture with suite_exit=0)
//   runner       = layer identity (default "inner" — the fan-in suite is an inner-layer run; the SAME
//                  default mirror-full-suite-state.ts writes, so the state + verification-round carriers
//                  agree. Explicit --runner overrides.)
//   scope        = "worktree" (the pre-verified suite ran against the task worktree's HEAD)
//   commit       = the pinned suite_head (the exact HEAD that was verified)
//   cpu_time_s / cpu_source = the capture's GNU-time CPU seconds / provenance (AC6: explicit null +
//                  not-wired when the source was unavailable, NEVER 0)
//   preverified  = true (AC1 marker — distinguishes a reused-capture round from a full-suite-runner row)
//   taskId/runId = which fan-in produced this round (traceability; tolerated by every reader)
//
// pass/fail/cancelled/tests are parsed from --suite-log when the log carries the node:test spec-reporter
// summary (`ℹ pass N` / `ℹ fail N` / `ℹ cancelled N`; gap-suite-round-pass-fail-cancel-fields). A log
// without a summary block (a pre-verified reuse whose caller recorded no log path) leaves them ABSENT —
// the /tests reader renders null as "—" and trend-check skips per-test cost for a row with no tests —
// both honest, neither fabricates a count.
//
// Fail-closed (硬规则 3b): a missing/invalid required field exits 2 and writes NOTHING — a partial
// record is never appended.
//
// Usage:
//   node --experimental-strip-types plugin/scripts/pre-verified-round-record.ts
//       --task-id <taskId> --run-id <runId> --started-at <iso> --duration-ms <ms>
//       --lane-count <n> --load <n> --commit <sha>
//       [--preverified <0|1|true|false>] [--cpu-time-s <n|null>] [--cpu-source <name>]
//       [--cpu-user-s <n|null>] [--cpu-sys-s <n|null>]
//       [--suite-log <path>] [--runner <name>] [--root <dir>] [--record-file <file>]
//       [--state <green|red>] [--json] [--help]
//
//   --task-id         the fan-in task whose suite landed (required)
//   --run-id          the fan-in runId (required)
//   --started-at      the suite start, ISO-8601 or epoch-seconds (required)
//   --duration-ms     the suite wall-clock in ms (required, non-negative)
//   --lane-count      suite lane count (required, non-negative)
//   --load            /proc/loadavg 1min at the suite's end (required, non-negative)
//   --commit          the pinned verified HEAD (suite_head), 40-hex (required)
//   --preverified     the reuse marker: 1/true = this round REUSED a caller-produced capture
//                     (the pre-verified branch); 0/false = the suite RAN inside this fan-in (the
//                     real-suite branch). Default 1/true (backward compat).
//   --state           green (default) / red — a RED round writes state=red + reason (+gate/failures)
//                     parsed from --suite-log (gap-verification-round-static-fail-no-record).
//   --cpu-time-s      the suite's CPU seconds — a real number, or the literal null when the source
//                     was considered and UNAVAILABLE (AC6; 0 normalizes to null)
//   --cpu-source      WHERE the cpu_time_s came from ('gnu-time' / 'not-wired'; optional)
//   --cpu-user-s      the suite's gnu-time USER cpu seconds — the "%U" column of the same line whose
//                     "%U %S" sum is cpu_time_s. A real number or the literal null (0 → omitted, AC6).
//                     Written only alongside a real cpu_time_s (cpu_source='gnu-time'). Optional
//   --cpu-sys-s       the suite's gnu-time SYSTEM cpu seconds — the "%S" column (same contract as
//                     --cpu-user-s). user+sys ≈ cpu_time_s by construction (same source line). Optional
//   --suite-log       the fan-in suite log path — parse its `__OVERHEAD__ <phase>_ms=N` lines into
//                     static/serial/lowconc/main phase fields + record nproc/concurrentSuiteSlots/
//                     concurrentSuitesRunning (same 口径 as full-suite-runner), AND parse its node:test
//                     spec-reporter summary into pass/fail/cancelled/tests (gap-suite-round-pass-fail-
//                     cancel-fields), AND its measure-suite-reporter lines into perFile/ceiling/floor_ms
//                     (gap-bucket-scoped-worktree-skips-perfile-reporter). When absent or unreadable the
//                     row is EXPLICITLY phase-less and count-less (no fabricated fields).
//   --runner          layer identity (default 'inner' — the fan-in suite is an inner-layer run; the
//                     SAME default mirror-full-suite-state.ts writes, so the state + verification-round
//                     carriers agree for the same round. Explicit --runner overrides.)
//   --root            repo root (default: cwd) — resolves the shared checkout via git common-dir
//   --record-file     override the ledger path (hermetic tests)
//   --json            machine-readable output {ok, record, file}
//   --help            this help
//
// Exit codes:
//   0  one record appended
//   2  usage / environment error (missing/invalid field, unresolvable shared checkout) — nothing written

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { isDirectEntry } from "./gate-script-base.ts";
import { suiteLockSlotCount } from "./suite-lock-slots.ts";
import { resolveSharedCheckout, toIsoTimestamp } from "./per-task-suite-record.ts";
import { parsePerFileLines } from "./measure-trend-check.ts";
// gap-verification-round-static-fail-no-record — the shared test-failure matcher (the SAME
// single-definition-point FAILURE_PATTERNS full-suite-runner uses), imported from the lightweight
// runner-red-parse.ts module (its only runtime import is tmux-leak-fail-re.ts; the full-suite-runner
// types it imports are `import type` — erased — so this writer never pulls the heavy hub at runtime).
import { isFailureLine } from "./runner-red-parse.ts";

const COMMIT_RE = /^[0-9a-f]{40}$/i;

// ── phase + concurrency 口径 (gap-fan-in-verification-round-thin-schema-phase-gap) ───────────────────
// The fan-in verification-round row must carry the SAME phase / concurrency axes full-suite-runner's
// appendVerificationRound writes (static/serial/lowconc/main phase ms + nproc/concurrentSuiteSlots/
// concurrentSuitesRunning), so AC101's lane-concurrency control round (S=1) can compare the fan-in
// baseline against a full-suite-runner control round at the SAME 口径 (round 227 was the last rich row;
// 228-233 all thin — the defect this module fixes).
//
// Phase source: the fan-in suite log (--suite-log) carries test.sh's `__OVERHEAD__ <phase>_ms=N`
// fixed-overhead instrumentation — the SAME lines full-suite-runner stream-accumulates at
// plugin/scripts/full-suite-runner.ts:2849-3052. Only a phase that RAN is present (absent-field
// contract, same as the *_phase_ms spreads at :3696-3699): `static_phase_ms` ← `run_static_checks`,
// plus serial/lowconc/main. A missing/unreadable log → NO phase fields (never fabricated).
//
// Concurrency helpers below are THIN LOCAL REPLICAS of full-suite-runner's single-definition-point
// expressions (hostParallelism :1580, concurrentSuiteSlots :1536, countHeldSuiteLocks :1638) — kept
// local so the thin writer never imports the heavy full-suite-runner module; the expressions are
// byte-identical so the record is 同口径.

const PHASE_OVERHEAD_RE = /^__OVERHEAD__\s+([A-Za-z0-9_]+)_ms=(\d+)(?:\s+partial=1)?$/;

// gap-verification-round-static-fail-no-record AC1/AC2 — a RED fan-in round (suite_exit != 0) must ALSO
// write a verification-round record (state=red + reason + failures + taskId), not only the green path.
// Two failure shapes are distinguished, mirroring full-suite-runner's red-parsing 口径:
//   - static-check fail-closed: `STATIC_CHECK_FAILED: <name> exit=<rc>` (checker-cost-lib, stderr) — a
//     run_static_checks checker exited non-zero BEFORE the test phase ⇒ reason=gate-failed + gate=static-check
//     (the round-84 / split-long spec-declaration-point-check shape).
//   - test failure: isFailureLine (runner-red-parse.ts — the shared matcher) ⇒ reason=failed.
// STATIC_CHECK_FAILED_RE is a THIN LOCAL REPLICA of full-suite-runner.ts:538's regex (byte-identical),
// same as the PHASE_OVERHEAD_RE / TEST_COUNT_RE / CEILING_RE replicas below — the thin writer never
// imports the heavy full-suite-runner module.
const STATIC_CHECK_FAILED_RE = /^STATIC_CHECK_FAILED:\s*(\S+)\s+exit=(\d+)/;
// Mirror full-suite-runner's failures[] cap (a pathological red round cannot grow the record unbounded).
const MAX_RECORDED_FAILURES = 200;

/** Byte offset of the LAST `__FANIN_SUITE_START__` LINE (anchored at line start), or -1.
 *  gap-wiring-B-verification-round-write-path: the previous `lastIndexOf(substring)` was fooled by the
 *  suite's OWN test output — a node:test assertion description (`✔ … — parseSuitePhases slices by the
 *  last __FANIN_SUITE_START__ marker …`) CONTAINS the marker string MID-LINE, so lastIndexOf sliced
 *  from INSIDE the test run and excluded the EARLY `overlap: running` / `overlap_<phase>_ms` markers
 *  (real round 347 recorded phase_overlap=false + lowconc_phase_ms=0 despite a genuine overlap log).
 *  Anchoring on the line START (the emitted marker is always `__FANIN_SUITE_START__ iso=…`) excludes
 *  test-output mentions. */
function lastSuiteStartOffset(text) {
  const re = /^__FANIN_SUITE_START__\s/gm;
  let last = -1;
  let m;
  while ((m = re.exec(text)) !== null) last = m.index;
  return last;
}

/** Parse test.sh's `__OVERHEAD__ <phase>_ms=N` lines from a suite log. Returns {} when the log is
 *  absent/unreadable (never fabricates a phase — the absent-field contract). Keyed by the raw label
 *  (`serial_phase`, `lowconc_phase`, `main_phase`, `run_static_checks`).
 *  gap-fan-in-suite-log-cross-relaunch-reuse: 按最后一个 `__FANIN_SUITE_START__` 起始标记切片（只读
 *  当前轮），无标记 ⇒ 整份（向后兼容）。 */
export function parseSuitePhases(suiteLog) {
  const phaseMs = {};
  if (!suiteLog) return phaseMs;
  let text;
  try {
    text = fs.readFileSync(suiteLog, "utf8");
  } catch {
    return phaseMs;
  }
  const mk = lastSuiteStartOffset(text);
  const body = mk === -1 ? text : text.slice(mk);
  for (const line of body.split("\n")) {
    const m = line.match(PHASE_OVERHEAD_RE);
    if (m) phaseMs[m[1]] = Number(m[2]);
  }
  return phaseMs;
}

// gap-phase-overlap-field-always-false-negative — the same `overlap: running` marker full-suite-runner
// latches as phaseOverlapRan (phaseMarkerOverlap = /^overlap:\s+running/). test.sh emits it ONLY when
// PHASE_OVERLAP=1 AND both serial+lowconc are non-empty (the parallel branch ACTUALLY ran) — the
// ground-truth signal, not the env intent.
const OVERLAP_RUNNING_RE = /^overlap:\s+running/;

/** Whether the suite log records that the two-phase-overlap scheduling ACTUALLY ran. Tri-state (hard
 *  rule 3b — 判不出 is a distinct value, never conflated with a boolean): true = the log carries the
 *  `overlap: running` marker (overlap ran); false = the log is readable and does NOT carry it
 *  (sequential); null = the log is absent/unreadable (n/a — the field is present but the value is
 *  honestly unknown, never fabricated). Mirrors full-suite-runner's phaseOverlapRan latch. */
export function detectPhaseOverlap(suiteLog) {
  if (!suiteLog) return null;
  let text;
  try {
    text = fs.readFileSync(suiteLog, "utf8");
  } catch {
    return null;
  }
  // gap-fan-in-suite-log-cross-relaunch-reuse: 按最后一个起始标记切片（只读当前轮；无标记 ⇒ 整份）。
  // gap-wiring-B-verification-round-write-path: 用行首锚定的标记（见 lastSuiteStartOffset）——真实日志
  // 的 suite 自身测试输出会包含 `__FANIN_SUITE_START__` 字符串，lastIndexOf 会从测试输出中间切片而漏掉
  // 早段的 `overlap: running` 标记（round 347 实证：overlap 日志被记成 phase_overlap=false）。
  const mk = lastSuiteStartOffset(text);
  const body = mk === -1 ? text : text.slice(mk);
  for (const line of body.split("\n")) {
    if (OVERLAP_RUNNING_RE.test(line)) return true;
  }
  return false;
}

// gap-ac126-suite-bucket-execution-enable-wiring AC2/AC3 — parse test.sh's `__BUCKETS__` marker
// (bucket-mode rounds only; the default full suite never emits it). Returns { buckets, files } | null.
// `buckets` is the canonical label (P|M|P+M|full — "full" = hub fallback / no-bucket-triggerable);
// `files` is the selected test-file count. Mirrors full-suite-runner's onLine parse (:3292), but
// slices by the last __FANIN_SUITE_START__ marker (current round only — same as parseSuitePhases).
const BUCKET_MARKER_RE = /^__BUCKETS__\s+buckets=(\S+)\s+files=(\d+)\s+full=([01])/;

export function parseBucketMarker(suiteLog) {
  if (!suiteLog) return null;
  let text;
  try {
    text = fs.readFileSync(suiteLog, "utf8");
  } catch {
    return null;
  }
  const mk = lastSuiteStartOffset(text);
  const body = mk === -1 ? text : text.slice(mk);
  for (const line of body.split("\n")) {
    const m = line.match(BUCKET_MARKER_RE);
    if (m) return { buckets: m[1], files: Number(m[2]) };
  }
  return null;
}

// gap-suite-round-pass-fail-cancel-fields AC1 — parse the node:test spec-reporter summary lines
// (`ℹ pass N` / `ℹ fail N` / `ℹ cancelled N`, and the TAP `# …` forms) from the suite log. test.sh's
// dual-reporter config puts the spec reporter on stdout (redirected into --suite-log), and the FULL-SUITE
// path runs node --test as serial → lowconc → main (three phases, each emitting its OWN summary block),
// so the totals are the SUM across blocks — the SAME 口径 as full-suite-runner's tapPass/tapFail/
// tapCancelled accumulators (gap-verification-round-counter-overwrites-not-sums). Returns null when the
// log is absent/unreadable or carries NO summary block (distinguishes "no counts in log" from "0 tests",
// 硬规则⑥ 缺值=未查≠为假). Slices by the last __FANIN_SUITE_START__ marker (current round only).
const TEST_COUNT_RE = /^[#ℹ]\s*(pass|fail|cancelled)\s+(\d+)/;

// gap-suite-round-pass-fail-cancel-parser-breaks-under-force-color-ansi — the host env can carry
// FORCE_COLOR=3 (also COLORTERM=truecolor), which forces node:test's spec reporter to emit ANSI
// color EVEN when its stdout is redirected to a file: the summary line arrives as
// `\x1b[34mℹ pass N\x1b[39m` (ESC at line start). `^[#ℹ]` anchoring then never matches ⇒
// parseTestCounts returns null ⇒ verification-round's pass/fail/cancelled/tests fields honestly
// absent (the #684/#685 regression). Strip ANSI CSI before matching (the same ANSI_CSI_RE
// pane-state-classify.ts uses) so colorized AND plain summary lines both parse — the parser, not
// the spawn point, owns the fix (AC3 requires re-parsing an already-colorized log).
const ANSI_CSI_RE = /\x1B\[[0-9;]*[A-Za-z]/g;

export function parseTestCounts(suiteLog) {
  if (!suiteLog) return null;
  let text;
  try {
    text = fs.readFileSync(suiteLog, "utf8");
  } catch {
    return null;
  }
  const mk = lastSuiteStartOffset(text);
  const body = mk === -1 ? text : text.slice(mk);
  const acc = { pass: 0, fail: 0, cancelled: 0 };
  let seen = false;
  for (const line of body.split("\n")) {
    const m = line.replace(ANSI_CSI_RE, "").match(TEST_COUNT_RE);
    if (m) {
      seen = true;
      acc[m[1]] += Number(m[2]);
    }
  }
  return seen ? acc : null;
}

// ── gap-verification-round-bound-to-quay-shaped-suite-entry AC5 — 项目【声明】自己的输出约定 ──────────
// 人 2026-09-12 裁定：写死入口（bash scripts/test.sh）是错的，但**只让入口可配而输出解析仍写死，是换了
// 一个位置的同一个病** —— 换个项目照样产不出台账（判据会在「配置项存在」上变绿而实际无台账，硬规则 3b）。
// ⇒ 目标项目在 `.quay/config.yml` 的 `loop.test_output` 里【声明】自己的输出约定，quay 依声明解析。
//
// 声明形状：{ <字段>: "<正则，恰好一个捕获组>" }，字段 ∈ pass / fail / cancelled / tests。例（vitest）：
//   loop:
//     test_command: npx vitest run
//     test_output:
//       pass: 'Tests\s+.*?(\d+) passed'
//       fail: 'Tests\s+.*?(\d+) failed'
// ⛔ 不是「框架名 → quay 内置表」：那样新框架仍要改 quay 代码，等于把写死挪了个地方。声明即权威。
//
// 三条纪律（都可取假，硬规则 3/3b）：
//  ① 只在**声明了至少一个有效字段**时接管（无声明/空声明 ⇒ 返回 null，调用方走内建 node:test 解析——
//     本仓库形态零回归）；
//  ② 声明的正则在【去 ANSI 后的文本】上匹配（与内建解析同一归一化：FORCE_COLOR / 管道强制着色会让
//     带色输出匹配不上，缺这一步声明会「读到了但解析不出」——正是 AC5 要排除的那种假绿）；
//  ③ 解析不到 / 正则非法 ⇒ 该字段**缺席**（⛔ 不写 0：0 会把「声明没匹配上」伪装成「测得 0 个用例」）。
export const DECLARED_COUNT_FIELDS = ["pass", "fail", "cancelled", "tests"];

/** 应用项目声明的输出约定。返回 {字段: 数字}（可能为空对象 = 声明有效但一条都没匹配上）、或 null =
 *  无有效声明（调用方退回内建解析）。suiteLog 是日志**路径**（与 parseTestCounts 同签名）。 */
export function applyDeclaredTestOutput(suiteLog, declared) {
  if (!declared || typeof declared !== "object" || Array.isArray(declared)) return null;
  const fields = DECLARED_COUNT_FIELDS.filter(
    (f) => typeof declared[f] === "string" && declared[f].trim() !== "",
  );
  if (fields.length === 0) return null;
  if (!suiteLog) return {};
  let text;
  try {
    text = fs.readFileSync(suiteLog, "utf8");
  } catch {
    return {}; // 日志不可读 ⇒ 声明有效但无可解析输入（字段全缺席，⛔ 不伪造）
  }
  const plain = text.replace(ANSI_CSI_RE, "");
  const out = {};
  for (const f of fields) {
    let cap = null;
    try {
      const m = new RegExp(declared[f], "m").exec(plain);
      cap = m ? m[1] : null;
    } catch {
      cap = null; // 非法正则 ⇒ 该字段缺席（fail-closed；⛔ 不抛——观测写不得断掉整轮 fan-in）
    }
    if (cap == null) continue;
    const v = Number(String(cap).trim());
    if (Number.isFinite(v)) out[f] = v;
  }
  // tests 口径与 full-suite-runner 一致（pass+fail+cancelled）——仅当声明没直接给 tests 且至少解析到
  // 一个计数（否则 tests 也缺席，与「没声明」同形=不伪造）。
  if (out.tests === undefined && (out.pass !== undefined || out.fail !== undefined || out.cancelled !== undefined)) {
    out.tests = (out.pass ?? 0) + (out.fail ?? 0) + (out.cancelled ?? 0);
  }
  return out;
}

// gap-bucket-scoped-worktree-skips-perfile-reporter AC1 — the bucket-scoped worktree execution path
// (fan-in-execute.js detached `bash scripts/test.sh --buckets <task>`) writes its round record via THIS
// writer, NOT full-suite-runner.ts. The suite log carries measure-suite-reporter.mjs's per-file lines
// (`__PERFILE__ duration_ms=<dur> <path> passed=<bool>`, one per test file, streamed live) + capped-file
// lines (`__CEILING__ <path> duration_ms=<dur> floor_ms=<floor> 封顶者/该拆`), but the writer never
// parsed them ⇒ verification-round.perFile/ceiling/floor_ms were always absent on the most-used landing
// path (0 hits across every post-bucket round). Parse them here with the SAME 口径 as
// full-suite-runner.ts (perFile ← measure-trend-check.parsePerFileLines, the shared parser + the same
// normalizePerFileKey; ceiling/floor_ms ← the same ^__CEILING__ regex at full-suite-runner.ts:2630).

/** Parse the reporter's `__PERFILE__` lines from the suite log into {file,durationMs,passed,cpuMs?}[] —
 *  the SAME parser full-suite-runner uses (measure-trend-check.parsePerFileLines handles the
 *  `__FANIN_SUITE_START__` current-round slice + normalizePerFileKey + duration>0 filter internally, so
 *  the two carriers share one 口径 — no regex re-implemented). Each record carries `cpuMs`
 *  (gap-perfile-cpu-cost-collection — the file's OWN process.cpuUsage() ms) when the `__PERFILE__` line
 *  carried `cpu_ms=`, absent on legacy lines (缺键 ≠ 0). Returns [] when the log is absent/unreadable or
 *  carries no per-file lines (never a fabricated array — the field stays ABSENT). */
export function parsePerFile(suiteLog) {
  if (!suiteLog) return [];
  let text;
  try {
    text = fs.readFileSync(suiteLog, "utf8");
  } catch {
    return [];
  }
  return parsePerFileLines(text);
}

/** Parse the reporter's `__CEILING__` lines into the round's `ceiling` (capped file paths, stream
 *  order) + `floor_ms` (DISTINCT group floors) — the SAME ^__CEILING__ regex + accumulate-into-
 *  distinct-floor logic as full-suite-runner.ts:2630-2635. Both stay empty until a capped file exists
 *  (cc>1 AND a file's wall > idealSplit — a small bucket subset may legitimately emit none). Returns
 *  null when the log is absent/unreadable (缺值=未查, never a fabricated {[],[]}); a readable log with
 *  no __CEILING__ lines returns { ceiling: [], floor_ms: [] } (honest empty — the fields stay ABSENT). */
const CEILING_RE = /^__CEILING__\s+(.+?)\s+duration_ms=(\d+(?:\.\d+)?)\s+floor_ms=(\d+(?:\.\d+)?)/;

export function parseCeilingFloor(suiteLog) {
  if (!suiteLog) return null;
  let text;
  try {
    text = fs.readFileSync(suiteLog, "utf8");
  } catch {
    return null;
  }
  const mk = lastSuiteStartOffset(text);
  const body = mk === -1 ? text : text.slice(mk);
  const ceiling = [];
  const floorMsSeen = [];
  for (const line of body.split("\n")) {
    const m = line.match(CEILING_RE);
    if (m) {
      ceiling.push(m[1]);
      const floor = Number(m[3]); // group 2 is duration_ms; group 3 is floor_ms
      if (!floorMsSeen.includes(floor)) floorMsSeen.push(floor);
    }
  }
  return { ceiling, floor_ms: floorMsSeen };
}

/** Parse a RED suite log into the failure facts a red record carries (gap-verification-round-static-fail-
 *  no-record AC1/AC2). Reads the CURRENT round only (sliced by the last __FANIN_SUITE_START__ marker, the
 *  same discipline as every other log parser in this file). Returns:
 *    staticCheck   true when ≥1 fail-closed checker fired (a run_static_checks checker exited non-zero)
 *    failClosed    the parsed `STATIC_CHECK_FAILED: <name> exit=<rc>` lines {name, exitCode, line}
 *    failureLines  the raw test-failure lines (isFailureLine 口径), capped at MAX_RECORDED_FAILURES.
 *  An absent/unreadable log returns {staticCheck:false, failClosed:[], failureLines:[]} — a red round
 *  with an unreadable log still records reason=failed (honest: the failure facts are simply absent).
 */
export function parseRedFailures(suiteLog) {
  const failClosed = [];
  const failureLines = [];
  if (!suiteLog) return { staticCheck: false, failClosed, failureLines };
  let text;
  try {
    text = fs.readFileSync(suiteLog, "utf8");
  } catch {
    return { staticCheck: false, failClosed, failureLines };
  }
  const mk = lastSuiteStartOffset(text);
  const body = mk === -1 ? text : text.slice(mk);
  for (const line of body.split("\n")) {
    // Same FORCE_COLOR=3 ANSI strip as parseTestCounts (5b sibling surface): a RED suite's
    // spec-reporter failure lines are colorized too (`\x1b[31m✖ …` / `\x1b[34mℹ fail N\x1b[39m`), so
    // isFailureLine's `^✖` / `^[#ℹ]\s*fail\s+[1-9]` anchors miss them ⇒ failureLines (and the ✖/ℹ-fail
    // shapes) would be dropped even though the round is red. STATIC_CHECK_FAILED_RE (shell output,
    // never ANSI) is a no-op here, but stripping once keeps every matcher on a clean line.
    const stripped = line.replace(ANSI_CSI_RE, "");
    const m = STATIC_CHECK_FAILED_RE.exec(stripped);
    if (m) {
      const exitCode = Number(m[2]);
      if (Number.isInteger(exitCode) && exitCode >= 0) {
        failClosed.push({ name: m[1], exitCode, line: stripped });
      }
      continue; // a static-check fail-closed line is not a test-failure line
    }
    if (isFailureLine(stripped) && failureLines.length < MAX_RECORDED_FAILURES) failureLines.push(stripped);
  }
  return { staticCheck: failClosed.length > 0, failClosed, failureLines };
}

/** Host parallelism (nproc) — the same read-host expression as full-suite-runner.hostParallelism
 *  (RESOURCE_GATE_NPROC seam → os.availableParallelism() → os.cpus().length, floored at 1). */
export function hostParallelism() {
  const ncpuRaw = process.env.RESOURCE_GATE_NPROC ?? String(
    typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length,
  );
  const ncpu = Number(ncpuRaw);
  return Number.isFinite(ncpu) && ncpu >= 1 ? ncpu : 1;
}

/** Effective parallelism = cpu_time_s ÷ wall-seconds — the observability-holes AC4 "did the suite
 *  optimization help" KPI, same 口径 as full-suite-runner.effectiveParallelism (:1300). Returns null
 *  when cpu_time_s is null/≤0 or wall ≤0 — the field is then ABSENT (a fabricated 0 would read
 *  "infinite cores", 硬规则⑥ 缺值=未查≠为假). gap-wiring-B-verification-round-write-path AC1: wired
 *  into THIS real landing writer (the fan-in path) so real verification-round rows carry it, not just
 *  full-suite-runner's dead-on-fan-in path. */
export function effectiveParallelism(cpuTimeS, durationMs) {
  if (cpuTimeS == null || !Number.isFinite(cpuTimeS) || cpuTimeS <= 0) return null;
  const wallS = durationMs / 1000;
  if (!Number.isFinite(wallS) || wallS <= 0) return null;
  return Number((cpuTimeS / wallS).toFixed(3));
}

/** The configured concurrent-suite slot count — delegated to the TS canonical suiteLockSlotCount()
 *  (gap-suite-lock-slot-seam-asymmetry: it reads the SAME seam precedence as the bash canonical —
 *  RESOURCE_GATE_CONCURRENT_SUITES → QUAY_MAX_CONCURRENT_SUITES → 2). This writer keeps the slot read
 *  OUT of the heavy full-suite-runner module by importing the lightweight suite-lock-slots.ts
 *  (node-builtins only), not by duplicating the env expression — the previous local copy read only the
 *  knob and drifted from the bash side under a test seam. */
export function concurrentSuiteSlots() {
  return suiteLockSlotCount();
}

/** Resolve the single-flight 2-slot lock files the SAME way full-suite-runner.suiteLockPaths does:
 *  `${FULL_SUITE_LOCK_FILE}` env override → `git rev-parse --git-common-dir` from `root` (the SHARED
 *  lock dir all worktrees contend on) → fall back to `<root>/.git`. */
function suiteLockPaths(root) {
  const envOverride = process.env.FULL_SUITE_LOCK_FILE;
  let base;
  if (envOverride) {
    base = envOverride;
  } else {
    let commonDir = null;
    try {
      commonDir = execFileSync("git", ["rev-parse", "--git-common-dir"], { cwd: root, encoding: "utf8" }).trim();
    } catch {
      commonDir = null;
    }
    if (!commonDir) commonDir = ".git";
    base = path.join(path.resolve(root, commonDir), "full-suite.lock");
  }
  return [`${base}.0`, `${base}.1`];
}

/** Non-blocking probe of ONE slot: false = FREE, true = HELD. Missing parent dir reads as FREE (the
 *  same fail-open as full-suite-runner.probeLockHeld). */
function probeLockHeld(lockFile) {
  if (!fs.existsSync(path.dirname(lockFile))) return false;
  try {
    execFileSync("flock", ["-n", lockFile, "true"], { stdio: "ignore" });
    return false;
  } catch {
    return true;
  }
}

/** Number of single-flight lock slots CURRENTLY held by OTHER suites at probe time (0..S, S =
 *  concurrentSuiteSlots()). Best-effort: any error degrades to 0 (accounting never blocks a run). */
export function countHeldSuiteLocks(root) {
  try {
    const [l0, l1] = suiteLockPaths(root);
    return (probeLockHeld(l0) ? 1 : 0) + (probeLockHeld(l1) ? 1 : 0);
  } catch {
    return 0;
  }
}

/** Build the pre-verified round record. Returns {record} or {error} (fail-closed). */
export function buildPreVerifiedRoundRecord(o) {
  const taskId = o.taskId;
  if (!taskId || !String(taskId).trim()) return { error: "--task-id is required" };
  const runId = o.runId;
  if (!runId || !String(runId).trim()) return { error: "--run-id is required" };
  const startedAt = toIsoTimestamp(o.startedAt);
  if (startedAt == null) return { error: `--started-at must be an ISO/epoch timestamp (got ${JSON.stringify(o.startedAt)})` };
  const durationMs = Number(o.durationMs);
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return { error: `--duration-ms must be a non-negative number (got ${JSON.stringify(o.durationMs)})` };
  }
  const laneCount = Number(o.laneCount);
  if (!Number.isFinite(laneCount) || laneCount < 0) {
    return { error: `--lane-count must be a non-negative number (got ${JSON.stringify(o.laneCount)})` };
  }
  const load = Number(o.load);
  if (!Number.isFinite(load) || load < 0) {
    return { error: `--load must be a non-negative number (got ${JSON.stringify(o.load)})` };
  }
  const commit = o.commit ? String(o.commit).trim() : "";
  if (!COMMIT_RE.test(commit)) {
    return { error: `--commit must be a 40-hex commit sha (got ${JSON.stringify(o.commit)})` };
  }
  // cpu_time_s / cpu_source — a real number or EXPLICIT null + provenance (AC6, never 0).
  let cpuTimeS;
  let cpuSource;
  if (o.cpuSource != null) {
    cpuSource = String(o.cpuSource).trim();
    if (!cpuSource) return { error: "--cpu-source must be a non-empty string (got empty)" };
  }
  if (o.cpuTimeS != null) {
    const raw = String(o.cpuTimeS).trim();
    if (raw === "null" || raw === "") {
      cpuTimeS = null;
      if (cpuSource == null) cpuSource = "not-wired";
    } else {
      const v = Number(raw);
      if (!Number.isFinite(v) || v < 0) {
        return { error: `--cpu-time-s must be a non-negative number, 0, or null (got ${JSON.stringify(o.cpuTimeS)})` };
      }
      if (v === 0) {
        cpuTimeS = null;
        if (cpuSource == null) cpuSource = "not-wired";
      } else {
        cpuTimeS = v;
        if (cpuSource == null) cpuSource = "gnu-time";
      }
    }
  }
  // gap-verification-round-cpu-split-not-recorded AC1/AC3 — the gnu-time user/sys CPU split. The fan-in
  // capture parses the SAME gnu-time "%U %S" line into cpu_user_s (column 1) and cpu_sys_s (column 2);
  // cpu_time_s is their sum (column 1 + 2). Written ONLY alongside a real cpu_time_s (cpu_source =
  // 'gnu-time') — a split without its sum is ambiguous, so a caller that passes a REAL split value with
  // a null/absent cpu_time_s fails closed (硬规则 3b). Each component is a non-negative number or
  // explicit null (AC6, never a misleading 0 — the same 0→null normalization cpu_time_s follows).
  // Absent components (the arg not passed / empty / the literal null / 0) are omitted from the record;
  // a reader must tolerate their absence. NOTE: the entry gate ignores empty/0 split args entirely —
  // a bash caller whose capture has no gnu-time (e.g. a doc-only skip) passes `--cpu-user-s ""` and
  // must NOT trip the fail-closed (an unset capture var is "considered + unavailable", not a real split).
  let cpuUserS;
  let cpuSysS;
  const splitArgs = [
    ["cpu-user-s", o.cpuUserS, (v) => { cpuUserS = v; }],
    ["cpu-sys-s", o.cpuSysS, (v) => { cpuSysS = v; }],
  ];
  const hasRealSplit = splitArgs.some(([, raw]) => {
    if (raw == null) return false;
    const s = String(raw).trim();
    if (s === "" || s === "null") return false;
    const v = Number(s);
    // A "present" split value = anything the caller passed that is NOT the literal 0 (which normalizes
    // to omitted, AC6). Negative / non-numeric values are still a REAL attempt at a split → they must
    // enter validation (and fail closed) below — an invalid split must never be silently swallowed.
    return !(Number.isFinite(v) && v === 0);
  });
  if (hasRealSplit) {
    if (cpuTimeS == null) {
      return { error: "--cpu-user-s/--cpu-sys-s require a real --cpu-time-s (the gnu-time sum); a split without its sum is ambiguous" };
    }
    for (const [name, raw, setter] of splitArgs) {
      if (raw == null) continue;
      const s = String(raw).trim();
      if (s === "" || s === "null") continue; // considered + unavailable → omitted (absent-field contract)
      const v = Number(s);
      if (!Number.isFinite(v) || v < 0) {
        return { error: `--${name} must be a non-negative number, 0, or null (got ${JSON.stringify(raw)})` };
      }
      if (v === 0) continue; // 0 → omitted (AC6 — 0 conflates "not measured" with "truly ~0")
      setter(v);
    }
  }
  // gap-runner-field-hardcoded-outer-not-measurement — default 'inner' (the fan-in suite is an
  // inner-layer run), the SAME default mirror-full-suite-state.ts writes — so the verification-round
  // and the full-suite-state.json carriers agree on the runner for the same round (修前两者各说各话：
  // state=inner / verification-round=outer). Explicit --runner still overrides.
  const runner = o.runner ? String(o.runner).trim() : "inner";
  if (!runner) return { error: "--runner must be a non-empty string" };
  // preverified — the shared writer's branch marker (AC3): 1/true = reused capture (pre-verified
  // branch), 0/false = the suite RAN inside this fan-in (real-suite branch). Default true for
  // backward compat with the pre-verified callers that predate the shared-flag form.
  let preverified = true;
  if (o.preverified != null) {
    const pv = String(o.preverified).trim().toLowerCase();
    if (pv === "0" || pv === "false") preverified = false;
    else if (pv === "1" || pv === "true") preverified = true;
    else return { error: `--preverified must be 0|1|true|false (got ${JSON.stringify(o.preverified)})` };
  }
  // gap-verification-round-static-fail-no-record AC1/AC2 — the record's state/reason axis. The fan-in
  // writer previously hardcoded state=green (both branches only write after suite_exit=0). A RED round
  // (suite_exit != 0) must ALSO land a record so a reader can distinguish "didn't run" (no record) from
  // "ran and failed" (state=red + reason) and attribute it to a task (taskId). --state red is the new
  // entry; green (the default) keeps the existing shape byte-for-byte (backward compat, AC4).
  let state = "green";
  if (o.state != null) {
    const st = String(o.state).trim().toLowerCase();
    if (st === "green") state = "green";
    else if (st === "red") state = "red";
    else return { error: `--state must be green|red (got ${JSON.stringify(o.state)})` };
  }
  const record = {
    round: 0, // computed from prior line count in the appender
    startedAt,
    durationMs,
    laneCount,
    load,
    state, // green (default) or red (gap-verification-round-static-fail-no-record: a red fan-in round)
    runner,
    scope: "worktree", // the fan-in suite ran against the task worktree's HEAD
    commit,
    preverified, // AC1 marker — distinguishes a reused-capture round from a real detached run
    taskId: String(taskId).trim(),
    runId: String(runId).trim(),
  };
  if (o.cpuTimeS != null || cpuSource != null) {
    record.cpu_time_s = cpuTimeS;
    record.cpu_source = cpuSource ?? "not-wired";
    // gap-verification-round-cpu-split-not-recorded AC1 — the gnu-time user/sys split rides alongside
    // cpu_time_s/cpu_source when the capture parsed it (a real measurement); omitted when unavailable.
    if (cpuUserS != null) record.cpu_user_s = cpuUserS;
    if (cpuSysS != null) record.cpu_sys_s = cpuSysS;
  }
  // gap-wiring-B-verification-round-write-path AC1 — effective_parallelism (observability-holes AC4)
  // rides the REAL landing path: cpu_time_s ÷ wall. Present ONLY when cpu_time_s is a finite number
  // > 0 (null cpu_time_s → the field is ABSENT — a fabricated 0 would read "infinite cores"). This
  // is the single "did the suite optimization help" KPI, comparable per round — previously 0 real
  // records carried it because only the dead-on-fan-in full-suite-runner path wrote it.
  const effPar = effectiveParallelism(cpuTimeS, durationMs);
  if (effPar !== null) record.effective_parallelism = effPar;
  // gap-fan-in-verification-round-thin-schema-phase-gap AC1/AC2 — phase fields + concurrency
  // variables (same 口径 as full-suite-runner's appendVerificationRound). Phase source: the suite
  // log (--suite-log). preverified 分支单独定案 (AC2): the writer parses phases from --suite-log
  // WHENEVER the path is provided AND the file is readable (a real-run capture always carries it; a
  // pre-verified capture carries it only when the caller recorded its log path) — otherwise the row
  // is EXPLICITLY phase-less (no fabricated fields). This does not conflate the two branches: a
  // preverified=1 capture WITHOUT a log path records no phase data, honestly.
  const suiteLog = o.suiteLog ? String(o.suiteLog).trim() : "";
  // gap-verification-round-static-fail-no-record AC1/AC2 — on a RED round carry the failure facts:
  // reason/gate/failures. A static-check fail-closed ⇒ reason=gate-failed + gate=static-check +
  // failures[]=the checker lines (each staticCheck:true, so the shared-gate dispatch sees them); a
  // test failure ⇒ reason=failed + failures[]=the matched failure lines. A red round whose log carries
  // NO parseable failure signal still records reason=failed (fail-closed — a red run IS a failure even
  // when the log's signal shape was unparseable; failures[] is simply absent).
  if (state === "red") {
    const red = parseRedFailures(suiteLog);
    if (red.staticCheck) {
      record.reason = "gate-failed";
      record.gate = "static-check";
      record.failures = red.failClosed.map((c) => ({ line: c.line, staticCheck: true }));
    } else {
      record.reason = "failed";
      if (red.failureLines.length > 0) {
        record.failures = red.failureLines.map((line) => ({ line }));
      }
    }
  }
  const phaseMs = parseSuitePhases(suiteLog);
  const phaseOverlap = detectPhaseOverlap(suiteLog);
  if (phaseMs.run_static_checks !== undefined) record.static_phase_ms = phaseMs.run_static_checks;
  if (phaseMs.serial_phase !== undefined) record.serial_phase_ms = phaseMs.serial_phase;
  if (phaseMs.lowconc_phase !== undefined) {
    // gap-wiring-B-verification-round-write-path AC1 — lowconc_phase_ms 不再恒 0 on an overlap round
    // (the phases-overlap-merged defect: 78/78 real fan-in overlap rounds had lowconc_phase_ms=0).
    // On overlap test.sh subsumes lowconc into the serial window and emits lowconc_phase_ms=0, but
    // ALSO emits the per-process `__OVERHEAD__ overlap_lowconc_ms=N` sub-time — carry THAT real
    // duration instead of the 0 (mirrors full-suite-runner:3917-3924). Falls back to the raw value
    // only when the sub-time marker was missed (a truncated round — honest, nothing recoverable).
    record.lowconc_phase_ms =
      phaseOverlap === true && typeof phaseMs.overlap_lowconc === "number"
        ? phaseMs.overlap_lowconc
        : phaseMs.lowconc_phase;
  }
  if (phaseMs.main_phase !== undefined) record.main_phase_ms = phaseMs.main_phase;
  // gap-wiring-B-verification-round-write-path AC1 — lock_wait_ms (observability-holes AC1) rides the
  // REAL landing path. full-suite-runner derives it from its live stream markers (Date.now()); the
  // fan-in log is a post-hoc file with no wall timestamps, so test.sh now emits `__OVERHEAD__
  // lock_wait_ms=N` on the FULL-SUITE path (the flock START→acquired wall, EPOCHREALTIME) — parse it
  // into phaseMs.lock_wait. FALLBACK for logs produced BEFORE the precise marker landed (and reused
  // captures): `lock_overhead` (oh_t1 - oh_t0, the whole lock-acquire block incl. the flock wait +
  // ~ms of setup — the SAME wall full-suite-runner calls lock_wait) — a real measurement, not a
  // fabricated 0. Absent when the suite skipped the lock (scoped/nested runs — 缺键, never 0; a
  // reader must tolerate absence, same contract as full-suite-runner).
  if (phaseMs.lock_wait !== undefined) {
    record.lock_wait_ms = phaseMs.lock_wait;
  } else if (phaseMs.lock_overhead !== undefined) {
    record.lock_wait_ms = phaseMs.lock_overhead;
  }
  // gap-suite-lock-starvation-long-validation-hold AC2 — lock_hold_ms rides test.sh's
  // `__OVERHEAD__ lock_hold_ms=N` marker (the acquire→release wall) into phaseMs.lock_hold, so the
  // landing record can distinguish "long lock hold" from "worker slow". Absent on scoped/nested runs
  // (no lock taken — 缺键, never 0), same contract as lock_wait_ms.
  if (phaseMs.lock_hold !== undefined) {
    record.lock_hold_ms = phaseMs.lock_hold;
  }
  // gap-phase-overlap-field-always-false-negative — the fan-in landing path (this writer) must ALSO
  // carry phase_overlap (the DoD's "真实 fan-in 轮正确写入"): derive from the suite log's
  // `overlap: running` marker, mirroring full-suite-runner's phaseOverlapRan latch. Unlike
  // full-suite-runner (absent-field on a sequential round), this writer makes the field ALWAYS
  // present so a reader can distinguish the three cases — true = overlap ran; false = log readable +
  // marker absent (sequential); null = log absent/unreadable (n/a, never a fabricated boolean).
  record.phase_overlap = phaseOverlap;
  // gap-ac126-suite-bucket-execution-enable-wiring AC2/AC3 — the bucket-execution fields, present ONLY
  // on a bucket-mode round (test.sh emitted __BUCKETS__; the default full suite omits them — a reader
  // must tolerate their absence). Same 口径 as full-suite-runner:4027-4029: buckets = canonical label
  // (P|M|P+M|full), bucket_files = the selected test-file count, bucket_duration_ms = the round's own
  // durationMs (the round IS the bucket run — no separate clock).
  const bucketMarker = parseBucketMarker(suiteLog);
  if (bucketMarker !== null) {
    record.buckets = bucketMarker.buckets;
    record.bucket_files = bucketMarker.files;
    record.bucket_duration_ms = durationMs;
  }
  // gap-verification-round-bound-to-quay-shaped-suite-entry AC5 — 项目【声明】的输出约定优先：声明了
  // 至少一个有效字段 ⇒ 用它（声明即权威，⛔ 不因内建形状解析不出就退回默认——那样「可配置」是装饰，
  // 正是硬规则 3b 的假绿形态）。
  const declaredCounts = applyDeclaredTestOutput(suiteLog, o.testOutput);
  let appliedDeclared = null;
  if (declaredCounts !== null) {
    for (const f of DECLARED_COUNT_FIELDS) {
      if (declaredCounts[f] !== undefined) record[f] = declaredCounts[f];
    }
    appliedDeclared = declaredCounts;
  }
  // 内建口径（无声明时的既有行为，逐字不变）：node:test spec-reporter 的 `ℹ pass|fail|cancelled` 行。
  // gap-suite-round-pass-fail-cancel-fields AC1/AC2 — the fan-in suite's node:test summary carries the
  // pass/fail/cancelled tallies (redirected into --suite-log). Write them so the /tests page + Dashboard
  // card render real counts instead of "—". `tests` = pass+fail+cancelled (the same 口径 full-suite-runner
  // writes — it never trusts the `ℹ tests` line for the field). A log without a summary block (a
  // pre-verified reuse whose caller recorded no log path) ⇒ the fields stay ABSENT (honest — a reader
  // renders null as "—"; never fabricate a 0).
  if (declaredCounts === null) {
    const testCounts = parseTestCounts(suiteLog);
    if (testCounts !== null) {
      record.pass = testCounts.pass;
      record.fail = testCounts.fail;
      record.cancelled = testCounts.cancelled;
      record.tests = testCounts.pass + testCounts.fail + testCounts.cancelled;
    }
  }
  // gap-bucket-scoped-worktree-skips-perfile-reporter AC1 — the per-file + capped-file fields ride the
  // fan-in landing path (same absent-field contract as full-suite-runner:3340-3349): perFile present
  // only when parsePerFileLines yielded ≥1 record (a no-reporter/legacy log omits it); floor_ms/ceiling
  // present only when ≥1 __CEILING__ line fired (both appear together — every __CEILING__ line carries a
  // floor). A reader must tolerate their absence (缺键, never a fabricated []).
  const perFile = parsePerFile(suiteLog);
  if (perFile.length > 0) record.perFile = perFile;
  const ceilingFloor = parseCeilingFloor(suiteLog);
  if (ceilingFloor !== null) {
    if (ceilingFloor.floor_ms.length > 0) record.floor_ms = ceilingFloor.floor_ms;
    if (ceilingFloor.ceiling.length > 0) record.ceiling = ceilingFloor.ceiling;
  }
  // Concurrency variables (AC1): nproc + slots are deterministic reads; concurrentSuitesRunning =
  // 1 (this round's own slot) + currently-held OTHER-suite slots at WRITE time, capped at the slot
  // count — the same formula + clamp as full-suite-runner's round-start capture (:2591-2596). The
  // fan-in suite already exited, so "other suites still running" ≈ the concurrent pressure this
  // round experienced; a lone round records 1 (matching the full-suite-runner convention).
  const lockRoot = o.root ? path.resolve(String(o.root)) : process.cwd();
  const slots = concurrentSuiteSlots();
  record.nproc = hostParallelism();
  record.concurrentSuiteSlots = slots;
  record.concurrentSuitesRunning = Math.min(1 + countHeldSuiteLocks(lockRoot), slots);
  // appliedDeclared — AC5 的可见性半边：项目声明了输出约定时回报【实际应用了什么】（空对象 = 声明有效
  // 但一条都没匹配上）。调用方据此把「声明了但没匹配上」与「没声明」在 trace 上区分开（硬规则 3b：
  // 读不懂/没匹配上不得与合格同形）。null = 无有效声明（走了内建解析）。
  return { record, appliedDeclared };
}

/** Append one pre-verified round record to verification-round.jsonl (round = prior lines + 1). */
export function appendPreVerifiedRound(file, record) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let prior = 0;
  if (fs.existsSync(file)) {
    const text = fs.readFileSync(file, "utf8");
    for (const l of text.split("\n")) if (l.trim()) prior++;
  }
  fs.appendFileSync(file, JSON.stringify({ ...record, round: prior + 1 }) + "\n", "utf8");
}

function getArgValue(args, name) {
  const idx = args.indexOf(name);
  return idx === -1 ? undefined : args[idx + 1];
}

const usage = `pre-verified-round-record.ts — SHARED AC1/AC2 writer: append ONE verification-round.jsonl
  record for a full-suite round that ran OUTSIDE full-suite-runner.ts (the fan-in detached suite paths):
  the pre-verified branch (suite ran OUTSIDE the fan-in subagent's round, capture reused — preverified:1)
  AND the real-suite branch (suite ran detached inside this fan-in — preverified:0). SuiteRoundRecord-
  compatible; the preverified boolean marks which branch produced the round.

Usage:
  node --experimental-strip-types plugin/scripts/pre-verified-round-record.ts
      --task-id <taskId> --run-id <runId> --started-at <iso> --duration-ms <ms>
      --lane-count <n> --load <n> --commit <sha>
      [--preverified <0|1|true|false>] [--cpu-time-s <n|null>] [--cpu-source <name>]
      [--cpu-user-s <n|null>] [--cpu-sys-s <n|null>]
      [--suite-log <path>] [--runner <name>] [--root <dir>] [--record-file <file>]
      [--json] [--help]

  --task-id         the fan-in task whose suite landed (required)
  --run-id          the fan-in runId (required)
  --started-at      the suite start, ISO-8601 or epoch-seconds (required)
  --duration-ms     the suite wall-clock in ms (required, non-negative)
  --lane-count      suite lane count (required, non-negative)
  --load            /proc/loadavg 1min at the suite's end (required, non-negative)
  --commit          the pinned verified HEAD (suite_head), 40-hex (required)
  --preverified     1/true = reused a caller-produced capture (pre-verified branch); 0/false = the
                    suite RAN inside this fan-in (real-suite branch). Default 1/true.
  --state           green (default) or red — a RED round writes state=red + reason (+gate/failures)
                    parsed from --suite-log (gap-verification-round-static-fail-no-record: a red fan-in
                    round must land a record, not only the green path).
  --cpu-time-s      the suite's CPU seconds — a real number, or the literal null when the source was
                    considered and UNAVAILABLE (AC6; 0 normalizes to null)
  --cpu-source      WHERE the cpu_time_s came from ('gnu-time' / 'not-wired'; optional)
  --cpu-user-s      the suite's gnu-time USER cpu seconds — the "%U" column of the same "%U %S" line
                    whose sum is cpu_time_s. Real number or null (0 → omitted, AC6). Requires a real
                    --cpu-time-s (a split without its sum is ambiguous — fail-closed). Optional
  --cpu-sys-s       the suite's gnu-time SYSTEM cpu seconds — the "%S" column (same contract).
                    user+sys ≈ cpu_time_s by construction (same source line). Optional
  --suite-log       the fan-in suite log path — parse its __OVERHEAD__ <phase>_ms=N lines into
                    static/serial/lowconc/main phase fields + lock_wait_ms (test.sh's flock marker)
                    + record nproc/concurrentSuiteSlots/concurrentSuitesRunning (same 口径 as
                    full-suite-runner), AND parse its node:test spec-reporter summary into
                    pass/fail/cancelled/tests (gap-suite-round-pass-fail-cancel-fields), AND its
                    measure-suite-reporter lines into perFile/ceiling/floor_ms
                    (gap-bucket-scoped-worktree-skips-perfile-reporter). On an overlap
                    round lowconc_phase_ms carries the overlap_lowconc_ms sub-time instead of the
                    subsumed 0. effective_parallelism is derived from --cpu-time-s ÷ --duration-ms.
                    When the log is absent or unreadable the row is EXPLICITLY phase-less and
                    count-less (no fabricated fields).
  --runner          nominal runner identity (default 'outer', matching the existing ledger)
  --root            repo root (default: cwd) — resolves the shared checkout via git common-dir
  --record-file     override the ledger path (hermetic tests)
  --json            machine-readable output {ok, record, file}
  --help            this help

Exit codes:
  0  one record appended
  2  usage / environment error (missing/invalid field, unresolvable shared checkout) — nothing written`;

export function main(argv) {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(usage + "\n");
    return 0;
  }
  const root = path.resolve(getArgValue(args, "--root") ?? process.cwd());
  const recordFileOverride = getArgValue(args, "--record-file");
  const asJson = args.includes("--json");

  const fail = (msg) => {
    if (asJson) console.log(JSON.stringify({ ok: false, error: msg }));
    else console.error(`pre-verified-round-record: ${msg}`);
    return 2;
  };

  const built = buildPreVerifiedRoundRecord({
    taskId: getArgValue(args, "--task-id"),
    runId: getArgValue(args, "--run-id"),
    startedAt: getArgValue(args, "--started-at"),
    durationMs: getArgValue(args, "--duration-ms"),
    laneCount: getArgValue(args, "--lane-count"),
    load: getArgValue(args, "--load"),
    commit: getArgValue(args, "--commit"),
    preverified: getArgValue(args, "--preverified"),
    cpuTimeS: getArgValue(args, "--cpu-time-s"),
    cpuSource: getArgValue(args, "--cpu-source"),
    cpuUserS: getArgValue(args, "--cpu-user-s"),
    cpuSysS: getArgValue(args, "--cpu-sys-s"),
    runner: getArgValue(args, "--runner"),
    suiteLog: getArgValue(args, "--suite-log"),
    state: getArgValue(args, "--state"),
    root,
  });
  if (built.error) return fail(built.error);
  const record = built.record;

  let recordFile;
  if (recordFileOverride) {
    recordFile = path.resolve(recordFileOverride);
  } else {
    const shared = resolveSharedCheckout(root);
    if (!shared) return fail(`cannot resolve the shared checkout from ${root} (git common-dir failed)`);
    recordFile = path.join(shared, ".quay", "verification-round.jsonl");
  }

  try {
    appendPreVerifiedRound(recordFile, record);
  } catch (e) {
    return fail(`append failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (asJson) {
    console.log(JSON.stringify({ ok: true, record, file: recordFile }));
  } else {
    console.log(`pre-verified-round-record: appended round ${record.round} (${record.taskId} run ${record.runId}) → ${recordFile}`);
  }
  return 0;
}

if (isDirectEntry(import.meta, undefined, "pre-verified-round-record")) {
  process.exitCode = main(process.argv);
}
