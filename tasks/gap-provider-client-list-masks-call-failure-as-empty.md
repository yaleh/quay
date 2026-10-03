---
id: gap-provider-client-list-masks-call-failure-as-empty
title: provider-client 的 adr/goal/meta List 把 isError 降级成 [] ——
  调用失败与「没有记录」同形（硬规则 3b），taskList 已修而三个兄弟未修
status: todo
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

- [ ] AC1（主判据）: provider 的 adr/goal/meta 列表调用返回 `isError` 时，Core **抛错**（或返回一个**可区分于「空列表」**的取值），**不再返回 `[]`**；三个函数各贴实跑输出。
- [ ] AC2: 「调用失败」与「确实没有记录」在调用方必须**可区分**——给出这条可执行的判据，并贴实跑输出证明两种情形取值不同。
- [ ] AC3（双向负控制，两个方向都贴实跑输出）: ① provider 调用失败 ⇒ 得到「失败」态（且不是 `[]`）；② provider 正常但确实零记录 ⇒ 得到「空」态。
- [ ] AC4（一致性）: adr/goal/meta 三个与已修的 `taskList` 语义一致；任务体贴「同形状命中数」（在 packages/quay/src 下 grep `isError) return []` 的处数，并列出各在哪个函数；本任务立案实测 = 3）。
- [ ] AC5: 测试用 `node:test`，带正确的 `@test-group` 标注。
- [ ] AC6（兼容性）: 说明该变更对 github provider（声明不支持 ADR/goal/meta）的影响——**unsupported 与 failure 必须区分**，不得混为一谈，并给出取值设计。

## DoD

- [ ] DoD1（真实落地读数）: 有一个真实跑出来的对照，其中「调用失败」与「零记录」两条路径的返回值可被程序区分（贴实跑输出）。⛔ 只被 fixture/注入 seam 满足的判据不算测量（硬规则 4 推论三）。
- [ ] DoD2: 三个兄弟与 `taskList` 的语义一致（同一判定可读四种 kind），不出现「taskList 抛、adrList 吞」的双标准。
- [ ] DoD3: unsupported（github provider 无该 kind）与 failure（provider 调用炸了）在取值上可区分，不合并。
- [ ] DoD4: 负控（AC3 两向）实际跑过并留痕，不得只贴绿侧。

## Touches

- packages/quay/src/provider-client.ts
- packages/quay/test/adr-store.test.mjs
- packages/quay/test/mcp-adr.test.mjs
- packages/quay/test/cli-adr.test.mjs
- tasks/gap-provider-client-list-masks-call-failure-as-empty.md
