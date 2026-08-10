// @test-group serial
// @load-sensitive heavy
// KNOWN-LOAD-SENSITIVE (see plugin/loop/fast-mode-loop-tick.md "已知负载敏感族") — real-install e2e:
// each test spawns a real quay-init.sh --loop install subprocess tree. The install/quay-init family
// rotated flakes across groups under full-suite load, so the whole family is consolidated into the
// concurrency-1 serial phase (gap-install-family-tests-rotate-flakes-under-full-suite).
// quay-init.test.mjs — gap-ac37-exec-core-ships-with-package (执行核随包走).
//
// The three ≤80-line execution cores (plugin/loop/{manager,orchestrator,fast-mode}-tick-core.md)
// previously lived ONLY in orchestration/ — they did NOT ship with the loop (quay-init.sh had zero
// `tick-core` hits) and an installed project got the 1000+-line rationale archives with NO execution
// path. This file pins the fix:
//   AC2 — the three cores are in the DERIVED loop laydown set (derive_loop_scripts): a --loop
//       install lays orchestrator-tick-core.md + fast-mode-tick-core.md into orchestration/ and the
//       `quay-init.sh --loop | grep -c tick-core` measure is ≥ 3.
//   AC3 — manager-tick-core.md is OPT-IN (--manager): a default --loop does NOT lay it; --loop
//       --manager DOES.
//   AC4 — the existing referenced ⊆ landed gate (:1081) covers the three cores (no new check): a
//       --loop install passes verify-referenced-landed with them landed (their reference-doc
//       declarations were REMOVED so the gate now validates the landing, not a declaration).
//   AC5 — cold-start readable: the laid-down cores are readable in the target's orchestration/.
//
// Run:
//   scripts/test.sh plugin/test/quay-init.test.mjs
//   node --test plugin/test/quay-init.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { makeTmp, cleanup, runInit, pluginDir } from "./quay-init-loop-helpers.mjs";

const INIT_ARGS = (ws) => [
  "--loop", "--root", ws, "--project", "proj",
  "--test-command", "node --test", "--tmux-session", "proj-0:0.0",
];

const CORE_BASENAMES = [
  "orchestrator-tick-core.md",
  "fast-mode-tick-core.md",
  "manager-tick-core.md",
];

// ── AC2: the three exec cores ship in the derived set + are laid down ────────────────────────────────
test("AC2 — the three exec-core docs are in the derived laydown set; a --loop install lays them to orchestration/", () => {
  const ws = makeTmp();
  try {
    const r = runInit(ws, INIT_ARGS(ws));
    assert.equal(r.status, 0, `init must exit 0:\n${r.stderr}`);
    assert.match(r.stdout, /verify-referenced-landed: OK/, "referenced ⊆ landed must pass with the cores landed");
    // The two default-loop cores land in the target's orchestration/ (the path the tick templates reference).
    for (const core of ["orchestrator-tick-core.md", "fast-mode-tick-core.md"]) {
      const landed = path.join(ws, "orchestration", core);
      assert.ok(fs.existsSync(landed), `the exec core must be laid down: orchestration/${core}`);
      // Cold-start readable (AC5): byte-identical to the shipped plugin/loop/ canonical copy.
      const shipped = path.join(pluginDir, "loop", core);
      assert.ok(fs.existsSync(shipped), `the shipped canonical copy must exist: plugin/loop/${core}`);
      assert.equal(fs.readFileSync(landed, "utf8"), fs.readFileSync(shipped, "utf8"),
        `laid-down ${core} must be byte-identical to the shipped copy`);
    }
    // The measure: `quay-init.sh --loop | grep -c tick-core` ≥ 3 (the three cores are in the derived set).
    const measure = runInit(ws, INIT_ARGS(ws));
    const hits = (measure.stdout.match(/tick-core/g) || []).length;
    assert.ok(hits >= 3, `the --loop output must mention tick-core at least 3 times (three cores in the derived set); got ${hits}`);
  } finally { cleanup(ws); }
});

// ── AC3: manager-tick-core is opt-in (--manager), not in the default --loop set ───────────────────────
test("AC3 — manager-tick-core.md is OPT-IN: absent in a default --loop, present with --manager", () => {
  // Default --loop: the manager core must NOT land.
  const wsDefault = makeTmp();
  try {
    const r = runInit(wsDefault, INIT_ARGS(wsDefault));
    assert.equal(r.status, 0, `default init must exit 0:\n${r.stderr}`);
    assert.ok(!fs.existsSync(path.join(wsDefault, "orchestration", "manager-tick-core.md")),
      "default --loop must NOT lay manager-tick-core.md (opt-in via --manager)");
    assert.match(r.stdout, /skip \(opt-in\): orchestration\/manager-tick-core\.md/,
      "the default install must report the manager core as opt-in");
  } finally { cleanup(wsDefault); }

  // --loop --manager: the manager core DOES land.
  const wsMgr = makeTmp();
  try {
    const r = runInit(wsMgr, [...INIT_ARGS(wsMgr), "--manager"]);
    assert.equal(r.status, 0, `--manager init must exit 0:\n${r.stderr}`);
    assert.ok(fs.existsSync(path.join(wsMgr, "orchestration", "manager-tick-core.md")),
      "--loop --manager must lay manager-tick-core.md");
    const landed = path.join(wsMgr, "orchestration", "manager-tick-core.md");
    const shipped = path.join(pluginDir, "loop", "manager-tick-core.md");
    assert.equal(fs.readFileSync(landed, "utf8"), fs.readFileSync(shipped, "utf8"),
      "laid-down manager-tick-core.md must be byte-identical to the shipped copy");
  } finally { cleanup(wsMgr); }
});

// ── AC4: referenced ⊆ landed covers the three cores (no new check) ───────────────────────────────────
test("AC4 — the referenced⊆landed gate validates the three cores: removing one shipped core FAILS the install (declaration removed, landing required)", () => {
  // The two default-loop cores are NO LONGER declared reference-doc in init/SKILL.md — so if the
  // laydown cannot land one, the install must FAIL (the gate now validates the LANDING, not a
  // declaration). This is the "自动生效" the task's prescription names (:1081, no new check).
  const src = makeTmp();
  try {
    fs.cpSync(pluginDir, src, { recursive: true });
    // A freshly cloned plugin has NO built vendor runtime; the test only needs the LAYDOWN + gate,
    // but ensure_vendor_runtime would fail-closed before the gate runs. Build-less is fine: we
    // delete the core from the PLUGIN source so the laydown cannot ship it, and assert the gate
    // names it. (The vendor-runtime fail-closed would mask this — so pre-copy the runtime if present.)
    const rtDir = path.join(pluginDir, "vendor", "quay", "dist");
    if (fs.existsSync(rtDir)) {
      fs.cpSync(rtDir, path.join(src, "vendor", "quay", "dist"), { recursive: true });
      fs.cpSync(path.join(pluginDir, "vendor", "quay-native", "dist"),
        path.join(src, "vendor", "quay-native", "dist"), { recursive: true });
    }
    fs.rmSync(path.join(src, "loop", "orchestrator-tick-core.md"), { force: true });
    fs.rmSync(path.join(src, "loop", "fast-mode-tick-core.md"), { force: true });
    const ws = makeTmp();
    try {
      const r = runInit(ws, INIT_ARGS(ws), src);
      assert.notEqual(r.status, 0, "--loop must FAIL when a referenced exec core cannot land");
      assert.match(r.stderr, /referenced-not-landed/, "must use the referenced-not-landed category");
      assert.match(r.stderr, /orchestrator-tick-core\.md/, "must name the missing exec core");
      assert.match(r.stderr, /fast-mode-tick-core\.md/, "must name the missing exec core");
    } finally { cleanup(ws); }
  } finally { cleanup(src); }
});

// ── AC5: --loop lays all three cores when opted in; manager core's own deps are gate-validated ───────
test("AC5 — --loop --manager lays all three cores (cold-start readable); quay-session.ts (the manager core's dep) ships", () => {
  const ws = makeTmp();
  try {
    const r = runInit(ws, [...INIT_ARGS(ws), "--manager"]);
    assert.equal(r.status, 0, `--manager init must exit 0:\n${r.stderr}`);
    assert.match(r.stdout, /verify-referenced-landed: OK/, "referenced ⊆ landed must pass with all three cores");
    for (const core of CORE_BASENAMES) {
      const landed = path.join(ws, "orchestration", core);
      assert.ok(fs.existsSync(landed), `all three cores must be readable in the target: orchestration/${core}`);
    }
    // quay-session.ts is referenced by manager-tick-core.md — it must ship (gate-validated dep).
    assert.ok(fs.existsSync(path.join(ws, "plugin", "scripts", "quay-session.ts")),
      "the manager core's referenced dep plugin/scripts/quay-session.ts must be laid down");
  } finally { cleanup(ws); }
});
