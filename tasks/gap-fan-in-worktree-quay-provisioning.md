---
id: gap-fan-in-worktree-quay-provisioning
title: fan-in 全量 suite 在 worktree 跑时读 worktree 陈旧/缺失 .quay（config/gates/运行时载体）⇒ 环境性红——provisioning 时复制主检出现行 .quay（gap-gitignored-carriers 同族病的另一半）
status: ready
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

**（outer 2026-08-15 06:0xZ 隔离对照定案：ruled-gap fan-in 首次全量 suite 红 72 fail = 环境性，非改动。根因 = fan-in worktree 的 .quay 陈旧/缺失。归 inner C17。）**。

**现象**：ruled-gap fan-in 的全量 suite（worktree 内 `scripts/test.sh`）红 72 fail，22 个失败文件全是 gate/telemetry/resource 系（M63 ts-typecheck / blocked-signal / cap-from-gate / monitor-mount / run-identity 等）——**全部在主检出上通过**（outer 逐个实跑：M63 5/5、slot-visibility 8/8、blocked-signal-param 27/27、cap-from-gate-cli 4/4、run-identity 27/27）。改动自身测试绿（fan-in-workflow-check.test.mjs 不在失败文件里）。

**根因（gap-gitignored-carriers 同族病的另一半）**：carriers（QUAY_MAIN_CHECKOUT）修的是**检查器读主检出**；但**全量 suite 在 worktree 里跑时，测试自己读 worktree 的陈旧/缺失 .quay**——worktree .quay/config.yml 旧拷贝（缺 ts-typecheck gate 在 `gate --list`，M63 报 got=[dod,acceptance,doc-quay-directive-skill] 无 ts-typecheck）、运行时载体缺失（fan-in-merge-lock-events / gate-events / .workflow-events 等）。

**修法（供 inner 选，同 carriers 三候选）**：
① fan-in worktree provisioning 时把主检出现行 `.quay/` **只读复制**进 worktree（快照，gitignored，suite 跑一次即够）；
② `scripts/test.sh` 在 `QUAY_MAIN_CHECKOUT` 设置时让 suite 从主检出解析 `.quay/`（config/gates/运行时载体）；
③ 判据改由 worktree 内可得量承载。
**⛔ 不可接受第四条：把环境性红当合格 / landing over known-red。**

**判据1**：fan-in worktree 跑全量 suite 时，读到的 `.quay/`（config/gates/运行时载体）与主检出一致（陈旧/缺失不再造成环境性红）。
**判据2（能取假）**：ruled-gap（或任一 code-delta 任务）fan-in 全量 suite 绿——修复前 72 fail 环境性红，修复后同 suite 在主检出/修后 worktree 都绿。M63 ts-typecheck gate 在 `gate --list` 出现。
**判据3**：既有测试全绿；`--for-task` scoped 门绿。

**不覆盖**：不改 ruled-gap 豁免表（本身正确）；不改 carriers QUAY_MAIN_CHECKOUT 检查器接线（互补非替代）。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 读 full-suite-runner.ts provisioning（one-shot worktree 创建 + QUAY_MAIN_CHECKOUT 接线）+ scripts/test.sh 的 config/gates 解析。
2. 选修法（① 复制 .quay / ② QUAY_MAIN_CHECKOUT 解析 / ③ worktree 内量）——按实现代价 + 覆盖。
3. 判据2 能取假：ruled-gap 或代表 code-delta fan-in 全量 suite 绿；M63 gate --list 含 ts-typecheck。
4. 既有测试全绿 + `--for-task` scoped 门绿。

## Acceptance Criteria

- [x] AC1 判据1：fan-in worktree 全量 suite 读到的 .quay 与主检出一致。（test.sh 入口快照主检出 .quay 进 worktree；能取假：M63 `gate --list` 含 ts-typecheck、gate-events 等载体在 worktree 内存在）
- [x] AC2 判据2 能取假：修复前 72 fail 环境性红 → 修复后同 suite 绿；M63 gate --list 含 ts-typecheck。（修复前 worktree 无 config.yml ⇒ `_findRepoRoot` 抛错；修复后 M63 5/5 + blocked-signal 27/27 + cap-from-gate-cli 4/4 + monitor-mount 13/13 + run-identity 27/27 全绿。**全量 suite 绿在 fan-in/verification 轮终验**）
- [x] AC3 判据3：既有测试全绿；`--for-task` scoped 门绿。（`--for-task ... --allow-thin` exit 0、21 pass 0 fail；新增测试 5/5；代表性子集 fast-mode-telemetry 77/77 / cap-from-gate-config-budget 6/6 / resource-gate 49/49 / workflow-journal 12/12 绿。**全量 suite 在 fan-in 轮终验**）

## Definition of Done

- [x] fan-in worktree .quay provisioning（config/gates/运行时载体与主检出一致）+ 环境性红消除 + M63 等 gate 系测试绿 + 测试绿。（Build 相位判定；全量 suite 绿由 fan-in/verification 轮终验）

## Touches

- scripts/test.sh（入口处调 refresh-worktree-quay.sh——suite 启动时把主检出 .quay 快照进 worktree）
- plugin/scripts/refresh-worktree-quay.sh（新：主检出 .quay/（config/gates/运行时载体）快照复制进 linked worktree，排除 node-compile-cache / 日期型 full-suite-*.log / 收件箱；幂等；主检出上 no-op）
- plugin/scripts/capability-catalog.sh（新脚本 question 声明——AC1c 入口闸要求每个 plugin/scripts 文件声明它回答什么问题）
- docs/proposals/quay-product-outline.md（delivery-inventory §6 快照重新生成——plugin/scripts/ 新增文件触发 delivery-inventory-drift-gate）
- plugin/test/refresh-worktree-quay.test.mjs（新：复制/排除/no-op/自推导 root/幂等 五条）
- tasks/gap-fan-in-worktree-quay-provisioning.md（自身）

## Evidence

**修法定案（inner 2026-08-15 06:1xZ，选②+①机制）**：选法②（`scripts/test.sh` 在 linked worktree 里从主检出刷新 .quay），机制用①的快照复制（非 symlink——worktree suite 会写自己的 .quay/，写进副本不污染主检出）。
不选纯①（full-suite-runner.ts provisioning）：fan-in 全量 suite 是 `cd ${worktree} && bash scripts/test.sh` **直接**跑的（fan-in-execute.js step 4，不经 full-suite-runner），所以 provisioning 修不到它——test.sh 才是两条路径（fan-in 直跑 + one-shot）的共同入口。

**能取假（修复前 → 后，worktree 内）**：
- 修复前：worktree `.quay/config.yml` 缺失 ⇒ `_findRepoRoot` 抛「Cannot find repo root: no .quay/config.yml」；M63 D1 报「real .quay/config.yml must exist in this worktree」。ruled-gap fan-in 全量 suite 72 fail / 22 文件（M63 ts-typecheck / blocked-signal / cap-from-gate / monitor-mount / run-identity 等），主检出全绿。
- 修复后（`bash plugin/scripts/refresh-worktree-quay.sh "$PWD"` 跑一次后直接 `node --test`）：
  - M63 ts-typecheck-gate：5/5 ✔（`gate --list` 含 ts-typecheck）
  - blocked-signal-parameterized：27/27 ✔
  - cap-from-gate-cli：4/4 ✔
  - monitor-mount-check：13/13 ✔
  - run-identity：27/27 ✔
- 新测试 plugin/test/refresh-worktree-quay.test.mjs：5/5 ✔（AC1 复制 / AC2 排除 node-cache+日期日志 / AC3 主检出 no-op / AC4 git 自推导 root / AC5 幂等+dry-run）。
- `--for-task` scoped 门：绿（见下方）。

**机制**：test.sh 入口（main_root 之后）调 refresh-worktree-quay.sh → git 枚举主检出 gitignored `.quay/*`（config.yml + gate-events/fan-in-merge-lock-events/verification-round/checker-cost 等运行时载体）→ 快照复制进 worktree/.quay（排除 node-compile-cache 3.2G / full-suite-<ISO>.log / manager-inbox/outer-inbox）。源 = QUAY_MAIN_CHECKOUT（one-shot）或 git worktree list 推导（fan-in 直跑）。主检出上 no-op。
