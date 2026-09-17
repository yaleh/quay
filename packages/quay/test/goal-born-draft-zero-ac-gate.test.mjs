// @test-group product
// gap-goal-born-draft-zero-ac-escapes-standing-invariant — the AC-coverage gate's SCOPE must be the
// INVARIANT's own scope, not half of it.
//
// THE DEFECT THIS PINS: AC-217 declares 「status ∈ {draft, active} 的 GOAL 中，没有任何一条的 AC 条数
// == 0」, but the write face's predicate read `nextStatus === "active"` — the ACTIVE half only. So a GOAL
// could be born `draft` with zero ACs (GOAL-022, 2026-09-17T00:41:26Z, ≥101s in that state) while the
// rejection message on the active half literally PRESCRIBED that door ("create ⋯ as draft first"), and
// the one signal that should have fired spawned a gap-filing worker with nothing to fix.
//
// WHAT IS ASSERTED HERE (the carrier view; the AUTHORITATIVE reading is AC-217's own criterion, run
// verbatim in the task's evidence — ⛔ this file does NOT re-type that shell/python predicate, it reads
// the same carrier through the store's own `list()`):
//   AC1  the forbidden birth (draft, zero ACs) is REFUSED and the rejection ENUMERATES the count;
//   AC2  the natural AC-first order is fully usable (AC → GOAL draft → GOAL active);
//   AC3  the forbidden state is UNREACHABLE at every step — not "the window is short";
//   AC6  the gate is falsifiable in BOTH directions (the same write passes once the AC exists).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createGoalStore } from "../src/goal-store.ts";

const _createdDirs = [];
function tmpDir(tag = "born-draft") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `goal-${tag}-`));
  _createdDirs.push(dir);
  return dir;
}
test.after(() => {
  for (const dir of _createdDirs) fs.rmSync(dir, { recursive: true, force: true });
});

const GOAL_BODY = "goal body: background, scope, non-goals and exit conditions — long enough to satisfy the 40-char minimum";
const EXPECT = "the expected outcome this criterion proves";

function runCli(args) {
  const cli = new URL("../src/goal-store.ts", import.meta.url).pathname;
  const res = spawnSync("node", ["--no-warnings", "--experimental-strip-types", cli, ...args], { encoding: "utf8" });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

/** The invariant, read through the store's OWN carrier view: no GOAL in {draft, active} may have zero
 *  ACs naming it. ⛔ A SECOND EXPRESSION of AC-217's predicate would be the drift class this repo keeps
 *  removing — so this helper is deliberately the *store-API* view of the same quantity the criterion's
 *  `list`+python reads, and AC4 (in the task's evidence) pins that the criterion itself is unchanged. */
function bareGoals(store) {
  const records = store.list();
  const covered = new Set(records.map((r) => String(r.goal ?? "")).filter((g) => g !== ""));
  return records
    .filter((r) => String(r.id).startsWith("GOAL-") && (r.status === "draft" || r.status === "active"))
    .map((r) => String(r.id))
    .filter((id) => !covered.has(id));
}

// ── AC1: the forbidden birth is refused, with the count ENUMERATED ────────────────────────────────
test("AC1 — the CLI refuses a GOAL born `draft` with zero ACs and enumerates 「ACs naming …: 0」", () => {
  const root = tmpDir("ac1-cli");
  const r = runCli([
    "write", "GOAL-997", "--status", "draft", "--title", "probe draft", "--origin", "probe",
    "--body", GOAL_BODY, "--root", root, "--dry-run",
  ]);
  assert.notEqual(r.status, 0, "出生即 draft 且零 AC 必须在写面被拒（今天之前是 exit 0）:\n" + r.stdout + r.stderr);
  assert.match(r.stderr, /ACs naming GOAL-997: 0/, "拒绝必须【枚举】名下 AC 条数（硬规则 3：枚举不布尔）");
  // ⛔ The rejection must NOT teach the door that is now closed: the pre-fix message prescribed
  // 「create as draft first」 — the very state being refused.
  assert.doesNotMatch(r.stderr, /create GOAL-997 as draft first/);
  assert.doesNotMatch(r.stderr, /'--status draft', file its AC/);
  // ⛔ No parallel mechanism: the SAME gate, widened. `--force` stays unhonored here (the AC count is
  // a mechanical count of this store's own carriers — there is nothing in it to override).
  const forced = runCli([
    "write", "GOAL-997", "--status", "draft", "--title", "probe draft", "--origin", "probe",
    "--body", GOAL_BODY, "--root", root, "--force", "--dry-run",
  ]);
  assert.notEqual(forced.status, 0, "--force 不得放行（AC 条数是机械计数，不是可覆盖的判断）");
});

test("AC1 (library) — the same refusal through write(), so the gate is not CLI-only", () => {
  const s = createGoalStore(tmpDir("ac1-lib"));
  assert.throws(
    () => s.write("GOAL-997", { title: "probe", status: "draft", origin: "o", body: GOAL_BODY }),
    /ACs naming GOAL-997: 0/,
  );
  // The refusal writes nothing on disk.
  assert.deepEqual(s.list(), []);
});

// ── AC2 + AC3: the natural AC-first order, and the window is UNREACHABLE ──────────────────────────
test("AC2/AC3 — AC first → GOAL draft → GOAL active: every step exit 0, and the forbidden state never exists", () => {
  const root = tmpDir("ac23");
  const gs = (args) => runCli([...args, "--root", root]);

  // ① the AC that names a GOAL which does not exist yet — legal by construction (the completeness
  //    contract requires only that `goal:` be a non-empty string).
  const step1 = gs(["write", "AC-997", "--goal", "GOAL-997", "--status", "draft", "--title", "probe ac",
    "--criterion", "true", "--expect", EXPECT, "--origin", "probe"]);
  assert.equal(step1.status, 0, "AC 先写必须成功（否则「自然撰写顺序」被堵死）:\n" + step1.stdout + step1.stderr);
  assert.deepEqual(bareGoals(createGoalStore(path.join(root, "goals"))), [], "step① 后不得有裸 GOAL");

  // ② the GOAL, born draft, now that its exit condition exists.
  const step2 = gs(["write", "GOAL-997", "--status", "draft", "--title", "probe draft", "--origin", "probe", "--body", GOAL_BODY]);
  assert.equal(step2.status, 0, "有了指名 AC 之后 draft 出生必须成功:\n" + step2.stdout + step2.stderr);
  assert.deepEqual(bareGoals(createGoalStore(path.join(root, "goals"))), [], "step② 后不得有裸 GOAL");

  // ③ the human's activation.
  const step3 = gs(["write", "GOAL-997", "--status", "active"]);
  assert.equal(step3.status, 0, "激活必须成功:\n" + step3.stdout + step3.stderr);

  const s = createGoalStore(path.join(root, "goals"));
  assert.equal(s.get("GOAL-997").status, "active");
  assert.deepEqual(bareGoals(s), [], "最终态：{draft, active} 的 GOAL 全部有 AC");
  // I2 的派生面也看得见这条 AC：激活后它进入活跃集（判据是 goal 的状态，⛔ 不是 AC 自己的状态）。
  assert.deepEqual(s.listActiveCriteria().map((r) => String(r.id)), ["AC-997"]);
});

test("AC3 — the forbidden state is UNREACHABLE, ⛔ not merely short-lived: the write never lands", () => {
  const root = tmpDir("ac3-unreachable");
  const r = runCli(["write", "GOAL-998", "--status", "draft", "--title", "t", "--origin", "o", "--body", GOAL_BODY, "--root", root]);
  assert.notEqual(r.status, 0);
  // The claim is about the RECORD, ⛔ not about the directory: the store may create `goals/` (and a
  // lock/carrier dir) on the way in — what must not exist is the zero-AC GOAL carrier itself.
  const carriers = fs.existsSync(path.join(root, "goals")) ? fs.readdirSync(path.join(root, "goals")) : [];
  assert.deepEqual(carriers, [], `被拒的写不得留下载体（不是「先落盘再被观测到」）；实得 ${JSON.stringify(carriers)}`);
  assert.equal(runCli(["list", "--root", root]).stdout.trim(), "[]", "读回也必须是空的——没有一条记录落进 store");
});

// ── AC6: the gate is FALSIFIABLE — the same call passes once the AC exists ────────────────────────
test("AC6 — negative control: the SAME write is refused without a naming AC and accepted with one", () => {
  const s = createGoalStore(tmpDir("ac6-both"));
  const args = ["GOAL-996", { title: "same call", status: "draft", origin: "o", body: GOAL_BODY }];
  assert.throws(() => s.write(...args), /0 AC records name it/, "方向①：无 AC ⇒ 拒（判据能取假）");
  s.write("AC-996", { title: "exit condition", status: "draft", goal: "GOAL-996", criterion: "true", expect: EXPECT, origin: "o" });
  assert.equal(s.write(...args).status, "draft", "方向②：同一调用，有了 AC ⇒ 放行（⛔ 不是恒拒）");
});

test("AC6 — the ACTIVE half is unchanged: a GOAL cannot be born `active` with zero ACs either", () => {
  const s = createGoalStore(tmpDir("ac6-active"));
  assert.throws(
    () => s.write("GOAL-995", { title: "t", status: "active", origin: "o", body: GOAL_BODY }),
    /ACs naming GOAL-995: 0/,
    "扩到 draft 半边 ⛔ 不改 active 半边（同一条闸、同一个谓词）",
  );
});
