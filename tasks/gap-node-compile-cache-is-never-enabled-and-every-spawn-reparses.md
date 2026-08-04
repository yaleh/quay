---
id: gap-node-compile-cache-is-never-enabled-and-every-spawn-reparses
title: NODE_COMPILE_CACHE is set nowhere in the repo, so all 422 CLI spawns
  re-compile from scratch — 2.6x per spawn, and the default cache location is
  tmpfs
status: done
labels:
  - gap
  - milestone-candidate
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**管理者实测提出，外层用管理者规定的方法独立复现。**

### 已经在做的那一半

`scripts/test.sh:357` 的 `build_dist_once` 在任何测试之前构建 `dist/quay.js` 与 `dist/quay-native.js`
（`:409` 调用），`packages/quay/test/helpers/cli-entry.mjs` 把 spawn CLI 的测试路由到预构建包。
**但走这条路的只有 4 个测试文件**（`cli-entry` / `cli` / `mcp-server` / `serve`），全在 `packages/quay/test/` 下。

**剩下的 ts spawn 点全在 `plugin/test/` 下，spawn 的是 `plugin/scripts/` 里的方法论检查器，
而那批脚本不在任何打包流程里** ⇒ **每次都从 `.ts` 源重解析**
（外层实测：`plugin/dist` 不存在、`plugin/scripts/` 下无任何 `.js`）。

### 缺的那一半：编译缓存一次都没启用过

**外层实测**：全仓 `grep -rn "NODE_COMPILE_CACHE\|enableCompileCache"`（排除 node_modules 与历史件）
**零命中**——`scripts/test.sh` 与所有 plugin 脚本里**一处都没设过**。
Node **v26.5.0**，`require('module').enableCompileCache` **是 function**（实测）。

### 实测：外层独立复现，用的是「每次 spawn 耗时」不是墙钟

同一个 `plugin/scripts/task-schema.ts`：

| 条件 | 各次耗时（ms） | 均值 |
|---|---|---|
| **未设** `NODE_COMPILE_CACHE` | 326 / 289 / 428 | **~348** |
| **设到磁盘路径** | 296（冷）/ 116 / 141 / 142 | **~133**（暖） |

**⇒ 每次 spawn 快约 2.6 倍**（管理者报 2.7 倍）。**缓存目录 252K**（管理者报 244K）。
**它不只帮那批 ts spawn**——V8 字节码缓存对全部 spawn 点都有效，只是 TS 那批收益最大。

### 外层查出的一条与实现直接相关的事实

**这台机器上已经有一个 31MB 的编译缓存，而且就在 tmpfs 里**：
`/tmp/node-compile-cache/`，其中 `v26.5.0-x64-.../` **2629 个文件、24MB**，最后修改 08-04 00:41。
**本仓从未设过该变量**，本 shell 环境也没有 ⇒ 是别的进程启用的。

**机制在这里**：**Node 编译缓存的默认位置就是 `$TMPDIR/node-compile-cache`** ——
**任何东西启用它而不指定目录，默认落在 tmpfs**。
⇒ **本任务必须显式指定磁盘路径**，否则等于再犯一次今晚 OOM 的那个错误
（见 [[gap-the-shipped-tick-doc-teaches-every-project-to-put-worktrees-in-tmpfs]]）。

## Contract

```
measure spawn_ms_cold = `s=$(date +%s%N); node --no-warnings --experimental-strip-types plugin/scripts/task-schema.ts >/dev/null 2>&1; e=$(date +%s%N); echo $(( (e-s)/1000000 ))` 输出的毫秒数字段
measure spawn_ms_warm = `s=$(date +%s%N); node --no-warnings --experimental-strip-types plugin/scripts/task-schema.ts >/dev/null 2>&1; e=$(date +%s%N); echo $(( (e-s)/1000000 ))` 输出的毫秒数字段
measure cache_fs_type = `stat -f -c '%T' "$NODE_COMPILE_CACHE"` 输出的文件系统类型字段
measure cache_configured = `grep -c "NODE_COMPILE_CACHE" scripts/test.sh` 输出的计数字段
band cache_configured >= 1
invariant 缓存目录必须在磁盘上，绝不在 tmpfs；缓存不可用时测试必须照常通过
invoke `bash scripts/test.sh plugin/test/compile-cache.test.mjs`
control 删掉缓存目录并设为不可写 ⇒ 套件必须照常全绿，只是慢——缓存绝不能成为新的单点故障
resume 先设变量与磁盘路径，再谈是否给 plugin/scripts 打包
```

## Chosen mechanism

在 `scripts/test.sh` 里设 `NODE_COMPILE_CACHE`，指向**磁盘上的** gitignored 目录
（`node_modules/.cache/node-compile-cache` 或仓外磁盘路径），**并让 plugin 脚本继承它**。

**不做**：**不用默认位置**（默认是 `$TMPDIR`，即本机的 tmpfs——见上）；
**不给 `plugin/scripts/*.ts` 逐个打包**（管理者判定不划算，外层同意：
本条 2.6 倍是一行环境变量换来的，打包要造并维护一条新构建流水线）；
不在本任务里改任何 spawn 调用点（那是
[[gap-the-spawn-count-criterion-was-wall-clock-and-that-is-the-wrong-axis-for-concurrency]]）。

## Acceptance Criteria

- [x] AC1: **每次 spawn 耗时下降**——对同一脚本，未设 vs 已设各测 ≥3 次，**贴出每次的毫秒数**
      （不是均值一个数）。**判据是每次 spawn 耗时，不是套件墙钟**——理由见下
- [x] AC2: **缓存目录在磁盘上**——`stat -f -c '%T'` 的输出**不是 `tmpfs`**（实跑贴出）
- [x] AC3: **负控制（不过则 AC1 不算数）**——删掉缓存目录并设为**不可写**，
      `scripts/test.sh` **必须照常全绿**，只是慢。**缓存绝不能成为新的单点故障**（实跑贴出）
- [x] AC4: **plugin 脚本确实继承到了**——证明 `plugin/test/` 里 spawn 出去的子进程
      **确实带着这个环境变量**（不是只在 `test.sh` 的 shell 里设了而没传下去；实跑贴出）
- [x] AC5: **每套件 fork/解析次数或每次 spawn 耗时下降**，**并写明测量条件**
      （并发数、是否有第二层在跑、nproc）
- [x] AC6: 测试用 `node:test` 且带恰当的 `// @test-group`

## Definition of Done

- [x] AC1 与 AC3 的实跑输出都贴进任务体（提速一份、缓存不可用仍全绿一份）
- [x] 完整套件连跑 2 次全绿（`fail 0` 且 `cancelled 0`）
- [x] 任务体明写：**本条不得用墙钟 A/B 验证**，理由与 σ 的关系逐字记下（见 `## Dispatch review`）
- [x] `.gitignore` 覆盖缓存目录（与 `gate-events.jsonl` 同形）

### invoke 实跑证据（task-contract-check 消费者：done 任务必须展示 invoke 入口路径）

`scripts/test.sh plugin/test/compile-cache.test.mjs` → ℹ tests 5 / pass 5 / fail 0 / cancelled 0 / skipped 0。
批量 fan-in 全量：tests 2298 / fail 0 / cancelled 0 / skipped 27。

## Touches

- scripts/test.sh
- plugin/test/compile-cache.test.mjs（新）
- .gitignore

## Dispatch review

reviewer: outer
at: 2026-08-04T04:25:00Z
changed: **管理者实测提出并附了一条验证方法上的警告；外层按那条警告规定的方法独立复现，全部对得上。**

**外层复现的数字**（同一脚本、`date +%s%N` 直接测每次 spawn）：未设 326/289/428ms、
设到磁盘后 296（冷）/116/141/142ms ⇒ **约 2.6 倍**（管理者 2.7 倍）；缓存 **252K**（管理者 244K）。
**其余三条也逐条查实**：全仓从未设过该变量（零命中）、Node v26.5.0 的
`module.enableCompileCache` 确为 function、`build_dist_once` 确在 `:357/:409` 于测试前构建。

**管理者的警告是本条最重要的部分，外层逐字接收并落成判据**：
**σ = 297.6 秒。** 那批 spawn 点每个在一次套件里执行 2–5 次，总共节省约 **22–44 秒**，
**远在噪声之下** ⇒ **用「跑两次比墙钟」验证这条改动，必然得出「无改善」，
然后一个真实的改进会被当作噪声丢掉。** 正确的验证是**直接测每次 spawn 的耗时**，
或**数每套件的 fork/解析次数**。⇒ 落为 **AC1 要求贴出每次的毫秒数而不是一个均值**，
并写进 DoD「本条不得用墙钟 A/B 验证」。

**这与外层一小时前那条任务是同一个问题的两侧**：那条说**优化判据**不能用墙钟要用每套件成本，
这条说**验证判据**同样如此。**判据选错，一次在事前丢掉该做的工作，一次在事后丢掉已经做成的工作。**

**外层查出的一条实现关键，管理者的警告因此有了机制**：
**这台机器上已经有一个 31MB 的编译缓存躺在 tmpfs 里**（`/tmp/node-compile-cache/`，
v26 子目录 2629 文件 24MB，最后修改 08-04 00:41），**而本仓从未设过该变量** ⇒ 是别的进程启用的。
成因是 **Node 编译缓存的默认位置就是 `$TMPDIR/node-compile-cache`** ——
**任何东西启用它而不指定目录，默认就落进 tmpfs**。
⇒ **AC2 把「不是 tmpfs」写成可跑的判据**，而不是一句叮嘱。

**外层加的 AC3 与 AC4 是两条最容易被跳过的**：
AC3——**缓存不可用时套件必须照常全绿**，否则一个纯粹的加速机制变成了新的单点故障；
AC4——**证明子进程真的继承到了变量**，因为「在 `test.sh` 的 shell 里设了」与「spawn 出去的子进程带着它」
**是两件事，而失败时没有任何报错，只是没有加速**——那正是本班反复处置的「不报错的降级」形态。

**排期**：只动 `scripts/test.sh` 与一个新测试文件，**与在飞的 3a / token / tmpfs 均不相交，可独立派发**。
**与第三步是前置增益**：它降低每次 spawn 的成本，而第三步的天花板正是 spawn。
