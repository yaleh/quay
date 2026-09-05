---
id: gap-branch-rename-manager-doc-to-author
title: 分支改名 main/manager-doc → author（人 2026-09-05 裁定，含撞名规避确认）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
  depends_on:
    - gap-retire-unused-quay-author-skill
---
## Proposal

把主检出所在的 doc-only 工作分支 `main/manager-doc` 改名为 `author`（人 2026-09-05 逐字确认）。

**改名理由（人的三个约束 + 已核实的事实）**：
- **面向人类开发者**：`author` 与既有方法论词汇（quay:author skill、"authoring" 操作）同词，
  语义是"人撰写任务"，与 `develop`（机械闭环推进的权威主干）形成清晰对立。
- **反映最近实际领先 develop 的变更内容**：抽样最近 60 条提交，`tasks:` 前缀占 40 条（67%）、
  `Merge` 13 条、`docs` 3 条——该分支的流量本质就是任务的新建/变更/翻转，`author` 直接对应。
- **单词、无连字符**：3 字符。
- **原候选 `author` 曾因撞名被搁置**：`plugin/skills/author`（quay:author skill，todo→ready
  撰写动作）当时也叫这个名字，人机对话/文档里会产生真实指代歧义。**该 skill 已确认在全部会话
  历史中从未被真实调用（谓词验证过，见 gap-retire-unused-quay-author-skill），人已确认删除**——
  删除后撞名前提消失，`author` 重新可用作分支名。**本任务 depends_on 该删除任务先落地**，避免
  改名窗口期内分支名与仍存在的 skill 名并存造成混淆。

**已核实的事实（决定改名成本，无需重新调查）**：
1. `main/manager-doc` 是本地专属分支，从未推送 origin（`git ls-remote --heads origin` 命中 0）
   ⇒ 改名纯本地操作，无远程/PR 迁移成本。
2. 机制层零代码硬编码分支名——`propagateDocBranchToDevelop`（`driver-filters.ts:209`）、
   `fan-in-ff-merge.sh`、`develop-work-ff.sh`、`integration-batch-merge.sh` 全部用
   `git branch --show-current` 动态取当前分支；改名前后行为逐位相同。
3. 当前分支 HEAD = `618b453645`（2026-09-05 核实，develop 与之同步，0 落后）。
4. 任务 `gap-fan-in-ff-ref-update-detach-develop`（相关但非重复，处理的是 ff dual-mode 检测
   与反向同步机制本身，不是分支改名）里也大量引用旧分支名，按"历史证据保留"政策处理（见下）。

## Plan

1. **改名前置条件**：确认 `gap-retire-unused-quay-author-skill` 已 done（三份 author skill 文件
   已删除）——`git ls-remote` 无关，检查本地仓库 `find . -iname '*author*' -path '*skills*'`
   （排除快照）应为空。
2. **机械改名**：`git branch -m author`（在主检出上执行，重命名不是新建，oid 不变）。
3. **必须改 —— 测试 fixture（机制正确性）**：
   - `plugin/test/driver-filters.test.mjs:274`：`git checkout -q -b main/manager-doc` → `author`
     （连同 :272 注释）。
   - `plugin/test/ready-pool-check.test.mjs`：`:2417`（注释）、`:2432`、`:2438`、`:2442`、
     `:2457`、`:2468` 六处 `main/manager-doc` → `author`。
4. **必须改 —— 每会话注入的正本（现行规则）**：`CLAUDE.md` 第 330/331/333/334 行"分支同步"段落
   → `author`；顺手核对该段与 `gap-ff-propagate-…`/`gap-main-manager-doc-doc-only-ff-only-tracking`
   已确认的现行模型一致，避免二次编辑同一段。
5. **可改（cosmetic）**：`plugin/scripts/driver-filters.ts:202/204` 两行注释。
6. **任务文件里的现行规则引用改，历史 Evidence 保留**（人已确认的政策）：以下 7 个任务文件里，
   凡描述"现行规则/义务"的引用（如"主检出保持 main/manager-doc"、"立案落 main/manager-doc"）
   → `author`；凡带时间戳的 `Evidence:`/事件描述行（如"主检出已切到 doc-only 工作分支
   main/manager-doc（从 develop f0d11209a 创建）"）→ **保留旧名，不改写**（改写会伪造历史）：
   - `tasks/gap-dispatch-reads-stale-main-checkout-task-status.md`
   - `tasks/gap-fan-in-ff-ref-update-detach-develop.md`
   - `tasks/gap-ff-propagate-structurally-broken-filing-must-target-develop.md`
   - `tasks/gap-main-manager-doc-doc-only-ff-only-tracking.md`（任务 ID 本身含旧名，按硬规则 8
     不回收/不改 ID，只改正文里的现行规则引用）
   - `tasks/gap-mark-needs-human-commit-after-write.md`
   - `tasks/gap-mechanical-fan-in-result-single-authoritative-structured.md`
   - `tasks/gap-web-task-status-reads-stale-main-checkout.md`
7. **memory 层同步**（不在 Touches 内，因目录在仓库外）：更新
   `~/.claude/projects/-home-yale-work-quay/memory/` 下 10 个引用旧名的文件（现行指引部分），
   文件名本身带旧名的 `main-checkout-manager-doc-ff-develop.md` 建议改名 + 同步 `MEMORY.md` 指针。
8. **验证**：
   - 测试绿：`driver-filters.test.mjs` + `ready-pool-check.test.mjs` 改名后全绿。
   - 残留归零：`grep -rn "main/manager-doc"`（仓库 + memory）→ 仅剩"历史 Evidence 保留清单"；
     零计数前先用该谓词对一个已知仍含旧名的历史 Evidence 行干跑一次，确认谓词本身有效
     （硬规则 2 配套动作）。
   - 端到端负控制：一次真实 doc 分支翻转（如 `markNeedsHuman`）验证 `propagateDocBranchToDevelop`
     改名后仍能推到 `develop`。
9. **CONTINUE 轮发现的必要使能修复（anti-drift false-positive）**：本任务 Touches 含非 ASCII 文件名
   `docs/references/维度边界…md`，而 fan-in 的 anti-drift 守卫 `anti-drift-touches-check.ts`
   `computeActualFiles` 用 `git diff --name-only` 未关 `core.quotepath` ⇒ 非 ASCII 文件名被 git
   C-quote 成 `\ooo` 八进制形态 ⇒ 与声明 Touches 的真实 UTF-8 名无法匹配 ⇒ 误报 out-of-declared
   （上一轮实测 1 violation、exit 1）。修法与已落地的
   `direct-to-develop-bypass-check.ts` `gitCommitFiles` 同款：git 命令加 `-c core.quotepath=false`。

## Acceptance Criteria

- [x] AC1（能取假，前置）：`gap-retire-unused-quay-author-skill` 状态为 done 且本地仓库
      `find . -iname '*author*' -path '*skills*'`（排除快照目录）为空；⛔ 该任务未完成或仍有
      author skill 文件残留则本任务不得改名。**Evidence: 依赖 done；3 份 vendored SKILL.md 全删
      （含 gitignored `packages/quay/plugin/skills/author` 磁盘残留已清）；find 仅剩 `.claude/skills/
      quay-native-methodology/examples/quay-author-SKILL.md`（tracked 参考示例、非可装 skill，依赖任务
      有意保留）。**
- [x] AC2（能取假，机制）：`git branch --show-current` = `author`，且其 oid 与改名前
      `main/manager-doc` 的 oid（`618b453645` 或改名时的实际 HEAD）一致（证明是重命名非新建）；
      ⛔ 分支名不是 `author` 或 oid 不匹配则假。**Evidence: `git branch --show-current`=author；
      oid `ffdcf0824`（改名时实际 HEAD）= 改名前 oid；`main/manager-doc` ref 已不存在。**
- [x] AC3（能取假，无回归）：`node --test plugin/test/driver-filters.test.mjs
      plugin/test/ready-pool-check.test.mjs` 改名后全绿；⛔ 任一测试失败则假。**Evidence: 181/181 pass
      （fail 0）。**
- [x] AC4（能取假，完备性）：仓库内（含 CLAUDE.md）`grep -rn "main/manager-doc"` 的命中仅剩
      Plan 步骤 6 枚举的"历史 Evidence 保留"行；⛔ 现行规则类引用仍残留旧名则假。**Evidence: 残留仅
      = fan-in-ff-protocol-check 58eaaa2d0 回归测试/注释 + 各任务 Evidence 的 commit-subject 引文
      （c48ebc0d3 / f0d11209a / 1c483d387 / 1795 次 merge 引文）+ 本任务自身改名描述。**
- [x] AC5（能取假，memory 一致）：`~/.claude/projects/-home-yale-work-quay/memory/` 下 10 个
      文件的现行指引部分已更新为 `author`，`MEMORY.md` 指针同步；⛔ 仍有现行指引引用旧名则假。
      **Evidence: 12 个现行指引文件 + `main-checkout-manager-doc-ff-develop.md`→`main-checkout-author-ff-develop.md`
      改名 + `MEMORY.md` 指针同步；残留仅 fan-in-suite-red 的 58eaaa2d0 引文（历史）+ task-id
      `gap-main-manager-doc*`（硬规则 8 不改）。**
- [x] AC6（能取假，端到端负控制）：一次真实 doc 分支翻转（如触发 `markNeedsHuman` 或等效路径）
      经 `propagateDocBranchToDevelop` 成功推到 `develop`；⛔ 传播失败则假。**Evidence: author 上建
      空提交 `32fa5c154`，`propagateDocBranchToDevelop` 返回 true，develop 快进到 `32fa5c154`
      （develop..author 与 author..develop 计数均 0）。**

## Definition of Done

分支已改名为 `author`（重命名而非新建，oid 保留）、相关测试全绿、仓库与 memory 里的现行规则引用
已切换到新名（历史 Evidence 行按政策保留旧名）、一次真实的 doc→develop 传播验证通过。

## Touches

- CLAUDE.md
- docs/references/维度边界与结晶——从熔融实现中发现原则.md
- plugin/scripts/anti-drift-touches-check.ts
- plugin/scripts/driver-filters.ts
- plugin/scripts/promotion-driver.ts
- plugin/scripts/ready-pool-check.ts
- plugin/test/driver-filters.test.mjs
- plugin/test/ready-pool-check.test.mjs
- tasks/gap-dispatch-reads-stale-main-checkout-task-status.md
- tasks/gap-doc-develop-sync-semantic-conflict-resolution.md
- tasks/gap-driver-filters-readtaskstatus-stale-main-checkout.md
- tasks/gap-fan-in-ff-ref-update-detach-develop.md
- tasks/gap-ff-propagate-structurally-broken-filing-must-target-develop.md
- tasks/gap-main-manager-doc-doc-only-ff-only-tracking.md
- tasks/gap-mark-needs-human-commit-after-write.md
- tasks/gap-mechanical-fan-in-result-single-authoritative-structured.md
- tasks/gap-retire-unused-quay-author-skill.md
- tasks/gap-sync-trigger-divergence-detection-bidirectional.md
- tasks/gap-tasks-page-develop-ref-full-history-git-log-cost.md
- tasks/gap-web-task-status-reads-stale-main-checkout.md
- tasks/gap-branch-rename-manager-doc-to-author.md（self-touch）
