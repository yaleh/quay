---
id: gap-archguard-zero-production-calls
title: archguard 从未被真实调用，而 CLAUDE.md 明令「Consult it before calling a milestone done」——规定存在、执行为零
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

CLAUDE.md 明令「archguard (MCP) — ... **Consult it before calling a milestone done.**」但实测：
- `.archguard/` 从未提交（`git log -- .archguard` 空；目录 09:31 才首次生成）；
- `grep -rln "archguard" plugin/scripts/*.ts *.sh .claude/workflows/*.js scripts/test.sh` ⇒ 8 文件命中，**逐个核实全部是把它当【另一个项目名】提及**（`drivable-workspace-check.ts` / `external-dogfooding-check.ts` 里 `/home/yale/work/archguard` 是 dogfood 的外国项目、`runner-red-parse.ts:23` 是注释引 archguard TASK-67），**零个真实 MCP 调用**。

manager 09:3xZ 那次是本仓历史上第一次真跑 archguard。这属于「规定存在、执行为零」——比「没有检查」更贵的形态（读的人以为它在跑）。

**一跑就出结果**（证明不是「跑了也没用」，而是结构信号一直被忽略）：`classes=0 · enums=0 · inheritance=3 · methodCount 除 ProviderClient(9) 外几乎全 0`；最被依赖者是渲染助手 `html(28)/escapeHtml(19)` 非领域概念；`Task` 9 依赖者 0 方法（贫血领域模型）；出度最高是过程式巨函数 `handleAllRoutes(23)/handleGate(14)`。

**⚠️ 仪器学发现（一并记进任务体）**：`detect_shape_smells` threshold=2 报 **0 smells**，而 `"done"` 明明散在 ~30 文件。原因精确——**该检测器找「enum 值被跨模块比较」，本仓 enum 数=0 ⇒ 没有可锚定的抽象，缺失本身对它不可见**。⇒「缺失的抽象，对『检测抽象被误用』的工具是隐形的」（硬规则 3b 新变体）。⇒ 接 archguard 不能只接 shape-smells，要接能看见「结构缺失」的那些（god-package / 依赖结构 / 重复抽象）。

## Plan

- 选一个真实机件接入 archguard（suite 前 / tick 核 / fan-in——具体接点实现时定，manager 未判定）；
- 接入面不限于 shape-smells，优先 god-package / 依赖结构 / 重复抽象（能看见「结构缺失」的维度）；
- `.archguard/` 产物进入可查载体（或 git 提交，或某判据消费）。

## Acceptance Criteria

- [ ] AC1（能取假，真实调用）：某个真实机件（suite / tick 核 / fan-in）里出现对 archguard 的**真实调用**（非注释、非项目名提及——按位置判定）；（⛔ 仍零真实调用 ⇒ 假）。
- [ ] AC2（能取假，负控制）：把该调用注掉，对应检查/门必须变红（fail-closed，证明它被消费而非摆设）；（⛔ 注掉不红 ⇒ 假）。
- [ ] AC3（能取假，产物消费）：`.archguard/` 产物进入可查载体（git 提交 或 被某判据读），`git log -- .archguard` 非空或判据读到；（⛔ 产物仍不可查 ⇒ 假）。

## Definition of Done

一个真实机件接 archguard（能看见「结构缺失」的维度）；AC1/AC2/AC3 全勾；`.archguard/` 产物进入 git 或判据载体；该接点能跑通并产出结构信号（god-package/依赖结构/重复抽象至少其一）。

## Touches

- plugin/scripts/（接入 archguard 的真实机件，具体接点实现时定）
- .archguard/（产物进入 git 或判据载体）
- scripts/test.sh 或 tick 核（若接 suite/tick 面）
- tasks/gap-archguard-zero-production-calls.md（自身）
