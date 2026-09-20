---
id: gap-judgment-rewrites-route-through-proc-identity-leaf
title: ~6 处真 TS 站点手搓 /proc/&lt;pid&gt;/cmdline，未走 kernel leaf
  proc-identity.ts；同时收窄判定重写指纹使纯快照收集器出列
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

检测器 `identity-replication-check.ts` 的判定指纹（**读 `/proc/<pid>/cmdline` ∧ 对读到的内容做名字/特征比较**）在本仓报出 **20 处**。逐条去噪后（2 条是 `experiments/…` 的软链镜像、4 条是 test 文件、2 条在 `packages/quay/plugin/`（gitignored 副本）下、2 条是 `.sh`（不能 import TS））剩下 **~6 处真实 TS 站点**，各自手搓 `/proc/<pid>/cmdline` 解析。

而 kernel leaf `packages/quay/src/kernel/proc-identity.ts` **已经**导出了这两个判定的单一实现：`readProcCmdline(pid)`（:37）与 `isQuayServe(cmdline)`（:56），目前消费者只有 `worktree-process-reaper.ts`（import + re-export）与 `packages/quay/src/serve.ts`。

站点点名（立案时检测器 AC2 段的现场读数 + 逐处 `sed` 核实的形态）：

| 文件:行 | 形态 |
|---|---|
| `packages/quay/src/observation.ts:2566` | `readdirSync("/proc")` + `readFileSync(\`/proc/${pid}/cmdline\`)` + `cmd.includes(needle)`，失败返回 `null`（"unknown"） |
| `plugin/scripts/orphan-session-check.ts:150` | `readProcArgv(pid)` —— 与 kernel leaf `readProcCmdline` 逐字同形（NUL split + 失败 `null`） |
| `plugin/scripts/manager-tick-readings.ts:249` | `readCmdline(pid, procRoot="/proc")` —— `readProcArgv` 的重写，但**失败返回 `[]`**（与上一条的 `null` 语义相反） |
| `plugin/scripts/send-to-session.ts:161` | `readFile(\`/proc/${pid}/cmdline\`)` + `.split("\0").filter(Boolean)` |
| `plugin/scripts/supervisor-preempt-candidates.ts:133` | 同 `observation.ts` 形（读 cmdline + `.includes(needle)`），另读 `/proc/<pid>/stat` 取 pgrp |
| `plugin/scripts/worker-driver.ts:699` | 构造形 `path.join(procDir, e, "cmdline")` + `.replace(/\0/g," ")` |
| `plugin/scripts/fast-mode-telemetry.ts:215` | `snapshotProcCmdlines()` —— 收集**全部** cmdline 进数组，比较发生在**另一处**（纯快照收集器，不是身份判定） |

⛔ **不是机械替换，失败语义必须逐站点保留**：kernel leaf 的文档注释逐字写明 "null when unreadable — which is NOT the same as 'no arguments'（硬规则 3b）：a caller that must recognise a specific invocation treats null as 'could not tell', never as 'does not match'"。上面三个站点对"读不到"的取值分别是 `null` / `[]` / `null`——迁移时**不得**把它们折叠成同一个值（把 `null` 折成 `[]` 或 `false` 正是硬规则 3b 的失败形态：读不懂 ⇒ 伪装成"不匹配"）。

**同一任务的第二半：收窄指纹，把"读 cmdline"与"识别进程"分开**。当前实现的外部事实 B 是**文件级**判定——`const compRe = /grep\s+-q|\.includes\(|\.indexOf\(|\.match\(|basename\(|\.split\(|\.startsWith\(|\.endsWith\(|argv\[0\]/` 只在循环外做一次 `if (codeMatch(src, mask, compRe).length === 0) continue;`（约 :205），于是任何"收集全部 cmdline"的快照器只要同文件里恰好有一处 `.includes(` 就被计成"识别进程"（`fast-mode-telemetry.ts:215` 正是这样上榜的）。收窄方向：让"比较原语"必须作用在 cmdline/argv 的读取结果上（行内或邻域约束），使纯快照收集器出列，而真正的"读 ∧ 比"站点保留。

<!-- dedup-ref -->
相关联但不同机制：[[gap-arch-reverse-edges-zero]]（已 done）抽出的正是这个 kernel leaf，但那次的目标是**删除 `serve.ts` 的反向边**，没有把余下调用点迁过去（该文件头注释逐字记着当时的范围）；[[gap-archguard-p2-identity-replication-checker]]（已 done）落地的是检测器本体，其 AC2 只要求**报出**这些站点，不要求消除。

## AC

- [x] AC1（站点枚举为现场读数）：修前贴出检测器 AC2 段的**完整 20 条**输出，并逐条标注去噪理由（软链镜像 / test / gitignored 副本 / 非 TS），据此给出**待迁移站点清单**（须含 `observation.ts`、`orphan-session-check.ts`、`manager-tick-readings.ts`、`send-to-session.ts`、`supervisor-preempt-candidates.ts`、`worker-driver.ts` 六处；`fast-mode-telemetry.ts` 按收窄后的指纹判是否计入，并写明理由）。
- [x] AC2（迁移完成·按位置判定）：上列六处不再各自解析 `/proc/<pid>/cmdline`——`grep -n 'cmdline' <六个文件>` 的命中只余注释/类型说明，无第二处 `readFileSync`/`readFile(path.join(…,"cmdline"))`；贴出该 grep 输出（按位置判定，非关键词计数：逐个打印命中行并分类）。
- [x] AC3（失败语义不折损·负控制）：六个站点各自的"读不到"取值修后与修前**逐字一致**——对每一处贴出"读取失败"分支的修前/修后代码行（`null` / `[]` / `reason:"unknown"` 三者不得互换）；并把 kernel leaf `readProcCmdline` 返回 null 的路径作为可跑的反向断言（单测或 CLI 输出），证明迁移后该路径仍返回 null 而非 `[]`。
- [x] AC4（收窄生效·指纹）：修后检测器的判定重写数**下降**，且 `fast-mode-telemetry.ts:215` 的**纯快照收集器**不再被报为"识别进程"（`grep` 修后 AC2 段输出确认该行不在列）；同时**仍**报出真正的"读 cmdline ∧ 比较名字"站点（在未迁移的 `.sh`/test 面上至少保留 1 条，证明收窄不是把判据砍空——零计数要对着已知真样本干跑，硬规则 2）。
- [x] AC5（行为回归）：`node --experimental-strip-types plugin/test/identity-replication-check.test.mjs` exit 0；受影响站点各有既有测试且全绿（至少 `packages/quay/test/observation.test.mjs` 与覆盖 `orphan-session-check` / `worker-driver` / `supervisor-preempt-candidates` / `manager-tick-readings` / `send-to-session` 的测试文件，逐个点名并贴出运行结果）。
- [x] AC6（不制造反向边）：迁移后 `plugin/scripts/*.ts → packages/quay/src/kernel/proc-identity.ts` 是 `plugin → packages` 的**正向**边；`node --experimental-strip-types plugin/scripts/import-graph-check.ts` exit 0（kernel 边界规则不因本次迁移被破坏）。
- [x] AC7（scoped 门）：`bash scripts/test.sh --for-task gap-judgment-rewrites-route-through-proc-identity-leaf` 绿（或等价 scoped 静态门）。

## DoD

六处站点真实迁移并跑通：每处至少一条**运行时**证据（该站点所属测试跑绿，或一条真实调用 `readProcCmdline` 路径的命令输出），⛔ 不以"grep 归零"单独作为完成判据；检测器修后重跑并贴出判定重写清单（数字下降 + 快照收集器出列 + 真站点仍在）。AC3 的六组"失败取值修前/修后对照行"逐处贴出。

## Touches

- packages/quay/src/kernel/proc-identity.ts
- packages/quay/src/observation.ts
- plugin/scripts/orphan-session-check.ts
- plugin/scripts/manager-tick-readings.ts
- plugin/scripts/send-to-session.ts
- plugin/scripts/supervisor-preempt-candidates.ts
- plugin/scripts/worker-driver.ts
- plugin/scripts/identity-replication-check.ts
- packages/quay/test/observation.test.mjs
- packages/quay/test/kernel-proc-identity.test.mjs
- plugin/test/identity-replication-check.test.mjs
- plugin/test/worker-driver.test.mjs
- tasks/gap-judgment-rewrites-route-through-proc-identity-leaf.md

## Evidence

实施提交 `cd1fcb8`（分支 `task/gap-judgment-rewrites-route-through-proc-identity-leaf`，pre-merge + scoped 门后见下）。

### AC1 — 修前现场读数：**17 处**（立案时 AC 写的是 20；该读数已漂移，此处按【现场】报，不照抄 AC 里的数字）

```
$ node --experimental-strip-types plugin/scripts/identity-replication-check.ts --root .   # 修前
== 判定重写 (AC2) — 读 /proc/<pid>/cmdline ∧ 比较名字 (识别进程) — 17 处 ==
  experiments/quay-perpetual-stream/scripts/fast-mode-telemetry.ts:215
  packages/quay/src/kernel/proc-identity.ts:37
  packages/quay/src/observation.ts:2566
  packages/quay/test/mcp-server-deadlock-repro.test.mjs:148
  packages/quay/test/server-status-web-control-same-pid.test.mjs:507
  plugin/scripts/fast-mode-telemetry.ts:215
  plugin/scripts/manager-tick-readings.ts:249
  plugin/scripts/orphan-session-check.ts:150
  plugin/scripts/os-anchor-watchdog.sh:130
  plugin/scripts/run-namespace-sweep.mjs:85
  plugin/scripts/send-to-session.ts:161
  plugin/scripts/supervisor-observe.sh:214
  plugin/scripts/supervisor-preempt-candidates.ts:133
  plugin/scripts/worker-driver.ts:699
  plugin/scripts/worktree-process-reaper.ts:141
  plugin/test/driver-runtime-s04.test.mjs:43
  plugin/test/quay-init-tmux-detection.test.mjs:135
```

逐条去噪（17 条 → **6 条待迁移** + 1 条按收窄判 + 2 条范围外 + 8 条去噪）：

| # | 行 | 去噪理由 |
|---|---|---|
| 1 | `experiments/…/fast-mode-telemetry.ts:215` | **软链镜像**（`ls -la` 逐字 `-> ../../../plugin/scripts/fast-mode-telemetry.ts`）：同一实现，不另计 |
| 2 | `packages/quay/src/kernel/proc-identity.ts:37` | **kernel leaf 本体**——它就是单一实现（`readProcCmdline`），不是"复制替代抽象" |
| 4,5 | `packages/quay/test/mcp-server-deadlock-repro:148` / `server-status-web-control-same-pid:507` | test 文件 |
| 9 | `plugin/scripts/os-anchor-watchdog.sh:130` | `.sh`（不能 import TS） |
| 12 | `plugin/scripts/supervisor-observe.sh:214` | `.sh`（同上） |
| 16,17 | `plugin/test/driver-runtime-s04:43` / `quay-init-tmux-detection:135` | test 文件 |
| 6 | `plugin/scripts/fast-mode-telemetry.ts:215` | **不计入**：纯快照收集器（读全部 cmdline 进数组，比较在 `processAliveInCmdlines` 另一函数）⇒ 收窄后出列，见 AC4 |
| 10 | `plugin/scripts/run-namespace-sweep.mjs:85` | 真"读∧比"站点，但**不在本任务六处枚举内**且不在 Touches ⇒ 本次不动（同时是 AC4「真站点仍在」的活体见证） |
| 15 | `plugin/scripts/worktree-process-reaper.ts:141` | 同上（`readProcArgv0`——argv0-only 的第三个谓词），不在 Touches ⇒ 本次不动 |

**待迁移清单（六处）**：`observation.ts`（`runProcessAliveSync`）、`orphan-session-check.ts`（`readProcArgv`）、`manager-tick-readings.ts`（`readCmdline`）、`send-to-session.ts`（`targetInboundPolicy`）、`supervisor-preempt-candidates.ts`（`findExecutorPids`）、`worker-driver.ts`（`enumerateLiveWorkerCmdlines`）。

⚠️ **一条 AC 未预见的现场事实，贴出来而不是绕过**：检测器**每个文件只报第一处**命中，而六处文件里真实的手搓读共 **10 处**（见 AC2 的 before 计数：2/1/1/1/1/4）。多出的 4 处是 `observation.ts:977 readLiveWorkerProcesses` 与 `worker-driver.ts` 的 `findLiveWorkerPid` / `probePidLiveness` / `readPidCmdline`——它们一并迁移，否则 AC2 的 grep 判据在事实上不成立。

### AC2 — 六处不再手搓读（按位置判定；零计数对着已知真样本干跑）

谓词 = 「同一行既出现读原语、又出现 cmdline 路径」：`grep -cE 'readFile(Sync)?\(.*cmdline'`。对照样本 = 迁移前（`cd1fcb8^`）：

```
packages/quay/src/observation.ts                    before=2  after=0
plugin/scripts/orphan-session-check.ts              before=1  after=0
plugin/scripts/manager-tick-readings.ts             before=1  after=0
plugin/scripts/send-to-session.ts                   before=1  after=0
plugin/scripts/supervisor-preempt-candidates.ts     before=1  after=0
plugin/scripts/worker-driver.ts                     before=4  after=0
```

`grep -n 'cmdline' <六文件>` 修后命中逐条分类（**没有一条是读**）：

| 文件:行 | 命中 | 分类 |
|---|---|---|
| `observation.ts:903-905,916-918` | `workerTaskIdFromCmdline(cmdline: string)` / `cmdline.includes(...)` | 函数名 + `string` 类型标注（纯函数，入参就是 cmdline） |
| `observation.ts:979,980,982` | `const cmdline = text.trim()` / `workerTaskIdFromCmdline(cmdline)` | 本地变量名 |
| `worker-driver.ts:703,704,734,735` | `const cmdline = text.trim()` … | 本地变量名 |
| `worker-driver.ts:3077,3695` | `cmdlineFingerprint: string` | 类型字段名 |
| `worker-driver.ts:3150-3152` | `readPidCmdline(...)` | 函数名（函数体已走 leaf） |
| `send-to-session.ts:135` | `evidence: ["no readable settings face (/proc/<pid>/cmdline, …)"]` | **用户可见消息串**（"unknown" 判词的说明书，⛔ 不是读取；删掉它会让判据失去「说出查了哪些来源」的那一半——硬规则 3） |
| `orphan-session-check.ts` / `manager-tick-readings.ts` / `supervisor-preempt-candidates.ts` | —（0 命中） | — |

### AC3 — 六组"失败取值修前/修后"逐字对照（10 处读，按站点归并）

```
① observation.ts runProcessAliveSync        修前 } catch { /* pid exited mid-scan — not a match */ }   ⇒ /proc 不可读时 return null
                                           修后 if (cmd === null) continue;                          ⇒ 同一 return null（未改）
② observation.ts readLiveWorkerProcesses   修前 } catch { continue; }                                 ⇒ 跳过
                                           修后 if (text === null) continue;                         ⇒ 跳过
③ orphan-session-check.ts readProcArgv     修前 } catch { return null; }                              ⇒ null
                                           修后 return argv === null ? null : argv.filter(…)          ⇒ null
④ manager-tick-readings.ts readCmdline     修前 } catch { return []; }                                ⇒ []
                                           修后 return argv === null ? [] : argv.filter(Boolean)      ⇒ []
⑤ send-to-session.ts targetInboundPolicy   修前 cmdlineRaw ? cmdlineRaw.split(…).filter(Boolean) : []  ⇒ []
                                           修后 const argv = argvRaw === null ? [] : argvRaw.filter(Boolean) ⇒ []
⑥ supervisor-preempt-candidates.ts         修前 } catch { /* pid exited mid-scan */ }                  ⇒ 跳过
                                           修后 if (cmd === null) continue;                          ⇒ 跳过
⑦ worker-driver.ts enumerateLiveWorkerCmdlines 修前 } catch { continue; }                             ⇒ 跳过
⑧ worker-driver.ts findLiveWorkerPid       修前 } catch { continue; }                                 ⇒ 跳过
⑨ worker-driver.ts probePidLiveness        修前 } catch { return "unknown"; }  空 ⇒ "exited"           ⇒ "unknown" / "exited"
                                           修后 if (text === null) return "unknown"; text.trim().length === 0 ? "exited" : "alive"
⑩ worker-driver.ts readPidCmdline          修前 } catch { return null; }  空 ⇒ ""                      ⇒ null / ""
                                           修后 return text === null ? null : text.trim();
```

**⛔ 三值（null / [] / "unknown"）一个都没有互换**：为此 leaf 刻意给**两个读形**而不是一个——`readProcCmdline`（argv，空⇒null）与 `readProcCmdlineText`（text，空⇒""）。`probePidLiveness` 与 `readPidCmdline` 需要区分"读不成"与"读到了但空（僵尸）"，只有 Text 形给得出；`runProcessAliveSync` 需要保留「空 cmdline 也计入 readable」的计数器语义，同样只有 Text 形给得出。

**可跑的反向断言**（AC3 要求：证明 null 路径仍返回 null 而非 `[]`）——新增 `packages/quay/test/kernel-proc-identity.test.mjs`，8/8 绿，含：

```
✔ AC3 反向断言 — 读不成的路径仍返回 null, 不是 [] (硬规则 3b)
✔ AC3 — 读到了但空 (僵尸) 与读不成是两个取值: Text ⇒ "", argv ⇒ null
✔ 真 /proc 读数 — 本进程自己的 argv 可读, 且 argv[0] 非空 (迁移没有把真读也弄坏)
```

### AC4 — 收窄生效：**17 处 → 8 处**，收集器出列，真站点仍在

修后（合并 develop 之后重跑）：

```
== 判定重写 (AC2) — 8 处 ==
  packages/quay/test/mcp-server-deadlock-repro.test.mjs:148
  packages/quay/test/server-status-web-control-same-pid.test.mjs:507
  plugin/scripts/os-anchor-watchdog.sh:130
  plugin/scripts/run-namespace-sweep.mjs:85
  plugin/scripts/supervisor-observe.sh:214
  plugin/scripts/worktree-process-reaper.ts:141
  plugin/test/driver-runtime-s04.test.mjs:43
  plugin/test/quay-init-tmux-detection.test.mjs:135
```

判定面精确读数（`--json` + 逐项断言，不是 grep 关键词）：`judgmentRewrites.length = 8`；`fast-mode-telemetry` **不在列**（false）；`proc-identity` 不在列（false）；六处迁移站点**逐一不在列**（false ×6）。

**出列可归因于收窄、不是"文件被改没了"**：`plugin/scripts/fast-mode-telemetry.ts` 本轮**未被修改**（不在 `git diff --stat` 里），它出列只能来自收窄。收窄的三条绑法（链式 / 具名 / shell 管道）在 `identity-replication-check.ts` 的 `boundToRead`。

**收窄不是把判据砍空**（硬规则 2 的已知真样本干跑）：
- 未迁移面上仍报出真站点：`.sh` 2 条（`os-anchor-watchdog.sh:130` 的 `| grep -q claude` 管道、`supervisor-observe.sh:214` 的 `case "$cmd" in *claude*`）、test 4 条 —— ≥1 的要求满足。
- 单测 fixture **双向**钉住（`plugin/test/identity-replication-check.test.mjs` 新增一条）：收集器 fixture 必须**不在列**、三条绑法各一个真样本必须**在列**，整组断言"恰好这三条"。
- **收集器 fixture 的负控制非空转**（实测，不是声称）：把**收窄前**的谓词原样套到该 fixture 上 ⇒ `fileLevelCompPrim=true ∧ readContextPrefix=true ⇒ OLD would flag it: true`。即：旧判据确实会报它，新判据不报。

### AC5 — 行为回归（逐个点名，全部 exit 0）

| 测试文件 | 结果 |
|---|---|
| `plugin/test/identity-replication-check.test.mjs`（AC5 点名，含新增收窄用例） | **12 pass / 0 fail** |
| `packages/quay/test/kernel-proc-identity.test.mjs`（新增，AC3 反向断言） | **8 pass / 0 fail** |
| `packages/quay/test/observation.test.mjs`（AC5 点名） | **58 pass / 0 fail** |
| `plugin/test/orphan-session-check.test.mjs` | **14 pass / 0 fail** |
| `plugin/test/worker-driver.test.mjs`（AC5 点名） | **103 pass / 0 fail** |
| `plugin/test/supervisor-preempt-candidates.test.mjs`（AC5 点名） | **11 pass / 0 fail** |
| `plugin/test/manager-tick-readings.test.mjs`（AC5 点名） | **14 pass / 0 fail** |
| `plugin/test/session-primitives-adoption.test.mjs` + `plugin/test/driver-runtime-s01.test.mjs`（send-to-session 链；⛔ 该站点无 `targetInboundPolicy` 直调单测，argv 面经 CLI 覆盖，直调断言由上面的 leaf 测试的 reader 缝用例补） | **10 + 5 pass / 0 fail** |
| `packages/quay/test/build-plugin-dist.test.mjs`（跨树 import 进 dist bundle 的风险面） | **36 pass / 0 fail** |
| `packages/quay/test/serve-handlers.test.mjs` / `serve-board.test.mjs` / `gap-webui-board-transient-…test.mjs`（observation 下游） | 全绿（13 / 4） |
| `plugin/test/worktree-process-reaper.test.mjs`（leaf 的 re-export 消费者） | **22 pass / 0 fail** |
| `plugin/test/instrument-failure-check.test.mjs`（把 `readCmdline(pid, procRoot)[0]` 当"安全形"样本） | **17 pass / 0 fail** |
| `npx tsc --noEmit -p packages/*/`（`.quay/config.yml` 的 `ts-typecheck` 门逐字命令） | **exit 0**（四包全绿） |

### AC6 — 不制造反向边

```
$ node --experimental-strip-types plugin/scripts/import-graph-check.ts ; echo $?
import-graph-check: files=420 edges=1032 (value 923 / type 109)
  valueSccs=0 typeSccs=0 reverseEdges=0
  kernelChecked=true (violations=0)
PASS — valueSccs=0 ≤ 0, typeSccs=0 ≤ 0, reverseEdges=0 ≤ 0
0
```

新增的 5 条边（`orphan-session-check` / `manager-tick-readings` / `send-to-session` / `supervisor-preempt-candidates` / `worker-driver` → `packages/quay/src/kernel/proc-identity.ts`）全是 `plugin → packages` 的正向边（`reverseEdges` 仍 0）；kernel 边界（`kernel/` 下只用 `node:*`）未被破坏（`violations=0`）。`observation.ts` 那条是**包内** import（`./kernel/proc-identity.ts`），与 `serve.ts:45` 同一先例 —— ⛔ 不触 `packages/quay/src` 的「零 `plugin/` 静态 import」禁令。

### AC7 — scoped 门（pre-merge 后重跑）

```
$ git merge --no-edit develop          # 无冲突（develop 侧只动了 runner-static-gate.ts / 一个 checker / 两个 tasks）
$ bash scripts/test.sh --for-task gap-judgment-rewrites-route-through-proc-identity-leaf --allow-thin ; echo $?
✅ scoped static checks: change-relevant tier（含 import-graph-check / task-contract-check / touches-one-entry-one-path-check / mirror-pair-drift-check …）
ℹ tests 297   ℹ pass 297   ℹ fail 0
SCOPED_GATE_EXIT=0
```

### DoD — 每处站点的**运行时**证据（⛔ 不以 grep 归零为完成判据）

六处各自的运行时抓手（都在 AC5 的表里跑绿，此处点名到函数）：`observation.ts` 的 `runProcessAliveSync` / `readLiveWorkerProcesses` → `observation.test.mjs`（58）+ `serve-board.test.mjs`（13）；`orphan-session-check.ts` 的 `readProcArgv` → `orphan-session-check.test.mjs`（14）；`manager-tick-readings.ts` 的 `readCmdline` → `manager-tick-readings.test.mjs`（14）；`send-to-session.ts` 的 `targetInboundPolicy` → `session-primitives-adoption.test.mjs`（10）+ leaf 的 reader 缝用例；`supervisor-preempt-candidates.ts` 的 `findExecutorPids` → `supervisor-preempt-candidates.test.mjs`（11）；`worker-driver.ts` 的四处读 → `worker-driver.test.mjs`（103，含 `probePidLiveness` 的 `"unknown"` / `"exited"` 三值现场用例）。另有真 `/proc` 读数一条：`readProcCmdline(process.pid)` 返回非空 argv（`kernel-proc-identity.test.mjs`）。
