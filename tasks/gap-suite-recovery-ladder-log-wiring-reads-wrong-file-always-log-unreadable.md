---
id: gap-suite-recovery-ladder-log-wiring-reads-wrong-file-always-log-unreadable
title: 恢复阶梯每档读错日志——argv 的 --log-file 未按档改写，classifyRecoveryRound 恒
  log-unreadable，即便该档其实完整零 OOM
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
depends_on:
  - gap-suite-verdict-green-on-oom-killed-incomplete-run-lands-on-11-percent-of-files
---
## Proposal

**发现于本会话的只读 fan-in 错误审计（2026-10-15），当场复核仍在实时发生**：`gap-suite-verdict-green-on-oom-killed-incomplete-run-lands-on-11-percent-of-files`（done，14/14 AC）落地的 OOM/incomplete 低并发恢复阶梯，在生产上**结构性失能**——它从未真正证实过一档恢复轮的完整绿，即便那一档其实是干净、完整、零 OOM 的。

**查重结果**：全库搜索 `recoverySuiteCommand`/`classifyRecoveryRound`/`recLogFile`/`log-unreadable` 等字面量，命中的任务只有 `gap-suite-verdict-green-on-oom-killed-incomplete-run-lands-on-11-percent-of-files`（落地该机制的原任务）与下游引用它的 `gap-suite-resource-measurement-needs-a-host-adapter-not-inline-cgroup-calls`（`needs-human`，其阻碍记录里把本缺陷列为"不在自己 diff 里"的真因之一）。**没有任何现有任务把本缺陷本身登记为独立的修复对象**，故本任务是新建，不是重复。

**实测根因（当场复核，行号为本次读取时的真实行号）**：
1. `worker-fan-in.ts:1958`：主轮给 `full-suite-runner.ts` 的 argv 里带 `--log-file <suiteLogFile>`。
2. `worker-fan-in.ts:879-883`：`recoverySuiteCommand(base, n)` 只做 `[...base, "--lane-count", String(n)]`——**原样保留 `base` 里那个 `--log-file <suiteLogFile>`，没有把它替换成本档自己的日志路径**。
3. `worker-fan-in.ts:2930-2934`：恢复轮另起一个 `recLogFile`（命名形如 `recovery-${n}-${suffix}`）传给 `spawnSuiteAndWait`，但那只是外层 wrapper 捕获 `child.stdout` 的落点。
4. `suite-driver.ts:204-205`：`spawnSuiteAndWait` 只把 `child.stdout` tee 进它拿到的 `logFile`；而 `full-suite-runner.ts` 真正的 `SUITE-PLAN`/`__PERFILE__` 结构化输出是按**自己 argv 里的 `--log-file`**（仍是原始 `suiteLogFile`，被每一档依次覆写）直接写文件的，不经过 stdout。
5. `classifyRecoveryRound`（`worker-fan-in.ts:827`，缺省分支在 836 行落 `"log-unreadable"`）读的是那个几乎空的 `recLogFile`，永远读不到真内容 ⇒ 每一档恒 `no-conclusion(log-unreadable)`。

**真实生产实例（今天，2026-10-15，三个独立任务各命中 ≥1 次）**：
```
gap-routine-...-list-script-basenames...: round 2715(lane48,red/failed,584/584,oom=1) → round 2716(lane32,red/aborted,584/584,oom=0)
  fan-in 仍判：suite-recovery×3 "log-unreadable" → suite-recovery-blocked "no declared rung produced a complete verdict"
gap-routine-...-defaultroot-byte-identical-quad...: round 2719(lane48,red/failed,583/583,oom=1) → round 2720(lane32,red/failed,583/583,oom=0)
  fan-in 仍判：同上三连 "log-unreadable" → exhausted
```
`verification-round.jsonl` 自己的记录（由 runner 独立写，不经过本缺陷读的那份日志）证明：floor 档（32）在两个案例里都是**完整、零 OOM 的真实结论**（一个是遗留进程误判 aborted，一个是真实断言失败）——不是"读不到结论"，是分类器读错了文件。三个任务各烧掉 3 次满量重跑（每次约 5 分钟）后 `exited-not-landed`。

## Plan

1. 修复 `recoverySuiteCommand`（或其调用点）：每一档恢复轮必须让 `full-suite-runner.ts` 自己的 `--log-file` 参数指向**该档专属的** `recLogFile`，而不是原样沿用 `base` 里的原始路径——实现时先确认当前 `recoverySuiteCommand` 签名是否该接收 `recLogFile` 作为参数来替换 argv 里的 `--log-file` 值,而不是仅由调用方另传一个 `logFile` 给 `spawnSuiteAndWait`（两件事当前被当成同一件事,实际不是）。
2. `classifyRecoveryRound` 的判定来源改为读**该档自己真正写入的那份结构化日志**（即 runner argv 里 `--log-file` 真正指向的文件），不是 `spawnSuiteAndWait` 的 stdout 捕获文件——或者如果两者语义上应当是同一个文件,则要让 argv 覆盖生效,使 runner 真的把结构化输出写进调用方期望读取的那个路径。
3. 不改变现有「某档确实读不到/确实没跑完」时报 `log-unreadable`/`no-conclusion` 的语义——那条路径本身是对的（见硬规则 3b：无法评估要显式说明），本任务只修"明明有真实结论、却被误判为读不到"的那一半。
4. 负控制：构造一个真实完整、零 OOM 的恢复档（fixture 或对真实 `full-suite-runner.ts` 做最小规模调用），证明修复前它被误判 `log-unreadable`，修复后能被正确读出其真实 `planned/terminal/oomKill` 结论。
5. 保留现有判据不变：不放宽/不忽略真正的 OOM 计数，不放宽 `missing==0`/`oomKill==0`/完整阶段的认证门槛（AC10-14 的既有语义继续生效），不提高 16GiB `MemoryMax` 上限。
6. **验证方式按本次授权收窄**：在隔离 worktree 内对 `worker-fan-in.ts`/`suite-driver.ts` 相关单测跑**定向/受限范围**验证（`scripts/test.sh --for-task <this task>` 的 scoped 门禁 + 直接运行受影响的单测文件），**不要求触发一次昂贵的全量 `scripts/test.sh` 跑**，不部署，不重启任何生产/共享服务。

## Acceptance Criteria

- [ ] AC1: 在实现前重新核对当前 `recoverySuiteCommand`/`classifyRecoveryRound`/`spawnSuiteAndWait` 的真实代码（粘贴核对结果，含行号）——确认 Proposal 里描述的"argv 里的 `--log-file` 未被替换"这一现状在实现时仍然成立（不信 Proposal 的静态抄录，代码可能已变化）。
- [ ] AC2: 恢复轮的每一档都读到**自己真实写出的日志**，不再混用原始轮/其它档覆写过的文件（粘贴真实或 fixture 复现的「档 N 的日志路径 = 档 N 实际写入的路径」证据）。
- [ ] AC3: 负控制——构造一个真实完整、零 OOM 的恢复档，修复前验证它被误判 `log-unreadable`（粘贴修复前的误判输出），修复后同一档被正确读出 `planned==terminal`、`oomKill==0` 的真实结论（粘贴修复后输出）。
- [ ] AC4: 一个真正读不到/真正没跑完的档，修复后仍然正确报 `log-unreadable`/`no-conclusion`（不把"真的读不到"误判成"读到了"——负控制的另一半，硬规则 3b 两个方向都要测）。
- [ ] AC5: 既有 AC10-14（`gap-suite-verdict-green-on-oom-killed-incomplete-run-lands-on-11-percent-of-files`）的判据语义不变：不放宽 `missing==0`/`oomKill==0`/完整阶段的认证门槛，不把 OOM/unknown/缺失记录混进 `runBaselineEquivalence` 的比较集合（粘贴相关既有测试仍绿的证据）。
- [ ] AC6: `.quay/config.yml` 等预算/内存上限（16GiB `MemoryMax`）未被本任务改动（grep/diff 证据）。
- [ ] AC7: `scripts/test.sh --for-task <this task>` 的 scoped 门禁绿；不要求/不触发一次完整的全量 `scripts/test.sh` 跑作为验收证据（本任务验收范围按人 2026-10-15 裁定收窄为隔离 worktree 内的受控局部验证）。

## Definition of Done

- AC1-7 均带真实或受控 fixture 粘贴证据勾选。
- 不部署、不重启任何生产或共享服务（含 ClaudeCodeUI 的 anchor/driver），不触碰主机资源配置或预算。
- 现有测试覆盖与门禁未被削弱；不忽略/屏蔽任何 leak 或 OOM 判定。

## Touches
- plugin/scripts/worker-fan-in.ts
- plugin/scripts/suite-driver.ts
- plugin/test/worker-fan-in.test.mjs
- plugin/test/suite-driver.test.mjs
