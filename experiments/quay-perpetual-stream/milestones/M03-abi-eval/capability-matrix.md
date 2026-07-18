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
| parent/children | **full** — returned by `task_get` (frontmatter `parent`/`children` fields, or derived `role`). Live-verified §5.2 (`ABI-C1 -> children=["ABI-C1-CHILD"]`, `role=compound`). | **partial** — `children`: **full**, parsed from the issue body's own `- [ ] #N`/`- [x] #N` checkbox lines (DESIGN.md §3.2, `extractChildRefs`); `role` derives correctly from `children.length>0`, live-verified §5.2 for both `task_get` and `task_list` paths on the real `gh-7` compound issue. `parent`: **partial, path-dependent** — `list()` builds a full-repo `parentIndex` and correctly populates `parent` (verified live: `task_list`'s own `gh-5` entry reports `parent: "gh-7"`, matching the real parent-child issue structure), but `get()` (single-issue lookup, used by `task_get`) is DOCUMENTED in source (`github-client.js#get`, comment: "Single-issue lookup cannot cheaply compute parent... parent is left null in this path") to always return `parent: null` regardless of whether a real parent exists — **live-confirmed this iteration** (`task_get gh-5 -> parent: null`, same real issue that `task_list` correctly resolves to `parent: "gh-7"`). This means the same field, on the same real task, returns a different (silently degraded, not erroring) answer depending on which of two read entry points a caller uses — a genuinely new, precisely-bounded finding (the source comment self-documents the limitation, but no test previously exercised or cited this exact list-vs-get asymmetry). Logged as PR-ABI-002 below. |

## Write capability

| field | native | github |
|---|---|---|
| status | **full** — `task_write{status}` (MCP), `task edit --status` (CLI). Live-verified §5.2 (native ABI-P1 todo→ready). | **partial→full for status only** — `task_write{id,status}` is the ENTIRE write schema (`quay-github/src/mcp-server.js` line 95: `inputSchema: { id: z.string(), status: z.string() }`); CLI mirrors this (`bin/quay-github.js`: `task edit` requires `--status`, no other write flag exists at all). Live-verified idempotent §5.2 (`gh-3`, `gh-7` status re-asserted, same value, no live mutation). |
| title | **full** — `task_write{title}` accepted and applied (`quay-native/src/mcp-server.js` line 85, `store.js#write` line 264 destructures `title`). | **none** — `task_write`'s zod `inputSchema` does not declare `title`; the MCP SDK **silently strips** any extra `title` argument before it reaches `client.setStatus()` (which only ever touches labels/open-close, never `PATCH .../issues/:n {title}`). **Live-verified this iteration** (§5.2, `task_write-unsupported-field-probe`): calling `task_write{id:"gh-3", status:<current>, title:"...PROBE..."}` returned `isError: undefined` (no error surfaced) and the real GitHub issue's title was **unchanged** — confirmed independently via a live `gh issue view 3` call after the test run. This is the spot-check the charter's item 1 explicitly demanded (do not trust `provider.yml`'s "title/body/labels/parent/children remain unimplemented" comment alone) — **confirmed: not merely "unimplemented" in the sense of erroring, but silently no-op'd**, a materially different (and more dangerous, from a caller's perspective) failure mode than a clear rejection. Logged as PR-ABI-001. |
| body | **full** — same mechanism as `title`. | **none** — same silent-drop mechanism as `title` (not independently re-probed live this iteration beyond the `title` case, since the code path is identical — `inputSchema` has no `body` field at all, same zod-stripping applies; citing PR-ABI-001 as covering both). |
| labels | **full** — `task_write{labels}` replaces the full label array. | **none** for arbitrary/non-status labels — same schema gap as title/body. Note the ASYMMETRY: github's write DOES touch labels internally (`computeStatusWrite()` adds/removes `status:*` labels as a SIDE EFFECT of a status write — `write.test.mjs` Cases 2/3/5), but this is not a general `labels` write capability exposed to the caller; a caller cannot set an arbitrary non-status label via `task_write`. |
| parent/children | **full** — `task_write{parent, children}` accepted and applied (`store.js#write`). Live-verified §5.2 (`task edit ABI-C1 --children ABI-C1-CHILD`, then `task_get` confirms `children=["ABI-C1-CHILD"]`). | **none** — same schema gap; `children` is derived read-only from body checkbox parsing (DESIGN.md §3.2 explicitly: "does NOT use GitHub's separate sub-issues API — deliberately out of scope"), no write path exists (would require editing issue body text, which `task_write`'s schema does not accept at all). |

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

- **20 scored cells** (4 capabilities × 5 fields), of which **6 are N/A by design** (gate/skill's
  title/body/labels rows, and skill's parent/children row) — these are not gaps, both providers
  are symmetric because neither capability has a field-level sub-surface for those fields.
- Of the **14 substantively-scored cells**: **10 full/full** (read×5, gate×2 scored rows ×
  both providers all full; skill×1 scored row both full), **4 divergent** (write: status
  full/full, but title/body/labels/parent-children native=full vs github=none — 4 cells).
  Read's parent/children cell is **native=full, github=partial** (children full, parent
  field entirely absent from the view-model — PR-ABI-002).
- **Realized conformance**: read 5/5 full-symmetric (with one internal partial noted in the
  parent sub-field, PR-ABI-002); write 1/5 full-symmetric (status only); gate 2/2 full-symmetric;
  skill 1/1 full-symmetric. **9 of 13 non-N/A cross-provider-comparable cells are full/full
  symmetric; 4 are asymmetric (all in write, all previously known-in-general per DIR-001 but
  now precisely bounded and live-verified, not merely asserted).**

## Findings feeding the VT re-baseline (§ dashboard.md) and gap-list

1. **PR-ABI-001** (title/body/labels write on github: silently dropped, not rejected) — see
   gap-list.md entry.
2. **PR-ABI-002** (github's `task.parent` field is path-dependent: correct via `task_list`,
   always `null` via `task_get` on the same real task) — see gap-list.md entry.
3. No divergence was found in **read**, **gate**, or **skill** capability shape (beyond
   PR-ABI-002's field-level omission) — a genuinely NEW, previously-unmeasured finding: the
   ABI surfaces this milestone COULD have found broadly misaligned (gate/skill were the
   "ported but thin" and "declarative-only" surfaces DIR-001 flagged as uncertain) turned out,
   on live differential testing, to be fully symmetric. This is itself evidence the blind spot
   was real (nobody had checked) but the underlying implementation, where it existed, was
   already sound — the actual gap is narrower (write-completeness only) than the charter's own
   pre-dispatch framing worried it might be.
