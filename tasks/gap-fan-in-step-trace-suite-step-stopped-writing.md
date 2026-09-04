---
id: gap-fan-in-step-trace-suite-step-stopped-writing
title: fan-in-step-trace.jsonl 的 suite
  决策步骤（ac-precheck/suite-start/suite-end/suite-skip）自 2026-08-28 起写去了另一个per-run
  日志文件，共享载体上的这批步骤永久停写
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

`docs/proposals/archguard-generation-era-primitives.md` §2.5/§3 P5 报出：`.quay/fan-in-step-trace.jsonl`
的 `suite` 步骤全历史只有 40 条，自 2026-08-30T01:47Z 之后停止写入，而同一条 fan-in 路径的 `ff`
（158 条）/`merge-develop`（390 条）/`scoped-gate`（345 条）仍在写，文档称"没有任何机制发现这次
停写"。

**本次立案时现场复核，找到确切根因（比文档记述更精确，不是猜测）**：

代码里存在**两套独立的 trace 写手**，各自写不同文件：

1. `step()` → `appendFanInStepTrace(root, task, runId, step, phase, extra)`（`worker-driver.ts:2729`）
   写入**共享**载体 `.quay/fan-in-step-trace.jsonl`（`event:"step-begin"/"step-end"`），
   `merge-develop`/`anti-drift`/`typecheck`/`scoped-gate`/`doc-check`/`anti-drift-land`/`ac-gate`/`ff`
   都走这条路径；
2. `trace()` = `(entry) => appendFanInTrace(fanInLog, entry)`（`worker-driver.ts:3355`），其中
   `fanInLog = path.join(root, ".quay", \`fan-in-${task}-${runIdSafe}.log\`)`（`worker-driver.ts:3304`，
   **每个任务每次运行一个独立文件**）——`ac-precheck`/`suite-start`/`suite-end`/`suite-skip`
   （`worker-driver.ts:3410/3524/3530/3561`）全部走的是这条路径。

`git log -1 -S 'appendFanInTrace(fanInLog' -- plugin/scripts/worker-driver.ts` 定位到引入这个分裂
的提交：**`a5a301e03`（2026-08-28 18:06:10Z，"gap-mech-fan-in-log-webui-visible-clickable: 机械
fan-in 过程日志持久化 + web 详情页可点击访问"）**——与文档观测到的 2026-08-30T01:47Z 停写时刻相差
不到两天，时间上吻合：这次重构为了让 web UI 详情页能点开单次 fan-in 的完整日志，把 suite 决策步骤
的 trace 目标从共享文件改指向了新引入的 per-run 持久化日志，但**没有同步保留（或镜像）到共享的
`fan-in-step-trace.jsonl`**，导致依赖共享文件做跨任务/跨时间聚合监控的任何读者（含文档 §附录A
给出的"伴生对照"停写检测脚本）从此再也看不到这批步骤——**产生路径没有真的停，只是被复用到了另一
个文件，而共享文件的读者不知道要去那里找。**

`.quay/fan-in-step-trace.jsonl` 当前（2026-09-04）现场核查：仍是 0 条 `suite*`/`ac-precheck` 记录，
即使同一窗口内 `anti-drift-land`/`ac-gate`/`ff` 各出现 14 次（这三步在代码顺序上都在 suite 决策
**之后**才执行）——证实分裂至今仍未修复，不是历史遗留已经自愈。

**修法方向**：suite 决策步骤应当**同时**写入共享的 `.quay/fan-in-step-trace.jsonl`（供跨任务/跨
时间的聚合监控，如未来的 [[gap-archguard-p5-instrument-decay-standing-guard]]）与 per-run 持久化
日志（供 web UI 详情页点击查看，`a5a301e03` 的原始目的）——两者服务不同的读者，不应该是互斥关系。

## AC

- [ ] AC1（现状红，先跑复现）：触发一次真实机械 fan-in（走 `needSuite=true` 或 doc-only skip 路径
      均可），修复前用 `runId` 过滤 `.quay/fan-in-step-trace.jsonl`，`step` 字段属于
      `{ac-precheck, suite-start, suite-end, suite-skip}` 的记录数 = 0，而同一次运行按同一 `runId`
      过滤 `merge-develop`/`typecheck`/`scoped-gate`/`anti-drift-land` 的记录数 > 0（贴出该 runId
      的完整 `jq` 过滤输出，证明分裂现状，而不是简单声称）
- [ ] AC2（修复后绿）：同样触发一次真实机械 fan-in，修复后按同一 runId 过滤
      `.quay/fan-in-step-trace.jsonl`，`suite-start`+`suite-end`（或 `suite-skip`）至少各出现一次
      （贴出输出）
- [ ] AC3：per-run 持久化日志 `fan-in-<task>-<runId>.log`（`a5a301e03` 的产物，web UI 详情页依赖）
      继续保有相同内容，不因本修复而丢失——同一 runId 下两个载体的 suite 相关条目数一致（贴出对照）
- [ ] AC4：`plugin/test/worker-driver-fan-in.test.mjs` 新增/扩展一条断言，覆盖 AC2 的场景（mock
      suite 路径即可，不要求真跑全量 suite），`node --experimental-strip-types
      plugin/test/worker-driver-fan-in.test.mjs` exit 0

## DoD

用一次真实（或该测试文件已有的最贴近真实的 fixture 化）机械 fan-in 跑一遍，`.quay/fan-in-step-trace.jsonl`
与 `fan-in-<task>-<runId>.log` 两个载体里 suite 决策步骤的记录数在同一 runId 下互相一致且都 > 0；
不是"改了代码就算"——要有修复前后各一次的真实 jq 输出对照贴进任务体（AC1 与 AC2）。

## Touches

- plugin/scripts/worker-driver.ts（`trace()`/`appendFanInTrace` 与 `appendFanInStepTrace` 的写手统一）
- plugin/test/worker-driver-fan-in.test.mjs
- tasks/gap-fan-in-step-trace-suite-step-stopped-writing.md
