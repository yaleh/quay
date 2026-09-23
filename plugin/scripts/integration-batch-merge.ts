#!/usr/bin/env node
// integration-batch-merge.sh — the integration→develop batch-merge helper of the two-line branch
// model (gap-branch-model-integration-branch-splits-fork-baseline-from-merge-point, AC3; real-merge
// mode per gap-integration-batch-merge-ff-only-contradicts-real-merge-ruling).
//
// THIS FILE IS THE IMPLEMENTATION (tasks/gap-arch-tsify-integration-batch-merge-sh, SPEC-architecture-
// consolidation §5 Phase 5.2). `plugin/scripts/integration-batch-merge.sh` is now a THIN wrapper that
// execs this module, so the written-down entry (`bash plugin/scripts/integration-batch-merge.sh …`,
// the form every caller, test and doc uses) is unchanged while the body — including the two embedded
// interpreters (node for orphan-session-check.ts, python3 for JSON reads) — lives in one TS module.
// Behaviour is pinned by plugin/test/integration-batch-merge-characterization.test.mjs, whose
// fingerprint was taken against the pre-rewrite bash first and is byte-identical after the rewrite.
//
// RETIRED (AC48 2026-08-13) — 退役说明 → orchestration/archive/AC58-retired-clauses.md#R22.
// This script is KEPT AS THE REASON ARCHIVE (not deleted); no production path should invoke it.
//
// Under the two-line model the outer verification-round batch-merges `integration` → `develop`.
// The ORIGINAL design assumed this is ALWAYS a fast-forward (integration is always a descendant of
// develop, SPEC §4). That assumption was EMPIRICALLY NEGATED on 2026-08-06 23:48 (a 60-second
// disproof: develop advances via direct inner/outer/manager commits within a minute of an alignment
// merge), and the direction ruling (2026-08-06 23:4x) changed integration→develop from FF-only to
// real-merge on divergence.
//
// Modes:
//   default (no --merge) — fast-forward when integration is a descendant of develop; on TRUE
//     divergence (develop has commits integration lacks) report the divergence surface
//     (develop-only / integration-only counts + would-conflict file list) and FAIL CLOSED (needs a
//     human, nothing moved) — never a blind --ours/--theirs.
//   --merge — on TRUE divergence, perform a REAL merge of `integration` into `develop` (a merge
//     commit, built in a throwaway temp git worktree; the primary checkout is never touched).
//     Conflicts on KNOWN SHARED files (defaults: *tick-log.md, tasks/*.md, *queue-state* — files
//     written directly to develop by the inner/outer/manager, whose authoritative version lives on
//     develop) are auto-resolved develop-authoritative; conflicts on REVERSE-EDGE files
//     (--integration-authoritative — RUNTIME CONFIG files that tasks edit on INTEGRATION, where
//     develop's copy can be the STALE/DEFECTIVE one; see the reverse-edge section below) are
//     auto-resolved integration-authoritative, gated on a content criterion when one is supplied;
//     any REAL code conflict FAILS CLOSED (needs a human, nothing moved, conflict file list
//     reported) — never blind --ours/--theirs on code. Fast-forward when possible (no gratuitous
//     merge commits).
//
// REVERSE EDGE (gap-batch-merge-authoritative-direction-hardcoded-develop, 2026-08-08):
//   The conflict resolution direction is NOT a fixed "develop always wins". Empirical anchor
//   (2026-08-08 14:1xZ, integration→develop real merge): orchestration/session-liveness.env was a
//   genuine code conflict (not shared). The two sides:
//     develop     SESSION_TRANSCRIPTS="inner /path"   DEFECTIVE — name NOT in SESSION_TARGETS table
//                                                      (transcript silently ignored, monitor blind)
//     integration SESSION_TRANSCRIPTS="quay /path"    FIXED — name IN the SESSION_TARGETS table
//   The CORRECT resolution is integration-authoritative, decided by a CONTENT criterion ("the
//   SESSION_TRANSCRIPTS name must be in the SESSION_TARGETS table"), not a fixed direction. The
//   tool had no way to express that (only develop-authoritative resolve_as_ours existed), so the
//   outer manual-bypassed the tool. This task adds the reverse edge so the tool CAN express it.
//   Direction semantics: a REVERSE-EDGE candidate resolves to the integration side ONLY IF the
//   integration side satisfies the content criterion (--reverse-edge-criterion); a candidate whose
//   integration side FAILS the criterion (or no criterion was supplied AND the caller chose the
//   fixed-direction form) is resolved by whatever was declared. Without any reverse-edge
//   declaration a non-shared conflict stays fail-closed (AC4 preserved).
//   --reconcile — after a successful batch merge (ff or real), reconcile the PRIMARY checkout (the
//     checkout the outer loop lives in; the advanced <develop> branch may be checked out there). The
//     ref-level update-ref moves <develop> UNDER the checkout, leaving its HEAD/index STALE (git status
//     shows the old-vs-new tree as staged changes). The reconcile is provided HERE so callers don't
//     invent it: (1) BEFORE any ref moves, a porcelain-empty guard on the primary checkout FAILS CLOSED
//     if there is uncommitted/untracked work — a caller-invented `git reset --hard HEAD` destroyed an
//     uncommitted manager edit on 2026-08-08 08:08:24 (real data loss); (2) after the merge, the index
//     is refreshed with `git reset --mixed <new develop tip>` — index ONLY, never --hard, working tree
//     untouched.
//
// Contract (task body):
//   measure   integration_ff_merges = `git merge-base --is-ancestor <integration> <develop>` exit code
//             (0 = integration's tip is reachable from develop = its commits are absorbed)
//   band      integration_ff_merges = 0 (POST-state: after a successful batch merge integration is an
//             ancestor of develop; the PRE-state ff-ability check is `--is-ancestor <develop> <integration>`)
//   invoke    `git log --oneline develop..integration` (only pending-verification task merges, never empty
//             during a red window)
//   control   a task merged into integration during a red window does NOT block; a touch-declaration
//             imprecision shows up as a task→integration merge conflict, never a silent overwrite.
//
//   measure   unmerged_develop_files = `git diff --name-only <merge-base(integration,develop)> <develop>`
//             | grep -cE '\.(ts|js|mjs|sh)$' stdout 数字段 (three-dot semantics: develop-side code files
//             that never entered the tested tree; the raw two-dot also counts integration's OWN tested files)
//   band      unmerged_develop_files = 0 (POST-state: a batch merge may only proceed when the develop-side
//             code files have been verified together with the integration content; pure .md/tasks pass)
//   invoke    `git diff --name-only <merge-base> <develop>` (the develop-only surface the suite never saw)
//   control   negative: develop-side pure .md/tasks files (the 5 files in the 2026-08-08 report) PASS;
//             develop-side code files (.ts/.js/.mjs/.sh) BLOCK before any ref moves.
//
// The helper performs a REF-LEVEL fast-forward (`git update-ref` with a CAS on the old develop tip)
// or a REF-LEVEL real merge (temp worktree → merge → CAS update-ref), so it never touches the primary
// working tree and never needs `integration`/`develop` checked out. It exits non-zero — WITHOUT
// moving any ref — when integration is NOT a descendant of develop AND (no --merge, or a real code
// conflict).
//
// Usage:
//   integration-batch-merge.sh [--root <repo>] [--develop <ref>] [--integration <ref>]
//                              [--dry-run] [--merge] [--shared-file <glob>] [--sync]
//   --root        repo root (default: auto-derived from this script's location)
//   --develop     develop ref (default: develop)
//   --integration integration ref (default: integration)
//   --dry-run     check ff-ability + report the measure WITHOUT moving any ref; on divergence, also
//                 report the divergence surface (develop-only / integration-only counts + would-
//                 conflict file list)
//   --merge       on TRUE divergence, perform a REAL merge (a merge commit) instead of failing
//                 closed: conflicts on known shared files (defaults: *tick-log.md, tasks/*.md,
//                 *queue-state*) auto-resolve develop-authoritative; real code conflicts FAIL CLOSED
//                 (never blind --ours/--theirs). Fast-forward when possible.
//   --shared-file <glob>  add a path glob treated as a KNOWN SHARED file (develop-authoritative on
//                 conflict). Repeatable; defaults: *tick-log.md, tasks/*.md, *queue-state*.
//   --integration-authoritative <glob>
//                 add a path glob treated as a REVERSE-EDGE file: on conflict the path resolves to the
//                 INTEGRATION side (`checkout --theirs`). Repeatable. This is the escape hatch for
//                 RUNTIME CONFIG files (env/config) that tasks edit on INTEGRATION, where develop's copy
//                 can be the STALE/DEFECTIVE one (2026-08-08 session-liveness.env: develop "inner"
//                 name-not-in-table vs integration "quay" name-in-table). The direction SHOULD be backed
//                 by a content criterion (--reverse-edge-criterion): the integration side is then taken
//                 only when IT satisfies the criterion; otherwise the file fails closed (never
//                 blind-choose).
//   --reverse-edge-criterion <script>
//                 a content-criterion script gating reverse-edge resolution. Interface: `bash <script>
//                 <path>` with the INTEGRATION-side version of the conflicted file on stdin; exit 0 =
//                 criterion satisfied (integration authoritative → take theirs); any non-zero = NOT
//                 satisfied → the reverse-edge candidate becomes a genuine conflict (fail-closed, needs
//                 a human). When omitted, --integration-authoritative files resolve integration-side
//                 unconditionally (the fixed-direction form).
//   --deliver     (DIR-123 人裁定 2026-08-11) after a successful land closure (ff or real), launch
//                 develop-deliver-tgz.sh DETACHED (best-effort, non-blocking — a remote being down
//                 never fails the merge): builds a fresh hardware-independent quay .tgz at the merged
//                 develop tip, scp's it to the verification machines B/C, installs with their existing
//                 Node >=20, and proves `quay serve` returns 200. Freshness is recorded in
//                 .quay/develop-deliver-state.json; the outer tick retries when stale.
//   --sync        (gap-cross-machine-sync-has-no-mechanism-only-manual-pushes) after a successful
//                 merge (ff or real), IMMEDIATELY push the advanced <develop> ref to origin via
//                 sync-lag-check.sh (the event-driven trigger of the cross-machine sync mechanism —
//                 the push happens in the SAME round as the land closure, not at the next tick).
//   --sync-pull   (gap-two-peer-quay-developers-continuous-bidirectional-merge AC1) BEFORE the batch
//                 merge, run the DOWNSYNC half of the bidirectional merge: pull origin/<develop> into
//                 the LOCAL <develop> via sync-lag-check.sh --pull, so the merge base includes the
//                 peer's latest (the human frame: both machines continuously apply latest and develop
//                 on latest). A TRUE divergence (local develop AND origin/develop each have commits the
//                 other lacks) FAILS CLOSED (nothing moved) — the real bidirectional merge is the
//                 loop's own red-window/merge handling, never a blind --ours/--theirs at land time.
//                 The merge is the primary outcome; a push failure (non-fast-forward = a real
//                 cross-machine divergence) is REPORTED and does not roll the ref back — the
//                 every-tick heartbeat retries it.
//   --reconcile  after a successful batch merge, reconcile the primary checkout's stale index: run a
//                porcelain-empty guard first (fail-closed on uncommitted/untracked work, owners
//                reported), then `git reset --mixed <new develop tip>` — index only, never --hard.
//   --fan-in <taskId>  FAN-IN MODE (gap-task-telemetry-6-percent-join): per-task fan-in merge of
//                `task/<taskId>` into the CURRENT CHECKOUT's branch (fast-mode's $MERGE_TARGET),
//                with the telemetry runId embedded in the commit subject — "merge: fan-in task/<id>
//                (runId: fm-...)" — the position-parseable bridge that makes git landing records and
//                telemetry records joinable (the 6% join-rate defect). Requires --run-id. Skips the
//                batch-merge gates entirely (it exits before them); the batch-merge flow is unchanged
//                and remains the default when --fan-in is absent.
//   --run-id <id>  the telemetry runId (from fast-mode-telemetry.ts --task-start). REQUIRED by
//                --fan-in <taskId> (embedded in the fan-in commit subject, position-parseable). In the
//                batch-merge path (--merge on divergence) it is embedded in the REAL merge commit's
//                message (`(runId: <id>)`) — the telemetry taskId → git traceability link
//                fan-in-runid-check.ts reads. Must be filename-safe. No-op on the fast-forward path
//                (creates no commit).
//
//   OBJECT GATE (gap-batch-merge-gate-validates-tip-not-merge-result): before ANY merge (ff or real),
//                the helper validates the MERGE RESULT, not just the integration tip. The suite tested
//                the INTEGRATION TIP; the batch merge produces integration ⊕ develop. develop-only
//                changes since the divergence point never entered the tested tree — if any are code
//                files (.ts/.js/.mjs/.sh), the merge result would ship untested code and the helper
//                FAILS CLOSED (nothing moved, the offending files reported). Pure .md/tasks files on
//                the develop side PASS (e.g. the 5 files in the 2026-08-08 report). The gate uses
//                three-dot semantics (`git diff --name-only <merge-base> <develop>`), NOT the raw
//                two-dot `git diff integration develop` — the two-dot also lists integration's OWN
//                tested files, a false positive the gate must avoid.
//
//   FRESHNESS GATE (gap-batch-merge-gate-reads-stale-green; gap-batch-merge-freshness-gate-ignores-scope;
//                   gap-batch-merge-freshness-gate-doc-only-exemption):
//                before ANY merge (ff or real), the helper requires a FRESH suite green — the batch-merge
//                gate previously read ONLY `state == green` and treated a 3-hour-old green (measuring a
//                DIFFERENT batch of commits) as a pass for THIS tree (7b1ac3a1, 2026-08-08). The gate
//                also previously IGNORED the state's `scope` field, so a green from ANY linked worktree
//                (even one testing a completely unrelated tree) satisfied the gate. Three dimensions,
//                all required:
//                  state == green (not running/red; a missing state file FAILS CLOSED — no valid green)
//                  scope == main (a WORKTREE-sourced green is DEFERRABLE — the runner tags every state
//                    `scope: main|worktree`, gap-worktree-scoped-runs-consume-resources-but-produce-no-
//                    signal AC1; only a main-repo green is the authoritative signal the batch merge may
//                    trust — the SCOPE axis). scope absent (legacy state) = treat as main (fail-open)
//                  finishedAt within --freshness-window (default 3600s) of now  — the AGE axis
//                  suite startedAt >= most-recent integration fan-in commit time — the COVERAGE axis
//                DOC-ONLY EXEMPTION (gap-batch-merge-freshness-gate-doc-only-exemption): the COVERAGE
//                axis is EXEMPT when every file the fan-in(s) changed after the suite started is doc-only
//                (.md/.jsonl — `git diff --name-only <integration-tip-as-of-suite-start> <integration>`)
//                — doc-only commits (phase-goal/SPEC/task edits) cannot change the test surface, so
//                blocking forces a needless 17-min full-suite re-run (rounds 153/157/158). A pending
//                change touching ANY other file type (a code file) is NOT exempt — fail-closed as before.
//                FAILS CLOSED (nothing moved) on any violation. `--skip-freshness-gate` is the explicit
//                opt-out for callers exercising OTHER gates in isolation; the real orchestrator
//                invocation never passes it (the gate is ON by default — mechanical, not self-judged).
//
//   WORKTREE-GREEN GATE (gap-suite-fix-scope-worktree-green-merge-gate): before ANY merge (ff or real),
//                the helper requires at least one suite-fix self-test round on record — a
//                `verification-round.jsonl` line with `scope=worktree` AND `state=green`
//                (`<repo_root>/.quay/verification-round.jsonl`). The suite-fix subagent's fan-in is the
//                step that must be gated: without this record there is NO mechanical evidence the
//                subagent ever self-tested green in its OWN worktree (rounds 230/231 scope=main were the
//                second subagent waiting on the shared checkout — the A15 ④ 三保障 all silently failed
//                while each 条文 "没被违反"). Data already exists (full-suite-runner.ts writes
//                scope/state); this is a CONSUMER-SIDE pre-assertion, NO new mechanism. Fail-closed:
//                record absent OR present-but-no-worktree+green (scope missing on a legacy line ⇒ not
//                counted) ⇒ reject the merge with an actionable message (先在自己 worktree 自测绿).
//                `--skip-worktree-green-gate` is the explicit opt-out for callers exercising OTHER gates
//                in isolation; the real orchestrator/suite-fix invocation never passes it (ON by default).
//
// Exit codes:
//   0  merge performed (ff or real) OR nothing pending (integration already absorbed into develop);
//      with --dry-run, the ff-ability / divergence surface was reported without moving any ref
//   1  NOT a fast-forward and no --merge (needs a human), OR a real code conflict in --merge mode
//      (fail-closed, nothing moved), OR the object gate blocked (develop-side code files outside the
//      tested tree — fail-closed, nothing moved), OR the freshness gate blocked (no valid fresh green —
//      stale/missing/running/non-main-scope suite state — fail-closed, nothing moved), OR the
//      worktree-green gate blocked (no scope=worktree+state=green round on record — the suite-fix
//      subagent never self-tested green in its own worktree — fail-closed, nothing moved)
//   2  usage / missing ref

import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { repoRoot as moduleRepoRoot } from "./repo-root.ts";

// ── output helpers ──────────────────────────────────────────────────────────────────────────────
// `echo "x"` / `echo "x" >&2`: one line, plus a newline. Kept as named helpers so the stdout/stderr
// split (which the characterization fingerprint records) is stated once, not re-decided per call.
const say = (m: string): void => { process.stdout.write(m + "\n"); };
const err = (m: string): void => { process.stderr.write(m + "\n"); };

/** `$(…)`: command substitution strips ALL trailing newlines (bash semantics, not trimEnd — a
 *  trailing space is preserved). */
const stripNl = (s: string): string => s.replace(/\n+$/, "");

/** `printf '%s\n' "$x"` — always at least one line (the empty string prints one empty line). */
const linesOf = (s: string): string[] => s.split("\n");

interface Res { status: number; stdout: string; stderr: string }

const SELF = fileURLToPath(import.meta.url);

// ── 统一 --help（gap-scripts-sprawl：用法在前、退出 0、无业务副作用）────────────────────
// The documented entry is the `.sh` path (every caller, test and doc uses it), so the FIRST line is
// the canonical `用法: bash integration-batch-merge.sh …` even when this module is invoked directly:
// the wrapper and this implementation must not print two different contracts.
const HELP_FIRST_LINE =
  "用法: bash integration-batch-merge.sh [参数…] — 详见下方脚本头部用法注释（--help|-h 仅打印用法，无副作用，退出 0）";

/** Print this file's own leading comment block, `#`/`//`-stripped — the tool_help contract
 *  (`awk 'NR<=120 && /^#/ …'`), generalized to the TS comment form. */
function headerCommentLines(limit: number, stopAtFirstCode: boolean): string[] {
  const src = fs.readFileSync(SELF, "utf8").split("\n");
  const out: string[] = [];
  const n = Math.min(limit, src.length);
  for (let i = 1; i < n; i++) {
    const line = src[i] as string;
    if (!/^(#|\/\/)/.test(line)) {
      if (stopAtFirstCode) break;
      continue;
    }
    const stripped = line.replace(/^(#|\/\/) ?/, "");
    if (stripped.startsWith("!")) continue;
    out.push(stripped);
  }
  return out;
}

if (process.argv[2] === "--help" || process.argv[2] === "-h") {
  say(HELP_FIRST_LINE);
  for (const l of headerCommentLines(120, false)) say(l);
  process.exit(0);
}

// ── location + git plumbing ─────────────────────────────────────────────────────────────────────
const SCRIPT_DIR = path.dirname(SELF);
let repoRoot = moduleRepoRoot();

/** `git -C <repoRoot> …`. Never throws: a failed spawn surfaces as a non-zero exit code, matching
 *  the bash helper's explicit status handling (the script is `set -uo pipefail`, NOT `-e` — failures
 *  are never fatal, each call site decides). */
function git(...args: string[]): Res {
  return gitAt(repoRoot, ...args);
}

function gitAt(cwd: string, ...args: string[]): Res {
  const r = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  return { status: r.status === null ? 127 : r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/** A command's STDOUT only, `$( )`-stripped, or "" when the command failed (`… 2>/dev/null || true`). */
function gitOut(...args: string[]): string {
  const r = git(...args);
  return r.status === 0 ? stripNl(r.stdout) : "";
}

/** `"$(bash <script> … 2>&1)"` — run a helper script with stderr MERGED into stdout in true stream
 *  order (two separate pipes would lose the interleaving). `exec bash "$0" "$@"` — note the explicit
 *  `bash`, NOT a bare `exec "$0"`: the helper scripts are not required to carry the +x bit, and the
 *  bash original always invoked them as `bash <path>` (a bare exec made sync-lag-check.sh fail with
 *  "cannot execute: Permission denied" — exit 126 on a test fixture that has the read bit only). */
function runShellMerged(script: string, args: string[]): Res {
  const r = spawnSync("bash", ["-c", 'exec bash "$0" "$@" 2>&1', script, ...args], { encoding: "utf8" });
  return { status: r.status === null ? 127 : r.status, stdout: r.stdout ?? "", stderr: "" };
}

// ── options ─────────────────────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
let developRef = "develop";
let integrationRef = "integration";
let dryRun = 0;
let sync = 0;
let syncPull = 0;
let deliver = 0;
let mergeMode = 0;
let reconcile = 0;
// ── FAN-IN MODE (gap-task-telemetry-6-percent-join) ─────────────────────────────────────────────
// Per-task fan-in (task/<id> → the current checkout's branch — fast-mode's $MERGE_TARGET) with the
// telemetry runId embedded in the commit subject. Empty by default (the batch-merge flow is the
// default); set by --fan-in <taskId> / --run-id <runId>.
let fanInTask = "";
// ── runId (gap-task-telemetry-6-percent-join) ───────────────────────────────────────────────────
// The telemetry runId (from fast-mode-telemetry.ts --task-start). REQUIRED by --fan-in <taskId>
// (embedded in the fan-in commit subject); when a REAL merge commit is created (--merge on
// divergence), it is embedded in the commit message (`(runId: <id>)`) — the telemetry taskId → git
// branch traceability link fan-in-runid-check.ts reads. The fast-forward path creates NO commit
// (ref-level update-ref), so it has no message to annotate.
let runId = "";
// ── FRESHNESS GATE (gap-batch-merge-gate-reads-stale-green) ───────────────────────────────────────
// The batch merge may only proceed when the suite green is a FRESH green that actually verified the
// CURRENT integration tip. Defaults: gate ON (mechanical — the outer's suiteGreen rule and the script's
// own check are the SAME gate, no "document says mechanical, actual is self-judged" gap), window 3600s,
// state file at <repo_root>/.quay/full-suite-state.json. `--skip-freshness-gate` is the explicit
// opt-out for callers exercising OTHER gates (object / reconcile / real-merge conflict) in isolation.
let skipFreshnessGate = 0;
let freshnessWindow = 3600;
let suiteStateFile = "";
// ── WORKTREE-GREEN GATE (gap-suite-fix-scope-worktree-green-merge-gate) ──────────────────────────────
// suite-fix subagent fan-in 前置断言：fan-in 前必须存在 ≥1 条 `scope=worktree` 且 `state=green` 的轮次
// 记录（verification-round.jsonl），否则拒绝 merge。`--skip-worktree-green-gate` 是显式 opt-out（测试
// 隔离其他门用）；真实 orchestrator/suite-fix 调用不传（门默认 ON，机械而非自判）。
let skipWorktreeGreenGate = 0;
// Known-shared files: written directly to develop by the inner/outer/manager; integration's copies
// are stale — on conflict, develop is authoritative. Matched against conflicted paths via glob match.
const sharedPatterns: string[] = ["*tick-log.md", "tasks/*.md", "*queue-state*"];
// REVERSE-EDGE (integration-authoritative) files: RUNTIME CONFIG files (env/config) that tasks edit
// on INTEGRATION — develop's copy lags and can be the DEFECTIVE one (2026-08-08 session-liveness.env:
// develop "inner" name-not-in-table vs integration "quay" name-in-table). On conflict these resolve to
// the INTEGRATION side (`checkout --theirs`) instead of develop. Checked BEFORE sharedPatterns (an
// explicit reverse-edge declaration overrides the develop-authoritative default for that path).
// Direction is CONTENT-criterion-driven when reverseEdgeCriterion is set: integration is taken ONLY
// IF its side satisfies the criterion; otherwise the candidate fails closed (never blind-choose).
const intAuthoritativePatterns: string[] = [];
let reverseEdgeCriterion = "";
// Populated by reportDivergence() — the would-conflict file list (empty = none / disjoint).
let wouldConflicts: string[] = [];

/** Print the header comment block (line 2 .. the last `#` comment line) as the usage text, to
 *  STDERR, exit 2. The end is derived from the file, not hardcoded, so header edits never truncate
 *  the usage. */
function usage(): never {
  for (const l of headerCommentLines(Number.MAX_SAFE_INTEGER, true)) err(l);
  process.exit(2);
}

{
  let i = 0;
  const nextValue = (flag: string): string => {
    i++;
    if (i >= argv.length) {
      err(`integration-batch-merge: ${flag} requires a value`);
      process.exit(2);
    }
    return argv[i] as string;
  };
  while (i < argv.length) {
    const a = argv[i] as string;
    if (a === "--root") repoRoot = nextValue(a);
    else if (a === "--develop") developRef = nextValue(a);
    else if (a === "--integration") integrationRef = nextValue(a);
    else if (a === "--dry-run") dryRun = 1;
    else if (a === "--merge") mergeMode = 1;
    else if (a === "--shared-file") sharedPatterns.push(nextValue(a));
    else if (a === "--integration-authoritative") intAuthoritativePatterns.push(nextValue(a));
    else if (a === "--reverse-edge-criterion") reverseEdgeCriterion = nextValue(a);
    else if (a === "--sync") sync = 1;
    else if (a === "--sync-pull") syncPull = 1;
    else if (a === "--deliver") deliver = 1;
    else if (a === "--reconcile") reconcile = 1;
    else if (a === "--run-id") runId = nextValue(a);
    else if (a === "--skip-freshness-gate") skipFreshnessGate = 1;
    else if (a === "--skip-worktree-green-gate") skipWorktreeGreenGate = 1;
    else if (a === "--freshness-window") freshnessWindow = Number(nextValue(a));
    else if (a === "--suite-state-file") suiteStateFile = nextValue(a);
    else if (a === "--fan-in") fanInTask = nextValue(a);
    else usage();
    i++;
  }
}

if (!fs.existsSync(path.join(repoRoot, ".git"))) {
  err(`integration-batch-merge: not a git repo: ${repoRoot}`);
  process.exit(2);
}

// Precompiled glob matchers for the shared / reverse-edge pattern lists (bash `case` globs, where
// `*` also crosses `/`). Compiled once so a per-conflict match stays allocation-free.
const globCache = new Map<string, RegExp>();
function globMatch(pattern: string, value: string): boolean {
  let re = globCache.get(pattern);
  if (re === undefined) {
    let body = "";
    for (const ch of pattern) {
      if (ch === "*") body += ".*";
      else if (ch === "?") body += ".";
      else body += ch.replace(/[.+^${}()|[\]\\]/, "\\$&");
    }
    re = new RegExp(`^${body}$`);
    globCache.set(pattern, re);
  }
  return re.test(value);
}

// Is a conflicted path a KNOWN SHARED file (develop-authoritative on conflict)?
function isSharedFile(p: string): boolean {
  return sharedPatterns.some((pat) => globMatch(pat, p));
}

// Is a conflicted path a REVERSE-EDGE (integration-authoritative) file? Checked BEFORE sharedPatterns
// — an explicit --integration-authoritative declaration overrides the develop-authoritative default.
function isIntegrationAuthoritativeFile(p: string): boolean {
  return intAuthoritativePatterns.some((pat) => globMatch(pat, p));
}

// gap-suite-leaks-live-claude-sessions — stop every claude session whose --settings workspace is under
// the given worktree path, BEFORE the worktree is removed (注销 worktree 前停其会话). A teardown that
// only `git worktree remove`s the dir leaks any live claude session launched inside it (the
// manager-productization2 119h orphan pair). Best-effort: a missing orphan-session-check.ts or a
// transient process race never fails the removal.
function stopSessionsUnderWorktree(wt: string): void {
  if (!wt) return;
  const osc = path.join(SCRIPT_DIR, "orphan-session-check.ts");
  if (!fs.existsSync(osc)) {
    err(`integration-batch-merge: WARNING orphan-session-check.ts not found at ${osc} — sessions under ${wt} not stopped (leak risk)`);
    return;
  }
  try {
    spawnSync("node", ["--no-warnings", "--experimental-strip-types", osc, "--kill-workspace", wt], { stdio: "ignore" });
  } catch {
    /* best-effort */
  }
}

// Run the content-criterion script against the INTEGRATION (theirs) side of a conflicted path.
// Interface: `bash <script> <path>` with the integration-side file content on stdin. Exit 0 = criterion
// satisfied (integration is authoritative → take theirs). Any non-zero = NOT satisfied — the reverse-edge
// candidate has NO mechanical basis to take integration, so it becomes a genuine conflict (fail-closed;
// never blind-choose either side).
function criterionSatisfied(wt: string, p: string): boolean {
  const content = gitAt(wt, "show", `:3:${p}`);
  const payload = content.status === 0 ? stripNl(content.stdout) : "";
  const r = spawnSync("bash", [reverseEdgeCriterion, p], { input: payload + "\n", encoding: "utf8" });
  return r.status === 0;
}

// Resolve one conflicted path to the develop side ("ours" — we merge integration INTO develop).
// Covers modify/modify, add/add, theirs-deleted (checkout --ours) and ours-deleted (git rm).
function resolveAsOurs(wt: string, p: string): void {
  if (gitAt(wt, "checkout", "--ours", "--", p).status === 0) {
    gitAt(wt, "add", "--", p);
  } else {
    // ours (develop) DELETED the path — develop-authoritative = keep it deleted.
    gitAt(wt, "rm", "-q", "--", p);
  }
}

// Resolve one conflicted path to the integration side ("theirs" — the reverse edge). Reverse of
// resolveAsOurs: modify/modify and add/add take the integration version (checkout --theirs); a
// theirs-deleted case (ours modified, integration deleted) keeps it deleted (git rm).
function resolveAsTheirs(wt: string, p: string): void {
  if (gitAt(wt, "checkout", "--theirs", "--", p).status === 0) {
    gitAt(wt, "add", "--", p);
  } else {
    // theirs (integration) DELETED the path — integration-authoritative = keep it deleted.
    gitAt(wt, "rm", "-q", "--", p);
  }
}

// Report the divergence surface (AC1): develop-only / integration-only counts + would-conflict files.
// Used by BOTH the dry-run report and the pre-merge report of the real path. Populates the global
// wouldConflicts array with the would-conflict file list (empty = none / disjoint).
function reportDivergence(): void {
  wouldConflicts = [];
  const devOnly = gitOut("rev-list", "--count", `refs/heads/${integrationRef}..refs/heads/${developRef}`) || "0";
  const intOnly = gitOut("rev-list", "--count", `refs/heads/${developRef}..refs/heads/${integrationRef}`) || "0";
  say("integration-batch-merge: DIVERGENCE — develop and integration have diverged (NOT a fast-forward)");
  say(`integration-batch-merge:   develop-only commits:     ${devOnly}`);
  say(`integration-batch-merge:   integration-only commits: ${intOnly}`);
  // Would-conflict file list, computed WITHOUT touching refs via `git merge-tree` (exit 1 = conflicts).
  const mt = git("merge-tree", "--write-tree", "--name-only", `refs/heads/${developRef}`, `refs/heads/${integrationRef}`);
  if (mt.status === 1) {
    // `tail -n +2 | sed '/^$/,$d'`: drop the tree-OID line, then stop at the first blank line.
    const rest = linesOf(stripNl(mt.stdout)).slice(1);
    for (const l of rest) {
      if (l === "") break;
      wouldConflicts.push(l);
    }
  }
  if (wouldConflicts.length > 0) {
    say("integration-batch-merge:   would-conflict files:");
    for (const p of wouldConflicts) say(`integration-batch-merge:     ${p}`);
  } else {
    say("integration-batch-merge:   would-conflict files: (none — changes are file-disjoint)");
  }
}

// Report the conflict classification (shared / integration-authoritative / code) for the GIVEN path
// list. Shared = auto-resolve develop-authoritative; integration-authoritative = reverse-edge,
// auto-resolve to the INTEGRATION side (criterion-gated in --merge); code = fail-closed, needs human.
function reportConflictClassification(paths: string[]): void {
  const shared: string[] = [];
  const intAuth: string[] = [];
  const code: string[] = [];
  for (const p of paths) {
    if (isIntegrationAuthoritativeFile(p)) intAuth.push(p);
    else if (isSharedFile(p)) shared.push(p);
    else code.push(p);
  }
  say("integration-batch-merge:   conflict classification:");
  say(`integration-batch-merge:     shared (auto-resolve develop-authoritative): ${shared.length}`);
  for (const p of shared) say(`integration-batch-merge:       ${p}`);
  say(`integration-batch-merge:     integration-authoritative (reverse-edge, integration side): ${intAuth.length}`);
  for (const p of intAuth) say(`integration-batch-merge:       ${p}`);
  say(`integration-batch-merge:     code (fail-closed, needs human):             ${code.length}`);
  for (const p of code) say(`integration-batch-merge:       ${p}`);
}

// --sync: event-driven cross-machine push (gap-cross-machine-sync-has-no-mechanism-only-manual-pushes).
// The land closure just advanced <develop>; push it to origin IMMEDIATELY (same round, not next tick).
function doSync(): void {
  if (sync !== 1) return;
  const slc = path.join(SCRIPT_DIR, "sync-lag-check.sh");
  if (fs.existsSync(slc)) {
    const r = runShellMerged(slc, ["--root", repoRoot, "--branch", developRef, "--remote", "origin", "--push"]);
    for (const l of linesOf(stripNl(r.stdout))) say(l);
    if (r.status !== 0) {
      err(`integration-batch-merge: SYNC-PUSH FAILED (exit ${r.status}) — develop advanced locally but origin/${developRef} NOT updated; the every-tick heartbeat will retry (divergence = human resolution)`);
    } else {
      say("integration-batch-merge: sync-push ok (develop → origin, same round as the land closure)");
    }
  } else {
    err(`integration-batch-merge: --sync requested but sync-lag-check.sh not found at ${slc}; skipping event-driven push (heartbeat will cover it)`);
  }
}

// --deliver: DIR-123 (人裁定 2026-08-11) — after the land closure advanced <develop>, deliver a FRESH
// hardware-independent quay .tgz to the verification machines B/C and prove it runs (quay serve → 200).
// This is the "auto-build after every merge to develop" mechanism: develop advances ONLY via this
// script, so the hook here is airtight. BEST-EFFORT BY DESIGN: a remote being down must never fail the
// merge — the deliver failure is logged + recorded in develop-deliver-state.json, and the outer tick
// retries when the state looks stale. Zero new secrets (local ~/.ssh/id_ed25519 reaches B/C already).
// The deliver is launched DETACHED (setsid) so it does NOT block the merge round — the build alone
// (package.sh: dist + sync-vendor + plugin-dist + npm pack) takes minutes.
function doDeliver(): void {
  if (deliver !== 1) return;
  const dds = path.join(SCRIPT_DIR, "develop-deliver-tgz.sh");
  if (!fs.existsSync(dds)) {
    err(`integration-batch-merge: --deliver requested but develop-deliver-tgz.sh not found at ${dds}; skipping`);
    return;
  }
  const deliverLog = path.join(repoRoot, ".quay", "deliver-run.log");
  say(`integration-batch-merge: launching detached develop-deliver-tgz.sh (log: ${deliverLog}) — does NOT block this merge`);
  try {
    const fd = fs.openSync(deliverLog, "w");
    const child = spawn("setsid", ["bash", dds, "--root", repoRoot], { detached: true, stdio: ["ignore", fd, fd] });
    child.on("error", () => { /* best-effort: a remote being down never fails the merge */ });
    child.unref();
    fs.closeSync(fd);
  } catch {
    /* best-effort — the merge outcome is decided by the ref move, not by the delivery */
  }
}

// ── --reconcile: primary-checkout guard + index refresh (gap-batch-merge-reconcile-destroys- ────────
// ── uncommitted-work) ────────────────────────────────────────────────────────────────────────────────
//
// The batch merge is REF-LEVEL (`git update-ref` with a CAS on the develop tip) and never touches the
// primary checkout's working tree. But when the primary checkout has <develop> checked out, moving the
// ref UNDER it leaves HEAD/index STALE: git status then shows the old-vs-new tree as staged changes.
// Callers historically invented a reconcile — the inner used `git reset --hard HEAD`, which OVERWROTE
// the working tree and DESTROYED an uncommitted manager edit (2026-08-08 08:08:24, real data loss).
// This module provides the reconcile itself so callers don't invent it:
//
//   reconcileGuard()   porcelain-empty guard — runs BEFORE any ref moves. After the ref moves the
//                      stale index ITSELF shows up as porcelain entries, so it can no longer be told
//                      apart from real uncommitted work; the guard must therefore run while the index
//                      still matches the old HEAD. Non-empty porcelain ⇒ FAIL CLOSED (nothing moved,
//                      owners reported). No-op when the primary checkout is not on the advanced branch.
//   reconcileIndex()   post-merge `git reset --mixed <new develop tip>` — refreshes the index to the
//                      new tip WITHOUT touching working-tree files. NEVER --hard (the one harmful
//                      extra action). Land lock serializes mutation ORDER; it does not prevent
//                      destruction — "I hold the lock" ≠ "safe to clobber the working tree".

// Is the primary checkout on the branch this run will advance (developRef)? Only then does a ref-level
// merge leave its HEAD/index stale and does the reconcile apply.
function reconcileApplies(): boolean {
  const r = git("branch", "--show-current");
  return r.status === 0 && stripNl(r.stdout) === developRef;
}

// Fail-closed porcelain guard (run BEFORE the ref moves). Returns false on uncommitted/untracked work.
function reconcileGuard(): boolean {
  if (!reconcileApplies()) {
    const r = git("branch", "--show-current");
    const branch = r.status === 0 ? stripNl(r.stdout) : "<detached>";
    say(`integration-batch-merge: reconcile: primary checkout on '${branch}' (not '${developRef}') — index refresh not needed`);
    return true;
  }
  const porcelain = stripNl(git("status", "--porcelain").stdout);
  if (porcelain !== "") {
    err("integration-batch-merge: reconcile FAIL-CLOSED — primary checkout has uncommitted/untracked changes; NOT moving any ref");
    err(`integration-batch-merge:   primary checkout: ${repoRoot}`);
    err(`integration-batch-merge:   branch: ${developRef}`);
    err("integration-batch-merge:   porcelain (resolve these file owners before re-running --reconcile):");
    for (const l of linesOf(porcelain)) err(`integration-batch-merge:     ${l}`);
    return false;
  }
  say("integration-batch-merge: reconcile: primary checkout clean (porcelain empty) — safe to proceed");
  return true;
}

// Post-merge index refresh: `git reset --mixed <newTip>` — index only, never --hard.
function reconcileIndex(newTip: string): boolean {
  if (!reconcileApplies()) {
    const r = git("branch", "--show-current");
    const branch = r.status === 0 ? stripNl(r.stdout) : "<detached>";
    say(`integration-batch-merge: reconcile: primary checkout on '${branch}' (not '${developRef}') — index refresh not needed`);
    return true;
  }
  say(`integration-batch-merge: reconcile: git reset --mixed ${newTip} (refresh index only; NEVER --hard; working-tree files untouched)`);
  const r = git("reset", "--mixed", newTip);
  if (r.status !== 0) {
    err(`integration-batch-merge: reconcile: git reset --mixed FAILED (exit ${r.status}); index NOT refreshed — needs human`);
    return false;
  }
  say(`integration-batch-merge: reconcile: index refreshed to develop tip ${newTip}; working-tree files untouched`);
  return true;
}

// ── OBJECT GATE (gap-batch-merge-gate-validates-tip-not-merge-result) ───────────────────────────────
// The suite tested the INTEGRATION TIP; the batch merge produces integration ⊕ develop (the MERGE
// RESULT). develop-only changes since the divergence point never entered the tested tree — if any are
// code files, the merge result would ship code that was never verified together with the integration
// content. This gate FAILS CLOSED (nothing moved) unless unmerged_develop_files = 0.
//
// The measure uses THREE-DOT semantics: `git diff --name-only <merge-base(integration,develop)> <develop>`
// isolates the develop-only surface. The raw two-dot `git diff integration develop` ALSO lists
// integration's OWN tested files (a file the suite verified would appear as differing) — a false
// positive this gate must avoid: the defect is develop-side untested code, not integration's tested code.
function checkObjectGate(mergeTarget: string, mergeUsesVerified: number): boolean {
  // gap-merge-green-snapshot-verified-commit-livelock AC3 — the object gate validates the ACTUAL merge
  // result: `mergeTarget` (the VERIFIED commit when the green snapshot records one, else the
  // integration tip) ⊕ develop. The tested tree is mergeTarget — develop-only code files since it
  // diverged from mergeTarget are the ones that never entered the tested tree.
  const mb = gitOut("merge-base", mergeTarget, `refs/heads/${developRef}`);
  if (mb === "") {
    err(`integration-batch-merge: object-gate: no merge-base between ${mergeTarget} and ${developRef} — unrelated histories, skipping gate (downstream will fail closed)`);
    say("integration-batch-merge: measure unmerged_develop_files=0");
    return true;
  }
  // develop-only changes since the divergence point (the surface the suite never saw).
  const diff = git("diff", "--name-only", mb, `refs/heads/${developRef}`);
  const codeFiles = linesOf(diff.stdout).filter((l) => /\.(ts|js|mjs|sh)$/.test(l));
  if (codeFiles.length === 0) {
    say("integration-batch-merge: measure unmerged_develop_files=0");
    return true;
  }
  say(`integration-batch-merge: measure unmerged_develop_files=${codeFiles.length}`);
  say(`integration-batch-merge:   develop-side code files that never entered the tested tree (${mergeTarget}):`);
  for (const f of codeFiles) say(`integration-batch-merge:     ${f}`);
  if (dryRun === 1) {
    say("integration-batch-merge: DRY-RUN — object gate WOULD fail closed (no ref moved in dry-run)");
    return true;
  }
  err(`integration-batch-merge: OBJECT-GATE FAIL-CLOSED — the MERGE RESULT (${mergeTarget} ⊕ ${developRef}) would ship untested code; nothing moved`);
  if (mergeUsesVerified === 1) {
    err(`integration-batch-merge:   tested tree = verified commit ${mergeTarget} (the point the green suite tested)`);
  } else {
    err(`integration-batch-merge:   tested tree = integration tip (${mergeTarget})`);
  }
  err(`integration-batch-merge:   fix: fan-in the ${developRef}-side commit into ${integrationRef} (re-test the merged tree), then re-run`);
  return false;
}

// ── FRESHNESS GATE (gap-batch-merge-gate-reads-stale-green; gap-batch-merge-freshness-gate-ignores-scope) ──
// The batch merge may only proceed when the suite green is a FRESH green that actually verified the
// CURRENT integration tip. Root cause (7b1ac3a1, 2026-08-08): the gate read ONLY `state == green` and
// treated a 3-hour-old green — measuring a COMPLETELY DIFFERENT batch of commits — as a pass for THIS
// tree. Freshness has three dimensions:
//   1. SCOPE — the green must be MAIN-sourced (`scope == "main"`). The runner tags every state with
//      `scope: main|worktree`: main = the authoritative signal subagents wait for; worktree = DEFERRABLE
//      (its completion "updates nothing anyone waits on"). A worktree green may have tested a completely
//      different tree (ANY linked worktree — another task's checkout). scope ABSENT (legacy pre-scope
//      state) ⇒ treat as main (fail-open, the runner's documented legacy semantics).
//   2. AGE — `finishedAt` within `--freshness-window` of now (default 3600s). An old green with NO new
//      fan-in is still stale: a 3-hour-old green did not test today's tree.
//   3. COVERAGE — the suite STARTED at/after the most recent integration fan-in (`git log -1 --format=%ct
//      <integration>`). A fan-in that landed after the suite ran means the green did NOT test the pending
//      content. (Started-at, not finished-at, is the coverage basis — a suite cannot have tested a fan-in
//      that landed after it started; startedAt is the runner's ISO marker, finishedAt is epoch.)
// Fail-closed conditions (all mean "no valid green" ⇒ nothing moved): state != green, scope present but
// != main, finishedAt missing/unparseable, age > window, suite started before the most recent fan-in,
// OR the state file is absent. In --dry-run this reports the would-block measure without failing.

/** Read one top-level JSON field as a string ("" when the file is unreadable/not JSON or the key is
 *  absent) — the replacement for the per-field `python3 -c "… .get('k','')"` reads. */
function readJsonField(file: string, key: string): string {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (parsed === null || typeof parsed !== "object") return "";
    const v = (parsed as Record<string, unknown>)[key];
    if (v === undefined) return "";
    return String(v);
  } catch {
    return "";
  }
}

// ── DOC-ONLY EXEMPTION (gap-batch-merge-freshness-gate-doc-only-exemption) ───────────────────────────
// The COVERAGE axis fails closed when a fan-in landed on integration after the suite started — the
// green did not test the pending tip. That cost is only justified when the pending content can CHANGE
// THE TEST SURFACE. Doc-only commits (.md/.jsonl — phase-goal/SPEC/task edits) cannot: they touch no
// code the suite exercises. The gate observed 3 consecutive doc-only blocks (rounds 153/157/158), each
// a needless 17-min full-suite re-run. pendingIsDocOnly() EXEMPTS the coverage axis when every file
// changed between the integration tip AS OF the suite start and the CURRENT integration tip is a
// .md/.jsonl; a pending change touching ANY other file type is NOT exempt (negative control, AC3).
//
// Returns true (exempt — the pending content is doc-only) or false (not exempt — the coverage axis must
// fail closed).
function pendingIsDocOnly(startedEpoch: number): boolean {
  // The integration tip AS OF the suite start — the tree the green actually measured.
  let suiteTip = gitOut("rev-list", "-1", `--before=${startedEpoch}`, `refs/heads/${integrationRef}`);
  if (suiteTip === "") {
    // No integration commit existed when the suite started — the WHOLE integration tip is pending.
    // Diff against the git empty tree (well-known all-zeros hash) so the exemption covers this
    // degenerate case instead of erroring.
    suiteTip = stripNl(git("hash-object", "-t", "tree", "/dev/null").stdout);
  }
  const changed = linesOf(git("diff", "--name-only", suiteTip, `refs/heads/${integrationRef}`).stdout).filter((l) => l !== "");
  // No changed files — nothing pending, trivially doc-only.
  if (changed.length === 0) return true;
  // Any changed file that is NOT a .md/.jsonl ⇒ NOT doc-only ⇒ no exemption.
  return changed.every((f) => /\.(md|jsonl)$/.test(f));
}

function checkFreshnessGate(mergeTarget: string): boolean {
  if (skipFreshnessGate === 1) {
    say("integration-batch-merge: freshness-gate SKIPPED (--skip-freshness-gate)");
    return true;
  }
  // The shared fail-closed tail: the measure line always goes to stdout; --dry-run reports the
  // would-block WITHOUT failing (mirrors checkObjectGate); otherwise the verdict goes to stderr.
  const failClosed = (verdict: string, measure: string): boolean => {
    say(measure);
    if (dryRun === 1) {
      say(`integration-batch-merge: DRY-RUN — freshness gate WOULD fail closed: ${verdict} (no ref moved in dry-run)`);
      return true;
    }
    err(`integration-batch-merge: FRESHNESS-GATE FAIL-CLOSED — ${verdict}; nothing moved`);
    return false;
  };

  // Absent state file ⇒ no valid green ⇒ fail-closed (a missing file is NOT a pass — the 7b1ac3a1
  // "缺 state 同路径：不批量合" rule).
  if (!fs.existsSync(stateFile)) {
    return failClosed(`suite-state file not found at ${stateFile} (no valid green)`, "integration-batch-merge: measure suite_freshness=unknown");
  }

  const state = readJsonField(stateFile, "state");
  if (state !== "green") {
    return failClosed(`suite-state state='${state === "" ? "<missing>" : state}' (batch merge requires state==green)`, "integration-batch-merge: measure suite_freshness=unknown");
  }

  // SCOPE dimension (gap-batch-merge-freshness-gate-ignores-scope) — the green must be MAIN-sourced.
  // scope ABSENT (legacy pre-scope state) ⇒ treat as main (fail-open — the runner's documented legacy
  // semantics); scope present but != "main" (incl. unknown values) ⇒ fail-closed.
  const scope = readJsonField(stateFile, "scope");
  if (scope !== "" && scope !== "main") {
    return failClosed(
      `suite-state scope='${scope}' (batch merge requires a MAIN-sourced green — a worktree green is deferrable and may not have tested the merge target)`,
      "integration-batch-merge: measure suite_freshness=unknown",
    );
  }

  // Parse finishedAt (epoch since the 2026-08-08 normalization; ISO for legacy states) and startedAt
  // (ISO or epoch) into epoch seconds. "missing" / "unparseable" are DISTINCT from a number, so the
  // caller cannot mistake a failed read for a fresh green.
  let startedEpoch = Number.NaN;
  let age: number | "missing" | "unparseable" = "unparseable";
  try {
    const d = JSON.parse(fs.readFileSync(stateFile, "utf8")) as Record<string, unknown>;
    const f = d["finishedAt"];
    if (f === undefined || f === null) {
      age = "missing";
    } else {
      let ts: number;
      if (typeof f === "number") {
        ts = f;
      } else {
        ts = Date.parse(String(f).replace("Z", "+00:00")) / 1000;
        if (Number.isNaN(ts)) {
          age = "unparseable";
          ts = Number.NaN;
        }
      }
      if (!Number.isNaN(ts)) {
        const s = d["startedAt"];
        let st: number;
        if (typeof s === "number") {
          st = s;
        } else {
          st = s ? Date.parse(String(s).replace("Z", "+00:00")) / 1000 : ts;
          if (Number.isNaN(st)) st = ts;
        }
        startedEpoch = Math.trunc(st);
        age = Math.trunc(Date.now() / 1000 - ts);
      }
    }
  } catch {
    age = "unparseable";
  }

  if (age === "missing" || age === "unparseable") {
    return failClosed("suite-state finishedAt missing/unparseable (no valid green)", "integration-batch-merge: measure suite_freshness=unknown");
  }

  // AGE dimension — the Contract measure (suite_freshness) is exactly this age in seconds.
  if (age > freshnessWindow) {
    return failClosed(`suite green finished ${age}s ago (> window ${freshnessWindow}s) — STALE`, `integration-batch-merge: measure suite_freshness=${age}`);
  }

  // COVERAGE dimension — the suite must have STARTED at/after the commit this batch merge will
  // actually land. gap-merge-green-snapshot-verified-commit-livelock AC3/AC4: when the green snapshot
  // records a verifiedCommit, `mergeTarget` IS that commit (the point the suite VERIFIED) → COVERAGE
  // is satisfied by construction. Without verifiedCommit (legacy), the coverage basis is the
  // integration tip exactly as before — no criterion loosened.
  const lastFanin = gitOut("log", "-1", "--format=%ct", mergeTarget);
  if (lastFanin !== "" && startedEpoch < Number(lastFanin)) {
    // DOC-ONLY EXEMPTION: a fan-in that landed after the suite started means the green did not test
    // the pending tip — UNLESS the pending content is doc-only (.md/.jsonl). A pending code file is
    // NOT exempt.
    if (pendingIsDocOnly(startedEpoch)) {
      say("integration-batch-merge: freshness-gate DOC-ONLY EXEMPT — the fan-in(s) after the suite started touch only .md/.jsonl (doc-only); the green still covers the test surface — no re-run needed");
      say(`integration-batch-merge: measure suite_freshness=${age}`);
      return true;
    }
    return failClosed(
      `a fan-in landed on ${integrationRef} after the suite started (last fan-in ${lastFanin}s epoch > suite start ${startedEpoch}s) — the green did NOT test the pending merge point ${mergeTarget}`,
      `integration-batch-merge: measure suite_freshness=${age}`,
    );
  }

  say(`integration-batch-merge: freshness-gate OK — fresh green (finished ${age}s ago, window ${freshnessWindow}s; suite start ${startedEpoch}s ≥ last fan-in ${lastFanin === "" ? "<none>" : lastFanin} at merge point ${mergeTarget})`);
  say(`integration-batch-merge: measure suite_freshness=${age}`);
  return true;
}

// ── WORKTREE-GREEN GATE (gap-suite-fix-scope-worktree-green-merge-gate) ───────────────────────────────
// suite-fix subagent fan-in 前置断言：fan-in（批量合）前，`.quay/verification-round.jsonl` 必须存在
// ≥1 条 `scope=worktree` 且 `state=green` 的轮次记录，否则拒绝 merge——「不自测绿不许合」。
//
// 为什么需要这条门（manager 2026-08-10 09:4x 决定性读数 + outer 复核）：
//   第二个 suite-fix subagent（08:50 起）rounds 230/231 全部 `scope=main` —— 它没跑自己的轮次，它在等
//   共享检出的轮次。其 worktree HEAD = round-231 的 verifiedCommit，修复未提交。A15 ④ 三条保障同时失效
//   而条文每条「没被违反」：①修到绿才 merge 失效；②未绿退出⇒.halt 失效；③不得修一个等 30min 失效。
//   只有把 `scope` 字段读出来才看得见 —— 本门把该判据机械化。
//
// 不新建机件：数据已在 verification-round.jsonl（full-suite-runner.ts 已写 scope/state），只在消费者侧
// （本 fan-in 路径）加一个前置断言。scope 字段缺失（legacy 行）⇒ 无法判 ⇒ 拒。
// `--skip-worktree-green-gate` 是显式 opt-out（测试隔离其他门用）；真实 orchestrator/suite-fix 调用不传。
function checkWorktreeGreenGate(): boolean {
  if (skipWorktreeGreenGate === 1) {
    say("integration-batch-merge: worktree-green-gate SKIPPED (--skip-worktree-green-gate)");
    return true;
  }
  const roundFile = path.join(repoRoot, ".quay", "verification-round.jsonl");
  // measure: has_worktree_green_round — Contract measure exactly: any round with BOTH
  // scope==worktree and state==green. Absent file ⇒ no record ⇒ false (fail-closed). An unparseable
  // line makes the whole read fail in the python form (`|| echo False`) — reproduced here.
  let has = false;
  try {
    for (const l of linesOf(fs.readFileSync(roundFile, "utf8"))) {
      if (l.trim() === "") continue;
      const r = JSON.parse(l) as Record<string, unknown>;
      if (r["scope"] === "worktree" && r["state"] === "green") {
        has = true;
        break;
      }
    }
  } catch {
    has = false;
  }
  if (has) {
    say("integration-batch-merge: worktree-green-gate OK — ≥1 scope=worktree+state=green round on record");
    say("integration-batch-merge: measure has_worktree_green_round=True");
    return true;
  }
  say("integration-batch-merge: measure has_worktree_green_round=False");
  if (dryRun === 1) {
    say(`integration-batch-merge: DRY-RUN — worktree-green gate WOULD fail closed: no scope=worktree+state=green round in ${roundFile} (no ref moved in dry-run)`);
    return true;
  }
  err(`integration-batch-merge: WORKTREE-GREEN-GATE FAIL-CLOSED — no scope=worktree+state=green round in ${roundFile}; the suite-fix subagent never self-tested green in its OWN worktree ⇒ 不许 merge（不自测绿不许合）; nothing moved`);
  err("integration-batch-merge:   fix: 先在自己 worktree 自测绿：node --test <文件> 或 scoped test.sh（bash scripts/test.sh --for-task <task-id> --allow-thin），得到 scope=worktree+state=green 记录后再 fan-in");
  return false;
}

// ── fan-in mode (gap-task-telemetry-6-percent-join) ─────────────────────────────────────────────
// Per-task fan-in merge: `task/<taskId>` → the CURRENT CHECKOUT's branch (fast-mode's $MERGE_TARGET;
// the inner's shared checkout sits on it), with the telemetry runId embedded in the commit subject:
//   merge: fan-in task/<id> (runId: fm-...)
// The runId sits at a FIXED, position-parseable location (the trailing `(runId: …)` group) so the
// two record sets — task landing records (git fan-in commits) and telemetry records (runIds) — become
// joinable on the runId. This mode is the MECHANICAL way to produce a runId-carrying fan-in; the
// batch-merge flow (develop/integration gates below) is untouched and remains the default.
if (fanInTask !== "") {
  if (runId === "") {
    err("integration-batch-merge: --fan-in requires --run-id <runId> (the runId from fast-mode-telemetry.ts --task-start)");
    process.exit(2);
  }
  if (/[^A-Za-z0-9._-]/.test(runId)) {
    err(`integration-batch-merge: --run-id "${runId}" is not filename-safe (must match [A-Za-z0-9._-]+, the telemetry runId shape)`);
    process.exit(2);
  }
  if (git("rev-parse", "--verify", "--quiet", `refs/heads/task/${fanInTask}`).status !== 0) {
    err(`integration-batch-merge: fan-in failed — task branch task/${fanInTask} not found`);
    process.exit(1);
  }
  // Merge into the checked-out branch (the merge target). --no-ff always creates a merge commit.
  if (git("merge", "--no-ff", `task/${fanInTask}`, "-m", `merge: fan-in task/${fanInTask} (runId: ${runId})`).status !== 0) {
    git("merge", "--abort");
    err(`integration-batch-merge: fan-in FAILED — merge of task/${fanInTask} aborted (conflict or error); nothing merged`);
    process.exit(1);
  }
  const fanInSha = stripNl(git("rev-parse", "HEAD").stdout);
  const br = git("branch", "--show-current");
  const fanInTarget = br.status === 0 ? stripNl(br.stdout) : "<detached>";
  say(`integration-batch-merge: fan-in OK — task/${fanInTask} merged into ${fanInTarget} (commit ${fanInSha}) with runId ${runId}`);
  say("integration-batch-merge: measure fanin_runid_present=true");
  process.exit(0);
}

if (git("rev-parse", "--verify", "--quiet", `refs/heads/${developRef}`).status !== 0) {
  err(`integration-batch-merge: develop ref not found: ${developRef}`);
  process.exit(2);
}
if (git("rev-parse", "--verify", "--quiet", `refs/heads/${integrationRef}`).status !== 0) {
  err(`integration-batch-merge: integration ref not found: ${integrationRef}`);
  process.exit(2);
}

// ── --sync-pull: the DOWNSYNC half of the bidirectional merge (two peer developers) ─────────────────
// Before the batch merge, pull origin/<develop> into the LOCAL <develop> so the merge base includes
// the peer's latest ("apply latest and develop on latest" — the human frame 2026-08-06). A TRUE
// divergence (local AND origin each have commits the other lacks) FAILS CLOSED (nothing moved) — the
// real bidirectional merge is the loop's own red-window/merge handling. Runs BEFORE developTip is
// captured so the pull result is what every gate and the CAS evaluate.
if (syncPull === 1) {
  const slc = path.join(SCRIPT_DIR, "sync-lag-check.sh");
  if (fs.existsSync(slc)) {
    const sp = runShellMerged(slc, ["--root", repoRoot, "--branch", developRef, "--remote", "origin", "--pull"]);
    for (const l of linesOf(stripNl(sp.stdout))) say(l);
    if (sp.status !== 0) {
      err(`integration-batch-merge: --sync-pull downsync FAILED (exit ${sp.status}) — local ${developRef} and origin/${developRef} diverged or origin unreachable; NOT batch-merging on a diverged base (never a blind --ours/--theirs); nothing moved`);
      process.exit(1);
    }
  } else {
    err(`integration-batch-merge: --sync-pull requested but sync-lag-check.sh not found at ${slc}; skipping downsync (merge base may be stale)`);
  }
}

const developTip = stripNl(git("rev-parse", `refs/heads/${developRef}`).stdout);
const integrationTip = stripNl(git("rev-parse", `refs/heads/${integrationRef}`).stdout);

// ── MERGE-TO-VERIFIED-COMMIT (gap-merge-green-snapshot-verified-commit-livelock) ─────────────────────
// The full suite takes ~1847s while integration lands ~12 commits/round (median 147s/commit) — a green
// that only records `state == green` can NEVER catch integration HEAD (the COVERAGE axis fails closed
// forever = structural livelock). The fix: the green snapshot records the commit it VERIFIED
// (`verifiedCommit` — the integration tip at suite START, written by full-suite-runner.ts), and this
// script merges THAT commit instead of the moving integration HEAD. The merged point WAS tested →
// COVERAGE is satisfied by construction (AC4: no criterion loosened — the merged point is exactly the
// tested point). Backward compatible: a snapshot WITHOUT verifiedCommit falls back to the current
// behavior (merge integration HEAD). The `--integration <ref>` branch-name entry stays intact.
const stateFile = suiteStateFile !== "" ? suiteStateFile : path.join(repoRoot, ".quay", "full-suite-state.json");
let verifiedCommit = "";
let mergeTarget = "";
let mergeUsesVerified = 0;
if (fs.existsSync(stateFile)) {
  verifiedCommit = readJsonField(stateFile, "verifiedCommit");
}
if (verifiedCommit !== "") {
  // The verified commit must be a real commit AND lie on the integration line (an ancestor of
  // integration HEAD) — an orphaned/force-pushed-away commit is not a valid merge point.
  if (
    git("rev-parse", "--verify", "--quiet", `${verifiedCommit}^{commit}`).status === 0 &&
    git("merge-base", "--is-ancestor", `${verifiedCommit}^{commit}`, `refs/heads/${integrationRef}`).status === 0
  ) {
    mergeTarget = stripNl(git("rev-parse", `${verifiedCommit}^{commit}`).stdout);
    mergeUsesVerified = 1;
  } else {
    err(`integration-batch-merge: verifiedCommit ${verifiedCommit} (from ${stateFile}) is not a resolvable commit on ${integrationRef} — falling back to integration HEAD (COVERAGE will fail closed if that tip is untested)`);
  }
}
if (mergeTarget === "") {
  mergeTarget = integrationTip;
}
if (mergeUsesVerified === 1) {
  say(`integration-batch-merge: MERGE-TO-VERIFIED-COMMIT — merging the verified commit ${mergeTarget} (the point the green suite tested) instead of integration HEAD ${integrationTip}`);
}

// ── real merge (temp worktree → merge → CAS update-ref) ──────────────────────────────────────────
// Real merge of the MERGE TARGET into develop (merge commit) in a throwaway temp worktree, then advance
// develop with a CAS on the old tip. Shared-file conflicts auto-resolve develop-authoritative; a real
// code conflict fails closed (nothing moved). Returns true on success, false on fail-closed.
//
// The temp worktree is a PROCESS-LIFETIME resource: it must be removed on EVERY exit path (bash did this
// with `trap cleanup EXIT`). `process.on("exit")` is the direct analogue — it runs on `process.exit()`
// and on normal exit, so an early `process.exit(1)` from any gate below still cleans up.
let tmpWt = "";
let tmpWtCleaned = false;
function cleanupTmpWt(): void {
  if (tmpWt === "" || tmpWtCleaned) return;
  tmpWtCleaned = true;
  // gap-suite-leaks-live-claude-sessions: 注销 worktree 前先停其会话 — a teardown that only removes
  // the dir leaks live claude sessions launched inside the worktree. Stop them first.
  stopSessionsUnderWorktree(tmpWt);
  git("worktree", "remove", "--force", tmpWt);
  try {
    fs.rmSync(tmpWt, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
}
process.on("exit", cleanupTmpWt);

function realMerge(): boolean {
  try {
    tmpWt = fs.mkdtempSync(path.join(os.tmpdir(), "integration-batch-merge."));
  } catch {
    err("integration-batch-merge: mktemp failed");
    return false;
  }
  tmpWtCleaned = false;

  if (git("worktree", "add", "-q", "--detach", tmpWt, developTip).status !== 0) {
    err(`integration-batch-merge: real-merge failed — could not create temp worktree at ${tmpWt}`);
    return false;
  }

  // Merge the MERGE TARGET into develop (detached HEAD at developTip). --no-commit: we decide when
  // to commit, after classifying and (if safe) auto-resolving conflicts. `mergeTarget` is the
  // VERIFIED commit (the tested point) when the green snapshot records one, else the integration tip.
  const merged = gitAt(tmpWt, "merge", "--no-ff", "--no-commit", mergeTarget);
  if (merged.status !== 0) {
    const conflicts = linesOf(gitAt(tmpWt, "diff", "--name-only", "--diff-filter=U").stdout).filter((l) => l !== "");
    if (conflicts.length === 0) {
      err("integration-batch-merge: real-merge aborted for a non-conflict reason (nothing moved)");
      gitAt(tmpWt, "merge", "--abort");
      return false;
    }

    // Classify the ACTUAL conflicts into three buckets: shared (develop-authoritative default),
    // reverse-edge (integration-authoritative — resolves to the INTEGRATION side), or code (fail-closed).
    let sharedConflicts: string[] = [];
    let intAuthConflicts: string[] = [];
    const codeConflicts: string[] = [];
    for (const p of conflicts) {
      if (isIntegrationAuthoritativeFile(p)) intAuthConflicts.push(p);
      else if (isSharedFile(p)) sharedConflicts.push(p);
      else codeConflicts.push(p);
    }

    // Gate reverse-edge candidates on the content criterion (when supplied): the integration side is
    // authoritative ONLY IF it satisfies the criterion. A candidate whose integration side FAILS the
    // criterion has no mechanical basis to be trusted → it becomes a genuine conflict (fail-closed,
    // never blind-choose either side — AC4 preserved even for declared reverse-edge files).
    if (intAuthConflicts.length > 0 && reverseEdgeCriterion !== "") {
      const stillIntAuth: string[] = [];
      for (const p of intAuthConflicts) {
        if (criterionSatisfied(tmpWt, p)) {
          say(`integration-batch-merge:   content criterion satisfied for ${p} → integration-authoritative`);
          stillIntAuth.push(p);
        } else {
          err(`integration-batch-merge:   content criterion NOT satisfied for ${p} → genuine conflict (FAIL-CLOSED, needs a human)`);
          codeConflicts.push(p);
        }
      }
      intAuthConflicts = stillIntAuth;
    }

    if (codeConflicts.length > 0) {
      // AC3/AC4 load-bearing: a REAL (or criterion-rejected) conflict fails closed — never blind
      // --ours/--theirs, no ref moved.
      err("integration-batch-merge: REAL-MERGE FAIL-CLOSED — code conflicts need a human; nothing moved");
      err("integration-batch-merge:   code conflict files:");
      for (const p of codeConflicts) err(`integration-batch-merge:     ${p}`);
      if (sharedConflicts.length > 0) {
        err("integration-batch-merge:   (shared files would auto-resolve develop-authoritative, but code conflicts block):");
        for (const p of sharedConflicts) err(`integration-batch-merge:     ${p}`);
      }
      if (intAuthConflicts.length > 0) {
        err("integration-batch-merge:   (reverse-edge files would resolve to the integration side, but code conflicts block):");
        for (const p of intAuthConflicts) err(`integration-batch-merge:     ${p}`);
      }
      gitAt(tmpWt, "merge", "--abort");
      return false;
    }

    // Reverse-edge conflicts → auto-resolve integration-authoritative (integration side).
    if (intAuthConflicts.length > 0) {
      say(`integration-batch-merge: resolving integration-authoritative conflicts (integration side, ${intAuthConflicts.length}):`);
      for (const p of intAuthConflicts) {
        say(`integration-batch-merge:   ${p}`);
        resolveAsTheirs(tmpWt, p);
      }
    }

    // Shared-file conflicts → auto-resolve develop-authoritative (AC2).
    if (sharedConflicts.length > 0) {
      say(`integration-batch-merge: auto-resolving shared-file conflicts develop-authoritative (${sharedConflicts.length}):`);
      for (const p of sharedConflicts) {
        say(`integration-batch-merge:   ${p}`);
        resolveAsOurs(tmpWt, p);
      }
    }
  }

  // Commit the merge. Default: git's prepared MERGE_MSG from the --no-commit merge. With --run-id,
  // embed the runId in the message so the fan-in merge's subject carries it — the telemetry taskId →
  // git branch traceability link fan-in-runid-check.ts reads.
  if (runId !== "") {
    say(`integration-batch-merge: real-merge commit carries runId ${runId}`);
    if (gitAt(tmpWt, "commit", "-q", "-m", `merge: fan-in ${integrationRef}→${developRef} (runId: ${runId})`).status !== 0) {
      err("integration-batch-merge: real-merge commit failed (nothing moved)");
      gitAt(tmpWt, "merge", "--abort");
      return false;
    }
    say("integration-batch-merge: measure fanin_runid_present=true");
  } else {
    if (gitAt(tmpWt, "commit", "-q", "--no-edit").status !== 0) {
      err("integration-batch-merge: real-merge commit failed (nothing moved)");
      gitAt(tmpWt, "merge", "--abort");
      return false;
    }
  }
  const mergeCommit = stripNl(gitAt(tmpWt, "rev-parse", "HEAD").stdout);

  // Advance develop with a CAS on the old tip (atomic; refuses if develop moved concurrently).
  if (git("update-ref", `refs/heads/${developRef}`, mergeCommit, developTip).status !== 0) {
    err("integration-batch-merge: update-ref CAS failed — develop moved concurrently? Nothing changed.");
    return false;
  }

  // POST-state measure: the MERGE TARGET (the verified commit / integration tip this merge actually
  // landed) must now be reachable from develop. When merging the VERIFIED commit while integration
  // HEAD has advanced beyond it, integration is intentionally NOT fully absorbed — the newer commits
  // were not tested and await the next green (reported, not a failure).
  if (git("merge-base", "--is-ancestor", mergeTarget, `refs/heads/${developRef}`).status === 0) {
    say(`integration-batch-merge: OK — develop real-merged to ${mergeTarget} (merge commit ${mergeCommit})`);
    if (mergeUsesVerified === 1 && mergeTarget !== integrationTip) {
      say(`integration-batch-merge:   integration HEAD ${integrationTip} still has newer untested commits — they await the next green (nothing silently dropped)`);
      say("integration-batch-merge: measure integration_ff_merges=1");
    } else {
      say("integration-batch-merge: measure integration_ff_merges=0");
    }
    doSync();
    doDeliver();
    if (reconcile === 1 && dryRun === 0) {
      if (!reconcileIndex(mergeCommit)) return false;
    }
    return true;
  }
  err(`integration-batch-merge: post-measure FAILED — merge target ${mergeTarget} not ancestor of develop after real merge; needs human`);
  return false;
}

// ── main flow ───────────────────────────────────────────────────────────────────────────────────

// Nothing pending? The MERGE TARGET (the verified commit when the green snapshot records one, else the
// integration tip) is already absorbed into develop ⇒ measure=0, no-op.
if (git("merge-base", "--is-ancestor", mergeTarget, `refs/heads/${developRef}`).status === 0) {
  if (dryRun === 1) {
    say("integration-batch-merge: DRY-RUN (no ref moved)");
    say(`integration-batch-merge: develop=${developTip} integration=${integrationTip}`);
  }
  if (mergeUsesVerified === 1 && mergeTarget !== integrationTip) {
    say(`integration-batch-merge: OK — verified commit ${mergeTarget} is already an ancestor of develop (the tested point is merged; integration HEAD ${integrationTip} has newer untested commits that await the next green)`);
  } else {
    say("integration-batch-merge: OK — integration is already an ancestor of develop (nothing pending)");
  }
  say("integration-batch-merge: measure integration_ff_merges=0");
  process.exit(0);
}

// ── OBJECT GATE: validate the MERGE RESULT, not just the integration tip, BEFORE any ref moves. In
// --dry-run this reports the would-block measure without failing.
if (!checkObjectGate(mergeTarget, mergeUsesVerified)) process.exit(1);

// ── FRESHNESS GATE: a FRESH green that verified the MERGE TARGET (the TIME/SOURCE-AXIS gate, run
// before any ref moves). In --dry-run this reports the would-block measure without failing.
if (!checkFreshnessGate(mergeTarget)) process.exit(1);

// ── WORKTREE-GREEN GATE: ≥1 `scope=worktree`+`state=green` round on record (a CONSUMER-SIDE
// pre-assertion; the data is written by full-suite-runner.ts, no new mechanism). --dry-run reports
// would-block without failing (consistent with the other gates).
if (!checkWorktreeGreenGate()) process.exit(1);

// ── --reconcile: porcelain-empty guard BEFORE any ref moves ──────────────────────────────────────────
// The guard must run while the index still matches the old HEAD — after the ref moves, the stale index
// shows up as porcelain entries and can no longer be told apart from real uncommitted work.
if (reconcile === 1) {
  if (dryRun === 1) {
    if (reconcileApplies()) {
      const porcelain = stripNl(git("status", "--porcelain").stdout);
      say(`integration-batch-merge: DRY-RUN --reconcile: primary checkout (on ${developRef}) porcelain would-be-empty: ${porcelain === "" ? "yes" : "NO"}`);
      if (porcelain === "") say("integration-batch-merge: DRY-RUN --reconcile: guard would PASS; post-merge reconcile = git reset --mixed <new develop tip> (index only)");
    } else {
      say(`integration-batch-merge: DRY-RUN --reconcile: primary checkout not on ${developRef} — reconcile not needed`);
    }
  } else {
    if (!reconcileGuard()) process.exit(1);
  }
}

// PRE-state: is develop an ancestor of the MERGE TARGET (the verified commit / integration tip)?
const ffPossible = git("merge-base", "--is-ancestor", `refs/heads/${developRef}`, mergeTarget).status === 0 ? 1 : 0;

// What this batch merge would land: develop..merge_target (the invoke surface). When merging the
// VERIFIED commit while integration HEAD has advanced beyond it, the newer untested commits stay on
// integration — reported (deferred), never silently dropped.
const pending = gitOut("log", "--oneline", `refs/heads/${developRef}..${mergeTarget}`);
const deferred = gitOut("log", "--oneline", `${mergeTarget}..refs/heads/${integrationRef}`);

if (dryRun === 1) {
  say("integration-batch-merge: DRY-RUN (no ref moved)");
  say(`integration-batch-merge: develop=${developTip} integration=${integrationTip}`);
  if (ffPossible === 1) {
    say(`integration-batch-merge: FF-OK — ${developRef} is an ancestor of the merge target ${mergeTarget}`);
    say("integration-batch-merge: pending on integration:");
    say(`integration-batch-merge:   (merge surface ${developRef}..${mergeTarget})`);
    for (const l of linesOf(pending)) say(`    ${l}`);
    if (mergeUsesVerified === 1 && deferred !== "") {
      const deferredCount = linesOf(deferred).filter((l) => l !== "").length;
      say(`integration-batch-merge:   (${deferredCount} newer untested commit(s) on integration HEAD ${integrationTip} deferred to the next green — the verified commit is what the suite tested)`);
    }
  } else {
    reportDivergence();
    if (mergeMode === 1) reportConflictClassification(wouldConflicts);
    err(`integration-batch-merge: NOT-FAST-FORWARD — the merge target ${mergeTarget} is not a descendant of develop; needs a human (pass --merge to real-merge auto-resolving shared files develop-authoritative and reverse-edge files integration-authoritative)`);
    process.exit(1);
  }
  // Post-state measure (would-be): `git merge-base --is-ancestor <merge_target> <develop>`.
  if (git("merge-base", "--is-ancestor", mergeTarget, `refs/heads/${developRef}`).status === 0) {
    say(`integration-batch-merge: measure integration_ff_merges=0 (post: merge target ${mergeTarget} is ancestor of develop)`);
  } else {
    say(`integration-batch-merge: measure integration_ff_merges=1 (post: merge target NOT yet ancestor — merge pending)`);
  }
  process.exit(0);
}

if (ffPossible === 1) {
  // Perform the ref-level fast-forward with a CAS on the old develop tip (atomic; refuses if develop
  // moved concurrently — never a blind force-overwrite). gap-merge-green-snapshot-verified-commit-
  // livelock AC3: develop advances to the MERGE TARGET (the verified commit), not the moving HEAD.
  if (git("update-ref", `refs/heads/${developRef}`, mergeTarget, developTip).status !== 0) {
    err("integration-batch-merge: update-ref CAS failed — develop moved concurrently? Nothing changed.");
    process.exit(1);
  }

  // POST-state measure: the merge target must now be reachable from develop.
  if (git("merge-base", "--is-ancestor", mergeTarget, `refs/heads/${developRef}`).status === 0) {
    if (mergeUsesVerified === 1 && mergeTarget !== integrationTip) {
      say(`integration-batch-merge: OK — develop fast-forwarded to the VERIFIED commit ${mergeTarget} (the point the green suite tested)`);
      say(`integration-batch-merge:   integration HEAD ${integrationTip} still has newer untested commits — they await the next green (nothing silently dropped)`);
      say("integration-batch-merge: measure integration_ff_merges=1");
    } else {
      say("integration-batch-merge: OK — develop fast-forwarded to integration");
      say("integration-batch-merge: measure integration_ff_merges=0");
    }
    say(`integration-batch-merge: develop=${mergeTarget}`);
    doSync();
    doDeliver();
    if (reconcile === 1 && dryRun === 0) {
      if (!reconcileIndex(mergeTarget)) process.exit(1);
    }
  } else {
    err(`integration-batch-merge: post-measure FAILED — merge target ${mergeTarget} not ancestor of develop after ff; needs human`);
    process.exit(1);
  }
  process.exit(0);
}

// NOT a fast-forward (true divergence) — the pre-merge report, then either fail closed (default) or
// real-merge (--merge).
reportDivergence();
if (mergeMode === 0) {
  err("integration-batch-merge: NOT-FAST-FORWARD — integration is not a descendant of develop; needs a human (pass --merge to real-merge auto-resolving shared files develop-authoritative and reverse-edge files integration-authoritative)");
  process.exit(1);
}

process.exit(realMerge() ? 0 : 1);
