# outer 在飞协调状态（2026-08-12 21:05Z 刷新——ADR-009：须跨压缩存活）

> **本文件有效期 = 到下一次终态轮次为止，过期即重写。** 压缩/新会话后先读此文件再决定动作。
> 源：外层会话 902b4528（session 可能饱和/压缩，此文件是锚）。
> 本次写于 21:05Z，因 round 63/64 绿 + batch-merge 完成而刷新。

## 当前状态：diverge 0/0，post-merge 内容批在飞

- **develop = integration = 92268d81**（batch-merge 完成，diverge 5→0）。
- **post-merge 内容批**（本批提交会触发 round 65）：pre-commit 守卫任务（已立，
  gap-precommit-guard-running-round-rejects-assertion-surface-commits，**优先级 #1**）+ dead-loop/stranded-check 两任务
  flip done + A0b③ 任务补 source 断言 + gap-suite-start-verifies-target-commit 补 verifiedCommit 相等闸。
- **inner 在飞**：0（dead-loop + stranded-check 已处理，实现早落地）。

## 已完成的弧线（不要再等/再做）

- ✅ **round 59→64 全链**：round 59 红（manager cp AC3 真回归）→ round 60 红（manager 核心内容 3 断言）→
  round 61 绿（manager 1d75ac00 副本还原）→ round 62 绿（同树重复轮）→ round 63 绿（manager source sync 30de8f94）
  → round 64 绿（inner 4 笔 bookkeeping）→ batch-merge 全 5 提交。
- ✅ **manager 双修复**：12a6b18b 的 cp 两次损害（带进 plugin/loop/ 引用 / 拿走 vhs A10/B4 内容）→
  c9b9716d（副本去 plugin/loop/）+ 1d75ac00（副本还原 12a6b18b^）+ 30de8f94（source sync A10/B4 反向搬运，源一直贫化）。
- ✅ **收尾**：#61 + gap-mcp + dead-loop + stranded-check 的实现都已验证（rounds 61/63/64）。
- ✅ **batch-merge 三闸**全过（freshness / worktree-green / object），全部 FF。

## 关键机制发现（2026-08-12，已立案）

- **pre-commit 守卫**（gap-precommit-guard-running-round-rejects-assertion-surface-commits，priority #1）：
  「round 期间零提交」约定守不住——①无产物（C17）②事后难区分③**参与方不完整且名单无人维护**（inner 30s/笔，
  结构性不可靠小心解决）。state=running 且触及断言面文件 ⇒ 拒提交；fail-loud 缺字段；断言面集合从测试自声明聚合。
- **verifiedCommit 相等闸**（并入 gap-suite-start-verifies-target-commit）：起跑前确认 verifiedCommit ≠ 上一绿轮，
  防重复验同一棵树（round 62 就是 IDLE-GREEN 2min 阈值 < 收尾耗时造成的 400s 重复）。不调阈值（外生变量），判树变不变。
- **A0b③ 判据缺口**（gap-check-set-after-change-diff-nameonly-intersect-judged-objects）：改文件后跑哪些测试，
  用 diff --name-only ∩ 测试自声明判定对象。manager-tick-core 三条机制名断言需对【源与副本】各断言一次
  （副本=交付正确、源=执行正确；内容允许不同但机制名必须在）。源侧一直无人守（tick-core-static-check 只查 src 覆盖）。
- **同步方向教训**：源与副本关系被搞反时（副本更丰富），任何单向同步都同时做两件事。更正前提时必须回滚其产物。

## 已立案任务（按序派发）

- gap-precommit-guard-running-round-rejects-assertion-surface-commits（**priority #1**，post-merge 批）
- gap-ts-touching-fan-in-needs-typecheck-gate
- gap-dispatch-gate-blind-to-inflight-merge-worktree
- gap-src-n-pointer-rot-unverifiable-coverage
- gap-suite-start-verifies-target-commit（含 verifiedCommit 相等闸）
- gap-concurrent-write-mutable-tree-false-positive-red
- gap-check-set-after-change-diff-nameonly-intersect-judged-objects（A0b③，含源+副本断言）

## 已知事项

- 无在效冻结。三项目运行中。
- 窗口内提交（round 60 我的 47023142 / round 63 inner 的 4 笔任务体）验证「无害」是运气不是机制——pre-commit 守卫立项。
- `undefined`（repo 根 300KB 残留）与 `.quay/orphaned-full-suite-runner-*.diff` 未清理（起跑前快照会捕获，不新增即可）。
