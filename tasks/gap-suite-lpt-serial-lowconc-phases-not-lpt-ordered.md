---
id: gap-suite-lpt-serial-lowconc-phases-not-lpt-ordered
title: serial + lowconc 两相未走 LPT 排序——裸 node --test 字母序，尾部等待 ≈38% 整轮
  makespan（full 4 派发点 + --buckets 2 派发点范围遗留）
status: ready
labels:
  - gap
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

serial/lowconc 两相用裸 `node --test --test-concurrency=N <files…>`，node --test 对位置参数走 createTestFileList→ArrayPrototypeSort，argv 顺序被丢弃、按字母序重排。LPT（`lpt_reorder_files` + `suite-lpt-runner.mjs run({files})` 保序）只接了 main 相。原任务 `gap-m-bucket-long-tail-lpt-scheduling`（done）scope 只 M-bucket（223 文件/16 lanes）——属范围遗留，非有意排除。

**同机制、两条路径、六条派发点**：
- **full-suite 路径**（run_selected 内）：test.sh:1091/1093（overlap 分支）+ 1115/1133（sequential 分支）——serial(20 文件)+lowconc(20 文件) 按字母序 ⇒ 真实 makespan 代价（见下量化）。
- **--buckets 路径**（`--buckets` 分支）：test.sh:1543（bucket_serial）+ 1549（bucket_lowconc）——同用裸 `node --test`，LPT 在 `lpt_reorder_files files`（test.sh:1497）+ 按 group 切分之后，被 node --test 按字母序重排丢弃。实测 round 715/716(P)/718(M)：run 开头可见 `session-liveness-scd-*` 家族（`@test-group lowconc`）按字母序出现（busy→config-gates→develop-active→fire→…），非 LPT 序（LPT 应为 inflight-changing→busy→multitask→…）。**此处 makespan 代价≈0**（bucket_serial ≤1 文件；bucket_lowconc=8 文件且 `LOWCONC_CONCURRENCY` 派生=8 ⇒ 全同时启动，顺序无关）——属【一致性/可见性】缺口：LPT 承诺「longest-known first」在 run 开头被可见地违背。修法同 full 路径（接 runner 保序），AC2 量化只对 full 路径有意义。

**量化（round 721，2026-08-30 06:51Z，full 路径）**：serial_phase_ms=327s + lowconc_phase_ms=327s ≈ 整轮 855s 的 38%。两相时长分布极宽（serial 20 文件 1.2s→302s、lowconc 20 文件 0.6s→161s），字母序下短文件等 lane 到几百秒：test-coverage-check(59s) 等 +540s、known-load-sensitive(10s) +794s。模拟 list-scheduling：serial 相 conc=8 时 makespan 398s→302s（LPT −96s/−24%）。

**期望管理（非 AC）**：LPT 只能让 quay-init-* 家族（6×110–302s，若彼此互斥共享安装位置则相 floor≈Σ/conc≈282s）与短文件重叠，不能缩短自身——target 是拉回下界≈282s，不是快于下界。

## Plan

`lpt_reorder_files` + `suite-lpt-runner.mjs` 接到全部 6 条派发点（test.sh:1091/1093/1115/1133 full + 1543/1549 --buckets），复用现成机件零新机制：runner 已组合同 spec+measure-suite-reporter、从 execArgv 读并发。只改顺序不改成员 ⇒ pass/fail-neutral（与 M-bucket 同一不变式）。顺带补全 test.sh:924「LPT 只有一个定义点」承诺（现在 6 条路径里 5 条绕过）。

## Acceptance Criteria

- [ ] AC1（能取假，接线）：serial/lowconc 六条派发点全走 LPT（无裸 `node --test` 直传 files；grep test.sh 的 serial/lowconc 分支——含 --buckets 路径 1543/1549——无未排序裸调用）；（⛔ 仍有裸调用 ⇒ 假）。
- [ ] AC2（能取假，生产载体，硬规则 4 推论三）：实现落地后时间窗内，真实 full-suite 轮 serial/lowconc 相无 400s+ 尾部等待（N 只计落地后轮次）；（⛔ 用落地前历史轮冒充 ⇒ 假）。
- [ ] AC3（能取假，pass/fail-neutral）：成员不变只变顺序，serial/lowconc 的 pass/fail 结果与排序前一致。

## Definition of Done

serial/lowconc 六派发点接 LPT；AC1-AC3 全勾；全量 suite 绿；serial/lowconc 相 makespan 尾部等待拉回下界（不再字母序运气）；--buckets 路径 run 开头不再按字母序显示（scd 家族按 LPT 序）。

## Touches

- scripts/test.sh（serial/lowconc 六派发点接 lpt_reorder_files + suite-lpt-runner.mjs：1091/1093/1115/1133 full + 1543/1549 --buckets）
- tasks/gap-suite-lpt-serial-lowconc-phases-not-lpt-ordered.md（自身）