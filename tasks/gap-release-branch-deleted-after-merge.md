---
id: gap-release-branch-deleted-after-merge
title: release 分支合回后即删除：清理 release-v063-build 使 AC-271 转绿，并把「合回后删除」落成一个
  fail-closed 的命令（AC-271）
status: ready
labels:
  - gap
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-271
---
**type:** execution

## Finding

**缺口｜AC-271 今天实跑 FAIL（1 of 2），而能修好它的动作在仓库里没有任何落点：没有命令、没有脚本、没有任务持有它。**

2026-09-15 立案当轮在主检出 `/home/yale/work/quay` 实测（全部为直接量）：

```
$ node packages/quay/bin/quay.js goal gate AC-271          → EXIT=1
  verdict=fail  CAUSE=release-branch-not-parked-on-a-tag — 1 of 2 release branches have a tip
  that is not any tag: release-v063-build
$ git for-each-ref --format='%(refname:short)' refs/heads/release-* refs/heads/release/*
  →  release-v062-build
     release-v063-build
$ git tag --points-at release-v062-build                   →  v0.6.2        （合规：tip 逐字停在 tag 上）
$ git tag --points-at release-v063-build                   →  （空）        （违规）
$ git rev-parse release-v062-build release-v063-build      →  158616df7  d097f48c7
$ git rev-list --count v0.6.3..release-v063-build           →  15           （tag 之后又长了 15 个提交）
$ git rev-list --count develop..release-v062-build          →  0
$ git rev-list --count develop..release-v063-build          →  0            （内容已全部回到 develop ⇒ 删除无损）
$ git ls-remote --heads origin 'release*'                   →  （空）      （两条都只存在于本地）
$ git worktree list | grep release-v06                     →  （空）      （没有 worktree 占着它们，可删）
```

⊢ 两条分支都已**完全合回** develop（`develop..<branch>` = 0），tip 也都被保住
（`release-v062-build` 的 tip 就是 `v0.6.2` 那个提交；`release-v063-build` 的 tip `d097f48c7` 在 develop 上）
⇒ **删掉它们不丢任何提交**，而"删除"正是 `orchestration/SPEC-release-and-hotfix-branching-2026-09-15.md`
§4.1（人 2026-09-15 已裁定 ruled）定义的协议：
`release/vX.Y.Z` 从 develop 切 → 版本 bump → 合回 develop → 在合并点打 tag → **删除分支**。

**为什么"把两条分支删掉"本身不是修复**：AC-271 是 `long-term: true`，它会被 goal gate 反复复跑；
下一次切版本（`release/v0.7.0`，SPEC §9 第 2 步）若仍没有删除这一步，判据下一轮就再红。
而**动作侧今天没有任何载体**——两条 `release-*` 分支由人手工创建、手工遗留，仓库里
既没有"结束一次 release"的命令，SPEC §9 第 2 步也只写着「✅ 下一次切版本时即可采用」。
写成 prose 的协议正是 `ADR-004` 点名的形态（prose 会被复述掉）；`ADR-011` 的对偶是"一条规则带着它的执行面一起发"。

**这不是新机制，是一条已裁定协议的实现半边**：SPEC §4.1 定义了协议，§9 第 2 步把
「现存两条 `release-v06x-build` 按判据乙清理」列为待实现的迁移步。本任务实现的就是这一步的**删除半边**。

**命名半边不在本任务范围**：AC-271 逐字声明「⛔ 判据按 tip 是否指向 tag 判定，不按分支名解析版本号——
旧名 `release-v062-build` 与新规程 `release/vX.Y.Z` 都适用」⇒ 判据对新旧命名都成立，
改名（SPEC §4.1 变更点 1）不是本任务达标所需。

**发生率（硬规则 12：先给读数再谈机制）**：release 分支历史上共创建 **2** 条，其中 **1** 条的 tip
未停在 tag 上（1/2），且这 1 条已经从 tag 之后长了 **15** 个提交（跨 6 天以上）。

**明确写出的边界（⛔ 不做）**：
- ⛔ 不实现"把分支 tip 拨回 tag"的 `--park` 形态：改写分支历史有风险，而 SPEC 的协议是删除，
  判据又同时接受"删除"与"tip 停在 tag 上"两种合规形态 ⇒ **删除足以达标**；
- ⛔ 不改 release 分支命名（见上，判据不要求）；
- ⛔ 不新造第二个检查器去复述 AC-271：判据本身就是那个检查，且它由 goal gate 按轮复跑
  （再写一个恒等的检查器只会制造一处需要同步维护的副本）。

<!-- dedup-ref -->
同族先例（机制不同，故不是重复）：`gap-release-cut-via-workflow-dispatch`（AC-268，todo）管的是
「切 tag + workflow_dispatch 让 release run 真跑一次」，**既创建也不删除任何 release 分支**；
`gap-develop-ci-first-decisive-green`（AC-265，ready）管 develop 首绿与 CI 载体；
`gap-release-run-tests-hangs-on-shared-mcp-client-leak`（AC-266）与
`gap-sea-artifact-plugin-root-toplevel-eval`（AC-267）各管 release run 内部的两个失败。
本任务是这一族里唯一持有「release 分支合回后必须消失」这条判据的**动作载体**。

## Requested action

1. **先做取证（任一不满足就停并报告，不代做别的任务的实现）**：对
   `git for-each-ref --format='%(refname:short)' refs/heads/release-* refs/heads/release/*`
   列出的每一条，逐条贴出四个读数：`git rev-parse <b>` / `git tag --points-at <b>` /
   `git rev-list --count develop..<b>` / `git ls-remote --heads origin <b>`。
   ⛔ 任何一条 `develop..<b>` ≠ 0 ⇒ 停（强删会丢工作）；任何一条在 origin 上存在 ⇒ 先报告
   （远端删除是单独动作，不能与本地删除混为一谈）。
2. **落一个 fail-closed 的"结束一次 release"命令**，建议
   `plugin/scripts/release-branch-finish.sh <branch> [--remote <r>] [--dry-run]`。三条**不可少**的属性：
   - **只认 release 分支名**：`<branch>` 必须匹配 `release-*` / `release/*`，其它名字一律拒绝
     （否则这就是一个通用删分支工具，会被误用）；
   - **未合回必拒**：`git rev-list --count develop..<branch>` ≠ 0 ⇒ 拒绝删除，退出码独立、
     stderr 带独立 `CAUSE=`（例如 `CAUSE=release-branch-not-merged`）；
   - **远端失败不静默**：本地删除后，若 origin（或 `--remote` 指定的远端）存在同名 ref，一并删除；
     删除失败必须留痕（独立 `CAUSE=`）+ 非零退出，不得 catch 掉。
   另加：`--dry-run` 只打印将要发生的动作、退出 0 且**不动任何 ref**；
   `--help` 用法在前、退出 0、无业务副作用（照 `plugin/scripts/release-task.sh` 头注释的既有约定）。
   命令名与参数形状可比上面更贴合实现，但上面三条语义属性是判据的一部分。
3. **在生产对象上真跑**：用第 2 步的命令删掉两条现存分支（先跑一次 `--dry-run` 贴出读数，
   再真跑）。⛔ 不要用 `git branch -D` 手工删掉之后再补一个命令说它可用——落地判据要的是
   **生产对象穿过这个命令**（硬规则 4 推论三的应用：能产出 ≠ 已产出）。
4. **两条负控制（证明判据与命令各自能取假；硬规则 4c 要求在落笔当轮当场干跑一次）**：
   造一个临时分支 `release/v0.0.0-nc`（develop tip + 一个 develop 上不存在的提交），
   - (a) 逐字跑 AC-271 的 criterion ⇒ 期望 **exit 1** 且 stderr 含
     `CAUSE=release-branch-not-parked-on-a-tag` 并列出该分支名与总数；
   - (b) 用第 2 步的命令删它 ⇒ 期望**被拒**（exit ≠ 0、带未合回那条 `CAUSE=`）且该分支**仍在**；
   然后删掉这个临时分支，再跑一次 criterion ⇒ 期望 **exit 0**
   （这条绿是"清理已完成"的读数，不是恒绿——(a) 已经证明同一判据能红）。
   ⛔ 临时分支必须在同一动作序列内删除；最终读数必须回到 exit 0。
5. **登记（新脚本在本仓库的既有义务）**：按 `plugin/scripts/capability-catalog.sh` **头部自述的规则**
   给它补全该文件要求的全部表项（读文件，⛔ 不照抄任何清单）。⛔ 不要把新脚本写进
   `plugin/skills/*/SKILL.md` / `plugin/loop/*.md` / `plugin/workflows/*.js` 的引用面
   （它不是循环机件；被这些面引用会让它进 derived laydown 集）。
6. **落点同步**：`orchestration/SPEC-release-and-hotfix-branching-2026-09-15.md` §9 第 2 步
   的「现存两条 `release-v06x-build` 按判据乙清理」标为已完成并附当轮读数；§10 的残留表按需同步。

## Acceptance Criteria

- [x] **AC1 取证完整**：贴出两条分支各自的四个读数（tip sha / `git tag --points-at` / `develop..<b>` / origin 侧 `ls-remote`），且两条的 `develop..<b>` = 0。⛔ 任一 ≠ 0 ⇒ 停并报告，不删。 — ✅ 实测：`release-v062-build` tip `158616df766cf53c3f7c03ec7967dfc226e55340` / tag `v0.6.2` / `develop..b` = **0** / ls-remote 空；`release-v063-build` tip `d097f48c78804cf7914d4c2042acd55f64cbe30d` / tag 空 / `develop..b` = **0** / ls-remote 空 ⇒ 两条均为 0，继续。
- [x] **AC2 判据在真实仓库上转绿**：`node packages/quay/bin/quay.js goal gate AC-271`（走 store 自己的 runner，与 driver 复跑同一入口）→ **exit 0**，贴出完整 JSON 与退出码；且 `git for-each-ref --format='%(refname:short)' refs/heads/release-* refs/heads/release/*` 输出为空（或每条的 `git tag --points-at` 非空）。⛔ 只贴 criterion 的手工 python 复跑不算。 — ✅ 实测（主检出）：`{"id":"AC-271","verdict":"pass","reason":"acceptance passed (exit 0)"}`，EXIT=0；枚举输出为空。
- [x] **AC3 删除穿过命令、不是手工**：贴出两次真实调用（分支名 + 命令 + 退出码 0），并先跑过一次 `--dry-run`（贴出其输出，且 dry-run 前后 `git for-each-ref …` 逐字相同 ⇒ 证明它不动 ref）。 — ✅ 实测：`--dry-run` 两条各 exit 0（输出 `would-delete-local` + `dry-run: no ref was touched`），dry-run 前后 `git for-each-ref` **逐字相同**；真跑 `release-v062-build` / `release-v063-build` 各 exit 0（`deleted-local` + `finished`）。两条均由命令删除，无手工 `git branch -D`。
- [x] **AC4 未合回必拒（命令侧负控制）**：在临时分支 `release/v0.0.0-nc` 上跑该命令 → exit ≠ 0 ∧ stderr 带未合回那条 `CAUSE=` ∧ 该分支仍可解析（`git rev-parse` 成功）。贴出三条读数。 — ✅ 实测：exit **3**；stderr `CAUSE=release-branch-not-merged — 'release/v0.0.0-nc' carries 1 commit(s) not in develop; deleting it would lose work.`；`git rev-parse release/v0.0.0-nc` = `dc497874c45fa72a22ffd58ac1603f25dd4ba6b1`（成功）。
- [x] **AC5 判据能取假（判据侧负控制）**：同一临时分支存在时跑 AC-271 的 criterion → exit 1 ∧ stderr 含 `CAUSE=release-branch-not-parked-on-a-tag` ∧ 列出该分支名与总数；删除该分支后再跑 → exit 0。贴出两次读数。 — ✅ 实测：有临时分支时 criterion exit **1**，stderr `CAUSE=release-branch-not-parked-on-a-tag — 1 of 1 release branches have a tip that is not any tag: release/v0.0.0-nc`；同一动作序列内删除该分支后，同一 criterion exit **0**。
- [x] **AC6 非 release 名必拒**：`bash plugin/scripts/release-branch-finish.sh develop --dry-run` → exit ≠ 0（用法/拒绝码）∧ `develop` 未被删（`git rev-parse develop` 与调用前逐字相同）。贴出读数。 — ✅ 实测：exit **2**；stderr `CAUSE=not-a-release-branch — refusing to finish 'develop'`；`git rev-parse develop` = `602dd8ccf0cf72c51e91819725632b2342eb89eb`，调用前后逐字相同。
- [x] **AC7 登记与既有门绿**：`bash plugin/scripts/capability-catalog.sh --json` → exit 0（未分类 = 0），并贴出新脚本那一行 `{"file":"<basename>","question":…}`；`bash plugin/scripts/release-branch-finish.sh --help` → exit 0 ∧ 无副作用（前后 `git for-each-ref …` 相同）。 — ✅ 实测：`--json` exit 0，`unclassified: 0`，行 `{"file":"release-branch-finish.sh","question":"How does a FINISHED release branch stop existing — and can that deletion be REFUSED?…"}`（六张表 QUESTION/CADENCE/INVALIDATION/LAST_REAFFIRMED/MATCHING/CONSUMER 齐备，`rhythm-consumer-check --check` exit 0）；`--help` exit 0，首行带 `用法`，前后 `git for-each-ref` 相同。
- [x] **AC8 测试落位且被套件选中**：`plugin/test/release-branch-finish.test.mjs` 存在，经 `scripts/test.sh` 的 glob 被选中并通过（贴出选中它的命令与绿；⛔ 在 worktree 里直接 `node --test` 不算证据）。测试至少覆盖「未合回拒绝」与「非 release 名拒绝」两条分支。 — ✅ 实测：`bash scripts/test.sh --for-task gap-release-branch-deleted-after-merge --allow-thin` exit 0，选择集含 `+ plugin/test/release-branch-finish.test.mjs`，`tests 25 / pass 25 / fail 0`；该文件 9 条中覆盖未合回拒绝（exit 3）与非 release 名拒绝（exit 2）两分支，另含 dry-run 不动 ref、远端删除、远端不可读 fail-closed、merge base 不可解析 fail-closed。
- [x] **AC9 SPEC 落点同步**：`orchestration/SPEC-release-and-hotfix-branching-2026-09-15.md` §9 第 2 步已标完成并附读数值；贴出该行 diff。 — ✅ 实测：§9 第 2 步改为「✅ **删除半边已完成**（`gap-release-branch-deleted-after-merge`）」并附两条分支 tip 与 `develop..<b>` = 0 的读数、`AC-271` 转 pass；末段执行状态同步。

## Definition of Done

**REAL LANDING 的判据是「生产对象穿过了机制」，不是「文件存在」**（DIR-026 Reading A）：

- 生产仓库 `/home/yale/work/quay` 上 `git for-each-ref --format='%(refname:short)' refs/heads/release-* refs/heads/release/*` 落地后为**空**，且这一步**由新命令执行**（AC3 的两次真实调用），⛔ 不是手工 `git branch -D` 之后再补一个命令；
- `node packages/quay/bin/quay.js goal gate AC-271` 在落地后于生产仓库 **exit 0**（AC2）——这一条正是 driver 下一轮独立复跑的那个量；
- 判据**能取假**由 AC4（命令侧未合回拒绝）与 AC5（判据侧列出违规分支）两条负控制证明。⛔ 只贴一次 exit 0 的绿读数不算：一条恒绿判据与「合格」同形（硬规则 3b/4）；
- 命令对**未合回**分支 fail-closed、对**非 release 名** fail-closed、远端删除失败留痕（AC4/AC6 + 实现自述的 `CAUSE=` 词表）；
- 新脚本在 `capability-catalog.sh` 自报的登记面完整（AC7）；其测试进入套件泳道（AC8）；
- ⛔ 只写脚本、只写测试、或只留 fixture/注入证据，都不算落地。

## Touches

- plugin/scripts/release-branch-finish.sh (new)
- plugin/test/release-branch-finish.test.mjs (new)
- plugin/scripts/capability-catalog.sh
- orchestration/SPEC-release-and-hotfix-branching-2026-09-15.md
- tasks/gap-release-branch-deleted-after-merge.md
