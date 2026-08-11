---
id: gap-red-round-loses-overhead-phase-decomposition
title: 红轮结构上拿不到相位分解 —— __OVERHEAD__ 只在成功收尾时发（test.sh _oh_emit 在 kill-on-red
  前未全部落盘 + stderr 不进 runner 日志）；红轮恰恰是【需要测量】的场合，绕法 __PERFILE__ 重建（lane8 对照已实证可行）
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

**`test.sh` 的 `__OVERHEAD__ <segment>_ms=N` 相位分解只在完整收尾时落到 runner 日志：kill-on-red 截断（红轮主相没跑完，`_oh_emit main_phase` 未发）＋ `_oh_emit` 写 stderr（`>&2`，runner 只 tee stdout）⇒ 红轮日志里 `__OVERHEAD__` 恒 0。而【需要测量相位成本的场合恰恰是红轮】（lane4-vs-lane8 对照、截断轮 per_test_ms 归因）。**

### 实证（manager 2026-08-11 03:4x，lane4 vs lane8 对照收尾）

- **r268（lane8, red）**：`grep -c __OVERHEAD__` = **0**，`grep -c __PERFILE__` = **324** —— 相位分解丢失，per-file 还在。
- **r266（lane4, green）**：`__OVERHEAD__` = **9**（lock_overhead / resource_gate / build_dist / run_static_checks / gap_ms_pre_to_serial / serial_phase / gap_ms_serial_to_lowconc / lowconc_phase / main_phase 九个段）—— 相位分解在场。
- **机制定位**：`scripts/test.sh:1067-1076` —— `if [ "$oh_full" -eq 1 ]` 下 `_oh_emit` 按相位边界发九个段；`_oh_emit`（:909-915）写 **stderr**（`>&2`），而 full-suite-runner 的日志 tee 只接 stdout ⇒ 即便没被截断，相位行也可能不进 runner 归档日志。
- **后果**：`verification-round.jsonl` 的红轮记录没有 `*_phase_ms`；`per_test_ms`（=durationMs/tests）把截断红轮与完整绿轮混在一起 ——「700s 退化」误判的又一来源（与 gap-verification-round-missing-phase-ms 同族，但那是「记录不存」，这是「来源不产」）。
- **绕法（已实证可行）**：用 `__PERFILE__`（324 条）按文件分组重建 main 相 —— lane4=287文件 sum2543s÷4=636s、lane8=286文件 sum4543s÷8=568s，即并发翻倍只换 11% 墙钟（每文件耗时同时涨 1.79×，4 核超额订阅自我抵消）。

### 选定机制方向（实现归 inner，判定归 outer）

**让红轮也能拿到相位分解**——两条一起收：
1. **`_oh_emit` 的 stderr 也进 runner 归档**：runner 日志 tee 从 stdout-only 改为 `2>&1`（或 `_oh_emit` 改 stdout）。保证截断前的已发段（serial/lowconc 通常已跑完）落盘。
2. **kill-on-red 前兜底发一次 partial 相位**：test.sh 在截断路径（trap/abort）也调 `_oh_emit` 发已完成的段，标 `partial=1`——红轮至少拿到「已跑完相位」的分解，未跑的主相标缺省。

**验证锚**：修后 (a) 红轮日志 `__OVERHEAD__` 非 0（至少 serial/lowconc 段在场）；(b) 绿轮行为不回归（九段仍在）；(c) `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1: **复现固化**——任务体记录 r268 red `__OVERHEAD__`=0 / `__PERFILE__`=324、r266 green `__OVERHEAD__`=9、`_oh_emit` 写 stderr（:909-915）+ `oh_full` 门（:1067-1076）（本任务 Proposal 已含）
- [ ] AC2: **stderr 进归档**——runner 日志捕获 `_oh_emit` 的 stderr 输出；红轮日志 `__OVERHEAD__` 非 0
- [ ] AC3: **partial 兜底**——kill-on-red 前发已完成的相位段（标 partial），未跑相位标缺省；红轮可区分「已跑完的 serial/lowconc」与「被截断的 main」
- [ ] AC4: **既有不回归**——绿轮九段仍在；`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC4 全部勾上
- [ ] 修后实跑：构造一个红轮（如故意超时），其日志 `__OVERHEAD__` 非 0 且含已跑完段（贴输出）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- scripts/test.sh（`_oh_emit` 输出面 + kill-on-red 前 partial 兜底）
- plugin/scripts/full-suite-runner.ts（日志 tee `2>&1`；若有 appendVerificationRound 相位解析则补红轮路径）
- plugin/test/full-suite-runner.test.mjs（新增红轮相位段用例）
- tasks/gap-red-round-loses-overhead-phase-decomposition.md（自身：勾 AC + 贴证据）

## Contract

measure   red_round_overhead_present = `grep -c '__OVERHEAD__' <红轮归档日志>` 的 stdout 数字
band      red_round_overhead_present >= 1（红轮至少 serial/lowconc 相位段在场）
invariant green_round_nine_segments = 1（绿轮九段不回归）
invariant red_round_partial_marked = 1（截断相位标 partial / 缺省，可区分）
invoke    `grep -cE '__OVERHEAD__|__PERFILE__' <红轮日志>`（贴两类计数，证明红轮有相位分解）
control   红轮有相位；绿轮不回归；截断相位可区分
resume    stderr 进归档 / partial 兜底 / 测试分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-11
changed: manager lane4-vs-lane8 对照收尾——r268 red `__OVERHEAD__`=0 / `__PERFILE__`=324，r266 green `__OVERHEAD__`=9；`_oh_emit` 写 stderr 且 `oh_full` 门在 kill-on-red 前未跑完。红轮结构上拿不到相位分解，而需要测量的恰是红轮；绕法 `__PERFILE__` 重建已实证。立案：stderr 进归档 + partial 兜底。实现归 inner，判定归 outer
