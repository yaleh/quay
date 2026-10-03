---
id: gap-provider-client-list-masks-call-failure-as-empty
title: provider-client 的 adr/goal/meta List 把 isError 降级成 [] ——
  调用失败与「没有记录」同形（硬规则 3b），taskList 已修而三个兄弟未修
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Finding

**缺陷（实测）：provider-client 的三个 List 把 provider 调用失败降级成空数组 —— 调用失败与「没有记录」同形（硬规则 3b）。**

`packages/quay/src/provider-client.ts` 里三个 list 函数在 provider 调用失败时**静默返回空数组**：

- `:181-185` `adrList` → `:183` `if (r.isError) return [];`
- `:204-209` `goalList` → `:206` `if (r.isError) return [];`
- `:232-236` `metaList` → `:234` `if (r.isError) return [];`

**同一个文件里的 `taskList` 已经修好了**：`:113-138`，`:122` 是 `if (r.isError) throw new Error(...);`，且 `:115-121` 的注释明写：调用失败（`isError:true`）**仍然抛** —— 更早的「静默强转空数组」把真实失败与全部合法记录一起藏了；而单个 frontmatter 解析失败现在是**部分成功**（`isError:false`、带 `malformed` 数组），不走这条抛出。

⇒ 这就是硬规则 3b 点名的形状：**判定机件在「读不懂输入」时，返回了与「合格」同形的值**。`[]` 在此**不携带信息** —— 它同时表示「确实没有记录」与「调用炸了」。

**实测证据（这条缺陷造成的真实误判）**：第三方会话在 /data/home/yale/work/claudecodeui 上跑 `adr list --json` 得到 `[]`、exit 0、stderr 除一行 banner 外无任何错误。它据此得出的结论是「**quay 漏扫了我的 ADR 文件**」，并准备按这个方向上报。真实原因相反：quay **扫到了**那些文件，是其中一个文件让 store 层抛错（同族的 store 层缺陷），而这一层的 `return []` 把异常**抹平成空数组**，于是「炸了」呈现为「没有」。**一个 competent 的观察者被这一层引到了反方向。**

**同形状命中数 = 3**（在 packages/quay/src 下 grep `isError) return []`：`adrList` `:183`、`goalList` `:206`、`metaList` `:234`；`taskList` 已改为 throw，不在其列）。

**正确设计同样已在本仓库确立。** `gap-one-unparseable-task-takes-down-the-whole-board` 的 **AC5** 已经就这一点做过裁定：「真正的 `task_list` 调用失败（如 provider 不可达）**仍然抛**」。`taskList` 的 `:122` 就是它的落地。本任务 = 把同一裁定应用到 adr/goal/meta 三个兄弟。

<!-- dedup-ref -->
**去重（按机制，不按症状关键词）**：`task_list` 检索 "isError) return []" / "silent coercion" / "静默空数组"，命中只落在上面那条 **done** 的 task-board 修复（同族先例，不同机制对象）。本任务不是重复立案。

## Requested action

把 `taskList` 已用的裁定推广到三个兄弟，不另造语义：

1. **失败即响亮**：`adrList` / `goalList` / `metaList` 在 `isError` 时**抛错**（或返回一个**可区分于「空列表」**的取值），不再返回 `[]`；取值设计二选一，但必须与 `taskList` 语义一致。
2. **区分失败 vs 空**：调用方必须能区分「调用失败」与「确实没有记录」——给出可执行判据。
3. **区分 unsupported vs failure**：github provider 声明不支持 ADR/goal/meta（无该 kind）与「调用炸了」是**两件事**，不得混为一谈；若都需要表达，给出各自的取值。
4. **一致性**：三个与已修的 `taskList` 同一判定，不出现「taskList 抛、adrList 吞」的双标准。

**不做**：不改 `taskList`（已修好）；不把 unsupported 与 failure 合并。

## AC

- [x] AC1（主判据）: provider 的 adr/goal/meta 列表调用返回 `isError` 时，Core **抛错**（或返回一个**可区分于「空列表」**的取值），**不再返回 `[]`**；三个函数各贴实跑输出。
- [x] AC2: 「调用失败」与「确实没有记录」在调用方必须**可区分**——给出这条可执行的判据，并贴实跑输出证明两种情形取值不同。
- [x] AC3（双向负控制，两个方向都贴实跑输出）: ① provider 调用失败 ⇒ 得到「失败」态（且不是 `[]`）；② provider 正常但确实零记录 ⇒ 得到「空」态。
- [x] AC4（一致性）: adr/goal/meta 三个与已修的 `taskList` 语义一致；任务体贴「同形状命中数」（在 packages/quay/src 下 grep `isError) return []` 的处数，并列出各在哪个函数；本任务立案实测 = 3）。
- [x] AC5: 测试用 `node:test`，带正确的 `@test-group` 标注。
- [x] AC6（兼容性）: 说明该变更对 github provider（声明不支持 ADR/goal/meta）的影响——**unsupported 与 failure 必须区分**，不得混为一谈，并给出取值设计。

## DoD

- [x] DoD1（真实落地读数）: 有一个真实跑出来的对照，其中「调用失败」与「零记录」两条路径的返回值可被程序区分（贴实跑输出）。⛔ 只被 fixture/注入 seam 满足的判据不算测量（硬规则 4 推论三）。
- [x] DoD2: 三个兄弟与 `taskList` 的语义一致（同一判定可读四种 kind），不出现「taskList 抛、adrList 吞」的双标准。
- [x] DoD3: unsupported（github provider 无该 kind）与 failure（provider 调用炸了）在取值上可区分，不合并。
- [x] DoD4: 负控（AC3 两向）实际跑过并留痕，不得只贴绿侧。

## Evidence

实现：`packages/quay/src/provider-client.ts` 新增共享 `unwrapKindList()`，`adrList` / `goalList` / `metaList` 三个 list 都经它解码 —— 与已修的 `taskList` 同一裁定（isError ⇒ 抛）。三态取值：

| 状态 | 取值 |
|---|---|
| failure（provider 的 tool 回答了 isError） | **抛错**（`<tool> failed: <provider 文本>`）—— 永不 `[]` |
| empty（tool 正常回答、零记录） | `[]` |
| unsupported（provider 无该 kind） | `[]` |

**实跑读数（真实 native + 真实 github provider；无 fixture/注入 seam）**：

```
== native provider, ZERO RECORDS (empty) ==
adrList : RESOLVED []
goalList: RESOLVED []
metaList: RESOLVED []
== native provider, CALL FAILURE (carrier dir removed out from under it) ==
adrList : REJECTED ENOENT: no such file or directory, scandir '/tmp/ev-adr-…'
goalList: REJECTED ENOENT: no such file or directory, scandir '/tmp/ev-goals-…'
metaList: REJECTED ENOENT: no such file or directory, scandir '/tmp/ev-meta-…'
== github provider, UNSUPPORTED kinds ==
adrList : RESOLVED []
goalList: RESOLVED []
metaList: RESOLVED []
```

失败向的产生方式是真的、不是注入 seam：native provider 已连接之后，把该 kind 的 carrier 目录删掉，store 的 `readdirSync` 抛 ENOENT（三个 store 都刻意不 catch ENOENT），provider 因此回 isError。

**AC2 可执行判据**：调用方以 `try { const items = await client.adrList() } catch (err) { /* failure */ }` 区分 —— 拒绝 ⇒ failure；兑现的数组 ⇒ empty 或 unsupported。上表同一份读数里 `RESOLVED []` 与 `REJECTED ENOENT…` 字面不同 ⇒ 程序可区分（硬规则 3b）。

**AC3 双向负控（两向都实跑，非只贴绿侧）**：① 失败向 = native 的 carrier dir 在已连接后被删 ⇒ 三个 list 全部 REJECTED；② 空向 = 空 store ⇒ 三个 list 全部 RESOLVED []。两向都在 `packages/quay/test/provider-client.test.mjs` 里断言（`assert.rejects` 与 `assert.deepEqual([])`），并在上表实跑输出里。

**AC4 同形状命中数**：`grep -rn "isError) return []" packages/quay/src` ——
- 立案实测（改前）= **3**：`adrList`（provider-client.ts:183）、`goalList`（:206）、`metaList`（:234）；`taskList` 已改为 throw，不在其列。
- 改后 = **0**（ZERO HITS）。`taskList` 未改。

**AC6 取值设计（unsupported ≠ failure）**：provider 表达「我没有这个 kind」有两条路，**都兑现 `[]`**：① 注册了该 tool 但返回**非错误的空**（github 的 adr_list/goal_list stub，`{adrs:[]}`/`{goals:[]}`，isError falsy）；② **根本没注册**该 tool（github 无 `meta_list`）—— MCP SDK 的 server 端 `tools/call` 把「tool 不存在」与「handler 抛错」压成同一个 `{isError:true, content:[{text}]}` 形状，唯一判别是 SDK 自己的 `Tool <name> not found`（JSON-RPC -32602）文本，`unwrapKindList` **逐字匹配该 tool 名**的这条签名 ⇒ 归为 unsupported；任何**其它** isError ⇒ 抛（failure）。⇒ github 三个 kind 全部 `RESOLVED []`（unsupported，不抛），真实失败全部 REJECTED ⇒ 两者取值可区分、不合并。签名若漂移，失败方向是 fail-LOUD（抛而非静默 `[]`）。

**测试**：`packages/quay/test/provider-client.test.mjs`（`// @test-group product`，全部 `node:test`），5 tests / 0 fail。`node --test packages/quay/test/provider-client.test.mjs` ⇒ `pass 5 / fail 0`。含 AC4 的源码扫描（`packages/quay/src` 下 0 处旧形状）、三条 list 分别走 `unwrapKindList`、以及 taskList 未改。

## Touches

- packages/quay/src/provider-client.ts
- packages/quay/test/provider-client.test.mjs
- packages/quay/test/adr-store.test.mjs
- packages/quay/test/mcp-adr.test.mjs
- packages/quay/test/cli-adr.test.mjs
- tasks/gap-provider-client-list-masks-call-failure-as-empty.md
