---
id: gap-ac3-live-test-fixture-leaks-supervised-driver-processes
title: 共享的"AC3 live"测试夹具泄漏真实被监督的 driver 子进程——跨多个任务的 worktree 反复出现,数量持续增长
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: plan
---
## Proposal

**实测证据（2026-09-14，本机）**：`pgrep -f "dr-ac3-live"` 在同一时刻发现分布在**至少 4 个不同任务**
worktree 下的泄漏进程——`gap-driver-status-carrier-path-source-label-mismatch`（多个）、
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

**✅ 实现者核实后的真实根因（2026-09-14，实测；上面那两个猜测【都不对】，且比它们更严重）**：

- 它是**本文件内联的 AC3 夹具**，**不是**跨文件共享的辅助函数：`plugin/test/driver-runtime.test.mjs`，
  测试名 `AC3 (gap-ac203) — 必死启动 ⇒ start 非零退出 + 死因；…`。`--run-id dr-ac3-live` 全仓只此一处
  调用点（`grep -rn` 确认）。
- **泄漏不是失败路径特有的——绿灯路径【每次都】泄漏。** 三个环节缺一不可：
  ① `startKind` 以 `detached: true` + `unref()` 起 supervisor（生产需要：`quay driver start` 退出后驱动
     必须活着）⇒ supervisor 与其 fork 出的 driver **不随测试进程退出而消失**，只能显式杀。
  ② `stopKind` 唯一的杀法是从 `<root>/.quay/` 读 pid 文件发信号 ⇒ **root 一旦不在，一个信号都发不出
     去**，且**两种形态都静默**（实测：root 被整个删掉 ⇒ `driver-runtime: invalid --root: …` + exit 2；
     root 还在而 pid 文件没了 ⇒ `not-running` + exit 0）。后者是硬规则 3b 的教科书形态——读不懂输入 ⇒
     与「干净」同形。**泄漏能长期隐形，正是因为 stop 报了「没在跑」。**
  ③ 夹具注册了**两个独立的 `t.after`**（先 `fs.rmSync(root)`、后 `run(["stop", …])`），而 node:test 的
     `after` 钩子按**注册顺序 FIFO** 执行（本机实测：先注册的先跑）⇒ **rmSync 先把 root 删掉 ⇒ stop
     空转 ⇒ 泄漏**。
- **取证对照（一条命令级）**：把原测试单跑一遍（`pass 1 / fail 0`，全绿）后立刻 `pgrep` —— 残留
  supervisor + driver 各一个，而该 root 目录已不存在 ⇒ 「通过路径同样泄漏」当场成立。**原 AC2 里
  「那条（正常通过时清理了）早就是真的」这个前提是错的。**
- `/tmp/dr-ac3-live-*` 目录残留 **141 个**（`ls -d | wc -l`）；残留 supervisor 的 `appendLog` 会
  `mkdir -p` 把已删掉的 `.quay/` **重建出来** ⇒ **「目录还在」不等于「stop 跑过」**，这个读数本身也
  取不了假。

**⚠️ 附带实测（另一条同形陷阱，本轮踩到并已避开）**：把真实夹具放进子 `node --test` 跑时，node:test 会
因继承的 `NODE_TEST_CONTEXT` 而**静默跳过**嵌套 runner（exit 0 + stdout 为空 + 一行 Warning
`run() is being called recursively within a test file. skipping running files.`）——同样是「读不懂输入 ⇒
与成功同形」。修法是删掉子进程 env 里的该变量；两条对照并各自断言「子进程真的跑了」（pass/fail 计数），
⛔ 不依赖「它应该跑了」——本轮实测正是靠「root 锚点必须存在」这条断言才没把它读成绿。

**代价**：
1. 每个泄漏进程都是一个真实运行的 Node.js 进程（`driver-runtime.ts __supervise` + `promotion-driver.ts`），
   持续消耗 CPU/内存，且数量随每次跑到这条测试路径的任务增多而单调增长，从未见过自然回收。
2. 泄漏进程绑定的 `--pid-file` 指向 `/tmp/dr-ac3-live-<random>/.quay/promotion-driver.pid`——这些临时
   root 目录本身大概率也从未被清理（未逐一核实磁盘占用，值得实现者一并检查）。
3. 首次发现时曾误判为"某个任务的 worker 真的跑了 6 小时"——花费额外排查时间才确认是测试夹具泄漏而非
   任务本身卡住，这类误导后续排查的成本会随泄漏数量增长而持续复现。

## Plan

1. 定位共享的测试辅助函数（命令行里 `--run-id dr-ac3-live` 是唯一锚点，建议全仓 `grep -rn "dr-ac3-live"
   plugin/test/` 定位调用点与其定义处）。⇒ **核实结论：不存在跨文件共享的辅助函数**，是本文件 AC3 测试
   的内联夹具。
2. 确认清理路径：辅助函数必须在测试结束（包括断言失败路径）时，对它 spawn 出的 `__supervise` 包装进程
   使用进程组信号（`kill(-pgid)`，因为 supervisor 会以 detached/setsid 方式再 fork 子 driver 进程，仅
   `kill()` 直接子进程不够——这正是同仓库另一条已修复缺陷 `detached-test-child-leak-hangs-suite` 的同类
   模式，可参考其修法）。⇒ 采用 `kill(-pgid)`，但**加了一道实测守卫**：先 `ps -o pgid= -p <pid>` 实测
   `pgid == pid`（确认它确实是自己进程组的组长）才发组信号，⛔ 不假设——否则 `kill(-pgid)` 会打到
   **别人的**进程组（本机同一时刻就有别的任务 worktree 的同类残留，误杀的代价是别人的套件）。
3. 用 `try/finally`（而非 `after`/`afterEach` 钩子）包裹 spawn-and-assert 逻辑，确保断言失败时清理仍然
   执行。⇒ 落成**单个 `t.after`，其内部三段固定顺序 + try/finally**：① stop（机制路径）→ ② 进程组
   兜底 kill → ③ **最后**删 root。⛔ 钩子本身不能省（它才是「测试体抛错也清理」的那半边）；`try/finally`
   管的是钩子内部三段之间不互相跳过。
4. 顺带清理 `/tmp/dr-ac3-live-<random>` 临时目录本身（若测试结束时仍存在）。⇒ 落成第 ③ 段，**必须在
   最后**：root 一没，②要读的 pid 文件也就读不到了。
5. **（实现时新增，硬规则 5b：修好一个 ≠ 没有别的）在同一载体里 grep 该原则的其它适用点**：
   `plugin/test/driver-cli.test.mjs` 命中 **2 处**（`ac1` / `ac1-stop`）。两者同样是「`stop` 写在测试体内、
   `t.after` 只 `rmSync`」⇒ 断言一失败 `stop` 就跑不到，而钩子的 `rmSync` 一跑 `stop` 就空转。
   **实证**：`ac1-stop` 的一次失败留下了一对 `/tmp/driver-cli-ac1-stop-XpH3GN` 进程（supervisor +
   worker driver），`ps -o lstart=` = **2026-09-11 10:13:14，活了 2.7 天**。⇒ 一并改为共享的
   `teardownDrivers(root, kinds)`（stop 在前、rmSync 在后、try/finally），并把该文件里最后一份「正确
   顺序」的副本也收敛到它，使顺序只有一处定义。

## Acceptance Criteria

- [x] AC1 找到该共享测试辅助函数的定义处，贴出其文件路径与函数名。⇒ **不存在跨文件共享的辅助函数**；
      夹具内联于 `plugin/test/driver-runtime.test.mjs` 的测试 `AC3 (gap-ac203)` 内（`--run-id dr-ac3-live`
      全仓只此一处调用点，`grep -rn` 确认）。清理逻辑的定义处（本任务新立，唯一）＝
      `plugin/test/driver-runtime.test.mjs` 的 `teardownLiveDriver(root, pluginRoot)`；同族第二处收敛到
      `plugin/test/driver-cli.test.mjs` 的 `teardownDrivers(root, kinds)`。
- [x] AC2 负控制：故意让辅助函数内部的一个断言失败（模拟真实失败场景），跑完该测试文件后，用
      `ps`/`pgrep` 确认**没有**残留匹配 `dr-ac3-live` 的进程——⛔ 这条必须覆盖失败路径，不能只测
      "正常通过时清理了"（那条早就是真的，泄漏恰恰发生在异常/失败路径）。
      ⇒ **已落成两条独立跑通的对照之一**：`driver-runtime.test.mjs` 的
      `AC2 (gap-ac3-live…) 负控制`。失败由夹具内的注入接缝产生（env `QUAY_AC3_LIVE_INJECT_FAIL=1`，
      默认不生效），子进程退出码非 0 且 stdout 含 `fail 1`（先证明「真的失败了」，再谈残留）。
      读数按**本次 root 这条唯一路径**精确匹配（⛔ 不通配 `dr-ac3-live`——那会把别的任务 worktree 的
      历史残留算进来，是假阳性）。结果：**零残留 + root 已删**。
      ⚠️ **原判据的前提被实测推翻**：「那条早就是真的」不成立——**通过路径同样每次泄漏**（见 Proposal）。
      故 AC3 不是可有可无的对照，它与 AC2 一样是红过的。
- [x] AC3 正控制：正常通过路径下同样确认零残留进程（作为 AC2 的对照，证明清理逻辑本身没有被引入新的
      "总是不清理"回归）。⇒ `AC3 (gap-ac3-live…) 正控制`：子进程 exit 0 且 stdout 含 `pass 1`，
      结果 **零残留 + root 已删**。两条对照各自 spawn 一次真实夹具、各自读数，⛔ 不是「跑一次然后断言
      应该都清理了」。
- [x] AC4 `/tmp/dr-ac3-live-*` 临时目录在测试结束后（含 AC2 的失败路径）不残留。⇒ AC2/AC3 两条对照
      各自断言 `!fs.existsSync(<本次 root>)`，**两条路径都覆盖**（比「笼统地看有没有剩余目录」更精确：
      按本次 mkdtemp 出来的唯一路径判，避免把历史遗留目录算进来）。清理落在 teardown 第 ③ 段，在
      pid 文件读完**之后**执行。
- [ ] AC5 全量 `scripts/test.sh` 绿（待外部）

**红控制（本条判据可取假的证据，⛔ 不是「读代码相信」）**：把夹具的清理换回**旧形态**（两个独立
`t.after`：先 `rmSync` 后 `stop`）再跑这两条对照 ⇒ **两条都因残留断言变红**（`AC2 失败路径：不得残留…`
/ `AC3 通过路径：不得残留…`），且变红的正是「残留」那一条（⛔ 不是「子进程没跑」那一条——那说明红的
是判据本身而不是缺陷）。换回修好的形态 ⇒ 两条都绿。**这就是「换一个参数看结论翻不翻」的对照。**

## Definition of Done

- 五条 AC 全部满足（AC1–AC4 由上述两个独立对照与红控制实测；AC5 为外层全量套件），且 AC2/AC3 必须是
  **两个独立跑通的对照**（不能只跑一次然后断言"应该都清理了"）——已落实：两者各自 subprocess 跑真实
  夹具、各自读数，并各自先证明「自己跑在预期的路径上」（失败/通过）。
- 任务体保留本条实测证据：46 个峰值残留进程、4 个不同任务 worktree 的分布、年龄跨度读数——**保留于
  Proposal**，并补入实现时取得的根因读数（141 个残留 `/tmp` 目录、`appendLog` 重建 `.quay/` 使「目录
  还在」不可作判据、node:test `after` 钩子 FIFO 顺序实测、以及同族第二处 `driver-cli ac1-stop` 活了
  2.7 天的实证）。
- ⛔ 不得只清理"当前发现的"这一批残留进程了事——那只是症状；本任务修的是泄漏的产生路径本身。已落实：
  改的是清理时序（产生路径），⛔ 未对本机其它任务 worktree 的历史残留进程做任何清理（它们不属于本
  任务的在飞状态）。**残留不再新增**由两条对照实测守住。

## Touches

- tasks/gap-ac3-live-test-fixture-leaks-supervised-driver-processes.md
- plugin/test/driver-runtime.test.mjs
- plugin/test/driver-cli.test.mjs
