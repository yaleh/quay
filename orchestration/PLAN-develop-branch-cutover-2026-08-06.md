# 方案：切换到 develop/integration 主线 + GitHub 作为唯一跨机同步点

**日期**：2026-08-06（管理者，人给出方向）
**状态**：**人已确认执行（"按 orchestration/PLAN-develop-branch-cutover-2026-08-06.md 方案开始
执行。持续推进，直至完成。"）。执行中——见文末「执行日志」。**
**触发**：人的直接指令——

> 高优先级落地 branch 策略。develop 和 integration 两个分支都用于持续开发；master branch 应仅在
> 我要求时才从 develop 同步。然后调整跨机器同步模式：两台机器的 quay 项目都改为持续同步本地和
> GitHub 上的 develop 分支，本地的任务分支也应 push 到 GitHub；两台机器之间不再直接同步；GitHub
> 的 master branch 仅在我要求时才 push。

---

## 0. 目标终态（一句话）

```
GitHub（develop 分支）── 唯一的跨机汇合点
      ↑ push/pull              ↑ push/pull
   A 机 develop            B 机 develop
      ↑ 合入                    ↑ 合入
   task/<id>（本地做，推 GitHub 认领/备份）

master：只在人要求时，从 develop 手动同步（本地和 GitHub 都一样，冻结）
A↔B 直接同步（现在的 quay-sync.git 裸仓库）：**退役**
```

---

## 1. 已核实的事实（不是推测，全部真跑过，只读探测/dry-run，未改变任何东西）

| 项 | 结果 |
|---|---|
| A 机 → GitHub 写权限 | ✓（`git push --dry-run` 成功） |
| B 机 → GitHub 写权限 | ✓（`gh auth status` 已登录 `yaleh` 账号，`git push --dry-run` 成功——**不需要新配凭据**） |
| GitHub 现状 | **只有 `master` 分支，`develop`/`integration` 从未推送过** |
| A 本地 `master` vs GitHub `master` | **A 领先 1005 个提交**——今晚整场会话的工作从未推到过 GitHub |
| A 本地 `develop`/`integration` | 停在 5.5 小时前（23:56），落后 A 本地 `master` 127 个提交，**从未被两层循环实际使用过** |
| B 本地 `master`(自己的独立历史) | 与 A 当前 `master` 的共同祖先是 `8371d741`（我上次同步的旧点，昨天 18:47）；B 在此基础上**独立产生了 98 个提交** |
| tick 文档对 `master` 的硬编码引用 | `fast-mode-loop-tick.md` 7 处、`orchestrator-loop-tick.md` 2 处——规模可控 |
| `full-suite-runner.ts` / `suite-state-trigger.ts` | **不硬编码 `master`**，无需改 |
| `claim-task.sh` | **已经是 `--remote`/`$QUAY_CLAIM_REMOTE` 参数化的**，指向哪个 remote 由调用方定——只需把这个变量指到 GitHub，机制本身不用改代码 |

---

## 2. 最大的真实风险：A 和 B 的历史是**分叉的**，不是谁包含谁

**这不是一次简单的"把两边都传到 GitHub"就能完成的操作。**

```
                8371d741（共同祖先，昨天 18:47）
                    /              \
        A: +1005 个提交        B: +98 个提交
        （今晚整场会话）      （B 机独立开发）
```

**两边很可能改了同一批文件**——今晚已经实测过一次真实分叉（`gap-productize-the-manager-layer` 同一任务 B 机 `done`、A 机 `todo`）。把两边的 `develop` 都推到 GitHub 后，**第一次 `git pull`（合并两边历史）大概率会有真实冲突**，不是机械的 fast-forward。

**这正是今天你自己指出的那个更大问题的一个具体实例**：「两个对等的 quay 开发者需要持续双向合并，权威的『最新』未定义」（已立案 `gap-two-peer-quay-developers-continuous-bidirectional-merge`，`todo`，尚未设计）。**这份方案某种程度上就是那条任务的答案的第一步**——但合并两边 98 vs 1005 个提交这件事本身，需要谁来做、怎么做、冲突怎么裁定，是这份方案里最需要你确认的一点。

**【人已裁定，2026-08-06】**：*「本项目先推到 GitHub，然后让 B 去合并并推回 GitHub。」*

⇒ **A 的 `develop`（1005 个提交）先落地 GitHub，作为基线**；B 的 98 个独有提交**由 B 自己的两层循环负责合并**（不是 A 的 outer、不是我代劳）——B fetch GitHub 新 `develop`，尝试合并自己的 98 个提交，**冲突由 B 自己的 inner/outer 按平时处理红窗/缺陷的方式裁定**，合并完推回 GitHub `develop`。

**这个选择的意义不只是省事**：B 自己合并自己的历史，天然复用了它已经在用的判断机制（红窗分诊、AC 核对），**不需要新发明一套"跨机冲突裁定"流程**——冲突不过是 B 视角下的一次普通"本地改动 vs 上游新版本"合并，和它今晚一直在处理的红窗、缺陷本质相同。

---

## 3. 迁移步骤（草案，按顺序，每步都需要你的确认才执行）

### 阶段一：建立 GitHub 上的 develop（一次性，人工/我执行）

1. A 机：`develop` = A 机当前 `master` 的镜像（`git branch -f develop master`，或直接 `git push origin master:develop`）；
2. A 机：`integration` 同理，指向同一点起步；
3. 推送到 GitHub：`develop`、`integration` 两个分支落地。
4. **`master` 在 GitHub 上保持原地不动**（仍是 1005 个提交前的旧点，直到你明确要求同步）。

### 阶段二：B 合并自己的独有工作（**B 自己的两层循环的常规开发活动，不是我或 A 的 outer 代劳的一次性操作**）

**【人已裁定】**：这一阶段的执行者是 **B 机自己**，不是我，也不是 A 机的 outer。做法：

5. **严格排在阶段一之后**（A 的 develop 落地 GitHub 是这一步的前提，不能并行）；
6. B 机 fetch GitHub 新落地的 `develop`；
7. B 机自己的 inner/outer 把这次合并当成**一次普通的开发工作**来做——尝试 `git merge`/`rebase` B 的 98 个提交到新 `develop`，**冲突由 B 自己的循环按平时处理红窗/缺陷的方式裁定**（不新发明流程，复用现有判断机制）；需要时可以拆成多个小任务分别合并，而不是一次性合并 98 个提交；
8. B 机把合并结果推回 GitHub `develop`——**推回这一步也是 B 自己做，不是 A 拉取后代推**。

我（管理者）在这一阶段的角色：观察、记录、必要时提醒（例如提示 B 的 outer "阶段一已完成，可以开始阶段二"），**不动手合并、不裁定冲突内容**。

### 阶段三：切换两层循环的工作分支（机制改动，落地到 quay 自己的 tick 文档）

9. `fast-mode-loop-tick.md` / `orchestrator-loop-tick.md`：把硬编码的 `master`（共 9 处）改为 `develop`/`integration`；
10. inner 的 Build 阶段：从 `develop` 分叉 `task/<id>`，完成后合入 `integration`；
11. outer 的 Land/收口阶段：验证通过后，`integration → develop`（按已有 `SPEC-branching-model` 设计，fast-forward，无冲突）；
12. `claim-task.sh` 的 `$QUAY_CLAIM_REMOTE` 指向 GitHub（`origin`），**不再指向本地裸仓库**；
13. 两机各自的定期 push：`develop` 持续推/拉 GitHub；`task/<id>` 也推 GitHub（作为认领标记 + 备份，复用 `claim-task.sh` 已有机制，不新写）。

### 阶段四：退役旧机制

14. A→B 的 `~/work/quay-sync.git` 直连不再使用（不必删除，留作历史记录即可）；
15. `gap-b-machine-periodic-push-backup-to-bare-repo` 那个刚落地的 `periodic-push-backup.sh`——**它现在的目标是 quay-sync.git，需要重新指向 GitHub develop**，否则会推去一个不再被读取的地方（今晚已发现它落地但未部署，正好在部署前改方向，代价为零）；
16. `master` 分支：**冻结**，只有你明确说"同步"时，才由 outer 执行 `develop → master`。**触发形式【人已裁定】**：**纯文本，不定具体格式**——你在对话里用自然语言提一句（频率会很低），不需要固定命令、不需要正式任务/ticket。机制上仍建议做成一个显式的、需要人确认的动作（outer 收到这类文本后执行前先复述一遍要做的操作，等你确认，而不是静默执行），但**触发的门槛就是"你说了"，不额外加形式要求**。

### 阶段五：验证

17. 两机各自跑一次 `quay-init --loop --force`，确认 tick 文档的分支切换生效；
18. 观察一个完整的 `task/<id>` 生命周期（分叉→认领→合并→collect），确认新流程无回归；
19. 确认 `master` 在无人手动触发的情况下**保持冻结**（这是本方案最容易被静默违反的一条，建议做成机械检查而非纪律）。

---

## 4. 三件事——【均已裁定，2026-08-06】

1. **B 的 98 个独有提交怎么合** ⇒ **本项目（A）先推到 GitHub，然后让 B 去合并并推回 GitHub**——B 用自己的两层循环合并、自己裁定冲突、自己推回，不是 A 的 outer 代裁，也不是我代劳（见 §2、§3 阶段二）。
2. **谁执行这次切换** ⇒ 由上一条直接决定分工：**阶段一（A 推 develop/integration 到 GitHub）由 A 执行**；**阶段二（B 合并自己的 98 个提交）由 B 自己的两层循环执行**，作为它常规开发工作的一部分，不是一次性人工操作；**阶段三/四（tick 文档改分支名、`claim-task.sh` 改 remote、旧机制退役）转给各机的 outer 落地成机制**；**阶段五（验证）由两机各自的循环跑一次真实生命周期自证**。我（管理者）全程只观察、记录、传话，不代任何一方执行 git 操作。
3. **`master → develop` 何时算"你要求"** ⇒ **纯文本，频率很低，不定具体格式**（见阶段四 步骤16 的更新）。

---

## 5. 我不会做的事（除非你另有指示）

- **不会在没有你确认的情况下执行任何一步**（本文件本身就是确认前的完整方案）；
- **不会替你裁定 B 的 98 个提交里谁的版本对**（那是内容判断，不是机制判断）；
- **不会删除 `~/work/quay-sync.git` 或任何现有分支**——只退役使用，不删数据。

---

**本文件是给你确认用的完整方案，不建 AC/DoD、不排优先级、不执行任何一步。**
**三个开放问题已按你的裁定更新（§2、§3 阶段二、§4、阶段四步骤16）——请确认整体方案，确认后我按分工把阶段一交给 A、阶段二交给 B 的循环、阶段三/四/五转给两机 outer 落地。**

---

## 执行日志（2026-08-06，人确认后）

**阶段一 —— 完成（管理者，A 机，直接执行，行政性 git 操作，非产品代码）**：
- `git branch -f develop master && git branch -f integration master`（本地指向当前 `master`）；
- `git push origin develop:develop integration:integration` → GitHub 新建两分支成功；
- `git ls-remote --heads origin` 核对：`develop`=`integration`=`926d771b`（A 机当时 master 头），
  `master`=`9316b797`（旧点，**未动**，仍落后本地 master 1000+ 提交——冻结按设计生效）。

**阶段二 —— 已委派（B 机自己的两层循环执行，非管理者/A 代劳）**：
- 通过 tmux send-keys（ADR-016 三步：`C-u`→文本→`Enter`，发送前后各 `capture-pane` 核对）
  通知 `orangevps` 的 `quay-b:0`（outer 窗口，当时 idle 待输入）：阶段一已完成，指示其
  `git fetch origin`、读取 `origin/develop` 上的本方案文件、把本机独有提交合并到基于
  `origin/develop` 的新工作上（冲突按自己的常规红窗处理方式裁定）、完成后推回 `origin develop`；
  发送后确认 B outer 进入处理状态（"Choreographing…"）。**进行中，未有完成回报。**

**阶段三/四 —— 已立案为 A 机自己任务板上的两条 `todo` 任务**（转给 A 自己的两层循环落地，
管理者不直接改产品代码）：
- `tasks/gap-two-layer-loop-tick-docs-hardcode-master-not-wired-to-existing-branch-model.md`
  （tick 文档 11 处硬编码 master → develop/integration；master 写保护约束）；
- `tasks/gap-claim-task-and-backup-push-still-point-at-retired-local-bare-repo-not-github.md`
  （`claim-task.sh`/`periodic-push-backup.sh` 改指 GitHub，退役 `quay-sync.git` 目标）。
- 两条均已通过 `mcp__quay__task_list` 核对可被正常解析（无 malformed），已提交入库。

**阶段五（验证）**：尚未开始——依赖阶段三任务落地后的真实生命周期自证，见该任务 AC2。

**下一步（manager 持续观察，不代执行）**：等 B 完成阶段二回报；等 A 自己的两层循环拾取
两条新任务；周期性 tick 里核对 `orchestration/manager-phase-goal.md` AC15 三条度量的变化。
