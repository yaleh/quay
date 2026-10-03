---
id: gap-goal-criterion-rewrite-stale-test-fixtures
title: 判据改写（AC-322/AC-327，2026-10-03T15:42Z）与 AC-904 新增后，三个测试夹具/语料未同步 ⇒ develop
  全量 suite 常红 9 条，阻塞所有 code-delta fan-in
status: done
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

- [x] 改动后 `node --test packages/quay/test/ac322-criterion-catchup.test.mjs` 全 pass。
- [x] 改动后 `node --test plugin/test/worker-driver.test.mjs` 全 pass。
- [x] 改动后 `node --test plugin/test/live-web-address.test.mjs` 全 pass。

## DoD

develop 上直跑上述三个测试文件全绿，使 `gap-goal904-merge-drill-record-doc`（及任何 code-delta 任务）的机械 fan-in 不再被这三簇常红阻塞。

## Evidence

选【测试侧】（Proposal 的倾向）：三簇夹具都确实缺新判据要求的前置，且判据侧改动须动 `goals/*.md`（本任务 Touches 未含）。三个文件逐个验证全绿（在工作树 `gap-goal-criterion-rewrite-stale-test-fixtures`，merge develop `9082f8c8d` 后）：

- `node --test packages/quay/test/ac322-criterion-catchup.test.mjs` ⇒ `tests 6 / pass 6 / fail 0`。
- `node --test plugin/test/worker-driver.test.mjs` ⇒ `tests 118 / pass 118 / fail 0`。
- `node --test plugin/test/live-web-address.test.mjs` ⇒ `tests 17 / pass 17 / fail 0`。
- scoped 门 `scripts/test.sh --for-task gap-goal-criterion-rewrite-stale-test-fixtures --allow-thin` ⇒ `tests 141 / pass 141 / fail 0`；选择面含 `packages/quay/test/ac322-criterion-catchup.test.mjs`、`plugin/test/live-web-address.test.mjs` 与 worker-driver 的 goal-merge e2e。

三簇各自的修法（均为夹具补齐 + 期待对齐，未改判据）：

1. **ac322**：`writeGoal()` 补 `activatedAt:`（`live_goals()` 新前置）；pass 臂改用生产形态（SPEC-goal-branch §4.7 裁定⑲）的 `git merge --no-ff goal/<id>` 落地——`goal_merges()` 只认 develop 上具名 `goal/<id>` 的合并提交，`classify()` 据此判 `via`（旧夹具用 `--ff-only` 直落 develop，无合并提交 ⇒ 判 `direct` ⇒ 落地不计入、恒 exit 3）。另在 develop 合并前补一次 `settle()`：判据的 `dev_at()` 经 `git reflog show --date=unix` 读【秒级】tip，若合并提交与追平 merge 同秒，`dev_at` 会取到落地【之后】的 tip 而误报 CAUSE（fixture artifact，非真漏追平——实测 1791046177 同秒命中）。被删的旧消息 A 的四处期待改为新读数 B（`no goal-branch landing could be checked…`），并 pin 新前置 `activatedAt:`。
2. **worker-driver**：`makeGoalMergeRepo()` 的 GOAL-901 补 `activatedAt:`（回拨 5 分钟）；并按 AC-327 改写后新增的「至少一条可归因于该次 merge 的 `via` 落地，否则 exit 3（zero would be vacuous）」补齐语料——base 提交上加 `goals/AC-901-*.md`（`goal: GOAL-901`，`phase: post-merge` 以免 `recordGoalMergeRequest` 的 pre-merge AC 闸拒绝）与 `tasks/TT-901.md`（`goal_ac: AC-901`），goal 分支上加逐字 subject `tasks: 翻 TT-901 done（driver 机械 fan-in）` 的翻转提交。Proposal 第 2 条只记到 `activatedAt:` 一处即可解除——补齐后实测：仅补 `activatedAt:` 会由 `merged=0` 的 exit 3 换成 `via=0` 的 exit 3（同码不同因），故语料一并补齐。
3. **live-web-address**：语料谓词 `criterion.includes("live-web-address.ts")` 是活的（收进一切调用该助手的判据），AC-904 增设后实得 18 ⇒ 计数 17→18（标题/断言/`codes.length` 同步）。夹具 HTTP server 对 `GET /doc` 追加 `<div id="doc-index">DOC-904</div>`（在 `<nav>` 之外，17 条的 nav/title 断言不受影响）使 real arm 可评估；mutant 拒绝词白名单补 AC-904 的措辞 `no live web address for`。

## Touches

- packages/quay/test/ac322-criterion-catchup.test.mjs
- plugin/test/worker-driver.test.mjs
- plugin/test/live-web-address.test.mjs
- tasks/gap-goal-criterion-rewrite-stale-test-fixtures.md