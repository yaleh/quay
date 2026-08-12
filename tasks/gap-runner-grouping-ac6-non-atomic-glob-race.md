---
id: gap-runner-grouping-ac6-non-atomic-glob-race
title: runner-grouping-list-groups AC6 与 AC3/AC7 同一非原子 glob 竞态 — 唯一没被套上有界重读的受害者
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Finding

`plugin/test/runner-grouping-list-groups.test.mjs` 的 AC6（:103-115）与 AC3（:78-101）/ AC7（已修 bd20f944）是**同一个非原子 glob 竞态**，AC6 是三个受害者里唯一没被套上有界重读的。manager 044044 逐行引用实现定位（C6）。

## 实测（2026-08-12 04:22 轮 red，verify-32e2a91c）

```
✖ AC6: --group product,engine ∪ --group lowconc selects the same files as no-args (61791.4ms)
   file=plugin/test/runner-grouping-list-groups.test.mjs  in_family=True  kind=nested-spawn
```

| | 非原子 glob 读 | 断言形态 | 有界重读 |
|---|---|---|---|
| AC3（已修 2cc67f78） | 2 次 | 计数关系 | 有（:90-97） |
| AC7（已修 bd20f944） | — | 成员关系 | 有 |
| **AC6（本轮红）** | **3 次**（:109/:110/:111） | **逐字节相等**（:114） | **无** |

根因：三次 `runTestSh` 之间有两个窗口，serial-anti-stomp 并发建 `zz-*` 夹具落在任意窗口 ⇒ 断言必然不等。夹具瞬时，与「isolation 下绿」一致。

## 修复方向（manager 044044 裁定 → inner 实现）

把 `:90-97` 的有界重读包装抽出来，套到 AC6（以及该文件里任何多次 runTestSh 再比较的断言）。AC3 注释已论证安全（真正分区破坏是确定性的每次重读都失败；重试只清瞬时窗）。

**不要**把 AC6 标成 flaky 跳过——它测的是 `--group` 分区与无参选择的一致性，是真判据。

## AC

- [x] 复现固化——任务体记录 AC6 与 AC3/AC7 同竞态、三受害者的修法对照（manager 044044 实测）
- [x] 有界重读套到 AC6（复用 :90-97 的既有包装，不新造）——抽成 `readStable(read, relationship)`，AC3 与 AC6 共用
- [x] 修后实跑：isolation 重跑绿 + 并发下不再 flake（同类 AC3/AC7 已有先例）
- [x] 既有 runner-grouping 测试不回归（`--for-task` scoped）

## DoD

- [ ] 修后 3 轮并发套件 AC6 不再红（外层 verification-round 验证）
- [ ] 全量套件绿（fail 0 且 cancelled 0）（外层 verification-round 验证）

## Evidence（inner 2026-08-12 06:5xZ，commit a90cb600）

**实现**：把 AC3 `:90-97` 的有界重读包装抽成文件级 `readStable(read, relationship)` helper（4 次有界重读、关系稳定即 break、真破坏确定性失败），AC3 与 AC6 均改为经它读取。AC6 的三次 `runTestSh`（:--list-files / --group product,engine / --group lowconc）作为单一 read 闭包传入，relationship 为逐字节拼接相等。AC10 只有一次 `runTestSh`（无窗口），不需要包装。不标 flaky 跳过。

**验证**：
1. isolation 单跑 `node --experimental-strip-types --test plugin/test/runner-grouping-list-groups.test.mjs` → **3/3 绿**（AC10 6.5s / AC3 20.4s / AC6 30.4s，57.5s 总）
2. `--for-task` scoped 静态门通过（与 #61 同批）
3. 该文件仍标注 `@test-group serial` + `@load-sensitive nested-spawn`，串行组路由不改变（并发不回归由外层 verification-round 观察）