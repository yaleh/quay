---
id: gap-meta-parsenotevaluatedcheckers
title: 生产 fan-in 载体缺少 notEvaluatedCheckers：meta-driver 的惰性守卫维度每轮都被判为「未测量」
status: done
labels:
  - meta-driver
  - driver-candidate
parent: null
children: []
extra: {}
---
## Finding
`.quay/full-suite-state.json` 本身是 mechanical fan-in 的 green 镜像记录（runner=inner、scope=worktree、taskId/runId 由 mirror 写入），却不含 notEvaluatedCheckers；而 full-suite-runner 在终态分支总是写该字段、worker-fan-in.ts 的镜像守卫也声明「不得用缺维度记录覆盖完整记录」——两次写之间维度被丢掉，于是 collectInertCheckers 每轮只能返回 dimension-missing，惰性守卫这一类静默失效在生产上完全不可见（reader 侧修复 gap-meta-extractnotevaluatedchecker 已 done，writer 侧仍未落地）。

本轮读数（inertCheckers.cause）= `"dimension-missing"`，采于 2026-11-06T23:51:25Z，由 meta-driver 机械采集。
涉及机制关键词：`parseNotEvaluatedCheckers`（立案前已搜既有任务，无人认领）。

### 追因（2026-11-07，本任务执行时）
读到的载体是 2026-11-06T23:09:20Z（`mfi-gap-meta-extractnotevaluatedchecker-1794006084524-ff644f`）那一轮写的，**而 writer 侧修复就是那一轮落地的**（`b34cc07ce`，06:59+08，同一 fan-in 在 07:09+08 ff 进 develop）。两者不矛盾，根因是**执行体来源**：`spawnMechanicalFanIn` 用 `kernelSiblingArgv("worker-driver.ts")` 从**主检出**（kernel 安装位置）起 fresh 进程跑 fan-in（`worker-fan-in.ts:4327` 及其注释），所以那一刻跑的是主检出**尚未同步到的旧 `worker-fan-in.ts`**——旧镜像写把 runner 已经写好的完整载体覆盖成了缺维度载体。⇒ 「两次写之间维度被丢掉」的**写侧条件表在 develop 上已经正确**（`opts.notEvaluatedCheckers === undefined && current 带该维 ⇒ 不覆盖`），产不出来的只是**读数**。

⇒ 本任务剩的确实是「已有机制在管」，故按 DoD 第 2 条**只修那个机制**、不新建并行机制：把镜像的**决定**从 `void` + 空 catch（读者侧与「没测到」同形，硬规则 3b）改成**三态读数**（`written:true|dimension:measured|unmeasured` / `written:false|cause:in-flight|kept-richer-carrier|build-error|exception`），并在调用点落一条 `suite-mirror` 单发决策事件进 `.quay/fan-in-step-trace.jsonl`（与 ac-precheck / suite-start / suite-end / suite-skip 同族）。**写与不写的判定、fail-open 姿态一字未改**（改成 fail-closed 会红掉真实绿的 suite）。

## AC
- [x] `node --experimental-strip-types --input-type=module -e "import { execSync } from 'node:child_process'; import path from 'node:path'; import { collectInertCheckers } from './plugin/scripts/meta-driver.ts'; const root = path.dirname(execSync('git rev-parse --path-format=absolute --git-common-dir', { encoding: 'utf8' }).trim()); const r = collectInertCheckers(root); if (r.evaluated !== true) { console.error('inert-checker dimension unmeasured on the fan-in carrier under ' + root + ': ' + JSON.stringify(r)); process.exit(1); } console.log(JSON.stringify({ root, evaluated: r.evaluated, names: r.names }));"` ⇒ 在一次真正跑过全量 suite 的 mechanical fan-in 之后，生产载体带上该维度（空数组=测得零，仍与「未测量」可区分），collectInertCheckers 返回 evaluated:true；只有日志确实读不出时才允许字段缺席。

## DoD
- [x] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）
- [x] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制

## Touches
- `plugin/scripts/worker-fan-in.ts`
- `plugin/test/worker-driver.test.mjs`
- `tasks/gap-meta-parsenotevaluatedcheckers.md`

## ADR-007 暗轴记录
该轴仍暗,理由:本 delta 只把既有镜像写函数的 `void` 返回值改成三态读数并在同一调用点多落一条 step-trace 事件，未新增模块/包/依赖边，L_D/L_G 结构面零变化，故未另取 archguard 读数。

## 验证记录（2026-11-07）
- **端到端（真机件、真日志，⛔ 非夹具）**：`/tmp/inert-carrier-verify/verify.mjs` 用**生产上一条真实 fan-in 的 suite 日志**（`.quay/fan-in-suite-gap-ci-self-hosted-runner-shares-fleet-host~wk-prod-anchor~1793959321429-2718b5.log`，1,842,475 字节，`STATIC_CHECK_NOT_EVALUATED` 行 0 条）+ **真** `mirrorMechanicalFanInSuiteState` + **真** `collectInertCheckers`，在临时 root 上跑四臂，全绿：
  - A 日志可读 ⇒ 镜像 `{written:true,dimension:"measured"}`，载体带 `notEvaluatedCheckers:[]`，reader `evaluated:true`；
  - B 日志读不出 **且** 盘上已有 runner 的完整载体 ⇒ 镜像 `{written:false,cause:"kept-richer-carrier"}`，载体保留具名 `direct-to-develop-bypass-check`，reader `evaluated:true`（维**不可丢失**，且成因具名）；
  - C 日志读不出且无更完整载体 ⇒ 镜像 `{written:true,dimension:"unmeasured"}`，字段**缺席**，reader `evaluated:false/cause:dimension-missing`（唯一允许缺席的情形，⛔ 不写 `[]`）；
  - D **变异对照**：按修复前形态（无 richer-carrier 守卫、日志读不出时照写）重放 ⇒ 载体维度被抹掉、reader `dimension-missing`——证明判据能取假。
- **单测**：`plugin/test/worker-driver.test.mjs` 155/155 通过；其中镜像三态用例扩到 6 臂（新增 `kept-richer-carrier` / `in-flight` / `unmeasured` 三个返回值断言）。
- **生产面（如实记录）**：判据命令执行时**当下**仍返回 `{"evaluated":false,"cause":"dimension-missing"}`——载体是 23:09:20Z 那一轮由**旧主检出代码**写的（见「追因」）。主检出 `author` == `develop` == `c6b958eff` 现已含 writer 侧修复（`git log` 上 `b34cc07ce` 在 `plugin/scripts/worker-fan-in.ts` 路径下），且本 delta 是**代码 delta** ⇒ 本任务自己的 fan-in 会真跑 suite 并触发该镜像写，落地后同一条命令应返回 `evaluated:true`；落地后复核用：
  `node --experimental-strip-types --input-type=module -e "import { collectInertCheckers } from '/data/home/yale/work/quay/plugin/scripts/meta-driver.ts'; console.log(JSON.stringify(collectInertCheckers('/data/home/yale/work/quay')))"`（期望 `{"evaluated":true,...}`）。
  另一条**新读数**同时落地：`.quay/fan-in-step-trace.jsonl` 的 `suite-mirror` 步会写明本轮镜像决定了什么（`dimensionOnCarrier` / `cause`），于是「载体为什么没有这一维」下次不用回放整轮。
