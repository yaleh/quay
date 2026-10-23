---
id: AC-919
title: 两段契约作为一份可复用模块存在，线索词表不含 confirmed、判断词表三态齐全且互不同形
status: achieved
kind: criterion
goal: GOAL-911
criterion: "node -e 'const fs=require(\"fs\");const
  p=\"docs/analysis/semantic-admission-contract.mjs\";if(!fs.existsSync(p)){pro\
  cess.stderr.write(\"CAUSE=instrument-failure: \"+p+\"
  missing\\n\");process.exit(2)}const
  s=fs.readFileSync(p,\"utf8\");if(/CLUE_STATES[\\s\\S]{0,200}?confirmed/.test(\
  s)){process.stderr.write(\"CAUSE=clue vocabulary contains confirmed (hard-rule
  3b: clue must not be isomorphic to verdict)\\n\");process.exit(1)}for(const v
  of
  [\"confirmed\",\"refuted\",\"needs-more-evidence\"]){if(!s.includes(v)){proce\
  ss.stderr.write(\"CAUSE=judge verdict missing:
  \"+v+\"\\n\");process.exit(1)}}console.log(\"OK: contract present; clue
  excludes confirmed; judge verdicts present\")'"
expect: 正向：`docs/analysis/semantic-admission-contract.mjs`
  作为**一份**可复用契约存在，导出线索层词表（`candidate` 等，**不含** `confirmed`）与判断层词表（`confirmed` /
  `refuted` / `needs-more-evidence`），且两套词表是独立取值、互不同形（硬规则 3b）；契约是单一模块，不按 kind
  复制。反向（能取假）：删掉判断层任一词条（例如 `needs-more-evidence`），criterion exit 1 具名缺失；给线索层词表加上
  `confirmed`，exit 1 具名违例；文件不存在，exit 2（instrument-failure，不与不合格同形）。
origin: GOAL-911 设计：两段管线（线索 → 语义判断）的契约应是一份可复用模块，三态词表各是独立取值（硬规则 3b）
activatedAt: 2026-10-22T10:07:48.504Z
statusLog:
  - at: 2026-10-22T10:07:48.504Z
    from: draft
    to: active
    actor: goal-driver
    reason: "triage: activate"
  - at: 2026-10-23T12:59:36.457Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-10-22T10:07:48.504Z
---
