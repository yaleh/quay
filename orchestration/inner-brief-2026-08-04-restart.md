# 内层重启简报（外层写，2026-08-04 02:5xZ）

**你是内层**（tmux `quay-0:inner`）。约 40 分钟前整机 OOM，所有 Claude Code 与 tmux 进程都死了。
你是刚重启的会话，**没有上下文，也没有记忆**——本文件是你的起点，以及内层 tick 文档
（目录 `docs/analysis/`，文件名 `fast-mode-loop-tick.md`）。

> **为什么这里要把路径拆开写**：`loop-shipping.test.mjs` 的 AC1b 禁止对 6 条旧路径的**活引用**，
> 而这两个字符串同时是**目标项目的落地位置**——**「解释一个路径」与「引用一个路径」在文本上同形**。
> 外层 2026-08-04 03:2xZ 因为在本文件里写了完整旧路径，**把全量套件搞红了一次**（第三次同类）。

**先读完本文件再动手。不要凭记忆重建状态，你没有可凭的记忆。**

---

## 0. 没有数据损失（已由管理者与外层各自核实）

三仓工作树干净、git 完整、无中途 merge、重活令牌无人持有、无遗留锁。
两条在飞工作在 tmpfs worktree 里未提交，**已由管理者抢救并提交到各自任务分支**。

**关键：那两条提交的作者是管理者，不是它们的执行者。**
**按「未完成的中途状态」审查它们，不要当作到了检查点。** 外层已逐条跑过判据，结果在下面。

---

## 1. 环境变了三处，不看会踩空

| 变化 | 后果 |
|---|---|
| **`/tmp` 是 tmpfs，每 MB 都是内存**——OOM 直接因它而起 | **worktree 一律不许建在 `/tmp`**。见 §4 |
| **tmux 会话名变了**：`archguard-2`→`archguard-1`、`meta-cc-4`→`meta-cc-2`（`quay-0` 未变，但窗口重建为 `manager` / `inner` / `outer` 三个） | 那两个项目 `session-liveness.env` 里写死的会话名现在全是错的 |
| **archguard / meta-cc 的会话没有恢复，人同意暂缓** | **你独占这台机器。不要假设它们在跑，也不要等它们。** 但也**不要**去动那两个仓 |

**会话名这件事本身就是第 3 条缺陷的现场证据**：正确的修法不是手工把配置改成新值——
那只是把同一个错误再犯一次，下次重启还会变。**应当让配置自己算出来**，那正是 §3 那条分支在做的事。

---

## 2. 关键路径：`packages/quay/test/install-config-driven-e2e.test.mjs`

这个 e2e **把重装门槛编码成了测试**，它变绿就是门槛过了。

**外层 02:3xZ 在 master 上实测：`tests 5 / pass 4 / fail 1`——只剩 1 条红：A4。**

```
✖ A4 — a ## Finding task WITHOUT ## Plan passes the author→ready gate; a ## Plan task still goes through the strict contract
  A4: shape=finding ok=false artifacts={"proposal":true,"plan":false,"ac":true,"dod":true} reason="missing artifacts: plan"
```

**A4 由 §3 的第一条分支变绿。外层已实测确认（见下）。**

**已知缺口，不在本轮范围**：该 e2e 覆盖 byte-identical / idempot / upgrade / finding / npm test，
**缺 go build**；而「`vendor/` 撞 Go 保留目录」那条**只有 Go 目标能暴露**。这条记着，别当作已覆盖。

---

## 3. 两条抢救分支：外层已跑过判据，结论不同

**两条 worktree 已由外层从 `/tmp` 搬到磁盘**（`git worktree remove` + 在磁盘上 `git worktree add`；
搬前逐条验过 0 处未提交改动、分支 ref 在共享 `.git` 里，**三条分支 tip 搬后逐字未变**）。

### 3a. `task/gap-the-finding-shape-still-requires-a-plan-section` — 判据全绿，缺的是全量套件与落地

- **worktree：`/home/yale/work/quay-worktrees/finding`**（提交 `bf9ea942`，master +1）
- 改了 `packages/quay-native/src/store.ts`（`finding` 形状的必需段集合**去掉 `plan`**，
  并把 artifact map 改成按各形状自己注册的段构建）+ `packages/quay-native/test/gate-shape-dispatch.test.mjs` 加 2 个测试
- **外层在该分支上实测**：`install-config-driven-e2e` + `gate-shape-dispatch` 合计
  **`tests 16 / pass 16 / fail 0`——A4 绿了**，且反向负控制（Plan 形状缺 `## Plan` 仍红）在场

**该做什么**：跑一次全量套件 → 勾 AC/DoD → 合入 master。
**不要重写它**——判据已经在场，重写只会把已验证的东西换成未验证的。

### 3b. `task/gap-init-guesses-the-tmux-session-and-writes-the-guess-into-the-monitor` — 真的是中途状态，3 条红

- **worktree：`/home/yale/work/quay-worktrees/tmux`**（提交 `dc365250`，master +1）
- 改了 `plugin/scripts/quay-init.sh`（新增 `detect_tmux_session()`，唯一命中即用 / 多命中要求显式
  `--tmux-session` / 零命中 fail-closed）、`plugin/scripts/session-liveness.sh`（删掉 `<basename>-0` 猜测回退，
  改 fail-closed）、新测试 `plugin/test/quay-init-tmux-detection.test.mjs`（250 行）
- **外层实测：`tests 41 / pass 38 / fail 3`**

**外层已把 3 条红定位到根因，你不需要重新诊断：**

| 红 | 现象 | 外层的定位 |
|---|---|---|
| AC2「零命中 fail-closed」 | 期望 exit 2，实得 **exit 1** | **`quay-init.sh:46` 是 `set -euo pipefail`**，而 561 行 `DETECT_OUT="$(detect_tmux_session ...)"` 在函数返回非 0 时**当场终止脚本**，562 行的 `DETECT_RC=$?` 根本没机会执行。零命中 rc=1 ⇒ 脚本以 1 退出 |
| AC3「多命中要求显式」 | 退出码对了，但 stderr **空** | **同一个根因**：rc=2 被 `set -e` 直接当成脚本退出码，`elif [ "$DETECT_RC" = 2 ]` 那段提示**从未执行** |
| session-liveness 零配置默认目标 | 期望 `SESSION-STATUS confproj alive=1`，实得 `SESSION-STATUS <临时目录名> alive=1` | **外层判断是测试的期望写错了，不是脚本错**。脚本打印的第一个字段是**目标名 = 项目根 basename**，不是会话名（外层在本仓实跑 `--once` 得 `SESSION-STATUS quay alive=1`，会话名 `quay-0` 在 target 字段里）。**这是判断题，你来定**：要么测试改断 target 字段（`confproj:outer`），要么脚本改成按会话命名——**若选后者，先查还有谁消费这个字段**，别为了一条测试改掉一个被别处依赖的输出格式 |

前两条是同一个机械修法（`DETECT_RC=0; DETECT_OUT="$(...)" || DETECT_RC=$?`）。
**修完请把负控制补上**：让这两条测试在「去掉 `|| DETECT_RC=$?`」时确实变红——
本仓反复付过学费的那条是「一个从没红过的检查与永远返回空集不可区分」。

**还有一条外层查出的连带项，落地前必须一起处理**：
本仓 `orchestration/session-liveness.env` 原本**没有** `SESSION_TMUX_SESSION`，
靠的正是这条分支要删掉的 `<basename>-0` 回退恰好得到 `quay-0`。
**外层已先行写入实值**（`SESSION_TMUX_SESSION=quay-0`），所以本仓不会踩空；
但**你要检查 `quay-init --loop` 是否真的把检测到的会话写进目标项目的这个文件**——
否则别的项目装上后，监视器一起步就 fail-closed。

---

## 4. 内存纪律（这次 OOM 直接因它而起）——一条要改的机制

**`/tmp` 是 tmpfs。worktree 不许建在 `/tmp`。用磁盘路径**，例如 `/home/yale/work/quay-worktrees/<slug>`。

**但纪律写在这里没用，因为机制里写的是另一回事**：
`docs/analysis/fast-mode-batch2-prompt.md` 第 33/36/60 行**明确指示 subagent**
`git worktree add /tmp/quay-wt-<slug>`。**你派出去的每一个 subagent 都会照做。**

⇒ **请把那份 prompt 里的 worktree 路径约定改到磁盘**，并同步检查
`docs/analysis/test-isolation-contract.md:107`——它把 `/tmp/quay-wt-*` 列为「永不匹配」前缀
（保护在用 worktree 不被清理），路径一改，那条保护就落空了，**两处必须一起改，否则清理器会开始删在用的 worktree**。

外层会另建一条任务承载这件事；**若你先做到了，就在任务里注明已合并处理，不要做两遍。**

---

## 5. 本轮建议次序（外层的判断，你可以反对，但请说理由）

1. **3a 落地**（全量套件 → 勾 AC/DoD → 合入）。它让门槛 e2e 的最后一条红变绿，是关键路径上唯一的一步。
2. **3b 修 3 条红**（前两条机械，第三条是判断题）。
3. **§4 的 worktree 路径约定**（两文件一起改）。

**3a 与 3b 的 `## Touches` 不相交**（`packages/quay-native/*` vs `plugin/*`），可并发；
但**这台机器上现在只有你**，全量套件请串行跑，跑前照 `plugin/scripts/resource-gate.sh --for full-suite` 的结论办。

---

## 6. 几条不要做的事

- **不要 `git push` / `git tag` / `gh release`**——推送授权仍未给出，且不要找绕过办法。
- **不要动 archguard / meta-cc 两个仓**（它们停着，是人的决定）。
- **不要用 `git worktree remove` 处理任何有未合入提交的分支**——本班已经因为一次措辞不够硬的清理
  指令丢过一次 worktree（工作只剩孤立分支）。清理前先验：`status --porcelain` 为空 **且**
  `merge-base --is-ancestor <tip> master` 成立。
- **不要相信任何自述（包括本文件）里的数字**——本文件里每个数字外层都跑过命令，
  但你落地前应当自己再跑一次；两次不一致时以你这次的实测为准，并告诉外层。
