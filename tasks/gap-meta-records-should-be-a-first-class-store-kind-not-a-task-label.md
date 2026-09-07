---
id: gap-meta-records-should-be-a-first-class-store-kind-not-a-task-label
title: meta-driver 的输入/输出应是与 goal/adr/document 同级的第五种 store kind，而不是 task
  上的一个标签——本仓库已有「共享机件、独立 schema」的成熟模式（114 行 base、已应用 4 次），我没用它
status: done
labels:
  - gap
  - defect
  - meta-driver
parent: null
children: []
extra:
  schema: execution
  acceptance: node --experimental-strip-types --test plugin/test/meta-driver.test.mjs
---
## Finding

**人 2026-09-07 裁定（第二次，语气升级）：「还是非常糟糕，还是非常脏。为什么不能做个更干净、和 goal/task 同一层次的机制？如果不想引入更多的机制，就应该把 goal 和 task 也统一了，而不是有的分开有的用额外的标签区别。」**

核准后属实。**答案本来就在架构里，是我没用**（硬规则①：用机件，不手搓——我手搓了一个标签约定，而现成的一等对象模式就在旁边）。

### 一、本仓库已有「同一层次」的模式，已应用四次

`packages/quay/src/goal-store.ts` 头注释逐字：

> A goal record is a **SEPARATE object kind** from tasks (a Provider's own store), ADRs (adr-store.js), and documents (document-store.js) … It reuses the SAME generic frontmatter/lock/filename-resolution mechanics as its two siblings via `frontmatter-store-base.js` — **mechanics are shared, schemas are not**（the base header's "shared MECHANICS, independent SCHEMAS" rule; **this is the third application**）。

实测体量：

```
frontmatter-store-base.ts   114 行（5 个共享 helper：parseFrontmatter / serializeFrontmatter /
                                    slugify / fileNameForId / withFileLock）
document-store.ts           160 行
adr-store.ts                223 行      ← 一种完整 kind 的真实体量
goal-store.ts               812 行（含 gate/criterion/staleness 等 goal 专有机件，非 store 样板）
```

⇒ 已有四种一等对象：**task（Provider 自己的库）/ adr / document / goal**。每一种都有自己的载体目录、schema、CLI、（部分有）MCP 与 web 面。

**而 meta 的「消息」被我做成了 task 上的一个标签**——这就是人指出的不一致：**有的分开，有的用额外标签区别**。

### 二、诚实的成本（⛔ 不要低估，也不要拿错的条款拒绝它）

adr 这种 kind 的**专属登记面实测约 7 个文件**：`adr-store.ts` / `cli/adr.ts` / `mcp-handlers.ts` / `provider-client.ts` / `serve-adr.ts` / `gate/factories/adr.ts` / provider 侧 `mcp-server.ts`。

**⚠️ 不要用 SPEC §5.1 拒绝本条**：那条禁的是**新增 driver kind**（`DRIVER_KINDS`，11 个文件、16 处登记面，理由是 `RoutineSpec` 已经是 probe 的抽象）。**store kind 是另一回事**——`frontmatter-store-base.js` 存在的全部意义就是让新增 kind 廉价而统一，且本仓库已经这样做了三次。两者不可混为一谈。

### 三、准入测试（`goal-store.ts` 头注释自己定的规矩：「why it cannot collapse into any prior kind」）

必须诚实回答，否则不该新增 kind：

| 既有 kind | 它的处理者 / 生命周期 | meta 记录为何不能塌进去 |
|---|---|---|
| **task** | worker 实现；todo→ready→done | 消息**不是要被实现的工作**。实测：6 条打了 `meta-driver` 标签的任务被 worker 派发 **32 次**——真消息若走这条路会被 worker 拿去实现 |
| **goal/AC** | goal-driver 跑 criterion；draft→active→achieved | 消息**没有可跑的 criterion**，也不「达成」 |
| **adr** | 人裁决；proposed→accepted | 消息**不是决定** |
| **document** | 方法论产物；draft→active→retired | 消息不是方法论产物 |

**meta 记录的承重字段（候选，须由执行者定稿）**：
1. **handler = meta-driver**——唯一一种由 driver 的语义半处理的对象；
2. **生命周期 = 提出 → 已答复**（不是 done、不是 achieved、不是 accepted）；
3. **答复内嵌在同一条记录上**——这一条同时解决了输出侧可见性：**问与答在同一个 git 可见对象里**。

### 四、⊢ 一条 kind 同时收拢了我先前拆成三条的问题

| 我先前立的 | 它其实是什么 | 在 kind 方案下 |
|---|---|---|
| `gap-meta-driver-has-no-visible-carrier-or-tools-unlike-task-goal-adr` | 输出/回执不可见（gitignored jsonl） | 答复内嵌在 git 可见记录上 ⇒ 自然解决 |
| `gap-meta-addressedtasks-input-truncates-body-only-title-reaches-probe` | 输入只传 title，正文丢失 | 专用 schema 自己定义送达面 ⇒ 不存在截断 |
| `gap-addressedtasks-conflates-topic-label-with-routing-worker-implements-messages-to-meta` | 标签双义、双消费者 | 消息不再是 task ⇒ worker 根本看不到它 |

⇒ **三条都是同一个根的三个症状**（用错了对象层次），应由本条取代。三条均未开工（无 worktree），可干净废止。

### 五、关于人的另一半提议：「不然就把 goal 和 task 也统一了」

**须正面回答，⛔ 不得回避**。我的判断（供人复核，非定论）：

- goal 与 task **在机件层已经是统一的**——同一个 `frontmatter-store-base.ts`，同样的 frontmatter/锁/文件名解析。
- 它们**分开的是 schema 与处理者，而那是承重的**：goal 有可跑 criterion、`achieved`、active 上限 cap 不变式；task 有四件套闸、派发、fan-in。把两者的 schema 合并会让「AC 的判据」与「任务的四件套」挤在一个 schema 里，⇒ 是退化不是清理。
- ⇒ **人感到的不一致，不是「goal 与 task 分开」，而是「唯独 meta 用标签而不是 kind」。** 把 meta 做成 kind 会**消除**这个不一致，而不是加剧它。
- ⛔ 但这只是我的判断。若人认为 goal/task 也该统一，那是另一条更大的任务，**本条不预设**，只须在实现前确认本条不与那个方向冲突。

**方向倾向（供执行者判断，非强制；三选一并写明理由）**：
- **甲（推荐：第五种 store kind）**——`meta-store.ts` + 载体目录 + CLI + MCP，照 adr 的形状。付第二节那份成本，换一个真正的一等对象。
- **乙（在既有 kind 里加一个 `kind` 取值）**——例如挂进 goal-store 的 `kind:` 维度。**便宜但会污染 goal 的状态词表**（draft/active/achieved 对「提出→已答复」不合），须说明如何不污染。
- **丙（不要对象）**——`orchestration/meta-driver-focus.md` 覆盖段已是干净的要求通道（2026-09-07 09:19 落地，每轮读、变化触发、不经 worker）；`addressedTasks` 诚实降格为「关于你所观测机制的在管任务」这一上下文视图。**代价：回执仍无 git 可见载体**（除非另解）。
- ⛔ **不接受**：①保持现状（人已两次判定为脏）；②只改措辞不改层次；③以 SPEC §5.1（driver kind）为由拒绝一个 store kind（条款不适用，见第二节）。

## 实现落点（本任务 DoD ③④ 与 AC7 的落点，⛔ 不是转述而是结论）

**甲/乙/丙 选择：甲（第五种 store kind）。** 乙（在 goal-store 里加 `kind:` 取值）会污染 goal 的状态词表——`draft/active/achieved` 对「提出→已答复」根本不合，且把「消息」塞进「目标」的 schema；丙（不要对象，只用 focus 覆盖段）保留了「回执无 git 可见载体」的缺陷（正是被取代的 gap-meta-driver-has-no-visible-carrier-* 的根）。甲照 adr/goal 的既有形状走 frontmatter-store-base（共享机件、独立 schema）：新增 `packages/quay/src/meta-store.ts`（META-NNN，proposed→answered，`handler=meta-driver`，`reply` 内嵌）+ `quay-native` shim + `quay meta` CLI + `meta_*` MCP 三个登记面；⛔ 未新增 driver kind（SPEC §5.1 仍然有效）。

**第五节（goal/task 是否也该统一）结论：不必统一，本任务不与那个方向冲突。** goal 与 task 在机件层已经统一（同一个 frontmatter-store-base、同样的 frontmatter/锁/文件名解析），分开的是 schema 与处理者（goal 的可跑 criterion / `achieved` / cap 不变式；task 的四件套闸 / 派发 / fan-in）——把两者 schema 合并是退化不是清理。人感到的不一致不是「goal 与 task 分开」，而是「唯独 meta 用标签而不是 kind」；本任务把 meta 做成 kind，消除该不一致，而非加剧。

**三条被取代任务的覆盖映射（AC7）：**
- `gap-meta-driver-has-no-visible-carrier-or-tools-unlike-task-goal-adr`（输出/回执不可见，gitignored jsonl）→ 被本条的「答复内嵌在同一条 git 可见的 META 记录上、`quay meta show`/`meta_get` 可查」覆盖（AC4）。
- `gap-meta-addressedtasks-input-truncates-body-only-title-reaches-probe`（输入只传 title、正文丢失）→ 被本条的「专用 schema 自己定义送达面，`body` 完整进读数」覆盖（AC5）。
- `gap-addressedtasks-conflates-topic-label-with-routing-worker-implements-messages-to-meta`（标签双义、双消费者，worker 派发 32 次）→ 被本条的「消息不再是 task ⇒ worker 结构上看不到它」覆盖（AC3）。

三条均已置 `superseded`（frontmatter `status: superseded`），本表即各自「被本条哪一部分覆盖」的注明。

**登记面与 `quay driver` 未进 CLI help 缺口的关系（DoD ⑤）：不同源。** 那个已知缺口是「`driver-runtime.ts` 有 `liveness` 子命令、但 `quay driver` 的 CLI VERBS/help 未收录它」——运行时已实现、CLI 表层漏登记。本条的 `quay meta` 动词在三个登记面都登记齐全（`bin/quay.ts` dispatch + `jsonCommands` + fallback usage、`cli/help.ts`、`cli/meta.ts`），`meta_list/meta_get/meta_write` 在四个 MCP 面都登记齐全（provider `mcp-server.ts` + Core `mcp-handlers.ts` + `provider-client.ts` + `abi.ts`）——不存在「实现了但某表层漏登记」的同类缺口。capability-catalog.sh 是 `plugin/scripts/*` 的能力清单（脚本→它回答的问题），不是 CLI/MCP 动词清单；本条的 catalog 登记落在 `meta-driver.ts` 条目（更新其问题声明以反映「消息 = META 记录」这一新能力）。

## AC

- [x] 准入测试被显式回答并写进代码头注释：新 kind 的承重字段逐条列出「为何不能塌进 task / goal / adr / document」，形式与 `goal-store.ts` 头注释同源；⛔ 不接受不作论证直接新建。
- [x] 该对象是**一等**的，由读数证明：存在自己的载体目录（`git ls-files <dir> | wc -l` 非零）、CLI 动词、MCP 工具；三者各由一次**实跑**证明（MCP 那条须是真实调用，⛔ 不是看源码有注册代码）。
- [x] **worker 看不到它（能取假）**：创建一条该 kind 的记录 ⇒ 观察 ≥3 轮派发，`.quay/worker-outcome.jsonl` 中**零**该 id 的派发；作为反向对照，用旧路径（打 `meta-driver` 标签立 task）⇒ **出现**派发。两个方向都实跑。
- [x] **问与答同处一条记录**：meta-driver 的答复落在该记录上（git 可见），发件人**不读 `.quay/` 任何文件**即可查到；由一次真实判读端到端证明。
- [x] 送达面无截断：该 kind 的正文完整进入 probe 提示词，或**显式声明**送达面并使未送达部分可被读出（⛔ 不得静默截断——这正是旧设计的缺陷）。
- [x] 不产生提交洪水（能取假）：内容不变的连续 ≥5 轮，该载体产生的提交数为 **0**；构造一次内容变化 ⇒ 恰 1 次提交。
- [x] 三条被取代任务的处置已落实：`gap-meta-driver-has-no-visible-carrier-or-tools-unlike-task-goal-adr` / `gap-meta-addressedtasks-input-truncates-body-only-title-reaches-probe` / `gap-addressedtasks-conflates-topic-label-with-routing-worker-implements-messages-to-meta` 均置 `superseded` 并在本任务体注明各自被本条的哪一部分覆盖。

## DoD

- [x] 上述判据本轮实跑并贴出输出（⛔ 不是转述），两条能取假的（worker 不可见、洪水）双向都实跑。
- [x] **生产载体证据（非 fixture）**：在真实工作区创建一条记录、跑一轮真实判读、用 CLI/MCP 查到答复；⛔ 不得以单测通过冒充（硬规则④推论三）。
- [x] 甲/乙/丙 选了哪个、为何另两个不合适，写进任务体；选丙须给出回执可见性的替代解。
- [x] 第五节（goal/task 是否也该统一）给出结论并留档：确认本条与该方向不冲突，或指出冲突点交人裁决；⛔ 静默跳过不可接受。
- [x] 登记面登记齐全：新 CLI/MCP 动词进 `plugin/scripts/capability-catalog.sh`（自称唯一清单），并说明与 `quay driver` 未进 CLI help 那个已知缺口是否同源。
- [x] ⛔ 未新增 driver kind（SPEC §5.1 仍然有效，本条只新增 **store** kind）；⛔ 未把该 kind 的记录纳入任何每轮追加的 jsonl；⛔ 未新建只写不读的登记面（SPEC §6.3）。
- [x] **落地后重启 meta-driver 并确认新对象出现在真实轮记录/读数里**——本会话已实测「代码落地但 driver 未重启 ⇒ 生产跑旧代码」，⛔ 不可跳过。

## Touches

- `packages/quay/src/meta-store.ts`
- `packages/quay/src/abi.ts`
- `packages/quay/src/provider-client.ts`
- `packages/quay/src/mcp-handlers.ts`
- `packages/quay/src/cli/meta.ts`
- `packages/quay/src/cli/help.ts`
- `packages/quay/bin/quay.ts`
- `packages/quay/test/cli.test.mjs`
- `packages/quay-native/src/meta-store.ts`
- `packages/quay-native/src/mcp-server.ts`
- `packages/quay-native/bin/quay-native.ts`
- `plugin/scripts/meta-driver.ts`
- `plugin/probes/meta-driver.md`
- `orchestration/meta-driver-focus.md`
- `plugin/scripts/capability-catalog.sh`
- `plugin/test/meta-driver.test.mjs`
- `docs/analysis/quay-init-closure-ratchet.baseline.json`
- `meta/META-001-meta-store-kind.md`
- `tasks/gap-meta-records-should-be-a-first-class-store-kind-not-a-task-label.md`
