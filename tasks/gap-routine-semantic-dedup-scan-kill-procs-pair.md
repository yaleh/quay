---
id: gap-routine-semantic-dedup-scan-kill-procs-pair
title: "semantic-dedup-scan: ~55 identical lines duplicated across two plugin
  scripts; the reaper's own comment says 'Same contract as
  orphan-session-check.ts'."
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
~55 identical lines duplicated across two plugin scripts; the reaper's own comment says 'Same contract as orphan-session-check.ts'.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `semantic-dedup-scan` · probe `semantic-dedup-scan` · runId `semantic-dedup-scan-1791238550062` · ts `2026-10-05T22:15:50.062Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`killProcs`
- 涉及文件：
- `plugin/scripts/orphan-session-check.ts:220`
- `plugin/scripts/worktree-process-reaper.ts:509`
- kind：`byte-identical-body`
- verdict：`real-duplication`

## Requested action
extract to a shared plugin module imported by both reapers

## 处置（2026-10-06，复核 + 修复）
**结论：real-duplication 成立，已修**（不是「已注意到」，也不是「已有机制在管」）。

修法：两处 byte-identical 的 `killProcs` 抽到**新的共享模块** `plugin/scripts/process-kill-lib.ts`（唯一实现），
两个 reaper 各自改为 `import { killProcs } from "./process-kill-lib.ts"; export { killProcs };`。
保留各自的 re-export 键，所以**两处调用点与各自测试的 import 站点逐字不变**（同 `worktree-process-reaper.ts`
对 kernel 的 `readProcCmdline`/`isQuayServe` 已有的「本地绑定 + 再导出」形状）。

**逐字差异核实**：抽取前两体 **code-identical**，只差注释、以及 orphan 版多一对死代码
`const t0 = Date.now(); void t0;`（无副作用，删与不删等价）。抽取采用 reaper 版（干净版）。

**可核读数（本轮实跑）**：
- `grep -rn "function killProcs" plugin/scripts` ⇒ **1 处**（`process-kill-lib.ts`）；两个 reaper 里已没有函数体，只剩 import + re-export。
- 三处 import 到的是**同一个函数对象**（不是「两份长得一样」）：
  `(await import("process-kill-lib.ts")).killProcs === (await import("orphan-session-check.ts")).killProcs === (await import("worktree-process-reaper.ts")).killProcs` ⇒ `true`。
- 行为契约未变（fail-open 单次计数）：`killProcs([])` ⇒ `{"killed":0,"sigkilled":0,"failed":0}`；
  对两个已消失 pid ⇒ `{"killed":2,"sigkilled":0,"failed":0}`。
- 两 reaper 的测试文件仍从各自 reaper 入口 import `killProcs` 并通过（re-export 生效的证据）。

**5b 同载体扫描（同一原则的其它适用点，⛔ 不只修被报出来的那一个）**：
- 「`killProcs` 定义处」全仓命中 **3**：本模块（唯一实现）、两个 reaper（re-export，非定义）；
  第 3 处是 `plugin/test/helpers/driver-runtime-harness.mjs:443`，**同名异义**——立即 SIGKILL、无宽限、
  无计数，是测试夹具专用，⛔ 与本节契约不同，不合并（属 `source-text-lib.ts` 记过的「同名异义变体」那一类）。
- 「派生铺设集成员的 ESM `./` 依赖不在铺设集内」这一类：扫 126 个派生成员 ⇒ **78 处未登记**
  （含公认共享库 `source-text-lib.ts`、`fs-walk.ts` 等）⇒ 该 (c) 条目**不是被维持的不变量，而是逐实例历史补丁**；
  且本轮实测 `quay-init --all --loop --manager` 只铺 SPEC §6 闭集（`.quay/` 外 3 文件），**脚本已不再拷进消费者项目**
  （`quay-init.sh` 自注：`derive_loop_scripts` / `verify_referenced_landed` 现仅「保留为库函数」供 `laydown-set-check.sh` 调用）
  ⇒ 该类引用原先的 ERR_MODULE_NOT_FOUND 失效前提已不存在。
  ⇒ 故本模块**不加** `quay-init.sh` 的 (c) 显式条目：加了既修不了这个类（78 处仍在），又会改 `quay-init.sh`
  进而要求重锚 `docs/analysis/quay-init-closure-ratchet.baseline.json`。**此处显式记明理由，⛔ 不是静默略过。**
- 另记一处**不再适用**的失效前提：全仓 grep `ERR_MODULE_NOT_FOUND` 命中的 78 处 ESM 依赖里，本节只新增 1 处 import，
  而该处与已有的 78 处同类 —— 属**既存状态**，本任务不扩张范围去修整个类。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `kill-procs-pair`（routine `semantic-dedup-scan`，runId `semantic-dedup-scan-1791238550062`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `plugin/scripts/orphan-session-check.ts`
- `plugin/scripts/worktree-process-reaper.ts`
- `plugin/scripts/process-kill-lib.ts`
- `plugin/scripts/capability-catalog-declarations.json`
- `tasks/gap-routine-semantic-dedup-scan-kill-procs-pair.md`
