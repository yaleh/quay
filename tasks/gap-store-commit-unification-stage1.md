---
id: gap-store-commit-unification-stage1
title: 单一提交原语 store-commit.ts + 五 store 接线（删三处各自 git commit，SPEC 阶段 1）
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-195
---
## Proposal

正本：`orchestration/SPEC-store-commit-unification-2026-09-08.md` §5 阶段 1；判据 `goals/AC-195-store-git-commit-0-store-commit-ts.md`（goal=GOAL-008）。

五个 store kind 的 commit-after-write 今天三套互不相同、两个完全没有（SPEC §1.1 实测表）：tasks 走 `quay-native/src/store.ts:1117`（四态返回、`git rev-parse --show-toplevel` root、ff develop）；goals 走 `quay/src/goal-store.ts:264 commitGoalFileAfterWrite`（`path.dirname(goalDir)` 当 git 根、boolean 返回）；meta 走 `quay/src/meta-store.ts:77 commitMetaFileAfterWrite`（同 goal 的两处毛病）；adr / docs-managed 完全没有提交路径。AC-195 判据今天读数 = 3（`grep -l '"commit",'` 五个 store 文件命中 goal-store / meta-store / quay-native store 各 1）⇒ 红。

本任务实现 SPEC 阶段 1（本 goal 判据面核心，AC-195..199 是同一原子改动）：建 `packages/quay/src/store-commit.ts` 单一提交原语 `commitStoreWrite`（四态返回、rev-parse root、pathspec 限定 add+commit 背靠背、unchanged 回滚 HEAD），五 store 全部委托它、删除三处各自 `git commit`。阶段 2（传播按读者归位，改 `acShortCircuitVerdict`）与阶段 3（驱动侧 5 个直写点）范围外、另立任务（SPEC §5）。

相关但已收敛（非重复）：`gap-task-ops-consolidate-driver-frontmatter-writers`（done，只收敛 parser/writer，未收敛提交落点）。

## Plan

1. 建 `packages/quay/src/store-commit.ts`：导出 `CommitOutcome = "committed" | "unchanged" | "not-in-git" | "failed"` 与 `commitStoreWrite(opts: {relPath, message, root?, propagate?, skipIf?})`。root 默认 `git rev-parse --show-toplevel`（⛔ 非 path.dirname，硬规则 4 推论二）；`git add <pathspec> && git commit --no-verify -m <msg> -- <relPath>` 背靠背（硬规则 11，索引跨层共享）；`unchanged` 必须 restore 回 HEAD 不留脏工作树（脏 goals/*.md 会挡 develop→doc ff-only，gap-meta-commitgoalfile 修过的 bug）；`not-in-git` 是有意 no-op 非失败（单测临时目录）。
2. 迁 `goal-store.ts`：删 `commitGoalFileAfterWrite`（:264，含 :292 的 git commit 与 :265 的 path.dirname root），改调 `commitStoreWrite`（propagate 默认 none、skipIf 字节相同，SPEC §4 声明表）。
3. 迁 `meta-store.ts`：删 `commitMetaFileAfterWrite`（:77，含 :105 git commit 与 :78 path.dirname root），改调 `commitStoreWrite`。
4. 迁 `quay-native/src/store.ts`：`commitTaskWrite`（:1117）内部的 git add/commit 改调 `commitStoreWrite`（保留其 `committed|not-in-git|nothing|failed` 四态语义与 ff develop 传播；root 已是 rev-parse，无需改）。
5. 给 `adr-store.ts` / `document-store.ts` 加 commit-after-write（人 2026-09-08 裁定 2），调 `commitStoreWrite`（propagate none）。
6. 建 `packages/quay/test/store-commit.test.mjs`：带 `@test-group` 标注，含四组负控制（SPEC §7 AC-199，缺一不可否则是回声不是测量）：① propagate develop 关掉 ⇒ develop 拿不到该写；② propagate none 打开 ⇒ develop 不拿到该写；③ 目标不在 git 工作树 ⇒ 返回 not-in-git 而非 failed；④ 内容字节相同 ⇒ 返回 unchanged 且工作树干净。

## Acceptance Criteria

- [x] AC-195 判据本判据：`test "$(grep -l '"commit",' packages/quay/src/goal-store.ts packages/quay/src/meta-store.ts packages/quay/src/adr-store.ts packages/quay/src/document-store.ts packages/quay-native/src/store.ts 2>/dev/null | wc -l)" -eq 0`
- [x] 原语存在且四态齐备：`test -f packages/quay/src/store-commit.ts && grep -q 'not-in-git' packages/quay/src/store-commit.ts && grep -q 'unchanged' packages/quay/src/store-commit.ts && grep -q 'rev-parse' packages/quay/src/store-commit.ts`
- [x] 旧 boolean 提交函数 = 0：`test "$(grep -rl 'commitGoalFileAfterWrite\|commitMetaFileAfterWrite' packages/quay/src | wc -l)" -eq 0`
- [x] 五 kind 全部接线 commitStoreWrite = 5：`test "$(grep -l commitStoreWrite packages/quay/src/goal-store.ts packages/quay/src/meta-store.ts packages/quay/src/adr-store.ts packages/quay/src/document-store.ts packages/quay-native/src/store.ts 2>/dev/null | wc -l)" -eq 5`
- [x] 不再有 path.dirname 当 git 根：`test "$(grep -rn 'const root = path.dirname(goalDir)\|const root = path.dirname(metaDir)' packages/quay/src | wc -l)" -eq 0`
- [x] 负控制单测进默认 suite 且跑绿：`head -3 packages/quay/test/store-commit.test.mjs | grep -q '@test-group' && node --no-warnings --experimental-strip-types --test packages/quay/test/store-commit.test.mjs`

## Definition of Done

真实落地 = 一个对象真的穿过该机件，不是「测试绿」（DIR-026 Reading A）：① 五个 store 文件里 `git commit` 的唯一下落是 `store-commit.ts` 的 `commitStoreWrite`（上列结构 grep 全过），并做一次真实写盘往返——经 goal-store 写一个 goal 文件，`git log develop -- goals/` 可见提交消息来自新原语（非旧式「写盘即提交（goal-store）」），且 `git status --porcelain goals/` 为空（unchanged 不留脏）；② `node --no-warnings --experimental-strip-types --test packages/quay/test/store-commit.test.mjs` 退出 0 且该文件经 `@test-group` 被默认 suite 选中（非 skip）。

## Touches

- packages/quay/src/store-commit.ts
- packages/quay/src/goal-store.ts
- packages/quay/src/meta-store.ts
- packages/quay/src/adr-store.ts
- packages/quay/src/document-store.ts
- packages/quay-native/src/store.ts
- packages/quay/test/store-commit.test.mjs
- packages/quay-native/test/store.test.mjs
- plugin/skills/manager/SKILL.md
- plugin/skills/init/SKILL.md
- tasks/gap-store-commit-unification-stage1.md