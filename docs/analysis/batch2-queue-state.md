# 快速模式队列状态（跨 compact / /clear 恢复用）

**更新：** 2026-08-02，内层编排会话写入
**用途：** `/clear` 后重读此文件 + 冷启动节三命令建立实况，**以 git 实测为准**（此文件可能是旧快照）
**上层目标：** `orchestration/exp6-phase1-sustained-unattended-operation.md`（外层任务，内层读它了解全局）

---

## 前置（exp6 阶段 A/B，满足后才启动 12 小时）

| AC | 内容 | 状态 |
|---|---|---|
| AC2 | 3 个既有失败各有 open 任务 | ✔ 已建 + **已修**（全 done） |
| AC4 | readiness 补 suite-green | ✔ 已补（`52cde788`，实跑 NOT READY 验证过） |
| AC1 | 套件 0 失败 | ✔ **达成**（2128 tests / 2110 pass / 18 skip / **0 fail**） |
| AC3 | select-preflight ≤30s | ✔ **达成**（83.4s → 8.3s，~10×，merge `ae94205a`） |
| AC5 | tick 队列补充步骤 | ⏳ 未做（下一项） |

## B4 已完成（2026-08-02，全部 merge + 全量绿）

| 任务 | merge | 关键 |
|---|---|---|
| `gap-select-preflight-json-real-store-too-slow` | `ae94205a` | walk-once 共享：83.4s→8.3s；2 walk-count 回归锁 |
| `gap-symlink-mirror-invocation-test-contract-mismatch` | `1f824aee` | 测试契约模型：exit-0+Usage 合法 + clock 字段 redact |
| `gap-dod-clause13-14-enforced-but-undocumented` | `f10f6860` | Option A 文档补 Clause 13/14，PASS all 15 clauses |

## 已完成 B5（全部 merge）

| 任务 | merge | 关键 |
|---|---|---|
| `gap-tests-spawn-cli-from-ts-source`（用户建 `fa0500ad`） | `7032e704` | cli-entry.mjs 载体 + cli.test.mjs 131s→66s；done |
| `gap-tests-use-cli-where-module-import-suffices`（用户建 `0f0c8d10`） | `478e76d2` | sink 不必要的 fixture 进程（serve/mcp-server tests）；done，34.5 min |

## 滞留分支合并（人裁定 M243 → M246 → M222，M239 推迟）

| 分支 | 状态 |
|---|---|
| **M243**（DIR-124-A2） | **B 回退**（时间盒内未恢复）。单一根因找到：`validateEvent` 返回 `.error` 非 `.errors`（runner bug，`095ddbf0` 已修）。但完整恢复 12 fixtures 还需修语料 5 类 A1a 差异（recordedAtMs/stage 大小写/endedAtMs/agentLabel/outcome），触及语义修复→时间盒出口。**revert `88e17bf2`**，master 绿。恢复时必须一并带回 `095ddbf0`（已记入 DIR-124-A2.md「恢复时必须一并带回的修复」节） |
| M246（DIR-124-A5） | 待 M243 裁定后 |
| M222（DIR-112） | 待 M246 后；rebase 到 B5-1 之上，保留异步 + 换 QUAY_CLI |

## 在飞（B7）

| 任务 | dispatch | runId | worktree |
|---|---|---|---|
| `gap-telemetry-report-writes-and-deadlocks-readiness` | 17:10Z | fm-gap-telemetry-report-writes-and-deadlocks-readiness-1785690646974-mw97c6 | /tmp/quay-wt-telemetry-readiness |

B7-1：把 `--report` 的写拆成显式 `--snapshot`/`--flush` 子命令，`--report` 变纯读。根因是职责错位（读操作在写）不是 gitignore——聚合保持跟踪、不放宽 readiness 干净树检查、不 gitignore 绕过。`.halt` 保留（去留等外层裁定），本任务是用户驱动的例外派发。外层已停两个 inner Monitor（各 60s 调一次 --report），树可保持干净，AC3（20 次 --report 后 git status --porcelain 为空）可真实验证。

## 已完成 B6

| 任务 | merge | 关键 |
|---|---|---|
| `gap-suite-cost-model-is-wrong-optimizations-buy-nothing` | `4282632c` | 成本模型实测：**非「最慢单文件」决定、8-lane 饱和**（Σ/wall ≈7.1）；噪声带宽 17–63s；B5-1/B5-2 墙钟效果在噪声内不可判定；AC1b 断言汇聚点计时（env-gated，零断言改动）+ `measure-suite.mjs` 可重复测量工具。done，72 min |

## 待执行（按顺序）

| 任务 | 说明 |
|---|---|
| **M243 恢复** | 必须一并带回 `095ddbf0`（validateEvent 返回 `.error` 非 `.errors`，runner bug，随 revert `88e17bf2` 成了孤儿——已核实：该 commit 仍在对象库，但文件不在 HEAD 树，不带回 bug 原样回来）。完整恢复还需修语料 5 类 A1a 差异（recordedAtMs/stage 大小写/endedAtMs/agentLabel/outcome） |
| M246（DIR-124-A5） | 待 M243 裁定后；M246 与 M222 的合并**按人裁定顺序**，M239 已推迟 |
| M222（DIR-112） | 待 M246 后；rebase 到 B5-1 之上，保留异步 + 换 QUAY_CLI |
| 下一批 gap 任务 | **先 checkTouchesPair 组可并发批次**（外层实测：本会话 Task/Agent 未进工具前六，并发是关的；下一批默认并发，不默认串行）。测试是最大可优化项（36%），新成本模型已给出可测阈值（≥20s 墙钟 / Σ 需 ≥5 采样） |
| AC5：tick 队列补充步骤 | 复用 select-preflight/assembleBatch，不新建 |
| AC6：跑 readiness check（含 suite-green）→ READY 后 rm .halt + /loop | 前置 AC1-AC5 全满足后 |

## 工作方式调整（外层实测 2026-08-02，含 subagent transcript 的完整分解）

- **时间去向（修正版，含 subagent transcript）：空转 14% / 全量套件 26.2% + 范围化 9.7% = 测试 36%**。早先「空转 49%、测试不是瓶颈」的分解漏了 subagent transcript，是错的（`940a3f5b` 修正）——**测试是最大的可优化项**
- 迭代阶段一律 `--for-task`（68s vs 489s，7.2×），全量只在合并前跑一次
- 下一批先 checkTouchesPair 组可并发批次，不默认串行

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
