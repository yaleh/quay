---
id: gap-routine-semantic-dedup-scan-driver-sleep-requeststop-triple
title: "semantic-dedup-scan: Byte-identical requestStop one-liners and
  wakeResolve-augmented sleep bodies redefined in all three resident-loop
  drivers, which could import the existing driv"
status: ready
labels:
  - gap
  - routine-filed
  - semantic-dedup-scan
parent: null
children: []
extra: {}
---
## Finding
Byte-identical requestStop one-liners and wakeResolve-augmented sleep bodies redefined in all three resident-loop drivers, which could import the existing driver-shared.ts instead.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1791442852793` · ts `2026-10-08T07:00:52.793Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`sleep`、`requestStop`
- 涉及文件：
- `plugin/scripts/outer-driver.ts:410`
- `plugin/scripts/promotion-driver.ts:795`
- `plugin/scripts/quality-gate-driver.ts:1059`
- `plugin/scripts/outer-driver.ts:415`
- `plugin/scripts/promotion-driver.ts:802`
- `plugin/scripts/quality-gate-driver.ts:1063`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
extract

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `driver-sleep-requeststop-triple`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1791442852793`）所描述的问题被复核并处置 —— 复核结论：**属实，且是复算出来的而非采信**。base `c440e9c5b` 上，从三文件各抽 finding 点名的两行（`const requestStop = …` 与 `wakeResolve = resolve;`）后逐字节比较：三份 **md5 全同** `c7673894490cf22183e5fea6037bd59c`（identical-body 成立）；`let wakeResolve` 代码位置出现数 **outer/promotion/quality = 1 / 1 / 1**，`residentLoopStop` = 0 / 0 / 0。处置 = **修掉（extract）**：抽 `residentLoopStop()` 到 finding 自己建议的落点 `plugin/scripts/driver-shared.ts`（停机标志 + 可唤醒 sleep 的单一实现），`driver-runtime.ts` 作 Layer 0 转出，三 driver 改为 import 并走 `stopCtl.isStopRequested() / stopCtl.requestStop / stopCtl.sleep(ms)`；语义逐字保留（requestStop 置标志并唤醒**在飞的** sleep ⇒ 停机延迟 0 而非一个 interval；`wakeResolve` 仅在仍等于本次 resolve 时清空）。硬规则 5b 同载体扫描：修完后全仓 `let wakeResolve` 只剩 **1 处**（`driver-shared.ts` 的单一实现本身），三 driver 均为 **0** —— 缺陷成簇的另一半（「只修被报出来的那一个」）已覆盖。
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案 —— 结论 = **修掉**，四条可复跑读数：①**处置量是一个可读的数**：按代码位置（`git show develop:plugin/scripts/<f>.ts` vs 本分支工作树）枚举 `let wakeResolve` —— **1/1/1 → 0/0/0**；`residentLoopStop(` 调用 —— **0/0/0 → 1/1/1**（每文件另加 import 行，故 grep 得 3/2/2，其中 quality 经 driver-runtime 转出）。②**行为保持**：新增 4 条单测覆盖三语义点 —— 到点 resolve 且未停机 / `requestStop` 唤醒在飞 sleep（实测算 `<2s`，而 sleep 参数是 `60_000` ⇒ 未被唤醒则判据必超时，**判据能取假**）/ `requestStop` 幂等且无在飞 sleep 时不抛；`node --test plugin/test/driver-shared.test.mjs` **11/11 PASS**；三个 driver 既有测试 `node --test plugin/test/outer-driver.test.mjs` + `quality-gate-driver.test.mjs` **45/45 PASS**，`plugin/test/promotion-driver-s0*.test.mjs` + `driver-runtime-s*.test.mjs` + `driver-runtime-control-plane.test.mjs` **97/97 PASS**。③**scoped 门**：`bash scripts/test.sh --for-task gap-routine-semantic-dedup-scan-driver-sleep-requeststop-triple --allow-thin` **EXIT=0，56/56 PASS**（选中本任务的测试文件 + 变更相关分层静态检查）。④**防复发**：`plugin/test/driver-shared.test.mjs` 新增 positional 回归 —— 三 driver 源文件的 `let wakeResolve` 计数必须 **=0** 且必须出现 `residentLoopStop()`，故「顺手再把四行抄回去」会立刻变红（硬规则 9：给规则造产物，而不是写得更醒目）。

## DoD
- [x] 上面的判据实跑通过 —— 上述读数均已实跑：base 三份两行 md5 全同 `c7673894490cf22183e5fea6037bd59c`；before/after 计数 1/1/1 → 0/0/0（`let wakeResolve`）、0/0/0 → 1/1/1（`residentLoopStop` 调用）；`node --test plugin/test/driver-shared.test.mjs` 11/11、`outer-driver.test.mjs`+`quality-gate-driver.test.mjs` 45/45、`promotion-driver-s0*`+`driver-runtime-s*`+`driver-runtime-control-plane` 97/97；scoped 门 `scripts/test.sh --for-task … --allow-thin` EXIT=0（56/56）。
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑 —— 修复由 worker 派发链执行（worktree `quay-worktrees/gap-routine-semantic-dedup-scan-driver-sleep-requeststop-triple`，分支 `task/gap-routine-semantic-dedup-scan-driver-sleep-requeststop-triple`，提交 `07c0c3ee3`）；例程探针只往 `.quay/routine-findings.jsonl` 写 finding 记录并机械立案，未执行任何修复，亦未改动被扫描文件。

## Touches
- `plugin/scripts/driver-shared.ts`
- `plugin/scripts/driver-runtime.ts`
- `plugin/scripts/outer-driver.ts`
- `plugin/scripts/promotion-driver.ts`
- `plugin/scripts/quality-gate-driver.ts`
- `plugin/test/driver-shared.test.mjs`
- `tasks/gap-routine-semantic-dedup-scan-driver-sleep-requeststop-triple.md`