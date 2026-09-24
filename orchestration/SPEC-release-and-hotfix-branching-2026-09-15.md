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
**①默认分支即刻切 `develop`（不等 master）〔⚠️ 已被 §3.2.1′〈2026-09-17 追加裁定〉反转：默认分支回到 `master`，
理由与效力见该节〕｜②develop 携带 `X.Y.Z-dev`，release 分支去后缀〔⚠️ **落实机制已于 2026-09-20
由 §12 追加裁定修订**：`-dev` 语义**不变**，变的是「谁写后缀」——`VERSION` 单一来源 + `resolveVersion` build 模式，
**不再有手工「去后缀的 bump 提交」**；下文的「去后缀」措辞一律读作 §12 的机制〕｜
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
| 1 默认分支是否现在切 `develop` | **「是，且与 master 改造无冲突」**〔⚠️ **这条裁定已于 2026-09-17 被 §3.2.1′ 追加裁定反转**（默认分支回到 `master`）——本行保留为历史，效力不再〕 | §3.2、§9 第 1 步 | 解除 §2.2 后果 1+2；**不等 master 修好** |
| 2 版本 bump 落 develop（带 `-dev`）还是落 release 分支 | **「`-dev` 后缀」** | §4.3 选项 ii | develop 携带 `X.Y.Z-dev`，release 分支去后缀〔⚠️ **裁定原文保留为历史；落实机制已由 §12 修订**（2026-09-20）：「去后缀」不再是 release 分支上的一次手工提交，而是 `resolveVersion` 在 **build 模式**下对同一份 `VERSION` 的解析结果〕 |
| 3 master 推进用 A 还是 C | **「A 工作流内」** | §6 | ⊢ 人由此同时裁定：**同一次显式 dispatch 内的后续 job 写 GitHub，不违反 ③ 的裁定精神**（③ 禁的是隐式触发，不是显式 run 内的后续步骤） |
| 4 首次 ff 等 v0.7.0 全绿还是接受红着的 v0.6.3 | **「等 v0.7.0 全绿」** | §6 末、§9 第 5 步 | master 在此之前**保持不动是正确输出** |
| 5 判据甲–戊 挂 GOAL-020 还是独立立 GOAL | **「挂 GOAL-020」** | §7 | 编号立案时分配（当前最大 `AC-269`） |

**⊢ 立论一句话**：2026-08-05 的判断在当时是对的（那时 master 角色是空的，加一条空转发布线是白付成本）；
**今天它失效的原因不是那个判断错了，而是它点名的前提条件发生了变化**——发布流程从"不存在"变成了"存在但半截"。

---

## 2. 现状盘点（全部为直接量，2026-09-15）

> ⚠️ **本节的读数是 2026-09-15 的快照，⛔ 不是当前状态。** 其中「默认分支 = `master`」这一项
> 于 2026-09-15 当日被 §3.2.1 原裁定切成 `develop`，又于 2026-09-17 被 §3.2.1′ 追加裁定**反转回 `master`**
> ⇒ 它今天**恰好又等于本节记录的那个值**，但那是**两次裁定**的结果，⛔ 不是「本节读数一直没变」。
> 其余各项（master 化石、三条交付渠道的缺口、release 分支现状、版本号三处互相说不通）**仍然有效**。

### 2.1 四条线的实际角色

| 线 | tip | 谁在写 | 实际角色 | 读数 |
|---|---|---|---|---|
| `master` | `9316b797d` 2026-08-03 22:38Z | **无人** | **化石**：ADR-015「循环直接跑在 master 上」那套经典循环的终点，ADR-022 同日退役该循环后再无人碰 | `master..develop` = **19548**；`develop..master` = **0** ⇒ master 是 develop 的祖先，**可 ff**【git 实测】 |
| `develop` | 随时前进（今日 13:18Z 仍在动） | promotion-driver / worker-driver / fan-in / 三层 | **真正的主干**：任务状态权威源、worktree 分叉点、fan-in 汇入点 | — |
| `author` | 与 develop 逐字相同 | 主检出（doc-only 写面），**并推送到 `origin`** | develop 的活跃工作副本，非权威；**第四条长期线**（§3.1） | `develop..author` = `author..develop` = **0**【git 实测】；`origin/author` = `e27f111ed4b8a5feca7b8579d831c2d95f8aa476`，实测**是本地 `author` 的真实祖先**【git 实测 2026-09-17】 |
| `task/<id>` | 每任务一条 | worker | per-task 隔离（②的现行模型） | — |

**`author` → `origin` 的推送频率约定**（2026-09-17 起，单点失效防护，见
`gap-ac283-author-pushed-to-origin-and-ancestor-of-local`）：`author` 只增不改
（`syncDevelopToDoc` 走 `git merge --ff-only develop`，非快进时显式报「无法 ff-only 同步」而不是改写历史）
⇒ 每次推送都是 fast-forward，**约定按事件而不是按时间间隔**：本地 `author` tip 每前进一次
（= 主检出上的一次 doc 侧提交），就应推一次 `git push origin author`。
⛔ **不设数值间隔**（「每小时 / 每天」这类）：该动作的发生率今天没有被测量过，
按硬规则 4 推论一，成本结构未知前不设数值阈值。
⚠️ **这个约定今天没有机械载体**——没有任何 driver / 脚本会推 `author`，它是纪律不是机制。
常设守卫只有 `AC-283` 的判据（`origin/author` 存在 ∧ 是本地 `author` 的真实祖先），
**而它测的是祖先关系、不是新鲜度**：一次推送之后远端停在旧点仍然 pass
⇒ 「远端确实是一份**新鲜**备份」这半边今天**没有判据**（该缺口记在
`tasks/gap-ac283-author-pushed-to-origin-and-ancestor-of-local.md` 自己的 AC2，⛔ 不在此处补判据）。

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

## 3. 设计：四条长期线 + 一条临时线

（⚠️ 本节标题原为「三条长期线」；第四条 `author` 由 2026-09-17 追加补入 §3.1 表与上图，
理由与效力见 §3.2.1′〈2026-09-17 追加裁定〉。）

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

   author（第四条长期线，2026-09-17 补入本图）：
   ┌────────────────────────────────┐
   │  本地 doc-only 写面（非权威）    │◀──── ⇅ 双向 ff 同步（doc 侧）────▶ develop
   │  也推送 origin 作备份（§2.1）    │       ─── git push origin author ───▶ origin/author
   └────────────────────────────────┘
```

### 3.1 每条线的唯一权威角色

| 线 | 唯一角色 | 前进事件（**有且仅有一个**） | 禁止 |
|---|---|---|---|
| `develop` | 分叉基线 + 汇入点 | fan-in merge / driver 的状态提交 | — |
| `author` | **本地 doc-only 写面**（⛔ 非权威） | 主检出上的人工 doc 编辑 ⇒ **与 `develop` 双向 ff 同步**（`syncDevelopToDoc` 快进追 develop；doc 侧提交由 `propagateDocBranchToDevelop` 回推 develop）；**并推送 `origin/author` 作单点失效备份**（约定见 §2.1） | ⛔ 不作为 worktree 的分叉点；⛔ 不承载任何权威状态（任务状态以 `develop` 为准）；⛔ 不得被 rebase / `--force` / 删除远端 ref（三者都会让 `AC-283` 转红） |
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

⚠️ **本段后半句已于 2026-09-17 被反转**：它把「默认分支」当成了**一个**目的（PR/worktree 目标），
而 marketplace 的对外门面**复用了同一个量** ⇒ 一个量承担两个目的。观察（默认分支同时承担门面与 PR 目标）
今天仍然对，**反转的是目的排序**。逐字见 §3.2.1′〈2026-09-17 追加裁定〉。

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
⚠️ **2026-09-17 追加**：`AC-273` 已转 `superseded`，该量改由 `AC-285` 守——见 §3.2.1′〈2026-09-17 追加裁定〉。

**⚠️ 不等 master 改造完成**——理由是两者治的病不同（见上），且 §9 第 5 步（首次 ff）被 `AC-268` 阻塞中，
**若把默认分支的修复绑在它后面，§2.2 后果 1+2 会一直存在到第一次全绿发布为止**。

**影响面核查**【读码】：
- `ci.yml` 的 `push/pull_request: branches:[master, develop]` —— **不受影响**（按分支名匹配，非按默认分支）
- `release.yml` / `publish-plugin-dist.yml` —— **不受影响**（`workflow_dispatch` + 显式 `ref`/`tag` 输入）
- `marketplace.json` 的 `ref: dist-plugin` —— **不受影响**（钉死分支名）
- **受影响且正是目的**：新 `git clone` 的检出分支、新 PR 的默认 base、`EnterWorktree` 的默认基点
  （`origin/HEAD` 随默认分支走 ⇒ §2.2 后果 2 消失）
- ⚠️ 切换后 `origin/HEAD` 的本地缓存不会自动更新，各检出需 `git remote set-head origin -a` 一次

### 3.2.1′ 追加裁定（2026-09-17）：默认分支**反转**回 `master`；`AC-273` 转 `superseded`；`author` 列为第四条长期线

> 本节沿用 §11 的追加裁定写法（背景 → 人裁定 → ⊢ 效力 → 与既有授权链的关系），
> 并遵 §7 头的既有纪律：**本 SPEC 不自行写 goal store**——反转的判据由 `GOAL-023` 的 `AC-285` / `AC-284` 承载。

**背景（本 SPEC 自己的 §3.2.1 原裁定 + 2026-09-17 直接量）**：

§3.2.1 于 2026-09-15 裁定并执行了「默认分支 `master` → `develop`」。2026-09-17 人提出：**这个方向反了**——
本地开发继续以 `develop` 为主**不变**，但 **GitHub 默认分支 / marketplace 的对外展示应当是 `master`（已发布版）**。

**理由（人 2026-09-17 提议中给出的直接量）**：`claude plugin marketplace add yaleh/quay`（**不带 ref**）
读的是 GitHub 仓库**默认分支**上的 `.claude-plugin/marketplace.json` ⇒ 当前 `default = develop` 使
**外部访客 / marketplace 浏览面看到 `-dev` 版本号**，而实际装出来的字节是已发布版
（人报告：装出来是 `0.9.0` 的字节、显示却是 `-dev` 的版本号）。
⚠️ **这条是「提议中的理由」**（`gap-ac285-github-default-branch-master` 的立案读数与它同源），
⛔ 本 SPEC **未独立复测该 CLI 行为**——它在此作为**裁定的依据**被引用，不作为本文件自己的实测断言。

**佐证读数（本 SPEC 复测，2026-09-17，【git 实测】）**——三条，逐条可复算：

```
① origin HEAD symref（git ls-remote --symref origin HEAD）  → ref: refs/heads/develop   HEAD
② 默认分支(develop)的浏览面  .claude-plugin/marketplace.json → "version": "0.10.0-dev", "ref": "dist-plugin"
③ master 上的浏览面          .claude-plugin/marketplace.json → "version": "0.9.0",      "ref": "dist-plugin"
   （origin/master tip = 17cf30678da6fd4a56daf9750adf87179f49f58d；实测是 origin/develop 的祖先，落后 291 个提交）
```

⇒ **② 与 ③ 的 `ref` 都是 `dist-plugin`** ⇒ **装出来的字节不变**（`ref` 是钉死的分支名，⛔ 不随默认分支走）；
变的只有**浏览时**从默认分支读到的那一行版本声明 ⇒ **这是元数据展示层的问题，不是产物错误。**

**原裁定哪一半失效（⚠️ 这是「一个量承担两个目的」的形态，不是原判断错了）**：
§3.2 那段（"nvie 原文时代『默认分支 = master』是因为默认分支同时承担『门面』和『PR 目标』；
本仓库的 PR/worktree 目标应当是主干，**发布线不需要当默认分支**"）的**观察今天仍然对**，
但它**没料到 marketplace 的对外门面复用「默认分支」这同一个量**：
PR/worktree 目标要 `develop`，而门面要 `master`——两者在 2026-09-15 被当成了**一件事**。
⇒ **反转的是目的排序，不是观察本身。**

**人裁定（2026-09-17）**：**默认分支改为 `master`；本地开发仍以 `develop` 为主**。
⚠️ 本 SPEC **未持有该裁定的逐字原文**——本行由 GOAL-023 的任务记录转述，形态与
`gap-ac285-github-default-branch-master`、以及本 SPEC 本次修订任务（`gap-spec-release-hotfix-branching-2026-09-17-revision`）
的 Proposal 一致。⛔ 因此它是**转述**，⛔ 不按 §1 ⑤ 那种「逐字引文」对待（硬规则 5：搜不到逐字原文 ⇒ 不得冒充逐字）。

**⊢ 效力（三条，逐条可核）**：

1. **默认分支方向反转** `develop` → `master`。执行动作与 §3.2.1 原动作同形、只是取值相反
   （`gh api repos/yaleh/quay -X PATCH -f default_branch=master`），本地那一半是各检出 `git remote set-head origin -a`。
   ⛔ **本 SPEC 不执行它**——落地由 `gap-ac285-github-default-branch-master`（`goal_ac: AC-285`）持有。
   ⚠️ 执行之后，**下方 §3.2.1 原裁定与 §9 第 1 步的「已完成」记录会变成历史陈述**：它们记录的是
   2026-09-15 那一次执行的事实（当时确实切成 develop），**不是当前配置**。
2. **`AC-273` 转 `superseded`，被 `AC-285` + `AC-284` 取代**（已执行：goal store 实测 `status: superseded`，
   `superseded-by: [AC-285, AC-284]`）。**取代关系**：原 `AC-273` 一条判据**混合检查了两件正交的事**——
   「GitHub 默认分支对不对」与隐含地「worktree 会不会跟着分叉对」。拆成两条正交判据：
   **`AC-285`**（`git ls-remote --symref origin HEAD` 实测 = `refs/heads/master`）
   ＋ **`AC-284`**（worktree 分叉点被 `merge-base` / `is-ancestor` 结构性校验，不再只查分支名）。
   ⚠️ `AC-273` 的判据文字**一字未改**（它照旧能取假），改的只有 `status`——
   ⛔ 不是「判据写错了」，是**它守的那件事被拆开、由两条更窄的判据守**。
   ⛔ **另一个必须处理的后果**：默认分支一旦真翻到 `master`，`AC-273` 的判据会**从 pass 翻成 fail**，
   而它当时的 `status` 是 `achieved` ⇒ 它会以「achieved 但判据正在失败」的形态出现在 I5 读数里。
   转 `superseded` 正是为消掉这个**必然会发生的红**，⛔ 不是为了「让数字好看」。
3. **`author` 列为第四条长期线**（§2.1 表 + §3 ASCII 图 + §3.1 表三处同步补入）：
   `author` = **本地 doc-only 写面**（⛔ 非权威）、与 `develop` **双向 ff 同步**、
   **并推送 `origin/author` 作单点失效备份**（§2.1 有推送频率约定；远端 ref 的落地由
   `gap-ac283-author-pushed-to-origin-and-ancestor-of-local` 持有，`goal_ac: AC-283`，已 done）。

**⊢ 与既有授权链的关系**：本条**不是**推翻 §1 ⑤ 问 1 的**机制**（"默认分支这个量要不要现在动"），
而是**反转它的取值**；§3.2 的论证结构（A 归档 vs B 改造 master 的取舍、两者治不同的病）**全部保持有效**——
本条动的不是"该不该有默认分支这回事"，是"这一个量服务于哪个目的"。
⇒ 与 §11 同形：**同一份权威链条上的追加裁定，不是另起一份 SPEC。**

**⚠️ 本条不做的（⛔ 边界）**：本 SPEC **不自行写 goal store**、**不改任何 AC 的 `criterion`**、
**不改 `CLAUDE.md` 的「分支同步」节**（task 状态写入面，由 `GOAL-023` 的范围与非目标排除）。

---

## 4. release 分支规程

### 4.1 命名与生命周期

```
release/vX.Y.Z        ← 取代现行的 release-vXXX-build
  从 develop 切  →  changelog（⚠️ 没有「版本 bump」这一步 —— 见下）+ 合回 develop
  →  在合并点打 tag vX.Y.Z  →  【删除分支】
  └── 末三步（合回 → 打 tag → 删除）= 一条命令：
      bash plugin/scripts/release-branch-finish.sh <branch> --cut --tag vX.Y.Z
```

**⛔ 整条规程（本节 ① 的前置校验 + 切分支 + 上面这条 `--cut` + push + dispatch `release.yml` + §12 的下一版
bump/重锚 + 清理）= 一条命令（2026-09-24 起，唯一正本在脚本自己）：**

```
bash plugin/scripts/release-cut.sh <X.Y.Z> [--dry-run]
```

`--help` 是该命令用法的唯一正本；`--dry-run` 打印全部步骤（含**台账落点的绝对路径**）而不写任何东西。
本 SPEC ⛔ 不再复述那一串手工步骤（它们是 §4.1.1 / §12 的历史读数，不是操作说明）。**动机（实测）**：2026-09-24 的
v0.12.0 切版按散文手工做了 12 步，其中两步是散文没写的 —— `release-branch-finish.sh --cut` 要求 `HEAD == base`，
从主检出（`HEAD=author`）跑不了，于是切版搬进一个**独立 clone**，台账随之落进那个 clone 的 `.quay/`（AC-320 立案
的直接量）；下一版 bump 又必然让 closure-ratchet 基线变脏。ADR-004：散文会被改写掉，规程要带执行面。

**⚠️ 2026-09-20（§12 追加裁定）：本条**没有**「版本 bump」这一步。** 切 release 分支**不再**伴随一次
「把 `-dev` 去掉」的提交——release 分支上的提交与 develop 上逐字相同（`X.Y.Z-dev`），发布产物的**无后缀**
形态是 `resolveVersion(VERSION,'build')` 在**构建时**按模式解析出来的（HEAD 在 tag `vX.Y.Z` 上，或分支名是
`release/*`）。人侧的动作只剩改 `VERSION` 一行 + 跑一次生成器（`scripts/stamp-version.ts`）。
⇒ 下文凡出现「版本 bump / 去后缀」的地方，都是**旧机制的残留措辞**，效力以 §12 为准。

**变更点（相对现状）有三个，其余保持**：
1. 命名带 `/` 与完整 semver（现状 `release-v062-build` 的 `062` 形态在 `0.10.x` 之后会排序错乱）
2. **合回后删除**（现状：两条都还在，且 `release-v063-build` 在 tag 之后又长了 15 个提交，§2.4）
3. 切点前置（§4.2）

#### 4.1.1 结束步的载体与「合规」的唯一定义（2026-09-19）

**这一节存在的理由（实测，硬规则 9 的代价）**：上表末三步在 2026-09-15 只有「删除」那一步有命令，
**合回与删除没有被同一件事带上**——于是它依赖「结束一次 release 的人恰好想起来运行该命令」。
2026-09-19T03:27–03:38Z 的真实切版（v0.10.0）证明这个前提曾经不成立：判据连红 4 次，
而把它翻绿的**是一次无任何记录的外部删除**（该分支的 reflog、提交、派发记录里都查不到
「谁删的、用什么命令删的」——详见 §10 残留 4）。

**① 合规的唯一定义（判据与命令共用同一份）**。AC-271 的 criterion 接受**两种**终结形态；
命令此前只认第一种，于是「按规程删除」对第二种形态在物理上做不到：

| 形态 | criterion 的谓词 | 命令的谓词 |
|---|---|---|
| 已合回 | 分支不存在 | `git rev-list --count <base>..<branch>` = 0 |
| tip 被某个 tag 持有 | `git tag --points-at <branch>` 非空（tip 逐字停在 tag 上） | `git tag --contains <branch>` 非空（tip 被某个 tag 持有） |

两种形态**都蕴含「删掉不丢任何提交」**，因此它们是同一条「有无删除的许可」判据的两个充分条件；
命令对**两者皆不满足**仍然 **fail-closed 拒绝**（`exit 3` + `CAUSE=release-branch-not-merged`）
——那是唯一真会丢工作的形态。命令侧认的是「被 tag 持有」这一**较宽**的读法（tip 是 tag 的祖先时，
提交由 tag 保管，删除同样无损），而 criterion 的「逐字停在 tag 上」是它的子集：**命令接受的每一种
形态，执行之后产生的状态都满足 criterion**（分支消失 ⇒ 形态①成立）。
仪器故障（tag 列举跑不起来）有独立的 `CAUSE=release-branch-tag-scan-failed`，
⛔ 绝不与「没有 tag 持有它」共用输出（硬规则 3b）。

**② 结束步的载体 = 切版动作自己**。`release-branch-finish.sh <branch> --cut --tag vX.Y.Z`
在一次调用里做完协议末三步：合回 `<base>`（`--no-ff`，要求 HEAD 已是 `<base>`）→
**在该合并点打版本 tag** → 结束（删除）。⇒ **「这次切版走完了」与「分支已消失」是同一条命令的
exit 0**，不是两件需要分别记得的事；tag 一旦打上，就正是让第①条的谓词放行的那件事。
⛔ 它不改变手工路径：手工切版仍可能留下残留，代价由 AC-271 的 criterion 按轮抓出（那是判据的职责）。
`--cut` 的每条前置（缺 `--tag`／tag 已存在／HEAD 不是 `<base>`／工作树有已跟踪改动）都
fail-closed 拒绝且**不动任何 ref**。

**③ 每一次结束都留痕（可查）**。命令把每一次判定（删除／拒绝／仪器故障）追加进本地记录
`.quay/release-branch-finish.jsonl`（分支名、时刻、合规形态、tag、base、结果、远端结果、退出码），
用 `release-branch-finish.sh --log` 读回。**记录文件不存在 ⇒ `exit 2` 且带独立
`CAUSE=release-branch-trace-missing`**（「从未发生」⛔ 不与「发生但没有记录」共用输出，硬规则 3b/9）。
⛔ 载体必须落在**本地侧**：实测 `git ls-remote --heads origin release/v0.10.0` 为空，
`release-*` / `release/*` 只存在于本地，任何远端侧载体（例如 release workflow 里加一个 job）
**在结构上够不到这些 ref**。

**④ §12 使「形态 (b)」对按规程切的版**结构上不可达 ⇒ 删除是唯一可达的合规形态**（2026-09-20 实测）**。
这条是 §12.2 的**已实测后果**，不是推断：§12.2（人 2026-09-20 逐字裁定「tag 提交不自描述」）把版本 tag
钉在**合回 develop 的合并点**上，而该合并点是分支 tip 的**子**提交。实测（v0.11.0 那次切版）：

| 量 | 读数 |
|---|---|
| `git tag --points-at release/v0.11.0` | **空**（⇒ 形态 (b) 不成立） |
| `git tag --contains release/v0.11.0` | `v0.11.0` |
| tag `v0.11.0` 的落点 | `f00a7486d` = 「Merge release/v0.11.0 into develop」，`parents=b0aa9f334 7d10a1d2d` ⇒ 分支 tip `7d10a1d2d` 是它的父 |
| `git merge-base --is-ancestor 7d10a1d2d v0.11.0` | 是（EXIT=0） |
| `git rev-list --count develop..release/v0.11.0` | `0` |

⇒ ①表格里「tip 被某个 tag 持有」那一行**仍成立**（命令侧认它），但 criterion 的形态 (b)
**恒不成立**；⇒ 凡按 §12 规程切的版，**唯一可达的合规形态是 (a) 删除**，
**收尾步就是整条长期保证的唯一承重墙**。
⇒ 而这一步此前只靠人记得：本轮切版**没有经过 `release-branch-finish.sh`**（`.quay/release-branch-finish.jsonl`
2026-09-20 一行都没有），随后那次删除**同样零痕迹**（见 §10 残留 5）。
**⑤ 承重墙的【自作用】载体 = `release-branch-janitor.ts`（2026-09-20）**。既然保证全压在「删除」上，
「谁记得谁做」就不是可接受的实现方式（硬规则 9：可见性 ⊂ 执行）。该命令每轮按 **AC-271 同一份枚举**
（`refs/heads/release-*` + `refs/heads/release/*`）分派到三种**互不共用输出**的结果：

| 分派 | 谓词 | 动作 |
|---|---|---|
| 已合规 | `tag --points-at <b>` 非空 | **不碰**（记录 `parked-compliant`） |
| 红且可无损删除 | `points-at` 空 **且**（`tag --contains <b>` 非空 **或** `rev-list --count <base>..<b>` = 0） | **经 `release-branch-finish.sh` 结束**（共用①的合规定义与③的痕迹载体；⛔ 不自己 `git branch -D`） |
| 红且无许可 | 两种许可皆不成立 | **留在原地**（那正是 criterion 必须继续抓到的「会丢工作」形态，⛔ 不得代判为绿） |

仪器故障（枚举 / tag 扫描跑不起来）有**独立**退出码与 `CAUSE=`，⛔ 绝不与「枚举为空」共用输出（硬规则 3b）。
它**每轮挂在 `worker-driver` 的 housekeeping 里**（与 `superseded_reclaim` 同一处）⇒「切版忘了删」在
**一个 tick 内**被收尾、**不需要任何人记得**；结果写本轮 round 记录的 `release_branch_janitor` 字段。
⛔ **不接进 goal gate / goal-driver 的判定路径**：判定者不得成为被判定状态的修复者，否则判据变自证（硬规则 4）。
它有自己的记录 `.quay/release-branch-janitor.jsonl`（`--log` 读回；「从未发生」/「存在但读不出」各有独立
退出码与 `CAUSE=`，且即使枚举为空也写一条 pass 摘要行 ⇒ 「跑过且无事可做」⛔ 不与「从未跑过」同形）。
**词表刻意不复用**既有 `form=`（本文件③）与 `shape=`（§4.1.2）——用 `disposition=` 与
`{parked-compliant, finished-via-carrier, finish-failed, left-alone-no-license}`（硬规则 8）。

#### 4.1.2 「取 release 形态读数」的载体：**隔离 Git 目录**（2026-09-20）

**这一节存在的理由（实测，硬规则 9 的代价）**：AC-271 禁止本地存在 tip 不在任何 tag 上的
`release-*` / `release/*` 分支，而 `scripts/resolve-version.ts` 的 `build` 模式**按分支名判定**
（`RELEASE_BRANCH_RE = /^release\//`）：无后缀的 `X.Y.Z` 只在 HEAD 恰在 tag `vX.Y.Z` 上、
**或当前分支是 `release/*`** 时产生。⇒ **每一次真实的 build 模式验证都必须在真仓库里把 HEAD
放到一条真 `release/*` 分支上**——正是 AC-271 禁止的那个状态。**两个机制各自都对，合起来直接冲突**，
而冲突的代价是：一个 `long-term: true` 的保证被**合法验证动作**击穿，且击穿者无从追查。

**实测（2026-09-20，主检出）**：在飞任务 `gap-version-stamp-generator-and-build-wiring` 的 AC 逐字要求
「在真实 `release/*` 临时分支上跑 `sync-vendor.sh` 的产物…无 `-dev`」⇒ worker 会话
`c543788e-52ea-4e2f-917a-8bc89399a001` 于 `04:51:07.365Z` 在**任务 worktree 里**执行
`git worktree add …/ac-stamp-release-reading -b release/ac4-reading HEAD`，`04:53:26.422Z` 执行
`git worktree remove --force … && git branch -D release/ac4-reading`。
**红窗宽度 2m19s**，期间 `04:52:49.353Z` 的 driver 读数给出 `verdict=fail` +
`CAUSE=release-branch-not-parked-on-a-tag — 1 of 1 release branches have a tip that is not any tag:
release/ac4-reading`。该 tip `df538caa6` 是一条**与该版本无关**的实现提交，`git tag --points-at` 为空、
`git merge-base --is-ancestor df538caa6 {develop,author,master}` **三个全 NO**
⇒ 立案对照**排除了**「某次切版忘了删分支」（那条路径的 tip 会停在版本 tag 之后、或与某次 cut 同源），
**与「为取读数临时造了一条分支」一致**。同一会话在 `05:00:52.101Z`–`05:01:16.474Z` 又造/删了一条
`release/ac4-reading2`（24s）——那一次**没有被判据观测到**（`04:59:36.472Z` 之后至今无 AC-271 台账读数），
**那是运气不是保证**。

⛔ **这两次创建与销毁在仓库里零痕迹**：`.quay/release-branch-finish.jsonl` 末条仍是
`2026-09-19T03:52:55Z`（本轮**没有**对应行——走的是裸 `git worktree add -b` / `git branch -D`，
⛔ **不是** `release-branch-finish.sh`，它以 `result=deleted-local` / `refused-no-license` 记账，
本轮记录里没有那样的行），且 `.git/logs/refs/heads/release/` 目录不存在（`git branch -D` 连 reflog
一起删）⇒ **成因只能由 worker transcript 可查，仓库产物不可查**。⛔ 不得写成「已由命令处理」，
也⛔ 不得记成任何任务的成果。这与 §10 残留 4 的 2026-09-19「无痕迹的外部删除」**是同一形态，
只是这次发生在创建侧**——同一个坑两次，两次都不是靠仓库产物发现的。

**载体（本条的执行面，⛔ 不是措辞——ADR-004）**：凡要求「在真实 release 分支上取一次 build 模式读数」
的步骤，改按

```
node --experimental-strip-types plugin/scripts/release-reading-sandbox.ts \
     --root <repo> --branch release/<name>
```

它把读数搬进**隔离的 Git 目录**：`git init` 一个 scratch 目录 → 用 `git fetch` 把目标提交取进去
（**按 sha**，所以对 `df538caa6` 这种**不被任何 tag 引用、也不在任何分支上**的提交同样成立）→
**在那里面**建 `release/...` 分支 → 把判定**原样委托**给真正的
`scripts/resolve-version.ts --mode build`（⛔ 不重写分支/tag 规则）→ **同一次运行**里打印源仓库
`refs/heads/release-*` / `refs/heads/release/*` 的读数（前 / 后）→ 追加一行痕迹 → 删除 scratch 目录。
⇒ 「共享仓库里没有悬空 release 分支」与「读数真的给出了无后缀形态」**同一次运行自证**。

**⛔ 边界（不许做的三件事）**：① **不放宽判据**——AC-271 的 criterion 一字不改；本轮它**抓对了**，
红的是保证、不是判据；② **不给 `resolve-version.ts` 加「注入分支名」的开关**——那会把 build 读数变成
恒真的回声（硬规则 4 推论三：一个只能被注入数据满足的判据不是测量）；③ 本命令**不向源仓库写任何 ref**，
它不是「创建 release 分支」的通用工具。**成对负控制**：同一条命令换一个非 `release` 名再跑一次
**必须给 `X.Y.Z-dev`** ——只贴 release 那一侧的话，一个恒定返回 `X.Y.Z` 的实现也能通过。

**痕迹与独立取值（硬规则 3b/8/9）**：每一次读数追加进本地记录
`.quay/release-reading-sandbox.jsonl`（分支名、时刻、sha、形态、版本、结果），用 `--log` 读回；
**记录文件不存在 ⇒ `exit 4` + `CAUSE=release-reading-trace-missing`**；
**存在但读不出 ⇒ `exit 5` + `CAUSE=release-reading-trace-unreadable`** ——「从未发生」/「发生但读不出」/
「发生过」三者**各自独立取值**。⛔ 记录词表**不复用** `.quay/release-branch-finish.jsonl` 的 `form=`
（那是另一个载体回答的另一个问题：`none` / `merged` / `tagged` / `cut`），本记录用
`shape=` ∈ {`release-branch`, `non-release-branch`}（硬规则 8：命名不得复用）。

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
| **ii. 预发布标记** ✅**已裁定采纳** | develop 上的版本写作 `0.7.0-dev`；`release/vX.Y.Z` 上去掉 `-dev` 后缀；tag 打在去后缀的提交上〔⚠️ **本行的「去掉后缀 / tag 打在去后缀的提交上」是 2026-09-15 的旧落实措辞，已由 §12 修订（2026-09-20）**：裁定本身（选项 ii）不变，但**没有**任何一次手工「去后缀」提交——见下方"落实口径"〕 | 需要 `version-consistency-check.ts` 的 9 条目认 `-dev` 后缀（它已是集中式清单，改动局部）【读码】 |

**⊢ 已裁定：选项 ii（`-dev` 后缀）**（人 2026-09-15，§1 ⑤ 问 2）。
理由：它让「装到的是不是一个已发布版本」从**字面量**即可判定，不需要查 tag、不需要调 gh，
与 §2.6 的 criterion 机制约束一致。

**落实口径**（⚠️ **2026-09-20 由 §12 改写**；下方是**当前生效**的机制，不是 2026-09-15 的手工流程）：

| 位置 | 形态 | 由谁决定 |
|---|---|---|
| **唯一来源** `VERSION`（仓库根，git 跟踪） | 裸 `X.Y.Z`，**无后缀** | **人**（唯一需要手工改的一行） |
| 所有**被提交**的载体（13 条目 / 10 文件，`scripts/version-carriers.ts`） | `X.Y.Z-dev`，**在每一条分支上，包括 `release/vX.Y.Z`** | `scripts/stamp-version.ts`（生成器）跑一次，读 `resolveVersion(VERSION,'tracked')` |
| **发布产物**（dist-plugin 树 / npm tgz / SEA / marketplace 缓存键） | `X.Y.Z`（**无后缀**） | `resolveVersion(VERSION,'build')` 在**构建时**按 git 状态解析：HEAD 恰在 tag `vX.Y.Z` 上，**或**当前分支是 `release/*` |
| 判定不了时（游离 HEAD 且无版本 tag） | **`evaluated:false`** — 独立取值，⛔ 不是 `-dev` | `resolve-version.ts`（硬规则 3b） |

**⇒ 三个「不再」（这是本节相对 2026-09-15 原稿的实质改动）**：
1. ⛔ **不再有** release 分支上「去掉 `-dev`」的 bump 提交——release 分支的提交载体**同样是 `X.Y.Z-dev`**；
2. ⛔ **不再有**合回 develop 之后「加回 `-dev`」的 bump 提交——人只改 `VERSION` 一行（`X.Y.(Z+1)`）+ 跑生成器；
3. ⛔ **tag 提交不自描述**（人 2026-09-20 逐字）——tag `vX.Y.Z` 打在合回 develop 的合并点上，而该点的提交内容是
   `X.Y.Z-dev`。**这个不一致是设计**：发布产物的版本是**构建的属性**，不是**提交的属性**。

**实现要点**【读码】（2026-09-20 现状；原稿点名的 `VERSION_ENTRIES` 常量与 9/10 条目的计数**已不存在**）：
- 载体表是 `scripts/version-carriers.ts` 的 `VERSION_CARRIERS`——**判官（`version-consistency-check.ts`）与生成器（`stamp-version.ts`）共用同一张表**（一张手抄两遍的清单正是本仓库 ADR-004 要禁的漂移）。
  **当前实测 13 条目 / 10 文件**（`package-lock.json` 的 4 个 workspace 成员各算一条）。⛔ 本节原稿的「9 条 / 10 条 / 第 11–14 个承载面」是**那个时点的**盘点，已被这张表取代。
- 判定是**外部单一来源判据**：每个载体必须 `== resolveVersion(VERSION,'tracked')`。旧判据（「载体之间互相相等」）**结构上看不见**一棵「全体一致但全体过时」的树。
- **`marketplace.json` 的 `plugins[].version` 已从载体表移除（2026-09-20 实测）**：Claude Code **从不读**该字段，安装缓存按拉到的插件自己的 `plugin.json` version 键控（决定性对照：marketplace 广告 `9.9.9` vs manifest `0.10.0-dev` ⇒ 仍回读 `0.10.0-dev`）。两个 `marketplace.json` 中的该字段**已删除**，故 `grep -c '"version"' .claude-plugin/marketplace.json` 在 quay 条目上为 0。读数见 §12 与 `scripts/version-carriers.ts` 的表注释。
- `X.Y.Z-dev` 是合法 semver prerelease ⇒ `package.json` / `npm pack` 接受
- 产物名在**非发布构建**下带后缀（`quay-0.7.0-dev.tgz` / `quay-sea-0.7.0-dev-linux-x64.tar.gz`），
  **正式发布产物名不变**（构建时 HEAD 在 tag 上 / 分支是 `release/*` ⇒ build 模式给无后缀形态）
- ✅ **原「需实测的未知」已于 2026-09-15 实测关闭**：Claude Code marketplace **接受** prerelease 后缀。
  读数（`gap-develop-version-union-missing-dev-suffix`，隔离的 `CLAUDE_CONFIG_DIR` 真实安装）：
  `claude plugin install quay@quay -s user --json` → `{"outcome":"ok",…}`，
  `claude plugin list --json` → `"version":"0.7.0-dev"`、`installPath=…/plugins/cache/quay/quay/0.7.0-dev`
  ⇒ 它接受的**其实是拉到的插件 manifest 的版本**（该次读数当时被读成"marketplace 字段被接受"，
  2026-09-20 的对照把它更正为"marketplace 字段根本没被读"——§12）。残留 1 已结算（§10 同步）。

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
〔⚠️ **2026-09-17 追加**：该独立动作的**取值**已被 §3.2.1′ 追加裁定反转为 `master`；
本段"不能等 master 修好"的**结构**（默认分支与 master 改造是两件事）保持有效。〕

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
| **丁** | `AC-273` | `git symbolic-ref refs/remotes/origin/HEAD` == `refs/remotes/origin/develop` | ~~**PASS**（守卫型）~~**⛔ 本行已 superseded（2026-09-17）**——**被 `AC-285` + `AC-284` 取代**：本条判据混合检查了两件正交的事（「GitHub 默认分支对不对」＋隐含地「worktree 会不会跟着分叉对」），拆为 `AC-285`（默认分支实测 = `master`）与 `AC-284`（worktree 分叉点由 `merge-base` 结构性校验）。⚠️ goal store 侧 `AC-273.status` 已实测为 `superseded`、`superseded-by: [AC-285, AC-284]`；**fidelity/负控制读数保留为历史**：它原为 PASS（本条"因为裁定 1 已于本轮执行"，见 §3.2.1 执行记录）、其负控制（期望值换成 `origin/master` ⇒ `exit 1 / CAUSE=default-branch-not-the-trunk`）证明它当时能取假。⛔ 判据文字一字未改。逐字理由见 §3.2.1′〈2026-09-17 追加裁定〉 | ~~✅~~ **superseded** |
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
| 1 | **GitHub 默认分支 `master` → `develop`** ⛔ **本行已 superseded（2026-09-17）**：方向被 §3.2.1′ 追加裁定**反转**回 `master`，由 **`AC-285`**（默认分支实测 = `master`）+ **`AC-284`**（worktree 分叉点结构性校验）接替原 **`AC-273`** | 无（纯 GitHub 设置，可逆） | ✅ **当时已完成**（2026-09-15T13:5xZ，含本地 `set-head`，执行记录见 §3.2.1）；⚠️ 该记录是**历史事实**（那一次确实切成了 `develop`），**不是当前配置**——反转后的落地见 `gap-ac285-github-default-branch-master`（`goal_ac: AC-285`） |
| 2 | release 分支规程（命名 + 合回删除） | 无 | ✅ **删除半边已完成**（`gap-release-branch-deleted-after-merge`，2026-09-15T16:4xZ）：落成 fail-closed 命令 `plugin/scripts/release-branch-finish.sh`（只认 `release-*` / `release/*` 名；`develop..<b>` ≠ 0 ⇒ 拒绝；远端删除失败或读不到 ⇒ 独立 `CAUSE=` + 非零退出）；**现存两条 `release-v06x-build` 由该命令在生产仓库删除**——`release-v062-build` tip `158616df7`（= `v0.6.2`）、`release-v063-build` tip `d097f48c7`，两条 `develop..<b>` 实测均为 **0** ⇒ 删除无损；删除后 `AC-271` 由 fail 转 **pass**。⚠️ 命名半边（§4.1 变更点 1）仍未采用——⛔ 它不在判据乙的达标条件内（判据按 tip 是否指向 tag 判定，不解析分支名）<br>✅ **2026-09-19 补齐三处**（`gap-ac271-release-branch-outlives-its-tag-again`，详见 §4.1.1）：① 命令的合回谓词与 AC-271 的 criterion **对齐为同一份合规定义**（认「tip 被某个 tag 持有」；两者皆不满足仍 fail-closed 拒绝 exit 3）；② 结束步有了载体——`--cut --tag <vX.Y.Z>` 在一次调用里做完「合回 → 在合并点打 tag → 删除」（此前这三步只有删除那一步有命令，合回与删除不被同一件事带上）；③ 每一次结束留痕 `.quay/release-branch-finish.jsonl` + `--log` 读回（此前只有 stdout，硬规则 9）。⚠️ 触发它的根因：v0.10.0 那次切版的残留让判据连红 4 次、靠一次**无痕迹的外部删除**才回绿（§10 残留 4）。⚠️ 命名半边仍未采用
| 3 | 版本号 `-dev` 后缀（§4.3 选项 ii，**已裁定**） | 无（裁定已下） | ✅ **已完成**（`gap-develop-version-union-missing-dev-suffix`，2026-09-15T15:0xZ）——并集 10 条 + `package-lock.json` 4 条 workspace 版本齐步到 `0.7.0-dev`；checker 认后缀并新增 all-or-none 断言；`AC-272` 转 **pass**；滚动渠道 `origin/dist-plugin` 已由 run `34985578795` 重发（`VERSION=0.7.0-dev`）；marketplace 实测**接受** prerelease（§10 残留 1 已关闭）<br>⚠️ **2026-09-20 修订（§12）**：本行的落实**已换代**——「10 条并集 / checker 的 `VERSION_ENTRIES` / 手工齐步」都不再是现状。现在是 `VERSION` 单一来源 + `scripts/resolve-version.ts`（`tracked`/`build` 双模式）+ `scripts/stamp-version.ts` 生成器 + 共用的载体表 `scripts/version-carriers.ts`（13 条目 / 10 文件），人只改 `VERSION` 一行；**没有**「去后缀 / 加回后缀」的 bump 提交。判定也换代了：`checker == resolveVersion(VERSION,'tracked')`（外部单一来源），取代「载体之间互相相等」 |
| 4 | master 推进 job `advance-master` + `needs:` 全集静态检查（§6.1，**已裁定 A**） | 无（裁定已下） | ✅ **实现可今天就做**；⛔ 不变式 3 的静态检查必须同批落地；**生效要等第 5 步** |
| 5 | **首次 ff**：master → 第一个全绿发布的 tag | `AC-268` | ❌ 阻塞中（至今 0 次全绿发布）；⚠️ 第 4 步落地后**这一步是自动发生的**，不需要另外的人工动作 |
| 6 | hotfix 线 | 第 5 步 + 真实触发条件出现（§5） | ❌ 且**不应催化**（发生率 1） |

⊢ **裁定之后，第 1–4 步全部解除阻塞**（第 3、4 步此前唯一的阻塞就是裁定本身）。
⊢ **唯一仍被外部阻塞的是第 5 步**，它等 `AC-268`；而它一旦发生，由 §6.1 的 job **自动完成**。

---

## 10. 开放问题：**已全部裁定**（人 2026-09-15）＋ 实现期残留

**原 5 个开放问题的裁定见 §1 ⑤ 表**（1 默认分支即刻切 develop〔⚠️ 已被 §3.2.1′ 反转为 `master`〕｜2 `-dev` 后缀｜3 方案 A｜4 等 v0.7.0 全绿｜5 挂 GOAL-020）。
⛔ 本节**不再保留**这 5 条为开放项。

**实现期残留（不是裁定问题，是必须实测才能回答的未知）**：

| # | 残留 | 为什么不能靠推断解决 | 触发点 |
|---|---|---|---|
| 1 | ~~Claude Code marketplace 的 `version` 字段是否接受 prerelease 后缀（`0.7.0-dev`）~~ | **已关闭（2026-09-15T15:0xZ，`gap-develop-version-union-missing-dev-suffix`）**：接受。真实安装读数（隔离 `CLAUDE_CONFIG_DIR`）：`claude plugin install quay@quay -s user --json` → `{"outcome":"ok","plugin":"quay@quay","scope":"user"}` exit 0；`claude plugin list --json` → `"version":"0.7.0-dev"`，`installPath=…/plugins/cache/quay/quay/0.7.0-dev`。⚠️ 顺带读数：该次安装时 marketplace 目录（默认分支 develop）仍声明 `version: 0.7.0`，而拉到的插件 manifest 为 `0.7.0-dev` —— CLI 报的是**拉到的插件**那一侧；本 SPEC 第 3 步落地 develop 后两侧一致<br>⚠️ **2026-09-20 更正（§12，`gap-version-marketplace-omit-and-spec-amendment`）**：本行的结论「该字段不仅接受 prerelease，还以它作 cache 键」**是错的**——那次读数只看到「拉到的插件 manifest 的版本」，没看到 marketplace 字段。决定性对照（marketplace 广告 `9.9.9` vs manifest `0.10.0-dev`）证明 CLI **从不读** marketplace 条目的 `version`。⇒ 该字段已从两个 `marketplace.json` 删除并从载体表移除 | — |
| 1b | ~~marketplace 条目的 `version` 字段是否可以整个省略~~（本 SPEC §4.3 只实测过「接受 `-dev` 后缀」时留下的未知） | **已关闭（2026-09-20，`gap-version-marketplace-omit-and-spec-amendment`）**：不但可以省略，而且**本来就没被读过**。四种方言 × 两组对照的真实安装（隔离 `CLAUDE_CONFIG_DIR`）读数见 §12；一个广告 `9.9.9` 的条目照样装成功并回读 manifest 的 `0.10.0-dev`。⇒ 字段已删除（两个文件），两个 carrier 条目已从 `scripts/version-carriers.ts` 移除 | — |
| 2 | `advance-master` 的 `needs:` 全集静态检查落在哪个检查器 | 需与既有 workflow 类检查器合并还是新建，取决于现有覆盖面 | §9 第 4 步实现时；⛔ 不得延后到第 4 步之后 |
| 3 | ~~判据甲–戊的立案时机~~ | **已关闭**：2026-09-15T14:0xZ 全部立案为 `AC-270`..`AC-274`（`--expect-absent`，挂 GOAL-020），见 §7 | — |
| 4 | **`release/v0.10.0` 的消失不可归因**（2026-09-19T03:38:24Z）：`git rev-parse release/v0.10.0` 于 03:2xZ 仍可解析（tip `8c7b85e79`），03:39:02Z 起已不可解析，`AC-271` 的 criterion 随之由连红 4 次转回 pass。**这次删除没有留下任何痕迹**：`.git/logs/refs/heads/release/` 目录不存在（reflog 随分支一起消失）、无对应提交（`git log --all --grep` 只有该分支的 bump 提交 `8c7b85e79` 与合并提交 `4c8116632`）、`orchestration/dispatch-record.jsonl` 无记录、当时 worker driver 为空闲（`.quay/worker-round.jsonl` 03:31:28Z `action=stop` / `pool-empty`） ⇒ **「谁删的、用什么命令删的」在本仓库不可查**（硬规则 9 的代价：可见性 ⊂ 执行）。⛔ 不得把它记成任何任务的成果，也⛔ 不得写成「已由 `release-branch-finish.sh` 删除」 | 已由 §4.1.1 的**留痕**半边直接对治（从 2026-09-19 起，每一次结束都写 `.quay/release-branch-finish.jsonl`，`--log` 可查）；本条**永久留为历史记录**，其价值是它作为「结束步没有载体」的第一个实证（同一根因的另外两处见 §4.1.1 ①②） | — |
| 5 | **`release/v0.11.0` 的残留与随后的零痕迹消失**（2026-09-20）：AC-271 于 `15:24:57.854Z` / `15:29:00.488Z` / `15:30:59.641Z` 三次 `verdict=fail` 并点名 `release/v0.11.0`（tip `7d10a1d2d`，`tag --points-at` **空**）。**这次切版没有经过 `release-branch-finish.sh`**：`.quay/release-branch-finish.jsonl` 2026-09-20 **一行都没有**（`--log` 末条仍为 `2026-09-19T03:52:55Z`，`trace: 4 record(s)`），而同一窗口 `.quay/worker-round.jsonl` 第 119–123 轮**全部** `in_flight:0` / `pool-empty`（排除 worker 归因；⛔ 本行不声称知道执行者是谁，只给可核的量）。随后约 `15:35Z` 该分支**消失**，`AC-271` 随之转 `pass`——**这次消失同样零痕迹**：`--log` **无新增行**、`.git/logs/refs/heads/release/` **不存在**（`git branch -D` 连 reflog 一起删）、`git rev-parse --verify 7d10a1d2d` 仍 EXIT=0。⇒ 与残留 4 **是同一形态的第三次**（第二次是 §4.1.2 的 `release/ac4-reading`，创建与销毁均零痕迹），且**第二次与第三次都发生在第一次的修复（§4.1.1 ① ② ③）落地之后**。⛔ 不得记成任何任务的成果，⛔ 不得写成「已由 `release-branch-finish.sh` 删除」，也⛔ 不据此声称 AC-271 已被修复 | 已由 §4.1.1 ⑤ 的 **janitor** 直接对治（收尾步不再靠人记得：红且被 tag 持有者每轮经载体结束、并留 `disposition=` 记录；红且无许可者留在原地由判据继续抓）；本条**永久留为历史记录**，其价值是它是「载体存在但可以不被经过」的第三个实证 | — |
：`git rev-parse release/v0.10.0` 于 03:2xZ 仍可解析（tip `8c7b85e79`），03:39:02Z 起已不可解析，`AC-271` 的 criterion 随之由连红 4 次转回 pass。**这次删除没有留下任何痕迹**：`.git/logs/refs/heads/release/` 目录不存在（reflog 随分支一起消失）、无对应提交（`git log --all --grep` 只有该分支的 bump 提交 `8c7b85e79` 与合并提交 `4c8116632`）、`orchestration/dispatch-record.jsonl` 无记录、当时 worker driver 为空闲（`.quay/worker-round.jsonl` 03:31:28Z `action=stop` / `pool-empty`） ⇒ **「谁删的、用什么命令删的」在本仓库不可查**（硬规则 9 的代价：可见性 ⊂ 执行）。⛔ 不得把它记成任何任务的成果，也⛔ 不得写成「已由 `release-branch-finish.sh` 删除」 | 已由 §4.1.1 的**留痕**半边直接对治（从 2026-09-19 起，每一次结束都写 `.quay/release-branch-finish.jsonl`，`--log` 可查）；本条**永久留为历史记录**，其价值是它作为「结束步没有载体」的第一个实证（同一根因的另外两处见 §4.1.1 ①②） | — |

---

**执行状态（2026-09-15T16:4xZ）**：§9 第 0/0b/1 步**已完成**（SPEC 落盘、`AC-270`..`AC-274` 立案、默认分支切换含本地 set-head）
〔⚠️ **2026-09-17 追加**：第 1 步的**方向已反转**（§3.2.1′），`AC-273` 已 `superseded` 并由 `AC-285` + `AC-284` 接替；
以下这段是 **2026-09-15 当日的历史执行状态**，⛔ 不代表当前配置〕；
**第 3 步已完成**（`gap-develop-version-union-missing-dev-suffix`：并集 10 条 + lockfile 4 条齐步 `0.7.0-dev`、checker 认后缀 + all-or-none、`AC-272` pass、`origin/dist-plugin` 重发、marketplace 实测接受 prerelease）；
**第 2 步的删除半边已完成**（`gap-release-branch-deleted-after-merge`：`plugin/scripts/release-branch-finish.sh` 落成，两条现存 `release-v06x-build` **穿过该命令**删除，`AC-271` 转 pass；命名半边未采用，且不在判据乙的达标条件内）；
第 4 步已解除阻塞、待实现；第 5 步等 `AC-268`，届时由 §6.1 的 `advance-master` job 自动完成。
⛔ 本文件自身仍不推进任何分支——master 至今未动，且按裁定 4 这正是正确输出。

**追加执行状态（2026-09-19T03:3xZ 起）**：v0.10.0 切版（`8c7b85e79` bump → `4c8116632` 合并 + tag `v0.10.0`
→ 分支 `release/v0.10.0` 未删除）使 `AC-271` 连红 4 次；该分支于 03:38Z 前后消失，
**成因不可查**（§10 残留 4）。第 2 步的「结束步载体 + 合规定义对齐 + 留痕」三处由
`gap-ac271-release-branch-outlives-its-tag-again` 补齐，落点见 §4.1.1。
⛔ 那次删除**不计入**任何任务的成果。

**追加执行状态（2026-09-20）**：`AC-271` 第二次被翻红，这一次的成因**不是**删除半边漏了，
而是**创建侧**：一条在飞任务的 AC 逐字要求取一次**真实 build 模式读数**，而 build 模式按分支名判定
⇒ 合法验证动作必须在共享仓库里造一条真 `release/*` 分支，正是判据禁止的状态。窗口
`04:51:07.365Z`–`04:53:26.422Z`（`release/ac4-reading`）与 `05:00:52.101Z`–`05:01:16.474Z`
（`release/ac4-reading2`），两次创建与销毁**在仓库产物里零痕迹**（成因由 worker transcript
`c543788e-52ea-4e2f-917a-8bc89399a001` 可查，`.quay/release-branch-finish.jsonl` 无对应行、
`.git/logs/refs/heads/release/` 不存在 ⇒ 走的不是 `release-branch-finish.sh`）。
判据本身**保持严格**（本轮它抓对了）。载体由 `gap-ac271-build-reading-creates-shared-release-ref`
补齐为**隔离 Git 目录**上的读数，落点见 §4.1.2。⛔ 这两次创建/销毁**不计入**任何任务的成果。

---

## 11. 追加裁定（2026-09-16）：`advance-master` 的 gate 从「SEA/npm 产物全绿」改为「plugin 渠道真实装得上」

**背景**：2026-09-16 当晚实测（manager 会话，跟 §6.1 的 `advance-master` 撞了两次真问题）：
① GitHub 的 `GITHUB_TOKEN` 结构性无法推 `.github/workflows/*`（见 `044f6ab20`，已修：改用
`RELEASE_PAT` 仓库 secret）；② 修完①、真 dispatch 一次（`v0.7.1`，run `35075347245`→`35076017292`）后，
`sea-release`（windows-x64）在「Verify the release archive carries the plugin sidecar (AC3)」这一步
真的红了——这是本仓库近期**没有精力去保障**的一条产物线（SEA 跨平台可执行文件 + npm tgz 发布）。

**人裁定（逐字）**：「取消 sea 和 npm release。这些是我们最近没有精力去保障的。然后按 SPEC 补上正确流程」，
经追问 `advance-master` 拿什么 gate 后再裁：「按照 claude code plugin 发布和安装。CI 应当按此设计。」

**⊢ 效力**：
1. **`release` job（npm pack + 挂 GitHub Release 资产）、`sea-release`（×3 平台矩阵）、
   `sea-verify-node-free`、`sea-verify-node-free-cross-platform`、`dist-verify-node-floor`
   （release.yml 内那份——依赖 `release` job 已发布的资产，⛔ 不是 ci.yml 里自建产物的同名版本）、
   `delivery-manifest-verify`（`--ci` 真资产模式）——这 6 个现有 job 里的 5 个（除 advance-master 自身外
   全部）**从 `advance-master` 的 gate 中移除**，因为它们存在的唯一理由就是验证即将被取消的那条产物线。
2. **`advance-master` 改为依赖一个新 job**（暂命名 `verify-plugin-channel`，实现时按静态检查器的实际
   命名对齐）：从 `${{ inputs.tag }}` 构建/复用 `dist-plugin` 分支的产物，在一个**全新、隔离的环境**里
   真实执行 marketplace 安装链路——`claude plugin marketplace add <this-tag-or-repo>` →
   `claude plugin install quay@quay --scope project` → `quay-init`（针对一个 scratch 测试项目）→
   启动 `quay driver start --kind promotion|worker` + `quay serve` → 确认三者都 alive/健康。
   **这就是今晚在 ad-arm1 archguard 项目上手工做过的那套验证的机器可执行版本**——不是凭空设计，是把
   人工验证过一遍的步骤原样自动化。
3. **`plugin/scripts/release-master-advance-needs-check.ts`**（§6.1 不变式 3 的静态检查器）的期望
   `needs:` 全集**必须**同步改成 `[verify-plugin-channel]`（或该 job 的实际命名）——⛔ 不能只改
   workflow 文件、漏改检查器，否则检查器会对着一个已经不存在的旧全集报"漂移"或者更糟——静默认为
   "没有全集要求"（同硬规则 3b 的形态）。
4. **`AC-266`（release job 30 分钟超时/`mcp-server.test.mjs` 泄漏）、`AC-267`（SEA `plugin-root.ts`
   顶层求值崩溃）、`AC-268`（release 渠道真发出一个版本——指的是 npm/SEA 那个版本）——三条判据的主体
   （SEA/npm 产物线）已被本裁定取消，判的东西不再存在，需转 `superseded`，写明"渠道被人裁定取消，
   非缺陷已修"，⛔ 不是让它们继续挂着变成永久无法达成的红。
5. **`AC-274`（master ff 到全绿 release，时间窗限定本条立案之后）本身不需要改判据文字**——它读的是
   `.quay/ci-runs.jsonl` 里 `workflow=Release ∧ conclusion=success` 那一般性逻辑，不点名具体 job；
   `release.yml` 收窄之后，"全绿"这个门槛本身变低（少了 5 个曾经会红的 job），判据不用动，
   **实现只需要保证 collector（`ci-runs-collect.ts`）继续如实记录收窄后的 job 清单**。
6. **不在本次裁定范围内**（保持 §8 原有边界不动）：`publish-plugin-dist.yml` / `dist-plugin` 分支本身
   的构建机制不变——本裁定只改**谁来 gate `advance-master`**，不改滚动渠道 B 自己的构建触发方式。

**⊢ 与 §1 授权链的关系**：本条不是推翻 §1⑤问3（"master 推进用 A 工作流内机制"）——那条裁定关于**机制**
（在 release.yml 内一个新 job，fast-forward）仍然有效，本条只是收窄该 job 的**输入依据**（gate 什么），
是同一份权威链条上的追加裁定，不是另起一份 SPEC。

### 11.5 补完：§11.4 只退役了三条**判据**，GOAL-020 自己的**退出条件②**与**范围节**未同步（同日修订）

**这是硬规则 5b 的形态：修一个实例 ≠ 修完同类。** §11.4 退役的对象是 `AC-266` / `AC-267` / `AC-268`
三条**判据**，而它们所服务的那份 **GOAL-020 自己的文本**没有跟着改——修的人只盯着被报出来的那三条 AC，
**兄弟实例（同一 GOAL 的退出条件与范围节）就在同一个 body 里，却一条未动**：

- `## 退出条件` 的第 ② 条**仍逐字**要求「SEA 产物不再因 `plugin-root.ts` 的顶层求值而在 `serve` 上崩」
  ——它判的那条产物线（SEA/npm）已被本 §11 裁定取消；
- `## 范围` 节仍写着 `AC-265..AC-269` 五条，其中 266/267/268 **三条已 `superseded`**，
  而在域的 `AC-270 / AC-271 / AC-272 / AC-273 / AC-274` **一条都没列**——判官被明确要求
  ⚠️ **2026-09-17 追加**：其中 `AC-273` 本身也已 `superseded`（被 `AC-285` + `AC-284` 取代）——
  见 §3.2.1′〈2026-09-17 追加裁定〉。本节引用它时，它是**"当时在域"**的历史陈述。
  「judge the AC set against it, not against the exit conditions alone」
  （`plugin/scripts/goal-driver.ts:938-939` `buildSufficiencyPrompt`），陈旧的范围节
  **自己就在告诉判官：声明的分解与在域集合对不上**。

⇒ 后果：充分性判官对 GOAL-020 持续给出 DETERMINATE `insufficient`
（`.quay/goal-sufficiency-cache.json` 的 key `3c73e546…`），**而退出条件②的文本本身在要求一件已不存在的事**。
⛔ 这个方向上加判据只会让目标更远：新增一条判 SEA 的 AC 等于把刚退役的 AC-267 换个编号复活，
而退出条件②仍要求它 ⇒ 判官下一轮仍判 `insufficient`，新增的那条则永远是红。

⇒ 由 `gap-goal020-exit-conditions-stale-after-sea-channel-retired`（同日）修订 GOAL-020 的 body：
退出条件②去掉已退役的 SEA 半句，「产物真能起来」改由 **`AC-274` 已经读的那个量**（Release run 全绿）承载；
范围节改为在域 7 条，并显式登记 `AC-266 / AC-267 / AC-268` 已 `superseded`。**修订后的 ② 全文**：

> ② **release 渠道能发出一个真能起来的产物**——`.quay/ci-runs.jsonl` 里存在一次
>    `workflow=Release` 且 `conclusion=success` 的 run，且 master 已 ff 到它的 tag；
>    「发出去的产物真能起来」由该 run 的**全绿**承载：`advance-master.needs` 必须覆盖
>    `.github/workflows/release.yml` 内其余每一个 job（`release-master-advance-needs-check.ts`，
>    每轮跑，见 `plugin/scripts/runner-static-gate.ts:958`），而该 gate job 本身就是 plugin 渠道的
>    真实安装验证（marketplace 装得上 → `quay-init` → `quay driver start` / `quay serve` 在隔离环境
>    alive，见本 SPEC §11.2）。

⛔ 本小节与本次修订**不新增任何判据、不改任何 AC 的 `status` / `criterion`**：`AC-266/267/268` 保持
`superseded`，`AC-274` 保持 `active`，GOAL-020 自身的 `status` 保持 `active`——改的只有 GOAL-020 的文本。

---

## 12. 追加裁定（2026-09-20）：版本落实机制 —— `VERSION` 单一来源 + build 模式解析，⛔ 没有「去后缀的 bump 提交」

**人 2026-09-20 逐字裁定**：

> 「版本号应有唯一来源，由 git 跟踪。可以在 build 过程中，监测分支并加后缀，如 -dev。」
> 「tag 提交不再自描述。」

### 12.1 改的是什么，⛔ 不改的是什么

- ⛔ **不改** §4.3 选项 ii 的 **`-dev` 语义**：develop 常态带后缀、发布产物无后缀。
- ✅ **改的是「谁写这个后缀」**。旧机制：人在 release 分支上手工去掉 `-dev`（一次提交）、合回 develop 后再加回来
  （又一次提交）——**两个必须记得的手工动作**，且 tag 提交的内容被用来"自描述"发布版本。
  新机制：`VERSION`（git 跟踪，裸 `X.Y.Z`）是**唯一来源**；后缀由 `scripts/resolve-version.ts` 按**模式**解析，
  由生成器在改 `VERSION` 时一并写齐。
- ⛔ **不改** §4.1.1 结束步的载体与合规定义：`release-branch-finish.sh` 的判据是「分支已合回」或「tip 被某个 tag
  持有」，**不读任何版本字面量**——本次修订因此**一行都没有改它**（`--cut --tag <vX.Y.Z>` 由调用者显式给 tag 名，
  正是因为它不猜版本）。已核实：`bash plugin/scripts/release-branch-finish.sh --help` exit 0，
  且其判据不含「存在一个去后缀的 bump 提交」这一前置（该前置**从来不存在**）。

### 12.2 载体表（机制，不是措辞 —— ADR-004）

| 面 | 载体 | 行为 |
|---|---|---|
| **唯一来源** | `VERSION`（仓库根，git 跟踪，裸 `X.Y.Z`） | 人只改这一行 |
| **解析** | `scripts/resolve-version.ts`（`--mode tracked` / `--mode build`） | `tracked` ⇒ **恒** `X.Y.Z-dev`（**所有分支**，含 `release/*`）；`build` ⇒ HEAD 恰在 tag `vX.Y.Z` 上 **或** 分支名匹配 `release/*` 时给 `X.Y.Z`，否则 `X.Y.Z-dev`；**判定不了**（游离 HEAD 且无版本 tag）⇒ `evaluated:false`（独立取值，硬规则 3b），⛔ 不回答 `-dev` |
| **生成** | `scripts/stamp-version.ts` + **共用的**载体表 `scripts/version-carriers.ts` | 改 `VERSION` 后跑一次，**13 条目 / 10 文件**齐步（`package-lock.json` 的 4 个 workspace 成员各算一条） |
| **判定** | `scripts/version-consistency-check.ts` | 每个载体必须 `== resolveVersion(VERSION,'tracked')`——**外部单一来源**判据，取代旧的「载体之间互相相等」（后者结构上看不见一棵"全体一致但全体过时"的树） |

**⇒ tag 提交不自描述（人的裁定）**：tag `vX.Y.Z` 打在**合回 develop 的合并点**上，而该点的提交内容是
`X.Y.Z-dev`。**发布产物的版本是构建的属性，不是提交的属性**——这个不一致是**设计**。
⇒ 合回之后人只改 `VERSION` 一行（`X.Y.(Z+1)`）+ 跑生成器；⛔ **没有**去后缀提交，也⛔ **没有**加回后缀提交。

**⇒ 人侧的动作已机械化（2026-09-24）**：上面「改 `VERSION` 一行 + 跑生成器」、以及重锚 closure-ratchet 基线
（版本 bump 会改 `plugin/.claude-plugin/plugin.json`，那是 ratchet 的 laydown 源之一，基线必然变脏），
连同 §4 的整条切版规程，由 **`bash plugin/scripts/release-cut.sh <X.Y.Z>`** 一条命令执行（用法正本 = 该命令的
`--help`）。⛔ 本 SPEC 不复述那串步骤。

### 12.3 marketplace `plugins[].version`：实测删除（同日）

**问题**（本 SPEC §4.3 只实测过"接受 `-dev` 后缀"，§10 残留 1 曾把它读成"该字段被接受并以它作 cache 键"）：
根 `.claude-plugin/marketplace.json` 的 `version` 由 Claude Code 从 git 直接读、**没有构建步骤可盖章**，
仍是一处必须手写的提交字面量。它能整个省略吗？

**实测（`gap-version-marketplace-omit-and-spec-amendment`，隔离 `CLAUDE_CONFIG_DIR` 的**真实安装**，
`claude plugin marketplace add` + `claude plugin install quay@quay -s user --json` + `claude plugin list --json`）**：

| 方言 | 条目 `version` | `install` outcome | `list --json` `version` / `installPath` 键 |
|---|---|---|---|
| 根（github source, ref `dist-plugin`） | `0.10.0-dev` | `ok` | `0.10.0` / `…/quay/quay/0.10.0` |
| 根（github source） | **省略** | `ok` | `0.10.0` / `…/quay/quay/0.10.0`（与上行**逐字相同**） |
| `plugin/`（`source: "."`） | `0.10.0-dev` | `ok` | `0.10.0-dev` / `…/quay/quay/0.10.0-dev` |
| `plugin/`（`source: "."`） | **省略** | `ok` | `0.10.0-dev` / `…/quay/quay/0.10.0-dev`（与上行同样相同） |
| `plugin/`（`source: "."`） | **`9.9.9`**（故意发散） | `ok` | `0.10.0-dev` ← **决定性对照** |

⊢ **最后一行是前四行给不出的对照**（硬规则 4 推论四）：marketplace 广告 `9.9.9`、manifest 是 `0.10.0-dev`，
安装照样成功且回读 `0.10.0-dev` ⇒ 「该字段被忽略」与「该字段恰好一致」**可区分**，而它是**被忽略**的。
⇒ 该字段携带**零信息**，却要人手工维护两个文件里的一个字面量。
**动作**：从两个 `marketplace.json` 删除该字段，并从载体表移除对应的两条 carrier；新加一条可执行断言
（`plugin/test/plugin-packaging.test.mjs`：两个 `marketplace.json` 的 quay 条目**不得**带 `version`），
因为字段一旦离开载体表，**再没有任何机件会因它回归而变红**（硬规则 9：可见性 ⊂ 执行）。
读数原样保留在 `scripts/version-carriers.ts` 的表注释里。

### 12.4 本条对旧文的效力

| 旧文 | 处置 |
|---|---|
| §0 ②、§1 ⑤ 问 2、§4.3 选项 ii 表 | **裁定原文保留为历史**（那是 2026-09-15 那天确实发生的事）+ 就地 ⚠️ 标注指向本条 |
| §4.1 生命周期流程图、§4.3「落实口径」 | **已改写**为当前机制（⛔ 不是加注：这两处是**规程**，读者照做即生效） |
| §9 第 3 行、§10 残留 1 | **已改写** + ⚠️ 标注；§10 新增残留 1b（marketplace 字段能否省略）并**当场关闭** |
| §4.3「实现要点」 | **已改写**：`VERSION_ENTRIES` 常量与 9/10 条目的计数**已不存在**，现为共用的 `VERSION_CARRIERS`（13 条目 / 10 文件） |

⛔ 本条**不新增任何判据、不改任何 AC 的 `status` / `criterion`**，也不改任何分支——它改的是 §4.1/§4.3 的
**落实机制措辞**与 `marketplace.json` 的一个字段。
