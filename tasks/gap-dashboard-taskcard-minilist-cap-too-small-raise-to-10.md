---
id: gap-dashboard-taskcard-minilist-cap-too-small-raise-to-10
title: dashboard 首页任务台账速览的 ready/todo/needs-human mini-list 上限从 3 调到 10
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

人裁定（2026-09-14）：`packages/quay/src/serve-dashboard.ts` 的 `renderTaskCard` 函数（`:855`）
里 `const MINI_LIST_N = 3;` 把 `ready`/`todo`/`needs-human` 三个非终态状态各自的"最近更新"预览列表都
截断在 3 条。对于任务量本来就小的项目（如第三方项目 quay-fleet，这三个状态合计常年在个位数），这个
上限经常导致本该完整可见的少量任务被静默截断——预览列表下面**没有** `+N 更多` 这类提示（对照同一个
文件里 `renderLiveCard` 的 `live.inFlight.slice(0, 3)` 那处截断，已由 `gap-dashboard-livecard-minilist-overflow-indicator`
补上了 `+N 更多` 徽标，`renderTaskCard` 的这三个 mini-list 没有对应处理）。

**人本次的裁定范围明确**：只把 `MINI_LIST_N` 从 `3` 调到 `10`，**不**引入自适应阈值逻辑，**不**新增
"+N 更多"提示——那个不一致本身是真的（已经记录在案，值得单独关注），但本任务的范围就是这一个常量调整，
不在本任务里顺带处理。

**去重记录**：搜索过 `MINI_LIST_N`（0 命中）、`mini-list`（2 命中，均为 `renderLiveCard` 的
`liveMiniList` 机制——`gap-dashboard-live-swimlane-fixed-lane-gantt-timeline`、
`gap-dashboard-livecard-minilist-overflow-indicator`，两者都不涉及 `renderTaskCard`）、
`dashboard ready todo cap`（0 命中）。本任务是不同函数（`renderTaskCard` vs `renderLiveCard`）的
不同常量，不是重复。

## Plan

1. `packages/quay/src/serve-dashboard.ts` 的 `MINI_LIST_N` 常量值由 `3` 改为 `10`。
2. 不修改 `miniList()` 函数的其余逻辑（排序方式、过滤条件、渲染结构均不变）。
3. 不新增溢出提示——`ready`/`todo`/`needs-human` 三个状态各自的条目数一旦超过 10 仍然静默截断，
   这条已知的不一致本任务不处理（记在本 Proposal 里供以后单独立案参考，不是本任务遗漏）。
4. **连带处理（不是扩范围）**：两个已落地任务的测试把「（最近 3 条）」这个标题字面量钉死
   （`gap-dashboard-taskcard-multistatus-minitable`、`gap-dashboard-minilist-row-layout`），
   改常量后全量套件 2 红——这是上一轮 exited-not-landed 的真因，不是环境抖动。
   修法是让这两处改为从 `serve-dashboard.ts` 读 `MINI_LIST_N`（**不是**把 3 改成 10：下一个改上限的人
   会再踩一次，且这两个文件同时断言该标题的【在场】与【缺席】，钉死字面量会让缺席断言变成空转），
   常量**值**仍被钉住、且钉在拥有该常量的任务自己的测试里（`serve-dashboard.test.mjs`）。
   这不引入自适应阈值、不新增溢出提示，裁定范围未变。

## Acceptance Criteria

- [x] AC1 构造一个含 12 条 `status: ready` 任务的合成任务集，`renderTaskCard` 的输出里 `ready` 这个
      mini-list 必须包含 **10** 条（不是 3 条）——直接断言渲染出的行数。
- [x] AC2 构造一个含 5 条 `status: todo` 任务的合成任务集（真实小项目场景），`todo` 的 mini-list 必须
      包含全部 **5** 条（验证"真实数量小于新上限时应完整展示"这个人裁定的实际诉求）。
- [x] AC3 负控制：`done`/`superseded` 这两个终态状态的渲染路径不受影响——它们本来就只显示计数、没有
      mini-list，本任务不得意外给它们也加上一个 mini-list。
- [x] AC4 全量 `scripts/test.sh` 绿。

## Definition of Done

- 四条 AC 全部满足。
- ⛔ 不得引入自适应阈值或"+N 更多"提示——本任务范围明确限定为改一个常量值，人已裁定范围，不得扩大。
- 任务体保留人本次的原始裁定措辞（"只调常量，不做自适应，不加提示"）以及那个"+N 更多不一致"作为
  已知、暂不处理的观察项，供以后单独立案参考。

## Evidence

上一轮 exited-not-landed 的真因（全量套件日志
`.quay/fan-in-suite-gap-dashboard-taskcard-minilist-cap-too-small-raise-to-10~wk-prod-1789350883~1789357624434-a893c7.log`）：
`# tests 2562 / # pass 2560 / # fail 2`，两条 ✖ 全在同一文件、且都是本任务改常量造成的连带：

- `packages/quay/test/gap-dashboard-taskcard-multistatus-minitable.test.mjs` — `renders the ready
  mini-list heading`（断言 `${s}（最近 3 条）`）、以及 `ready (1 task) still renders its block`。
- `packages/quay/test/gap-dashboard-minilist-row-layout.test.mjs:131` — 该处是**缺席**断言
  （`!zero.includes("ready（最近 3 条）")`），改常量后它不再报红，但**变成空转**——断言一个已不可能
  出现的字符串不存在（同硬规则 4c 的「恒真但什么也没验到」形态），故一并修。

双向对照（都在本 worktree 实跑，非推断）：

```
A 常量 10 → 3（其余不动）        ⇒ serve-dashboard.test.mjs AC1/AC2 红（fail 2）
                                  ⇒ 值 10 确实被钉住，不是恒真
B 常量留 10、标题字面量写死 3     ⇒ 两个兄弟测试红（fail 2）
                                  ⇒ 派生断言可假，不是空转
```

作用域门（`scripts/test.sh --for-task <本任务> --allow-thin`）结果与 scoped-gate 缓存写入记录见本轮
提交与 `.quay/scoped-gate-cache.json`；**AC4 的「全量」这一半由 driver 机械 fan-in 的套件运行判定**
（worker 不自己跑全量套件）。

### 2026-09-14 05:0x–05:2x 复验：上一轮那条 suite 红**未复现**——但机制已定位且有两向对照

全量 `scripts/test.sh` 在本 worktree 重跑一次：**绿（EXIT=0，无 ✖）**；上一轮红的那条
（`plugin/test/worker-driver-retry-classification.test.mjs` 的 `round 记录携带判定（生产载体）`）
本轮 `passed=true`（该文件本轮 `__PERFILE__ duration_ms=5940`；失败轮该测试自身耗时 8058ms）。

它是**负载相关的竞态**，不是本任务的连带：该文件与本任务 delta **零 diff**（与 develop 逐字节相同，
见 `git diff --stat develop task/<本任务> -- plugin/test/worker-driver-retry-classification.test.mjs` 为空）。

- 机制：`worker-driver.ts` 的 `writeRound()` 在**轮末**调用（`:5233`，定义 `:4874`），而
  `spawnSelected()` **不 await worker**（`:5038` `rw.promise = runOneWorker({...}).then(r => onWorkerFinished(rw, r))`
  之后随即 `running.push(rw)` 返回）⇒ 第 N 轮的 `exited_not_landed_stops` 会落在**第 N+1 轮**的记录里。
  测试在 `waitFor(picks>=2)` 之后只等固定 **400ms**（`worker-driver-retry-classification.test.mjs:303`）
  就读载体 ⇒ 若下一轮（reap + ready-pool 子进程 + writeRound）超过 400ms，读到 1 条而非 2 条 ⇒ `:311`
  的 `assert.ok(stops.length >= 2)` 红。
- 两向对照（`/tmp/rcl-race-control.mjs`：逐字复制该测试的驱动配置与读法，只把 `--ready-pool-cmd` 放慢到
  2s，令「一轮 > 固定宽限」按构造为真）：

```
A-fixed400ms (测试现有读法): stops=1 kinds=["count-and-retry"]                picks=2 outcomes=2 => FAIL
B-poll-carrier (轮询载体)  : stops=2 kinds=["count-and-retry","stop-terminal"] picks=2 outcomes=2 => PASS
```

  A 复现出的数组与 2026-09-14 那轮全量红**逐字同形**（`[{"task":"gap-stop","kind":"count-and-retry",...}]`，
  即该断言打印的那一份）⇒ 两个假设给出相反预测、一条命令的对照分开了它们（硬规则 4 推论四）。
- 修法（已由上面的 B 验证，**本任务未采用**）：把 `:303` 的固定 sleep 换成轮询载体本身——
  `await waitFor(() => readRoundLines(root).flatMap(r => r.exited_not_landed_stops ?? []).length >= 2, 30000)`
  ——断言强度不变（仍断言 ≥2 条、kind 可区分、顺序），只是不再与驱动轮次竞态。
- **为何不在本任务里修**：该文件不在本任务 `## Touches`、与 develop 零 diff、与本任务所改常量无因果；
  在分支里修它会把一个 engine 测试文件带进本任务 delta（anti-drift 需扩 `## Touches`），而人本次裁定
  明确限定范围为一个常量。故照本任务既有惯例（Proposal 第 3 条对「+N 更多」不一致的处理）**记录在案、
  供以后单独立案参考**。修法已备好，是一条 3 行改动；**下一次该文件在 fan-in 套件里再红时，应当照着
  上面这段直接修**。

### 2026-09-14 09:5xZ（worker 续做第 4 轮）：同一条 suite 红再次出现，读数从「单点观测」升级为「发生率」

本轮**未**采用上面备好的 3 行修法——理由不变（不在 `## Touches`、与本任务所改常量零因果、人裁定限定范围）。
本轮新增的是**发生率**读数，不是又一次单点观测：

- 近 25 份 `fan-in-suite-*.log` 中含该文件的有 **9** 次，其中 `passed=false` **2** 次
  （① 本任务 `~1789360449027-edcb92`；② `gap-ac255-driver-internalization-pid-le2-six-kinds-fresh`
  的 `~1789365557802-30860f`，同一断言、同一夹具数组逐字相同，见该日志 `:4695`）⇒ **7/9 通过**。
  ⚠️ 该对照**不是干净的**：ac255 的 `## Touches` 含 `worker-driver.ts`，故只能说明「同一红在两个
  不同 delta 的 worktree 上都出现过」，不能单独据此判定无关。
- **干净的半边在本 worktree**：本分支对该文件与 `plugin/scripts/worker-driver.ts` 与 develop **零 diff**
  （`git diff develop...HEAD --stat --` 两者均为空）。
- 本 worktree 单独跑该文件：**12/12 全绿**（`node --experimental-strip-types --test
  plugin/test/worker-driver-retry-classification.test.mjs`，duration 4008ms）。
- ⇒ 与上面那两向对照一致：**间歇性负载竞态**（约 22%/轮，高负载时更高），非本任务连带。

本轮作用域门：`scripts/test.sh --for-task <本任务> --allow-thin` **绿（tests 102 / pass 102 / fail 0）**，
AC1（12 条 ready ⇒ 渲染 10 行）/AC2（5 条 todo ⇒ 全部 5 条）/AC3（终态无 mini-list，负控制）三条断言
逐条在场并 ✔；merge develop 无冲突；scoped-gate 缓存已按 develop `d4856fbfe` 写入
（`.quay/scoped-gate-cache.json`）。

## Touches

- packages/quay/src/serve-dashboard.ts
- packages/quay/test/serve-dashboard.test.mjs
- packages/quay/test/gap-dashboard-taskcard-multistatus-minitable.test.mjs
- packages/quay/test/gap-dashboard-minilist-row-layout.test.mjs
- tasks/gap-dashboard-taskcard-minilist-cap-too-small-raise-to-10.md