---
id: AC-923
title: C1 准入闸真正消费 registry 的 admission 字段：非法取值必须按名拒绝，而不是继续走机械判定
status: draft
kind: criterion
goal: GOAL-911
criterion: "node --input-type=module -e 'const m=await
  import(\"./docs/analysis/ownership-active-limited-proposal.mjs\");const
  bad=m.CONCERN_KIND_REGISTRY.map(e=>e.kind===\"package-cycle\"?{...e,admission:\
  \"bogus\"}:e);const
  r=m.evaluateEntryBar([{concern_kind:\"package-cycle\"}],{registry:bad});if(!/\
  admission/i.test(r.reason||\"\")){console.error(\"ADMISSION-NOT-CONSUMED: C1
  gate produced no admission-shaped refusal for an illegal admission value;
  reason=\"+(r.reason||\"<none>\"));process.exit(1)}console.log(\"OK: C1 gate
  refuses an illegal admission value\")'"
expect: 今天 exit 1（reason=CONDITION_2_NOT_MET:no slice_delta…）——闸完全无视
  admission；当且仅当 C1 准入闸（evaluateEntryBar）先校验 registry 的 admission
  并按名拒绝非法取值时，exit 0。判据读运行时输出，不看源码排版。
origin: "readings.criteria[AC-918]: verdict=fail, reason='acceptance failed
  (exit 2) — CAUSE=instrument-failure: no kind+admission pairs parsed'，且
  timeSeries goal:AC-918:verdict unchanged
  count=5。读码核实根因：docs/analysis/ownership-active-limited-proposal.mjs:319-404
  的条目写的是 `admission: CONCERN_ADMISSIONS.MECHANICAL`（常量引用，无引号字面量）与 `kind:
  CONCERN_KIND_IN_SCOPE`，AC-918 的
  `kind:\\s*\"([a-z-]+)\"…admission:\\s*\"([a-z-]+)\"` 正则结构上匹配不到任何一条 ⇒
  该判据永不通过。AC-921（achieved，verdict=pass）已接管「字段取值正确」这半边。但 AC-918 标题的另一半「Planner
  按它分派」无人测量：evaluateEntryBar（:510）全文不读
  `entry.admission`，registryAdmissionViolations（:427，带 evaluated:false/cause
  的独立取值）只有 plugin/test/ownership-active-limited-proposal.test.mjs 一个消费者，零生产消费者 ⇒
  字段被携带、从不被消费。本条接管 AC-918 那半边错误持有的判据面；⛔ 退役 AC-918 本身仍是人的决定，本提议只声明取代关系，不改其
  status。"
supersedes:
  - AC-918
---
