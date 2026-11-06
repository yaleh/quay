---
id: gap-meta-parsenotevaluatedcheckers
title: 生产 fan-in 载体缺少 notEvaluatedCheckers：meta-driver 的惰性守卫维度每轮都被判为「未测量」
status: ready
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

## AC（draft）
- [ ] `node --experimental-strip-types --input-type=module -e "import { execSync } from 'node:child_process'; import path from 'node:path'; import { collectInertCheckers } from './plugin/scripts/meta-driver.ts'; const root = path.dirname(execSync('git rev-parse --path-format=absolute --git-common-dir', { encoding: 'utf8' }).trim()); const r = collectInertCheckers(root); if (r.evaluated !== true) { console.error('inert-checker dimension unmeasured on the fan-in carrier under ' + root + ': ' + JSON.stringify(r)); process.exit(1); } console.log(JSON.stringify({ root, evaluated: r.evaluated, names: r.names }));"` ⇒ 在一次真正跑过全量 suite 的 mechanical fan-in 之后，生产载体带上该维度（空数组=测得零，仍与「未测量」可区分），collectInertCheckers 返回 evaluated:true；只有日志确实读不出时才允许字段缺席。

## DoD（draft）
- [ ] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）
- [ ] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制

## Touches
- `plugin/scripts/worker-fan-in.ts`
- `tasks/gap-meta-parsenotevaluatedcheckers.md`