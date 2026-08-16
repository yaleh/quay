// @test-group governance
// red-on-omission-audit.test.mjs — 每条固化行为必须能指出「不做时哪个读数会变红」
// (tasks/gap-ac41-red-on-omission-artifact, AC41 判据 3)
//
// The defect (2026-08-10 活体实证): A15 裁定5（连续 3 轮 A15 心跳缺失 ⇒ .halt；再 3 轮 ⇒ /clear）在
// 80 行执行核里、每轮必读、阈值明确、计数器建好、catalog 已声明，**仍连续 9 轮未被执行**直到 manager
// 置 .halt。固化 + 引用 + tick 解决「记不住」，解决不了「没人执行」——「守」与「不守」在记录上不可区分。
// 判据: 每条固化行为必须能指出「不做时哪个读数会变红」；指不出的视为未固化。
//
// This file pins AC1-AC5:
//   AC1: reproduction — A15 裁定5 全就位仍 9 轮未执行的实证（registry a15_ruling5 行为即判据）
//   AC2: 逐条审计 — registry 每条有 behavior + redReading；audit 覆盖 C 段/A 段；三条 invariant 在册
//   AC3: 补产物 — 指不出的补「不做会变红」的产物；verify 是机械核对（非自证）
//   AC4: 审计可机械核 — covered/uncov 输出；缺失的列未固化；删声明 ⇒ uncov>0 ⇒ exit 1
//   AC5: 既有不回归 — 接线（tick core + manager-phase-goal 交叉标注）+ --for-task scoped 门绿
//
// Run:
//   scripts/test.sh plugin/test/red-on-omission-audit.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { REGISTRY, runAudit, buildAudit } from "../scripts/red-on-omission-audit.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const CLI = path.join(repoRoot, "plugin", "scripts", "red-on-omission-audit.ts");
const TICK = path.join(repoRoot, "orchestration", "orchestrator-tick-core.md");

const MANDATED_IDS = ["a15_ruling5", "scope_worktree_gate", "ruling5_status"];

function readTick() {
  return fs.readFileSync(TICK, "utf8");
}

// ── AC1: 复现固化 — A15 裁定5 全就位仍 9 轮未执行 ────────────────────────────────────────────────

test("AC1 — registry carries a15_ruling5 with the ruling-5 rule (3-round heartbeat gap ⇒ .halt; +3 ⇒ /clear)", () => {
  const e = REGISTRY.find((r) => r.id === "a15_ruling5");
  assert.ok(e, "a15_ruling5 must be in the registry");
  assert.match(e.behavior, /连续\s*3\s*轮/);
  assert.match(e.behavior, /\.halt/);
  assert.match(e.behavior, /\/clear/);
  assert.ok(e.redReading.length > 20, "a15_ruling5 must carry a concrete red reading");
});

test("AC1 — the audit documents the three effective interventions (.halt / ruling5_status / scope=worktree gate) as covered", () => {
  const audit = buildAudit(new Map(REGISTRY.map((r) => [r.id, r])));
  for (const id of MANDATED_IDS) {
    const row = audit.find((a) => a.id === id);
    assert.ok(row, `${id} must be in the audit list`);
    assert.ok(row.redReading, `${id} must have a red reading (covered, not 未固化)`);
  }
});

// ── AC2: 逐条审计 — 固化行为清单每条标「不做时变红的读数」 ──────────────────────────────────────

test("AC2 — every registry entry carries a non-empty behavior AND a non-empty redReading", () => {
  assert.ok(REGISTRY.length >= 10, `registry should be a meaningful audit surface, got ${REGISTRY.length}`);
  for (const r of REGISTRY) {
    assert.ok(r.behavior.trim().length > 10, `${r.id}: behavior must be descriptive`);
    assert.ok(r.redReading.trim().length > 10, `${r.id}: redReading must be concrete`);
    assert.ok(["invariant", "a-reading", "c-constraint", "b-production"].includes(r.kind), `${r.id}: valid kind`);
  }
});

test("AC2 — the audit list covers the C 段 hard-constraint ids and key A 段 reading ids", () => {
  const audit = buildAudit(new Map(REGISTRY.map((r) => [r.id, r])));
  const ids = new Set(audit.map((a) => a.id));
  for (const cid of ["C1", "C2", "C3", "C7", "C14"]) {
    assert.ok(ids.has(cid), `audit must cover C 段 constraint ${cid}`);
  }
  for (const aid of ["A1", "A6", "A13", "A14", "A15", "A16", "A17"]) {
    assert.ok(ids.has(aid), `audit must cover A 段 reading ${aid}`);
  }
});

test("AC2 — the audit HONESTLY lists not-yet-solidified rows as 未固化 (redReading null)", () => {
  const audit = buildAudit(new Map(REGISTRY.map((r) => [r.id, r])));
  const notSolidified = audit.filter((a) => a.redReading == null);
  // The C 段 discipline rows (C4/C5/C6/C8/C9/C10/C11/C12/C13/C15) have no mechanical red reading yet —
  // they must be listed 未固化, not silently claimed as solidified.
  assert.ok(notSolidified.some((a) => a.id === "C4"), "C4 (process counting discipline) must be listed 未固化");
  assert.ok(notSolidified.some((a) => a.id === "C15"), "C15 (isolated-rerun evidence) must be listed 未固化");
});

// ── AC3: 补产物 — verify 是机械核对（读 tracked 文件，不是自证为真的布尔） ────────────────────────

test("AC3 — a15_ruling5 verify is MECHANICAL: it FAILS against a tick-core copy without the ruling5_status declaration", () => {
  const entry = REGISTRY.find((r) => r.id === "a15_ruling5");
  assert.ok(entry);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roa-ac3-"));
  try {
    // A tick core WITHOUT the ruling5_status declaration (the state BEFORE this task's 补产物).
    const stripped = readTick().replace(/ruling5_status/g, "XXXX_status");
    const orch = path.join(tmp, "orchestration");
    fs.mkdirSync(orch, { recursive: true });
    fs.writeFileSync(path.join(orch, "orchestrator-tick-core.md"), stripped, "utf8");
    const res = entry.verify(tmp);
    assert.equal(res.ok, false, "without the ruling5_status declaration the red reading must NOT verify");
    assert.match(res.detail, /ruling5_status/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("AC3 — a15_ruling5 verify PASSES against the real tick core (the 补产物 is declared)", () => {
  const entry = REGISTRY.find((r) => r.id === "a15_ruling5");
  assert.ok(entry);
  const res = entry.verify(repoRoot);
  assert.equal(res.ok, true, `real tick core must declare the ruling-5 rule + ruling5_status:\n${res.detail}`);
});

test("AC3 — every verify function inspects the workspace, never returns a constant true (no 回显/自证)", () => {
  // A registry entry whose verify ignores the workspace and always returns true would be a 回显
  // (hard rule 4 — a quantity that structurally cannot be false is not a measurement). We pin that
  // every verify actually reads a tracked file and returns a FAIL on a root with no files.
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "roa-empty-"));
  try {
    let failing = 0;
    for (const r of REGISTRY) {
      const res = r.verify(empty);
      if (!res.ok) failing++;
    }
    // Every registry verify depends on tracked files under the root, so against an empty root ALL
    // must fail — none may be a constant-true self-assertion.
    assert.equal(failing, REGISTRY.length, "every verify must fail on an empty root (none is self-asserted true)");
  } finally {
    fs.rmSync(empty, { recursive: true, force: true });
  }
});

// ── AC4: 审计可机械核 — covered/uncov；缺失的列未固化；删声明 ⇒ exit 1 ──────────────────────────

test("AC4 — runAudit on the real repo: band satisfied (uncov=0) and all three invariants true", () => {
  const result = runAudit(repoRoot);
  assert.equal(result.measure.uncov, 0, `uncov must be 0 on the real repo:\n${JSON.stringify(result.uncov, null, 2)}`);
  assert.equal(result.measure.covered, REGISTRY.length, "all registry entries must be covered");
  assert.deepEqual(result.invariants, {
    a15_ruling5_has_red_reading: 1,
    scope_worktree_gate_covered: 1,
    ruling5_status_covered: 1,
  });
});

test("AC4 — removing the ruling5_status declaration from a tick-core copy makes a15_ruling5 + ruling5_status uncov (未固化)", () => {
  const entry = REGISTRY.find((r) => r.id === "a15_ruling5");
  const entry2 = REGISTRY.find((r) => r.id === "ruling5_status");
  assert.ok(entry && entry2);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roa-ac4-"));
  try {
    const stripped = readTick().replace(/ruling5_status/g, "XXXX_status");
    const orch = path.join(tmp, "orchestration");
    fs.mkdirSync(orch, { recursive: true });
    fs.writeFileSync(path.join(orch, "orchestrator-tick-core.md"), stripped, "utf8");
    assert.equal(entry.verify(tmp).ok, false);
    assert.equal(entry2.verify(tmp).ok, false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("AC4 CLI — real repo exits 0 with covered/uncov in stdout", () => {
  const r = spawnSync("node", ["--no-warnings", "--experimental-strip-types", CLI, "--root", repoRoot, "--json"], {
    encoding: "utf8",
  });
  assert.equal(r.status, 0, `real repo must exit 0:\n${r.stdout}\n${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.ok(typeof out.measure.covered === "number");
  assert.equal(out.measure.uncov, 0);
  assert.equal(out.invariants.a15_ruling5_has_red_reading, 1);
});

test("AC4 CLI — an empty root (no tick core) exits 1 (missing red readings ⇒ 未固化)", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roa-cli-"));
  try {
    const r = spawnSync("node", ["--no-warnings", "--experimental-strip-types", CLI, "--root", tmp, "--json"], {
      encoding: "utf8",
    });
    assert.equal(r.status, 1, `empty root must exit 1 (uncov>0):\n${r.stdout}\n${r.stderr}`);
    const out = JSON.parse(r.stdout);
    assert.ok(out.measure.uncov > 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── AC4 (C3 migrated-form controls, gap-ac76 item 7): the c3_resource_gate invariant follows the
//    C3→R32 clause migration — accepts the direct form OR (core pointer ∧ archive phrase), and
//    reddens when neither is present ──────────────────────────────────────────────────────────────

test("AC4 (C3 migrated) — the migrated form (core C3 正身已迁出 pointer + archive R32 phrase) verifies GREEN", () => {
  const entry = REGISTRY.find((r) => r.id === "c3_resource_gate");
  assert.ok(entry);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roa-c3mig-"));
  try {
    const orch = path.join(tmp, "orchestration");
    const scripts = path.join(tmp, "plugin", "scripts");
    fs.mkdirSync(orch, { recursive: true });
    fs.mkdirSync(scripts, { recursive: true });
    // resource-gate.sh exists (the script gate is live; only the outer C3 clause was migrated).
    fs.writeFileSync(path.join(scripts, "resource-gate.sh"), "#!/bin/sh\nexit 0\n");
    // The C3 clause in the core is now ONLY the migration pointer (the body lives in the archive).
    fs.writeFileSync(path.join(orch, "orchestrator-tick-core.md"),
      "| C3 | ~~**C3 正身已迁出**~~ → `orchestration/archive/AC58-retired-clauses.md#R32` (src:436) |\n");
    const archiveDir = path.join(tmp, "orchestration", "archive");
    fs.mkdirSync(archiveDir, { recursive: true });
    fs.writeFileSync(path.join(archiveDir, "AC58-retired-clauses.md"),
      "## R32 — outer B3 全量 suite 后台起跑退役\n... `resource-gate.sh --for full-suite` 放行 ...\n");
    const res = entry.verify(tmp);
    assert.equal(res.ok, true, `migrated form must verify:\n${res.detail}`);
    assert.match(res.detail, /migrated/, "detail must name the migrated form");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("AC4 (C3 migrated) NEGATIVE CONTROL — neither the direct phrase NOR the C3 pointer (and no archive phrase) ⇒ c3 uncov", () => {
  const entry = REGISTRY.find((r) => r.id === "c3_resource_gate");
  assert.ok(entry);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roa-c3neg-"));
  try {
    const orch = path.join(tmp, "orchestration");
    const scripts = path.join(tmp, "plugin", "scripts");
    fs.mkdirSync(orch, { recursive: true });
    fs.mkdirSync(scripts, { recursive: true });
    // resource-gate.sh exists — isolates the clause check (a missing script would fail for the wrong reason).
    fs.writeFileSync(path.join(scripts, "resource-gate.sh"), "#!/bin/sh\nexit 0\n");
    // The C3 line carries NEITHER the direct phrase NOR the migrated pointer.
    fs.writeFileSync(path.join(orch, "orchestrator-tick-core.md"),
      "# outer tick — 执行核\n| C3 | 资源闸约束（正文已迁出且无指针引用） (src:1) |\n");
    // The archive exists but does NOT carry the phrase.
    const archiveDir = path.join(tmp, "orchestration", "archive");
    fs.mkdirSync(archiveDir, { recursive: true });
    fs.writeFileSync(path.join(archiveDir, "AC58-retired-clauses.md"), "## R32\n（无 resource-gate 短语）\n");
    const res = entry.verify(tmp);
    assert.equal(res.ok, false, `neither form present must fail the c3 invariant:\n${res.detail}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── AC5: 接线 + 既有不回归 ────────────────────────────────────────────────────────────────────────

test("AC5 wiring — outer tick core carries the red-on-omission audit invocation + the ruling5_status declaration", () => {
  const t = readTick();
  assert.match(t, /red-on-omission-audit/, "tick core must invoke the red-on-omission audit each tick");
  assert.match(t, /ruling5_status/, "tick core must declare the ruling5_status self-report field");
  assert.match(t, /scope=worktree/, "tick core must reference the scope=worktree gate (A15 ④)");
});

test("AC5 wiring — manager-phase-goal carries the AC41 判据 3 red-on-omission cross-annotation", () => {
  const mgr = fs.readFileSync(path.join(repoRoot, "orchestration", "manager-phase-goal.md"), "utf8");
  assert.match(mgr, /gap-ac41-red-on-omission-artifact|red-on-omission/, "manager-phase-goal must cross-annotate this task");
});

test("AC5 wiring — the checker is declared in capability-catalog (mechanism-catalog admission)", () => {
  const cat = fs.readFileSync(path.join(repoRoot, "plugin", "scripts", "capability-catalog.sh"), "utf8");
  assert.match(cat, /red-on-omission-audit/, "capability-catalog must declare the red-on-omission audit");
});

test("AC5 wiring — the checker is wired into scripts/test.sh run_static_checks", () => {
  const sh = fs.readFileSync(path.join(repoRoot, "scripts", "test.sh"), "utf8");
  assert.match(sh, /red-on-omission-audit/, "test.sh must run the red-on-omission audit as a static checker");
});
