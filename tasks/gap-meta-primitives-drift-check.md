---
id: gap-meta-primitives-drift-check
title: Re-pin the quay-fleet primitives provenance so primitives-drift-check can
  evaluate again
status: todo
labels:
  - meta-driver
  - driver-candidate
parent: null
children: []
extra: {}
---
## Finding
This round's inertCheckers carries primitives-drift-check: the cross-repo byte-identity guard returns exit 3 (NOT-EVALUATED) every round because the fleet commit pinned in its manifest no longer resolves in the fleet repo, so the two-copy discipline has no working mechanical defense, the honesty is recorded but unconsumed, and no open task owns the stale pin.

本轮读数（inertCheckers）= `["primitives-drift-check"]`，采于 2026-10-13T17:04:03Z，由 meta-driver 机械采集。
⚠️ 机制词 `primitives-drift-check` 命中【已完成】任务：gap-ac253-session-primitives-shared-layer-adoption.md[done]、gap-ac69-malformed-record-exits-3-and-passes-the-static-gate.md[done]、gap-develop-ci-red-node20-floor-and-static-not-evaluated.md[done]、gap-routine-semantic-dedup-scan-arg-parsing-helper-family.md[done]——问题仍在而任务已 done ⇒ 先查那些任务为何没解决它，⛔ 不要在它们旁边新造一个并行机制。

## AC（draft）
- [ ] `bash -c 'node --no-warnings --experimental-strip-types plugin/scripts/primitives-drift-check.ts --root . >/dev/null 2>&1; rc=$?; [ "$rc" -eq 0 ] || [ "$rc" -eq 1 ]'` ⇒ The check returns an evaluated verdict (exit 0 byte-identical, or exit 1 real drift to disposition) instead of its NOT-EVALUATED third state, i.e. the pin resolves again and the byte-identity contract is verifiable rather than silently off.

## DoD（draft）
- [ ] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红）
- [ ] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制

## Touches
- `plugin/scripts/primitives-drift-manifest.json`
- `packages/quay/src/primitives/PROVENANCE.md`
- `tasks/gap-meta-primitives-drift-check.md`