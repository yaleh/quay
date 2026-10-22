---
id: AC-921
title: AC-918 的准入判据读注册表对象本身（import），不扫源码文本——文本正则看不见与注释同形的常量 kind
status: achieved
kind: criterion
goal: GOAL-911
criterion: "node --input-type=module -e 'const m=await
  import(\"./docs/analysis/ownership-active-limited-proposal.mjs\");const
  want={\"package-cycle\":\"mechanical\",\"design-evolution-regression\":\"mech\
  anical\",\"god-file-size\":\"semantic-judged\",\"unencapsulated-state\":\"sem\
  antic-judged\",\"spine-without-extension-point\":\"semantic-judged\"};const
  got=Object.fromEntries(m.CONCERN_KIND_REGISTRY.map(e=>[e.kind,e.admission]));\
  const bad=Object.entries(want).filter(([k,v])=>got[k]!==v);const
  invalid=m.CONCERN_KIND_REGISTRY.filter(e=>e.admission!==\"mechanical\"&&e.adm\
  ission!==\"semantic-judged\").map(e=>e.kind);if(bad.length||invalid.length){c\
  onsole.error(\"ADMISSION-WRONG bad=\"+JSON.stringify(bad)+\"
  invalid=\"+JSON.stringify(invalid)+\"
  got=\"+JSON.stringify(got));process.exit(1)}console.log(\"OK:
  \"+Object.keys(want).length+\" registered kinds carry the declared
  admission\")'"
expect: Passes only when CONCERN_KIND_REGISTRY itself (as imported, not as
  source text) carries the declared admission on all five kinds and every
  entry's value is one of the two legal tokens; fails today (no entry has
  admission) and fails if any value is wrong or missing, with the offending
  kinds named.
origin: "readings.criteria[AC-918]: verdict=fail, reason='acceptance failed
  (exit 2) — CAUSE=instrument-failure: no kind+admission pairs parsed' — yet
  docs/analysis/ownership-active-limited-proposal.mjs exists and its
  CONCERN_KIND_REGISTRY does carry all four current kinds by value. The
  criterion's `kind:\\s*\"([a-z-]+)\"` pattern can only match a quoted literal,
  but the two mechanical kinds are registered as `kind: CONCERN_KIND_IN_SCOPE`
  and `kind: DESIGN_EVOLUTION_KIND` (module constants in that file), so a
  correct implementation that keeps the constants would be reported as `missing:
  [package-cycle, design-evolution-regression]` — a false negative that reads
  like a value mismatch. Conversely the same regex runs over raw source text, so
  a `kind: \"package-cycle\"` / `admission: \"mechanical\"` pair inside a
  COMMENT satisfies it (硬规则 2: 按位置判定, 注释里提到不算命中). Importing the module is
  verified runnable today (node --input-type=module -e import of that path
  succeeds; the file imports only node:fs / node:path). AC-918's own `expect`
  also claims it verifies 'Planner 的 C1 准入按 admission 分派', which no text scan of
  the registry can cover — that half needs a behavioural criterion once the C1
  path exists. Retirement/rewording of AC-918 remains a human decision; this
  item only declares the replacement relation."
activatedAt: 2026-10-22T10:17:09.697Z
statusLog:
  - at: 2026-10-22T10:17:09.697Z
    from: draft
    to: active
    actor: goal-driver
    reason: "triage: activate"
  - at: 2026-10-22T10:59:01.115Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
supersedes:
  - AC-918
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-10-22T10:17:09.697Z
---
