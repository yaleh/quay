# 快速模式队列状态（跨 compact / /clear 恢复用）

**更新：** 2026-08-02，内层编排会话写入
**用途：** `/clear` 后重读此文件 + 冷启动节三命令建立实况，**以 git 实测为准**（此文件可能是旧快照）
**上层目标：** `orchestration/exp6-phase1-sustained-unattended-operation.md`（外层任务，内层读它了解全局）

---

## 前置（exp6 阶段 A/B，满足后才启动 12 小时）

| AC | 内容 | 状态 |
|---|---|---|
| AC2 | 3 个既有失败各有 open 任务 | ✔ 已建（symlink-mirror / dod-clause / select-preflight） |
| AC4 | readiness 补 suite-green | ✔ 已补（`52cde788`，实跑 NOT READY 验证过） |
| AC1 | 套件 0 失败 | ⏳ 4 个失败任务在飞 |
| AC3 | select-preflight ≤30s | ⏳ 在飞（当前 111s） |
| AC5 | tick 队列补充步骤 | ⏳ 未做（AC1 前置后做） |

## 在飞（B4 第一批，全部 checkTouchesPair 实测 disjoint，派发 12:31:48Z）

| 任务 | worktree | runId | 状态 |
|---|---|---|---|
| `gap-select-preflight-json-real-store-too-slow` | `/tmp/quay-wt-selectpreflight` | fm-...-1785673841089-yoji1f | AC3 直接目标 |
| `gap-symlink-mirror-invocation-test-contract-mismatch` | `/tmp/quay-wt-symlinkmirror` | fm-...-1785673841393-d330u6 | 修测试契约模型 |
| `gap-dod-clause13-14-enforced-but-undocumented` | `/tmp/quay-wt-dodclause` | fm-...-1785673841706-w7y7uz | ADR-011 双向漂移 |

## 待执行（按顺序）

| 任务 | 说明 |
|---|---|
| `gap-tests-spawn-cli-from-ts-source`（用户建 `fa0500ad`） | 与 use-cli **重叠**（实测 OVERLAP），不能与它同批 |
| `gap-tests-use-cli-where-module-import-suffices`（用户建 `0f0c8d10`） | 与 spawn-cli 重叠，串行/等 merge |
| AC5：tick 队列补充步骤 | 复用 select-preflight/assembleBatch，不新建 |

## 揭示的既有失败（已建任务，勿重复）

- 3 engine：symlink-mirror ×2 + enforcement-with-design ×1（open 任务在飞）
- 3 governance：chart2-s2（B3-2 记录为发现，需另建任务——本批未覆盖）

## 已完成（B2/B3 全批次）

B2-0..B2-3、B3-1 合并 + 全量绿；B3-2 三步处置后 done。细节见 `git log` 与 `/tmp/fast-mode-batch2-timing.md`。

## 常设纪律（tick 文件）

- fan-in 前必须 `git rebase master`（worktree 快照过期 = B3-2 红的教训）
- 测试不得硬编码全局计数（`EXPECTED_ENGINE=58` 教训）
- 发现问题必须处置：修或建任务（有证据才建），不静音
- 计量强制：派发前 `--task-start`、fan-in 关闭 `--task-end`，两步不可跳过
- 停止条件：`.halt`/suite 非绿/needs-human≥3/合并冲突/就绪队列空 —— 一律停下等人
