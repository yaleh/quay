---
id: gap-ac188-three-long-term-guarantee-goal-acs
title: 把 GOAL-007 三例的长期保证上移为 goal 层【在域】AC（各带非空 criterion、origin 点名来源 task）
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-188
---
## Proposal

正本：`goals/AC-188-goal-ac-criterion.md`（判据）+ `goals/GOAL-007-done-fixture.md`（三例原文）。

AC-188 判据当前取假（2026-09-07 实测：`goal-store.ts list` 里 in-scope criterion AC 38 条，`covered: 0/3`，exit 1）。GOAL-007 的三例——① `gap-fan-in-ff-retry-counter-scope`、② `gap-suite-load-sampler-orphan-process`、③ `gap-direct-to-develop-bypasses-fan-in-gates`——各自需要一条 goal 层 AC 长期承载其保证，而它们都不存在。

人已裁定方向【丁：不修，上移 goal 层】（AC-188 origin 逐字）：承认 task 层判据是一次性的，把需长期维持的保证显式上移为 goal 层 AC（goal-driver 每轮约 42s 已对其跑 gateCriterion）。本任务把「丁」的核心动作落地：为三例各建一条 goal 层 criterion AC。

范围边界（AC-188 origin 已划清）：本任务只交付【三条在域记录 + 各带非空可跑 criterion + origin 点名来源 task id】，不查这三条是否已跑过（那是 AC-191）、是否通过（那是 achieved-but-failing 处理者）。

## Plan

1. 逐条读 `goals/GOAL-007-done-fixture.md` 三例原文，提取每条需长期维持的保证与其生产载体：
   - ① ff 重试计数 per-cycle 不累计——载体 `.quay/fan-in-retries.jsonl`；runId 由 fm-* per-dispatch 变为 wk-prod-* per-driver-process 后，同一 runId 跨任务累计不得突破每周期预算
   - ② 不存在 cwd 指向已删 worktree 的孤儿 suite 进程——载体：进程 cwd × `git worktree list`
   - ③ 无绕过 fan-in 闸直落 develop 的提交——载体：git log develop 直接提交检测（先例 `plugin/scripts/direct-to-develop-bypass-check.ts`）
2. 用 `node packages/quay/src/goal-store.ts write <id> --title … --status active --goal GOAL-007 --criterion … --expect "exit 0" --origin …` 建三条。编号取现有最高 AC-191 之后、不复用：AC-192（slug `ff-retry-counter-per-cycle`）、AC-193（slug `no-orphan-suite-process`）、AC-194（slug `no-direct-to-develop-bypass`）；filename 由 `id-<slug>.md` 派生。
3. 每条 criterion 是可跑 shell 判据、非空 ≥20 字符、读真实生产载体（非 fixture 注入）；origin 逐字点名对应来源 task id（见上）。
4. 跑 AC-188 判据确认 `covered: 3/3`、exit 0；再对三条各 `goal-store.ts gate <id>` 确认能产出 pass/fail（非恒 not-evaluated）。

## AC

- [x] AC-188 判据 exit 0：`covered: 3/3`（三个来源 task id 各被一条在域 criterion AC 的 origin 点名）
- [x] 可证伪性（硬规则④）：立案时 AC-188 判据实测 `covered: 0/3`、exit 1（本任务已干跑确认）——完成前后读数不同，排除恒真
- [x] 三条新记录各满足 kind=criterion、status=active、goal=GOAL-007、criterion 非空≥20 字符、origin 点名来源 task id（`node packages/quay/src/goal-store.ts list --root .` 逐条读）
- [x] 自满足防护：三条 id ∈ {AC-192,AC-193,AC-194}，且 ∉ {GOAL-007,AC-188,AC-189,AC-190,AC-191}（判据按 id 排除 SELF）
- [x] 每条 criterion 可跑：`for i in 192 193 194; do node packages/quay/src/goal-store.ts gate AC-$i; done` 三条各打印 verdict（pass|fail），无一条报「no criterion defined」
- [x] `node packages/quay/bin/quay.ts task check gap-ac188-three-long-term-guarantee-goal-acs --json` 的 `missing` 为 `[]`

## DoD

`goals/` 下三条真实 AC 记录（AC-192/193/194），每条 criterion/origin 是从 GOAL-007 三例原文【逐条】提炼的可跑判据（非占位、非空），AC-188 判据在生产工作树上 exit 0（`covered: 3/3`）——不是靠 fixture 注入，而是 `node packages/quay/src/goal-store.ts list --root .` 真实读出三条、且按 origin 定位到各自来源 task。仅新增文件而 list 读不出、或 criterion 全为空占位 ⇒ 不算完成。

## Touches

- goals/AC-192-ff-retry-counter-per-cycle.md (new)
- goals/AC-193-no-orphan-suite-process.md (new)
- goals/AC-194-no-direct-to-develop-bypass.md (new)
- packages/quay/test/goal-store.test.mjs
- tasks/gap-ac188-three-long-term-guarantee-goal-acs.md