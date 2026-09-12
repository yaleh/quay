// @test-group engine
// goal-store-write-gate-criterion-attribution.test.mjs — the WRITE-SURFACE attribution gate
// (tasks/gap-criterion-attribution-write-gate-at-birth).
//
// 缺陷：`goals/AC-*.md` 的 criterion 是一条被 acceptance-runner 执行的 shell 字符串。若某个失败出口
// （`sys.exit(1)`）同行不写 stderr，runner 只能写出 `acceptance failed (exit 1) — criterion wrote no
// output to stderr/stdout` —— 一条说「失败了」但不说「为什么」的 verdict；而 AC-241 判的正是那本台账。
// 台账是 append-only：一条这样的 AC 只要被创建并跑过一次，那条不可归因的 fail 就永久留在生产台账上，
// 之后再快的检测也擦不掉（AC-239 → AC-245 → AC-247/248/249，两日内三次复发，且棘轮一次都没跑到它们——
// 只改 goals/ 的 delta 是纯 doc delta，`@static-tier change` 那轮不执行，runner-static-gate.ts:650
// 逐字承认这个洞）。⇒ 可堵的边界只有写入面。
//
// 本测试分两层，各自独立取假：
//   A 共用谓词（纯函数）—— 三态可区分（合格 / 裸退出 / 读不懂），且**负控制**：已归因的判据不误报。
//   B 写入面闸（真 goal-store，临时目录）—— CREATE 拒绝、UPDATE 只许不增、读不懂的存量走 NOT-EVALUATED。
//   C 单一实现 —— 棘轮 re-export 的就是 goal-store 的那一份（身份相等，⛔ 不是两份等价实现）。
//
// ⛔ 负控制是这两层的命门：只断言「坏输入被拒」的测试无法区分「闸在工作」与「闸恒拒一切」。
//    故 B 的每一组拒绝都配一组**同形放行**（把同一行补上 stderr ⇒ 过），C 用 === 而非「行为一致」。
//
// Run: scripts/test.sh plugin/test/goal-store-write-gate-criterion-attribution.test.mjs
//      node --test plugin/test/goal-store-write-gate-criterion-attribution.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createGoalStore } from "../../packages/quay/src/goal-store.ts";
import * as goalStore from "../../packages/quay/src/goal-store.ts";
import * as checker from "../scripts/criterion-failure-attribution-check.ts";

const tmpDirs = [];
function mkTmp(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}
after(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

/** A fresh store over its own empty goals dir. */
function freshStore() {
  const dir = path.join(mkTmp("wgate-"), "goals");
  return { dir, store: createGoalStore(dir) };
}

/** Write a legacy goal record BY HAND — the only way a pre-gate record (with bare failure exits, or
 *  with no criterion at all) can exist on disk. ⛔ Bypassing the store here is the point: the gate
 *  cannot be the thing that manufactured its own input. */
function seedHandwritten(dir, id, criterionBlock) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${id}-legacy.md`),
    `---\nid: ${id}\ntitle: legacy ${id}\nstatus: draft\nkind: criterion\ngoal: GOAL-001\n` +
      (criterionBlock === null ? "" : `criterion: |\n${criterionBlock}\n`) +
      `expect: exit 0\norigin: handwritten legacy fixture\n---\n`,
    "utf8",
  );
}

const BASE = { goal: "GOAL-001", expect: "exit 0", origin: "write-gate fixture" };

// ── A: the shared predicate, three states, both directions ─────────────────────────────────────────

test("A1 the shared predicate has THREE distinguishable states (硬规则 3b)", () => {
  const bare = goalStore.evaluateCriterionAttribution('python3 -c "import sys; sys.exit(1)"');
  assert.equal(bare.evaluated, true, "a readable criterion is evaluated");
  assert.equal(bare.bare.length, 1);
  assert.equal(bare.bare[0].line, 1, "the bare exit is reported WITH its line number");

  const clean = goalStore.evaluateCriterionAttribution(
    'python3 -c "import sys; sys.stderr.write(\'cause\\n\'); sys.exit(1)"',
  );
  assert.equal(clean.evaluated, true);
  assert.deepEqual(clean.bare, [], "NEGATIVE CONTROL: an attributed failure exit is NOT flagged");

  for (const unreadable of [undefined, null, 17, ""]) {
    const v = goalStore.evaluateCriterionAttribution(unreadable);
    assert.equal(v.evaluated, false, `unreadable (${JSON.stringify(unreadable)}) must be NOT-EVALUATED`);
    assert.equal(typeof v.error, "string");
    assert.notDeepEqual(v, clean, "NOT-EVALUATED must never be shaped like 'read it and it is clean'");
  }
});

test("A2 the implicit-exit class is covered by the SAME predicate (no second code path)", () => {
  // AC-172's original shape: no `exit` statement at all; the trailing `grep -q` IS the exit and
  // writes nothing. The write gate must refuse it too, or it would only close half the boundary.
  const v = goalStore.evaluateCriterionAttribution(
    "node packages/quay/src/goal-store.ts list --status draft | grep -q '\"id\": \"GOAL-'",
  );
  assert.equal(v.evaluated, true);
  assert.equal(v.bare.length, 1);
  assert.equal(v.bare[0].implicit, true, "reported as INHERITED, not as a written exit");
});

test("A3 `||`-remediated and attributed forms stay clean (the false side of the predicate)", () => {
  for (const clean of [
    "grep -q X f || { echo cause >&2; exit 1; }",
    'python3 -c "import sys; sys.stderr.write(\'no record\\n\'); sys.exit(2)"',
    "exit 0",
    "sys.stderr.write('no record\\n'); sys.exit(1)",
  ]) {
    const v = goalStore.evaluateCriterionAttribution(clean);
    assert.equal(v.evaluated, true, `"${clean}" is readable`);
    assert.deepEqual(v.bare, [], `"${clean}" must NOT be flagged`);
  }
});

test("A4 the measured OVER-REPORT is pinned, not hidden (`&&`-LEFT silent branch)", () => {
  // A silent segment left of `&&` IS a real unattributable failure exit: if `test -f x` is false the
  // chain short-circuits and the script exits 1 with ZERO output. The predicate flags it even though
  // `echo ok` sits to its right — that attribution is exactly what hid the original defect, so the
  // direction is kept (over-report, ⛔ never under-report). Pinned here so a future "cleanup" that
  // narrows it has to argue with a test rather than with a comment.
  const v = goalStore.evaluateCriterionAttribution("test -f x && echo ok");
  assert.equal(v.bare.length, 1);
  assert.equal(v.bare[0].implicit, true);
});

// ── B: the write-surface gate, each rejection paired with its same-shape admission ─────────────────

test("B1 CREATE: a bare failure exit is REFUSED, and the rejection names the LINE", () => {
  const { dir, store } = freshStore();
  assert.throws(
    () => store.write("AC-901", { title: "t", ...BASE, criterion: 'python3 -c "import sys; sys.exit(1)"' }),
    (err) => {
      assert.match(err.message, /line 1/, "the rejection enumerates the offending line number");
      assert.match(err.message, /refused at the write surface/);
      return true;
    },
  );
  assert.deepEqual(fs.readdirSync(dir), [], "a refused write leaves NOTHING on disk");
});

test("B2 CREATE: the SAME criterion with stderr on the same line is ADMITTED (negative control)", () => {
  const { dir, store } = freshStore();
  store.write("AC-901", {
    title: "t",
    ...BASE,
    criterion: 'python3 -c "import sys; sys.stderr.write(\'no qualifying record\\n\'); sys.exit(1)"',
  });
  assert.equal(fs.readdirSync(dir).length, 1, "the admitted write landed on disk");
});

test("B3 UPDATE is SHRINK-ONLY: N+1 bare exits refused, N and 0 admitted", () => {
  const { dir, store } = freshStore();
  seedHandwritten(dir, "AC-902", "  if not ok: sys.exit(1)\n  sys.exit(1)");

  const nPlus1 = "  if not a: sys.exit(1)\n  if not b: sys.exit(1)\n  sys.exit(1)";
  assert.throws(
    () => store.write("AC-902", { criterion: nPlus1 }),
    /would REGRESS/,
    "2 bare exits -> 3 must be refused (the edit ADDS an unattributable exit)",
  );

  const n = "  if not a: sys.exit(1)\n  sys.exit(1)";
  store.write("AC-902", { criterion: n }); // == N: legal
  store.write("AC-902", { criterion: "  sys.stderr.write('no record\\n') or sys.exit(1)" }); // 0: legal
});

test("B4 an UNREADABLE stored criterion is NOT-EVALUATED — distinct text, and the repair stays open", () => {
  const { dir, store } = freshStore();
  seedHandwritten(dir, "AC-903", null); // no criterion field at all
  assert.throws(
    () => store.write("AC-903", { criterion: "  if not a: sys.exit(1)" }),
    (err) => {
      assert.match(err.message, /NOT-EVALUATED/, "the unreadable-stored state has its OWN vocabulary");
      assert.doesNotMatch(err.message, /would REGRESS/, "…and is not shaped like the shrink-only refusal");
      return true;
    },
  );
  // The repair path must stay open, or a broken record could never be fixed through the store.
  store.write("AC-903", { criterion: "python3 -c \"print(1)\"" });
});

test("B5 a status-only write is NEVER judged (the mechanical I2 flip must stay unblocked)", () => {
  const { dir, store } = freshStore();
  seedHandwritten(dir, "AC-904", "  if not ok: sys.exit(1)");
  // criterion NOT touched ⇒ the gate must not even look: legacy bare records must remain flippable.
  const vm = store.write("AC-904", { status: "achieved" });
  assert.equal(vm.status, "achieved");
});

// ── C: ONE implementation (identity, not a second equivalent) ───────────────────────────────────────

test("C1 the ratchet re-exports the SAME predicate — identity, not a copy", () => {
  assert.equal(
    checker.isBareFailureExitLine,
    goalStore.isBareFailureExitLine,
    "a second implementation would be a different function object",
  );
  assert.equal(checker.FAILURE_EXIT_RE, goalStore.FAILURE_EXIT_RE, "the failure-exit regex is ONE object");
  assert.equal(checker.hasTrailingComputedFailureExit, goalStore.hasTrailingComputedFailureExit);
  assert.equal(checker.implicitFailureExitLines, goalStore.implicitFailureExitLines);
  assert.equal(checker.bareFailureExitsOfCriterion, goalStore.bareFailureExitsOfCriterion);
});

test("C2 the gate and the ratchet agree on a real criterion (the two surfaces cannot drift)", () => {
  const criterion = "  if not a: sys.exit(1)\n  sys.stderr.write('cause\\n') or sys.exit(1)";
  const viaRatchet = checker.bareFailureExitsOfCriterion(criterion);
  const viaGate = goalStore.evaluateCriterionAttribution(criterion);
  assert.deepEqual(viaGate.bare, viaRatchet);
  assert.equal(viaRatchet.length, 1, "exactly the one unattributed exit");
});
