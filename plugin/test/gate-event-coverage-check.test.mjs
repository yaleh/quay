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
// ③ --no-block（gap-coverage-miss-fail-closed-stops-code-landings）：取值轴与阻断轴解耦 —— RED 照报
//    + 落 ledger 但不 exit 1；默认模式仍 fail-closed。对照 = 同一 fixture 跑两种模式，两半都能取假。
import { test, after } from "node:test";
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
  readNonBlockLedger,
  windowBounds,
} from "../scripts/gate-event-coverage-check.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHECKER = path.join(HERE, "..", "scripts", "gate-event-coverage-check.ts");

// 每个 fixture 仓登记在册，after() 一次性清掉 —— mkdtemp 不配对清理会被 tmp-leak-pairing-check
// 判红、并被 test-isolation-check 的 AC5 单向棘轮判为「新引入的违规」（实测）。
const made = [];
after(() => {
  for (const d of made) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* best-effort：清理失败不该把测试判成红的 */
    }
  }
});

/** 一个真 git 仓 + 真 carrier 的最小 fixture（⛔ 不 mock git：本检查的读数全部来自 git 与载体）。 */
function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gec-"));
  made.push(root);
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
  // ⚠️ 每个时刻都从 D2（墙钟算出的「2 天前」）派生，⛔ 一个日历字面量都不写。写成字面量会与
  //    commitAt 的墙钟日期错位，而覆盖判据是 `e.ts >= l.ts - 60s` ⇒ 过了某个午夜之后它**结构上必然**
  //    恒假、测试恒红。实测 2026-09-15 本轮就是这样红的：落地提交在 09-13、事件却钉死在 09-12。
  //    这是硬规则 4 推论二的日历版——「恰好等于今天/昨天」的字面量不是常量，是会过期的宿主依赖。
  // ⚠️ 两条落地必须**不同时**：t-2 的落地要晚于 t-1 的**事件**。否则 INJECT 删掉 t-2 事件后，
  //    它的落地会落进 bootstrap 豁免（`l.ts < cutoff`，cutoff 由仍存活的 t-1 事件给出）
  //    ⇒ 下面那条负控制退化成恒绿（硬规则 4c 的第二种失败形态）。
  const cases = [
    { id: "t-1", at: `${D2}T08:00:00Z`, ev: `${D2}T08:05:00Z` },
    { id: "t-2", at: `${D2}T10:00:00Z`, ev: `${D2}T10:05:00Z` },
  ];
  for (const { id, at, ev } of cases) {
    writeTask(root, id, "ready");
    commitAt(git, "seed", at);
    writeTask(root, id, "done");
    commitAt(git, `tasks: 翻 ${id} done（driver 机械 fan-in）`, at);
    writeEvent(root, id, ev);
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
  assert.deepEqual(parsed.days[0].exempt, [], "⛔ 不得落进 bootstrap 豁免——落进去这条负控制就恒绿了");
});

// ── --no-block: 取值轴与阻断轴解耦 (gap-coverage-miss-fail-closed-stops-code-landings AC3) ──────────
// 两半都必须能取假，故本组测试对**同一** fixture 跑两种模式：
//   默认 ⇒ exit 1（阻断轴默认开：证明被修的不是「判据不报红了」）
//   --no-block ⇒ exit 0 且 RED 仍打印 + 落 ledger（取值轴保留：证明被修的不是「把它改成不报」）
function runRaw(argv) {
  try {
    const out = execFileSync("node", ["--no-warnings", "--experimental-strip-types", CHECKER, ...argv], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: (e.stdout ?? "").toString(), err: (e.stderr ?? "").toString() };
  }
}

/** 两条落地、t-2 晚于 cutoff 且无事件 ⇒ 一条历史覆盖缺口（RED）。返回该 fixture。 */
function makeGapRepo() {
  const { root, git } = makeRepo();
  const cases = [
    { id: "t-1", at: `${D2}T08:00:00Z`, ev: `${D2}T08:05:00Z`, has: true },
    { id: "t-2", at: `${D2}T10:00:00Z`, ev: `${D2}T10:05:00Z`, has: false },
  ];
  for (const { id, at, ev, has } of cases) {
    writeTask(root, id, "ready");
    commitAt(git, "seed", at);
    writeTask(root, id, "done");
    commitAt(git, `tasks: 翻 ${id} done（driver 机械 fan-in）`, at);
    if (has) writeEvent(root, id, ev);
  }
  return root;
}

const LEDGER_REL = path.join(".quay", "gate-event-coverage-nonblock-ledger.jsonl");

test("--no-block：同一 fixture 默认 exit 1（阻断轴默认开）、--no-block exit 0 且 RED 照报 + 落 ledger（取值轴保留）", () => {
  const root = makeGapRepo();

  // 半 1（阻断轴默认开，能取假）：默认模式下这条缺口**必须**仍 exit 1。
  const def = runChecker(root, ["--days", "3"]);
  assert.equal(def.code, 1, `默认模式必须仍 fail-closed，实得 ${def.code}：${def.out}`);

  // 半 2（取值轴保留，能取假）：--no-block 下不阻断，但判定**仍是 RED**（⛔ 不是被改成 pass）。
  const nb = runChecker(root, ["--days", "3", "--no-block"]);
  assert.equal(nb.code, 0, `--no-block 下 RED 不得阻断，实得 ${nb.code}：${nb.out}${nb.err ?? ""}`);
  const parsed = JSON.parse(nb.out);
  assert.equal(parsed.verdict, "red", "取值轴必须仍是 RED");
  assert.equal(parsed.noBlock, true);
  assert.equal(parsed.blocked, false);
  assert.deepEqual(parsed.days[0].uncovered, ["t-2"], "缺口必须仍被点名");

  // 持久载体：取值轴落 ledger（硬规则 9 —— 屏显会滚走，ledger 不会）
  const ledgerPath = path.join(root, LEDGER_REL);
  assert.ok(fs.existsSync(ledgerPath), "RED 必须落 ledger");
  const rows = fs
    .readFileSync(ledgerPath, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
  assert.deepEqual(rows.map((e) => e.task), ["t-2"]);
  assert.equal(rows[0].day, DAY);
  assert.ok(rows[0].sha, "ledger 条目须带落地 sha（可回溯到具体落地提交）");

  // 去重（grow-only、按 day|task）：同一缺口再跑一次不得重复记账
  const nb2 = runChecker(root, ["--days", "3", "--no-block"]);
  assert.equal(nb2.code, 0);
  assert.equal(fs.readFileSync(ledgerPath, "utf8").trim().split("\n").length, 1, "同一 day|task 不得重复记账");
});

test("--no-block gate 模式的**屏显**仍报出缺口（判定行 + UNCOVERED + NON-BLOCKING 标记都在日志里）", () => {
  const root = makeGapRepo();
  const g = runRaw(["--root", root, "--merge-target", "develop", "--days", "3", "--gate", "--no-block"]);
  assert.equal(g.code, 0, `gate --no-block 应 exit 0，实得 ${g.code}：${g.out}${g.err ?? ""}`);
  assert.match(g.out, /^RED:/m, "判定行必须仍打印 RED");
  assert.match(g.out, /UNCOVERED .*t-2/, "UNCOVERED 明细必须仍打印（这是「仍被报出」的屏显半边）");
  assert.match(g.out, /NON-BLOCKING \(--no-block\)/, "须有显式的非阻断标记，可搜索");
});

test("--no-block 不减损第三态：载体读不到仍 exit 3（⛔ 不被 --no-block 吞成 exit 0）", () => {
  const { root } = makeRepo(); // 无 .quay/gate-events.jsonl
  const r = runRaw(["--root", root, "--merge-target", "develop", "--all", "--no-block"]);
  assert.equal(r.code, 3, `--no-block 下读不到载体仍必须 exit 3，实得 ${r.code}`);
  assert.match(r.out + (r.err ?? ""), /NOT-EVALUATED/);
});

test("--no-block 不伪造 RED：全绿时不落 ledger、exit 0", () => {
  const { root, git } = makeRepo();
  writeTask(root, "t-g", "ready");
  commitAt(git, "seed", `${D2}T08:00:00Z`);
  writeTask(root, "t-g", "done");
  commitAt(git, "tasks: 翻 t-g done（driver 机械 fan-in）", `${D2}T08:00:00Z`);
  writeEvent(root, "t-g", `${D2}T08:05:00Z`);
  const r = runRaw(["--root", root, "--merge-target", "develop", "--days", "3", "--gate", "--no-block"]);
  assert.equal(r.code, 0);
  assert.match(r.out, /^PASS:/m);
  assert.ok(!fs.existsSync(path.join(root, LEDGER_REL)), "全绿不得写 ledger（--no-block 只在 RED 时记账）");
});

// ── 读侧：--no-block 台账的消费者 (gap-coverage-nonblock-ledger-has-no-consumer) ────────────────────
// 本次改动前这份台账**只有写者**：RED 落进一份没人打开的 jsonl，而 --no-block 下 run_checker 按
// exit 0 把 cost 行记成 `verdict:"pass"` ⇒ 取值轴只剩它 ⇒ 「有人报过」与「没人报过」同形（硬规则 9）。
// 下面每条断言都配一个「若它不成立结果会不同」的对照；三态是本组核心（硬规则 3b）：
//   读到 / 缺席 / 读不懂，三者必须两两不同形，且**只有第一种**才带「未处置条数」这个取值。

const ENTRY_AT = `${D2}T12:00:00.000Z`; // 记账时刻（写侧记这一条时，同任务**没有**晚于落地的 complete 事件）

function writeLedger(root, entries) {
  const p = path.join(root, LEDGER_REL);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
  return p;
}

function ledgerEntry(task, extra = {}) {
  return { day: DAY, task, sha: "deadbeef", coverage: 0.9, threshold: 95, at: ENTRY_AT, ...extra };
}

test("读侧 arm①：台账里有未处置条目 ⇒ 报出（枚举形态：未处置数 + day|task 清单，⛔ 不是布尔）", () => {
  const { root } = makeRepo();
  // 别的任务的一条已覆盖事件 —— 对照：它不该让本条目算「已处置」（按 task 匹配，⛔ 不是按时间全局匹配）
  writeEvent(root, "t-other", `${D2}T12:30:00.000Z`);
  writeLedger(root, [ledgerEntry("t-open")]);

  const r = readNonBlockLedger(root);
  assert.equal(r.evaluated, true, "读到台账 ⇒ evaluated:true");
  assert.equal(r.carrier, "read");
  assert.equal(r.entries, 1);
  assert.deepEqual(r.unresolved.map((e) => e.task), ["t-open"], "未处置清单必须点名具体任务");
  assert.equal(r.disposed, 0);
});

test("读侧 arm②（能取假）：同任务出现 ts ≥ 记账时刻的 complete 事件 ⇒ 该条目不再被报", () => {
  const { root } = makeRepo();
  writeEvent(root, "t-other", `${D2}T11:00:00.000Z`); // 让 gate-events 载体可读（与 t-open 无关）
  writeLedger(root, [ledgerEntry("t-open")]);
  // 前置半边：不加事件时必须**报出**（否则本测试恒绿、证明不了任何事）
  assert.equal(readNonBlockLedger(root).unresolved.length, 1, "前置：补贴事件前该条目必须被报出");

  writeEvent(root, "t-open", `${D2}T12:30:00.000Z`); // 记账之后补上的 complete 事件

  const r = readNonBlockLedger(root);
  assert.equal(r.evaluated, true);
  assert.equal(r.unresolved.length, 0, "已补上 complete 事件的条目不得再被报");
  assert.equal(r.disposed, 1);
});

test("读侧 处置下界（负控制）：同任务**早于**记账时刻的 complete 事件不得把条目判成已处置", () => {
  const { root } = makeRepo();
  writeLedger(root, [ledgerEntry("t-open")]);
  // 这条事件早于记账时刻 —— 写侧记这一条时它就已经存在、且当时没让它算 covered（半开边界 60s 外）
  // ⇒ 它必须**不能**让条目静默关闭。若把下界写成「同任务有任意 complete 事件」，本测试会变绿。
  writeEvent(root, "t-open", `${D2}T11:00:00.000Z`);

  const r = readNonBlockLedger(root);
  assert.equal(r.unresolved.length, 1, "早于记账时刻的事件不能算处置（否则每一条历史缺口都会被静默关闭）");
  assert.equal(r.disposed, 0);
});

test("读侧 arm③a：台账**缺席** ⇒ 独立的未评估取值（⛔ 不与「零未处置」同形）", () => {
  const { root } = makeRepo(); // 无 .quay/gate-event-coverage-nonblock-ledger.jsonl
  const r = readNonBlockLedger(root);
  assert.equal(r.evaluated, false, "载体缺席是未评估，⛔ 不是「查过且零未处置」");
  assert.equal(r.carrier, "absent");
  assert.equal(r.unresolved, null, "未评估时未处置清单必须是 null —— 空数组会被读成「查过且干净」");
  assert.match(r.reason, /NOT-EVALUATED/);
});

test("读侧 arm③b：台账存在但**全部**行不可解析 ⇒ 读不懂（独立取值，⛔ 不伪装成空台账）", () => {
  const { root } = makeRepo();
  fs.writeFileSync(path.join(root, LEDGER_REL), "not json at all\n{{{\n");
  const r = readNonBlockLedger(root);
  assert.equal(r.evaluated, false);
  assert.equal(r.carrier, "unreadable");
  assert.equal(r.unresolved, null);
  assert.equal(r.malformedLines, 2);
});

test("读侧 arm③c：gate-events 载体读不到 ⇒ 处置不可判 ⇒ 未评估（⛔ 不是「都处置了」）", () => {
  const { root } = makeRepo();
  writeLedger(root, [ledgerEntry("t-open")]); // 有台账，但没写任何 gate-events.jsonl
  const r = readNonBlockLedger(root);
  assert.equal(r.evaluated, false, "处置判不了 ⇒ 未评估；伪装成 0 条未处置会把缺口静默丢掉");
  assert.equal(r.unresolved, null);
  assert.match(r.reason, /NOT-EVALUATED/);
});

test("读侧 坏行不掩好行：坏行计数、好行照判（一行噪声不得把整份读数判成不可得）", () => {
  const { root } = makeRepo();
  writeEvent(root, "t-other", `${D2}T11:00:00.000Z`); // 让 gate-events 载体可读
  const p = writeLedger(root, [ledgerEntry("t-open")]);
  fs.appendFileSync(p, "half a line\n");
  const r = readNonBlockLedger(root);
  assert.equal(r.evaluated, true);
  assert.equal(r.malformedLines, 1);
  assert.equal(r.unresolved.length, 1);
  assert.equal(r.entries, 1);
});

test("读侧 CLI `--ledger`：exit 0 = 读到、exit 3 = 未评估（三态在退出码上也可区分）", () => {
  const { root } = makeRepo();
  writeEvent(root, "t-other", `${D2}T11:00:00.000Z`); // 让 gate-events 载体可读
  const missing = runRaw(["--root", root, "--ledger", "--json"]);
  assert.equal(missing.code, 3, "台账缺席 ⇒ exit 3（与「读到且零未处置」的 exit 0 不同形）");
  assert.equal(JSON.parse(missing.out).evaluated, false);
  assert.equal(JSON.parse(missing.out).carrier, "absent");

  writeLedger(root, [ledgerEntry("t-open")]);
  const read = runRaw(["--root", root, "--ledger", "--json"]);
  assert.equal(read.code, 0);
  const parsed = JSON.parse(read.out);
  assert.equal(parsed.evaluated, true);
  assert.deepEqual(parsed.unresolved.map((e) => e.task), ["t-open"]);
});
