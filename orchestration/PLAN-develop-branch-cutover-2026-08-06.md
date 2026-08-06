# 方案：切换到 develop/integration 主线 + GitHub 作为唯一跨机同步点

**日期**：2026-08-06（管理者，人给出方向）
**状态**：**等待人确认，未执行任何一步**。
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

**我的建议**（供你裁定，不是我擅自决定）：
- **以 A 机当前 `master`（1005 个提交，最新）为基线**，建 `develop` = A 机 `master` 的当前状态；
- B 机的 98 个独有提交，**逐个 cherry-pick 或整体 merge 到新 `develop` 上**，冲突由 outer（哪一层裁定，见下）逐个解；
- **不建议**反过来（以 B 的旧点为基线，A 的 1005 个提交去合并）——代价方向不对称，A 的量大得多。

---

## 3. 迁移步骤（草案，按顺序，每步都需要你的确认才执行）

### 阶段一：建立 GitHub 上的 develop（一次性，人工/我执行）

1. A 机：`develop` = A 机当前 `master` 的镜像（`git branch -f develop master`，或直接 `git push origin master:develop`）；
2. A 机：`integration` 同理，指向同一点起步；
3. 推送到 GitHub：`develop`、`integration` 两个分支落地。
4. **`master` 在 GitHub 上保持原地不动**（仍是 1005 个提交前的旧点，直到你明确要求同步）。

### 阶段二：合并 B 机的独有工作（一次性，需要人在场裁定冲突，或明确授权 outer 裁定）

5. B 机 fetch GitHub 的新 `develop`；
6. 在 B 机（或专门的合并工作树里）尝试 `git merge`/`rebase` B 的 98 个提交到新 `develop`；
7. **冲突处理**——这是唯一一步我认为不该我自己决定怎么处理的：是逐个 cherry-pick 人工看，还是整体合并让 outer 处理冲突并留痕？
8. 合并结果推回 GitHub `develop`。

### 阶段三：切换两层循环的工作分支（机制改动，落地到 quay 自己的 tick 文档）

9. `fast-mode-loop-tick.md` / `orchestrator-loop-tick.md`：把硬编码的 `master`（共 9 处）改为 `develop`/`integration`；
10. inner 的 Build 阶段：从 `develop` 分叉 `task/<id>`，完成后合入 `integration`；
11. outer 的 Land/收口阶段：验证通过后，`integration → develop`（按已有 `SPEC-branching-model` 设计，fast-forward，无冲突）；
12. `claim-task.sh` 的 `$QUAY_CLAIM_REMOTE` 指向 GitHub（`origin`），**不再指向本地裸仓库**；
13. 两机各自的定期 push：`develop` 持续推/拉 GitHub；`task/<id>` 也推 GitHub（作为认领标记 + 备份，复用 `claim-task.sh` 已有机制，不新写）。

### 阶段四：退役旧机制

14. A→B 的 `~/work/quay-sync.git` 直连不再使用（不必删除，留作历史记录即可）；
15. `gap-b-machine-periodic-push-backup-to-bare-repo` 那个刚落地的 `periodic-push-backup.sh`——**它现在的目标是 quay-sync.git，需要重新指向 GitHub develop**，否则会推去一个不再被读取的地方（今晚已发现它落地但未部署，正好在部署前改方向，代价为零）；
16. `master` 分支：**冻结**，只有你明确说"同步"时，才由 outer 执行 `develop → master`（建议做成一个显式的、需要人确认的动作，不进日常 tick 流程）。

### 阶段五：验证

17. 两机各自跑一次 `quay-init --loop --force`，确认 tick 文档的分支切换生效；
18. 观察一个完整的 `task/<id>` 生命周期（分叉→认领→合并→collect），确认新流程无回归；
19. 确认 `master` 在无人手动触发的情况下**保持冻结**（这是本方案最容易被静默违反的一条，建议做成机械检查而非纪律）。

---

## 4. 需要你明确裁定的三件事（不是我能替你定的）

1. **B 的 98 个独有提交怎么合**——冲突交给 outer 独立裁定,还是需要你审阅?
2. **谁执行这次切换**——我(管理者)按这份方案手动执行阶段一/二的一次性操作，阶段三/四/五转给 outer 落地成机制？还是全部转给 outer？
3. **`master → develop` 何时算"你要求"**——需要一个明确的触发形式（比如你说"同步 master"这句话本身，还是需要一条正式指令/任务）？

---

## 5. 我不会做的事（除非你另有指示）

- **不会在没有你确认的情况下执行任何一步**（本文件本身就是确认前的完整方案）；
- **不会替你裁定 B 的 98 个提交里谁的版本对**（那是内容判断，不是机制判断）；
- **不会删除 `~/work/quay-sync.git` 或任何现有分支**——只退役使用，不删数据。

---

**本文件是给你确认用的完整方案，不建 AC/DoD、不排优先级、不执行任何一步。**
