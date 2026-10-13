---
id: gap-routine-semantic-dedup-scan-loadavg-readers
title: "semantic-dedup-scan: Identical /proc/loadavg field-0 reader with
  Number.isFinite guard and catch-to-0; acceptance-runner's comment says it is
  the same reading."
status: ready
labels:
  - gap
  - routine-filed
  - semantic-dedup-scan
parent: null
children: []
extra: {}
---
## Finding
Identical /proc/loadavg field-0 reader with Number.isFinite guard and catch-to-0; acceptance-runner's comment says it is the same reading.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1791908616513` · ts `2026-10-13T16:23:36.513Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`readLoadAvg`、`gateLoadAvg`
- 涉及文件：
- `plugin/scripts/full-suite-runner.ts:460`
- `packages/quay/src/gate/acceptance-runner.ts:161`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
extract a shared readLoadAvg1

## Disposition

**复核结论：finding 属实，且逐字核对后【还少报了一处】——同一读数在生产树里实际有 3 份，不是 2 份。**

取证（`git show develop:<path>` 取原文，把探针的谓词对着**已知为真**的样本干跑；⛔ 不是「我记得是这样」）：

```
develop@<fork point> 上，6 行 body（含 `String(…)` 包裹形态）逐字命中 = 2：
  plugin/scripts/full-suite-runner.ts             `readLoadAvg`   ← finding 点名
  packages/quay/src/gate/acceptance-runner.ts     `gateLoadAvg`   ← finding 点名
body 的 md5 = ec2fd93a2799c602d66c99552f128760

同一读数【去掉那个冗余 `String(…)` 包裹】再量 = 1（探针的 byte digest 看不见它）：
  packages/quay/src/gate/engine.ts                `load1`
```

`String(…)` 是纯冗余：`fs.readFileSync(p, "utf8")` 的返回类型就是 `string`，包一层不改变任何东西 ⇒ 这 3 处
是**同一个读数**，只是其中一处的拼法躲过了按字节比对的探针。这正是本族 finding 的形态（改名 / 改拼法
就是掩体），所以本次按 3 处一起收敛，而不是只动被点名的那 2 处（硬规则 5b）。

**处置 = 修掉（extract），不是「已注意到」，也不是「已有机制在管」。**

- 实现落 **`packages/quay/src/kernel/load-avg.ts`**（kernel 叶，导出 `readLoadAvg1`；唯一 import 是
  `node:fs` —— import-graph-check 第四规则显式允许 node 内建，量的是【层间越界】）。
- 三个消费方改为读这一份，各自形态不同：
  - `plugin/scripts/full-suite-runner.ts` —— 跨树 import 后**原样转出**
    （`export { readLoadAvg1 as readLoadAvg } from "../../packages/quay/src/kernel/load-avg.ts"`），
    公开面与签名不变，两个活的消费者（`worker-driver.ts` / `worker-fan-in.ts`）零改动。
  - `packages/quay/src/gate/acceptance-runner.ts` —— 本文件内 import；本地 `gateLoadAvg` **整体删除**
    （文件外零消费者），⛔ 不留 wrapper shim：留一个包装就是给「再抄回一份 body」留常设入口；它的
    「same reading as checker-cost.sh」注释是死锚点，随 body 一起删。
  - `packages/quay/src/gate/engine.ts` —— 本地 `load1` 删除，并删掉它那句已经失效的理由：
    「Inlined here (not imported from plugin/scripts) so the published Core package stays dependency-free」
    禁的是 import **方法学层**，⛔ 从来没有禁过 import 同包的 kernel 叶 ⇒ 该理由不成立，不该留在原地。
- **计数（本次最直接的一条）：生产树里该 body 的副本 3 → 1。**

**为什么落 kernel**：`packages/**` → `plugin/**` 是 `import-graph-check.ts` 的 `reverseEdges` 棘轮
（基线 0）明令的逆向边，所以共享实现**不能**留在 `plugin/scripts` 再被产品侧 import；kernel 是两层唯一
共同可达的落点（产品侧包内 import，方法学侧跨树 import）。与 finding
`mergeenv-cross-layer-byte-identical-under-rename` 的落法与理由逐字同形（`kernel/env-merge.ts`）。

**⛔ 刻意不合并的两个（不同义，不是本次谓词内的副本；逐条点名而不是沉默跳过）**：
- `plugin/scripts/suite-load-sampler.ts` 的 `readLoadavg`：读不到 /proc 时返回 **`null` 而不是 0** ——
  sampler 的负载曲线必须留一个「洞」，`0` 会被读成「机器闲下来了」（硬规则 3b，与该文件自己为
  `readCpuStall` 记下的同一条区分同源）。**换口径 = 把两种成因压成一个值**，故不动。
- `plugin/scripts/checker-cost.ts` 的 `getLoad1`：先看 `CHECKER_COST_LOAD_OVERRIDE` 测试缝（有缝 = 有
  独立契约），且先把文件读进有名字的绑定。形状与谓词都不同。
- 相邻但同义的**非 TS** 读法（`/proc/loadavg` 的 awk 取第一列）：`plugin/scripts/checker-cost-lib.sh:53`、
  `plugin/scripts/resource-gate.sh:199`。⛔ 本次不动：它们是 shell 层，不在本 finding 的谓词（TS 函数体
  `byte-identical-body`）内，收进来要把整个 shell 检查面拉进本任务 diff。

### 新增判据 + 红控制

`packages/quay/test/kernel-load-avg.test.mjs`（5 条，`@test-group product`）：
- ① 该 body 在生产树里**【恰好一个文件】**（EXACT set 断言，⛔ 不是 `<= N`），且 finding 点名的 3 个 former
  copy 逐个不在集合里（失败信息给名字而不是裸计数）；
- ①（零计数半边）**去掉 `String(…)` 的近似副本命中数 = 0**，并附**负控制**：同一个谓词对 kernel 叶自己的
  body（含包裹形态）**必须命中** —— 两半合起来才证明两个 needle 是在**按包裹这一个差别**分辨，而不是
  其中一个写坏了（硬规则 2 的两半）；
- ② 三个消费方**都 import kernel 叶**（接线，而非只有 body 计数）——「三层是同一个判断」原来是注释，
  现在是会红的结构；
- ③ 方法学层与产品层拿到的是**同一个函数对象**（`fullSuiteNs.readLoadAvg === kernelNs.readLoadAvg1`）
  —— 复制出来的会是不同对象，这是 ② 单独看不出的那一半；
- ④ 读数等于**宿主真实的** `/proc/loadavg` 第 0 字段（独立解析，值随宿主与时刻变化 ⇒ 常量 / 错字段 /
  错路径都过不了），并钉住 guard 的**形态**（`Number.isFinite(v) ? v : 0`）。

**红控制（三臂，都实测变红、都点名，撤掉即绿）**：
- A 把逐字节副本注回 finding 点名的 `packages/quay/src/gate/acceptance-runner.ts` ⇒ 红：
  `got: ["packages/quay/src/gate/acceptance-runner.ts","packages/quay/src/kernel/load-avg.ts"]`；
- B 注入到**无关**生产文件 `plugin/scripts/task-ops.ts` ⇒ **也红**：`got: ["packages/quay/src/kernel/load-avg.ts","plugin/scripts/task-ops.ts"]`
  —— 证明咬的是「恰好一份」这条计数，不只是那份点名清单；
- C 把**去掉包裹**的近似副本注入同一无关文件 ⇒ 零计数半边红：
  `got: ["plugin/scripts/task-ops.ts"]` —— 证明近似副本这一半不是空转。
- 三臂注入前后都用 `cp` 备份并 `diff -q` 核对还原（工作树最终 `git status` 只有本次 5 个改动）。

**④ 的一处诚实记录（判据自己也会取不到假，硬规则 4c）**：第一版写的是
`assert.equal(readLoadAvg1(), expected)`。但**值有第二个产生者**——内核自己每 ~5s（本机实测：4s 窗口内
变 1 次）重算一次，所以从「产生处」到「读取处」中间**还隔着一层会改写该量的内核 tick**；套件并行负载下
本进程可能被跨 tick 调度 ⇒ 那是一处真 flake，不是理论风险。已改为**前后夹逼**（读 → 调 → 再读，断言
落在两者之间）：常量 / 错字段（第 3 字段 `16/16562` → NaN）/ 错路径**仍然全部会红**，唯一的 race 被消掉。

⛔ **本条判据不测什么，写出来而不是留白**（硬规则 3b：「没查成」不得与「查过且合格」同形）：
`readLoadAvg1` 直读绝对路径 `/proc/loadavg` 且**没有路径缝**，所以 catch→0 那一支**没有被行为级跑到**。
为一个遥测读数新加注入缝是本次 finding 没有要求的范围，且会多出一份要维护的契约 ⇒ 该支改由**源码形态**
钉住（④ 的最后一条断言），并在测试头注释里明写「未行为级覆盖」，⛔ 不假装跑过。

### 门（本轮实跑）

- `tsc --noEmit`：`packages/quay` / `packages/quay-native` / `packages/quay-github` / `packages/quay-backlog`
  逐个 **exit 0**。
- `import-graph-check.ts --json`：`verdict.ok=true`，`valueSccs 0 / typeSccs 0 / reverseEdges 0`，
  `kernelChecked=true`，`kernelViolations 0`（新 kernel 叶只引 node 内建，第四规则 vacuous 成立）。
- `kernel-sibling-resolution-check.ts`：PASS —— 427 kernel file(s)，0 naive resolution。
- `capability-catalog.sh` rc=0：`378 scripts | 378 declared | 0 unclassified | 373 ship`
  —— ⛔ 本次**未新增 plugin/scripts 文件**，故无新声明义务。
- 新判据文件 5/5 绿；三臂红控制见上。

### 本条不声称什么

⛔ 本条**没有**消除全仓所有 `/proc/loadavg` 读法（见上面「刻意不合并的两个」+ shell 层的两处 awk）。
只把 finding 点名的 **2 处逐字节副本 + 1 处同义近似副本收敛为 1 处**，并把「三层是同一个读数」从
注释变成结构（③ 直接断言同一个函数对象）。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `loadavg-readers`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1791908616513`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/full-suite-runner.ts`
- `packages/quay/src/gate/acceptance-runner.ts`
- `packages/quay/src/gate/engine.ts`
- `packages/quay/src/kernel/load-avg.ts`
- `packages/quay/test/kernel-load-avg.test.mjs`
- `tasks/gap-routine-semantic-dedup-scan-loadavg-readers.md`

## Blocker

**2026-10-13T17:05:05.577Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: AssertionError [ERR_ASSERTION]: shared green run exits 0 [baseline A/B: HARD RED (task-introduced-red) — the task's red set is NOT a subset of the develop baseline red set: added=plugin/test/full-suite-runner-s11.test.mjs,plugin/test/full-suite-runner-s11.test.mjs,plugin/test/full-suite-runner-s11.test.mjs,plugin/test/full-suite-runner-s03.test.mjs,plugin/test/full-suite-runner-s04.test.mjs,plugin/test/full-suite-runner-s04.test.mjs,plugin/test/full-suite-runner-s04.test.mjs,plugin/test/full-suite-runner-s09.test.mjs,plugin/test/full-suite-runner-s01.test.mjs,plugin/test/full-suite-runner-s01.test.mjs,plugin/test/full-suite-runner-s01.test.mjs,plugin/test/full-suite-runner-s01.test.mjs,plugin/test/full-suite-runner-s01.test.mjs,plugin/test/full-suite-runner-s06.test.mjs,plugin/test/full-suite-runner-s06.test.mjs,plugin/test/full-suite-runner-s12.test.mjs,plugin/test/full-suite-runner-s12.test.mjs,plugin/test/full-suite-runner-s05.test.mjs,plugin/test/full-suite-runner-s05.test.mjs,plugin/test/full-suite-runner-s05.test.mjs,plugin/test/full-suite-runner-s08.test.mjs,plugin/test/full-suite-runner-s08.test.mjs,plugin/test/full-suite-runner-s08.test.mjs,plugin/test/full-suite-runner-s02.test.mjs,plugin/test/full-suite-runner-s02.test.mjs,plugin/test/full-suite-runner-s02.test.mjs,plugin/test/full-suite-runner-s07.test.mjs,plugin/test/full-suite-runner-s07.test.mjs,plugin/test/trend-check.test.mjs,plugin/test/fan-in-execute-paths-s12.test.mjs,plugin/test/fan-in-execute-paths-s12.test.mjs,plugin/test/worker-driver.test.mjs,plugin/test/fan-in-execute-paths-s06.test.mjs,plugin/test/full-suite-runner-cgroup.test.mjs,plugin/test/full-suite-runner-cgroup.test.mjs,plugin/test/full-suite-runner-cgroup.test.mjs,plugin/test/full-suite-runner-cgroup.test.mjs,plugin/test/full-suite-runner-cgroup.test.mjs,plugin/test/full-suite-runner-cgroup.test.mjs,plugin/test/full-suite-runner-cgroup.test.mjs,plugin/test/full-suite-runner-cgroup.test.mjs,plugin/test/full-suite-runner-cgroup.test.mjs,plugin/test/full-suite-runner-cgroup.test.mjs,plugin/test/full-suite-runner-cgroup.test.mjs,plugin/test/full-suite-runner-cgroup.test.mjs,plugin/test/full-suite-runner-s10.test.mjs,plugin/test/full-suite-runner-s10.test.mjs,plugin/test/full-suite-runner-s10.test.mjs,plugin/test/full-suite-runner-s10.test.mjs,plugin/test/fan-in-execute-paths-s11.test.mjs,plugin/test/measure-trend-check.test.mjs,plugin/test/suite-state-trigger.test.mjs,plugin/test/suite-accounting.test.mjs,plugin/test/suite-accounting.test.mjs,plugin/test/suite-accounting.test.mjs,plugin/test/full-suite-runner-phases.test.mjs,plugin/test/full-suite-runner-phases.test.mjs,plugin/test/full-suite-runner-phases.test.mjs,plugin/test/full-suite-runner-phases.test.mjs,plugin/test/full-suite-runner-phases.test.mjs,plugin/test/full-suite-runner-phases.test.mjs,plugin/test/full-suite-runner-phases.test.mjs,plugin/test/full-suite-runner-phases.test.mjs,plugin/test/full-suite-runner-phases.test.mjs,plugin/test/full-suite-runner-phases.test.mjs,plugin/test/full-suite-runner-phases.test.mjs,plugin/test/full-suite-runner-phases.test.mjs,plugin/test/full-suite-runner-phases.test.mjs,plugin/test/full-suite-runner-phases.test.mjs,plugin/test/full-suite-runner-phases.test.mjs,plugin/test/full-suite-runner-phases.test.mjs,plugin/test/full-suite-runner-phases.test.mjs,plugin/test/full-suite-runner-phases.test.mjs,plugin/test/full-suite-runner-phases.test.mjs,plugin/test/full-suite-runner-phases.test.mjs,plugin/test/full-suite-runner-phases.test.mjs,plugin/test/full-suite-runner-phases.test.mjs,plugin/test/full-suite-runner-phases.test.mjs,plugin/test/full-suite-runner-phases.test.mjs,plugin/test/full-suite-runner-phases.test.mjs,plugin/test/full-suite-runner-phases.test.mjs,plugin/test/full-suite-runner-phases.test.mjs,plugin/test/full-suite-runner-phases.test.mjs,plugin/test/full-suite-runner-phases.test.mjs,plugin/test/full-suite-runner-phases.test.mjs,plugin/test/full-suite-runner-phases.test.mjs,plugin/test/full-suite-runner-phases.test.mjs,plugin/test/full-suite-runner-phases.test.mjs,plugin/test/full-suite-runner-phases.test.mjs,plugin/test/full-suite-runner-phases.test.mjs,plugin/test/full-suite-runner-phases.test.mjs,plugin/test/full-suite-runner-phases.test.mjs,plugin/test/full-suite-runner-phases.test.mjs,plugin/test/full-suite-runner-phases.test.mjs,plugin/test/full-suite-runner-phases.test.mjs,plugin/test/full-suite-runner-phases.test.mjs,plugin/test/full-suite-runner-phases.test.mjs,plugin/test/full-suite-runner-phases.test.mjs,plugin/test/full-suite-runner-phases.test.mjs,plugin/test/full-suite-runner-phases.test.mjs,plugin/test/full-suite-runner-phases.test.mjs,plugin/test/full-suite-runner-phases.test.mjs,plugin/test/full-suite-runner-phases.test.mjs,plugin/test/full-suite-runner-phases.test.mjs,plugin/test/full-suite-runner-phases.test.mjs,plugin/test/full-suite-runner-phases.test.mjs,plugin/test/full-suite-runner-phases.test.mjs,plugin/test/full-suite-runner-phases.test.mjs,plugin/test/full-suite-runner-phases.test.mjs,plugin/test/full-suite-runner-phases.test.mjs,plugin/test/full-suite-runner-phases.test.mjs changed=-]
- run_id：wk-prod-anchor
- session_id：bb471705-ce31-441c-bfd4-a16457b06674
