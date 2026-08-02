# 升级项（外层攒给人的非常规决定）

外层不自行决定的三类：同一失败在消解后**再次出现**（循环不收敛）；需要改变**方向或范围**的决定；
外层自身停止条件触发。

每条写：现象 / 外层已尝试什么 / 为什么超出授权 / ≥2 个选项及建议。

---

## 3. ~~`.halt` 何时解除~~ —— **已决（2026-08-02，选项 A）**

**人的裁定**：先派发死锁修复 → 修好后重跑 readiness → **READY 即可由外层解除 `.halt`**。
合并顺序交给外层（已定 M222 → M246 → M243，理由见 `orchestration/tick-log.md`）。人声明接下来数小时不干预。

<details><summary>原始升级内容</summary>


**发现时刻**：2026-08-02 ~17:10Z（Monitor 报 `BATCH-END` 后按 tick 步骤 4 组批时）

**现象**

内层报停止条件：`.halt` 存在（06:48 放置），**循环暂停，不自行派发新任务**——它在正确地守规则。
所以补队列没有意义，除非解除暂停。

跑 `restart-readiness-check.sh`：**NOT READY**，但**唯一**失败项是「工作树不干净」，
其余全部绿，**包含全量套件**：

```
[FAIL] working tree NOT clean:  M milestones/fast-mode-telemetry/2026-08-02.json
[ok]   no MERGE_HEAD / no unmerged index / master 未被 stray worktree 占用
[ok]   task-schema / dod-fixture / vmeta-lag / loadbearing-test-gate 全绿
[ok]   full-test-suite (scripts/test.sh) 绿
NOT READY ✗
```

**那一项是外层自己造成的死锁**：该文件被 git 跟踪，而 `--report` 每次调用都改写它
（实测 md5 `f177326fc890` → `34b6854e76b1`），外层的 Monitor **每 60 秒**调一次。
⇒ 任何提交后 60 秒内工作树必然变脏 ⇒ readiness 永远通不过。
已建任务 [[gap-telemetry-report-writes-and-deadlocks-readiness]]（根因：`--report` 是读操作却在写）。

**为什么超出授权**

解除 `.halt` = 启动无人值守运行，是范围级动作，不是解阻塞。exp6-phase1 的 AC6 明确要求
「readiness READY 后才 rm `.halt`」。

**选项**

| 选项 | 含义 | 代价 |
|---|---|---|
| **A（建议）** | 先派发 `gap-telemetry-report-writes-and-deadlocks-readiness`（外层临时停掉 Monitor 以便树能干净），修好后重跑 readiness，READY 再由**你**决定解除 | 一个任务的量；解除 `.halt` 的决定仍在你手里，且届时判据是干净的 |
| B | 临时停 Monitor + 提交该文件 → 树干净 → 解除 `.halt` | 最快；但死锁没修，Monitor 一重挂就复现，且会持续产生噪声提交 |
| C | 保持 `.halt`，继续由外层逐个显式派发 | 今天一整天就是这个模式，有效但吞吐受限于外层的派发节奏 |

**建议 A**。另外内层挂起两个问题等你：M243 → M246 → M222 的合并顺序是否照队列文件执行
（我理解你已在 escalations #2 裁定过，需要你确认内层可以照做）；以及 `.halt` 保留到什么时候。

</details>

---

## 2. 四个 worktree 分支滞留着 **24,989 行已验收但从未合并**的工作 —— 合并还是丢弃？

**发现时刻**：2026-08-02 ~16:10Z 外层 tick（复核 #1 的排期结论时顺带查 `git worktree list`）

**这同时推翻了 #1 的核心结论**：A2/A5 不是「标了 done 却没做」，是**做完并通过验收后 Land 从未合并**。

**现象**

| 分支 | 任务 | 未合并 | 内容 |
|---|---|---|---|
| `milestone/M243/iteration-0` | DIR-124-A2 | **+8,351** | `workflow-replay.ts` 361 行、12 个 fixture、182 行测试、`sync-vendor.sh`、AC write-back + acceptance-audit 提交 |
| `milestone/M246/iteration-0` | DIR-124-A5 | **+9,161** | `workflow-baseline-metrics.ts` 1,422 行 ×2 侧、802 行测试 ×2 侧、build-evidence-manifest |
| `milestone/M239/iteration-0` | gap-prepare-milestone-no-size-aware-routing-A | **+6,901** | `prepare-milestone-size-estimate.ts` 437 行、513 行测试 ×2 侧、`prepare-milestone.js` 的 fast-lane 路由 |
| `milestone/M222/iteration-0` | DIR-112 | **+576** | `cli.test.mjs` 的 async execFile 改造 |

- **全部滞留于 2026-08-01**（驱动模式那天，33+ 次串行 prepare 的批次）
- **四个分支 `git merge-tree` 全部干净，无冲突**
- master 上 `milestones/M243/` 只有 `absorb-entry.md` + `preparation.json`，**没有 `audits/`、没有
  `iterations/`** —— Land 阶段确实从未跑完（CAPTURE 提交是 Land 写的）
- 另有 **20 个零领先分支** + 26 个 worktree 目录，`milestones/` 占 **1.3G**

**外层已尝试什么**

1. 用 `git merge-tree` 逐个试合并（不落地），确认四个都无冲突
2. 确认工作确实不在 master：`grep -rl 'workflow-replay|baseline-metrics'` 在 master 上零命中
3. 确认这不是 `--clean-stale` 的漏洞：按 CLAUDE.md，带提交的分支**本就应该 fail-closed 保留**，
   机制是按设计工作的

**为什么超出授权**

1. **合并 25k 行是落地代码的决定**，不是解阻塞——外层不直接改代码
2. **`milestone/M222/iteration-0` 改的正是 `packages/quay/test/cli.test.mjs`，而内层此刻在飞的
   B5-1 正在重写同一个文件**。现在合并 M222 = 制造一次真实冲突
3. 这四个分支携带的是 **2026-08-01 的前提**，其中 M239 的 fast-lane 路由与我们之后关于
   prepare 管线的决定可能已经不一致——「还要不要」是范围决定

**选项**

| 选项 | 含义 | 代价 / 风险 |
|---|---|---|
| **A（建议）** | 按分支逐个决定，**顺序：M243 → M246 → M239 → M222**。前三个与内层在飞工作无重叠，可在下一个内层空档由**内层**执行 `rebase master` + `merge --no-ff` + 跑全量套件；**M222 必须等 B5-1 落地后再谈**（同文件） | 每个合并后要跑一次全量套件（~8 分钟），共约 40 分钟；M239 的 fast-lane 路由需先确认是否仍符合当前方向 |
| B | 只合并 M243 + M246（DIR-124-A2/A5 的基线工具），M239/M222 另议 | 最小；但 M239 的 6,901 行继续悬着 |
| C | 全部丢弃，需要时重建 | 丢掉 25k 行已验收的工作。**不建议** |

**人的裁定（2026-08-02）**：**M239 推迟**——不在最核心的主线上。合并顺序定为
**M243 → M246 → M222**（在 B5-2 之后），M239 留在分支上不动（`--clean-stale` 不会碰带提交的分支，它是安全的）。

### 合并前必须知道的一件事：M222 与在飞的 B5-1 改同一个函数

`milestone/M222/iteration-0` 把 `packages/quay/test/cli.test.mjs` 的 `run()` 从 `execFileSync`
改成了**异步 `execFile`**，并新增了同样异步的 `runNative()`。而 B5-1
（`gap-tests-spawn-cli-from-ts-source`）此刻正在改的就是这个 `run()` —— 把它 spawn 的二进制从
`.ts` 换成预构建 bundle。

**两者是不同的杠杆，而且叠加**：

| | 机制 | 效果 |
|---|---|---|
| B5-1 | 换二进制（`.ts` → `dist/quay.js`） | 每次调用 3.5s → 1.4s |
| M222 | `run()` 同步 → 异步 | 67 次调用可并发，而非文件内串行 |

B5-1 的任务体估算 436s → ~295s **只算了换二进制**。叠加 M222 的异步化，上限可能远好于此——但也
可能不是，因为并发度受 `--test-concurrency` 和机器核数约束。**必须实测，不要推算。**

**因此**：

1. **任何测速任务在飞期间都不合并分支**。B5-1 已于本 tick 前落地（合并 `7032e704`），但 **B5-2
   (`gap-tests-use-cli-where-module-import-suffices`) 正在飞**，它的交付物同样是套件墙钟的改前/改后
   实测——合并任何分支都会改变套件构成，把基线毁掉。约束不变，只是对象换成 B5-2
2. B5-2 落地后再按 M243 → M246 → M222 合并，**M222 需要 rebase 到 B5-1 之上并解冲突**——解法在语义
   上是明确的：保留 M222 的异步结构，把里面的二进制换成 B5-1 的 `QUAY_CLI` 常量
3. 合并 M222 后**重测 `cli.test.mjs` 与套件墙钟**，这个叠加数字才是 AC9（≤416s）的真实进度

**另有一件不需要你决定的**：20 个零领先分支 + 1.3G 的 `milestones/` 目录属于常规清理，外层已建
任务，不占用你的判断。

---

## 1. ~~`DIR-124-A2` 标记为 done，但机制从未落地~~ —— **已决（2026-08-02，选项 A）；结论后被 #2 推翻**

**人的裁定**：先做 DIR-124 全链复核再决定排期。复核已完成 → `orchestration/dir-124-chain-audit.md`。

**结果**：真阳性有 **两个**，不是一个——`A5`（baseline metrics）与 `A2` 同一形态（done + AC 零勾选 + 代码零落地）。
两者状态已改回 `todo`；**不排期**，因为它们是 B/C/D/E 的前置而 B/C/D/E 全未开工——没有东西被错误证明过。
顺带拆掉一个陷阱：A1 一旦闭合，PARENT-DONE-IFF-CHILDREN 会让 DIR-124-A 在 A2/A5 仍假 done 时一起闭合。

<details><summary>原始升级内容</summary>


**发现时刻**：2026-08-02 ~15:15Z 外层 tick（`task-status-drift-check.ts` 的 `reverse-drift-suspect`）

**现象**

`tasks/DIR-124-A2.md` 的 `status: done`，但：

- `## Acceptance Criteria` 下 **AC 全部未勾**（`- [ ]`，无一个 `- [x]`）
- 全仓 `find -iname '*replay*'` 查不到任何 `*workflow*replay*` fixture / script / test
- 它声称的机制是 workflow 事件的**黄金重放**：八个 success/failure/composite/concurrent/cache 用例
  的 fixture、M192 两个 known-defect 形状的分类、以及 baseline invariance 的 replay diff
- `golden-replay-dir044.ts` **不是它** —— 那是 DIR-044 的产物

**外层已尝试什么**

1. 排除了检查器误报：另外查证了同批被报的 `DIR-124-B1`，确认那个是假阳性（代码确实落地，只缺
   milestone 簿记文件），并已为检查器的准确率单独建任务
   `gap-reverse-drift-check-buries-true-positives-in-noise`
2. 排除了「换名落地」：`grep -rl 'goldenReplay|golden-replay|replayWorkflow'` 的命中全部属于
   `composite-land` / `composite-preflight` / `milestone-worktree` / `golden-replay-dir044`，
   没有一个是 A2 声称的 workflow 事件重放

**为什么超出授权**

「这个机制现在还要不要」是**范围决定**，不是解阻塞。三条路的代价差一个数量级，且 A2 是
DIR-124 拆分链上的一环——单独复活它可能连带 A1/A3/A4/A5 的状态也要复核。

**选项**

| 选项 | 含义 | 代价 |
|---|---|---|
| **A（建议）** | `status: done → todo`，但**不立即排期**；连同 `DIR-124-A5`（同批未查证）一起做一次 DIR-124 全链状态复核，结果决定排期 | 复核约 1 个任务的量；避免只修一个而漏掉同类 |
| B | 判定 workflow 黄金重放在快速模式下已无必要（我们不再走 execute-milestone），**显式降范围**并把理由写进任务体，保持 done | 最便宜；但如果阶段 2 产品交付要回到 workflow 路径，等于埋一个洞 |
| C | 立刻重建该机制 | 最贵；且在 exp6 阶段 1 的 12 小时目标期内会挤掉测试提速与持续运行 |

**建议 A**：真正的问题不是 A2 一个任务，而是「有多少 done 是这样 done 的」还没有答案。先量出规模
再决定排期。

</details>

---


