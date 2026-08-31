// @test-group lowconc
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vc-verify-only-"));
  try {
    const dirs = ["orchestration", "docs/analysis", "plugin/scripts", ".quay/runtime/bin"];
    for (const d of dirs) fs.mkdirSync(path.join(tmp, d), { recursive: true });
    fs.writeFileSync(path.join(tmp, "orchestration", "orchestrator-loop-tick.md"), "# outer\n");
    fs.writeFileSync(path.join(tmp, "docs/analysis", "fast-mode-loop-tick.md"), "# inner\n");
    fs.writeFileSync(path.join(tmp, "plugin/scripts", "session-liveness.sh"), "#!/bin/bash\n");
    fs.writeFileSync(path.join(tmp, ".quay", "config.yml"), "providers: {}\n");
    fs.writeFileSync(path.join(tmp, ".quay", "runtime", "bin", "quay.js"), "//x\n");
    const r = run(["--verify-only", "--root", tmp, "--project", "vtest",
      "--evidence", path.join(tmp, "evidence.json"), "--ac89", path.join(tmp, "ac89.jsonl")]);
    assert.equal(r.status, 0, `verify-only on a laid-down project must exit 0:\n${r.stderr}`);
    assert.match(r.stdout, /L1_OK=1/, "L1 must be probed from disk, not a stale global 0");
    assert.match(r.stdout, /AC88_VERIFY=not-live/,
      "laid-down mechanism with no loop work is not-live (DATA), not fail");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
