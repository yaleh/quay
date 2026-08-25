---
id: gap-suite-concurrent-session-liveness-cross-contamination
title: 并发套件（全量+scoped）共享 session-liveness-sig-* 前缀 ⇒ leak-scan 跨套件误报假红
status: needs-human
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

`gap-tmux-stale-not-honored-comment-private-socket-leak-scan` fan-in 5 轮 defer 至 needs-human——全量套件尾 tmux-leak-scan 检出 `/tmp/session-liveness-sig-*`（5 目录）+ `ol-*`（5 会话）残留，来自【其它任务并发套件】的 session-liveness 测试（本任务 Touches 前缀 `quay-init-tmux-|quay-isc-|repro-rmsync-` 不在残留内，workflow 已核实）。残留 transient 已清，但并发套件仍在跑（m-bucket 全量 + print-bg-wait scoped）⇒ 立即重派会再撞同一残留。

**根因**：`QUAY_MAX_CONCURRENT_SUITES=1` 应串行化套件，但全量 + scoped 套件仍在并发；并发套件共享 `session-liveness-sig-*` 前缀 ⇒ leak-scan 无法区分「本套件残留」vs「其它套件残留」，把并发套件的合法残留误判为 leak。

**代码层根因（manager 定位，已核实 2026-08-25）**：`full_suite_lock_acquire()` 只在 `run_selected()` 函数体内被调用一次（`scripts/test.sh:881`）；`--buckets` 分支（`:1352-1440`）里 `run_selected` 只在两个兜底场景被调（`bucket_full=1` 退化全量 `:1381`、0 文件退化 `:1386`），**正常 bucket-scoped 成功路径（选中 M/P 文件）结构上跳过 `run_selected` ⇒ 也跳过锁**。实证：round #572 M 桶 `lock_wait_ms` 键缺失（该键只在真 `full_suite_lock_acquire` 时写），与 #573 full 全程重叠 5 分钟。`QUAY_MAX_CONCURRENT_SUITES=1` 前提是「所有套件调用走同一把锁」，但 `--buckets` 从设计上没接进去——不是 flock 失效，是这条路径压根没调获取锁的函数。**与 `gap-suite-serial-lowconc-classification-recheck` 同族**：`run_selected()` 里挂的东西（锁 + serial/lowconc 保护）对 `--buckets` 正常路径全部生效缺失。⇒ 判据应是「bucket-scoped 成功路径也调用 `full_suite_lock_acquire`」，前缀隔离（②）是症状级防御、非根因修复。

## Plan

三选一（或组合）：① 串行化套件（honor `QUAY_MAX_CONCURRENT_SUITES=1`，含 scoped 计数）；② 按套件隔离 `session-liveness-sig-*` 前缀（每套件独立前缀）；③ leak-scan 过滤非本套件残留（按前缀/套件 ID）。

**落地 ②（前缀隔离）**：复用 `gap-leak-residue-per-run-namespace-isolation` 已有机制 —— `scripts/test.sh` 在 `QUAY_RUN_ID` 未设置时自行生成并 export 一个 8-hex 短 id（full-suite-runner.ts 已设则不覆盖），使 fan-in 直跑路径（`setsid bash scripts/test.sh --buckets` / `--for-task` scoped 门，均绕过 runner）与全量套件一样获得每轮独立 `/tmp/quay-run-<id>/` 命名空间 ⇒ session-liveness 探针落各自命名空间、套件尾 leak-scan 只扫本子树 ⇒ 并发套件残留互相不可见。①/③ 未采用（① 会串行化 scoped 门拖慢吞吐且改不动 fan-in 直跑路径；③ 需每套件 ID 传导，改动面更大）。

## Acceptance Criteria

- [x] AC1（能取假，并发不误报）：并发套件下 leak-scan 不再误报其它套件残留；（⛔ 仍假红 ⇒ 假）。
      行为负控制（`plugin/test/suite-run-namespace-isolation.test.mjs` AC1 两条，`node --test` 实测 4/4 pass）：
      ① QUAY_RUN_ID 设 8-hex 命名空间后，`tmux-leak-scan.sh --check` 对 legacy 共享前缀
      `/tmp/session-liveness-sig-t-*` 残留 exit 0（`no NEW residual`）；② 对【另一】命名空间
      `/tmp/quay-run-<otherId>/` 下残留同样 exit 0 —— 若 scan 停止 honor QUAY_RUN_ID 回退 legacy 前缀，① 恒 FAIL（能取假）。
- [x] AC2（能取假，串行/隔离生效）：全量+scoped 套件不再并发共享 session-liveness 前缀（串行化或前缀隔离）；（⛔ 仍并发共享 ⇒ 假）。
      结构针（同上文件 AC2 两条）+ 干跑：`scripts/test.sh` 含 `if [ -z "${QUAY_RUN_ID:-}" ]` 守卫下的
      `export QUAY_RUN_ID="${_qrid}"`（8-hex，`od -N4 -tx1 /dev/urandom`），且位置在首个
      `tmux-leak-scan.sh --snapshot` 之前（移动/删除 ⇒ 结构针 FAIL，能取假）；`bash -n scripts/test.sh`
      通过、`QUAY_RUN_ID=` 空跑生成 `809e76d3`（len=8）⇒ 直跑路径（--buckets/--for-task）probe 落各自
      `/tmp/quay-run-<id>/`，不再共享 `/tmp/session-liveness-sig-*`。

## Definition of Done

并发套件跨污染消除；AC1-2 全勾；fan-in 不再因并发套件残留被 defer。

## Touches

- scripts/test.sh（QUAY_RUN_ID 按需生成 — 直跑路径套件化）
- plugin/test/suite-run-namespace-isolation.test.mjs（对应测试）
- tasks/gap-suite-concurrent-session-liveness-cross-contamination.md（自身）

## Escalation（2026-08-25 → needs-human）

实现已完成并验证（worktree e7e29445 + merge develop 9e6e4e28）：Plan ② 前缀隔离落地于 `scripts/test.sh`（QUAY_RUN_ID 按需生成），AC1-2 已勾、全量 suite 两轮绿（exit 0，wall_ms≈1212704，lane_count=16）。fan-in 无法落地：`fan-in-materialize-check` 假阳性 RED（确定性，重跑同红）。

根因：实现阶段 Touches 由 `plugin/scripts/full-suite-runner.ts`（fan-in orchestration file ⇒ bootstrap-HIT）收窄为 `scripts/test.sh`（非 orchestration ⇒ 实为非 bootstrap），但该 Touches 变更尚未 merge 到 develop ⇒ check 读主检出旧任务体（Touches 仍列 full-suite-runner.ts）误判 bootstrap-hit ⇒ 再比 materialized record（派发时旧 md5 2c046a5c）vs worktree 现 fan-in-execute.js（merge-develop 后新 md5）⇒ `red-worktree-exists-mismatch` 假红（materialized record 不可变 + worktree 文件不再变 ⇒ 重跑必同红）。

处置（三选一，供 outer）：a) 同步主检出任务体 Touches（已在本 body 收窄为 scripts/test.sh）+ 翻 ready 重派 fan-in（check 读收窄后 Touches ⇒ 非 bootstrap ⇒ 通过）；b) ruled 该提交（豁免 check）；c) 修 `fan-in-materialize-check.ts` 读 worktree Touches（新 gap，与已 done 的 `gap-fan-in-materialize-check-false-positive-non-bootstrap` 同族但不同变体：那修的是 `taskIsBootstrapHit` 死代码未接线，这修的是「读主检出陈旧 Touches 而非 worktree 实际 Touches」）。