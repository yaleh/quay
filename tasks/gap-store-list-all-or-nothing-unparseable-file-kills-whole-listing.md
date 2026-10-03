---
id: gap-store-list-all-or-nothing-unparseable-file-kills-whole-listing
title: 一个文件解析失败拖垮整个 carrier 列表 —— adr/goal/meta/document 四个 store 的 list() 都是全有全无
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

**缺陷（本机实测，非推测）：一个 carrier 文件解析失败，拖垮该 kind 的整个列表。**

`packages/quay/src/adr-store.ts:162-174` 的 `list()` 对每个匹配文件**裸调** `parse()`：`fs.readdirSync` → filter（`f.endsWith(".md") && f.startsWith("ADR-")`）→ `.map(f => { const { frontmatter, body } = parse(fs.readFileSync(...)); return toViewModel(...); })`。它逐文件调 `parse()`（同文件 `:102-108`），而 `parse()` 对没有 YAML frontmatter 的文件直接 `throw new Error("malformed ADR file: missing YAML frontmatter block")`（源在 `:106`）。这是 `map` 不是逐文件 try/catch ⇒ **一个文件抛出，整次列表全灭。**

**实测复现（第三方真实工作区 /data/home/yale/work/claudecodeui）**：该工作区 `adr/` 下有 5 个 `ADR-*.md`，其中 `ADR-003-验证记录.md` 是 ADR-003 的伴随验证记录（正文首行自述「不是该 ADR 的一部分」），**没有 frontmatter**，但文件名以 `ADR-` 开头、`.md` 结尾 ⇒ 被 `list()` 收进来。直接调 store 本体（绕开上层掩码）得到：

```
LIST THREW: malformed ADR file: missing YAML frontmatter block
```

**负控（证明因果，双向）**：把该文件重命名为 `NOTES-003-验证记录.md`（不再匹配 `ADR-` 前缀）后，同一份代码立刻列出 4 条，状态全部正确（ADR-001 superseded / ADR-002 accepted / ADR-003 proposed / ADR-004 accepted）。⇒ 触发条件不是「文件坏」，而是**「文件名匹配 store 的收集谓词、但内容不含 frontmatter」**。

**这是成簇缺陷，不是单点（硬规则 5b）——只修 adr 就是重复犯错。** 同一 `readdirSync().map(裸调 parse)` 形状在四个 store 都在，均已按盘上实际核实（file:line 以盘上为准）：

- `packages/quay/src/adr-store.ts:162-174`（parse 包装在 `:102-108`，throw 在 `:106`）
- `packages/quay/src/goal-store.ts:1617-1636`（`list()`，裸调 `parseFrontmatter` 在 `:1623`）
- `packages/quay/src/meta-store.ts:138-149`（`list()`，裸调 `parseFrontmatter` 在 `:144`）
- `packages/quay/src/document-store.ts:105-116`（`list()`，裸调 `parseFrontmatter` 在 `:110`）

**同形状命中数 = 4**（在 packages/quay/src 下按「`readdirSync` + `.map` 内裸调 parse/parseFrontmatter」这一形状枚举，上面四条即全部；写不出这个数视为只修了被报出来的那一个）。

**测试文件现状（立案实测）**：`adr-store.test.mjs`、`goal-store.test.mjs`、`document-store.test.mjs` 均在；**`meta-store.test.mjs` 不存在** ⇒ 需照相邻 store 测试（adr/document）的形状新建，Touches 里以 `(new)` 标注。

<!-- dedup-ref -->
**正确设计早已在本仓库确立（本任务的关键论据）。** `gap-one-unparseable-task-takes-down-the-whole-board`（status: done）修的是同一机制，只不过对象是 task board（605 分之 1 拖垮整板）。它的 AC 把正确形状钉死：AC1 = 列表在有 1 个不可解析记录时**返回其余全部** + 解析失败清单（含文件名与解析器报错）；AC3 = 坏文件在页面上**显式成行**（复用 `.malformed-row`）；AC4 = 双向负控制。⇒ task board 修好了，adr/goal/meta/document 四个兄弟实例当时没被 grep 到（硬规则 5b：修完一个实例后必须在同一载体里 grep 该原则的其它适用点，并把命中数与前几条贴进提交）。本任务 = 补做那次 grep 的落地。

**去重（按机制，不按症状关键词）**：`task_list` 检索 "malformed ADR" / "missing YAML frontmatter" / "silent coercion" / "全有全无" / "whole listing" 均 0 命中；与本机制相关的既有任务只有上面那条 **done** 的 task-board 修复（不同对象、不同 store）。本任务不是重复立案。

## Requested action

按已确立的形状落地，四个 store 一并修，不另造语义：

1. **逐文件容错**：`list()` 内对每个匹配文件 try/catch 解析，失败的文件**收集**进一个失败清单（`{file, error}`），而不是让整次 `list()` 抛出。
2. **返回形状**：`list()` 返回「可解析记录 + 失败清单」（部分成功），或导出同形的伴随读取器（照 task-board 先例的 `listWithMalformed()`）。
3. **保住响亮失败**：真正的读取失败（carrier 目录不存在 / 权限错误）**仍然抛**，不得被吞成空列表或全是失败记录（AC4 即这条的负控制）。
4. **四个 store 同一形状**：失败清单的字段名与语义一致，调用方能用一个判定读四种 kind。

**不做**：不改任何 carrier 文件的内容；不把解析失败静默丢弃；不引入新依赖。

## AC

- [ ] AC1（主判据）: 四个 store 各自的 carrier 目录里存在 1 个「名字匹配收集谓词、内容不含 frontmatter」的文件时，`list()` **返回其余全部记录**（不抛错、也不返回空数组）；四个 store 各贴实跑输出。
- [ ] AC2: 解析失败的文件**显式出现在返回值里**（一个可枚举的失败清单，含文件名 + 解析器报错），调用方能读出「哪个文件坏了、为什么坏」，而不是被静默丢弃。
- [ ] AC3（双向负控制，两向都贴实跑输出）: 注入坏文件 ⇒ 返回 N−1 条正常 + 1 条失败记录；移除坏文件 ⇒ 恢复 N 条、无失败记录。
- [ ] AC4（防回退负控制）: 真正的读取失败（carrier 目录不存在、权限错误等）**仍然响亮**（抛错或显式失败态），不得被吞成「空列表」或「全是失败记录」；范围限 store 层，provider 调用层不在本 AC 内。
- [ ] AC5（全簇覆盖）: adr/goal/meta/document **四个 store 逐个**有对应测试；任务体贴「同形状命中数」（在 packages/quay/src 下 `readdirSync` + `.map` 内裸调 parse 的 store 数）并列出各文件位置（本任务立案实测 = 4）。
- [ ] AC6: 测试用 `node:test`，带正确的 `@test-group` 标注。

## DoD

- [ ] DoD1（真实落地读数）: 拿一个故意含坏文件的 carrier 目录真跑一遍 store `list()`，列表可用且坏文件在失败清单里成行可见（贴实跑输出）。⛔ 只满足 fixture 的判据不算测量（硬规则 4 推论三）。
- [ ] DoD2: 四个 store 的失败清单**形状一致**（同一字段名、同一枚举语义），调用方能用一个判定读四种 kind。
- [ ] DoD3: 与已修的 task board 形状（部分成功 + 失败清单 + 真失败仍抛）对齐，不另造一套语义。
- [ ] DoD4: 每个 store 的负控（AC3 两向 + AC4）都实际跑过并留痕，不得只贴绿侧。

## Touches

- packages/quay/src/adr-store.ts
- packages/quay/src/goal-store.ts
- packages/quay/src/meta-store.ts
- packages/quay/src/document-store.ts
- packages/quay/test/adr-store.test.mjs
- packages/quay/test/goal-store.test.mjs
- packages/quay/test/document-store.test.mjs
- packages/quay/test/meta-store.test.mjs (new)
- packages/quay/test/frontmatter-store-base.test.mjs
- tasks/gap-store-list-all-or-nothing-unparseable-file-kills-whole-listing.md
