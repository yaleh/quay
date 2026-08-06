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
status: ready
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

- [ ] AC1: **目的地侧实测**——全新临时工作区跑 `quay-init --loop`，在**目的地**存在管理者驱动文档，
      贴出 `ls` 与实跑输出（源仓库里有不算）
- [ ] AC2: **负控制**——改前跑同一条命令，确认目的地**没有**该文档（证明 AC1 是修复生效）
- [ ] AC3: **形态裁定入库**——任务体记录管理者驱动的铺设粒度裁定（每机一份 vs 每项目一份）及理由；
      若判定为每机一份，说明它与 `--project` 参数的关系
- [ ] AC4: **与 `gap-productize-the-manager-layer`（done）交叉标注**——说明那条验的是"SKILL 引用的机制
      都在"（为真），本条补的是"管理者自己的驱动文档不在铺设集"（AC 跨度不足的第 4 个实例）
- [ ] AC5: **AC12b 关联**——任务体说明：新主机没有管理者 = 没有观测 AC12b 的那一层，
      并记录本条落地前 AC12b 在新主机上是否可测

## Definition of Done

- [ ] AC1-AC5 实跑输出贴进任务体
- [ ] 完整套件连跑 2 次全绿（`fail 0` 且 `cancelled 0`）

## Touches
- tasks/gap-the-manager-layer-does-not-propagate-quay-init-lays-no-manager-driver.md
- plugin/scripts/quay-init.sh
- orchestration/manager-loop-tick.md
- tasks/gap-productize-the-manager-layer.md（交叉标注）

## Dispatch review

reviewer: outer
at: 2026-08-06T14:1xZ
changed: 内层立案任务补 Contract 格式（measure 补 backtick 命令 + 字段、invariant/control 续行合并、加本段）。任务待派（dispatch 记账 0d6e98b7 补晋 ready）。

