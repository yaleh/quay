# Malformed fixture checked Plan for milestone-preparation-check.test.mjs (RED fixture)

DIR-117 iteration-2 item 3: Stage 2 is entirely missing, so the fixture task's AC item two is
never mapped to any Plan stage. validatePlanStructure() must reject this with `plan-ac-not-mapped`.

### Stage 1: cover fixture AC item one
- AC: 1
- Files: experiments/quay-perpetual-stream/fixtures/preparation/fixture-source.ts
- Command: `node --check experiments/quay-perpetual-stream/fixtures/preparation/fixture-source.ts`

(No Stage 2 — AC item two is never mapped to any stage. This file must always FAIL
validatePlanStructure()/checkPreparation() — it is intentionally never a valid receipt target.)
