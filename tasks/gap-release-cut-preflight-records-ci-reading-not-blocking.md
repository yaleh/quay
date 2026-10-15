---
id: gap-release-cut-preflight-records-ci-reading-not-blocking
title: release-cut preflight 记录 develop 最后一次 decisive CI 读数（记录⛔不阻塞）：给 SPEC §4.2
  一个可区分产物，不新增发版禁令
status: ready
labels:
  - gap
  - release
parent: null
children: []
extra: {}
---
## Proposal

`SPEC-release-and-hotfix-branching-2026-09-15.md` §4.2「切点前置：develop 的上一次 decisive CI 必须是绿」**没有任何机械载体**：通读 `scripts/release-cut.mjs` 的 preflight，它只查 tag 不存在 / 版本一致 / 树干净 / develop 不落后 remote / `release.yml` 无漂移，**完全不读 CI**；`release-master-advance-needs-check.ts` 是 `needs:` 断言、`release-freshness-check.sh` 是新鲜度/漂移 —— 都不读 CI 绿。该条款原文的豁免是「**在 AC-265 达成之前**，本条只能记为『规程已定义、尚不可执行』」，而 `goals/AC-265-goal.md` 现为 `status: achieved` ⇒ **豁免已失效、前置在字面上是活的**，但它仍然只靠意志执行（硬规则 9：产物不可区分 ⇒ 守与不守同形）。

**本任务把它变成「记录，⛔ 不阻塞」——这是一条设计约束，不是措辞偏好：**
- 反例就在眼前：develop 的 CI 自 2026-10-10 起因**纯环境原因**红了 5 天（最后一次 decisive 绿 2026-10-10T03:04:40Z）。若把该前置做成**硬闸**，等于用一行代码把「环境抖一下 ⇒ 永不发版」制度化 —— 正是 §4.2 自己正文点名要避免的那种僵局（硬规则 12：每个前置单看都成立、合起来永远差最后一步）。§4.2 当初为 AC-265 开的那扇门，说明作者知道这条会死锁。
- 所以载体只做**可见性**：preflight 读一次 develop 的最后一次 decisive run，把读数写进**这次 cut 自己的**痕迹并打印出来 ⇒ 任何一次 cut 都带着它当时的 CI 读数、可事后查。
- 读数口径：carrier = `.quay/ci-runs.jsonl`；`branch=develop` ∧ `workflow ∈ {ci.yml, CI}` ∧ `conclusion ∈ {success, failure}`（`cancelled` 按设计排除，⛔ 不得把 cancelled 读成绿或红）。
- ⛔ 新记录**另起一个载体**（放在 `.quay/release-branch-finish.jsonl` 旁边），⛔ **不复用**它的 `form=` 词表（硬规则 8：不借用别的载体的词汇表来表达新语义）。

## Plan

1. 在 `scripts/release-cut.mjs` 的 preflight 里读 develop 的最后一次 decisive run（上面的口径），解析出 `{runId, conclusion, ts, url}`。
2. 把「本次 cut 时刻 develop 的 CI 读数」写进一个新载体（自己命名、自成词汇表），并在 preflight 的**输出里打印**该读数（人能看到）。
3. 三值读数：无记录 / 全是 cancelled / 读不出 ⇒ 显式记 `not-evaluated`（⛔ 不伪装成绿或红，硬规则 3b/6）。
4. ⛔ **不加闸**：CI 读数是红时 preflight 与 cut **照常继续**（本任务只增加可见性，不新增阻塞）。
5. 负控与 A/B：构造「最近一次是 failure」的形状确认记录与打印如实；构造「无 CI 行 / 全 cancelled」的形状确认记 not-evaluated；确认两种形状下 cut 都**不被阻塞**。

## AC

- [ ] AC1: 粘贴改动后的 preflight 代码片段：它从 `.quay/ci-runs.jsonl` 按 `branch=develop ∧ workflow∈{ci.yml,CI} ∧ conclusion∈{success,failure}` 取最后一次 decisive run，并说明 `cancelled` 为何被排除。
- [ ] AC2: 粘贴**新载体**的路径与一行真实记录（含 `runId` / `conclusion` / `ts` / `url` 与「tag 时刻」），并说明它为什么不复用 `.quay/release-branch-finish.jsonl` 的 `form=` 词表（硬规则 8）。
- [ ] AC3: 粘贴 preflight 输出里打印该读数的原文（人造一份「最近一次 = failure」的 ci-runs 形状跑一次即可）。
- [ ] AC4: 负控一：`.quay/ci-runs.jsonl` 缺失 / 只有 `cancelled` 行时，记录与打印必须是**显式 not-evaluated**（粘贴两侧读数），⛔ 不得写绿也不得写红。
- [ ] AC5: 负控二（本任务的核心约束）：CI 读数为 **failure** 时，preflight 与 release-cut **仍然继续**（粘贴「CI 红 ⇒ cut 照常推进到下一步」的原文读数）；并在代码注释里写明「为何是记录而不是闸」（指向 §4.2 豁免已随 AC-265 失效 + 硬规则 12 的死锁 + 5 天环境红史）。
- [ ] AC6: 既有 `plugin/test/release-cut.test.mjs` 不因本改动变红（粘贴该文件改动后的 `ℹ tests/pass/fail`）；新增判据（若有）**自证其红**：把 not-evaluated 臂写成绿时对应用例必须红（粘贴两次读数）。
- [ ] AC7: 改动只落在 release 相关文件（`git diff --name-only` 只有本任务 Touches 里的项）。

## DoD

- 落地后 develop 上**下一轮真实 CI run** 不因本改动新增失败项（粘贴 run id + 结论）。
- 下一次真实 cut（人裁定后）的痕迹里能看到该 CI 读数（粘贴那行；若在落地后的窗口内没有 cut，如实写明「尚无 cut 样本」并给出可查的载体路径）。
- ⛔ 明确不改：本任务**不得**让 CI 读数阻塞任何现有流程（这正是它的设计约束）。

## Touches

- scripts/release-cut.mjs
- plugin/test/release-cut.test.mjs
- tasks/gap-release-cut-preflight-records-ci-reading-not-blocking.md


ADR-007 逐里程碑暗轴记录（本任务的声明）
该轴仍暗,理由: 本任务只给 release-cut preflight 增加一次 CI 读数的记录与打印（记录⛔不阻塞），是可见性改动，不量架构面（依赖图 / 文档比 / 变异存活都没测），没有可解析的读数可贴。