---
id: gap-cross-project-dogfood-claudecodeui-c3-fuepz9
title: "[cross-project dogfood] The resident selector parses only the first line
  of the model reply, so any prose first line (e.g. about a missing…"
status: ready
labels:
  - gap
  - cross-project-dogfood
parent: null
children: []
extra: {}
---
## Proposal
Cross-project Quay dogfooding round `cpd-943549-1791888744490-fuepz9` read the real usage artifacts of source project `claudecodeui` and formed this hypothesis; an independent verifier and an independent refuter both returned `supported`.

**Claim**: The resident selector parses only the first line of the model reply, so any prose first line (e.g. about a missing orchestration file) forces dispatch of candidates[0] instead of the intended pick.

**Quay-side components**: `plugin/scripts/driver-runtime.ts`

**Why this is Quay-generic, not host-local**: the claim names Quay's own mechanism, not the source project's product; the source project is only where the failure became visible.

## Evidence
- `plugin/scripts/driver-runtime.ts:2476` — Before choosing, read orchestration/dispatch-preference.md — its 覆盖段 carries the current priority (manager-maintained). Honor it unless a candidate is structurally ineligible ...
- `plugin/scripts/driver-runtime.ts:2490` — const line = String(stdout ?? "").trim().split("\n")[0]?.trim() ?? "";  // only the FIRST line is ever matched against candidate ids
- `plugin/scripts/driver-runtime.ts:2503` — reason: `selector worker returned no valid pick (exit ${exitCode ?? "null"}${got}${errFrag}); fallback to first shuffled candidate`
- `.quay/worker-outcome.jsonl:1298` — "selector_reason":"selector worker returned no valid pick (exit 0, got \"No `orchestration/dispatch-preference.md` exists in this repo root (only the qua\", stderr=\"\"v4.1flash\" isn't described ..."); fallback to first shuffled candidate"

- round: `cpd-943549-1791888744490-fuepz9` (record `cross-project-dogfood@cpd-943549-1791888744490-fuepz9::c3`)
- source project: `claudecodeui`
- verifier verdict: `supported`; refuter verdict: `supported`

## Plan
1. Reproduce the claim from the cited positions above (the artifact that exposed it), then read the named Quay-side surface.
2. Either fix the mechanism, or record why the claim does not hold for Quay's own code — the round's refuter was satisfied, so "it is only that host" needs its own evidence.
3. Correct `## Touches` to the files the fix actually changes before editing them.

## Acceptance Criteria
- [ ] the Quay-side mechanism named in the claim behaves as the claim says (reproduce it from the cited positions)
- [ ] the fix is verified on Quay's own tree, not only on the source project that exposed it

## Definition of Done
- the defect is fixed or shown not to exist, and the round's claim is answered in the task body.

## Touches
- `plugin/scripts/driver-runtime.ts`
- `tasks/gap-cross-project-dogfood-claudecodeui-c3-fuepz9.md`
