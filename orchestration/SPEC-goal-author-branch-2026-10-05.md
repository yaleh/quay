# SPEC：goal-author 分支 —— 让人在 goal 开发期间有一条能安全检出、补文档、并随 goal 进 develop 的分支

**作者**：会话 `goal branch discussion`｜**日期**：2026-10-05｜
**状态**：**proposal（核心已 ruled）**——人 2026-10-05 裁定 §1 ①②；其余为起草者设计，§9 列待裁定。
**来源**：人 2026-10-05「讨论为当前的 goal branch 创建对应的 author branch，使人类用户在 goal 的开发过程中有一个合适的分支可以用于 check out 并补充相应的文档以供审查」→ 一轮讨论后人裁定方案并要求成文。
**前置阅读**：
- `SPEC-goal-branch-2026-10-03.md`（goal 独立分支；**本 SPEC 扩展它，不改其已 ruled 条款**。接触点只有两处：§4.2 生命周期多一条清理、§4.7 并入前置条件多一条）
- `SPEC-release-and-hotfix-branching-2026-09-15.md` §3.1（`author` 的现行角色：本地 doc-only 写面，⛔ 非权威）
- CLAUDE.md「分支同步（author ↔ develop）」一节（author→develop 的现行机制与「develop 权威 wins」的语义兜底）

**证据标注**：【实测】= 起草时在临时仓库或本仓库实跑（2026-10-05）；【读码】= 起草时读当前源码；【人裁定】= 本次讨论中人的原话。⛔ 未标注来源的断言不得进入本文件。

---

## 0. 一句话

**每个 branch-mode goal 可以有一条 `goal-author/<GOAL-NNN>`：人的文档工作分支，从 goal tip 分出，人在自己的 worktree 里检出并提交文档；
这些文档提交由 worker-driver 自动折入 `goal/<GOAL-NNN>`（与 `author` 的提交进入 `develop` 同构），随 goal 一起并入 develop。**

---

## 1. 人的裁定

| # | 日期 | 裁定 | 来源 |
|---|---|---|---|
| ① | 10-05 | 方案：**`goal-author/<GOAL-NNN>`**（而不是 `author/<GOAL>` 或别的名字） | 【人裁定】「同意 goal-author/<GOAL-NNN> 方案」 |
| ② | 10-05 | goal 开发期间补的文档**必须随 goal 一起进 develop**，「这和当前 author 上的 commit 一样」 | 【人裁定】原话 |
| ③ | 10-05 | 动机：人需要一条**可 check out、可补文档、供审查**的分支 | 【人裁定】原话 |

**②的解读（起草者，待确认，§9 Q1）**：「和 author 上的 commit 一样」读作**提交即进入**——文档提交一旦在 goal-author 上，就由机器折入 goal 分支，不需要人再发一个「发布」动作（`author` 上的提交也不需要）。本稿按这个读法写 §4.3；若人要的是显式发布请求，只改 §4.3 的触发。

---

## 2. 为什么需要它（三条实测）

1. **分支名不能用 `author/<GOAL>`**【实测】：本仓库已有一条叫 `author` 的分支，git 拒绝在它之下建子名字：
   `fatal: cannot lock ref 'refs/heads/author/GOAL-028': 'refs/heads/author' exists; cannot create 'refs/heads/author/GOAL-028'`。
   同理 `goal/GOAL-028/docs` 也建不出来（`'refs/heads/goal/GOAL-028' exists`）。`goal-author/GOAL-028` 可建。⇒ 前缀必须与 `author`、`goal` 都不同。
2. **人不能在 `goal/<id>` 上检出**【实测】：fan-in 在合并目标不是主检出当前分支时，用 `git push . <源>:refs/heads/<目标>` 推进它（【读码】`packages/quay/src/fan-in/ff-merge.ts:854` `ffMode = current === mergeTarget ? "merge" : "push"`，`:933-934`）。临时仓库里让 `goal/GOAL-028` 在另一个 worktree 被检出后做同样的 push：
   `remote: error: refusing to update checked out branch: refs/heads/goal/GOAL-028`，goal tip 不动。⇒ **人只要在 `goal/<id>` 上开着 worktree，该 goal 的所有任务落地都会失败。**这也是判据 worktree 必须 detached 的原因。所以「人能安全检出的分支」是必需，不是方便。
3. **现有 author→develop 机制不能原样复用**【读码】：`propagateDocBranchToDevelop`（`plugin/scripts/driver-filters.ts:593`）以**主检出的当前分支**为源、目标写死 `develop`（`ffPushToDevelop` `:330`）；机械 ff 失败时走 `semanticSyncDocToDevelop`（`:474`），其语义是「develop 权威 wins，允许损失 doc 侧变更」。这对机器写的任务状态翻转可以接受；**对人写的文档不可接受**（裁定②要求文档必须进 develop）。

---

## 3. 模型

| goal 世界 | 现行世界 | 角色 |
|---|---|---|
| `goal/<GOAL-NNN>` | `develop` | 权威：经验证的落地线（⛔ 人不检出） |
| `goal-author/<GOAL-NNN>` | `author` | 非权威：人的 doc 工作副本，由机器把它的提交折入权威线 |

- **名字是派生量，不存储**：`goal-author/<GOAL-NNN>`，只能由 goal id 推出，⛔ 不允许人填任意名字。
- **存在条件**：goal 为 `branch: true`、状态 active、`goal/<id>` 存在。goal 并入或放弃后它被清理（§4.5、§4.6）。
- **身份模式**（与 `SPEC-goal-branch` §4.8 同款）：`^goal-author/GOAL-\d{3,}$` 且对应 goal 存在、`branch: true`、状态非 `superseded/retired` ⇒ 合法；读不到 goal store ⇒ `not-evaluated`，⛔ 不当作合法。

---

## 4. 设计

### 4.1 创建与工作区

`quay goal author <GOAL-NNN>`（goal 目前只有 CLI 面，与 `goal merge`/`goal preview` 同处，`packages/quay/src/cli/goal.ts`）：
- 前置：goal `branch: true` ∧ active ∧ `goal/<id>` 存在；否则拒绝并说明。
- 若 `goal-author/<id>` 不存在，从**当前 goal tip** 创建（幂等：已存在则只确保 worktree）。
- 为人建私有 worktree，路径取配置解析出的 worktree 基目录下的 `goal-author-<GOAL-NNN>`（⛔ 不在 /tmp，记录 realpath；与 `goalCriterionWorktreeDir`【读码】`packages/quay/src/goal-store.ts:233` 同一单一推导思路）。
- worktree 的依赖装配**复用** goal 分支 worktree 已有的那一处（`gap-goal-branch-worktrees-lack-node-modules` 落地的函数），⛔ 不抄第三份。
- 输出：分支名、worktree 路径、相对 goal tip 的 ahead/behind、以及一条提示「⛔ 不要在 `goal/<id>` 上检出」。
- 若检测到 `goal/<id>` 已被某个 worktree 检出（`git worktree list --porcelain` 的登记面），打印告警读数（它会让该 goal 的任务落地失败，§2.2）。

### 4.2 goal → goal-author（人看到最新代码）

**人自己 `git merge goal/<id>`**（在自己的 worktree 里，非破坏）。机器**不改写**人的分支历史，也不 rebase。`quay goal author` 的输出里给出 ahead/behind，让人知道该合了。

### 4.3 goal-author → goal（文档折入；与 author→develop 同构）

**触发**：worker-driver 每轮对每个 live branch-mode goal 派生「待折入」——`goal/<id>..goal-author/<id>` 非空，且最近一次折入结果记录的 `(goal tip, goal-author tip)` 与当前不同。⛔ 不存「待折入」标志（同 `pendingGoalMerges` 的派生，【读码】`packages/quay/src/goal-merge.ts:384`）。同一对 tip 上一次红了不重跑；goal-author 前进（人修了提交）或 goal 前进即重新进入待折入。

**执行**（持 `goal` 锁，与任务落地、goal 并入共用同一把，故互斥）：
1. 取人自己的改动：`git diff --name-only goal/<id>...goal-author/<id>`（三点，只含 goal-author 一侧）。
2. **路径检查**：触及 `tasks/` 或 `goals/` ⇒ red `store-managed-path`，点名路径（这些记录由 store 在主 root 写，第二个写者会冲突）。
3. **文档类判定复用现有判据，⛔ 不另设白名单**：`plugin/scripts/select-static-checks-for-touches.ts --classify-delta`（delta ∩ 所有检查器读取路径之并 = ∅ ⇒ doc-only；【读码】该文件 `:239` 起）。doc-only ⇒ 继续；code ⇒ red `not-doc-only`，点名路径（代码改动走任务，不走 goal-author）。
4. **折入**：goal-author 以 goal tip 为祖先 ⇒ **ff**（`ff-merge.ts` 的 `sourceRef`【读码】`:65`，源 = goal-author tip，`mergeTarget` = `goal/<id>`）；否则在临时 worktree（detached 于 goal tip）里 `git merge --no-ff goal-author/<id>`。**冲突 ⇒ red `conflict`，不动任何 ref**——人在自己的分支里 `git merge goal/<id>` 解冲突（§4.2），因为只有人知道文档该怎么取舍。
5. 文档静态检查（`bash scripts/test.sh --static-checks-doc`）绿 ⇒ 推进 `goal/<id>`；红 ⇒ 不动 ref。
6. 结果写一条 `goal-docs-fold-result` GateEvent（`item_id` = GOAL，`payload` 含步骤、原因、两个 tip）。⛔ 事件里不含 fan-in 载体路径（DIR-131，goal-driver 不得读本仓落地载体；折入执行在 worker-driver 侧）。
7. ⛔ **不跑全量 suite**：第 3 步的判据保证没有任何检查器读这些路径，全量 suite 对 doc-only delta 没有信息量（这正是 fan-in 对 doc-only delta 跳过 suite 的依据）。

**「与 author 一样」的落点**：人提交即折入；折入后的下一次任务 fan-in 的追平步骤会把文档带进任务 worktree，并随 goal 并入 develop（§4.5）。**要写一半的东西不要提交到 goal-author**（与现行 DIR-027「在私有分支工作、干净窗口才快进」同一纪律；人用提交的时机控制折入的时机，不需要另设 hold）。

**并发**：折入推进了 goal tip，此时已合入旧 tip 的在飞任务其 ff 会非快进 ⇒ 走既有的再追平重试（`SPEC-goal-branch` §4.4）。代价是偶尔多一次追平，不改变正确性。

### 4.4 `goal show` 的读数（派生，不存储）

docs 折入态直接读 git：`none`（分支不存在）/ `folded`（goal-author 是 goal 的祖先）/ `pending (N commits)` / `blocked: <step>`（取最近一次 `goal-docs-fold-result`）。⛔ 不新增 `folded` 之类的自维护字段（硬规则 4b）。

### 4.5 并入 develop

- **前置条件**（`SPEC-goal-branch` §4.7 增补一条）：`quay goal merge` 要求 goal-author tip 已是 goal tip 的祖先（已折入），否则拒绝，给出折入读数（`docs-not-folded` + 最近一次折入结果）。人可用 `--drop-docs "<理由>"` 显式放弃：理由与被放弃的 goal-author tip SHA 写进请求事件（人能越过，越过留痕——同 `--override` 的纪律）。
- 并入 develop 的合并提交自然带着文档（它们已经在 goal 分支上），⛔ 不需要第二条路径把文档送进 develop。
- **并入成功后清理**：goal-author 分支仅当**没有任何 worktree 检出它**时删除；被检出 ⇒ 读数 `blocked-checked-out`，不删，下一轮再试。⛔ 永远不删人的 worktree 目录（里面可能有未提交的东西）。

### 4.6 放弃（retired / superseded）

同 `SPEC-goal-branch` 裁定⑨：分支废弃。删除 goal-author 之前，把 **goal tip 与 goal-author tip 两个 SHA** 写进进入该状态的 statusLog reason，供人工救援；同样遵守 `blocked-checked-out`。

### 4.7 与 `author` 的关系

两条线并存，不互相替代：`author`（主检出）仍是**全项目**的 doc 写面；goal-author 只放**只对这个 goal 的未成熟改动有意义**的文档。判别：这份文档是否在该 goal 并入前就应该对全项目可见？是（ADR、跨 goal 的 SPEC）⇒ 直接提交 `author`；否 ⇒ goal-author。goal-author 的提交⛔ 不会提前进 develop，与 goal 隔离的初衷一致。

---

## 5. 复用与新增

| 复用 | 新增 |
|---|---|
| goal 锁（`worker-fan-in.ts` `acquireFanInLock` `:1018`，`lockFile` 参数）；worker-driver 执行请求/派生待办的模式（`runGoalMergeFanIn` `:2513`、`pendingGoalMerges`）；`ff-merge.ts` 的 `sourceRef`；`--classify-delta`；goal worktree 的依赖装配函数；身份检查的「模式 + 存在性」形态 | `goal-author` 分支角色（`branch-model.ts`：创建/删除/枚举各一个调用点）；`quay goal author` 动词；折入执行与 `goal-docs-fold-result` 事件；`goal merge` 的 `docs-not-folded` 前置与 `--drop-docs`；放弃/并入时的清理 |
| ⛔ **不**复用：`propagateDocBranchToDevelop`（以主检出当前分支为源、目标写死 develop、失败时 develop 取胜，§2.3） | |

---

## 6. 影响面

| 面 | 改动 | 量级 |
|---|---|---|
| `packages/quay/src/branch-model.ts` | goal-author 角色 | 小 |
| `plugin/scripts/target-identity-literal-check.ts` | 增一条模式 + 存在性 | 小 |
| `packages/quay/src/cli/goal.ts`、`help.ts` | `goal author` 动词；`goal merge --drop-docs` | 小 |
| `packages/quay/src/goal-merge.ts` | 请求事件带 goal-author tip / drop-docs；`docs-not-folded` 前置 | 小 |
| `plugin/scripts/worker-fan-in.ts`、`worker-driver.ts` | 折入执行（锁、路径检查、classify、ff 或临时 worktree 合并、文档检查、事件）、派生待折入、清理 | 中 |
| `goal-store.ts` | 放弃时两个 SHA 写 statusLog | 小 |
| `SPEC-goal-branch-2026-10-03.md` | §4.2/§4.7 各增一条指向本 SPEC 的修订（实现期做） | 小 |
| 未 opt-in 的 goal、无 goal-author 的 goal | **零行为变化** | 无 |

---

## 7. 判据草案（⛔ 本 SPEC 不写 goal store；归属由立案时决定）

每条都读**生产载体**、只计实现落地之后的时间窗（硬规则 4 推论三）。⚠️ **一律用祖先关系（`git merge-base --is-ancestor`），⛔ 不用 `--first-parent`**（develop 的 first-parent 链会被 fan-in 的「合并 develop 再 ff」挤掉，实测 69% 的落地不在其上，见 `SPEC-goal-branch` §7「判据的拓扑前提」）；夹具必须按真实 fan-in 形状造，并含反例臂。

- **甲**（命名）：每个存在的 `goal-author/*` 分支名都匹配 §3 模式，且对应 live branch-mode goal。
- **乙**（折入）：每个 live goal，其 `goal-author/<id>` 的每个提交要么已是 `goal/<id>` 的祖先，要么落在「待折入」读数里且有最近一次 `goal-docs-fold-result`；**不得有既未折入、又无折入结果的提交超过 N 轮**（N 在立案时按实测一轮时长定，⛔ 此处不写字面量）。
- **丙**（不可绕过）：每个成功的 goal 并入，其 goal-author tip 已被合并提交的第二父包含，或请求事件含 `--drop-docs`（带该 tip SHA）。
- **丁**（只折文档）：每次折入的 delta 经 `--classify-delta` 为 doc-only，且不含 `tasks/`、`goals/`。
- **戊**（不删人的东西）：goal-author 被删除时没有 worktree 检出它；人的 worktree 目录始终保留。
- **反例检查**：关掉 §4.3 第 2、3 步的检查后丁必须变红；关掉 §4.5 前置后丙必须变红；让人在 `goal/<id>` 上开着 worktree 时 §4.1 的告警读数必须出现——否则它们是回声。

---

## 8. 非目标

- ⛔ 不自动改写或 rebase 人的分支；冲突由人解。
- ⛔ 不跑全量 suite、不折入代码改动（代码走任务）。
- ⛔ 不处理 `tasks/`、`goals/` 记录（store 在主 root 写）。
- ⛔ goal-author 的提交不提前进 develop。
- ⛔ 不做 goal-author 之间的依赖或相互合并；不做嵌套分支。
- ⛔ 不改 `author` 的现行机制（它仍服务全项目 doc 写面）。

---

## 9. 开放问题（待裁定）

1. **触发方式（Q1）**：本稿按「提交即折入」（裁定②的起草者解读）。备选：人显式发 `quay goal docs publish` 请求，避免任何提交都被自动卷入。起草者倾向保持自动，理由：人用提交时机控制折入时机，与 author 一致，且少一个动词。
2. **折入红时 `goal merge` 的处理（Q2）**：本稿是拒绝并给出原因（`docs-not-folded`），人修好或 `--drop-docs`。备选只警告。倾向拒绝——文档必须随 goal 进 develop 是人的裁定，静默丢文档违背它。
3. **冲突后的便利（Q3）**：是否提供 `quay goal author sync`（在人的 worktree 里替人 `git merge goal/<id>`，冲突则停下交给人）？倾向先不做，等第一次真实冲突再看。
4. **`blocked-checked-out` 的告知（Q4）**：被检出的分支清不掉时，除了读数是否还要主动提示人（例如在下一次 `goal show` 里置顶）？倾向只做读数。
5. **第三方项目（Q5）**：`--classify-delta` 在没有检查注册表的项目会退到 `loop.doc_surfaces` 声明、再退到保守缺省（【读码】`select-static-checks-for-touches.ts` `:95`）。保守缺省下 doc 提交可能被判 code ⇒ 折入 red。是否需要一条明示的降级读数，立案时看实测。

---

## 10. 落地顺序

1. **身份模式 + `branch-model.ts` 角色**：对现有路径零行为变化，可独立先落。
2. **`quay goal author` 动词 + worktree 创建**（复用 goal worktree 的依赖装配）。此时人已经有分支可检出、可补文档——**满足裁定③**，但文档还不会自动进 goal。
3. **折入执行 + `goal-docs-fold-result` + 派生读数**——满足裁定②的「提交即折入」。
4. **`goal merge` 的 `docs-not-folded` 前置与 `--drop-docs`**——使裁定②不可绕过。
5. **并入/放弃时的清理**（`blocked-checked-out`、两个 SHA 写 statusLog）。
6. 选一个真实 goal（建议即 GOAL-028 之后的第一个真实试点）真补一份文档，按 §7 读生产载体验收。

**与硬规则 12**：「文档需要随 goal 进 develop」目前没有发生率读数（还没有 goal-author）；它已被人直接裁定，不降为观察项。第 3、4 步之间不要求先观察。
