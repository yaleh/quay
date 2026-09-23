// @test-group engine
// errexit-abort-silent-exits-zero.test.mjs — the REGRESSION PIN for the third attribution class
// (tasks/gap-ac241-errexit-abort-silent-failures-have-no-predicate, GOAL-009 AC-241, 6th recurrence).
//
// 缺陷（生产台账实测，2026-09-20T23:50:57.067Z）：AC-241（「生产台账上失败判据必须可归因」）在修完 30 条存量
// 裸出口、baseline 32→0 之后【仍然转红】。肇事判据 AC-286 的三条失败出口全部把 `CAUSE=…` 写到 stderr，静态
// `bare=0`（旧谓词判它「完全可归因」），运行时却以零输出死掉：它 `set -euo pipefail`，第 7 行
// `LINE="$(grep … | head -1)"` 的命令替换非零 ⇒ errexit 在【赋值语句】上中止整个脚本 ⇒ 第 8/9 行的守卫与
// 它的 CAUSE 永不执行。这不是「出口语句自己静默」，而是「出口语句有归因、但脚本在非出口语句上被中止」——
// 落在旧谓词两条分支（显式出口 / 无出口时的隐式出口）之间的缝里。
//
// 本文件钉的是【结果量】：在域 criteria 里「errexit 中止类」的 AC 数必须为 0。
// ⛔ 配套取假（否则本文件与「断言恒真」同形，硬规则 3b）：同一段断言对一份**合成未守卫 fixture** 必须报红。
//    「断言真样本为 0」与「断言对假样本也判 0」是两件事，只做前者等于什么都没验。
//
// Run: node --test plugin/test/errexit-abort-silent-exits-zero.test.mjs
//      scripts/test.sh plugin/test/errexit-abort-silent-exits-zero.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

import { errexitAbortSilentExits } from "../../packages/quay/src/goal-store.ts";
import { parseGoalFile, IN_DOMAIN_STATUSES } from "../scripts/criterion-failure-attribution-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** Every in-domain criterion carrying ≥1 errexit-abort silent exit, scanned through the SHARED predicate
 *  (`errexitAbortSilentExits`) — ⛔ not through the composite `bareFailureExitsOfCriterion`, so this
 *  count cannot be masked by class ① having already found something on the same criterion. */
function errexitAbortAcs(goalsDir) {
  const out = [];
  for (const name of fs.readdirSync(goalsDir).filter((f) => f.startsWith("AC-") && f.endsWith(".md")).sort()) {
    const rec = parseGoalFile(fs.readFileSync(path.join(goalsDir, name), "utf8"));
    if (rec === null) continue;
    if (!IN_DOMAIN_STATUSES.includes(rec.status)) continue;
    if (rec.criterion.trim() === "") continue;
    const hits = errexitAbortSilentExits(rec.criterion);
    if (hits.length > 0) out.push({ id: rec.id, hits });
  }
  return out;
}

/** The ACs this task repaired BY NAME. Pinned individually as well as in aggregate: an aggregate of 0
 *  would also read as 0 if the predicate silently stopped looking, so the four must be proven clean on
 *  their own reads, not merely absent from a count. */
const REPAIRED = ["AC-280", "AC-283", "AC-285", "AC-286"];

test("the REAL repo's in-domain errexit-abort class count is 0 (the regression pin)", () => {
  const hits = errexitAbortAcs(path.join(REPO_ROOT, "goals"));
  assert.equal(
    hits.length,
    0,
    `an in-domain criterion enables errexit and assigns from an UNGUARDED command substitution — under ` +
      `\`set -e\` it aborts the shell on that line, so the attributed cause written below it never runs, ` +
      `and the runner writes its zero-output template into the append-only ledger: ${JSON.stringify(hits)}`,
  );
});

test("each repaired AC is clean ON ITS OWN READ (not merely absent from an aggregate)", () => {
  // A count of 0 is satisfied by "the predicate stopped finding anything" too. Read the four criteria
  // back and require each to be evaluable AND empty of this class.
  const goalsDir = path.join(REPO_ROOT, "goals");
  for (const id of REPAIRED) {
    const name = fs.readdirSync(goalsDir).find((f) => f.startsWith(`${id}-`) && f.endsWith(".md"));
    assert.ok(name, `${id} must exist in goals/ — the pin names a criterion that has been renamed/removed`);
    const rec = parseGoalFile(fs.readFileSync(path.join(goalsDir, name), "utf8"));
    assert.ok(rec, `${id} must parse as a goal record`);
    assert.ok(rec.criterion.trim() !== "", `${id}'s criterion must be non-empty (else it is NOT-EVALUATED, not clean)`);
    assert.deepEqual(
      errexitAbortSilentExits(rec.criterion),
      [],
      `${id} still carries an unguarded errexit abort: ${JSON.stringify(errexitAbortSilentExits(rec.criterion))}`,
    );
  }
});

// ── 取假: the same assertion must go RED on a synthetic unguarded fixture ────────────────────────────

test("取假: the same predicate returns a hit on a synthetic UNGUARDED fixture (the assertion can fail)", () => {
  const unguarded =
    "set -euo pipefail\n" +
    "LINE=\"$(grep -nE 'anchor' plugin/scripts/worker-fan-in.ts | head -1)\"\n" +
    "if [ -z \"$LINE\" ]; then\n" +
    "  echo \"CAUSE=anchor-not-found\" >&2; exit 1\n" +
    "fi\n";
  const hits = errexitAbortSilentExits(unguarded);
  assert.equal(hits.length, 1, "an unguarded assignment-with-command-substitution must be found");
  assert.equal(hits[0].line, 2, "…and NAMED by its line number (hard rule 3 — an enumeration, not a bool)");
  assert.equal(hits[0].errexitAbort, true, "…and marked as the errexit class, not as a written exit");
  // And the OUTER assertion shape really does flip: the same count that is 0 on the repo is ≥1 here.
  assert.ok(hits.length > 0, "the aggregate assertion must be able to go red");
});

test("取假 (mirror): the GUARDED forms of the same shape are clean — the predicate is not always-true", () => {
  const guarded = [
    // `|| true` INSIDE the substitution: the substitution's status becomes 0, so no abort.
    "set -euo pipefail\nLINE=\"$(grep -nE 'anchor' \"$f\" | head -1 || true)\"\nif [ -z \"$LINE\" ]; then echo CAUSE=x >&2; exit 1; fi\n",
    // `|| true` AFTER the assignment: the statement's status becomes 0.
    "set -euo pipefail\nLINE=\"$(grep -nE 'anchor' \"$f\" | head -1)\" || true\nif [ -z \"$LINE\" ]; then echo CAUSE=x >&2; exit 1; fi\n",
    // `if ! VAR=$(…); then …`: POSIX exempts a CONDITION from errexit — the guard DOES run.
    "set -euo pipefail\nif ! LINE=$(grep -nE 'anchor' \"$f\"); then echo CAUSE=x >&2; exit 1; fi\n",
    // No errexit at all: the assignment's failure does not end the shell.
    "LINE=\"$(grep -nE 'anchor' \"$f\" | head -1)\"\nif [ -z \"$LINE\" ]; then echo CAUSE=x >&2; exit 1; fi\n",
    // A command substitution NOT in value position — the statement's status is `echo`'s.
    "set -euo pipefail\necho \"$(grep -nE 'anchor' \"$f\" | head -1)\"\n",
    // A plain assignment with no command substitution cannot fail this way.
    "set -euo pipefail\nSRC=\"plugin/scripts/worker-fan-in.ts\"\nexit 0\n",
  ];
  for (const c of guarded) {
    assert.deepEqual(errexitAbortSilentExits(c), [], `must be CLEAN (a false positive accuses a clean criterion): ${c}`);
  }
});

test("the class is ADDITIVE — it fires even when the criterion carries attributed explicit exits", () => {
  // This IS the AC-286 shape and the reason the previous five repairs all held while AC-241 stayed red:
  // `implicitFailureExitLines` sits behind `out.length === 0`, and this criterion has explicit exits.
  // Measured directly (no yaml, no fixture seam) — the predicate must not inherit that mutex.
  const ac286Shape =
    "set -euo pipefail\n" +
    "LINE=\"$(grep -nE 'const[[:space:]]+mergeTarget' \"$SRC\" | head -1)\"\n" +
    "if [ -z \"$LINE\" ]; then\n" +
    "  echo \"CAUSE=default-assignment-not-found\" >&2; exit 1\n" +
    "fi\n" +
    "case \"$LINE\" in\n" +
    "  *'\"develop\"'*) echo OK; exit 0 ;;\n" +
    "  *) echo \"CAUSE=default-not-develop\" >&2; exit 1 ;;\n" +
    "esac\n";
  const hits = errexitAbortSilentExits(ac286Shape);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].line, 2);
  // The attribution on the exit lines does NOT clear it — errexit aborts BEFORE those lines run. Pinned
  // so a future "cleanup" that clears on attribution has to argue with a test, not with a comment.
  assert.ok(ac286Shape.split("\n").some((l) => l.includes(">&2")), "the criterion really does write causes");
});
