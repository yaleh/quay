---
id: gap-meta-inertcheckersreading
title: Inert-guard reading cannot distinguish an in-flight suite from a dropped
  notEvaluatedCheckers dimension
status: done
labels:
  - meta-driver
  - driver-candidate
parent: null
children: []
extra: {}
---
## Finding
full-suite-runner writes the carrier with state:'running' and no notEvaluatedCheckers field (full-suite-runner.ts:3608), while collectInertCheckers maps ANY missing field to cause:'dimension-missing' (meta-driver.ts:1893-1897). That is the exact value three landed tasks (gap-meta-extractnotevaluatedchecker / gap-meta-parsenotevaluatedcheckers / gap-not-evaluated-checkers-never-persisted) built to flag a mirror that DROPS the field — so a transient in-flight suite and a regressed mirror render identically, and this round's dark inert-guard dimension cannot be attributed to either.

本轮读数（inertCheckers.evaluated）= `false`，采于 2026-11-07T04:22:28Z，由 meta-driver 机械采集。
涉及机制关键词：`InertCheckersReading`（立案前已搜既有任务，无人认领）。

## AC
- [x] `node --experimental-strip-types --input-type=module -e "import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {collectInertCheckers} from './plugin/scripts/meta-driver.ts';const mk=(o)=>{const d=fs.mkdtempSync(path.join(os.tmpdir(),'ic-'));fs.mkdirSync(path.join(d,'.quay'),{recursive:true});fs.writeFileSync(path.join(d,'.quay','full-suite-state.json'),JSON.stringify(o));return d};const a=collectInertCheckers(mk({state:'running'}));const b=collectInertCheckers(mk({state:'green'}));const c=collectInertCheckers(mk({state:'green',notEvaluatedCheckers:[]}));if(a.evaluated!==false){console.error('running carrier wrongly reported as measured');process.exit(1)}if(b.cause!=='dimension-missing'){console.error('finished carrier without the field lost its dimension-missing cause: '+JSON.stringify(b));process.exit(1)}if(a.cause===b.cause){console.error('suite-running and dropped-dimension share one cause: '+JSON.stringify(a));process.exit(1)}if(c.evaluated!==true||c.cause!==null){console.error('measured carrier not recognised: '+JSON.stringify(c));process.exit(1)}console.log(JSON.stringify({running:a.cause,missing:b.cause}))"` ⇒ A carrier with state:'running' and no field reports a cause distinct from 'dimension-missing'; a FINISHED carrier with no field still reports 'dimension-missing'; a carrier carrying the field (even []) reports evaluated:true — so a dark inert-guard round is attributable to 'suite in flight' rather than silently colliding with a landed-fix regression.

实测（工作树 task/gap-meta-inertcheckersreading）：输出 `{"running":"suite-in-flight","missing":"dimension-missing"}`；负控制 = 同一条命令跑在改动前的代码上 ⇒ exit 1 并打印 `suite-running and dropped-dimension share one cause: {"evaluated":false,"names":[],"cause":"dimension-missing"}`（判据能取假）。

## DoD
- [x] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）
- [x] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制

## Touches
- `plugin/scripts/meta-driver.ts`
- `plugin/test/meta-driver.test.mjs`
- `plugin/probes/meta-driver.md`
- `tasks/gap-meta-inertcheckersreading.md`

## ADR-007 dark-axis
- L_D archguard(package cycles): cycles=0 maxScc=1

## Blocker

**2026-11-07T05:00:15.258Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: oom-killed (3) — new regression at lower concurrency: plugin/test/driver-runtime-control-plane.test.mjs (passed at the original concurrency 23, fails at 16) — needs a code fix
- run_id：wk-prod-anchor
- session_id：eda640de-edbd-43eb-be5d-26830e7b39fe

## Evidence

**2026-11-07 续跑轮（同一工作树复用，未新建）**

- AC 重跑（HEAD 已 merge develop `09629a9e9`）：输出 `{"running":"suite-in-flight","missing":"dimension-missing"}` ⇒ exit 0。
- `--verify-run`（与 fan-in 逐字相同的 scoped 门：`scripts/test.sh --for-task gap-meta-inertcheckersreading --allow-thin`）⇒ `"classification":"green"`，exitCode 0，`wallMs`≈12s。
- `anti-drift-touches-check --merge-target develop` ⇒ `ANTI-DRIFT OK: 3 actual file(s), all within declared Touches`。

**上一轮 suite 红与本次 delta 无关（两轮日志逐字证据，⛔ 不是「猜是环境」）**

- 原轮 `laneCount=23`：`SUITE-INCOMPLETE reason=oom-killed oomKill=3`；唯一 `__PERFILE__ passed=false` 是 `packages/quay/test/npm-pack-e2e.test.mjs`，错误 `build-plugin-dist failed: Error: The service was stopped`（esbuild 子进程被 OOM 杀）。该文件已登记 `@load-sensitive`。
- 降并发恢复轮 `laneCount=16`（`…~wk-prod-anchor~recovery-16-….log`）：`oomKill=0` 且 `completeness=complete`，唯一失败是 `plugin/test/driver-runtime-control-plane.test.mjs` 的 `AC2/AC4 (production path)`，报 `[TypeError: fetch failed] [cause]: Error: bad port`（`fetching at StreamableHTTPClientTransport.send`）。
- 该文件不 import 本任务改动的任何模块；本 delta 只落在 `plugin/scripts/meta-driver.ts`（`collectInertCheckers` / `readingsDigest`）。
- 根因（可复现，一条命令）：`bad port` 是 WHATWG fetch 拒绝的端口族（6000/6666/2049/5060/10080 …）；本机 `/proc/sys/net/ipv4/ip_local_port_range = 1024 65535` ⇒ `serveKindControlPlane` 的 `port:0` 内核分配**可以**落到这些端口；实测 `await fetch('http://127.0.0.1:6000/')` ⇒ `fetch failed | cause: bad port`，同端口 32768 ⇒ 正常。⇒ 一个**独立**的偶发缺陷（控制面选端未避开 fetch 坏端口），⛔ 不是本任务引入，也不在本任务 Touches 内，故本轮不在此处修。
- 单文件复跑：`node --test --experimental-strip-types plugin/test/driver-runtime-control-plane.test.mjs` ⇒ 6/6 pass（本机负载下不复现）。
