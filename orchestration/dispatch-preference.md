# 派发倾向（dispatch preference）—— 正本

> 本文件是 inner 选择「先派谁」时的倾向正本（`SPEC-dispatch-ordering-semantic-2026-08-13.md` §4）。
> 机制只答「能不能派」（disjointness / deps-ready / self-touch / 非 PARKED / 非 compound）；
> 本文件承载「先派谁」的**语义倾向**。三段齐全：**默认段 / 覆盖段 / 维护者字段**；
> 缺任一段即视为文件被破坏（`dispatch-preference-check.ts` 报红，AC54 判据2）。
> 本文件 **git 可见**（不在 gitignored 的 `.quay/` 下），可 diff、抗 compact、跨会话重启存活。

## 默认段

manager 不在时生效（inner/outer 独立运行时回落到这一段）。

- **红窗优先**：存在红色（失败）继承/未收敛红窗时，优先派发与其直接相关的任务。
- **gap 优先于 DIR**：`label:gap` 任务优先于 `label:directive` 任务。
- **其余任选**：同尺寸互斥集内，由 inner 按语义选择，并把「为什么选它」写进派发记录（AC55 产物）。

## 覆盖段

manager 在时的当前倾向（本阶段优先）。

- **⚡ 当前优先级（谓词形，2026-08-24T07:5xZ manager 立）：候选中凡满足
  `frontmatter labels 含 delivery-critical` 者，一律优先于其它候选**，
  除非结构上不可派（Touches 冲突 / 依赖未满 / 非 ready）。多条同时满足时，其相对顺序由 selector 按语义判断。

  **⛔ 本条【不列任务 id】，这是刻意的设计**（2026-08-24 manager 自纠：初版列了两条 id + 一句散文
  「两条落地后此条失效」，那是**无产物的自我承诺**——硬规则 9「守与不守在记录上无法区分 ⇒ 只能靠意志」；
  且过期条目是**惰性**的：任务 done 后离开 ready 池，谓词永远匹配不到，**静默失效且与「从未设过优先级」同形**，
  没有任何机件会报出来）。

  **⊢ 谓词为何自动到期**：它合取了一个**语义项**（`delivery-critical` 标签——由 outer 在立案/晋升时按证据打，
  **从不移除**：实测 72 条带该标签者中 done 69 / superseded 1 / ready 2）与一个**自行衰减项**
  （候选集本身只含 ready 且未在飞的任务）。**到期由那个会自己衰减的项负责，不需要任何人清理。**
  ⇒ 一般形式：**一条会过期的规则，必须包含一个自己会衰减的项**；只写标签的谓词照样会陈旧。

  **⊢ 实测等价性（立本条时的负控制，2026-08-24T07:5xZ）**：该谓词此刻选出的集合 =
  `{gap-worker-driver-stopreason-latch-permanent-stop, gap-worker-needs-human-destroys-branch-worktree}`，
  与初版手写清单**逐字相同**；差别只在这两条落地后谓词自动选不中，而清单需要有人来删。

  **⊢ 何时才该退回清单形**：仅当需要**谓词表达不了的粒度**（如「A 必须排在 B 之前，而两者都带该标签」）。
  那时清单条目必须携带**可机械求值的到期条件**（id 本身即是——检查器可 resolve 其 status），
  且检查器输出须四态可分（无条目 / 全部在册 / 有条目已 done·superseded·不存在 / 覆盖段解析不出），
  **⛔ 后两态不得与 PASS 同形**（硬规则 3b）。

- **⚡ 显式排序（清单形，2026-08-24T11:0xZ manager 立，正是上一条描述的那个触发场景）**：
  `gap-worker-needs-human-destroys-branch-worktree` 必须排在 `gap-worker-driver-stopreason-latch-permanent-stop`
  **之前**——两者都是 delivery-critical 且都 touch `worker-driver.ts`（结构上互斥，同一时刻只能有一个在飞），
  但仅按谓词平级选是不够的：**outer 2026-08-24T11:0xZ 实证一次真实级联**——stopreason-latch 的 worker
  两度翻 done、两度因 destroy-path 缺陷被孤儿清理销毁（分支+worktree 全部消失，AC1-3+DoD 回到全未勾，
  ~1h 实现墙钟白费），根因正是 destroy-path 缺陷本身**尚未修复** ⇒ **不先修 destroy-path，
  stopreason-latch 每次重派都会被同一个缺陷再销毁一次，永远落不了地**。
  **到期条件（可机械求值）**：`gap-worker-needs-human-destroys-branch-worktree` 的 status ∈
  {done, superseded} ⇒ 本条排序约束自动失效，回落纯谓词平级选择（两者不再有依赖关系）。
  **⊢ 与上面谓词形的关系**：这不是退回旧的"手写清单+散文失效"模式——到期条件是 status 检查（机械可判），
  不是散文承诺；且只列了这一对的顺序关系，不是列全部候选，谓词仍然决定"谁进候选池"，本条只决定
  "候选池内这两个具体 id 的相对先后"。
- **覆盖段生效条件**：manager 在场（可见、维护）。manager 不在场时回落到默认段。

## 维护者字段

- **维护者**：manager（负责更新覆盖段；`manager-phase-goal.md` 归属逐字「manager 定义要什么/怎么判 + 维护倾向文件的覆盖段」）。
- **默认段的维护**：inner/outer 在 manager 缺席时按需修订；修订须带回覆盖段并在本字段登记变更。
