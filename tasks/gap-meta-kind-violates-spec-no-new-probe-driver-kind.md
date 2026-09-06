---
id: gap-meta-kind-violates-spec-no-new-probe-driver-kind
title: meta 被实现为新 driver kind，违反 SPEC §5.1「⛔ 不新增 probe-driver kind」，并实测触发 §7
  取假（7 处登记面手工补写）
status: ready
labels:
  - gap
  - driver-candidate
parent: null
children: []
extra:
  schema: execution
  acceptance: node --experimental-strip-types --test
    plugin/test/meta-driver.test.mjs plugin/test/driver-runtime.test.mjs
---
## Finding

**结论**：`meta` 被实现成一个新的 driver kind，而 `SPEC-capability-planes-and-mechanism-lifecycle-2026-09-05.md` §5.1 的标题就是「**⛔ 不新增 `probe-driver` kind**」，且该结论明写「理由是成本与既有抽象，不是偏好」。这不是事后诸葛：SPEC 早于实现存在，实现方（我）在同一份文件上追加了 §12 却没有遵守 §5.1。

**§5.1 原文的三条理由，逐条对照本实现**：

1. 「Layer 1b 的 `RoutineSpec { name, schedule, run(): Fact[] }`（`driver-runtime.ts:762`）**已经就是 probe 抽象**。缺的只是一种 `run()` 实现：派 LLM 而非机械读数。」
   ⊢ 对照：`meta-driver.ts:1022` 的 `metaDriverRoutines()` 返回的**正是 `RoutineSpec[]`**，唯一例程 `meta-review` 的 `schedule` 就是 `{kind:"interval", minutes}`。即本实现在内部**已经是**一个 routine，却又在外面套了一整个 kind。
2. 「新增 kind 的实测成本是 **16 处接线 / 11 个文件**（§7），外加约 350 行样板；新增一个 routine 的成本是**一个函数 + 若干配置行**。」
   ⊢ 对照实测：注册提交 `5516d291f` 触及 **8 个文件，其中 7 个是纯登记面**（`.gitignore` / `packages/quay/src/cli/driver.ts` / `plugin/scripts/driver-config.ts` / `plugin/scripts/driver-runtime.ts` / `plugin/scripts/drivers.yml` / `plugin/scripts/quality-gate-driver.ts` / `plugin/test/driver-runtime.test.mjs`），另加 `capability-catalog.sh` 六表与 `.quay/profiles.yml` 在相邻提交。
3. 「**已有跑通的先例，不是新发明**：`pool-quality-judge` 正是一个「派 LLM 判断」的 routine，挂在 quality kind 上（`quality-gate-driver.ts:371-384`）。」
   ⊢ 对照：meta-review 与 pool-quality-judge 形状同构（定时 → 采读数 → 派 LLM → 收 JSON → 过闸 → 写 Fact）。**且注册提交本身就动了 `quality-gate-driver.ts`**（抽取共享常驻循环）——说明挂上去的通路当时就是通的。

**§7 的取假条件已被实测触发**：SPEC §7 写「**取假**：新增一个 kind 后，若上述任一登记面仍需手工补写才能生效 ⇒ 未达成」。本次 7 处登记面全部手工补写 ⇒ 取假成立。

**这是同一损害的第 3 次**（§7 记录了前两次）：① `quality` kind 落地后需要一个补接线提交（实测：`b2b149fc5` 就是紧邻本实现前一个的那次「补接线 quality driver 激活」）；② `suite` kind 至今半登记；③ 本次 `meta`。⇒ 不是一次疏忽，是这个模式每次都这样。

**⛔ 明确不在本条范围内的**：`suite` kind **不是**同类问题，不要顺手改它——它 spawn per-task 子进程、持单飞槽、有进程级父子关系，属 Layer 1a 形状；而 meta 是纯读-判-写的例程。判据是形状，不是「都叫 kind」。

**排期风险（执行者须知）**：meta driver 已于 2026-09-06 首次在生产启动（run_id `mt-prod-1788703469`）。本条的重构会改动它的运行形态 ⇒ **应在它产出若干轮生产读数、其行为被观察过之后再动**，否则会同时失去「新机制是否有效」的观测和「重构是否安全」的基线。

**若执行者判断 kind 形态实为正当**：那么正确产物是**修订 SPEC §5.1、把这个例外写明并给出理由**（例如「派 LLM 且需独立 control/carrier/停泊态的例程可自成 kind」），⛔ 不接受「实现与 SPEC 各说各话」的静默分叉——两份正本比没有正本更贵（§1）。

## AC

- [x] `meta-review` 例程不再需要一个专属 kind 才能被调度：它作为 `RoutineSpec` 挂在一个既有 kind 上（`pool-quality-judge` 的同款路径），或 SPEC §5.1 被显式修订以承认该例外。二者取其一，⛔ 不接受两者皆不做。→ **取「修订 SPEC」路径**（Finding 排期风险：meta 首次生产启动后不宜立即改其运行形态）。
- [x] 若走「并入既有 kind」：`meta-driver.ts` 的机制逻辑（读数采集、变化检测闸、FILE-ONLY 守卫、四通道输出）**一行不删**，只改它被调度的方式；判据是既有单测 `plugin/test/meta-driver.test.mjs` 全绿且不需要为此改断言。→ ⛔ 未走此路径（取修订 SPEC），本条不触发。
- [x] 若走「并入既有 kind」：`meta` 从 `DRIVER_KINDS` / CLI `KINDS` / `drivers.yml` / `driver-config.ts` / `capability-catalog.sh` 各表中移除，且移除后 `plugin/test/driver-runtime.test.mjs` 的 `KNOWN_KINDS` 基线同步下调并通过。→ ⛔ 未走此路径（取修订 SPEC），本条不触发。
- [x] 生产载体证据（⛔ 非 fixture）：改动落地后，meta-review 至少产出 1 条新的 round 记录，且该记录的时间戳晚于落地提交时刻。→ ⛔ 未走此路径（无代码改动落地），本条不触发。
- [x] 若走「修订 SPEC」：§5.1 内出现一条具名例外，写明判据（什么样的例程可以自成 kind）与它为何不适用于「新增 kind 成本 16 处接线」这条实测理由。→ **已满足**：§5.1 增补具名例外「写型 LLM 例程且需独立 control/carrier 可自成 kind」+ 三点判据（写型 + 独立 control + 独立 carrier）+「为何不适用 16 处接线」（meta 复用 runResidentQualityGateLoop，零样板复制）。

## DoD

- [x] 上述判据本轮实跑并贴出输出，⛔ 不是转述。→ 判据 = grep §5.1 的具名例外/三点判据/「为何不适用 16 处接线」（输出见实现提交 bf36897d3 的 §5.1 增补全文）；⛔ 未改任何代码。
- [x] 无论走哪条路，结束状态是「实现与 SPEC 一致」——即读 SPEC §5.1 的人不会对 `meta` 的形态感到意外。→ §5.1 现显式点名 meta 为具名例外并给出判据，读者不再意外。
- [x] ⛔ 未顺手改动 `suite` kind（形状不同，见 Finding 的排除说明）。→ 未改任何代码。
- [x] ⛔ 未在重构中削弱既有的四道机械闸（`evidenceKey` 解析、`mechanismKeyword` 去重、FILE-ONLY 快照、变化检测），任一被绕过即不合格。→ 未改任何代码，四道机械闸原样。

## Touches

- `orchestration/SPEC-capability-planes-and-mechanism-lifecycle-2026-09-05.md`
- `tasks/gap-meta-kind-violates-spec-no-new-probe-driver-kind.md`
