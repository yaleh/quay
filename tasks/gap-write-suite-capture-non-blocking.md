---
id: gap-write-suite-capture-non-blocking
title: writeSuiteCapture 观测写不得阻塞 fan-in——写失败 fail-open，ff 闸改读权威源
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

审计命中（gap-observability-blocks-main-execution-audit 实锤 1）：`writeSuiteCapture`（worker-driver.ts:2036）用 `fs.mkdirSync` + `fs.writeFileSync`，**无 try/catch、非 best-effort**；调用点 :2353/:2365 是裸调用。写失败（磁盘/权限）⇒ 异常传播到外层 `catch (e) → failClean("exception")` ⇒ **整个 fan-in 失败，即使 suite 已绿**。capture 是 suite 结果的派生观测载体（ff 闸 fan-in-ff-merge.sh AC1 收窄读 suite_exit/suite_head），观测写失败弄死落地——违反人 2026-08-30 裁定「观测不得阻塞主执行」。

修复：capture 写改为 fail-open（写失败 WARN，不 fail fan-in）；同时 ff 闸在 capture 缺失/不可读时改读**权威源**（full-suite-state.json 的 suite 终态 / mfi 的 suiteOutcome + suiteHead），不因 capture 缺失误拒一个真实绿 suite。

## Plan

1. `writeSuiteCapture` 包 try/catch：写失败打 WARN 到 stderr + fan-in 日志，不抛。调用点不变。
2. ff 闸（fan-in-ff-merge.sh）AC1 收窄改为：capture 可读则用 capture；capture 缺失/不可读则回退读权威源（full-suite-state 的 suite 终态 / worker-outcome 的 mfi），判定 suite 是否真实绿。
3. 测试：capture 写失败（只读目录/mock）⇒ fan-in 继续且绿 suite 落地；capture 缺失但 suite 真实绿 ⇒ ff 不误拒；正常路径 capture 照常写不回归。

## Acceptance Criteria

- [x] AC1（能取假，负控制）：构造 capture 写失败（如目标目录只读）⇒ fan-in 不因 capture 失败 fail，绿 suite 仍落地。
- [x] AC2（能取假，ff 不误拒）：capture 缺失但 suite 真实绿（权威源可见）⇒ ff 不误拒。
- [x] AC3（能取假，回归）：正常路径 capture 照常写出、ff 闸主路径行为不变。

## Definition of Done

一次 capture 写失败的真实/构造场景下 fan-in 不因观测写失败而弄红；ff 闸在 capture 缺失时可从权威源判定 suite 真实性。

## Touches

- plugin/scripts/worker-driver.ts（writeSuiteCapture fail-open）
- plugin/scripts/fan-in-ff-merge.sh（ff 闸回退权威源）
- plugin/test/worker-driver.test.mjs（capture 写失败负控制）
- plugin/test/fan-in-ff-merge.test.mjs（capture 缺失回退）
- tasks/gap-write-suite-capture-non-blocking.md（自身）