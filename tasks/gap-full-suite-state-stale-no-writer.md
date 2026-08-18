---
id: gap-full-suite-state-stale-no-writer
title: "detached-suite（fan-in-execute.js）不写 full-suite-state.json → 该文件陈旧 → collectFailureFiles 无边界 union 潜伏 bug + /tests 页读陈旧数据"
status: ready
labels:
  - gap
  - defect
  - instrumentation
parent: null
children: []
extra:
  schema: execution
---

**type:** finding

## Finding

`fan-in-execute.js` 的 detached-suite 路径（`setsid bash scripts/test.sh`）不经 `full-suite-runner.ts`（唯一写 full-suite-state.json 的入口）⇒ full-suite-state.json 陈旧。四消费者逐个核实（manager 读代码，outer 复核 ③）：① slot-refill `suite_red` 只 report 不入 gate（惰性无害）；② fan-in-ff-merge.sh 已退役该依赖（AC84）；**③ ready-pool-check.ts `collectFailureFiles` 无边界 union `stateFailures`（:1185-1192）——陈旧失败清单被永久注入每轮 suite-blocking，无过期机制（潜伏 bug，现因文件恰好停在 green/failures:[] 才没事）**；④ Web UI /tests 页（observation.ts:1265）读该文件当当前状态——受害，是 `gap-webui-tests-missing-startedat` 的同一根因。

**窄修法（不动 detached-suite 架构本身，它解决真实的 turn-budget 耗尽问题，保留）**：① fan-in-execute.js suite 完成时 mirror-write 一份 full-suite-state.json（复用 full-suite-runner.ts:2456 `mirrorStateFile` 模式）；② `collectFailureFiles` 改有边界 union（仅文件轮次落在当前红窗内才并入）。

## Acceptance Criteria

- [ ] AC1: fan-in suite 完成后 full-suite-state.json 有活数据（mirror-write 落地）。
- [ ] AC2: `collectFailureFiles` 只并入落在当前窗口内的 stateFailures（有边界，非无条件 union）。
- [ ] AC3: /tests 页读到的 full-suite-state 是活数据（吸收 gap-webui-tests-missing-startedat 的表层症状）。

## Definition of Done

- [ ] 一次 detached-suite fan-in 后 full-suite-state.json 反映该轮结果（真实输出，非 fixture）。

## Touches

- tasks/gap-full-suite-state-stale-no-writer.md（自身）
