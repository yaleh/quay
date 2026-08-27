---
id: gap-bucket-second-truth-source-page-recompute
title: bucket 判定存在第二真相源——页面 serve-tests.ts bucketSetOfFile 重算而非读派发侧结果（不读重归属表/镜像折叠 ⇒ 与派发决策相反）
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

同一个「测试属于哪个桶」的判定有**两份独立实现**，页面那份是派发那份的**不完整手工复制品**，对同一文件可给出相反答案：

```
① 派发用：plugin/scripts/suite-bucket-attribution.ts bucketSetOf()
          + suite-bucket-select.ts effectiveBucketSet()（叠加重归属表 judgment + 镜像折叠）
② 页面用：packages/quay/src/serve-tests.ts bucketSetOfFile()
          自陈注释（:240-247）：「显示层镜像，复刻 bucketSetOf 的判定，
          理由是 Core 不能 import plugin/（packages/quay/src 零 plugin/ 依赖）」
```

**② 不读重归属表、不做镜像折叠** ⇒ 对同一文件给出与派发决策相反的答案。实证两例：
```
plugin/test/dead-loop-check.test.mjs         judgment=M（派发按 M 选入）；页面算出 {S} 显示「S 套件」
plugin/test/fan-in-ff-protocol-check.test.mjs judgment=M（同上）；页面算出 {S,M} 显示「多桶」
```

**⛔ 核心约束（勿破坏）**：`packages/quay/src` 零 `plugin/` 依赖是架构边界——「让页面直接 import 判定函数」被它挡死，这正是当初做镜像的原因，不是疏忽。

**修法（人 2026-08-26 定调「建立和应用统一的 bucket 机制」）**：派发侧把每文件 `effectiveBucketSet` 结果**落盘**（含来源：reattr/static/mirror-fold/unresolved），页面**只读**那份产物 ⇒ 单一真相源、页面无判定逻辑、架构边界不破。与既有模式一致：`verification-round.jsonl` 就是「派发侧算、落盘、页面读」，页面从不自己重算轮次数据——bucket 归属应走同一条路。

**⊢ 副产物（下一条的验收前提）**：那份落盘产物天然记录每文件**经哪条路径**进入本轮（该信息目前任何地方都没落盘）。

## Plan

1. 派发侧新增落盘：`effectiveBucketSet` 对每文件的结果 + 来源（reattr/static/mirror-fold/unresolved）写入 `.quay/` 下的 bucket 归属产物。
2. 页面 `serve-tests.ts` 的 `bucketSetOfFile` 改为**读该产物**（不再自算判定），删除/收窄显示层镜像的判定逻辑。
3. ⛔ 页面仍零 `plugin/` 依赖——通过读落盘产物而非 import 判定函数。

## Acceptance Criteria

- [ ] AC1（能取假，单一真相源）：派发侧 effectiveBucketSet 结果落盘（含来源），页面 serve-tests.ts 只读该产物、不再自算 bucketSetOfFile 判定；（⛔ 页面仍有自算判定逻辑 ⇒ 假）。
- [ ] AC2（能取假，页面与派发一致）：对 dead-loop-check.test.mjs / fan-in-ff-protocol-check.test.mjs 两例，页面显示的桶 == 派发侧 judgment（M），不再相反；（⛔ 仍显示 S/多桶 ⇒ 假）。
- [ ] AC3（能取假，边界不破）：packages/quay/src 仍零 plugin/ 依赖（页面读落盘产物，⛔ 不 import 判定函数）；（⛔ import plugin/ ⇒ 假）。

## Definition of Done

bucket 判定收敛为单一真相源（派发侧算、落盘、页面读）；AC1-AC3 全勾；页面显示与派发决策一致；架构边界不破。

## Touches

- plugin/scripts/suite-bucket-select.ts（effectiveBucketSet 结果 + 来源落盘）
- packages/quay/src/serve-tests.ts（bucketSetOfFile 改读落盘产物，删显示层判定镜像）
- plugin/test/suite-bucket-select.test.mjs（bucket 单一真相源测试）
- tasks/gap-bucket-second-truth-source-page-recompute.md（自身）
