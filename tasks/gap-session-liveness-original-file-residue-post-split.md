---
id: gap-session-liveness-original-file-residue-post-split
title: session-liveness 拆分后原文件残留：session-liveness.test.mjs（governance/main）100%
  重复 3 新文件（50 测试原独有 0）却仍 tracked 跑 207.5s + OVERDUE 并发 flake——拆分 DoD
  缺口（复制没删原），删原文件修拆分残留
status: ready
labels: []
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**session-liveness 拆分后原文件残留：`session-liveness.test.mjs`（@test-group governance，main 组）100% 重复 3 个新拆分文件的内容（50 测试标题全在 events/heartbeat/signals 里，原独有 0），却仍 tracked、仍在 main 组跑 207.5s（尾部封顶时长复活）且其 OVERDUE 测试在 cc8 并发下偶发 flake——这是 `gap-session-liveness-tail-capped-split`（已 done）的实现缺陷：拆分复制了新文件但没删原文件。**

### 实测（02:08 轮全量，855s red，只剩 1 文件）

- 三趟：main fail 1 / serial fail 0 / lowconc fail 0（verify 加固后 lowconc 3 个 --loop 假阳性已解决）；
- 唯一失败：`plugin/test/session-liveness.test.mjs`（__PERFILE__ 207.5s passed=false）；
- 失败测试：`OVERDUE must fire once the transcript freezes`（AC3 direction 2），actual false/expected true——transcript 冻结后 OVERDUE 未触发，cc8 并发时序 flake；
- **根因**：拆分 commit 354be03e 加了 events(19)/heartbeat(14)/signals(24) 3 文件 + helpers，**但没删原文件**。原文件 50 测试与 3 新文件**完全重复**（`comm -12` 重复 50 / 原独有 0 / 新独有 7）——它应被删除，却留在 main 组（governance）跑 207.5s，恢复拆分要消除的尾部封顶形态，且其测试在 cc8 下偶发 flake。
- 拆分任务 AC1 声称"57 测试/246 断言保留"——那是复制到新文件；**删原文件步骤缺失** = DoD 缺口。

### 处置方向

1. **删原 `session-liveness.test.mjs`**（100% 重复，无独有内容——`comm` 证明原独有 0）；
2. **确认新文件承载全部测试**（57 = 50 原 + 7 新，无丢失）；
3. **负控制**：删除后全量三趟 fail 0 / cancelled 0；session-liveness 不再在 main 组出现（只在 lowconc 3 文件）。

**不是放宽断言**（管理者禁令 a：这 6 条无回滚事件，摘掉真降覆盖）——删重复原文件是修拆分残留，断言本身保留在 3 个新文件里。

## Contract

measure orig_deleted = `ls plugin/test/session-liveness.test.mjs 2>/dev/null | wc -l` stdout 数字段（修复后原文件删除，= 0）
measure new_files = `ls plugin/test/session-liveness-{events,heartbeat,signals}.test.mjs 2>/dev/null | wc -l` stdout 数字段（= 3，新文件保留）
measure suite_green = `python3 -c "import json; d=json.load(open('.quay/full-suite-state.json')); print(1 if d['state']=='green' else 0)"` stdout 数字段（删除后全量绿，= 1）
band orig_deleted = 0 且 new_files = 3 且 suite_green = 1
invoke `bash scripts/test.sh --for-task gap-session-liveness-original-file-residue-post-split 2>&1 | tail -3`
control 删除后 session-liveness 测试全在 3 新文件（57 测试在场）；全量三趟 fail 0 / cancelled 0；main 组不再有 session-liveness.test.mjs
resume 若中断，先跑 measure 读原文件存在 + 新文件数 + 套件状态

## Acceptance Criteria

- [ ] AC1: **原文件删除**——session-liveness.test.mjs 移除（100% 重复，无独有内容）
- [ ] AC2: **新文件承载**——events/heartbeat/signals 3 文件含全部测试（57），隔离全过
- [ ] AC3: **全栈并发 8 绿**——全量三趟 fail 0 / cancelled 0（session-liveness OVERDUE flake 消失）
- [ ] AC4: 与 gap-session-liveness-tail-capped-split（拆分 DoD 缺口：没删原文件）、
      gap-post-merge-verification-failure-batch（同批次）、gap-verify-referenced-landed（同轮）交叉标注

## Definition of Done

- [ ] AC1-AC3 实跑输出贴任务体（删除前后、新文件测试数对照、全量三趟绿）
- [ ] 并发 8 全量套件连跑 2 次全绿（fail 0 且 cancelled 0）

## Touches
- plugin/test/session-liveness.test.mjs（删除——100% 重复残留）
- tasks/gap-session-liveness-tail-capped-split.md（AC4 交叉标注：DoD 缺口）
- tasks/gap-post-merge-verification-failure-batch.md（AC4 交叉标注）

## Dispatch review

reviewer: outer
at: 2026-08-08T02:3xZ
changed: 02:08 轮全量只剩 1 失败（session-liveness.test.mjs 207.5s passed=false）——verify 加固已解决
  lowconc 3 假阳性，serial fail 0。归因：拆分 commit 354be03e 加 3 新文件但没删原文件；原 50 测试
  100% 重复（comm 原独有 0），留 main 组（governance）跑 207.5s + OVERDUE 并发 flake。删原文件 =
  修拆分残留，非放宽断言（管理者禁令 a 适用：断言在 3 新文件保留）。
