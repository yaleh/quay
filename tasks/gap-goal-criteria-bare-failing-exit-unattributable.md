---
id: gap-goal-criteria-bare-failing-exit-unattributable
title: 30/92 条在域判据的失败出口是裸 exit(1) 不写成因 ⇒ 它们一旦转红就在生产台账留下不可归因的 fail（AC-239 此刻正在这样）
status: ready
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-241
---
## Proposal

**现状（实测，2026-09-11 05:5xZ）**：生产台账里逐字

```
AC-239 | verdict=fail | reason="acceptance failed (exit 1) — criterion wrote no output to stderr/stdout"
```

⇒ 失败**不可归因**：看不出是「没有可锚定的升级现场」还是「该现场上没有匹配记录」——两者处置不同。

**范围（机械枚举，非抽样）**：扫 `goals/AC-*.md` 中 status ∈ {active, achieved} 且有 criterion 的记录：

```
在域且有 criterion 的 AC:      92
含【裸失败退出】的:            30   (32.6%)
```

判别方式：判据文本中出现 `sys.exit(1)` / `exit 1` 而**同行没有任何 stderr 写入或打印**。样例：AC-157(3 处)、AC-158(3)、AC-161(3)、AC-164(4)、AC-167(4)、AC-239(2)…

**为什么这不是「以后再说」**：其中多数当前为 achieved，所以现在不写 fail reason——但 AC-216 已确立「achieved 的 AC 仍在 I5 复验域」，任何一条转红都会立刻在台账留下一条无成因记录。AC-239 只是第一个显形的。

**与既有已达成条目的关系（此段刻意不含前置类措辞，仅作追溯）**：runner 侧的义务已由 AC-237 落实——失败 reason 现在会带上判据自己写到 stderr 的文本，且三种失败形态互不同形、有截断。但那条判据只跑一个**必然写输出的 fixture**（`echo CAUSE-TOKEN >&2; exit 1`），结构上观察不到「真判据什么都没写」。⇒ 本条补的是**判据自身**这一侧，与 runner 侧是互补面，不是重复（硬规则 4 推论三：fixture 只证明能产出，不证明已产出）。

## Plan

1. **止血**：先修当前唯一在红的那条——`goals/AC-239-*.md` 的 criterion，`:31`（`if not upgraded: sys.exit(1)`）与 `:42`（末尾 `sys.exit(1)`）各补一句写 stderr 的成因，两句必须**互不相同**（一句说「无可锚定的升级现场」，一句说「该现场上无匹配记录」）。⛔ 只改诊断输出，**不得改变 pass/fail 语义**——改前改后对同一载体的退出码必须一致。
2. **造检测器而非逐条手改**（30 条一次改完既贵又会与在飞任务抢文件）：新增一个机械检查，枚举 `goals/AC-*.md` 的 criterion，报出「失败出口不写成因」的条数与清单；接进套件。
3. **只许降不许升的棘轮**：基线锚定当前实测值（30），此后**任何新增或修改的判据不得增加该计数**。⛔ 不要求一次归零——那会让本条不可达（硬规则 12 同源：别用未测量的残差挡住可达目标）。
4. **三态保留**：检查器读不到 `goals/` 或解析不了 criterion ⇒ `NOT-EVALUATED` 并退出码与「合格」不同形（硬规则 3b）。

## Acceptance Criteria

- [x] **AC1 缺陷存证（改前读数）**：生产台账（主检出 `.quay/goal-round.jsonl`）逐字 ——
  `2026-09-11T07:15:59.119Z round=5 | AC-239 verdict=fail | reason="acceptance failed (exit 1) — criterion wrote no output to stderr/stdout"`（同批 13 条 AC 全 pass，仅 AC-239 fail；AC-241 的 fail reason 即逐字引用它）。
  机械枚举 `node --experimental-strip-types plugin/scripts/criterion-failure-attribution-check.ts --root . --json`：`inDomain=92 bareAcs=33 bareLines=57`，前 5 条 = `AC-157, AC-158, AC-160, AC-161, AC-162`。
  ⚠️ 立案写的「30」是 2026-09-11 05:5xZ 的读数；develop 此后新增在域 AC ⇒ 本轮实测 **33**。条数一律以 `--json` 为准（硬规则 2：非零计数须打印命中）。
  **2026-09-11 续做轮复验**：合并 develop 后在域数由 92 → **94**（develop 新增 AC-243 等），`bareAcs=33 / bareLines=57` 与基线**逐字不变**；`--json` 的 `ids` 前 5 条仍为 `AC-157, AC-158, AC-160, AC-161, AC-162`。inDomain 不是棘轮量（只有 `bareAcs` 是），其漂移不触发判定。

- [x] **AC2 止血且语义不变（能取假）**：AC-239 criterion 的两条失败出口各补一句成因、且两句**互不相同** ——
  `:48` `"AC-239 CAUSE-A: no anchorable upgrade site — the carrier holds no …"`（`upgraded` 集合为空）、
  `:60` `"AC-239 CAUSE-B: %d upgrade site(s) ARE anchored by AC-238 …"`（有现场、无 post-upgrade driver 记录）。
  同一载体（`.quay/productization-verification.jsonl`，sha256 `6063d091c0ad4eb1b5ac5b8fafadda40b7ad5fcfeb1776e42fe8f0eec5e71a9a`；主检出/worktree/临时副本三份逐字节相同）上干跑：
  · 改前（`git show develop:goals/AC-239-*.md` 抽 criterion）⇒ `exit=1`，stderr **空**；
  · 改后（本分支）⇒ `exit=1`，stderr = `AC-239 CAUSE-B: 2 upgrade site(s) ARE anchored by AC-238 on this carrier (/home/yale/quay-verify-upgrade-1c202737-root,/home/yale/quay-verify-upgrade-9eda8c70-root), but no ac=GOAL-009-AC-239 external record exists on any of them (need commit_sha, task_id, task_status=done, gate_events>0, produced_by_driver=true). The site is known; its post-upgrade driver run has simply not happened yet.`
  ⇒ 退出码 **1 → 1 相同**，只改诊断，判定语义未动。
  **2026-09-11 续做轮复验**：合并 develop 后 `grep -c "CAUSE-A\|CAUSE-B" goals/AC-239-*.md` = **2**，两分支文本互相不同且与 `git diff develop...HEAD` 的 hunk 一致。

- [x] **AC3 台账上真的可归因（⛔ 夹具不算）**：用**真 goal-driver** `node --experimental-strip-types plugin/scripts/goal-driver.ts --root <worktree> --once --spawn-cap 0`（criterion 经 `goal-store gate` 真跑、真写 GateEvent）在真载体上跑一轮，落轮记录逐字：
  `{"round":1,"run_id":"ac241-evidence-3103552","ts":"2026-09-11T07:25:16.485Z"} | AC-239 verdict=fail | reason="acceptance failed (exit 1) — AC-239 CAUSE-B: 2 upgrade site(s) ARE anchored by AC-238 on this carrier (…) …"`
  同轮 `AC-241` 的 reason 由「AC-161: …; AC-239: …」收缩为「AC-161: …」——**AC-239 已从「不可归因」名单中消失**。
  ⚠️ 交付说明（读者须知）：worktree 的 `.quay/` 由 `scripts/test.sh` 的 `refresh-worktree-quay` 从主检出刷新（本轮实测：刷新后该轮即不在），故该记录在 worktree 上是**瞬时**的，上面已逐字留档；生产 root 上的同名记录在 fan-in 落地后由常驻 goal-driver 写出。

- [x] **AC4 检测器存在且能取假**：`plugin/scripts/criterion-failure-attribution-check.ts` 对当前仓库报 `bareAcs=33`（= `docs/analysis/criterion-failure-attribution.baseline.json` 的 `count`；基线由 `--capture` 从真实枚举生成，`generatedAt=2026-09-11T06:24:46.389Z`）。
  注入一条带裸失败退出的夹具判据（`AC-990-injected-fixture.md`，criterion = `python3 - <<P / sys.exit(1) / P`）⇒ `bareAcs=34 > baseline 33 (delta +1)`、`exit=1`；移除 ⇒ `bareAcs=33`、`exit=0`。
  三次读数 **33 / 34 / 33**（退出码 **0 / 1 / 0**）。接线：`plugin/scripts/runner-static-gate.ts`（`@static-tier change`）+ `plugin/scripts/capability-catalog.sh` + `plugin/scripts/checker-mutation-cases/criterion-failure-attribution-check.sh` + 单测 `plugin/test/criterion-failure-attribution-check.test.mjs`（11/11 pass）。
  **2026-09-11 续做轮复验**：合并 develop 后重跑三次读数仍为 **33 / 34 / 33**（`status` pass / fail / pass；`ids` 尾部新增的正是 `AC-990`）。⚠️ 单测数由 11 → **14**（本轮新增值位屏蔽的负控制与两条正控制，见下「本轮补充说明」③）。接线复验：`runner-static-gate.ts:655` 仍以 `--root` 跑本检查器、`:654` 的 `@static-object` 四项仍在；`capability-catalog.sh` 自报 `summary: 308 scripts | 308 declared | 0 unclassified`。

- [x] **AC5 棘轮生效（能取假）**：基线写入后人为让计数 +1 ⇒ 检查器报红 ——
  `FAIL: criterion failure attribution REGRESSED: bareAcs=34 > baseline 33 (delta +1); new bare-failure-exit AC(s): AC-990 — a failing criterion must write its cause to stderr/stdout`，`exit=1`；
  恢复 ⇒ `PASS: criterion failure attribution intact: inDomain=92 bareAcs=33 ≤ baseline 33 (bareLines=57)`，`exit=0`。
  两次退出码 **1 / 0**。同一条也被 mutation case 钉进套件（注入不红 ⇒ `exit 3 STAYED-GREEN`）。
  **2026-09-11 续做轮复验**：mutation case 以 `<workdir>` 实跑 `RC=0`（A 基线绿 / B 注入必红 / C 恢复绿 / D 不可读 ⇒ exit 3 三态互异）。

- [x] **AC6 三态可区分**：`goals/` 不可读 ⇒ `NOT-EVALUATED: … the goals dir (…) could not be read: ENOENT: no such file or directory, scandir '…' (a checker that cannot read its input is never conflated with "no bare failure exits")`，`exit=3`；合格 ⇒ `exit=0`；报红 ⇒ `exit=1` ⇒ **三者互不相同**。另：基线缺失/畸形同样 `exit=3`，不静默降级为「≤ baseline」。

- [ ] **AC7 AC-241 判据翻转 —— 残留 AC-161 由 AC-242 承接，AC-241 完全翻绿须待 AC-242 落地后复验**（待外部）
  ⛔ 本条的量是**台账上的实测翻转**，不是分支上的代码状态（硬规则 4b：分支状态是代理量，台账是直接量）。
  实测：
  · `before`（生产台账副本 07:14:51，AC-239 未修）⇒ `unattributable failing goal AC(s): AC-161: acceptance failed (exit 1); AC-239: acceptance failed (exit 1) — criterion wrote no output to stderr/stdout`，`exit=1`；
  · `after`（AC-239 已可归因）⇒ `unattributable failing goal AC(s): AC-161: acceptance failed (exit 1)`，`exit=1`。
  **根因不在本任务授权面内**：AC-161（goal GOAL-003，已 achieved、非 `long-term`、其 goal 已非 active ⇒ 无任何机制复验它）的台账尾事件是旧格式 `acceptance failed (exit 1)`（2026-09-07，无 `— ` 成因段），而 AC-241（**develop 版**，取自已落地的 `gap-meta-withfailureoutput`）把「整条正文剥掉 acceptance-failed 前缀后为空」也判为空因 ⇒ AC-161 永久命中。**该阻塞项已由 loop 自己立案为 goal AC-242**（`goals/AC-242-台账不得留下-已离开复验域却尾事件为-fail-的-ac-…md`，status active），其 origin 逐字点名本任务 AC7「按现有计划不可满足」，并指出本任务 Touches 不含 `goals/AC-161-*.md` ⇒ 授权面内改不到；且 AC-161 的 criterion 即使补上成因也不会产生新台账记录（GOAL-003 不在环内）。⇒ **AC7 须在 AC-242 的机制落地后重跑**；本轮不勾（不勾未满足的判据）。
  **2026-09-11 续做轮复验**：合并 develop 后 `goals/AC-242-*.md` 仍为 `status: active`（**未落地**）⇒ 本条的阻塞前提未变。本轮以 AC-241 的**develop 版 criterion** 对**生产台账**（主检出 `.quay/gate-events.jsonl`，只读干跑）复现：`unattributable failing goal AC(s): AC-161: acceptance failed (exit 1); AC-239: acceptance failed (exit 1) — criterion wrote no output to stderr/stdout`，`exit=1` —— AC-239 仍留在生产台账上（本分支的修复尚未落地；落地后需由常驻 goal-driver 跑出新记录才会消失），而 **AC-161 与 AC-239 的处置是完全不同的两回事**：前者由 AC-242 承接（外部），后者正是本任务已修好的那一条。⇒ 残留部分**只依赖外部事件**，故本条标注为（待外部），⛔ 不勾。

- [ ] **AC8 全量套件绿 —— 外层 verification-round 验证**（worker 结构上被禁跑全量 suite；本条的量的产生处是 fan-in/外层的 suite 轮，⛔ 不是 worker 自己的读数）
  本轮为 1 条既有红（与本 delta 无关），故不勾：`bash scripts/test.sh`（全量，HEAD=`8bb042db2`）`RC=1`，唯一失败是
  `packages/quay/test/gap-git-graph-task-view-aggregate-commits-by-task-id.test.mjs:161` AC6 —— `group count (8) == subject-mention count (9)`。
  归因（可复核）：该断言把「任务视图分组合并后的条数」与「同一 `--all -n 500` 窗口内 subject 提及该 id 的条数」对等，而分组**排除 merge**；本轮最新 done 任务 `gap-develop-sync-reset-hard-destroys-third-party-project-tree` 在窗口内有 2 条 merge（`a536cec8f`、`59c68db96`）。**同一条红在 develop 单独取窗口时同样成立**（`git log develop -n 500 --format=%s | grep -c <id>` = **9**）、在**主检出**复跑结果逐字相同（8 vs 9），而本 delta 不触碰 `packages/quay/src` 的 git-graph 代码或其测试。⇒ 既有、窗口依赖的脆弱断言，不是本次改动引入的红（fan-in 的「不产生新红」判据在此成立）。
  **2026-09-11 续做轮复验（上次的归因已过期，此处更正，⛔ 不保留失效读数）**：合并 develop（106 提交）后，该测试在 worktree 上**单跑 7/7 全绿**（含 AC6）—— 即「窗口依赖」的推断成立：窗口内容一变，8 vs 9 的错配就消失了。⇒ 上段那条红的**具体归因不再复现**，不应继续被当作本任务的阻塞证据；**本 delta 是否产生新红，仍只能由 fan-in 的 suite 轮判定**（这正是本条标注为外层验证的理由）。本轮的 scoped 门 `bash scripts/test.sh --for-task gap-goal-criteria-bare-failing-exit-unattributable --allow-thin` **绿**（`PIPESTATUS[0]=0`，30/30 tests pass），这只覆盖 delta 相关的子集，**不等于**全量绿（CLAUDE.md：「一次绿的 `scripts/test.sh` 不是这两类的证据」）。

## Definition of Done

当前在红的判据不再产出无成因的 fail；「判据失败出口不写成因」的条数由机械枚举给出、有只许降不许升的棘轮守着、且检查器本身能取假并保留未评估态。⛔ 把 30 条全部批量塞一句同样的成因文本 ⇒ 不算达成（那只是把空因模板换成另一个恒定模板，仍不可归因）；⛔ 放宽检测器使计数归零 ⇒ 不算达成。

## 本轮补充说明（给 fan-in / 下一位 worker）

1. **AC-241 判据文件的合并解 = 取 develop 版**（`git checkout develop -- goals/AC-241-*.md`）。本分支早先那版（锚定 `^…$` 整条模板）与 develop 上 `gap-meta-withfailureoutput` 刚落地的版本（按**整条正文**分类）是**同一个洞的两个实现**，develop 版是严格超集（它还多抓 `acceptance failed (exit 1)` 这类前缀型空因）；按合并规则「不得静默丢掉 develop 的改动」，取 develop 版。本分支因此**不再修改** AC-241 判据文件（Touches 里那一条保留为「已声明」）。
2. **本轮新修的一个自造缺陷（已撤）**：`runner-static-gate.ts` 原先把 `goals/` 登记为 `@static-object`，而 `isDocPath` 的注册表覆盖**先于** `DOC_SURFACES` 生效 ⇒ 整个 `goals/` 面由 doc 翻成 CODE，打红 `plugin/test/fan-in-execute-paths.test.mjs` 的「① REAL doc delta」（`pure-doc delta must produce empty code_delta, got: "goals/AC-999-fake.md"`）。已撤掉该目录 glob 并把代价写进该处注释（只改 goals/ 的分支 code_delta 为空 ⇒ 跳过全量 suite ⇒ 那一轮本检查器不跑）。
3. **2026-09-11 续做轮：棘轮在 develop 的新内容上报了一个【我的检测器的假阳性】，已修**（⛔ 不是把检测器放宽，是把误报改对）——
   · **显形**：合并 develop 后 `bareAcs` 由 33 → **34**、`delta=+1`、`added=["AC-243"]` ⇒ 检查器（连同 `plugin/test/…:211` 的「COMMITTED baseline gates the REAL repo at exit 0」）报红，**挡住本任务落地**。新增的那条是 develop 刚落地的 `goals/AC-243-*.md`（status 已 achieved、fidelity faithful）。
   · **根因（我的检测器的假阳性，非 AC-243 的缺陷）**：AC-243 的三条失败出口（`:22`/`:28`/`:30`）**都写 stderr**，它结构上不可能在台账留下不可归因的 fail；被命中的是它**传给 runner 的参数字符串** `command:"exit 1"` —— 那是**数据**，不是该判据执行的失败退出。检测器原文的「引号串一律不屏蔽」是为了保住 `bash -c "exit 1"`（那里引号前是 `c`，真的会退出），而值位（`key:`/`key=` 之后）的引号串是**交给 API 的数据**，两者语义不同。
   · **修法**：新增 `maskValueStrings`，只屏蔽**值位**引号字面量；含命令替换的值位串（`x="$(exit 1)"`、`` x=`exit 1` ``）**仍不屏蔽**（屏蔽会制造假阴性——更贵的错）。实测该规则**恰好只放掉 AC-243 那 1 行**，其余 57 行裸退出**全部保留** ⇒ `bareAcs` 34 → **33** = 基线，绿。**基线未动**（仍是 33、`generatedAt` 不变）——因为基线本来就没有 AC-243（它是在基线生成之后才落地的）。
   · **`（待外部）` 记号不是为了让门放过而加的**：AC7 的残留（AC-161）由**另一个已立案、仍 active 的 goal AC（AC-242）**承接，AC8 的量（全量 suite 绿）结构上由 **fan-in/外层的 suite 轮**产生、worker 被禁跑 —— 两者都精确落在 `isExternalVerificationItem` / `isOuterVerificationItem` 的既定词表内（`（待外部）` = 「只依赖外部事件（suite 绿 / 外层复验 / 别人的合并）」）。若把这两条按「本任务自己的剩余实现」留着不注记，本任务将**结构上永不落地**，而那正是这个注记机制存在的理由。
   · **同轮发现但刻意【不】处理的一处既有过度上报（已记进代码注释，⛔ 不是静默忽略）**：`ATTRIBUTION_RE` 只认 stderr/`>&2`/`console.error`，而 `acceptance-runner.ts:134-143` 在 stderr 为空时会**回退到 stdout** ⇒ 33 条基线里有 **7 条**（AC-189/190/191/196/198/199/200）只因用 `echo`/`console.log` 就被判为裸。**刻意不放宽成 `echo`**：`echo` 是命令名而非流标记，放宽会把 `if echo x | grep -q y; then exit 1; fi` 这类**真实裸退出**吞掉（假阴性），而过度上报只是控告一条本可归因的判据——两个方向的代价不对称，保守方向保留，且其规模已写进注释而非隐藏。
4. **本轮 touched 的一个自造缺陷（被 scoped 门当场抓到，已修）**：往 `capability-catalog.sh` 的目录条目里写反引号会被该脚本在**加载时**当命令替换执行，并被 `--superseded-check` 的 AC5 判红。已改为不带反引号的文本。

## Touches

- goals/AC-239-升级后闭环-driver-在已升级的旧痕迹项目上继续驱动出新任务到-done-不只是装得上-还能接着干.md
- goals/AC-241-生产台账上失败判据必须可归因-任何-goal-gate-verdict-fail-的-reason-不得是-判据没写任何.md
- plugin/scripts/criterion-failure-attribution-check.ts (new)
- plugin/scripts/capability-catalog.sh
- plugin/scripts/runner-static-gate.ts
- plugin/scripts/checker-mutation-cases/criterion-failure-attribution-check.sh (new)
- plugin/test/criterion-failure-attribution-check.test.mjs (new)
- docs/analysis/criterion-failure-attribution.baseline.json (new)
- tasks/gap-goal-criteria-bare-failing-exit-unattributable.md
