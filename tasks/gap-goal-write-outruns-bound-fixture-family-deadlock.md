---
id: gap-goal-write-outruns-bound-fixture-family-deadlock
title: goal write 先于绑定夹具落地 ⇒ 一个 AC 家族互相死锁：develop 的判据已 exit 3 而夹具仍断言 1（全量 suite
  20 红，四个任务无一能落地）
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: finding
---
**type:** finding

## Finding

**机制（跨任务红源 —— 不是任一任务的 delta 缺陷）**

`quay goal write <AC>` 把 criterion 提交进主检出并【立即】propagate 到 `develop`；而绑定它的夹具
（`packages/quay/test/ac<NNN>-criterion-address-derivation.test.mjs`）是普通代码，只能经 fan-in 落
`develop`。两者落在【两个不同的时钟】上 ⇒ 存在一个窗口：develop 的判据说一件事、它的夹具断言另一件
—— 一个确定性的、develop 全量的 suite 红。

一个 AC 家族被「一任务一 AC、互不覆盖」拆开时，N 个任务同时开这个窗口，每支分支只带【自己那一份】
夹具修复 ⇒ **没有任何一支分支的合并树是全绿的 ⇒ 没有任何 fan-in 能落地 ⇒ 夹具永远到不了 develop。**

**实测（2026-09-29，家族 `gap-ac291/292/301/303-criterion-carrier-absence-not-evaluated`）**

四条 goal 写入都已在 `develop` 上，四条判据的「可评估性」分支都已 `exit 3`：

| AC | develop 上的 goal 写入 commit | 判据的可评估性出口 | 夹具在 develop 上的断言 |
|---|---|---|---|
| AC-291 | `e0105451a goals: AC-291 field:criterion` | `... >&2; exit 3; fi` | `exit 1` |
| AC-292 | `0cfc7eb14 goals: AC-292 field:criterion` | `... >&2; exit 3; fi` | `exit 1` |
| AC-301 | `86ed0af4d goals: AC-301 field:criterion` | `... >&2; exit 3; fi` | `exit 1` |
| AC-303 | `ecf823458 goals: AC-303 field:criterion` | `fail()` 出口 `exit 3` | `exit 1` |

读数（在 `gap-ac303` 工作树内跑；那三个夹具文件与 develop 逐字相同 —— `git diff develop HEAD -- <三文件>` 为空）：

```
node --test packages/quay/test/ac{291,292,301}-criterion-address-derivation.test.mjs
⇒ 20 失败（6 + 7 + 7），全部形如 `expected exit 1, got 3` / `3 !== 1`
```

与 fan-in suite 日志一致（`# tests 9765 / # pass 9745 / # fail 20`）；本任务两轮 `exited-not-landed` 都停在
`step=suite: AssertionError [ERR_ASSERTION]: an unnormalisable wildcard must not yield a green`
（2026-09-29T02:59:19Z、03:13:32Z）。

**为什么每支分支都落不了地**：机械 fan-in 在【本分支的工作树】里跑全量 suite
（`plugin/scripts/worker-fan-in.ts` `runMechanicalFanIn` 步链 …→scoped 门→全量 suite→ff），而每支分支的
合并树里仍带着另外三份未修的夹具 ⇒ 没有一支 fan-in 是绿的。

**driver 的行为使它是「churn」而不是「停」**：`plugin/scripts/worker-driver.ts:2712` 的
`judgeRetryExemption` 看到同一断言签名跨 ≥2 个任务复发 ⇒ 判 `unrelated-flaky-exempt`；`:4557` 的
`else if (exemption.verdict !== "unrelated-flaky-exempt")` 因此为假 ⇒ **重试上限不前进** ⇒ 无限重派，
每轮烧一个 ~19 分钟的全量 suite。

<!-- dedup-ref -->
⚠️ **永久化半边**：`gap-ac292-criterion-carrier-absence-not-evaluated` 已经是 `needs-human`（被 park），
而它的分支【已经带着】自己那份夹具修复（`assert.equal(r.code, 3, NOT_EVALUATED_WHY)`）⇒ 没有东西会落地
它 ⇒ develop 的 ac292 夹具恒红 ⇒ 死锁从「贵」变成「永久」。park 的解除是 manager 的动作（⛔ worker 不得
un-park 另一个任务）。

**为什么 worker 不能从自己的 mandate 里破**：兄弟夹具在它的 `## Touches` 之外，
`anti-drift-touches-check.ts` 对未声明的写入 HARD-FAIL（`anti_drift.exempt` 只能在 workspace 根 config
里声明，故意不交给任务自己）；而自行扩 Touches 会证伪该任务自己的 AC7（非目标边界未被越过）。

**两条候选解法（裁决归 manager，本条只立案不裁决）**
1. **家族一起落地**：一个任务把四份绑定夹具一并纳入 `## Touches` 并落地，随后四支兄弟分支的 fan-in 即可通过。
2. **goal 写入留在分支上直到 fan-in**：把「criterion 落库」从 `goal write`（直落 develop）改为随任务分支一起落。

<!-- dedup-ref -->
**去重（按机制，⛔ 不按症状关键词）**：`grep -rliE 'family deadlock|bound fixture|goal write.*propagat' tasks/*.md`
无同机制命中；`gap-ac301-criterion-carrier-absence-not-evaluated.md:154,331` 只是把「goal 写入已 propagate
到 develop」当作【证据】记下，未命名本机制 ⇒ 不是重复立案。

## AC

- [ ] **AC1（develop 上四份夹具全绿）**：在 develop HEAD 上跑 `node --test packages/quay/test/ac291-criterion-address-derivation.test.mjs packages/quay/test/ac292-criterion-address-derivation.test.mjs packages/quay/test/ac301-criterion-address-derivation.test.mjs packages/quay/test/ac303-criterion-address-derivation.test.mjs` ⇒ 4 个文件、`fail 0`（当前为 20 失败）；逐字贴出汇总行。⛔ 单文件本地跑 / dry-run 不算；⛔ 必须是 develop HEAD 的树。
- [ ] **AC2（判据与夹具在 develop 上同形）**：对四条 AC 各贴一行读数，证明 develop 上「判据的可评估性出口」与「夹具的期望码」一致（都为 3）——每份 goal 文件 `grep -c 'exit 3'` 非零 ∧ 每份夹具 `grep -c 'status, 3\|code, 3'` 非零，八个数一并贴出。
- [ ] **AC3（落地形态已具名）**：落地的改动逐字说明用了 Finding 里哪一条解法（1 或 2），并贴出该改动如何使「goal 写入」与「夹具落地」不再分处两个时钟（解法 1 ⇒ 四份夹具出现在同一个提交里，贴 `git show --name-only`；解法 2 ⇒ 贴 goal 写入随分支落地的路径）。
- [ ] **AC4（被 park 的兄弟不再被本机制挡住）**：被 park 的那支兄弟任务其夹具已在 develop 上（`git show develop:packages/quay/test/ac292-criterion-address-derivation.test.mjs` 的期望码为 3），**或**该任务已被 `retreat`/重派（读数 = `quay task get gap-ac292-criterion-carrier-absence-not-evaluated --json` 的 status）。⛔ 本条由 manager 的动作满足，worker 不得自己 un-park 它。
- [ ] **AC5（非目标边界）**：`git diff --name-only` 对 `## Touches` 之外为空；并贴出证据说明**没有**改任何 `packages/quay/src/**` 产品源码（本缺陷修的是落地时钟，⛔ 不是判据语义）。

## DoD

**REAL LANDING 判据（DIR-026 Reading A）**：不是「有一条 AC 被勾上」，而是**四份绑定夹具真的在 develop 上、且一次真实的全量 suite 在 develop HEAD 上给出 `# fail 0`** —— 判据与夹具回到同一个时钟上。

1. **落地对象**：四份 `packages/quay/test/ac{291,292,301,303}-criterion-address-derivation.test.mjs` 的内容在 `develop` 上可 `git show develop:<path>` 读到，且其可评估性断言为 `3`。
2. **全量证据**：一次真实的全量 suite 在 develop HEAD 上跑完，汇总行逐字进 Evidence（⛔ 不是单文件、不是 dry-run、不是 scoped 门）。
3. **解封证据**：至少一支原本 `exited-not-landed` 的兄弟任务的 fan-in suite 步不再停在 `an unnormalisable wildcard must not yield a green`（贴该轮 `mechanical_fan_in.step` 与其新读数）。
4. **机制随记录进库**：本 Finding 的「两个时钟」表述随任务体留在 `tasks/` 里，⛔ 不只活在会话记忆里。

## Touches

- `packages/quay/test/ac291-criterion-address-derivation.test.mjs`
- `packages/quay/test/ac292-criterion-address-derivation.test.mjs`
- `packages/quay/test/ac301-criterion-address-derivation.test.mjs`
- `packages/quay/test/ac303-criterion-address-derivation.test.mjs`
- `tasks/gap-goal-write-outruns-bound-fixture-family-deadlock.md`

（说明：前四条 = 解法 1 的落地对象，即四份绑定夹具。⛔ `packages/quay/src/**`、任何 `plugin/scripts/*.ts`、任何 `plugin/scripts/*.sh` 均不在本 Touches 内。第五条为 self-touch。若 manager 裁决走解法 2，Touches 需在落地前按其裁定修订。）
