---
id: gap-meta-driver-snapshot-tracked-changes-reference-error
title: "meta-driver semantic half is 100% dead: bare
  snapshotTrackedChanges/probeWriteViolations are re-exported, not imported —
  ReferenceError, live for 27 days"
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

该轴仍暗，理由：本任务只修一个模块内标识符绑定错误（加一行 import），不新增/不改变任何生产包间依赖边，也不碰任何 god-package 候选，故 L_D 与 L_G 两轴对本任务结构性不适用。

## Finding

`.quay/meta-driver-round.jsonl` 的 `meta-review` 记录自 2026-09-14 起**连续 100% 失败**（1,746 条 REF、0 条 verified），而机械心跳整段时间照常跳动。根因是**标识符绑定**，不是导入失败：

- `plugin/scripts/meta-driver.ts:1859` 写着 `export { snapshotTrackedChanges, probeWriteViolations } from "./probe-write-guard.ts";`
- `:2432`/`:2441` 却**裸用**这两个符号。
- **ESM 的 `export { x } from "..."` 只绑定到导出表，不在本模块作用域绑定 `x`** ⇒ 裸用即 `ReferenceError`。

2026-09-13 把实现搬到 probe-write-guard.ts 时只补了 re-export、漏了 import ⇒ 次日起语义半全灭。**「静默失败与一切正常同形」的活体实例。**

**为什么必须先修**：ownership/architecture shadow proposer 的安全性正建立在「语义半不得写任何 tracked 文件、一切落盘由机械半在之后执行」这条守卫上。守卫在运行时不可用 ⇒ shadow 无法自证安全。

## Plan (as executed)

1. 在 `meta-driver.ts` 补真 `import { snapshotTrackedChanges, probeWriteViolations } from "./probe-write-guard.ts";`（2 行注释 + 1 行 import，`git diff --stat` = 3 行，re-export 保留：ADR-004 单源、既有 import 路径不变）。
2. 逐条核对：该文件内这两个符号的全部出现（64 import / 1859 re-export / 2438、2447 调用）都可解析，无第二处裸用。
3. 新增 `plugin/test/meta-driver-probe-write-guard-import.test.mjs`（`@test-group engine`），锁**类别**而非实例：凡裸调用 `snapshotTrackedChanges(` / `probeWriteViolations(`，同文件必须有真 `import { … } from "./probe-write-guard.ts"`（⛔ 仅 `export … from` 不算；用去注释后的代码判定，非关键词匹配）。同时断言 re-export 仍在、且 meta-driver 未自行定义这两个符号。

## Touches

- plugin/scripts/meta-driver.ts
- plugin/test/meta-driver-probe-write-guard-import.test.mjs
- tasks/gap-meta-driver-snapshot-tracked-changes-reference-error.md

## AC

- [x] `plugin/scripts/meta-driver.ts` 含真 `import`。**Verified**: `grep -nE '^import \{[^}]*snapshotTrackedChanges'` 命中第 64 行。
- [x] 回归测试通过。**Verified**: 3/3 pass，exit 0。
- [x] **负对照成立**。**Verified**: 临时删掉 import 行后该测试**报红**（AssertionError，指名 `snapshotTrackedChanges(...) bare but has no import`），随后 `diff -q` 确认恢复为字节一致。
- [x] 既有测试不回退。**Verified**: `plugin/test/meta-driver.test.mjs` 133/133 pass，exit 0。
- [x] 未改任何判定逻辑。**Verified**: `git diff --stat` = `1 file changed, 3 insertions(+)`，零删除、零既有语义行改动。

## DoD

```text
真实落地 = import 修复随本任务提交进 develop（已提交 2f847618d），且生产语义半恢复：
.quay/meta-driver-round.jsonl 在提交时刻之后出现至少一条 state:"verified" 的语义半记录。
```

**⚠️ 诚实结果：DoD 只满足一半，不得记作「已验证」。**

- **✅ 守卫本身已修复，且生产已加载新代码**（直接量，非自述）：运维读数显示语义半的失败**模式发生了转移**——`2026-09-14T02:51:40Z` 起是 `REF`（ReferenceError，连 spawn 都到不了），到 `2026-10-09T08:52:02Z` 变成 `E2BIG`。**能报出 E2BIG 就证明代码已经越过了 ReferenceError 那一行**——即 import 修复确实生效（主检出工作树的 mtime 触发了 source-refresh，符合「常驻 driver 从工作树加载」的既有行为）。
- **⛔ 但没有任何 `state:"verified"` 记录**，因为语义半现在撞上**下一个、独立的**阻塞点：`launchArgv`（`driver-runtime.ts:1783`）把整个 prompt 作为**单个 argv 元素**传参，而 Linux 单参数上限 `MAX_ARG_STRLEN=131072`（本会话二分实测），meta-driver 的 readings JSON 实测 **1,281,521 字节**（≈9.8×超限）⇒ `spawn E2BIG`。
- 该缺陷**早于本次修复存在**（2026-09-12 就是 E2BIG），只是被 REF 掩盖了 25 天。已单独立案：`gap-launchargv-prompt-in-argv-exceeds-max-arg-strlen`（⛔ 不在本 task 范围内修，blast radius 是 Layer 0 spawn 原语，须独立验证）。

**结论**：本 task 的自身判据（import 绑定 + 类别回归测试 + 负对照）全部达成；**「生产语义半恢复」这一条未达成，原因是另一个缺陷**，已移交。