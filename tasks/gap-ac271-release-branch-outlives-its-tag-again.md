---
id: gap-ac271-release-branch-outlives-its-tag-again
title: release/v0.10.0 在 tag 之后存活 ⇒ AC-271 二次转红：结束步在切版动作里没有载体，且 finish
  命令对本轮这种分支形态 fail-closed 拒绝（AC-271）
status: todo
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

**缺口｜AC-271 二次转红：`release/v0.10.0` 在 v0.10.0 发布完成后存活，其 tip 不 points-at 任何 tag。**

两次独立测量（主检出 `/home/yale/work/quay`，2026-09-19T03:3xZ，都是直接量）：

```
$ node packages/quay/bin/quay.js goal gate AC-271
{"verdict":"fail","reason":"acceptance failed (exit 1) — CAUSE=release-branch-not-parked-on-a-tag —
 1 of 1 release branches have a tip that is not any tag: release/v0.10.0 => …"}
EXIT=1                       ← store 自己的 runner（与 driver 复跑同一入口）；复跑第二次同为 EXIT=1

$ python3 …（AC-271 criterion 逐字）
→ rc 0，输出 'release/v0.10.0'；`git tag --points-at release/v0.10.0` → 空     ← 违规分支
```

判据的两级谓词本身正常：`for-each-ref` exit 0 且列得出分支名、`tag --points-at` exit 0 而输出为空
⇒ ⛔ **不是仪器故障**（`CAUSE=for-each-ref-failed` / `tag-points-at-failed` 两个分支都没走）；
这是判据真的取到了 fail。

逐条读数：

| 量 | 值 |
|---|---|
| `git rev-parse release/v0.10.0` | `8c7b85e79d06d779735ea07b0c2733c366d92da2` |
| `git tag --points-at release/v0.10.0` | （空） |
| tag `v0.10.0` 所在提交 | `4c8116632`（附注 tag：`git cat-file -t v0.10.0` → `tag`） |
| `git rev-list --count release/v0.10.0..v0.10.0` | `1`（tip 严格落后 tag 一个提交 = 那个 merge commit） |
| `git merge-base --is-ancestor release/v0.10.0 v0.10.0` | **真**（tip 是 tag 的祖先 ⇒ 删它不丢任何提交） |
| `git rev-list --count develop..release/v0.10.0` | **1** |
| `git rev-list --count develop..develop-v0100-merge` | `3`（这次切版的合回落在这条旁支上，尚未进入 develop） |
| `git ls-remote --heads origin release/v0.10.0` | （空，只存在于本地） |
| `git worktree list` 里占用该分支者 | 无（`release-v0100` 系列的 worktree 停在 `develop-v0100-merge`，不在该分支上） |

**这个红是被「切版动作本身」引入的，而同一次动作里没有任何一步消除它**（`.quay/gate-events.jsonl` 直接量）：
`AC-271` 在 `03:21:08Z` 仍是 `verdict=pass`；`release/v0.10.0` 于 `03:27:02Z` 从 `origin/develop` 创建、
`03:27:27Z` 打上版本 bump 提交 `8c7b85e79`、`03:28:14Z` 在 merge commit `4c8116632` 上打 tag `v0.10.0`；
**`03:28:56Z` 判据即翻 `fail`**（下一个 goal 轮）。从绿到红之间只发生了这一件事。

**上一轮修复为什么没有守住**：`gap-release-branch-deleted-after-merge`（AC-271，done 2026-09-15T16:20）
交付的是 ① `plugin/scripts/release-branch-finish.sh` 这个 fail-closed 命令、② 用它删掉当时遗留的两条
`release-v06x-build`。它的任务体把范围明确限为**删除半边**，**没有把结束步接进切版动作**。此后又发生
3 次 release cut（`ae28758aa` v0.8.0 / `17cf30678` v0.9.0 / `4c8116632` v0.10.0），第 3 次留下残留。

**这一轮的差别有直接测量，不是推测**：v0.10.0 的合回落在旁支 `develop-v0100-merge`（tip `225c81e17`）
而非 develop，而该命令的合回谓词默认以 develop 为基：

```
$ bash plugin/scripts/release-branch-finish.sh release/v0.10.0 --dry-run
CAUSE=release-branch-not-merged — 'release/v0.10.0' carries 1 commit(s) not in develop;
  deleting it would lose work. Merge it back first, or park its tip on a tag (AC-271 accepts either)
EXIT=3
```

**判别性对照（硬规则 4 推论四）**：同一条分支上 `git merge-base --is-ancestor release/v0.10.0 v0.10.0`
= **真**（该提交由 tag `v0.10.0` 持有，删了什么都不会丢），而命令判「删了会丢工作」并**拒绝**。
⇒ 两个假设给出**相反**预测：若残留成因为「没人执行删除」，命令本应**接受**这条分支；实测它**拒绝**。
⇒ 与实测一致的解释是：**该命令对这次切版产生的分支形态 fail-closed 拒绝，于是「按规程删除」这一步
在物理上做不到**——判据认「tip 停在 tag 上」，命令只认「已回到 develop」，两者不是同一份合规定义。
⛔ 不断言人事上究竟发生过什么——命令不写任何持久痕迹（见下），「那次切版有没有人按过它」在本仓库
**不可查**。

**第三个独立缺陷：这一步没有产物 ⇒「有没有做」在记录上不可区分**（硬规则 9：可见性 ≠ 执行）：
`grep -n 'log|tee|jsonl|>>' plugin/scripts/release-branch-finish.sh` → **无命中**：命令只写
stdout/stderr，删除成功不留任何持久痕迹。于是「某次切版走完了结束步」与「没走」在任何记录上**同形**
——这正是 ADR-004 点名的形态（写成 prose 的协议会被复述掉；`ADR-011` 的对偶是「规则要带着执行面一起发」）。

**一处必须写明的约束（避免实现者白走一轮）**：`release-*` / `release/*` 分支**只存在于本地**
（本轮 `git ls-remote --heads origin release/v0.10.0` 为空；上一轮两条亦然）⇒ **任何远端侧的载体
（例如 release workflow 里新增一个 job）在结构上够不到这些 ref**，载体必须落在本地侧。

**发生率**（硬规则 12：先给读数）：上一轮修复之后的 release cut = **3** 次，留下残留 = **1** 次。
⛔ 本任务**不以发生率为前置**：`AC-271` 是 `long-term: true`，它必须**现在为真**，而它现在是 exit 1。

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

1. **先取证（任一不满足就停并报告，不代做别的任务的实现）**：对
   `git for-each-ref --format='%(refname:short)' refs/heads/release-* 'refs/heads/release/*'`
   列出的每一条，逐条给出四个读数：`git rev-parse <b>` / `git tag --points-at <b>` /
   `git rev-list --count develop..<b>` / `git ls-remote --heads origin <b>`。⛔ 若某条的 tip
   **不可达任何 tag**，停并报告——那才是真「删了会丢工作」的形态。
2. **让现存残留消失，且穿过机制**：先 `--dry-run` 贴出读数，再真跑；⛔ 不手工 `git branch -D`。
   删除前必须先证无损：`git merge-base --is-ancestor <b> <其版本 tag>` 为真（本轮该读数已实测为真）。
   命令形状由实现者定，`--base <tag>` 是既有能力之一。
3. **让这条保证在下一次切版时不可能被漏掉**。两个子项都要有落点：
   - **(a) 命令侧**：合回谓词要认「tip 可达其版本 tag」这一合规形态——判据与命令必须共用同一份
     合规定义；今天的命令认 develop、判据认 tag，二者不一致正是这次删不掉的直接原因。⛔ 任何放宽
     必须保持 fail-closed：**既不在 develop、也不在任何 tag 里** ⇒ 仍然拒绝（那是唯一的真
     「会丢工作」形态）。
   - **(b) 载体侧**：把结束步接进切版动作本身，使「这次切版走完了」与「分支已消失（或停在 tag 上）」
     是同一件事的一部分；并留下**可查痕迹**，使「某次切版有没有走完结束步」在记录上可区分
     （硬规则 9）。⛔ 载体必须落在**本地侧**（见 Finding 末段的实测约束）；⛔ 也不接受「在 SPEC 或
     skill 里再写一句『记得删』」——写成 prose 的协议正是这一轮红掉的原因（ADR-004）。
4. **两条负控制（硬规则 4c：落笔当轮当场干跑一次）**：
   - **判据侧**：造临时分支 `release/v0.0.0-nc`（develop tip + 一个 develop 上没有的提交）⇒ 逐字跑
     AC-271 的 criterion ⇒ 期望 exit 1 + `CAUSE=release-branch-not-parked-on-a-tag` 且列出该分支名
     与总数；同一动作序列内删除该分支后再跑 ⇒ 期望 exit 0。
   - **命令侧**：造一条 tip **既不在 develop 也不在任何 tag** 的 release 分支 ⇒ 命令必须**拒绝**
     （独立退出码 + 独立 `CAUSE=`）且该分支仍在。这是 3(a) 放宽的**唯一护栏**：没有它，「认 tag」
     会退化成「什么都认」。
5. **登记与测试**：命令若有行为变更或新 flag，按 `plugin/scripts/capability-catalog.sh` **头部自述
   的规则**补齐该文件要求的表项（读文件，⛔ 不照抄任何清单）；行为变更必须有测试进入套件泳道
   （`plugin/test/release-branch-finish.test.mjs` 已存在，扩它）。若本轮新增文件，同轮把它加进本任务
   的 `## Touches`。
6. **落点同步**：`orchestration/SPEC-release-and-hotfix-branching-2026-09-15.md` §4.1 / §9 第 2 步 /
   §10 残留表按当轮读数同步。

## Acceptance Criteria

- [ ] **AC1 取证完整**：贴出每条 release 分支的四个读数（tip sha / `git tag --points-at` /
  `develop..<b>` / origin 侧 `ls-remote`），并对每条给出 `git merge-base --is-ancestor <b> <其版本 tag>`
  的真假。⛔ 任一条的 tip 不可达任何 tag ⇒ 停并报告，不删。
- [ ] **AC2 判据在真实仓库上转绿**：`node packages/quay/bin/quay.js goal gate AC-271` → **exit 0**，
  贴出完整 JSON 与退出码；且 `git for-each-ref --format='%(refname:short)' refs/heads/release-*
  'refs/heads/release/*'` 输出为空（或每条的 `git tag --points-at` 非空）。⛔ 只贴 criterion 的
  手工 python 复跑不算。
- [ ] **AC3 删除穿过机制、不是手工**：贴出 `--dry-run` 的输出（且 dry-run 前后上述 `for-each-ref`
  逐字相同 ⇒ 证明它不动 ref）+ 真跑的 exit 0。⛔ 实现期不得出现手工 `git branch -D`。
- [ ] **AC4 命令能结束本轮这种形态（合回目标不是 develop）**：贴出命令在 tip 可达其版本 tag、
  但 `develop..<b>` ≠ 0 的分支上成功结束的读数（命令 + 退出码 0）。
- [ ] **AC5 载体侧落点**：贴出结束步被切版动作带上的那个位置，以及其**痕迹读数**——一条命令能从
  痕迹载体里读出「这次切版走了结束步」。⛔ 只改 SPEC/skill 的措辞不算载体（那正是本轮红掉的原因）。
- [ ] **AC6 命令仍 fail-closed（命令侧负控制）**：tip 既不在 develop 也不在任何 tag 的 release
  分支 ⇒ 命令拒绝（exit ≠ 0、stderr 带独立 `CAUSE=`）∧ 该分支仍可解析（`git rev-parse` 成功）。
- [ ] **AC7 判据能取假（判据侧负控制）**：临时分支 `release/v0.0.0-nc` 存在时跑 AC-271 的 criterion
  ⇒ exit 1 ∧ stderr 含 `CAUSE=release-branch-not-parked-on-a-tag` ∧ 列出该分支名与总数；同一动作
  序列内删除后再跑 ⇒ exit 0。⛔ 临时分支必须在同一动作序列内删除。
- [ ] **AC8 登记与套件**：`bash plugin/scripts/capability-catalog.sh --json` → exit 0（未分类 = 0），
  并贴出行为变更脚本那一行；`bash scripts/test.sh --for-task gap-ac271-release-branch-outlives-its-tag-again
  --allow-thin` → exit 0 且选择集含被改的测试文件（⛔ worktree 里直接 `node --test` 不算证据）。

## Definition of Done

- [ ] 生产仓库 `/home/yale/work/quay` 上 `release-*` / `release/*` 分支集合为空（或每条的
  `git tag --points-at` 非空），且 `node packages/quay/bin/quay.js goal gate AC-271` **exit 0**
  ——这一条正是 driver 下一轮独立复跑的那个量。
- [ ] `release/v0.10.0` 的消失**穿过机制**（AC3 的 dry-run + 真跑），⛔ 不是手删后补一条记录。
- [ ] 「下一次切版不会再留残留」有**载体证据**（AC5）：结束步被切版动作带上，且留痕可查。⛔ 只在
  SPEC/skill 里再写一句「记得删」不算——写成 prose 的协议正是这一轮红掉的原因（ADR-004）。
- [ ] 命令仍 fail-closed：既不在 develop 也不在任何 tag 的分支被拒（AC6），判据能取假（AC7）。
- [ ] 上面的判据按 `inherited-core` 的 REAL LANDING 口径执行（DIR-026 Reading A）：生产对象真的
  穿过了机制。⛔ 只写脚本、只写测试、只改 SPEC、或只留 fixture/注入证据，都不算落地。

## Touches

- plugin/scripts/release-branch-finish.sh
- plugin/test/release-branch-finish.test.mjs
- plugin/scripts/capability-catalog.sh
- orchestration/SPEC-release-and-hotfix-branching-2026-09-15.md
- tasks/gap-ac271-release-branch-outlives-its-tag-again.md