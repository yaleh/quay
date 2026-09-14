// gate-event-coverage-check.test.mjs — gap-complete-gateevent-coverage-has-a-residual-gap
//
// The checker's two non-obvious judgments, each with its own control (硬规则 4 推论四：一个能解释现象
// 的说法不是被检验的结论 —— 每条断言都配一个「若它不成立结果会不同」的对照)：
//   ① 分母是**落地**不是 `翻 X done` 提交条数。对照：同一次落地留下 2 条 flip 提交（中间一次 ff 失败
//      被 reset 回滚）⇒ 读数必须与「只留最后一条 flip」相同。若把提交条数当分母，该任务会被算成
//      「1 覆盖 / 2 落地 = 50%」而误报红。
//   ② 落地按**状态转移**取，不按提交信息取。对照：一条提交信息完全不含「翻 … done」字样、但确实把
//      status 从 ready 改成 done（直接 Provider-ABI `task_write` 形态）⇒ 必须被计入分母。这是 AC1
//      「枚举所有会把任务翻 done 的路径」的机械版；按提交信息扫会**一条都看不见**（实测 09-04~09-14
//      有 3 条这种落地）。
// 三态：载体读不到 ⇒ exit 3 NOT-EVALUATED，与控制流上的 PASS（exit 0）可区分。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  collectLandings,
  computeCoverage,
  readCompleteEvents,
  windowBounds,
} from "../scripts/gate-event-coverage-check.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHECKER = path.join(HERE, "..", "scripts", "gate-event-coverage-check.ts");

/** 一个真 git 仓 + 真 carrier 的最小 fixture（⛔ 不 mock git：本检查的读数全部来自 git 与载体）。 */
function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gec-"));
  const git = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  git.__root = root;
  git("init", "-q", "-b", "develop");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  return { root, git };
}

function writeTask(root, id, status) {
  fs.writeFileSync(path.join(root, "tasks", `${id}.md`), `---\nid: ${id}\nstatus: ${status}\n---\n\n## AC\n\n- [x] done\n`);
}

// ⚠️ 提交日期必须**钉死**：git 缺省用墙钟 ⇒ 与检查器的窗口（缺省「最近 N 个完整日，不含今天」）错位，
//    读数变成「窗口内零落地 ⇒ NOT-EVALUATED」。固定到「2 天前」既落在 --days 3 窗口内，又与真实今天无关。
const D2 = new Date(Date.now() - 2 * 86400e3).toISOString().slice(0, 10);
const T2 = `${D2}T10:00:00Z`;
/** 事件时间戳：晚于 fixture 提交（落地后写事件），且与提交同日。 */
const T2E = `${D2}T10:05:00Z`;

function commit(git, msg, at = T2) {
  return commitAt(git, msg, at);
}

function commitAt(git, msg, at) {
  const env = { ...process.env, GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at };
  git("add", "-A");
  execFileSync("git", ["-C", git.__root, "commit", "-q", "-m", msg], { encoding: "utf8", env, stdio: ["ignore", "pipe", "ignore"] });
  return git("rev-parse", "HEAD").trim();
}

/** 与 fixture 提交同日的 UTC 日 —— 单元测试显式传窗口，⛔ 不依赖墙钟。 */
const DAY = D2;

function writeEvent(root, task, ts, actor = "quay-driver") {
  fs.appendFileSync(
    path.join(root, ".quay", "gate-events.jsonl"),
    `${JSON.stringify({ id: `${task}-${ts}`, item_id: task, pipeline_id: task, gate: "complete", actor, verdict: "pass", timestamp: ts, payload: { from: "ready", to: "done" } })}\n`,
  );
}

function runChecker(root, extra = []) {
  try {
    const out = execFileSync(
      "node",
      ["--no-warnings", "--experimental-strip-types", CHECKER, "--root", root, "--merge-target", "develop", "--json", ...extra],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: (e.stdout ?? "").toString(), err: (e.stderr ?? "").toString() };
  }
}

test("分母是落地不是 flip 提交条数：同一次落地留 2 条 flip 提交（一次被 reset 回滚）只算 1 个落地", () => {
  const { root, git } = makeRepo();
  writeTask(root, "t-a", "ready");
  commit(git, "seed");
  // 第一次 flip：随后被 reset 回滚（ff 失败重试形态）——机械 fan-in 的 flip 在 ff 之前
  writeTask(root, "t-a", "done");
  commit(git, "tasks: 翻 t-a done（driver 机械 fan-in）");
  writeTask(root, "t-a", "ready");
  commit(git, "tasks: reset t-a done→ready（fan-in 收敛「done 未落地」中间态）");
  // 第二次 flip：真落地
  writeTask(root, "t-a", "done");
  commit(git, "tasks: 翻 t-a done（driver 机械 fan-in）");
  writeEvent(root, "t-a", T2E);

  const landings = collectLandings(root, "develop", null, null);
  assert.equal(landings.length, 1, "两条 flip 提交 + 一次回滚 ⇒ 只有 1 个落地");
  assert.equal(landings[0].task, "t-a");

  const events = readCompleteEvents(path.join(root, ".quay", "gate-events.jsonl"));
  const rep = computeCoverage({ landings, events, threshold: 95, from: DAY, to: DAY });
  assert.equal(rep.verdict, "pass");
  assert.equal(rep.days[0].landings, 1);
  assert.equal(rep.days[0].covered, 1);
  assert.equal(rep.days[0].coverage, 1, "按提交条数当分母会算出 1/2=50% —— 那是读数伪影不是缺陷");
});

test("落地按状态转移取而非提交信息取：提交信息不含「翻 … done」字样但确实 ready→done 的落地必须入分母", () => {
  const { root, git } = makeRepo();
  writeTask(root, "t-b", "ready");
  commit(git, "seed");
  writeTask(root, "t-b", "done");
  commit(git, "tasks: t-b task_write by cli:12345"); // ⛔ 无「翻 … done」字样（Provider-ABI 直写形态）
  writeEvent(root, "t-b", T2E);

  const flipStyle = collectLandings(root, "develop", null, null);
  assert.equal(flipStyle.length, 1, "按状态转移扫 ⇒ 这条落地可见（按 `翻 .* done` 正则扫恒 0）");

  // 对照：把它记成「未覆盖」⇒ 必须判红（证明该路径确实会被这个判据盯住）
  const rep = computeCoverage({ landings: flipStyle, events: [], threshold: 95, from: DAY, to: DAY });
  assert.equal(rep.verdict, "red");
  assert.deepEqual(rep.days[0].uncovered, ["t-b"]);
});

test("bootstrap 例外：未覆盖落地早于载体中第一条 quay-driver complete 事件 ⇒ 豁免（机制当时尚未在生产生效）", () => {
  const { root, git } = makeRepo();
  writeTask(root, "t-old", "ready");
  commit(git, "seed");
  writeTask(root, "t-old", "done");
  commit(git, "tasks: 翻 t-old done（driver 机械 fan-in）"); // 09-04T08:00 —— 早于机制生效
  writeTask(root, "t-new", "ready");
  commit(git, "seed2");
  writeTask(root, "t-new", "done");
  commit(git, "tasks: 翻 t-new done（driver 机械 fan-in）"); // 之后
  writeEvent(root, "t-new", T2E); // 载体第一条 quay-driver 事件 = cutoff
  // t-old 无事件（机制当时未生效）；t-new 有事件

  const landings = collectLandings(root, "develop", null, null);
  const events = readCompleteEvents(path.join(root, ".quay", "gate-events.jsonl"));
  const rep = computeCoverage({ landings, events, threshold: 95, from: DAY, to: DAY });
  assert.equal(rep.bootstrapCutoff, T2E);
  assert.equal(rep.verdict, "pass", "未覆盖但早于 cutoff ⇒ 豁免，不判红");
  assert.deepEqual(rep.days[0].exempt, ["t-old"]);
  assert.deepEqual(rep.days[0].uncovered, [], "豁免项不得同时出现在 uncovered（否则判红）");
});

test("对照（负控制）：cutoff 之后的未覆盖落地**不**豁免 ⇒ 判红并点名（这是残留缺口真正被盯住的那一半）", () => {
  const { root, git } = makeRepo();
  // ⚠️ 时序是这条对照的全部：t-y 的落地**先**发生并写了事件（⇒ 它建立 cutoff）；t-x 的落地**后**发生
  //    且无事件 ⇒ 必须判红。若两者同时刻，t-x 会落进 bootstrap 豁免而把这条负控制变成恒绿。
  writeTask(root, "t-y", "ready");
  commitAt(git, "seed", `${D2}T09:00:00Z`);
  writeTask(root, "t-y", "done");
  commitAt(git, "tasks: 翻 t-y done（driver 机械 fan-in）", `${D2}T09:10:00Z`);
  writeEvent(root, "t-y", `${D2}T09:11:00Z`); // 载体第一条 quay-driver 事件 = cutoff
  writeTask(root, "t-x", "ready");
  commitAt(git, "seed2", `${D2}T10:00:00Z`);
  writeTask(root, "t-x", "done");
  commitAt(git, "tasks: 翻 t-x done（AC78 fan-in-execute workflow）", `${D2}T10:30:00Z`); // 晚于 cutoff

  const landings = collectLandings(root, "develop", null, null);
  const events = readCompleteEvents(path.join(root, ".quay", "gate-events.jsonl"));
  const rep = computeCoverage({
    landings: landings.filter((l) => l.task === "t-x"),
    events,
    threshold: 95,
    from: DAY,
    to: DAY,
  });
  assert.equal(rep.verdict, "red", "cutoff 之后的未覆盖落地必须报红（否则判据在修复后又变成恒绿）");
  assert.deepEqual(rep.days[0].uncovered, ["t-x"]);
  assert.deepEqual(rep.days[0].exempt, []);
});

test("窗口边界：--days N 是最近 N 个**完整**日（UTC，不含今天）", () => {
  const events = [{ task: "z", ts: "2026-08-12T18:00:00.000Z", actor: "outer" }];
  const b = windowBounds({ days: 3, events, nowIso: "2026-09-14T07:00:00.000Z" });
  assert.deepEqual(b, { from: "2026-09-11", to: "2026-09-13" }, "今天(09-14)是部分日 ⇒ 分母不含它");
});

test("三态：载体读不到 ⇒ exit 3 NOT-EVALUATED（与 PASS 的 exit 0 可区分，硬规则 3b）", () => {
  const { root } = makeRepo(); // 无 .quay/gate-events.jsonl
  const r = runChecker(root, ["--all"]);
  assert.equal(r.code, 3, `读不到载体必须 exit 3，实得 ${r.code}`);
  assert.match(r.out + (r.err ?? ""), /NOT-EVALUATED/);
});

test("端到端：真 git 仓 + 真载体 —— 全绿时 exit 0，删掉一条事件后 exit 1 并点名", () => {
  const { root, git } = makeRepo();
  for (const id of ["t-1", "t-2"]) {
    writeTask(root, id, "ready");
    commit(git, "seed");
    writeTask(root, id, "done");
    commit(git, `tasks: 翻 ${id} done（driver 机械 fan-in）`);
    writeEvent(root, id, "2026-09-12T10:00:00.000Z");
  }
  const green = runChecker(root, ["--days", "3"]);
  assert.equal(green.code, 0, `baseline 应 PASS：${green.out}${green.err ?? ""}`);

  // INJECT：删掉 t-2 的 complete 事件 ⇒ 必须 RED（这正是「载体漏记一条」的缺陷形态）
  const carrier = path.join(root, ".quay", "gate-events.jsonl");
  const kept = fs.readFileSync(carrier, "utf8").split("\n").filter((l) => l && !l.includes("t-2"));
  fs.writeFileSync(carrier, `${kept.join("\n")}\n`);
  const red = runChecker(root, ["--days", "3"]);
  assert.equal(red.code, 1, `漏记一条必须 RED，实得 ${red.code}：${red.out}`);
  const parsed = JSON.parse(red.out);
  assert.equal(parsed.verdict, "red");
  assert.deepEqual(parsed.days[0].uncovered, ["t-2"]);
});
