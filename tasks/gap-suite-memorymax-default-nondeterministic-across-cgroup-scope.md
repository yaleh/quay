---
id: gap-suite-memorymax-default-nondeterministic-across-cgroup-scope
title: full-suite-runner-cgroup.test.mjs:1830 红——defaultSuiteMemoryMax() 因
  listSharedHostScopes().count 跨进程不确定，DEFAULT_SYSTEMD_RUN_LIMITS.memoryMax 非纯常量
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

`full-suite-runner-cgroup.test.mjs:1830` 断言 `reading.memoryMax === defaultSuiteMemoryMax()`。`reading.memoryMax` 来自 `DEFAULT_SYSTEMD_RUN_LIMITS.memoryMax`（`full-suite-runner.ts:1515-1516`），其值是模块加载时 `defaultSuiteMemoryMax()`（`:1495`）的求值。而 `defaultSuiteMemoryMax()` = `suiteMemoryMax({ effectiveTotalMemBytes: readEffectiveTotalMemBytes(), declared: declaredSuiteMemoryMax(), hostGuard: suiteHostGuard({…, siblingScopeCount: listSharedHostScopes().count}) })`——其中 `listSharedHostScopes().count` 是**宿主状态相关**的。在 probe 进程（跑在新建的 `systemd-run --scope` 里）里 scope 计数与测试进程不同 ⇒ `defaultSuiteMemoryMax()` 在 probe 内返回 16G、在测试进程返回 2G ⇒ 断言失败。**这是一个确定性 bug（非 flake、非负载）**：`DEFAULT_SYSTEMD_RUN_LIMITS.memoryMax` 本应是「声明的纯常量」，却被实现成了宿主相关、跨进程不确定的量。它被 baseline A/B 误判为「task-introduced red」，正阻塞 `gap-src-root-gate-cycle-break` 与 `gap-ac353` 的落地。

## Plan

1. 把「声明默认值」与「宿主守卫/scope 计数」解耦：`DEFAULT_SYSTEMD_RUN_LIMITS.memoryMax` 应取 `declaredSuiteMemoryMax()`（纯常量，不读 cgroup、不读 sibling scope 计数），host-guard 只在真正要调 suite 上限时才套用，不进模块加载常量。
2. 或等价方向：让 `defaultSuiteMemoryMax()` 对 probe 进程与测试进程返回同一值（消除 `listSharedHostScopes().count` 对「默认声明值」的污染）。
3. 修正后 `full-suite-runner-cgroup.test.mjs:1830` 的断言在两种进程上下文里确定性成立。

## Acceptance Criteria

- [ ] AC1（能取假·确定性）`node --experimental-strip-types --test plugin/test/full-suite-runner-cgroup.test.mjs` 在本机连续 2 次绿（不是靠 skip，是断言真过）；仍红即假。
- [ ] AC2（根因对）`DEFAULT_SYSTEMD_RUN_LIMITS.memoryMax` 不再依赖 `listSharedHostScopes().count`——一条命令可从源码/测试验证该依赖已移除。
- [ ] AC3（无回归）`bash scripts/test.sh --for-task <本任务id> --allow-thin` 绿；full-suite-runner 相关测试不破。

## Definition of Done

cgroup 测试确定性绿（AC1）、声明默认值与宿主状态解耦（AC2）、scoped 测试绿（AC3）。

## Touches

- plugin/scripts/full-suite-runner.ts（defaultSuiteMemoryMax / DEFAULT_SYSTEMD_RUN_LIMITS 解耦）
- plugin/test/full-suite-runner-cgroup.test.mjs（断言随根因修正）
- tasks/gap-suite-memorymax-default-nondeterministic-across-cgroup-scope.md