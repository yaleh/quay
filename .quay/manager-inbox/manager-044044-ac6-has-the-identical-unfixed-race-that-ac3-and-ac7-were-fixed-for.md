# manager → outer：本轮红的 AC6 带着 AC3/AC7 已经修过两次的**同一个**竞态，只是没人把修法搬过去

时间 **2026-08-12T04:40:44Z**（真实 `date -u`）· 来源 manager(vhs) · C8 直接发 · **在你的关键路径上**：这轮验的是 `verify-32e2a91c`，即 #58 的 fan-in

---

## 本轮红的读数（`.quay/full-suite-state.json`，pid 3828596 仍在跑，`finishedAt=None`）

```
state=red reason=failed  runner=outer  startedAt=2026-08-12T04:22:25.548Z
verifiedCommit=32e2a91cb0acffff0fc9e7f957bf27c84956485d   scope=worktree  laneCount=4
✖ AC6: --group product,engine ∪ --group lowconc selects the same files as no-args (61791.4ms)
   file=plugin/test/runner-grouping-list-groups.test.mjs  in_family=True  kind=nested-spawn
   __PERFILE__ duration_ms=176588.3  passed=false
not-in-family: packages/quay-backlog/test/backlog-client.test.mjs
```

## 根因：**同一个非原子 glob 竞态，AC6 是三个受害者里唯一没被修的**

引实现，逐行（C6）：

**`plugin/test/runner-grouping-list-groups.test.mjs:78-101` — AC3，已修**

```js
// :79-87 注释原文（作者自己写的根因）
// The two glob reads are NON-ATOMIC. A sibling serial-family test (serial-anti-stomp, running
// concurrently at serial concurrency=2) briefly creates a zz-* fixture in the SHARED plugin/test
// dir; if it lands between --list-files and --list-groups, one count shifts by exactly 1 ...
// ... same philosophy as the AC7 membership fix, gap-runner-grouping-ac7-nested-spawn-load-flake.
:90  for (let attempt = 0; attempt < 4; attempt++) {
:91    files = runTestSh("--list-files").trim().split("\n").filter(Boolean);
:92    g = parseGroups(runTestSh("--list-groups"));
:96    if (files.length + g.serial === g.total) break;
:97  }
```

**`:103-115` — AC6，本轮红，没有任何重试**

```js
:109  const noArgs = runTestSh("--list-files");
:110  const body   = runTestSh("--group", "product,engine", "--list-files");
:111  const low    = runTestSh("--group", "lowconc", "--list-files");
:114  assert.equal(body.replace(/\n$/, "") + "\n" + low, noArgs);
```

**AC6 比 AC3 更暴露，不是更少：**

| | 非原子 glob 读 | 断言形态 | 有界重读 |
|---|---|---|---|
| AC3（已修 `2cc67f78`，01:07:21Z） | **2** 次 | 计数关系 | **有**（`:90-97`） |
| AC7（已修 `bd20f944`） | — | 成员关系 | 有 |
| **AC6（本轮红）** | **3** 次（`:109/:110/:111`） | **逐字节相等**（`:114`） | **无** |

三次 `runTestSh` 之间有两个窗口；断言要求三次调用的输出**逐字节拼接相等**，
所以 `serial-anti-stomp` 在任意一个窗口里建一个 `zz-*` 夹具，就必然不等。
（我查了此刻 `plugin/test/` 下无 `zz-*` 残留——夹具是瞬时的，这与「passes in isolation」一致。）

## 这是一个「按条修、不按类修」的实例，而且注释里有自证

AC3 的修复注释 `:86-87` 逐字写着 **「same philosophy as the AC7 membership fix」**——
**作者当时就知道这是一类缺陷，仍然只修了触发的那一条。** 于是：

```
AC7 flake → 修 AC7   （gap-runner-grouping-ac7-nested-spawn-load-flake, bd20f944）
AC3 flake → 修 AC3   （2cc67f78, 01:07:21Z, r311 绿）
AC6 flake → 现在      ← 同一文件第三次，同一根因
```

**每次修都买来一轮绿，然后下一条断言接着 flake。** 跨轮证据：`00:30:45` 那轮红也是这个文件。

## 我的意见（裁定权在你）

修法在仓库里已经有了，不需要设计：**把 `:90-97` 的有界重读包装抽出来，套到 AC6（以及这个文件里任何做多次 `runTestSh` 再比较的断言）上。**
AC3 的注释已经论证过它为什么安全——「真正的分区破坏是确定性的，每次重读都失败；重试只清瞬时窗，永不掩盖真破坏」。

**不要**把 AC6 简单地标成 flaky 跳过：它测的是 `--group` 分区与无参选择的一致性，是真判据。

**归属**：修法与任务体都归你。我不改实现（§0 边界），只报读数与位置。

## 附：另一个 not-in-family 的失败没有文件上下文之外的信息

`packages/quay-backlog/test/backlog-client.test.mjs` 在同一轮里被 triage 归为 not-in-family。
我**没有查它的根因**（未查 ≠ 无关）。
