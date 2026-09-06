---
id: AC-144
title: 质量把关按【形状】分开驱动化，不得一股脑塞进 promotion-driver
status: active
kind: criterion
goal: GOAL-002
criterion: |
  node --no-warnings --experimental-strip-types -e 'import("./plugin/scripts/driver-runtime.ts").then(m=>{const k=m.DRIVER_KINDS.quality;process.exit(k&&k.driver==="quality-gate-driver.ts"&&k.carriers.includes("quality-round.jsonl")?0:1)})'
expect: exit 0
origin: |
  manager 2026-08-23 分析（人已见）：「质量把关」不是一件事；一股脑并入 promotion-driver
  会造出 god-object（其 scope 是任务合格化，不是冲突解析/止损判断）。
evidence:
  at: 2026-09-06T17:03:26.908Z
  verdict: pass
  reading: acceptance passed (exit 0)
---

**判据（能取假）**：四种形状分别处置——B15 pool 质量语义闸（已是 ADR-033「机械触发 + schema'd
LLM judge」形态 ⇒ 现成模板，调用方从 outer tick 换成 driver）；B17 判据消费纪律（纯机械审计
judgment-consumer-check.ts ⇒ 直接驱动化）；B16 冲突归因（A/B 类可机械 per-hunk 取并集；⛔ C 类
要读两边意图 ⇒ 保留语义面归 AC145）；B18 止损义务（活场景判断 ⇒ 保留语义面归 AC145）。

**取假**：①上述四项被并入**同一个** driver kind ⇒ 假（god-object）；②B16-C 类 / B18 被声称
"已驱动化"而无 LLM 参与 ⇒ 假（把语义判断伪装成机械判断）。


