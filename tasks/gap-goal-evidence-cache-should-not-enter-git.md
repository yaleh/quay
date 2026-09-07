---
id: gap-goal-evidence-cache-should-not-enter-git
title: evidence 是 gitignored 账本最后一行的缓存，却随记录进 git
  并旅行到别的克隆声称未做过的测量——按裁定「高频无语义价值的变更不进 git」移出
status: done
labels:
  - gap
  - defect
  - meta-driver
parent: null
children: []
extra: {}
---
## Finding

**人 2026-09-07 裁定（逐字）**：「**没有长期语义价值的高频变更应当避免进 git**。」

本条把该裁定落到 goal 记录上：`evidence: {at, verdict, reading}` **两个条件全中**——
- **高频**：每次 `goal-store gate` 都重写（goal driver 每约 42 秒一遍全部 AC；meta-driver 每轮 15 条）；
- **无长期语义价值**：它是 gitignored 的 `.quay/gate-events.jsonl`（`.gitignore:43`）**最后一行的缓存**——同一 gate 已经把 `{actor, verdict, timestamp, payload.reason}` 追加进那个账本，与记录里的 `{at, verdict, reading}` 一一对应。

而记录的其余部分（`id/title/criterion/origin/status/goal`）是**低频且耐久**的承诺面，必须留在 git。⇒ 二者混居在同一个被跟踪文件里，才是根。

**与上游的分工（⛔ 不重复，也不回退）**：`gap-goal-gate-timestamp-commit-flood` 解决的是「高频抖动**产生提交**」——它落地后，纯时间戳写入不再提交。**本条解决它管不到的残留**：evidence 仍会在真实状态变更时**搭车进 git**，而一旦进了 git 就会——

**随 git 旅行到别的克隆/检出，在那台机器上声称一次它从未做过的测量。** 今天一个新克隆会继承别人最后一次提交的 verdict 与时刻，UI 与 staleness 都会照此显示；那是**假读数**，且与「这台机器没测过」不可区分。移出后新克隆诚实地报「未测量」——硬规则⑥：**缺值 = 未查，不是为假**。⇒ 这是正确性问题，与频率无关，所以上游修完它依然在。

**两个真实消费者（已查证，不是推测）**：
1. `packages/quay/src/goal-store.ts:32-34` —— `lastProgressAt` = 其 AC 的 `evidence.at` 最大值（DERIVED never stored），用于 staleness；零 AC 或无 `evidence.at` ⇒ notEvaluated。
2. `packages/quay/src/serve-goal.ts:12-16 / :128-135` —— web UI 渲染「最近 verdict 与时刻」。

两者都能改读 `.quay/gate-events.jsonl` 中该 AC 的最后一条，**顺带拿到历史**（今天只有最后一次）。

**⛔ 明确排除的做法**：
- **不 gitignore 整个 `goals/`**。那会丢掉 `status`/`criterion`/`origin` 这些承诺面，且让 `gap-meta-goalstoreargv` / `gap-meta-commitgoalfile`（均 done）修好的「未跟踪 goals/*.md 阻塞 develop→doc ff-only 同步」**复发**。
- **不回退写盘即提交**：`status` 的 `active→achieved` 翻转是耐久信息，仍须提交。

## AC

- [x] `goals/*.md` 不再写入 `evidence` 字段：跑一次 `goal-store gate <任一 AC>` 后，该文件内容**逐字节不变**（⛔ 判据须比对文件内容，不是 grep 是否含 `evidence:`）。立条时实测该操作必改 `at:` 一行（能取假）。
- [x] 「最近 verdict 与时刻」仍可得，且来源是账本：`serve-goal` 渲染的 evidence 单元与 `goal-store` 的 `lastProgressAt` 对同一 AC 给出的时刻，等于 `.quay/gate-events.jsonl` 中该 AC 最后一条的 `timestamp`。
- [x] 新检出诚实（负控制，本条是裁定的核心）：在一个**没有** `.quay/gate-events.jsonl` 的检出里，staleness 报 `notEvaluated`、UI 显示「—」；⛔ 不得显示任何继承自 git 的读数。
- [x] 跑一次 gate 之后两个消费者立刻反映新 verdict（证明改读账本没有引入滞后）。

## DoD

- [x] 上述判据本轮实跑并贴出输出，⛔ 不是转述。
- [x] ⛔ 未 gitignore `goals/`；⛔ 未回退 `commitGoalFileAfterWrite` 对 status 变更的提交。
- [x] 迁移可核对：改动落地后 `git log --oneline -- goals/` 的新增提交，逐条都对应一次真实的 status/criterion/origin 变更（⛔ 不含纯 evidence 提交）。

## Evidence

本轮实跑（worktree `task/gap-goal-evidence-cache-should-not-enter-git` @ c6289393b）：

- `node --experimental-strip-types --test packages/quay/test/goal-store.test.mjs` → **33 pass / 0 fail**（含本条 4 条 AC：逐字节不变 / lastProgressAt=账本 ts / 无账本⇒notEvaluated / flip 立刻反映）。
- `node --experimental-strip-types --test packages/quay/test/serve-goal-doc.test.mjs` → **11 pass / 0 fail**（AC2 来源=账本 ts、AC3 无账本⇒「—」且不渲染 `2020-01-01` stale 读数）。
- `node --experimental-strip-types --test plugin/test/goal-driver.test.mjs` → **9 pass / 0 fail**（evidence 不回写断言）。
- `git diff develop..HEAD -- .gitignore` → 空（未 gitignore goals/）；本分支 `git log --oneline develop..HEAD -- goals/` → 空（未产生任何 goals/*.md 提交）。

## Touches

- `packages/quay/src/goal-store.ts`
- `packages/quay/src/serve-goal.ts`
- `packages/quay/test/goal-store.test.mjs`
- `packages/quay/test/serve-goal-doc.test.mjs`
- `plugin/scripts/goal-driver.ts`
- `plugin/test/goal-driver.test.mjs`
- `tasks/gap-goal-evidence-cache-should-not-enter-git.md`
