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
