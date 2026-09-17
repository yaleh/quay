---
id: gap-ac283-author-pushed-to-origin-and-ancestor-of-local
title: origin 上不存在 author 分支 ⇒ AC-283 判据 exit 1（CAUSE=origin-author-absent）——本地
  author 只活在 boheidc 单机、从未推送；推送到 origin 并以判据收口
status: ready
labels:
  - gap
  - single-point-of-failure
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-283
---
**type:** execution

## Proposal

**缺口（AC-283 判据，立案当轮直接量，2026-09-17，cwd = 主检出 `/home/yale/work/quay`）**：

`goals/AC-283-author-分支已推送到-origin-且是本地-author-的真实祖先-解决单点失效.md` 的 criterion 要求：
GitHub 上存在 `refs/heads/author`，且它的 sha 是**本地 `author` 的祖先**。逐字重跑，**实测 exit 1**，逐字：

```
CAUSE=origin-author-absent — origin has no 'author' branch yet; push it first (git push -u origin author)
```

⇒ 缺口不是「判据读不懂」（它打印了具名 CAUSE，不是硬规则 3b 的静默通过），也不是「读数缺失」，
是**被判定对象本身不存在**：`git ls-remote --heads origin author`（**直查远端**，⛔ 不是读本地
remote-tracking 缓存）返回空。

**立案当轮现场读数（全部当场直查，可复算）**：

| 量 | 读数 | 取法 |
|---|---|---|
| origin 的 `author` ref | **不存在** | `git ls-remote --heads origin author` ⇒ 空 |
| 本地 `author` tip | `609dd4677b2ac0799852fee12930c4b185855353` | `git rev-parse author` |
| 本地 `develop` tip | 同一个 sha | `git rev-parse develop` |
| `origin/develop`（直查远端） | 同一个 sha | `git ls-remote --heads origin develop` |
| `author` ↔ `develop` 分叉 | `0  0` | `git rev-list --left-right --count develop...author` |
| origin | `https://github.com/yaleh/quay` | `git remote -v` |
| gh 身份 scopes | `repo`, `workflow` | `gh auth status` |
| `pre-push` 钩子 | 无 | `ls .git/hooks/` |

⇒ **三个 sha 相同**是本缺口最有用的一条事实：`author` 目前与 `develop` 逐字相同
（`orchestration/SPEC-release-and-hotfix-branching-2026-09-15.md:65` 的分支表对 author 的定义就是「与 develop 逐字相同」），
而该 commit **已经在 GitHub 上**（以 `refs/heads/develop` 的身份）⇒ 这次 push **不新增任何对象**，
只是**新建一个 ref**。这消掉了本仓库已知的两类 push 拦截：① workflow 文件 scope 拒推
（`GITHUB_TOKEN` 是 GitHub App token，推不动 `.github/workflows/*`）在这里不适用——delta 为空，
且本地 gh 身份本来就带 `workflow` scope；② 无 `pre-push` 钩子。

### 判据的每一段都当场跑过（不是只跑红的那条）

criterion 的判定链有三段（远端无该 ref / 远端 sha 的对象取不到 / 远端不是祖先）。三段我**全部用真实 git 对象
在本机跑了一次**，远端用 `mktemp -d` 里的合成裸仓库（⛔ 全程未触碰 origin）：

| 场景 | 合成远端 `refs/heads/author` 指向 | 期望 | 实测 |
|---|---|---|---|
| 正控制（= 本次 push 之后的形态） | `609dd4677…`（与本地 author **等值**） | exit 0 | **exit 0** ✅ |
| 负控制（远端是另一条历史） | `1a6b904fc764587ce624c47a6bb7c313ea8a4cf0`（`origin/dist-plugin`，实测**不是** author 的祖先） | exit 1 | **exit 1**，`CAUSE=remote-not-ancestor-of-local` ✅ |
| 负控制（远端无该 ref） | —（不建该 ref） | exit 1 | **exit 1**，`CAUSE=origin-author-absent` ✅ |

⚠️ 立案时我第一次挑的负控制是 `origin/master`（`17cf3067…`），**实测它 IS author 的祖先**（author 从 master 长出）
⇒ 拿它当负控制会得到一个**恒真**的假对照，已换掉。记在这里，是因为「随手挑另一个 sha 当反例」正好是
硬规则 2 的零计数半边会犯的错（计数为 0 / 反例恒真时，谓词并没有被真正检验）。

### ⚠️ 判据测的是【祖先关系】，不是【新鲜度】——本任务补一条收口对照

criterion 只要求 `origin/author` 是本地 author 的**祖先**：等值满足、**落后的也满足**。⇒ 一次 push 之后，
即使 `author` 继续前进而 `origin/author` 停在旧点，判据**仍 exit 0**。这对本 AC 的**字面**成立，
但对 GOAL-023 的**意图**（「解决单点失效」= 远端要是一份**真备份**）不够 ⇒ 本任务自带收口对照 AC2：
**push 那一刻**远端 sha 必须 == 本地 `author` tip，⛔ 不是「曾经推过一次」就算数。
⛔ 不得因此改宽 `goals/AC-283-*.md`——`criterion` / `expect` / `origin` / `activatedAt` 四处一个字都不许动。

### 为什么这个不变量在 push 之后【保持】成立（可复算，不是漂亮话）

`author` 的历史在现行机制下只增不改：CLAUDE.md「分支同步」一节里，主检出（author）追 develop 走的是
`syncDevelopToDoc` 的 **`git merge --ff-only develop`**（非快进时显式报「无法 ff-only 同步」，而不是改写历史）
⇒ author 只会**前进** ⇒ `origin/author` 一旦被推上去就**永远是它的祖先**，判据不会自己变红。

**唯一能重新打红它的两个动作**（都不是本任务会做、但别人容易顺手做的）：

1. 对 author 做 rebase / `push --force`（改写历史 ⇒ 远端不再是祖先）；
2. **删掉 `origin/author`**。⚠️ 这条有一个真实的误伤路径：项目惯例里有一条「为保命推过的**临时**工作分支，
   合入后 `git push origin --delete <branch>` 清掉」。`author` **不是**那种临时分支——它是主检出所在的
   **长期写面**、正是本 AC 判据的对象 ⇒ **不适用那条清理惯例**。写在这里，是因为下一次有人
   「顺手清理远程分支」时，判据变红与「一切正常」同形（硬规则 3b）。

<!-- dedup-ref -->
**去重核对（机制，不是症状关键词）**：本 store 内**无任何任务**以顶层 `goal_ac: AC-283` 认领该 AC——
逐文件扫 `^goal_ac:`，GOAL-023 的五条 AC（283/284/285/286/287）**一条都还没有主**；按机制词复扫
（`origin/author` / `push.*origin author` / `author 分支` / `单点失效`）命中并逐一排除的三条：
`gap-claim-task-and-backup-push-still-point-at-retired-local-bare-repo-not-github`（done）与
`gap-b-machine-periodic-push-backup-to-bare-repo`（done）做的是**把 B 机 / develop 定期推到一个本地裸仓库**
（`~/work/quay-sync.git`）的**周期性**备份，载体与目标 ref 都不同；
`gap-fan-in-push-silently-fails-no-detection`（done）要的是**检测 develop 的 push 是否悄悄失败**，
与本条「author 这个 ref 在 GitHub 上根本不存在」是不同的缺陷。三条都不写 `goal_ac`、都不动 author 的远程存在性。
GOAL-023 的其余四条 AC 各有其面（AC-284 worktree 分叉点、AC-285 GitHub 默认分支、AC-286 fan-in 目标回归、
AC-287 SPEC 修订），本任务只做 AC-283 这一面。

## Plan

1. **取一次现场读数**（⛔ 不假定它还是立案时那个值）：`git ls-remote --heads origin author`、
   `git rev-parse author`、`git rev-list --left-right --count develop...author`，
   并**在 push 之前存一份完整的** `git ls-remote --heads origin`（AC4 的前后对照要用）。
   若 `origin/author` **已经存在**且是本地 author 的祖先 ⇒ 判据已被满足，**不要重复 push**，
   直接做第 4/5 步并如实记「由他人完成」。
2. **推送**：`git push -u origin author`（criterion 自己的 `CAUSE` 报文里点名了这条命令形；`-u` 建立 upstream 跟踪）。
   在**本仓库内任意 worktree / 主检出**执行均可（worktree 共享同一份 refs），
   ⛔ 不要从别的 clone 推（那里可能没有本地 `author` ref）。
   ⛔ 作用域**只有** `refs/heads/author` → `origin` 这一个 ref 的创建：不用 `--force`、不推别的 ref、
   不碰 `develop` / `master` / 任何 `task/*`。
3. **核 push 真的落地**（⛔ 不看 push 命令的退出码就算完——本仓库有「push 悄悄失败」的前科）：
   `git ls-remote --heads origin author` 必须返回一个非空 sha，且 `git cat-file -e <sha>^{commit}` 退出 0。
4. **读判据本身**：`node packages/quay/bin/quay.js goal gate AC-283`（等价形态
   `node --experimental-strip-types packages/quay/src/goal-store.ts gate AC-283`）⇒ `verdict: pass`，
   贴出它打印的完整输出。
5. **补新鲜度对照（AC2）**：`git rev-parse author` 与第 3 步读到的远端 sha **逐字相等**，两个完整 sha 并排贴出。
6. **留痕**：读数写进任务体（或 `.quay/ac283-*` 未跟踪 scratch 文件），可被下一轮独立复算。
7. **收口**：确认 `gate AC-283` 为 pass ∧ 第 5 步的等值成立后收口。⛔ 收口之后不要再对 author 做任何改写。

## AC

- [ ] **AC1（goal 判据）**：`gate AC-283` 逐字重跑 `verdict: pass`，贴出完整输出。
      ⛔ 不得改宽判据——`goals/AC-283-*.md` 的 `criterion` / `expect` / `origin` / `activatedAt` 四处**一字未动**
      （举证：`git diff develop -- goals/` 对该文件零命中）。
- [ ] **AC2（新鲜度对照——判据盲区的那一半）**：push 那一刻 `origin/author` 的 sha == 本地 `author` tip，
      两个完整 sha 并排贴出且**逐字相等**。⛔「曾经推过一次 / 远端有个落后的 author」不满足本条。
- [ ] **AC3（push 真的落地，不靠 push 命令的退出码）**：`git ls-remote --heads origin author` 返回非空 sha，
      且 `git cat-file -e <sha>^{commit}` 退出 0；贴出两条命令与输出。
- [ ] **AC4（作用域未被越界）**：并排贴出 push **前**（Plan 第 1 步存下的）与 push **后**的
      `git ls-remote --heads origin`，证明**只有** `refs/heads/author` 是新增的，
      `develop` / `master` / 任何 `task/*` 的 sha 均未变化。⛔ 用了 `--force` 或推了别的 ref ⇒ 本条红。
- [ ] **AC5（判据可被打红——负控制实跑）**：对一个合成远端（`mktemp -d` 里的裸仓库，
      `refs/heads/author` 指向 `1a6b904fc764587ce624c47a6bb7c313ea8a4cf0`，立案时实测**不是**本地 author 的祖先）
      跑一次 criterion 的判定段：**exit 1 且 `CAUSE=remote-not-ancestor-of-local`**。
      ⛔ 为做这条对照不得触碰 origin。立案时已跑过正/负控制（见 Proposal 表），收口时复跑一次并贴出。
- [ ] **AC6（判据读的数在收口时刻仍取得到）**：收口后**再跑一次** `gate AC-283`
      （与 AC1 之间至少隔一次别的 git 操作）仍 `pass`；证明这个 pass 不是恰好夹在某个瞬态窗口里。

## DoD

**REAL LANDING 判据（DIR-026 Reading A）**：不是「本地有一条 `git push` 命令的成功回显」，
而是**GitHub 上真的存在 `refs/heads/author`，其 sha 与本地 author tip 逐字相等，且 AC-283 判据在真实远端上 exit 0**：

1. **落地对象**：`gate AC-283` 在**真实 origin** 上 `pass`，贴出完整输出（criterion 自己会打印它读到的远端 sha）。
2. **可被打红**：AC5 的负控制**实际跑过**并贴上 exit code 与 `CAUSE=`，证明这条判据不是恒绿。
3. **新鲜度**：AC2 的两个 sha 并排且相等。
4. **不被冒名**：AC3 用的是**直查远端**的 `ls-remote`，⛔ 不是本地 remote-tracking 缓存
   （未 fetch 时 `git rev-parse origin/author` 可能读到陈旧值，与「已推送」同形）。
5. **作用域**：AC4 的前后 ref 对照。
6. **证据留痕**：判据输出、正/负控制、前后 ref 对照落成**任务体内联**或 `.quay/ac283-*` 未跟踪 scratch 文件，
   可被下一轮独立复算（⛔ 不是只写一句「已推送」）。

## Touches

- tasks/gap-ac283-author-pushed-to-origin-and-ancestor-of-local.md

（说明：本任务的落地面是一个**远程 ref**（`refs/heads/author`）与一次本地 git 操作，不产生任何**被跟踪文件**的
改动 ⇒ Touches 只有自身这一个具体路径。证据一律**内联在任务体**或写进 `.quay/` 下的**未跟踪** scratch 文件——
按 `touches-glob-on-quay-runtime-artifacts-blocks-promotion`，未跟踪运行时产物不进
`anti-drift-touches-check` 的 `actualFiles`，声明它们反而是噪声且会挡晋升；⛔ 若确要把某个 `.quay/ac283-*`
文件**提交**，必须把它的**精确路径**（⛔ 不是通配形）加进本节。`author` 的本地 upstream 配置落在
`.git/config`，不是被跟踪文件，同样不声明。）