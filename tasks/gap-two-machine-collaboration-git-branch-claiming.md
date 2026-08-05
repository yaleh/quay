---
id: gap-two-machine-collaboration-git-branch-claiming
title: "two-machine collaboration via git-branch claiming (measured: of the
  three in-flight markers only git branches are cross-host visible — telemetry
  inProgress is local file, worktree is local dir; manager central allocation
  is single-point + QUAY_GLOBAL_DIR lock dies across hosts, same root cause as
  fast-mode single-flight; suggest claim via git: pre-push empty task/<id>
  branch = claim, branch exists = claimed, merge+delete = release; reuse
  checkTouchesPair against task/* branches on the shared bare repo; PRECONDITION:
  authority/push-direction must be fixed first — NETWORK is bidirectional
  (B can SSH back to A, verified vhs.wan.hwang.men 2026-08-05 17:2xZ; the
  old 'one-way' premise was a mis-stated mechanical obstacle, the real
  question is the AUTHORITY decision); B's package.json ENOENT blocker is
  open; to be evaluated TOGETHER with gap-branch-model-integration-branch (integration
  model is built for exactly 'multiple sources in, stale baseline' = cross-host
  is its natural use case)"
status: ready
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---
**type:** execution

## Proposal

**两机协作机制——认领用 git 分支，不用中心调度（管理者实测 + 外层裁定）**：

**实测**：三种「在飞」标记里**只有 git 分支跨主机可见**——遥测 inProgress 是本机文件、worktree 是本机
目录，B 机都看不到；而 task/<id> 分支在 git 里，双方 git ls-remote 都能看到。⇒ **task/<id> 分支天然
是分布式任务认领标记**。

**建议形态（认领用 git，不用中心调度）**：
① 做某任务前先推空的 task/<id> 分支到共享裸仓库；
② 推成功=认领成功，分支已存在=已被认领，换一个；
③ 完成合并删分支=释放。
复用 checkTouchesPair：认领时查「我要认领的任务与对方在飞任务触摸集是否相交」——**对方的在飞任务 = 共享
仓库里存在的 task/* 分支**。

**为什么不用 manager 中心分配**：manager 在 A 机、单点；与 QUAY_GLOBAL_DIR 单飞锁跨主机失效同源
（状态放在假设共享文件系统的地方）。**git 是唯一真正跨主机共享的状态存储**——认领机制建在它上面。

**前提（必须先解决）——前提已于 2026-08-05 17:2xZ 修正**：
① B 机还不能开发 quay——package.json ENOENT 阻塞未闭（任务 ready 在飞）；
② **网络层是双向连通的（管理者真测：B 机 SSH 回 A 机 vhs.wan.hwang.men，hostname/uptime 精确匹配）**——
  原「A→bare→B 单向、B 不能推回」是**被误当理由的机械障碍，已排除**。剩下的才是真问题：**权威与推送
  方向的设计裁定（AC3）**——B 有能力推回，但**该不该**推回仍待定（A 机 master 领先 origin/master 644 提交，
  B 机跟 A 机裸仓库）。涉及仓库拓扑变更，**与 integration 分支模型
  （gap-branch-model-integration-branch-splits-fork-baseline-from-merge-point，ready 已等 9 小时）一起考虑**——
  integration 分支模型正是为「多个来源汇入、基线陈旧」设计的，跨主机是天然用例。
③ **B→A 对称白名单（外层裁定 2026-08-05 17:2xZ）**：现有跨主机白名单（git/tmux-send-keys/capture-pane/
  只读，禁 kill/rm-rf/批量）是 A→B 方向的自我约束；B 机既然能主动连回 A，**B→A 方向需对称约束**——
  跨主机破坏性/批量操作在**两个方向**都禁止（伤害不认方向）。若 B 将来跑自主 outer/inner，此对称约束
  是其安全前置。

### 选定机制

1. 认领协议：推空 task/<id> 分支到共享裸仓库 = 认领；存在 = 被认领；合并删分支 = 释放
2. 认领时 checkTouchesPair：与共享仓库存在的 task/* 分支（对方在飞）查触摸相交
3. 前提：确定权威与推送方向（A→B 或双向），与 integration-branch 模型一起设计
4. 验证：两机同时认领 disjoint 任务 ⇒ 互不冲突；同任务 ⇒ 第二个认领失败

## Acceptance Criteria

- [ ] AC1: 认领协议落地——推空 task/<id> 分支 = 认领成功；分支已存在 = 被认领（实测）
- [ ] AC2: 认领时 checkTouchesPair——与共享仓库 task/* 分支（对方在飞）查触摸相交，相交则换任务
- [ ] AC3: 权威与推送方向确定（A→B 或双向），与 integration-branch 模型一致
- [ ] AC4: 两机同时认领 disjoint 任务 ⇒ 互不冲突；同任务 ⇒ 第二个认领失败（实测负控制）
- [ ] AC5: 与 integration-branch + QUAY_GLOBAL_DIR 单飞锁 + 自适应并发（机制一次下游复用）交叉标注

## Touches

- plugin/scripts/（认领协议 helper：claim-task.sh 或类似）
- plugin/loop/fast-mode-loop-tick.md / orchestrator-loop-tick.md（认领步骤）
- tasks/gap-branch-model-integration-branch-splits-fork-baseline-from-merge-point.md（AC3/AC5 交叉标注）
- tasks/gap-adaptive-concurrency-cap-tied-to-resource-gate.md（AC5 交叉标注）

## Contract

measure   claim_success = `bash <claim-task.sh> <id> 2>&1 | grep -c 'claimed\|已认领'` stdout 数字段
band      claim_success >= 1（认领成功路径可跑）
invoke    `grep -n 'claim\|认领\|task/' plugin/scripts/<claim-task.sh>`
control   disjoint 任务两机认领 ⇒ 都成功（AC4）；同任务 ⇒ 第二个失败
resume    认领协议与权威确定分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-05T18:2xZ
changed: 外层 filing 时已审（ratchet compliance 补齐 section）
