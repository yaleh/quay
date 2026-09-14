---
id: gap-ac3-live-test-fixture-leaks-supervised-driver-processes
title: 共享的"AC3 live"测试夹具泄漏真实被监督的 driver 子进程——跨多个任务的 worktree 反复出现,数量持续增长
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: plan
---
## Proposal

**实测证据（2026-09-14，本机）**：`pgrep -f "dr-ac3-live"` 在同一时刻发现分布在**至少 4 个不同任务** worktree
下的泄漏进程——`gap-driver-status-carrier-path-source-label-mismatch`（多个）、
`gap-productize-deep-semantic-dedup-scan-routine`、`gap-checker-claim-vs-actual-cadence-and-count-drift`、
`gap-adr007-per-milestone-dark-axis-enforcement-gate`——年龄跨度从 2.1 小时到 6.15 小时不等（`ps -o etimes=`
实测：7677s 到 22138s）。峰值一次性发现 **46 个**存活进程，全部命令行匹配同一形态：

```
node --experimental-strip-types <worktree>/plugin/scripts/driver-runtime.ts __supervise --kind promotion
  --root /tmp/dr-ac3-live-<随机6位> --restart-delay 1 --run-id dr-ac3-live
```

以及对应的子进程：
```
node --experimental-strip-types /tmp/dr-ac3-live-<同随机6位>/plugin/scripts/promotion-driver.ts
  --root /tmp/dr-ac3-live-<同随机6位> --pid-file /tmp/dr-ac3-live-<同随机6位>/.quay/promotion-driver.pid
  --run-id dr-ac3-live
```

**成因判断（基于命名与形态，未逐一读测试源码确认，留给实现者核实）**：`--run-id dr-ac3-live` 这个字面量
强烈暗示这是某个共享测试辅助函数（可能命名含"AC3"或"live"，用于验证 driver-runtime 的真实监督/重启行为，
而非用 mock）在多个任务的测试套件里被复用；该辅助函数会真的 spawn 一个 `__supervise` 包装进程 + 其子
driver 进程，指向一个 `/tmp/dr-ac3-live-<random>` 临时 root，但**测试结束时未正确终止这两个真实子进程**
（可能是只 `kill()` 了直接子进程、漏了 supervisor 自己再 fork 出的孙进程；或 `afterEach`/`t.after` 钩子
在断言失败时被跳过——这是本仓库已知的另一个真实缺陷模式，见硬规则相关记录：after 钩子抛错会跳过剩余
全部钩子，导致 detached 子进程泄漏）。

**代价**：
1. 每个泄漏进程都是一个真实运行的 Node.js 进程（`driver-runtime.ts __supervise` + `promotion-driver.ts`），
   持续消耗 CPU/内存，且数量随每次跑到这条测试路径的任务增多而单调增长，从未见过自然回收。
2. 泄漏进程绑定的 `--pid-file` 指向 `/tmp/dr-ac3-live-<random>/.quay/promotion-driver.pid`——这些临时
   root 目录本身大概率也从未被清理（未逐一核实磁盘占用，值得实现者一并检查）。
3. 首次发现时曾误判为"某个任务的 worker 真的跑了 6 小时"——花费额外排查时间才确认是测试夹具泄漏而非
   任务本身卡住，这类误导后续排查的成本会随泄漏数量增长而持续复现。

## Plan

1. 定位共享的测试辅助函数（命令行里 `--run-id dr-ac3-live` 是唯一锚点，建议全仓 `grep -rn "dr-ac3-live"
   plugin/test/` 定位调用点与其定义处）。
2. 确认清理路径：辅助函数必须在测试结束（包括断言失败路径）时，对它 spawn 出的 `__supervise` 包装进程
   使用进程组信号（`kill(-pgid)`，因为 supervisor 会以 detached/setsid 方式再 fork 子 driver 进程，仅
   `kill()` 直接子进程不够——这正是同仓库另一条已修复缺陷 `detached-test-child-leak-hangs-suite` 的同类
   模式，可参考其修法）。
3. 用 `try/finally`（而非 `after`/`afterEach` 钩子）包裹 spawn-and-assert 逻辑，确保断言失败时清理仍然
   执行——这正是本仓库记录过的"after 钩子抛错跳过后续全部钩子导致泄漏"那类缺陷的预防形态。
4. 顺带清理 `/tmp/dr-ac3-live-<random>` 临时目录本身（若测试结束时仍存在）。

## Acceptance Criteria

- [ ] AC1 找到该共享测试辅助函数的定义处，贴出其文件路径与函数名。
- [ ] AC2 负控制：故意让辅助函数内部的一个断言失败（模拟真实失败场景），跑完该测试文件后，用
      `ps`/`pgrep` 确认**没有**残留匹配 `dr-ac3-live` 的进程——⛔ 这条必须覆盖失败路径，不能只测
      "正常通过时清理了"（那条早就是真的，泄漏恰恰发生在异常/失败路径）。
- [ ] AC3 正控制：正常通过路径下同样确认零残留进程（作为 AC2 的对照，证明清理逻辑本身没有被引入新的
      "总是不清理"回归）。
- [ ] AC4 `/tmp/dr-ac3-live-*` 临时目录在测试结束后（含 AC2 的失败路径）不残留。
- [ ] AC5 全量 `scripts/test.sh` 绿。

## Definition of Done

- 五条 AC 全部满足，且 AC2/AC3 必须是两个独立跑通的对照（不能只跑一次然后断言"应该都清理了"）。
- 任务体保留本条实测证据：46 个峰值残留进程、4 个不同任务 worktree 的分布、年龄跨度读数。
- ⛔ 不得只清理"当前发现的"这一批残留进程了事——那只是症状；本任务修的是泄漏的产生路径本身。

## Touches
（实现者需先执行 Plan 第 1 步定位后再精确声明；暂不预先猜测具体文件路径，避免声明与实际改动位置不符）
