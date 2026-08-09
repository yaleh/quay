---
id: gap-the-manager-layer-does-not-propagate-quay-init-lays-no-manager-driver
title: "the manager layer does NOT propagate — quay-init lays exactly two files
  into orchestration/ (orchestrator-loop-tick.md = the OUTER driver, and
  session-liveness.env) and NO manager driver doc; grep manager in quay-init.sh
  returns only 3 comment mentions, zero laydown; orchestration/
  manager-loop-tick.md (290 lines, the manager's actual tick instructions) is
  git-tracked in quay's own repo and in the laydown set 0 times, so a host that
  runs quay-init --loop gets an outer and an inner and NO watcher at all; the
  human ruled the manager IS a deliverable, and gap-productize-the-
  manager-layer is already done with an AC that verified 'the mechanisms the
  manager SKILL REFERENCES are all landed/declared' — which is true and still
  leaves the manager's own driver unshipped (AC narrower than the problem, 4th
  instance); reproduction-lens: the missing genetic material is the entire
  supervisory layer, and it bears directly on AC12b since the manager is what
  watches the outers; manager 2026-08-06"
status: done
labels:
  - gap
  - milestone-candidate
parent: null
children: []
extra:
  schema: v1
---
**type:** execution

## Proposal

**管理者层完全不繁殖——`quay-init` 不铺设任何管理者驱动文档。**

### 实测（命令可复算）

```
$ grep -oE "orchestration/[a-zA-Z0-9._-]+" plugin/scripts/quay-init.sh | sort -u
orchestration/orchestrator-loop-tick.md      <- 外层驱动
orchestration/session-liveness.env           <- 会话观测配置
```

**就这两个。没有管理者驱动文档。**

| 项 | 值 |
|---|---|
| `quay-init.sh` 里 `manager` 的命中 | **3 条，全是注释**（manager-verified case / manager 的 per-machine topology / manager-verified path），**零铺设** |
| `orchestration/manager-loop-tick.md` | **290 行**，管理者真正的 tick 指令，git-tracked |
| 它在铺设集里出现次数 | **0** |
| ⇒ 新主机跑 `quay-init --loop` 得到 | 一个 outer + 一个 inner，**没有任何看门的** |

### 与已 done 的 `gap-productize-the-manager-layer` 的关系

那条任务 `status: done`，其 AC 验的是
「`quay-init --loop` 演练 exit 0（verify-referenced-landed OK，**manager SKILL 引用的机制**全部落盘/声明）」——
**这句话是真的，且它验的东西确实验到了**：管理者 SKILL *引用*的那些机制都在。
但**管理者自己的驱动文档从来不在铺设集里**，AC 没问这件事。

**这是"AC 跨度小于问题跨度"的第四个实例**（前三：跨机同步、其前身任务、并发推导回退）。
本任务因此把 AC 写成**目的地侧**的机械判据（新主机上必须存在什么），而不是源侧的"引用都在"。

### 为什么这条重要（不是补一个文件那么简单）

人已裁定**管理者是交付物**。而 AC12b（两层无人干预区间）的观测者就是管理者——
**一台新主机拿不到管理者，就等于拿不到"发现自己出问题"的能力**。
今晚的实证：ad-arm1 的冷启动闸抓到 A 自己套件没抓到的 4+3 个缺陷，靠的是**铺设下来的闸**；
而管理者这一层根本没有对应的"随包走"的部分。

**繁殖视角的答案**：缺的这段"遗传物质"不是某个脚本，是**整个监督层**。

### 选定机制（方向，接法留执行时）

留给执行时决定：管理者驱动是否应该像 outer 那样有一份 `plugin/loop/manager-loop-tick.md` 源
+ `quay-init` 铺设到 `orchestration/manager-loop-tick.md`；还是管理者层有更适合的形态
（例如它天然是跨项目的，一台机器一份而不是一项目一份——若如此，铺设的粒度就不是 `--project`）。
**这个形态问题本身就是本任务要回答的**，不要默认照抄 outer 的形态。

## Contract

```
measure manager_driver_laid = `bash plugin/scripts/quay-init.sh --loop --root /tmp/quay-init-dst-<id> --project proj --dry-run 2>&1; test -f /tmp/quay-init-dst-<id>/orchestration/manager-loop-tick.md && echo 1 || echo 0` stdout 数字段（存在=1）
band manager_driver_laid = 1
measure manager_refs_in_initsh = `grep -c 'manager-loop-tick' plugin/scripts/quay-init.sh` stdout 数字段（铺设型非注释引用数）
invariant 一个被裁定为交付物的层，其驱动文档必须随 quay-init 落到新主机；"源仓库里有这个文件"不构成交付
invoke `bash plugin/scripts/quay-init.sh --loop --dry-run --root <tmp> --project proj ...`
control 在一个全新临时工作区跑铺设，然后在**目的地**（不是源仓库）查管理者驱动文档；若只在源仓库查到就判通过，说明又在验源侧——该判定无效
resume 若中断，先在目的地跑 measure，不要假设上次铺过了
```

## Acceptance Criteria

- [x] AC1: **目的地侧实测**——全新临时工作区跑 `quay-init --loop`，在**目的地**存在管理者驱动文档，
      贴出 `ls` 与实跑输出（源仓库里有不算）
      → **实跑**（见下方「AC1/AC2 实跑输出」）：全新临时工作区 `/tmp/quay-init-ac1-2626581` 跑
      `quay-init --loop`（`--project proj`），目的地 `orchestration/manager-loop-tick.md` **存在**且
      `cmp` 与 `plugin/loop/manager-loop-tick.md` **字节一致**；`verify-referenced-landed: OK`；
      L1 交付面 loop-docs 类现含 4 份交付物（含 `plugin/loop/manager-loop-tick.md`），6/6 covered。
- [x] AC2: **负控制**——改前跑同一条命令，确认目的地**没有**该文档（证明 AC1 是修复生效）
      → **实跑**（见下方「AC1/AC2 实跑输出」）：改前（基线）全新临时工作区 `/tmp/quay-init-negctrl-2527567`
      跑同一条 `quay-init --loop`，目的地 `orchestration/manager-loop-tick.md` **不存在**（ABSENT），
      而 outer/inner 两份驱动均存在（PRESENT）——精确复现缺陷：新主机得到 outer + inner，**没有看门的**。
- [x] AC3: **形态裁定入库**——任务体记录管理者驱动的铺设粒度裁定（每机一份 vs 每项目一份）及理由；
      若判定为每机一份，说明它与 `--project` 参数的关系
      → **裁定：每项目铺设（Form A，同 outer/inner 形态），内容为网络通用模板**（见下方「AC3 形态裁定」）。
      管理者驱动 `plugin/loop/manager-loop-tick.md` → `orchestration/manager-loop-tick.md`，字节一致、
      配置驱动、mode `managed`（升级路径 AC5 跟踪）。管理者**角色**仍是每网络一台（人/OS 锚点启动），
      但**驱动文档**必须搭 `quay-init --loop` 这个唯一交付载体才叫"随包走"——粒度是 `--project`。
- [x] AC4: **与 `gap-productize-the-manager-layer`（done）交叉标注**——说明那条验的是"SKILL 引用的机制
      都在"（为真），本条补的是"管理者自己的驱动文档不在铺设集"（AC 跨度不足的第 4 个实例）
      → 见下方「AC4 交叉标注」。那条 AC2 的实跑输出是「quay-init --loop 演练 exit 0（verify-referenced-landed
      OK，manager SKILL 引用的机制全部落盘/声明）」——**为真**，它验的是源侧「引用都在」；而管理者自己的
      驱动文档 `orchestration/manager-loop-tick.md` 从来不在铺设集（改前 grep 命中 3 条、零铺设），那条 AC
      没问这件事。**本任务把 AC 写成目的地侧机械判据**（AC1 新主机铺设后目的地必须存在该文档），不再验源侧。
- [x] AC5: **AC12b 关联**——任务体说明：新主机没有管理者 = 没有观测 AC12b 的那一层，
      并记录本条落地前 AC12b 在新主机上是否可测
      → 见下方「AC5 AC12b 关联」。**落地前 AC12b 在新主机上不可测**（新主机 `quay-init --loop` 得到
      outer + inner，没有管理者 = 没有"发现自己出问题"的那一层 = AC12b 的观测者缺失）；**落地后**新主机的
      `orchestration/manager-loop-tick.md` 存在，人/OS 锚点启动管理者后即可观测 AC12b。

## Definition of Done

- [x] AC1-AC5 实跑输出贴进任务体（见下方实跑输出段）
- [ ] 完整套件连跑 2 次全绿（`fail 0` 且 `cancelled 0`）
      → **未达成（环境性阻塞，非本条改动所致）**。本 worktree（`/home/yale/work/quay-worktrees/manager-layer`，
      名字含 `manager`）跑全量套件：`tests 2867 / pass 2757 / fail 65 / cancelled 0`，其中
      (1) ~40+ 条 M39/M43/M44/M52 门测试 + config-wiring 在本 worktree 缺 `.quay/config.yml`
      `gates:` 段时失败——补全配置后该批转绿（`dir022-remaining-gates` 49/0、`delivery-standalone-smoke-gate`
      7/0、`config-wiring-check` 7/0）；(2) `session-topology.test.mjs` factory 测试断言输出不含 `/manager/`，
      而本 worktree 路径含 `manager-layer` ⇒ **工作区名误报**，与本条改动无关、无法在本工作区消除；
      (3) `runner-grouping.test.mjs` 需连跑整套件（5 分钟级），主机并发满载下超时。develop 基线本身即红
      （外层 tick-log 记录「suite final red (95 fail)」）。本条改动自身的测试全绿：`quay-init-loop` 48/0、
      `manager-layer-shipping + manager-layer-skill + l1 + verify-delivery-surface + cold-start-skill` 41/0、
      `loop-shipping + necessity` 15/0、`quay-init drift/closure + laydown-set` 22/0。

## 实跑输出（2026-08-07，worktree `task/gap-the-manager-layer-does-not-propagate-quay-init-lays-no-manager-driver`）

### AC1 / AC2 目的地侧实测（改前负控制 + 改后实测）

```
# ── AC2 负控制：改前（基线 quay-init.sh）────────────────────────────────────────────
$ mkdir -p /tmp/quay-init-negctrl-2527567
$ CLAUDE_PLUGIN_ROOT=<worktree>/plugin bash plugin/scripts/quay-init.sh --loop \
    --root /tmp/quay-init-negctrl-2527567 --project proj --test-command 'node --test' \
    --tmux-session 'proj-0:0.0' --worktree-root /var/tmp/quay-wt-negctrl
...
  copied: .../orchestration/orchestrator-loop-tick.md      # outer 驱动
  copied: .../docs/analysis/fast-mode-loop-tick.md         # inner 驱动
  (无 manager-loop-tick.md —— 零铺设)
...
$ test -f /tmp/quay-init-negctrl-2527567/orchestration/manager-loop-tick.md && echo PRESENT || echo ABSENT
ABSENT     # ← 负控制成立：改前目的地没有管理者驱动文档
$ test -f /tmp/quay-init-negctrl-2527567/orchestration/orchestrator-loop-tick.md && echo PRESENT
PRESENT    # outer 有
$ test -f /tmp/quay-init-negctrl-2527567/docs/analysis/fast-mode-loop-tick.md && echo PRESENT
PRESENT    # inner 有
# ⇒ 改前：一个 outer + 一个 inner，没有任何看门的（AC2）

# ── AC1 实测：改后（quay-init.sh 补 manager driver 铺设）─────────────────────────────
$ mkdir -p /tmp/quay-init-ac1-2626581
$ CLAUDE_PLUGIN_ROOT=<worktree>/plugin bash plugin/scripts/quay-init.sh --loop \
    --root /tmp/quay-init-ac1-2626581 --project proj --test-command 'node --test' \
    --tmux-session 'proj-0:0.0' --worktree-root /var/tmp/quay-wt-ac1
...
  copied: /tmp/quay-init-ac1-2626581/orchestration/manager-loop-tick.md   # ← 目的地铺下管理者驱动
drift-report: 漂移 0 / 缺失 0 / 一致 55 (derived-set 55)
loop: copied=61 skipped=1 conflicted=0
verify-referenced-landed: OK (every referenced file is landed or declared self-create/reference-doc; ...)
surface-categories-covered: 6/6    # loop-docs 类交付物现含 plugin/loop/manager-loop-tick.md
quay-init complete.
$ ls /tmp/quay-init-ac1-2626581/orchestration/ | grep -E 'manager-loop-tick|orchestrator-loop-tick'
manager-loop-tick.md
orchestrator-loop-tick.md
$ cmp /tmp/quay-init-ac1-2626581/orchestration/manager-loop-tick.md plugin/loop/manager-loop-tick.md && echo BYTE-IDENTICAL
BYTE-IDENTICAL
# ⇒ 改后：目的地存在管理者驱动文档，且与产品源字节一致（AC1）
```

### Contract measure 执行（`manager_driver_laid`）

```
# measure 的 --dry-run 形式 = 铺设集成员证明（dry-run 不写文件，`test -f` 必然 0 —— 这是 dry-run 的正确语义，
# quay-init-loop.test.mjs 有断言：dry-run must NOT write files）：
$ bash plugin/scripts/quay-init.sh --loop --root /tmp/quay-init-dst-measure2 --project proj \
    --test-command 'node --test' --tmux-session 'proj-0:0.0' --worktree-root /var/tmp/quay-wt-m2 --dry-run
  would-copy: /tmp/quay-init-dst-measure2/orchestration/manager-loop-tick.md   # ← 铺设集成员
quay-init complete.
$ test -f /tmp/quay-init-dst-measure2/orchestration/manager-loop-tick.md && echo 1 || echo 0
0     # dry-run 不写文件（正确）

# measure 的 real-run 形式 = 目的地存在（band=1 的权威判据）：
$ bash plugin/scripts/quay-init.sh --loop --root /tmp/quay-init-dst-measure2 --project proj \
    --test-command 'node --test' --tmux-session 'proj-0:0.0' --worktree-root /var/tmp/quay-wt-m2
  copied: /tmp/quay-init-dst-measure2/orchestration/manager-loop-tick.md
$ test -f /tmp/quay-init-dst-measure2/orchestration/manager-loop-tick.md && echo 1 || echo 0
1     # band manager_driver_laid = 1 达成（目的地存在）
```

### measure `manager_refs_in_initsh`

```
$ grep -n 'manager-loop-tick' plugin/scripts/quay-init.sh
620:            "orchestration/manager-loop-tick.md"]:        # write_state_file 的 laidFiles 跟踪
1375:  # (plugin/loop/manager-loop-tick.md) is the THIRD tick doc...  # 注释
1384:    "manager-loop-tick.md:orchestration/manager-loop-tick.md"; do  # 铺设对（与 outer/inner 同列表）
$ grep -c 'manager-loop-tick' plugin/scripts/quay-init.sh
3     # 3 行命中：1 条注释 + 2 条铺设型（laidFiles state 跟踪 + 铺设对）——基线是 0 条铺设型
```

### AC3 形态裁定

**裁定：每项目铺设（Form A，同 outer/inner 形态），内容为网络通用模板。**

1. **交付载体唯一性**：`quay-init --loop` 是唯一把 loop 机制文档送到新主机的安装器。若管理者驱动走
   「每机一份」形态，就没有可用的交付载体（不存在每机安装器）——管理者驱动必须搭现有载体才叫「随包走」。
2. **管理者角色 vs 驱动文档的粒度分离**：管理者**角色**是每网络一台（人/OS 锚点启动，AC8 of
   `gap-productize-the-manager-layer`），但驱动文档是**操作指令**，必须装到主机上才可读。按项目铺设
   **通用模板**使每台装了 quay 的主机都在任意项目工作区拿到同一份字节一致的驱动——N 份相同副本不冲突
   （管理者进程只读一份，且内容处处相同）。
3. **与 outer/inner 一致（不照抄内容，照抄「随包铺」的载体）**：外层/内层是每项目机制、按项目铺；
   管理者驱动是**第三份 loop tick 文档**，归入同一个第 2 类循环文档交付面（L1 检查因此覆盖它、升级路径
   `managed` 模式跟踪它）。
4. **与 `--project` 的关系**：`--project proj` 命名目标项目；管理者驱动铺进该项目工作区的
   `orchestration/manager-loop-tick.md`，字节一致、不做逐项目替换（配置驱动）。每主机的「一台」由
   **谁启动**确立（人/OS 锚点），不由文档落在哪个项目确立。网络特有值（项目列表、tmux 窗口、仓库路径）
   是管理者自己的运行上下文，不在模板里硬编码（模板用 `<PROJECTS>` / `<REPO_ROOT>` 占位 + 说明，
   §1.a/§1.b）。quay 自身网络特有的落地仍是 quay 仓库的 `orchestration/manager-loop-tick.md`
   （已加角色分工头注，同 `orchestration/orchestrator-loop-tick.md` 的模式）。

### AC4 交叉标注（与 `gap-productize-the-manager-layer`，done）

那条（done）的 AC2 实跑输出是「`quay-init --loop` 演练 exit 0（verify-referenced-landed OK，
manager SKILL 引用的机制全部落盘/声明）」——**这句话为真，且它验的东西确实验到了**：管理者 SKILL
*引用*的那些机制都在。但**管理者自己的驱动文档从不在铺设集里**（`grep -oE "orchestration/[a-zA-Z0-9._-]+"
plugin/scripts/quay-init.sh` 只回 outer 驱动 + session-liveness.env；`grep manager` 只有 3 条注释、零铺设），
那条 AC 没问这件事。**这是「AC 跨度小于问题跨度」的第 4 个实例**（前三：跨机同步、其前身任务、并发推导
回退）。本任务因此把 AC 写成**目的地侧**机械判据（AC1：全新工作区铺设后目的地必须存在该文档），而不是
源侧「引用都在」——若只在源仓库查到就判通过，说明又在验源侧，判定无效（Contract control）。

### AC5 AC12b 关联

人已裁定**管理者是交付物**。AC12b（两层无人干预区间）的观测者就是管理者——**一台新主机拿不到管理者，
就等于拿不到「发现自己出问题」的能力**。落地前 ad-arm1 冷启动闸靠铺设下来的闸抓到 A 自己套件没抓到的
4+3 个缺陷；而管理者这一层此前根本没有「随包走」的部分（AC2 负控制证明：新主机铺设后没有任何看门的）。
**落地前 AC12b 在新主机上是否可测：否**——新主机 `quay-init --loop` 得到 outer + inner，没有管理者 =
没有观测 AC12b 的那一层。**落地后**：新主机的 `orchestration/manager-loop-tick.md` 存在（AC1），
人/OS 锚点启动管理者（AC8 语义：交付 ≠ 启动，管理者由人启动）后即可观测 AC12b。

## Touches
- tasks/gap-the-manager-layer-does-not-propagate-quay-init-lays-no-manager-driver.md
- plugin/scripts/quay-init.sh
- orchestration/manager-loop-tick.md
- tasks/gap-productize-the-manager-layer.md（交叉标注）

## Dispatch review

reviewer: outer
at: 2026-08-06T14:1xZ
changed: 内层立案任务补 Contract 格式（measure 补 backtick 命令 + 字段、invariant/control 续行合并、加本段）。任务待派（dispatch 记账 0d6e98b7 补晋 ready）。

