---
id: gap-ac355-criterion-false-from-goal-acceptance-active-guard
title: AC-355 判据在 driver 求值下恒报假：AC-242 轮转与 pre-filing 复核在跑判据前置位
  QUAY_GOAL_ACCEPTANCE_ACTIVE=1，被判据末尾的 bare `node --test` 继承 ⇒
  goal-store.test.mjs 8 红 ⇒ 判据报 post-merge-test-regression（同一棵树干净 shell 205/205
  全绿）——修法=让该测试文件对残留重入闸自净；5b 同族另有 6 个 plugin/test goal 文件同缺陷
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-355
---
## Proposal

**缺口（立案轮直接量，2026-10-10，cwd = 主检出 `/data/home/yale/work/quay`）**

AC-355（GOAL-034 post-merge 生产验证）的台账尾事件是 `fail`，但它的判据**此刻在这棵树上为真**：

```
$ node --no-warnings --experimental-strip-types --test <AC-355 的七个文件>
⇒ exit=0  ℹ tests 205  ℹ pass 205  ℹ fail 0
```

台账里它连着两次判 `fail`，都是 `CAUSE=post-merge-test-regression … exit=1`：

```
2026-10-10T07:04:23.556Z  actor=goal-cli    verdict=pass  evaluationRoot=/data/home/yale/work/quay
2026-10-10T07:15:46.569Z  actor=goal-sweep  verdict=fail  CAUSE=post-merge-test-regression
2026-10-10T07:18:12.729Z  actor=goal-cli    verdict=fail  CAUSE=post-merge-test-regression   # pre-filing 复核
```

**同一棵树、同一条命令；唯一差别是一个环境变量。受控 A/B（立案轮实测，一条命令可复现）：**

```
$ QUAY_GOAL_ACCEPTANCE_ACTIVE=1 node --no-warnings --experimental-strip-types --test <同样的七个文件>
⇒ exit=1  ℹ tests 205  ℹ pass 197  ℹ fail 8     # 与 07:15 / 07:18 那次逐字同签名（同 8 条）
```

⇒ 这**不是** GOAL-034 的合并回归：AC-355 判据的结构检查全过（`kernel/gate-run-options.ts` 在；`gate/config/utils.ts` 与 `gate/factories/loader.ts` 都不在；八个消费点仍按位置 import kernel），**也不是**七个文件本身坏（干净 shell 205/205）。

### 成因：求值机制自己给判据下毒

`QUAY_GOAL_ACCEPTANCE_ACTIVE`（`packages/quay/src/goal-store.ts:135`）是**跑 goal 判据的重入闸**——值 `"1"` ⇒ 嵌套的 goal-store 调用**拒绝跑判据**（`checkAchievedFailing` `goal-store.ts:2015`、`sweepFrozen` `:2227`、`goal-driver.ts:650` 复核）。两条**求值路径在跑本判据前把它置位在自己的 `process.env` 上**（`goal-store.ts:2025-2026` 与 `goal-driver.ts:671-672`；两处注释逐字写明它「inherited by the criterion's child shell」）。

AC-355 判据末尾用 **bare `node --test`**（⛔ 不经 `scripts/test.sh`）跑七个文件 ⇒ 继承该变量 ⇒ `goal-store.test.mjs` 的 8 条（`I5 ×3`、`AC4 负控制`、`AC-242 successor ×4`）读到 `evaluated:false` / `ran:[]` / 空集而失败；而空集与「跑了且全过」**同形**（硬规则 3b），判据于是报 `post-merge-test-regression`。

⇒ **driver 每轮都会重新观测到这个假 fail**（先由 `goal-sweep` 轮转、再由 pre-filing 复核），于是每轮为它立一次案 —— 本任务正是这个循环的产物。

**为什么早先那条 done 没挡住（本任务必须解释）**：`goal-034-merge-and-postmerge-verify`（status: done，`goal_ac: AC-355`）在**干净 shell** 里跑 `quay goal gate AC-355 --dry-run` ⇒ exit 0 ⇒ 判 done。它**从未在 driver 的求值环境里跑**，因此从未观测到「机制给自己下毒」这一态。那条 done 不是「修好了」，是「在唯一不触发该态的环境里验的」。

### 修法：让判据的测试载体对残留重入闸自净

`scripts/test.sh` 的 entry normalization 块**已经** unset 它（`scripts/test.sh:216` `unset FORCE_COLOR QUAY_GOAL_ACCEPTANCE_ACTIVE`；先例 `gap-goal-acceptance-active-leaks-into-suite-via-driver-anchor-env`，status done，landed `b566e683`）。**判据绕过了那个入口** —— bare `node --test` 拿不到 entry 的 unset。

缺的是**测试文件自身的洁净**：一个测试文件的行为**不得随宿主的 `QUAY_GOAL_ACCEPTANCE_ACTIVE` 变化**。最小改法：在 `packages/quay/test/goal-store.test.mjs` 模块加载时**保存并删除** `process.env[GOAL_ACCEPTANCE_ACTIVE_ENV]`，在 `test.after(...)` 里还原。这一处同时覆盖 in-process 的 `s.sweepFrozen()`（读本进程 env）与 `runCli` / `n()` 派生的 CLI 子进程（`spawnSync` 继承本进程 env）。文件里那条**故意**置位并断言 `refused:true` 的测试（`goal-store.test.mjs:1473`）自带 save/set/restore，逐字不动。

**⛔ 明确不做**：不改 AC-355 的判据文本（判据本身是对的）；不加宽/放松 `goal-store.ts` / `goal-driver.ts` 的重入闸（`:1473` 逐字钉住它）；不删/跳任何断言。

**5b（硬规则 5b，已在立案轮枚举）**：同缺陷（置位下变红、`env -u` 下全绿）的**同族文件另 6 个**（立案轮实测）：

- `plugin/test/goal-driver-s02.test.mjs`（poison exit=1 / 5 fail；clean exit=0）
- `plugin/test/goal-driver-s04.test.mjs`（5 fail）
- `plugin/test/goal-driver-s10.test.mjs`（4 fail）
- `plugin/test/goal-driver-s12.test.mjs`（1 fail；实测形状 `standing-ok` where `standing-violated` expected）
- `plugin/test/goal-driver-s13.test.mjs`（3 fail）
- `plugin/test/goal-invariants-standing.test.mjs`（3 fail；clean exit=0）

（对照：`goal-driver-s01/03/05/06/07/08/09/11`、`goal-driver-criterion-worktree`、`goal-driver-task-boundary-check`、`l1-delivery-surface-check` 置位下 exit=0 ⇒ **不在**集合内。）

## Plan

1. **改前基线**：主检出跑 `QUAY_GOAL_ACCEPTANCE_ACTIVE=1 node --no-warnings --experimental-strip-types --test <AC-355 的七个文件>`，记 exit 与 `ℹ tests/pass/fail` 原始行（期望 exit=1 / fail 8，与台账 07:15 同签名）；再跑干净版（期望 exit=0 / fail 0）。两者原文进 `## Evidence`。
2. **自净** `packages/quay/test/goal-store.test.mjs`：模块加载处 `const __prevGuard = process.env[GOAL_ACCEPTANCE_ACTIVE_ENV]; delete process.env[GOAL_ACCEPTANCE_ACTIVE_ENV];`，`test.after` 里还原（`undefined` ⇒ `delete`，否则写回原值）。⛔ 不碰 `:1473` 那条置位测试。
3. **5b 收尾**：对 Proposal 末节的 6 个 plugin/test 文件逐个照第 2 步自净（各自 CLI spawn helper 的 child env / in-process store 读，同一原则），直至 `QUAY_GOAL_ACCEPTANCE_ACTIVE=1 node --test <file>` exit 0。把「命中数 7 + 前 3 条」贴进提交。
4. **两侧全绿**：`QUAY_GOAL_ACCEPTANCE_ACTIVE=1 node --test <七个文件>` 与 `env -u QUAY_GOAL_ACCEPTANCE_ACTIVE node --test <七个文件>` 都 exit=0 / fail=0。
5. **判据本身（文本原样）**：用置位环境执行 AC-355 判据文本（`quay goal show AC-355 --json` 取 `.criterion` 后**原样** `bash` 执行）⇒ exit 0。
6. **强度核对**：`grep -c 'test('` 证明 touch 前后 `goal-store.test.mjs` 的测试数不减、无新增 `skip`；`:1473` 的 `refused:true` 断言仍在且通过。
7. 常规收尾（merge develop → 静态检查 → scoped 门 → suite → fan-in）。

## Acceptance Criteria

- [x] AC1 — 改前基线可复现：置位下七个文件 `fail 8`、干净下 `fail 0`；两次原始行进 `## Evidence`。
- [x] AC2 — 改后：AC-355 判据**文本未改**，在**置位环境**下 exit 0（含 `ℹ fail 0`）。
- [x] AC3 — 双向：置位与 `env -u` 两种环境下七个文件都 exit 0 ∧ fail 0（⛔ 不把失败从一个环境挪到另一个）。
- [x] AC4 — 强度未减：`goal-store.test.mjs` 的 `test(` 计数不减、无新增 skip；`:1473` 的 `refused:true`（重入闸）断言仍在且通过。
- [x] AC5 — 5b：Proposal 末节列出的 6 个 plugin/test 同族文件逐个在置位下 exit 0；枚举命中数（7）+ 前 3 条进提交。
- [x] AC6 — 未削弱门：`quay goal show AC-355 --json` 的 `.criterion` 与改前 **md5 相同**（证明修在测试层，⛔ 不是改判据迁就结果）。

## Definition of Done

**真实操作，不是「加一行 unset 就完事」**：

- 用 **driver 的求值环境（`QUAY_GOAL_ACCEPTANCE_ACTIVE=1`）实跑一次 AC-355 判据的原样文本**，读出 `exit 0` 与 `ℹ tests 205 / pass 205 / fail 0` 的原始行 —— 这是「机制不再给自己下毒」的**直接量**，不是「改了个文件」的转述。
- 反向证据同样在案：干净 shell 也 exit 0（两侧都绿 ⇒ 修的是**环境敏感性**，不是把红挪走）。
- 重入闸的覆盖**未减**：`:1473` 的 `refused:true` 仍被断言；测试计数不减。
- `## Touches` 内每个文件都真的改了并被验证；无 Touches 外写入。

## Touches

- `packages/quay/test/goal-store.test.mjs`
- `plugin/test/goal-driver-s02.test.mjs`
- `plugin/test/goal-driver-s04.test.mjs`
- `plugin/test/goal-driver-s10.test.mjs`
- `plugin/test/goal-driver-s12.test.mjs`
- `plugin/test/goal-driver-s13.test.mjs`
- `plugin/test/goal-invariants-standing.test.mjs`
- `tasks/gap-ac355-criterion-false-from-goal-acceptance-active-guard.md`

## Evidence

（**立案轮读数**，供实现者直接复用；执行轮的读数追加在本节之下。）

- 台账三条（`grep AC-355 .quay/gate-events.jsonl`）：`07:04:23 goal-cli pass`；`07:15:46 goal-sweep fail`；`07:18:12 goal-cli fail`（后两条同 `treeSha` `9ebeb144a8…`、同因）。
- 受控 A/B（立案轮，主检出当前树）：干净 `205/205 exit 0`；置位 `197 pass / 8 fail exit 1`（8 条与台账同签名）。
- 结构检查（立案轮，主检出）：`kernel/gate-run-options.ts` 在；`gate/config/utils.ts`、`gate/factories/loader.ts` 不在；八个消费点位置扫描 `PASS`。
- 5b 枚举（立案轮）：见 Proposal 末节（7 命中 + 4 未命中对照；s02 与 goal-invariants-standing 已实测 poison→clean 双向）。

### 执行轮读数（2026-10-10，worktree `gap-ac355-criterion-false-from-goal-acceptance-active-guard`，提交 `b2081cb6b`）

**AC1 改前基线——原始行（改前 = 落到 worktree 上的 develop 尖端）**

```
$ QUAY_GOAL_ACCEPTANCE_ACTIVE=1 node --no-warnings --experimental-strip-types --test <AC-355 的七个文件>
⇒ exit=1  ℹ tests 205  ℹ pass 197  ℹ fail 8
$ env -u QUAY_GOAL_ACCEPTANCE_ACTIVE node --no-warnings --experimental-strip-types --test <同样的七个文件>
⇒ exit=0  ℹ tests 205  ℹ pass 205  ℹ fail 0
```

置位下的 8 条（与台账 07:15 同签名）：`I5 — an achieved AC whose criterion now fails lands in checkAchievedFailing`、`I5 bidirectional`、`I5 CLI`、`AC4 — 负控制：1 active goal + achieved AC ⇒ checkAchievedFailing 报 evaluated:true + scopeSize>0`、`AC-242 successor ×4`（轮转后 exit 1 并点名该 AC / 轮转有界 / 判据自己声明 NOT-EVALUATED / 已记录的 fail 更早被重新检查）。

**AC2 + AC3 改后——原始行（同一 worktree，改后）**

```
$ QUAY_GOAL_ACCEPTANCE_ACTIVE=1 node --no-warnings --experimental-strip-types --test <七个文件>
⇒ exit=0  ℹ tests 205  ℹ pass 205  ℹ fail 0
$ env -u QUAY_GOAL_ACCEPTANCE_ACTIVE node --no-warnings --experimental-strip-types --test <七个文件>
⇒ exit=0  ℹ tests 205  ℹ pass 205  ℹ fail 0
```

（测试总数 205 前后不变；⛔ 不是把失败从一个环境挪到另一个。）

**AC2 判据原样文本——置位环境实跑（DoD 的直接量）**

```
$ node … quay goal show AC-355 --json | 取 .criterion 原样写入 /tmp/ac355-criterion.txt
$ md5sum /tmp/ac355-criterion.txt
d25dc9ed75082e7dbf397e2d6dafd80e  /tmp/ac355-criterion.txt
$ QUAY_GOAL_ACCEPTANCE_ACTIVE=1 bash /tmp/ac355-criterion.txt      # cwd = worktree 根
PASS: develop tip carries the slice (kernel/gate-run-options.ts, dead shim gone, six consumers converged) and the seven affected test files pass
$ echo $?
0
$ grep -E '^ℹ (tests|pass|fail)' /tmp/goal034-ac355-test-output.txt   # 判据自己写的那份输出
ℹ tests 205
ℹ pass 205
ℹ fail 0
```

反向（干净 shell）同一文本也 `exit 0`（`PASS: …`，code 0）。

**AC4 强度未减**

```
$ git show develop:packages/quay/test/goal-store.test.mjs | grep -c 'test('   ⇒ 85
$ grep -c 'test(' packages/quay/test/goal-store.test.mjs                     ⇒ 85
$ skip/\.skip( 计数：develop 0 → 改后 0
$ grep -n 'refused, true' packages/quay/test/goal-store.test.mjs
1497:    assert.equal(r.refused, true, "拒绝是一个【独立取值】（硬规则 3b），⛔ 不是 ran:[] 冒充「跑了 0 条」");
```

该条（原 `:1473`，插入自净块后为 `:1497`）在 205 全绿之内通过。

**AC5 5b——置位下逐个（`QUAY_GOAL_ACCEPTANCE_ACTIVE=1 node --test <file>`）**

```
plugin/test/goal-driver-s02.test.mjs          ⇒ ℹ tests 14  ℹ pass 14  ℹ fail 0
plugin/test/goal-driver-s04.test.mjs          ⇒ ℹ tests 14  ℹ pass 14  ℹ fail 0
plugin/test/goal-driver-s10.test.mjs          ⇒ ℹ tests 4   ℹ pass 4   ℹ fail 0
plugin/test/goal-driver-s12.test.mjs          ⇒ ℹ tests 4   ℹ pass 4   ℹ fail 0
plugin/test/goal-driver-s13.test.mjs          ⇒ ℹ tests 3   ℹ pass 3   ℹ fail 0
plugin/test/goal-invariants-standing.test.mjs ⇒ ℹ tests 19  ℹ pass 19  ℹ fail 0
```

枚举命中数 **7**（= 6 个 plugin/test + `packages/quay/test/goal-store.test.mjs`）；前 3 条：`goal-store.test.mjs`、`goal-driver-s02`、`goal-driver-s04`。已贴进提交 `b2081cb6b`。

**AC6 判据文本未改**

```
$ md5(criterion) 主检出（== develop 尖端） ⇒ d25dc9ed75082e7dbf397e2d6dafd80e
$ md5(criterion) worktree                ⇒ d25dc9ed75082e7dbf397e2d6dafd80e
$ git diff --stat develop -- goals/      ⇒ （空）
```

**附带：scoped 门本轮先红后绿（已在本刀内修，记此以为鉴）**

首版解释性注释把 suite 入口路径写成**字面串**，被 suite-bucket 静态归因读成 `S` 信号，把 4 个此前 `UNRESOLVED`（零信号）的 plugin 测试文件推成 **pure-S** ⇒ `suite-bucket-reattr-ratchet-check` 红（正是 FAMILY-5 形态：**判定器在代码注释上触发**）。**改法 = 改写注释措辞（⛔ 不动 ratchet 基线、⛔ 不动 `docs/analysis/test-file-baseline.txt`）**；bucket 集回到 develop 值（`s02=M`、`s04/s10/s12/s13=UNRESOLVED`、`goal-invariants-standing=P+M`、`goal-store=P`），ratchet `PASS — 0 pure-S un-attributed; 56 S-signal-multi (report-only)`。scoped 门最终：

```
$ bash scripts/test.sh --for-task gap-ac355-… --allow-thin
⇒ exit 0   ℹ tests 142  ℹ pass 142  ℹ fail 0
```
