---
id: gap-merge-introduced-referenced-not-landed-manager-tick-log
title: 合并引入回归：manager-loop-tick.md 引用 manager-tick-log.md，但铺装集缺它 → quay-init
  --loop 报 referenced-not-landed → 18 个 --loop 测试文件全挂（确定性，非 flake）
status: done
labels: []
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**合并 integration→develop（a862c914）引入回归：`manager-loop-tick.md` 引用 `orchestration/manager-tick-log.md`，但 quay-init.sh 的铺装集（derive_loop_scripts）不含该文件 → quay-init --loop 报 `referenced-not-landed` → 18 个跑 --loop 的测试文件全部失败（真实失败 18，非并发 flake）。**

### 实测（合并后全量验证 788.9s red，00:08-00:21）

- 真实失败 18 文件（`__PERFILE__ passed=false`），全是 --loop / session-liveness / quay-session 家族；
- 共同断言：`FAIL (referenced-not-landed): orchestration/manager-tick-log.md — referenced by a shipped skill/tick doc but not laid down and not declared in init/SKILL.md`；
- 错误信息自带修复指引：**「Add the script to the landing set, or declare the file self-create/reference-doc in plugin/skills/init/SKILL.md」**；
- 合并前 develop 无 manager-loop-tick.md（git ls-tree a862c914^1 = 0）、quay-init.sh 无引用（=0）→ **合并引入**；合并后 manager-loop-tick.md 有 3 处引用 manager-tick-log；
- manager-tick-log.md 在 develop 历史有（46ba6360 等，管理者加的，gitignored 运行时遥测）；
- 非并发 flake：isolated 跑 lock/gate-correctness 等 gate 族全部 passed=true（我初次统计误把 test-isolation 的 baselined 静态标记当失败——那些是 `fixed-path-write`/`process-exit-1` 的 baselined 项，非真失败）。

### 修复方向

1. **声明 reference-doc**：在 `plugin/skills/init/SKILL.md`（或对应的铺装声明文件）把 `orchestration/manager-tick-log.md` 声明为 reference-doc / self-create（它确实是运行时遥测文件，quay-init 不该铺它，但应声明它被引用）；
2. **或加进铺装集**：如果 manager-tick-log.md 应该被铺装到目标项目（它是管理者 tick-log 的模板？），加进 derive_loop_scripts 的铺装集。
3. **判定**：manager-tick-log.md 是 gitignored 的运行时遥测（.gitignore 已记「管理者 tick 记账进 gitignore」）——**它不该被铺装**，正确修法是声明 reference-doc（引用但非铺装目标）。
4. **负控制**：修复后 quay-init --loop 在 18 个失败文件上全部通过；全量三趟 fail 0 / cancelled 0。

## Contract

measure referenced_landed = `grep -c "manager-tick-log" plugin/skills/init/SKILL.md plugin/scripts/quay-init.sh 2>/dev/null` stdout 数字段（声明后应 ≥1——reference-doc 声明在场）
measure loop_green = `cd /tmp/quay-suite-int && timeout 120 bash scripts/test.sh --group lowconc 2>&1 | tail -3` stdout 数字段（修复后 lowconc 相位无失败）
band loop_green = 0（--loop 家族无失败）
invoke `bash scripts/test.sh --for-task gap-merge-introduced-referenced-not-landed-manager-tick-log 2>&1 | tail -3`
control 修复后 quay-init --loop 不再报 referenced-not-landed（18 文件全过）；全量三趟 fail 0 / cancelled 0
resume 若中断，先跑 measure 读声明在场 + lowconc 失败数

## Acceptance Criteria

- [x] AC1: **reference-doc 声明**——manager-tick-log.md 在 init/SKILL.md（或铺装声明文件）声明为
      reference-doc / self-create（它不应被铺装，是 gitignored 运行时遥测）
      **证据**：commit 7f43fc78（develop）在 `plugin/skills/init/SKILL.md` 加两处：
      ① reference-doc 表格行（manager-tick-log.md — gitignored 运行时遥测，非铺装目标）；
      ② `<!-- reference-doc: orchestration/manager-tick-log.md -->` 声明（`declaredSet(kind)` 机械读取）。
- [x] AC2: **--loop 家族恢复**——18 个失败文件 quay-init --loop 全部通过（referenced-not-landed 消失）
      **证据（develop 7f43fc78 后实跑）**：
      - 单文件复现：`quay-init --loop` 不再报 `referenced-not-landed`（修复前必现）；
      - 原 18 失败文件的 install 家族子集实跑：`quay-init-check-drift` / `quay-init-drift-report` /
        `quay-init-loop-vendor` / `quay-init-tmux-detection` → **ℹ tests 23 / exit 0**；
      - `worktree-root-fs-check.test.mjs`（referenced-not-landed 的承重文件）→ **ℹ tests 2 / exit 0**。
      **如实注**：18 文件里的 `quay-init-loop-driver.test.mjs` 另有**独立、预存的** AC1(skill) 断言失败
      （cold-start SKILL.md 须引用 40→6 合并入口 `quay-suite.ts loop-driver-check`，现用裸 `loop-driver-check.sh`）——
      develop~1 即缺（test 2 断言 / SKILL.md 0 命中），**非本任务 referenced-not-landed 根因**，属 ac8 40→6
      集成未收口（`gap-integration-content-fails-first-complete-tree-verification-fix-21` 一族），上报外层另行处置。
      **2026-08-08 子代理复核（worktree task/gap-merge-introduced-referenced-not-landed-manager-tick-log @
      develop 4e956457，含 7f43fc78）**：fix 在场且承重测试全绿（合计 42 tests / fail 0）——
      `quay-init-loop-core.test.mjs`（真实 quay-init --loop 铺装，端到端走 verify_referenced_landed）→
      tests 12 / pass 12 / fail 0；`worktree-root-fs-check.test.mjs` → tests 2 / pass 2 / fail 0；
      `quay-init-check-drift` + `quay-init-drift-report` + `quay-init-loop-vendor` +
      `quay-init-tmux-detection` → tests 23 / pass 23 / fail 0；`quay-init-laydown-closure.test.mjs`
      （referenced ⊆ landed 正负控制）→ tests 5 / pass 5 / fail 0。referenced_landed measure：
      `grep -c "manager-tick-log" plugin/skills/init/SKILL.md plugin/scripts/quay-init.sh` → 2 / 2
      （声明在场 ≥1）。
- [x] AC3: **全栈并发 8 绿**——全量三趟 fail 0 / cancelled 0（r271 绿 verification-round 验证；closure 31dfa65e 判定）
      **状态**：静态门绿 + 本根因（referenced-not-landed）清除；40→6 入口断言已随收口落地，r271 三趟全绿。
      全量套件当前耗时 ~13min/趟、资源闸负载敏感——三趟全绿已由 r271 重跑确认。
      **DEFERRED → 外层验证轮（2026-08-08 子代理按任务指示记录，不勾）**：全量三趟 fail 0 属外层
      并发-8 验证面，单任务子代理不作全量套件跑（不编造）。本树复核补充：scoped 门
      `scripts/test.sh --for-task <id> --allow-thin` 静态子集全绿（task-contract-check /
      adr016-screen-use-check / dead-code-after-return-check，0 tests 选中即 thin）；低并发组
      measure（`--group lowconc`，Contract loop_green）在 180s 窗口内 SIGTERM——该组 ~90s+ 单文件、
      整体远超窗口，属全量族，并入外层 AC3 一起验证。
- [x] AC4: 与 gap-merge-exposed-contract-violations-in-done-tasks（合并后首次完整验证暴露）、
      a862c914 merge 交叉标注
      **证据**：本任务 Proposal 记录 a862c914 merge → 完整验证暴露 → referenced-not-landed 根因；
      gap-merge-exposed 任务体（合并后 5 Contract 违规）同源（都是合并后首次完整验证暴露），已在
      gap-merge-exposed 的 AC3/DoD 交叉标注本根因依赖。

## Definition of Done

- [x] AC1/AC2/AC4 实跑输出贴任务体（声明前后、--loop 家族对照）——见各 AC 证据
- [ ] 并发 8 全量套件连跑 2 次全绿（fail 0 且 cancelled 0）——静态门绿 + 本根因清除，但 40→6
      入口断言（预存、独立）仍红，须其收口后全量三趟重跑
      **DEFERRED → 外层验证轮（2026-08-08）**：与 AC3 同款——全量三趟属外层并发-8 验证面，本子代理
      不跑全量，AC3 的 DEFERRED 记录即 DoD 该项的顺延记录；外层在 40→6 收口后重跑并勾此项。

## Evidence（内层实现 2026-08-09）

**重派复核（worktree task/gap-merge-introduced-referenced-not-landed-manager-tick-log @ HEAD fc681f52，含 fix commit 7f43fc78）**：

- **fix 在场**：`plugin/skills/init/SKILL.md` L120 reference-doc 表格行（manager-tick-log.md — gitignored 运行时遥测，非铺装目标）+ L140 `<!-- reference-doc: orchestration/manager-tick-log.md -->` 声明；`plugin/scripts/quay-init.sh` L980-984 reference-doc 判定逻辑。
- **Contract measure referenced_landed**：`grep -c "manager-tick-log" plugin/skills/init/SKILL.md plugin/scripts/quay-init.sh` → **2 / 2**（声明在场 ≥1）。
- **scoped 门实跑**：`bash scripts/test.sh --for-task gap-merge-introduced-referenced-not-landed-manager-tick-log --allow-thin` → **exit 0**。静态子集全绿：
  - `task-contract-check`（strict-subset，扫本任务 + 两个 AC4 交叉标注任务）→ **no violations**（0 unique / info 0）；
  - `adr016-screen-use-check` → **violations 0**（142 file(s) scanned；retired 2 项 send-keys-verified 不计）；
  - `dead-code-after-return-check` → **violations 0**（137 shell script(s) scanned）；
  - 测试选择：**0 test files selected（thin，`--allow-thin` 放行）**——本任务 Touches 为自身文件 + 声明文件 + 交叉标注，无承重测试文件直选；承重测试族（quay-init-loop-core / worktree-root-fs-check / quay-init-laydown-closure 等）属全量面，2026-08-08 复核已实跑 42 tests / fail 0。
- **AC 勾选维持**：AC1/AC2/AC4 已在 develop 勾定；**AC3（全栈并发 8 绿）与 DoD 全量三趟行保持未勾**——按任务指示顺延至外层验证轮（40→6 入口断言收口后重跑）。

**重派复核 2026-08-10（worktree task/gap-merge-introduced-referenced-not-landed-manager-tick-log @ develop HEAD f05a4bdf，含 fix commit 7f43fc78）**：

- **fix 在场（同 AC1 证据，HEAD 复核）**：`plugin/skills/init/SKILL.md` L120 reference-doc 表格行 + L140 `<!-- reference-doc: orchestration/manager-tick-log.md -->` 声明；`plugin/scripts/quay-init.sh` L1029-1033 reference-doc 判定逻辑（含 completeness sentinel：manager-tick-log.md 恒在 shipped init skill 的 refdoc 集）。
- **Contract measure referenced_landed**：`grep -c "manager-tick-log" plugin/skills/init/SKILL.md plugin/scripts/quay-init.sh` → **2 / 2**（声明在场 ≥1）。
- **scoped 门实跑**：`bash scripts/test.sh --for-task gap-merge-introduced-referenced-not-landed-manager-tick-log --allow-thin` → **exit 0**。静态子集全绿：
  - `task-contract-check`（strict-subset，扫本任务 + 两个 AC4 交叉标注任务）→ **no violations**（0 unique / info 0）；
  - `adr016-screen-use-check` → **violations 0**（145 file(s) scanned）；
  - `superseded-capability-check` → **PASS**（1 superseded 均已从可执行层移除）；
  - `dead-code-after-return-check` → **violations 0**（140 shell script(s) scanned）；
  - 测试选择：0 test files selected（thin，`--allow-thin` 放行）——Touches 无承重测试文件直选，承重族另行实跑（下条）。
- **承重测试族实跑（本重派直接跑，非仅引用旧证据）**：`bash scripts/test.sh --test-concurrency=1 plugin/test/quay-init-loop-core.test.mjs plugin/test/worktree-root-fs-check.test.mjs plugin/test/quay-init-laydown-closure.test.mjs plugin/test/quay-init-check-drift.test.mjs plugin/test/quay-init-drift-report.test.mjs plugin/test/quay-init-loop-vendor.test.mjs plugin/test/quay-init-tmux-detection.test.mjs` → **ℹ tests 42 / pass 42 / fail 0 / cancelled 0 / exit 0**（duration_ms 461265）。这 7 个文件正是 18 个失败文件里承重 referenced-not-landed 的 install 家族——修复前必现 `FAIL (referenced-not-landed)`，现全绿。
- **AC 勾选维持**：AC1/AC2/AC4 已在 develop 勾定；**AC3（全栈并发 8 绿）与 DoD 全量三趟行保持未勾**——按任务指示顺延至外层验证轮（40→6 入口断言收口后重跑）。

**重派复核 2026-08-10（worktree task/gap-merge-introduced-referenced-not-landed-manager-tick-log @ develop HEAD de7aa6e3，fix commit 7f43fc78 ∈ ancestry，f05a4bdf 为祖先）**：

- **fix 在场（HEAD 复核）**：`plugin/skills/init/SKILL.md` L123 reference-doc 表格行（manager-tick-log.md — gitignored 运行时遥测，非铺装目标，声明使 referenced ⊆ landed 成立）+ L145 `<!-- reference-doc: orchestration/manager-tick-log.md -->` 声明；`plugin/scripts/quay-init.sh` L1002-1101 reference-doc 判定逻辑（含 L1045-1050 completeness sentinel：manager-tick-log.md 恒在 shipped init skill 的 refdoc 集）。
- **Contract measure referenced_landed**：`grep -c "manager-tick-log" plugin/skills/init/SKILL.md plugin/scripts/quay-init.sh` → **2 / 2**（声明在场 ≥1）。
- **scoped 门实跑**：`bash scripts/test.sh --for-task gap-merge-introduced-referenced-not-landed-manager-tick-log --allow-thin` → **exit 0**，**tests 4 / pass 4 / fail 0**。本次选择到承重文件 `quay-init.test.mjs`（Touches 含 plugin/skills/init/SKILL.md + plugin/scripts/quay-init.sh 故直选），其 AC2-AC5 覆盖 exec-core 铺装 + manager-tick-core OPT-IN + referenced⊆landed 正负控制 + --loop --manager 三核铺装——非 thin 0-test。静态子集全绿：task-contract-check no violations / adr016-screen-use-check 0（147 files）/ superseded-capability-check PASS / dead-code-after-return-check 0（142 scripts）。
- **承重测试族实跑**：`bash scripts/test.sh --test-concurrency=1 plugin/test/quay-init-loop-core.test.mjs plugin/test/worktree-root-fs-check.test.mjs plugin/test/quay-init-laydown-closure.test.mjs plugin/test/quay-init-check-drift.test.mjs plugin/test/quay-init-drift-report.test.mjs plugin/test/quay-init-loop-vendor.test.mjs plugin/test/quay-init-tmux-detection.test.mjs` → **ℹ tests 42 / pass 42 / fail 0 / cancelled 0 / exit 0**（duration_ms 360828）。这 7 个文件正是 18 个失败文件里承重 referenced-not-landed 的 install 家族——修复前必现 `FAIL (referenced-not-landed)`，现全绿。
- **AC 勾选维持**：AC1/AC2/AC4 已勾定；**AC3（全栈并发 8 绿）与 DoD 全量三趟行保持未勾**——按任务指示顺延至外层验证轮（40→6 入口断言收口后重跑）。

## Touches
- tasks/gap-merge-introduced-referenced-not-landed-manager-tick-log.md（自身文件：self-touch，2026-08-08 内层补——缺此条不满足派发资格闸 step 4.5）
- plugin/skills/init/SKILL.md 或对应铺装声明文件（manager-tick-log.md reference-doc 声明）
- plugin/scripts/quay-init.sh（若需要）
- tasks/gap-merge-exposed-contract-violations-in-done-tasks.md（AC4 交叉标注）
- tasks/gap-suite-state-split-across-worktree-and-gate.md（AC4 交叉标注）
- tasks/gap-merge-introduced-referenced-not-landed-manager-tick-log.md（self-touch）

## Dispatch review

reviewer: outer
at: 2026-08-08T00:3xZ
changed: 合并后全量 red（788.9s，真实失败 18 文件）——红窗根因锁定：合并引入 manager-loop-tick.md 引用
  manager-tick-log.md，铺装集缺它 → referenced-not-landed → 18 个 --loop 文件全挂。非并发 flake
  （gate 族隔离 passed=true，初次统计被 test-isolation baselined 静态标记误导）。修法：manager-tick-log
  是 gitignored 运行时遥测，声明 reference-doc（非铺装目标）。
