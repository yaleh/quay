---
id: gap-routine-semantic-dedup-scan-server-verifier-twin-scripts
title: "semantic-dedup-scan: 216 of 491 non-comment lines in
  server-partial-stop-verify reappear verbatim in server-restart-inflight-verify
  (44 percent vs 40 percent); five helpers are byt"
status: done
labels:
  - gap
  - routine-filed
  - semantic-dedup-scan
parent: null
children: []
extra: {}
---
## Finding
216 of 491 non-comment lines in server-partial-stop-verify reappear verbatim in server-restart-inflight-verify (44 percent vs 40 percent); five helpers are byte-identical, runCli differs only by the timeout literal, and the restart file imports lastLine/parseRoundRecord from its twin at line 81, making the copy lineage explicit.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1792560001684` · ts `2026-10-21T05:20:01.684Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`resolveCliPath`、`readServerCarrier`、`isIsoInstant`、`out`、`runCli`、`sleep`
- 涉及文件：
- `plugin/scripts/server-partial-stop-verify.ts:211`
- `plugin/scripts/server-partial-stop-verify.ts:423`
- `plugin/scripts/server-partial-stop-verify.ts:441`
- `plugin/scripts/server-partial-stop-verify.ts:449`
- `plugin/scripts/server-partial-stop-verify.ts:456`
- `plugin/scripts/server-partial-stop-verify.ts:460`
- `plugin/scripts/server-restart-inflight-verify.ts:306`
- `plugin/scripts/server-restart-inflight-verify.ts:447`
- `plugin/scripts/server-restart-inflight-verify.ts:454`
- `plugin/scripts/server-restart-inflight-verify.ts:461`
- `plugin/scripts/server-restart-inflight-verify.ts:465`
- `plugin/scripts/server-restart-inflight-verify.ts:481`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
extract

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `server-verifier-twin-scripts`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1792560001684`）所描述的问题被复核并处置 —— 复核：finding 的机械谓词实跑复现（216/491 = 44.0%，与 finding 逐字相符）；处置 = 修掉（extract），六个被点符号在 `plugin/scripts/gate-script-base.ts` 只定义一次，两个验证器改为 import，两文件内的定义副本 12 → 0
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案 —— 修掉的取证见下方 `## Evidence`：修前/修后同尺读数、新测试 15/15（含在 fixture 上双向演练过的谓词）、既有四个测试文件 100/100 未回归

## DoD
- [x] 上面的判据实跑通过 —— `plugin/test/server-verifier-twin-helpers.test.mjs`（15/15 pass，含 finding 自己的 body 谓词与 180 s / 300 s 预算区分）；`server-partial-stop-verify` / `server-restart-inflight-verify` / `gate-script-base` / `gate-script-base-adoption` 四个既有测试文件 100/100 pass
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑 —— 本条由 worker 派发链执行；探针只产出了 finding 记录，未改动任何被点文件

## Touches
- `plugin/scripts/server-partial-stop-verify.ts`
- `plugin/scripts/server-restart-inflight-verify.ts`
- `plugin/scripts/gate-script-base.ts`
- `plugin/test/server-verifier-twin-helpers.test.mjs`
- `tasks/gap-routine-semantic-dedup-scan-server-verifier-twin-scripts.md`

## Evidence

处置 = **修掉（extract）**，⛔ 不是「已注意到」。抽取落点 = `plugin/scripts/gate-script-base.ts` —— 两个验证器本来就
已经 import 的「TS gate 脚本共享原语」模块（同族的 `flagValue` / `printJson` / `serializeSortedJson` / `git` 都落在那里），
而不是新造一个模块：这条边界正是该模块自己声明的那个问题（「Do TypeScript gate scripts share the framework
primitives they need?」）。

**finding 的机械谓词，修前/修后同尺对拍**（同一段脚本：去空行/去注释/去首尾空白后，按多重集求交）：
- 修前（`git show develop:<file>`）：partial 491 行 / restart 545 行，**216 行重现 = 216/491 = 44.0%** ——
  与 finding 的「216 of 491（44 percent）」逐字相符，说明这把尺子量的就是它，而不是我另立的一个量。
- 修后（本分支）：457 / 514，重现 185 行（40.5%）；**六个被点符号的定义副本 12 → 0**。
- 残余重叠的构成（逐块核对，不是估计）：两侧 import 同一批共享符号（11 行 —— 这是抽取的**目标态**，不是残留副本）、
  `BuildResult` 接口（6 行）、`main()` 的公共参数/usage 前导（15 行）、末尾 emit + append 记录块（约 20 行）、
  `main(process.argv).then(...)` 收尾（4 行），其余是 `}` / `return {` / `ok: false,` 这类 2 行语法片段。
  这些是**两个不同 AC（AC-254 / AC-256）各自的总控流程**里的平行结构，不是同一函数体的副本；finding 点名的六个符号已全部单一化。

**形状与行为边界**：
- 六个符号现在只在 `gate-script-base.ts` 定义一次；两个验证器 import。`isIsoInstant` 在两个文件里保留**再导出**
  （它们自己的测试从这个模块 import 它），定义仍只有一份。
- ⛔ 两处副本唯一真实的差异 —— `runCli` 的 spawn timeout（partial 180 s / restart 300 s，后者要等一次真实的
  driver 重启）—— 抽成**参数**（默认 180 s），restart 继续显式传 `RESTART_CLI_TIMEOUT_MS = 300000`；有测试钉住，
  防止将来被「统一」掉（那只会以「忙主机上真实重启超时」的形式暴露）。
- `readServerCarrier` 保持**宽松**（pid 整数 + services 数组），⛔ 没有换成 Core 的严格 `readServerState`
  （还要求 schemaVersion / startedAt）—— 那会把一份真实可读的 carrier 翻成 unreadable ⇒ NOT-EVALUATED，属于行为变更。
  `SERVER_STATE_REL` 字面量随之从两个文件收敛为一份；product 侧 Core 的 `server-state.ts` 保留自己那一份（跨边界不
  互相 import：本模块会被 inline 进每个引用它的 shipped bundle，为一个字符串把 Core 拖进去不划算）。
- 另加 `cliArgv()` 纯函数把 `runCli` 的 argv 组装拆出来，让 `.ts`/`.js` 分支**可观测**而不必执行 —— CI 的 Node 底线
  跑不了 `.ts` fixture，只靠 dev 主机才能读的契约不算测量（硬规则 4 推论三）。

**判据实跑（本 worktree）**：
- `node --no-warnings --test --experimental-strip-types plugin/test/server-verifier-twin-helpers.test.mjs` ⇒ **15/15 pass**。
  谓词先在 fixture 上**双向**演练（定义源码读 true；注释提及、import、以及只是包含该名字的另一个标识符都读 false），
  再对真文件跑 —— 硬规则 2 / 3b 的两半都做了。
- 既有 `plugin/test/{server-partial-stop-verify,server-restart-inflight-verify,gate-script-base,gate-script-base-adoption}.test.mjs`
  ⇒ **100/100 pass**（行为面未回归）。

**划界（本条不声称什么）**：
- 名字相同的**不同实现**不动：`runCli` 另有四个检查器各写一份（`task-ac-carryover-check` / `task-contract-check` /
  `tmux-test-isolation-check` / `threshold-scope-check`，签名是 argv[] → exit code，语义不同）；`sleep` 另有
  `driver-runtime.ts` 与 `start-drivers.ts` 两个单行副本（后者是零依赖 laydown 入口，按既有约定不能 import 任何东西）。
  finding 点名的是这两个验证器之间的复制；本条按 finding 的范围收敛，并把同族命中记在这里（硬规则 5b）。
- 不把两个验证器合并成一个 —— 它们验证 AC-254 与 AC-256 两个不同判据，合并会把两份判定逻辑耦合起来。

实现提交：`1d78fe7d3`（分支 `task/gap-routine-semantic-dedup-scan-server-verifier-twin-scripts`）。
