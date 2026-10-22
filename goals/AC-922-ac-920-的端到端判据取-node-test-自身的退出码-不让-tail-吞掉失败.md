---
id: AC-922
title: AC-920 的端到端判据取 node --test 自身的退出码，不让 tail 吞掉失败
status: draft
kind: criterion
goal: GOAL-911
criterion: node --test plugin/test/unencapsulated-state-admission.test.mjs
expect: "The AC is decided by the test runner's own exit status: any failing
  test in unencapsulated-state-admission.test.mjs makes the criterion exit
  non-zero. Until the test file lands the gate reports not-evaluated
  (cause=capability), which is honest; once it lands, a green suite is the only
  way to pass."
origin: "readings.criteria[AC-920]: verdict=not-evaluated, cause='capability' —
  the criterion was refused before execution (artifact
  plugin/test/unencapsulated-state-admission.test.mjs does not resolve).
  Independently of that refusal, the recorded criterion is `node --test
  plugin/test/unencapsulated-state-admission.test.mjs 2>&1 | tail -6`:
  packages/quay/src/core/acceptance-runner.ts runs criteria with
  spawnSync({shell: true}) (i.e. /bin/sh -c, no pipefail — both runAcceptance
  and runAcceptanceCapture), so the command's exit status is tail's, which is 0
  even when node --test exits non-zero (verified: `sh -c 'node -e
  \"process.exit(3)\" | tail -1; echo $?'` prints 0). That makes the goal's
  end-to-end AC structurally unable to fail — a command that cannot return
  non-zero is not a criterion (硬规则 4), and it would let GOAL-911 report its
  third AC achieved while every test in the new file fails. Retirement/rewording
  of AC-920 remains a human decision; this item only declares the replacement
  relation."
supersedes:
  - AC-920
---
