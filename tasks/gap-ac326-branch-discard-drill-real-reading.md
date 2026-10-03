---
id: gap-ac326-branch-discard-drill-real-reading
title: AC-326 停在 exit 3：机制已落地但 goal 分支的丢弃路径从未在生产上跑过——在真实 store 上执行 GOAL-028
  退出条件② 的废弃演练（draft+branch:true → active 懒建 goal/GOAL-901 → retired 记 tip +
  删分支），并新增逐字绑定该判据的三态夹具
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-326
---
## Proposal

**判据为什么仍为假（立案轮直接量，2026-10-03，主检出 `/data/home/yale/work/quay`）**

```
$ node packages/quay/bin/quay.js goal gate AC-326 --dry-run --json
⇒ {"verdict":"not-evaluated","cause":"declared",
    "reason":"... acceptance failed (exit 3) — NOT-EVALUATED: no branch-mode goal has been retired or superseded yet"}
$ grep -l '^branch: true' goals/*.md        # 0 个文件
```

判据的 exit 0 要求**至少一个** `branch: true` 且 status ∈ {retired, superseded} 的 goal：其 `goal/<id>` 分支不存在，且 statusLog 中进入该状态的条目带一个提交 SHA。今天 store 里**连一个 branch-mode goal 都没有**，所以判据只能诚实地停在 exit 3（`goals/GOAL-028-*.md` §退出条件 也写明：第一个试点 goal 跑起来前读 exit 3 是正确输出）。

**上一个 done 任务做了什么、没做什么**

<!-- dedup-ref -->
相近但机制不同的任务（traceability，⛔ 不是本任务的前置）：`gap-goal-branch-data-model-and-lifecycle`（done）交付了 `branch` 字段与 `goal/<id>` 的懒建/丢弃机制（`branch-model.ts` 的 `ensureGoalBranch`/`discardGoalBranch`，`goal-store.ts` 的三个调用点），并用单测覆盖；`gap-goal-active-ac-gap-classification-ignores-round-verdict`（ready）处理的是 driver 把「自陈无法评估」的 AC 误判成 workable 而每轮空转 spawn 的那一层。两者都不是本任务要做的事。

前者的第 6 条 AC **只要求**「对真实仓库跑 AC-326 判据，verdict 为 not-evaluated」，其 `## DoD` 把生产读数显式推给「一次真实的废弃演练」（GOAL-028 退出条件②）——**那次演练从未发生**。于是机制在、单测绿、判据仍 exit 3：这正是硬规则 4 推论三说的「实现落地、测试绿了、但生产没跑过」。本任务把那次演练真跑一遍。

**本任务做什么**

① **在真实 goal store（主检出根）上跑一次完整的丢弃路径**，全程只用 store 自己的 CLI（被演练的就是这条机制，⛔ 不许手改 `goals/*.md`）。配方已在一次性临时仓库（`/tmp` 下 `git init -b develop` + `goals/`）上端到端实跑验证过，判据读 `PASS: 1 abandoned branch-mode goal(s): branch gone, discarded tip recorded`（exit 0）：

```sh
R=/data/home/yale/work/quay            # ⛔ 必须是主检出：判据读的是【这个根的工作树】的 goals/*.md
# 1) AC 先写（store 拒绝 0 AC 的 draft/active GOAL；P6-goal）——保持 draft，⛔ 永不激活
node packages/quay/bin/quay.js goal write AC-901 --store --root $R \
  --goal GOAL-901 --status draft \
  --criterion '<一条真能跑、且可为假的判据：检查 GOAL-901 已 retired、statusLog 有 40 位 tip SHA、goal/GOAL-901 已不存在；不可评估时 exit 3>' \
  --expect '<逐字写清 exit 0/1/3 各代表什么>' --origin 'GOAL-028 退出条件② 废弃演练（AC-326 生产读数）'
# 2) goal draft + branch:true —— 此步【不】建分支（懒创建是设计）
node packages/quay/bin/quay.js goal write GOAL-901 --store --root $R \
  --title 'AC-326 废弃演练（drill）：只用于跑一次 goal 分支丢弃路径，⛔ 不是真实开发方向' \
  --status draft --branch true --body '<≥40 非空白字符：背景/范围与非目标/退出条件>'
# 3) active ⇒ store 从【当时的 develop tip】建出 goal/GOAL-901 —— 立刻记下它
node packages/quay/bin/quay.js goal write GOAL-901 --store --root $R --status active --reason '...'
git -C $R rev-parse goal/GOAL-901          # ← AC1① 要的就是这一行
# 4) retired ⇒ tip SHA 写进 statusLog 的 `to: retired` 条目，随后分支被删除
node packages/quay/bin/quay.js goal write GOAL-901 --store --root $R --status retired --reason '...'
node packages/quay/bin/quay.js goal write AC-901 --store --root $R --status retired --reason '...'
# 5) 读数（dry-run 不写台账；driver 下一轮自己会判并落账）
node packages/quay/bin/quay.js goal gate AC-326 --dry-run --json --root $R
```

② **新增一个逐字绑定该判据的夹具**（`packages/quay/test/ac326-criterion-branch-discard.test.mjs`）：从 `goals/AC-326-*.md` **提取判据原文**（⛔ 不是抄一份进测试），在临时 git 仓库里用 `/bin/sh` 跑它，覆盖三态与两种违反——「无 branch-mode goal ⇒ exit 3」「branch-mode goal 仍 active（分支在）⇒ exit 3」「经真实 store 走完 retired（分支已删、SHA 已记）⇒ exit 0」「分支仍在 ⇒ exit 1 且 `CAUSE=abandoned-goal-branch-still-exists`」「retired 但 statusLog 无 SHA ⇒ exit 1 且 `CAUSE=discarded-tip-not-recorded`」。`branch-model.test.mjs` 测的是 store 的行为，本夹具测的是**判据文本本身**——没有任何现存用例在跑这段判据（上一次任务只在真仓库上读了 exit 3）。

**⛔ 边界**：本任务不新增任何 `goal/*` 分支残留、不改任何其它 goal/task、不新增代码路径；演练 goal 必须在 title/origin 里自陈是 AC-326 的废弃演练。**若执行时发现 store 里已存在 branch-mode goal**（例如人已开始 GOAL-028 退出条件① 的试点），⛔ 不得再造第二个演练 goal：转为 `needs-human` 并写清现场。演练期间 active GOAL 数会短暂变成 4（本工作区 `cap: 5`，`.quay/config.yml` 的 `gates`/`goal` 段）；若步骤 3 因 cap 被拒，⛔ 不得改配置绕过——转 `needs-human` 并贴出拒绝原文。

**⚠️ 记录在案的取舍**：GOAL-028 把这次演练写作「人的动作」。本题让 worker 执行它，理由是演练的每一步都机械可核（AC1–AC4 全是载体读数），而把判据停在 exit 3 直到某次真实放弃，正是 sibling 任务诊断的「每轮空转 spawn」。若人认为废弃演练必须由人亲自做，本题应被 superseded 而非照做——那时判据仍停在 exit 3，且读数仍是真的。

## AC

- [ ] **AC1（丢弃路径在生产上真跑过：分支真的建过、又真的没了）**：贴出三条互不可省的读数——① 步骤 3 当时 `git -C /data/home/yale/work/quay rev-parse goal/GOAL-901` 的 40 位 SHA；② 收尾 `git -C /data/home/yale/work/quay rev-parse -q --verify refs/heads/goal/GOAL-901` 无输出（exit ≠ 0）；③ `git -C /data/home/yale/work/quay branch --list 'goal/*'` 输出为空。①证明建过，②③证明删了。
- [ ] **AC2（rescue handle 落在生产载体上，⛔ 手工编辑不算）**：`goals/GOAL-901-*.md` 的 frontmatter 有独立一行 `branch: true`、`status: retired`，且 statusLog 中 `to: retired` 那一条的 reason 里的 SHA 与 AC1① **逐字相同**；贴出该文件全文与该 statusLog 块的逐字文本。⛔ 未经 `quay goal write` 落库（手工 Edit / Python 插入）不算。
- [ ] **AC3（判据取到真实 exit 0）**：`node packages/quay/bin/quay.js goal gate AC-326 --dry-run --json --root /data/home/yale/work/quay` ⇒ `"verdict":"pass"`、`"cause":null`；贴原始 JSON 与紧随其后的 `echo $?`。（`--dry-run` 不写 GateEvent——本任务只要读数，台账由 driver 的下一轮自己写。）
- [ ] **AC4（取假：exit 0 必须来自「废弃 + 记 SHA + 删分支」，不是来自「多了一个 GOAL 文件」）**：在步骤 3 之后、步骤 4 之前（goal 已 active、`goal/GOAL-901` 已存在、尚未 retired）跑同一条判据 ⇒ 读数必须**不是** pass（预期 `not-evaluated`，因为尚无 retired 的 branch-mode goal）；贴那一刻的原始 JSON。⚠️ 若此时已经 pass，说明判据读的不是本演练的状态：**停下来报 needs-human**，⛔ 不得继续。
- [ ] **AC5（绑定判据的夹具：三态 + 两种违反，且非空转）**：新增 `packages/quay/test/ac326-criterion-branch-discard.test.mjs`——判据文本从 `goals/AC-326-*.md` 运行时提取（⛔ 不是抄本），在临时 git 仓库上以 `/bin/sh` 执行；`node --test packages/quay/test/ac326-criterion-branch-discard.test.mjs` 全绿，且五条断言逐条可核：无 branch-mode goal ⇒ `code 3`；branch-mode goal 仍 active ⇒ `code 3`；经真实 store retired ⇒ `code 0`；分支仍在而 goal retired ⇒ `code 1` 且 stderr 含 `CAUSE=abandoned-goal-branch-still-exists`；retired 但 statusLog 无 SHA ⇒ `code 1` 且含 `CAUSE=discarded-tip-not-recorded`。另贴一条**强度证据**：用 `cp` 备份把被判据覆盖的那一步（删分支，或写 statusLog）临时回退（⛔ 不用 `git checkout --`）后，至少一条断言转红，恢复后回绿。
- [ ] **AC6（scoped 门绿且非 thin）**：`bash scripts/test.sh --for-task gap-ac326-branch-discard-drill-real-reading` 退出 0，且确实执行了 ≥1 个测试文件；在 `## Evidence` 贴出被执行的测试文件名。
- [ ] **AC7（无残留、不越权）**：贴 `git -C /data/home/yale/work/quay status --porcelain goals/`（只应出现本题新增的 `GOAL-901-*.md` / `AC-901-*.md`）、`git -C /data/home/yale/work/quay status --porcelain tasks/ | grep -v gap-ac326` 为空、`git -C /data/home/yale/work/quay branch --list 'goal/*'` 为空；并逐条说明**没有**改动任何其它 goal 记录或 task 文件。

## DoD

**REAL LANDING 判据（DIR-026 Reading A）**：不是「判据文本改了」「dry-run 绿了」「夹具自造一个 goal 就算数」，而是**主检出上的 AC-326 判据读到了由真实机制产生的 exit 0**：

1. **落地对象**：`goals/GOAL-901-*.md` 是一次真实丢弃的产物——分支 `goal/GOAL-901` 确实从 develop tip 建过（AC1① 有 SHA），retired 后确实不存在（AC1②③），其 tip SHA 逐字留在 statusLog（AC2）。三条读数任一缺失 ⇒ 未落地。
2. **判据读数**：AC-326 判据在主检出上读 exit 0 / `verdict: pass`（AC3），且同一判据在「已建分支但未 retired」时**不**为 pass（AC4）——两个方向都有读数，证明 exit 0 来自废弃动作本身。
3. **判据不再无人看守**：绑定判据原文的夹具落地（AC5），把「三态 + 两种违反」钉住——此后判据文本或其依赖的 store 行为回退，夹具会红，⛔ 不再出现「机制回退而判据静默停在 exit 3 无人发现」。
4. **不留脏状态**：演练不留下任何 `goal/*` 分支，不改动除新增两条记录外的任何 goal/task（AC7）。

## Touches

- `packages/quay/test/ac326-criterion-branch-discard.test.mjs` (new)
- `goals/AC-901-*.md` (new)
- `goals/GOAL-901-*.md` (new)
- `tasks/gap-ac326-branch-discard-drill-real-reading.md`

（说明：前两条 `(new)` 是演练要写的两条 store 记录——经 `quay goal write --store --root /data/home/yale/work/quay` 落在主检出，再按仓库既有做法把同一份字节带进本任务 worktree，使它们进入本分支的 delta；第三条是绑定判据的夹具；最后一条是 self-touch。⛔ 不改 `packages/quay/src/**`、⛔ 不改任何 `plugin/scripts/**`、⛔ 不改任何既有 goal 记录。）