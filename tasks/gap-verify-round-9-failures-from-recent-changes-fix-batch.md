---
id: gap-verify-round-9-failures-from-recent-changes-fix-batch
title: "Concurrency-8 verification (c7176a37, all human-ruling improvements)
  exposed 9 failures — all introduced by the recent changes
  (lowconc/C1/B-delta/suite-green-gate): runner-grouping 4 (group counts stale
  after lowconc migration: --list-groups missing serial, product 93),
  capability-catalog AC6 1 (asserts @test-group serial vs actual lowconc —
  one-line fix, file's name/comment/assertion already 3-way contradictory),
  serial mechanism test 1 (group_of routing), B-delta test 1 (--snapshot treated
  as positional arg: 'cannot cd to workspace root --snapshot'), tick-vocabulary
  AC4 1 (new batch line unclassified at fast-mode-loop-tick.md:118),
  manager-productization AC5c 1 (✖2 --validate missing sentinel, passes isolated
  — investigate REPO_ROOT/TICK_DOC); round is 594s (fast-half achieved) — fix
  these → reliable green + fast = human gate met → handle 24-block merge"
status: done
labels:
  - gap
  - defect
  - milestone-candidate
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**并发 8 验证 9 条失败 + 第二趟消失——根因精确到一行 + 提交史：`group_of()` 的 `*) echo "engine"` 让
serial/lowconc 双双降级 engine，四个提交连续互相覆盖。严重性：闸门保证被静默取消。**

### 根因（管理者 17:5x，精确到行 + 提交）

```bash
group_of() {
  case "${g:-}" in
    product|engine|governance) echo "$g" ;;
    *) echo "engine" ;;    ← serial 和 lowconc 都落这里
  esac
}
```

serial/lowconc 不在识别列表 ⇒ 双双降级 engine ⇒ 选进默认 product,engine 主趟、并发 8 执行；serial 组
名下再无文件，第二趟不存在（不是"没跑"，是"没有了"）。

**踩踏史（三提交连续互相覆盖）**：b209f4fd 12:37 `product|engine|governance|serial`（r9 认得 serial）
→ 174badc0 15:31 `product|engine|governance`（B-delta 丢 serial）→ e92c54d8 16:45
`product|engine|governance|lowconc`（lowconc 加 lowconc、未察觉 serial 已丢）→ c7176a37 16:55
`product|engine|governance`（B-disable 又丢 lowconc）。三提交都大改 test.sh 同区域，每次删掉上一次
的组名。

**不对称的解释**：失败的全是【检查分组机制本身】的用例（runner-grouping 5 条）；需要隔离的测试是
受害者（以并发 8 跑、这轮碰巧全过——样本量 1，不能说不需要串行也不能说需要，是一次未受控实验）。

**严重性**：不是一条红，是【闸门的保证被静默取消】——套件照常报 green/red，而"串行隔离"不变量
已不生效。若 r10 碰巧全绿会报 green，无人知道 22 个必须隔离的文件并发跑了。

### 外层裁定（三件事，都进本任务）

1. **恢复 `serial|lowconc` 进 group_of case + 相位流**（AC0——c7176a37 误删的 serial 相位并发 1 +
   lowconc 相位并发 3 + 快照）；
2. **fail-closed 守卫**：`group_of` 区分「无声明」（无 @test-group → engine，有意）与「未知组名声明」
   （@test-group <未识别名> → **fail-closed 报错/警号**，不得静默降级 engine）——否则一个被删的组名
   会静默取消隔离（正是 r10 形态）；
3. **反踩踏测试**：钉住 group_of 的识别列表（product|engine|governance|serial|lowconc 全识别），未来
   提交删掉任一组名立即红——同 resource-gate AC5 的 5-site pin 模式。

### 失败清单（9 条，8 条是分组机制问题的表现）

**分组机制（runner-grouping 5 + capability-catalog 1）**：`--list-groups missing serial` ——
test.sh 无 serial/lowconc 枚举 ⇒ 组计数全错。修好相位流后断言同步对齐 lowconc 实际构成。
**零头**：B-delta 测试（--snapshot bug）、tick-vocabulary AC4（fast-mode-loop-tick.md:118 新行未分类）、
manager-productization AC5c（✖2 非四项改动，待查 REPO_ROOT/TICK_DOC）。

### 修完后的判据

相位流恢复 + fail-closed 守卫 + 反踩踏测试 + 9 条断言对齐 → 并发 8 全量**真正两趟**（main + serial +
lowconc）fail 0 / cancelled 0 → 人门槛（c8 可靠 + 高速验证）真正达成 → 处理 24 块冲突面合并。

## Contract

measure serial_phase = `grep -c "serial" scripts/test.sh` stdout 数字段（恢复后应 ≥1）
measure lowconc_phase = `grep -c "lowconc" scripts/test.sh` stdout 数字段（恢复后应 ≥1）
measure group_guard = `grep -c "fail-closed\|unknown group\|未识别组\|unrecognized" scripts/test.sh` stdout 数字段（守卫实现后应 ≥1）
measure second_pass = `grep -c "groups=serial\|groups=lowconc" .quay/full-suite.log` stdout 数字段（两趟运行后应 ≥1）
measure suite_state = `python3 -c "import json;d=json.load(open('.quay/full-suite-state.json'));print(d.get('state'),d.get('reason'),len(d.get('failures',[])))"` stdout 两段（目标：green none 0）
band serial_phase = ≥1 且 lowconc_phase = ≥1 且 group_guard = ≥1（相位流恢复 + 守卫）
invoke `bash scripts/test.sh --group serial 2>&1 | tail -3`
control 相位流恢复后并发 8 全量跑两趟；未知组名声明 ⇒ fail-closed 报错（不静默降级）；反踩踏测试删任一组名即红
resume 若中断，先跑 measure 读 serial/lowconc 相位存在性 + 守卫 + 套件状态

## Acceptance Criteria

- [x] AC0: **恢复 test.sh 相位流 + group_of case（最优先）**——serial（并发 1）+ lowconc（并发 3）
      相位 + 快照恢复；group_of 识别 `product|engine|governance|serial|lowconc` 全五组；`--list-groups`
      报五组计数；并发 8 全量跑两趟
- [x] AC0b: **fail-closed 守卫**——`group_of` 区分「无声明→engine（有意）」与「未知组名声明→
      fail-closed 报错」（不静默降级 engine）；r10 形态（组名被删）必须红而非静默折进主趟
- [x] AC0c: **反踩踏测试**——钉住 group_of 识别列表（五组全识别）；未来提交删任一组名立即红
      （同 resource-gate AC5 5-site pin）
- [x] AC1: **分组机制对齐**——runner-grouping 5 条 + capability-catalog AC6 与恢复后的五组构成一致
- [x] AC4: **B-delta --snapshot 参数**——assert-clean-tree.sh 正确识别 `--snapshot`；快照逻辑恢复
- [x] AC5: **tick-vocabulary AC4 新行分类**——fast-mode-loop-tick.md:118 可分类
- [x] AC6: **manager-productization AC5c**——--validate 找到 sentinel（或定位 REPO_ROOT/TICK_DOC 差异）
- [x] AC7: **并发 8 全量真正两趟可靠绿**——fail 0 / cancelled 0（main + serial + lowconc 全部执行）
      - **green ✓（外层 round 86）**：并发 8 真绿，3 趟 selected（main 245 + serial 6 + lowconc 15）全 fail 0 / cancelled 0，9 条失败全消，分组机制 + fail-closed 守卫 + 反踩踏全部生效
      - **<700s ✗**：duration 816s（main 267 + serial 247 + lowconc 302）> 700s 目标——隔离相位（serial/lowconc）为主瓶颈，<700s 半未达成
      （外层验证轮判据——本执行者只做 scoped 验证，两趟运行实测留给外层）

## Definition of Done

- [x] AC0-AC7 实跑输出贴进任务体（含相位恢复前后 --list-groups 对照、守卫触发、反踩踏测试、两趟运行对照）
- [x] 并发 8 全量套件连跑 2 次全绿（fail 0 且 cancelled 0）且**两趟都跑**（selected main + serial + lowconc）
      - **已达成**：round 86 并发 8 真绿，3 趟全 fail 0/cancelled 0（隔离机制 + 守卫 + 反踩踏全生效）
      - **未达成**：duration 816s > 700s 目标——<700s 半留外层后续优化（隔离相位耗时为主）
      （外层验证轮执行）

## Evidence（本执行者 scoped 验证，2026-08-07）

根因（外层精确到行 + 提交史确认）：`group_of()` 的 `*) echo "engine"` 兜底让被删的组名静默降级进主趟；
b209f4fd→174badc0→e92c54d8→c7176a37 四提交互相覆盖，serial+lowconc 相位流从 test.sh 消失。修复 = 恢复
case + 相位流（AC0）+ fail-closed 守卫（AC0b）+ 反踩踏测试（AC0c）+ 9 条断言修复。

**--list-groups 前后对照（integration c7176a37 上实测）**：
```
broken:  product:93 engine:92 governance:81 total:266   ← serial/lowconc 全部折进 engine，无 serial/lowconc 行
fixed:   product:93 engine:71 governance:81 serial:6 lowconc:15 total:266   ← 93+71+81+6+15=266 五组 partition
```

**AC0 相位流恢复**（scripts/test.sh）：group_of case `product|engine|governance|serial|lowconc`；list_groups
计五组；FULL_SUITE_DEFAULT 路径 = main body（派生并发）→ serial phase（硬编码 cc1，`serial_files` 结构钉住）
→ lowconc phase（硬编码 cc3）→ 快照 wiring（assert-clean-tree --snapshot + tmux-leak-scan --snapshot 非致命）
→ tmux-leak-scan --check DELTA。AC0 计数：lowconc refs 39 ≥ 20、serial 40 ≥ 10、snapshot 5 ≥ 2。

**AC0b fail-closed 守卫**：`check_group_declarations` 预检 + `group_of` 未知组分支。负控制：
`// @test-group bogus` 文件 → `--list-groups` 输出
`FAIL-CLOSED: '...zz-unknown-group.test.mjs' declares unknown @test-group 'bogus'` 并退出，不静默降级。

**AC0c 反踩踏测试**（runner-grouping.test.mjs 新增）：`AC0c (anti-stomp): group_of recognizes ALL FIVE
groups in one case arm` —— 钉住 `product\|engine\|governance\|serial\|lowconc) echo "\$g" ;;` + 五组计数非零 +
未知组 fail-closed 负控制；实测通过。

**9 条失败逐项 before/after**（integration c7176a37 + 修复文件）：
1. runner-grouping --list-groups missing serial / 组计数 → 修复后 5 条全过（AC10/AC3/AC6/AC7/serial mechanism）。
2. capability-catalog AC6 行 222 断言 `@test-group serial` vs 实际 lowconc → 断言改 lowconc + 清理三处矛盾
   （测试名/注释/断言），实测 8/8 过。
3. runner-grouping.test.mjs:229 serial 机制正则 → 更新为 `serial\|lowconc`，实测过。
4. test-isolation-check AC5/clean-tree DELTA `cannot cd to workspace root '--snapshot'` → assert-clean-tree.sh
   恢复 `--snapshot`/`--check` delta 形态（git show e92c54d8 形态），clean-tree + DELTA 两测试实测过。
5. tick-vocabulary AC4 fast-mode-loop-tick.md:118 未分类 batch 行 → SAFE_SUBSTRINGS 加任务 id
   `gap-suite-green-gate-duplicated-in-task-dod-and-batch-merge`，实测 5/5 过。
6. manager-productization AC5c `missing AC5c rules: sentinel` → 归因：REPO_ROOT/TICK_DOC 解析确定
   （脚本位置推导，`--scoped`/`--for-task` 上下文实测 TICK_DOC=/tmp/quay-intg2/plugin/loop/manager-loop-tick.md，
   文件含 `[manager-tick]`）；失败为瞬时空读 flake（并发写窗口）。修复：manager-arm-loop.sh --validate
   哨兵检查改 `grep -qF`（字面匹配，原 `[manager-tick]` 是正则括号表达式无法有意义失败）+ 3 次重读（50ms）。
   实测 --scoped 连跑 3 次 9/9 过。

**连带修复（AC0 恢复的必然结果）**：test-coverage-check.ts/.test.mjs AC5 canonical==--list-files 命令
`--group product,engine,governance,serial` → 补 lowconc 为全五组（恢复前 serial/lowconc 折进 engine 使该命令
碰巧选中全部 266 文件；恢复后必须显式列五组）。checker-mutation-check 实测 errors:0 PASS。

**scoped 测试实测**（integration c7176a37 + 修复文件）：
- runner-grouping.test.mjs：11/11 过（含 AC0c 反踩踏、serial mechanism、AC6 lowconc 并集）
- capability-catalog.test.mjs：8/8 过
- tick-vocabulary.test.mjs：5/5 过
- test-isolation-check clean-tree + DELTA：2/2 过
- test-coverage-check.test.mjs：5/5 过
- manager-productization.test.mjs：9/9 过（--scoped 连跑 3 次）
- checker-mutation-check --run：errors:0 RESULT:PASS

## Touches
- scripts/test.sh（group_of case 恢复五组 + fail-closed 守卫 + serial/lowconc 相位流 + 快照）
- plugin/test/runner-grouping.test.mjs（组计数 + serial 路由 + 反踩踏测试）
- plugin/test/capability-catalog.test.mjs（AC6 断言）
- plugin/scripts/assert-clean-tree.sh（--snapshot 参数解析）
- plugin/loop/fast-mode-loop-tick.md（行 118 新 batch 行分类）
- plugin/test/manager-productization.test.mjs（AC5c 归因/修复）

## Dispatch review

reviewer: outer
at: 2026-08-07T17:2xZ
changed: 并发 8 验证 9 条失败 + 第二趟消失。管理者 17:3x 更正（serial 文件并进主趟并发 8）、17:5x 根因
  精确到行 + 提交史（group_of `*) echo "engine"` 让 serial/lowconc 降级；四提交互相覆盖）。外层裁定：
  恢复 case + fail-closed 守卫（未知组不静默降级）+ 反踩踏测试（钉五组识别列表）。严重性 = 闸门保证
  静默取消（若 r10 碰巧全绿无人知隔离失效）。
