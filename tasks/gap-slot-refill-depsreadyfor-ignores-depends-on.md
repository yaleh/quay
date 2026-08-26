---
id: gap-slot-refill-depsreadyfor-ignores-depends-on
title: slot-refill.ts depsReadyFor 只读 parent 不读 depends_on——worker 派发依赖闸对 depends_on 结构上失效（与 ready-pool-check.ts 同名函数语义不一致）
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

`plugin/scripts/slot-refill.ts` 的 `depsReadyFor`（:233-241）**只读 `task.parent`，完全不读 `depends_on`**（全文件仅 :232 一行注释提到 depends_on）。而 `plugin/scripts/ready-pool-check.ts` 的 `depsReadyFor`（:1505-1521）读 **parent AND depends_on**（:1521 `for (const d of readDependsOn(task.frontmatterRaw)) deps.push(d)`；:1506 注释「ALL prerequisites — parent AND every depends_on entry」）。

**派发路径走 slot-refill**（:785 `if (!depsReadyFor(task, metaById)) { defer(id, "deps-not-ready"); continue; }`），ready-pool-check 只算池/诊断 ⇒ **`depends_on` 对实际 worker 派发是死字段**。slot-refill 的 depsReadyFor 注释自称「Mirrors ready-pool-check's depsReadyFor」，但漏掉了 depends_on 半边——名字/注释承诺的镜像语义与实际代码不符（硬规则 3b 同形：读不懂/没读 ⇒ 与「合格」同形）。

**生产实例（manager 读码核实，非猜测）**：`gap-suite-pure-execution-900s-optimization` 若加 `depends_on` 指向四个上游，`ready-pool-check` 会判依赖未满足，但 `slot-refill` 照派（实测 0 次已派纯运气——四个上游全部仍是 ready、一个都没落地）。加了 depends_on 会造成「以为闸上了、其实没有」的更危险假象。

**与既有任务的关系**：`gap-readdepends-on-indented-extra-depends-on`（done）修的是 readDependsOn 正则认不到缩进形态；`gap-compound-depsreadyfor-structural-deadlock`（done）修的是 compound parent 聚合语义。**本条修的是 slot-refill depsReadyFor 漏 depends_on**——三个是三个不同缺陷，本条未覆盖。

## Plan

1. `slot-refill.ts depsReadyFor` 读 depends_on（对齐 ready-pool-check.ts:1521），depends_on 未满足的任务不被 worker 派发。
2. 核实完整派发链（slot-refill → worker-driver）无其它绕过 depends_on 的路径（⛔ 只修 depsReadyFor 一处就断言「已生效」是硬规则 5b 局部完备）。

## Acceptance Criteria

- [x] AC1（能取假，depsReadyFor 读 depends_on）：slot-refill.ts depsReadyFor 读 depends_on（对齐 ready-pool-check），depends_on 前驱未 done 的任务 deps-not-ready 被 defer；（⛔ 仍只读 parent ⇒ 假）。
- [x] AC2（能取假，负控制派发）：造一个 `depends_on:` 指向未 done 任务的任务，`slot-refill --json` 不得推荐/派发它（dep 未落地仍被推荐 ⇒ 假）；（⛔ 需给出「加了 depends_on 后 slot-refill 确实 defer」与「不加则推荐」的对照——避免恒假/空转，硬规则 4c）。

## Definition of Done

slot-refill depsReadyFor 读 depends_on 对齐 ready-pool-check；AC1-AC2 全勾；depends_on 前驱未落地任务不被 worker 派发。

## Touches

- plugin/scripts/slot-refill.ts（depsReadyFor 读 depends_on）
- plugin/test/slot-refill.test.mjs（depends_on 依赖闸负控制）
- tasks/gap-slot-refill-depsreadyfor-ignores-depends-on.md（自身）
