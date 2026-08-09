---
id: gap-todo-shape-mismatch-author-gate
title: "todo 形状与晋级闸不匹配——38/42 todo 缺 ## Contract（DIR-* 指令类 Contract=0 AC=0），过不了
  author→ready 闸，② 阻塞的机制根；meta-cc 同病两犯（14 todo 全被拒）"
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**42 条 todo 里 38 条缺 `## Contract`（27 条只有 Touches 缺 Contract、11 条两节都缺、仅 4 条齐全）——过不了 author→ready 晋级闸（fourArtifacts 要求 Proposal/AC/Touches/DoD + Contract），全部被 `ready-pool-check` 判 ineligible。② 池位义务的阻塞根因是【任务形状与晋级闸不匹配】：DIR-* 指令类任务用的是另一种形状（Contract=0 AC=0），晋级闸对它们全部拒绝。这是跨项目重复出现的同一问题——meta-cc 那边「14 个 todo(DIR-082..100) 全过不了 author→ready 闸，task_check 实证 ## Finding 不计入 proposal」。同一个闸、同一种形状不匹配，在两个项目各犯一次。**

### 实证（manager 2026-08-09 核实 + outer 复核）

- **todo 结构完备率**（42 条）：两节都缺 11 条、只有 Touches 缺 Contract 27 条、两节齐全仅 4 条 ⇒ **38/42 缺 Contract**。
- **抽验前 6 条全 DIR-***：DIR-100-B/C、DIR-118、DIR-119-C/D/D5——`Contract=0 AC=0`（指令类任务形状）。
- **晋级闸拒绝**：`ready-pool-check` 的 eligible = `depsReady && fourArtifacts.complete && touchesResolve && !retiredMechanism`；fourArtifacts 要求 Proposal/AC/Touches/DoD+Contract。38 条缺 Contract ⇒ 全 ineligible。
- **跨项目重复**：CLAUDE.md 记 meta-cc「14 个 todo(DIR-082..100) 全过不了 author→ready 闸，task_check 实证 ## Finding 不计入 proposal」——同一个闸、同一种形状不匹配。

**为什么重要**：② 不是「pool 数字没到」的算术问题，是「任务形状与闸不匹配」的结构问题。继续在 pool 数字上使劲（promote 不进去的）是治标；根因是 DIR-* 指令类任务没有 Contract，且晋级闸的 fourArtifacts 不认指令类形状。meta-cc 同病两犯 ⇒ 这是跨项目机制缺陷。

**修的方向（实现归内层）**：
- 候选 A：**DIR-* 指令类补 Contract**——批量给 38 条 todo 补 `## Contract` 六键（或指令类专用 Contract 形状），让它们过闸。
- 候选 B：**晋级闸识别指令类**——fourArtifacts 对 DIR-*/指令类任务放宽（指令类不要求 Contract，或认其专用形状）。
- 候选 C：**跨项目机制统一**——CLAUDE.md 的 author→ready 闸对「任务形状」的判据统一（Contract 是否必要、指令类是否豁免），quay/meta-cc 同一判据。

**验证锚**：修后，(a) 38 条缺 Contract 的 todo 中可补的补上（pool 回升）；(b) DIR-* 指令类有明确的晋级路径（补 Contract 或闸识别指令类）；(c) meta-cc 同病不再犯（跨项目判据统一）。

## Acceptance Criteria

- [ ] AC1: **复现固化**——任务体记录实证（38/42 todo 缺 Contract、抽验 6 条 DIR-* 全 Contract=0 AC=0、晋级闸 fourArtifacts 拒绝、meta-cc 同病两犯）（本任务 Proposal 已含；内层补：ready-pool --json 复现 38 ineligible）
- [ ] AC2: **DIR-* 指令类有晋级路径**——补 Contract 或闸识别指令类（候选 A/B 任一），指令类任务可过 author→ready
- [ ] AC3: **pool 回升**——38 条补 Contract 后 pool 显著回升（≥floor 或至少 deficit 归零）
- [ ] AC4: **跨项目判据统一**——CLAUDE.md 的 author→ready 闸对任务形状判据统一（quay/meta-cc 同一），meta-cc 同病不再犯（交叉标注）
- [ ] AC5: **既有机制不回归**——`--for-task` scoped 门绿（含 ready-pool / author-gate 契约检查）

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：38 条 todo 晋级路径打通；pool 回升；meta-cc 同病不再犯（贴任务体）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/ready-pool-check.ts（候选 B：fourArtifacts 识别指令类 / Contract 必要性）
- tasks/DIR-100-B.md（候选 A：38 条 todo 缺 Contract 的具体目标——批量补 ## Contract 六键或指令类专用形状）
- tasks/DIR-100-C.md
- tasks/DIR-118.md
- tasks/DIR-119-C.md
- tasks/DIR-119-D.md
- tasks/DIR-119-D5.md
- tasks/DIR-124-A.md
- tasks/DIR-124-A1.md
- tasks/DIR-124-B.md
- tasks/DIR-124-B2.md
- tasks/DIR-124-B3.md
- tasks/DIR-124-C.md
- tasks/DIR-124-D.md
- tasks/DIR-124-E.md
- tasks/DIR-124-F-core.md
- tasks/DIR-124-F-learn.md
- tasks/DIR-124-F.md
- tasks/QC-T1.md
- tasks/TG.md
- tasks/gap-cold-start-skill-has-no-recovery-branch.md
- tasks/gap-commit-message-claims-verified-without-verification.md
- tasks/gap-execute-milestone-build-admission-and-verification-fuse.md
- tasks/gap-green-verdict-ac1-ac2-mechanisms-not-effective.md
- tasks/gap-inner-blocked-signal-comment-refs-retired-inner-state-sh.md
- tasks/gap-needs-human-routing-does-not-close-bracket.md
- tasks/gap-no-formalized-bare-metal-session-bootstrap.md
- tasks/gap-over90-clock-measures-queue-time-not-work-time.md
- tasks/gap-prepare-milestone-no-size-aware-routing-A.md
- tasks/gap-prepare-milestone-no-size-aware-routing-B.md
- tasks/gap-prepare-milestone-no-size-aware-routing-C.md
- tasks/gap-quay-has-never-self-hosted-its-own-cold-start.md
- tasks/gap-quay-init-laydown-dominant-red-suite-blocker.md
- tasks/gap-quay-init-never-writes-branch-model-config-fork-baseline-merge-target.md
- tasks/gap-quay-last-pane-txt-untracked-dirties-tree.md
- tasks/gap-quay-self-hosting-e2e-proof.md
- tasks/gap-suite-red-verdict-carries-empty-failures-payload.md
- tasks/gap-supervisor-deliver-no-wait-for-idle-retry.md
- tasks/gap-workflow-metadata-warn-omissions.md
- CLAUDE.md（候选 C：author→ready 闸任务形状判据统一，quay/meta-cc 同判据）
- docs/proposals/（候选 C：跨项目判据文档）
- tasks/gap-todo-shape-mismatch-author-gate.md（自身：勾 AC + 贴证据）

## Contract

measure   todo_contract_gap = `python3` 统计 todo 中缺 `## Contract` 的条数（或 ready-pool ineligible 数）
band      todo_contract_gap = 0（38 → 0，全部有晋级路径）
invariant dir_tasks_promotable = 1（DIR-* 指令类可过 author→ready）
invariant cross_project_gate_uniform = 1（quay/meta-cc 同一任务形状判据）
invoke    `node --no-warnings --experimental-strip-types plugin/scripts/ready-pool-check.ts --root /home/yale/work/quay --json`（贴回 ineligible 数）
control   38 → 0；DIR-* 可晋；meta-cc 同病不犯
resume    补 Contract / 闸识别指令类 / 跨项目判据统一分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-09
changed: 建任务（manager 核实根因：38/42 todo 缺 Contract、DIR-* 指令类形状与晋级闸不匹配、meta-cc 同病两犯——② 阻塞的机制根，非 pool 数字问题。实现归内层）
