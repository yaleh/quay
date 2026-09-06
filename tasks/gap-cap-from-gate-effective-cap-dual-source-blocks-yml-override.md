---
id: gap-cap-from-gate-effective-cap-dual-source-blocks-yml-override
title: effective_cap 有两个来源——drivers.yml 一改就确定性红全仓，且断言把值写死
status: ready
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**`drivers.yml` 自称是并发 cap 的单一真相源，但 `worker.cap` 实际上不可改——改它会确定性红全仓。**

**实测（双向对照，2026-09-06）**：
```
drivers.yml worker.cap = 2 ⇒ plugin/test/cap-from-gate-bands.test.mjs
                             AssertionError  actual: 2, expected: 5   FAIL
drivers.yml worker.cap = 5 ⇒ 同一测试                                 4 pass / 0 fail
```

**根因：同一个量两个来源。**
- **运行时**：`cap-from-gate` 算出的 `effective_cap` 读 `drivers.yml`（经 `driverCap`/`loadDriverConfig`）
- **常量与测试**：`FIXED_EFFECTIVE_CAP = defaultDriverConfig().worker.cap`（`cap-from-gate.ts:107`）
  读的是**代码默认值**（`driver-config.ts` 里的 5）

只要 yml 与代码默认相同（都是 5），两者恒等、缺陷完全不可见；**一旦有人按文件头注释的说明去改 yml，立刻分叉并红**。

**同族第二处（同日发现，未修）**：`slot-refill.ts:157`
`FIXED_DISPATCH_CAP = defaultDriverConfig().worker.cap` 同样绕开 yml——
独立调 `slot-refill --json` 在 yml=2 时仍报 `cap: 5`。
⇒ **不是孤例，是 `defaultDriverConfig()` 被当成真相源使用的一类**（硬规则 5b：修一处不等于只有一处，
须在同一载体里 grep 全部 `defaultDriverConfig().*\.cap` 的读点并逐一判定）。

**断言本身也有问题（人 2026-09-06 指出）**：
`cap-from-gate-bands.test.mjs:127/139/152` 的断言消息逐字写着
`"effective_cap is the fixed 5"` / `"stays fixed 5"`——**把值写死在消息里**。
即使比较用的是常量，消息里的 `5` 也会在 cap 变更后变成误导性文本。

**代价已发生**：我 2026-09-06 13:5x 按人授权把 cap 临时改成 2 以缓解调度竞争型 flaky，
结果引入**确定性全仓 fan-in 红**（比它要缓解的概率性 flaky 更糟），已撤销（`drivers.yml` 现回 5）。
**在本任务修好前该字段不可用**，这条限制已写进 `drivers.yml` 的字段注释。

## Plan

1. **消除双来源**：让 `FIXED_EFFECTIVE_CAP`（`cap-from-gate.ts:107`）与运行时走**同一个读取路径**
   （`driverCap(root,"worker")` / `loadDriverConfig(root)`），不再用 `defaultDriverConfig()`。
   ⚠️ 注意 `defaultDriverConfig()` 的正当用途仍在——它是 **yml 缺失/不可解析时的回退**
   （`driver-config.ts:18-20` 明写 `concurrency-default-fallback`），**不要连回退一起删掉**。
2. **同族排查**（硬规则 5b）：grep 全仓 `defaultDriverConfig()` 的所有 `.cap` 读点，
   逐一判定该处应读 yml 还是应保留回退；把命中数与判定结果写进提交信息。
   已知至少还有 `slot-refill.ts:157` `FIXED_DISPATCH_CAP`。
3. **断言去字面量**：`cap-from-gate-bands.test.mjs:127/139/152` 的断言消息不再写死 `5`，
   改为插值实际期望值（如 `` `effective_cap must equal the configured worker cap (${expected})` ``）。

## Acceptance Criteria

- [ ] 把 `drivers.yml` 的 `worker.cap` 改成一个非默认值（如 3）后，`node --test plugin/test/cap-from-gate-bands.test.mjs` **仍全绿**（立案时取假：cap=2 时 `actual:2 expected:5` 红）
- [ ] 同一改动下 `node plugin/scripts/slot-refill.ts --in-flight-count 0 --json` 报的 `cap` 等于 yml 的值（立案时取假：yml=2 时它报 5）
- [ ] 负控制：把 `drivers.yml` 临时改坏（不可解析）时，仍回退到 `defaultDriverConfig()` 且不抛——回退路径未被误删（单测断言）
- [ ] `grep -rn 'defaultDriverConfig()' plugin/scripts | grep '\.cap'` 的每个命中点都在提交信息里有"读 yml / 保留回退"的判定
- [ ] 断言消息不含写死的并发数字：`grep -n 'fixed 5' plugin/test/cap-from-gate-bands.test.mjs` 零命中
- [ ] `bash scripts/test.sh --for-task gap-cap-from-gate-effective-cap-dual-source-blocks-yml-override` 退出 0

## Definition of Done

**验收对象是【`drivers.yml` 的 worker.cap 真的可以改】，不是【测试被改绿】。**
把该字段改成 3、跑全量 suite 静态段与 `cap-from-gate-bands` / `slot-refill` 相关测试**全绿**，
且运行时读数（`driverCap` / `slot-refill --json` 的 `cap` / `effective_cap`）三者**一致等于 3**；
改回 5 后同样一致。**只改断言让它绿而运行时仍读两个来源 ⇒ 不算完成**——
那只是把一个可见的分叉重新藏起来。

## Touches

- plugin/scripts/cap-from-gate.ts
- plugin/scripts/slot-refill.ts
- plugin/test/cap-from-gate-bands.test.mjs
- plugin/scripts/drivers.yml
- tasks/gap-cap-from-gate-effective-cap-dual-source-blocks-yml-override.md
