---
id: AC-918
title: 注册表每个条目有 admission 字段，mechanical/semantic-judged 取值正确且 Planner 按它分派
status: active
kind: criterion
goal: GOAL-911
criterion: "node -e 'const fs=require(\"fs\");const
  s=fs.readFileSync(\"docs/analysis/ownership-active-limited-proposal.mjs\",\"u\
  tf8\");const
  entries=[...s.matchAll(/kind:\\s*\"([a-z-]+)\"[\\s\\S]*?admission:\\s*\"([a-z\
  -]+)\"/g)].map(m=>[m[1],m[2]]);if(entries.length===0){process.stderr.write(\"\
  CAUSE=instrument-failure: no kind+admission pairs
  parsed\\n\");process.exit(2)}const
  want={\"package-cycle\":\"mechanical\",\"design-evolution-regression\":\"mech\
  anical\",\"god-file-size\":\"semantic-judged\",\"unencapsulated-state\":\"sem\
  antic-judged\",\"spine-without-extension-point\":\"semantic-judged\"};const
  got=Object.fromEntries(entries);const
  bad=Object.entries(want).filter(([k,v])=>got[k]!==v);const
  missing=Object.keys(want).filter(k=>!(k in
  got));if(bad.length||missing.length){process.stderr.write(\"CAUSE=admission
  mismatch: bad=\"+JSON.stringify(bad)+\" missing=\"+JSON.stringify(missing)+\"
  got=\"+JSON.stringify(got)+\"\\n\");process.exit(1)}console.log(\"OK:
  admission field present and correct on \"+Object.keys(want).length+\"
  registered kinds\")'"
expect: 正向：`CONCERN_KIND_REGISTRY` 每个已注册条目都带 `admission` 字段，且 `package-cycle` /
  `design-evolution-regression` = `mechanical`，`god-file-size` /
  `unencapsulated-state` / `spine-without-extension-point` =
  `semantic-judged`；Planner 的 C1 准入按 `admission` 分派（mechanical 走既有 delta
  判定，semantic-judged 走两段管线，绝不直接机械确认）。反向（能取假）：把任一条目的 `admission` 改成错误值（例如把
  `package-cycle` 改成 `semantic-judged`），criterion exit 1 并具名 bad；删掉 `admission`
  字段，exit 1 并具名 missing。
origin: GOAL-911 设计（人 2026-10-22 裁定「线索 vs 语义判断」做成通用结构）：注册表需显式区分
  mechanical（机械可确认）与 semantic-judged（机械只产线索、语义做判断）
activatedAt: 2026-10-22T10:27:54.627Z
statusLog:
  - at: 2026-10-22T10:27:54.627Z
    from: draft
    to: active
    actor: goal-driver
    reason: "triage: activate"
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-10-22T10:27:54.627Z
---
