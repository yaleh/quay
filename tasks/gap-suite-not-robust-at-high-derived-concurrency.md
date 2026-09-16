---
id: gap-suite-not-robust-at-high-derived-concurrency
title: 套件在 nproc 推导的高并发（128路，tokyo-alpha）下不稳定——已临时封顶到16，根因未修
status: todo
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: finding
---
**type:** execution

## Finding

`scripts/test.sh` 的默认并发是 `max(1, floor(nproc × oversub / S))`——按执行机器的核数动态推导（`gap-no-resource-awareness-heavy-ops-run-blind` AC5）。这个设计假设"更多核 ⇒ 更高并发是安全的"，但在 `gap-tokyo-alpha-runner-env-lacks-pyyaml-suite-red` 排查环境缺口时，第一次真的在一台 128 核机器（tokyo-alpha self-hosted runner）上以推导出的高并发（128路）跑了全量套件，实测**推翻了这个假设**：

**实测（同一 commit，同一台机器，连跑三次，128路并发）**：每次失败集合都不一样，且都是负载/时序形状，不是确定性的产品缺陷：
- `serve-board` 相关测试：`EADDRINUSE 0.0.0.0:44203`（端口分配在高并发下发生冲突）
- `fan-in-execute-paths` ⑧⑩：15s 有界等待被打破（时序假设在高负载下不成立）
- `dead-code-after-return-check` AC6：live-tree 严格零扫描的判据在高并发抖动下不稳

这三类失败在同一 commit 三次运行里**互不相同**，符合"负载相关 flake"而非"确定性缺陷"的形状（同类模式已见于本仓库其它已知 flake：`tmux-leak-scan-r2`、`git-graph-oracle` 等——见 `[[flaky-test-cluster-test-separates-data-dependence-from-load-sensitivity]]` 一类既有记录，但这三个具体测试之前没被专门记录过，因为从未有机器真的跑出 128 路并发）。

**当前处置（`gap-tokyo-alpha-runner-env-lacks-pyyaml-suite-red` 里做的，是工作区绕过不是根因修复）**：在 `.github/workflows/ci.yml` 的 `Run tests` 步骤里把并发**显式封顶到 16**（这个套件日常被开发/验证所用的那台 16 核机器的既有惯例值），绕开了不稳定区间，但没有修复这三类测试本身对高并发的不健壮性。

## Requested action

给上面三类测试各自的时序/资源假设做出健壮化处理（不是简单再调阈值），使套件在真正的高并发（128路量级）下也能稳定：
1. `serve-board`：端口分配改用动态探测而非固定端口猜测，或加重试。
2. `fan-in-execute-paths` ⑧⑩：15s 有界等待的边界在高负载下需要要么变成显式可配置、要么改用事件驱动而非墙钟等待。
3. `dead-code-after-return-check` AC6：查清"live-tree 零扫描"判据为什么会被高并发抖动影响（可能是并发写入同一路径 / 判据本身有竞态）。

⛔ 不要仅仅"调大超时数字"敷衍——按硬规则 4 的推论，成本结构未知前不要设数值阈值；先搞清楚每类失败的真实机制。

## Acceptance Criteria
- [ ] AC1: 三类失败各自的根因机制查清（端口分配策略 / 等待边界来源 / 判据竞态来源），不是"调大数字让它过"。
- [ ] AC2: 三类测试修复后，在 tokyo-alpha（128 核，真实环境）上，同一 commit 用推导并发（不封顶，即 `default_test_concurrency()` 的原生值）连跑 ≥5 次，`cancelled`/`failed` 恒为 0（取假：修复前同样跑 5 次必须复现至少 1 次失败，作为对照）。
- [ ] AC3: `.github/workflows/ci.yml` 里 `gap-tokyo-alpha-runner-env-lacks-pyyaml-suite-red` 加的并发封顶（16）移除，恢复使用 `default_test_concurrency()` 的宿主推导值（呼应硬规则 4 推论二：不要用一个恰好等于某台机器容量的字面量代替"读宿主"）。

## Definition of Done
- [ ] 并发封顶字面量从 `ci.yml` 移除，套件改回宿主推导并发，且在 tokyo-alpha 上稳定跑绿（AC2 的 5 连跑记录落证据）。

## Touches
- plugin/test/serve-board*.test.mjs（端口分配部分）
- plugin/test/fan-in-execute-paths*.test.mjs（⑧⑩ 等待边界部分）
- plugin/scripts/dead-code-after-return-check.ts（AC6 判据部分）
- .github/workflows/ci.yml（移除并发封顶字面量）
- tasks/gap-suite-not-robust-at-high-derived-concurrency.md（自身）
