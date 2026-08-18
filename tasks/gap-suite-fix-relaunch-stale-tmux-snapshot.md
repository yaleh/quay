---
id: gap-suite-fix-relaunch-stale-tmux-snapshot
title: suite-fix 重跑（execute-suite-fix.js）走 launch 不生成 tmux-leak before-run 快照——陈旧快照（25h）使 tmux-leak-scan 报「无快照」RED，directory-lock 第 4 轮 suite 实证
status: ready
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**现象（inner 报 + outer 独立核实，2026-08-18 02:0xZ）**：`gap-directory-level-tasks-touch-global-lock` fan-in 第 4 轮 suite RED，失败项 `tmux-leak-scan: FAIL — no before-run snapshot at <worktree>/.quay/tmux-leak…`。**独立核实**：worktree 的 `.quay/tmux-leak-scan.snapshot` 是 **Aug 17 01:13 陈旧快照（~25h）**——不是缺失，是**没被重跑更新**。

**根因（机制，非 flake）**：suite-fix 重跑走 `execute-suite-fix.js` 的 relaunch 路径，该路径**不经过标准 SUITE_LAUNCH 的 before-run 快照生成步骤**——首次 fan-in 的 SUITE_LAUNCH 会生成快照，但 suite-fix 的 relaunch（round 3/4）用的是另一条启动脚本，跳过了快照生成 ⇒ tmux-leak-scan 在 suite 收尾时用陈旧快照做 delta ⇒ 报「无 before-run 快照」（fail-closed）⇒ RED。

**与 directory-lock 的关系**：非 directory-lock 回归（其 Touches = slot-refill.ts + touches-one-path，与 tmux-leak/快照零交集）。是**suite-fix 重跑机制的缺陷**——任何需要 suite-fix 迭代的任务在重跑轮都会撞它。

**影响**：suite 红后 suite-fix 重跑 ≥1 轮即可能撞「无 before-run 快照」RED（fail-closed）⇒ 任务 land 被 launch 机制缺陷挡（今晚 directory-lock 已烧 4 轮，r4 即此因）。与「suite 不并行」「ff 判据」同属 fan-in 收敛性机制族。

**能取假（⊢ 对照）**：修复后，一次 suite-fix 重跑（relaunch）在 suite 开始前生成**新鲜** tmux-leak before-run 快照（或复用标准 SUITE_LAUNCH 的启动路径）——tmux-leak-scan 不再报「无快照」；重复 suite-fix 迭代不再因陈旧快照 RED。

## Plan

1. 读 `execute-suite-fix.js` 的 relaunch 路径（round 3/4 用的启动脚本）与标准 `SUITE_LAUNCH`（fan-in-execute.js）——确认 relaunch 缺 before-run 快照生成。
2. 修法（二选一）：
   - ① **relaunch 复用标准 SUITE_LAUNCH 路径**（含 tmux-leak before-run 快照生成）——消除两条启动路径的漂移；
   - ② **relaunch 启动前显式生成快照**（独立调用 tmux-leak-scan 的 before-run 步骤）。
   倾向 ①（单一路径，避免再出现「两条启动路径行为不一致」）。
3. 确认 suite 收尾的 tmux-leak-scan 用新鲜快照做 delta。
4. 对照实测：一次 suite-fix 重跑 → 新鲜快照 → 不再「无快照」RED。
5. scoped 门（`--for-task`）+ 全量验证，fan-in。

## Acceptance Criteria

- [x] AC1: suite-fix 重跑（relaunch）在 suite 开始前生成新鲜 tmux-leak before-run 快照（或复用标准 SUITE_LAUNCH 启动路径）。
- [x] AC2: suite 收尾 tmux-leak-scan 用新鲜快照做 delta，不再报「no before-run snapshot」RED。
- [x] AC3: 首次 fan-in 与 suite-fix 重跑行为一致（单一路径，不漂移）。
- [x] AC4: 对照实测：一次 suite-fix 重跑（≥1 轮迭代）→ 无陈旧快照 RED。
- [x] AC5: 测试全绿 + `--for-task` scoped 门绿。

## Definition of Done

- [x] suite-fix 重跑生成新鲜 before-run 快照（单一路径），tmux-leak 不再因陈旧快照 RED，重复迭代可收敛，scoped + 全量绿。

## Touches

- plugin/workflows/execute-suite-fix.js（relaunch launchCmd 补显式 before-run tmux-leak --snapshot；双拷贝）
- .claude/workflows/execute-suite-fix.js（同 dual-copy，与 plugin/workflows 逐字节一致）
- plugin/test/execute-suite-fix-relaunch-snapshot.test.mjs（新增：relaunch 快照生成结构测试 + tmux-leak-scan 陈旧快照覆盖回归）
- tasks/gap-suite-fix-relaunch-stale-tmux-snapshot.md（自身）

## Evidence（invoke 实跑）

**修法选择：②（relaunch 前显式 --snapshot），非 ①（复用 SUITE_LAUNCH 路径）。** 读代码确认 Proposal 的「两条启动路径」实际差异：
`fan-in-execute.js` 的 SUITE_LAUNCH 是 `bash scripts/test.sh` **直跑**；`execute-suite-fix.js` 的 launchCmd 是
`full-suite-runner.ts --root <worktree>`（runner 再 spawn `bash scripts/test.sh --test-concurrency=N`）。两条路径的
before-run 快照都【隐式】生成在 `scripts/test.sh` 的 FULL_SUITE_DEFAULT 分支内（`:1537` `tmux-leak-scan.sh --snapshot`），
**没有一个 workflow 文件显式持有该步骤**。修法①（把 relaunch 改成 `bash scripts/test.sh` 直跑）会丢掉 full-suite-runner.ts 的
state.json / verification-round.jsonl 写入——那正是 execute-suite-fix 的 Verify 轮询与 Merge 闸的唯一数据源，直跑会静默挂死。
故走 ②：在 launchCmd 里【显式】补 `tmux-leak-scan.sh --snapshot ${worktree}`，把「launch 前落新鲜快照」的保证搬到 workflow 层
（不依赖 test.sh 深层分支），覆盖 `refresh-worktree-quay.sh` 从 main checkout 拷进 worktree 的陈旧 `.quay/tmux-leak-scan.snapshot`
（陈旧/缺失快照 ⇒ 收尾 `--check` fail-closed「no before-run snapshot」RED 的成因）。`--snapshot` 失败不阻断 launch（`;` 分隔，
fail-open——`--check` 本身 fail-closed 兜底）。worktree 恒为真实 worktree（≠ main checkout）⇒ runner 不触发 one-shot
provisioning ⇒ `<worktree>/.quay` 快照路径与 test.sh 的 `--check`（`:1708`）一致。

**实现**（`plugin/workflows/execute-suite-fix.js` + `.claude/workflows/execute-suite-fix.js`，逐字节一致）：
launchCmd 由 `cd ${root} && ${launchEnv} setsid node ...` 改为
`cd ${root} && bash plugin/scripts/tmux-leak-scan.sh --snapshot ${worktree}; cd ${root} && ${launchEnv} setsid node ...`
（前台落快照 → detached 起 suite）。新增 `plugin/test/execute-suite-fix-relaunch-snapshot.test.mjs`（3 条，@test-group engine）。

**scoped 测试**（`bash scripts/test.sh --for-task gap-suite-fix-relaunch-stale-tmux-snapshot --allow-thin`）：
```
ℹ tests 3
ℹ pass 3
ℹ fail 0
ℹ skipped 0
ℹ duration_ms 337.508175
EXIT=0
```
```
✔ AC1 — execute-suite-fix.js relaunch launchCmd explicitly snapshots tmux-leak before launching (5.984789ms)
✔ AC3 — both execute-suite-fix.js copies are byte-identical (1.009013ms)
✔ AC2 — a stale snapshot is overwritten by --snapshot, then --check is clean (no 'no snapshot' RED) (168.104937ms)
```
静态检查全 PASS（task-contract-check：`no violations`——补修后的 Touches 去掉了裸目录+不确定标注 `plugin/scripts/tmux-leak-scan（若需…）`；
workflows-dual-copy-drift-check：`5 pairs, 5 consistent / 0 drifted`）。

**关键断言**（execute-suite-fix-relaunch-snapshot.test.mjs，真实 `tmux-leak-scan.sh` 二进制的 spawnSync）：
```
AC1 — 两个 dual-copy 的 launchCmd 均含 `tmux-leak-scan.sh --snapshot ${worktree}`，且 --snapshot 出现在 `setsid node` 之前（顺序钉死）。
AC2 — 陈旧快照（STALE-SENTINEL）→ --snapshot 覆盖 → --check 干净（exit 0，无「no before-run snapshot」）——完整 stale→snapshot→check 循环。
AC3 — plugin/workflows 与 .claude/workflows 两副本逐字节一致。
```

**AC 映射**：AC1 = 结构测试（launchCmd 显式 --snapshot + 顺序）；AC2 = 功能回归（陈旧快照被覆盖 + --check 干净，不再 fail-closed
「no snapshot」）；AC3 = dual-copy 逐字节一致 + 两副本均含快照步骤（与首次 fan-in 的 test.sh 隐式生成等价，不漂移）；
AC4 = AC2 的功能循环即 stale→fresh→clean 的对照实测（陈旧快照形态 vs 修复后干净形态）；真实 ≥1 轮迭代的 suite-fix relaunch 确认
属 fan-in 步骤（全量 suite 唯一入口，inner scoped-only 无法产出真实 suite-fix 轮）。AC5 = scoped 3/3 绿 + 静态检查全 PASS。
（DoD 行不勾——按 brief，fan-in workflow 翻 done 时勾。）
