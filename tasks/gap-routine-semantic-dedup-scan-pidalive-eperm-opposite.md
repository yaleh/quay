---
id: gap-routine-semantic-dedup-scan-pidalive-eperm-opposite
title: "semantic-dedup-scan: Three copies treat EPERM as alive
  (exists-but-not-ours) and are byte-identical, but driver-runtime.ts:241
  returns false unconditionally, so the same-named prob"
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
Three copies treat EPERM as alive (exists-but-not-ours) and are byte-identical, but driver-runtime.ts:241 returns false unconditionally, so the same-named probe that gates supervisor restart reads a live-but-foreign pid as DEAD.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1789889905875` · ts `2026-09-20T07:38:25.875Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`pidAlive`
- 涉及文件：
- `plugin/scripts/driver-runtime.ts:241`
- `packages/quay/src/server-state.ts:172`
- `plugin/scripts/start-drivers.ts:115`
- `plugin/scripts/server-partial-stop-verify.ts:411`
- kind：`divergent-implementation`
- verdict：`divergent-implementation`

**⚠️ 这是同一条判定的第四轮**（前三次：`pidalive-eperm-divergence` 09-13、`pidalive-eperm-dead-vs-alive` 09-17、
`pidalive-twin` 09-18）。前几轮未落地 ⇒ 本轮按「修掉」处置，并留一条会咬的回归钉，
⛔ 不以「已注意到」结案（AC2 的原文要求）。

## Requested action
merge

## Disposition（复核与处置）

**结论：修掉 —— divergence 已消除、副本 4→2、并留一条会咬的回归钉。** 结论可核，量法与对照在下面。

### 1. 复核：finding 成立

`pidAlive` = `kill(pid, 0)` 探针。四个副本里三份（`server-state.ts` / `start-drivers.ts` /
`server-partial-stop-verify.ts`）把 EPERM 读成 ALIVE（POSIX 语义：进程存在，只是不属于我们），
`driver-runtime.ts:241` 的第四份用裸 `catch { return false }` 无条件读成 DEAD。本机可复现
（uid=1000；`kill(1,0)` → EPERM，`kill(999999,0)` → ESRCH）：

```
修前  driver-runtime.pidAlive(1) = false      ← 与另外三份相反
修后  driver-runtime.pidAlive(1) = true       （与 Core server-state.pidAlive 是同一个符号对象）
```

⚠️ **finding 标题点的是「gates supervisor restart」，复核后那一条恰恰是最不该算数的**：载体里的 pid
若指向一个不属于我们的进程，它**本来就不是我们的 supervisor**——「旧的没了」在 restart 那一支上是对的
读数。真正被反制的是另外两处，它们的存在理由逐字写在注释里：

- `rmCarrierUnlessForeignLive`（:2703）：「指向**外来的**活进程的载体 = 那个进程在盘上唯一的记录」
- `stopLegacyPair`（:2638）：「⛔ 确认不在之前不摘载体」「停不掉时必须返回 `still-running`，⛔ 不假装 `stopped`」

EPERM 读成 DEAD ⇒ 这两句在**最需要它们的输入**（一个活着的、不属于我们的进程）上不生效。

### 2. 对照实测（硬规则 4 推论四：解释必须配一个「若解释为假则结果会不同」的对照）

夹具 = 让 `.quay/promotion-supervisor.pid` 指向 **pid 1**（本机上「存在但不属于我们」的活进程），跑
**真的** `stopLegacyPair(root, "promotion", { graceMs: 0, killWaitMs: 0 })`。两次运行只差探针那一支，
同一具夹具、同一个函数（脚本 `/tmp/pidalive-control.mjs`；以 root 跑时它拒绝执行）：

| 探针 | `pidAlive(1)` | `verdict` | `remaining` | 载体还在盘上？ |
| --- | --- | --- | --- | --- |
| 修前（EPERM ⇒ DEAD） | `false` | `not-running` | `[]` | **否**（被删） |
| 修后（EPERM ⇒ ALIVE） | `true` | `still-running` | `[1]` | 是（留痕） |

⇒ 修前把「停不掉的活进程」报成「本来就没在跑」，并把它在盘上唯一的记录删掉 —— 正是 `stopLegacyPair`
注释与硬规则 3b 明令禁止的两种形态。**这就是「失败在哪一步」的直接量**，⛔ 不是推理。

### 3. 处置：合并到单一真相源，⛔ 不是改判据再留四份

归并方向取**另三份的读法**（EPERM ⇒ ALIVE）：它是 POSIX 语义，也是本仓库其它三处的既有读法，还是本仓库
若干测试自己写的 `catch (e) { return e.code === "EPERM" }` 辅助函数所用的读法。

- `packages/quay/src/server-state.ts:pidAlive` = **单一真相源**（Core 侧读法本来就对；本次只把入参放宽为
  `string | number | null | undefined` 并 `Number()` 归一 —— pid 载体读出来是**文本**，driver 侧多处正是
  这样调它，⛔ 不改这一条会让 driver 侧把 `"123"` 读成 DEAD）。
- `plugin/scripts/driver-runtime.ts`：**删掉副本**，在既有的「Layer 0 · Core 库符号的单一导入面」一节导入
  并再导出（本文件内部多处直接调用它，故用 import + export，⛔ 不是 `export … from`）。
- `plugin/scripts/server-partial-stop-verify.ts`：**删掉副本**，从 `./driver-runtime.ts` 取 —— 该 import 边
  **本来就存在**（同一行已在导入 `DRIVER_KINDS`），所以这次归并没新增任何依赖。
- `plugin/scripts/start-drivers.ts`：**保留唯一一份副本，是有意的** —— 它是零闭包依赖的 laydown 直入脚本
  （文件末尾的直入守卫：不得 import 任何同级模块），且其唯一调用方 `stopServeHost(pid: number, …)` 手里
  本来就是数字。它的注释已记下本条 finding 与「为什么这一份是例外」。

⇒ **副本 4 → 2**（Core 一份 = 真相源；start-drivers 一份 = 结构上无法归并、语义已对齐、已注明）。

### 4. 回归钉：⛔ 不靠下一次扫描再发现

`plugin/test/driver-runtime-s03.test.mjs` 的 AC2 用例新增两条断言：①EPERM（pid 1）⇒ ALIVE；
②pid 读成**文本**（`readPidFile` 的返回形态）也要真去探、不得读成 DEAD。

**这条钉会咬**（即上面第 2 节那次对照的另一半）：把旧的裸 `catch { return false }` 装回
`server-state.ts`，AC2 立刻红 ——

```
✖ AC2 — pidAlive / readPidFile / aliveness (death direct-quantity, ⛔ not carrier-stall)
  AssertionError [ERR_ASSERTION]: EPERM / 成功都意味着「pid 1 存在」⇒ ALIVE，⛔ 不是 DEAD
```

宿主给不出 EPERM 时（以 root 跑）该断言只走成功支、**没有判别力**，用例会 `t.diagnostic` 明说，
⛔ 不静默当通过（硬规则 3b）。

### 5. 判据实跑

`bash scripts/test.sh --for-task gap-routine-semantic-dedup-scan-pidalive-eperm-opposite --allow-thin`
（worktree 内，develop 已 merge 进来）：**exit 0，115 passed / 0 failed**。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `pidalive-eperm-opposite`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1789889905875`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过（§5 的 scoped gate exit 0 / 115 passed / 0 failed；§2 的对照两次实跑；§4 的钉负对照实跑）
- [x] ⛔ 探针只立案不执行：本任务由例程经 `routine-file-gate.ts` 机械立案，修复由派发链（worker）在本任务自己的 worktree 内执行 —— 例程本身一行都没跑

## Touches
- `plugin/scripts/driver-runtime.ts`
- `packages/quay/src/server-state.ts`
- `plugin/scripts/start-drivers.ts`
- `plugin/scripts/server-partial-stop-verify.ts`
- `plugin/test/driver-runtime-s03.test.mjs`
- `tasks/gap-routine-semantic-dedup-scan-pidalive-eperm-opposite.md`
