---
id: gap-cross-project-dogfood-claudecodeui-c1-ccx5t6
title: "[cross-project dogfood] Fan-in retry records capture only the first line
  of git's combined push output, so an ordinary non-fast-forward is…"
status: ready
labels:
  - gap
  - cross-project-dogfood
parent: null
children: []
extra: {}
---
## Proposal
Cross-project Quay dogfooding round `cpd-3268698-1792199271253-ccx5t6` read the real usage artifacts of source project `claudecodeui` and formed this hypothesis; an independent verifier and an independent refuter both returned `supported`.

**Claim**: Fan-in retry records capture only the first line of git's combined push output, so an ordinary non-fast-forward is logged as error "To ." and the rejection reason is never recorded.

**Quay-side components**: `packages/quay/src/fan-in/ff-merge.ts`

**Why this is Quay-generic, not host-local**: the claim names Quay's own mechanism, not the source project's product; the source project is only where the failure became visible.

## Evidence
- `.quay/fan-in-retries.jsonl:1` — {"taskId":"gap-quay-tests-page-perfile-wrapper",...,"error":"To .","attemptKey":"mfi-..."} — same bare "To ." on lines 2,3,5,6,7,8 (7 of 8 records)
- `packages/quay/src/fan-in/ff-merge.ts:944` — mergeErr = (m.stdout + m.stderr).trim().split("\n")[0] ?? "";  // push-mode ffCmd at :939 = git push . <src>:refs/heads/<target>, whose first stderr line is 'To .'

- round: `cpd-3268698-1792199271253-ccx5t6` (record `cross-project-dogfood@cpd-3268698-1792199271253-ccx5t6::c1`)
- source project: `claudecodeui`
- verifier verdict: `supported`; refuter verdict: `supported`

### Re-verified on Quay's own tree (this task's worker, 2026-10-17)
Read positions, post-fix numbering (the fix added 22 lines above them): `extractFfErrorReason` at `:142`, the ff call site at `:966`, the inert-delta in-lock retry call site at `:988`, the push-mode `ffCmd` at `:960` (`["git","-C",root,"push",".",`${sourceRef}:refs/heads/${mergeTarget}`]`).

Ledger census over THIS workspace's `.quay/fan-in-retries.jsonl` (345 records, read with `node`, not by eye):

| recorded `error` | count |
|---|---|
| `"To ."` | **145** |
| `hint: Diverging branches can't be fast-forwarded, you need to either:` | 197 |
| `remote: error: refusing to update checked out branch: refs/heads/develop` | 3 |

Raw-output reproduction (two-commit scratch repos on this host, byte-for-byte against those recorded strings):

```
$ git push . stale:refs/heads/develop      # the push-mode ffCmd, develop already advanced
exit=1
stderr:
To .
 ! [rejected]        stale -> develop (non-fast-forward)
error: failed to push some refs to '.'
hint: Updates were rejected because a pushed branch tip is behind its remote
...
$ (stdout+stderr).trim().split("\n")[0]  →  "To ."        ← the 145 records, reproduced
```

```
$ git merge --ff-only task/x               # the merge-mode ffCmd, branches diverged
exit=128
stderr: (9 hint: lines …) , last line: fatal: Not possible to fast-forward, aborting.
$ (stdout+stderr).trim().split("\n")[0]  →  "hint: Diverging branches …"   ← the 197 records
```

Both `ffCmd` modes open with a **banner/hint**, never the reason. Push mode is the production mode: the main checkout sits on `author`, so `branch --show-current !== develop` and the ff degenerates to `git push .` (ff-merge.ts `:859`).

## Plan
1. Reproduce the claim from the cited positions above (the artifact that exposed it), then read the named Quay-side surface.
2. Either fix the mechanism, or record why the claim does not hold for Quay's own code — the round's refuter was satisfied, so "it is only that host" needs its own evidence.
3. Correct `## Touches` to the files the fix actually changes before editing them.

## Result — the claim is CONFIRMED and the defect is FIXED
**Claim verdict: `supported`, and "it is only that host" is refuted** — the mechanism is Quay's own (`packages/quay/src/fan-in/ff-merge.ts`), reproduced on Quay's tree, and its residue is in Quay's own ledger (145/345 records).

**Fix**: `extractFfErrorReason(stdout, stderr)` (`:142`) replaces `(stdout+stderr).trim().split("\n")[0]` at both call sites (`:966`, `:988`). It drops the `To <dest>` transport banner, then prefers the line git uses to **state the verdict** (`! [rejected] …` / `error:` / `fatal:`) over a `hint:`. PURE — no git call — so both modes' real outputs drive it as fixtures. Recorded values after the fix:

| mode | before | after |
|---|---|---|
| push | `To .` | `! [rejected]        stale -> develop (non-fast-forward)` |
| merge | `hint: Diverging branches can't be fast-forwarded, you need to either:` | `fatal: Not possible to fast-forward, aborting.` |

The operator-facing `FF FAILED — ${mergeErr}; not a fast-forward.` message (`:1022`) now carries the same reason.

**Negative control (硬规则 4 推论三 — the test must be one the pre-fix code FAILS):** reverting both call sites to the old expression and re-running the new e2e case reds it with `AssertionError: ⛔ the pre-fix defect: the banner was recorded… actual: 'To .'`. Post-fix it passes. The test discriminates on the defect itself, not on a fixture echo.

**Sibling scan (硬规则 5b — "在某处修好 X ≠ X 只在那一处")** over `packages/` + `plugin/scripts/` for the same "keep only the first line of a multi-line captured output" idiom — 27 hits, judged by *position* (硬规则 2), not by count:
- `plugin/scripts/driver-filters.ts:799` (`ffPushToDevelop`, same `git push . <src>:develop`) — **already correct**, takes `slice(0,3).join(" | ")` from stderr. This is the convention `ff-merge.ts` had drifted from: the defect was a straggler of an already-fixed class.
- `plugin/scripts/freshness-producer-coverage-check.ts:491`, `plugin/scripts/prod-data-audit.ts:364`, `plugin/scripts/fast-mode-telemetry.ts:789/796/851/992` — `[0]` **is the value by design** on a successful call (merge-tree sha / first `find` path / `rev-parse`), several shape-guarded by `/^\d+$/`. Not this class.
- `packages/quay/src/fan-in/ff-merge.ts:569` (`classifyDeltaVerdict`) — same file, same idiom, but a **different surface**: a Node child's *crash* detail, where line 0 is usually the real `Error:` (the helper's banner/verdict logic is git-specific and would mis-pick there). No measured occurrence ⇒ recorded as an **observation, not fixed** (硬规则 12).
- The three other local `push .` call sites (`store.ts:1349`, `store-commit.ts:188/253`) discard the output or reduce it to a boolean.

## Acceptance Criteria
- [x] the Quay-side mechanism named in the claim behaves as the claim says (reproduce it from the cited positions)
- [x] the fix is verified on Quay's own tree, not only on the source project that exposed it

## Definition of Done
- the defect is fixed or shown not to exist, and the round's claim is answered in the task body.

## Touches
- `packages/quay/src/fan-in/ff-merge.ts`
- `packages/quay/test/ff-merge.test.mjs`
- `plugin/test/fan-in-ff-merge.test.mjs`
- `tasks/gap-cross-project-dogfood-claudecodeui-c1-ccx5t6.md`
