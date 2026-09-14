// @test-group engine
// goal-invariants-standing.test.mjs — gap-standing-invariants-not-reevaluated-move-to-suite
// 把三条「常设不变式」从 goal 层下沉到套件：AC-182 / AC-183 / AC-187 的 criterion 今天全部 exit 0
// （实测 2026-09-09，逐条真跑），它们缺的不是「还没做」，而是【有人定期重跑】。goal 层做不到这件事：
// goal-driver.ts:619 只评估 active goal，且 :633/:644 会在判据全过时把 AC 与 GOAL 一起机械 flip 成
// achieved ⇒ 常设不变式一旦全绿就被关闭、从此不再复验（GOAL-001 已于 979f956aa 走过一遍：翻转前
// 660 轮里 659 轮评估过它的 AC，翻转后 2117 轮评估次数 = 0）。套件每次都跑、永不关闭、不占 goal cap。
//
// 三条断言各自保留「作用域为空 ⇒ not-evaluated」与「通过 ⇒ pass」的区分（gap-goal-store-empty-scope
// 纪律，硬规则 3b——空作用域的输出不得与「全部复验通过」同形）：
//   AC-182  judgeUntrackedGoals   goals/ 无未跟踪记录文件；空作用域 = goals/ 无 .md 记录文件
//   AC-183  judgeNotFfBenign      sync 载体 fresh window（tail -200）内每条 not-ff 事件必带 benign；
//                                 空作用域 = 窗口内 0 条 not-ff 事件（或载体缺失）
//   AC-187  collectSyncHealth     读数必须暴露 not-ff 的 benign 分解（notFfBenign / notFfBehind）；
//                                 纯函数断言自带 fixture ⇒ 恒评估；载体缺失 ⇒ 全零（可区分，
//                                 不是 notFfBenign=1 冒充通过）
//
// 三条都可取假（AC2）：前两条靠「违反输入 ⇒ state=fail」；第三条靠「钉死分解行为」——若
// collectSyncHealth 退化回不读 benign 字段（读数盲于良性分叉），「benign:true ⇒ notFfBenign=1」
// 这条 assert 直接红（同 adr016 的「tests pin the judgment, not the shell」）。
//
// Run: scripts/test.sh plugin/test/goal-invariants-standing.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

import { collectSyncHealth } from "../scripts/meta-driver.ts";
import { createGoalStore, criterionFingerprint, AMEND_ACTOR, SWEEP_ACTOR } from "../../packages/quay/src/goal-store.ts";
import { queryGateEvents } from "../../packages/quay/src/gate/gate-event-store.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

// ── 判定（纯函数，三条共用一个三态词表 state ∈ pass | fail | not-evaluated）───────────────────

/** AC-182：goals/ 无未跟踪记录文件。`untracked === null` 表示 git status 读不出（≠ 0，硬规则 6）。 */
function judgeUntrackedGoals({ goalFiles, untracked }) {
  if (goalFiles === 0) {
    return { state: "not-evaluated", reason: "goals/ 无 .md 记录文件，无可查对象", goalFiles: 0, untracked };
  }
  if (untracked === null) {
    return { state: "not-evaluated", reason: "git status goals/ 读不出（非 git 仓库或 git 失败）", goalFiles, untracked };
  }
  if (untracked === 0) return { state: "pass", goalFiles, untracked: 0 };
  return { state: "fail", goalFiles, untracked };
}

/** AC-183：fresh window 内每条 not-ff 事件必带 benign。缺 key（哪怕 benign:false）不算缺——hasOwnProperty 判 key 存在，与 jq has() 同义。 */
function judgeNotFfBenign(events) {
  const notFf = events.filter((e) => e && e.event === "doc-develop-sync-not-ff");
  if (notFf.length === 0) {
    return { state: "not-evaluated", reason: "窗口内 0 条 not-ff 事件，无可解读对象", notFf: 0, missingBenign: 0 };
  }
  const missing = notFf.filter((e) => !Object.prototype.hasOwnProperty.call(e, "benign"));
  if (missing.length > 0) {
    return { state: "fail", notFf: notFf.length, missingBenign: missing.length };
  }
  return { state: "pass", notFf: notFf.length, missingBenign: 0 };
}

// ── 采集（从真实 root 读数；读不出即空/ null，不伪造）─────────────────────────────────────────

function collectUntrackedGoals(root) {
  const goalsDir = path.join(root, "goals");
  let goalFiles = 0;
  try {
    goalFiles = fs.readdirSync(goalsDir).filter((f) => f.endsWith(".md")).length;
  } catch {
    goalFiles = 0;
  }
  let untracked = null; // null = 读不出，不是 0（硬规则 6：缺值 = 未查，不是为假）
  try {
    const porcelain = execFileSync("git", ["-C", root, "status", "--porcelain", "goals/"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    untracked = porcelain.split("\n").filter((l) => /^\?\?/.test(l)).length;
  } catch {
    untracked = null;
  }
  return { goalFiles, untracked };
}

function collectNotFfEvents(root, window = 200) {
  const file = path.join(root, ".quay", "doc-develop-sync.jsonl");
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return []; // 载体缺失 ⇒ 空窗口 ⇒ not-evaluated（不是「全 benign」）
  }
  const lines = text.trim() === "" ? [] : text.trim().split("\n").slice(-window);
  const events = [];
  for (const line of lines) {
    try {
      const r = JSON.parse(line);
      if (r && typeof r === "object") events.push(r);
    } catch {
      /* 坏行跳过——一行坏 JSON 不得使机制失明（collectSyncHealth 同款） */
    }
  }
  return events;
}

const _tmpDirs = [];
function tmpDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  _tmpDirs.push(dir);
  return dir;
}
after(() => {
  for (const d of _tmpDirs) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
});

function writeSyncCarrier(dir, rows) {
  const p = path.join(dir, ".quay", "doc-develop-sync.jsonl");
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, rows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
}

// ── AC-182（goals/ 无未跟踪记录文件）────────────────────────────────────────────────────────────

test("AC-182 可取假 — goals/ 有记录文件且存在未跟踪文件 ⇒ fail", () => {
  const v = judgeUntrackedGoals({ goalFiles: 3, untracked: 1 });
  assert.equal(v.state, "fail");
  assert.equal(v.untracked, 1);
});

test("AC-182 通过 — goals/ 有记录文件且 0 未跟踪 ⇒ pass", () => {
  const v = judgeUntrackedGoals({ goalFiles: 3, untracked: 0 });
  assert.equal(v.state, "pass");
});

test("AC-182 空作用域 — goals/ 无 .md 记录文件 ⇒ not-evaluated（≠ pass）", () => {
  const v = judgeUntrackedGoals({ goalFiles: 0, untracked: 0 });
  assert.equal(v.state, "not-evaluated");
  assert.notEqual(v.state, "pass");
});

test("AC-182 读不出 — git status 失败 ⇒ not-evaluated（≠ pass，缺值=未查）", () => {
  const v = judgeUntrackedGoals({ goalFiles: 5, untracked: null });
  assert.equal(v.state, "not-evaluated");
  assert.notEqual(v.state, "pass");
});

test("AC-182 live — 本仓库 goals/ 0 未跟踪记录（每轮真跑）", () => {
  const v = judgeUntrackedGoals(collectUntrackedGoals(REPO_ROOT));
  assert.equal(v.state, "pass", JSON.stringify(v));
});

// ── AC-183（sync 载体 not-ff 事件必带 benign）──────────────────────────────────────────────────

test("AC-183 可取假 — not-ff 事件缺 benign ⇒ fail", () => {
  const v = judgeNotFfBenign([
    { event: "doc-develop-sync-not-ff", benign: true },
    { event: "doc-develop-sync-not-ff" }, // 旧格式，缺 benign
  ]);
  assert.equal(v.state, "fail");
  assert.equal(v.missingBenign, 1);
});

test("AC-183 通过 — 所有 not-ff 事件带 benign（含 benign:false 也算带）⇒ pass", () => {
  const v = judgeNotFfBenign([
    { event: "doc-develop-sync-ff-synced" },
    { event: "doc-develop-sync-not-ff", benign: true },
    { event: "doc-develop-sync-not-ff", benign: false },
  ]);
  assert.equal(v.state, "pass");
  assert.equal(v.notFf, 2);
});

test("AC-183 空作用域 — 窗口内 0 条 not-ff ⇒ not-evaluated（≠ pass）", () => {
  const v = judgeNotFfBenign([{ event: "doc-develop-sync-ff-synced" }]);
  assert.equal(v.state, "not-evaluated");
  assert.notEqual(v.state, "pass");
});

test("AC-183 载体缺失 — 读不到载体 ⇒ 空窗口（≠「全 benign」）", () => {
  const events = collectNotFfEvents(path.join(REPO_ROOT, "no-such-dir-for-sync-carrier"), 200);
  assert.equal(events.length, 0);
});

test("AC-183 live — 本仓库 fresh window 内每条 not-ff 必带 benign（真跑；载体缺失则 not-evaluated，只抓真实违反）", () => {
  const v = judgeNotFfBenign(collectNotFfEvents(REPO_ROOT));
  assert.notEqual(v.state, "fail", JSON.stringify(v));
});

// ── AC-187（collectSyncHealth 暴露 not-ff 的 benign 分解）───────────────────────────────────────

test("AC-187 分解 — benign:true 的 not-ff 事件 ⇒ notFfBenign=1（读数不再盲于良性分叉）", () => {
  const dir = tmpDir("gi187-benign-");
  writeSyncCarrier(dir, [{ event: "doc-develop-sync-not-ff", ts: "2026-09-07T00:00:00Z", benign: true }]);
  const h = collectSyncHealth(dir);
  assert.equal(h.notFf, 1);
  assert.equal(h.notFfBenign, 1);
  assert.equal(h.notFfBehind, 0);
});

test("AC-187 分解 — benign:false（behind>0 真分叉）⇒ notFfBehind=1", () => {
  const dir = tmpDir("gi187-behind-");
  writeSyncCarrier(dir, [{ event: "doc-develop-sync-not-ff", ts: "2026-09-07T00:00:00Z", benign: false }]);
  const h = collectSyncHealth(dir);
  assert.equal(h.notFf, 1);
  assert.equal(h.notFfBenign, 0);
  assert.equal(h.notFfBehind, 1);
});

test("AC-187 不猜 — 旧格式 not-ff（无 benign）⇒ 只进 notFf 总数，不进任一分解桶", () => {
  const dir = tmpDir("gi187-old-");
  writeSyncCarrier(dir, [{ event: "doc-develop-sync-not-ff", ts: "2026-09-07T00:00:00Z" }]);
  const h = collectSyncHealth(dir);
  assert.equal(h.notFf, 1);
  assert.equal(h.notFfBenign, 0);
  assert.equal(h.notFfBehind, 0);
});

test("AC-187 空作用域 — 载体缺失 ⇒ 全零（可区分：不是 notFfBenign=1 冒充通过）", () => {
  const dir = tmpDir("gi187-empty-");
  fs.mkdirSync(path.join(dir, ".quay"), { recursive: true }); // 有 .quay 无载体
  const h = collectSyncHealth(dir);
  assert.equal(h.notFf, 0);
  assert.equal(h.notFfBenign, 0);
  assert.equal(h.notFfBehind, 0);
});

// ── gap-goal-store-write-surface-semantics：AC2 / AC3 两条常设不变式 ────────────────────────────
// 与 AC-182/183/187 同源（gap-standing-invariants-not-reevaluated-move-to-suite）：本任务第 1/2/3
// 步的「别再退化」那半是 hermetic 常设不变式——goal 层做不到「定期重跑」（goal-driver 只评估
// active goal 且全过就机械 flip），套件每次都跑、永不关闭、不占 goal cap。故下沉到此文件，⛔ 不
// 写成 goal AC（`achieved` 不可逆，活性/常设判据写成 goal AC 是类别错误）。

/** AC2（P2）常设：goal-driver 不再回传 origin 快照——回传会在「人改了 origin 而快照是旧的」时
 *  静默覆盖新值（P2 竞态根因）。按位置判定（源码 grep），⛔ 不按注释/字符串提及。 */
test("AC2 常设 — goal-driver.ts 无 `origin ?? \"\"` 回传（P2 竞态根因已删）", () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, "plugin", "scripts", "goal-driver.ts"), "utf8");
  assert.equal(src.includes('origin ?? ""'), false, "goal-driver.ts 不得再回传 origin 快照（P2）");
});

/** AC3（P4/P5）常设：update 清空 criterion 被拒（曾 exit 0 静默写成空串）；反向 status-only 放行
 *  （机械 I2 flip 不被挡）。hermetic——用 createGoalStore 在临时目录上真写，⛔ 不注入 seam。 */
test("AC3 常设 — update 清空 criterion 被拒；status-only 放行（机械 flip 不被挡）", () => {
  const dir = tmpDir("gi-ac3-");
  const s = createGoalStore(path.join(dir, "goals"));
  const GOAL_BODY = "goal body: background, scope, non-goals and exit conditions — long enough to satisfy the 40-char minimum";
  // ⚠️ `status: "draft"`: a GOAL born `active` now needs a naming AC first
  // (gap-goal-create-as-active-skips-zero-ac-gate). The subject here is the CRITERION write surface
  // (blanking refused / status-only flip allowed), which does not depend on the GOAL's own status.
  s.write("GOAL-001", { title: "g", status: "draft", origin: "o", body: GOAL_BODY });
  s.write("AC-001", { title: "a", status: "active", goal: "GOAL-001", criterion: "true", expect: "expected", origin: "o" });
  assert.throws(() => s.write("AC-001", { criterion: "" }), /criterion/);
  // status-only 写入不碰内容字段 ⇒ 不校验内容，机械 flip 放行。
  s.write("AC-001", { status: "achieved" });
  assert.equal(s.get("AC-001").status, "achieved");
});

// ── 修订入闸：「对一条已 achieved 的 AC 修订 criterion」── gap-ac242-…-amendment-unguarded 缺陷② ──
// 缺陷（生产时间线，本仓库可核）：`8bff44425` @ 2026-09-13T03:22:31Z 把 AC-203 的 criterion 收紧
// （加 kind 维度），**当时该 AC 已是 achieved**（2026-09-11T00:20:42Z）；03:52:16Z 它的 goal-sweep
// verdict = pass（读的是**旧文本**）；04:28:39Z 修订后的 criterion 才落到工作树；04:54:50Z 下一次轮转
// 到它 ⇒ fail。⇒ 一张对【已提交的新 criterion 已经为假】的 AC 的 pass 被判定计进 `verifiedFresh`
// （实测 81 条之一），禁态因此在**检测之前**存在了约 1.5 小时。发生率不是一次性：`git log --since=
// 2026-09-01 -- goals/` 中修改已 achieved AC 的 criterion/expect 行的提交实测 12 处。
//
// 修法：轮转写的 verdict 是**针对某一版判据文本**的 ⇒ 落账时把该文本的内容指纹写进事件
// （`payload.criterionHash`），判定时逐条比对。指纹不匹配（含遗留事件无指纹）⇒ 独立取值
// `amendedUnverified`：既不是「查过且全好」（verifiedFresh），也不是「此刻为假」（failing）——
// 后两者都是对一条**没人跑过**的判据下断言（硬规则 3b）。
// ⛔ 指纹不是 mtime/时钟：那是依赖宿主的量（硬规则 4 推论二），且 write 会重排整份 frontmatter。

/** 一条 achieved AC + 已关闭 GOAL 的夹具（冻结population：GOAL 非 active 且未声明 long-term）。 */
function amendmentFixture(tag, criterion = "exit 0") {
  const dir = tmpDir(tag);
  const s = createGoalStore(path.join(dir, "goals"));
  const body = "goal body: background, scope, non-goals and exit conditions — long enough to satisfy the 40-char minimum";
  s.write("GOAL-900", { title: "closed goal", status: "achieved", origin: "o", body });
  s.write("AC-900", { title: "a", status: "achieved", goal: "GOAL-900", criterion, expect: "e", origin: "o" });
  return { dir, s, ledger: path.join(dir, ".quay", "gate-events.jsonl") };
}

test("AC4 修订入闸 — 改 criterion ⇒ 既有 pass 不再计入 verifiedFresh（对照：同一夹具不改 ⇒ 仍计入）", async () => {
  const { s, ledger } = amendmentFixture("gi-ac4-");
  // 轮转跑一次 ⇒ 真跑判据 `exit 0` ⇒ pass，并以指纹落账。
  const r1 = await s.sweepFrozen({ budget: 5, wallMs: 60_000 });
  assert.deepEqual(r1.ran.map((x) => x.id), ["AC-900"], "夹具前提：这条在冻结population 内且被轮转覆盖");
  assert.equal(r1.ran[0].verdict, "pass");

  // ── 对照腿（同一夹具、**不**改 criterion）：仍计入 verifiedFresh ⇒ 下面的断言能取假 ──────────
  const before = s.checkStalePass();
  assert.deepEqual(before.verifiedFresh, ["AC-900"], "对照：判据未改 ⇒ 计入 verifiedFresh");
  assert.deepEqual(before.amendedUnverified, [], "对照：未改 ⇒ 不进修订桶");

  // ── 处理腿：对这条已 achieved 的 AC 修订 criterion ────────────────────────────────────────
  const amended = "echo 'AC-900: no qualifying record' >&2; exit 1";
  s.write("AC-900", { criterion: amended });
  const after = s.checkStalePass();
  assert.deepEqual(after.verifiedFresh, [], "旧 pass ⛔ 不再计入「查过且全好」——它查的不是这一版判据");
  assert.deepEqual(after.amendedUnverified, ["AC-900"], "独立取值：既有 verdict 所针对的判据文本已不是当前这条");
  assert.deepEqual(after.failing, [], "⛔ 也不是 failing——那是对一条【没人跑过】的判据断言其为假（硬规则 3b）");
  assert.notEqual(after.amendedUnverified.length === 0, after.verifiedFresh.length === 0 || after.failing.length === 0,
    "三桶互不同形（枚举独立态，硬规则 3）");

  // ── 空跑 + 独立 actor 落账（本轮对新 criterion 跑一次）────────────────────────────────────
  // ⛔ 判据刚被轮转过（秒级之前）⇒ 年龄闸会说「不该再看」；修订优先级必须压过它，否则「立刻空跑」
  // 就不会发生，新判据要等满 minAge 才第一次被执行。
  const r2 = await s.sweepFrozen({ budget: 5, wallMs: 60_000 });
  assert.deepEqual(r2.ran.map((x) => x.id), ["AC-900"], "修订 ⇒ 同一轮立刻重跑（⛔ 不受 minAge 年龄闸限制）");
  assert.equal(r2.ran[0].verdict, "fail", "新判据实跑为假（真跑，⛔ 非推断）");
  const ev = queryGateEvents(ledger, { pipeline_id: "AC-900" });
  assert.equal(ev.at(-1).actor, AMEND_ACTOR, "actor 独立、可区分于轮转（⛔ 不用同一个字符串记两种成因）");
  assert.notEqual(AMEND_ACTOR, SWEEP_ACTOR);
  assert.equal(ev.at(-1).payload.criterionHash, criterionFingerprint(amended), "落账带上【新】判据的指纹");

  // ── 空跑非 pass ⇒ 该 AC 的 achieved 声明不原样留在「查过且全好」──────────────────────────
  const after2 = s.checkStalePass();
  assert.deepEqual(after2.verifiedFresh, [], "空跑非 pass ⇒ 绝不回到 verifiedFresh");
  assert.deepEqual(after2.failing, ["AC-900"], "它是「此刻为假」（新判据的实测结论），不是「查不成」");
  assert.deepEqual(after2.amendedUnverified, [], "空跑之后已有可用 verdict（写者仍是轮转，故判定面读得到它）");
  assert.equal(ev.at(-1).verdict, "fail", "载体上留痕的 verdict 与判定面一致");
});

test("AC4 对照 — 纯空白重排⛔ 不算修订（write 重排 frontmatter 不得触发空跑）", async () => {
  const { s } = amendmentFixture("gi-ac4-ws-", "exit 0");
  await s.sweepFrozen({ budget: 5, wallMs: 60_000 });
  assert.deepEqual(s.checkStalePass().verifiedFresh, ["AC-900"]);
  // 只改空白（语义相同）：指纹规范化后不变 ⇒ 不得被判成「判据被改过」而空跑一轮（成本）。
  s.write("AC-900", { criterion: "exit    0" });
  const after = s.checkStalePass();
  assert.deepEqual(after.verifiedFresh, ["AC-900"], "空白重排 ⇒ 仍是同一版判据 ⇒ 仍计入");
  assert.deepEqual(after.amendedUnverified, [], "⛔ 不得把排版变化读成语义变化");
  const r = await s.sweepFrozen({ budget: 5, wallMs: 60_000 });
  assert.deepEqual(r.ran, [], "稳态：没有被误判的修订 ⇒ 零判据重跑（成本上界不被破坏）");

  // 双向控制：语义变化（非空白）**必须**被捕获 ⇒ 证明上一条不是「指纹恒等于自己」的恒真断言。
  s.write("AC-900", { criterion: "echo 'AC-900: nope' >&2; exit 1" });
  assert.deepEqual(s.checkStalePass().amendedUnverified, ["AC-900"], "语义变化必须被捕获");
  assert.deepEqual(s.checkStalePass().verifiedFresh, []);
});

test("AC4 遗留事件（无指纹）⇒ 独立取值而非「必定匹配当前判据」（硬规则 3b），且⛔ 不被优先重跑", async () => {
  const { s, ledger } = amendmentFixture("gi-ac4-legacy-", "exit 0");
  // 手写一条**没有** criterionHash 的轮转事件（改前版本写下的那类）：它没有对「验的是哪一版」做出任何声明。
  fs.mkdirSync(path.dirname(ledger), { recursive: true });
  fs.appendFileSync(ledger, JSON.stringify({
    id: "legacy-1", item_id: "AC-900", pipeline_id: "AC-900", gate: "goal", actor: SWEEP_ACTOR,
    verdict: "pass", timestamp: new Date().toISOString(), payload: { reason: "acceptance passed (exit 0)" },
  }) + "\n");
  const j = s.checkStalePass();
  assert.deepEqual(j.verifiedFresh, [], "⛔ 「没声明验的是哪一版」不得被读成「就是当前这一版」（读不懂输入不得伪装成合格）");
  assert.deepEqual(j.amendedUnverified, ["AC-900"], "⇒ 独立取值：不知道（⛔ 也不是 false）");
  assert.deepEqual(j.failing, []);
  // ⛔ 不被优先重跑：优先只给【有正向不符声明】的那些；否则落地当轮会把整个冻结population 重跑一遍
  // （本例 77 条），远超年龄轮转被 sizing 的成本上界。遗留事件随正常年龄轮转收敛（并把指纹补上）。
  const r = await s.sweepFrozen({ budget: 5, wallMs: 60_000 });
  assert.deepEqual(r.ran, [], "遗留（无指纹）不触发优先重跑——它没有「与当前文本不符」的正向证据");
  // 收敛：年龄闸到期后正常轮转重跑它，此后指纹齐备 ⇒ 回到可用 verdict。
  const r2 = await s.sweepFrozen({ budget: 5, wallMs: 60_000, minAgeMs: 0 });
  assert.deepEqual(r2.ran.map((x) => x.id), ["AC-900"], "年龄到期 ⇒ 正常轮转覆盖它，并补上指纹");
  assert.deepEqual(s.checkStalePass().verifiedFresh, ["AC-900"], "收敛后回到 verifiedFresh（不再是「不知道」）");
});
