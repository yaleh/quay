---
id: gap-lwa-crit-fixture-sleep300-child-not-reaped-forces-aborted-on-clean-suite
title: live-web-address-fixture.mjs 的 sleep 300 夹具子进程未被回收——未 detach，既有常驻 driver
  回收机制管不到，干净完整轮也被判 aborted
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
depends_on:
  - gap-test-spawned-resident-drivers-outlive-their-suite-no-process-group-reaping
---
## Proposal

**发现于本会话的只读 fan-in 错误审计（2026-10-15）**：真实全量轮 round 2712/2716（`gap-routine-semantic-dedup-scan-print-json-three-behaviours`/`...-list-script-basenames-diverged-under-one-name`）在 `fail=0`、且 2716 的字段证明 `plannedFiles==terminalFiles==584`、`completeness:"complete"`、`oomKill:0` 的情况下，仍被判 `state:"red" reason:"aborted"`，`notEvaluated:"leaked-processes (2)"`——leaked 的是 `/tmp/lwa-crit-* (deleted)` 目录下的 `sleep 300` 进程。

**查重结果**：全库搜索 `live-web-address-fixture`/`lwa-crit`/`leaked-processes`，命中 `gap-test-spawned-resident-drivers-outlive-their-suite-no-process-group-reaping`（**done**）——但读其任务体确认，它的修复范围明确是**以 `detached:true` 方式 spawn 的「常驻 driver/子进程持有 stdio」**那一类泄漏（process-group kill，keyed on `child.pid` 作为 group leader），不是本缺陷这一类。**没有现有任务把 `lwa-crit` 夹具自身的子进程泄漏登记为独立对象**，故本任务新建，不是重复，也不是对已 done 任务的回归（是同一症状类别下一个未覆盖的近亲案例）。

**实测根因定位**：`packages/quay/test/helpers/live-web-address-fixture.mjs` 的 `mkRoot(prefix="lwa-crit-")` 是 7 个 `ac<NNN>-criterion-address-derivation.test.mjs` 共享的夹具工厂（`ac290`/`ac292`/`ac293`/`ac294`/`ac295`/`ac300`/`ac302`）。每个文件里的 `spawnNotAServe(root, phrase)` 这样 spawn：
```js
return spawn("/bin/sh", ["-c", `echo ${phrase} >/dev/null; sleep 300`], { cwd: root, stdio: "ignore" });
```
**没有 `detached: true`**——这正是既有 `gap-test-spawned-resident-drivers-...` 修复不会命中它的原因（该修复的 process-group kill 面向 detached 子进程）。各文件自己的 `withFixture()` 在 `finally` 里对注册进 `children`/`servers` 数组的子进程做 `killAndReap`（SIGKILL + 等 exit 事件），**正常测试路径下应当能回收**；但生产真实观察到的是它**没有**被回收——说明存在至少一条绕过该 `finally` 的路径（例如：单测自身超时/被外层 watchdog 以 SIGKILL 杀死整个测试 worker 进程，JS 层 `finally` 没有机会执行；或某个调用点没有把子进程正确登记进 `children`/`servers` 数组）。**真实失效路径由实现时的调查确认，本提案不假设是哪一条**。

## Plan

1. 复核全部 7 个消费 `spawnNotAServe`/类似夹具的测试文件，逐一确认子进程是否都被正确注册进 `withFixture` 的回收数组——若发现某个调用点遗漏注册，直接修。
2. 若 7 个文件都正确注册（即泄漏来自测试级/suite 级 watchdog 对整个 worker 的 SIGKILL，绕过 JS `finally`），修复方向转为：给这一类夹具子进程显式打标记（如独立的 cwd 前缀或一个可被进程树扫描识别的 marker argv），使**既有的 suite 级遗留进程清扫**（leak sweep）能在扫到它时主动 kill 并计入 `reaped`，而不是把它当成需要人工关注的泄漏上报——或者（视调查结果二选一，不强行两者都做）让这类夹具子进程本身也用 `detached:true` + 对应的 teardown，使其自然落入已有的 process-group 回收机制，复用现有机制而不是另造一套。
3. **不放宽**：不能把"检测到遗留进程"这件事本身弱化或跳过判定（`leakedProcesses`/`notEvaluated` 的既有契约、以及这条判定对真实泄漏的灵敏度必须保持），本任务只修"这一类**已知、测试自身制造的**子进程没被按设计回收"，不是放宽泄漏检测本身。
4. 保持与 `gap-test-spawned-resident-drivers-outlive-their-suite-no-process-group-reaping` 既有机制并存、不冲突：新修复若复用/扩展该文件的回收路径，须保证其原有 AC1/AC2 的两个方向（泄漏必被抓、干净轮不多出 leak key）继续成立。
5. **验证方式按本次授权收窄**：隔离 worktree 内直接跑受影响的 7 个 `ac<NNN>-criterion-address-derivation.test.mjs`（+ 必要的 `worktree-process-reaper`/resident-driver 相关单测）做受控局部验证，`scripts/test.sh --for-task <this task>` scoped 门禁即可，**不要求触发一次昂贵的全量 `scripts/test.sh` 跑**，不部署，不重启任何生产/共享服务。

## Acceptance Criteria

- [ ] AC1: 逐一核对 7 个消费该夹具的测试文件（`ac290`/`ac292`/`ac293`/`ac294`/`ac295`/`ac300`/`ac302`），确认泄漏的真实触发路径（遗漏注册 / 外层 SIGKILL 绕过 finally / 其它），粘贴调查结论。
- [ ] AC2: 修复后，针对确认的真实触发路径构造一个可复现的负控制（修复前能复现泄漏，修复后不再泄漏），粘贴修复前/修复后两次读数对比。
- [ ] AC3: 一个真正的、非本夹具制造的遗留进程（即真实需要被上报的泄漏）修复后仍被正确检测、仍计入 `leakedProcesses`/`notEvaluated`——不得因为本修复而让检测面变窄（硬规则 2 的镜像：零计数也要配一个"谓词对真样本命中"的对照）。
- [ ] AC4: 与既有 `gap-test-spawned-resident-drivers-outlive-their-suite-no-process-group-reaping` 的 AC1/AC2 不冲突——其既有测试（成功/失败/超时/取消四态 process-group 回收 + suite-end backstop）修复后仍全绿（粘贴证据）。
- [ ] AC5: 不放宽 leak/OOM 判定灵敏度，不提高 16GiB `MemoryMax` 等内存上限（grep/diff 证据）；原测试覆盖未被削减。
- [ ] AC6: `scripts/test.sh --for-task <this task>` 的 scoped 门禁绿；本任务验收范围按人 2026-10-15 裁定收窄为隔离 worktree 内受控局部验证（7 个相关文件直跑 + scoped 门禁），不要求/不触发一次完整全量 `scripts/test.sh` 跑作为验收证据。

## Definition of Done

- AC1-6 均带真实或受控 fixture 粘贴证据勾选。
- 不部署、不重启任何生产或共享服务（含 ClaudeCodeUI 的 anchor/driver），不触碰主机资源配置或预算。
- 现有测试覆盖与门禁未被削弱；不忽略/屏蔽任何 leak 或 OOM 判定。

## Touches
- packages/quay/test/helpers/live-web-address-fixture.mjs
- packages/quay/test/ac290-criterion-address-derivation.test.mjs
- packages/quay/test/ac292-criterion-address-derivation.test.mjs
- packages/quay/test/ac293-criterion-address-derivation.test.mjs
- packages/quay/test/ac294-criterion-address-derivation.test.mjs
- packages/quay/test/ac295-criterion-address-derivation.test.mjs
- packages/quay/test/ac300-criterion-address-derivation.test.mjs
- packages/quay/test/ac302-criterion-address-derivation.test.mjs
- plugin/scripts/worktree-process-reaper.ts
