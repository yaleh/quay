// @test-group engine
// judgment-consumer-check.test.mjs — 每个机械判据必须有消费它的动作（判据→消费动作映射审计）
// (tasks/gap-judgment-computed-not-wired-to-action, AC2 类级纪律 / AC3 系统审计)
//
// The defect family (2026-08-10 三次同形态): 判据被机械算出来了, 但没有接到任何「会因它而动」的那一步——
//   「判据算出来了」≠「会因它而动」.
//   1. 18:4x slot-refill 不查 excluded 的 not-yet-flipped（已修, gap-slot-refill-repeats-done-eligible-recommendations）
//   2. 21:4x 候选被 C8 拒后不回填（已修, gap-slot-refill-c8-reject-no-backfill）
//   3. 22:0x deficit 每轮算出无触发器读（已修 B9 第三触发器接 --apply）
// 每多一个算出来没人消费的判据, 就多一个「看它一眼算检查过」的假仪器.
//
// This file pins AC1-AC5:
//   AC1: reproduction — 三实例在 registry 里带消费动作（18:4x not-yet-flipped / 21:4x self-touch /
//        22:0x deficit）
//   AC2: 判据→消费动作映射 — registry 每条有 judgment + consumer；audit 覆盖三实例 + 候选判据
//   AC3: 机械核对 — verify 读 tracked 文件（非自证），删声明 ⇒ unfinished>0 ⇒ exit 1
//   AC4: 审计可机械核 — covered/unfinished 输出；未完成判据列 finished:false；删接线 ⇒ exit 1
//   AC5: 接线 + 既有不回归 — tick-core A19 类级纪律 + capability-catalog 声明 + test.sh 接入 +
//        --for-task scoped 门绿
//
// Run:
//   scripts/test.sh plugin/test/judgment-consumer-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { JUDGMENT_REGISTRY, runAudit } from "../scripts/judgment-consumer-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const CLI = path.join(repoRoot, "plugin", "scripts", "judgment-consumer-check.ts");
const TICK = path.join(repoRoot, "orchestration", "orchestrator-tick-core.md");

const MANDATED_IDS = ["not_yet_flipped", "self_touch_scan", "deficit"];

function readTick() {
  return fs.readFileSync(TICK, "utf8");
}

// ── AC1: 复现固化 — 三实例在 registry 里带消费动作 ──────────────────────────────────────────────

test("AC1 — registry carries the three 2026-08-10 instances (not_yet_flipped / self_touch_scan / deficit) with consumers", () => {
  for (const id of MANDATED_IDS) {
    const e = JUDGMENT_REGISTRY.find((r) => r.id === id);
    assert.ok(e, `${id} must be in the registry`);
    assert.ok(e.kind === "invariant", `${id} must be an invariant (one of the three instances)`);
    assert.ok(e.consumer.trim().length > 10, `${id}: consumer must be descriptive`);
  }
});

test("AC1 — the audit documents the three instances' consumers (wired, finished)", () => {
  const result = runAudit(repoRoot);
  for (const id of MANDATED_IDS) {
    const row = result.audit.find((a) => a.id === id);
    assert.ok(row, `${id} must be in the audit list`);
    assert.ok(row.finished, `${id} must be finished (consumer wired) on the real repo`);
    assert.ok(row.consumer.trim().length > 10, `${id}: consumer must be concrete`);
  }
});

// ── AC2: 判据→消费动作映射 — 每条判据有 judgment + consumer ───────────────────────────────────

test("AC2 — every registry entry carries a non-empty judgment AND a non-empty consumer", () => {
  assert.ok(JUDGMENT_REGISTRY.length >= 6, `registry should cover the known judgments, got ${JUDGMENT_REGISTRY.length}`);
  for (const r of JUDGMENT_REGISTRY) {
    assert.ok(r.judgment.trim().length > 10, `${r.id}: judgment must be descriptive`);
    assert.ok(r.consumer.trim().length > 10, `${r.id}: consumer must be concrete`);
    assert.ok(["invariant", "judgment"].includes(r.kind), `${r.id}: valid kind`);
  }
});

test("AC2 — the audit covers the three instances AND the candidate judgments (dispatchable_disjoint / obligation_ledger / closure_lag)", () => {
  const result = runAudit(repoRoot);
  const ids = new Set(result.audit.map((a) => a.id));
  for (const id of [...MANDATED_IDS, "dispatchable_disjoint", "obligation_ledger", "closure_lag"]) {
    assert.ok(ids.has(id), `audit must cover judgment ${id}`);
  }
});

// ── AC3: 机械核对 — verify 读 tracked 文件（非自证）────────────────────────────────────────────

test("AC3 — every verify function inspects the workspace, never returns a constant true (no 回显/自证)", () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "jcc-empty-"));
  try {
    let failing = 0;
    for (const r of JUDGMENT_REGISTRY) {
      const res = r.verify(empty);
      if (!res.ok) failing++;
    }
    // Every registry verify depends on tracked files under the root, so against an empty root ALL
    // must fail — none may be a constant-true self-assertion.
    assert.equal(failing, JUDGMENT_REGISTRY.length, "every verify must fail on an empty root (none is self-asserted true)");
  } finally {
    fs.rmSync(empty, { recursive: true, force: true });
  }
});

test("AC3 — the deficit verify FAILS against a tick-core copy without the --apply wiring (the 22:0x shape)", () => {
  const entry = JUDGMENT_REGISTRY.find((r) => r.id === "deficit");
  assert.ok(entry);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jcc-ac3-"));
  try {
    const stripped = readTick().replace(/ready-pool-check\.ts --apply/g, "ready-pool-check.ts");
    const orch = path.join(tmp, "orchestration");
    fs.mkdirSync(orch, { recursive: true });
    fs.writeFileSync(path.join(orch, "orchestrator-tick-core.md"), stripped, "utf8");
    const res = entry.verify(tmp);
    assert.equal(res.ok, false, "without the --apply wiring the deficit consumer must NOT verify");
    assert.match(res.detail, /--apply/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("AC3 — the deficit verify PASSES against the real tick core (the B9 third-trigger wiring is declared)", () => {
  const entry = JUDGMENT_REGISTRY.find((r) => r.id === "deficit");
  assert.ok(entry);
  const res = entry.verify(repoRoot);
  assert.equal(res.ok, true, `real tick core must declare the deficit→--apply wiring:\n${res.detail}`);
});

// ── AC4: 审计可机械核 — covered/unfinished；未完成列 finished:false；删接线 ⇒ exit 1 ─────────────

test("AC4 — runAudit on the real repo: band satisfied (unfinished=0) and both invariants true", () => {
  const result = runAudit(repoRoot);
  assert.equal(result.measure.unfinished, 0, `unfinished must be 0 on the real repo:\n${JSON.stringify(result.unfinished, null, 2)}`);
  assert.equal(result.measure.covered, JUDGMENT_REGISTRY.length, "all registry entries must be covered");
  assert.deepEqual(result.invariants, {
    each_judgment_has_consumer: 1,
    no_consumer_listed_unfinished: 1,
  });
});

test("AC4 — removing the deficit --apply wiring from a tick-core copy makes deficit unfinished (finished:false)", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jcc-ac4-"));
  try {
    const stripped = readTick().replace(/ready-pool-check\.ts --apply/g, "ready-pool-check.ts");
    const orch = path.join(tmp, "orchestration");
    fs.mkdirSync(orch, { recursive: true });
    fs.writeFileSync(path.join(orch, "orchestrator-tick-core.md"), stripped, "utf8");
    // Copy the other tracked files the registry verifies against (slot-refill.ts / touches / test.sh).
    for (const rel of ["plugin/scripts/slot-refill.ts", "plugin/scripts/touches-orthogonality-check.ts", "plugin/scripts/obligation-ledger-check.ts", "scripts/test.sh"]) {
      const abs = path.join(repoRoot, rel);
      const dest = path.join(tmp, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, fs.readFileSync(abs, "utf8"));
    }
    const result = runAudit(tmp);
    const deficitRow = result.audit.find((a) => a.id === "deficit");
    assert.ok(deficitRow, "deficit must be in the audit");
    assert.equal(deficitRow.finished, false, "deficit must be listed unfinished (finished:false)");
    assert.equal(result.measure.unfinished, 1, "unfinished must be 1 (the deficit wiring was removed)");
    assert.equal(result.invariants.each_judgment_has_consumer, 0, "each_judgment_has_consumer must flip to 0");
    assert.equal(result.invariants.no_consumer_listed_unfinished, 1, "the unfinished judgment must be honestly listed");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("AC4 CLI — real repo exits 0 with covered/unfinished in stdout", () => {
  const r = spawnSync("node", ["--no-warnings", "--experimental-strip-types", CLI, "--root", repoRoot, "--json"], {
    encoding: "utf8",
  });
  assert.equal(r.status, 0, `real repo must exit 0:\n${r.stdout}\n${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.ok(typeof out.measure.covered === "number");
  assert.equal(out.measure.unfinished, 0);
  assert.equal(out.invariants.each_judgment_has_consumer, 1);
  assert.equal(out.invariants.no_consumer_listed_unfinished, 1);
});

test("AC4 CLI — an empty root (no tracked files) exits 1 (missing consumer wirings ⇒ 未完成)", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jcc-cli-"));
  try {
    const r = spawnSync("node", ["--no-warnings", "--experimental-strip-types", CLI, "--root", tmp, "--json"], {
      encoding: "utf8",
    });
    assert.equal(r.status, 1, `empty root must exit 1 (unfinished>0):\n${r.stdout}\n${r.stderr}`);
    const out = JSON.parse(r.stdout);
    assert.ok(out.measure.unfinished > 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── AC5: 接线 + 既有不回归 ──────────────────────────────────────────────────────────────────────

test("AC5 wiring — outer tick core carries the A19 class discipline (消费/consumer) + the checker invocation", () => {
  const t = readTick();
  assert.match(t, /judgment-consumer-check/, "tick core must reference the judgment-consumer checker (A19)");
  assert.match(t, /消费/, "tick core must carry the 类级纪律 (消费) clause");
  assert.match(t, /--apply/, "tick core must still carry the B9 deficit→--apply wiring");
});

test("AC5 wiring — the checker is declared in capability-catalog (mechanism-catalog admission + consumer measure)", () => {
  const cat = fs.readFileSync(path.join(repoRoot, "plugin", "scripts", "capability-catalog.sh"), "utf8");
  assert.match(cat, /judgment-consumer-check/, "capability-catalog must declare the judgment-consumer check");
  assert.match(cat, /consumer/, "capability-catalog declaration must carry the consumer measure surface");
});

test("AC5 wiring — the checker is wired into scripts/test.sh run_static_checks", () => {
  const sh = fs.readFileSync(path.join(repoRoot, "scripts", "test.sh"), "utf8");
  assert.match(sh, /judgment-consumer-check/, "test.sh must run the judgment-consumer check as a static checker");
});
