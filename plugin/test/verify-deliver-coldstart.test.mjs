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
  // record writer must append the seven criterion fields verbatim (produced_by_driver=true literal,
  // gate_events>0, task_status=done, commit_sha/task_id non-empty, top-level build_sha via the GOAL-009
  // anchor) and refuse produced_by_driver=false / gate_events=0 — the criterion's `is True` / `>0`
  // predicates must be able to take false (硬规则 3b / 硬规则 4).
  assert.match(r.stdout, /ac207-record\(valid\) wrote=1 fields_ok=1/,
    "positive control: a valid AC-207 record (all seven criterion fields) is written");
  assert.match(r.stdout, /ac207-record\(produced_by_driver=false\) refused=1/,
    "negative control: produced_by_driver=false is refused (criterion `is True` can take false)");
  assert.match(r.stdout, /ac207-record\(gate_events=0\) refused=1/,
    "negative control: gate_events=0 is refused (criterion `>0` can take false)");
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
//   (a) the shared helper `ac89_append_goal009` — injects top-level build_sha/ts (the single choke
//       point; AC-203/205/207/232 go through it), or
//   (b) an explicit top-level `"build_sha":` field in the record-producing printf (AC-201).
// ⛔ Adding a third, unanchored write point for any NEED ac turns this test red — which is the point.

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
  // A record PRODUCER appends to the carrier: either the shared anchor helper, or a printf redirected
  // into the AC89 carrier. A selfcheck assertion (`grep -q '"ac":"…"'`) matches the ac field but is
  // not a producer, so it is excluded by position — not by a keyword.
  const isProducer = (s) =>
    s.includes("ac89_append_goal009") || />>\s*"\$\{?[Aa][Cc]89\}?"/.test(s);
  // The anchor is a TOP-LEVEL build_sha on the produced record: the helper adds it (form a), or the
  // printf spells it (form b).
  const isAnchored = (s) => s.includes("ac89_append_goal009") || /"build_sha"\s*:/.test(s);

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
    "every AC-214 NEED ac's write point must carry a top-level build_sha (via ac89_append_goal009 or an " +
    `explicit field) — otherwise that ac is structurally unsatisfiable in AC-214:\n  ${problems.join("\n  ")}`);
});
