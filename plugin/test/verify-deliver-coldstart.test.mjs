// @test-group engine
// verify-deliver-coldstart.test.mjs — AC88 三步交付验证机制 (gap-ac88-verification-mechanism-extend-deliver).
//
// Tests for plugin/scripts/verify-deliver-coldstart.sh — the repeatable mechanism that upgrades
// AC88's cross-host verification from "install tgz + serve HTTP probe" to:
//   ① clean-dir fresh .tgz install → ② project quay-init → ③ cold-start liveness
//   (outer window + inner layer) by DIRECT measures (git commit / /proc cwd / worktree, NOT serve HTTP or layer
//   heartbeat), with AC5 evidence that the verification self-built the tgz from develop-tip
//   (commit sha + sha256,达成 = newer than the 2026-08-16 phase switch).
//
// Coverage map (task ACs):
//   AC1 — the script's --selfcheck (hermetic) proves step ordering is a script invariant
//         (install→init→coldstart) via the direct-measure verdict function.
//   AC2 — --selfcheck's positive/negative controls prove the DIRECT measures can take false
//         (only a chore(quay-init) auto-commit ⇒ COLDSTART_LIVE=no) and true (a real loop commit
//         ⇒ COLDSTART_LIVE=yes); NOT a serve-HTTP probe.
//   AC5 — --selfcheck's AC5 controls prove the criterion can take false (build before the
//         2026-08-16 phase switch ⇒ AC5_OK=0), true (build after ⇒ AC5_OK=1), and be DISTINCT
//         when not evaluated (no build_sha ⇒ AC5_EVALUATED=0, ≠ fail). 硬规则 3b.
//   AC3/AC4 — the script's fresh-install shape (isolated npm --prefix + clean project root) is
//         argued in the script header and exercised by --help/arg-validation; the real install is
//         load-sensitive and belongs to the AC88 cross-host drive, not this hermetic file.
//
//   gap-verify-deliver-coldstart-l1-asserts-retired-artifacts (2026-09-08) re-anchored L1 to the
//   SPEC §6 closed set. Direct (non-selfcheck) coverage here:
//   AC2 — L1 closed-set is PARSED from the SPEC's QUAY-INIT-CLOSED-SET:BEGIN/END block: mutating
//         the block (adding an absent entry) flips L1_OK 1→0 ⇒ the script really reads the SPEC,
//         not a hardcoded copy (硬规则 4c).
//   AC3 — an unreadable SPEC ⇒ L1_NOT_EVALUATED=1 and L1_OK≠1 (未评估 ≠ 合格, 硬规则 3b).
//   This file uses node:test and declares // @test-group lowconc (AC5 of the mechanism task).
//
//   gap-ac-record-schema-duplicated-between-criterion-and-writer (2026-09-12) — the carrier-record
//   field list becomes a SINGLE declarative source (AC_RECORD_SCHEMA) enforced at the one write
//   choke point; the criterion side stays the oracle:
//   AC1 — `--ac-record-schema-report` prints the per-AC three-way diff (criterion / declared schema
//         / writer-emitted, all extracted POSITIONALLY — the criterion via yaml+AST scoped by its
//         `r.get("ac")!=…` guard, which is what keeps AC-239's AC-238 branch from being attributed
//         to AC-239) and exits non-zero on a hard diff; and it can take FALSE both ways (a dropped
//         field ⇒ DRIFT naming it; a dropped whole row ⇒ caught by the producer-side unregistered
//         reverse lookup, without which a row-driven report prints all-green).
//   AC2 — a brand-new AC yields a valid record from ONE declaration row + the generic
//         write_ac_record, with NO new write_acNNN_record function.
//   AC3 — the omission is caught AT PRODUCTION TIME (⛔ not "the criterion exits 1" — that is the
//         status quo): refused, nothing written, the missing field named; completed ⇒ one record.
//   AC4 — after the record lands the criterion is re-run automatically, its exit code recorded, and
//         "appended but still red" loudly reported (⛔ never silently treated as success).
//   AC5 — GOAL-016 AC-247/248/249/250 keep their real field sets, each declared field individually
//         enforced at write time (omitting any one is refused).
//
// Run:
//   scripts/test.sh plugin/test/verify-deliver-coldstart.test.mjs
//   node --test plugin/test/verify-deliver-coldstart.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT = path.join(REPO_ROOT, "plugin", "scripts", "verify-deliver-coldstart.sh");

// run(): spawn the script with args, return { status, stdout, stderr }.
function run(args) {
  return spawnSync("bash", [SCRIPT, ...args], { encoding: "utf8" });
}

test("AC2+AC5 — --selfcheck exits 0, reports PASS, and exercises both direct-measure and AC5 controls", () => {
  const r = run(["--selfcheck"]);
  assert.equal(r.status, 0, `--selfcheck must exit 0:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /selfcheck: PASS/, "selfcheck must report PASS");
  // AC2 controls (direct measures take false/true)
  assert.match(r.stdout, /dead\(no-real-loop,recent-chore-commit\) L1_OK=1 COLDSTART_LIVE=no/,
    "negative control: only a chore(quay-init) auto-commit must NOT be live (hard rule 4b)");
  assert.match(r.stdout, /alive\(recent-non-chore-commit\) L1_OK=1 COLDSTART_LIVE=yes/,
    "positive control: a real loop commit must be live");
  // AC1 regression (gap-verify-deliver-coldstart-l2-proc-ok-false-positive): proc_ok must NOT be
  // a standalone sufficient liveness signal when the outer pane is stuck at the startup
  // permission-prompt — even with >=2 claude/node processes in the project (B/C 实测 4 进程卡
  // "Quick safety check" 弹窗 6.2h, coldstart_live 曾由 proc_ok 单独撑起).
  assert.match(r.stdout, /prompt-blocked\(procs=2,prompt=1\) L2_OK=0 COLDSTART_LIVE=no/,
    "negative control: procs present BUT startup-prompt ⇒ proc_ok demoted, NOT live (hard rule 4b)");
  assert.match(r.stdout, /prompt-passed\(procs=2,prompt=0\) L2_OK=1 COLDSTART_LIVE=yes/,
    "positive control: procs present AND startup-prompt passed ⇒ proc_ok is a live signal");
  assert.match(r.stdout, /pane-verdict-permission-intervention=1/,
    "reuse wiring: pane-state-classify --pane-verdict classifies the real trust-prompt as intervention (AC1 复用不新造)");
  // AC5 controls (criterion takes false/true and has a distinct not-evaluated state)
  assert.match(r.stdout, /ac5-positive\(recent-build\) eval=1 ok=1/,
    "AC5 positive: build after the 2026-08-16 phase switch must be ok");
  assert.match(r.stdout, /ac5-negative\(old-build\)   eval=1 ok=0/,
    "AC5 negative: build before the phase switch must be NOT ok (criterion can take false)");
  assert.match(r.stdout, /ac5-not-evaluated\(no-sha\) eval=0 ok=0/,
    "AC5 not-evaluated: missing build_sha is DISTINCT from fail (硬规则 3b)");
  // AC168 marketplace channel controls (gap-verify-deliver-coldstart-marketplace-channel-unverified):
  // the --selfcheck must ALSO exercise the marketplace positive/negative/enabled-leak controls, not
  // just the AC2/AC5 direct-measure controls. These prove the marketplace assertion really tests
  // register-plugin.mjs's effect (AC2 negative: no register ⇒ no entry) and flags the user-level
  // enabledPlugins leak (AC-161) — hermetic (fake HOME + fake installed package, no real npm install,
  // no real ~/.claude/settings.json touched).
  assert.match(r.stdout, /marketplace-register\(positive\) MP_EVALUATED=1 MP_REGISTER_OK=1 MP_SETTINGS_OK=1 MP_ENABLED_LEAK=0/,
    "marketplace positive: register-plugin.mjs registers the directory source + no enabledPlugins leak");
  assert.match(r.stdout, /marketplace-noregister\(negative,AC2\) MP_SETTINGS_OK=0/,
    "marketplace negative (AC2): without register-plugin.mjs no marketplace entry appears");
  assert.match(r.stdout, /marketplace-enabled-leak\(AC-161违反\) MP_SETTINGS_OK=0 MP_ENABLED_LEAK=1/,
    "marketplace leak: a user-level quay@quay enabledPlugins entry is flagged (AC-161)");
  assert.match(r.stdout, /marketplace-register-fail\(AC5\) MP_REGISTER_OK=0 MP_REGISTER_RC=1 reason_present=1/,
    "marketplace register-failure (AC5): a non-zero register exit is recorded structurally, not swallowed");
  // AC-161 regression (gap-ac161-user-scope-enable-repolluted-by-cli-materialization): segment ①
  // (step1_install = the delivery-install path) must leave the operator's real
  // ~/.claude/settings.json BYTE-IDENTICAL — the CLI materialization it triggered ("claude plugin
  // install" writes user-level enabledPlugins) re-reddened the STANDING goal AC-161 every delivery
  // verification. The --selfcheck must exercise BOTH halves:
  //   positive    — HOME isolated ⇒ zero write to the real settings, AND the isolated HOME really
  //                 received the postinstall write (so the green is not "postinstall never ran" —
  //                 the vacuity shape this very task is about, 硬规则 4 推论三);
  //   falsifiable — the isolation target pointed back at the real HOME (pre-fix semantics) ⇒ the
  //                 same assertion goes red (AC4). Exercises the production step1_install, not a
  //                 fixture copy of its judgment.
  assert.match(r.stdout, /step1-real-settings-guard\(positive\) STEP1_HOME_ISOLATED=1 STEP1_REAL_SETTINGS_UNCHANGED=1 isolated_home_written=1 sentinel_sig_same=1/,
    "segment ① positive: HOME isolation ⇒ operator settings untouched AND the isolated HOME was really written (non-vacuous)");
  assert.match(r.stdout, /step1-real-settings-guard\(falsifiable,pre-fix-semantics\) STEP1_HOME_ISOLATED=0 STEP1_REAL_SETTINGS_UNCHANGED=0/,
    "segment ① falsifiable (AC4): with isolation off, the same assertion takes false");
  // AC-203 (gap-driver-runtime-driver-path-anchored-at-project-root-not-dist): the carrier record writes
  // the five criterion fields verbatim and refuses a dead-driver record (fail-closed, 缺值≠合格).
  assert.match(r.stdout, /ac203-record\(valid\) wrote=1 fields_ok=1/,
    "AC-203 record: valid record written with has_plugin_dir=false literal + driver_alive=1 + carrier_records>0");
  assert.match(r.stdout, /ac203-record\(dead-driver\) refused=1/,
    "AC-203 record: a dead-driver (driver_alive=0) record is refused — the criterion can take false");
  // gap-cross-host-evidence-run-incomplete-… AC5 真因: probe_ac203_driver_status 的 node 曾把
  // alive=/recs= 打在同一行 ⇒ sed ^recs= 永不命中、^alive= 抓到 "1 recs=2" ⇒ AC-203 记录结构上写不出。
  // 此控制钉住两字段分两行解析（feed {"driver_alive":1,"carrier_records":2} ⇒ alive=1 recs=2）。
  assert.match(r.stdout, /ac203-status-parse\(alive\+recs\) alive=1 recs=2/,
    "AC-203 status parse: alive=1 recs=2 parsed from separate lines (single-line bug ⇒ '1 recs=2'/ -1)");
  // AC-201 controls (gap-ac201-productization-verification-build-sha-tgz-sha256-record):
  // the --selfcheck must ALSO exercise the AC-201 record append positive/negative controls — positive
  // injects a 40-hex BUILD_SHA + 64-hex SHA256_QUAY and asserts a top-level ac=GOAL-009-AC-201 record
  // with both fields non-empty (top-level fields, NOT a detail string); negative (empty BUILD_SHA)
  // writes nothing (缺输入不写, 硬规则 3b).
  assert.match(r.stdout, /ac201-record\(positive\) written=1 build_sha_len=40 tgz_sha256_len=64 ac_count=1/,
    "AC-201 positive: 40-hex build_sha + 64-hex tgz_sha256 written as top-level fields");
  assert.match(r.stdout, /ac201-record\(negative,no-build-sha\) written=0 lines=1/,
    "AC-201 negative: empty BUILD_SHA writes nothing (hard rule 3b)");
  // AC-214 freshness anchor helper (gap-ac214-freshness-anchor-build-sha-missing-on-203-205-207):
  // the GOAL-009 anchor helper must append top-level build_sha (the AC-214 meta-criterion's only
  // recognized anchor field) on a 40-hex BUILD_SHA, and fail closed (no write, non-zero) on an
  // empty BUILD_SHA — 缺值≠合格 (硬规则 3b).
  assert.match(r.stdout, /goal009-anchor\(positive\) rc=0 records=1 build_sha=1/,
    "positive control: a 40-hex BUILD_SHA ⇒ a GOAL-009 record with top-level build_sha is written");
  assert.match(r.stdout, /goal009-anchor\(negative\) rc=1 lines=1→1/,
    "negative control: an empty BUILD_SHA ⇒ no write and non-zero (fail-closed, 硬规则 3b)");
  // AC-206 (gap-ac206-goals-tasks-dual-carrier-quay-init-goals-closed-set): the dual-carrier record
  // writes the four boolean fields verbatim, refuses an empty-host record (fail-closed), and truthfully
  // writes goals_dir_created=false when goals/ is missing (缺件如实非静默, 缺值≠合格).
  assert.match(r.stdout, /ac206-record\(valid\) wrote=1 fields_ok=1/,
    "AC-206 record: valid record written with all four boolean fields true (dual carrier)");
  assert.match(r.stdout, /ac206-record\(goals-missing\) neg_ok=1/,
    "AC-206 record: goals/ missing ⇒ goals_dir_created=false still written (缺件如实非静默)");
  assert.match(r.stdout, /ac206-record\(empty-host\) refused=1/,
    "AC-206 record: empty host ⇒ refused (fail-closed, 缺值≠合格)");
  // AC-204 (gap-ac204-quay-init-forbidden-prefixes-mcp-commands-hooks-enable-declared): the forbidden-
  // surface record writes forbidden_count=0 (integer) + enable_declared=true (literal) verbatim, and
  // refuses a forbidden-copy record (forbidden_count=1) and a no-enable record (enable_declared=0) —
  // the 成对判定 (禁列为空 alone is satisfiable by "lay nothing" ⇒ must pair with enable declared).
  assert.match(r.stdout, /ac204-record\(valid\) wrote=1 fields_ok=1/,
    "AC-204 record: valid record written with forbidden_count=0 + enable_declared=true verbatim");
  assert.match(r.stdout, /ac204-record\(forbidden-copy\) refused=1/,
    "AC-204 record: forbidden_count=1 ⇒ refused (fail-closed)");
  assert.match(r.stdout, /ac204-record\(no-enable\) refused=1/,
    "AC-204 record: enable_declared=0 ⇒ refused (fail-closed, 成对判定)");
  // AC-205 (gap-ac205-session-delivery-channel-transcript-confirmed): transcript_confirmed is
  // derived from transcript-delivery-check reading the transcript (probe present ⇒ delivered exit 0;
  // absent ⇒ not) — never from a send exit code — and the record writes the three criterion fields
  // verbatim + top-level build_sha, refusing shipped=false / transcript_confirmed=false / empty-host
  // (fail-closed, AC4 negative).
  assert.match(r.stdout, /ac205-transcript-check\(hit\/miss\) hit=1 miss=0/,
    "AC-205 transcript check: probe present ⇒ delivered(exit 0), absent ⇒ not — the transcript read is the source");
  assert.match(r.stdout, /ac205-record\(valid\) wrote=1 fields_ok=1/,
    "AC-205 record: valid record written with shipped_from_installed_artifact=true + transcript_confirmed=true + build_sha");
  assert.match(r.stdout, /ac205-record\(shipped=false\) refused=1/,
    "AC-205 record: shipped_from_installed_artifact=false ⇒ refused (fail-closed)");
  assert.match(r.stdout, /ac205-record\(transcript_confirmed=false\) refused=1/,
    "AC-205 record: transcript_confirmed=false ⇒ refused (AC4 negative — send exit 0 but transcript not materialized)");
  assert.match(r.stdout, /ac205-record\(empty-host\) refused=1/,
    "AC-205 record: empty host ⇒ refused (fail-closed)");
  // AC-234 (gap-ac234-web-third-party-renders-carriers-and-round-records): the --selfcheck must ALSO
  // exercise the web-render content-count positive/negative controls (three counts derived from
  // rendered HTML content — task/goal anchors + round-row anchors — never an HTTP status code) and the
  // carrier-record writer's positive/negative controls (writes the six criterion fields verbatim;
  // refuses zero-count / empty-host — fail-closed, AC4 负控制).
  assert.match(r.stdout, /ac234-render-counts\(positive\) tasks=3 goals=2 rounds=5/,
    "AC-234 positive: rendered HTML content yields tasks_rendered=3 goals_rendered=2 round_records_rendered=5 (content, not HTTP status)");
  assert.match(r.stdout, /ac234-render-counts\(negative,empty-shell\) tasks=0 goals=0 rounds=0/,
    "AC-234 negative: an empty-shell page yields 0/0/0 (the criterion can take false — 三计数缺一不可)");
  assert.match(r.stdout, /ac234-record\(valid\) wrote=1 fields_ok=1/,
    "AC-234 record: valid record written with the six criterion fields verbatim (tasks/goals/rounds as JSON integers)");
  assert.match(r.stdout, /ac234-record\(zero-count\) refused=1/,
    "AC-234 record: any zero count ⇒ refused (fail-closed)");
  assert.match(r.stdout, /ac234-record\(empty-host\) refused=1/,
    "AC-234 record: empty host ⇒ refused (fail-closed)");
  // AC-232 (gap-ac232-downstream-goal-carrier-write-readback): the --selfcheck must ALSO exercise the
  // downstream-goal-carrier write+read-back record writer's positive/negative controls — writes the three
  // criterion fields verbatim (goal_write_ok/goal_read_back_ok as JSON literals, goal_records as a JSON
  // integer) + top-level build_sha; truthfully writes false/0 when the write fails or read-back is empty
  // (AC4 负控制 — 写调用 0 与空文件同形, the criterion can take false); refuses empty-host (fail-closed).
  assert.match(r.stdout, /ac232-record\(valid\) wrote=1 fields_ok=1/,
    "AC-232 record: valid record written with goal_write_ok=true + goal_read_back_ok=true + goal_records=5 + build_sha");
  assert.match(r.stdout, /ac232-record\(write-failed\) neg_ok=1/,
    "AC-232 record: write-failed ⇒ goal_write_ok=false still written (缺件如实非静默 — criterion can take false)");
  assert.match(r.stdout, /ac232-record\(empty-host\) refused=1/,
    "AC-232 record: empty host ⇒ refused (fail-closed, 缺值≠合格)");
  // gap-verify-coldstart-does-not-configure-target-profiles: the --selfcheck must ALSO exercise the
  // target-profiles configuration controls — derived (driving profiles worker-default written into the
  // target), no-source (not-configured, distinct — 硬规则 3b), override (--target-launcher/model win),
  // and path resolution (--driving-profiles explicit > --build-root).
  assert.match(r.stdout, /target-profiles\(derived\) status=configured rc=0 launcher=claude-fjdac model=deepseek-v4-pro-anthropic auth=token/,
    "target-profiles positive (AC1): driving profiles worker-default is written into the target");
  assert.match(r.stdout, /target-profiles\(no-source\) status=not-configured rc=2/,
    "target-profiles negative (AC2): no source + no override ⇒ not-configured (distinct, 硬规则 3b)");
  assert.match(r.stdout, /target-profiles\(override\) status=configured launcher=custom-launcher model=custom-model auth=token/,
    "target-profiles override: --target-launcher/model win over derivation");
  assert.match(r.stdout, /target-profiles\(resolve\) explicit=1 buildroot=1/,
    "target-profiles resolve: --driving-profiles explicit > --build-root");
  // AC-207 carrier record (gap-ac207-e2e-target-driver-driven-real-commit-task-done): the AC-207
  // record writer must append the eight criterion fields verbatim (produced_by_driver=true literal,
  // gate_events>0, task_status=done, commit_sha/task_id non-empty, commit_files non-empty JSON array
  // with ≥1 path outside tasks/goals/.quay, top-level build_sha via the GOAL-009 anchor) and refuse
  // produced_by_driver=false / gate_events=0 — the criterion's `is True` / `>0` predicates must be
  // able to take false (硬规则 3b / 硬规则 4).
  assert.match(r.stdout, /ac207-record\(valid\) wrote=1 fields_ok=1/,
    "positive control: a valid AC-207 record (all eight criterion fields) is written");
  assert.match(r.stdout, /ac207-record\(produced_by_driver=false\) refused=1/,
    "negative control: produced_by_driver=false is refused (criterion `is True` can take false)");
  assert.match(r.stdout, /ac207-record\(gate_events=0\) refused=1/,
    "negative control: gate_events=0 is refused (criterion `>0` can take false)");
  // gap-ac207-commit-sha-points-at-bookkeeping-flip-not-implementation-commit: the write point used
  // to select "the newest commit that isn't chore(quay-init):" — which in a real e2e is the driver's
  // 翻-done BOOKKEEPING commit (7 of 9 commits), while the criterion only asked commit_sha be
  // non-empty ⇒ a zero-implementation project passed too. The controls below pin BOTH halves of the
  // fix: (a) the writer refuses a record whose commit_files are all under tasks/goals/.quay (a
  // bookkeeping commit can't be dressed up as an implementation one — the judgment is POSITIONAL,
  // 硬规则 ②: touched files, so renaming the commit message can't get around it), and (b) the
  // selection function picks the real implementation commit even when newer bookkeeping commits sit
  // on top of it, and yields empty + non-zero when only bookkeeping commits exist (⇒ fail-closed,
  // never a bookkeeping commit written to fill the slot).
  assert.match(r.stdout, /ac207-record\(bookkeeping-files-only\) refused=1/,
    "negative control: commit_files all under tasks/goals/.quay ⇒ refused (the defect: a bookkeeping commit is not an implementation commit)");
  assert.match(r.stdout, /ac207-record\(no-files\) refused=1/,
    "negative control: a missing commit_files ⇒ refused (缺值≠合格, 硬规则 6)");
  assert.match(r.stdout, /ac207-select\(impl-behind-bookkeeping\) subj='feat\(e2e-verify-207\): add e2e-marker\.txt marker \(ac207\)' rc=0/,
    "selection: the implementation commit is picked, NOT the newer 翻-done bookkeeping commit on top of it (the old head-1 form picked the bookkeeping commit)");
  assert.match(r.stdout, /ac207-select\(bookkeeping-only\) out='' rc=1/,
    "selection negative: a bookkeeping-only history selects nothing (⇒ no record written, 硬规则 3b)");
  assert.match(r.stdout, /ac207-is-bookkeeping\(tasks-only\)=1/,
    "positional judgment: a commit touching only tasks/ IS bookkeeping");
  assert.match(r.stdout, /ac207-is-bookkeeping\(marker-file\)=1/,
    "positional judgment: a commit touching e2e-marker.txt is NOT bookkeeping (same message text, different files — proves the judgment is positional)");
  // AC3 — the read→judge→write single point (ac207_read_and_write) driven on a fixture third-party
  // project, asserted by CARRIER LINE COUNT (not by a self-report): a bookkeeping-only history writes
  // NOTHING (0 → 0) and leaves the distinguishable AC207-NO-IMPLEMENTATION-COMMIT trace; the same
  // fixture plus one implementation commit writes exactly one record whose commit_files point outside
  // the bookkeeping triplet. Same fixture, same product function ⇒ the negative isn't vacuously true.
  assert.match(r.stdout, /ac207-e2e-write\(bookkeeping-only\) above=0 line=0 trace=1/,
    "AC3 negative: a bookkeeping-only third-party project writes NO record (carrier lines 0→0) and leaves the AC207-NO-IMPLEMENTATION-COMMIT trace (⛔ not silent, ⛔ not a bookkeeping commit filling the slot)");
  assert.match(r.stdout, /ac207-e2e-write\(with-impl-commit\) line=1 files=\["e2e-marker\.txt"\]/,
    "AC3 positive counterpart: the same fixture + one implementation commit writes exactly one record with commit_files outside the bookkeeping triplet");
  // produced_by_driver must not be decided by `git … | grep -q`: under `set -o pipefail` a matching
  // grep exits early, git takes SIGPIPE, the pipeline returns 141, and the predicate reads FALSE
  // exactly when the condition is TRUE. Measured 2026-09-11 on orangevps against the real third-party
  // root: implementation commit + 1 gate event + status=done all held, yet produced_by_driver was 0
  // and no record was written (OLD=0 / NEW=1 on that host). The race is host-dependent — this
  // machine's GNU grep reads to EOF (10/10 pipelines returned 0, so the old form passes here) while
  // orangevps's grep exits early (5/5 returned 141) — so the deterministic local guard is the
  // STRUCTURAL control: probe_ac207_measures's body must carry no pipe into grep.
  assert.match(r.stdout, /ac207-produced-by-driver\(no-pipe-into-grep\)=1/,
    "produced_by_driver must be decided by captured text + case matching, not `git … | grep -q` (pipefail SIGPIPE reads false exactly when the condition is true)");
  // AC-240 (gap-ac240-e2e-closure-same-run-pairing): the run-level closure self-evidence must take
  // THREE distinguishable values. AC-203 (driver alive) and AC-207 (driver produced) can each hold
  // while coming from two DISJOINT batches of witnesses — measured 2026-09-11 on this repo's carrier:
  // AC-203 roots={63ee9681,b95bd6f1}, AC-207 roots={a2a5aac0}, intersection empty. So "the closure is
  // self-evidenced by ONE run" was neither produced nor judged — only accidentally never true.
  assert.match(r.stdout, /e2e-closure\(pair-same-run-same-root\) E2E_CLOSURE_SELF_EVIDENCED=1 note_present=1/,
    "positive control: AC-203 + AC-207 written by THIS run for the SAME project_root ⇒ E2E_CLOSURE_SELF_EVIDENCED=1");
  assert.match(r.stdout, /e2e-closure\(ac207-only\) E2E_CLOSURE_SELF_EVIDENCED=0 note_present=1/,
    "negative control: AC-207 written but AC-203 not written this run (the origin defect's own shape — step⑤ never probed) ⇒ 0 with a non-empty NOTE, never silent");
  assert.match(r.stdout, /e2e-closure\(different-roots\) E2E_CLOSURE_SELF_EVIDENCED=0 note_present=1/,
    "negative control: both written but for DIFFERENT project_roots ⇒ 0 — the pairing is on the SAME root, not on both being non-empty");
  assert.match(r.stdout, /e2e-closure\(no-e2e-attempt\) E2E_CLOSURE_SELF_EVIDENCED=not-evaluated note_present=1/,
    "not-evaluated: --ac207-e2e not passed ⇒ `not-evaluated`, DISTINCT from 0/1 (硬规则 3b: a verdict whose value set lacks a 未评估 state cannot tell 'checked and failed' from 'never checked')");
  // AC-240 generation side, POSITIONAL (硬规则 ②): the AC-203 probe/write call must sit inside
  // step5_e2e's body. Before this task the in-body hit count was 0 — step④ probed once in a 30s
  // window right after `driver start`, so the project that actually got driven to done (the strongest
  // available "the driver is really alive" direct measure) was never probed and the same run could
  // only ever emit AC-207.
  assert.match(r.stdout, /ac240-ac203-write-point\(in-step5_e2e\) hits=\d+ /,
    "the AC-203 probe/write point must be located inside step5_e2e (before this task: 0 hits in its body)");
});

test("AC1 — --selfcheck is hermetic: it does not touch a real install and runs offline", () => {
  // The selfcheck builds its own temp git repos under os.tmpdir() and never calls npm install /
  // quay-init on a real project. Prove it runs without any real .tgz / npm / network.
  const r = run(["--selfcheck"]);
  assert.equal(r.status, 0, `--selfcheck must be hermetic:\n${r.stderr}`);
  assert.ok(!/npm install/.test(r.stdout), "selfcheck must not run a real npm install");
});

test("--help exits 0 with usage, no side effects (gap-scripts-sprawl)", () => {
  const r = run(["--help"]);
  assert.equal(r.status, 0, `--help must exit 0:\n${r.stderr}`);
  assert.match(r.stdout, /用法|Usage|--selfcheck/, "--help must print usage mentioning the flags");
});

test("arg validation — missing --tgz/--tgz-native without --build-root exits 2 (main flow, not a run)", () => {
  // Full-mode arg validation happens before any install; a missing artifact source must be a
  // usage error (exit 2), NOT a silent pass.
  const r = run(["--root", "/nonexistent/verify-root"]);
  assert.equal(r.status, 2, "missing tgz source must exit 2 (usage error)");
  assert.match(r.stderr, /--tgz|--build-root/,
    "usage error must name the required artifact source");
});

test("arg validation — unknown argument exits 2", () => {
  const r = run(["--no-such-flag"]);
  assert.equal(r.status, 2, "unknown argument must exit 2");
  assert.match(r.stderr, /unknown argument/, "must report the unknown argument");
});

test("arg validation — --channel must be npm-global|marketplace (exit 2 for unknown, fail-closed)", () => {
  // AC1: --channel defaults to npm-global (backward compat); an unknown value must be a usage error
  // (exit 2), NOT silently treated as npm-global (fail-closed, 硬规则 3b).
  const r = run(["--channel", "bogus"]);
  assert.equal(r.status, 2, "unknown --channel must exit 2");
  assert.match(r.stderr, /--channel must be npm-global\|marketplace/, "must name the allowed values");
});

test("--verify-only requires an existing --root (exit 2, not a run)", () => {
  const r = run(["--verify-only", "--root", "/nonexistent/verify-root"]);
  assert.equal(r.status, 2, "--verify-only without an existing root must exit 2");
  assert.match(r.stderr, /--verify-only requires an existing --root/, "must explain the requirement");
});

test("--verify-only re-probes L1 from disk (a laid-down project reports L1_OK=1, not a stale 0)", () => {
  // Regression: verify-only used to inherit L1_* globals only set in step2_init, so L1_OK was
  // always 0 in verify-only mode (COLDSTART_LIVE could never be yes). probe_l1() re-reads disk.
  // L1 is now the SPEC §6 closed set (parsed from --spec), not the retired tick docs.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vc-verify-only-"));
  try {
    const spec = path.join(tmp, "closed-set-spec.md");
    fs.mkdirSync(path.join(tmp, ".quay"), { recursive: true });
    fs.mkdirSync(path.join(tmp, "tasks"), { recursive: true });
    fs.writeFileSync(path.join(tmp, ".quay", "config.yml"), "providers: {}\n");
    fs.writeFileSync(spec,
      "QUAY-INIT-CLOSED-SET:BEGIN\n- .quay/config.yml\n- tasks/\nQUAY-INIT-CLOSED-SET:END\n");
    const r = run(["--verify-only", "--root", tmp, "--project", "vtest",
      "--evidence", path.join(tmp, "evidence.json"), "--ac89", path.join(tmp, "ac89.jsonl"),
      "--spec", spec]);
    assert.equal(r.status, 0, `verify-only on a laid-down project must exit 0:\n${r.stderr}`);
    assert.match(r.stdout, /L1_OK=1/, "L1 must be probed from disk, not a stale global 0");
    assert.match(r.stdout, /AC88_VERIFY=not-live/,
      "laid-down mechanism with no loop work is not-live (DATA), not fail");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("AC2 — L1 closed-set is parsed from the SPEC (mutating the marked block flips the verdict)", () => {
  // 硬规则 4c / 硬规则 2: the L1 assertion set must be DERIVED from the SPEC's
  // QUAY-INIT-CLOSED-SET:BEGIN/END block, not a hardcoded copy. Prove it by mutating the block
  // and observing the verdict flip — if it did not flip, the script would still be a hardcoded copy.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vc-l1-spec-"));
  try {
    const spec = path.join(tmp, "spec.md");
    const root = path.join(tmp, "root");
    fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
    fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
    fs.writeFileSync(path.join(root, ".quay", "config.yml"), "providers: {}\n");
    fs.writeFileSync(spec,
      "QUAY-INIT-CLOSED-SET:BEGIN\n- .quay/config.yml\n- tasks/\nQUAY-INIT-CLOSED-SET:END\n");
    const a = run(["--verify-only", "--root", root, "--project", "l1spec",
      "--evidence", path.join(tmp, "e1.json"), "--ac89", path.join(tmp, "a1.jsonl"), "--spec", spec]);
    assert.match(a.stdout, /L1_OK=1/, "closed-set all present ⇒ L1_OK=1");
    assert.match(a.stdout, /L1_CLOSED_SET_COUNT=2 /, "two closed-set entries parsed from SPEC");
    // Add an entry the root does NOT have ⇒ the verdict must flip (proves the SPEC is re-read).
    fs.writeFileSync(spec,
      "QUAY-INIT-CLOSED-SET:BEGIN\n- .quay/config.yml\n- tasks/\n- .claude/settings.json\nQUAY-INIT-CLOSED-SET:END\n");
    const b = run(["--verify-only", "--root", root, "--project", "l1spec",
      "--evidence", path.join(tmp, "e2.json"), "--ac89", path.join(tmp, "a2.jsonl"), "--spec", spec]);
    assert.match(b.stdout, /L1_OK=0/, "adding an absent entry must flip L1_OK to 0");
    assert.match(b.stdout, /L1_CLOSED_SET_COUNT=3 /, "three entries after mutation");
    assert.match(b.stdout, /\.claude\/settings\.json/, "the newly-added entry is named in the missing set");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("AC3 — unreadable SPEC ⇒ L1_NOT_EVALUATED=1 (distinct from qualified, hard rule 3b)", () => {
  // 硬规则 3b: "未评估" and "合格" must be two distinguishable values. An unreadable SPEC must
  // yield L1_NOT_EVALUATED=1 and L1_OK≠1 (never a silent pass nor a silent fail disguised as qualified).
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vc-l1-ne-"));
  try {
    const root = path.join(tmp, "root");
    fs.mkdirSync(root, { recursive: true });
    const r = run(["--verify-only", "--root", root, "--project", "l1ne",
      "--evidence", path.join(tmp, "e.json"), "--ac89", path.join(tmp, "a.jsonl"),
      "--spec", path.join(tmp, "does-not-exist.md")]);
    assert.match(r.stdout, /L1_NOT_EVALUATED=1/, "missing SPEC must set L1_NOT_EVALUATED=1");
    assert.match(r.stdout, /L1_OK=0/, "and L1_OK must NOT be 1 (未评估 ≠ 合格)");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("AC4 — --verify-only (no build, no tgz sha256) does NOT append an AC-201 record (缺输入不写, 硬规则 3b)", () => {
  // AC-201 record (ac=GOAL-009-AC-201) is only appended when BOTH BUILD_SHA and SHA256_QUAY are
  // non-empty. In --verify-only mode there is no build and ac5_evaluate is never called ⇒
  // SHA256_QUAY stays empty ⇒ append_ac201_record must not write. Prove the ac89 carrier contains
  // the ordinary AC88 record but no GOAL-009-AC-201 record (缺输入 ≠ 合格, 硬规则 3b).
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vc-ac201-"));
  try {
    const spec = path.join(tmp, "spec.md");
    const root = path.join(tmp, "root");
    fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
    fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
    fs.writeFileSync(path.join(root, ".quay", "config.yml"), "providers: {}\n");
    fs.writeFileSync(spec,
      "QUAY-INIT-CLOSED-SET:BEGIN\n- .quay/config.yml\n- tasks/\nQUAY-INIT-CLOSED-SET:END\n");
    const ac89 = path.join(tmp, "ac89.jsonl");
    const r = run(["--verify-only", "--root", root, "--project", "ac201",
      "--evidence", path.join(tmp, "e.json"), "--ac89", ac89, "--spec", spec]);
    assert.equal(r.status, 0, `verify-only must exit 0:\n${r.stderr}`);
    assert.match(r.stdout, /ac201 record NOT appended/,
      "verify-only must report the AC-201 record was NOT appended (缺输入不写)");
    const contents = fs.existsSync(ac89) ? fs.readFileSync(ac89, "utf8") : "";
    assert.ok(/\"ac\":\"AC88\"/.test(contents),
      "the ordinary AC88 record IS still appended in verify-only mode");
    assert.ok(!/GOAL-009-AC-201/.test(contents),
      "verify-only (no build, no tgz sha256) must NOT append an AC-201 record");
    // AC3 (gap-verify-coldstart-does-not-configure-target-profiles): the ac89 detail must CARRY the
    // target-profiles fields (grep-able). verify-only never configures ⇒ honestly not-configured
    // (a distinct value, never a silent "configured" — 硬规则 3b).
    assert.match(contents, /target_profiles_status=not-configured/,
      "ac89 detail must carry target_profiles_status (verify-only honestly reports not-configured)");
    const ev = fs.readFileSync(path.join(tmp, "e.json"), "utf8");
    assert.match(ev, /"target_profiles_status": "not-configured"/,
      "evidence JSON must carry target_profiles_status (grep-able, AC3)");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── AC5 (gap-ac203-record-lacks-build-sha-makes-ac214-permanently-unsatisfiable) ─────────────
//
// AC-214 (goals/AC-214-*.md) is a freshness meta-criterion over four carrier records. For each ac in
// its NEED list it keeps the NEWEST record and reads a top-level `build_sha` (or `commit`):
//     sha = r.get("build_sha") or r.get("commit")
//     if sha and (...) : newest[a] = ...
//     missing = [a for a in NEED if a not in newest]   ⇒ exit 1
// ⇒ a record WITHOUT that anchor is not "old evidence", it is NO evidence. AC-203's write point was a
// bare printf that emitted no build_sha ⇒ AC-214 was structurally unsatisfiable once AC-203 produced.
//
// This is the DoD's mechanical guard (⛔ 不是人工清点一次): NEED is PARSED from the AC-214 criterion
// source rather than copied here (硬规则 4c — a copy drifts), and for every enumerated ac the script's
// record-PRODUCING statements are collected by POSITION (a pure-comment line never counts, 硬规则 2;
// a selfcheck `grep -q '"ac":"…"'` assertion is not a producer) and each must carry the anchor.
//
// The two anchor forms accepted are exactly the two that exist in this file:
//   (a) a call to the single write choke point `ac_record_append` in its DEFAULT (anchored) mode — it
//       injects the top-level build_sha/ts anchor itself (AC-203/205/207/232/238 go through it), or
//   (b) an explicit top-level `"build_sha":` field in the record fragment — required for the `plain`
//       mode callers (AC-201/204/206/234: the choke point does NOT anchor those).
// ⛔ Adding a third, unanchored write point for any NEED ac turns this test red — which is the point.

// AC-240 AC1 — the generation-side AC-203 write point is POSITIONALLY inside step5_e2e's body, and
// its driver_alive / carrier_records arguments are the values probed by probe_ac203_driver_status at
// that moment — never the literals "0"/"1" that step④ happens to pass (⛔ and step④ is deliberately
// NOT changed: its literals are only reachable behind a measured gate, so it is a serialization of
// readings, not a tautology). This is a positional check (硬规则 ②): a comment mentioning the call
// does not count, and moving the probe back out of step⑤ flips it — i.e. the same-run pairing stops
// being an accident and becomes a requirement.
test("AC1 (AC-240) — the AC-203 probe/write call sits inside step5_e2e and passes probed values", () => {
  const lines = fs.readFileSync(SCRIPT, "utf8").split("\n");
  const start = lines.findIndex((l) => /^step5_e2e\(\)/.test(l));
  assert.ok(start >= 0, "step5_e2e must be defined");
  let end = -1;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i] === "}") { end = i; break; }
  }
  assert.ok(end > start, "step5_e2e's body must terminate at a column-0 `}`");
  // Comments stripped by POSITION (a bare `#` line is not a call site).
  const body = lines.slice(start, end + 1).map((l) => l.replace(/#.*$/, "")).join("\n");
  const probeCall = body.split("\n").filter((l) => /probe_ac203_driver_status/.test(l));
  const writeCall = body.split("\n").filter((l) => /write_ac203_record/.test(l));
  assert.ok(probeCall.length >= 1,
    "step5_e2e must call probe_ac203_driver_status (before this task the in-body hit count was 0)");
  assert.ok(writeCall.length >= 1,
    "step5_e2e must call write_ac203_record (the single AC-203 write point, so no second writer is invented)");
  const call = writeCall[0];
  assert.match(call, /\$AC203_DRIVER_ALIVE/, "driver_alive must come from the live probe, not a literal");
  assert.match(call, /\$AC203_CARRIER_RECORDS/, "carrier_records must come from the live probe, not a literal");
  assert.ok(!/"0"\s+"1"/.test(call),
    `the write call must not pass the literals "0" "1" (that would make the record a tautology): ${call.trim()}`);
});

// logicalStatements(): join backslash-continued physical lines into one statement, so a printf whose
// format string and its `>> "$AC89"` redirection sit on different physical lines is judged as a whole.
function logicalStatements(src) {
  const out = [];
  let cur = "";
  for (const raw of src.split("\n")) {
    const line = raw.replace(/\s+$/, "");
    const cont = line.endsWith("\\");
    const piece = cont ? line.slice(0, -1) : line;
    cur = cur ? `${cur} ${piece.trim()}` : piece;
    if (!cont) { out.push(cur); cur = ""; }
  }
  if (cur) out.push(cur);
  return out;
}

// parseAc214Need(): the NEED list is the criterion's own source of truth — read it, never restate it.
// A parse failure is reported as NOT-EVALUATED (a distinct outcome), never as a silent pass (硬规则 3b).
function parseAc214Need(repoRoot) {
  const dir = path.join(repoRoot, "goals");
  const found = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((n) => /^AC-214-.*\.md$/.test(n))
    : [];
  if (found.length !== 1) {
    return { ok: false, reason: `expected exactly one goals/AC-214-*.md, found ${found.length}` };
  }
  const src = fs.readFileSync(path.join(dir, found[0]), "utf8");
  const m = src.match(/NEED\s*=\s*\[([\s\S]*?)\]/);
  if (!m) return { ok: false, reason: "AC-214 criterion has no `NEED = [...]` list" };
  const ids = [...m[1].matchAll(/"(GOAL-009-AC-\d+)"/g)].map((x) => x[1]);
  if (ids.length === 0) return { ok: false, reason: "NEED list parsed but enumerated no ac ids" };
  return { ok: true, ids };
}

test("AC5 — every AC-214 NEED ac's write point carries a freshness anchor (mechanical enumeration)", () => {
  const need = parseAc214Need(REPO_ROOT);
  assert.ok(need.ok,
    `AC-214's NEED must be mechanically parseable — an unparsed NEED is NOT-EVALUATED, not a pass (硬规则 3b): ${need.reason}`);
  assert.ok(need.ids.length >= 2,
    `NEED must enumerate the carrier acs (parsed ${need.ids.length}: ${need.ids.join(",")})`);

  const stmts = logicalStatements(fs.readFileSync(SCRIPT, "utf8"));
  // A record PRODUCER appends to the carrier: either a call to the write choke point, or a printf
  // redirected into the AC89 carrier. A selfcheck assertion (`grep -q '"ac":"…"'`) matches the ac
  // field but is not a producer, so it is excluded by position — not by a keyword.
  // Two producer forms: the write choke point `ac_record_append` (a — gap-ac-record-schema-
  // duplicated-between-criterion-and-writer rerouted every writer through it so the field list is
  // validated at production time; gap-ac-record-choke-point-naming-dedup-ac238-bypass merged the two
  // entry functions into it and rerouted AC-238's bare printf through it too), and a printf
  // redirected into the carrier (b).
  const isProducer = (s) =>
    s.includes("ac_record_append ") || />>\s*"\$\{?[Aa][Cc]89\}?"/.test(s);
  // The anchor is a TOP-LEVEL build_sha on the produced record: the choke point adds it in its
  // DEFAULT (anchored) mode, or the record fragment spells it itself.
  // ⚠️ `plain` mode is the discriminator, and it must be read as the call's MODE argument — matching
  // the bare word anywhere would be both a false-positive (a fragment value containing "plain") and,
  // worse, would make this predicate TRUE for the plain-mode callers too, i.e. a量 that cannot take
  // false (硬规则 4). The mode argument is written as `"<carrier>" plain` / `"<carrier>" anchored`.
  const isPlainModeCall = (s) => /["']\s+plain\b/.test(s);
  const isAnchored = (s) =>
    (s.includes("ac_record_append ") && !isPlainModeCall(s)) ||
    /"build_sha"\s*:/.test(s.replace(/\\/g, ""));

  const problems = [];
  for (const id of need.ids) {
    const re = new RegExp(`ac":"${id}"`);   // backslashes stripped below (helper fragments are escaped)
    const producers = stmts.filter((s) =>
      !/^\s*#/.test(s) && re.test(s.replace(/\\/g, "")) && isProducer(s));
    if (producers.length === 0) {
      problems.push(`${id}: no record-producing write point found in ${path.relative(REPO_ROOT, SCRIPT)} ` +
        `(cannot assert its anchor ⇒ NOT-EVALUATED, not a pass)`);
      continue;
    }
    for (const p of producers) {
      if (!isAnchored(p)) {
        problems.push(`${id}: write point lacks a top-level build_sha anchor ⇒ AC-214 reads it as ` +
          `NO evidence (exit 1): ${p.trim().slice(0, 140)}`);
      }
    }
  }
  assert.deepEqual(problems, [],
    "every AC-214 NEED ac's write point must carry a top-level build_sha (via the anchored-mode " +
    `choke point ac_record_append or an explicit field) — otherwise that ac is structurally unsatisfiable in AC-214:\n  ${problems.join("\n  ")}`);
});

// ── AC-247 (GOAL-016) — the takeover producer's hermetic controls ────────────────────────────────
// gap-ac247-stalled-project-clean-takeover-record: the AC reads a carrier record that this script now
// produces (segment ⑧, --ac247-takeover). Its hermetic half lives in --selfcheck, and its two
// load-bearing properties are BOTH negative controls — so asserting only "PASS" would let a green
// selfcheck hide exactly the defect the AC is about:
//   · every one of the eight criterion readings, when unreadable, must produce ZERO records
//     (⛔ never a `driver_alive:0` record — "could not read" must not be dressed as "read it, it's
//     not alive"; 硬规则 3b's mirror half), with stale_days 13.999 refused and 14.000 accepted so the
//     14-day floor is a real filter rather than a constant;
//   · driver_alive must come from the status carrier (the same parser AC-203 uses) and ⛔ never from
//     `quay driver start`'s exit code — the AC names that explicitly, because start already exits 0
//     while the system is dead (GOAL-009 AC-203).
test("AC-247 — --selfcheck exercises the takeover producer's eight-reading refusal + liveness-source controls", () => {
  const r = run(["--selfcheck"]);
  assert.equal(r.status, 0, `--selfcheck must exit 0:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /ac247-record\(fields\+anchor\) ok=1 missing_fields='' anchor-literal-hits=0/,
    "the eight fields must land verbatim on the record line, through the shared anchor choke point only");
  assert.match(r.stdout, /ac247-refusal\(9 negative specs \+ boundary-14\.000-accepted\) negatives_all_refused=1/,
    "every unreadable/out-of-range reading must yield ZERO records — including the 13.999 boundary below the 14-day floor");
  assert.match(r.stdout, /ac247-task-store-count\(61 via real node stub\) ok=1 head\/stale-unreadable-checks=0/,
    "the task-store count must read the project's own store through its ABI, and a non-JSON/empty reply must NOT read as 0");
  assert.match(r.stdout, /ac247-liveness-source\(from-AC203_DRIVER_ALIVE\)=1 status-read-hits=1 bad-assign-hits=0/,
    "driver_alive must come from the status carrier, ⛔ not from the driver start exit code");
});

// ── AC-249 (GOAL-016) — the complete-change producer's hermetic controls ──────────────────────────
// gap-ac249-complete-change-code-doc-same-task-record: the AC reads a carrier record whose ONLY judging
// field is `commit_files`, and it must be the UNION of every commit filed under that one task_id with
// BOTH a code path (`src/`|`scripts/`) and an ADR-007 doc path — one side alone does not count.
// The defect this producer exists for is that the PRE-EXISTING `ac207_select_implementation_commit`
// returns a SINGLE "newest implementation commit": a task that split code and doc into two commits is
// seen as half a change in BOTH directions, so a fully qualified task reads as a permanent red
// (硬规则 4c). Asserting only "PASS" would let a green selfcheck hide exactly that, so the readings
// pinned below are: the union writes one record; the SAME fixture under the single-commit selector
// writes NONE (the guard — ⛔ without it a "newest commit only" implementation passes every positive
// case); each one-sided union writes none; the `./src/…` path form writes none; an unreadable union
// writes none and is reported as NOT-EVALUATED rather than as "incomplete".
test("AC-249 — --selfcheck exercises the complete-change producer's union + both one-sided refusals", () => {
  const r = run(["--selfcheck"]);
  assert.equal(r.status, 0, `--selfcheck must exit 0:\n${r.stdout}\n${r.stderr}`);
  // positive: the union (code commit first, doc commit last) carries BOTH sides and writes one record
  assert.match(r.stdout, /ac249-union\(multi-commit same task\) files=\["quay-adr\/ADR-007\.md","scripts\/check-adr\.ts","tasks\/T-1\.md"\] wrote=1 lines=0->1/,
    "the union of a two-commit complete change must carry both sides and write exactly one record");
  // ⛔ THE GUARD: the same fully-qualified fixture, read through the single-commit selector, writes ZERO
  assert.match(r.stdout, /ac249-single-commit-selector\(reference impl\) files=\["quay-adr\/ADR-007\.md"\] wrote=0/,
    "the pre-existing single-commit selector must see only the newest (doc) commit and write NOTHING — that is the defect face");
  // one side alone, both directions — zero records, carrier line count unchanged
  assert.match(r.stdout, /ac249-negative\(code-only\) files=\["src\/a\.ts","tasks\/T-1\.md"\] wrote=0 lines=1->1/,
    "a code-only union must be refused (单边不算)");
  assert.match(r.stdout, /ac249-negative\(doc-only\) files=\["quay-adr\/ADR-007\.md","tasks\/T-1\.md"\] wrote=0 lines=1->1/,
    "a doc-only union must be refused (单边不算)");
  // the path form is a direct quantity: `./src/…` can never satisfy `startswith("src/")`
  assert.match(r.stdout, /ac249-negative\(dot-slash-form\) pred_is_code=0 wrote=0 lines=1->1/,
    "a `./`-prefixed path must fail the predicate — the criterion's startswith sees paths verbatim");
  // unreadable union ⇒ NOT-EVALUATED, ⛔ never a `commit_files: []` record (未测量 ≠ 不合格)
  assert.match(r.stdout, /ac249-negative\(missing-union\) files=\[\] wrote=0 lines=1->1/,
    "an unreadable union must write nothing (未测量 ≠ 不合格, 硬规则 3b)");
  // structural: the writer carries no second anchor, does not route through the single-commit selector,
  // and the union excludes merge commits (whose `git show --name-only` is empty)
  assert.match(r.stdout, /ac249-writer-anchor-hits=0 writer-single-selector-hits=0 union-no-merges-hits=\d+/,
    "the writer must not carry a build_sha literal nor reach for the single-commit selector; the union must skip merges");
});

// ── AC 载体记录 schema：单一真源 + 产出时 fail-closed + 落账后复跑（gap-ac-record-schema-…）──────
// AC1 — the drift report: criterion(判读侧) vs AC_RECORD_SCHEMA(声明) vs writer(实写), all three
//        positional extractions, printed per AC; a hard diff exits non-zero.
test("AC1 — --ac-record-schema-report prints the per-AC three-way diff and exits 0 when clean", () => {
  const r = run(["--ac-record-schema-report"]);
  assert.equal(r.status, 0, `the report must exit 0 when there is no hard diff:\n${r.stdout}\n${r.stderr}`);
  // the four GOAL-016 ACs this task migrates must all read clean on all three sides
  for (const n of [247, 248, 249, 250]) {
    assert.match(r.stdout, new RegExp(`GOAL-016-AC-${n}\\s+\\[ok\\] criterion=\\d+ schema=\\d+ writer=\\d+`),
      `AC-${n} must be ok on criterion/schema/writer (the mechanism must carry its real field set)`);
  }
  // AC-239's commit_files is a written-but-unread field: reported as surplus (recorded), not a hard diff
  assert.match(r.stdout, /GOAL-009-AC-239\s+\[surplus\][\s\S]{0,200}多余字段/,
    "a field that is written but never read must be recorded as surplus, not silently dropped nor failed");
  // the summary separates the three hard diffs from the benign one — and says what was NOT evaluated
  assert.match(r.stdout, /missing\(criterion-vs-schema\)=0 missing\(criterion-vs-writer\)=0 missing\(schema-vs-writer\)=0 surplus=\d+ unregistered=0 not-evaluated=0/,
    "the summary must separate hard diffs from surplus and must expose a not-evaluated count (硬规则 3b)");
});

// AC2 — single source: a new AC needs ONE declaration row + the generic producer, NOT a new function.
test("AC2 — a brand-new AC produces a valid record via one declaration row and no new writer function", () => {
  const r = run(["--selfcheck"]);
  assert.equal(r.status, 0, `--selfcheck must exit 0:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /ac-record-schema\(AC2 new-ac, no new writer fn\) wrote=1 line=\{"build_sha":"[0-9a-f]{40}","ts":"[^"]+","ac":"GOAL-016-AC-999","host":"hostB-fake","project_root":"\/tmp\/p","made_by":"write_ac_record"\}/,
    "the generic write_ac_record must emit a complete, anchored record for an AC that has ONLY a declaration row");
});

// AC3 — fail-closed AT PRODUCTION TIME (⛔ not "the criterion exits 1", which is the status quo).
test("AC3 — a record missing a declared field is refused and writes NOTHING; completed it writes", () => {
  const r = run(["--selfcheck"]);
  assert.equal(r.status, 0, `--selfcheck must exit 0:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /ac-record-schema\(AC3 missing-field\) refused=1 lines=0→0 \(expect 1\/0→0/,
    "omitting a declared field must be refused with ZERO lines written — the failure happens at write time");
  assert.match(r.stdout, /ac-record-schema\(AC3 complete\) accepted=1 lines=0→1 \(expect 1\/0→1/,
    "the same call with the field present must write exactly one record (so the refusal above is not vacuous)");
  assert.match(r.stdout, /ac-record-schema\(AC3 message\) 'AC-RECORD-SCHEMA: refusing GOAL-016-AC-249 record — host \(MISSING\)/,
    "the refusal must NAME the missing field — otherwise the operator is back to debugging a red criterion");
  assert.match(r.stdout, /ac-record-schema\(AC3 unregistered-ac\) refused=1 lines=1→1/,
    "an ac with no declaration row must be refused — that is what makes 'one declaration row' the price of a new AC");
});

// AC4 — after a record lands, the criterion is re-run automatically; its exit code is recorded, and a
// red criterion is REPORTED (⛔ never silently treated as success).
test("AC4 — the criterion is re-run after the append, and 'appended but still red' is reported", () => {
  const r = run(["--selfcheck"]);
  assert.equal(r.status, 0, `--selfcheck must exit 0:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /ac-record-rerun\(after-append, criterion-green\) wrote=1 rerun_rc=0 loud=0 rerun_records=1/,
    "a green criterion must be re-run automatically and its rc=0 recorded, with no false alarm");
  assert.match(r.stdout, /ac-record-rerun\(appended-but-criterion-red\) wrote=1 rerun_rc=1 loud=1 rerun_records=1/,
    "an appended record whose criterion still exits 1 must record rc=1 AND be reported loudly (⛔ 不静默当成功)");
});

// AC5 — the four GOAL-016 field sets are carried: every declared field is enforced individually.
test("AC5 — every declared field of AC-247/248/249/250 is enforced at write time", () => {
  const r = run(["--selfcheck"]);
  assert.equal(r.status, 0, `--selfcheck must exit 0:\n${r.stdout}\n${r.stderr}`);
  const declared = { 247: 7, 248: 11, 249: 4, 250: 10 };
  for (const [n, w] of Object.entries(declared)) {
    assert.match(r.stdout, new RegExp(`ac-record-schema\\(AC5 GOAL-016-AC-${n}\\) declared=${w} accepted=1 omitted\\('host'\\)_refused=yes`),
      `AC-${n}'s declared field set (${w} fields) must be individually enforced — omitting one is refused`);
  }
});

// AC1 falsifiability — the report must be able to take FALSE, in both of its blind spots.
test("AC1 — the drift report can take false (dropped field ⇒ DRIFT; dropped row ⇒ unregistered)", () => {
  const r = run(["--selfcheck"]);
  assert.equal(r.status, 0, `--selfcheck must exit 0:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /ac-record-schema\(AC1 drop-a-criterion-field\) rc=1 drift-line=1 names-field=1/,
    "dropping a criterion-read field from the declaration must flip the report to DRIFT and name the field");
  assert.match(r.stdout, /ac-record-schema\(AC1 whole-row-removed\) rc=1 unregistered=1/,
    "removing a whole declaration row makes the AC vanish from a row-driven report — the producer-side reverse lookup must catch it");
});

// ── AC-238 接入写入 choke point（gap-ac-record-choke-point-naming-dedup-ac238-bypass）───────────
// AC3 — the report must now SEE AC-238 (before this task its bare `printf >> "$AC89"` was invisible to
// a report that is driven by the schema rows), on all three sides, clean.
test("AC-238 — the drift report sees it and reads ok on all three sides (was: invisible)", () => {
  const r = run(["--ac-record-schema-report"]);
  assert.equal(r.status, 0, `the report must exit 0 when there is no hard diff:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /GOAL-009-AC-238\s+\[ok\] criterion=7 schema=7 writer=7/,
    "AC-238 must be registered, written and read — and the three counts must agree (else it is DRIFT/surplus)");
  assert.match(r.stdout, /14 AC registered/,
    "the declaration table must have grown by exactly the new AC-238 row (13 → 14)");
});

// AC4 — the new write point is fail-closed and the failure is falsifiable: every declared AC-238 field
// is individually enforced, and the refusal writes NOTHING (未测量 ≠ 不合格).
test("AC-238 — every declared field is enforced at write time, and the refusal writes zero lines", () => {
  const r = run(["--selfcheck"]);
  assert.equal(r.status, 0, `--selfcheck must exit 0:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout,
    /ac-record-schema\(AC238 refused-when-declared-field-omitted\) refused=1 lines=0→0 msg='AC-RECORD-SCHEMA: refusing GOAL-009-AC-238 record — host \(MISSING\)/,
    "omitting a declared AC-238 field must be refused with the field NAMED and nothing written");
  assert.match(r.stdout, /ac-record-schema\(AC238 accepted-when-complete\) wrote=1 lines=0→1/,
    "…and the completed fragment must write exactly one record (otherwise the refusal above is vacuous)");
  assert.match(r.stdout, /ac-record-schema\(AC238 every-declared-field-enforced\) declared=7 each_omitted_refused=7/,
    "every declared field — not just the one the message happens to name — must be individually enforced");
  // 结构性（按位置）：AC-238's write used to be a bare `printf … >> "$AC89"`; it must now go through
  // the choke point, and must NOT carry its own anchor literal (the anchored mode injects build_sha/ts).
  assert.match(r.stdout, /ac238-writer bare-printf-to-AC89-hits=0 choke-point-hits=1 build_sha-literal-hits=0/,
    "the bare printf must be gone, the write must go through ac_record_append, and the anchor must come from the choke point alone");
});

// AC2 — the rename is complete: the historical name is gone from the WHOLE script, comments included,
// and the entry point sits in the `ac_record_*` family like its collaborators.
test("AC2 — the historical entry-function name is gone and the entry point joins the ac_record_* family", () => {
  const src = fs.readFileSync(SCRIPT, "utf8");
  assert.equal(src.includes("ac89_append_goal009"), false,
    "the historical name must not survive anywhere in the script — comments included (AC2)");
  assert.match(src, /^ac_record_append\(\) \{$/m,
    "the merged single entry point must be defined under the ac_record_* prefix");
  assert.match(src, /\$3 = 模式，缺省 `anchored`/,
    "the two former behaviours must be expressed as a MODE parameter, not as two function bodies (AC1)");
});

test("AC-249 — the step is wired into the opt-in chain and shares AC-248's --target-root/--task-id", () => {
  const src = fs.readFileSync(SCRIPT, "utf8");
  assert.match(src, /--ac249-complete-change\) AC249_COMPLETE_CHANGE=1; shift/,
    "the opt-in flag must be parsed");
  // positional: the AC-249 step call must sit in the SAME branch as AC-248's — the two ACs are two
  // readings of ONE driven-out task, so a second invocation path (or a second task-id knob) would let
  // them be produced from different drives, which the goal's criterion explicitly rules out.
  const branchStart = src.indexOf('elif [ "$AC248_ADR_FLIP" = 1 ] || [ "$AC249_COMPLETE_CHANGE" = 1 ]; then');
  assert.ok(branchStart >= 0, "AC-248/AC-249 must share one opt-in branch");
  const branchBody = src.slice(branchStart, src.indexOf("\n  elif [", branchStart));
  assert.match(branchBody, /step_ac248_adr_flip "\$AC248_ROOT"/, "AC-248's step must run in the shared branch");
  assert.match(branchBody, /step_ac249_complete_change "\$AC248_ROOT"/, "AC-249's step must run in the shared branch");
  // ⛔ exactly ONE --task-id knob: a second, AC-249-specific task-id flag would make "the same task"
  // two knobs the caller can turn apart (硬规则 3b's family: looks covered, can differ).
  assert.equal((src.match(/--task-id\)\s/g) || []).length, 1,
    "--task-id must be the single shared knob (AC-248 and AC-249 read the same driven task)");
});
