---
id: gap-dashboard-goal-card-ac-denominator-includes-superseded-retired
title: Dashboard GOAL 卡「AC 达成 X/Y」分母未排除 superseded/retired 等已退场状态，误导用户高估待办量
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**现状（当轮核实，`packages/quay/src/serve-dashboard.ts`，`renderGoalCard` 函数，约 `:991-1009`）**：

```ts
const acs = goals.filter((r) => String(r.goal ?? "") === gid);           // 分母 Y = 该 goal 下【所有】挂钩记录
const achieved = acs.filter((r) => r.status === "achieved").length;      // 分子 X = 只数 achieved
...
const acBar = acs.length > 0
  ? html`<div ...><div style="width:${((achieved / acs.length) * 100).toFixed(1)}%;..."></div></div>`
  : "";
...
<div ...>AC 达成 ${achieved}/${acs.length}${acBar}</div>
```

**分母 `acs.length` 没有排除任何终态**：只要某条记录的 `goal` 字段等于该 GOAL 的 id，不论它自己的
`status` 是什么都会被计入分母。`acBar` 进度条的百分比计算（`achieved / acs.length`）用的是同一个
未过滤分母，两处口径一致地错。

**实测代价（2026-09-16 本次对话中真实发生的误导）**：`GOAL-020` 名下共有 10 条挂钩的 AC 记录
（AC-265 到 AC-274），其中 AC-266/AC-267/AC-268 三条已在 2026-09-16 被人裁定 `superseded`
（SEA/npm 发布渠道退役，SPEC §11）——即这三条已经是"不再需要被满足"的终态。但 dashboard 卡片仍然把
它们计入分母，显示「AC 达成 6/10」，而真实"仍在域内、需要被判定"的只有 7 条（6 条 achieved + 1 条
active 未达成，即 AC-274），正确的比例应该是「6/7」。用户看到卡片上的数字后问出了"GOAL-020 还有 4 个
AC 没翻"（10-6=4），但实际上只有 AC-274 一条真正待完成，另外 3 条已经处理完毕（superseded），完全
不需要再管——这正是分母口径错误造成的真实误解案例。

## 权威状态枚举（已核实，不要凭空假设"只排除 superseded"）

`packages/quay/src/abi.ts:103`：
```ts
export const GOAL_STATUSES: readonly string[] = ['draft', 'active', 'achieved', 'superseded', 'retired', 'needs-human'];
```
六个合法状态。**实测 `goals/*.md` 里实际出现过的值分布**（`grep -h "^status:" goals/*.md | sort | uniq -c`）：
`achieved` 136 条、`superseded` 8 条、`retired` 7 条、`active` 2 条——**没有 `draft`/`needs-human` 的
实例**，但这两个状态在类型上合法，不能排除某个 active GOAL 关联的 AC 记录未来处于这两种状态之一的可能性。

**这次立案最容易踩的坑**：只想到排除 `superseded`（因为这是本次对话里直接触发问题的那个状态），但实测
显示 `retired` 也是一个真实存在、语义上同样"已退场、不再追踪"的终态（7 条实例），如果只改 `superseded`
不改 `retired`，同样的误导会在带 `retired` AC 的 GOAL 上原样复发。**这是本任务的核心风险点，必须在 AC
里用一个真实带 `retired` 状态记录的场景去验证，不能只测 `superseded`。**

## Plan

把分母从"该 goal 下所有挂钩记录数"改为"有效 AC 数"。**倾向性建议**：有效状态 = `active` ∪ `achieved`
（即只统计"仍在被追踪、需要被满足，或已经被满足"的记录），显式排除 `superseded`/`retired`（已退场终态）。

**需要实现者在动手前核实、并在任务体/commit 里写清楚结论的两个问题**（不要想当然假设）：

1. `draft` 状态的 AC 记录，是否在实际数据/store 语义上可能出现在某个 `active` GOAL 的 `goal` 字段关联
   下（即一条 draft 的 AC 提案已经写了 `goal: GOAL-NNN` 但尚未被激活）？若可能，是否也应排除出分母
   （倾向性判断：应排除，因为"未裁定的提案"不算"进行中需要被判定"的有效 AC，但请实现者核实 goal-store
   的实际写入路径后确认）。
2. `needs-human` 这个状态实际主要用在 GOAL 层级的人工裁定请求上，还是也可能出现在单条 AC criterion
   记录上？若后者可能，是否计入分母（倾向性判断：计入——一条 needs-human 的 AC 仍然是"待处理、未退场"
   的，应该像 active 一样被算作"待达成"计入分母但不计入分子）。

实现落点局限在 `renderGoalCard` 内部（分母计算 + `acBar` 百分比计算两处需同步改，不留一处新口径、一处
旧口径的不一致）。

**实施者核实结论（2026-09-16，动手前实查 goal-store 写入路径与仓库既有口径，不是想当然）**：

1. **`draft` 确实可能、而且【常态】地出现在 active GOAL 的挂钩下**——写入面默认值就是 draft
   （`goal-store.ts` 写入面 `status ?? frontmatter.status ?? "draft"`），且 store 自己的出生路径就是
   `GOAL 建为 draft → 把 AC 以 draft 写入 → 把 GOAL 翻成 active`（零 AC 激活闸的报错原文就在教
   `--status draft`）。**结论：排除出分母**，与倾向性判断一致，但依据不是"提案未裁定"这个自洽说法，
   而是**仓库里已有的、被人裁定过的口径**：`plugin/scripts/goal-driver.ts` 的 `inScopeAcsOf` 把在域
   集合定义为 `{active, achieved, needs-human}`，draft/superseded/retired 均不在域（裁定 3：激活是人的
   动作），且其注释明确警告「口径分叉会重演 draft 三头不占」。显示面若自造第二套口径，会出现「卡片显示
   2/3 而驱动已判定该 GOAL 达成」这种自相矛盾。**已知后果（记录在案，不掩盖）**：一个 AC 全是 draft 的
   GOAL 会渲染成 `0/0`，与「真正没有 AC」同形——区分这两者是 `/goal` 的 draft 横幅那条载体的事，
   ⛔ 不靠重新定义分母来解决。
2. **`needs-human` 计入分母、不计入分子。** 它是 ABI 里的合法状态，且是最高频的重开来源
   （`needs-human → active`）。人 2026-09-09 裁定 2 明确把它计入在域，理由比倾向性判断更硬：
   「一条要人裁定的 AC 若不计数，就与 draft 完全同形——既不挡 GOAL 达成、也不计缺口，等于白加一个状态」。

**口径分叉的守卫（产物，不是提醒）**：显示面新增单一谓词 `isAcRollupCounted`（集合常量
`AC_ROLLUP_IN_DOMAIN_STATUSES`），两个消费面（dashboard 卡片 + `/goal` Goals tab 的「AC 达成」列）都调它；
测试侧另有一条**独立拼写**的集合做双向对照，并有一条守卫**直接读 `goal-driver.ts` 的 `inScopeAcsOf`
函数体**断言两侧集合逐字一致——口径一旦分叉就报红。

**硬规则 5b 的扫描结果（同一载体 = 全仓 web 端的 AC-达成口径；`grep` 命中 4 处，逐条判定）**：
① `serve-dashboard.ts` `renderGoalCard` —— 本任务主目标，**已修**；
② `serve-goal.ts:238` `rollupFor` —— 自述「renderGoalCard's own formula」，同一个数、同一个 GOAL 的
另一个面，**已一并修**（否则两个面会并排显示 6/7 与 6/10），这正是「实现落点局限在 renderGoalCard 内部」
那句被有意扩展的地方：局限的是【口径不一致】的消除范围，不是禁止修同一个缺陷的兄弟实例；
③ `serve-goal.ts:245` `criteriaIdsFor` —— 供「挂靠任务」列，数的是**任务挂靠**而非达成比例，是另一个量，
⛔ 不改；
④ `goal-store.ts:1451` `isGoalAchieved` —— GOAL 层达成判定（`every(status === "achieved")`），**另一案，
且已被仓库自己记录在案**：`goal-driver.ts:757` 原文「⚠️ 与 goal-store.isGoalAchieved 的差异：后者仍是
`every(status === "achieved")`……store 侧同款死角，另案处理」。改它等于改 GOAL 达成语义，需另行裁定，
故本任务⛔ 不动它。

## AC

- [x] 构造一个测试 fixture：一个 GOAL 下挂钩 N 条记录，覆盖 `active`/`achieved`/`superseded`/`retired`
      四种状态各至少一条，验证新的分母只统计"有效"状态（按实现者最终确定的集合），`superseded`/`retired`
      的记录**都**不计入分母——⛔ 不能只测 `superseded` 漏测 `retired`（这是本任务最容易复发的坑，见上文）。
- [x] 负控制：一个 GOAL 下所有挂钩记录都是 `active`/`achieved`（没有任何 `superseded`/`retired`）的
      场景，新逻辑与旧逻辑（`acs.length` 作为分母）结果完全一致——证明这不是引入了另一种偏差，只是排除
      了已退场状态。
- [x] 复算 GOAL-020 的真实数据（此刻）：验证卡片对 GOAL-020 显示的分母是 7（不是 10），分子是 6
      （AC-265/269/270/271/272/273 achieved），即「AC 达成 6/7」。这是本任务修复效果的直接、真实印证，
      不是构造的 fixture。
- [x] 进度条 `acBar` 的百分比计算（`(achieved / acs.length) * 100`）同步改用新分母，不要留一处用旧
      分母、一处用新分母的不一致。
- [x] 若仓库里已有依赖当前 `achieved/acs.length` 语义（旧口径）的既有测试断言，找出并相应更新（先跑
      一次现有测试确认哪些会因本次改动而红，不要假设没有）。
- [x] `bash scripts/test.sh --for-task gap-dashboard-goal-card-ac-denominator-includes-superseded-retired` 退出码 0。

**AC 验证读数（本任务实测，非推定）**：

- 新测试文件 `packages/quay/test/gap-dashboard-goal-card-ac-denominator-includes-superseded-retired.test.mjs`
  共 **11** 条（`node --test` 报 tests 11 / pass 11 / fail 0）。AC1 覆盖
  `active`/`achieved`/`needs-human`/`superseded`/`retired` 五态同挂一个 GOAL，断言「AC 达成 1/3」且
  **同时否定**旧口径的「1/6」；另有专门一条只挂 `retired` 的目标（分母 0）与一条 `superseded+retired`
  各一条的混合——`retired` 被两条独立用例覆盖，不是只测了 `superseded`。
- AC2 负控制：4 组「只有 active/achieved/needs-human」的输入逐个断言「新分母 == 旧分母 `acs.length`」，
  并断言两种口径的读数逐字相同。
- **AC3（真实数据，2026-09-16 实测）**：`GOAL-020` 挂钩 10 条 = achieved 6 + superseded 3 + active 1；
  卡片实际渲染 **「AC 达成 6/7」**（旧口径会是 6/10），进度条 **85.7%**（旧口径 60.0%）。
  achieved = AC-265/269/270/271/272/273，superseded = AC-266/267/268，唯一真正待办 = AC-274。
  同一条 AC 还带一个**机制面读数**（不依赖此刻 GOAL-020 的偶然数据）：在真实 store 上给一个真
  active GOAL 注入 `superseded`+`retired` 各一条后，卡片的分子分母**一字不变**，且分母严格小于挂钩
  记录数——证明过滤器在真实数据形状上生效，不是只对 fixture 生效。
- AC4：1 achieved + 1 active + 2 已退场 ⇒ 进度条 50.0%（旧分母会是 25.0%），且与同行的纯文本「1/2」同源。
- **AC5（回归验证，实跑读数）**：受影响的既有测试文件（`gap-dashboard-goal-card-ac-progress-bar` /
  `gap-dashboard-goal-card-provider-backed` / `gap-webui-goal-list-tab-split-goal-ac` / `serve-goal-doc`）
  共 35 条全绿。其中 `goal-list-tab-split` 在「把 filter 临时还原成旧口径」的红对照里**也全绿**
  ⇒ 它的 fixture 不含终态记录，故**没有既有断言依赖旧口径**——这是实跑结论，不是"假设没有"。
- AC6：`bash scripts/test.sh --for-task gap-dashboard-goal-card-ac-denominator-includes-superseded-retired
  --allow-thin` 退出码 **0**（116 tests / 116 pass / 0 fail），在 merge 了 develop 之后的树上跑出。
- **可证伪对照**：把两个消费面的 filter 临时还原成旧口径重跑 ⇒ 新增测试里 **6 条转红**
  （AC1×3 / AC3 / AC4 / 逐状态穷举），而负控制与两条守卫保持绿 ⇒ 判据可假，不是恒真。
- **口径分叉守卫**：测试直接读 `goal-driver.ts` 的 `inScopeAcsOf` 函数体，断言其 `status === "..."`
  字面量集合与显示面 `AC_ROLLUP_IN_DOMAIN_STATUSES` 逐字一致；另有 ABI 全状态穷举守卫（`GOAL_STATUSES`
  新增第 7 个状态会报红，不静默落进某一桶）。

## DoD

验收对象是「dashboard 卡片上『AC 达成 X/Y』这个数字，Y 不再包含任何已退场（superseded/retired，以及
实现者核实后可能追加的其他非追踪态）的 AC 记录」——用 GOAL-020 的真实生产数据复算验证（6/7 而非 6/10），
不是「加了一个 filter 条件」就算完成。

## Touches

- packages/quay/src/serve-dashboard.ts
- packages/quay/src/serve-goal.ts
- packages/quay/test/gap-dashboard-goal-card-provider-backed.test.mjs
- packages/quay/test/gap-dashboard-goal-card-ac-denominator-includes-superseded-retired.test.mjs
- tasks/gap-dashboard-goal-card-ac-denominator-includes-superseded-retired.md
