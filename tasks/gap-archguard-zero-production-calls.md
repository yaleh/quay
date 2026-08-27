---
id: gap-archguard-zero-production-calls
title: archguard 从未被真实调用，而 CLAUDE.md 明令「Consult it before calling a milestone
  done」——规定存在、执行为零
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  correction_note: pool-quality-judge 误判 should-remove（采信 07-20 过期注释）→ 已恢复
    ready。实测：archguard 现能解析本仓（07-23 6f183ef9 加 tsconfig 后），.archguard/output/src
    367 entities / scripts 2017 entities；crossDomainFusions 找到 4 族重复
    store（createAdrStore/createDocumentStore/createGoalStore，assertSafeId/assertSafeStatus
    逐字节复制），真实结构洞见非空跑。
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

- [x] AC1（能取假，真实调用）：某个真实机件（suite / tick 核 / fan-in）里出现对 archguard 的**真实调用**（非注释、非项目名提及——按位置判定）；（⛔ 仍零真实调用 ⇒ 假）。
  - 证据：`plugin/scripts/archguard-runner.ts` 里 `spawnSync(cli, ["analyze", "--lang", "typescript", "--format", "json", ...])` 是代码位置的**真实 CLI 调用**，且被 `scripts/test.sh` `run_selected`（全量 suite 路径，`run_static_checks` 之后）以 `run_checker "archguard-structure-check" node ... archguard-runner.ts --root` 接线。实测 `node ... archguard-runner.ts --root .` 跑通两 scope（src 392 entities / scripts 2113 entities），输出 `PASS — no dependency cycles in any scope`。
- [x] AC2（能取假，负控制）：把该调用注掉，对应检查/门必须变红（fail-closed，证明它被消费而非摆设）；（⛔ 注掉不红 ⇒ 假）。
  - 证据（两条负控制均 exit 1）：① PATH 剥离 archguard ⇒ `archguard CLI not found on PATH (fail-closed)` exit 1；② 把 runner 内 `runAnalyze` 调用逐行注掉 + `rm -rf .archguard/output` ⇒ `cannot read archguard output ... (fail-closed)` exit 1。fail-closed 由「读不到产物就 exit 1」构造保证，注掉调用 ⇒ 读不到 ⇒ 红。
- [x] AC3（能取假，产物消费）：`.archguard/` 产物进入可查载体（git 提交 或 被某判据读），`git log -- .archguard` 非空或判据读到；（⛔ 产物仍不可查 ⇒ 假）。
  - 证据：走「被某判据读」半边——runner 读回 `.archguard/output/{src,scripts}/class/all-classes.json` 的 `metricVector.sccCount` 作为判据输入，并把逐次结构信号 append 进 `.archguard/metrics-history.jsonl`（`cat` 可查的追加载体；`.archguard/` 整体 gitignored 属 archguard 自身 cache/metrics，故不 walk「git 提交」半边）。

## Definition of Done

一个真实机件接 archguard（能看见「结构缺失」的维度）；AC1/AC2/AC3 全勾；`.archguard/` 产物进入 git 或判据载体；该接点能跑通并产出结构信号（god-package/依赖结构/重复抽象至少其一）。

## Touches

- plugin/scripts/archguard-runner.ts
- .archguard/metrics-history.jsonl
- scripts/test.sh
- plugin/scripts/capability-catalog.sh
- docs/proposals/quay-product-outline.md
- tasks/gap-archguard-zero-production-calls.md（自身）
