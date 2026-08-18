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

- [x] AC1: fan-in suite 完成后 full-suite-state.json 有活数据（mirror-write 落地）。
- [x] AC2: `collectFailureFiles` 只并入落在当前窗口内的 stateFailures（有边界，非无条件 union）。
- [x] AC3: /tests 页读到的 full-suite-state 是活数据（吸收 gap-webui-tests-missing-startedat 的表层症状）。

## Definition of Done

- [x] 一次 detached-suite fan-in 后 full-suite-state.json 反映该轮结果（真实输出，非 fixture）。

## Touches

- tasks/gap-full-suite-state-stale-no-writer.md（自身）
- plugin/scripts/mirror-full-suite-state.ts（新增：fan-in detached-suite 的 full-suite-state.json mirror-write 薄写入器）
- plugin/scripts/ready-pool-check.ts（collectFailureFiles / countUnattributedFailures 有边界 union + computeSuiteBlocking 透传 stateStartedAt）
- plugin/scripts/select-static-checks-for-touches.ts（FAN_IN_ORCHESTRATION_FILES 增补 mirror-full-suite-state.ts）
- plugin/scripts/capability-catalog.sh（新脚本 AC1c QUESTION/CADENCE/INVALIDATION/LAST_REAFFIRMED/MATCHING/CONSUMER 六表登记）
- docs/proposals/quay-product-outline.md（§6 DELIVERY-INVENTORY snapshot --write-inventory 再生成）
- plugin/workflows/fan-in-execute.js（step 4.5 增 mirror-state-block；双拷贝同步 .claude/workflows/fan-in-execute.js）
- .claude/workflows/fan-in-execute.js（双拷贝）
- plugin/test/mirror-full-suite-state.test.mjs（新增：mirror writer 形状 + fail-closed + overwrite）
- plugin/test/ready-pool-check.test.mjs（有边界 union 的正/负控制）
- plugin/test/fan-in-execute-paths.test.mjs（mirror-state-block wiring + 真实写 + doc-only skip 不伪造）

## Evidence

- scoped：`bash scripts/test.sh --for-task gap-full-suite-state-stale-no-writer` → exit 0，210 tests / 210 pass / 0 fail，含全部 change-relevant 静态检查（capability-catalog 六表登记 unclassified==0、delivery-inventory drift=0、workflows-dual-copy 5/5 一致、ts-typecheck gate GREEN ADMITTED）。
- AC1（mirror-write）：`plugin/scripts/mirror-full-suite-state.ts` 新增 + `fan-in-execute.js` step 4.5 `# mirror-state-block` 在 `full_suite_ran=true` 时 mirror-write 终态 green；带 in-flight 防踩闸（on-disk `finishedAt==null` ⇒ skip，不覆盖 running/early-red，避免打掉 full-suite-runner 的 generation-guarded 终态写）。真实块测试 `⑦b REAL mirror` 写出 `<dir>/.quay/full-suite-state.json`（state=green/finishedAt=epoch），`⑦b REAL skip` 证明 doc-only 不伪造 green。
- AC2（有边界 union）：`collectFailureFiles`/`countUnattributedFailures` 增 `stateStartedAt` 参数，`stateFailuresInWindow` 只并入落在当前红窗内的 state 失败；`ready-pool-check.test.mjs` 正/负控制（stale 排除、in-window 并入、无 time 向后兼容）。
- AC3（/tests 活数据）：/tests 页读的 `currentState` 即 full-suite-state.json 的 `state`，mirror-write 每次 green fan-in 后写入新鲜 `state`（吸收 gap-webui-tests-missing-startedat 表层症状）。
