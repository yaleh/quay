---
id: gap-quay-init-loop-dedupe-real-install
title: "quay-init 族去重复真装——文件级 before 钩子 1 次真装 + 文件拷贝副本（不含 check-drift，已另案退休）"
status: done
labels:
  - gap
  - performance
parent: null
children: []
extra:
  schema: execution
---

**type:** finding

## Finding

`quay-init-loop-*` 系列测试文件内，多个 `test()` 各自独立调用 `runLoop(ws, src)` 从零做一次完整真实安装（`spawnSync` 真跑 `quay-init.sh --loop`，真实文件系统拷贝几十个衍生脚本）。单文件至少 4 次独立「从零真装」，是同族耗时大头（今晚统计该族单文件 395-525s，是当轮最慢文件）。该族测试自带 `@load-sensitive real-install` 注释，测试设计者已知「又慢又 flaky」，现有对策是「隔离降并发」，没动「减少重复安装次数」。

real-install 族单文件耗时 5 天涨 4-6 倍（measure-history.jsonl 887 条：driver 32s→271s、vendor 61s→425s），趋势真实。**问题不在「测得太真实」（这些测试保护真实缺陷类 delivery-surface 冻结不更新 + 数据完整性），在「重复测太多遍同一件昂贵的事」。**

## Acceptance Criteria

- [x] AC1: 安装-as-setup 用例只做共享 fixture 的 1 次真装（`before` 钩子产出只读基线快照，content-addressed，per serial phase 共享），每条用例 `cp -a` 复制工作副本 + 各自破坏性操作 + 验证；install-time 行为用例按 AC2 保留必要真装：detection 阶梯改 `--dry-run`（同一 detection 路径 + 同输出，不落盘）、gitignore 用例改 fixture 基线 + 重跑。文件级从零真装 spawn：core 7→3 + 4 条 dry-run、runtime 8→6（gitignore 2 条改 fixture 基线）；vendor 7 条全为 vendor-runtime 行为用例，真装保留（AC2）。
- [x] AC2: 覆盖率不丢——33/33 全绿；dry-run 用例仍走真实 `detect_test_command` 路径（message + exit code 同真装，只省 laydown+verify）；gitignore 用例仍走真实 `ensure_runtime_gitignore`（fixture 复制后重跑，skip/append 行为全断言）。**未改任何 mock/fixture**。
- [x] AC3: scoped 绿（`scripts/test.sh --for-task … --allow-thin` EXIT=0，33/33 pass + 全部 scoped 静态检查 PASS）+ 从零真装 spawn 下降（22→16，其中 core 4 条改 dry-run、runtime 2 条改 fixture 基线）+ 单文件耗时下降（core 隔离实测 ~151s，含 4 条 dry-run 各 ~6-8s vs 真装 ~13s；fail-closed 那条 13s→170ms）+ flakiness 随 spawn 减少同步降。

## Definition of Done

- [x] 安装-as-setup 真装收敛到共享 fixture（1 次真装 per serial phase）+ 文件拷贝副本；行为用例 detection 改 dry-run、gitignore 改 fixture 基线；真装 spawn core 7→3 / runtime 8→6 / vendor 7（vendor-runtime 行为，AC2 保留）。耗时下降 + flakiness 降，覆盖率不丢（真实输出，非 mock）。

## Impl（gap-quay-init-loop-dedupe-real-install）

落地（2026-08-19，worktree `task/gap-quay-init-loop-dedupe-real-install`，基线 develop d00e570a）：

- **共享 fixture 基线已由前序任务落地**（`gap-serial-install-family-shared-prebuilt-fixture` `9578de67` / `ce183c82`）：`quay-init-loop-helpers.mjs` 的 `sharedFixture`/`laydownTemplate`/`laydownWorkspace` 已提供「before 钩子 1 次真装 → 只读基线 → `cp -a` 副本」机制；core/runtime 的安装-as-setup 用例已接。本任务在剩余行为用例上继续收敛。
- **core.test.mjs**：detection 阶梯 4 条改 `--dry-run`——①「no detection source fail-closed」实测 dry-run 同 exit 2 + 同 stderr（170ms vs 真装 ~13s）；② scripts/test.sh、③ go.mod、④ Cargo.toml 只断言 detected message + exit 0，dry-run 同路径同输出（各 ~6-8s vs 真装 ~13s）。保留真装的 3 条（custom-config 写 config、package.json 检测写 config、explicit 优先写 config）都断言 `.quay/config.yml` 写入，dry-run 不落盘，故按 AC2 保留。
- **runtime.test.mjs**：AC10 gitignore 2 条改 fixture 基线 + 重跑——pre-existing 条在 fixture 副本已有 runtime 条目上叠 user note 再重跑（skip 不重复）；append 条删掉 fixture 副本条目留 user content 再重跑（append）。`ensure_runtime_gitignore` 每次 install 都跑（fresh 或 re-run），行为不变。vendor-runtime 6 条（no-bundles fail-closed / fake-bundles lay / auto-build / existence OK / existence fail / migration）为 install-time 行为，真装保留。
- **vendor.test.mjs**：7 条全为 vendor-runtime 行为（stale mtime / freshness / version-consistency），每条改 plugin 副本后跑真装、断言 install 输出，无法用 fixture 基线复制（install 本身即被测物），按 AC2 保留。
- **helpers.mjs**：未改（`runInit` 透传 `--dry-run`；`laydownWorkspace` 已是共享 fixture 复用点——本任务 gitignore 2 条正是复用它）。
- **测量**：scoped 33/33 绿，EXIT=0；core 隔离 ~151s；真装 spawn 22→16（core 7→3 + 4 dry-run、runtime 8→6、vendor 7 不变）。

## Touches

- tasks/gap-quay-init-loop-dedupe-real-install.md（自身）
- plugin/test/quay-init-loop-core.test.mjs（before 钩子真装 + 文件拷贝）
- plugin/test/quay-init-loop-vendor.test.mjs（同上）
- plugin/test/quay-init-loop-runtime.test.mjs（同上）
- plugin/test/quay-init-loop-helpers.mjs（共享 fixture 手法复用）
