---
id: AC-926
title: AC-919 的契约判据改为真实 import 契约模块（不扫源码文本），且「模块缺席」记为 not-evaluated 而非 fail
status: draft
kind: criterion
goal: GOAL-911
criterion: "node --input-type=module -e 'const
  p=\"./docs/analysis/semantic-admission-contract.mjs\";const fs=await
  import(\"node:fs\");if(!fs.existsSync(p)){console.error(\"NOT-EVALUATED:
  contract module absent: \"+p);process.exit(3)}let m;try{m=await
  import(p)}catch(e){console.error(\"CAUSE=contract module unreadable:
  \"+(e&&e.message?e.message:e));process.exit(1)}const
  fail=(msg)=>{console.error(\"CAUSE=\"+msg);process.exit(1)};const
  clue=m.CLUE_STATES,judge=m.JUDGE_VERDICTS;if(!Array.isArray(clue)||!Array.isA\
  rray(judge))fail(\"CLUE_STATES/JUDGE_VERDICTS are not
  arrays\");if(!Object.isFrozen(clue)||!Object.isFrozen(judge))fail(\"vocabular\
  ies are not
  frozen\");if([...clue].sort().join()!==\"candidate,clear,not-evaluated\")fail(\
  \"CLUE_STATES=\"+JSON.stringify(clue));if([...judge].sort().join()!==\"confir\
  med,needs-more-evidence,refuted\")fail(\"JUDGE_VERDICTS=\"+JSON.stringify(jud\
  ge));const
  shared=[...clue].filter((v)=>judge.includes(v));if(shared.length)fail(\"vocab\
  ularies share values: \"+JSON.stringify(shared));if(clue===judge)fail(\"the
  two vocabularies are the same array object\");if(typeof
  m.checkVocabulariesDisjoint!==\"function\")fail(\"checkVocabulariesDisjoint is
  not exported\");const
  real=m.checkVocabulariesDisjoint(clue,judge);if(!real||real.evaluated!==true|\
  |(real.violations||[]).length)fail(\"real vocabularies judged as:
  \"+JSON.stringify(real));const
  iso=m.checkVocabulariesDisjoint(judge,judge);if(!iso||iso.evaluated!==true||!\
  (iso.violations||[]).length)fail(\"an isomorphic vocabulary was not reported
  by name: \"+JSON.stringify(iso));console.log(\"OK: real import — clue/judge
  vocabularies frozen, complete, disjoint; the disjointness check names an
  isomorphic vocabulary\")'"
expect: Pass means the goal's contract is verified from the module's runtime
  exports — clue vocabulary exactly candidate/clear/not-evaluated and frozen,
  judge vocabulary exactly confirmed/refuted/needs-more-evidence and frozen, the
  two are distinct arrays with empty intersection, and checkVocabulariesDisjoint
  reports the real pair clean while reporting an isomorphic pair by name — with
  no source-text scan anywhere, so mentioning a vocabulary in a comment can no
  longer turn it green. Module absent = exit 3 (criterion-declared
  not-evaluated), never a plain fail.
origin: "criteria[AC-919].criterion in this round's readings is a source-text
  scan — `fs.readFileSync(p,\"utf8\")` +
  `/CLUE_STATES[\\s\\S]{0,200}?confirmed/` + `s.includes(v)` — so a module that
  merely mentions the three verdicts in a comment satisfies it; the same goal
  already carries AC-921, whose title records the identical defect for AC-918
  ('准入判据读注册表对象本身（import），不扫源码文本——文本正则看不见与注释同形的常量 kind'), and
  tasks/gap-semantic-admission-contract-module.md states verbatim 'criterion
  只做源码字符串检查——只在注释里提到词表…都能让它变绿'. This proposal declares the replacement relation
  only: AC-919 keeps its status until a human retires it, and
  tasks/gap-semantic-admission-contract-module.md AC1 (which pins AC-919's
  current criterion text) would need re-pointing by that same human decision."
supersedes:
  - AC-919
---
