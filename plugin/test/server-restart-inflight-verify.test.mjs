// @test-group engine
// GOAL-017 / AC-256 — the PRODUCER's judgment, exercised through its REAL functions.
//
// WHAT THIS FILE DEFENDS. `plugin/scripts/server-restart-inflight-verify.ts` writes AC-256's carrier.
// A producer that can be satisfied by a fixture proves the record CAN be produced, never that one HAS
// been (硬规则 4 推论三) — the production-run evidence for that lives in the task file, not here.
// What belongs HERE is the other half: **can this producer produce a NON-qualifying record?** Every
// branch below is a way the record could be emitted while observing nothing:
//
//   (a) 空集        the in-flight set was EMPTY            ⇒ «not one of them died» is vacuous
//   (b) 空转 before 已死/僵尸  a dead pid in the before set ⇒ the same vacuity, one level down — and
//                                                            the criterion CANNOT see it, only this can
//   (c) 假重启      driver_pid_before == driver_pid_after  ⇒ nothing was restarted
//   (d) 旧驱动还在  the old driver pid is still alive      ⇒ the pid file moved, the process did not
//   (e) 停机不恢复  the same run_id, or a round ts that is not after the restart
//   (f) 杀了子进程  the after set ≠ the before set         ⇒ THE core assertion, violated
//   (g) 类型        a pid written as a STRING              ⇒ isinstance(...,int) is structurally false
//
// (b)/(e)/(f) must be DIFFERENT verdicts from each other and from NOT-EVALUATED — folding them
// together is 硬规则 3b's failure mode («measured, nothing happened» vs «could not measure»).
//
// The criterion itself is RE-RUN here (its own `criterion:` block, verbatim, through a real YAML
// reader — ⚠️ it is a `>-` FOLDED scalar, see below) against synthesized workspaces: once accepting
// the produced record, then REJECTING each perturbed copy. That pair is the mechanical proof that the
// individual field shapes are load-bearing rather than decorative.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { parse as parseYaml } from "yaml";

import {
  AC_ID,
  CARRIER_REL,
  INFLIGHT_SOURCE,
  REQUIRED_RECORD_FIELDS,
  RESTARTED_SERVICE,
  WORKER_DRIVER_MARKERS,
  aliveAmong,
  aliveNonZombie,
  buildRecord,
  childDigest,
  cmdlineIsWorkerDriver,
  deriveInflight,
  driverChildren,
  isIsoInstant,
  parsePidFile,
  procCmdline,
  procState,
  samePidSet,
} from "../scripts/server-restart-inflight-verify.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

// ── fixtures ────────────────────────────────────────────────────────────────────────────────────

/** A valid before/after pair: a real restart, a non-empty in-flight set that survives, a NEW run_id. */
function readings(overrides = {}) {
  const base = {
    at: "2026-09-13T22:00:00.000Z",
    restartedAt: "2026-09-13T22:01:00.000Z",
    driverPidBefore: 3057428,
    driverPidAfter: 3099001,
    driverPidBeforeAlive: true,
    driverPidBeforeAliveAfter: false,
    driverPidAfterAlive: true,
    inflightBefore: [300998, 300999],
    inflightBeforeAllAlive: true,
    inflightDeclared: [300998, 300999],
    inflightAllChildren: [300998, 300999, 307003],
    inflightAliveAfter: [300998, 300999],
    workerRunIdBefore: "wk-prod-anchor",
    workerRoundBefore: 17,
    workerRunIdAfter: "wk-prod-1789337000",
    workerRoundAfter: 1,
    workerRoundTsAfter: "2026-09-13T22:08:00.000Z",
    workerRoundMtime: "2026-09-13T22:08:00.000Z",
    restartedService: RESTARTED_SERVICE,
    restartedVia: "quay server restart --only driver:worker --json",
    restartedArgv: ["node", "quay.ts", "server", "restart", "--only", "driver:worker"],
    restartedExit: 0,
    restartedStdout: '{"changed":true}',
    controlMode: "none",
  };
  return { ...base, ...overrides };
}

// ── the criterion, read through a REAL YAML reader ──────────────────────────────────────────────

/** Locate `goals/AC-256-*.md` and return its `criterion:` value.
 *
 *  ⚠️ AC-256's criterion is a `>-` **FOLDED** block scalar, not `|-`. Hand-rolling the fold is how
 *  this goes wrong silently: every logical line in that block is separated by a BLANK line, so the
 *  fold turns the blank into a newline and the wrapped continuations into SPACES — python is
 *  newline-significant, so a naive `join("\n")` produces a syntax error and a naive `join(" ")`
 *  produces a broken `<<'P'` heredoc. Neither direction is safe to guess, so the repo's own YAML
 *  reader does the folding. (Same class as the recorded `yaml-folded-block-scalar-criterion-extraction`
 *  trap.) */
function criterionSource() {
  const dir = path.join(REPO_ROOT, "goals");
  const file = fs.readdirSync(dir).find((n) => n.startsWith("AC-256-"));
  assert.ok(file, "the AC-256 criterion file exists");
  const raw = fs.readFileSync(path.join(dir, file), "utf8");
  const parts = raw.split(/^---\s*$/m);
  assert.ok(parts.length >= 3, "the goal file has a frontmatter block");
  const doc = parseYaml(parts[1]);
  assert.equal(typeof doc?.criterion, "string", "the frontmatter carries a string `criterion`");
  return doc.criterion;
}

/** Run the criterion verbatim in `ws` and return { code, stderr }. */
function runCriterion(ws) {
  const r = spawnSync("bash", ["-c", criterionSource()], { cwd: ws, encoding: "utf8" });
  return { code: r.status, stderr: r.stderr ?? "", stdout: r.stdout ?? "" };
}

/** A workspace carrying `record` + a `worker-round.jsonl` written AFTER the record's `at`. */
function makeCriterionWorkspace(record, { roundMtimeDelta = +60, omitRound = false } = {}) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "ac256-criterion-"));
  fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(ws, CARRIER_REL), JSON.stringify(record) + "\n");
  if (!omitRound) {
    const p = path.join(ws, ".quay", "worker-round.jsonl");
    fs.writeFileSync(p, JSON.stringify({ ts: "2026-09-13T22:08:00.000Z", round: "1", run_id: "wk-prod-1789337000" }) + "\n");
    const parsed = Date.parse(record.at);
    // A deliberately malformed `at` is one of the cases under test — fall back to a fixed instant so
    // the FIXTURE can still be built (the criterion's own exit code is what is being asserted there).
    const t = (Number.isFinite(parsed) ? parsed / 1000 : Date.parse("2026-09-13T22:00:00.000Z") / 1000) + roundMtimeDelta;
    fs.utimesSync(p, t, t);
  }
  return ws;
}

// ── the record the criterion actually reads ─────────────────────────────────────────────────────

test("AC-256 — the positive control goes through the REAL buildRecord and its record satisfies the criterion verbatim", (t) => {
  const built = buildRecord(readings());
  assert.equal(built.ok, true, `expected OK, got ${built.verdict}: ${built.reason}`);
  const rec = built.record;
  for (const f of REQUIRED_RECORD_FIELDS) assert.ok(f in rec, `required field ${f} is present`);

  assert.equal(rec.ac, AC_ID, "ac is the criterion's literal id");
  assert.equal(rec.restarted_service, "driver:worker", "restarted_service is the criterion's literal service");
  assert.ok(isIsoInstant(rec.at), "at is ISO-8601 (a non-ISO at would make the criterion exit 3)");
  // ⛔ INTEGERS, not strings: the criterion's `isinstance(x, int)` is structurally false for "300998".
  assert.equal(Number.isInteger(rec.driver_pid_before), true);
  assert.equal(Number.isInteger(rec.driver_pid_after), true);
  assert.notEqual(rec.driver_pid_before, rec.driver_pid_after, "a REAL restart");
  assert.ok(Array.isArray(rec.inflight_worker_pids_before) && rec.inflight_worker_pids_before.length >= 1, "non-empty");
  assert.equal(rec.inflight_worker_pids_before.every(Number.isInteger), true, "every before pid is an int");
  assert.equal(rec.inflight_worker_pids_alive_after.every(Number.isInteger), true, "every after pid is an int");
  assert.equal(samePidSet(rec.inflight_worker_pids_alive_after, rec.inflight_worker_pids_before), true, "set-equal");
  // The strengthened fields the criterion does NOT read — they are what makes the record auditable.
  assert.equal(rec.driver_pid_before_dead_after, true);
  assert.equal(rec.driver_pid_after_alive, true);
  assert.equal(rec.inflight_worker_pids_before_all_alive, true);
  assert.equal(rec.inflight_source, INFLIGHT_SOURCE);
  assert.notEqual(rec.worker_run_id_after, rec.worker_run_id_before, "the driver resumed on a NEW run_id");
  assert.ok(Date.parse(rec.worker_round_ts_after) > Date.parse(rec.restarted_at), "and turns strictly after the restart");

  const ws = makeCriterionWorkspace(rec);
  t.after(() => fs.rmSync(ws, { recursive: true, force: true }));
  const run = runCriterion(ws);
  assert.equal(run.code, 0, `the criterion accepts the produced record (stderr: ${run.stderr})`);
});

test("AC-256 criterion tri-states — absent carrier ⇒ exit 1, non-ISO `at` ⇒ exit 3, missing round carrier ⇒ exit 3", (t) => {
  const ws0 = fs.mkdtempSync(path.join(os.tmpdir(), "ac256-empty-"));
  t.after(() => fs.rmSync(ws0, { recursive: true, force: true }));
  const absent = runCriterion(ws0);
  assert.equal(absent.code, 1, "a missing carrier is NOT-ACHIEVED (1), ⛔ NOT not-evaluated (3)");
  assert.match(absent.stderr, /carrier .* absent/);

  const rec = buildRecord(readings()).record;
  const ws3 = makeCriterionWorkspace({ ...rec, at: "not-a-date" });
  t.after(() => fs.rmSync(ws3, { recursive: true, force: true }));
  const badAt = runCriterion(ws3);
  assert.equal(badAt.code, 3, "a non-ISO `at` is an INSTRUMENT problem (3) — a different fact from (1)");
  assert.match(badAt.stderr, /NOT-EVALUATED/);

  const ws4 = makeCriterionWorkspace(rec, { omitRound: true });
  t.after(() => fs.rmSync(ws4, { recursive: true, force: true }));
  const noRound = runCriterion(ws4);
  assert.equal(noRound.code, 3, "a missing worker-round carrier is also (3) — the cross-check cannot be made");
});

test("AC-256 criterion field shapes are load-bearing: perturbing each ONE makes the criterion reject the copy", (t) => {
  const rec = buildRecord(readings()).record;
  const cases = [
    ["same driver pid (a cosmetic pid-file rewrite)", { driver_pid_after: rec.driver_pid_before }],
    ["empty in-flight set", { inflight_worker_pids_before: [], inflight_worker_pids_alive_after: [] }],
    ["a killed in-flight worker", { inflight_worker_pids_alive_after: [rec.inflight_worker_pids_before[0]] }],
    ["string pids instead of ints", { inflight_worker_pids_before: rec.inflight_worker_pids_before.map(String) }],
    ["string driver pids instead of ints", { driver_pid_before: String(rec.driver_pid_before) }],
    ["the wrong `ac` id", { ac: "GOAL-017-AC-255" }],
  ];
  for (const [label, patch] of cases) {
    const ws = makeCriterionWorkspace({ ...rec, ...patch });
    t.after(() => fs.rmSync(ws, { recursive: true, force: true }));
    const run = runCriterion(ws);
    assert.equal(run.code, 1, `the criterion REJECTS: ${label} (stderr: ${run.stderr})`);
    assert.match(run.stderr, /no qualifying record/, `…and says so for: ${label}`);
  }

  // …and the mtime cross-check (the criterion's only direct reading of "did the driver resume") is
  // load-bearing too: a round carrier older than `at` fails.
  const stale = makeCriterionWorkspace(rec, { roundMtimeDelta: -600 });
  t.after(() => fs.rmSync(stale, { recursive: true, force: true }));
  const staleRun = runCriterion(stale);
  assert.equal(staleRun.code, 1, "a round carrier not written since the restart is a failure, not a pass");
  assert.match(staleRun.stderr, /did not actually resume/);
});

// ── the negative controls, one per way the record could observe nothing ─────────────────────────

test("AC-256 (a)/(b) 空转 controls — an empty before set, and a before set containing a dead pid, are NOT-EVALUATED", () => {
  const empty = buildRecord(readings({ inflightBefore: [], inflightAliveAfter: [], inflightDeclared: [], inflightAllChildren: [] }));
  assert.equal(empty.ok, false);
  assert.equal(empty.verdict, "NOT-EVALUATED");
  assert.match(empty.reason, /EMPTY/);
  assert.equal(empty.record, undefined, "zero record on refusal");

  // (b) is the control the CRITERION cannot make: a pid that is already gone/zombie satisfies
  // «set(after) == set(before)» vacuously, because a corpse also "did not die during the window".
  const dead = buildRecord(readings({ inflightBeforeAllAlive: false }));
  assert.equal(dead.ok, false);
  assert.equal(dead.verdict, "NOT-EVALUATED");
  assert.match(dead.reason, /not every in-flight worker pid was alive/i);
});

test("AC-256 (c) 假重启 control — an unchanged driver pid is NOT-A-RESTART, never a qualifying record", () => {
  const r = buildRecord(readings({ driverPidAfter: 3057428 }));
  assert.equal(r.ok, false);
  assert.equal(r.verdict, "NOT-A-RESTART");
  assert.notEqual(r.verdict, "NOT-EVALUATED", "«nothing was restarted» and «could not measure» must not share a value");
});

test("AC-256 (d) OLD-DRIVER-SURVIVED — a moved pid file whose OLD process is still alive is its own verdict", () => {
  // This is the reading `driver_pid_before != driver_pid_after` alone CANNOT make: a no-op that only
  // rewrites the pid file satisfies it. Two drivers existing at once is a different fact from
  // "nothing was restarted", so it must not share that value either.
  const r = buildRecord(readings({ driverPidBeforeAliveAfter: true }));
  assert.equal(r.ok, false);
  assert.equal(r.verdict, "OLD-DRIVER-SURVIVED");
  assert.notEqual(r.verdict, "NOT-A-RESTART");
  assert.notEqual(r.verdict, "NOT-EVALUATED");

  const gone = buildRecord(readings({ driverPidAfterAlive: false }));
  assert.equal(gone.verdict, "DRIVER-NOT-RESUMED", "no new live driver is yet another fact");
});

test("AC-256 (e) 停机不恢复 control — the same run_id (or a round ts not after the restart) is DRIVER-NOT-RESUMED", () => {
  const sameRun = buildRecord(readings({ workerRunIdAfter: "wk-prod-anchor" }));
  assert.equal(sameRun.ok, false);
  assert.equal(sameRun.verdict, "DRIVER-NOT-RESUMED");
  assert.match(sameRun.reason, /OLD run_id/);

  const earlyTs = buildRecord(readings({ workerRoundTsAfter: "2026-09-13T21:00:00.000Z" }));
  assert.equal(earlyTs.verdict, "DRIVER-NOT-RESUMED");
  assert.match(earlyTs.reason, /not strictly after/);

  const unreadable = buildRecord(readings({ workerRunIdBefore: "" }));
  assert.equal(unreadable.verdict, "NOT-EVALUATED", "an unreadable reading is NOT «the driver did not resume»");
});

test("AC-256 (f) 杀子进程 control — a killed in-flight worker is INFLIGHT-KILLED, and the reason NAMES the pid", () => {
  // The synthetic half of the control: the producer's judgment, driven by a before/after pair that
  // differs. The mechanical half (that `aliveAmong` actually observes a process dying) is the
  // /proc-level test below — a judgment that could not be fed a real difference would be decorative.
  const r = buildRecord(readings({ inflightAliveAfter: [300998] }));
  assert.equal(r.ok, false);
  assert.equal(r.verdict, "INFLIGHT-KILLED");
  assert.match(r.reason, /300999/, "the vanished pid is named — an unactionable «something died» is not a reading");
  assert.match(r.reason, /6\.9|§6\.9/, "and it names the invariant that was violated");
  assert.notEqual(r.verdict, "NOT-EVALUATED");
});

test("AC-256 (g) type controls — a non-ISO `at`, a null driver pid, or a missing reading refuses rather than emitting a malformed record", () => {
  for (const [label, patch] of [
    ["non-ISO at", { at: "13/09/2026 22:00" }],
    ["non-ISO restartedAt", { restartedAt: "yesterday" }],
    ["unreadable before pid", { driverPidBefore: null }],
    ["unreadable after pid", { driverPidAfter: null }],
    ["driver was a corpse at sampling time", { driverPidBeforeAlive: false }],
  ]) {
    const r = buildRecord(readings(patch));
    assert.equal(r.ok, false, `refused: ${label}`);
    assert.equal(r.verdict, "NOT-EVALUATED", `distinguishable value for: ${label}`);
    assert.equal(r.record, undefined, `zero record for: ${label}`);
  }
});

// ── the reading layer: /proc direct quantities, on a SYNTHETIC proc dir ────────────────────────

/** Build a fake /proc: pid → { state, cmdline, children }. */
function makeProc(entries) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ac256-proc-"));
  for (const [pid, e] of Object.entries(entries)) {
    fs.mkdirSync(path.join(dir, pid, "task", pid), { recursive: true });
    fs.writeFileSync(path.join(dir, pid, "status"), `Name:\tnode\nState:\t${e.state} (x)\n`);
    fs.writeFileSync(path.join(dir, pid, "cmdline"), (e.cmdline ?? []).join("\0") + "\0");
    fs.writeFileSync(path.join(dir, pid, "task", pid, "children"), (e.children ?? []).join(" ") + (e.children?.length ? " " : ""));
  }
  return dir;
}

test("AC-256 — the in-flight set comes from the PROCESS TREE and is FILTERED by the workspace's own worker name", (t) => {
  const dir = makeProc({
    4242: { state: "S", cmdline: ["node", "worker-driver.ts", "--root", "/w"], children: [111, 222] },
    111: { state: "S", cmdline: ["claude", "-n", "quay-task-worker", "-p", "Task: gap-x"] },
    222: { state: "S", cmdline: ["bash", "closure-lag-check.sh", "--root", "/w"] },
  });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  assert.deepEqual(driverChildren(4242, dir), [111, 222], "all direct children are enumerated");
  const inflight = deriveInflight(4242, "quay-task-worker", [111], dir);
  assert.deepEqual(inflight.pids, [111], "the JUDGMENT set is only the real worker — a routine probe script is NOT an in-flight worker");
  assert.deepEqual(inflight.allChildren, [111, 222], "…and what was EXCLUDED stays visible in the reading");
  assert.deepEqual(inflight.declared, [111], "the driver's self-report is carried alongside, ⛔ never used as the set");

  // The digest makes the exclusion auditable from the record alone.
  const digest = childDigest(inflight.allChildren, dir);
  assert.match(digest["222"], /closure-lag-check/, "the excluded child's identity is readable in the record");
  assert.match(digest["111"], /quay-task-worker/);

  // A different workspace name selects a different set from the SAME tree (the filter is the
  // workspace's own role name, ⛔ not a hardcoded literal).
  assert.deepEqual(deriveInflight(4242, "fleet-task-worker", [], dir).pids, [], "a name that matches nothing yields nothing — no fabricated workers");
  assert.deepEqual(deriveInflight(4242, "closure-lag", [], dir).pids, [222], "and the same tree read with another name is a different set");
});

test("AC-256 — the before set is checked for ZOMBIES, not signalability (a zombie is dead)", (t) => {
  const dir = makeProc({
    111: { state: "S", cmdline: ["node", "k"] },
    222: { state: "Z", cmdline: ["node", "k"] },
    333: { state: "R", cmdline: ["node", "k"] },
  });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  assert.equal(procState(111, dir), "S");
  assert.equal(procState(222, dir), "Z");
  assert.equal(aliveNonZombie(111, dir), true);
  // A zombie still accepts signal 0 — `kill(pid,0)` is the proxy that reads «alive» for a corpse.
  // This assertion is the whole reason the reading is the /proc State character instead.
  assert.equal(aliveNonZombie(222, dir), false, "a Z-state process is NOT alive");
  assert.equal(aliveNonZombie(333, dir), true, "state R is alive");
  assert.equal(aliveNonZombie(999, dir), false, "an absent pid is not alive");
  assert.deepEqual(aliveAmong([111, 222, 333], dir), [111, 333], "aliveAmong drops the zombie and keeps the rest");
});

test("AC-256 — a REAL process that exits is observed: the live re-check is a direct quantity, not a proxy", (t) => {
  // No fixture here: a real child is spawned and reaped, so `/proc` is the real one and the reading
  // is the kernel's. Without this, `aliveAmong` could be a constant-true function and every
  // «one of them died» assertion above would still pass.
  const child = spawnSync(process.execPath, ["--no-warnings", "-e", "process.exit(0)"], { stdio: "ignore" });
  assert.equal(child.status, 0, "the probe process ran");
  assert.equal(aliveNonZombie(process.pid), true, "our OWN pid reads alive");
  assert.equal(aliveNonZombie(2147483646), false, "an out-of-range pid reads not-alive (no throw, no crash)");

  const victim = spawnSync(process.execPath, ["--no-warnings", "-e", "setTimeout(()=>{},50)"], { stdio: "ignore" });
  assert.equal(aliveNonZombie(victim.pid ?? 0), false, "a process that has fully exited + been reaped reads not-alive");
});

test("AC-256 — driverChildren walks EVERY thread's children file (missing one direction makes «all survived» easier to satisfy)", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ac256-proc-threads-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, "700", "task", "700"), { recursive: true });
  fs.mkdirSync(path.join(dir, "700", "task", "701"), { recursive: true });
  fs.writeFileSync(path.join(dir, "700", "status"), "Name:\tn\nState:\tS (x)\n");
  fs.writeFileSync(path.join(dir, "700", "cmdline"), "node\0worker-driver.ts\0");
  fs.writeFileSync(path.join(dir, "700", "task", "700", "children"), "11 12");
  // A child forked by a SECONDARY thread is invisible from the main thread's children file.
  fs.writeFileSync(path.join(dir, "700", "task", "701", "children"), "13");
  assert.deepEqual(driverChildren(700, dir), [11, 12, 13], "children of every task are unioned");
  assert.deepEqual(driverChildren(999, dir), [], "an unreadable driver pid yields no children (⇒ NOT-EVALUATED upstream, never «no workers»)");
});

test("AC-256 — the pid file of the DRIVER is only a cross-check: the derivation wins, and the two are compared by SET", () => {
  // 硬规则 4b: the declared set is maintained by the object under test (it stops updating exactly
  // when the driver stalls, which looks identical to «everything is fine»). It is carried, never judged.
  const rec = buildRecord(readings({ inflightDeclared: [300998, 300999, 999999] })).record;
  assert.deepEqual(rec.inflight_declared_by_driver, [300998, 300999, 999999]);
  assert.deepEqual(rec.inflight_worker_pids_before, [300998, 300999], "the criterion set is the DERIVED one");
  assert.match(rec.inflight_declared_vs_derived, /DIFFERENT/, "a disagreement is recorded, not smoothed over");
  assert.equal(
    buildRecord(readings({ inflightDeclared: [300998, 300999] })).record.inflight_declared_vs_derived,
    "identical",
    "…and agreement is recorded as its own value",
  );

  assert.equal(samePidSet([1, 2], [2, 1]), true, "set equality ignores order");
  assert.equal(samePidSet([1, 2], [1, 2, 3]), false);
  assert.equal(samePidSet([1, 2, 2], [1, 2]), true, "duplicates do not create a difference");
});

test("AC-256 — parsePidFile / cmdlineIsWorkerDriver are total (a junk carrier must not throw or report positives)", () => {
  assert.deepEqual(parsePidFile("  11\n22  33 \n"), [11, 22, 33]);
  assert.deepEqual(parsePidFile(""), []);
  assert.deepEqual(parsePidFile(null), []);
  assert.deepEqual(parsePidFile("not-a-pid 12x"), []);
  assert.equal(cmdlineIsWorkerDriver(2147483646), false, "an absent process is not the worker driver");
  assert.equal(WORKER_DRIVER_MARKERS[0], "worker-driver.ts", "the primary marker is derived from the kernel registry");
  assert.equal(WORKER_DRIVER_MARKERS[1], "worker-driver.js", "the shipped/bundled form is derived from the SAME registry stem (⛔ no second literal)");
  assert.equal(procCmdline(2147483646), null, "an absent process has no cmdline (null, ⛔ never an empty string that reads as «matched nothing»)");
});

test("AC-256 — the worker-driver identity probe accepts BOTH entry forms and still excludes the supervisor", (t) => {
  // 实测形态（2026-09-14，生产 root /home/yale/work/quay）：生产跑的是**出厂 bundle**，不是源树 .ts。
  // 只认 `.ts` 的探针因此对每一个真实生产驱动**恒假** —— 而「恒假」与「驱动没在跑」同形（硬规则 4b），
  // 生产者会在正确的 pid 上拒绝动手。本用例把两个形态都钉住，同时证明它仍能把驱动与 supervisor 分开
  // （supervisor 的 cmdline 带 kind 词 `worker` 但 ⛔ 不带驱动入口名 ⇒ 放宽到裸 `worker` 就会误认）。
  const dir = makeProc({
    700: { state: "S", cmdline: ["node", "/repo/plugin/scripts/dist/worker-driver.js", "--root", "/ws", "--pid-file", "/ws/.quay/worker-driver-inflight.pid", "--run-id", "wk-prod-1"] },
    701: { state: "S", cmdline: ["node", "--experimental-strip-types", "/repo/plugin/scripts/worker-driver.ts", "--root", "/ws"] },
    702: { state: "S", cmdline: ["node", "--experimental-strip-types", "/repo/plugin/scripts/dist/driver-runtime.js", "__supervise", "--kind", "worker", "--root", "/ws"] },
    703: { state: "S", cmdline: ["node", "/repo/plugin/scripts/dist/promotion-driver.js", "--root", "/ws"] },
  });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(cmdlineIsWorkerDriver(700, dir), true, "the SHIPPED/bundled form (dist/worker-driver.js) IS the worker driver — this is the form production runs");
  assert.equal(cmdlineIsWorkerDriver(701, dir), true, "the source-tree form (worker-driver.ts) IS the worker driver");
  assert.equal(cmdlineIsWorkerDriver(702, dir), false, "the SUPERVISOR runs driver-runtime.js — it must never be mistaken for the driver it supervises");
  assert.equal(cmdlineIsWorkerDriver(703, dir), false, "another kind's driver is not this kind's driver");
});
