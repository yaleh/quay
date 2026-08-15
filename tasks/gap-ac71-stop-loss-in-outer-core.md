---
id: gap-ac71-stop-loss-in-outer-core
title: AC71 止损义务接入 outer 执行核——报/裁活行为缺陷必带止损行（manager C21 已落，outer 侧同义条款缺失）
status: done
labels:
  - gap
  - process
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

> **止损（2026-08-15 立案，人 04:3xZ 裁定「处理问题必须同时覆盖【机制】与【止损】」——本条即止损行的实例化）**：**需要 —— 当下动作 = 本任务把止损义务接入 outer 执行核**。AC71 是唯一真无载体的阶段 AC（manager 23:3xZ 双向核实：`ls tasks/ | grep -ci 'ac71'` = 0；语义反查 `grep -rl '止损' tasks/*.md` 命中 6 条全是 ac67/68/69/70/72/74，无一条是 AC71 载体——「止损行实践」已存在于多个任务体，但 AC71 本身的机制（外层核内义务）无任务承载）。manager 判「立案归 outer」（人 04:3xZ 裁定适用于 manager/outer 两层；manager 侧 C21 已落 `manager-tick-core.md`，outer 侧同义条款由 outer 落自己的核——`orchestrator-tick-core.md` 是 outer 边界）。

**AC71 判据（phase-goal 逐字）**：
```
范围：只覆盖【活行为】里的缺陷（该错误行为此刻仍在跑）；纯代码/文档缺陷不适用。
两项义务，缺一即未处理：(a) 修机制（立案/排期/落地）← 一直在做；(b) 止损（错误行为还在跑，要不要立刻压住）← 新增的一半。

判据1（形态·产物是本来就要写的东西）：报/裁一条活行为缺陷时，投递与立案里各带一行
  `止损：不需要 —— 理由<读数>` 或 `止损：需要 —— <当下动作>`。
判据2（三个关口）：① 不能漏（「判过且结论是不需要」与「根本没想到」同形）；② 不能被前置吃掉
  （止损 = 用现有材料先压住出血；需要新机件不是止损是提前实现）；③ 判据不得是自述量。
判据3（能取假·真样本）：AC68/AC69 立案时均无止损行（事后补）⇒ 回放它们必须报红。
归属：manager 侧已落 C21；outer 侧同义条款由 outer 落自己的核。
```

**manager C21（已落，outer 镜像的模型）**：报/裁【活行为】缺陷 ⇒ 投递与记录各带一行 `止损：...`；① 不能漏 ② 不能被前置吃掉 ③ 判据不得自述 ④「不需要」绑当时读数，读数变了重判 ⑤ 过订阅未解前 load-sensitive flake 归因不可信 ⑥ 形态 = 「不编辑也不提交」⑦ 同时写下防的路径此刻是否已启用。

**outer 侧现状（已核）**：`orchestrator-tick-core.md` B-segment 无任何 `止损` 义务（grep 0 命中业务语义——仅 `.halt` 触发判据里提「止损」一次，非本条义务）；`tasks/gap-ac71-*.md` 不存在。**⇒ 缺 outer 侧同义条款，AC71 判据1 对 outer 无落点。**

## Plan

1. 读 manager C21 完整条款（`orchestration/manager-tick-core.md` C21 行）+ AC71 判据逐字（已读）。
2. outer 执行核 B-segment 加 `止损:` 义务条款（镜像 C21 七点，按 outer 形态适配）——落 `orchestration/orchestrator-tick-core.md`（C17 outer 独占，本任务直接落盘）。
3. AC71 判据3 能取假：AC68/AC69 两条任务体立案段无止损行的历史态 → 回放必须报红（真样本不构造）。
4. 本任务自身带 `止损:` 行（判据1 形态——已在本 Proposal 首行）。
5. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [x] AC1 判据1：outer 执行核 B-segment 有 `止损:` 义务条款（报/裁活行为缺陷 ⇒ 投递与记录各带一行，含 ①不能漏 ②不被前置吃掉 ③判据不自述 ④绑读数 ⑤flak 归因 ⑥形态 ⑦启用检查）——镜像 manager C21，位置判定。（**补勾 2026-08-15：B18 落 `orchestrator-tick-core.md:68`，tick-core-static-check 58/58 PASS——outer 核实**）
- [x] AC2 判据3 能取假：AC68/AC69 立案段无止损行（事后补）回放必须报红——真样本不构造（D2）。（**补勾 2026-08-15：AC68/AC69 立案提交 e69beef0 止损计数均 0，事后 cba1f2e6 补入——回放红成立——outer 核实**）
- [x] AC3 本任务自身带 `止损:` 行（判据1 形态实例——Proposal 首行）。（**补勾 2026-08-15：Proposal 首行 + 文末 `## 止损` 段——outer 核实**）
- [x] AC4 既有测试全绿；`--for-task` scoped 门绿。（**补勾 2026-08-15：--static-checks-doc exit 0（FAMILY-4/5 ok）+ tick-core-static-check PASS——outer 核实**）

## Definition of Done

- [x] outer 执行核 `orchestrator-tick-core.md` 含 `止损:` 义务条款 + AC68/AC69 回放红 + 本任务止损行。

## Touches

- orchestration/orchestrator-tick-core.md（C17 outer 独占——B-segment 加止损义务条款）
- tasks/gap-ac71-stop-loss-in-outer-core.md（自身）
- （如需产物化判据3：plugin/scripts/ 新增检查器 + test.sh 接线 + 测试——按需要评估，核心判据是执行核条款的位置判定）

## Evidence

**AC1（判据1，B18 条款在 outer 执行核——位置判定）**：`orchestration/orchestrator-tick-core.md:68` 新增 B18「止损义务」条款（镜像 manager C21 七点：①不能漏 ②不被前置吃掉 ③判据不自述 ④绑读数 ⑤flak 归因 ⑥不编辑也不提交 ⑦防的路径是否启用），含 `止损：不需要——理由<读数>` ∨ `止损：需要——<当下动作>` 两形态。`tick-core-static-check` 58/58 src:N 覆盖 PASS。

**AC2（判据3，AC68/AC69 回放红——真样本位置判定）**：AC68 与 AC69 在立案提交 `e69beef0`（08-14 04:05）的 `止损` 计数均 **0**（真实缺席样本），止损行系事后 3 分钟 `cba1f2e6`（04:08「AC68/69 add 止损 judgment lines」）补入 ⇒ 回放立案态必须报红（0 止损 = 缺形态）。不构造，取 git 历史真实提交。

**AC3（本任务带止损行）**：Proposal 首行 `止损：需要 —— 当下动作 = 本任务把止损义务接入 outer 执行核` + 文末 `## 止损` 段——判据1 形态实例。

**AC4（门绿）**：`scripts/test.sh --static-checks-doc` exit 0（FAMILY-4/5 ok）；tick-core-static-check PASS（58/58）；ts-typecheck ADMITTED（无新增 .ts）。

## 止损

**需要 —— 当下动作 = 本任务落地**：把止损义务接入 outer 执行核（B-segment 条款 + 本任务作载体）。AC71 是唯一真无载体 AC，立案即止损线落地；此后 outer 报/裁活行为缺陷必带止损行，AC71 判据1 对 outer 有落点。
