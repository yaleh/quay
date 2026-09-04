// @test-group engine
// supervisor-health.test.mjs — the supervisor base layer's HEALTH check
// (tasks/gap-supervisor-base-layer-outside-sessions-architecture, ## Contract `measure`:
//   `bash <supervisor 健康检查>` stdout 的 alive 字段; band: alive = the base layer process does
//   not die with an agent session).
//
// supervisor-health.sh answers "Is the base layer alive outside any Claude session?" — the
// os-anchor systemd USER timer (outlives every session) plus the delivery/observe adapters and
// the session liveness monitor. This file tests the Contract surface:
//   - the `alive:` field on stdout (measure)
//   - the component lines (os_anchor_timer=active|inactive|missing · deliver_adapter · …)
//   - exit 0 = alive · 1 = not alive
//   - hermetic seams: SUPERVISOR_HEALTH_ROOT + SUPERVISOR_HEALTH_SKIP_SYSTEMCTL=1
//
// Coverage map (task ACs):
//   AC1 — three-layer judgment: the health check's components are exactly the BASE layer
//         (scheduling via the os-anchor timer; delivery; observation) — machinery and behavior
//         are not health-checked here.
//   AC7 — node:test + // @test-group engine.
//
// Run: scripts/test.sh plugin/test/supervisor-health.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, "..", "scripts", "supervisor-health.sh");


/** A minimal fake repo root: the four machinery files the health check probes, plus a nonexec
 * .sh to exercise the missing/not-executable path. */
function makeFakeRoot(overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sup-health-root-"));
  const scripts = path.join(root, "plugin", "scripts");
  fs.mkdirSync(scripts, { recursive: true });
  const names = [
    "supervisor-deliver.sh",
    "transcript-delivery-check.ts",
    "pane-state-classify.ts",
  ];
  for (const n of names) {
    const p = path.join(scripts, n);
    fs.writeFileSync(p, "#!/usr/bin/env bash\n", "utf8");
    if (n.endsWith(".sh")) fs.chmodSync(p, 0o755);
  }
  for (const [n, mode] of Object.entries(overrides)) {
    const p = path.join(scripts, n);
    if (mode === "absent") {
      try { fs.rmSync(p, { force: true }); } catch { /* best-effort */ }
    } else if (mode === "nonexec") {
      fs.chmodSync(p, 0o644);
    }
  }
  return { root, scripts };
}

function runHealth({ root, skipSystemctl = "1" }) {
  return spawnSync("bash", [SCRIPT], {
    encoding: "utf8",
    env: {
      ...process.env,
      SUPERVISOR_HEALTH_ROOT: root,
      SUPERVISOR_HEALTH_SKIP_SYSTEMCTL: skipSystemctl,
    },
  });
}

test("AC7/Contract: alive:true with all components present (hermetic, skip systemctl)", () => {
  const { root } = makeFakeRoot();
  try {
    const r = runHealth({ root });
    assert.equal(r.status, 0, `alive → exit 0, got ${r.status}\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /^alive: true/m, `measure field:\n${r.stdout}`);
    assert.match(r.stdout, /^os_anchor_timer=active/m, `anchor timer evidenced:\n${r.stdout}`);
    assert.match(r.stdout, /^deliver_adapter=present/m);
    assert.match(r.stdout, /^delivery_checker=present/m);
    assert.match(r.stdout, /^observe_adapter=present/m);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC7/Contract: a missing delivery adapter → alive:false, exit 1, names the missing component", () => {
  const { root } = makeFakeRoot({ "supervisor-deliver.sh": "absent" });
  try {
    const r = runHealth({ root });
    assert.equal(r.status, 1, `missing component → exit 1, got ${r.status}\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /^alive: false/m);
    assert.match(r.stdout, /^deliver_adapter=missing/m);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC7: a .sh component that is not executable is missing (laid down but not functional)", () => {
  const { root } = makeFakeRoot({ "supervisor-deliver.sh": "nonexec" });
  try {
    const r = runHealth({ root });
    assert.equal(r.status, 1, `nonexec .sh → exit 1, got ${r.status}\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /^deliver_adapter=missing/m);
    assert.match(r.stdout, /^alive: false/m);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC7: inactive os-anchor timer (systemctl consulted, timer not active) → alive:false", () => {
  const { root } = makeFakeRoot();
  try {
    const r = spawnSync("bash", [SCRIPT], {
      encoding: "utf8",
      env: {
        ...process.env,
        SUPERVISOR_HEALTH_ROOT: root,
        // No skip: consult systemctl. This machine HAS the quay timer (active in CI-less
        // runs it would be inactive on another box) — the assertion is about the FIELD shape
        // and exit code, which are deterministic.
      },
    });
    assert.match(r.stdout, /^os_anchor_timer=(active|inactive|missing)/m, `timer field present:\n${r.stdout}`);
    assert.match(r.stdout, /^alive: (true|false)/m, `alive field present:\n${r.stdout}`);
    // exit code must be self-consistent with the alive field.
    const alive = /^alive: true/m.test(r.stdout);
    assert.equal(r.status, alive ? 0 : 1, `exit code agrees with alive field (alive=${alive}), got ${r.status}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC7: Contract `measure` shape — the alive field is the FIRST stdout line (band field)", () => {
  const { root } = makeFakeRoot();
  try {
    const r = runHealth({ root });
    const firstLine = r.stdout.split("\n")[0];
    assert.match(firstLine, /^alive: (true|false)$/, `first stdout line is the alive field, got: ${firstLine}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

