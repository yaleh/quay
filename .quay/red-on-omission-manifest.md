# red-on-omission 状态产物清单 (AC41③)

`tasks/gap-ac41-red-on-omission-artifact` 的 `.quay/` 面：各固化行为的「不做会变红」状态产物
（mtime / 字段 / 门）。这些是 RUNTIME 文件（gitignored，由三层执行核写），本清单是它们的
**tracked 正本**——`red-on-omission-audit` 检查器机械核对的是「清单 + 执行核里 DECLARED 的读数」，
不是这些运行时文件本身（fresh checkout 没有它们）。

| 行为 (id) | 状态产物 | 变红读数（不做时） | 写者 |
|---|---|---|---|
| a15_ruling5 / ruling5_status / a15_heartbeat_write | `.quay/suite-health-last-run.json` | `ruling5_status` 字段缺失/显示 violated；文件 mtime 距今 >3 tick 周期 ⇒ 检查器 exit 1 | A15 ② 每 tick 写 |
| scope_worktree_gate | `.quay/verification-round.jsonl` | 无 `scope=worktree`+`state=green` 记录 ⇒ fan-in 拒（门拒）；`scope` 字段缺失 ⇒ 无法判 ⇒ 拒 | full-suite-runner.ts 每轮写 |
| a17_semantic_judge | `plugin/scripts/semantic-observer-judge.ts` 的 `redOnOmission` | judge 输出 `stopped:true` 而 tick-log 无对应升级 ⇒ **exit 1** | judge 自身（CLI exit） |

> **已退役（2026-08-26，`gap-a13-a20-stale-carrier-after-worker-driver-takeover`）**：`a13_inner_heartbeat`（`.quay/inner-wakeup-heartbeat.json`）与 `a2_suite_chain`（`.quay/suite-chain-heartbeat.json`）随 worker-driver 接管派发退役——两载体不再被写（inner ScheduleWakeup / 套件链 trigger 均被常驻 driver 取代），其 liveness/reconcile 由 `driver-runtime.ts liveness`（supervisor respawn + DEATH 告警）+ `worker-round.jsonl` 无条件 round 记录 + 协调地板承接。

**原则**：每条固化行为必须能指出「不做时哪个读数会变红」；指不出的，视为未固化。本清单 + 执行核
C 段/A 段 + `red-on-omission-audit` 的 registry 是这条判据的机械正本。运行时文件缺失不红（fresh
checkout 合法），红的是「该产物应被写入而没写」（mtime 陈旧 / 字段缺失 / 门拒）。
