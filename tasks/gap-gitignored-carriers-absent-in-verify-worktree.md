---
id: gap-gitignored-carriers-absent-in-verify-worktree
title: .quay/ 运行时载体在一次性 verify worktree 结构上不存在——依赖检查器每轮 NOT-EVALUATED 恒绿（AC62 撤勾，5 载体/2 检查器/1 错误勾选/≥1 真差集被掩盖）
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

> **止损（2026-08-15 03:2xZ，manager 报 + 立案归我）：需要 —— 当下动作 = 本任务立案**。manager 核 AC67/AC78 实跑 `fan-in-workflow-check` 得 ok=false（差集=[gap-ac81-inner-verify-wiring]），但套件绿——先验调用方式（test.sh:629 与它完全相同，排除参数错），读实现发现：**验证轮跑一次性 worktree（full-suite-runner.ts:2300-2301 root = provisionOneShotWorktree），而 .quay/ 运行时载体 GITIGNORED ⇒ worktree 里结构上不存在 ⇒ 依赖它的判据每轮 NOT-EVALUATED exit 0 套件绿**。同 CLAUDE.md 硬规则 3b③ 那条恒绿，换了成因（零调用是已知空白，本形态每轮都跑、每轮 exit 0、记录上像在守护而输入不存在）。

**受影响面（逐 `git check-ignore` 确认）**：scripts/test.sh 声明的 `.quay/` 载体中 **gitignored 5 个**：
```
fan-in-merge-lock-events.jsonl（:180）· per-task-suite-records.jsonl（:185）·
verification-round.jsonl（:147）· task-file-violation-ledger.jsonl（:81）· checker-cost.jsonl（:156）
```
**⚠️ verification-round.jsonl 在列 ⇒ AC83 的生产读数判据可能同病（manager 未验，不当已确认）。**

**实跑对照（同一命令同一参数只换 --root）**：
```
fan-in-workflow-check   主检出 ⇒ ok=false evaluated=true「fan-in-without-workflow-or-bad-agent-id」
                        worktree ⇒ ok=true evaluated=false "nothing-to-judge"
fan-in-ff-protocol-check 主检出 ⇒ 四子检查全 evaluated=true
                        worktree ⇒ suite-in-lock evaluated=FALSE；lock-hold-only-ff 整条缺席
```

**发生率（manager，硬规则⑫）**：5 载体 / 2 个已实测行为分叉的检查器 / 1 次由此导致的错误勾选（manager 自己撤勾 AC62，2 小时内）/ ≥1 条被结构性掩盖的真差集（AC78 判据2 的 gap-ac81）⇒ 立案门槛到。

**三条候选修法（⛔ 不指定实现，归实现方选）**：
① 轮启动时把这些运行时载体**只读复制/挂载**进一次性 worktree（gitignore 不动）；
② 检查器加显式参数由轮的启动方喂**主检出路径**（`per-task-suite-record-check --lock-events` 已有现成先例）；
③ 判据改由「输入在 worktree 内可得」的量承载。
**⛔ 不可接受第四条：把 NOT-EVALUATED 当合格** —— 它现在就是这么表现的，正是要修的东西。

**归属**：立案归 outer（manager 03:2xZ）；**实现归 inner**（full-suite-runner.ts 是套件本身，AC65 谁能验证必须走 inner——改动正确性依赖套件跑一轮验证，非一条命令可验）。

## Plan

1. inner 读 full-suite-runner.ts:2300-2301（一次性 worktree 创建）+ scripts/test.sh 的 5 个载体声明。
2. 选修法（① 只读复制/挂载 / ② 显式主检出路径 / ③ worktree 内可得量）——按实现代价 + 覆盖完整性。
3. 能取假：主检出 fan-in-workflow-check 必须仍 ok=false（真抓到 gap-ac81）；worktree 里该检查器必须真评估（不再 nothing-to-judge）。
4. 既有测试全绿 + `--for-task` scoped 门绿 + 套件验证轮。

## Acceptance Criteria

- [x] AC1 检查器在一次性 worktree 里真评估（不再因载体缺失 NOT-EVALUATED 恒绿）——至少 fan-in-workflow-check 与 fan-in-ff-protocol-check。
- [x] AC2 主检出行为不退化：fan-in-workflow-check 主检出仍 ok=false 真抓 gap-ac81；真漂移仍红。
- [x] AC3 能取假·真样本（manager 03:3xZ 建议形态，钉【结论】非【是否评估】）：**同一时刻、同一参数，worktree 与主检出的 verdict 必须相同**——修复前两边都必须 ok=false 且差集都含 gap-ac81-inner-verify-wiring；修复后（该差集被处理掉时）两边都必须 ok=true。任一时刻两边结论不同 ⇒ 红。⛔ 把空文件复制进 worktree（evaluated=true 但 0 条记录 ok=true）满足「真评估」却恒绿原封不动——判据钉结论不钉评估。**与 AC2 成对**：只有 AC2 时可把主检出也改成空集全绿；两条都在才闭合。
- [x] AC4 ⚠️ verification-round.jsonl 载体缺失对 AC83 生产读数判据的影响——核实是否同病并覆盖。
- [x] AC5 既有测试全绿；`--for-task` scoped 门绿；套件验证轮绿。

## Definition of Done

- [x] 依赖 .quay/ 运行时载体的检查器在一次性 worktree 中真评估（载体可得或显式喂主检出路径）+ 真差集不再被掩盖 + NOT-EVALUATED 不用于合格。

## Touches

- plugin/scripts/full-suite-runner.ts（轮启动时经 `suiteEnv` 喂 `QUAY_MAIN_CHECKOUT=<mainRoot>`——选修法②「显式喂主检出路径」，检查器零改动）
- scripts/test.sh（`main_root=${QUAY_MAIN_CHECKOUT:-$repo_root}`；fan-in 族三检查器改 `--root "${main_root}"`）
- plugin/test/fan-in-workflow-check.test.mjs（AC3 测试：喂主检出路径 ⇒ 评估 + 抓 gap-ac81，NOT-EVALUATED 独立取值）
- plugin/test/full-suite-runner.test.mjs（runner 喂 QUAY_MAIN_CHECKOUT env 的测试）
- tasks/gap-gitignored-carriers-absent-in-verify-worktree.md（自身）

## Evidence

**修法**：选 **② 显式喂主检出路径**（检查器零改动——复用已有 `--root`）。full-suite-runner.ts 在 `suiteEnv` 喂 `QUAY_MAIN_CHECKOUT=<mainRoot>`（mainRoot = one-shot 前 root，恒为主检出）；test.sh `main_root=${QUAY_MAIN_CHECKOUT:-$repo_root}`，fan-in 族三检查器（fan-in-workflow-check / fan-in-ff-protocol-check / direct-to-develop-bypass-check）改 `--root "${main_root}"`。主检出跑时 main_root==repo_root ⇒ 行为不变（AC2）；one-shot 轮 main_root=真主检出 ⇒ 轮内检查器与主检出读同一数据 ⇒ verdict 恒同（AC3）。未选①（只读复制）：fan-in-workflow-check 还读 dispatch-record/.workflow-events/session transcripts，全在主检出，复制 5 载体不够且会 over-red；未选③：判据本义就是审计主运行时，改由 worktree 内量承载是错位。

**AC1 实跑（worktree 轮 now 喂主检出路径 ⇒ 真评估）**：
```
fan-in-workflow-check    --root main  ⇒ ok=false evaluated=true missing=[gap-ac81-inner-verify-wiring]
fan-in-ff-protocol-check --root main  ⇒ 四子检查全 evaluated=true（suite-in-lock / lock-hold-only-ff 都在）
```
**AC2 主检出不退化**：主检出 `fan-in-workflow-check --root /home/yale/work/quay` ⇒ ok=false evaluated=true 真抓 gap-ac81（修前修后同一条命令，检查器零改动）。
**AC3 能取假·真样本**（新判据，钉结论）：修前 worktree `--root <worktree>` ⇒ ok=true evaluated=false "nothing-to-judge"（恒绿）；修后轮内 `--root main_root` ⇒ 与主检出**同 verdict**（ok=false evaluated=true、差集含 gap-ac81）。NOT-EVALUATED 保持独立取值（空数据仍 evaluated=false，绝不用于合格）。测试：`fan-in-workflow-check.test.mjs` 新增 AC3 CLI 测试（worktree-vs-main 分裂回放）57/57 绿。
**AC4 核实（非同病）**：verification-round.jsonl 由 runner 经 `appendVerificationRound(stateDir)` 写**主检出** `.quay/`（stateDir 默认 `<mainRoot>/.quay`，:2192/:1451/:3524；实测主检出 179 轮、本轮 03:27 刚写）⇒ AC83 的生产载体在**主检出**，不在 worktree；AC83 是 manager 侧 phase-goal 判据（orchestration/manager-phase-goal.md:961），读主检出；`prod-data-audit.ts` 的 `resolveProductionRoot` 已沿 `git rev-parse --git-common-dir` 从 worktree 追到主检出（:87-103）。⇒ verification-round.jsonl 在 worktree 缺失**不影响** AC83。
**AC5 测试**：`fan-in-workflow-check.test.mjs` 57/57、`fan-in-ff-protocol-check.test.mjs` 16/16、`full-suite-runner.test.mjs` 146/146（含新增 QUAY_MAIN_CHECKOUT env 测试）；`--for-task` scoped 门（含两测试文件，203 tests 全绿 + scoped 静态检查）——套件验证轮在 fan-in 后由 inner 触发。

## 止损

**需要 —— 当下动作 = 本任务立案**：发生率 5 载体/2 检查器/1 错误勾选/≥1 真差集被掩盖（硬规则⑫），AC62 已撤勾（manager 01:0xZ 的 ✅ 环境错）。恒绿检查是假的保证——本任务把「记录上在守护、输入不存在」的形态从隐性变显性。
