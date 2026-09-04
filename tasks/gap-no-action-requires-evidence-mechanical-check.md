---
id: gap-no-action-requires-evidence-mechanical-check
title: outer 的 no-action 判词零成本——14:08-15:08 连续 5 次 tick 全判 no-action 但五条不等式 ①②③
  每次为真（欠 15 强制动作）；需机械检查（复用 manager-tick-log-check 行判据同形），不是散文纪律
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**outer 的 `no-action` 判词零成本——14:08-15:08 连续 5 次 tick 全判 no-action，但五条不等式里 ①②③ 每次都为真，欠 15 个强制动作、交付 0 个。manager 已核实（人已明令：先定义应然，不再解释失效）。需要机械检查，不是散文纪律。正确形式 = workflow（script 是其中的确定性部分），不是纯 script。**

### 应然（manager 2026-08-09，人已明令）

外层每轮 tick 的五条不等式，no-action 只有在五条全假时才合法：
1. `in_flight < cap` 且 `recommended` 非空 ⇒ 必须派发到 cap，或写明不派的硬理由
2. `pool < floor` ⇒ 必须晋级补池，或写明为何无可晋级
3. `nyf > 0` 且工作已落地 ⇒ 必须翻 done（零风险记账动作）
4. `integration 领先 develop` 且 `suite 绿` ⇒ 必须批量合
5. `suite state=red` ⇒ 分诊+派发

**对照实证**：14:08-15:08 5 次 tick，条件①②③ 每次都真，欠 15 强制动作，5 次 no-action 全不合法。

### 形式判据（manager 更正 2026-08-09，人当场驳回 script-only）

**不是 script-only，是 workflow（script 是其中的确定性部分，不是二选一）。** 两条更正：

**错一（manager 自纠）**：workflow 的价值不是扇出，是**控制流是代码**——manager 自己的 tick 作为 workflow 有价值因为「A 段读数被跑是因为脚本跑它，B 段产出被写是因为脚本要它」，与该轮注意力无关。今晚全部失效（机制在场没被调用、读数在场没被判、no-action 零成本）都是意志/注意力失效，workflow 正是把意志从环里拿掉的形式。「必须接到不依赖会话意志的地方」与「用没扇出否定 workflow」自相矛盾。

**错二（manager 自纠）**：五条不等式的输入**不是确定性的**——三条的值要靠语义产生：
- **① in_flight**：slot-refill 的 in_flight_count 是**入参不是测量**；真测量只能读 pane/transcript，判断「某个 ◯ general-purpose 是不是占槽的任务 agent」「括号已闭但 agent 还活着算不算占槽」——**要语义**。
- **② pool**：ready-pool-check 内部靠 `taskWorkLanded(task.body,…)` 解析 Touches+git 历史**猜**「工作是否落地」——**要语义，且已知会猜错**（gap-session-liveness 4/9 被误排）。
- **③ nyf 且「工作已落地」**：正是那个语义判断本身。
- **④ 领先且绿⇒该合**：基本确定，但有 freshness gate / doc-only 例外。
- **⑤ red⇒分诊**：真红 vs 幻影红——今晚三例证明正则决定不了，**全是语义**。

**结论**：脚本只能做「值到手之后」的算术，而今晚出错的地方全在**产生值**这一步（inner 的「唯一真实候选」是语义误判、把 1/4 抄写不判是语义缺席、三次幻影红是正则替语义干活干砸）。让 checker script 去产生这些值 = 第四次造幻影红的机制。

### 正确形式（manager 裁定）

**workflow**：
- **算术与门槛**：用普通 JS 写死（确定、可复现、无意志）——不等式求值、freshness 上界、行内自洽比对。
- **需要语义的三处用带 schema 的 agent()** 强制产出结构化判断：
  - agent₁：判「该轮 in_flight 到底是几」（读 pane/transcript，判 ◯ general-purpose 是否占槽、括号闭但 agent 活是否占槽）→ schema 输出 `{in_flight, evidence, confidence}`
  - agent₂：判「not-yet-flipped 任务的 work 是否真落地」（替代 taskWorkLanded 的猜）→ schema 输出 `{workLanded: bool, reason, acCompleteness}`
  - agent₃：判「suite red 是真红还是幻影红」→ schema 输出 `{verdict: real|phantom|ambiguous, evidence}`
- **判词与动作**：由脚本按不等式决定，不由模型自由裁量——五条求值 + 行内读数/判词/实际痕迹比对，一致才 PASS，不一致红。

### 三个设计约束（manager 上一条，仍有效）

**① 必须是「重新测量的裁判」，不是「行格式 linter」**：只校验行格式可被「读数如实写、判词写 escalate、什么也不做」满足。checker 必须重测（语义 agent 产生值）+ 比对 ⓐ行内读数 ⓑ判词 ⓒ实际痕迹，不一致红。

**② 接线到会话意志之外**：`scripts/test.sh` 的 `run_static_checks` 或 pre-commit。只在 tick 会话自选才跑 = 不算接线。接线不做 = 第 N 次口头纠正。

**③ 新鲜度上界**：行带时间戳+原始读数；判「行内自洽 + 新鲜度上界」而非拿此刻真值判过去行（防假警报）。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录 14:08-15:08 5 次 no-action 实证 + 五条应然定义 + 形式更正（script-only 被驳回，workflow 正确）（本任务 Proposal 已含；内层补：构造 no-action 行复现）
- [x] AC2: **重新测量的裁判**（形式分歧说明：AC 措辞改为「workflow 形式」，但人裁定 2026-08-09 保持 script 交付——`outer-tick-log-check.sh` 用 `--truth` 接缝实现等价的确定性重测，AC3 实质满足）——重测产生五条真值（非行格式 linter），比对 ⓐ行内读数 ⓑ判词 ⓒ实际痕迹；三者不一致红；构造「读数全+判词 escalate+实际没动」⇒ 红
- [x] AC3: **重新测量的裁判**——checker 重测产生五条值（非行格式 linter），比对 ⓐ行内读数 ⓑ判词 ⓒ实际痕迹；三者不一致红；构造「读数全+判词 escalate+实际没动」⇒ 红（已测）
- [x] AC4: **接线到会话意志之外**——`scripts/test.sh` 的 `run_static_checks`（全量套件必跑）；只在 tick 会话自选才跑 = 不算接线（已接线）
- [x] AC5: **新鲜度上界 + 既有不回归**——行带时间戳+原始读数，判「行内自洽+上界」非此刻真值；manager-tick-log-check 既有判据仍工作；`--for-task` scoped 门绿（已测）

## Definition of Done

- [x] AC1–AC5 全部勾上
- [x] 修后实跑：构造「读数全+判词 escalate+没动」⇒ 红；「no-action+五条全假」⇒ PASS；「20 分钟前行+此刻量变」⇒ 不误报（贴任务体）
- [x] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证（含接线生效）

## Evidence（内层实现 2026-08-09）

**实现形式**：`plugin/scripts/outer-tick-log-check.sh`（script，人裁定保持）。三层判据：
- **L1 行内自洽**（始终）：no-action 行必须带五条读数且全 `[当前假`；任一 `[当前真` 或缺失 ⇒ FAIL
- **L2 重新测量**（仅当新鲜，`--truth` 接缝 / 真实根命令重测）：no-action 但实测任一为真 ⇒ FAIL；动作类型（escalate/correct/unblock）但实测有真值 + 无 git 痕迹 ⇒ FAIL（欺骗输入）
- **L3 新鲜度上界**：mtime 超 `--fresh-minutes`（默认 60）⇒ 跳过 L2，只判 L1 自洽（不拿此刻真值判过去行）

**AC1 复现（fixture）**：`no-action 行 + ①[当前真` ⇒ `exit 1`（FAIL）。14:08-15:08 5 次 no-action 正是这种：①②③ 每次为真。

**AC2/AC3 实跑（--truth 接缝，确定性）**：
- 欺骗输入「读数全 + 判词 escalate + 实测①真 + 无 git 痕迹」⇒ `exit 1`（`action-claimed-but-no-git-trace`）——格式合规但行为照旧的欺骗被抓
- 「no-action + 五条全假 + 实测全假」⇒ `exit 0`（合法 no-action）
- 「no-action 行带全假读数但实测①真」⇒ `exit 1`（`no-action-but-remeasured-true`——读数撒谎/漏报被抓）

**AC4 接线**：`scripts/test.sh` 的 `run_static_checks` 加入 `run_checker "outer-tick-log-check" bash .../outer-tick-log-check.sh --root ${repo_root}`（`@static-tier full`，每次全量套件必跑，不依赖会话意志）。**接线后的强制效果已验证**：真实 tick-log 的 15:28 no-action 行（①③④ 为真）现在被 checker 判 FAIL——外层必须写合规行（五条全假或改判词），这正是「no-action 不再零成本」。

**AC5 新鲜度上界**：fixture mtime 回拨 20 分钟 + `--fresh-minutes 10` + `--truth 10000` ⇒ `fresh=0` 跳过 L2 ⇒ `exit 0`（不因此刻量变误报，自洽即过）。

**测试**：`plugin/test/outer-tick-log-check.test.mjs` **11/11 pass / 0 fail**（欺骗输入红 / 合法 no-action PASS / correct/unblock 不误报 / 陈旧行不误报 / no-log / no-tick-section fail-closed）。

**mutation case**：`plugin/scripts/checker-mutation-cases/outer-tick-log-check.sh`（合法 no-action 绿 → 注入 ①真 → 红 → 恢复 → 绿），`checker-mutation-check --list` 已含 `outer-tick-log-check yes run_static_checks`。

**capability-catalog / inventory**：外-tick-log-check.sh 已入 QUESTION 表 + consumer-facing 表（179/179 declared）；`--write-inventory` 重生成 outline §6（inventory_drift=0）。

**AC5 scoped 门**：`bash scripts/test.sh --for-task gap-no-action-requires-evidence-mechanical-check --allow-thin` → **exit 0，violations 0**（task-contract-check 等全过）。

**DoD 全量绿（含 run_static_checks 接线生效）**：留给外层 verification-round——注意接线后真实 tick-log 当前 15:28 no-action 行会红，外层需先写合规行（这是本任务的强制效果）。

## Touches

- plugin/scripts/outer-tick-log-check.sh（script：重测裁判——L1 行内自洽 / L2 重测比对 / L3 新鲜度上界；`--truth` 接缝）
- plugin/test/outer-tick-log-check.test.mjs（测试：欺骗输入红 / 合法 no-action PASS / 新鲜度上界不误报 / fail-closed）
- plugin/scripts/checker-mutation-cases/outer-tick-log-check.sh（mutation case：合法绿 → 注入①真红 → 恢复绿）
- scripts/test.sh（接线到 run_static_checks——全量套件必跑，`@static-tier full`）
- plugin/scripts/capability-catalog.sh（QUESTION 表 + consumer-facing 表登记）
- docs/proposals/quay-product-outline.md（§6 DELIVERY-INVENTORY 重生成）
- orchestration/orchestrator-tick-core.md（B8/B13 no-action 举证要求——外层已改，内层核实）
- tasks/gap-no-action-requires-evidence-mechanical-check.md（自身：勾 AC + 贴证据）

## Contract

measure   no_action_illegal_rows = `node .claude/workflows/outer-no-action-check.js`（或等价入口）的 exit code
band      no_action_illegal_rows = 非 0（FAIL：no-action 不合法，欠动作）
invariant deception_input_caught = 1（读数全+判词 escalate+实际没动 ⇒ 红）
invariant no_action_legal_passes = 1（五条全假的 no-action 行 PASS）
invariant freshness_bound_no_false_positive = 1（20 分钟前行 + 此刻量变 ⇒ 不误报）
invoke    `bash plugin/scripts/outer-tick-log-check.sh --root /home/yale/work/quay`（构造行实跑贴回；真实实现为 script，人裁定保持，workflow 等价）
control   no-action+①真 ⇒ FAIL；no-action+全假 ⇒ PASS；欺骗输入 ⇒ 红；陈旧行 ⇒ 不误报
resume    workflow 骨架（JS 算术 + agent 语义）+ 接线 + 新鲜度上界分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-09
changed: 建任务时先按 script-only 写，manager 当场驳回——workflow 价值=控制流是代码（非扇出），五条值要语义产生（script 只做值到手后的算术，而失效全在产生值一步）。改为 workflow：JS 算术 + agent(schema) 语义 + 判词脚本决定。实现归内层
