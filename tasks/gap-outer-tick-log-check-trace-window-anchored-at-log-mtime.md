---
id: gap-outer-tick-log-check-trace-window-anchored-at-log-mtime
title: outer-tick-log-check 的 git-trace 窗口锚定在 tick-log 自身 mtime
  且前向查找——动作行自己的提交(act-then-log 顺序下在 log 写入之前)永远被排除,通过与否取决于「log
  写入后是否有无关提交落地」的运气,是 phantom-red 家族
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**`plugin/scripts/outer-tick-log-check.sh` 的 L2 git-trace 检查窗口方向错了——它查的是「tick-log 写入时刻之后」的提交，而动作行自己的证据提交（exec-core B 系列 act-then-log：先 B1 收尾提交，再 B13 追加 tick-log）严格在 log 写入之前。结果：合法执行的动作行在「log 写入后无其它提交」的窗口内必然假 FAIL，通过与否靠运气。**

### 实证（outer 2026-08-09 17:17 直接触发）

- 17:13 提交 `49c0be86`（③ done-flip 4 条，动作行的证据）。
- 17:16 追加 tick-log 行（`### 17:15Z`，动作分类 `unblock`）。
- 17:17 手跑 `outer-tick-log-check.sh --root $PWD` ⇒ **FAIL `action-claimed-but-no-git-trace`**。
- 根因：checker 用 `LAST_EPOCH="$(date -r "$LOG" +%s)"`（tick-log 文件 mtime）当窗口起点，`git log --since="@$LAST_EPOCH"` 只数 log 写入**之后**的提交。动作行的提交（17:13）在窗口（17:16→now）之外 ⇒ 计数 0 ⇒ 假 FAIL。
- 同轮 suite（b69266c7，17:24 起跑）的 static-check 里 checker **PASS**——因为 17:16 之后恰好有 inner fan-in 提交（27f44be5/aa3cdf1b/30029245 等 17:2x）落在窗口内。**同一行，手跑 FAIL、套件内 PASS，区别只是「log 写入后有没有无关提交」——纯运气，不是判据。**
- 对照：16:37 行在 16:42 套件里 PASS，同样是因为 16:37→16:42 之间有提交（b133cba6 等）。

**为什么重要**：这是 phantom-red 家族（`gap-suite-*` 幻影红同形）——checker 的判词不可复现，同一条合法行有时红有时绿。它接线在 `scripts/test.sh` 的 `run_static_checks`（`@static-tier full`，每次全量必跑），若「动作行 + log 写入后无提交」的窗口被撞上，整轮全量套件被假红，红窗分诊成本重复发生。当前靠 inner 高频 fan-in 掩盖，但这是运气象非设计。

### 正确语义（按 checker 自身头注「该 tick 时刻」）

头注 L2 意图：「判词写 escalate/correct/unblock 但该轮实际 git 无任何提交痕迹（git log --since **该 tick 时刻**为空）」。窗口应是**该 tick 自己的窗口**：`[上一行 tick 写入时刻, 本行 tick 写入时刻]`（或 `[上一行写入, now]`），而不是 `[本行写入, now]`。实现时窗口起点应取**上一行的 mtime 或上一 tick 时刻**（log 是 append-only，读倒数第二个 `###` 段的写入时刻），终点 `now`——这样动作行的证据提交必然落在窗口内。

### 候选修法（实现归内层，接法留执行时）

1. **窗口起点取上一 tick 写入时刻**：解析 log 倒数第二个 `### HH:MMZ` 段的文件偏移对应的写入时刻（或记录每行写入时的 epoch 到行内），`git log --since=@<prev> --until=now`。
2. **行内带写入 epoch**：B13 追加行时把 `date +%s` 写进行内（`epoch=<ts>`），checker 读该行的 epoch 作窗口起点——免去 mtime 猜测。
3. **fallback 保守**：窗口起点取 `min(本行写入时刻 - 1 个 tick 周期, 上一行写入)`，保证动作提交被包含；无法解析时跳过 L2 trace（不假红）。

**验证锚**：修后 (a) 构造「动作行 + 证据提交在 log 写入前 + 无后续提交」⇒ PASS（不再假红）；(b) 构造「欺骗输入 escalate + 真无提交」⇒ 仍 FAIL（不削弱原判据）；(c) 16:37/17:15 既有行在任意时刻跑均 PASS（可复现）。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录 17:15 行手跑 FAIL / 套件内 PASS 的运气差实证 + 根因（窗口锚定 log mtime 前向查找）（本任务 Proposal 已含；内层补：构造「证据提交在 log 前 + 无后续提交」fixture ⇒ 假 FAIL）
- [x] AC2: **窗口修正**——L2 trace 窗口起点改为该 tick 自己的起点（上一行写入 / 行内 epoch / 保守回退），动作行的证据提交必然落窗
- [x] AC3: **不削弱原判据**——欺骗输入（escalate/correct/unblock + 真无提交）仍 FAIL；no-action + 五条全假仍 PASS
- [x] AC4: **可复现**——同一动作行在任意时刻跑 checker 结果一致（不再靠 log 写入后有无无关提交）
- [x] AC5: **既有不回归**——`--for-task` scoped 门绿（outer-tick-log-check 的既有 11/11 测试全过）

## Definition of Done

- [x] AC1–AC5 全部勾上
- [x] 修后实跑：构造「证据在 log 前 + 无后续提交」⇒ PASS（贴任务体）；欺骗输入 ⇒ 仍 FAIL
- [x] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/outer-tick-log-check.sh（L2 trace 窗口起点：`--since=@<本行写入>` 改为该 tick 自己的窗口）
- plugin/test/outer-tick-log-check.test.mjs（新增 fixture：证据提交在 log 前 + 无后续提交 ⇒ PASS；欺骗输入仍红）
- tasks/gap-outer-tick-log-check-trace-window-anchored-at-log-mtime.md（自身：勾 AC + 贴证据）

## Contract

measure   trace_false_fail_after_fix = `bash plugin/scripts/outer-tick-log-check.sh --root <repo> --log <fixture>` 对「证据在 log 前 + 无后续提交」fixture 的 exit code
band      trace_false_fail_after_fix = 0（不再假 FAIL）
invariant deception_still_caught = 1（escalate + 真无提交 ⇒ 仍红）
invariant deterministic_per_row = 1（同一行任意时刻跑结果一致）
invoke    `grep -n 'LAST_EPOCH\|--since=' plugin/scripts/outer-tick-log-check.sh`（窗口起点代码位置）
control   证据在 log 前 + 无后续提交 ⇒ PASS；欺骗输入 ⇒ 红；no-action 全假 ⇒ PASS
resume    窗口起点 + fixture 分两步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-09
changed: 建任务——17:17 手跑 checker 对 17:15 合法 unblock 行假 FAIL（action-claimed-but-no-git-trace），套件内同行 PASS，根因是 git-trace 窗口锚定 tick-log mtime 前向查找，act-then-log 下动作提交必然在窗外。phantom-red 家族，接线 run_static_checks 全量必跑。实现归内层

## Evidence（内层实现 2026-08-09）

**根因确认**：`plugin/scripts/outer-tick-log-check.sh` 原 L2 trace 用 `LAST_EPOCH="$(date -r "$LOG" +%s)"`（tick-log mtime）作 `git log --since="@$LAST_EPOCH"` 的窗口起点。act-then-log（先 B1 收尾提交、再 B13 追加 log）下，动作行的证据提交严格在 log 写入之前 ⇒ 被 `--since` 排除 ⇒ 计数 0 ⇒ 假 FAIL「action-claimed-but-no-git-trace」。通过与否只取决于「log 写入后是否有无关提交落地」——运气判据，phantom-red。

**窗口修正（AC2）**：窗口改为该 tick 自己的窗口 `[该 tick 起点, log 写入时刻]`（`git log --since=@<TRACE_START_EPOCH> --until=@<LAST_EPOCH>`）。`TRACE_START_EPOCH` 按优先级解析：
1. 上一 tick 段行内 `epoch=<ts>`（B13 前向兼容：每行记该 tick 写入时刻）；
2. 本 tick 段行内 `epoch=<ts>`（契约 = 该 tick 起点时刻）；
3. 上一 tick 段 `### HH:MM` 表头 → 当日 epoch − 120s 缓冲（分钟粒度 + 实际写入可能早于表头；校验不晚于 log mtime，防跨日/掩码时间）；
4. 均不可解析 ⇒ `TRACE_START_EPOCH` 为空 ⇒ 跳过 L2 trace 判据（不假红，spec 明令）。

动作行的证据提交必然落在 `(上一行写入, log 写入)` 内 ⇒ 落窗 ⇒ PASS；`--until=@<log mtime>` 把 log 写入后的无关提交排除在外 ⇒ 同一行任意时刻跑结果一致（AC4）。

**不削弱原判据（AC3）**：欺骗输入（escalate/correct/unblock + 真无本 tick 提交）仍 FAIL——即使仓库存在更早提交但落在 tick 窗口外，`TRACE_EMPTY` ⇒ 红；no-action + 五条全假仍 PASS。

**AC1 复现固化（内层补）**：构造受控 fixture（真实 git 仓库 + 提交时刻受控）验证窗口方向：
```
证据提交 t=E，tick 起点 t=E-60，log 写入 t=E+180（act-then-log 严格次序）
OLD 窗口 [log_mtime, now]            : 0 commits  ⇒ 假 FAIL（证据在窗外）
NEW 窗口 [tick_start, log_mtime]     : 1 commits  ⇒ 证据落窗 ⇒ PASS
```
同形即 17:15 行手跑 FAIL / 套件内 PASS 的运气差；修后该 fixture 在任意时刻跑均 PASS。

**测试（AC5）**：`plugin/test/outer-tick-log-check.test.mjs` 既有 11 例全过 + 新增 4 例（`// @test-group engine`）：
- AC1/AC4 — 证据提交在 log 写入前 + 无后续提交 ⇒ PASS（不再假红）
- AC4 — log 写入后无关提交落地，动作行结果不变（`--until` 锚定 log mtime）
- AC3 — 仓库有更早提交但本 tick 窗口内无 ⇒ 仍 FAIL（不削弱原判据）
- AC2 — 窗口回退：无 `epoch=` 时用上一 tick 表头锚定该 tick 起点 ⇒ PASS

**scoped 门**：`bash scripts/test.sh --for-task gap-outer-tick-log-check-trace-window-anchored-at-log-mtime --allow-thin` ⇒ **exit 0**，fail 0 / cancelled 0，task-contract-check no violations。既有 11/11 + 新增 4/4 = 15/15 绿。真实仓库实跑 `outer-tick-log-check.sh --root <repo> --log <tick-log>` 连续 3 次 exit 0（确定性）。

**full-suite DoD 行未勾**：全量套件绿留外层 verification-round 验证（`@static-tier full` 接线在 scripts/test.sh，本分支未触碰）。
