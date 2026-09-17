---
id: GOAL-023
title: GitHub默认分支改回master（对外门面=已发布版）+ push author 备份 + 加固 worker worktree
  分叉不变量——反转 SPEC-release-and-hotfix-branching-2026-09-15 §3.2.1 的一次裁定
status: draft
kind: goal
origin: 人 2026-09-17 提议：本地开发继续以develop为主，但GitHub默认分支/marketplace对外展示应为master（已发布版）
---
## 背景

2026-09-17 排查"claude plugin marketplace 装出来是0.10.0-dev不是v0.9.0"这个报告时，发现：
`claude plugin marketplace add yaleh/quay`（不带ref）读的是GitHub仓库的**默认分支**——目前是`develop`
（人 2026-09-15 在 SPEC-release-and-hotfix-branching-2026-09-15.md §3.2.1 裁定切换的），导致外部用户
浏览marketplace时看到的是develop当前的"-dev"版本号（虽然实际装出来的字节仍正确来自dist-plugin=0.9.0，
这层是marketplace元数据展示层的问题，不是产物错误）。

进一步排查发现一个更基础的问题：**`author`分支（这个项目文档反复强调的"写面"）从未被推送到GitHub过**
（`git ls-remote --heads origin author`为空），只存在于这台机器（boheidc）本地，从仓库最初创建时就有，
是单点失效风险——这台机器的检出一旦丢失，`author`及其历史永久丢失。

人提出的方案：本地开发继续以develop为主不变，但GitHub默认分支改回master（让外部访客/marketplace看到
"已发布"版本），同时push author做备份。调查这个方案的可行性时，发现一个关键缺口：**worker任务worktree
从develop分叉这件事，当前不是被硬编码保证的**——`worker-driver.ts`的派发prompt第1步只写"create an
isolated git worktree for `${task}`"，没有指明具体分叉点；`dispatch-worktree-setup.sh`的闸只检查分支名
是不是`task/*`模式，不检查分叉点。今天能正确工作纯粹是因为GitHub默认分支恰好=develop，`EnterWorktree`
工具的默认（fresh）模式恰好读到正确的分支——这是巧合对齐，不是结构性保证。如果现在直接把默认分支改成
master，worker新建的worktree会静默地从master（更旧的代码）分叉，且不会被现有的分支名检查发现，直到
fan-in阶段才会因为冲突/回归被发现。

## 方案（5 部分）

1. **push `author` 到 origin**，解决单点失效风险。
2. **加固 worker 任务 worktree 的分叉点不变量**——给 `dispatch-worktree-setup.sh` 的闸增加
   merge-base/is-ancestor对develop的校验（不只查分支名），使这个不变量不再依赖GitHub默认分支的值。
3. **GitHub 默认分支改为 master**——外部访客、`claude plugin marketplace add`看到的是已发布版本。
4. **worker fan-in 目标继续是 develop**——已经是现状，本方案不改变这条，只做回归防护验证。
5. **修订 `orchestration/SPEC-release-and-hotfix-branching-2026-09-15.md`**：
   - §3.2.1 增补一条2026-09-17追加裁定，记录这次反转及理由（参照该SPEC自己§11的追加裁定写法）。
   - `AC-273`（现在硬编码期望`origin/HEAD == develop`，改默认分支后会永久报红）标记 `superseded`，
     被本GOAL的AC-285（默认分支=master的判据）与AC-284（worktree分叉点判据）共同取代——原来一条判据
     混合检查了"GitHub默认分支对不对"和隐含地"worktree会不会跟着分叉对"两件事，拆成两条正交判据。
   - 三条长期线（develop/master/release）的设计补第四条：`author`——本地写面、双向ff同步develop、
     现在起也推送备份，写清它的角色与推送频率约定。

## 范围与非目标

范围：以上5部分，及AC-273的正式退役/替代。
非目标：不改变`quay-native`/task状态写入面在author这件事本身（那是另一条已裁定的规则，见
CLAUDE.md"分支同步"一节），本GOAL只处理author的**备份**与GitHub门面/worktree分叉这三件相关但独立的事。

## 退出条件

五条AC全部achieved：AC-283（author已推送且是本地author的真实祖先）、AC-284（worktree分叉点被
merge-base结构性校验，不再只查分支名）、AC-285（GitHub默认分支实测=master）、AC-286（fan-in目标
仍是develop，回归防护）、AC-287（SPEC文档完成对应修订：追加裁定+AC-273标记superseded+author补入
三条线设计）。