---
id: gap-ac78-fan-in-workflow-a6-check
title: AC78 fan-in 走 workflow；A6 从「步骤清单」改为「检查 workflow 是否被执行」（人 08:3xZ 裁定「应当创建和维护模板」）
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**AC78（fan-in 走 workflow；A6 从「步骤清单」改为「检查 workflow 是否被执行」—— 人 2026-08-14 08:3xZ 裁定）**
人的两句：「**应当创建和维护模板**」「**如果用 workflow，A6 就应该改为检查是否执行了 workflow。按这一方案执行。**」

**① 为什么是这个方案（今天查实的三条事实，判据全文见 orchestration/manager-phase-goal.md:3142）**：
```
任务 subagent 的 prompt 无模板   四条特征串（"You are implementing task" / "DO NOT flip status" /
                                 "worktree-isolated background subagent" / "Report back"）仓库【零命中】
                                 谓词已干跑（fan-in-ts-typecheck-gate 同法命中 12 文件）⇒ 真零
inner 执行核 A15 不规定其内容     只规定「派不派」（Touches 正交/依赖/disjoint/fork 基线/self-touch）
inner 会话 Workflow 调用 = 0     它从未走过这条路
⇒ prompt 靠【复制上一次】生成 ⇒ A6 改了三次（AC62/AC67/AC75），prompt 一次没跟着改
⇒ 六次 fan-in 全带 pre-AC67 的「DO NOT flip status. DO NOT merge.」
```
**⇒ 根因是【模板在记忆路径上】。人的方案是把它搬到【执行路径】上。现成先例：`execute-suite-fix.js:101`——prompt 就是脚本里的模板串加插值。**

**判据1（步骤迁入 workflow，A6 只留检查）**：fan-in 四步（`git merge develop` → delta 判定/全量 suite → doc 检查 → flip done + `fan-in-ff-merge.sh`）**正身迁入一个 workflow 脚本**；A6 改为「fan-in 必须经该 workflow 执行」+ 本轮判据。按 AC58「退役即迁出」：A6 旧正身（步骤清单）**不得直接删**，迁进 `orchestration/archive/` 并给**落点映射**（落点 = 该 workflow 脚本的对应段落）。

**判据2（能取假·三层，缺一不可）**：
```
(a) 每次 fan-in 必须有一次对应的 Workflow 调用记录
    读法：meta-cc query_session_content role=tool tool_name=Workflow（第三方可读，非自述量）
(b) 每次 fan-in 必须在 fan-in-merge-lock-events.jsonl 留 ≥1 条（带 agentId）
    ⚠️ 必须带时间边界：只统计【该 workflow 落地之后】fan-in 的任务
       —— 否则会把之前的 fan-in 一并算进差集、稳定过计、天天报红
       （manager 2026-08-14 算这条时就过计过：13−1=12，真值 6）
(c) 【agentId 判据——2026-08-14 08:4xZ manager 裁定并入，本条**不能**没有它】：
    lock-events 的 agentId 必须是【真实 subagent 标识】，不得是会话 id。
    检验：`<project>/<id>.jsonl` 顶层存在 ⇒ 红（是会话）；`subagents/agent-<id>.jsonl` 存在 ⇒ 绿。
    现成真样本：AC72 agentId=902b4528（outer 会话，顶层 jsonl 存在）⇒ 红；
              AC73 agentId=bc1a438b（inner 会话，顶层 jsonl 存在）⇒ 红；
              AC67 agentId=aab2d14d（subagents/agent-aab2d14d10a762ff4.jsonl 存在）⇒ 绿。
差集非空 ⇒ 红，并列出差集任务名
```
**(a) 管「有没有走 workflow」，(b) 管「走了有没有真的 ff」，(c) 管「ff 是不是 subagent 执行的」。只有 (c) 能分开「走了脚本」与「换了执行者/记错了执行者」。**（判据2 的三层缺 (c) 的实证：AC72/AC73 的 ff 都走了 `fan-in-ff-merge.sh`、都留了 lock-events（(a)(b) 全绿），但 agentId 填的是会话 id——只有 (c) 报红。**若当初只写 (a)(b)，此刻会宣布协议已启用。**）

**判据3（M176 陷阱写进 A6）**：**workflow 一律以 `scriptPath` 调用，禁用 `name:`**。`CLAUDE.md` 逐字记着：同一会话内第二次 `name:` 派发**可能取到旧脚本体**，即使文件已改并提交。**⇒ 不写死这条，我们会在「模板已更新」与「实际用的是旧模板」之间再造一个同形的洞。**

**判据4（双副本同改）**：A6 的改动**必须同时落两份**（`orchestration/fast-mode-tick-core.md` 与 `plugin/loop/fast-mode-tick-core.md`）——**同 AC73 判据4**。

**⚠️ 一个必须一并记的位移（③b，不阻塞但不能不写）**：步骤正身迁入 workflow 之后，**协议的设计正本 `SPEC-fan-in-ff-merge-lock-2026-08-14.md` 与 workflow 脚本之间又成了一对「规格 vs 实现」**。但它与今天这个洞**不同级**：
```
今天的洞   prompt 是 A6 步骤的【副本】，两者都在执行路径上 ⇒ 副本漂移 = 执行漂移（六次实证）
迁入之后   workflow 脚本是【唯一实现】，没有第二份可漂 ⇒ SPEC 与它的分歧只是文档漂移
```
**⇒ 前者是执行缺陷，后者是文档缺陷。不要用同一条判据管**（同 manager 裁 B15 不并 AC73 的那把尺）。**但仍留一条弱判据**：改 workflow 的提交必须在提交信息里点名它对应 SPEC 的哪一节，否则下一个人无从对照。

**⚠️ 前置 (a)——A6 两份副本谁是正本（2026-08-14 outer 已裁定并落盘，本任务建前必定的那一条）**：
- **正本 = `orchestration/fast-mode-tick-core.md`**（本层实际执行路径 + C17 外层独占写）；**落地副本 = `plugin/loop/fast-mode-tick-core.md`**（随 `quay-init --loop` 铺到目标项目，inner 按正本逐字落地，不得单边编辑）。
- 两份头部已改成【不对称】表述（正本写「本文件是执行核正本」；副本写「本文件是 `orchestration/fast-mode-tick-core.md` 的落地副本，勿单边编辑」）。
- **不定这条，下次单边编辑会在更深的位置重造今天的洞。**

**⚠️ 实现须带：`fan-in-ff-merge.sh` 的 `--agent-id` 自校验（manager 2026-08-14 裁定并入判据2 (c) 的实现侧）**：`--agent-id` 是自由文本、填什么都能过——AC72/AC73 两次实证。**给该参数补 fail-closed**：若 `--agent-id` 等于任一顶层会话 id（即 `<project>/<id>.jsonl` 存在）⇒ 报错退出、不写锁事件。**不是新机制，是给已有参数补校验；能取假**——AC72/AC73 两条就是现成真样本（AC67 的 aab2d14d 只有 subagents/ 文件，顶层不存在 ⇒ 放行）。

**排期（outer 裁定 2026-08-14，理由记 tick-log）**：AC78 与 AC76 在 `orchestration/fast-mode-tick-core.md` 重叠 ⇒ 串行；两者当前均被在飞 AC66（同文件重叠）挡。AC66 落地后**先派 AC78**——最新人裁（08:3xZ「按这一方案执行」）优先落地 + 结构性修复（模板上执行路径，治六次 fan-in 绕过协议的复发根）+ 前置 (a) 已解除；AC76 顺延一条（其判据3 真样本 07:2xZ/07:4xZ 已内嵌任务体，等待不失效）。

**不覆盖**：不规定 workflow 脚本名与内部结构（实现面）；不改 fan-in 协议本身（AC62/AC75 已定）；不引入新的 subagent 计数（人 08-10 与 08-14 两次裁定禁止）。

**归属**：任务体 = outer；实现 = inner（`plugin/loop/` 与 `.claude/workflows/` 不在 outer/manager 编辑边界内）；manager 已出判据。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 读 manager-phase-goal.md:3142（AC78 判据全文）+ SPEC-fan-in-ff-merge-lock-2026-08-14.md + 现 A6 行（两份副本，正本已由前置 (a) 定为 orchestration/ 那份）。
2. 判据1：fan-in 四步正身迁入新 workflow 脚本（`.claude/workflows/`，先例 execute-suite-fix.js:101）；A6 改为「fan-in 必须经该 workflow 执行」+ 本轮判据；A6 旧正身迁 `orchestration/archive/` + 落点映射（落点=workflow 脚本对应段落）。
3. 判据2：checker——(a) meta-cc Workflow 调用记录 ∩ (b) lock-events ≥1 条带 agentId ∩ (c) agentId 是真实 subagent 标识（顶层 `<id>.jsonl` 存在 ⇒ 红）。三处都带时间边界：只统计该 workflow 落地后 fan-in。差集非空 ⇒ 红 + 列差集任务名。
4. 判据3：A6/派发路径写死 `scriptPath` 调用，禁 `name:`（M176）。
5. 判据4：A6 改动双副本同改（orchestration + plugin/loop）；前置 (a) 头部已不对称（outer 已落盘），实现不得改回对称。
6. `fan-in-ff-merge.sh` `--agent-id` 自校验（fail-closed：顶层会话 jsonl 存在 ⇒ 报错退出）。
7. 弱判据：改 workflow 提交点名对应 SPEC 节。
8. 能取假·真样本回放：AC72/AC73（agentId=会话 id）回放判据2 (c) 必须红；AC67（agentId=aab2d14d subagent）回放必须绿；时间边界内旧 fan-in 无 Workflow 记录 ⇒ 红。
9. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1 判据1：fan-in 四步正身迁入 workflow 脚本；A6 改为「检查 workflow 是否被执行」+ 本轮判据；A6 旧正身按 AC58 迁 archive + 落点映射（落点=workflow 脚本对应段落）。
- [ ] AC2 判据2：checker——(a) 每次 fan-in 有对应 Workflow 调用记录（meta-cc tool_name=Workflow，第三方可读）∧ (b) 每次 fan-in 在 lock-events 留 ≥1 条带 agentId ∧ (c) agentId 是真实 subagent 标识（顶层 `<id>.jsonl` 存在 ⇒ 红）；三处带时间边界（只统计 workflow 落地后 fan-in）；差集非空 ⇒ 红 + 列差集任务名。
- [ ] AC3 判据2 (c) 能取假：AC72（agentId=902b4528 顶层存在）与 AC73（agentId=bc1a438b 顶层存在）回放必须红；AC67（agentId=aab2d14d 仅 subagents/ 文件）回放必须绿。
- [ ] AC4 判据3：workflow 一律 scriptPath 调用，禁用 name:（M176 陷阱写进 A6/派发路径）。
- [ ] AC5 判据4：A6 改动双副本同改（orchestration + plugin/loop）；前置 (a) 头部不对称表述保持。
- [ ] AC6 `fan-in-ff-merge.sh` `--agent-id` 自校验落地（顶层会话 jsonl 存在 ⇒ 报错退出、不写锁事件）；弱判据（改 workflow 提交点名对应 SPEC 节）落地。
- [ ] AC7 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] fan-in 四步正身迁入 workflow + A6 只留检查 + 判据2 三读法（Workflow 记录 ∩ lock-events 带时间边界 ∩ agentId 非会话 id）+ scriptPath-only + 双副本同改 + --agent-id 自校验 + 弱判据（提交点名 SPEC 节）。

## Touches

- orchestration/fast-mode-tick-core.md（A6 行：步骤清单 → 检查 workflow 是否被执行 + 判据3 scriptPath——双副本之一，正本）
- plugin/loop/fast-mode-tick-core.md（同一 A6 改动——落地副本随正本逐字落地）
- .claude/workflows/（fan-in 四步正身 workflow 脚本——具体名实现定，先例 execute-suite-fix.js）
- plugin/scripts/fan-in-workflow-check.ts (new)（判据2 (a)(b)(c) checker：Workflow 记录 ∩ lock-events 时间边界 ∩ agentId 非会话）
- plugin/test/fan-in-workflow-check.test.mjs (new)
- plugin/scripts/fan-in-ff-merge.sh（--agent-id 自校验：顶层会话 jsonl 存在 ⇒ 报错退出）
- orchestration/archive/AC58-retired-clauses.md（A6 旧正身退役落点 + 落点映射，AC58 形态）
- plugin/scripts/retired-clause-check.ts（REGISTRY 登记新退役条款）
- tasks/gap-ac78-fan-in-workflow-a6-check.md（自身）

## Evidence

（落地后回填）
