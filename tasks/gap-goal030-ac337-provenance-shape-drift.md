---
id: gap-goal030-ac337-provenance-shape-drift
title: GOAL-030 ③ 读数漂移：状态事件 v0→v1 把 writerModule/entry 移入 producer，AC-337 判据与
  branch-selfhost-probe 仍读顶层字段 ⇒ 3/3 事件被误判 loaded-main-checkout-code
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-337
---
**type:** execution

## Proposal

GOAL-030 的 AC-337 判据与它调用的探针在 2026-10-13 的主检出上取 `exit 1 / CAUSE=loaded-main-checkout-code`，但**被它点名的 3 条事件实际全部由本树代码写出** —— 这是**读数侧的字段路径漂移**（reader 未随状态事件契约 v0→v1 迁移），不是自举失败。分支代码身份没有被破坏；坏的是那个读身份的量。

### 事实链（可直接复跑）

1. 判据（`goals/AC-337-*.md` 第 22 行）与探针自检（`scripts/branch-selfhost-probe.mjs:135` 的 `classifyEventIdentities`）都从**原始 JSONL 记录**上重新推导 `inTree(e.writerModule) && inTree(e.entry)` —— 判据刻意不复用探针的结论（它不信任探针自己报的「通过」，这是 AC-337 的设计前提，⛔ 不许在本次修复中削弱）。
2. 状态事件契约已 v0→v1：`packages/quay/src/kernel/task-transition.ts:223-238` 明确记载 v1「**moves the provenance triple under `producer`**」；v0 的顶层 `writerModule`/`entry` 不再出现在新记录上（v0 旧行仍按 v0 读，`readTaskStatusEventCarrier` 逐行按 `schema` 键分类）。迁移提交：`685ec7415`（task-status-events contract v1）、`083b4a644`（Provider-ABI 写路径也发 v1）。
3. 上面两个 reader 没有随之迁移：v1 记录上 `e.writerModule` 是 `undefined` ⇒ `inTree(undefined) === false` ⇒ 3/3 事件被判「本树外」。
4. 当前读数（2026-10-13，主检出 = author @`d1e0bb744`）：`node --experimental-strip-types packages/quay/bin/quay.ts goal gate AC-337 --dry-run --timeout 120000 --json` ⇒ `event.verdict: "fail"`，理由引用的正是一条 `"schema":"task-status-event/v1"` 记录；同一批事件的 `producer.writerModule` = `/data/home/yale/work/quay/packages/quay/src/kernel/task-transition.ts`、`producer.entry` = `/data/home/yale/work/quay/plugin/scripts/ready-pool-check.ts` —— **都在被求值的树内**。两类转移（promote 2 / retreat 1）、`childResolution: "default"`、`production.unchanged: true`、`env.QUAY_PLUGIN_ROOT: null` 本来就全部成立；先跑 `scripts/branch-selfhost-probe.mjs --json` 可直接复现。

### 为什么它一直没被发现

`plugin/test/branch-selfhost-probe.test.mjs` 把漂移**钉住**了：它同时断言判据正文与探针源码含 `e.writerModule`/`e.entry`（第 146/168 行），而它喂给 `classifyEventIdentities` 的合成事件是最新 v0 形态（第 61-62 行 `event(writerModule, entry)`），**从未喂过一条 v1 记录** ⇒ 测试始终是绿的。硬规则 3b 的形态：读不懂的输入与「不合格」共用一个 spelling，于是「读错字段」与「真的加载了主检出代码」不可区分。

### 修法（只修 reader，⛔ 不动 kernel 写侧）

1. **探针**：加 `provenanceOf(rec)` —— 顶层 `writerModule` 存在则按 v0 取，否则取 `rec.producer`（v1）；`classifyEventIdentities` 改用它。**缺值仍必须判失败**（硬规则 3b：读不到的来源不得与「在树内」同形；`null`/缺 `entry` 的 arm 必须继续保持红）。
2. **判据**：经 `node --experimental-strip-types packages/quay/bin/quay.ts goal write AC-337 --criterion '<新正文>'` 把同一 tolerance 内联进那段 `node -e` 读取器（⛔ 不手改 `goals/*.md`，goal store 的唯一写路径是 goal write）。除字段路径外，判据契约保持不变：读哪些顶层字段、三态退出码、`CAUSE=` 词表都照旧，仍是对**原始记录**的独立复核。**这不是挪动球门**：AC-337 断言的保证（每条事件的写入模块与入口 realpath 在被求值的树内）一字未改，改的只是该保证在当前已发布的 v1 契约上应从哪个字段路径取 —— 即使按 v1 记录算，判据也仍然能取假（见下面第 5 条 AC 的变异负对照）。
3. **测试**：`plugin/test/branch-selfhost-probe.test.mjs` 增加 **v1 形态**的 arm（`producer` 在树内 ⇒ `ok:true`；`producer` 指向树外 ⇒ `ok:false`），并更新第 146/168 行的字段名钉子。这两个 arm 必须能当**回归锁**：把 `provenanceOf` 的 v1 分支拿掉后测试转红。
4. **探针 `--selftest`** 同样加一条 v1 arm（`--selftest` 是判据之外的第二道自检）。
5. ⛔ 非目标：不改 `packages/quay/src/kernel/task-transition.ts` 的写侧记录形态，不改 v1 契约，不新增事件字段，不扩大 AC-337 的范围。若在核对中发现 `negativeControl` 在已并入主检出的树上被 `mainHasModule===true` 短路为 n/a，那是判据自己写明的逃生门，**如实在 Evidence 记下即可，本次不修**。

<!-- dedup-ref --> 归属与去重：本条是 GOAL-030 的第三条承接链 —— 前两条是 `gap-goal030-promotion-writes-via-kernel-transition` 与 `gap-goal030-branch-selfhost-probe`（均 done），本条针对的是它们落地**之后**发生的契约迁移所造成的读数漂移，机制不同；`task-granularity-advice.ts` 对本任务的 Touches 报 `peers: []`，无在飞任务重叠。

## AC

- [ ] `node --no-warnings scripts/branch-selfhost-probe.mjs --json` 退出码 0，且 stdout JSON 里 `selfCheck.ok === true`、`selfCheck.causes` 为空数组、`events.length === 3`。
- [ ] 同一次运行的输出里，3 条事件各自带 `producer.writerModule` 与 `producer.entry`，且二者的 realpath 均以被测树的 toplevel 开头（即 `inTree` 对 v1 记录取真，`identity.bad` 为空）。
- [ ] `node --no-warnings scripts/branch-selfhost-probe.mjs --selftest` 退出码 0，且其中至少一条 arm 的事件记录带 `producer`（v1 形态）：在树内 ⇒ 通过，指向树外 ⇒ 报 `CAUSE=loaded-main-checkout-code`。
- [ ] `node --test plugin/test/branch-selfhost-probe.test.mjs` 退出码 0。
- [ ] **变异负对照（证明判据仍能取假、不是恒真）**：临时把 `provenanceOf` 改成只读顶层 `writerModule`/`entry`，`node --no-warnings scripts/branch-selfhost-probe.mjs --json` 必须退出 1 且 stderr 含 `CAUSE=loaded-main-checkout-code`；恢复实现后转绿。两次退出码与 stderr 首行写进 Evidence。
- [ ] `node --experimental-strip-types packages/quay/bin/quay.ts goal gate AC-337 --dry-run --timeout 120000 --json` 的 `event.verdict === "pass"`（判据本体经唯一正本路径求值）。
- [ ] 集群核对（硬规则 5b）：`grep -rn 'e\.writerModule\|e\.entry\|producer\.writerModule' scripts/ goals/ plugin/test/branch-selfhost-probe.test.mjs` 的全部命中都已按 v0/v1 双形态处理，把命中数与前 3 条内容贴进 Evidence（不得再有会把 v1 记录判错的读取点）。

## DoD

- 在主检出上跑 `scripts/branch-selfhost-probe.mjs`，**每条真实事件**的 `producer.writerModule`（kernel 模块 realpath）与 `producer.entry`（driver 子进程入口 realpath）都落在被求值的树内 —— 这是对生产载体（`.quay/task-status-events.jsonl` 形态）的真实读数，不是 fixture 回声。
- AC-337 经 `quay goal gate` 取到 `pass`，`quay goal check --achieved-failing` 不再含 AC-337。
- 判据的健全性由变异负对照证明（去掉 v1 分支 ⇒ 报 `loaded-main-checkout-code`），即它仍是一个**能取假**的判据。
- ⛔ 未改 kernel 写侧记录形态、未改 v1 契约、未削弱判据「独立复核原始记录」的设计。

## Touches

- scripts/branch-selfhost-probe.mjs
- plugin/test/branch-selfhost-probe.test.mjs
- goals/AC-337-分支自举-按文件路径启动的分支-promotion-driver-默认子进程解析-在沙盒中触发-todo-ready-分.md
- tasks/gap-goal030-ac337-provenance-shape-drift.md

## Evidence

落笔当轮读数（2026-10-13，主检出 = author @`d1e0bb744`）：

- `scripts/branch-selfhost-probe.mjs --json` ⇒ `rc=1`，stderr `CAUSE=loaded-main-checkout-code`。
- 该次运行的 3 条事件均为 `"schema":"task-status-event/v1"`；`producer.writerModule` 三条同值 `/data/home/yale/work/quay/packages/quay/src/kernel/task-transition.ts`，`producer.entry` 三条同值 `/data/home/yale/work/quay/plugin/scripts/ready-pool-check.ts` —— realpath 均在 `/data/home/yale/work/quay` 内。
- `promotion.flips=2` 且 promote 事件 2 条；`revaluation.flips=1` 且 retreat 事件 1 条；`childResolution="default"`；`production.unchanged=true`；`env.QUAY_PLUGIN_ROOT=null`。
- `quay goal gate AC-337 --dry-run --timeout 120000 --json` ⇒ `event.verdict="fail"`，`payload.reason` 引用的正是一条 v1 记录（`{"schema":"task-status-event/v1",...`）。
