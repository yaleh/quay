// @test-group governance
// loop-driver-check.test.mjs —
// gap-the-loop-driver-check-reads-a-self-declared-registry-nobody-writes.
// loop-driver-check.sh counts LINES in the SELF-DECLARED registry
// .quay/loop-driver.jsonl — it does not observe any real driver. The tick doc
// step 4 now instructs writing that registry (byte-identical payload with the
// cold-start skill) so a verbatim cold start reaches LIVE.
//
// Tests:
//   AC1 (doc parity) — the tick doc step 4 records the driver with the SAME
//                      JSON payload as the cold-start skill (逐字同源).
//   AC1 (live)       — one cron registry line → LIVE, exit 0.
//   AC4 (neg ctrl)   — two lines → DOUBLE-TRIGGER, exit 4.
//   AC3 (HONEST limit) — a STALE single line (no real driver exists) is
//                      INDISTINGUISHABLE from a live one → still reports LIVE.
//                      This is the structural limit of a self-declared registry;
//                      recorded as NOT solved by L1, transferred to L2. We do NOT
//                      fake a pass: the test pins the true current behavior.
//   AC5 (doc)        — the tick doc STALLED remedy checks the registry BEFORE
//                      re-creating the cron (no more double-trigger machine).
//   AC7 (doc)        — the no-.halt print is 未暂停, not 运行中 (a control-plane
//                      read, not a state assertion).
//   AC2 (gitignore)  — the registry is gitignored with a rule same-shaped as
//                      gate-events.jsonl.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const PLUGIN_DIR = path.join(REPO_ROOT, "plugin");
const TICK_DOC = path.join(PLUGIN_DIR, "loop", "orchestrator-loop-tick.md");
const SKILL_DOC = path.join(PLUGIN_DIR, "skills", "cold-start", "SKILL.md");
const CHECK_SCRIPT = path.join(PLUGIN_DIR, "scripts", "loop-driver-check.sh");

// The registry line payload — the exact string both docs must carry (逐字同源).
const REG_PAYLOAD = '{"mechanism":"cron","interval":"*/20 * * * *","source":"cold-start"}';

function tmpWs() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ldc-check-"));
}

function writeRegistry(dir, count = 1) {
  fs.mkdirSync(path.join(dir, ".quay"), { recursive: true });
  for (let i = 0; i < count; i++) {
    fs.appendFileSync(path.join(dir, ".quay", "loop-driver.jsonl"), REG_PAYLOAD + "\n", "utf8");
  }
}

function runCheck(dir) {
  return spawnSync("bash", [CHECK_SCRIPT, dir], { cwd: dir, encoding: "utf8" });
}

// ── AC1 (doc parity): the tick doc step 4 writes the registry, same payload ────────────────────────
test('AC1 (doc parity) — tick doc step 4 records the driver with the same payload as the cold-start skill (逐字同源)', () => {
  const tick = fs.readFileSync(TICK_DOC, "utf8");
  const skill = fs.readFileSync(SKILL_DOC, "utf8");
  assert.ok(tick.includes("loop-driver.jsonl"), "the tick doc must name the registry (band doc_registers >= 1)");
  assert.match(tick, /printf '%s\\n' '.*loop-driver\.jsonl/, "the tick doc step 4 must contain the registry-write line");
  assert.ok(tick.includes(REG_PAYLOAD), "the tick doc's registry payload must be the sanctioned one");
  assert.ok(skill.includes(REG_PAYLOAD), "the cold-start skill's registry payload must be the sanctioned one");
  assert.ok(skill.includes("loop-driver.jsonl"), "the cold-start skill names the registry");
});

// ── AC1 (live): one cron line → LIVE, exit 0 ───────────────────────────────────────────────────────
test('AC1 (live) — one cron registry line reports LIVE, exit 0', () => {
  const ws = tmpWs();
  try {
    writeRegistry(ws, 1);
    const c = runCheck(ws);
    assert.equal(c.status, 0, `one cron driver must be LIVE (exit 0), got ${c.status}: ${c.stdout}`);
    assert.match(c.stdout, /LIVE/, "must print LIVE");
    assert.match(c.stdout, /\(1\)/, "must print the count 1");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

// ── AC4 (negative control): two lines → DOUBLE-TRIGGER, exit 4 ────────────────────────────────────
test('AC4 (negative control) — two registry lines still report DOUBLE-TRIGGER, exit 4', () => {
  const ws = tmpWs();
  try {
    writeRegistry(ws, 2);
    const c = runCheck(ws);
    assert.equal(c.status, 4, `two drivers must be DOUBLE-TRIGGER (exit 4), got ${c.status}: ${c.stdout}`);
    assert.match(c.stdout, /DOUBLE-TRIGGER/, "must report DOUBLE-TRIGGER");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

// ── AC3 (honest limitation, NOT solved by L1) ─────────────────────────────────────────────────────
test('AC3 (honest limitation) — a stale single entry is indistinguishable from a live one: still reports LIVE (NOT solved by L1)', () => {
  const ws = tmpWs();
  try {
    // "registry has one line, but that driver is long gone" — the previous
    // session's cron is dead, yet the self-declared registry still has its line.
    writeRegistry(ws, 1);
    const c = runCheck(ws);
    // The checker can only count lines. It CANNOT distinguish a dead cron from a
    // live one — the registry carries no session identity or liveness probe. A
    // zero-driver repo with a stale line is therefore reported LIVE (false
    // positive), which is exactly the structural limit recorded in the task body
    // (AC3 not solved in L1; transferred to L2). We pin the TRUE behavior rather
    // than fake a pass.
    assert.equal(c.status, 0, "self-declared registry cannot detect staleness — reports LIVE (exit 0) by design");
    assert.match(c.stdout, /LIVE/, "the checker reads only the registry, not the real driver");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

// ── AC5 (doc): STALLED remedy checks the registry before re-creating the cron ─────────────────────
test('AC5 (doc) — the STALLED remedy checks the registry was written before re-creating the cron', () => {
  const tick = fs.readFileSync(TICK_DOC, "utf8");
  const stallSection = tick.slice(tick.indexOf("确认恰好一个触发源"));
  assert.ok(stallSection.includes("STALLED"), "must address the STALLED case");
  assert.match(stallSection, /先查注册表是否写过，再谈重建 cron/, "must gate the rebuild behind the registry check in the phrasing itself");
  assert.match(stallSection, /注册表写过吗/, "must tell the operator to check whether the registry was written");
  // The double-trigger machine is gone: re-creating the cron must be the
  // LAST-resort step (step 3), AFTER checking the registry (step 1) and after
  // distinguishing "never wrote it" (step 2) — never the unconditional first action.
  const checkIdx = stallSection.indexOf("注册表写过吗");
  const rebuildIdx = stallSection.indexOf("这时才回步骤 4 重建 cron");
  assert.ok(checkIdx !== -1 && rebuildIdx !== -1, "both the registry check and the gated rebuild must be present");
  assert.ok(rebuildIdx > checkIdx, "the registry check must precede the (gated) rebuild");
});

// ── AC7 (doc): no-.halt print is 未暂停, not 运行中 ────────────────────────────────────────────────
test('AC7 (doc) — the no-.halt print is 未暂停 (control-plane), not 运行中 (state assertion)', () => {
  const tick = fs.readFileSync(TICK_DOC, "utf8");
  assert.ok(tick.includes("未暂停"), "the no-.halt branch must print 未暂停");
  assert.ok(!tick.includes('echo 运行中'), "the no-.halt branch must NOT print 运行中 (a control-plane absence read as a state assertion)");
  assert.ok(!/echo "运行中"|echo 运行中/.test(tick), "no residual 运行中 status-print in the tick doc");
});

// ── AC2 (gitignore): registry is gitignored same-shaped as gate-events.jsonl ──────────────────────
test('AC2 (gitignore) — .quay/loop-driver.jsonl is ignored by a rule same-shaped as gate-events.jsonl', () => {
  const r = spawnSync("git", ["check-ignore", "-v", ".quay/loop-driver.jsonl"], { cwd: REPO_ROOT, encoding: "utf8" });
  assert.equal(r.status, 0, `git check-ignore must exit 0 (ignored), got ${r.status}: ${r.stderr}`);
  assert.match(r.stdout, /loop-driver\.jsonl/, "must name the loop-driver.jsonl rule");
  const g = spawnSync("git", ["check-ignore", "-v", ".quay/gate-events.jsonl"], { cwd: REPO_ROOT, encoding: "utf8" });
  assert.equal(g.status, 0, "gate-events.jsonl must also be ignored (same-shape control)");
  const driverRule = r.stdout.split("\t")[0];
  const gateRule = g.stdout.split("\t")[0];
  assert.match(driverRule, /\*\*\/\.quay\/loop-driver\.jsonl/, "the driver rule must be **/.quay/loop-driver.jsonl");
  assert.match(gateRule, /\*\*\/\.quay\/gate-events\.jsonl/, "the gate rule must be **/.quay/gate-events.jsonl (same shape)");
});
