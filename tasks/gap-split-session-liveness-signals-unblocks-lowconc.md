---
id: gap-split-session-liveness-signals-unblocks-lowconc
title: "lowconc 相被单文件 session-liveness-signals.test.mjs（216s > sum/3=152s）钉死墙钟（__GROUP__ capped=1）⇒ 拆成 3 个文件，lowconc 272→约 152s（-120s，算术确定，无需先测）"
status: todo
labels:
  - gap
  - defect
  - performance
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**lowconc 相（r266 conc=3 files=14 sum=440s，墙钟 272s）被单文件 `plugin/test/session-liveness-signals.test.mjs` 钉死：它 216s > lowconc 的 sum/3=152s（并行地板），`__GROUP__` 那行 `capped=1` 就是它——一个文件把整相墙钟卡在 216s。拆成 3 个文件后 lowconc 272→约 152s。这条不需要先测，floor 是算出来的（算术确定）。**

### 实证（manager 2026-08-11 03:4x）

- **r266 lowconc 相**：`__GROUP__ concurrency=3 files=14 sum_ms=440095` → floor（sum/3）= 209s；但 `capped=1` 说明有单文件超过 floor 把墙钟钉死。
- **肇事文件**：`plugin/test/session-liveness-signals.test.mjs` 单测 216s。
- **可省量**：lowconc 墙钟 272s → 约 152s（-120s）。拆 3 个后每文件 ~72s < 152s floor，相墙钟回到并行地板。
- **为什么不需要先测**：floor = sum/concurrency 是算术确定的——单文件 216s > 152s floor 必然钉死墙钟，拆到每个 < floor 必然释放。这是「算术确定」与杠杆 1「先测再改」的本质区别。

### 选定机制方向（实现归 inner，判定归 outer）

**把 `session-liveness-signals.test.mjs` 拆成 3 个测试文件**（按测试关注面分组，如信号种类 / 阈值行为 / 集成断言），每个文件墙钟 < 152s。纯拆分，不改测试语义、不降覆盖。

**验证锚**：修后 (a) 3 个拆分文件各自墙钟 < 152s；(b) lowconc 相 `__GROUP__` 的 `capped=0` 且墙钟 ≈ sum/3；(c) 测试语义/覆盖不降（原断言全保留）；(d) `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1: **复现固化**——任务体记录 r266 lowconc `__GROUP__ concurrency=3 files=14 sum_ms=440095 capped=1` + session-liveness-signals 216s > floor 152s（本任务 Proposal 已含）
- [ ] AC2: **拆分**——session-liveness-signals.test.mjs 拆成 3 个文件，各自墙钟 < 152s（lowconc 相 floor）
- [ ] AC3: **语义不降**——原断言全保留（信号种类/阈值/集成覆盖不缩水）
- [ ] AC4: **lowconc 墙钟释放**——lowconc 相 `capped=0` 且墙钟 ≈ 272→152s（-120s）
- [ ] AC5: **既有不回归**——`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：lowconc 相 `__GROUP__` 行贴出（capped 0、sum/3、墙钟）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/test/session-liveness-signals.test.mjs（拆成 3 个文件）
- plugin/test/ 下 2 个新拆分文件（命名 session-liveness-signals-*.test.mjs）
- plugin/scripts/known-load-sensitive.ts（若拆分涉及 lowconc 标注）
- tasks/gap-split-session-liveness-signals-unblocks-lowconc.md（自身：勾 AC + 贴证据）

## Contract

measure   lowconc_capped_after = `grep -oE '__GROUP__ concurrency=3 files=[0-9]+ sum_ms=[0-9.]+ floor_ms=[0-9.]+ capped=[0-9]+' <lowconc相日志> | tail -1` 的 stdout 中 capped 数字
band      lowconc_capped_after = 0（拆后无单文件钉死墙钟）
invariant split_files_under_floor = 1（3 个拆分文件各 < 152s）
invariant assertions_preserved = 1（原断言全保留，覆盖不缩水）
invoke    `grep -oE '__GROUP__ concurrency=3 files=[0-9]+ sum_ms=[0-9.]+ floor_ms=[0-9.]+ capped=[0-9]+' <lowconc相日志>`（贴 capped 从 1 到 0）
control   拆后 capped=0；墙钟回 floor；语义不降；既有不回归
resume    拆分 / 验证 capped / scoped 门分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-11
changed: 人指示应用三条杠杆；manager 03:4x。杠杆 2（-120s，算术确定）= 拆 session-liveness-signals.test.mjs（216s > lowconc floor 152s，__GROUP__ capped=1 即它）。无需先测——floor=sum/conc 算术确定。实现归 inner，判定归 outer
