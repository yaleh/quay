---
id: gap-arch-discovery-space-instrument-has-no-candidate-universe-on-non-quay-hosts
title: arch_discovery 的 space 仪器在非 quay 宿主上 candidates 恒为 0（候选集是 quay 自己的
  enum-surface 注册表、routine 不传 --registry），却记成 exit:0 干净轮
status: todo
labels:
  - gap
  - architecture-discovery
parent: null
children: []
extra: {}
---
## Proposal
**Measured 2026-10-14 on ClaudeCodeUI, the first non-quay host to run `arch_discovery` (enabled this session; official dist kernel built from develop `4a322afab`).** The first resident round (`.quay/arch-discovery-findings.jsonl`, scan-round ts `2026-10-14T03:33:15.908Z`) produced 45 findings. **All 45 came from the `time` instrument** (suite-red recurrence over ClaudeCodeUI's own fan-in history, 41/45 with an empty `verdict`). The **`space` instrument (the structural one) contributed zero**, and the round records it as a clean run: `instruments.space = {exit:0, wall_ms:79}`.

That zero is not a measurement of ClaudeCodeUI. Running the shipped instrument by hand with the exact argv the routine used:
```
arch-discovery-space.mjs --scan --root /data/home/yale/work/claudecodeui  → cost:{wall_ms:27, git_calls:3, candidates:0}, results:[]
arch-discovery-space.mjs --scan --root /data/home/yale/work/quay          → cost:{wall_ms:3154, git_calls:127, candidates:13}, 13 results (drift-hypothesis/legit-difference/undetermined)
```
`arch-discovery-space.mjs:28-33` explains the gap. In `--scan` mode, candidates come from quay's own `enum-surface-parity-check` registry ("as shipped in this instrument's own checkout"). A foreign tree is scannable only through `--registry <json>`, which "lets a fixture/foreign tree declare its own authorities+surfaces". **`arch-discovery-routine.ts` never passes `--registry`** (zero occurrences in the routine), and its config schema has no key for it. So on every non-quay host the space half is structurally incapable of a finding, and that incapacity is recorded in the same shape as "scanned, nothing found" (硬规则 3b / 4: a reading that cannot be non-zero carries no information and must not look like a pass).

This is Quay-generic, not a ClaudeCodeUI config problem. It applies to every host that is not quay's own repo, including the clean-room acceptance hosts, where `arch_discovery: verified` likewise came from `time` alone.

## Plan
1. **Make the zero honest first.** When the space instrument reports `candidates: 0`, the routine records a distinct, legible state, for example `space: not-evaluated:no-candidate-universe`, carrying the instrument's own `cost.candidates`. It must not fold that into a clean `exit:0` round. This alone is enough to stop the false reading.
2. **Give hosts a declared way in, as data rather than code.** Add an optional `loop.arch_discovery.space_registry: <repo-relative path>` key. When present, the routine passes `--registry <abs path>` to the space instrument. The registry stays a data file in the checker's own registry format. Quay ships no host-specific analyzer, and the host declares only its authorities and surfaces.
3. Do not change the `time` instrument. Do not change `space`'s behavior on quay's own root, where the default candidate set must stay byte-identical.

## Acceptance Criteria
- [ ] AC1: on a non-quay fixture root with no registry, the routine's scan-round records space as `not-evaluated` (or equivalent distinct state) with `candidates:0` surfaced, not as a clean exit. Negative control: the pre-fix routine on the same root records `{exit:0}` with no such marker. Both readings pasted.
- [ ] AC2: the same fixture root with a minimal `space_registry` declaring one authority+surface that genuinely drifts yields ≥1 real space candidate in the round. A registry declaring a non-drifting pair yields a candidate judged non-drift. This shows the registry is load-bearing in both directions.
- [ ] AC3: quay's own root: space candidate set and results are unchanged before/after (count + ids pasted).
- [ ] AC4: a malformed `space_registry` path or file fails closed with a legible reason, not a silent zero.
- [ ] AC5: `scripts/test.sh --for-task <this task>` green.

## Definition of Done
- AC1-AC5 checked with pasted evidence.
- No host-specific analyzer code is added to Quay or to any host. The only host-side artifact is an optional, declarative registry data file.

## Touches
- tasks/gap-arch-discovery-space-instrument-has-no-candidate-universe-on-non-quay-hosts.md
- plugin/scripts/arch-discovery-routine.ts
- docs/analysis/arch-discovery-space.mjs
- plugin/test/arch-discovery-routine.test.mjs
