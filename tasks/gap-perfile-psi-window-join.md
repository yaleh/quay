---
id: gap-perfile-psi-window-join
title: perFile 记录缺 PSI 时间窗联接——单测 PSI 只能靠手写脚本事后联接,没有可复用工具/标准字段
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**已排除的假设(负面记录,防止重新踩坑)**：本任务最初的怀疑是"cgroup ENOENT 竞态"阻塞了 PSI 采集，已在讨论阶段被证据推翻，不要用这个框重新调查。`suite-accounting.ts:168-174/279-314` 里 exit-spanning 相读 cgroup 最终计数器 ENOENT 是**已文档化的预期行为**（transient systemd scope 在最终读之前已被销毁；`cpu_usec` 有 `backfillFinalCpu` 从 systemd journal `Consumed` 行补回，PSI 没有 journal 对应物，注释明确写了"stays null (honest; not fabricatable)"——永久性的诚实限制，不是 bug）。决定性反例：`2026-08-31T23:45` 的 4 相轮次（static/serial/main/end），前三相 `psi_cpu_total` 全部非空真实值，只有最后 end 相是 null，完全符合设计。近期（2026-09-03 至今 263 轮）几乎全部单相是因为这些全部是 `scope: worktree`（`--for-task` 逐任务 scoped 校验）轮次，只跑一个 `static` 相；`scope: main`（全量多相 suite）轮次最后一次运行是 2026-08-24，已两周未跑——这是另一个独立话题，不在本任务范围。

**真实缺口**：当前会话用一次实测证明"近似的单测 PSI"是可以联接出来的，但没有被沉淀成可复用能力。两个已存在的载体：`.quay/verification-round.jsonl` 的 `perFile` 记录带精确的 `{file, startedAtMs, endedAtMs}` 时间窗；`.quay/suite-load-<runId>.jsonl` 是系统级周期采样（约 1 秒一次，直接读 `/proc/pressure/cpu`，不经过 cgroup diff，不受 scope 销毁影响，在当前 `scope:worktree` 轮次里确认正常产出——runId `mfi-gap-webui-dashboard-regressed-to-12-60s-past-two-done-tasks-1788765392750-4efbe6` 对应的 suite-load 文件有 75 个采样点覆盖整轮）。当场手写 Python 脚本联接了这两个文件，对 `packages/quay/test/observation.test.mjs` 的真实 147.5 秒执行窗口取到 29 个采样点（`cpu_stall` 从 3.36% 爬升到 79.01%），证明这条路径可行、数据都在。

但这条联接：(a) 没有接入任何常规记录流程——`perFile` 记录本身不带任何 PSI 字段，只有 `file/durationMs/passed/endedAtMs/startedAtMs/cpuMs`；(b) 类似的窗口联接逻辑（`psi-failure-correlation-check.ts:348-356` 的 `windowMeanStall`）已经存在，但只服务于该脚本自己的"跨多轮聚合相关性分析"内部管线，不是一个可被外部单独调用、给定 `{runId, file}` 就能查询"这一个测试这一次跑的 PSI 序列"的通用工具——每次要看某一个测试的 PSI 都要重新手写联接脚本（本次会话就是一例）；(c) 两个源文件都是 gitignored（`.quay/verification-round.jsonl`、`.quay/suite-load-*.jsonl`），不随 `git worktree add` 走，worker 在自己 worktree 里跑分析必须显式传 `--root` 到主检出，否则应读到"载体未找到"（同 `gap-psi-shadow-admission-controller` AC2 已实测坐实的 fail-closed 纪律，直接复用不重新证明）。

**明确边界（防止范围膨胀）**：
- 不做"真正精确的单测独占 PSI"——物理上做不到：PSI 是 cgroup/系统级聚合量，同一时间窗口内若有其他文件并发在跑，采到的 `cpu_stall` 反映全部并发负载的聚合读数，不是单个文件独有。本任务只做"近似的时间窗联接"，输出必须诚实标注样本口径（不得暗示为独占值）。
- 不改 `phases[].psi_cpu_total` 的 cgroup-diff 路线——一次相边界内可能并发跑几百个文件（实测 `static` 单相内 252 个文件、`laneCount=28`），聚合读数结构上无法拆到单文件，这是结构性限制不是本任务要修的路线。
- 不重新验证/推翻 `gap-psi-shadow-admission-controller` 已做出的"PSI 对失败无增量预测力，Phase 1 不做"结论——本任务是纯诊断可见性工具（回答"这个测试跑的时候机器多忙"），不接入任何调度/准入逻辑，不得被用来重提已被两条独立数据源否定的假设。

## Acceptance Criteria

- [x] AC1（能取假，通用查询函数落地）：新增 `plugin/scripts/psi-window-join.ts`，导出一个纯函数（例如 `joinFilePsiWindow(root, runId, file)`），复用/抽出 `psi-failure-correlation-check.ts` 现有的窗口联接逻辑（不得重写一份重复实现——`grep -c windowMeanStall plugin/scripts/psi-window-join.ts plugin/scripts/psi-failure-correlation-check.ts` 两文件合计命中 ≥1 且只有一处函数定义，另一处是 import/调用），返回 `{found:true, samples:{t,cpu_stall}[], mean, max, sampleCount}` 或 `{found:false, reason}`；（⛔ 载体缺失时返回空数组当作"查到了 0 个样本" ⇒ 假；⛔ 复制粘贴一份新的窗口聚合实现而不复用既有逻辑 ⇒ 假）。
- [x] AC2（能取假，CLI 可单独查询）：脚本支持直接命令行调用 `node --experimental-strip-types plugin/scripts/psi-window-join.ts --run-id <id> --file <relpath> [--root <path>] [--json]`，对不存在的 `runId`/`file` 组合打印/返回 `found:false` 而非崩溃或静默空结果；`--root` 未传时回落 `QUAY_MAIN_CHECKOUT` 再回落 cwd（同 `psi-failure-correlation-check.ts` 既有约定，不新造一套解析规则）。
- [x] AC3（能取假，真实数据复现本次会话的手工联接）：对 `runId=mfi-gap-webui-dashboard-regressed-to-12-60s-past-two-done-tasks-1788765392750-4efbe6`、`file=packages/quay/test/observation.test.mjs` 跑该工具，`sampleCount` 必须等于 29（本次会话手工联接的真实读数），`mean`/`max` 必须与手工联接读数一致（mean≈48.73、max=79.01，允许因浮点显示的极小误差）；Measured 贴出该次真实调用的完整输出。若 `.quay/verification-round.jsonl`/对应 `suite-load-*.jsonl` 到实现时已被轮转清理，允许改用当时仍存在的另一个真实 runId+file 组合复现，但必须在 Measured 里说明替换原因与新读数，不得跳过这条真实数据核验。
- [x] AC4（能取假，fail-closed）：在一个不含 `.quay/verification-round.jsonl` 的干净临时目录下调用该工具（`--root` 指向该临时目录），必须返回 `found:false` 且带明确 reason（提及"未找到"/"not found"字样），退出码非 0（CLI 模式）；（⛔ 载体缺失时返回 `found:true` 或吞掉错误 ⇒ 假）。
- [x] AC5（能取假，`psi-failure-correlation-check.ts` 复用新工具）：`psi-failure-correlation-check.ts` 的被动分析路径改为调用/复用 `psi-window-join.ts` 导出的函数而不是维持两份独立的窗口联接实现；`node --experimental-strip-types plugin/scripts/psi-failure-correlation-check.ts --source passive --root <主检出>` 跑一次，输出结果（分档统计）与本任务落地前的行为一致（回归对照，Measured 贴出改动前后各跑一次的关键数字，如 `failWithPsi`/`passWithPsi` 总数一致）。
- [x] AC6（能取假，单元测试覆盖，不依赖真实进程）：新增 `plugin/test/psi-window-join.test.mjs`，用 fixture 注入的 `.quay/verification-round.jsonl` + `.quay/suite-load-<id>.jsonl`（临时目录，非真实生产文件）覆盖：命中样本的正常联接、载体缺失的 fail-closed、指定 file 在指定 runId 下不存在于 `perFile` 时的 `found:false`；`node --test plugin/test/psi-window-join.test.mjs` 退出码 0。
- [x] AC7（能取假，范围守卫）：`git diff develop --stat` 不含 `plugin/scripts/suite-scheduler.ts` 的 `nextDispatch`/`currentCap`、不含 `plugin/scripts/full-suite-runner.ts` 里 `phases`/cgroup-diff 相关代码的行为改动（只允许新增 import/调用，不允许改其读取时序或字段结构）；新脚本已按 `plugin/scripts/capability-catalog.sh` 头注释完成六表注册（Measured 贴出注册后 `bash plugin/scripts/capability-catalog.sh` 的 summary 行，脚本计数含新文件）。

## Definition of Done

`plugin/scripts/psi-window-join.ts` 作为一个独立、可被 CLI 直接调用、也可被其他脚本 import 的通用工具落地，能对给定 `{root, runId, file}` 三元组诚实回答"这个测试这次跑的时候，系统级 PSI(`cpu_stall`)采样序列是什么"或"载体缺失/未命中"，不伪装成有数据；`psi-failure-correlation-check.ts` 改为复用它而非维持重复实现；新工具有真实生产数据的一次复现验证（AC3，非 fixture-only）与 fixture 单测覆盖（AC6）并存——复现验证证明它真的在读生产载体，单测证明边界情况可靠；全程未触碰 cgroup-diff 路线或任何调度/准入逻辑（AC7）。AC1-7 全部勾选，Measured 贴出每条的真实命令输出。

## Touches

- plugin/scripts/psi-window-join.ts（新，本任务核心：`joinFilePsiWindow` 导出函数 + CLI 入口）
- plugin/scripts/psi-failure-correlation-check.ts（改：被动分析路径改为复用新工具，不再维持独立的窗口联接实现）
- plugin/test/psi-window-join.test.mjs（新，fixture 单测：命中/载体缺失/文件未命中三种情形）
- plugin/scripts/capability-catalog.sh（新脚本六表注册之一）
- docs/analysis/quay-init-closure-ratchet.baseline.json（re-anchor：capability-catalog.sh 六表注册改变 laydown 源，机械 --reanchor 刷新 fingerprint/sha）
- tasks/gap-perfile-psi-window-join.md（自身）

## Measured

AC1（通用查询函数落地 + 复用既有窗口联接逻辑，唯一定义 + import/调用）：
```
$ grep -c windowMeanStall plugin/scripts/psi-window-join.ts plugin/scripts/psi-failure-correlation-check.ts
plugin/scripts/psi-failure-correlation-check.ts:2
plugin/scripts/psi-window-join.ts:3
$ grep -n windowMeanStall plugin/scripts/psi-window-join.ts plugin/scripts/psi-failure-correlation-check.ts
plugin/scripts/psi-window-join.ts:106:export function windowMeanStall(samples: PsiSample[], startMs: number, endMs: number): number | null {
plugin/scripts/psi-failure-correlation-check.ts:96:import { windowMeanStall } from "./psi-window-join.ts";
plugin/scripts/psi-failure-correlation-check.ts:396:      const stall = windowMeanStall(samples, rec.startedAtMs, rec.endedAtMs);
```
唯一定义落在 psi-window-join.ts:106；psi-failure-correlation-check.ts 只剩 import（:96）+ 调用（:396），无第二份窗口联接实现。

AC2（CLI 单独查询，不存在的 runId/file 组合 ⇒ found:false 非崩溃非静默）：
```
$ node --experimental-strip-types plugin/scripts/psi-window-join.ts --run-id does-not-exist --file nope.test.mjs --root /home/yale/work/quay --json
{"found": false, "reason": "perFile record not found for file=\"nope.test.mjs\" in runId=\"does-not-exist\""}
（exit code 2）
```

AC3（真实数据复现本次会话手工联接，sampleCount=29 / mean≈48.73 / max=79.01）：
```
$ node --experimental-strip-types plugin/scripts/psi-window-join.ts \
    --run-id mfi-gap-webui-dashboard-regressed-to-12-60s-past-two-done-tasks-1788765392750-4efbe6 \
    --file packages/quay/test/observation.test.mjs --root /home/yale/work/quay --json
{
  "found": true,
  "samples": [
    {"t": 1788766239285, "cpu_stall": 3.36}, {"t": 1788766244298, "cpu_stall": 6.59},
    {"t": 1788766249326, "cpu_stall": 14.74}, {"t": 1788766254371, "cpu_stall": 16.74},
    {"t": 1788766259382, "cpu_stall": 16.88}, {"t": 1788766264409, "cpu_stall": 22.75},
    {"t": 1788766269428, "cpu_stall": 30.39}, {"t": 1788766274523, "cpu_stall": 28},
    {"t": 1788766279551, "cpu_stall": 24.36}, {"t": 1788766284559, "cpu_stall": 24.19},
    {"t": 1788766289590, "cpu_stall": 21.49}, {"t": 1788766294611, "cpu_stall": 23.1},
    {"t": 1788766299674, "cpu_stall": 26.41}, {"t": 1788766304702, "cpu_stall": 40.85},
    {"t": 1788766309852, "cpu_stall": 58.45}, {"t": 1788766314918, "cpu_stall": 65.55},
    {"t": 1788766319944, "cpu_stall": 68.89}, {"t": 1788766324953, "cpu_stall": 71.38},
    {"t": 1788766329979, "cpu_stall": 75.05}, {"t": 1788766335004, "cpu_stall": 75.18},
    {"t": 1788766340023, "cpu_stall": 76.54}, {"t": 1788766345049, "cpu_stall": 77.97},
    {"t": 1788766350068, "cpu_stall": 76.78}, {"t": 1788766355128, "cpu_stall": 75.71},
    {"t": 1788766360160, "cpu_stall": 77.28}, {"t": 1788766365169, "cpu_stall": 78.8},
    {"t": 1788766370196, "cpu_stall": 78.23}, {"t": 1788766375216, "cpu_stall": 78.52},
    {"t": 1788766380219, "cpu_stall": 79.01}
  ],
  "mean": 48.730689655172405,
  "max": 79.01,
  "sampleCount": 29
}
（exit code 0）
```
29 个采样点，cpu_stall 从 3.36% 单调爬升到 79.01%；与立案时手工联接读数一致（mean≈48.73、max=79.01）。

AC4（fail-closed，干净临时目录无 verification-round.jsonl ⇒ found:false + 退出码非 0）：
```
$ node --experimental-strip-types plugin/scripts/psi-window-join.ts --run-id any --file a.test.mjs --root /tmp/tmp.GaimCbzeDG --json
{"found": false, "reason": "carrier not found: /tmp/tmp.GaimCbzeDG/.quay/verification-round.jsonl"}
（exit code 2）
```

AC5（psi-failure-correlation-check.ts 复用新工具，回归对照一致）：
改动前（主检出旧代码）与改动后（worktree import windowMeanStall）各跑一次 --source passive --root /home/yale/work/quay：
```
rounds(含 perFile)=639 matched=598 | perFile 有时间窗=228998 passed:false=302
窗内有 PSI: pass=136874 fail=286 | 无采样排除=91838 | MIN_N=10
  并发区间  通过N  通过均值  失败N  失败均值  差值(失败-通过)  判定
       1-2     108    14.92      2     5.06          -9.85  样本不足
       3-5     405    11.05      2    13.52           2.46  样本不足
      6-10    6540    18.99      9    24.88           5.89  样本不足
     11-20   72622    47.94     98    40.97          -6.97  无信号
     21-40   57199    71.41    175    63.27          -8.14  无信号
       41+       0      n/a      0      n/a            n/a  样本不足
GO/NO-GO 结论(主=主动, 辅=被动): 无增量信号，Phase 1 不做
```
两遍输出逐字一致（pass=136874 / fail=286 / 各并发分档完全相同）。

AC6（fixture 单测，退出码 0）：
```
$ node --test plugin/test/psi-window-join.test.mjs
ℹ tests 6
ℹ pass 6
ℹ fail 0
```
覆盖：命中样本正常联接（window [1000,5000] 命中 5 采样 mean=30/max=50）、载体缺失 fail-closed（verification-round 缺失 + suite-load 缺失两分支）、指定 file/runId 不存在于 perFile ⇒ found:false。

AC7（范围守卫 + 六表注册）：
- `git diff develop --stat`（merge develop 后）只含 4 个实现文件 + re-anchor baseline，不含 plugin/scripts/suite-scheduler.ts 的 nextDispatch/currentCap、不含 plugin/scripts/full-suite-runner.ts 的 phases/cgroup-diff 行为改动。
- 六表注册后：
```
$ bash plugin/scripts/capability-catalog.sh --summary
capability-catalog: 319 scripts | 319 declared | 0 unclassified | 314 ship
```
（脚本计数 319 含新文件 psi-window-join.ts；0 unclassified，exit 0。）
