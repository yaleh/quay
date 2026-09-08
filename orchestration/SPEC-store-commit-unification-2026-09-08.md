# 规格：五种 store kind 的提交面统一 —— 一个原语、四态返回、传播跟读者走

**日期**：2026-09-08
**触发**：人「显然，我们应当讨论如何为 task 的提交构建更统一的机制。而且不光是 task，还有 goal 和 meta 等类型的文件。」
→ 讨论后人给出方向：「我倾向于简化设计」「一个可能的调整是增加可选的参数以控制提交行为」「应当为五个 store kind 建立统一的机制」「adr / docs-managed 也要有 commit-after-write」。
**定义者**：管理者。**实现者**：待定（本规格立为 `GOAL-008`，判据见 §7）。
**前身/相邻**：`SPEC-goal-store-2026-08-09.md`（goal store 本体）、`SPEC-goal-mechanism-2026-09-06.md`（goal 机制）、
`tasks/gap-task-ops-consolidate-driver-frontmatter-writers`（done，收敛 parser/writer，**未收敛提交落点**）。

---

## 0. 人 2026-09-08 的裁定（本规格的授权基础）

| # | 裁定 | 影响 |
|---|---|---|
| 1 | 「应当为五个 store kind 建立统一的机制」 | §3 单一原语 `commitStoreWrite`，§4 五 kind 声明表 |
| 2 | 「**adr / docs-managed 也要有 commit-after-write**」 | 解除本规格唯一悬而未决的范围问题；五 kind 齐备 |
| 3 | 「我倾向于简化设计」+ 提出 a（完全不提交）/ b（只提交当前检出） | §2.1 排除 a、采纳 b 作为**默认**；§2.2 用「读者」而非「写者」决定传播 |
| 4 | 「增加可选的参数以控制提交行为……需显式提供参数」 | §3 参数表：默认由 kind 声明，调用方**只在例外时**覆盖 |

---

## 1. 现状（实测，2026-09-08）

### 1.1 五个 kind，三套互不相同的提交机制，两个根本没有

| kind | 文件数 | 7 天 develop 提交 | 写盘即提交 | 实现位置 | root 怎么来 | 分支感知 | 传播 develop | 去重 | 失败可辨 |
|---|---|---|---|---|---|---|---|---|---|
| tasks | 1860 | 1574 | ✓ | `quay-native/src/store.ts:1117` | `git rev-parse --show-toplevel`（memo） | ✓ 三分支 | ✓ ff-push | ✗ | ✓ 四态 |
| goals | 59 | 3980 | ✓ | `quay/src/goal-store.ts:264` | `path.dirname(goalDir)` | ✗ | ✗ | ✓ 剥时间戳 | ✗ boolean |
| meta | 1 | 4 | ✓ | `quay/src/meta-store.ts:77` | `path.dirname(metaDir)` | ✗ | ✗ | ✓ 字节比对 | ✗ boolean |
| adr | 35 | 3 | **✗** | — | — | — | — | — | — |
| docs-managed | 1 | 0 | **✗** | — | — | — | — | — | — |

`frontmatter-store-base.ts` 已经把 parse/serialize/lockfile/filename 抽成共享机件（其头注释：**"shared MECHANICS, independent SCHEMAS"**），
**而 commit-after-write 是一个纯 MECHANIC，它不在里面** —— 这就是本规格的落点，不需要新架构。

### 1.2 四类实质分歧（不是风格问题）

1. **root 解析**：`store.ts` 用 `git rev-parse --show-toplevel`（worktree 里也对）；goal/meta 用 `path.dirname(<kind>Dir)`
   —— 一个「恰好等于当前布局」的假设（**硬规则 4 推论二**）。实测 2 处：`goal-store.ts:265`、`meta-store.ts:78`。
2. **传播**：只有 tasks ff-push 到 develop；goals/meta 提交到「当前检出的当前分支」就不管了。
3. **幂等**：三种各不相同（无 / 剥 `at:` 时间戳后比对 / 字节比对），都是各自治 commit flood 时长出来的。
4. **失败词表**：只有 tasks 有 `committed | not-in-git | nothing | failed` 四态；goal/meta 一律返回 `false`
   —— **「不在 git 里」「内容没变所以跳过」「commit 真失败」三件事同形**（**硬规则 3b**），且发生在一个曾经每小时提交上千次的路径上。

### 1.3 store 之外还有 5 个直写点（本规格的第二阶段，非第一阶段）

7 天内 `tasks/` 的非 merge 提交里，**ABI `task_write` 只占 268 条，驱动直写 581 条 = 68.4%**：

| 写面 | 条数 | 实现 | 落点 |
|---|---|---|---|
| ABI `task_write` | 268 | `store.ts commitTaskWrite` | 主检出 author + ff develop |
| 翻 done / done→ready 收敛 | 294 | `worker-driver.ts:3025 commitTaskStatusChange` | **worktree 的 task/ 分支** |
| todo→ready 机械晋升 | 174 | `ready-pool-check.ts:2503 commitTaskFile` | 主检出 |
| 重试上限翻转 | 68 | `driver-filters.ts:897 commitTaskFile` | 主检出 |
| 首次登记 | 45 | 机械落盘 | 主检出 |

⇒ **同一个 `tasks/<id>.md`，勾 AC 在主检出、翻 done 在 worktree。** 这不是缺陷本身，但它是 §2.2 判准要治的错配。

---

## 2. 判准

### 2.1 排除「完全不提交、会话末尾一起提交」

人提出的方案 a。**排除的理由不是风险大，而是它造成的故障各自已有一条 done 任务在治**：

| 已实证故障 | 载体 |
|---|---|
| 未跟踪的 `goals/*.md` 阻塞 develop→doc ff-only 同步 | `gap-meta-commitgoalfile`（done） |
| 晋升写 status 未提交 ⇒ 挡 fan-in 的 clean-tree 判据 | memory `uncommitted-promotion-blocks-fan-in-clean-tree` |
| 盘上任务体一改**立即**改变另外两层的派发计算，无守卫拦，一次 `git checkout -- tasks/` 静默回退 | CLAUDE.md 硬规则 11b |
| driver 的 `stashIfDirty` 会把别人未提交的改动 stash 掉 | memory `driver-stash-spares-ignored-files` |

**根因：「会话」不是隔离单位。** 实测 7 天内 1490 个会话 cwd 全部是同一个主检出 `/home/yale/work/quay`；
写者包括 promotion-driver / worker-driver / goal-driver / meta-driver / 若干 subagent。
**在一个多写者共享工作树里，「写盘即提交」是唯一能把「我的改动」和「别人的改动」分开的手段** —— 它不是啰嗦，是隔离机制。

### 2.2 采纳「提交到当前检出」为默认，但传播策略跟**读者**走

方案 b **已有生产验证**：goals/meta 今天就是这个语义，实测扫 33 个分支，
**非 merge 的 goals 提交不在 develop 上的 = 0 条**（写它的驱动几乎都在主检出；偶发在 worktree 的也被该任务的 fan-in ff 带进了 develop）。

**本规格的核心判准：**

> **一个写的传播策略，由「谁读这个字段、什么时候读」决定，不由「谁写它」决定。**

| 读者 | 何时读 | 正确传播 | 例子 |
|---|---|---|---|
| **派发/调度**（`ready-pool-check` / `slot-refill` 读 develop ref） | 任务在飞期间持续读 | **必须尽快到 develop** | `task.status`、`depends_on` |
| **该任务自己的 fan-in**（ac-precheck 读 worktree 副本） | 该任务落地时 | **跟着分支走正好** | AC 勾选、`## Evidence`、该 task 关联的 goal 状态更新 |
| **不存在的对象** | — | **必须到 develop** | 新建 goal / 新建 task 立案（不到 develop 就不在池里） |

这条判准解释了一个已实测的缺陷：**AC 勾选属于第二类（fan-in 读），今天却走第一类的路径**（`task_write` ff 到 develop），
于是 `acShortCircuitVerdict` 在 worktree 里看不到它。实测 2026-09-07：
`gap-cli-write-surface-lacks-toplevel-fields` 的 worker 03:32:16 经 ABI 勾满 8 条 AC（提交 `212f4e811` 落 author/develop），
5 分钟后短路判据读 worktree 副本见 0/8 ⇒ `exited-not-landed`，烧掉 45 分钟并重派。
**⇒ 落点与读者错配，才是那个 bug 的根，不是「提交到哪个分支」本身。**

### 2.3 结构消除优先于判断跳过（洪水那一课）

2026-09-06 21:00 – 09-07 01:22 发生过一次 goals commit 洪水：约 3700 条提交，每个 goal 文件被提交 264 次，
内容全是 `evidence.at` 的时间戳重写。**时序是本规格必须记住的教训**：

```
09-06 22:44   修复①落地：stripEvidenceTimestamp（判断型守卫——纯时间戳刷新不提交）
09-06 23:00   1097 条   ← 洪水继续
09-07 00:00   1138 条   ← 洪水继续
09-07 01:22   洪水停止（直接原因在记录里查不到，不作结论）
09-07 02:33   修复②翻 done：evidence 改为 ledger-DERIVED，不再是存储字段（结构型）
09-07 07:51   最后一次 evidence.at 刷新
09-08 03:29   近 20 小时零刷新；近 6 小时仅 2 条 goals 提交，均为真实内容变更；goals/ 工作树 dirty=0
```

**修复①落地后洪水又跑了 3 小时、约 3700 条提交**（硬规则 4 推论三同形：实现落地、测试绿、生产照跑；
最可能是常驻 driver 从主检出加载旧代码，见 memory `driver-code-fix-activation-requires-main-sync-restart`，
但无 01:22 的重启记录可证实，故只作假说）。真正让它不可能复发的是修复②：**没有可刷新的存储字段**。

⇒ **规格结论**：`skipIf` 是必要的兜底，但**能用结构消除的字段，不要留给判断去跳过** ——
判断型守卫要等驱动重启才生效，结构型立即生效。

---

## 3. 统一原语契约

落点：`packages/quay/src/store-commit.ts`（或并入 `frontmatter-store-base.ts`），**五个 store 的唯一提交实现**。

```ts
export type CommitOutcome =
  | "committed"    // 改动已在当前分支历史上（propagated 另行报告）
  | "unchanged"    // skipIf 判定无实质变更，已 restore 到 HEAD，⛔ 不留脏工作树
  | "not-in-git"   // 目标不在 git 工作树内（单测临时目录）—— 有意的 no-op，不是失败
  | "failed";      // git add/commit 真失败 —— 盘上有改动但不在任何分支历史上

export function commitStoreWrite(opts: {
  relPath: string;                 // "tasks/x.md" | "goals/AC-1.md" | "meta/META-1.md" | "adr/ADR-1.md" | "docs-managed/D-1.md"
  message: string;
  root?: string;                   // 默认 `git rev-parse --show-toplevel`  ⛔ 不是 path.dirname(<kind>Dir)
  propagate?: "none" | "develop";  // 默认由 kind 声明（§4），调用方按 §2.2 覆盖
  skipIf?: (head: string, work: string) => boolean;  // 默认字节相同；goal 传剥 `at:` 的比较器
}): { outcome: CommitOutcome; propagated: boolean };
```

**不可协商的四条**：

1. **root 用 `git rev-parse --show-toplevel`**，不是 `path.dirname`。worktree、嵌套 workspace、换布局都正确。
2. **pathspec 限定单文件 + `add`/`commit` 背靠背**（硬规则 11：索引是跨层共享的可变状态，⛔ 绝不裸 `git commit`）。
   `--no-verify`：机械 ABI 写是内容中性的。
3. **四态返回，不是 boolean**（硬规则 3b）。调用方只对 `failed` 落痕告警；`unchanged`/`not-in-git` 是预期状态。
4. **`unchanged` 必须把文件 restore 回 HEAD**，⛔ 不得留脏工作树（脏 `goals/*.md` 会挡 develop→doc ff-only，
   这正是 `gap-meta-commitgoalfile` 修过的 bug）。

---

## 4. 五个 kind 的声明表

每个 kind 在自己的 store 里**声明一次**默认值；调用方只在 §2.2 的例外情形覆盖。

| kind | commit | `propagate` 默认 | `skipIf` 默认 | 理由 |
|---|---|---|---|---|
| **tasks** | ✓ | **`develop`** | 字节相同 | 派发/调度读 develop ref |
| **goals** | ✓ | `none` | 字节相同 | 跟分支；**新建 goal** 由调用方传 `develop` |
| **meta** | ✓ | `none` | 字节相同 | 同上 |
| **adr** | ✓（**新增**） | `none` | 字节相同 | 人 2026-09-08 裁定 2 |
| **docs-managed** | ✓（**新增**） | `none` | 字节相同 | 人 2026-09-08 裁定 2 |

**为什么 `propagate` 要显式声明而不是让原语猜**：今天「goals 不传播」是一个**没人注意到的实现细节**；
声明表把它变成一个**写下来的决定**，改它就是一次可审阅的一行 diff。

**goal 的 `skipIf` 特例退役**：`stripEvidenceTimestamp` 在 evidence 改为 ledger-derived 之后已无对象可剥（§2.3）。
本规格**保留该比较器作为防御纵深，但不再依赖它** —— 它的存在不构成对结构消除的替代。

---

## 5. 迁移顺序（三阶段，后一阶段依赖前一阶段）

**阶段 1（本 goal 的判据面，§7）：原语 + 五 kind 接线。**
建 `store-commit.ts`；`goal-store` / `meta-store` / `quay-native store` 三处删除各自的提交实现改为调用；
`adr-store` / `document-store` 新增调用。带双向负控制单测。

**阶段 2：传播策略按读者归位。**
把 AC 勾选从「ff 到 develop」改回「跟分支走」，并同步修 `acShortCircuitVerdict`（改判 develop ref 与 worktree 副本的并集，
对齐它自称同源的 fan-in step 6.5 ac-precheck）。**这一步会改变生产行为，必须单独一条任务、单独一轮验证。**

**阶段 3：驱动侧 5 个直写点收敛。**
`task-ops.ts commitTaskFile` / `worker-driver.ts commitTaskStatusChange` / `ff-merge.ts:185` / `driver-filters.ts:398`
统一到同一原语（`gap-task-ops-consolidate-driver-frontmatter-writers` 已收敛了 parser/writer，**未收敛提交落点**）。
**⛔ 不与阶段 1 混做**：它触及 68.4% 的写路径。

---

## 6. 范围外（明确不做）

- **不改「写面保留 author」**（人 2026-08-31 裁定）。本规格只统一**提交原语**与**传播声明**，不改哪个分支是写面。
- **不按「会话当前检出」动态解析 root**。实测该量取不到：会话 `f0bf04e3` 07:58 起于主检出，
  08:27 `EnterWorktree` 切到 `.claude/worktrees/driver-of-driver-spec-amendment` 并在那里跑了 5803 条记录，
  其 34 次 `task_write` 的提交仍落 author/develop，而该 worktree 分支**领先 develop 0 个提交、落后 2648**
  —— **MCP server 的 cwd 停在会话启动那一刻，`EnterWorktree` 不改它**。
  需要非默认 root 的调用方**显式传 `root`**（§3），把决定权交给知道答案的一方。
- **不动 `.quay/` 下的运行时状态文件**（gitignored 账本、控制文件）—— 它们不是 store kind。

---

## 7. 判据（= `GOAL-008` 的 AC，全部今天可取假）

| AC | 判据 | 今天的读数 |
|---|---|---|
| **AC-195** | 五个 store 文件中自己实现 `git commit` 的 = **0**（全部委托 `store-commit.ts`） | **3** ⇒ 红 |
| **AC-196** | `store-commit.ts` 输出词表含 `not-in-git` 与 `unchanged`，且旧 boolean 提交函数 = **0** | 文件不存在、旧函数 **2** 个 ⇒ 红 |
| **AC-197** | 五个 store 全部调用 `commitStoreWrite` = **5**（含 adr / docs-managed） | **0** ⇒ 红 |
| **AC-198** | 不再有 `const root = path.dirname(<kind>Dir)`，且原语用 `rev-parse` | **2** 处 ⇒ 红 |
| **AC-199** | 双向负控制单测在默认 suite 里真的跑（`scripts/test.sh <file>` 退出 0） | 文件不存在 ⇒ 红 |

**AC-199 的双向负控制必须包含**（⛔ 缺一不可，否则是回声不是测量）：
① `propagate: "develop"` 关掉 ⇒ develop 拿不到该写；② `propagate: "none"` 打开 ⇒ develop **不**拿到该写；
③ 目标不在 git 工作树 ⇒ 返回 `not-in-git` 而**不是** `failed`；④ 内容字节相同 ⇒ 返回 `unchanged` 且**工作树干净**。

---

## 8. 风险与已知教训

| 风险 | 缓解 |
|---|---|
| 常驻 driver 加载主检出旧代码，修复落地但生产不变（§2.3 实证 3700 条提交） | 阶段 1 落地后**必须核一次生产载体**：`git log develop -- goals/ meta/ adr/` 的提交消息形态变化；⛔ 不以「测试绿」结案 |
| 统一原语把 goals 的高频提交成本也统一进来 | 洪水已由结构消除治住（近 20 小时零 `at:` 刷新）；`skipIf` 保留为防御纵深 |
| 阶段 2 改变生产行为（AC 勾选落点） | 单独任务、单独一轮；并附「fan-in 冲突率」前后对照（7 天基线：291 次 fan-in、31 次冲突、其中 **12 次在 `tasks/*.md`**） |
| ratchet 盲点：`task-file-bypass-check.ts` 按位置匹配 `tasks/` 字面量，**看不到经变量路径的 `fs.writeFileSync(file, …)`** | 阶段 3 扩成 `store-write-bypass-check` 时一并修；⛔ 否则统一完了仍无守卫 |

**残留清理（小，但属于本规格范围）**：59 个 goal 文件中 **19 个**仍带冻结的 `evidence.at` 块
（值分布在 09-07 04:01–07:51），是 evidence 改为 ledger-derived 之后的死数据 ——
**一个不再更新的字段和「一切正常」在记录上同形**（硬规则 4b），应随阶段 1 清掉。
