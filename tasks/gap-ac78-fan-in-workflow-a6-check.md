---
id: gap-ac78-fan-in-workflow-a6-check
title: AC78 fan-in 走 workflow；A6 从「步骤清单」改为「检查 workflow 是否被执行」（人 08:3xZ 裁定「应当创建和维护模板」）
status: done
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

**判据5（`/clear` 后行为稳定 —— 人 2026-08-14 08:4xZ 追加的一般原则）**：
**人的两句逐字**：「**不要担心 spawn limit。人会处理超限后的 `/clear` 操作。关键是保障 `/clear` 操作后的行为稳定性
（已知 subagent 和 workflow 都可以跨 `/clear` 持续）**」「**subagent / workflow 的独立上下文是优势。应利用这一特性实现更稳定的行为。**」

**⇒ 这条把 AC78 的理由从「防漂移」升级为「防清空」，且它给出一个可当场检验的判据**：
```
设想 inner 此刻 /clear ——它还能正确派发吗？
  今天的答案：不能。prompt 无模板、无脚本、无执行核条款，只存在于【复制上一次】的惯性里；
              /clear 之后连"上一次"都没有了。
  AC78 之后：能。prompt 由 workflow 脚本生成，脚本在盘上、由 scriptPath 调用。
```
**⇒ 判据5 = 「本 workflow 所需的一切（模板文本、参数来源、调用方式）必须全部落在盘上的脚本与锚可达的文件里；
不得有任何一项依赖会话记忆」**，判定法即上面那个设想：**逐项问「/clear 之后这一项还在吗」。**
**这不是新规则，是既有规则的一次具体应用**——`plugin/loop/fast-mode-loop-tick.md:9` 与
`orchestration/SPEC-three-layer-unified-architecture-2026-08-09.md:86` 逐字：
**「凡是必须跨压缩存活的东西，必须落在锚所指向的文件里」（ADR-009 第二次修订）。**
**⇒ 今天这个洞正是那条规则的一次违反，只是违反的对象是 prompt 而不是执行核本身。**

**判据6（利用独立上下文，不只是躲开它）**：人「**独立上下文是优势，应利用这一特性实现更稳定的行为**」
⇒ **workflow 内 subagent 的 prompt 应当【自足】**：不引用「上一条消息」「协调者说」「见上文」这类
依赖调用方上下文的措辞。**今日实证两条，都是这类引用出的错**：
```
AC73  brief 逐字嵌了 inner 自己的会话 id ⇒ subagent 照抄 ⇒ --agent-id 填成会话 id
AC72  subagent 从 AC67 任务体判据4 的【示例串】里取 id ⇒ 示例恰好是真实会话 id ⇒ 同样填错
```
**⇒ 判据：prompt 里凡需要 subagent 的自身标识，一律写成【让它自己去找】的指令
（定位 `subagents/agent-<自己>.jsonl`），不得由调用方填值、也不得给可被误抄的示例值。**
**AC67 那次填对了，正因为它是自己找的。**

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

**不覆盖**：不规定 workflow 脚本名与内部结构（实现面）；不改 fan-in 协议本身（AC62/AC75 已定）；不引入新的 subagent 计数（人 08-10 与 08-14 两次裁定禁止）；**不为 spawn limit 做任何自动处置**（人：超限后的 `/clear` 由人执行）。

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
8. 判据5（/clear 稳定性）：workflow 所需的一切（模板文本/参数来源/调用方式）全部落盘且锚可达——逐项问「/clear 之后这一项还在吗」，不得有任何一项依赖会话记忆。
9. 判据6（prompt 自足，实现要求）：workflow 生成的 subagent prompt 必须【自足】——不引用「协调者说/见上文/上一条消息」；凡需 subagent 自身标识，prompt 里写成【让它自己去找】的指令（定位 `subagents/agent-<自己>.jsonl`），**不得由调用方填值、不得给可被误抄的示例值**。这是写在脚本里的实现要求，不是给 inner 的口头提醒。
10. 能取假·真样本回放：AC72/AC73（agentId=会话 id）回放判据2 (c) 必须红；AC67（agentId=aab2d14d subagent）回放必须绿；时间边界内旧 fan-in 无 Workflow 记录 ⇒ 红；/clear 设想逐项问 ⇒ 无一项依赖会话记忆。
11. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1 判据1：fan-in 四步正身迁入 workflow 脚本；A6 改为「检查 workflow 是否被执行」+ 本轮判据；A6 旧正身按 AC58 迁 archive + 落点映射（落点=workflow 脚本对应段落）。
- [ ] AC2 判据2：checker——(a) 每次 fan-in 有对应 Workflow 调用记录（meta-cc tool_name=Workflow，第三方可读）∧ (b) 每次 fan-in 在 lock-events 留 ≥1 条带 agentId ∧ (c) agentId 是真实 subagent 标识（顶层 `<id>.jsonl` 存在 ⇒ 红）；三处带时间边界（只统计 workflow 落地后 fan-in）；差集非空 ⇒ 红 + 列差集任务名。
- [ ] AC3 判据2 (c) 能取假：AC72（agentId=902b4528 顶层存在）与 AC73（agentId=bc1a438b 顶层存在）回放必须红；AC67（agentId=aab2d14d 仅 subagents/ 文件）回放必须绿。
- [ ] AC4 判据3：workflow 一律 scriptPath 调用，禁用 name:（M176 陷阱写进 A6/派发路径）。
- [ ] AC5 判据4：A6 改动双副本同改（orchestration + plugin/loop）；前置 (a) 头部不对称表述保持。
- [ ] AC6 `fan-in-ff-merge.sh` `--agent-id` 自校验落地（顶层会话 jsonl 存在 ⇒ 报错退出、不写锁事件）；弱判据（改 workflow 提交点名对应 SPEC 节）落地。
- [ ] AC7 判据5：workflow 所需的一切（模板文本/参数来源/调用方式）落盘且锚可达，逐项问「/clear 之后这一项还在吗」无一项依赖会话记忆。
- [ ] AC8 判据6：workflow 内 subagent prompt 自足（不引「协调者说/见上文/上一条消息」）；凡需自身标识写成【让它自己去找】（定位 `subagents/agent-<自己>.jsonl`），不得由调用方填值、不得给可误抄示例值——实现要求写进脚本，非口头提醒。
- [ ] AC9 既有测试全绿；`--for-task` scoped 门绿。

## Definition of Done

- [ ] fan-in 四步正身迁入 workflow + A6 只留检查 + 判据2 三读法（Workflow 记录 ∩ lock-events 带时间边界 ∩ agentId 非会话 id）+ scriptPath-only + 双副本同改 + --agent-id 自校验 + 判据5（/clear 后一切落盘锚可达）+ 判据6（prompt 自足、自身标识自己找）+ 弱判据（提交点名 SPEC 节）。

## Touches

- orchestration/fast-mode-tick-core.md（A6 行：步骤清单 → 检查 workflow 是否被执行 + 判据3 scriptPath——双副本之一，正本；**C17 外层独占写 ⇒ 本任务只落 SUGGESTION 到 Evidence，不编辑**）
- plugin/loop/fast-mode-tick-core.md（同一 A6 改动——落地副本随正本逐字落地）
- .claude/workflows/fan-in-execute.js (new)（fan-in 四步正身模板，subagent prompt 自足 + 自身标识自己找）
- plugin/workflows/fan-in-execute.js (new)（delivery-drift-gate 要求的字节镜像）
- plugin/scripts/fan-in-workflow-check.ts (new)（判据2 (a)(b)(c) checker：Workflow 记录 ∩ lock-events 时间边界 ∩ agentId 非会话）
- plugin/test/fan-in-workflow-check.test.mjs (new)
- plugin/scripts/fan-in-ff-merge.sh（--agent-id 自校验：顶层会话 jsonl 存在 ⇒ 报错退出）
- plugin/scripts/capability-catalog.sh（fan-in-workflow-check.ts 目录声明——AC1c gate 要求）
- scripts/test.sh（fan-in-workflow-check 接 run_static_checks——AC73 零接线病族的对应治理）
- docs/proposals/quay-product-outline.md（DELIVERY-INVENTORY 快照派生刷新）
- orchestration/archive/AC58-retired-clauses.md（A6 旧正身退役落点 + 落点映射，AC58 形态）
- plugin/scripts/retired-clause-check.ts（REGISTRY 登记新退役条款 R30）
- tasks/gap-ac78-fan-in-workflow-a6-check.md（自身）

## Evidence

**实现落地（inner，2026-08-14）**：
- `.claude/workflows/fan-in-execute.js`（+ 字节镜像 `plugin/workflows/fan-in-execute.js`）：fan-in 四步正身（merge develop → delta 断言面判定 → ts-typecheck → scoped+全量+doc → flip done + ff-merge）迁入 subagent prompt。prompt 自足（逐字内联所有上下文，无「协调者说/见上文/上一条消息」依赖）；`--agent-id` 写成【自己找 `subagents/agent-<自己>.jsonl`】指令，不填值、给示例。渲染自检通过（prompt 长度 3201，含 `ls -t ~/.claude/projects/*/subagents/agent-*.jsonl` 自找段，无真实会话/示例 id 混入）。
- `plugin/scripts/fan-in-workflow-check.ts`（判据2 (a)(b)(c) checker）+ `plugin/test/fan-in-workflow-check.test.mjs`（25 tests 全绿）：(a) 从会话 jsonl 提取 Workflow(fan-in-execute) 调用（mtime≥边界过滤），(b) 从 lock-events 派生 fan-in 集（时间边界——manager 13−1=12 vs 真值 6 教训），(c) agentId 顶层 `<id>.jsonl` 存在 ⇒ 红（AC72/AC73 回放红）、`subagents/agent-<id>.jsonl` 存在 ⇒ 绿（AC67/AC66 回放绿）、missing/unresolvable ⇒ 红。
- `plugin/scripts/fan-in-ff-merge.sh` `--agent-id` 自校验（AC78 判据2(c) 实现侧）：顶层会话 id ⇒ exit 2、不写锁事件。实测：`--agent-id 902b4528-bc95-…`（AC72 顶层）⇒ `resolves to a TOP-LEVEL session id ... exit 2`；`--agent-id aab2d14d10a762ff4`（AC67 subagent）⇒ 放行。测试 `fan-in-ff-merge.test.mjs` 新增 2 条（12/12 全绿）。
- A6 双副本：`plugin/loop/fast-mode-tick-core.md` A6 改为「fan-in 必须经 fan-in-execute workflow 执行 + 判据3 scriptPath-only + 判据2 (a)(b)(c) + 落点映射」，旧步骤正身迁 `orchestration/archive/AC58-retired-clauses.md#R30`（落点映射→workflow 对应段落），`retired-clause-check.ts` REGISTRY 加 R30（retired-clause-check OK — 29 entries）。
- `fan-in-workflow-check` 接 `run_static_checks`（scripts/test.sh）+ 目录声明（capability-catalog.sh，AC1c gate 通过，`fan-in-workflow-check.ts` 六栏完整）+ DELIVERY-INVENTORY 快照刷新（scripts 243 / workflows 3，inventory_drift=0）。

**门（AC9）**：
- ts-typecheck 闸：`node --experimental-strip-types plugin/scripts/fan-in-ts-typecheck-gate.ts --task gap-ac78-fan-in-workflow-a6-check --worktree <wt> --merge-target develop` = **GREEN（exit 0）**（Touches 含新增 .ts=1，typecheck 通过）。
- scoped 门：`bash scripts/test.sh --for-task gap-ac78-fan-in-workflow-a6-check --allow-thin` = **58 tests / 58 pass / 0 fail**（fan-in-workflow-check 25、fan-in-ff-merge 12、retired-clause-check 5、capability-catalog 等；scoped 静态检查 test-framework-policy/test-isolation/delivery-inventory 全 PASS）。
- doc 检查：`bash scripts/test.sh --static-checks-doc` = **PASS（exit 0）**（tick-core-static-check PASS；tick-core-drift-check 报 fast-mode 对漂移但 --no-block，非阻塞）。
- `retired-clause-check`：OK — 29 entries migrated（47 tokens: all gone from source, all present in archive）。
- `rhythm-consumer-check --check`：PASS（判据1 182 judged 0 violation——fan-in-workflow-check 每轮已接 test.sh）。

**C17 建议（orchestration/fast-mode-tick-core.md，外层独占写，本任务未编辑）**：A6 行需按 plugin/loop 副本逐字落地（正本/落地副本同步），建议文本 = plugin/loop/fast-mode-tick-core.md 现 A6 行（`| A6 | Fan-in 必须经 fan-in-execute workflow 执行(**判据1:fan-in 四步正身迁入 \`.claude/workflows/fan-in-execute.js\`,A6 只留检查;... |`），并保持前置 (a) 头部不对称表述。落地后 tick-core-drift-check 的 fast-mode 对漂移消除。另：orchestration 旧 A6（缺 delta 断言面判定的版本）若从源删除，其独有词条需补 archive R30（或新增 R31）——retired-clause-check REGISTRY 目前只登记了 plugin/loop 源。
