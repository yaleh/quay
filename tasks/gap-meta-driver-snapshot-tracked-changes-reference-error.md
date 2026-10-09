---
id: gap-meta-driver-snapshot-tracked-changes-reference-error
title: "meta-driver semantic half is 100% dead: bare
  snapshotTrackedChanges/probeWriteViolations are re-exported, not imported —
  ReferenceError, live for 27 days"
status: todo
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

`.quay/meta-driver-round.jsonl` 的**最后一条** `meta-review` 记录（2026-10-09T08:39:53.728Z）仍是：

```
{"name":"meta-review","state":"failed","reason":"routine threw: snapshotTrackedChanges is not defined"}
```

自 2026-09-14 起**连续 100% 失败**（约 1,739 条 failed、0 条 verified），而机械心跳整段时间照常跳动。根因是**标识符绑定**，不是导入失败：

- `plugin/scripts/meta-driver.ts:1853` 写着 `export { snapshotTrackedChanges, probeWriteViolations } from "./probe-write-guard.ts";`
- `plugin/scripts/meta-driver.ts:2432` 与 `:2441` 却**裸用** `snapshotTrackedChanges(root)` / `probeWriteViolations(...)`。
- **ESM 的 `export { x } from "..."` 只绑定到导出表，不在本模块作用域绑定 `x`** ⇒ 裸用即 `ReferenceError: snapshotTrackedChanges is not defined`。

这正是本仓库记忆里已记录过的一般形态（`export {x as y}` 绑定导出表而非模块作用域）。2026-09-13 把实现从 meta-driver.ts 搬到 probe-write-guard.ts 时，只写了 re-export 而没补 import ⇒ 次日（09-14）起语义半全灭。**这是「静默失败与一切正常同形」的活体实例**：机械心跳继续每 ~40-60s 写一行 `facts:[]`，外表健康。

**为什么必须先修**：本任务同时是 ownership/architecture shadow proposer 的**硬前置**——shadow 的安全性正是建立在「语义半不得写任何 tracked 文件、一切落盘由机械半在之后执行」这条守卫上。守卫本身在运行时不可用 ⇒ shadow 无法证明自己安全。⛔ 不允许绕过。

**明确非目标**：不重构 meta-driver 的语义半、不改任何判定逻辑、不重启生产 driver 进程、不接 liveness 健康面（那是独立任务）、不碰任何其它 driver kind。

## Plan

1. 在 `plugin/scripts/meta-driver.ts` 补一条真正的 `import { snapshotTrackedChanges, probeWriteViolations } from "./probe-write-guard.ts";`，与既有 `export { ... } from` 并存（re-export 保留，既有调用点/测试的 import 路径不变——同 probe-write-guard.ts 头注释的 ADR-004 单源约定）。
2. 确认 `meta-driver.ts` 内**没有第二处**同类裸用（`grep -n` 逐条核对 probe-write-guard 导出的两个符号在该文件内的每一次出现：定义/import 之外必须全部可解析）。
3. 加一条**回归测试**，锁死这个类别而不只是这一次实例：对 `plugin/scripts/meta-driver.ts` 做静态检查——凡出现 `snapshotTrackedChanges(` / `probeWriteViolations(` 的裸调用，该标识符必须在同文件内有一条 `import {...} from "./probe-write-guard.ts"`（⛔ 仅 `export ... from` 不算）。**取假形态**：把刚补的 import 行删掉，该测试必须报红（用「已知为真」的缺陷样本干跑谓词，硬规则②）。

## Touches

- plugin/scripts/meta-driver.ts
- plugin/test/meta-driver-probe-write-guard-import.test.mjs
- tasks/gap-meta-driver-snapshot-tracked-changes-reference-error.md

## AC

- [ ] `plugin/scripts/meta-driver.ts` 含一条真 `import`（而非仅 `export ... from`）引入 `snapshotTrackedChanges` 与 `probeWriteViolations`：`grep -qE '^import \{[^}]*snapshotTrackedChanges' plugin/scripts/meta-driver.ts` 退出 0。
- [ ] 回归测试通过：`node --experimental-strip-types --test plugin/test/meta-driver-probe-write-guard-import.test.mjs` 退出 0。
- [ ] **负对照成立**：临时删掉该 import 行后，上一条测试必须**报红**（验证谓词真的能取假），随后恢复。
- [ ] 该文件的既有测试不回退：`node --experimental-strip-types --test plugin/test/meta-driver.test.mjs` 退出 0。
- [ ] 未改任何判定逻辑：`git diff --stat -- plugin/scripts/meta-driver.ts` 显示新增行数 ≤3（一条 import 及其必要换行），无删改既有语义行。

## DoD

真实落地 = import 修复随本任务提交进 develop，且**生产语义半恢复**：`.quay/meta-driver-round.jsonl` 在提交时刻**之后**出现至少一条 `state:"verified"` 的 `meta-review` 记录（⛔ 非 fixture；该载体 gitignored，故判据由执行者在生产机上现场取读数并把时间戳与提交 sha 一并记入本任务）。**本任务不重启任何 driver**——若生产进程未自行加载新代码（source-refresh 未触发），如实记为「代码已修、生产待刷新」并升级，⛔ 不伪装成已验证。