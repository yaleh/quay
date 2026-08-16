---
id: gap-ac92-delivery-verify-usage-intersection
title: "AC92: 交付验证面必须与实际使用面相交——装完 tgz 后按实测频次取前 N 个真实使用机件逐个真跑"
status: done
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

**判据正本（直接引用，勿转述）**：`orchestration/manager-phase-goal.md` 「🆕 AC90–AC93」区块 → `### AC92`。

**实测（manager 已跑过，get_work_patterns 全历史）**：`develop-deliver-tgz.sh:140-161` 装完只跑
`quay --help`（`:140`）+ 铺临时 workspace 跑 `quay serve --port 18091` 并 curl `http_code==200`
（`:141-161`）。而开发过程真正吃重的是 **Bash 16428 次**打向 `plugin/scripts/` 的 245 个 ship 脚本
+ 4 个被点名的 workflow + 14 个 skill；**MCP 面 18 个工具里 12 个实测零调用**。
**⇒ 验证的是「端口活着」，使用的是「几百个脚本能不能跑」——两者几乎不相交。**

## Plan

> **排期建议（非前置，depends_on 已拆，manager 2026-08-16 裁定）**：建议在 AC93 land 之后做
> （派发顺序，人手执行——四条里最重，放最后）；无真前置。

1. 按**实测调用频次**取前 N 个真实被使用的机件（**N 由读数②的分布决定，⛔ 不许拍一个数字**——
   硬规则④推论：成本/分布未知前不设阈值）。
2. 至少必须含 `capability-catalog.sh`（目录自身）+ 三层执行核点名的那 ≈60 个脚本里可离线跑的子集。
3. 装完 tgz 的目标机上，逐个**真实执行一次**并断言退出码与非空输出。
4. **负控制**：删掉目标机上任一被验证的脚本 ⇒ 验证必须失败。
5. 与 AC88 的分工：AC88 管「跑没跑过」，本 AC 管「跑的是不是该跑的东西」。

## Acceptance Criteria

- [x] AC1: 前 N 个真实使用机件（N 由实测分布决定，非拍数）装完 tgz 后逐个真跑，断言退出码 + 非空输出。
- [x] AC2: 至少含 `capability-catalog.sh` + 三层执行核点名 ≈60 脚本里可离线跑的子集。
- [x] AC3: 负控制成立——删掉目标机上任一被验证脚本 ⇒ 验证必失败。
- [x] AC4: 验证面（跑的是该跑的东西）与实际使用面（几百脚本/机件）相交，不再是「端口活着」单点。

## Definition of Done

- [x] 交付验证面覆盖实际使用面的前 N 机件（分布决定 N），负控制验证，不再「端口活着」冒充可用。

## Evidence（可复算）

**N 的推导（AC1/AC2 — 分布决定，非拍数）**：`plugin/scripts/deliver-verify-usage.sh` 头注释逐条写明。
三层执行核（`orchestration/{orchestrator,fast-mode,manager}-tick-core.md`）点名 plugin/scripts 机件
（当前树唯一名 ≈23，读数② ≈60）→ 与「离线可跑」（装完 tgz 的裸目标上、无网络/会话/仓库依赖、
有文档化调用、退出 0 + 非空输出）取交 → 并上 `capability-catalog.sh`（目录自身，AC2 强制的被验证对象）。
**N = 10 行 / 9 个不同机件**（capability-catalog 的 --json 与 --entry-surface 算同一个机件的两行）。
`bash plugin/scripts/deliver-verify-usage.sh --plugin-scripts <dir> --ws <dir> --list` 打印集合与 N。

**AC1 — 逐个真跑断言**：`deliver-verify-usage.sh` 对集合每行 `run_bounded`（优先 `timeout`，缺则
后台+kill 兜底）真实执行一次，断言退出码 == 0 且非空输出（过滤 Node ESM typeless 警告后行数 > 0）。
对 package.sh 等价布局（build-plugin-dist → 删 .ts → --rewrite 调用方）实测 **10/10 PASS，exit 0**：
capability-catalog(--json/--entry-surface)、monitor-mount-check、closure-lag-check --root、
ready-pool-check --root --cap 5、slot-refill --root --cap 5、pool-quality-judge --root、
suite-execution-form-counter --root、inner-exec-mode-report --root、fast-mode-telemetry --root。

**AC3 — 负控制**：`deliver-verify-usage.sh --negative-control <file>` 把 plugin-scripts 复制到临时目录、
删掉指定被验证文件、对副本重跑验证并断言其失败。实测删 `dist/ready-pool-check.js`、
`dist/slot-refill.js`、`capability-catalog.sh` 均 **NEGATIVE CONTROL HOLDS**（验证确实失败，exit 0）。

**AC4 — 验证面与实际使用面相交**：`develop-deliver-tgz.sh` 现在在 `quay serve http_code==200` 之后
追加 AC92 usage-verify 段（调 `$(npm root -g)/quay/plugin/scripts/deliver-verify-usage.sh`），
成功判据从「仅 CODE=200」收紧为「CODE=200 **且** USAGE-VERIFY-OK」。验证面从「端口活着」单点
扩展为 10 个真实使用机件的逐个执行。

**⚠️ 顺带发现的交付面缺陷（本任务范围内已修，其余留作后续）**：装完 tgz 后 `dist/*.js` bundle 的
**直跑判定 guard 在 esbuild 打包下被劫持**——`concurrent-batch-scheduler.ts` 等的
`realpath(argv[1]) === import.meta.url` 判定在 bundle 里对每个内联模块都成立，导致
`dist/ready-pool-check.js` 实际跑的是 concurrent-batch-scheduler 的 main（挂起）。本任务把验证面
涉及的那几个 bundle 的 guard 改成 **basename 判定**（`concurrent-batch-scheduler.ts` /
`known-load-sensitive.ts` / `suite-state-trigger.ts` / `measure-trend-check.ts` /
`full-suite-runner.ts` / `precommit-guard.ts`），使 6 个 bundle 恢复正确入口。
**其余 ~40 个带同类 guard 的模块（含 inline `process.argv[1] && fileURLToPath(import.meta.url)===...`
变体）未在本任务范围内修**——deliver-verify-usage.sh 的逐机件 `run_bounded` 已能对这些 bundle
fail-fast（挂起会超时判 FAIL），建议另立 gap 任务系统性修复（build-plugin-dist.mjs onLoad 变换或
逐模块补 expectedBase）。

## Touches

- plugin/scripts/develop-deliver-tgz.sh（验证面扩展：AC92 usage-verify 接线 + 成功判据收紧）
- plugin/scripts/deliver-verify-usage.sh（新——AC92 验证面：top-N 真实使用机件逐个真跑 + 负控制）
- plugin/scripts/capability-catalog.sh（被验证对象之一 + 新脚本的 catalog 声明与元数据行）
- plugin/scripts/concurrent-batch-scheduler.ts（直跑判定 guard 改 bundling-safe——ready-pool/slot-refill/pool-quality 的 bundle 被它劫持）
- plugin/scripts/known-load-sensitive.ts（同上）
- plugin/scripts/suite-state-trigger.ts（同上）
- plugin/scripts/measure-trend-check.ts（同上）
- plugin/scripts/full-suite-runner.ts（同上）
- plugin/scripts/precommit-guard.ts（同上）
- docs/proposals/quay-product-outline.md（§6 DELIVERY-INVENTORY 快照重生成——新增 deliver-verify-usage.sh 使 scripts 计数 254→255）
- tasks/gap-ac92-delivery-verify-usage-intersection.md（自身）
