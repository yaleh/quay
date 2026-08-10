---
id: gap-pool-quality-semantic-gate
title: pool 任务质量语义闸——proof-once-then-lost:nyf-semantic-judge workflow(49c0be86
  flip 4,24min)因三层执行核只有「检测没被调用」仪器无「调用」步骤而丢失；ADR-033 已 accepted 锚定「需要语义的值必须
  agent()」;处方=泛化为 pool-quality-judge(判词加 should-remove 档:前提证伪→撤出,如 crosscut
  RESCOPE)+做成执行核带机械触发的编号步骤(触发机械量/判定 agent)
status: ready
labels:
  - gap
  - defect
parent: "null"
children: []
extra: {}
---
**type:** execution

## Proposal

**pool 任务质量保障是 outer 的语义活——机械脚本只能辅助（ADR-033，已 accepted）。本仓库 2026-08-09 证明过一次然后丢失：`nyf-semantic-judge` workflow（16:49 后台起跑 → 17:13 翻转 4 个 done，24 分钟，并行做其它 tick 事务），19 个 nyf 任务每个一个 schema agent 出 `{verdict, acCompleteness, evidence, recommendFlip}`，筛选计数用普通 JS——触发用机械量、判定用 agent，正是 ADR-033 的完整形态。丢失原因：三层执行核（orchestrator/fast-mode/manager tick-core）都有「检测 workflow 没被调用」的仪器，没有一层有「调用 workflow」的步骤——仪器在测一个从未被规定过的动作。处方：把 `nyf-semantic-judge` 泛化为「pool 任务质量语义闸」，判词加 `should-remove` 档（前提证伪 → 撤出/重定范围），做成执行核带机械触发条件的编号步骤。**

### 实证（人 2026-08-10 提出 + outer 核实）

- **模板在磁盘**：`~/.claude/projects/-home-yale-work-quay/7795bb75-.../workflows/scripts/nyf-semantic-judge-wf_a9cc0bb4-807.js`（3476 字节，schema agent 每任务一个）。
- **证明实例**：`49c0be86`（1786295598）——「close-pass ③ — flip 4 nyf to done per nyf-semantic-judge workflow (landed+recommendFlip): capability-catalog, proposal-convergence-load-flake, scripts-sprawl, single-file-duration-trend」，提交信息带每任务 agent 证据。
- **丢失原因（逐 grep 三份执行核）**：orchestrator-tick-core 命中 workflow 1 次（A14 引用 manager A9 手法做类比，非执行步骤）；fast-mode-tick-core 1 次（头部叙述）；manager-tick-core 2 次（A9，检测 manager 有没有调用）——**三层都有「检测 workflow 没被调用」的仪器，没有一层有「调用 workflow」的步骤**。
- **同死因对照**：manager 84 次读数 workflow（07-25→08-01）死于「只活在意志里，不在锚指向的文件里」——本 workflow 同死因。
- **今晚活案例**：`gap-crosscut-checks-zero-coverage-of-plugin-scripts` 前提被证伪（plugin/scripts 其实被 scoped 选择覆盖），我手工 RESCOPE——如果有这道语义闸，它本不该以那个形态进 pool。

**为什么重要**：pool 质量是「需要语义才能产生的值」——脚本只能辅助（AC 计数、Touches 解析），真正判定（前提是否成立、工作是否落地、是否该撤出）要 agent。ADV-033 已 accepted，本条是该原则的第一个落地执行步骤。

### 选定机制方向（实现归内层 + outer 执行核接线）

1. **泛化 workflow**：`nyf-semantic-judge` → `pool-quality-judge`——判词扩展为 `ready`（质量确认可派发）/ `needs-work`（不完整）/ **`should-remove`（前提证伪 → 撤出/重定范围）** / `uncertain`（verification-window/需人）。每任务一个 schema agent 出 `{verdict, acCompleteness, premiseSound, evidence, recommendation}`，筛选计数用普通 JS。
2. **执行核编号步骤**：orchestrator-tick-core 增编号步骤（机械触发）：pool > 25 OR 最久未复核任务年龄 > 48h OR 每 10 轮 verification-round——触发用机械量、判定用 agent。**这是「调用 workflow」的步骤，不是「检测没被调用」的仪器。**
3. **ADR-033 已 accepted**（本任务前提已锚定）。

**验证锚**：修后 (a) workflow 泛化后跑一次 pool-quality-judge（贴判词分布）；(b) 执行核有编号步骤（grep 命中「调用 workflow」步骤）；(c) 触发条件机械量在档。

## Acceptance Criteria

- [ ] AC1: **复现固化**——任务体记录证明实例（49c0be86 + 模板路径）+ 丢失原因（三层仪器无步骤）+ 同死因对照（本任务 Proposal 已含）
- [ ] AC2: **workflow 泛化**——`pool-quality-judge` 判词含 ready/needs-work/should-remove/uncertain，每任务 schema agent + JS 计数
- [ ] AC3: **执行核编号步骤**——orchestrator-tick-core 增「调用 workflow」步骤（机械触发：pool>25 / 最久未复核>48h / 每 10 轮）
- [ ] AC4: **should-remove 生效**——前提证伪任务被判 should-remove → 撤出/重定范围（不是进 pool）
- [ ] AC5: **既有不回归**——`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：pool-quality-judge 跑一次贴判词分布（含 should-remove 案例）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- orchestration/orchestrator-tick-core.md（B 段增「调用 pool-quality-judge workflow」编号步骤 + 机械触发条件）
- plugin/scripts/ 或 workflow 模板（pool-quality-judge 泛化：判词含 should-remove）
- plugin/test/known-load-sensitive.test.mjs（AC2 workflow 泛化条目测试，若脚本化；候选路径已声明）
- adr/ADR-033-schema-agent.md（已 accepted，本任务前提锚定）
- tasks/gap-pool-quality-semantic-gate.md（自身：勾 AC + 贴判词分布）

## Contract

measure   pool_quality_judge_ran = `grep -c "pool-quality-judge" orchestration/orchestrator-tick-core.md` 的 stdout 数字
band      pool_quality_judge_ran >= 1（执行核有「调用 workflow」编号步骤）
invariant should_remove_tier_present = 1（判词含 should-remove）
invariant trigger_is_mechanical = 1（触发用机械量：pool>25 / 年龄>48h / 每 10 轮）
invariant judgment_is_agent = 1（判定用 schema agent，脚本只做算术——ADR-033）
invoke    `node --no-warnings --experimental-strip-types <pool-quality-judge workflow 或脚本> --root <repo>`（跑一次贴判词分布）
control   判词含 should-remove；触发机械量；判定 agent；执行核有编号步骤
resume    workflow 泛化 / 执行核步骤 / 触发条件分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-10
changed: 人提出（ADR-033 原则应用）——pool 质量是语义活,机械脚本只能辅助;证明过一次（nyf-semantic-judge 16:49→17:13 flip 4）然后丢失（三层仪器无步骤）。裁定：判词加 should-remove 档（前提证伪→撤出,如 crosscut RESCOPE 案例）;做成执行核编号步骤（机械触发:pool>25/年龄>48h/每 10 轮,触发机械、判定 agent）;ADR-033 已 accepted。实现归内层 + outer 执行核接线
