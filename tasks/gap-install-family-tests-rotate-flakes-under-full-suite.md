---
id: gap-install-family-tests-rotate-flakes-under-full-suite
title: quay-init/install 家族 29 个测试在全量套件下轮换性
  flake——每轮不同文件（drift-report/governance、loop-core/serial、runtime-landing…）单独跑恒绿，逐测试打地鼠不收敛
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**quay-init/install 家族 29 个测试（做真实 `quay-init --loop` + `npm pack` install）在全量套件下轮换性 flake——每轮不同文件失败、单独跑恒绿。逐测试打地鼠（install-config → serial 组、loop-core → serial 残留、drift-report → ?）不收敛，是系统性负载问题。**

### 实证（outer 2026-08-09）

| round | 失败文件 | 组 | 签名 |
|---|---|---|---|
| 160 | quay-init-drift-report, runtime-landing, test-coverage-check, verify-delivery-surface | governance/serial | inventory drift（halt-check.sh 未重生成，已修） |
| 161 | quay-init-loop-core | serial | AC2 init exit≠0 + AC4 残留（serial 顺序残留，已立案） |
| 162 | quay-init-drift-report | governance | `✖ AC3 本地修改派生脚本列为 drift` (20s) |

**关键事实**：
- **全部单独跑恒绿**（drift-report 6/6、loop-core 12/12、runtime-landing 5/5、verify-delivery 13/13）。
- **组不同**：drift-report=governance、loop-core=serial、install-config=serial、runtime-landing=lowconc——**不是某一组的并发问题，是 install 家族本身在全量套件负载下轮换性超时/失败**。
- **29 个 install 家族测试**（`@test-group governance/lowconc/serial` + quay-init/npm-pack）：轮换失败样本，逐测试打地鼠不收敛。

**为什么重要**：install 家族是「真实 install 字节一致」的承重 e2e。轮换性 flake 使**每轮 full red 都不同文件**——红窗分诊、修复、复跑的成本线性上升（round-160/161/162 三次分诊三个不同文件），而根因是**全量套件负载下 install 子步（npm pack + 双 workspace install）资源争抢**。

**修的方向（实现归内层）**：
- 候选 A：**install 家族全隔离**——29 个 install 家族测试统一进 serial 或独立 install 组（并发 1），消除与其它 hermetic 测试的争抢。**冲击面**：serial 组 5→N，runner-grouping 不变量需核。
- 候选 B：**install 子步减负载**——npm pack 产物缓存共享（29 测试共享一次 pack）、install 只跑一次、临时 workspace 复用。**根治**：从「每次 install」到「每轮一次 pack + 共享」。
- 候选 C：**资源门**——install 家族测试前查资源（类似 resource-gate），资源不足时 skip（不 flake 直接 red）。**风险**：skip 变静默漏测。
- 候选 D：**load-sensitive 白名单**——参考 session-liveness 族的处理（KNOWN-LOAD-SENSITIVE 标记 + 隔离），install 家族同样处理。

**验证锚**：修后，(a) 连续 3 轮 full red 不再因 install 家族轮换（每轮 install 家族文件全绿）；(b) 单独跑仍恒绿；(c) 无 skip 静默漏测。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录 3 轮 install 家族轮换失败（round-160/161/162 不同文件）+ 全部单独跑绿 + 29 家族规模（本任务 Proposal 已含；内层补：构造全量负载下 install 家族轮换失败）
- [ ] AC2: **install 家族连续 3 轮不再轮换失败**——每轮 install 家族文件全绿（外层 verification-round 验证）
- [x] AC3: **单独跑不回归**——29 家族各单独跑仍绿
- [x] AC4: **无静默漏测**——不通过 skip 逃过（负控制：每轮 install 家族确实被跑）
- [x] AC5: **既有机制不回归**——`--for-task` scoped 门绿（runner-grouping / 组系统契约检查）

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：连续 3 轮 install 家族全绿（贴任务体）；29 家族单独跑绿
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- scripts/test.sh（候选 A/D：install 家族组别或 KNOWN-LOAD-SENSITIVE 隔离）
- plugin/scripts/（候选 B：npm pack 缓存 / install 复用）
- tasks/gap-install-config-driven-e2e-load-flake.md（交叉标注——本任务是它族类的系统化）
- tasks/gap-serial-phase-install-test-residue-dependency.md（交叉标注——同族不同表现）
- tasks/gap-relation-sync-load-flake-child-spawn-under-suite.md（交叉标注——同族：负载敏感旋转 flake，本任务是子进程 spawn 竞争类同族收编）
- tasks/gap-install-family-tests-rotate-flakes-under-full-suite.md（自身：勾 AC + 贴证据）

## Contract

measure   install_family_red_rounds_after_fix = `grep -c "quay-init.*passed=false\|install-config.*passed=false\|runtime-landing.*passed=false\|drift-report.*passed=false" .quay/full-suite.log` 的 stdout 数字
band      install_family_red_rounds_after_fix = 0（连续 3 轮 install 家族全绿）
invariant install_family_solo_green = 1（29 家族各单独跑恒绿）
invariant install_family_no_silent_skip = 1（每轮 install 家族确实被跑，非 skip 逃过）
invoke    `node --no-warnings --experimental-strip-types --test <每个 install 家族文件>`（抽 3 个单独跑贴回）
control   连续 3 轮 install 家族全绿；单独跑绿；无 skip
resume    组别隔离 + pack 缓存 + 资源门分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-09
changed: 建任务（round-160/161/162 三次分诊三个不同 install 家族文件——drift-report/governance、loop-core/serial、install-config/serial；全单独跑绿、29 家族规模；逐测试打地鼠不收敛 ⇒ 系统化负载问题。实现归内层）

## Evidence（内层实现 2026-08-09）

**实现选择（候选 A/D 合并：install 家族全隔离 + KNOWN-LOAD-SENSITIVE 机器可读标记）**：
把 serial 判据从「nested-runner-only」扩展为「nested-runner **或** real-install 的 install/quay-init
家族」，12 个已立案的 install/quay-init 家族测试文件统一收编进 serial 并发 1 相位（候选 A），并给每个
成员打上 `// @load-sensitive <kind>` + `KNOWN-LOAD-SENSITIVE` 机器可读标记（候选 D）。不选候选 B/C
（pack 缓存共享 / 资源门）——它们治标不治本且风险（B：29 测试共享一次 pack 的复用语义改动；C：skip 变
静默漏测）。改动清单：
- `scripts/test.sh`：serial 判据/组描述/相位注释系统化（round-162 的 install-config 单文件扩展升级为
  全家族收编，注释更新于 header / 组定义 / group_of / serial 相位 / lowconc 相位五处；**无功能分支改动**，
  round-162 的 tmux-leak-scan 无条件化与 round-161 的 install-config 隔离修复均保留）。
- 12 个测试文件组别收编：install-config-driven-e2e / npm-pack-e2e / quay-init-check-drift /
  quay-init-drift-report / quay-init-laydown-closure / quay-init-loop-core / quay-init-loop-driver /
  quay-init-loop-runtime / quay-init-loop-vendor / quay-init-loop / quay-init-tmux-detection /
  runtime-landing → 全部 `@test-group serial` + `@load-sensitive heavy|nested-spawn` + KNOWN-LOAD-SENSITIVE。
- `plugin/test/quay-init-laydown-closure.test.mjs`：移除 governance self-skip 包装（serial 相位下它会让
  测试静默 skip——QUAY_TEST_GROUPS 只在 `--group` 分支设，serial 相位下 self-skip 包装必须删除）。
- `plugin/loop/fast-mode-loop-tick.md`：「serial 组的显式判据」从一条扩为两条（嵌套 runner / real-install
  家族），注明 160/161/162 三论轮换与全家族收编。
- `tasks/gap-install-config-driven-e2e-load-flake.md`：交叉标注（候选 A 已落地并被系统化为全家族收编）。

**AC5 scoped 门**：`bash scripts/test.sh --for-task gap-install-family-tests-rotate-flakes-under-full-suite
--allow-thin` → **exit 0**。task-contract strict-subset **no violations**（对
gap-install-family-tests-rotate-flakes-under-full-suite / gap-install-config-driven-e2e-load-flake /
gap-serial-phase-install-test-residue-dependency 三任务文件）；adr016-screen-use **0 违规**（2 retired 不计）；
dead-code-after-return **0 违规**。selector 0/5（thin allowed——Touches 是 shell 脚本 / 任务文件，非测试文件）。

**组系统契约（机械不变量）**：`runner-grouping.test.mjs` + `known-load-sensitive.test.mjs` +
`load-sensitive-release-check.test.mjs` 连跑 **35/35 绿 / 0 fail / 0 cancelled**（EXIT=0，179.2s）——
partition 和（AC3 files+serial==total）、AC6（`--group product,engine ∪ --group lowconc` == no-args）、
serial 机制、AC0c 五组 anti-stomp、KLS 头声明⇒`@load-sensitive` 强制、release-check 准入全过。

**AC3 单独跑不回归（抽样 3 个）**：`quay-init-check-drift + quay-init-drift-report + runtime-landing`
连跑 **15/15 绿 / 0 fail / 0 skipped**（EXIT=0，73.8s）。测试逻辑未动（仅组别标注 + 注释），单独跑绿由
构造保留。

**AC4 无静默漏测**：12 个收编文件在 serial 相位跑真实测试（无 governance self-skip 包装；抽样的 3 个
0 skipped 实证）；`known-load-sensitive.ts --list` 权威清单确认 12 个文件全部标记为
heavy/nested-spawn 负载敏感。

**fan-in 对账（round-162 并发合并）**：本任务分支基于 round-159 base fc681f52，integration 已推进至
round-169（含 round-161 隔离修复 + round-162 install-config→serial 移动）。实现时把 5 个重叠文件
（scripts/test.sh / install-config-driven-e2e / quay-init-loop-core / fast-mode-loop-tick /
load-flake 任务）对账到 integration 当前内容 + 本任务增量：round-161/162 的功能改动（install-config 的
`diskWorktreeRoot()` 隔离、test.sh 的 tmux-leak-scan 无条件化、loop-core 的顺序残留隔离契约注释）**全部
保留**，只叠加本任务的注释/标注增量。`git rebase integration` 后本分支 = integration + 本任务增量。

**AC2（连续 3 轮 install 家族全绿）与 DoD 全量套件归外层 verification-round 验证**——内层只交付
scoped 门绿 + 组契约绿 + 单独跑绿 + 无静默漏测。

**再派发复验（inner re-dispatch 2026-08-09）**：实现已随 6668a4e8 fan-in 落在 develop（本工作树
基于 develop HEAD，包含全部 12 文件 serial 收编 + KLS 标记 + test.sh 注释系统化）。本内层复跑三项
核验全过，与上述证据逐字吻合：
- `bash scripts/test.sh --for-task gap-install-family-tests-rotate-flakes-under-full-suite --allow-thin`
  → **exit 0**（task-contract strict-subset **no violations** 对三任务文件；adr016-screen-use **0 违规**
  （2 retired 不计）；dead-code-after-return **0 违规**；selector 0/5 thin allowed）。
- 组系统契约：`runner-grouping + known-load-sensitive + load-sensitive-release-check` 连跑
  **35/35 绿 / 0 fail / 0 cancelled / 0 skipped**（EXIT=0，206.3s）。
- AC3 单独跑（抽样 3）：`quay-init-check-drift + quay-init-drift-report + runtime-landing` 连跑
  **15/15 绿 / 0 fail / 0 skipped**（EXIT=0，93.8s）。
AC 勾选状态不变（AC1/3/4/5 勾、AC2 + DoD 留外层）。

**再派发复验（inner re-dispatch 2026-08-10，develop HEAD de7aa6e3）**：develop 已推进（含 manager
修复，未触及 test 基建），本工作树基于当前 develop HEAD 复跑三项核验全过，与上述证据吻合：
- `bash scripts/test.sh --for-task gap-install-family-tests-rotate-flakes-under-full-suite --allow-thin`
  → **exit 0**。task-contract strict-subset **no violations**（对 4 个 Touches 任务文件）；adr016-screen-use
  **0 违规**（147 文件扫描）；superseded-capability **PASS**；dead-code-after-return **0 违规**；
  selector 0/6 thin allowed（Touches 是 shell 脚本 / 任务文件，非测试文件）。
- 组系统契约：`runner-grouping + known-load-sensitive + load-sensitive-release-check` 连跑
  **35/35 绿 / 0 fail / 0 cancelled / 0 skipped**（EXIT=0，223.5s）。
- AC3 单独跑（抽样 3）：`quay-init-check-drift + quay-init-drift-report + runtime-landing` 连跑
  **15/15 绿 / 0 fail / 0 skipped**（EXIT=0，125.2s）——工作树先 `npm install`（postinstall 触发
  sync-vendor.sh 重建 plugin/vendor 产物），env 就绪后测试逻辑未动、单独跑绿由构造保留。
AC 勾选状态不变（AC1/3/4/5 勾、AC2 + DoD 留外层）。
