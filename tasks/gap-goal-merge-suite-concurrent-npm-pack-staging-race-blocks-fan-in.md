---
id: gap-goal-merge-suite-concurrent-npm-pack-staging-race-blocks-fan-in
title: goal 并入的全量 suite 下两个测试在与真实 npm-pack staging 并发时必红，两次 GOAL-030 并入尝试均复现
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Finding

**现象**（实测，`.quay/gate-events.jsonl` 两条 `gate: "goal-merge-result"` 记录，`item_id: "GOAL-030"`，id `53293e46-...`/`ba3bd963-...`，时间戳 `14:19:42`/`14:52:50`）：`quay goal merge GOAL-030` 的两次尝试（一次首次请求 `f2b2a22b`，一次人工显式重试 `46d1f55b`）在 §4.7 的全量 suite 步骤均红，**两次失败的测试名与原因逐字相同**：

```
✖ walk→read race: a listed .sh that vanishes before its read is SKIPPED and REPORTED, never a crash
  (npm-pack staging rm -rf's packages/quay/plugin/ mid-suite)   [plugin/test/adr016-screen-use-check.test.mjs]
✖ AC2 — fast-mode-telemetry.ts has ONE physical copy; plugin/scripts/ is authoritative,
  experiments/ is a symlink re-export                           [plugin/test/fast-mode-telemetry.test.mjs 同族]
```

**已排除「GOAL-030 内容冲突」**：两次失败都报在 `step: "suite"`（不是 `merge-conflict`）；我独立在 `/tmp/goal030-merge-repro` 用 `git worktree add --detach develop && git merge --no-ff goal/GOAL-030` 复现了同一棵合并树——`git merge` 零冲突，合并提交 `8c787c161`（parents `39e3a147d 8c8973dfa`）干净生成。

**已排除「这是内容/逻辑 bug」**：在这棵复现出来的合并树上，单独跑 `node --experimental-strip-types --test plugin/test/adr016-screen-use-check.test.mjs`——**19/19 全绿**，包括那条在两次生产并入尝试里都红的「walk→read race」测试。同一棵树、同一份代码，单文件隔离跑通过，说明失败不是合并内容引入的逻辑缺陷。

**⇒ 结论：这是全量 suite 并发执行下的环境伪影**，不是内容冲突。该测试自己的名字就点明了触发条件——「npm-pack staging rm -rf's packages/quay/plugin/ mid-suite」——这是本仓库真实发生过的现象（测试原本就是为它写的），而该测试的断言是**严格 `assert.deepEqual`**（`plugin/test/adr016-screen-use-check.test.mjs:155-166`）：只 mock 了一个指定受害文件的 `readFileSync` 抛 ENOENT，断言 `scan.unreadable` **恰好等于**只含那一条的数组。全量 suite 并发跑时，如果真有一个做实际 npm-pack staging 的测试文件同时在对 `packages/quay/plugin/` 做 `rm -rf`/重建，会让这条测试自己的真实（未 mock）文件系统扫描也撞到一个**额外的、非预期的** ENOENT（或反过来，受害文件没来得及被 mock 命中前先被真实删除），讲真实数组撞上严格等值断言就会红——这与两次生产事件的失败模式完全吻合（同一测试、同一原因，仅因并发时机而间歇出现）。

`fast-mode-telemetry.ts` 的 symlink/物理拷贝不变式测试很可能是同一次并发扰动的另一受害者（同一 suite 窗口内，若某并发进程短暂改写了 `plugin/scripts/`/`experiments/` 下的相关路径，这条不变式检查也会被拖带进去一起红）——未独立复现到 100% 确证，留给执行者核实。

**影响面**：任何 `quay goal merge` 的全量 suite 步骤都会被这类并发噪声间歇性拖红——不是 GOAL-030 专属，会堵住任何 goal 分支的并入（人工重试在赌运气，不稳健）。

## Acceptance Criteria

- [ ] 在 `/tmp/goal030-merge-repro`（或新建的等效复现树）上，并发跑一次真实的 npm-pack 打包/staging 操作与 `plugin/test/adr016-screen-use-check.test.mjs` 同时执行，复现该测试红（确认根因，而不是停留在"很可能"）
- [ ] 若确认是严格 `assert.deepEqual` 对并发噪声不宽容：修复方向——断言改为"受害文件那一条必须存在"而不是"数组恰好只有这一条"（如 `assert.ok(scan.unreadable.some(e => e.rel === victim && e.reason === "ENOENT"))`），同时保留对"受害文件确实被跳过而非崩溃"这一核心语义的覆盖；⛔ 不要把断言弱到连受害文件本身都不检查
- [ ] `fast-mode-telemetry.ts` 的物理拷贝/符号链接不变式测试同样核实是否对并发噪声敏感，若是按同一原则修复
- [ ] 修复后：在同一棵复现合并树上单文件跑绿（回归验证不变坏），且不引入新的宽容度缺口（即故意传一个"受害文件本身没被正确跳过"的坏结果，断言仍必须红——取假）
- [ ] `scripts/test.sh` 全量跑绿（本任务落地的真正验收口径）
- [ ] 本任务落地（develop 上）后，`quay goal merge GOAL-030 --reason "..."` 的下一次尝试（或已有待执行请求的自动重试）在 suite 步骤不再复现这两条失败

## Definition of Done

两条测试对全量 suite 并发执行下的真实环境噪声具备容忍度（在不放弃其核心断言语义的前提下），`scripts/test.sh` 全绿，且验证过 GOAL-030（或任一其它 goal 分支）的并入不再被这类并发伪影间歇性挡住。

## Touches

- plugin/test/adr016-screen-use-check.test.mjs
- plugin/test/fast-mode-telemetry.test.mjs
- tasks/gap-goal-merge-suite-concurrent-npm-pack-staging-race-blocks-fan-in.md
