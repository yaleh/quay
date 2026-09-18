---
id: gap-prose-prereq-refs-should-exclude-done-referenced-tasks
title: prosePrereqRefs 的 add() 只排除 superseded、不排除 done ⇒
  引用了已完成任务的散文句会被读成「未建边前置」，任务无法自愈地被永久拦在晋升闸外
status: done
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
---
## Finding

**缺陷（实测 2026-09-18，非推断）**：`plugin/scripts/ready-pool-check.ts` 的 `prosePrereqRefs`（约 :1439）内部的 `add(id)` 通过 `readTaskStatusOnDisk` 读被引用任务的状态，**只跳过 `superseded`，不跳过 `done`**。而一个已 `done` 的任务不可能是「尚未满足的前置」。⇒ 只要散文里有一句命中 `PREREQ_KEYWORD_RE` 的话旁边带一个反引号任务 id，而该 id 早已 done，`prosePrereqGap` 仍然非空，任务被 fail-closed 拦在 todo→ready 闸外；且这个状态**无法自愈**——被引用任务已经完成，不会再有任何后续事件让缺口消失，只能靠人改写措辞。

**生产受害体（实测）**：`gap-touches-parser-early-subheading-latch-hides-declaration` 在 `.quay/promotion-outcome.jsonl` 中被跳过 **88** 次，理由均为 `prosePrereqGap=[gap-git-history-window-notes-ref-dominates]`；而被引用的那个任务已于 `2026-09-18T14:28Z`（commit `8ec3fe692`）翻 done。触发句含「当前阻塞器」（关键词 `阻塞`）紧邻一个反引号 id。

**同类先例（发生率至少 2）**：2026-09-15 一个任务因同形机制在 round 378-382+ 被连续拒绝，被引用任务同样已 done（见 `ready-pool-check.ts` 约 :1331 的注释；对应已完成的 `gap-prose-prereq-negation-window-is-before-keyword-only-and-sibling-markers-are-chinese-only`，那条修的是否定词窗口与 sibling 词表，**没有**触及「被引用者已 done」这一轴）。

<!-- dedup-ref -->
**查重（已核）**：`task_list` 对 `gap-prose-prereq` 前缀只有三条，均为 done：`gap-prose-prereq-detector-blind-to-repo-own-conventions`（漏检扩面）、`gap-prose-prereq-negation-blind-and-paragraph-scoped`（作用域与否定）、`gap-prose-prereq-negation-window-is-before-keyword-only-and-sibling-markers-are-chinese-only`（后置否定与英文 sibling）。三者机制均不同，本条治的是「被引用任务状态已是 done 却仍计为缺口」，非重复。

## Requested action

在 `prosePrereqRefs` 的 `add(id)` 里，除现有的 `superseded` 早返回外，再加：`readTaskStatusOnDisk(tasksDir, id) === "done"` 时也早返回。**保持 fail-closed**：`todo` / `ready` / `in-progress` / 未知状态 / 缺失或无法解析的 status **一律仍计入缺口**——未知状态绝不能被当成 done（硬规则 3b：读不懂不得伪装成合格）。不改关系边（`depends_on`）语义；`prosePrereqRefs` 由 ready-pool 分析与 promotion-driver 共用，修一处即两处生效。

## Result

`add()` 改为先取一次 `const status = readTaskStatusOnDisk(...)`，`status === "superseded" || status === "done"` 时早返回；其余取值（`todo` / `ready` / 其他 / `""` / 垃圾 token / `null`）一律保持原有 fail-closed 行为入缺口集。`readTaskStatusOnDisk` 与 `prosePrereqRefs` 的两处文档注释同步更新（硬规则 5b：同一条原则在本文件里有三处表述，一处不改即留漂移）。

**Touches 扩面的理由（硬规则 5b 的产物）**：本条原则的其它实例就在同目录的兄弟夹具里——`ready-pool-check-s17/s18` 里被引用的夹具任务此前一律写成 `status: "done"`，那只表示「这个被引用任务存在」，**不是**被测机制的一部分。新规则下 done 引用在 sibling/scope/polarity/dedup-marker 这些被测机制生效**之前**就被状态过滤丢掉 ⇒ 那些断言会变成恒绿（硬规则 3b 的「空转」形态）。因此把它们的夹具状态改为非 done（`ready` / `todo`），使被测机制重新承重。**忠实性对照**：单独回退源码修复后重跑，s17/s18/s19 全绿、只有新增用例红 ⇒ 夹具改动忠实保留了原行为，没有放宽任何断言。同一扫描面（`grep -rln "analyzeTasks|buildTargetedPromotion"` ∩ `grep -rln 前置|阻塞|Do not dispatch until`）的交集只有 s17/s18/s19，其余 `analyzeTasks` 消费者无散文前置关键词，不受影响。

## Acceptance Criteria

- [x] AC1（先红）在 `plugin/test/ready-pool-check-s19.test.mjs`（若不适合则新建同目录兄弟测试）加用例：任务体含 ``前置：`gap-x` ``，tasks 目录里 `gap-x` 的 status 为 `done` ⇒ `prosePrereqGap` 严格等于 `[]`；修复前该用例**红**，贴原始红输出。
  - 用例：`ready-pool-check-s19.test.mjs` 的 `AC1/AC2 — a prose prereq citing an already-DONE task is not a gap; todo / unknown status stay fail-closed`。
  - **修复前（`git checkout -- plugin/scripts/ready-pool-check.ts` 后跑 `node --test --test-name-pattern="AC1/AC2" plugin/test/ready-pool-check-s19.test.mjs`）**：
    ```
    ✖ AC1/AC2 — a prose prereq citing an already-DONE task is not a gap; …
      AssertionError [ERR_ASSERTION]: ① a ref to a DONE task is dropped at the ref level (pre-fix: ['gap-x'])
      + actual   [ 'gap-x' ]
      - expected []
      ℹ tests 1 / ℹ pass 0 / ℹ fail 1
    ```
    失败点正是第一条断言（`gap-x` 已 done 却仍被采为前置），与 Finding 的机制一致。
  - **修复后**：同命令 ⇒ `✔ AC1/AC2 …` `ℹ tests 1 / ℹ pass 1 / ℹ fail 0`。

- [x] AC2（负控制，防改成恒绿）同一任务体，`gap-x` status 为 `todo` ⇒ 仍为 `['gap-x']`；`gap-x` 无 status 或 status 无法解析 ⇒ 仍被计入缺口；两个方向各贴读数。
  - 同一 `body = "前置：`gap-x`，本任务须待其落地后方可派发。"` 全程复用，**只改被引用任务的 status**：
    | `gap-x` 的 status | `prosePrereqRefs` | `prosePrereqGap` |
    |---|---|---|
    | `done` | `[]` | `[]` |
    | `todo` | `["gap-x"]` | `["gap-x"]` |
    | `ready` | — | `["gap-x"]` |
    | 无 status 字段（`readTaskStatusOnDisk` ⇒ `null`） | — | `["gap-x"]` |
    | `status:` 空值 | — | `["gap-x"]` |
    | `status: ???`（垃圾 token） | — | `["gap-x"]` |
    | 无 frontmatter 块（整段读不出） | — | `["gap-x"]` |
  - 反向读数（① done ⇒ `[]`）与正向读数（② todo/未知 ⇒ `["gap-x"]`）都在同一用例里断言，**缺任一方向该用例即不能同时挡住「恒假」与「恒绿」**。
  - 另：`superseded` 仍被丢弃（既有行为锚点）；`阻塞 `gap-done-other`；前置 `gap-live`。` ⇒ 只丢 done 那条、同句里的活前置仍拦（防「一改就全放行」）。

- [x] AC3（不回归）`node --test plugin/test/ready-pool-check-*.test.mjs plugin/test/promotion-driver-*.test.mjs` 退出码 0，贴 `# tests` / `# pass` / `# fail` 三行。
  - `node --no-warnings --experimental-strip-types --test --test-reporter=tap plugin/test/ready-pool-check-*.test.mjs plugin/test/promotion-driver-*.test.mjs` ⇒ `exit=0`：
    ```
    # tests 224
    # pass 224
    # fail 0
    ```
  - scoped 门（driver fan-in 同一条）：`bash scripts/test.sh --for-task gap-prose-prereq-refs-should-exclude-done-referenced-tasks --allow-thin` ⇒ `exit=0`，`ℹ pass 25 / ℹ fail 0`（Touches 扩面前是 `pass 9` —— 旧 Touches 选不到 s17/s18，正是「门绿在一个不含本次改动的集合上」那个形态，故以扩面后的 25 为准）。
  - **忠实性对照**（本条的关键负控制）：单独回退源码修复、保留夹具改动后重跑 s17+s18+s19 ⇒ **只有新增用例红**（`✖ AC1/AC2 …`），被改夹具的 10 个既有用例全绿 ⇒ 夹具改动没有放宽既有断言。

- [x] AC4（生产读数）落地后，对上述受害体正文（触发句 + 已 done 的引用）在真实 tasks 目录上求值，`prosePrereqGap` 不含那个已 done 的 id；贴读数。
  - 受害体正文取**改写措辞之前**的那一版（`git show 1e1fa1f46:tasks/gap-touches-parser-early-subheading-latch-hides-declaration.md`）——现行文件在 `15:54Z` 被人工改写成「当时在飞，已翻 done 的受害体」，正好把触发词 `阻塞` 从该句拿掉，所以现版正文已不含触发句。触发句即该版 :68：
    ```
    - `有 touches 标题 ∧ globs.length === 0` = **3** 条：`gap-git-history-window-notes-ref-dominates`（在飞，当前阻塞器）、
    ```
  - 在**真实** `tasks/` 目录上求值（`prosePrereqGap(body, frontmatterRaw, tasksDir)`），同一份正文跑两次源码：
    ```
    [PRE-FIX  (develop HEAD)] cited=gap-git-history-window-notes-ref-dominates status=done prosePrereqGap=["gap-git-history-window-notes-ref-dominates"] containsCited=true
    [POST-FIX (this task)  ] cited=gap-git-history-window-notes-ref-dominates status=done prosePrereqGap=[]                                        containsCited=false
    ```
  - 被引用任务 `tasks/gap-git-history-window-notes-ref-dominates.md` 的 status 由同一命令读出为 `done` ⇒ **旧读数正是那 88 次跳过的理由，新读数为空**。

## Definition of Done

**真实落地判据**：被 ready-pool 分析与 promotion-driver 共用的那一份 `prosePrereqRefs` 本体不再把已 done 的引用计为未建边前置；不是只在测试夹具里绿。不改关系边语义，不放宽对 todo/ready/未知状态的 fail-closed。可回滚：还原 `add()` 里新增的一行早返回即可。

**落地位置核验**：唯一改动点是 `plugin/scripts/ready-pool-check.ts` 中 `prosePrereqRefs` 内的 `add()`，即 `if (status === "superseded" || status === "done") return;` 那一行（刻意不写行号：行号随文件上方任何编辑漂移）。AC4 的 POST-FIX 读数正是这份本体在**真实 tasks 目录**上的求值结果（非夹具），故不是「只在测试夹具里绿」。

## Touches

- plugin/scripts/ready-pool-check.ts
- plugin/test/ready-pool-check-s19.test.mjs
- plugin/test/ready-pool-check-s17.test.mjs
- plugin/test/ready-pool-check-s18.test.mjs
- tasks/gap-prose-prereq-refs-should-exclude-done-referenced-tasks.md

<!-- Touches 扩面说明（硬规则 5b）：s17/s18 是本条原则的兄弟实例——两文件里被引用的夹具任务此前一律写
     status: "done"（只表示「被引用任务存在」），新规则下它们在 sibling/scope/polarity/dedup-marker 生效
     之前就被丢 ⇒ 那些断言会退化成恒绿。改夹具状态为 ready/todo 使其重新承重；忠实性对照见 AC3。 -->
