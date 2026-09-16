// @test-group product
// gap-dashboard-goal-card-ac-denominator-includes-superseded-retired — 「AC 达成 X/Y」的分母只计
// 【在域】AC。旧口径 `acs.length` 把该 GOAL 下【所有】挂钩记录都算进分母，不管记录自己的 status，
// 于是已被取代/放弃（superseded/retired）的 AC 也占着分母 ⇒ 卡片高估待办量。
//
// 实测代价（2026-09-16）：GOAL-020 名下 10 条挂钩 AC，其中 AC-266/267/268 已裁定 superseded，
// 卡片显示「AC 达成 6/10」，读者据此得出「还有 4 个 AC 没翻」——真实待办只有 AC-274 一条。
//
// 在域集合 = {active, achieved, needs-human}，⛔ 不是本任务自己发明的口径：正本是
// plugin/scripts/goal-driver.ts 的 `inScopeAcsOf`（含人 2026-09-09 裁定 2 把 needs-human 计入、
// 裁定 3 把 draft 排除），且 goal-driver 自己的注释警告「口径分叉会重演 draft 三头不占」。
// draft 之所以【不在域】：它是一条等人裁定的提案，尚未生效（激活是人的动作）。
//
// 测试：
//   AC1 — 构造 fixture：一个 GOAL 下覆盖 active/achieved/needs-human/superseded/retired，
//         分母只计在域状态；⛔ superseded【和】retired 都必须被排除（只测 superseded 会漏掉
//         retired 这个同样真实存在、语义相同的终态——本任务最容易复发的坑）。
//   AC1 — 只带已退场记录的目标 ⇒ 分母 0（记录在案的已知后果，见谓词注释）。
//   AC2 — 负控制：无任何 superseded/retired 时，新分母与旧口径 `acs.length` 逐条一致。
//   AC3 — 真实生产 store：往一个真的 active GOAL 注入 superseded + retired 各一条，卡片的
//         达成数与分母一字不变（证明过滤器在真实数据形状上确实生效，不是只对 fixture 生效）。
//   AC4 — 进度条百分比与新分母同源：旧分母 25.0% 的位置必须变成 50.0%。
//   AC5 — 既有依赖旧口径的断言：已跑受影响的既有测试文件，无一因本改动变红（见提交信息）。
//   契约守卫 — ABI 的每个 GOAL_STATUS 都必须被显式分类；显示口径必须与 inScopeAcsOf 逐字一致。
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import { renderGoalCard, AC_ROLLUP_IN_DOMAIN_STATUSES } from "../src/serve-dashboard.ts";
import { handleGoalList } from "../src/serve-goal.ts";
import { GOAL_STATUSES } from "../src/abi.ts";
import { createGoalStore } from "../src/goal-store.ts";
import { makeTmpDir } from "../../../plugin/test/helpers/tmp-workspace.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const GOAL_DRIVER_SRC = path.join(REPO_ROOT, "plugin", "scripts", "goal-driver.ts");

// ── fixtures (renderGoalCard 只读 id/title/status/kind/goal/evidence) ─────────────────────────────

function goal(id, { status = "active", kind = "goal", title = `${id} title` } = {}) {
  return { id, title, status, kind, goal: undefined, evidence: undefined, supersedes: [], supersededBy: [], body: "" };
}

function ac(id, goalId, status) {
  return { id, title: `${id} title`, status, kind: "criterion", goal: goalId, criterion: "exit 0", expect: "", origin: "test", evidence: undefined, supersedes: [], supersededBy: [], body: "" };
}

const NOW = Date.parse("2026-09-06T00:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const OPTS = { cap: 3, staleMs: 7 * DAY, nowMs: NOW };

/** 进度条填充宽度百分比（"66.7"），无进度条时 null。锚在填充 div 自己的 style 上，
 *  故裸的容器 `width:100%` 不会被误匹配。 */
function progressBarWidthPct(html) {
  const m = html.match(/width:(\d+\.\d+)%;height:100%;background:var\(--color-positive-700\)/);
  return m ? m[1] : null;
}

/** 取某条 GOAL 那一行的「AC 达成 x/y」读数（"x/y"），取不到时 null。
 *  锚在 `/goal/<gid>"` 上，故不会被别的 GOAL 行或 activeCount 汇总误匹配。 */
function acRollupFor(html, gid) {
  const m = html.match(new RegExp(`/goal/${gid}"[\\s\\S]*?AC 达成 (\\d+)/(\\d+)`));
  return m ? `${m[1]}/${m[2]}` : null;
}

/** 测试侧【独立拼写】的在域集合——故意不 import 被测谓词，否则判据与被测实现同源、恒真。
 *  它必须与 AC_ROLLUP_IN_DOMAIN_STATUSES 一致（下面的口径守卫断言这一点）。 */
const IN_DOMAIN = new Set(["active", "achieved", "needs-human"]);
const OUT_OF_DOMAIN = new Set(["draft", "superseded", "retired"]);

// ── AC1 ──────────────────────────────────────────────────────────────────────────────────────────

test("AC1: 分母只计在域状态，superseded 与 retired 【都】被排除（⛔ 不只测 superseded）", () => {
  const goals = [
    goal("GOAL-001"),
    ac("AC-1", "GOAL-001", "achieved"),
    ac("AC-2", "GOAL-001", "active"),
    ac("AC-3", "GOAL-001", "needs-human"), // 在域：待裁定，未退场
    ac("AC-4", "GOAL-001", "superseded"),  // 已退场
    ac("AC-5", "GOAL-001", "retired"),     // 已退场
    ac("AC-6", "GOAL-001", "retired"),     // 第二条 retired：挡住"只排除一条"的实现
  ];
  const html = renderGoalCard(goals, OPTS);

  assert.match(html, /AC 达成 1\/3/, "分母 = 3 条在域（achieved + active + needs-human），分子 = 1");
  assert.doesNotMatch(html, /AC 达成 1\/6/, "旧口径 1/6（分母含 superseded/retired）必须消失");
  assert.equal(acRollupFor(html, "GOAL-001"), "1/3", "另一条取数路径给出同一读数");
  assert.equal(progressBarWidthPct(html), "33.3", "进度条 = 1/3 → 33.3%");
});

test("AC1: 把 retired 单独拎出来——只有 retired 的目标分母为 0，不被当成待达成", () => {
  const html = renderGoalCard(
    [goal("GOAL-001"), ac("AC-1", "GOAL-001", "retired"), ac("AC-2", "GOAL-001", "retired")],
    OPTS,
  );
  // 记录在案的后果（谓词注释里写明）：全部已退场 ⇒ 0/0，与「真正无 AC」同形。
  // 区分「有 N 条提案待裁定」与「什么都没有」是另一条载体（/goal 的 draft 横幅）的事，
  // ⛔ 不靠重新定义分母来解决——那会让卡片与 goal-driver 的达成判定口径分叉。
  assert.match(html, /AC 达成 0\/0/, "全部已退场 ⇒ 分母 0、分子 0");
  assert.equal(progressBarWidthPct(html), null, "分母 0 ⇒ 不渲染进度条（不出 NaN/Infinity）");
});

test("AC1: superseded + retired 混在 achieved 里，分子不受影响（只动分母）", () => {
  const html = renderGoalCard(
    [
      goal("GOAL-001"),
      ac("AC-1", "GOAL-001", "achieved"),
      ac("AC-2", "GOAL-001", "superseded"),
      ac("AC-3", "GOAL-001", "retired"),
    ],
    OPTS,
  );
  assert.match(html, /AC 达成 1\/1/, "1 条 achieved / 1 条在域 ⇒ 1/1");
  assert.equal(progressBarWidthPct(html), "100.0", "1/1 → 100.0%");
});

// ── AC2 负控制 ───────────────────────────────────────────────────────────────────────────────────

test("AC2 负控制：没有任何 superseded/retired 时，新分母与旧口径 acs.length 完全一致", () => {
  // 三种在域混合，逐个断言「新口径 == 旧口径」——证明本改动只是【排除了已退场】，
  // 不是引入了另一种偏差。
  const cases = [
    { acs: ["achieved", "achieved", "active"], want: "2/3" },
    { acs: ["active", "active"], want: "0/2" },
    { acs: ["achieved", "achieved", "achieved"], want: "3/3" },
    { acs: ["needs-human", "achieved", "active", "active"], want: "1/4" },
  ];
  for (const c of cases) {
    const records = [goal("GOAL-001"), ...c.acs.map((s, i) => ac(`AC-${i + 1}`, "GOAL-001", s))];
    const attached = records.filter((r) => String(r.goal ?? "") === "GOAL-001");
    const oldDenominator = attached.length; // 旧口径 = acs.length
    const newDenominator = attached.filter((r) => IN_DOMAIN.has(r.status)).length;
    assert.equal(
      newDenominator,
      oldDenominator,
      `负控制前提：这组输入里没有任何已退场记录，两个口径必须相等（${c.acs.join(",")}）`,
    );
    const html = renderGoalCard(records, OPTS);
    assert.match(html, new RegExp(`AC 达成 ${c.want.replace("/", "\\/")}`), `新口径读数 ${c.want}`);
    // 旧口径的分母与之一致 ⇒ 旧口径的读数必须与渲染结果逐字相同（不可能"新旧不同但都对"）
    const oldWant = `${c.acs.filter((s) => s === "achieved").length}/${oldDenominator}`;
    assert.equal(c.want, oldWant, `在负控制带上，新旧口径读数必须逐字相同（${c.want} vs ${oldWant}）`);
  }
});

test("AC2 负控制：纯 achieved/active 的目标，卡片读数与改动前逐字一致", () => {
  // 这正是 package 里既有测试用的输入形状（见 gap-dashboard-goal-card-ac-progress-bar /
  // -provider-backed），所以既有断言不受本改动影响——AC5 的实测结论与此互证。
  const html = renderGoalCard(
    [goal("GOAL-001"), ac("AC-170", "GOAL-001", "achieved"), ac("AC-171", "GOAL-001", "active"), ac("AC-172", "GOAL-001", "achieved")],
    OPTS,
  );
  assert.match(html, /AC 达成 2\/3/, "与既有 provider-backed AC5 断言的 2/3 相同形状");
  assert.equal(progressBarWidthPct(html), "66.7", "与既有 progress-bar AC1 断言的 66.7 相同");
});

// ── AC4 进度条与新分母同源 ───────────────────────────────────────────────────────────────────────

test("AC4: 进度条百分比用新分母 —— 旧分母下的 25.0% 必须变成 50.0%", () => {
  const goals = [
    goal("GOAL-001"),
    ac("AC-1", "GOAL-001", "achieved"),
    ac("AC-2", "GOAL-001", "active"),
    ac("AC-3", "GOAL-001", "superseded"),
    ac("AC-4", "GOAL-001", "retired"),
  ];
  const html = renderGoalCard(goals, OPTS);
  const pct = progressBarWidthPct(html);
  assert.equal(pct, "50.0", "1 achieved / 2 在域 → 50.0%");
  assert.notEqual(pct, "25.0", "旧分母 1/4 = 25.0% 必须消失——⛔ 不能一处新口径、一处旧口径");
  assert.match(html, /AC 达成 1\/2/, "同一行的纯文本读数与进度条同一分母");
});

// ── AC3 真实生产 store ───────────────────────────────────────────────────────────────────────────

test("AC3: 真实 store 上，给一个真 active GOAL 注入 superseded+retired，达成数与分母一字不变", () => {
  const store = createGoalStore(path.join(REPO_ROOT, "goals"));
  const live = store.list();

  // 前提作为【读数】而不是假设（硬规则 12）：没有 active GOAL 则这条读数无意义。
  const liveActive = live.filter((r) => r.kind === "goal" && r.status === "active");
  assert.ok(liveActive.length > 0, `precondition: 真实 store 有 ${liveActive.length} 个 active GOAL，本读数才有对象`);

  const gid = String(liveActive[0].id);
  const before = acRollupFor(renderGoalCard(live, { cap: 3, staleMs: 7 * DAY, nowMs: NOW }), gid);
  assert.ok(before != null, `precondition: 真实 store 的 ${gid} 渲染出了一行「AC 达成 x/y」`);

  const attachedLive = live.filter((r) => String(r.goal ?? "") === gid);
  const inDomainLive = attachedLive.filter((r) => IN_DOMAIN.has(r.status)).length;
  assert.equal(before, `${attachedLive.filter((r) => r.status === "achieved").length}/${inDomainLive}`,
    `${gid} 的真实读数必须等于「在域内的 achieved / 在域总数」（此刻 live 数据：${before}）`);

  // 两次注入：⛔ 分别注一条 superseded 与一条 retired —— 独立的两个终态都要挡住。
  const injected = [
    ...live,
    ac("AC-SYNTH-SUP", gid, "superseded"),
    ac("AC-SYNTH-RET", gid, "retired"),
  ];
  const after = acRollupFor(renderGoalCard(injected, { cap: 3, staleMs: 7 * DAY, nowMs: NOW }), gid);

  assert.equal(after, before, `注入 2 条已退场记录后 ${gid} 的读数必须一字不变（${before} → ${after}）`);
  const attachedInjected = injected.filter((r) => String(r.goal ?? "") === gid);
  const denominatorAfter = Number(after.split("/")[1]);
  assert.ok(
    denominatorAfter < attachedInjected.length,
    `分母必须【严格小于】挂钩记录数——这条读数才证明过滤器在真实数据上生效（分母 ${denominatorAfter} vs 挂钩 ${attachedInjected.length}）`,
  );
  assert.equal(
    denominatorAfter,
    attachedInjected.filter((r) => IN_DOMAIN.has(r.status)).length,
    "分母 == 在域条数（用测试侧独立拼写的集合重算，不是调用被测谓词）",
  );
});

// ── 同一口径的第二个消费面：/goal Goals tab 的「AC 达成」列 ──────────────────────────────────────
// 硬规则 5b：修好一个实例不等于它只存在于那一处。`serve-goal.ts` 的 rollupFor 自述是
// 「renderGoalCard's own formula」——同一个数、同一个 GOAL，只修卡片会让两个面并排显示 6/7 与 6/10。

test("兄弟面：/goal Goals tab 的「AC 达成」列用同一口径（旧口径 1/4 必须变成 1/2）", async () => {
  const records = [
    { id: "GOAL-001", title: "g", status: "active", kind: "goal", body: "" },
    { id: "AC-1", title: "c", status: "achieved", kind: "criterion", goal: "GOAL-001", criterion: "exit 0", body: "" },
    { id: "AC-2", title: "c", status: "active", kind: "criterion", goal: "GOAL-001", criterion: "exit 0", body: "" },
    { id: "AC-3", title: "c", status: "superseded", kind: "criterion", goal: "GOAL-001", criterion: "exit 0", body: "" },
    { id: "AC-4", title: "c", status: "retired", kind: "criterion", goal: "GOAL-001", criterion: "exit 0", body: "" },
  ];
  const client = { goalList: async () => records, taskList: async () => ({ tasks: [], malformed: [] }) };
  const res = {
    statusCode: 0, headers: {}, body: "",
    writeHead(code, headers) { this.statusCode = code; this.headers = headers; },
    end(body) { this.body = body || ""; },
  };
  await handleGoalList({}, res, new URL("http://localhost/goal"), client, makeTmpDir("ac-rollup-goal-"));

  assert.equal(res.statusCode, 200, "Goals tab 正常渲染");
  const m = res.body.match(/class="ac-rollup"><a [^>]*>(\d+)\/(\d+)</);
  assert.ok(m, "Goals tab 的 AC 达成 单元格必须渲染出来（取不到 ⇒ 判据没读到输入，硬规则 3b）");
  assert.equal(`${m[1]}/${m[2]}`, "1/2", "该列分母同样排除 superseded/retired（旧口径会是 1/4）");
  assert.equal(
    `${m[1]}/${m[2]}`,
    acRollupFor(renderGoalCard(records, OPTS), "GOAL-001"),
    "卡片与 Goals tab 列【必须同一读数】——口径分叉就是本任务要修的那个缺陷的另一半",
  );
});

// ── 契约守卫 ─────────────────────────────────────────────────────────────────────────────────────

test("契约守卫：ABI 的每个 GOAL_STATUS 都被显式分类（新增第 7 个状态会在此报红，⛔ 不静默落进某一桶）", () => {
  const unclassified = GOAL_STATUSES.filter((s) => !IN_DOMAIN.has(s) && !OUT_OF_DOMAIN.has(s));
  assert.deepEqual(
    unclassified,
    [],
    `这些 ABI 状态在显示口径里既没被算作在域、也没被排除：${unclassified.join(", ")}。` +
      "新增状态必须先决定它是否参与「AC 达成 X/Y」的分母，再改 AC_ROLLUP_IN_DOMAIN_STATUSES 与本测试的 OUT_OF_DOMAIN。",
  );
  assert.deepEqual(
    [...AC_ROLLUP_IN_DOMAIN_STATUSES].sort(),
    [...IN_DOMAIN].sort(),
    "被测谓词的在域集合必须与测试侧独立拼写的集合逐字一致",
  );
  for (const s of IN_DOMAIN) assert.ok(!OUT_OF_DOMAIN.has(s), `${s} 不得同时被算作在域又被排除`);
});

test("口径守卫：显示口径与 goal-driver inScopeAcsOf 的在域集合一致（口径分叉会重演 draft 三头不占）", () => {
  const src = fs.readFileSync(GOAL_DRIVER_SRC, "utf8");
  const fn = src.match(/export function inScopeAcsOf\([\s\S]*?\n\}/);
  assert.ok(
    fn,
    "在 goal-driver.ts 里定位不到 inScopeAcsOf —— 若确已重构，请先核对两侧口径再更新本守卫（⛔ 不得直接删掉本断言）",
  );
  const literals = [...fn[0].matchAll(/status === "([^"]+)"/g)].map((m) => m[1]);
  assert.ok(
    literals.length > 0,
    "在 inScopeAcsOf 体内找不到任何 status === \"...\" 比较 —— 本判据读不懂输入（硬规则 3b：不得把读不懂当作通过）",
  );
  assert.deepEqual(
    [...new Set(literals)].sort(),
    [...AC_ROLLUP_IN_DOMAIN_STATUSES].sort(),
    `显示口径与 goal-driver 的达成判定口径分叉了：inScopeAcsOf=${[...new Set(literals)].sort().join(",")} ` +
      `vs 显示=${[...AC_ROLLUP_IN_DOMAIN_STATUSES].sort().join(",")}`,
  );
});

test("逐状态穷举：只有 3 个在域状态进分母，其余一律不进（含缺 status / 非字符串）", () => {
  const rollupFor = (status) =>
    acRollupFor(renderGoalCard([goal("GOAL-001"), ac("AC-1", "GOAL-001", status)], OPTS), "GOAL-001");
  // 在域 ⇒ 分母 1（achieved 同时进分子，故单独断言）。
  assert.equal(rollupFor("active"), "0/1", "active 计入分母");
  assert.equal(rollupFor("achieved"), "1/1", "achieved 计入分母且计入分子");
  assert.equal(rollupFor("needs-human"), "0/1", "needs-human 计入分母、不入分子（待裁定 = 未达成）");
  // 不在域 ⇒ 分母 0。
  for (const s of ["draft", "superseded", "retired"]) {
    assert.equal(rollupFor(s), "0/0", `${s} 不计入分母`);
  }
  // 缺 status / 非字符串：正向成员制 ⇒ 不在域（与 inScopeAcsOf 的 `status === "..."` 形状同源）。
  for (const weird of [undefined, null, 42, {}]) {
    assert.equal(rollupFor(weird), "0/0", `${String(weird)} 不在域`);
  }
});
