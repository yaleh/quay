# Provider-ABI capability matrix (M03-abi-eval, iteration-0)

`{read, write, gate, skill} × {status, title, body, labels, parent/children} × {native, github}`.
Legend: **full** (fully implemented, exercised live/tested this iteration or by an existing,
cited test) / **partial** (implemented for a subset, e.g. status-only write) / **none**
(no code path exists — CLI/MCP schema does not accept it, confirmed by reading source, not
inferred from provider.yml prose alone).

Each cell cites either a `provider.yml`/source-code line reference, or a live smoke-check
transcript from this iteration (§ pointers refer to `iterations/iteration-0.md`).

## Read capability

| field | native | github |
|---|---|---|
| status | **full** — `task_get`/`task_list` return `status` (`quay-native/src/store.js`, `provider.yml: data.read: true`). Live-verified §5.2 (`task_get ABI-P1 -> status=todo`). | **full** — `task_get`/`task_list` derive `status` from `issue.state` + `status:*` label (`quay-github/src/github-client.js#issueToViewModel`, DESIGN.md §3). Live-verified §5.2 (`task_get gh-3 -> status=ready`, live `gh api`). |
| title | **full** — returned by `task_get`. Live-verified §5.2. | **full** — returned by `task_get`/`task_list` (issue title). Live-verified §5.2 (`gh3Before.title` read and compared). |
| body | **full** — returned by `task_get`. | **full** — returned by `task_get` (issue body, raw markdown). `provider.yml` comment: `body` "remain read-only" for **write** (see below), but read is unrestricted — `packages/quay-github/test/cli.test.mjs` test 3 asserts `t.title` non-empty; body read exercised by every gate/childrenStatus call (`extractGateSection` reads `task.body`). |
| labels | **full** — returned by `task_get` (frontmatter `labels` array). | **full** — returned by `task_get`/`task_list` (issue's own GitHub labels, minus the `status:*`/`lane:*` convention labels which are folded into `status`/`lane` fields — DESIGN.md §3). Live-verified: `gh issue view 3` shows `status:ready`,`lane:execution` labels, consistent with `task_get gh-3` output §5.2. |
| parent/children | **full** — returned by `task_get` (frontmatter `parent`/`children` fields, or derived `role`). Live-verified §5.2 (`ABI-C1 -> children=["ABI-C1-CHILD"]`, `role=compound`). | **full** (M09-gh-write, PR-ABI-002 CLOSED) — `children`: **full**, parsed from the issue body's own `- [ ] #N`/`- [x] #N` checkbox lines (DESIGN.md §3.2, `extractChildRefs`); `role` derives correctly from `children.length>0`, live-verified §5.2 for both `task_get` and `task_list` paths on the real `gh-7` compound issue. `parent`: **now full, path-symmetric** — `get()` (single-issue lookup, used by `task_get`) was fixed (M09-gh-write iteration-0) to also call `fetchAllIssues()`+`buildParentIndex()` (the same functions `list()` already used), closing the asymmetry this row previously logged as PR-ABI-002. **Live-verified this milestone**: `task_get gh-5 -> parent: "gh-7"`, `task_list`'s own `gh-5` entry -> `parent: "gh-7"` — both entry points now agree on the SAME real task (previously `task_get` unconditionally returned `null`). See M09-gh-write's iteration-0 report for the raw command output. PR-ABI-002 closed. |

## Write capability

| field | native | github |
|---|---|---|
| status | **full** — `task_write{status}` (MCP), `task edit --status` (CLI). Live-verified §5.2 (native ABI-P1 todo→ready). | **full** — `task_write{id,status}` (`quay-github/src/github-client.js#setStatus`, unchanged this milestone). Live-verified idempotent §5.2 (`gh-3`, `gh-7` status re-asserted, same value, no live mutation). |
| title | **full** — `task_write{title}` accepted and applied (`quay-native/src/mcp-server.js` line 85, `store.js#write` line 264 destructures `title`). | **full** (M09-gh-write, PR-ABI-001 CLOSED) — `task_write{title}` now accepted and REALLY applied via `github-client.js#writeFields` (`gh api ... -X PATCH -f title=...`). **Live-verified this milestone** against a dedicated scratch issue (`gh-11`, created specifically for this Done-when, not a production-tracking issue): `gh issue view 11 --json title` before = `"[M09-GH-WRITE-SCRATCH] Scratch issue for task_write title/body/labels live-mutation testing"`, after `task_write{id:"gh-11", title:"[M09-GH-WRITE-SCRATCH] title mutated by task_write live test"}` = `"[M09-GH-WRITE-SCRATCH] title mutated by task_write live test"` — real title change confirmed via a fresh `gh issue view` call, not just the tool's own echoed response. See M09-gh-write's iteration-0 report for the full before/after transcript. PR-ABI-001's title leg closed. |
| body | **full** — same mechanism as `title`. | **full** (M09-gh-write, PR-ABI-001 CLOSED) — same `writeFields` PATCH mechanism as `title`. **Live-verified this milestone** against `gh-11`: body before = the scratch-issue creation text, after `task_write{id:"gh-11", body:"body mutated by task_write live test..."}` = the new text, confirmed via `gh issue view 11 --json body`. PR-ABI-001's body leg closed. |
| labels | **full** — `task_write{labels}` replaces the full label array. | **full** (M09-gh-write, PR-ABI-001 CLOSED) — `task_write{labels}` now accepted; `writeFields` computes an add/remove diff against the issue's current NON-status/lane ("other") labels only (status:*/lane:* labels remain owned by the separate `setStatus`/`computeStatusWrite` path, deliberately not touched by this write, to avoid reintroducing DESIGN.md §3.1's precedence-ambiguity risk). **Live-verified this milestone** against `gh-11`: labels before = `["lane:execution"]`, after `task_write{id:"gh-11", labels:["m09-test-label"]}` = `["lane:execution", "m09-test-label"]` (confirmed via `gh issue view 11 --json labels`) — the pre-existing `lane:execution` label was correctly preserved (not a target of this write), and the new `m09-test-label` was correctly added. PR-ABI-001's labels leg closed. |
| parent/children | **full** — `task_write{parent, children}` accepted and applied (`store.js#write`). Live-verified §5.2 (`task edit ABI-C1 --children ABI-C1-CHILD`, then `task_get` confirms `children=["ABI-C1-CHILD"]`). | **none** — DELIBERATELY excluded from M09-gh-write's scope (see that charter's explicit exclusion: parent/children write would require editing a DIFFERENT issue's body text — the parent's checkbox list — a materially riskier cross-issue write path than the title/body/labels PATCH-on-self path, deferred to a future milestone rather than bundled here). `task_write{parent:...}` now returns an explicit `isError:true` MCP tool error (PR-ABI-001's hard-error floor, Done-when 4) rather than the prior silent no-op — **live-verified this milestone**: `task_write{id:"gh-3", status:<current>, parent:"gh-7"}` -> `isError:true`, message names `parent` as an unsupported field. This is a genuine, intentional "none" (no write CAPABILITY), now correctly signaled as such rather than silently dropped. |

## Gate capability

| field | native | github |
|---|---|---|
| status (primitive) | **full** — `task_check` on a primitive task (`store.js#check`). Live-verified §5.2 (`ABI-P1 -> ok=true, gate=execute->done`). | **full** — `task_check` on a primitive task (`github-client.js#checkGate`, ported line-for-line from native per DESIGN.md §3.5). Live-verified §5.2 (`gh-3 -> ok=false, gate=execute->done`, live AC-checkbox state). |
| status (compound) | **full** — recursive `childrenStatus()` (`store.js`), handles nested/cyclic graphs (`compound-gate-recursive.test.mjs`). Live-verified §5.2 (`ABI-C1 -> ok=true, childrenStatus present`). | **full** — same recursive algorithm, ported (QN-035/DIR-006, DESIGN.md §3.5), including cyclic/stale-done handling (`quay-github/test/compound-gate.test.mjs`, 8 cases, byte-for-byte structural mirror of native's own test). Live-verified §5.2 against the REAL `gh-7`/`gh-5`/`gh-6` compound issue structure (`ok=true, childrenStatus present=true`), not just the injected-fixture unit tests. |
| title/body/labels | N/A — gate operates on status+AC-checkbox-content+children only in both providers; title/body/labels are not independently gated fields in either Provider's design (DESIGN.md §3.5, `store.js#check`). Symmetric by design, not a gap. |
| parent/children | **full** — see "status (compound)" row above; parent/children gating is the same mechanism. | **full** — see "status (compound)" row above. |

## Skill capability

| field | native | github |
|---|---|---|
| status | **full** — `status_skill_map: {todo: quay:author, ready: quay:execute}` (`provider.yml`), consumed generically by Core's `composePayload()` (`packages/quay/src/action.js`, zero Provider-specific branching — confirmed by reading the file in full, matches provider.yml's own comment). Exercised by QN-029/QN-035 per DESIGN.md citations. | **full** — IDENTICAL `status_skill_map`/`action_buttons` shape (live-confirmed this iteration: `quay-github/bin/quay-github.js manifest` §5.3 output byte-matches native's own mapping for `todo`/`ready`). Same generic `composePayload()` consumes it — no Provider branch exists to diverge. Skill execution itself (the `quay:author`/`quay:execute` Skill FILES) is shared, not duplicated (`skills_path: "../quay-native/skills"` in `quay-github/provider.yml`, documented as deliberate non-duplication, not a gap). |
| title/body/labels/parent/children | N/A — the Skill capability's ABI surface is exactly `status_skill_map` + `action_buttons`, keyed only by `task.status`; it has no independent title/body/labels/parent/children sub-capability to score in either Provider. Symmetric by design. |

## Summary — cell count

**Updated M09-gh-write, iteration-0 (2026-07-18) — PR-ABI-001/PR-ABI-002 now CLOSED.** The
cell-count/realized-conformance figures below are RESCORED from this milestone's own live
evidence (M09-gh-write's iteration-0 report has the full command transcripts); the original
M03-abi-eval prose is preserved above per-cell (each cell's own write-up documents both the
original finding and this milestone's fix), this section is the rolled-up rescore.

- **20 scored cells** (4 capabilities × 5 fields), of which **6 are N/A by design** (gate/skill's
  title/body/labels rows, and skill's parent/children row) — these are not gaps, both providers
  are symmetric because neither capability has a field-level sub-surface for those fields.
- Of the **14 substantively-scored cells**: **13 full/full** (read×5 — including parent/children,
  now fixed; write×3 — status/title/body/labels, i.e. 4 of the 5 write fields; gate×2; skill×1),
  **1 intentionally-scoped-out** (write's parent/children cell: native=full, github=**none**,
  by DELIBERATE charter exclusion — not a gap, an explicit scope boundary, and now correctly
  hard-errors instead of silently no-op'ing).
- **Realized conformance**: read 5/5 full-symmetric (PR-ABI-002 closed — `get()`/`list()` parent
  resolution now agree); write 4/5 full-symmetric (status+title+body+labels; parent/children
  deliberately excluded this milestone, floor error confirmed); gate 2/2 full-symmetric; skill
  1/1 full-symmetric. **13 of 14 non-N/A cross-provider-comparable cells are full/full symmetric;
  1 is an intentional, correctly-signaled scope exclusion (parent/children write), not a
  silent gap.**

## Findings feeding the VT re-baseline (§ dashboard.md)

(Note: this experiment's own convention tracks gap findings directly in this matrix + `dashboard.md`'s
Log section, not a separate `gap-list.md` file — that file exists in the sibling exp4 experiment
only; M09-gh-write's charter's "gap-list.md" references should be read as this section, per
this experiment's actual file layout confirmed at M09-gh-write's it0.)

1. **PR-ABI-001 — CLOSED (M09-gh-write, iteration-0).** Originally: title/body/labels write on
   github silently dropped, not rejected. Fix: `github-client.js#writeFields` (real PATCH-based
   title/body write + add/remove-diff labels write) + `mcp-server.js`'s `task_write` schema
   rebuilt with a zod `.catchall()` so unrecognized fields survive validation instead of being
   silently stripped, then explicitly rejected (`isError:true`) in the handler. Real live writes
   verified against a dedicated scratch issue (`gh-11`); hard-error floor verified against the
   real `parent` field (out of this milestone's write scope). See M09-gh-write's iteration-0
   report for full command transcripts.
2. **PR-ABI-002 — CLOSED (M09-gh-write, iteration-0).** Originally: github's `task.parent` field
   was path-dependent — correct via `task_list`, always `null` via `task_get` on the same real
   task. Fix: `github-client.js#get()` now also calls `fetchAllIssues()`+`buildParentIndex()`
   (the same functions `list()` already used) before building its view-model. Verified live
   against the real `gh-5`/`gh-7` parent/child pair already used by this matrix's own conformance
   suite: `task_get gh-5 -> parent: "gh-7"`, matching `task_list`'s already-correct result.
3. No divergence was found in **read** (now fully closed), **gate**, or **skill** capability
   shape — the ABI surfaces this milestone COULD have found broadly misaligned (gate/skill were
   the "ported but thin" and "declarative-only" surfaces DIR-001 flagged as uncertain) turned out,
   on live differential testing, to be fully symmetric. The one remaining asymmetric cell
   (write's parent/children) is now an INTENTIONAL, charter-scoped exclusion with a correctly
   signaled hard error, not a silent gap — the write-completeness surface is materially closer to
   full parity than the original M03-abi-eval baseline (1/5 write fields) found.
