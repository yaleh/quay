---
id: gap-ac285-github-default-branch-master
title: GitHub 仓库默认分支仍为 develop ⇒ AC-285 判据 exit
  1（CAUSE=default-branch-not-master）——把仓库设置翻到 master，直查远端回读 + 分叉面探针实测
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-285
---
**type:** execution

## Proposal

**缺口（AC-285 判据，立案当轮直接量，2026-09-17T05:47Z，cwd = 主检出 `/home/yale/work/quay`）**：

`goals/AC-285-github-仓库默认分支实测为-master.md` 的 criterion 要求 `git ls-remote --symref origin HEAD` 解析出
`refs/heads/master`。**逐字重跑，实测 exit 1**，逐字：

```
$ node packages/quay/bin/quay.js goal gate AC-285
{"id":"AC-285","verdict":"fail",
 "reason":"acceptance failed (exit 1) — CAUSE=default-branch-not-master — origin HEAD symref is: ref: refs/heads/develop HEAD (expected refs/heads/master)",
 "timestamp":"2026-09-17T05:47:48.307Z","dryRun":false,
 "event":{"id":"c2997a54-0662-47fe-80b1-7594cafc4aec", ... "verdict":"fail" ...}}
GATE_EXIT=1
```

⇒ 缺口不是「判据读不懂」（它打印了具名 `CAUSE=`，不是硬规则 3b 的静默通过），而是**被判定对象本身不是 master**。

**立案当轮现场读数（全部当场直查，可复算）**：

| 量 | 读数 | 取法 |
|---|---|---|
| origin HEAD symref | `ref: refs/heads/develop` | `git ls-remote --symref origin HEAD \| head -1`（**直查远端**） |
| GitHub default branch | `develop` | `gh repo view yaleh/quay --json defaultBranchRef` |
| 本账号对该仓库的权限 | `ADMIN` | 同上 `--json viewerPermission`（⇒ 可改仓库设置） |
| gh 身份 / scopes | `yaleh`；`gist, read:org, repo, workflow` | `gh auth status`（⇒ 网络可用、写权限在） |
| `origin/master` | `17cf30678da6fd4a56daf9750adf87179f49f58d` | `git ls-remote --heads origin master` |
| `origin/develop` | `bdf090379909ea226d514848ff51e1b46635ff78` | `git ls-remote --heads origin develop` |
| master ↔ develop 关系 | `--is-ancestor origin/master origin/develop` ⇒ **exit 0**；`rev-list --count origin/master..origin/develop` = **285**；反向 = **0** | 三条 git 命令 |
| **master 上的版本** | `plugin/VERSION` = `0.9.0`，`packages/quay/package.json` = `0.9.0` | `git show origin/master:plugin/VERSION` |
| **master 上的 marketplace 元数据** | `"version": "0.9.0"` | `git show origin/master:.claude-plugin/marketplace.json` |
| **develop 上的 marketplace 元数据** | `"version": "0.10.0-dev"` | `git show origin/develop:.claude-plugin/marketplace.json` |
| 本地 `refs/remotes/origin/HEAD` | `refs/remotes/origin/develop` | `git symbolic-ref refs/remotes/origin/HEAD` |

⇒ 最后三行是本任务**意图面**的直接证据，不是"master 更好"的判断：GOAL-023 要的是「外部访客 / marketplace 看到**已发布版**」。
`claude plugin marketplace add yaleh/quay`（不带 ref）读的是**默认分支**上的 `.claude-plugin/marketplace.json`
⇒ 现在读到 develop 的 `0.10.0-dev`，翻到 master 后读到 `0.9.0`。两者的 `plugins[].source.ref` **都**钉 `dist-plugin`
⇒ **装出来的字节不变，变的只是元数据展示层**（与人的报告一致：装出来是 0.9.0 的字节、显示却是 -dev 的版本号）。

### 关键口径：AC-285 读的是【远端】，不是本地缓存

criterion 逐字是 `git ls-remote --symref origin HEAD` —— 它**走网络问 GitHub**。两条后果：

1. 满足它只需改 **GitHub 的仓库设置一处**；⛔ 不需要、也不应该把它与本地 `refs/remotes/origin/HEAD` 混为一谈。
2. 本地那个 ref 是一个**缓存**（`git remote set-head` 写它，git 不会因为远端默认分支变了就自动更新它）——
   现状仍 `develop`。**它现在与 AC-285 无关**；它是另一条判据（AC-273，读本地 ref）的判定对象，
   而 AC-273 由本 GOAL 退役（AC-287 负责），⛔ 不归本任务。

### 翻转面：这次改动与 AC-284 的关系（本任务唯一有实质风险的一段）

把默认分支改成 master，正是 `orchestration/SPEC-release-and-hotfix-branching-2026-09-15.md` §2.2 后果 2
描述的靶子：**新 worktree 默认从 master（更旧的线）分叉**。AC-284（`done`）给
`plugin/scripts/dispatch-worktree-setup.sh` 加了分叉点自检，其头注释 `:159-162` 逐字声明
**本步骤不硬编码默认分支的值**（PASS 面一字不变，默认分支只在**拒绝面**作反例鉴别器）
⇒ 闸是 fail-closed 的：从 master 分叉的 worktree 会被 `exit 2` 拒。

**但闸只判、不改分叉点本身**：派发 prompt（`plugin/scripts/worker-driver.ts:1670`）逐字只说
`create an isolated git worktree for ${task}`，**不指名任何 base** ⇒ 翻转后**存在两种互斥的可能**，
静态推不出来，必须现场实测（硬规则 4 推论四：不必给出对照的"我认为"不得作为结论）：

- **(a)** 分叉点来自**本地** `refs/remotes/origin/HEAD`（现 develop）或 worker 的 cwd HEAD ⇒ 分叉面一字不变，worker 照常派发；
- **(b)** 分叉点来自 **GitHub 默认分支** ⇒ 新 worktree 从 master（落后 285 提交）分叉，被 AC-284 的闸 `exit 2` **拒**
  （fail-closed，⛔ 不是静默错——但它会**挡住派发**，是必须当场看见并记录的运维后果）。

⇒ AC4 要求用一个**一次性探针 worktree** 取这个二元组读数。⛔ 判"应该不会"而不测，等于把一个真实的派发面风险
降格成观察项。

### 本地另一处消费者（读 `refs/remotes/origin/HEAD` 的量）

`packages/quay/src/branch-model.ts:227` 的 `detectDefaultBranch()` **首选**读本地 `refs/remotes/origin/HEAD`，
其结果喂给 `classifyBranch()`（`:258`）→ `plugin/scripts/anti-drift-touches-check.ts:175` 的**落地基线**判定。

⇒ **若**有人"顺手"跑 `git remote set-head origin -a` 把它刷成 master，本地"默认分支"这个角色就从 develop 变成 master，
**所有** worktree 的落地基线分类随之改变。**今天**它仍成立（master 是 develop 的祖先 ⇒ `contains-default` ⇒ `compatible`），
但只要将来有一条 hotfix 只落 master 不回灌 develop，develop 侧的分支就会被判 `divergent` ⇒ anti-drift 假红。
⇒ 本任务**要求显式记录这个决定**：默认动作 = **不动本地 set-head**（本地"落地基线"的角色是 develop，
对外门面才是 master —— 这正是 GOAL-023「本地开发继续以 develop 为主」的形态）。
⛔ 不把"顺手刷一下保持一致"当清理动作。

<!-- dedup-ref -->
### 去重核对（机制，不是症状关键词）

本 store 内**无任何任务**以顶层 `goal_ac: AC-285` 认领该 AC（`grep -rn '^goal_ac: AC-285' tasks/*.md` ⇒ **零命中**）。
按机制词复扫（`默认分支` / `default_branch` / `defaultBranch` / `set-head` / `symref`）命中 14 个文件，逐一排除，
最相关的三条：

- `gap-ac284-worktree-forkpoint-check`（`done`，`goal_ac: AC-284`）—— 同一 GOAL 的**邻面**，做的是**检测闸**
  （`dispatch-worktree-setup.sh` 的分叉点自检），**不改任何仓库设置**，本任务复用它作护栏（见 AC4）。
- `gap-ac283-author-pushed-to-origin-and-ancestor-of-local`（`done`，`goal_ac: AC-283`）—— 推的是 `refs/heads/author`
  这一个 **ref**，本任务改的是**仓库设置**（默认分支），两者不同对象。
- `gap-fan-in-merge-target-hardcoded-develop-blocks-third-party-landing`—— 说的是 fan-in 的 **merge target**
  硬编码 develop（第三方项目主线不是 develop 时落不了地），本任务**不碰** merge target（那条由 AC-286 守）。
- 其余 11 个命中文件（`gap-batch-merge-freshness-gate-ignores-scope` / `gap-aged-project-post-upgrade-driver-e2e` /
  `gap-develop-version-union-missing-dev-suffix` / `gap-upgrade-entry-never-establishes-branch-model` /
  `gap-goal020-exit-conditions-stale-after-sea-channel-retired` 等）只在正文里**提到**默认分支/分支模型，
  无一条以"改 GitHub 默认分支设置"为机制。

GOAL-023 的其余四条 AC 各有其面（AC-283 author push / AC-284 分叉点闸 / AC-286 fan-in 目标回归 / AC-287 SPEC 修订），
本任务只做 AC-285 这一面。

## Plan

1. **现场读数**（⛔ 不假定仍等于立案值）：`git ls-remote --symref origin HEAD | head -1`、
   `gh repo view yaleh/quay --json defaultBranchRef,viewerPermission`、
   `git merge-base --is-ancestor origin/master origin/develop; echo rc=$?`、
   `git symbolic-ref refs/remotes/origin/HEAD`。**并存一份翻转前的** `git ls-remote --heads origin | sort`
   （AC5 的前后对照要用）。
2. **翻转前的红基线**：`node packages/quay/bin/quay.js goal gate AC-285` ⇒ `verdict: fail` +
   `CAUSE=default-branch-not-master`，贴完整输出（证明判据不是恒绿）。
3. **翻转**（**唯一**的实质改动，作用域 = 一个仓库设置）：
   `gh repo edit yaleh/quay --default-branch master`（等价 `gh api -X PATCH repos/yaleh/quay -f default_branch=master`）。
   ⛔ 作用域只有这一个设置：不推 / 不删任何 ref、不 `--force`、不改 master / develop / dist-plugin 的**内容**；
   ⛔ **不跑** `git remote set-head origin -a`（理由见 Proposal 末段；本任务的决定 = 本地缓存保持 develop，并写明）。
   先 `--help`/dry 形态确认 `gh repo edit` 支持该 flag（若版本不支持则用 `gh api -X PATCH` 那条等价形）。
4. **直查远端回读**（⛔ 不看命令退出码就算完；本仓库有"改了但读不出来/悄悄失败"的前科）：
   `git ls-remote --symref origin HEAD | head -1` 必须逐字含 `refs/heads/master`；
   `gh repo view yaleh/quay --json defaultBranchRef` 必须为 `{"defaultBranchRef":{"name":"master"}}`。
   **两个独立仪器**（git 直查 + gh API）并排贴出。⛔ 不得用本地 `refs/remotes/origin/HEAD` 当这条的读数。
5. **判据收口**：`node packages/quay/bin/quay.js goal gate AC-285` ⇒ `verdict: pass`，贴完整输出。
6. **分叉面探针（AC4）**：建一个**一次性**探针 worktree，形态与 worker 相同
   （`git -C <主检出> worktree add -b task/zzz-ac285-probe <临时路径>`；⛔ 收尾 `git worktree remove` 清掉，
   ⛔ 不留在 `quay-worktrees/` 下以免被当成在飞任务）。读两条：
   ① `git reflog show --format='%gs' task/zzz-ac285-probe | tail -1` ⇒ 形如 `branch: Created from <起点>`；
   ② `bash plugin/scripts/dispatch-worktree-setup.sh <探针路径> --base develop --dry-run` ⇒ 闸判定（PASS / REFUSED exit 2 / NOT-EVALUATED）。
   把 **(起点, 闸判定)** 二元组写进任务体。
   ⛔ 探针必须用它**真实的**默认起点（不指定 base），⛔ 不得为了拿到"期望结果"改用别的 base 造 worktree——
   那会把这条对照变成恒真（硬规则 2 的零计数半边）。
   若二元组落在 (b)（起点=master 且被拒）⇒ **如实记录为一个新发现**并说明它对派发面的影响，
   ⛔ 不得因此跳过或回退 AC1（翻转是 GOAL-023 裁定的动作），也⛔ 不得把它降格成观察项了事。
7. **留痕**：读数、红→绿判据输出、前后 ref 对照、探针二元组，全部写进**任务体内联**或 `.quay/ac285-*`
   **未跟踪** scratch 文件（可被下一轮独立复算）。
8. **收口**：AC1 + AC2 + AC4 齐备后收口。⛔ 收口后不再改仓库设置、不再动本地 set-head。

## AC

- [ ] **AC1（goal 判据红→绿）**：`node packages/quay/bin/quay.js goal gate AC-285` 逐字重跑 `verdict: pass`，
      贴完整输出；并**并排贴出第 2 步的红基线**（同一条命令、同一个对象，取值由 fail 变 pass ⇒ 判据可被打红、
      且这次改动是那个变化的因）。⛔ 不得改宽判据——`goals/AC-285-*.md` 的 `criterion` / `expect` / `origin` /
      `activatedAt` 四处**一字未动**（举证：`git diff develop -- goals/` 对该文件零命中 + blob sha 两侧相同）。

- [ ] **AC2（直查远端回读，⛔ 不信命令退出码）**：两个**独立仪器**同时指向 master 并并排贴出：
      ① `git ls-remote --symref origin HEAD | head -1` ⇒ 逐字含 `ref: refs/heads/master`；
      ② `gh repo view yaleh/quay --json defaultBranchRef` ⇒ `{"defaultBranchRef":{"name":"master"}}`。
      ⛔ 本条的读数**不得**取本地 `refs/remotes/origin/HEAD`（缓存，与远端设置不同源、与 AC-285 判据也不同源）。

- [ ] **AC3（判据可被打红——负控制实跑）**：把 criterion 原文**逐字提取**
      （`node packages/quay/bin/quay.js goal show AC-285 --json` 的 `criterion` 字段，贴出 md5）后原样执行，
      对**两个合成远端**（`mktemp -d` 里的裸仓库，`git symbolic-ref HEAD` 分别指向 master / develop）各跑一次：
      正控制（HEAD→master）⇒ `exit 0`；负控制（HEAD→develop）⇒ `exit 1` 且 `CAUSE=default-branch-not-master`。
      ⛔ 全程**不触碰 origin**；⛔ 不凭记忆重写判据文本。
      （第三段 `CAUSE=symref-unreadable` 由条件本身覆盖：只剩它时 `ls-remote` 返回空 ⇒ 该分支的取值与其他两态不同形。）
      ⛔ 没有正控制时，"exit 1"什么也没证明（判据可能结构上恒红）。

- [ ] **AC4（分叉面探针：起点 × 闸判定二元组，实测不是推断）**：贴出探针 worktree 的
      ① 创建记录（`branch: Created from <起点>`）与 ② `dispatch-worktree-setup.sh --base develop --dry-run` 的判定，
      并明确写下它落在 Proposal 列出的 (a) / (b) 哪一种；若落在 (b)（起点 = master 且被 `exit 2` 拒），
      记录它对 worker 派发面的实际影响。⛔ 探针用真实默认起点，⛔ 收尾已 `git worktree remove`（贴出清理后
      `git worktree list` 不含该路径）。

- [ ] **AC5（作用域：只有仓库设置变了）**：并排贴出翻转**前**（Plan 第 1 步存下的）与翻转**后**的
      `git ls-remote --heads origin`，证明**所有 ref 的 sha 逐字未变**（`develop` / `master` / `dist-plugin` /
      全部 `task/*` / `author`）。⛔ 有任何 ref 变化、用了 `--force`、或改动了分支内容 ⇒ 本条红。

- [ ] **AC6（本地 set-head 的决定被显式记录，且判据读的数在收口时刻仍取得到）**：
      ① 贴出收口时刻的 `git symbolic-ref refs/remotes/origin/HEAD`，并写明**本任务决定不动它**及理由
      （`branch-model.ts:227` → `anti-drift-touches-check.ts:175` 的落地基线角色是 develop；见 Proposal 末段）；
      ② 收口后再跑一次 `gate AC-285`（与 AC1 之间至少隔一次别的 git 操作）仍 `pass` ⇒ 证明这个 pass 不是
      恰好夹在某个瞬态窗口里。

## DoD

**REAL LANDING 判据（DIR-026 Reading A）**：不是「本地有一条 `gh repo edit` 的成功回显」，而是
**GitHub 上的仓库设置真的变了**（两个独立仪器直查远端都指 master，`origin/HEAD` symref 逐字解析为 `refs/heads/master`），
且 **AC-285 判据在真实 origin 上 exit 0**：

1. **落地对象**：`gate AC-285` 在**真实 origin** 上 `pass`，贴出完整输出。
2. **不被冒名**：AC2 的两个读数都是**直查远端**（`ls-remote` 走网络 / `gh` API 问 GitHub），
   ⛔ 不是本地 remote-tracking 缓存（`refs/remotes/origin/HEAD` 不会因为远端设置变了而自动更新，
   拿它当证据等于用一个陈旧缓存自证）。
3. **可被打红**：AC3 的正 / 负控制**实际跑过**并贴上 exit code 与 `CAUSE=`，证明这条判据不是恒绿。
4. **分叉面有实测**：AC4 的二元组已记录，且探针已清理；⛔ 不接受"分叉点应该不受影响"这类无对照的推断。
5. **作用域**：AC5 的前后 ref 对照（零 ref 变化）。
6. **可回滚**：写明回滚形态（`gh repo edit yaleh/quay --default-branch develop`）与它的作用域（同样只改一个设置）；
   ⛔ 不在本任务里真跑回滚（那会把判据打回红）。
7. **证据留痕**：判据输出、正 / 负控制、探针二元组、前后 ref 对照，落成**任务体内联**或 `.quay/ac285-*`
   **未跟踪** scratch 文件，可被下一轮独立复算（⛔ 不是只写一句"已改好"）。

## Touches

- tasks/gap-ac285-github-default-branch-master.md

（说明：本任务的落地面是**一个远程仓库设置**（GitHub default branch）+ 一次 `gh` 写操作，**不产生任何被跟踪文件**
的改动 ⇒ Touches 只有自身这一个具体路径，⛔ 没有"实现文件 + 测试文件"这一对可列——本任务不改产品代码、不加检查器
（AC-285 的 criterion 本身就是常设守卫，由 goal-driver 每轮跑）。
证据一律**内联在任务体**或写进 `.quay/` 下的**未跟踪** scratch 文件——按
`touches-glob-on-quay-runtime-artifacts-blocks-promotion`，未跟踪运行时产物不进
`anti-drift-touches-check` 的 `actualFiles`，声明它们反而是噪声且会挡晋升；⛔ 若确要把某个 `.quay/ac285-*` 文件
**提交**，必须把它的**精确路径**（⛔ 不是通配形）加进本节。`gh` 的凭据落在 `~/.config/gh/`、
本地 upstream 配置落在 `.git/config`，都不是被跟踪文件，同样不声明。）