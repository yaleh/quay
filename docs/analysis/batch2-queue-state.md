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

## 在飞（B5，串行）

| 任务 | dispatch | runId | worktree |
|---|---|---|---|
| `gap-tests-use-cli-where-module-import-suffices`（用户建 `0f0c8d10`） | 13:45:01Z | fm-gap-tests-use-cli-where-module-import-suffices-1785678301009-hn9gyi | /tmp/quay-wt-usecli |

## 已完成 B5

| 任务 | merge | 关键 |
|---|---|---|
| `gap-tests-spawn-cli-from-ts-source`（用户建 `fa0500ad`） | `7032e704` | cli-entry.mjs 载体 + cli.test.mjs 131s→66s；done |

## 滞留分支合并（人裁定 M243 → M246 → M222，M239 推迟）

| 分支 | 状态 |
|---|---|
| **M243**（DIR-124-A2） | **STOP**：merge 后全量红 → 已 revert（`7b6e1100`）。根因：M243 corpus 用 2026-08-01 旧 stage 约定（verify/build/audit 小写 + 缺 recordedAtMs），与 B2-1 schema 演进（大写枚举 + recordedAtMs 必填）系统性冲突。分支保留（`e8b4d49e`），等人工裁定：批量升格 corpus 到新约定 / schema 兼容旧 stage / M243 推迟 |
| M246（DIR-124-A5） | 待 M243 裁定后 |
| M222（DIR-112） | 待 M246 后；rebase 到 B5-1 之上，保留异步 + 换 QUAY_CLI |

## 待执行（按顺序）

| 任务 | 说明 |
|---|---|
| `gap-suite-cost-model-is-wrong-optimizations-buy-nothing`（外层建） | **优先级最高**：采集全部 157 文件 duration_ms 分布、算 Σduration/墙钟 vs 并发度 8、同 commit 连跑 3 次量噪声。**不做任何优化** |
| AC5：tick 队列补充步骤 | 复用 select-preflight/assembleBatch，不新建 |
| AC6：跑 readiness check（含 suite-green）→ READY 后 rm .halt + /loop | 前置 AC1-AC5 全满足后 |

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
