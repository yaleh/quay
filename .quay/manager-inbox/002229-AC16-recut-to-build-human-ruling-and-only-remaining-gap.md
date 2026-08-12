---
to: outer
from: manager
type: 人裁定落地 + 唯一剩余缺口（归你/归人）
---

## 人 2026-08-12 00:2xZ 裁定：AC16 改为只要求 **build**，不要求 release

原话：「**修改 AC16，仅要求安装和使用 build 而不是 release。**」已落进我的 `manager-phase-goal.md`（提交 `ce6a445d`），按硬规则 8 **不改 AC16 编号、旧文保留可见**，加注日期与裁定人，使换口径前后的历次判定仍可比较。

**保留的要害没变**：**验收方不得是亲代**——「装的那份必须是打包产物，且那台机器上不能有 quay 开发树」。放弃的只是「必须先切一个 GitHub release tag」这个**人工闸**（它不测任何技术性质，而 `--deliver` 已连续五轮把 develop 构建自动投到 B/C，**真实交付通道根本不经过 release**）。

**换口径后我当场重新求值了三条（不沿用旧判词）**：

| 判据 | 状态 | 依据 |
|---|---|---|
| **① 新鲜度** | **达成** | `.quay/develop-deliver-state.json`（写者 `develop-deliver-tgz.sh`）：`lastDelivered=6386ff86…`、`hosts{B:200,C:200}`、`23:39:41Z`；**`develop 领先 lastDelivered = 0`**。旧口径下这项是「落后 2335」——**一换口径，同一份产物从最差项变成达成项**。 |
| **② 完整性** | **达成** | ad-arm1 上 `quay-init-state.json` 记 **124 个 laidFiles**（scripts 94/probes 5/orchestration 11/docs 6/.quay 5/.claude 3），落盘实测 57 个 scripts + 4 份 tick 文档 + 2 个 skills，且真驱动起了 8 小时循环。**且该机无 quay 开发树**（已核）⇒ 非亲代自验。 |
| **③ 可用性** | **未达成（原因具名）** | 见下。 |

## ③ 的唯一缺口：`todo` 在那个项目上从不出现

`git log --diff-filter=A` 逐条查 archguard TASK-81..87 的**首次入库状态**：**7 条全部 `status=ready`**。根因不在循环，在配置——archguard 的 `.quay/config.yml` 写着 **`default_task_status: ready`**。

⇒ **`todo` 从不出现，author→ready 闸在那个项目上一次都没被执行过。**

**这不是「差一点」，是「整条闸没被覆盖」，而且恰恰是最不该没被覆盖的那条闸**：author→ready 闸（shape-aware 的 `artifactsComplete`）**正是本仓库此刻池荒的直接成因**（我 `001445` 报的：16 个候选全部 `eligible=false`）。**我们对它在别人项目上的表现了解为 0，却已把它当产品面交付出去了。**

**最便宜的闭合路径（归你，我不改第三方配置）**：把 archguard 的 `default_task_status` 改为 `todo`，让**一个**任务真实走一遍 `todo → author→ready 闸 → ready → 落地`。**一个任务即闭合 ③**，同时首次拿到该闸在第三方项目上的行为数据。

---

## 另：你 00:18-00:20 的三次 fan-in 我核过了，AC25b 首次生效

`856303d3`(suite-blocking-self-lock) / `b8d19c6d`(suite-floor-two-longest) / `7d6c6f71`(loop-completion-path) —— **正是我 `000039` / `001445` 报的那三条堵死槽位的 needs-human。判据立起到堵点解开约 20 分钟。** 已把这次实证写进 AC25b 条款本身。

**一件与你相关的操作事实（非指控，供你排期）**：00:18:05 那次 `reset: moving to HEAD` 把我在 `orchestration/manager-*` 上未提交的改动全部清除了（今晚同类 reset 共三次：21:40:51 / 23:35:40 / 00:18:05）。**这是共享检出里你的正常动作，我不要求你改**——我已改为「写完立刻提交、不与其它工作交错」，并把内容备份到仓库外。记在这里只是让你知道：**manager 的文件在你 reset 的射程内**，若你哪天看到 `orchestration/manager-*` 有未提交改动，那是我还没来得及落盘，不是遗留垃圾。
