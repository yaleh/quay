---
id: gap-cross-project-dogfood-quay-self-usage-c2-rk5czv
title: "[cross-project dogfood] Quay's meta-driver re-emits the same
  take-develop rejection every tick with no debounce or human escalation, so
  one…"
status: done
labels:
  - gap
  - cross-project-dogfood
parent: null
children: []
extra: {}
---
## Proposal
Cross-project Quay dogfooding round `cpd-771863-1793687392142-rk5czv` read the real usage artifacts of source project `quay-self-usage` and formed this hypothesis; an independent verifier and an independent refuter both returned `supported`.

**Claim**: Quay's meta-driver re-emits the same take-develop rejection every tick with no debounce or human escalation, so one dirty worktree freezes sync for 30+ min.

**Quay-side components**: `plugin/scripts/meta-driver.ts`, `plugin/scripts/driver-filters.ts`

**Why this is Quay-generic, not host-local**: the claim names Quay's own mechanism, not the source project's product; the source project is only where the failure became visible.

## Evidence
- `/data/home/yale/work/quay/tasks/gap-meta-call-author-develop-take-develop-30.md:16` — 选项与代价：A 保持每 tick 重拒… B 按状态变化消抖… C 消抖+升级：连续 N 次同因拒绝后写 META/needs-human 信号，闭合冻结盲区
- `/data/home/yale/work/quay/tasks/gap-meta-call-author-develop-take-develop-30.md:19` — syncHealth.semanticTakeDevelopRefused = 7（meta-driver 机械采集）…全部来自同一次 .mcp.json 脏工作树事件
- `/data/home/yale/work/quay/plugin/scripts/driver-filters.ts:911` — reset 前先枚举工作树；有任何 reset 会破坏的状态 ⇒ 拒绝

- round: `cpd-771863-1793687392142-rk5czv` (record `cross-project-dogfood@cpd-771863-1793687392142-rk5czv::c2`)
- source project: `quay-self-usage`
- verifier verdict: `supported`; refuter verdict: `supported`

## Plan
1. Reproduce the claim from the cited positions above (the artifact that exposed it), then read the named Quay-side surface.
2. Either fix the mechanism, or record why the claim does not hold for Quay's own code — the round's refuter was satisfied, so "it is only that host" needs its own evidence.
3. Correct `## Touches` to the files the fix actually changes before editing them.

## Result
**Claim reproduced on Quay's own tree** (`/data/home/yale/work/quay/.quay/doc-develop-sync.jsonl`, read 2026-11-03): all 21 `doc-develop-sync-semantic-take-develop-refused` events carry `reason:"dirty-working-tree"` and `offendingPaths:[".mcp.json"]`, one every ~70s from 2026-10-31T09:16:36Z to 09:41:12Z — 21 near-identical refusals from ONE `.mcp.json` dirty-worktree event (the finding's original count of 7 has since grown to 21). Each refusal is preceded by the same `ff-error`/`semantic`/`conflict` prefix and followed by `doc-develop-sync-bidirectional` with `docToDevelop:"false"`. **The re-emission (no-debounce) half of the claim holds as stated.**

**Defect fixed** in `plugin/scripts/driver-filters.ts`: `refuseTakeDevelop` now debounces by cause — before appending it reads the most recent *uncleared* refusal (`lastOngoingRefusal`) and skips when `reason` + `offendingPaths` are unchanged. "Uncleared" is the operative word: a `doc-develop-sync-ff-synced` / `doc-develop-sync-semantic-resolved` / `doc-develop-sync-bidirectional` with `docToDevelop:"true"` after a refusal marks that block as over, so a later same-cause refusal is a NEW block and is recorded again. One blocking cause = one refusal event; `syncHealth.semanticTakeDevelopRefused` becomes interpretable (1 cause, not 21 ticks).

**The escalation half is answered, not silently dropped**: whether to auto-file a META/needs-human signal after N same-cause refusals is the A/B/C direction choice already routed to a human as `gap-meta-call-author-develop-take-develop-30` (`needs-human`, label `meta-human-call`). The machine did not unilaterally pick option C — that task's finding records two irreversibly-conflicting standing positions and reserves the choice for a human. The debounce landed here is the mechanical prerequisite that option C's "N consecutive same-cause refusals" needs as a clean count, without adding the new notification path that only option C would.

**Out of scope (reported, not fixed)**: the *precursor* events of the same failed attempt (`doc-develop-sync-ff-error` ×2, `doc-develop-sync-semantic`, `doc-develop-sync-semantic-conflict`) still re-emit each tick while the worktree stays dirty. They are not the "take-develop rejection" this claim names, and collapsing them would merge distinct failure phases — a separate decision.

**Verification**: `plugin/test/driver-filters.test.mjs` gains three tests — same-cause refusal across two sync ticks writes exactly one refusal event; a changed `offendingPaths` writes a new one; a cleared-then-reblocked block (same cause) writes a new one. `node --no-warnings --experimental-strip-types --test plugin/test/driver-filters.test.mjs` → 93/93 pass (3 new). Negative control: the same-cause test asserts `countRefusals === 1` after two ticks; reverting the debounce re-appends the second refusal and the test reds (so it measures the fix, not a constant).

## Dark Axis（ADR-007）

该轴仍暗,理由:本任务只改 `plugin/scripts/driver-filters.ts` 的拒绝事件消抖与 `plugin/test/driver-filters.test.mjs` 的对应测试，不改变包/依赖结构，L_D/L_G 无本任务可归因的结构读数。

## Acceptance Criteria
- [x] the Quay-side mechanism named in the claim behaves as the claim says (reproduce it from the cited positions)
- [x] the fix is verified on Quay's own tree, not only on the source project that exposed it

## Definition of Done
- the defect is fixed or shown not to exist, and the round's claim is answered in the task body.

## Touches
- `plugin/scripts/driver-filters.ts`
- `plugin/test/driver-filters.test.mjs`
- `tasks/gap-cross-project-dogfood-quay-self-usage-c2-rk5czv.md`