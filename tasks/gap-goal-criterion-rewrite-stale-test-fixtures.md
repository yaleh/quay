---
id: gap-goal-criterion-rewrite-stale-test-fixtures
title: 判据改写（AC-322/AC-327，2026-10-03T15:42Z）与 AC-904 新增后，三个测试夹具/语料未同步 ⇒ develop
  全量 suite 常红 9 条，阻塞所有 code-delta fan-in
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**2026-10-04 在 develop 字节（`5c4631db8`）上复现：三个测试文件共 9 条确定性红**（另有 `plugin/test/ready-pool-check-s22.test.mjs` 的 N=2000 计时 flake 1 条），**不依赖任何在飞任务的分支**，使每个 code-delta 任务的机械 fan-in 全量 suite 常红、无法落地。由 `gap-goal904-merge-drill-record-doc` 发现（其 delta 仅一份 `docs-managed/` 文档，被判 code ⇒ 触发全量 suite，遂撞上这三簇红）。

三簇根因（均为判据改写/新增后测试夹具未同步）：

1. `packages/quay/test/ac322-criterion-catchup.test.mjs` **5 红**。AC-322 判据 2026-10-03T15:42Z（`d5c3df8d0`，人裁定「改判据并重开 321–323」）改为祖先关系版：`live_goals()` 新增要求 goal frontmatter 含 `activatedAt:`，并删去 `NOT-EVALUATED: no goal record carries branch: true yet`。夹具 `writeGoal()` 不写 `activatedAt` ⇒ `live_goals()` 恒空 ⇒ `checked=0` ⇒ 恒 exit 3（落地两测期待 exit 0/1；`no branch-mode goal` 测期待旧消息 A，实得 B）。
2. `plugin/test/worker-driver.test.mjs` **1 红**（goal-merge e2e，AC-325/AC-327）。同源：`makeGoalMergeRepo()` 写的 `goals/GOAL-901-*.md` 有 `branch: true` 但无 `activatedAt:` ⇒ AC-327 exit 3（期待 0，stderr `NOT-EVALUATED: no live branch-mode goal has merged into develop yet`）。
3. `plugin/test/live-web-address.test.mjs` **3 红**。AC-904 判据（2026-10-04T00:15Z，`1aec2bd8b`）调用 `plugin/scripts/live-web-address.ts` ⇒ 被语料谓词 `criterion.includes("live-web-address.ts")` 收进「17 条」语料（实得 18，`AC5: the corpus really is the 17 converged criteria` 断言失败）；且 AC-904 的语义（`curl /doc` 列出 DOC-904）在合成夹具 `enPage()` 上不可满足（real arm 期待 exit 0 实得 1），其拒绝词也不匹配 mutant arm 的三选一正则。

反例对照（硬规则 4 推论四）：以上均在 `git archive develop` 的字节上红——与本仓储任何在飞任务的 delta 无关，是 develop-wide 的。

**修法落点（实现者择一，⛔ 不要两侧同时改）**：测试侧（当前倾向；三簇的夹具都确实缺新判据要求的前置）——补齐夹具/语料并按新判据对齐期待；判据侧——若判断 `activatedAt:` 不该是 `live_goals()` 的硬前提、或 AC-904 不该走该助手，则经 `quay goal write` 改 `goals/AC-322-*.md` / `goals/AC-327-*.md` / `goals/AC-904-*.md`。若选判据侧，落地前须把对应 `goals/*.md` 加入本任务 `## Touches`（anti-drift 会拒收 Touches 外的写入）。

## AC

- [ ] 改动后 `node --test packages/quay/test/ac322-criterion-catchup.test.mjs` 全 pass。
- [ ] 改动后 `node --test plugin/test/worker-driver.test.mjs` 全 pass。
- [ ] 改动后 `node --test plugin/test/live-web-address.test.mjs` 全 pass。

## DoD

develop 上直跑上述三个测试文件全绿，使 `gap-goal904-merge-drill-record-doc`（及任何 code-delta 任务）的机械 fan-in 不再被这三簇常红阻塞。

## Touches

- packages/quay/test/ac322-criterion-catchup.test.mjs
- plugin/test/worker-driver.test.mjs
- plugin/test/live-web-address.test.mjs
- tasks/gap-goal-criterion-rewrite-stale-test-fixtures.md
