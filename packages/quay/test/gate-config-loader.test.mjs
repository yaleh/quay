// @test-group product
// gate-config-loader.test.mjs — direct unit tests of readGatesConfig's branch-A-terminal
// behavior (DIR-120 Phase 2), including the silent-data-loss scenario named in the task's
// own Proposal (problem-framing point 11 / AC item 5).
//
// Contract under test: readGatesConfig(workspaceRoot) → GatesConfig (never throws — fail-quiet).
//   Branch A (config.yml exists): returns its `gates:` value, or the empty six-key shape if
//     `gates:` is absent — and (DIR-120 Phase 2) NEVER falls through to a sibling
//     `.quay/gates.yml`, even if one exists with real content.
//   Branch B (no config.yml): unchanged — reads `.quay/gates.yml` if present, else empty shape.
//
// Run: node --test packages/quay/test/gate-config-loader.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { readGatesConfig, loadWorkspaceGateMetadata } from "../src/gate/config/loader.ts";
import { makeTmpDir } from "../../../plugin/test/helpers/tmp-workspace.mjs";

function tmpWs(tag) {
  const ws = makeTmpDir(`quay-gate-config-loader-${tag}-`);
  fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
  return ws;
}

const EMPTY_SHAPE = { it0: [], adr: [], fixed: [], testPass: [], coverageFloor: [], redGreen: [] };

/** Monkeypatch process.stderr.write around fn() to capture diagnostic output. */
function captureStderr(fn) {
  const chunks = [];
  const orig = process.stderr.write;
  process.stderr.write = (chunk, encoding, cb) => {
    chunks.push(typeof chunk === "string" ? chunk : chunk.toString());
    if (typeof cb === "function") cb();
    return true;
  };
  try {
    const result = fn();
    return { result, stderr: chunks.join("") };
  } finally {
    process.stderr.write = orig;
  }
}

// ---------------------------------------------------------------------------
// Branch A (config.yml present) — regression guard: the still-correct path
// ---------------------------------------------------------------------------

test("DIR-120 GREEN (regression guard): config.yml with a gates: section resolves from it", () => {
  const ws = tmpWs("branch-a-with-gates");
  fs.writeFileSync(
    path.join(ws, ".quay", "config.yml"),
    [
      "providers:",
      "  native:",
      "    enabled: true",
      "gates:",
      "  fixed:",
      "    - name: real-gate",
      "      script: \"./some-script.sh\"",
    ].join("\n")
  );
  const cfg = readGatesConfig(ws);
  assert.equal(cfg.fixed.length, 1);
  assert.equal(cfg.fixed[0].name, "real-gate");
});

// ---------------------------------------------------------------------------
// DIR-120 Phase 2: the silent-data-loss test (AC item 5 / problem-framing
// point 11) — config.yml exists, no gates: key, sibling gates.yml has REAL
// content. Post-Phase-2, this must return the empty shape, NOT the legacy
// file's real content (branch A is terminal — never falls through).
// ---------------------------------------------------------------------------

test("DIR-120 Phase 2 RED: config.yml present with NO gates: key, real-content sibling gates.yml present -> returns EMPTY shape, not legacy content (branch A terminal, silent data loss by design)", () => {
  const ws = tmpWs("branch-a-no-gates-key-legacy-present");
  // config.yml exists but has no gates: key at all (providers only).
  fs.writeFileSync(
    path.join(ws, ".quay", "config.yml"),
    "providers:\n  native:\n    enabled: true\n"
  );
  // Sibling legacy gates.yml with REAL content.
  fs.writeFileSync(
    path.join(ws, ".quay", "gates.yml"),
    [
      "fixed:",
      "  - name: legacy-gate",
      "    script: \"./legacy-script.sh\"",
    ].join("\n")
  );
  const cfg = readGatesConfig(ws);
  // DIR-104: the loader records srcFile provenance on any resolved file; the
  // empty CONTENT shape is what branch-A-terminal asserts.
  assert.deepEqual(
    {
      it0: cfg.it0, adr: cfg.adr, fixed: cfg.fixed,
      testPass: cfg.testPass, coverageFloor: cfg.coverageFloor, redGreen: cfg.redGreen,
    },
    EMPTY_SHAPE,
    "DIR-120 Phase 2: once config.yml exists, branch A is terminal — a real-content sibling gates.yml must NOT be silently used as a fallback"
  );
  assert.equal(cfg.srcFile, path.join(ws, ".quay", "config.yml"), "srcFile provenance (DIR-104)");
});

// ---------------------------------------------------------------------------
// Branch B (no config.yml) — unchanged, still reads legacy gates.yml
// ---------------------------------------------------------------------------

test("GREEN (branch B unchanged): no config.yml at all, real gates.yml present -> reads legacy content", () => {
  const ws = tmpWs("branch-b-legacy-only");
  fs.writeFileSync(
    path.join(ws, ".quay", "gates.yml"),
    [
      "fixed:",
      "  - name: legacy-only-gate",
      "    script: \"./legacy-only.sh\"",
    ].join("\n")
  );
  const cfg = readGatesConfig(ws);
  assert.equal(cfg.fixed.length, 1);
  assert.equal(cfg.fixed[0].name, "legacy-only-gate");
});

test("GREEN (branch B unchanged): no config.yml, no gates.yml -> empty shape", () => {
  const ws = tmpWs("branch-b-nothing");
  const cfg = readGatesConfig(ws);
  assert.deepEqual(cfg, EMPTY_SHAPE);
});

test("GREEN (branch B unchanged): malformed legacy gates.yml -> empty shape, no throw (fail-quiet)", () => {
  const ws = tmpWs("branch-b-malformed");
  fs.writeFileSync(path.join(ws, ".quay", "gates.yml"), "fixed: [unclosed\n  - bad: {");
  const cfg = readGatesConfig(ws);
  assert.deepEqual(
    {
      it0: cfg.it0, adr: cfg.adr, fixed: cfg.fixed,
      testPass: cfg.testPass, coverageFloor: cfg.coverageFloor, redGreen: cfg.redGreen,
    },
    EMPTY_SHAPE,
    "malformed -> empty content shape"
  );
  assert.equal(cfg.srcFile, path.join(ws, ".quay", "gates.yml"), "srcFile recorded on resolved file (DIR-104)");
});

test("GREEN: config.yml present with an EMPTY gates: section -> empty shape (not an error)", () => {
  const ws = tmpWs("branch-a-empty-gates-key");
  fs.writeFileSync(
    path.join(ws, ".quay", "config.yml"),
    "providers:\n  native:\n    enabled: true\ngates: {}\n"
  );
  const cfg = readGatesConfig(ws);
  assert.deepEqual(
    {
      it0: cfg.it0, adr: cfg.adr, fixed: cfg.fixed,
      testPass: cfg.testPass, coverageFloor: cfg.coverageFloor, redGreen: cfg.redGreen,
    },
    EMPTY_SHAPE,
    "empty gates: section -> empty content shape"
  );
  assert.equal(cfg.srcFile, path.join(ws, ".quay", "config.yml"), "srcFile provenance (DIR-104)");
});

test("GREEN: no workspaceRoot -> empty shape (existing guard, unchanged)", () => {
  assert.deepEqual(readGatesConfig(""), EMPTY_SHAPE);
});

// ---------------------------------------------------------------------------
// cand-gate-loader-unified-config-no-gates-spurious-diagnostics — a unified
// config.yml WITHOUT a `gates:` section is a legal configuration (built-in
// gates only) and must NOT be mistaken for a legacy top-level gates map, which
// would fabricate phantom "unrecognized gate section 'providers'/'loop'"
// diagnostics through the fail-loud scan.
// ---------------------------------------------------------------------------

test("GREEN (unified config, no gates:): config.yml with only providers/loop emits NO 'unrecognized gate section' diagnostics (phantom-diagnostic regression)", () => {
  const ws = tmpWs("no-gates-phantom");
  fs.writeFileSync(
    path.join(ws, ".quay", "config.yml"),
    "providers:\n  native:\n    enabled: true\nloop:\n  milestones: []\n"
  );
  const { result: meta, stderr } = captureStderr(() => loadWorkspaceGateMetadata(ws));
  assert.equal(stderr, "", `no-gates config.yml must emit zero diagnostics, got: ${stderr}`);
  assert.equal(meta.diagnostics.length, 0, "diagnostics array must be empty");
  assert.equal(Object.keys(meta.gates).length, 0, "no workspace gates for a no-gates config.yml");
});

test("GREEN (unified config, no gates:): readGatesConfig returns empty shape with srcFile provenance, zero diagnostics", () => {
  const ws = tmpWs("no-gates-read");
  fs.writeFileSync(
    path.join(ws, ".quay", "config.yml"),
    "providers:\n  native:\n    enabled: true\n"
  );
  const { result: cfg, stderr } = captureStderr(() => readGatesConfig(ws));
  assert.equal(stderr, "", `readGatesConfig must emit zero diagnostics, got: ${stderr}`);
  assert.deepEqual(
    {
      it0: cfg.it0, adr: cfg.adr, fixed: cfg.fixed,
      testPass: cfg.testPass, coverageFloor: cfg.coverageFloor, redGreen: cfg.redGreen,
    },
    EMPTY_SHAPE,
    "no-gates config.yml -> empty content shape"
  );
  assert.equal(cfg.srcFile, path.join(ws, ".quay", "config.yml"), "srcFile provenance (DIR-104)");
});

test("GREEN (regression guard): config.yml WITH a gates: section + unknown key STILL fires fail-loud (intended behavior preserved)", () => {
  const ws = tmpWs("with-gates-fail-loud");
  fs.writeFileSync(
    path.join(ws, ".quay", "config.yml"),
    "providers:\n  native:\n    enabled: true\ngates:\n  unknown_section:\n    - name: x\n      command: y\n"
  );
  const { stderr } = captureStderr(() => loadWorkspaceGateMetadata(ws));
  assert.ok(stderr.includes("unrecognized gate section 'unknown_section'"),
    `fail-loud must still fire for unknown keys INSIDE a gates: section, got: ${stderr}`);
});

test("GREEN (regression guard): legacy gates.yml top-level-as-gates-map still fires fail-loud for unknown keys (unchanged)", () => {
  const ws = tmpWs("legacy-fail-loud");
  fs.writeFileSync(
    path.join(ws, ".quay", "gates.yml"),
    "fixed:\n  - name: legacy-gate\n    script: \"./legacy.sh\"\nunknown_section:\n  - name: x\n    command: y\n"
  );
  const { result: meta, stderr } = captureStderr(() => loadWorkspaceGateMetadata(ws));
  assert.ok(stderr.includes("unrecognized gate section 'unknown_section'"),
    `legacy gates.yml top-level-as-map must still fail loud, got: ${stderr}`);
  assert.ok(meta.gates["legacy-gate"], "legacy fixed gate must still be registered");
});
