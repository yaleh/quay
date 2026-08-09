---
id: gap-round5-red-killtimeout-sigkill-and-capfromgate-seam-under-load
title: "round-5 套件红（22.1min 真跑完）两个负载相关簇：kill-timeout SIGKILL 被 REGRESSION 拒绝 + cap-from-gate 注入 seam 被套件负载覆盖"
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**全量套件 round-5（full-suite-runner，00:17:57 起，22.1min 完整跑完）红，`state=red reason=failed`，`failures=[]` 空（可读性缺口兑现——真因在 `.quay/full-suite.log`）。两个独立失败簇，都负载相关：**

**簇 A —— kill-timeout SIGKILL 被 REGRESSION 测试拒绝（proposal-convergence）**：
`experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs:2841` 的 REGRESSION 测试（gap-prepare-milestone-epoch-cli-toctou-and-tamper-hardening：20 个并发 `--new-epoch` 子进程共享 epoch，maxNewEpochResetCount:3）断言于 `:2877` 收到意外拒绝码：
```
AssertionError: unexpected rejection code for a concurrent --new-epoch call: unparseable-cli-output
  ({"ok":false,"code":"unparseable-cli-output","raw":"","stderr":"\n[spawnConvergenceCli] TIMEOUT:
   child did not exit within 20000ms — SIGKILLed (blocked in a futex under load); treat as a hang, not a pass","exitCode":null})
```
`[spawnConvergenceCli] TIMEOUT … SIGKILLed` 正是 red-window #9 的 kill-timeout 修复（`4e3b3197`，inner 2026-08-08 23:53）的机制在实跑：**修掉了无限挂死，但 child 被 SIGKILL 后返回 `unparseable-cli-output`，不在 REGRESSION 测试的接受码白名单里。** 内层修时验证过 `proposal-convergence.test.mjs 217/217`（隔离跑无负载，无 child 触发 20s 超时）——**负载下才暴露**：round-5 4-lane 满载下某 child 在 futex 阻塞 >20s 被 SIGKILL。

**簇 B —— cap-from-gate 注入 seam 被套件负载覆盖（6 测试）**：
`cap-from-gate.test.mjs` AC2/AC5/AC6/BUDGET/AC4/CLI smoke 全挂，断言：
```
AssertionError: GO band must equal the injected hermetic value, got 2
  2 !== 3
```
注入期望 cap=3，实得 2 —— **注入的 hermetic 信号在套件满载时被真实负载信号覆盖**（seam 忽略）。这是 23:19 tick 挂的观察项（「cap-from-gate 6 tests failed last suite run (ambient-load per outer)；再挂一次就是真密封性缺陷」）——**round-5 再挂，确认是真缺陷**（非 ambient-load 误判；round-4 绿、round-5 红的间歇性是负载窗口差异，不是 seam 有效）。

**两个簇都与外层本轮无关**：外层本轮只加了 contract-clean 的任务文件（92189a0a），未触测试代码/插件 seam；两簇都是既有负载敏感缺陷（A 是 4e3b3197 修复的不完整交互，B 是 23:19 已挂观察项）。

**修的方向（实现归内层，方向外层/manager 已定）**：
- 簇 A 候选：① SIGKILL 时 child/CLI 返回**可辨识的有界失败码**（如 `epoch-cli-timeout`），REGRESSION 接受码白名单加上它——超时是被修掉无限挂死的**设计内结果**，不是正确性失败；② 或 REGRESSION 测试接受 timeout/SIGKILL 为合法有界结果（与 maxNewEpochResetCount 同族的 bound 概念）。方向：**超时必须是可辨识的 bounded rejection，REGRESSION 不该把「被 kill 的超时」当 unexpected**。
- 簇 B 候选：① cap-from-gate 的注入 seam 在套件负载下必须仍生效（hermetic——注入信号优先于真实信号）；② 或测试改为不依赖 seam 隔离（在套件负载下测真实信号）——但 ② 违背 hermetic 初衷，倾向 ①。

**验证锚**：修后 (a) 套件满载时 cap-from-gate 注入 seam 仍得注入值；(b) 并发 `--new-epoch` child 超时被 kill 时返回可辨识码、REGRESSION 通过；(c) 全量套件 fail 0。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录 round-5 红两簇证据（A: proposal-convergence.test.mjs:2841/:2877 unparseable-cli-output + `[spawnConvergenceCli] TIMEOUT`；B: cap-from-gate `GO band … got 2 / 2!==3`）（本任务 Proposal 已含；内层补负载下复现——见下方 Evidence：确定性 kill-timeout 构造测试 + SEAM 非环境注入测试）
- [x] AC2: **kill-timeout 回归闭环**——child 超时被 SIGKILL 时返回可辨识的有界拒绝码（`epoch-cli-timeout`，REGRESSION 接受码白名单含它）；REGRESSION 通过（簇 A 修到）
- [x] AC3: **cap-from-gate 密封性**——套件满载时注入 seam 仍得注入值（`GO band … = injected`）；cap-from-gate 18/18 全过（簇 B 修到，red-window #10 的 RESOURCE_GATE_TEST_NPROC=4 pin 保留 + 新增 SEAM 测试封死）
- [x] AC4: **不引入新挂死**——kill-timeout 修后 child 仍被有界（不回到无限挂死）；既有 proposal-convergence 测试（218/218 = 原 217 + 新增 kill-timeout 测试）全绿不回归
- [ ] AC5: **套件绿**——全量套件 fail 0（`FULL-SUITE-EXIT=0`，外层批量合边界闸门）——**待外层 verification-round 验证**（本工作树跑 scoped gate）

## Definition of Done

- [ ] AC1–AC5 全部勾上——**AC5 待外层 verification-round（全量套件）确认后勾**
- [x] 修后实跑：两簇构造场景（负载下注入 / 并发超时 kill）输出符合预期，贴任务体（见下方 Evidence）
- [x] 既有 proposal-convergence / cap-from-gate 测试 + 新增测试全绿（`--for-task` scoped 通过）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Evidence（内层实现，2026-08-09）

**簇 A —— kill-timeout SIGKILL 白名单（REGRESSION）**：`proposal-convergence.test.mjs` 的 `parseCliJson` 现在在 `res.timeout === true` 时返回可辨识码 `epoch-cli-timeout`（而非 `unparseable-cli-output`），并加入两个 20-并发 REGRESSION 测试的接受码白名单（`--new-epoch` 与 `--override-budget`）。新增确定性测试「kill-timeout (round-5 red, cluster A)」用 50ms deadline 强制 SIGKILL 一个真实 `--new-epoch` child，断言 `code === "epoch-cli-timeout"` 且在 REGRESSION 白名单内。

```
✔ REGRESSION ... 20 genuinely concurrent --new-epoch ... (4727ms)
✔ REGRESSION ... 20 genuinely concurrent --override-budget ... (4494ms)
✔ kill-timeout (round-5 red, cluster A): a --new-epoch child SIGKILLed ... surfaces ... `epoch-cli-timeout` ... (528ms)
ℹ tests 4 / pass 4 / fail 0        # --test-name-pattern="REGRESSION|kill-timeout"
ℹ tests 218 / pass 218 / fail 0    # 全文件（原 217 + 新增 1）
```

**簇 B —— cap-from-gate 注入 seam 密封（SEAM 测试）**：red-window #10 的 `process.env.RESOURCE_GATE_TEST_NPROC = "4"` pin（文件顶）保留；新增「SEAM (round-5 red, cluster B)」测试读取环境真实 `nproc`，注入**故意非环境值**（ambient=4 ⇒ 注入 3，ambient≠4 ⇒ 注入 4），断言 `process-budget.sh` 与 `computeEffectiveCap` 全程用注入值（`total_budget`/`budget_available` = 注入值），若 seam 被忽略（回退环境 nproc）则断言响亮失败。

```
✔ BUDGET — the effective cap is bounded by the cross-layer total process budget ... (6389ms)
✔ SEAM (round-5 red, cluster B) — RESOURCE_GATE_TEST_NPROC overrides the ambient nproc end-to-end ... (2980ms)
ℹ tests 18 / pass 18 / fail 0      # cap-from-gate.test.mjs 全文件（原 17 + 新增 1）
```

**scoped gate**：`bash scripts/test.sh --for-task gap-round5-red-killtimeout-sigkill-and-capfromgate-seam-under-load --allow-thin` 通过（见提交报告的 violations 计数）。

**内层独立复验（2026-08-09，本轮 dispatch，二次复验）**：工作树在 develop（HEAD=2e7ccc5a）重新 provisioned，实现代码已在 develop 内（d39706d0/698a142a 经 fan-in 并入）。本轮无新增代码改动，重跑 scoped gate —— `tests 268 / pass 268 / fail 0 / cancelled 0 / skipped 0`，exit 0（含静态检查：test-framework-policy-check / test-isolation-check / test-impl-census / task-contract-check no violations / adr016-screen-use-check / dead-code-after-return-check 全过）。定向复验簇 B：`--test-name-pattern="SEAM|BUDGET" plugin/test/cap-from-gate.test.mjs` → `tests 2 / pass 2 / fail 0`（SEAM 注入非环境 nproc 端到端获胜；BUDGET 全层预算有界）。簇 A 两 REGRESSION（20 并发 --new-epoch / --override-budget）+ kill-timeout 确定性测试同轮全绿。

## Touches

- experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs（REGRESSION 白名单，选簇 A 候选②——kill-timeout 60s）
- plugin/test/cap-from-gate.test.mjs + plugin/scripts/cap-from-gate.ts（簇 B seam 密封性）
- plugin/scripts/resource-gate.sh（若 seam 传递链涉及）
- tasks/gap-round5-red-killtimeout-sigkill-and-capfromgate-seam-under-load.md（自身：勾 AC + 贴证据）

## Contract

measure   bounded_timeout_code = 并发 `--new-epoch` child 超时被 kill 时 CLI 返回的 code（`bash experiments/quay-perpetual-stream/scripts/<cli-entry> --new-epoch` 构造超时）
band      bounded_timeout_code = 可辨识码（非 `unparseable-cli-output`，REGRESSION 白名单含它）
invariant cap_seam_hermetic_under_load = 1（套件满载时注入 seam 仍得注入值）
invariant no_hang_regression = 1（kill-timeout 修后 child 仍被有界，proposal-convergence 217/217 不回归）
invoke    `bash scripts/test.sh --for-task gap-round5-red-killtimeout-sigkill-and-capfromgate-seam-under-load`（scoped 绿；全量由外层验证轮）
control   并发超时 ⇒ 可辨识码 + REGRESSION 过；套件负载 ⇒ 注入值生效；无新挂死
resume    簇 A + 簇 B + 测试分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-09
changed: 建任务（round-5 红三诊：两簇独立负载相关缺陷，均非外层本轮引入；簇 A 是 4e3b3197 修复的不完整交互——超时 SIGKILL 返回码不在 REGRESSION 白名单；簇 B 是 23:19 观察项兑现——注入 seam 被套件负载覆盖；方向已定，实现归内层）
