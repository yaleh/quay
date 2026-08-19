# lane-concurrency-control-round — AC101 600s 根因对照轮（S=1 vs S=2）

**task**: `gap-ac101-lane-concurrency-control-round`（对照实验，非代码改）
**runId**: fm-gap-ac101-lane-concurrency-control-round-1787080117495-ra65ke
**commit**: `d5d4835c2299cbdb43542782087526f107e813b3`（同 commit，两侧同负载）
**worktree**: `/home/yale/work/quay-worktrees/gap-ac101-lane-concurrency-control-round`

## 口径（两侧一致，AC3）

- **writer**: `full-suite-runner` 直调（`node --no-warnings --experimental-strip-types plugin/scripts/full-suite-runner.ts --root <worktree> --state-dir <worktree>/.quay`）——不走 fan-in 落地行、不走 fan-in 写入路径。
- **QUAY_PHASE_OVERLAP=0**（off，两侧固定同值）——隔离 S 的单一效应（sequential serial→lowconc→main，避免 overlap 下 serial+lowconc 各 16 的 32-lane 超订叠加变量；计划 step 3 的「建议 off」）。
- **同 commit、同 nproc=16、同负载**；两侧 `concurrentSuitesRunning=1`（单 suite，无并发，AC4 满足）。

## 结果（verification-round.jsonl rich-schema，两侧直调同 writer）

| 字段 | S=2 基线 | S=1 对照 | Δ |
|---|---|---|---|
| startedAt | 2026-08-18T19:21:59.268Z | 2026-08-18T19:58:57.589Z | — |
| durationMs | **1750753 (1750.8s)** | **872413 (872.4s)** | **-878.4s (-50.2%)** |
| laneCount | 8 | 16 | ×2 |
| concurrentSuiteSlots | 2 | 1 | S=1 |
| concurrentSuitesRunning | 1 | 1 | 单 suite |
| nproc | 16 | 16 | 同 |
| static_phase_ms | 85617 (85.6s) | 50615 (50.6s) | -35.0s |
| serial_phase_ms | 590264 (590.3s) | 281044 (281.0s) | **-309.3s (-52.4%)** |
| lowconc_phase_ms | 427767 (427.8s) | 183617 (183.6s) | -244.2s (-57.1%) |
| main_phase_ms | 598388 (598.4s) | 312178 (312.2s) | **-286.2s (-47.8%)** |
| phase_overlap | 无（off） | 无（off） | 同 |
| tests | 5214 (pass 5213 / fail 1) | 5214 (pass 5209 / fail 5) | — |
| state | red | red | 均非 clean-green |

### 失败明细（两侧均 environmental，非 develop 代码缺陷）

- **S=2 基线 fail 1**：`plugin/test/tmux-leak-scan.test.mjs`（kind=fixture-vs-sweeper——环境 tmux 残留，loop 其它 worktree 的 tmux 会话；同环境既存）。
- **S=1 对照 fail 5**（S=1 环境变量直接暴露的机制面，见下「附加发现」）：
  - `plugin/test/pre-verified-round-record.test.mjs`、`plugin/test/tmp-leak-pairing-check.test.mjs`、`plugin/test/resource-gate.test.mjs`、`plugin/test/worktree-process-reaper.test.mjs`、`process-budget.sh`——测试 fixture 硬编码 S=2 期望（`concurrentSuitesRunning=2` / `full-suite.lock.0/.1` / `max(1, floor(nproc/S))`），在 `QUAY_MAX_CONCURRENT_SUITES=1` 下断言 S=2 行为而失败。

## 判定（AC2）

**>600s ⇒ 不落 S=2→1 默认；记录 serial 301s 候选路径为下一候选，不空转。**

- S=1 总墙钟 872.4s **仍 > 600s**（差 272s）——「S=1 单独达不到 600s」（manager 08-18 补强判据）被本对照轮证实。
- **但 S=1 提供 50.2% 总提速 + 三相全提速**（serial 590→281、main 598→312、lowconc 428→184），与「S=2 默认砍半并发与裁定方向相反」的根因判断一致——S 是主因之一，**单靠 S 不够**。
- **组合目标口径（manager 08-18 重述）**：S=1 + overlap ON（生产默认）估算 ≈ 872 − lowconc(184) ≈ **688s**（serial+lowconc 窗口 max(281,184)=281 替代 sequential 465），仍 >600s。⇒ 600s 需 S=1 + overlap ON + 其余（lock_wait 消除 `gap-verification-round-observability-holes` AC1 + serial 相文件级优化）一起上。
- **吞吐反事实（manager 08-18 补强判据）**：S=1 轮 872s vs S=2 轮 1750s ⇒ 4.13 轮/h vs 2.06 轮/h（串行口径）；S=1 串行吞吐 ≈ S=2 并发吞吐 ×2。**证成：S=1 不牺牲吞吐，反而翻倍。**

## 下一候选：serial 相文件级耗时清单（S=2 基线 serial 相 33 文件，按 per-file 墙钟降序）

serial 相 = 590.3s（49.7%→本 commit 33.7%）仍是最大单块之一。文件级清单（`__PERFILE__ duration_ms` 提取自 S=2 基线 log）：

| 文件 | 墙钟 |
|---|---|
| plugin/test/quay-init-loop-core.test.mjs | 406.5s |
| plugin/test/quay-init-loop-consumer-doc-refs.test.mjs | 329.1s |
| plugin/test/runner-grouping-list-groups.test.mjs | 296.9s |
| plugin/test/quay-init-loop.test.mjs | 277.4s |
| packages/quay/test/install-config-driven-e2e-runtime.test.mjs | 264.2s |
| plugin/test/runner-grouping-serial-anti-stomp.test.mjs | 258.9s |
| packages/quay/test/install-config-driven-e2e-upgrade.test.mjs | 240.9s |
| plugin/test/quay-init-drift-report.test.mjs | 211.5s |
| packages/quay/test/install-config-driven-e2e.test.mjs | 203.9s |
| plugin/test/quay-init.test.mjs | 196.9s |
| packages/quay/test/delivery-standalone-smoke-gate.test.mjs | 181.3s |
| plugin/test/runner-grouping-flags-only.test.mjs | 169.9s |
| plugin/test/quay-init-laydown-closure.test.mjs | 148.7s |
| plugin/test/runner-grouping-governance.test.mjs | 108.8s |
| packages/quay/test/acceptance.test.mjs | 108.2s |
| （其余 18 文件合计 ~320s，见 `__PERFILE__` 全表） | — |

**主导族**：① `quay-init-*` 真实安装族（quay-init-loop-core 406s + consumer-doc-refs 329s + loop 277s + drift-report 211s + init 197s + laydown-closure 149s ≈ **1570s 文件时**）；② `install-config-driven-e2e-*` 真实安装 e2e 族（runtime 264 + upgrade 241 + e2e 204 ≈ **709s**）；③ `runner-grouping-*` 族（list-groups 297 + serial-anti-stomp 259 + flags-only 170 + governance 109 ≈ **835s**）。

## 附加发现（机制缺陷，非本任务修，供后续立案）

1. **TS 侧 `suiteLockSlotCount()` 不 honor `RESOURCE_GATE_CONCURRENT_SUITES` 测试 seam**（`plugin/scripts/suite-lock-slots.ts` 只读 `QUAY_MAX_CONCURRENT_SUITES`），而 bash 侧 `suite_slot_count`（`plugin/scripts/suite-slot-lib.sh`）读 `RESOURCE_GATE_CONCURRENT_SUITES` → `QUAY_MAX_CONCURRENT_SUITES` → 2。⇒ 设 `QUAY_MAX_CONCURRENT_SUITES=1` 时，5 个测试（fixture 期望 S=2）在 TS 侧读不到 seam 而失败。**改默认 S=2→1 落地前必须先补这条 seam**（SSoT check `suite-slot-ssot-check.ts` 未抓到该不对称——同「硬编码 S=2」家族，hard-rule ③b/⑤）。
2. **当前 develop commit 的 suite 已比 609s 历史基线慢 ~2.6×**：production（overlap ON，S=2）本 commit 实跑 1601s/1615s（17:57、18:21 两条 green 记录），对照任务 body 的 609s 分解（serial 301 + main 255）来自更早更快 commit。**600s 目标相对本 commit 真值（~1600s）需 ~63% 削减，不止 S 旋钮。**

## 执行注记

- worktree 需 `node_modules` symlink（`git worktree add` 不复制 gitignored 的 node_modules，首跑 esbuild ERR_MODULE_NOT_FOUND）+ `refresh-worktree-quay.sh`（`.quay/config.yml` 等 carriers）——已补。
- 首轮 S=1 尝试被在飞 fan-in suite（`gap-suite-fix-workflow-no-load-sensitive-branch`，19:35 派发、19:51 前阻塞于本 S=2 基线持有的槽）在 flock 上排队阻塞，已 kill 重跑（AC4「与在飞 fan-in suite 不并行」）。
- 两侧 `concurrentSuitesRunning=1`、`phase_overlap` 字段缺席（off）——rich-schema 两侧同口径齐备（AC3）。
