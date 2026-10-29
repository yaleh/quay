---
id: gap-full-suite-runner-cgroup-ac3-live-carrier-double-read-race
title: full-suite-runner-cgroup AC3 双读活载体竞态——merge suite 负载下 flake
status: done
labels:
  - gap
  - suite
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-930
---
## Finding

GOAL-912 merge 在全量 suite 步红：`plugin/test/full-suite-runner-cgroup.test.mjs` AC3「a REAL round's measured concurrency equals an independent overlap computation」在负载下 flake。根因：该测试对活载体 `.quay/verification-round.jsonl` **读了两次**——`resolveSuiteMemoryMax` 内部读一次算出 `real.actualConcurrency`，测试又独立读「最后 5 行」算 `bruteMax`。两次读之间若并发 suite 追加了新轮次，两次看到的「最后 5 行」不同 ⇒ 数值不一致。reader 的 sweep-line（`actualConcurrencyFromRows`）与测试的 brute-force 在**同一组 rows** 上恒等（end-before-start 与 a<=s<b 同语义），flake 纯粹是双读竞态，不是算法分歧。

## Requested action

一行修复：`plugin/test/full-suite-runner-cgroup.test.mjs` 第 1807 行，把对 `real.actualConcurrency` 的断言改为对同一组 rows 用 reader 算法 `actualConcurrencyFromRows(rows)` 重算（该函数已被 import）：

```js
// OLD
assert.equal(real.actualConcurrency, bruteMax, `the reader's ${real.actualConcurrency} equals the independent count ${bruteMax}`);
// NEW
const readerConcurrency = actualConcurrencyFromRows(rows);
assert.equal(readerConcurrency, bruteMax, `the reader's ${readerConcurrency} equals the independent count ${bruteMax}`);
```

（`rows` 就是紧邻下方测试自己读的那组最后 5 行；两个算法吃同一组 ⇒ 无竞态。）

## Acceptance Criteria

- [x] 测试改为用同一组 rows 交叉验证（reader 算法 vs brute-force），不再对活载体读两次。
- [x] `node --test plugin/test/full-suite-runner-cgroup.test.mjs` 绿。

## Definition of Done

修复提交落地 goal 分支（goal_ac=AC-930 路由）；该测试连续跑两次绿。

该轴仍暗,理由:测试竞态修复，无组件代码改动（只改测试断言一行），未跑 archguard/码文档比测量

## Touches

- `tasks/gap-full-suite-runner-cgroup-ac3-live-carrier-double-read-race.md`
- `plugin/test/full-suite-runner-cgroup.test.mjs`