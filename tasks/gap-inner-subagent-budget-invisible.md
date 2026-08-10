---
id: gap-inner-subagent-budget-invisible
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---

> **RETIRED (A16 人 2026-08-10 11:5x 裁定)**——本任务建的 `inner-agent-budget-report.ts` 计数机制已整体废弃并删除（计数是我方自造的，Claude Code 无查询余量接口；`gap-retire-inner-agent-budget-report` 执行删除）。上层只观察下层失能，不自计数。
**type:** execution

## Proposal

**harness 的 subagent spawn 硬上限（200/200）是 inner 派发能力的静默天花板——仓库没有任何正本记录它，三层执行核一条都没写。触顶后 inner 无法再派 subagent ⇒ 0 在飞 ⇒ 无 `<task-notification>` ⇒ 槽位回填评估不触发 ⇒ 5 空槽 + pool 32 + dispatchable 12 全部无用，且**形态与一切机制缺陷完全同形**（「空槽 + 有货 + 不派」），当晚 4 个人反复误诊数小时。**

### 实证（manager 2026-08-10 第三次更正，判准 ②e 原始记录 + outer 复核）

- **原始记录（非自述）**：inner 会话 728a4610 的 tool_result，`2026-08-10T05:13:13` 逐字写着 `Subagent spawn limit reached (200 of 200 agents spawned). Complete the remaining work directly with your tools instead of spawning more agents.`——该时刻正是最后一次 Agent 派发时刻（Agent tool_use 总数实测 201）。
- **因果链（全部实测）**：200/200 触顶（05:13:13）⇒ 无法再派 subagent ⇒ 0 在飞 ⇒ 无 `<task-notification>` ⇒ 槽位回填评估不触发 ⇒ 空槽 + 有货不派。
- **结构无解（本会话内）**：`/clear` 或新开会话重置计数器是唯一出路（人 2026-08-10 已就 outer 说过同形处置：「它不做，就 `/clear` outer Claude Code 会话，重新来」）。
- **此前归因全部错（manager 第三次更正）**：①「outer 不派发」——错，派发是 inner 职责（fast-mode-tick-core.md:78）；②「inner 自锁（ScheduleWakeup 断）」——断档是真的但不是原因（更早 52.2h 断档期间 inner 做 2831 次工具调用含 114 次 Agent 派发——心跳不是派发前提）；③真因 = 本条。
- **无正本**：`grep plugin/ orchestration/ .claude/` 无任何 agent 上限声明（仅命中不相关 fixtures 的 verify-line-budget 概念）。

**为什么重要**：一个会终止内层派发能力的硬天花板，三层执行核一条都没写——意味着每个长会话都会在某一刻静默失去派发能力，表现为「空槽 + 有货 + 不派」，而任何检查器都不会报它（没有产物、没有读数）。这是 C17（规则要产物）的又一次实例：上限本身是 harness 行为，但「是否触顶」没有机械可读的状态。

### 选定机制方向（实现归 inner，判定归 outer）

1. **派发前预算检查**：inner 核派发步骤前读「剩余 subagent 预算」——若无可读 API，退而用「距上次 Agent 派发的累计 Agent 次数」或 harness 报告的触顶信号。
2. **触顶即升级**：inner 派发时若收到 spawn-limit 信号 ⇒ 立即升级给人（不是静默转主线程串行）——把「静默失去派发能力」变成「触顶即报」。
3. **产物**：inner 每次 Agent 派发/触顶写 `.quay/inner-agent-budget.json`（`{spawned, limit, lastSpawnAt, hitLimit}`）——外层 tick 读它判「预算将尽/已触顶」。

**验证锚**：修后 (a) inner 派发前能读剩余预算；(b) 触顶时升级而非静默；(c) 产物存在且外层可读。

### 关键参数（本机 2.1.225 二进制 strings 实测存在，正控制 `CLAUDE_CODE` 命中 1401；数值随版本变，以厂商 changelog 为准）

1. **`CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION`**——**会话累计**上限，默认 **200**。厂商 changelog v2.1.212（2026-07-17）原文：`Added a per-session cap on subagent spawns (default 200, override with CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION) to stop runaway delegation loops; /clear resets the budget`。**我们撞的就是这个**。
2. **`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`**——**并发**上限，默认 **20**，v2.1.217。**与会话累计上限是两个不同旋钮，极易混用**（我们撞的是会话累计 200，不是并发 20）。
3. **`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`**——**嵌套深度**上限，默认 **3**，v2.1.219。

### 燃烧率（给数值以依据）

inner 实测 **201 次派发 / 3.33 天 = 60.4 次/天** ⇒ **默认 200 的寿命 ≈ 3.3 天**（会话 08-06 21:17 起、08-10 05:13 触顶，吻合）。设 2000 ⇒ ~33 天，5000 ⇒ ~83 天。⇒ **任何长于 3.3 天的自主运行都必然撞它，这是固有节律不是偶发。**

### 两条判定（写进任务体，供实现时用）

1. **顺序不可颠倒**：`/clear` **立刻**解封（重置预算至 200）；env var **只在下次进程启动时生效**（环境变量启动时读，`/clear` 换的是上下文不是进程）⇒ **不要指望 `/clear` 顺带把上限调高**；要让新上限生效必须重启 inner 的 claude 进程并在启动环境里带上它。
2. **调高上限不是修复**：该上限存在的理由是厂商原话 `to stop runaway delegation loops`，调高即调低那层保护；**真缺陷是触顶时的静默**（守与不守在记录上不可区分）。设成 2000 只是把同样的静默失败推到 33 天后。**本任务的机制方向（派发前查预算 / 触顶即升级 / 产物）才是修复**；「调参」（设 env var）与「机制」（预算检查 + 触顶升级）在实现时必须明确分开，不得以为设个环境变量就完事。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录 05:13:13 spawn-limit 原始记录 + 因果链 + 无正本实证（本任务 Proposal 已含；下方 Invoke evidence 又机械断言：`inner-agent-budget-report.test.mjs` 的「AC1 — reproduction is fixed in the task body」读任务体，必须含 `05:13:13` + `Subagent spawn limit reached` 字面量）
- [x] AC2: **预算检查**——inner 派发前读剩余 subagent 预算（可读则用，否则退化为 Agent 计数）— 新增 `plugin/scripts/inner-agent-budget-report.ts`：`resolveLimit` 读 env `CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION`（可读 API，缺省 200），`analyzeAgentBudget` 从 transcript 数 Agent tool_use（Agent 计数退化路径）→ `spawned`/`lastSpawnAt`；接线 `plugin/loop/fast-mode-loop-tick.md` 步骤 4「派发前预算检查（subagent 硬上限——会话级闸，先于逐候选检查）」命令块
- [x] AC3: **触顶升级**——收到 spawn-limit 信号 ⇒ 升级给人，不静默转主线程串行 — `analyzeAgentBudget` 扫描 transcript 的 `Subagent spawn limit reached` 信号 ⇒ `hitLimit=true` ⇒ `judgeBudget` status=hit ⇒ exit 1；tick 文档步骤 4 明令「触顶即升级，不静默转主线程串行」（`inner-blocked-signal.ts --assert-blocked` + `escalations.md`）；判断边界表新增「subagent 预算触顶 ⇒ 停止派发并升级」行
- [x] AC4: **产物**——`.quay/inner-agent-budget.json`（spawned/limit/lastSpawnAt/hitLimit），外层 tick 可读 — `writeBudget` 写精确 schema；`.gitignore` 加 `**/.quay/inner-agent-budget.json`（gitignored 运行时状态，`git check-ignore` 命中 .gitignore:134）；外层 `orchestration/orchestrator-tick-core.md` 新 A16 行读它判预算（hitLimit/spawned≥limit ⇒ 触顶升级；spawned/limit≥0.8 ⇒ 预算将尽预警）
- [x] AC5: **既有不回归**——`--for-task` scoped 门绿 — `bash scripts/test.sh --for-task gap-inner-subagent-budget-invisible --allow-thin` → **exit 0 / tests 35 / pass 35 / fail 0 / cancelled 0**（23 inner-agent-budget + 12 capability-catalog，见 Invoke evidence）；scoped 静态检查全 PASS（task-contract-check / adr016-screen-use-check / superseded-capability-check / strategic-doc-staleness-check / drive-contract-check / threshold-scope-check / instrument-failure-check）

## Invoke evidence（scoped 实跑，2026-08-10）

**Contract invoke**（读产物 + 双表面实跑；产物为机制演示态，gitignored 不提交）：

```text
# 产物 schema（精确四键 {spawned, limit, lastSpawnAt, hitLimit}；inner 每次派发前写）
$ python3 -c "import json;d=json.load(open('.quay/inner-agent-budget.json'));print(d)"
{'spawned': 2, 'limit': 200, 'lastSpawnAt': 1786350600, 'hitLimit': False}

# Contract measure（spawned limit hitLimit 三元组）
$ python3 -c "import json;d=json.load(open('.quay/inner-agent-budget.json'));print(d['spawned'],d['limit'],d['hitLimit'])"
2 200 False

# inner 派发前预算检查（OK：spawned < limit 且未触顶）⇒ exit 0
$ node --no-warnings --experimental-strip-types plugin/scripts/inner-agent-budget-report.ts --root <root> --json
status: ok | spawned: 3 | limit: 200 | remaining: 197 | hitLimit: False        # exit=0

# 触顶升级（spawn-limit 信号 ⇒ HIT，不静默转主线程串行）⇒ exit 1
$ node --no-warnings --experimental-strip-types plugin/scripts/inner-agent-budget-report.ts --root <root> --session <hit-transcript> --json
status: hit | hitLimit: True | spawned: 1                                     # exit=1

# 外层 tick 读（--read 表面）
$ node --no-warnings --experimental-strip-types plugin/scripts/inner-agent-budget-report.ts --read --root <root>
inner-agent-budget: OK — spawned 3 < limit 200, remaining 197                  # exit=0
```

**scoped 测试**（`bash scripts/test.sh --for-task gap-inner-subagent-budget-invisible --allow-thin`）：

```text
== scoped static checks (change-relevant tier) ==
  task-contract-check        PASS（no violations）
  adr016-screen-use-check    PASS（violations 0，band 0..1）
  superseded-capability-check PASS
  strategic-doc-staleness-check PASS（no NEW stale refs）
  drive-contract-check       PASS（3 doc(s) scanned, violations 0）
  threshold-scope-check      PASS（new since baseline: 0）
  instrument-failure-check   PASS（5/5 families）
== plugin/test/inner-agent-budget-report.test.mjs ==（23 条全绿）
  ✔ resolveLimit — env CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION wins, else default 200 (AC2 可读则用)
  ✔ analyzeAgentBudget — counts Agent tool_use, not Edit, and tracks lastSpawnAt (AC2 Agent 计数)
  ✔ analyzeAgentBudget — spawn-limit signal in the transcript ⇒ hitLimit=true (AC3 触顶信号)
  ✔ analyzeAgentBudget — spawned reaching limit also trips hitLimit (count fallback)
  ✔ serializeBudget / parseBudget / judgeBudget — schema + ok/near/hit/missing/malformed 全分支
  ✔ writeBudget/readBudgetText — round-trips the product under <root>/.quay/ (AC4)
  ✔ AC2/AC4 CLI — inner surface counts + writes the product and exits 0 on OK
  ✔ AC3 CLI — spawn-limit signal ⇒ HIT, exits 1 (escalate, not silent serial)
  ✔ AC4 CLI --read — MISSING exits 0 (no data) / MALFORMED exits 1 (fail-closed)
  ✔ AC2/AC3 wiring — fast-mode-loop-tick.md carries the pre-dispatch budget check + escalate-on-hit
  ✔ AC4 wiring — orchestrator-tick-core.md A 段 must READ+judge inner-agent-budget.json
  ✔ AC1/AC4 — cross-annotation to the same-family sibling tasks
  ✔ AC1 — the reproduction is fixed in the task body (05:13:13 + Subagent spawn limit reached)
== plugin/test/capability-catalog.test.mjs ==（Touches 登记 capability-catalog.sh ⇒ 同族选中）
  …（AC1c 新脚本无声明即 exit 1、unclassified==0、--entry-surface 等 12 条，全绿）
ℹ tests 35（23 inner-agent-budget + 12 capability-catalog）· pass 35 · fail 0 · cancelled 0 · exit 0
```

**DoD 注**：`--for-task` 带 `--allow-thin`——doc-heavy Touches（`plugin/loop/*.md` / `orchestration/*.md` /
`.gitignore` / `tasks/*.md` / `.quay/*.json` 无同名测试文件）使选择器覆盖率 < 0.5，这是选择器对文档型任务的
已知 fail-loud 结构属性（非测试失败）；测试集本身全绿（23 条）。同族先例 `gap-inner-wakeup-heartbeat-invisible`
与 `gap-dispatch-evaluated-only-at-inner-tick-boundary-not-slot-release` 均用 `--allow-thin`。全量套件绿归
外层 verification-round 验证（DoD 行不勾）。

## Definition of Done

- [x] AC1–AC5 全部勾上
- [x] 修后实跑：inner 派发前读预算；触顶升级（贴输出）——机制演示已跑（见 Invoke evidence：OK exit 0 / HIT exit 1）；live 归外层实跑
- [x] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/loop/fast-mode-loop-tick.md（步骤 4 派发前预算检查 + 触顶升级 + 判断边界表新行）
- orchestration/orchestrator-tick-core.md（外层 A 段新增 A16 行读 inner-agent-budget.json 判预算）
- plugin/scripts/inner-agent-budget-report.ts（新增：inner 派发前计数 + 写产物 + 报 verdict；外层 `--read` 判预算）
- plugin/test/inner-agent-budget-report.test.mjs（新增：AC2/AC3/AC4 机械测试——逻辑 + CLI + 文档契约）
- plugin/scripts/capability-catalog.sh（新脚本登记进唯一清单——AC1c gate：未声明问题的脚本进 artifact 会 exit 1）
- .gitignore（`**/.quay/inner-agent-budget.json` 运行时产物忽略——Touches 声明「gitignored 运行时状态」）
- .quay/inner-agent-budget.json（产物，gitignored 运行时状态；`git check-ignore` 命中 .gitignore:134）
- tasks/gap-inner-wakeup-heartbeat-invisible.md（交叉标注——同族：inner 自驱心跳无产物，与本任务同环两端）
- tasks/gap-dispatch-evaluated-only-at-inner-tick-boundary-not-slot-release.md（交叉标注——派发评估的另一静默天花板）
- tasks/gap-inner-subagent-budget-invisible.md（自身：勾 AC + 贴证据）

## Contract

measure   inner_agent_budget_spawned = `python3 -c "import json;d=json.load(open('.quay/inner-agent-budget.json'));print(d['spawned'],d['limit'],d['hitLimit'])"` 的 stdout
band      inner_agent_budget_spawned = （spawned < limit 且 hitLimit=false；接近 limit 时升级）
invariant inner_budget_read_before_dispatch = 1（inner 派发前读预算）
invariant inner_touch_limit_escalates = 1（触顶 ⇒ 升级，不静默）
invoke    `python3 -c "import json;d=json.load(open('.quay/inner-agent-budget.json'));print(d)"`（贴产物）
control   预算将尽/已触顶 ⇒ 升级；正常时静默
resume    预算检查 / 触顶升级 / 产物分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-10
changed: manager 第三次更正——harness 200/200 subagent 上限是静默天花板（原始 tool_result 05:13:13 逐字实证），无任何正本，三层核零记录。此前两归因（outer 不派发 / inner 自锁）均错。立案：派发前预算检查 + 触顶升级 + 产物。实现归 inner
