---
id: gap-quay-native-task-create-duplicate-id-prepends-frontmatter
title: quay-native task create 对已存在 id 返回 0 并把第二段 frontmatter 前置（静默损坏任务文件 + ABI
  的 status 变成 todo）
status: todo
needs_human_cause: human-adjudication
labels:
  - gap
  - mechanism
parent: null
children: []
extra: {}
---
## Proposal

**缺陷**：`quay-native task create <id> ...` 在 **id 已存在**时**返回 0**，并把一段新的 frontmatter
（含调用方给的 `--title` / `--status`）**前置**到已有的 `tasks/<id>.md` 之上。文件因此出现**两段
frontmatter**，而 ABI（`task view` / `task_list`）读到的是**前面**那一段 ⇒ 一条既有任务的状态被
**静默改写**成调用方传的那个值，同时文件内容被破坏（本仓库自己的任务文件里就能看到这个签名）。

**实测（2026-09-14，ad-arm1 真机，非推断）**：archguard 的任务 `TASK-TSCONFIG-EXTENDS` 当时是
settled `done`（`e997bce1 tasks: 翻 … done（driver 机械 fan-in）`，gate 事件 `payload={"from":"ready","to":"done"}`
actor=`quay-driver`）。一次 `task create TASK-TSCONFIG-EXTENDS --title "AC-257 驱动取证任务" --status todo`
之后：

- 提交 `2247ff8d tasks: TASK-TSCONFIG-EXTENDS task_write by cli:966329` 的 diff **逐字**显示新增了
  `title: AC-257 驱动取证任务` + `status: todo` + `---` 起的一段 frontmatter，**接在原来那段之前**；
- `task view` 随即报 `status: todo`（读到的是前置那一段）；
- 紧接着 promotion-driver 把它 `todo→ready`（`2e5cdf73`），**一条 settled done 的任务由此变成未 done**；
- 该文件此后带两段 frontmatter，直到被人工修复（`b5944654`）。

**为什么比"报个错"更贵**：

1. **静默**——退出码 0、无 stderr、文件看起来"写成功了"；失败形态与"创建成功"同形（硬规则 3b）。
2. **污染面是别人的仓库**——任何用 quay-native 的项目，只要有一次"重复建同 id 任务"，
   它的任务文件就被弄坏，且**没有任何守卫拦**（`task create` 是正常 ABI 动词）。
3. **它使"create 失败 ⇒ 说明已存在"这个惯用写法**（`verify-deliver-coldstart.sh` 的 AC-257 模式
   原实现即如此）**结构上永不成立** ⇒ 调用方的"复用"分支是死代码，而它看起来是活的。
4. 与 `gap-touches-orthogonality-check-relative-import-breaks-in-staged-plugin-copy` 同族：
   **重复写一个已存在的对象**时缺少 fail-closed。

**与既有任务的关系（仅追溯，不构成前置声明）**：本任务只承载 `task create` 这一条动词的重复 id 语义；
`task_write` 的 body 是整篇替换（既有纪律）是另一件事，⛔ 不在此合并。

## Plan

1. 定位 `task create` 的提供方实现（`packages/quay-native/src/` 的 store/create 路径 + core CLI 的
   `task-create.ts` 分发），读出它对"已存在 id"的当前判定（预期：没有判定，直接写）。
2. 改成 **fail-closed**：id 已存在 ⇒ 非 0 退出、**零写入**（文件字节不变），报错文案点名该 id 已存在
   （⛔ 不是静默覆盖、⛔ 不是"帮你改成 update"）。
3. 单测两条：① 对已存在 id 跑 create ⇒ 非 0 ∧ 文件 md5 不变；② 对新 id 跑 create ⇒ 0 ∧ 文件出现。
   沿用既有 `makeWorkspace()`（裸 tasks 目录不是合法 workspace）。
4. 复核 AC-257 模式里那条「先 `task view` 再决定建不建」的写法是否仍需要（它是本缺陷的下游回避，
   产品修好后可作为防御保留，但⛔ 不得把它当成产品已修的替代）。

## AC

- [ ] AC1 复现与修复：对一条**已存在**的 id 跑 `task create` ⇒ 退出码非 0，且该文件 **md5 逐字节不变**；贴命令、退出码与前后 md5。
- [ ] AC2 正例仍在：对一条**不存在**的 id 跑 `task create` ⇒ 退出码 0，文件出现且 `task view` 读得到；贴读数。
- [ ] AC3 单测：上面两条各一条断言；`scripts/test.sh` 对应泳道绿。

## DoD

真实落地 = 在**一个真实的任务文件**上跑一次对已存在 id 的 `task create`，该文件**字节不变**且退出非 0
（⛔ 只有单测不算）；并且新 id 的创建路径逐字未变。

## Needs-Human

**执行 2026-09-14T08:03:14.184Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：连续修满 3 次仍不合格（闸在重验证后仍判不合格）
- 成因类：human-adjudication
