---
id: gap-judgment-rewrites-route-through-proc-identity-leaf
title: ~6 处真 TS 站点手搓 /proc/&lt;pid&gt;/cmdline，未走 kernel leaf
  proc-identity.ts；同时收窄判定重写指纹使纯快照收集器出列
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

- [ ] AC1（站点枚举为现场读数）：修前贴出检测器 AC2 段的**完整 20 条**输出，并逐条标注去噪理由（软链镜像 / test / gitignored 副本 / 非 TS），据此给出**待迁移站点清单**（须含 `observation.ts`、`orphan-session-check.ts`、`manager-tick-readings.ts`、`send-to-session.ts`、`supervisor-preempt-candidates.ts`、`worker-driver.ts` 六处；`fast-mode-telemetry.ts` 按收窄后的指纹判是否计入，并写明理由）。
- [ ] AC2（迁移完成·按位置判定）：上列六处不再各自解析 `/proc/<pid>/cmdline`——`grep -n 'cmdline' <六个文件>` 的命中只余注释/类型说明，无第二处 `readFileSync`/`readFile(path.join(…,"cmdline"))`；贴出该 grep 输出（按位置判定，非关键词计数：逐个打印命中行并分类）。
- [ ] AC3（失败语义不折损·负控制）：六个站点各自的"读不到"取值修后与修前**逐字一致**——对每一处贴出"读取失败"分支的修前/修后代码行（`null` / `[]` / `reason:"unknown"` 三者不得互换）；并把 kernel leaf `readProcCmdline` 返回 null 的路径作为可跑的反向断言（单测或 CLI 输出），证明迁移后该路径仍返回 null 而非 `[]`。
- [ ] AC4（收窄生效·指纹）：修后检测器的判定重写数**下降**，且 `fast-mode-telemetry.ts:215` 的**纯快照收集器**不再被报为"识别进程"（`grep` 修后 AC2 段输出确认该行不在列）；同时**仍**报出真正的"读 cmdline ∧ 比较名字"站点（在未迁移的 `.sh`/test 面上至少保留 1 条，证明收窄不是把判据砍空——零计数要对着已知真样本干跑，硬规则 2）。
- [ ] AC5（行为回归）：`node --experimental-strip-types plugin/test/identity-replication-check.test.mjs` exit 0；受影响站点各有既有测试且全绿（至少 `packages/quay/test/observation.test.mjs` 与覆盖 `orphan-session-check` / `worker-driver` / `supervisor-preempt-candidates` / `manager-tick-readings` / `send-to-session` 的测试文件，逐个点名并贴出运行结果）。
- [ ] AC6（不制造反向边）：迁移后 `plugin/scripts/*.ts → packages/quay/src/kernel/proc-identity.ts` 是 `plugin → packages` 的**正向**边；`node --experimental-strip-types plugin/scripts/import-graph-check.ts` exit 0（kernel 边界规则不因本次迁移被破坏）。
- [ ] AC7（scoped 门）：`bash scripts/test.sh --for-task gap-judgment-rewrites-route-through-proc-identity-leaf` 绿（或等价 scoped 静态门）。

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
- plugin/test/identity-replication-check.test.mjs
- plugin/test/worker-driver.test.mjs
- tasks/gap-judgment-rewrites-route-through-proc-identity-leaf.md
