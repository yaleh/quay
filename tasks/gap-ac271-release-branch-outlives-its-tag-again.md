---
id: gap-ac271-release-branch-outlives-its-tag-again
title: AC-271 在 v0.10.0 切版后连红 4 次、靠一次无记录的外部删除才回绿：结束步在切版动作里没有载体，且 finish
  命令的合规定义与判据不一致（对本轮形态默认拒绝）
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-271
---
**type:** execution

## Finding

**缺口｜AC-271 的保证在 v0.10.0 切版后失效了约 10 分钟，其间判据连红 4 次；把它变回绿的是一次没有任何记录的外部删除，不是机制。**

> **⚠️ 状态变更（2026-09-19T03:38:24Z，在本任务首次写入之后数分钟内）**：
> `release/v0.10.0` 已不可解析（`git rev-parse` → unknown revision），判据翻回 `verdict=pass`
> （03:39:02Z 复测仍 pass）。**这次删除没有留下任何痕迹**：`.git/logs/refs/heads/release/` 随分支
> 一起消失、无提交、`orchestration/dispatch-record.jsonl` 无记录、当时 worker driver 为
> `pool-empty` 空闲（`.quay/worker-round.jsonl` 03:31:28Z `action=stop`）⇒ **「谁删的、用什么命令删的」
> 在本仓库不可查**。
> ⛔ **这不是本任务的完成**，也不是「问题不存在了」：判据转绿的原因是**一次无记录的外部动作**，
> 而本任务要修的三条结构缺陷一条都没动。下面所有读数都是**历史读数**（保留为证据），
> 现状读数见 AC1。

**立案当轮的两次独立测量**（主检出 `/home/yale/work/quay`，2026-09-19T03:3xZ，都是直接量）：

```
$ node packages/quay/bin/quay.js goal gate AC-271
{"verdict":"fail","reason":"acceptance failed (exit 1) — CAUSE=release-branch-not-parked-on-a-tag —
 1 of 1 release branches have a tip that is not any tag: release/v0.10.0 => …"}
EXIT=1                       ← store 自己的 runner（与 driver 复跑同一入口）；复跑第二次同为 EXIT=1
$ python3 …（AC-271 criterion 逐字）
→ rc 0，输出 'release/v0.10.0'；`git tag --points-at release/v0.10.0` → 空     ← 违规分支
```

判据的两级谓词本身正常：`for-each-ref` exit 0 且列得出分支名、`tag --points-at` exit 0 而输出为空
⇒ ⛔ **不是仪器故障**（`CAUSE=for-each-ref-failed` / `tag-points-at-failed` 两个分支都没走）。

`.quay/gate-events.jsonl` 里这次红绿的完整轨迹（同一个 actor `goal-cli`，同一个判据）：

```
03:21:08Z pass        ← 切版开始前
03:28:56Z fail        ← release/v0.10.0 于 03:27:02Z 创建、03:27:27Z 打 bump、03:28:14Z 在 merge
03:31:21Z fail          commit 上打 tag v0.10.0 —— 判据在 tag 落下后 42 秒即翻红
03:31:54Z fail
03:33:58Z fail        ← 连红 4 次
03:38:24Z pass        ← 一次无记录的外部删除之后
```

**历史读数（立案当轮）**：

| 量 | 值 |
|---|---|
| `git rev-parse release/v0.10.0` | `8c7b85e79d06d779735ea07b0c2733c366d92da2` |
| `git tag --points-at release/v0.10.0` | （空） |
| tag `v0.10.0` 所在提交 | `4c8116632`（附注 tag；**现在仍在**） |
| `git rev-list --count release/v0.10.0..v0.10.0` | `1`（tip 严格落后 tag 一个提交 = 那个 merge commit） |
| `git merge-base --is-ancestor release/v0.10.0 v0.10.0` | **真**（tip 是 tag 的祖先 ⇒ 删它不丢任何提交） |
| `git rev-list --count develop..release/v0.10.0` | **1** |
| `git rev-list --count develop..develop-v0100-merge` | `3`（这次切版的合回落在这条旁支上，尚未进入 develop） |
| `git ls-remote --heads origin release/v0.10.0` | （空，只存在于本地） |

**缺陷一：判据与命令不是同一份合规定义 ⇒ 命令对本轮这种形态默认拒绝。**
v0.10.0 的合回落在旁支 `develop-v0100-merge`（tip `225c81e17`）而非 develop，而
`plugin/scripts/release-branch-finish.sh` 的合回谓词默认以 develop 为基：

```
$ bash plugin/scripts/release-branch-finish.sh release/v0.10.0 --dry-run
CAUSE=release-branch-not-merged — 'release/v0.10.0' carries 1 commit(s) not in develop;
  deleting it would lose work. Merge it back first, or park its tip on a tag (AC-271 accepts either)
EXIT=3
```

**判别性对照（硬规则 4 推论四）**：同一条分支上 `git merge-base --is-ancestor release/v0.10.0 v0.10.0`
= **真**（该提交由 tag `v0.10.0` 持有，删了什么都不会丢），而命令判「删了会丢工作」并**拒绝**。
⇒ 两个假设给出**相反**预测：若残留成因为「没人执行删除」，命令本应**接受**这条分支；实测它**拒绝**。
⇒ 与实测一致的解释是：**判据认「tip 停在 tag 上」，命令只认「已回到 develop」**——两者不是同一份
合规定义，于是「按规程删除」这一步对本轮形态在物理上做不到。
⛔ 不断言人事上究竟发生过什么：删除没有任何痕迹（见缺陷三），所以「那次删除走的是命令还是手搓」
**不可查**；而由于默认基会拒绝，机制内的删除**必须**带 `--base`（`--base <tag>` 是既有能力）。

**缺陷二：结束步在切版动作里没有载体。** `gap-release-branch-deleted-after-merge`
（AC-271，done 2026-09-15T16:20）交付的是 ① 上述命令、② 用它删掉当时遗留的两条 `release-v06x-build`；
其任务体把范围明确限为**删除半边**，**没有把结束步接进切版动作**。此后又发生 3 次 release cut
（`ae28758aa` v0.8.0 / `17cf30678` v0.9.0 / `4c8116632` v0.10.0），第 3 次留下了可见残留。
SPEC §4.1 把这条协议写成 prose（「合回 → 在合并点打 tag → 【删除分支】」），而 ADR-004 点名的
正是这个形态：**写成 prose 的协议会被复述掉**。⛔ 本任务不接受再往 SPEC/skill 里补一句「记得删」。

**缺陷三：这一步没有产物 ⇒「有没有做、怎么做的」在记录上不可区分**（硬规则 9：可见性 ≠ 执行）：
`grep -n 'log|tee|jsonl|>>' plugin/scripts/release-branch-finish.sh` → **无命中**：命令只写
stdout/stderr，删除成功不留任何持久痕迹。本轮的直接后果已经实测到：03:38 那次删除**无法归因**
（是手搓 `git branch -D`，还是带 `--base` 走了命令？不可查）。

**一处必须写明的约束（避免实现者白走一轮）**：`release-*` / `release/*` 分支**只存在于本地**
（`git ls-remote --heads origin release/v0.10.0` 为空；上一轮两条亦然）⇒ **任何远端侧的载体
（例如 release workflow 里新增一个 job）在结构上够不到这些 ref**，载体必须落在本地侧。

**发生率**（硬规则 12：先给读数）：上一轮修复之后的 release cut = **3** 次，其中判据被切版动作翻红
= **1** 次（连红 4 个读数、跨约 10 分钟）。⛔ 本任务**不以发生率为前置**：AC-271 是 `long-term: true`，
它要的是**保证**，而现在这个保证的成立依赖「有人恰好想起来删」——本轮已实测到它曾经不成立。

**边界（⛔ 不做）**：不改 release 分支命名（判据不解析分支名）；不把判据放宽成「允许在 tag 之后生长」
（那是把红判据改绿）；不实现改写历史的 `--park`，除非实现者能给出它比删除更安全的实测理由——SPEC §4.1
的协议是删除，判据接受「删除」或「tip 停在 tag 上」两种合规形态。

<!-- dedup-ref -->
同族但机制不同，故不是重复：`gap-release-branch-deleted-after-merge`（AC-271，done）交付的是命令本身
+ 一次性清理，未接进切版动作、也未让命令认「tip 可达其版本 tag」这一合规形态——本任务补的正是它未覆盖
的那半边。`gap-release-yml-drop-sea-npm-gate-on-plugin-channel-instead`（AC-274，done）的正文叙述了
「用 release-branch-finish.sh 删除 release/vX.Y.Z」，那是规程的**叙述**而非**载体**（该条至今未勾，
标注为待外部验证）。

## Requested action

1. **先取证（任一不满足就停并报告，不代做别的任务的实现）**：贴出**现在**的
   `git for-each-ref --format='%(refname:short)' refs/heads/release-* 'refs/heads/release/*'`（本轮为
   空）与 `git rev-parse release/v0.10.0` 的失败形态；并确认 `git rev-parse v0.10.0^{commit}`
   = `4c8116632` 仍在（分支消失不得连带丢 tag）。⛔ 不得把 03:38 那次删除记成本任务的功劳——
   它发生在立案之后、无痕迹、成因不可查。
2. **对齐合规定义（命令侧）**：让 `plugin/scripts/release-branch-finish.sh` 的合回谓词认
   「tip 可达其版本 tag」这一合规形态——判据与命令必须共用同一份合规定义。⛔ 任何放宽必须保持
   fail-closed：**既不在 develop、也不在任何 tag 里** ⇒ 仍然拒绝（那是唯一的真「会丢工作」形态）。
3. **给结束步一个本地侧的载体 + 可查痕迹**：使「这次切版走完了」与「分支已消失（或停在 tag 上）」
   是同一件事的一部分，且「某次切版有没有走完结束步」在记录上可区分（硬规则 9）。⛔ 载体必须落在
   **本地侧**（见 Finding 末段的实测约束）；⛔ 不接受只改 SPEC/skill 措辞。
4. **两条负控制（硬规则 4c：落笔当轮当场干跑一次）**：
   - **命令侧**：在真实仓库造一条 tip **既不在 develop 也不在任何 tag** 的 release 分支 ⇒ 命令必须
     **拒绝**（独立退出码 + 独立 `CAUSE=`）且该分支仍在。这是第 2 步放宽的**唯一护栏**：没有它，
     「认 tag」会退化成「什么都认」。
   - **判据侧**：造临时分支 `release/v0.0.0-nc`（develop tip + 一个 develop 上没有的提交）⇒ 逐字跑
     AC-271 的 criterion ⇒ 期望 exit 1 + `CAUSE=release-branch-not-parked-on-a-tag` 且列出该分支名
     与总数；同一动作序列内删除该分支后再跑 ⇒ 期望 exit 0。⛔ 两次读数都要贴，临时分支必须同轮删掉。
5. **登记与测试**：命令若有行为变更或新 flag，按 `plugin/scripts/capability-catalog.sh` **头部自述
   的规则**补齐该文件要求的表项（读文件，⛔ 不照抄任何清单）；行为变更必须有测试进入套件泳道
   （`plugin/test/release-branch-finish.test.mjs` 已存在，扩它）。若本轮新增文件，同轮把它加进本任务
   的 `## Touches`。
6. **落点同步**：`orchestration/SPEC-release-and-hotfix-branching-2026-09-15.md` §4.1 / §9 第 2 步 /
   §10 残留表按当轮读数同步；并如实记录 03:38 那次删除为**无痕迹、成因不可查**（它是本任务第三条
   缺陷的第一个实证，⛔ 不要写成「已由命令删除」）。

## Acceptance Criteria

- [ ] **AC1 现状取证 + 归因诚实**：贴出（a）`git for-each-ref … refs/heads/release-* 'refs/heads/release/*'`
  现为空；（b）`git rev-parse v0.10.0^{commit}` = `4c8116632`（tag 未连带丢失）；（c）
  `git rev-parse release/v0.10.0` 的失败输出；（d）「03:38 那次删除不可归因」的证据（`.git/logs/refs/heads/release/`
  不存在 / 无对应提交 / 当时 worker 为 `pool-empty`）。⛔ 不得声称该删除经由本任务或某条命令完成。
- [ ] **AC2 命令能结束本轮这种形态（合回目标不是 develop）**：在真实仓库造一条 tip 可达其版本 tag、
  但 `develop..<b>` ≠ 0 的 release 分支，用 `release-branch-finish.sh` 成功结束它（命令 + 退出码 0 +
  该分支随后不可解析），并证明此前默认谓词会拒绝它（贴出改造前的 exit 3 读数或等价对照）。
- [ ] **AC3 判据与命令共用同一份合规定义**：贴出命令侧「合规 ⇒ 结束」（AC2）与「既不在 develop
  也不在任何 tag ⇒ 拒绝」（AC6）两条读数，并说明二者与 AC-271 criterion 的谓词逐条对应。
- [ ] **AC4 载体侧落点**：贴出结束步被切版动作带上的那个位置（切版动作里的落点），使「这次切版走完了」
  与「分支已消失/停在 tag 上」是同一件事的一部分。⛔ 只改 SPEC/skill 的措辞不算载体（那正是本轮红掉的原因）。
- [ ] **AC5 痕迹可查**：贴出一条命令，它能从痕迹载体里读出**某次**结束步确实发生过（含分支名/时间/
  结果）；⛔ 只有 stdout 刷过不算（硬规则 9）。
- [ ] **AC6 命令仍 fail-closed（命令侧负控制）**：tip 既不在 develop 也不在任何 tag 的 release 分支
  ⇒ 命令拒绝（exit ≠ 0、stderr 带独立 `CAUSE=`）∧ 该分支仍可解析（`git rev-parse` 成功）。
- [ ] **AC7 判据能取假（判据侧负控制）**：临时分支 `release/v0.0.0-nc` 存在时跑 AC-271 的 criterion
  ⇒ exit 1 ∧ stderr 含 `CAUSE=release-branch-not-parked-on-a-tag` ∧ 列出该分支名与总数；同一动作序列内
  删除后再跑 ⇒ exit 0。⛔ 临时分支必须在同一动作序列内删除，⛔ 不得留下。
- [ ] **AC8 登记与套件**：`bash plugin/scripts/capability-catalog.sh --json` → exit 0（未分类 = 0），
  并贴出行为变更脚本那一行；`bash scripts/test.sh --for-task
  gap-ac271-release-branch-outlives-its-tag-again --allow-thin` → exit 0 且选择集含被改的测试文件
  （⛔ worktree 里直接 `node --test` 不算证据）。

## Definition of Done

- [ ] **判据与命令的合规定义一致**：命令能结束「tip 可达其版本 tag、但尚未回到 develop」的 release
  分支（AC2），且对「既不在 develop 也不在任何 tag」的仍然拒绝（AC6）——这一对齐正是本轮删不掉的
  直接原因。
- [ ] **结束步有本地侧载体**（AC4）：下次切版不会因为「没人想起来」而留残留。⛔ 只在 SPEC/skill 里再写
  一句「记得删」不算——写成 prose 的协议正是本轮红掉的原因（ADR-004）。
- [ ] **痕迹可查**（AC5）：⛔ 只有 stdout 等于「做没做、怎么做的不可区分」——本轮已实测到其代价：
  03:38 那次删除至今无法归因（硬规则 9）。
- [ ] **判据能取假**（AC7）：同一 criterion 在临时分支存在时 exit 1 并列出分支名与总数，删除后 exit 0
  ⇒ 当前的 `verdict=pass` 不是一条恒绿判据的输出。⛔ 只贴一次 exit 0 不算（硬规则 3b/4）。
- [ ] **不得把 03:38 那次无痕迹删除记成本任务的成果**（AC1）：它发生在立案之后、成因不可查。
- [ ] 上面的判据按 `inherited-core` 的 REAL LANDING 口径执行（DIR-026 Reading A）：真实 ref 上真的
  穿过了机制。⛔ 只写脚本、只写测试、只改 SPEC、或只留 fixture/注入证据，都不算落地。

## Touches

- plugin/scripts/release-branch-finish.sh
- plugin/test/release-branch-finish.test.mjs
- plugin/scripts/capability-catalog.sh
- orchestration/SPEC-release-and-hotfix-branching-2026-09-15.md
- tasks/gap-ac271-release-branch-outlives-its-tag-again.md