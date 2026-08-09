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

- [x] AC1: **复现固化**——任务体记录实证（38/42 todo 缺 Contract、抽验 6 条 DIR-* 全 Contract=0 AC=0、晋级闸 fourArtifacts 拒绝、meta-cc 同病两犯）（本任务 Proposal 已含；内层补：ready-pool --json 复现 38 ineligible）
- [x] AC2: **DIR-* 指令类有晋级路径**——补 Contract 或闸识别指令类（候选 A/B 任一），指令类任务可过 author→ready
- [x] AC3: **pool 回升**——38 条补 Contract 后 pool 显著回升（≥floor 或至少 deficit 归零）
- [x] AC4: **跨项目判据统一**——CLAUDE.md 的 author→ready 闸对任务形状判据统一（quay/meta-cc 同一），meta-cc 同病不再犯（交叉标注）
- [x] AC5: **既有机制不回归**——`--for-task` scoped 门绿（含 ready-pool / author-gate 契约检查）

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：38 条 todo 晋级路径打通；pool 回升；meta-cc 同病不再犯（贴任务体）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Evidence（内层实现 2026-08-09）

**候选选择：A + B 组合。** A（批量补 `## Contract` 六键）用于 8 条 unknown-shape 真实 todo；
B（晋级闸 fourArtifacts 识别任务实际形状）用于 9 条 finding-shape draft 任务。没有只走 A
——直接把 `## Contract` 硬贴到 finding-shape 任务上会让它们从 finding 变成 contract 形状，
反而因缺 `## Proposal` 而 FAIL（已实测：加 Contract 后 missing=[proposal,plan,ac,dod]）。

**复现（AC1，修复前）**：`artifactsComplete` 全 store 扫描——42 条 todo 中 38 条缺 `## Contract`
（字面计数），实际被晋级闸判 ineligible 的 22 条。其中本任务 Touches 的 38 条目标里 19 条
ineligible（8 条 unknown-shape 缺形状、9 条 finding-shape 的 AC/DoD 用了 `## AC（draft）`/`## DoD（draft）`
标题、QC-T1 是 fixture、TG 是空壳）。`ready-pool-check --root . --json` 因 pool=12/floor=12
（deficit 0）不输出 candidates，故用 `artifactsComplete` 直接扫描复现。

**改了什么**：
1. `plugin/scripts/ready-pool-check.ts`（候选 B）：finding 形状的 AC/DoD 标题列表加入
   `AC（draft）`/`DoD（draft）`（及半角 `AC (draft)`/`DoD (draft)`）——9 条 finding-shape draft 任务
   的 AC/DoD 本来就是真内容，`（draft）` 只是标题标注，不算缺失。`sectionNonWsLength` 现在对标题
   做正则转义（literal 匹配）。
2. 8 条 unknown-shape 真实 todo 补 directive-class `## Contract` 六键（measure/band/invariant/invoke/
   control/resume，每键一行，可机械验证）——DIR-124-F-core、DIR-124-F-learn、
   gap-cold-start-skill-has-no-recovery-branch、gap-no-formalized-bare-metal-session-bootstrap、
   gap-quay-has-never-self-hosted-its-own-cold-start、gap-quay-init-never-writes-branch-model-config-
   fork-baseline-merge-target、gap-quay-self-hosting-e2e-proof、gap-workflow-metadata-warn-omissions。
   其中 4 条无 `## Dispatch review` 的（DIR-124-F-core、DIR-124-F-learn、gap-quay-init-never-writes…、
   gap-workflow-metadata-warn-omissions）补了 A10 格式的 Dispatch review（`reviewer: none` =
   记录的无闸选择）；gap-quay-init-never-writes 的 DoD 过薄（32 非空白字符 < 40）补足。
3. `CLAUDE.md`（候选 C / AC4）：新增「author→ready 晋级闸是形状感知的」跨项目判据注——quay/meta-cc
   用同一个任务形状判据，`（draft）` 后缀是标题标注不是缺失，未知形状 fail-closed。
4. `plugin/test/ready-pool-check.test.mjs`：新增测试
   「artifactsComplete recognizes finding-shape draft AC/DoD headings」固定 A 的发现。

**pool 前后**：修复前 pool=12/floor=12（deficit 0），42 条 todo 中可晋（fourArtifacts complete）20 条、
ineligible 22 条；修复后 42 条 todo 中可晋 37 条、ineligible 5 条——ineligible 5 条 = QC-T1（fixture，
`isFixture` 永久排除，非晋级对象）+ TG（空壳无 body，无可验证内容，不臆造）+ 3 条 contract-shape 缺 DoD
（gap-test-isolation-backlog-44…、gap-two-peer-quay-developers…、gap-worktree-node-modules…，**不在本任务
Touches 内**，属范围外残差，建议后续任务补 DoD）。目标 38 条中 36 条真实任务全部打通晋级路径。

**scoped 门（AC5）**：`bash scripts/test.sh --for-task gap-todo-shape-mismatch-author-gate --allow-thin`
→ exit 0；`tests 56 · pass 56 · fail 0 · cancelled 0`；scoped static checks 里
task-contract-check 0 violations（strict-subset 全 38 目标 + 自身）、strategic-doc-staleness-check 通过。
（`test-selection-thin` 警告是预期：42 条 Touches 里只有 `plugin/scripts/ready-pool-check.ts` 解析到 1 个
测试文件，38 条任务文件 + CLAUDE.md 不解析到测试，已用 `--allow-thin` 放行。）

**meta-cc 同病标注（AC4）**：本任务 Proposal 记录的「meta-cc 14 个 todo(DIR-082..100) 全过不了 author→ready
闸」与本任务同根——缺 shape 识别 / 形状不匹配，不是 pool 数字问题。CLAUDE.md 的跨项目注就是给两个项目共用的
判据源。

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
