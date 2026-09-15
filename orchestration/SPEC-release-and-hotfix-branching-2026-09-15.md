# SPEC：release 与 hotfix 分支 —— 把 master 从化石改造成「最近一次全绿发布」

**作者**：manager（会话 `git branching model discussion`）｜**日期**：2026-09-15｜
**状态**：**ruled**（人 2026-09-15 对全部 5 个开放问题逐条裁定，见 §1 ⑤）——待立案与实现
**来源**：人 2026-09-15「参考 nvie 的 git branching model，讨论如何为本项目应用 release 和 hotfix 分支，以及如何同步到 master 分支」
→ 两轮讨论后人要求成文。
**前置阅读**：
- `SPEC-branching-model-integration-branch-2026-08-05.md`（🚫 已退役，保留为理由档案）——**本 SPEC 是它 §7① 那个被推迟的裁定的到期结算**
- `orchestration/archive/AC58-retired-clauses.md#R23`（integration 分支的退役证据）
- `SPEC-per-task-suite-verification-2026-08-13.md`（取代 integration 的 per-task 验证模型 = 现行两线）
- `GOAL-020`（CI 与 release 渠道成为可信守门员，active，AC-265..269）、`GOAL-019`（plugin 渠道交付自足，active）

**证据基线**：本 SPEC 每条读数标注来源与类型——【git 实测】/【gh 实测】/【读码】/【转引 GOAL-020】/【转引旧 SPEC】。
⛔ 未标注来源的断言不得进入本文件。所有 git/gh 读数取于 2026-09-15 13:1x–13:4xZ，主检出 `/home/yale/work/quay`。

---

## 0. 一句话

**develop 保持不变（它已经是 nvie 的 develop）；把 `master` 从「2026-08-03 冻结的化石」重新定义为
「最近一次 release workflow 全绿的那个 tag」，只由这一个事件推进、永不接受直接提交；
release 分支规程化并在合回后删除；hotfix 线【实测发生率 1 且那 1 次已被现有手段解决】，
故降为有条件备用通道，⛔ 不作为落地前置。**

**人 2026-09-15 裁定后的四条确定动作**（§1 ⑤）：
**①默认分支即刻切 `develop`（不等 master）｜②develop 携带 `X.Y.Z-dev`，release 分支去后缀｜
③master 推进落在 `release.yml` 内一个新 job（`needs:` 枚举其余全部 6 个 job，ff-only，⛔ 永不 `--force`）｜
④首次 ff 等 v0.7.0 全绿——在此之前 master 不动是规则的正确输出，不是缺陷。**

---

## 1. 授权链与前身裁定（本 SPEC 的立论基础）

| # | 日期 | 裁定/事实 | 对本 SPEC 的效力 |
|---|---|---|---|
| ① | 2026-08-05 | 旧 SPEC §7① 逐字：「git-flow 的 `master` 是**发布线**，而 quay 目前**没有发布流程**……管理者倾向两线：现在加一条空转的发布线，是为尚不存在的流程付维护成本；**等真有发布授权时再加 `master`，那时它的语义才是实的**。裁定权在外层。」【转引旧 SPEC】 | **这是本 SPEC 存在的唯一理由**：它推迟的前提条件（"真有发布流程"）现在实测成立（§2.3：4 个 v0.6.x tag、6 个 GitHub Release、marketplace 渠道在服务 quay-fleet）⇒ **那个被挂起的裁定到期了** |
| ② | 2026-08-13 | AC48 判据2：integration 分支退役，per-task 验证模型取代（每任务从 develop fork、worktree 内跑全量、绿后 merge 回 develop）【转引 R23】 | ⛔ 本 SPEC **不推翻、不重新引入** integration。现行两线（develop + `task/<id>`）保持 |
| ③ | 2026-09-14 | 人令（`gap-github-actions-no-implicit-triggers`）：GitHub Actions 不得有隐式触发。publish-plugin-dist 与 release 改为 `workflow_dispatch` 独占。原因逐字：自动触发「force-overwrote a manually-published fix mid-flight」【读码 `publish-plugin-dist.yml` 头注释】 | ⛔ 本 SPEC **不**提议把发布重新挂回 tag-push/branch-push 自动触发。master 的推进机制必须与这条兼容（§6） |
| ④ | 2026-09-15 | 人提出参考 nvie，问 release/hotfix 与 master 同步 | 本 SPEC 的任务书 |
| ⑤ | 2026-09-15 | **人对 §10 的 5 个开放问题逐条裁定**（原文见下表） | **本 SPEC 由 proposal 转为 ruled**；§3.2 / §4.3 / §6 / §7 / §9 已按裁定改写，⛔ 不再保留"倾向/待裁定"措辞 |

**⑤ 的五条裁定原文与落点**：

| 问 | 裁定 | 落点 | 效力 |
|---|---|---|---|
| 1 默认分支是否现在切 `develop` | **「是，且与 master 改造无冲突」** | §3.2、§9 第 1 步 | 解除 §2.2 后果 1+2；**不等 master 修好** |
| 2 版本 bump 落 develop（带 `-dev`）还是落 release 分支 | **「`-dev` 后缀」** | §4.3 选项 ii | develop 携带 `X.Y.Z-dev`，release 分支去后缀 |
| 3 master 推进用 A 还是 C | **「A 工作流内」** | §6 | ⊢ 人由此同时裁定：**同一次显式 dispatch 内的后续 job 写 GitHub，不违反 ③ 的裁定精神**（③ 禁的是隐式触发，不是显式 run 内的后续步骤） |
| 4 首次 ff 等 v0.7.0 全绿还是接受红着的 v0.6.3 | **「等 v0.7.0 全绿」** | §6 末、§9 第 5 步 | master 在此之前**保持不动是正确输出** |
| 5 判据甲–戊 挂 GOAL-020 还是独立立 GOAL | **「挂 GOAL-020」** | §7 | 编号立案时分配（当前最大 `AC-269`） |

**⊢ 立论一句话**：2026-08-05 的判断在当时是对的（那时 master 角色是空的，加一条空转发布线是白付成本）；
**今天它失效的原因不是那个判断错了，而是它点名的前提条件发生了变化**——发布流程从"不存在"变成了"存在但半截"。

---

## 2. 现状盘点（全部为直接量，2026-09-15）

### 2.1 四条线的实际角色

| 线 | tip | 谁在写 | 实际角色 | 读数 |
|---|---|---|---|---|
| `master` | `9316b797d` 2026-08-03 22:38Z | **无人** | **化石**：ADR-015「循环直接跑在 master 上」那套经典循环的终点，ADR-022 同日退役该循环后再无人碰 | `master..develop` = **19548**；`develop..master` = **0** ⇒ master 是 develop 的祖先，**可 ff**【git 实测】 |
| `develop` | 随时前进（今日 13:18Z 仍在动） | promotion-driver / worker-driver / fan-in / 三层 | **真正的主干**：任务状态权威源、worktree 分叉点、fan-in 汇入点 | — |
| `author` | 与 develop 逐字相同 | 主检出（doc-only 写面） | develop 的活跃工作副本，非权威 | `develop..author` = `author..develop` = **0**【git 实测】 |
| `task/<id>` | 每任务一条 | worker | per-task 隔离（②的现行模型） | — |

### 2.2 master 是化石这件事，有三个被放大的后果（不是"不好看"，是实际代价）

| # | 后果 | 直接量 |
|---|---|---|
| 1 | **GitHub 默认分支仍是 `master`** | `gh repo view` → `defaultBranchRef.name = "master"`【gh 实测】⇒ 仓库首页、新 clone、PR 默认 base 全部指向 2026-08-03 的化石 |
| 2 | **每个新建 worktree 默认从化石分叉** | 撰写本 SPEC 时实测：`EnterWorktree` 建出的 worktree 落在 `9316b797d`（= master tip），`HEAD..develop` = **19555**，必须手工 `reset --hard develop` 才能工作。机制：worktree 默认 baseRef = `origin/<默认分支>`，而 `origin/HEAD -> origin/master`【git 实测 + 读码】 |
| 3 | **"半截发布"没有任何地方会变红** | §2.3：连续 3 个版本缺 npm 产物、SEA 核心功能崩，而没有任何一条线的位置会因此改变 ⇒ 缺陷与「一切正常」同形（硬规则 3b 形态） |

⊢ **后果 2 是今天实测新增的**，此前未被任何任务或 SPEC 记录过：它意味着**每一条 harness 建出的 worktree 都要靠人/agent 记得手工改基点**，而忘记改的那次不会报错，只会在一个 6 周前的树上工作。

### 2.3 三条交付渠道，与 tag 的关系各不相同

| 渠道 | 载体 | 触发 | 与 tag 的关系 | 状态 |
|---|---|---|---|---|
| **版本化渠道 A**：GitHub Release 资产（SEA 三平台 + npm tgz） | `release.yml`（`workflow_dispatch`，吃**已存在的 tag** 作输入，**不创建 tag**）【读码】 | 人工 | 强绑定 tag | **半截**，见下表 |
| **滚动渠道 B**：Claude Code marketplace | `publish-plugin-dist.yml`（`workflow_dispatch`，`ref` 默认 `develop`）→ force-push 到 orphan 分支 `dist-plugin`；`marketplace.json` 的 source 钉死 `ref: dist-plugin`【读码】 | 人工 | **完全脱钩** | 见 §2.5 |
| **源码渠道 C**：`git clone` | — | — | 落在默认分支 = master = 化石 | 见 §2.2 后果 1 |

**渠道 A 的实测交付缺口**【gh 实测，逐版本查资产清单】：

```
v0.4.0   quay-sea-{linux,macos}                      ← 缺 windows
v0.5.0   quay-0.5.0.tgz + quay-sea-{linux,macos,windows}   ← 唯一一次完整
v0.6.0   quay-sea-{macos,windows}                    ← 缺 linux-x64
v0.6.1   quay-sea-{linux,macos,windows}              ← 无 tgz
v0.6.2   quay-sea-{linux,macos,windows}              ← 无 tgz
v0.6.3   quay-sea-{linux,macos,windows}              ← 无 tgz
```

⇒ **npm 可安装产物（`.tgz`）在 6 个版本里只出现过 1 次（v0.5.0）**，而 `release.yml` 的 release note 模板
与 README 都在教用户 `npm install -g quay-*.tgz`【读码】——**文档承诺的安装方式，在当前最新版本上没有对应资产。**

**根因不是本 SPEC 的范围（已由 GOAL-020 持有）**，但要引用以说明 master 规则的价值【转引 GOAL-020】：
`release` job 撞 30m 超时（`Run tests` 因 `mcp-server.test.mjs` 无 self-skip 守卫 + 子进程泄漏退化成 hang），
`sea-verify-node-free` 三平台全挂（`plugin-root.ts:33` 模块顶层求值 `import.meta.url`，SEA 的 CJS bundle 里为 undefined ⇒ `quay serve` 一起手即崩）。

**关键观察（本 SPEC 的核心论据）**：v0.6.3 的 Release run `34845477762` 整体 **failure**，
但 GitHub Release 对象 `v0.6.3` **存在**且 `publishedAt = 12:48:30Z`，**早于该 run 的起始 12:48:42Z**
⇒ **release 对象不是这次 run 创建的**【gh 实测】。
⊢ 即：**"GitHub 上有一个 v0.6.3 Release" 这个事实，与 "v0.6.3 发布成功" 没有因果关系**——
前者由人工打 tag/建 release 产生，后者从未发生。二者在任何仪表盘上同形。

### 2.4 release 分支的现状：接近 nvie，但缺"删除"和"切点"两条纪律

| 读数 | 值 | 含义 |
|---|---|---|
| `v0.6.2` → `158616df7`、`v0.6.3` → `92c5b1b15` | 均为 "release: 版本 bump" 提交 | tag 打在版本 bump 提交上，符合 nvie |
| `develop..release-v063-build` | **0** | release 分支的内容已全部回到 develop，符合 nvie |
| `v0.6.3..release-v063-build` | **15** | ⚠️ **tag 之后该分支又长了 15 个提交**（含 `d097f48c7` 移除隐式触发那条 CI 改动）⇒ 分支名说"v063 的构建"，内容已不是 |
| `git branch --list 'release-*'` | `release-v062-build`、`release-v063-build` 均**仍存在** | ⚠️ nvie 要求合回后删除；此处不删，于是"哪条线代表 v0.6.3"随时间失真 |

### 2.5 滚动渠道 B 与版本号：三个数字互相说不通

```
marketplace.json 声明的版本      0.7.0        （develop 与 dist-plugin 上一致）【git 实测】
plugin/VERSION                  0.7.0        （落于 713565ff7 "feat(ac257): version 0.7.0…"）【git 实测】
最新 tag                        v0.6.3       ⇒ 0.7.0 没有任何 tag / Release 与之对应
dist-plugin 实际构建自           2b47315d7    ⇒ 在 v0.6.3 之后 548 个提交、在 develop tip 之前 155 个提交【git 实测】
```

⊢ **用户 `/plugin install quay` 装到的东西**：自称 `0.7.0`，实际内容是 develop 中间的某个提交，
**既不等于任何 tag，也不等于 develop 当前状态**。
⇒ 问题不是"滚动渠道该不该存在"（人 2026-09-14 已裁定它是显式手动动作，是有意设计），
**而是"装到的是哪个版本"这个问题今天没有可机械回答的形式**。

### 2.6 强制力现状：GitHub 原生分支保护不可用

```
GET /repos/yaleh/quay/branches/{master,develop}/protection   → 403
GET /repos/yaleh/quay/rulesets                               → 403
两者同一消息："Upgrade to GitHub Pro or make this repository public"          【gh 实测】
```

⊢ **本仓库拿不到 required status checks / 禁止直推 / 禁止 force-push 中的任何一项。**
nvie 模型在现代实践里默认靠分支保护兜底，**这里必须全部由本仓库自己的机件承担**
（`precommit-guard`、driver 的机械 fan-in、静态闸）。
⇒ **§6 的 master 推进机制不能设计成"靠规矩不去推它"，必须设计成"推它这件事本身有唯一入口且留痕"。**

---

## 3. 设计：三条长期线 + 一条临时线

```
                      ┌─────────────────────────────────────────────┐
   task/<id> ────────▶│  develop   主干：唯一分叉基线 + 唯一汇入点      │
   （per-task         │            （②的 per-task 模型不变）          │
     worktree）       └───────────────┬─────────────────────────────┘
                                      │ 切（要求：上一次 decisive CI 绿）
                                      ▼
                            release/vX.Y.Z   临时线：只接受版本/发布修复类提交
                                      │ 合回 develop → 在合并点打 tag vX.Y.Z → 删除本分支
                                      ▼
                          release.yml（workflow_dispatch，吃 tag）
                                      │ 全部 job = success（⛔ 不是"release 对象存在"）
                                      ▼
                      ┌─────────────────────────────────────────────┐
                      │  master    发布线：== 最近一次全绿发布的 tag    │
                      │            只被这一个事件 ff 推进               │
                      │            ⛔ 永不接受直接提交、永不被合并进入   │
                      └───────────────┬─────────────────────────────┘
                                      │ 仅当 develop 已带着不可发布的改动前进时
                                      ▼
                            hotfix/vX.Y.Z+1   备用线（发生率 1，见 §5，⛔ 不作为落地前置）

   dist-plugin（orphan）：滚动渠道 B 的产物分支，由人显式触发从任意 ref 构建
                          ⛔ 不纳入上述晋升链（人 2026-09-14 裁定它是独立的显式动作）
```

### 3.1 每条线的唯一权威角色

| 线 | 唯一角色 | 前进事件（**有且仅有一个**） | 禁止 |
|---|---|---|---|
| `develop` | 分叉基线 + 汇入点 | fan-in merge / driver 的状态提交 | — |
| `release/vX.Y.Z` | 版本定稿 | 版本 bump、changelog、**仅**发布路径的修复 | ⛔ 功能提交；⛔ 合回后继续存活 |
| `master` | **最近一次全绿发布** | release.yml 该 tag 的 run 全绿之后 ff 到该 tag | ⛔ 直接提交；⛔ 作为 merge 目标；⛔ 任何 non-ff 更新 |
| `hotfix/vX.Y.Z+1` | 已发布版本的紧急修复 | 见 §5 触发条件 | ⛔ 在 master 有实义之前使用（无基可切） |

### 3.2 为什么是"改造 master"而不是"归档 master + 默认分支切到 develop"

| 方案 | 优点 | 缺点 | 判断 |
|---|---|---|---|
| **A 归档 master**（照本仓库已有先例 `origin/b-master-archive-2026-08-06`、`develop-archived-20260816` 改名）+ 默认分支切 develop + 用 tag 序列当发布台账 | 一次性了结；不需要维护第三条线 | **发布状态不再有一个可 ff 比较的 ref**：要回答"最新一次真正成功的发布是哪个"必须查 gh run 的 conclusion，而 §2.6 说明 criterion **不得调 gh**（60s 预算 + PATH/认证/限流）【转引 GOAL-020 §三.2】⇒ 该问题退化为不可本地判定 | ✗ |
| **B 改造 master**（本 SPEC） | 「最近一次全绿发布」成为一个**本地可读的 git ref**，`git rev-parse master` 一条命令即得，天然满足 criterion 的机制约束；且 master 重新前进后，`ci.yml` 里 `push: branches:[master]` 那条今天的死配置自动复活成"发布点复核" | 需要定义并实现推进机制（§6） | ✅ **采纳** |

**⚠️ 但 A 里有一条必须单独采纳**：**默认分支切到 `develop`**。
它与 B 不冲突，且解决的是 §2.2 后果 1+2（新 clone / 新 worktree 的基点），
**而 B 解决的是后果 3（半截发布不可见）**——两者治的是不同的病。
nvie 原文时代"默认分支 = master"是因为默认分支同时承担"门面"和"PR 目标"；
本仓库的 PR/worktree 目标应当是主干，**发布线不需要当默认分支**。

### 3.2.1 已裁定：默认分支即刻切 `develop`（人 2026-09-15，§1 ⑤ 问 1）

**动作**（一条，可逆）：

```
gh api repos/yaleh/quay -X PATCH -f default_branch=develop
```

**✅ 执行记录（2026-09-15T13:5xZ，人授权后当轮执行）**：

```
切换前  gh repo view yaleh/quay --json defaultBranchRef  →  master
执行    gh api repos/yaleh/quay -X PATCH -f default_branch=develop  →  develop
复核    gh repo view yaleh/quay --json defaultBranchRef  →  develop          ✅
本地半  git remote set-head origin -a  →  origin/HEAD set to develop
        （切换前 refs/remotes/origin/HEAD = refs/remotes/origin/master）      ✅
```

⚠️ **本地那一半是每个检出各自要跑一次的**——`origin/HEAD` 是本地缓存，GitHub 侧改了不会自动同步。
worktree 与主检出共享 `refs/remotes/`，故本轮这一次覆盖了它们；**其它机器/其它 clone 仍需各跑一次**。
⊢ `AC-273` 守的就是这个量（§7 丁）。

**⚠️ 不等 master 改造完成**——理由是两者治的病不同（见上），且 §9 第 5 步（首次 ff）被 `AC-268` 阻塞中，
**若把默认分支的修复绑在它后面，§2.2 后果 1+2 会一直存在到第一次全绿发布为止**。

**影响面核查**【读码】：
- `ci.yml` 的 `push/pull_request: branches:[master, develop]` —— **不受影响**（按分支名匹配，非按默认分支）
- `release.yml` / `publish-plugin-dist.yml` —— **不受影响**（`workflow_dispatch` + 显式 `ref`/`tag` 输入）
- `marketplace.json` 的 `ref: dist-plugin` —— **不受影响**（钉死分支名）
- **受影响且正是目的**：新 `git clone` 的检出分支、新 PR 的默认 base、`EnterWorktree` 的默认基点
  （`origin/HEAD` 随默认分支走 ⇒ §2.2 后果 2 消失）
- ⚠️ 切换后 `origin/HEAD` 的本地缓存不会自动更新，各检出需 `git remote set-head origin -a` 一次

---

## 4. release 分支规程

### 4.1 命名与生命周期

```
release/vX.Y.Z        ← 取代现行的 release-vXXX-build
  从 develop 切  →  版本 bump（9 处，见 §4.3）+ changelog  →  合回 develop
  →  在合并点打 tag vX.Y.Z  →  【删除分支】
```

**变更点（相对现状）有三个，其余保持**：
1. 命名带 `/` 与完整 semver（现状 `release-v062-build` 的 `062` 形态在 `0.10.x` 之后会排序错乱）
2. **合回后删除**（现状：两条都还在，且 `release-v063-build` 在 tag 之后又长了 15 个提交，§2.4）
3. 切点前置（§4.2）

### 4.2 切点前置：develop 的上一次 **decisive** CI 必须是绿

**⚠️ 这是一条实测依赖，不是凭空前置**（硬规则 12 要求给出发生率）：
`gh run list --workflow ci.yml --branch develop` = **92 次 run（2026-08-16 → 2026-09-15）零成功**
（52 failure / 40 cancelled，decisive 绿率 0/52）【转引 GOAL-020】。

⊢ 因此本条**今天结构上不可满足**，它的落地**依赖 `AC-265`（develop 首绿）先达成**。
⛔ 在 AC-265 达成之前，本条只能记为"规程已定义、尚不可执行"，**不得**用它去阻塞任何现有流程
（否则就是"每个前置单看都成立，合起来永远差最后一步"——硬规则 12 点名的形态）。

**判定必须只计 decisive run**（success|failure），因为 40/92 = 43% 的 develop run 是 `cancelled`
（被后续 push 顶替，不代表红）【转引 GOAL-020】。

### 4.3 版本 bump 的落点：一个必须裁定的分歧

**现状**：bump 发生在 develop 上（`713565ff7` 把 9 处版本字面量推到 `0.7.0`），
于是 develop 与滚动渠道 B **持续广告一个没有任何 Release 的版本号**（§2.5）。

| 选项 | 做法 | 代价 |
|---|---|---|
| **i. nvie 严格** | bump 只发生在 `release/*` 上，随合并回到 develop；develop 间歇期携带**上一个已发布版本号** | ⚠️ 更糟：滚动渠道装到的东西会自称 `0.6.3`（一个真实存在的已发布版本）而内容是 develop ⇒ 版本号说谎的方向从"未来"变成"过去"，**更难查** |
| **ii. 预发布标记** ✅**已裁定采纳** | develop 上的版本写作 `0.7.0-dev`；`release/vX.Y.Z` 上去掉 `-dev` 后缀；tag 打在去后缀的提交上 | 需要 `version-consistency-check.ts` 的 9 条目认 `-dev` 后缀（它已是集中式清单，改动局部）【读码】 |

**⊢ 已裁定：选项 ii（`-dev` 后缀）**（人 2026-09-15，§1 ⑤ 问 2）。
理由：它让「装到的是不是一个已发布版本」从**字面量**即可判定，不需要查 tag、不需要调 gh，
与 §2.6 的 criterion 机制约束一致。

**落实口径**：

| 位置 | 版本形态 | 说明 |
|---|---|---|
| `develop` 常态 | `0.7.0-dev` | 9 处版本字面量齐步；滚动渠道 B 装到的东西自称 `-dev` ⇒ **自证"不是已发布版本"** |
| `release/v0.7.0` 上的 bump 提交 | `0.7.0` | 去后缀即定稿；tag 打在合回 develop 的合并点 |
| 合回 develop 之后 | `0.8.0-dev` | 下一轮开发立即带上新的 `-dev`（⛔ 不要让 develop 停留在无后缀的已发布版本号上，否则 §2.5 的歧义原样复发，只是方向相反） |

**实现要点**【读码】：
- `scripts/version-consistency-check.ts` 的 `VERSION_ENTRIES` 是**集中式清单**（9 条），
  改动局部：让比对认 `-dev` 后缀，并断言**要么全带、要么全不带**（⛔ 半带 = 漂移，必须红）
- `0.7.0-dev` 是合法 semver prerelease ⇒ `package.json` / `npm pack` 接受
- 产物名在非发布构建下会带后缀（`quay-0.7.0-dev.tgz` / `quay-sea-0.7.0-dev-linux-x64.tar.gz`），
  **正式发布产物名不变**（release 分支上已去后缀）
- ⚠️ **一个需实测的未知**：Claude Code marketplace 的 `version` 字段是否接受 prerelease 后缀。
  ⛔ 不得假定可行——落实前先用一次真实 `/plugin install` 验证（残留项，§10）

### 4.4 打 tag 与发布：复用已被证过的三点同一判据

`gap-ac108-push-tag-release-v060`（status: done）已经为 v0.6.0 定义并执行过这组判据【读任务体】：

```
① git rev-list --left-right --count origin/develop...develop   →  0  0     （推送完成）
② git rev-parse vX.Y.Z  ==  git rev-parse <合并点>                          （tag 指向同一提交）
③ gh release view vX.Y.Z --json tagName,createdAt  →  存在且新于本次切换      （release 对象存在）
```

**本 SPEC 要补的第四点**——正是 §2.3 关键观察揭示的缺口：

```
④ 该 tag 的 release.yml run 的【全部 job】conclusion = success
   ⛔ 「release 对象存在」不蕴含 ④：v0.6.3 的 release 对象比它的 run 早 12 秒诞生
```

④ 是 `master` 推进的唯一条件（§3.1），也是 `AC-268` 的内容【转引 GOAL-020】⇒ **本 SPEC 不重复定义它，只消费它。**

---

## 5. hotfix 线：发生率 1，降为有条件备用通道

**硬规则 12 要求先给发生率再谈机制。实测【git 实测 + gh 实测】**：

```
唯一一次"已发布版本坏了要紧急修"：v0.6.2 (12:19Z) → v0.6.3 (12:46Z)，间隔 27 分钟，
修的是 gap-dist-plugin-missing-node-modules-task-schema-yaml。
解决方式：从 develop 再切一个 release 分支发新版，【没有用到】任何 hotfix 机制。
```

⊢ **结论：hotfix 线今天不是缺失的能力，而是尚未出现的需求。**
⛔ 因此本 SPEC **不把 hotfix 列为落地前置**，只定义它**什么时候才真正必要**：

> **hotfix 的充要触发条件**：已发布的 `vX.Y.Z` 有必须修的缺陷，**且** develop 当前 HEAD 因为携带了
> 未完成/不可发布的改动而**不能直接切一版发出去**。
> ⇒ 只要 develop 随时可发（v0.6.2→v0.6.3 那次就是），**正确做法就是再切一版，不是 hotfix。**

**流程（真需要时）**：`master` 切 `hotfix/vX.Y.Z+1` → 修 → 合回 `develop` → 在合并点打 tag →
release.yml → 全绿后 master ff 到新 tag。
⚠️ **hotfix 分支同样走 per-task worktree + scoped 门**（②的现行模型），⛔ 不新开一套执行路径。

**前置**：hotfix 在 `master` 具备实义之前**无基可切**（今天从 master 切等于从 2026-08-03 的化石切）
⇒ **§3 落地是 §5 的前提，不是并列项。**

---

## 6. master 的推进机制：已裁定为 **A（release.yml 内新 job）**

**机制约束（⛔ 硬约束，不是偏好）**【转引 GOAL-020 §三.2 + §2.6】：
- criterion 只有 pass/fail 两态、总预算 60s、**不得现场调 `gh`**（网络/认证/限流会被记成"红"，且 `gh` 在非标准 PATH）
- ⇒ 任何"master 是否正确"的判据必须是**本地 git 读数 + 本地载体读数**（`.quay/ci-runs.jsonl`，由 AC-265 的采集器产出）
- GitHub 无分支保护可用 ⇒ 推进动作必须**有唯一入口且留痕**，不能靠"大家记得别推它"

| 选项 | 做法 | 优 | 劣 |
|---|---|---|---|
| **A 工作流内** ✅**已裁定采纳** | `release.yml` 末尾加一个 job（`needs:` 枚举其余全部 job，`contents: write`）执行 `git push origin ${{ inputs.tag }}:master` | 与 ④ 天然同源（job 依赖即条件）；零人工 | 新增一个有写权限的 job（边界问题已由人裁定 ③ 不适用于显式 dispatch 的同一次 run，见 §1 ⑤ 问 3） |
| **B 纯人工** | 人确认全绿后 `git push origin vX.Y.Z:master` | 零实现 | 无留痕、无强制；§2.6 说明这里没有任何兜底 |
| **C 本地机件** | `plugin/scripts/release-advance-master.ts`：读 `.quay/ci-runs.jsonl` 判 ④ → ff → 写事件 | 与本仓库既有机件范式一致；离线可判；留痕；**不需要给 CI 发新的写权限** | 多一个机件要进 capability-catalog（六行义务）【转引 memory】 |

**⚠️ C 的前置依赖在本 SPEC 撰写当轮已经满足**（2026-09-15 13:15–13:36Z 实测）：
`plugin/scripts/ci-runs-collect.ts` 于 `854a21c2b` 落到 develop，载体 `.quay/ci-runs.jsonl` 已产出
**40 条真实记录**（非 fixture）——其中 `workflow="Release"` 的 **2 条**分别是 `v0.6.2`(34843029988) /
`v0.6.3`(34845477762)，均带 `conclusion` 与**逐 job 清单**【git 实测 + 载体实测】。
⊢ 即：**"该 tag 的 release run 是否全绿" 今天就能在本地零 `gh` 调用地判定**，
正好落在 §6 开头那条硬约束（criterion 不得调 gh）的可行侧。
⛔ 但按硬规则 4 推论三，"载体已产出" ≠ "本机制已验证"——C 仍需一次真实演练才算数（判据戊）。

**⊢ 已裁定：A**（人 2026-09-15，§1 ⑤ 问 3）。
⊢ 该裁定同时确定了 ③ 的边界：**③ 禁的是隐式触发（push/tag 自动跑），不是显式 dispatch 的同一次 run 内的后续 job。**
C 不采纳，但 **C 的载体（`.quay/ci-runs.jsonl`）仍然是判据甲的读取面**（§7）——
即：**推进由 A 做，核对由本地载体做，两者互为独立读法**（硬规则 4b：判活性不用被测对象自己产生的量）。

### 6.1 A 的落地形态（实现期照此写）

**`release.yml` 现有 job 全集（6 个，逐字枚举）**【读码 `.github/workflows/release.yml`】：

```
release                              :28
sea-release                          :119   (matrix ×3)
sea-verify-node-free                 :269   (needs: sea-release)
sea-verify-node-free-cross-platform  :364   (matrix, needs: sea-release)
dist-verify-node-floor               :452   (needs: release)
delivery-manifest-verify             :499   (needs: [release, sea-release])
```

**新 job**：

```yaml
  advance-master:
    needs: [release, sea-release, sea-verify-node-free,
            sea-verify-node-free-cross-platform,
            dist-verify-node-floor, delivery-manifest-verify]   # ⛔ 必须是上面 6 个的全集
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
        with: { ref: ${{ inputs.tag }}, fetch-depth: 0 }
      - run: git push origin ${{ inputs.tag }}:master      # ⛔ 永不加 --force
```

**三条不变式**：

| # | 不变式 | 靠什么保证 |
|---|---|---|
| 1 | 任一 job 失败或被跳过 ⇒ master 不动 | GitHub Actions 的 `needs` 默认语义（被依赖 job 非 success 时本 job 跳过）⇒ **fail-closed 是默认行为，不是额外代码** |
| 2 | 只做 fast-forward，永不改写 | `git push` 对非 ff 更新**默认拒绝**；⛔ 永不加 `--force`。若 master 曾被直接提交过 ⇒ 这里会红，**这正是期望行为**（§3.1 禁止直接提交） |
| 3 | `needs:` 必须覆盖全部其余 job | ⚠️ **人工枚举会漂移**：将来给 `release.yml` 加第 7 个 job 而忘了加进 `needs:`，master 就会在"半绿"时前进——**正是本 SPEC 要防的那个失效模式原样复发**。⇒ 必须配一个静态检查：断言 `advance-master.needs` ⊇（全部 job 键 − `advance-master`）。⊢ 与 `GOAL-012`「用机械枚举取代三次都漏的人工枚举」同源，⛔ 不靠 review 记得 |

**⊢ 不变式 3 是 A 唯一新增的脆弱点**，且它有已知同形先例（硬规则 5b）⇒ 它的静态检查**与 A 同批落地，不得延后**。

**首次 ff 的跨度**：`master..v0.6.3` = **18852** 个提交【git 实测】。
⚠️ **但首次 ff 不应该指向 v0.6.3**——v0.6.3 的 run 是红的（§2.3），按 §3.1 的规则它不够格。
**最近一次 release run 全绿是 v0.3.13（2026-07-24）**【转引 GOAL-020】，而 master 当前 tip（2026-08-03）
**晚于**它 ⇒ 回退到 v0.3.13 将是 non-ff 改写，违反 §3.1。

⊢ **已裁定（人 2026-09-15，§1 ⑤ 问 4）：首次 ff 等 v0.7.0 全绿。**
即 master 保持不动，直到 `AC-268` 产出第一个全绿发布，由 §6.1 的 `advance-master` job **自动**一次 ff 到那个 tag
（跨度届时约 19.5k+ 提交，一次性）。在此之前 master 停在原地**是规则的正确输出，不是缺陷**——
它诚实地表达了"至今没有一次全绿发布"。
⛔ **不接受 ff 到红着的 v0.6.3**：那会让 master 从第一天起就说谎，等于把 §2.3 揭示的"半截发布不可见"
用一条新的线重新制造一遍。
⚠️ 这也意味着 §2.2 的后果 1+2（默认分支/worktree 基点）**不能等 master 修好**，
已由 §3.2.1 那条独立动作（默认分支即刻切 develop）先行解决。

---

## 7. 判据（归属已裁定：挂 `GOAL-020`；⛔ 本 SPEC 不自行写 goal store，编号由立案时分配）

**归属**：**已裁定全部挂 `GOAL-020` 之下**（人 2026-09-15，§1 ⑤ 问 5）——
该 GOAL 的标题「CI 与 release 渠道成为可信守门员」正是本 SPEC 的上位命题，
且本 SPEC 的判据甲/戊**消费** `AC-268` 的结果，同一 GOAL 内依赖关系可直接表达。
**立案时注意**【转引 memory】：goal store 无 CAS，并发会话会互相覆盖 ⇒ 建新 AC 必须传 `--expect-absent`；
当前最大编号 `AC-269`。
**⚠️ `achieved` 永久锁定**（全仓 `writeGoalStatus` 仅 2 个调用点、均写 `achieved`，无回退路径）【转引 GOAL-020 §三.1】
⇒ 会回退的活性判据必须 `long-term: true`。

**已立案（2026-09-15T14:0xZ，5 条全部写入 goal store，`--expect-absent`，挂 `GOAL-020`）**：

| # | AC | 判据（口径） | 立案当轮的**实跑**取值 | long-term |
|---|---|---|---|---|
| **甲** | `AC-270` | `master` ∈ {`9316b797d`（首次 ff 前的化石 tip，裁定 4 允许）, 某个 tag}；若等于某 tag，则该 tag 在 `.quay/ci-runs.jsonl` 里的 Release run `conclusion=success` | **PASS**（守卫型）。⚠️ **本行原稿写作"今天取假"，那是裁定 4 之前的口径**——裁定 4 把化石值列为允许取值后，它今天就必然是 PASS。⇒ 改判为**守卫**：首次 ff 前守"没有东西直推 master"，首次 ff 后守"没有在半绿发布上前进"。**负控制（已跑）**：把判据指向 `develop`（既非化石也非 tag）⇒ `exit 1 / CAUSE=master-moved-to-a-non-tag-commit` ⇒ **能取假** | ✅ |
| **乙** | `AC-271` | 本地 `release-*` / `release/*` 分支不存在，或每条的 tip 都 `points-at` 某个 tag | **FAIL**：`1 of 2` 违规——`release-v063-build` 的 tip 不指向任何 tag（比 `v0.6.3` 多 15 个提交）。⊢ 判据按"tip 是否指向 tag"判，⛔ 不解析分支名里的版本号 ⇒ 新旧命名都适用 | ✅ |
| **丙** | `AC-272` | `dist-plugin` 声明的版本以 `-dev` 结尾（自证非发布版），**或**存在同名 tag 且其 `build from <sha>` 正是该 tag 的提交 | **FAIL**：`CAUSE=claims-a-version-that-was-never-released` —— 声明 `0.7.0` 而 `v0.7.0` 不存在（§2.5）。⊢ 这条把裁定 2 的目的编码成判据：`-dev` 一旦落实，此臂自动转绿 | ✅ |
| **丁** | `AC-273` | `git symbolic-ref refs/remotes/origin/HEAD` == `refs/remotes/origin/develop` | **PASS**（守卫型）——**因为裁定 1 已于本轮执行**（见 §3.2.1 执行记录）。跑 `set-head` 之前它是红的。**负控制（已跑）**：把期望值换成 `origin/master` ⇒ `exit 1 / CAUSE=default-branch-not-the-trunk` ⇒ **能取假**。⊢ 读本地 ref 而非调 `gh`：criterion 只有 pass/fail 两态、60s 预算，`gh` 不在 driver 的 PATH 上 | ✅ |
| **戊** | `AC-274` | 载体里存在 `workflow=Release ∧ conclusion=success ∧ ts > 2026-09-15T14:00:00Z` 的 run，**且** master 正是其 tag 的提交 | **FAIL**：`CAUSE=no-green-release-in-the-post-filing-window` —— 载体 2 条 Release run 全 failure。⛔ 时间窗是硬规则 4 推论三的要求：能被立案**之前**的绿满足的判据，证明的是"能产出"不是"已产出" | ❌（一次性） |

**⊢ 两条守卫型判据（甲/丁）今天是 PASS，这不是空判据**——判别标准不是"今天红不红"，而是**能不能取假**，
而这一点由上表里两个已经跑过的负控制证明。⛔ 但也要认：**原稿把它们写成"今天取假"是错的**，
错因是裁定 4 落进文档时我只改了 §6 的表述、没有回头改 §7 的那一列（**硬规则 5b：在某处修好 X ≠ X 只在那一处**）。

**写入面实测的一条约束**（立案当轮撞到，值得记）：goal store 的 write surface **fail-closed 地要求
每一个 failure exit 与它的 stderr 写在【同一物理行】**——乙/戊 初稿把消息拆成多行续行，
被 `criterion carries N failure exit(s) that write no cause` 拒绝，改成 `msg = …` + `sys.stderr.write(msg); sys.exit(1)` 后通过。
⊢ 这正是硬规则 3b 的机制化：**一个失败但不说原因的判据，与"没查成"同形**，所以它在写入时就被挡住。

**验证**：5 条记录写入后，用 store 自己的 runner（`quay goal gate <id> --dry-run`，⛔ 不是我本地那份 python）
逐条复跑，取值与上表逐条一致：`270=0 / 271=1 / 272=1 / 273=0 / 274=1`。

**依赖**：甲/戊 依赖 `AC-268`；§4.2 的切点前置依赖 `AC-265`；丙 与 `GOAL-019` 相邻但不重叠（见 §8）。

---

## 8. 非目标（⛔ 边界，避免与在跑的 GOAL 重叠）

| ⛔ 不做 | 已由谁持有 |
|---|---|
| 让 develop 的 CI 变绿 / CI 红的机械归因 | `AC-265` / `AC-269` |
| 修 release job 的 hang（tokenless 测试泄漏子进程） | `AC-266` |
| 修 SEA 产物 `quay serve` 崩（`plugin-root.ts` 顶层求值） | `AC-267` |
| 让 release 渠道真发出一个版本 | `AC-268`（本 SPEC **消费**其结果，不重复定义） |
| plugin cache / marketplace 的解析路径与交付自足 | `GOAL-019` |
| 重新引入 `integration` 分支 | 2026-08-13 已退役（②），⛔ 本 SPEC 不推翻 |
| 把发布/发布物重新挂回自动触发 | 人 2026-09-14 裁定（③） |
| 改 per-task worktree + fan-in 模型 | 现行模型不动 |

---

## 9. 迁移顺序（按"能不能今天就做"排，不按理想顺序排）

| 步 | 动作 | 依赖 | 今天可做？ |
|---|---|---|---|
| 0 | **把本 SPEC 落盘**（"master 是化石"从口头认知变成可引用记录） | 无 | ✅ **已完成** |
| 0b | **判据甲–戊立案**（`AC-270`..`AC-274`，挂 GOAL-020） | 裁定 5 | ✅ **已完成**（2026-09-15T14:0xZ，5 条写入并经 store runner 复跑，§7） |
| 1 | **GitHub 默认分支 `master` → `develop`** | 无（纯 GitHub 设置，可逆） | ✅ **已完成**（2026-09-15T13:5xZ，含本地 `set-head`，执行记录见 §3.2.1）；⚠️ 其它 clone 需各跑一次 `git remote set-head origin -a`（`AC-273` 守此量） |
| 2 | release 分支规程（命名 + 合回删除） | 无 | ✅ 下一次切版本时即可采用；现存两条 `release-v06x-build` 按判据乙清理 |
| 3 | 版本号 `-dev` 后缀（§4.3 选项 ii，**已裁定**） | 无（裁定已下） | ✅ 可实现；⚠️ marketplace 是否接受 prerelease 版本号需先实测（§10 残留 1） |
| 4 | master 推进 job `advance-master` + `needs:` 全集静态检查（§6.1，**已裁定 A**） | 无（裁定已下） | ✅ **实现可今天就做**；⛔ 不变式 3 的静态检查必须同批落地；**生效要等第 5 步** |
| 5 | **首次 ff**：master → 第一个全绿发布的 tag | `AC-268` | ❌ 阻塞中（至今 0 次全绿发布）；⚠️ 第 4 步落地后**这一步是自动发生的**，不需要另外的人工动作 |
| 6 | hotfix 线 | 第 5 步 + 真实触发条件出现（§5） | ❌ 且**不应催化**（发生率 1） |

⊢ **裁定之后，第 1–4 步全部解除阻塞**（第 3、4 步此前唯一的阻塞就是裁定本身）。
⊢ **唯一仍被外部阻塞的是第 5 步**，它等 `AC-268`；而它一旦发生，由 §6.1 的 job **自动完成**。

---

## 10. 开放问题：**已全部裁定**（人 2026-09-15）＋ 实现期残留

**原 5 个开放问题的裁定见 §1 ⑤ 表**（1 默认分支即刻切 develop｜2 `-dev` 后缀｜3 方案 A｜4 等 v0.7.0 全绿｜5 挂 GOAL-020）。
⛔ 本节**不再保留**这 5 条为开放项。

**实现期残留（不是裁定问题，是必须实测才能回答的未知）**：

| # | 残留 | 为什么不能靠推断解决 | 触发点 |
|---|---|---|---|
| 1 | Claude Code marketplace 的 `version` 字段是否接受 prerelease 后缀（`0.7.0-dev`） | 官方 schema 未声明该约束；⛔ 「semver 合法」不蕴含「该渠道接受」（同硬规则 5：某来源没说不等于不存在限制） | §9 第 3 步落地前，用一次真实 `/plugin install` 验证 |
| 2 | `advance-master` 的 `needs:` 全集静态检查落在哪个检查器 | 需与既有 workflow 类检查器合并还是新建，取决于现有覆盖面 | §9 第 4 步实现时；⛔ 不得延后到第 4 步之后 |
| 3 | ~~判据甲–戊的立案时机~~ | **已关闭**：2026-09-15T14:0xZ 全部立案为 `AC-270`..`AC-274`（`--expect-absent`，挂 GOAL-020），见 §7 | — |

---

**执行状态（2026-09-15T14:1xZ）**：§9 第 0/0b/1 步**已完成**（SPEC 落盘、`AC-270`..`AC-274` 立案、默认分支切换含本地 set-head）；
第 2/3/4 步已解除阻塞、待实现；第 5 步等 `AC-268`，届时由 §6.1 的 `advance-master` job 自动完成。
⛔ 本文件自身仍不推进任何分支——master 至今未动，且按裁定 4 这正是正确输出。
