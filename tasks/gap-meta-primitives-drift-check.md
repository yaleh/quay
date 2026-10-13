---
id: gap-meta-primitives-drift-check
title: Re-pin the quay-fleet primitives provenance so primitives-drift-check can
  evaluate again
status: ready
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
- [x] `bash -c 'node --no-warnings --experimental-strip-types plugin/scripts/primitives-drift-check.ts --root . >/dev/null 2>&1; rc=$?; [ "$rc" -eq 0 ] || [ "$rc" -eq 1 ]'` ⇒ The check returns an evaluated verdict (exit 0 byte-identical, or exit 1 real drift to disposition) instead of its NOT-EVALUATED third state, i.e. the pin resolves again and the byte-identity contract is verifiable rather than silently off. —— 实跑（worktree，`--root .`）：改前 rc=3 NOT-EVALUATED（cannot read 446ba9aa:packages/agent-core/src/pty-frame.mjs from /home/yale/work/quay-fleet）→ 改后 rc=0、四文件 ok local==fleet==pinned；取假控制：给 session-schema.mjs 追加一字节 ⇒ rc=1 且点名该文件，还原 ⇒ rc=0；NOT-EVALUATED 仍可达：`--fleet /nonexistent-fleet` ⇒ rc=3

## DoD（draft）
- [x] 上面的判据实跑通过，且判据本身能取假（改坏实现时会红） —— 判据实跑通过（上一行），取假两面都验过：本地一字节 ⇒ 1；fleet 侧漂移由 plugin/test/primitives-drift-check.test.mjs 的 fixture 臂覆盖（7/7 绿）。附带一个被解冻的消费者：plugin/test/session-primitives-adoption.test.mjs 的 AC2 原为 t.skip（pinned SHA unreadable in /home/yale/work/quay-fleet），现实跑四条 fleet blob 比对——pass 9→10、skipped 1→0
- [x] 若结论是「已有机制在管、只是失败」，则修那个机制，⛔ 不新建并行机制 —— 结论正是「已有机制在管、只是失败」：primitives-drift-check.ts + manifest 都在管，坏的是 pin 的载体——fleetRepo 指的那个检出于 2026-10-12 被重新初始化为另一个项目。修法只换载体（改为冻结镜像 /data/home/yale/work/quay-fleet-org.git，由只读归档 quay-fleet-org.tar.gz 机械克隆而来）并在 PROVENANCE.md 写清缘由与重建命令；未新建并行机制、未改 checker 代码、fleetSha/fleetSourceDir/四条 sha256 一字未动

## Touches
- `plugin/scripts/primitives-drift-manifest.json`
- `packages/quay/src/primitives/PROVENANCE.md`
- `tasks/gap-meta-primitives-drift-check.md`

## Blocker

**2026-10-13T17:28:52.707Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=ff: fan-in-ff-merge: suite 证书 — suite_head..tip 恰为本任务的单个 flip-done 提交（身份判定：仅 M tasks/gap-meta-primitives-drift-check.md）⇒ 判惰性，⛔ 未调分类器
fan-in-ff-merge: FF FAILED — To .; not a fast-forward. Retry record written (attempt 1). Return to 无锁段 step 1 (merge develop again — 必须 merge 不得 rebase, AC75), re-judge the delta (step 2) and re-run.
fan-in-ff-merge: measure ff_only_locked=false
- run_id：wk-prod-anchor
- session_id：73a50246-57c4-49d8-9d72-988820b7cac7
